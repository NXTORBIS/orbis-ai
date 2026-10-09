import { EVENT_WEIGHTS, EARLY_SKIP_SECONDS, HALF_LIFE_DAYS, type MusicEventKind } from './config.ts'
import type { FeatureName, TrackFeatures } from './features.ts'

/**
 * What somebody likes, as something that can be wrong.
 *
 * Every preference here carries how sure Orbis is of it and how much it rests on. That is the difference between a
 * recommender that learns and one that lurches: "rock 0.73" is useless on its own, and "rock 0.73, from four plays,
 * confidence 0.2" tells the engine to test the idea rather than act on it.
 *
 * ## Three layers that do not overwrite each other
 *
 * **Long term** moves slowly -- months of listening. **Recent** moves in weeks, so a phase shows up without
 * destroying everything underneath it. **Session** moves in minutes, which is what makes "something calmer" work
 * without becoming "this person likes calm music".
 *
 * ## What somebody says beats what Orbis measured
 *
 * An explicit preference is a decision, not a measurement, so it barely decays and it wins. A person who says "never
 * this genre" and then plays one track from it has not changed their mind; they have made an exception.
 *
 * ## Skipping is not a verdict on a song
 *
 * A skip is evidence that *something* was wrong, and `attribute` works out what. One skip moves nothing much. Several
 * skips that share a feature move that feature -- which is how "no more of this bass-heavy stuff" is learned without
 * blacklisting a genre somebody mostly likes.
 */

/** One thing somebody is thought to like, with everything needed to doubt it. */
export interface Preference {
  /** -1 (dislikes) to 1 (likes). */
  value: number
  /** 0..1: how much the evidence supports this. Low means "try it and see". */
  confidence: number
  /** The weight of evidence behind it, decayed. */
  strength: number
  /** How recent the evidence is, 0..1. */
  recency: number
  /** How many separate pieces of evidence. */
  evidence: number
  /** Where it came from. Explicit beats measured, everywhere. */
  source: 'explicit' | 'behaviour'
  updatedAt: number
}

export const NO_PREFERENCE: Preference = Object.freeze({ value: 0, confidence: 0, strength: 0, recency: 0, evidence: 0, source: 'behaviour', updatedAt: 0 })

/** The things a preference can be about. Each is its own space of names. */
export type TasteDimension = 'artist' | 'album' | 'genre' | 'language' | 'era' | 'theme' | 'energy' | 'tempo' | 'brightness' | 'danceability' | 'vocalness' | 'duration'

/** A set of preferences in one dimension, by name. */
export type PreferenceMap = Record<string, Preference>

export interface TasteLayer {
  /** Which window this layer is: how fast it forgets. */
  halfLifeDays: number
  by: Record<TasteDimension, PreferenceMap>
}

export interface UserTaste {
  longTerm: TasteLayer
  recent: TasteLayer
  session: TasteLayer
  /** Said outright, and kept apart from everything measured. */
  explicit: TasteLayer
  /** How much new music this person has been taking, learned from what they do with it. */
  discoveryAppetite: Preference
  /** Totals, for the honest "your music" summary. */
  counts: { events: number; tracks: number; sessions: number }
  updatedAt: number
}

const emptyLayer = (halfLifeDays: number): TasteLayer => ({
  halfLifeDays,
  by: { artist: {}, album: {}, genre: {}, language: {}, era: {}, theme: {}, energy: {}, tempo: {}, brightness: {}, danceability: {}, vocalness: {}, duration: {} }
})

export const emptyTaste = (): UserTaste => ({
  longTerm: emptyLayer(HALF_LIFE_DAYS.longTerm),
  recent: emptyLayer(HALF_LIFE_DAYS.recent),
  session: emptyLayer(HALF_LIFE_DAYS.session),
  explicit: emptyLayer(HALF_LIFE_DAYS.explicit),
  discoveryAppetite: { ...NO_PREFERENCE },
  counts: { events: 0, tracks: 0, sessions: 0 },
  updatedAt: 0
})

const DAY = 24 * 60 * 60 * 1000

