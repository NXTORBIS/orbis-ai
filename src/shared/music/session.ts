import { clampTo, DEFAULT_TUNING, type MusicTuning } from './config.ts'
import type { TrackFeatures } from './features.ts'
import type { SessionSignals } from './intent.ts'
import type { MusicEvent } from './taste.ts'
import type { Strategy } from './ranking.ts'

/**
 * What has happened this sitting, how well it is going, and which way of choosing to try next.
 *
 * ## Judging the sitting, not the song
 *
 * One skip means almost nothing. A run where four of six were finished, one was replayed and one was skipped went
 * well, and treating the skip as a failure would throw away the thing that was working. So the quality score is over
 * the sitting, and it is what decides whether to carry on as before or change approach.
 *
 * ## Choosing between ways of choosing
 *
 * There are several reasonable strategies -- stay safe, follow the sound, follow the mood, push discovery -- and
 * which one works depends on the person and the moment. Each is credited with what happened after it was used, in
 * the context it was used in, and the next pick leans towards whatever has been working *here*. Uncertainty is
 * respected: a strategy nobody has tried is tried occasionally rather than never.
 *
 * Nothing here is allowed to run away. Every learned number is bounded, and a strategy that has gone badly is
 * reduced rather than banned, because the thing that failed at midnight may be the right answer in the morning.
 */

export interface SessionTrack {
  trackId: string
  startedAt: number
  /** Seconds listened to. */
  listened: number
  /** How it ended, when it has. */
  outcome: 'playing' | 'completed' | 'skipped-early' | 'skipped-late' | 'replaced'
  chosenBy: 'person' | 'orbis'
  strategy?: Strategy
  energy: number | null
}

export interface MusicSession {
  id: string
  startedAt: number
  updatedAt: number
  /** Every track this sitting, in order. */
  tracks: SessionTrack[]
  skips: number
  completions: number
  replays: number
  favourites: number
  searches: number
  manualChoices: number
  queueEdits: number
  /** How many suggestions were taken, and how many refused: the discovery scoreboard. */
  discoveryOffered: number
  discoveryAccepted: number
  /** How this sitting is going, 0..1. Null until there is enough to say. */
  quality: number | null
}

export const newMusicSession = (id: string, at: number): MusicSession => ({
  id,
  startedAt: at,
  updatedAt: at,
  tracks: [],
  skips: 0,
  completions: 0,
  replays: 0,
  favourites: 0,
  searches: 0,
  manualChoices: 0,
  queueEdits: 0,
  discoveryOffered: 0,
  discoveryAccepted: 0,
  quality: null
})

/** How long a gap makes it a new sitting rather than the same one. */
export const SESSION_GAP_MS = 45 * 60 * 1000

/** Whether what is happening belongs to this sitting or starts another. */
export const isSameSession = (session: MusicSession, at: number): boolean => at - session.updatedAt < SESSION_GAP_MS

/**
 * How well a sitting is going.
 *
 * Finishing tracks and going back to them is what "going well" means; skipping is what it does not. Editing the queue
 * counts against it mildly -- somebody fixing the queue is somebody Orbis got wrong -- and choosing by hand does not,
 * because that is somebody enjoying their own library. Null until a few tracks have happened, because three tracks
 * is not a trend.
 */
export function quality(session: MusicSession): number | null {
  const finished = session.tracks.filter((one) => one.outcome !== 'playing')
  if (finished.length < 3) return null
  const completionRate = session.completions / finished.length
  const skipRate = session.skips / finished.length
  const replayBonus = Math.min(0.2, session.replays * 0.07)
  const favouriteBonus = Math.min(0.2, session.favourites * 0.1)
  const editPenalty = Math.min(0.2, session.queueEdits * 0.04)
  return Math.max(0, Math.min(1, 0.5 + (completionRate - skipRate) * 0.5 + replayBonus + favouriteBonus - editPenalty))
}

