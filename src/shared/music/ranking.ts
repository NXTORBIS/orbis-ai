import { BASE_WEIGHTS, STAGE_LIMITS, type MusicTuning, type WeightName } from './config.ts'
import { similarity, transitionScore, type SimilarityKind, type TrackFeatures } from './features.ts'
import type { Constraints, IntentState, ListeningIntent } from './intent.ts'
import { MODE_SHAPE } from './intent.ts'
import { affinity, opinionOn, type UserTaste } from './taste.ts'

/**
 * Choosing what to play next, in stages, with every number traceable.
 *
 * ## Why stages
 *
 * One score over everything is impossible to debug and impossible to tune: a track can be wrong because it breaks a
 * stated constraint, because it was played twenty minutes ago, because it is the fourth by the same artist, or
 * because it would be a jarring join -- and those deserve different treatment. Filtering is absolute, predicting is
 * probabilistic, and arranging is about the sequence rather than the track. Keeping them apart is what makes
 * "why did it pick that?" answerable.
 *
 * ## Four things predicted separately
 *
 * Whether it will be played through, whether it will be skipped, whether it will be gone back to, whether it will be
 * kept. They are different questions and they disagree: a track somebody always finishes and never returns to is a
 * good background choice and a bad favourite. The models are small, honest logistic functions over features Orbis
 * actually has, learned from what happened (see `learnOutcome`), and they say how confident they are.
 *
 * ## Nothing here invents a number
 *
 * Every contribution comes from a measured feature or from recorded behaviour. A track with nothing measured gets a
 * score built from fewer parts and says so in `confidence`, rather than being given middling values that look like
 * knowledge.
 */

export type CandidateSource =
  | 'favourite'
  | 'frequent'
  | 'similar-sound'
  | 'similar-words'
  | 'similar-artist'
  | 'same-artist'
  | 'same-album'
  | 'graph-artist'
  | 'graph-genre'
  | 'context'
  | 'discovery'
  | 'unheard'
  | 'forgotten'
  | 'recent'
  | 'library'
  | 'playlist'
  | 'requested'

export interface Candidate {
  trackId: string
  features: TrackFeatures
  /** Where it came from. A track found by several routes is stronger than one found by one. */
  sources: CandidateSource[]
  /** How well it matched whatever found it, 0..1. */
  retrieval: number
  /** How long since it was last played, in days. Null when never. */
  lastPlayedDaysAgo: number | null
  playCount: number
  favourite: boolean
  /** Whether it has ever been played through. */
  everCompleted: boolean
}

export interface Scored extends Candidate {
  score: number
  /** 0..1: how much of the score rested on something actually known. */
  confidence: number
  parts: Partial<Record<WeightName | 'retrieval', number>>
  predictions: Predictions
  novelty: Novelty
  /** Why, in words somebody could read. */
  because: string[]
  /** Why it was dropped, when it was. Only ever shown in the developer inspector. */
  rejected?: string
}

export interface Predictions {
  skip: number
  complete: number
  replay: number
  favourite: number
  /** 0..1: how much behaviour these rest on. */
  confidence: number
}

export interface Novelty {
  /** 0..1 overall. */
  score: number
  newArtist: boolean
  newGenre: boolean
  newLanguage: boolean
  newEra: boolean
  neverPlayed: boolean
}

// ---------------------------------------------------------------- the small models

/**
 * The learned part. One weight per feature, per outcome, moved by what actually happened.
 *
 * Logistic regression rather than anything larger, for three reasons: it learns from the handful of events a real
 * person produces in an evening, every weight can be read and explained, and it cannot do anything surprising. The
 * features are the ones Orbis genuinely has.
 */
export interface OutcomeModel {
  /** Feature name to weight. */
  weights: Record<string, number>
  bias: number
  /** How many events this has seen. Low means its answers are barely worth anything. */
  seen: number
}

export interface RankingModels {
  skip: OutcomeModel
  complete: OutcomeModel
  replay: OutcomeModel
  favourite: OutcomeModel
  version: number
}