/** What a piece of evidence is still worth after some time. Half of it per half-life. */
export const decayed = (weight: number, ageMs: number, halfLifeDays: number): number => weight * Math.pow(0.5, Math.max(0, ageMs) / (halfLifeDays * DAY))

/**
 * How sure to be of a preference, from how much is behind it.
 *
 * Deliberately slow to reach certainty: two plays is a coincidence, twenty is a pattern. Something said outright
 * starts as near-certain, because it was a decision rather than a measurement.
 */
export const confidenceFrom = (evidence: number, source: Preference['source']): number => {
  if (source === 'explicit') return Math.min(1, 0.85 + evidence * 0.03)
  return Math.min(0.95, 1 - Math.exp(-evidence / 7))
}

/** Numbers are put in bands so "fast" and "slow" are things that can be liked. */
export const bandOf = (value: number, bands: number): string => `b${Math.min(bands - 1, Math.max(0, Math.floor(value * bands)))}`
export const TEMPO_BANDS = ['slow', 'walking', 'moderate', 'brisk', 'fast', 'very-fast'] as const
export const tempoBand = (bpm: number): string => {
  if (bpm < 70) return 'slow'
  if (bpm < 90) return 'walking'
  if (bpm < 110) return 'moderate'
  if (bpm < 130) return 'brisk'
  if (bpm < 160) return 'fast'
  return 'very-fast'
}
export const durationBand = (seconds: number): string => (seconds < 120 ? 'very-short' : seconds < 210 ? 'short' : seconds < 300 ? 'normal' : seconds < 420 ? 'long' : 'very-long')

/** Everything a track says about itself, as things that can be liked. */
export function aspectsOf(features: TrackFeatures): { dimension: TasteDimension; name: string }[] {
  const out: { dimension: TasteDimension; name: string }[] = [
    { dimension: 'artist', name: features.artistKey },
    { dimension: 'album', name: features.albumKey },
    { dimension: 'duration', name: durationBand(features.duration) }
  ]
  if (features.genre) out.push({ dimension: 'genre', name: features.genre })
  if (features.language) out.push({ dimension: 'language', name: features.language })
  if (features.era !== null) out.push({ dimension: 'era', name: String(features.era) })
  for (const theme of features.themes.slice(0, 6)) out.push({ dimension: 'theme', name: theme })
  const audio = features.audio
  if (audio) {
    out.push({ dimension: 'energy', name: bandOf(audio.energy, 5) })
    out.push({ dimension: 'brightness', name: bandOf(audio.brightness, 5) })
    out.push({ dimension: 'danceability', name: bandOf(audio.danceability, 5) })
    out.push({ dimension: 'vocalness', name: bandOf(audio.vocalness, 3) })
    if (audio.tempo !== null) out.push({ dimension: 'tempo', name: tempoBand(audio.tempo) })
  }
  return out
}

// ---------------------------------------------------------------- what somebody did

export interface MusicEvent {
  kind: MusicEventKind
  trackId: string
  at: number
  /** How far in it got, where that makes sense. */
  seconds?: number
  /** How long the track is, so a skip can be told from a finish. */
  duration?: number
  /** Who chose it: somebody, or Orbis. A refused suggestion means more than a refused own choice. */
  chosenBy?: 'person' | 'orbis'
  /** Which way of choosing produced it, so strategies can be judged by what happened. */
  strategy?: string
}

/** Which event a listen amounts to, from how much of it was heard. Never from how long ago it started. */
export function listenEvent(seconds: number, duration: number, stopped: 'ended' | 'skipped'): MusicEventKind {
  if (stopped === 'ended') return 'completed'
  if (seconds < EARLY_SKIP_SECONDS && (duration <= 0 || seconds < duration * 0.5)) return 'skipped-early'
  if (duration > 0 && seconds >= duration * 0.5) return 'played-half'
  if (seconds >= 30) return 'played-30s'
  if (seconds >= 10) return 'played-10s'
  return 'skipped-early'
}

/** What one event is worth, before any decay. */
export const weightOf = (event: MusicEvent): number => {
  const base = EVENT_WEIGHTS[event.kind] ?? 0
  // A suggestion somebody refused says more about the suggestion than a track they picked and dropped.
  if (event.chosenBy === 'orbis' && base < 0) return base * 1.3
  if (event.chosenBy === 'person' && base < 0) return base * 0.6
  return base
}

