/**
 * Orbis Arena -> Football: the one shape every provider is turned into. Nothing outside the normalisers reads a
 * provider's own field names, and a value a provider did not supply is `null`, never 0.
 */

export type FbProvider = 'openligadb' | 'thesportsdb'

export type FbStatus =
  | 'scheduled'
  | 'first-half'
  | 'half-time'
  | 'second-half'
  | 'extra-time'
  | 'penalties'
  /** Under way, but the provider did not say which period. */
  | 'in-play'
  | 'finished'
  | 'postponed'
  | 'suspended'
  | 'abandoned'
  | 'cancelled'
  | 'unknown'

export const LIVE_STATUSES: readonly FbStatus[] = ['first-half', 'half-time', 'second-half', 'extra-time', 'penalties', 'in-play']
export const isLive = (s: FbStatus): boolean => LIVE_STATUSES.includes(s)

/**
 * How we know a match is live:
 *  - `reported`: the provider says so (a status and a minute);
 *  - `inferred`: the provider gives no live flag; Orbis saw "not finished and kicked off a short while ago".
 *    The screen says so, and shows no minute.
 */
export type FbLiveBasis = 'reported' | 'inferred' | null

export interface FbTeam {
  /** Namespaced: `openligadb:40`, `thesportsdb:133604`. Two providers' ids are never assumed to be one team. */
  id: string
  name: string
  short: string | null
  badge: string | null
}

export type FbEventKind = 'goal' | 'own-goal' | 'penalty-goal'

export interface FbEvent {
  id: string
  kind: FbEventKind
  /** Match minute as the provider recorded it; `null` when it did not. */
  minute: number | null
  side: 'home' | 'away' | null
  player: string | null
  /** The score right after this goal, when the provider says it. */
  scoreAfter: { home: number; away: number } | null
  overtime: boolean
  /** The provider has since withdrawn it (e.g. a disallowed goal). Kept, so the correction can be explained. */
  revoked: boolean
}

export interface FbCompetition {
  id: string
  name: string
  season: string | null
}

export interface FbMatch {
  /** Namespaced like a team id. */
  key: string
  provider: FbProvider
  competition: FbCompetition
  round: string | null
  /** UTC, ISO 8601, or null when the provider did not say. */
  kickoff: string | null
  home: FbTeam
  away: FbTeam
  status: FbStatus
  /** The provider's own word for it, kept for diagnosis. */
  statusRaw: string | null
  liveBasis: FbLiveBasis
  /** Reported minute only; never counted up locally. */
  minute: number | null
  score: { home: number | null; away: number | null }
  halfTime: { home: number; away: number } | null
  events: FbEvent[]
  /** True when the provider supplies no event list on this endpoint (so an empty list does not mean "no goals"). */
  eventsAvailable: boolean
  venue: string | null
  /** When the provider says the record last changed, or null when it does not say. */
  sourceUpdatedAt: string | null
}

export interface FbStandingRow {
  position: number | null
  team: FbTeam
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  /** Letters, newest last, only when the provider supplies them. */
  form: string | null
  note: string | null
}

export interface FbSource {
  provider: FbProvider
  url: string
  retrievedAt: string
}

export type FbFreshness = 'fresh' | 'cached' | 'stale'

export interface FbFailure {
  ok: false
  reason: 'offline' | 'rate-limited' | 'provider-error' | 'bad-response' | 'invalid-request' | 'unsupported'
  message: string
}

export type FbAnswer<T> = ({ ok: true; data: T; sources: FbSource[]; freshness: FbFreshness; notes: string[] }) | FbFailure

export interface FbLeague {
  /** `openligadb:bl1`, `thesportsdb:4328`. */
  id: string
  provider: FbProvider
  providerId: string
  name: string
  country: string | null
  kind: 'league' | 'cup'
  /** What this provider can actually supply for this competition (verified, not assumed). */
  capabilities: { fixtures: boolean; table: boolean; liveScore: boolean; goalEvents: boolean; seasonHistory: boolean }
  /** `year` (openligadb "2025", MLS) or `span` (thesportsdb "2025-2026"). */
  seasonFormat: 'year' | 'span'
  /** First season the provider has data for. */
  firstSeason: number
  caveat: string | null
}