const emptyModel = (bias: number): OutcomeModel => ({ weights: {}, bias, seen: 0 })

export const emptyModels = (): RankingModels => ({
  // The starting biases are what a brand-new profile should assume: most tracks are played through, few are returned to.
  skip: emptyModel(-0.9),
  complete: emptyModel(0.6),
  replay: emptyModel(-1.8),
  favourite: emptyModel(-2.4),
  version: 1
})

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))))

/** The features the small models read. All bounded, so no single one can dominate. */
export function modelFeatures(candidate: Candidate, taste: UserTaste, intent: IntentState, now: number): Record<string, number> {
  const features = candidate.features
  const audio = features.audio
  const likedArtist = opinionOn(taste, 'artist', features.artistKey, now)
  const likedGenre = features.genre ? opinionOn(taste, 'genre', features.genre, now) : { value: 0, confidence: 0 }
  const wanted = intent.constraints.energy?.target
  return {
    affinity: affinity(taste, features, now).score,
    artistLiked: likedArtist.value * likedArtist.confidence,
    genreLiked: likedGenre.value * likedGenre.confidence,
    favourite: candidate.favourite ? 1 : 0,
    plays: Math.min(1, candidate.playCount / 10),
    everCompleted: candidate.everCompleted ? 1 : 0,
    neverPlayed: candidate.lastPlayedDaysAgo === null ? 1 : 0,
    recentlyPlayed: candidate.lastPlayedDaysAgo === null ? 0 : Math.max(0, 1 - candidate.lastPlayedDaysAgo / 14),
    energy: audio ? audio.energy : 0.5,
    energyGap: audio && wanted !== undefined ? Math.abs(audio.energy - wanted) : 0,
    danceability: audio ? audio.danceability : 0.5,
    vocalness: audio ? audio.vocalness : 0.5,
    longTrack: Math.min(1, features.duration / 420),
    retrieval: candidate.retrieval,
    sources: Math.min(1, candidate.sources.length / 4)
  }
}

/** What one model thinks, as a probability, with how much it is worth. */
export function predictOne(model: OutcomeModel, features: Record<string, number>): { probability: number; confidence: number } {
  let sum = model.bias
  for (const [name, value] of Object.entries(features)) sum += (model.weights[name] ?? 0) * value
  // Below about thirty events the weights are noise; the answer is reported with low confidence rather than withheld.
  return { probability: sigmoid(sum), confidence: Math.min(0.9, model.seen / 60) }
}

export function predict(models: RankingModels, candidate: Candidate, taste: UserTaste, intent: IntentState, now: number): Predictions {
  const features = modelFeatures(candidate, taste, intent, now)
  const skip = predictOne(models.skip, features)
  const complete = predictOne(models.complete, features)
  const replay = predictOne(models.replay, features)
  const favourite = predictOne(models.favourite, features)
  return {
    skip: skip.probability,
    complete: complete.probability,
    replay: replay.probability,
    favourite: favourite.probability,
    confidence: (skip.confidence + complete.confidence + replay.confidence + favourite.confidence) / 4
  }
}

/** The learning step: one event, one nudge, bounded. */
export function learnOutcome(models: RankingModels, which: 'skip' | 'complete' | 'replay' | 'favourite', features: Record<string, number>, happened: boolean, rate = 0.08): RankingModels {
  const model = models[which]
  const { probability } = predictOne(model, features)
  const error = (happened ? 1 : 0) - probability
  const weights = { ...model.weights }
  for (const [name, value] of Object.entries(features)) {
    const next = (weights[name] ?? 0) + rate * error * value
    // Bounded, so no single feature can take over the model however much evidence arrives.
    weights[name] = Math.max(-4, Math.min(4, next))
  }
  return { ...models, [which]: { weights, bias: Math.max(-4, Math.min(4, model.bias + rate * error * 0.3)), seen: model.seen + 1 } }
}