// ---------------------------------------------------------------- learning

/** Folds one piece of evidence into a preference. */
function fold(held: Preference, weight: number, at: number, halfLifeDays: number, source: Preference['source']): Preference {
  const kept = decayed(held.strength, at - held.updatedAt, halfLifeDays)
  const keptValue = held.strength > 0 ? held.value : 0
  const strength = kept + Math.abs(weight)
  // A running average over the evidence, so one strong event cannot flip a settled preference on its own.
  const value = strength === 0 ? 0 : (keptValue * kept + Math.sign(weight) * Math.abs(weight)) / strength
  const evidence = held.evidence + 1
  return {
    value: Math.max(-1, Math.min(1, value)),
    confidence: confidenceFrom(evidence, source === 'explicit' ? 'explicit' : held.source),
    strength,
    recency: 1,
    evidence,
    source: source === 'explicit' ? 'explicit' : held.source,
    updatedAt: at
  }
}

/** Learns from one event, in every layer, over every aspect of the track. */
export function learn(taste: UserTaste, event: MusicEvent, features: TrackFeatures, aspectWeights?: Partial<Record<TasteDimension, number>>): UserTaste {
  const weight = weightOf(event)
  if (weight === 0) return taste
  const aspects = aspectsOf(features)
  const next: UserTaste = {
    ...taste,
    longTerm: { ...taste.longTerm, by: { ...taste.longTerm.by } },
    recent: { ...taste.recent, by: { ...taste.recent.by } },
    session: { ...taste.session, by: { ...taste.session.by } },
    explicit: taste.explicit,
    counts: { ...taste.counts, events: taste.counts.events + 1 },
    updatedAt: event.at
  }
  for (const layer of ['longTerm', 'recent', 'session'] as const) {
    const target = next[layer]
    for (const aspect of aspects) {
      const scale = aspectWeights?.[aspect.dimension] ?? 1
      if (scale === 0) continue
      const map = { ...target.by[aspect.dimension] }
      map[aspect.name] = fold(map[aspect.name] ?? { ...NO_PREFERENCE }, weight * scale, event.at, target.halfLifeDays, 'behaviour')
      target.by[aspect.dimension] = map
    }
  }
  return next
}

/** Something said outright. Kept in its own layer, where nothing measured can argue with it. */
export function state(taste: UserTaste, dimension: TasteDimension, name: string, value: number, at: number): UserTaste {
  const map = { ...taste.explicit.by[dimension] }
  const held = map[name] ?? { ...NO_PREFERENCE }
  map[name] = {
    value: Math.max(-1, Math.min(1, value)),
    confidence: confidenceFrom(held.evidence + 1, 'explicit'),
    strength: Math.max(held.strength, Math.abs(value) * 5),
    recency: 1,
    evidence: held.evidence + 1,
    source: 'explicit',
    updatedAt: at
  }
  return { ...taste, explicit: { ...taste.explicit, by: { ...taste.explicit.by, [dimension]: map } }, updatedAt: at }
}

/** Forgets one thing entirely, in every layer. What somebody asks to be forgotten is forgotten. */
export function forget(taste: UserTaste, dimension: TasteDimension, name: string): UserTaste {
  const next = { ...taste }
  for (const layer of ['longTerm', 'recent', 'session', 'explicit'] as const) {
    const map = { ...next[layer].by[dimension] }
    delete map[name]
    next[layer] = { ...next[layer], by: { ...next[layer].by, [dimension]: map } }
  }
  return next
}

/** Empties the session layer. A new sitting is a new state of mind. */
export const newSession = (taste: UserTaste): UserTaste => ({
  ...taste,
  session: emptyLayer(HALF_LIFE_DAYS.session),
  counts: { ...taste.counts, sessions: taste.counts.sessions + 1 }
})

// ---------------------------------------------------------------- reading it back

export interface Opinion {
  value: number
  confidence: number
  /** Which layer decided it, for explaining. */
  from: 'explicit' | 'longTerm' | 'recent' | 'session' | 'none'
}