/** Records what happened to a track and keeps the running totals honest. */
export function record(session: MusicSession, event: MusicEvent, energy: number | null, strategy?: Strategy): MusicSession {
  const next: MusicSession = { ...session, tracks: [...session.tracks], updatedAt: event.at }
  const index = next.tracks.findIndex((one) => one.trackId === event.trackId && one.outcome === 'playing')

  switch (event.kind) {
    case 'play-started': {
      // A track playing again while already playing is a replay, which is the strongest ordinary signal there is.
      if (next.tracks.some((one) => one.trackId === event.trackId)) next.replays += 1
      next.tracks.push({
        trackId: event.trackId,
        startedAt: event.at,
        listened: 0,
        outcome: 'playing',
        chosenBy: event.chosenBy ?? 'orbis',
        strategy,
        energy
      })
      if ((event.chosenBy ?? 'orbis') === 'person') next.manualChoices += 1
      break
    }
    case 'completed':
      next.completions += 1
      if (index >= 0) next.tracks[index] = { ...next.tracks[index], outcome: 'completed', listened: event.seconds ?? next.tracks[index].listened }
      break
    case 'skipped-early':
    case 'skipped-late':
      next.skips += 1
      if (index >= 0) next.tracks[index] = { ...next.tracks[index], outcome: event.kind, listened: event.seconds ?? next.tracks[index].listened }
      break
    case 'replayed':
      next.replays += 1
      break
    case 'favourited':
      next.favourites += 1
      break
    case 'searched':
      next.searches += 1
      break
    case 'queued':
    case 'dequeued':
      next.queueEdits += 1
      break
    default:
      if (index >= 0 && event.seconds !== undefined) next.tracks[index] = { ...next.tracks[index], listened: event.seconds }
  }
  next.quality = quality(next)
  return next
}

/** Notes that a suggestion was offered, and whether it was taken. The discovery scoreboard. */
export function recordDiscovery(session: MusicSession, accepted: boolean): MusicSession {
  return { ...session, discoveryOffered: session.discoveryOffered + 1, discoveryAccepted: session.discoveryAccepted + (accepted ? 1 : 0) }
}

/** What the sitting looks like, for inferring intent. */
export function signalsFrom(session: MusicSession, now: number): SessionSignals {
  const energies = session.tracks.map((one) => one.energy).filter((one): one is number => one !== null)
  return {
    played: session.tracks.length,
    skips: session.skips,
    completions: session.completions,
    replays: session.replays,
    energy: energies.length ? energies.reduce((sum, one) => sum + one, 0) / energies.length : null,
    artists: 0,
    minutes: (now - session.startedAt) / 60000,
    hour: new Date(now).getHours(),
    manualChoices: session.manualChoices
  }
}

/** The energy of the sitting so far, weighted towards what just happened. */
export function sessionEnergy(session: MusicSession, features: ReadonlyMap<string, TrackFeatures>): number | null {
  const recent = session.tracks.slice(-6)
  let total = 0
  let weight = 0
  for (const [index, one] of recent.entries()) {
    const energy = one.energy ?? features.get(one.trackId)?.audio?.energy ?? null
    if (energy === null) continue
    const pull = index + 1
    total += energy * pull
    weight += pull
  }
  return weight === 0 ? null : total / weight
}

// ---------------------------------------------------------------- which way of choosing to use

export interface StrategyRecord {
  /** How often it was used in this sort of moment. */
  tried: number
  /** The average of what happened after, 0..1. */
  reward: number
  updatedAt: number
}

/** The context a strategy was judged in: strategies are credited per situation, not globally. */
export type StrategyContext = string

export interface StrategyMemory {
  by: Record<StrategyContext, Partial<Record<Strategy, StrategyRecord>>>
  version: number
}

export const emptyStrategyMemory = (): StrategyMemory => ({ by: {}, version: 1 })

/**
 * The situation a choice is being made in, coarsely.
 *
 * Coarse on purpose: a context so precise that it never repeats teaches nothing. What is kept is what plausibly
 * changes which strategy works -- what was asked for, roughly when, and whether this sitting is going well.
 */
export function contextKey(intent: string, hour: number, quality: number | null): StrategyContext {
  const partOfDay = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const going = quality === null ? 'unknown' : quality > 0.6 ? 'well' : quality < 0.4 ? 'badly' : 'middling'
  return `${intent}|${partOfDay}|${going}`
}

const STRATEGIES: Strategy[] = ['safe', 'similarity', 'context', 'discovery', 'artist', 'mood', 'session', 'experimental']

/**
 * Picks a way of choosing: mostly what has worked here, sometimes something untried.
 *
 * The untried are not picked at random. A strategy with no record is worth trying *because* it is unknown, and the
 * bonus for being unknown shrinks as it is tried -- so the engine finds out what works without spending the evening
 * experimenting on somebody. `exploration` bounds how often that happens, and it is itself bounded in `config.ts`.
 */