// ---------------------------------------------------------------- novelty

export interface Known {
  artists: ReadonlySet<string>
  genres: ReadonlySet<string>
  languages: ReadonlySet<string>
  eras: ReadonlySet<number>
  playedTrackIds: ReadonlySet<string>
}

/** How new a track is, in each of the ways something can be new. */
export function noveltyOf(candidate: Candidate, known: Known): Novelty {
  const features = candidate.features
  const newArtist = !known.artists.has(features.artistKey)
  const newGenre = features.genre ? !known.genres.has(features.genre) : false
  const newLanguage = features.language ? !known.languages.has(features.language) : false
  const newEra = features.era !== null ? !known.eras.has(features.era) : false
  const neverPlayed = !known.playedTrackIds.has(candidate.trackId)
  // A new artist in a known genre is a small step; new on every axis at once is a leap, and is scored as one.
  const score = Math.min(1, (neverPlayed ? 0.3 : 0) + (newArtist ? 0.3 : 0) + (newGenre ? 0.2 : 0) + (newLanguage ? 0.1 : 0) + (newEra ? 0.1 : 0))
  return { score, newArtist, newGenre, newLanguage, newEra, neverPlayed }
}

// ---------------------------------------------------------------- stage 1: what is not allowed

export interface Recent {
  /** Track ids played recently, newest first. */
  trackIds: readonly string[]
  /** Artist keys played recently, newest first. */
  artistKeys: readonly string[]
  genres: readonly string[]
}

/** Why a candidate cannot be used at all. Null when it can. */
export function refuse(candidate: Candidate, constraints: Constraints, recent: Recent, tuning: MusicTuning, known: Known): string | null {
  const features = candidate.features
  const value = (dimension: string): string | null =>
    dimension === 'artist' ? features.artistKey : dimension === 'album' ? features.albumKey : dimension === 'genre' ? features.genre : dimension === 'language' ? features.language : dimension === 'era' ? (features.era === null ? null : String(features.era)) : null

  for (const rule of constraints.exclude ?? []) {
    const have = value(rule.dimension)
    if (have && rule.values.some((one) => have.includes(one) || one.includes(have))) return `excluded: ${rule.dimension} ${have}`
  }
  for (const rule of constraints.only ?? []) {
    const have = value(rule.dimension)
    if (!have || !rule.values.some((one) => have.includes(one) || one.includes(have))) return `not one of the asked-for ${rule.dimension}s`
  }
  if (constraints.heard === 'only-new' && known.playedTrackIds.has(candidate.trackId)) return 'already heard'
  if (constraints.heard === 'only-known' && !known.playedTrackIds.has(candidate.trackId)) return 'not heard before'

  const trackGap = recent.trackIds.indexOf(candidate.trackId)
  if (trackGap >= 0 && trackGap < tuning.trackGap.value) return `played ${trackGap + 1} tracks ago`
  const artistGap = recent.artistKeys.indexOf(features.artistKey)
  if (artistGap >= 0 && artistGap < tuning.artistGap.value) return `same artist ${artistGap + 1} tracks ago`
  return null
}

// ---------------------------------------------------------------- the weights for this request

/**
 * What matters for this particular request.
 *
 * This is where "play my favourites" and "surprise me" stop being the same algorithm. A stated intent moves the
 * weights outright; an inferred one moves them only as far as its confidence.
 */