/**
 * What somebody thinks of one thing, taking the layers in the order they beat each other.
 *
 * Something said outright wins outright. Otherwise the layers are blended, with the session weighted most because it
 * is about now -- but only as far as its own confidence goes, so two plays into a sitting it barely counts.
 */
export function opinionOn(taste: UserTaste, dimension: TasteDimension, name: string, now: number): Opinion {
  const explicit = taste.explicit.by[dimension][name]
  if (explicit && explicit.evidence > 0) return { value: explicit.value, confidence: explicit.confidence, from: 'explicit' }

  const parts: { value: number; weight: number; from: Opinion['from'] }[] = []
  for (const [layer, pull] of [
    ['session', 1.3],
    ['recent', 1],
    ['longTerm', 0.8]
  ] as const) {
    const held = taste[layer].by[dimension][name]
    if (!held || held.evidence === 0) continue
    const fresh = decayed(1, now - held.updatedAt, taste[layer].halfLifeDays)
    parts.push({ value: held.value, weight: held.confidence * fresh * pull, from: layer })
  }
  if (parts.length === 0) return { value: 0, confidence: 0, from: 'none' }
  const weight = parts.reduce((sum, one) => sum + one.weight, 0)
  if (weight === 0) return { value: 0, confidence: 0, from: 'none' }
  const value = parts.reduce((sum, one) => sum + one.value * one.weight, 0) / weight
  const strongest = parts.reduce((best, one) => (one.weight > best.weight ? one : best), parts[0])
  return { value, confidence: Math.min(0.95, weight / 2.5), from: strongest.from }
}

export interface Affinity {
  /** -1..1: how much this person is likely to want this track. */
  score: number
  confidence: number
  /** The aspects that drove it, strongest first, for "why this". */
  because: { dimension: TasteDimension; name: string; value: number; confidence: number }[]
}

/**
 * How much somebody is likely to want a track, from everything known about them.
 *
 * Only aspects with some confidence count, and the answer carries how much of it rested on anything. A track whose
 * every aspect is new to Orbis comes back near zero with no confidence -- which is what makes the exploration logic
 * able to tell "probably not" apart from "no idea yet".
 */
export function affinity(taste: UserTaste, features: TrackFeatures, now: number): Affinity {
  const because: Affinity['because'] = []
  let total = 0
  let weight = 0
  for (const aspect of aspectsOf(features)) {
    const opinion = opinionOn(taste, aspect.dimension, aspect.name, now)
    if (opinion.confidence <= 0.02) continue
    // The artist and the genre say more about wanting a track than its length does.
    const pull = aspect.dimension === 'artist' ? 1.4 : aspect.dimension === 'genre' ? 1.2 : aspect.dimension === 'album' ? 1.1 : aspect.dimension === 'duration' ? 0.4 : 0.8
    total += opinion.value * opinion.confidence * pull
    weight += opinion.confidence * pull
    because.push({ dimension: aspect.dimension, name: aspect.name, value: opinion.value, confidence: opinion.confidence })
  }
  because.sort((a, b) => Math.abs(b.value * b.confidence) - Math.abs(a.value * a.confidence))
  if (weight === 0) return { score: 0, confidence: 0, because: [] }
  return { score: Math.max(-1, Math.min(1, total / weight)), confidence: Math.min(0.95, weight / 6), because: because.slice(0, 6) }
}

// ---------------------------------------------------------------- what a skip meant

export interface Attribution {
  dimension: TasteDimension
  name: string
  /** 0..1: how much this feature stands out as the likely reason. */
  blame: number
}

/**
 * What probably caused a skip.
 *
 * A skip says something was wrong, not that the song is bad. So the skipped track is compared with what has been
 * going well: an aspect that is unusual *for this person* carries the blame, and an aspect they demonstrably like
 * carries none. With nothing to compare against, nothing is blamed -- which is right, because one skip on a fresh
 * profile means nothing.
 *
 * This is what stops one skip of one song turning into "does not like this genre".
 */
