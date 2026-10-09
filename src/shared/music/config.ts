/**
 * Every number the music intelligence uses, in one place.
 *
 * Scattered constants are how a recommendation system becomes impossible to reason about: a weight in one file and a
 * penalty in another, and nobody can say why the same song keeps coming back. Everything tunable lives here, with the
 * range it is allowed to move in, so a value that learns can never run away.
 *
 * Two rules:
 *
 * **Every adaptive value is bounded.** `clampTo` is applied on every update. A discovery setting that drifts to 1.0
 * and stays there is not personalisation, it is a broken loop.
 *
 * **Defaults are honest starting points, not claims.** They were chosen to behave sensibly with no history at all,
 * and they are meant to be moved by evidence.
 */

export interface Bounded {
  value: number
  min: number
  max: number
}

export const bounded = (value: number, min: number, max: number): Bounded => ({ value, min, max })

/** Keeps a learned value inside the range it is allowed to take. */
export const clampTo = (one: Bounded, next: number): Bounded => ({ ...one, value: Math.max(one.min, Math.min(one.max, next)) })

/** How much each thing somebody does counts as evidence. Positive is liking, negative is not. */
export const EVENT_WEIGHTS = Object.freeze({
  /** Started, and nothing more. Barely evidence at all: a track that starts has not been chosen to continue. */
  'play-started': 0.05,
  'played-10s': 0.15,
  'played-30s': 0.3,
  'played-half': 0.55,
  completed: 0.8,
  /** Going back to something is the strongest thing somebody does without pressing anything. */
  replayed: 1.3,
  favourited: 1.8,
  unfavourited: -1.2,
  'added-to-playlist': 1.6,
  'removed-from-playlist': -0.5,
  /** Choosing something by hand says more than anything Orbis chose for them. */
  'manually-selected': 1.0,
  queued: 0.5,
  dequeued: -0.4,
  searched: 0.25,
  /** Straight past it. One is noise; several of a kind is not. */
  'skipped-early': -0.7,
  'skipped-late': -0.2,
  'disliked': -2,
  'artist-opened': 0.35,
  'album-opened': 0.3,
  'recommendation-accepted': 0.6,
  'recommendation-refused': -0.5,
  recognised: 0.4,
  imported: 0.9
} as const)

export type MusicEventKind = keyof typeof EVENT_WEIGHTS

/** How quickly evidence stops mattering. Days until a piece of evidence is worth half what it was. */
export const HALF_LIFE_DAYS = Object.freeze({
  /** What somebody has always liked moves slowly, by design. */
  longTerm: 240,
  recent: 21,
  session: 0.25,
  /** Something they said outright barely decays at all: it is a decision, not a measurement. */
  explicit: 3650
})

/** How the final score is made up. These move with what is being asked for; see `weightsFor` in ranking.ts. */
export const BASE_WEIGHTS = Object.freeze({
  personal: 1,
  context: 0.5,
  intent: 0.9,
  completion: 0.7,
  replay: 0.4,
  favourite: 0.5,
  skip: -1.1,
  discovery: 0.35,
  novelty: 0.25,
  diversity: 0.3,
  transition: 0.45,
  sequence: 0.3,
  repetition: -0.8,
  overexposure: -0.5
})

export type WeightName = keyof typeof BASE_WEIGHTS

/** Everything that can be turned up or down, with the range it may move in. */
export interface MusicTuning {
  /** How much new music to offer, from none to mostly new. */
  discovery: Bounded
  /** How different from each other the next few tracks should be. */
  diversity: Bounded
  /** How many tracks before the same artist may come round again. */
  artistGap: Bounded
  /** How many tracks before the same song may come round again. */
  trackGap: Bounded
  /** How much the engine is willing to try something it is unsure about. */
  exploration: Bounded
  /** How smooth the joins between tracks should be. */
  transitionCare: Bounded
  /** How many tracks ahead a sequence is planned. */
  horizon: Bounded
}

export const DEFAULT_TUNING: MusicTuning = Object.freeze({
  discovery: bounded(0.3, 0, 0.85),
  diversity: bounded(0.5, 0.05, 1),
  artistGap: bounded(4, 0, 30),
  trackGap: bounded(40, 0, 500),
  exploration: bounded(0.15, 0.02, 0.5),
  transitionCare: bounded(0.5, 0, 1),
  horizon: bounded(5, 1, 12)
})

/** The named discovery settings a person can choose, as actual numbers rather than labels. */
export const DISCOVERY_LEVELS = Object.freeze({
  familiar: 0.05,
  balanced: 0.3,
  explore: 0.5,
  adventurous: 0.68,
  experimental: 0.85
})

export type DiscoveryLevel = keyof typeof DISCOVERY_LEVELS

/** How many candidates each stage may carry forward. Bigger is better recommendations and slower answers. */
export const STAGE_LIMITS = Object.freeze({
  perSource: 120,
  afterFilter: 400,
  afterPersonal: 160,
  afterContext: 90,
  afterPrediction: 50,
  final: 25
})

/** How long a worked-out answer may be reused before it is worked out again. */
export const CACHE_MS = Object.freeze({
  candidates: 30_000,
  features: 24 * 60 * 60 * 1000,
  similarity: 10 * 60 * 1000,
  taste: 60_000
})

/** The version of the stored shapes. A stored model from an older version is migrated, never silently believed. */
export const INTELLIGENCE_VERSION = 1

/** Nothing counts as a listen below this, so a track that was skipped through does not look played. */
export const MIN_LISTEN_SECONDS = 5

/** A skip inside this many seconds is "straight past it"; later is "listened to some of it". */
export const EARLY_SKIP_SECONDS = 20