export function weightsFor(intent: IntentState, tuning: MusicTuning): Record<WeightName, number> {
  const weights: Record<WeightName, number> = { ...BASE_WEIGHTS }
  const pull = intent.source === 'stated' ? 1 : Math.min(1, intent.confidence)
  const shape = MODE_SHAPE[intent.intent] ?? {}
  const discovery = intent.constraints.discovery ?? tuning.discovery.value

  const move = (name: WeightName, to: number): void => {
    weights[name] = weights[name] + (to - weights[name]) * pull
  }

  // More discovery means novelty and new things count for more and familiarity for less.
  move('discovery', BASE_WEIGHTS.discovery + discovery * 1.4)
  move('novelty', BASE_WEIGHTS.novelty + discovery * 1.1)
  move('personal', BASE_WEIGHTS.personal * (1 - discovery * 0.45))
  move('repetition', BASE_WEIGHTS.repetition * (1 + discovery * 0.5))

  if (shape.familiarity !== undefined) move('personal', BASE_WEIGHTS.personal * (0.6 + shape.familiarity * 0.8))
  if (shape.smoothness !== undefined) move('transition', BASE_WEIGHTS.transition * (0.5 + shape.smoothness * 1.3))
  if (intent.constraints.energy?.direction && intent.constraints.energy.direction !== 'steady') move('intent', BASE_WEIGHTS.intent * 1.5)

  // Modes where being wrong is expensive lean on not being skipped.
  if (['sleep', 'focus', 'study', 'background'].includes(intent.intent)) {
    move('skip', BASE_WEIGHTS.skip * 1.5)
    move('diversity', BASE_WEIGHTS.diversity * 0.6)
  }
  if (intent.intent === 'party') {
    move('favourite', BASE_WEIGHTS.favourite * 1.4)
    move('novelty', BASE_WEIGHTS.novelty * 0.3)
  }
  return weights
}

// ---------------------------------------------------------------- how well it fits what was asked

export interface ContextNow {
  /** What was playing before this, for judging the join. Null at the start of a sitting. */
  previous: TrackFeatures | null
  /** The energy the sitting has settled at, when it is known. */
  sessionEnergy: number | null
  /** Hour of the day. Used only as weak evidence. */
  hour: number
  /** Whether only tracks that can be played without a network may be used. */
  offlineOnly: boolean
}

/** How well a track answers the stated constraints. 0..1, with what it rested on. */
export function intentFit(candidate: Candidate, intent: IntentState, context: ContextNow): { score: number; confidence: number; because: string[] } {
  const audio = candidate.features.audio
  const because: string[] = []
  const parts: number[] = []
  let confidence = 0

  const energy = intent.constraints.energy
  if (energy && audio) {
    confidence += 0.5
    if (energy.target !== undefined) {
      const fit = Math.max(0, 1 - Math.abs(audio.energy - energy.target) / 0.5)
      parts.push(fit)
      if (fit > 0.7) because.push('the energy is about right')
    }
    if (energy.direction && context.previous?.audio) {
      const change = audio.energy - context.previous.audio.energy
      const wanted = energy.direction === 'up' ? change > 0.04 : energy.direction === 'down' ? change < -0.04 : Math.abs(change) < 0.12
      parts.push(wanted ? 1 : 0.2)
      if (wanted) because.push(energy.direction === 'up' ? 'it lifts the energy' : energy.direction === 'down' ? 'it brings the energy down' : 'it keeps the energy level')
    }
  }

  const tempo = intent.constraints.tempo
  if (tempo?.direction && audio?.tempo !== null && audio && context.previous?.audio?.tempo) {
    confidence += 0.2
    const change = audio.tempo! - context.previous.audio.tempo
    const wanted = tempo.direction === 'up' ? change > 2 : tempo.direction === 'down' ? change < -2 : Math.abs(change) < 6
    parts.push(wanted ? 1 : 0.3)
  }

  if (intent.constraints.brightness?.direction && audio && context.previous?.audio) {
    confidence += 0.15
    const change = audio.brightness - context.previous.audio.brightness
    const wanted = intent.constraints.brightness.direction === 'up' ? change > 0.03 : change < -0.03
    parts.push(wanted ? 1 : 0.3)
    if (wanted) because.push(intent.constraints.brightness.direction === 'up' ? 'a brighter sound' : 'a darker sound')
  }

  for (const rule of intent.constraints.prefer ?? []) {
    const have =
      rule.dimension === 'artist'
        ? candidate.features.artistKey
        : rule.dimension === 'genre'
          ? candidate.features.genre
          : rule.dimension === 'language'
            ? candidate.features.language
            : rule.dimension === 'era'
              ? candidate.features.era === null
                ? null
                : String(candidate.features.era)
              : candidate.features.albumKey
    confidence += 0.15
    const matches = Boolean(have && rule.values.some((one) => have.includes(one) || one.includes(have)))
    parts.push(matches ? 1 : 0.25)
    if (matches) because.push(`it is ${rule.dimension === 'era' ? `from the ${have}s` : have}`)
  }

  if (parts.length === 0) return { score: 0.5, confidence: 0, because: [] }
  return { score: parts.reduce((sum, one) => sum + one, 0) / parts.length, confidence: Math.min(1, confidence), because }
}