export function attribute(taste: UserTaste, skipped: TrackFeatures, liked: readonly TrackFeatures[], now: number): Attribution[] {
  const aspects = aspectsOf(skipped)
  const out: Attribution[] = []
  for (const aspect of aspects) {
    const opinion = opinionOn(taste, aspect.dimension, aspect.name, now)
    // Something they are known to like is not the reason they skipped.
    if (opinion.value > 0.2 && opinion.confidence > 0.3) continue
    /*
     * How unusual this aspect is among what has been going well.
     *
     * With nothing going well to compare against, nothing is unusual and nothing is blamed. A fresh profile that
     * skips its first track has told Orbis almost nothing, and inventing a reason is how a recommender corners
     * itself in its first five minutes.
     */
    const shared = liked.filter((one) => aspectsOf(one).some((other) => other.dimension === aspect.dimension && other.name === aspect.name)).length
    const unusual = liked.length === 0 ? 0 : 1 - shared / liked.length
    // A known dislike is the first suspect; an unknown that is unlike everything else is the second.
    const blame = opinion.value < -0.1 ? Math.min(1, 0.6 + Math.abs(opinion.value) * 0.4) : unusual * (1 - opinion.confidence * 0.5)
    if (blame < 0.3) continue
    out.push({ dimension: aspect.dimension, name: aspect.name, blame })
  }
  return out.sort((a, b) => b.blame - a.blame).slice(0, 4)
}

/**
 * Learns from a skip by moving only what was probably to blame.
 *
 * The weight is shared out by blame, so an artist nobody has an opinion on takes the hit and a genre the person
 * plays all day does not. This is the difference between a system that narrows usefully and one that corners itself.
 */
export function learnFromSkip(taste: UserTaste, event: MusicEvent, features: TrackFeatures, liked: readonly TrackFeatures[]): UserTaste {
  const blame = attribute(taste, features, liked, event.at)
  if (blame.length === 0) {
    // Nothing stands out. The track itself is noted and nothing else is moved.
    return learn(taste, event, features, { artist: 0.2, genre: 0.1, album: 0.2, language: 0, era: 0, theme: 0.1, energy: 0.1, tempo: 0.1, brightness: 0.1, danceability: 0.1, vocalness: 0.1, duration: 0 })
  }
  const total = blame.reduce((sum, one) => sum + one.blame, 0)
  const weights: Partial<Record<TasteDimension, number>> = {}
  for (const dimension of ['artist', 'album', 'genre', 'language', 'era', 'theme', 'energy', 'tempo', 'brightness', 'danceability', 'vocalness', 'duration'] as const) weights[dimension] = 0
  for (const one of blame) weights[one.dimension] = (weights[one.dimension] ?? 0) + one.blame / total
  return learn(taste, event, features, weights)
}

// ---------------------------------------------------------------- the summary a person sees

export interface MusicDna {
  /** Named dimensions with a 0..100 reading and how sure it is. Only ones with evidence are included. */
  readings: { name: string; value: number; confidence: number; evidence: number }[]
  topArtists: { name: string; value: number; evidence: number }[]
  topGenres: { name: string; value: number; evidence: number }[]
  languages: { name: string; value: number; evidence: number }[]
  eras: { name: string; value: number; evidence: number }[]
  /** How much new music they have been taking. */
  discovery: number
  events: number
}

const topOf = (map: PreferenceMap, limit: number): { name: string; value: number; evidence: number }[] =>
  Object.entries(map)
    .filter(([, one]) => one.evidence >= 2 && one.value > 0.05)
    .sort((a, b) => b[1].value * b[1].confidence - a[1].value * a[1].confidence)
    .slice(0, limit)
    .map(([name, one]) => ({ name, value: Math.round(one.value * 100), evidence: one.evidence }))

/**
 * The "your music" summary, built only from what is actually known.
 *
 * A reading appears only when there is evidence for it. A profile with four plays shows almost nothing, which is the
 * truth -- a dial at 50 with nothing behind it is a decoration pretending to be an insight.
 */