export function chooseStrategy(memory: StrategyMemory, context: StrategyContext, preferred: Strategy | undefined, exploration: number, random: () => number = Math.random): { strategy: Strategy; why: string } {
  const records = memory.by[context] ?? {}
  // Something stated points at a strategy; that is respected unless it has actually been going badly here.
  if (preferred) {
    const held = records[preferred]
    if (!held || held.tried < 3 || held.reward > 0.35) return { strategy: preferred, why: 'it suits what was asked for' }
  }
  const scored = STRATEGIES.map((strategy) => {
    const held = records[strategy]
    const tried = held?.tried ?? 0
    const reward = held?.reward ?? 0.5
    // Worth trying because it is unknown, decreasingly so as it becomes known.
    const curiosity = exploration * Math.sqrt(2 / (tried + 1))
    return { strategy, value: reward + curiosity, tried, reward }
  }).sort((a, b) => b.value - a.value)

  const best = scored[0]
  // A small genuine roll, so a strategy that is merely second best is not frozen out for ever.
  if (random() < exploration / 2) {
    const other = scored[1 + Math.floor(random() * Math.min(3, scored.length - 1))] ?? best
    return { strategy: other.strategy, why: 'trying something different to find out' }
  }
  return { strategy: best.strategy, why: best.tried === 0 ? 'nothing has been tried here yet' : `it has worked here before (${Math.round(best.reward * 100)}%)` }
}

/** Credits a strategy with what happened. Bounded, and slow enough that one bad run does not condemn it. */
export function creditStrategy(memory: StrategyMemory, context: StrategyContext, strategy: Strategy, reward: number, at: number): StrategyMemory {
  const records = { ...(memory.by[context] ?? {}) }
  const held = records[strategy] ?? { tried: 0, reward: 0.5, updatedAt: at }
  const tried = held.tried + 1
  // A running average with a floor on the step, so it keeps moving but never jumps.
  const rate = Math.max(0.1, 1 / tried)
  records[strategy] = { tried, reward: Math.max(0, Math.min(1, held.reward + (reward - held.reward) * rate)), updatedAt: at }
  return { ...memory, by: { ...memory.by, [context]: records } }
}

/** What a track's outcome is worth as a reward, 0..1. This is what the strategies are judged on. */
export function rewardOf(outcome: SessionTrack['outcome'], extras: { favourited?: boolean; replayed?: boolean; addedToPlaylist?: boolean }): number {
  let reward = outcome === 'completed' ? 0.75 : outcome === 'skipped-late' ? 0.4 : outcome === 'skipped-early' ? 0.05 : 0.5
  if (extras.replayed) reward = Math.max(reward, 0.9)
  if (extras.favourited) reward = 1
  if (extras.addedToPlaylist) reward = Math.max(reward, 0.95)
  return reward
}

// ---------------------------------------------------------------- the knobs, moved by what happens

/**
 * Moves the tunable numbers towards what has been working.
 *
 * Everything is clamped and every step is small. The rule being enforced is that personalisation must converge on
 * somebody rather than oscillate around them: a run of skipped suggestions pulls discovery down a little, a run of
 * accepted ones pushes it up a little, and neither can reach an extreme.
 */
export function adapt(tuning: MusicTuning, session: MusicSession): MusicTuning {
  const next = { ...tuning }
  const offered = session.discoveryOffered
  if (offered >= 4) {
    const acceptance = session.discoveryAccepted / offered
    const towards = acceptance > 0.6 ? 0.06 : acceptance < 0.25 ? -0.08 : 0
    if (towards !== 0) next.discovery = clampTo(next.discovery, next.discovery.value + towards)
  }
  const finished = session.tracks.filter((one) => one.outcome !== 'playing').length
  if (finished >= 5) {
    const skipRate = session.skips / finished
    // Lots of skipping means the joins or the sameness are wrong; both are worth caring about more.
    if (skipRate > 0.5) {
      next.transitionCare = clampTo(next.transitionCare, next.transitionCare.value + 0.05)
      next.artistGap = clampTo(next.artistGap, next.artistGap.value + 1)
      next.exploration = clampTo(next.exploration, next.exploration.value - 0.02)
    } else if (skipRate < 0.15) {
      next.exploration = clampTo(next.exploration, next.exploration.value + 0.01)
    }
  }
  if (session.queueEdits >= 3) next.diversity = clampTo(next.diversity, next.diversity.value + 0.05)
  return next
}

export const startingTuning = (): MusicTuning => ({ ...DEFAULT_TUNING })