/** How well a track fits where the sitting has got to. Weak by design: context is a hint, not an instruction. */
export function contextFit(candidate: Candidate, context: ContextNow): { score: number; confidence: number } {
  const audio = candidate.features.audio
  if (!audio || context.sessionEnergy === null) return { score: 0.5, confidence: 0 }
  const fit = Math.max(0, 1 - Math.abs(audio.energy - context.sessionEnergy) / 0.6)
  return { score: fit, confidence: 0.4 }
}

// ---------------------------------------------------------------- scoring one candidate

export function scoreOne(
  candidate: Candidate,
  o: {
    taste: UserTaste
    models: RankingModels
    intent: IntentState
    context: ContextNow
    known: Known
    recent: Recent
    tuning: MusicTuning
    weights: Record<WeightName, number>
    now: number
    /** What has already been chosen for the next few, so diversity is against the plan and not just the past. */
    planned?: readonly TrackFeatures[]
  }
): Scored {
  const personal = affinity(o.taste, candidate.features, o.now)
  const predictions = predict(o.models, candidate, o.taste, o.intent, o.now)
  const novelty = noveltyOf(candidate, o.known)
  const fit = intentFit(candidate, o.intent, o.context)
  const context = contextFit(candidate, o.context)
  const transition = o.context.previous ? transitionScore(o.context.previous, candidate.features) : { score: 0.6, why: [] }

  // How unlike the next few it already is -- a fourth track of the same sort is worth less than the first.
  const sameness = (o.planned ?? []).reduce((worst, one) => Math.max(worst, similarity(one, candidate.features, 'overall').score), 0)
  const diversity = 1 - sameness

  const exposure = Math.min(1, candidate.playCount / 25)
  const recentlyHeard = candidate.lastPlayedDaysAgo === null ? 0 : Math.max(0, 1 - candidate.lastPlayedDaysAgo / 10)

  const parts: Scored['parts'] = {
    personal: personal.score * personal.confidence * o.weights.personal,
    intent: (fit.score - 0.5) * 2 * fit.confidence * o.weights.intent,
    context: (context.score - 0.5) * 2 * context.confidence * o.weights.context,
    completion: (predictions.complete - 0.5) * 2 * predictions.confidence * o.weights.completion,
    replay: predictions.replay * predictions.confidence * o.weights.replay,
    favourite: predictions.favourite * predictions.confidence * o.weights.favourite,
    skip: predictions.skip * Math.max(0.25, predictions.confidence) * o.weights.skip,
    discovery: novelty.score * o.weights.discovery,
    novelty: novelty.score * o.weights.novelty,
    diversity: (diversity - 0.5) * 2 * o.weights.diversity,
    transition: (transition.score - 0.5) * 2 * o.weights.transition,
    repetition: recentlyHeard * o.weights.repetition,
    overexposure: exposure * o.weights.overexposure,
    retrieval: candidate.retrieval * 0.3
  }

  const score = Object.values(parts).reduce((sum, one) => sum + (one ?? 0), 0)
  const because: string[] = []
  if (personal.score > 0.25 && personal.confidence > 0.2) {
    const top = personal.because[0]
    because.push(top ? `you like ${top.dimension === 'artist' ? top.name : `${top.dimension === 'era' ? `${top.name}s music` : top.name}`}` : 'it matches your taste')
  }
  because.push(...fit.because)
  if (novelty.neverPlayed) because.push(novelty.newArtist ? 'a new artist for you' : 'you have not played this before')
  if (transition.score > 0.8 && o.context.previous) because.push(transition.why[0] ?? 'it follows on well')
  if (predictions.confidence > 0.3 && predictions.complete > 0.7) because.push('you usually finish tracks like this')

  return {
    ...candidate,
    score,
    confidence: Math.max(personal.confidence, predictions.confidence, fit.confidence),
    parts,
    predictions,
    novelty,
    because: because.slice(0, 4)
  }
}