export function musicDna(taste: UserTaste): MusicDna {
  const reading = (name: string, dimension: TasteDimension, bands: readonly string[]): { name: string; value: number; confidence: number; evidence: number } | null => {
    const map = { ...taste.longTerm.by[dimension] }
    for (const [key, one] of Object.entries(taste.recent.by[dimension])) {
      const held = map[key]
      map[key] = held ? { ...held, value: (held.value + one.value) / 2, evidence: held.evidence + one.evidence, confidence: Math.max(held.confidence, one.confidence) } : one
    }
    const entries = Object.entries(map).filter(([, one]) => one.evidence > 0)
    if (entries.length === 0) return null
    let total = 0
    let weight = 0
    let evidence = 0
    for (const [key, one] of entries) {
      const index = bands.indexOf(key)
      const position = index >= 0 ? index / Math.max(1, bands.length - 1) : Number(key.replace('b', '')) / 4
      if (!Number.isFinite(position)) continue
      const pull = Math.max(0, one.value) * one.confidence * one.evidence
      total += position * pull
      weight += pull
      evidence += one.evidence
    }
    if (weight === 0) return null
    return { name, value: Math.round((total / weight) * 100), confidence: Math.min(0.95, evidence / 40), evidence }
  }

  const readings = [
    reading('Energy', 'energy', ['b0', 'b1', 'b2', 'b3', 'b4']),
    reading('Danceability', 'danceability', ['b0', 'b1', 'b2', 'b3', 'b4']),
    reading('Brightness', 'brightness', ['b0', 'b1', 'b2', 'b3', 'b4']),
    reading('Tempo', 'tempo', TEMPO_BANDS),
    reading('Voices', 'vocalness', ['b0', 'b1', 'b2']),
    reading('Track length', 'duration', ['very-short', 'short', 'normal', 'long', 'very-long'])
  ].filter((one): one is NonNullable<typeof one> => one !== null)

  return {
    readings,
    topArtists: topOf({ ...taste.longTerm.by.artist, ...taste.recent.by.artist }, 8),
    topGenres: topOf({ ...taste.longTerm.by.genre, ...taste.recent.by.genre }, 6),
    languages: topOf({ ...taste.longTerm.by.language, ...taste.recent.by.language }, 5),
    eras: topOf({ ...taste.longTerm.by.era, ...taste.recent.by.era }, 5),
    discovery: Math.round(Math.max(0, taste.discoveryAppetite.value) * 100),
    events: taste.counts.events
  }
}

/** How much new music to offer, learned from what happened to the new music already offered. */
export function learnDiscoveryAppetite(taste: UserTaste, accepted: boolean, at: number): UserTaste {
  const held = taste.discoveryAppetite
  const kept = decayed(held.strength, at - held.updatedAt, HALF_LIFE_DAYS.recent)
  const strength = kept + 1
  const value = ((held.strength > 0 ? held.value : 0.3) * kept + (accepted ? 1 : 0)) / strength
  return {
    ...taste,
    discoveryAppetite: {
      value: Math.max(0, Math.min(1, value)),
      confidence: confidenceFrom(held.evidence + 1, 'behaviour'),
      strength,
      recency: 1,
      evidence: held.evidence + 1,
      source: 'behaviour',
      updatedAt: at
    }
  }
}

/** Which dimensions Orbis is least sure about, so it knows what is worth finding out. */
export function leastKnown(taste: UserTaste, now: number): { dimension: TasteDimension; name: string; confidence: number }[] {
  const out: { dimension: TasteDimension; name: string; confidence: number }[] = []
  for (const dimension of ['genre', 'artist', 'language', 'era'] as const) {
    for (const name of Object.keys(taste.longTerm.by[dimension])) {
      const opinion = opinionOn(taste, dimension, name, now)
      if (opinion.confidence < 0.4 && Math.abs(opinion.value) > 0.1) out.push({ dimension, name, confidence: opinion.confidence })
    }
  }
  return out.sort((a, b) => a.confidence - b.confidence).slice(0, 10)
}

/** Dimension names used by `FeatureName`, mapped to taste dimensions, so the two vocabularies meet once. */
export const DIMENSION_FOR_FEATURE: Partial<Record<FeatureName, TasteDimension>> = {
  energy: 'energy',
  tempo: 'tempo',
  brightness: 'brightness',
  danceability: 'danceability',
  vocalness: 'vocalness',
  genre: 'genre',
  artist: 'artist',
  album: 'album',
  era: 'era',
  language: 'language',
  themes: 'theme',
  duration: 'duration'
}