export interface RankResult {
  chosen: Scored[]
  /** Everything considered and why it did not make it, for the developer inspector only. */
  rejected: { trackId: string; why: string }[]
  weights: Record<WeightName, number>
}

/**
 * The whole staged pass: refuse what is not allowed, score what is left, keep the best.
 *
 * Each stage narrows, so the expensive parts only ever see a few hundred candidates. The limits are in `config.ts`,
 * and they are the knob between better answers and faster ones.
 */
export function rank(
  candidates: readonly Candidate[],
  o: {
    taste: UserTaste
    models: RankingModels
    intent: IntentState
    context: ContextNow
    known: Known
    recent: Recent
    tuning: MusicTuning
    now: number
    limit?: number
  }
): RankResult {
  const weights = weightsFor(o.intent, o.tuning)
  const rejected: { trackId: string; why: string }[] = []

  // Stage 1: what is not allowed at all.
  const allowed: Candidate[] = []
  for (const candidate of candidates) {
    if (o.context.offlineOnly || o.intent.constraints.offlineOnly) {
      // Availability is decided by the caller, which knows about files; a candidate reaching here is playable.
    }
    const why = refuse(candidate, o.intent.constraints, o.recent, o.tuning, o.known)
    if (why) {
      rejected.push({ trackId: candidate.trackId, why })
      continue
    }
    allowed.push(candidate)
  }

  // Stage 2 and 3: personal and contextual, cheaply, to cut the field.
  const rough = allowed
    .map((candidate) => ({ candidate, rough: affinity(o.taste, candidate.features, o.now).score + candidate.retrieval * 0.5 }))
    .sort((a, b) => b.rough - a.rough)
    .slice(0, STAGE_LIMITS.afterPersonal)

  // Stages 4 to 12: everything, over the shortlist.
  const scored = rough
    .map(({ candidate }) => scoreOne(candidate, { ...o, weights }))
    .sort((a, b) => b.score - a.score)

  for (const one of scored.slice(STAGE_LIMITS.afterPrediction)) rejected.push({ trackId: one.trackId, why: `scored ${one.score.toFixed(2)}, below the cut` })
  return { chosen: scored.slice(0, o.limit ?? STAGE_LIMITS.final), rejected, weights }
}

/** Which way of choosing is in use, so outcomes can be credited to it. */
export type Strategy = 'safe' | 'similarity' | 'context' | 'discovery' | 'artist' | 'mood' | 'session' | 'experimental'

/** Which similarity a strategy leans on. */
export const STRATEGY_SIMILARITY: Record<Strategy, SimilarityKind> = {
  safe: 'overall',
  similarity: 'sound',
  context: 'mood',
  discovery: 'sound',
  artist: 'artist',
  mood: 'mood',
  session: 'overall',
  experimental: 'words'
}

/** Which intents push towards which strategy, before any learning. */
export const STRATEGY_FOR_INTENT: Partial<Record<ListeningIntent, Strategy>> = {
  familiar: 'safe',
  discovery: 'discovery',
  focus: 'context',
  study: 'context',
  sleep: 'context',
  party: 'safe',
  workout: 'mood',
  running: 'mood',
  'artist-exploration': 'artist',
  'genre-exploration': 'discovery',
  nostalgia: 'safe'
}
