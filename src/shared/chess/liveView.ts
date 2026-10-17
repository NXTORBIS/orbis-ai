import {
  currentFen,
  describeFreshness,
  freshness,
  type ClockDisplay,
  type ClockOrigin,
  type ClockReading,
  type DiagnosticKind,
  type Freshness,
  type LiveDiagnostic,
  type LiveGameRecord,
  type LiveStatus
} from './live.ts'
import type { GameMove, GameResult, PlayerInfo } from './model.ts'

/**
 * What the window needs to know to show live chess, with no window in it.
 *
 * `live.ts` is the authority on what a broadcast game *is*; this file is the authority on what the screen may
 * *say* about one. The split exists because the two have different failure modes. Ingestion fails by believing a
 * provider; a screen fails by believing itself -- by showing a worked-out clock as a reading, a position that
 * stopped arriving as the current one, or a round whose games it never asked for as "no games".
 *
 * Four rules run through everything below, and every function here is one of them made specific.
 *
 *   - **The wire is untrusted.** Everything the window gets from `chess:live-*` arrives as `unknown`. The readers
 *     here turn it into types or refuse it, and a refusal says which part could not be read. Nothing is defaulted
 *     into existence: a game whose moves cannot be read is counted as unreadable, not shown as a game with no
 *     moves. Unreadable is not missing.
 *   - **Missing stays missing.** No "?" for a rating nobody sent, no 0 for a clock nobody sent, no date for a
 *     tournament whose dates were not given, no game count for a round the provider never counted. A label here
 *     returns null and the screen says nothing, rather than saying something untrue.
 *   - **A shown value says where it came from.** A received clock and a counted-down one are different claims, and
 *     `clockFace` carries the difference so the screen cannot lose it.
 *   - **Behind is not current.** A board walked back through the moves, and a board whose feed went quiet, are
 *     both "not the position on the board over there", and both have to be sayable.
 *
 * No React, no Electron, no network, no timers: `now` is a parameter everywhere, so every rule above is testable
 * with no tournament being on.
 */

// ---- reading what comes over the wire ---------------------------------------------------------------------------

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown, max = 400): string | undefined => {
  if (typeof v !== 'string') return undefined
  const text = v.trim()
  return text ? text.slice(0, max) : undefined
}
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const positive = (v: unknown): number | undefined => {
  const n = num(v)
  return n !== undefined && n > 0 ? n : undefined
}

/** `{ key: value }` when there is a value, and nothing at all when there is not. "Missing stays missing", in code. */
const put = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>

const STATUSES: readonly LiveStatus[] = ['scheduled', 'live', 'finished', 'unknown']
const asStatus = (v: unknown): LiveStatus => (STATUSES.includes(v as LiveStatus) ? (v as LiveStatus) : 'unknown')

const RESULTS: readonly GameResult[] = ['1-0', '0-1', '1/2-1/2', '*']
const asResult = (v: unknown): GameResult => (RESULTS.includes(v as GameResult) ? (v as GameResult) : '*')

const KINDS: readonly DiagnosticKind[] = ['http', 'rate-limit', 'schema', 'network', 'timeout', 'cancelled', 'circuit-open', 'pgn', 'refused']
const asKind = (v: unknown): DiagnosticKind | undefined => (KINDS.includes(v as DiagnosticKind) ? (v as DiagnosticKind) : undefined)

/**
 * The answer to one question put to the main process.
 *
 * It has to carry three different shapes of "no", because three different things can say no and they mean
 * different things to a person: the build has no broadcast provider at all (`{ ok: false, reason }` from the
 * channel), the provider refused or could not be reached (`{ ok: false, diagnostic }` from the manager), or what
 * came back was not the shape this code was written against. The last one is the one worth separating: it means
 * Orbis is wrong, not that the tournament is off.
 */
export type LiveAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; kind?: DiagnosticKind; provider?: string; operation?: string; status?: number }

/** A fault said in the shape the screen shows. Never invents a reason: with nothing to go on it says exactly that. */
const refusal = (raw: unknown, fallback: string): LiveAnswer<never> => {
  const d = obj(obj(raw)?.diagnostic)
  if (d) {
    const message = str(d.message, 600)
    return {
      ok: false,
      reason: message ?? fallback,
      ...put('kind', asKind(d.kind)),
      ...put('provider', str(d.provider, 60)),
      ...put('operation', str(d.operation, 200)),
      ...put('status', num(d.status))
    }
  }
  const reason = str(obj(raw)?.reason, 600)
  return { ok: false, reason: reason ?? fallback }
}

/** One tournament round a provider is carrying, as the window reads it off the wire. */
export interface LiveEventView {
  provider: string
  /** The provider's id for it. This is what following and listing take. */
  eventId: string
  name: string
  status: LiveStatus
  /** The provider's own page, for attribution. */
  url?: string
  startsAt?: number
  finishedAt?: number
  /** Seconds the provider says it deliberately holds this broadcast back. */
  delaySeconds?: number
  tournamentName?: string
  /** The provider's own featuring rank. Lower is more prominent. */
  tier?: number
}

function readEvent(raw: unknown): LiveEventView | null {
  const e = obj(raw)
  const provider = str(e?.provider, 60)
  const eventId = str(e?.eventId, 120)
  const name = str(e?.name, 300)
  // Without all three there is nothing to show and nothing to follow, so this is not an event.
  if (!provider || !eventId || !name) return null
  return {
    provider,
    eventId,
    name,
    status: asStatus(e?.status),
    ...put('url', str(e?.url, 500)),
    ...put('startsAt', positive(e?.startsAt)),
    ...put('finishedAt', positive(e?.finishedAt)),
    ...put('delaySeconds', positive(e?.delaySeconds)),
    ...put('tournamentName', str(e?.tournamentName, 300)),
    ...put('tier', num(e?.tier))
  }
}

/**
 * The answer to "what is on".
 *
 * An empty list is a real answer and comes back as `ok` with nothing in it: nothing being broadcast and the
 * provider being unreachable are different states and the screen says different things about them.
 */
export function readEvents(raw: unknown): LiveAnswer<LiveEventView[]> {
  const top = obj(raw)
  if (!top) return { ok: false, reason: 'Orbis asked what is being broadcast and did not get an answer it could read.' }
  if (top.ok !== true) return refusal(raw, 'The list of broadcasts could not be fetched, and nothing said why.')
  const list = Array.isArray(top.value) ? top.value : null
  if (!list) {
    return { ok: false, reason: 'The list of broadcasts did not arrive as a list, so nothing was read from it.', kind: 'schema' }
  }
  const events: LiveEventView[] = []
  for (const item of list) {
    const event = readEvent(item)
    if (event) events.push(event)
  }
  // Entries that arrived and could not be read are worth saying out loud rather than quietly shortening the list.
  return { ok: true, value: events }
}

/** How many entries in a list of events could not be read. Shown so a shortened list is never silent. */
export function unreadableEvents(raw: unknown): number {
  const top = obj(raw)
  const list = top && top.ok === true && Array.isArray(top.value) ? top.value : []
  return list.filter((one) => readEvent(one) === null).length
}

/** One game in a round, as a list shows it before anybody is following anything. */
export interface LiveGameListing {
  provider: string
  providerGameId: string
  eventId: string
  /** Orbis's own name for the game: `provider:providerGameId`. Matches a record's `id`. */
  id: string
  /** The provider's label for the pairing. Shown as given, never split into players. */
  name: string
  white: PlayerInfo
  black: PlayerInfo
  status: LiveStatus
  result: GameResult
}

/**
 * A player, with only what was actually supplied.
 *
 * "?" is how PGN says it does not know and several feeds pass it straight through; "-" is how it says a player has
 * no title. Neither is a value, and a rating of 0 is not a rating.
 */
export function readPlayer(raw: unknown): PlayerInfo {
  const p = obj(raw)
  const name = str(p?.name, 120)
  const title = str(p?.title, 12)
  const rating = positive(p?.rating)
  return {
    ...(name && name !== '?' ? { name } : {}),
    ...(rating !== undefined ? { rating: Math.round(rating) } : {}),
    ...(title && title !== '-' && title !== '?' ? { title } : {})
  }
}

function readListing(raw: unknown): LiveGameListing | null {
  const g = obj(raw)
  const provider = str(g?.provider, 60)
  const providerGameId = str(g?.providerGameId, 120)
  const eventId = str(g?.eventId, 120)
  if (!provider || !providerGameId) return null
  return {
    provider,
    providerGameId,
    eventId: eventId ?? '',
    id: `${provider}:${providerGameId}`,
    // A provider that sent no label leaves the pairing to be written from the players, which the screen does.
    name: str(g?.name, 300) ?? '',
    white: readPlayer(g?.white),
    black: readPlayer(g?.black),
    status: asStatus(g?.status),
    result: asResult(g?.result)
  }
}

/** The answer to "what is in this round": the round itself, and the games the provider lists in it. */
export function readEventGames(raw: unknown): LiveAnswer<{ event: LiveEventView; games: LiveGameListing[]; unreadable: number }> {
  const top = obj(raw)
  if (!top) return { ok: false, reason: 'Orbis asked for this round and did not get an answer it could read.' }
  if (top.ok !== true) return refusal(raw, 'This round could not be fetched, and nothing said why.')
  const value = obj(top.value)
  const event = readEvent(value?.event)
  if (!event) {
    return { ok: false, reason: 'This round arrived without the details Orbis needs to show it, so nothing was read from it.', kind: 'schema' }
  }
  const list = Array.isArray(value?.games) ? value.games : []
  const games: LiveGameListing[] = []
  let unreadable = 0
  for (const item of list) {
    const game = readListing(item)
    if (game) games.push(game)
    else unreadable += 1
  }
  return { ok: true, value: { event, games, unreadable } }
}

/** The answer to "start following this round". */
export function readFollow(raw: unknown): LiveAnswer<{ generation: number }> {
  const top = obj(raw)
  if (!top) return { ok: false, reason: 'Orbis asked to follow this round and did not get an answer it could read.' }
  if (top.ok !== true) return refusal(raw, 'This round could not be followed, and nothing said why.')
  const generation = num(obj(top.value)?.generation)
  return { ok: true, value: { generation: generation ?? 0 } }
}

function readMoves(raw: unknown): GameMove[] | null {
  if (!Array.isArray(raw)) return null
  const moves: GameMove[] = []
  for (const item of raw) {
    const m = obj(item)
    const san = str(m?.san, 12)
    const uci = str(m?.uci, 6)
    const fen = str(m?.fen, 120)
    // A move with no notation, no coordinates or no position is not a move, and a game holding one cannot be
    // shown honestly -- the move list and the board would disagree. The whole game is refused instead.
    if (!san || !uci || !fen) return null
    moves.push({
      san,
      uci,
      fen,
      ...put('comment', str(m?.comment, 20_000)),
      ...put('clock', num(m?.clock)),
      ...(Array.isArray(m?.nag) ? { nag: (m.nag as unknown[]).flatMap((n) => (str(n, 8) ? [str(n, 8) as string] : [])) } : {})
    })
  }
  return moves
}

/** A broadcast game as the window holds it. The same shape `live.ts` normalised, read back off the wire. */
export function readRecord(raw: unknown): LiveGameRecord | null {
  const r = obj(raw)
  const id = str(r?.id, 160)
  const provider = str(r?.provider, 60)
  const providerGameId = str(r?.providerGameId, 120)
  const startFen = str(r?.startFen, 120)
  const receivedAt = positive(r?.receivedAt)
  if (!id || !provider || !providerGameId || !startFen || receivedAt === undefined) return null
  const moves = readMoves(r?.moves)
  if (moves === null) return null
  const clocks = obj(r?.clocks)
  const clockAt = clocks ? positive(clocks.at) : undefined
  const white = num(clocks?.white)
  const black = num(clocks?.black)
  return {
    id,
    provider,
    providerGameId,
    eventId: str(r?.eventId, 120) ?? '',
    ...put('eventName', str(r?.eventName, 300)),
    ...put('round', str(r?.round, 120)),
    white: readPlayer(r?.white),
    black: readPlayer(r?.black),
    startFen,
    moves,
    status: asStatus(r?.status),
    result: asResult(r?.result),
    // A clock reading with no moment attached cannot be shown honestly a minute later, so it is left out
    // altogether rather than pinned to now.
    ...(clockAt !== undefined && (white !== undefined || black !== undefined)
      ? { clocks: { ...put('white', white !== undefined && white >= 0 ? white : undefined), ...put('black', black !== undefined && black >= 0 ? black : undefined), at: clockAt } }
      : {}),
    ...put('sourceTimestamp', positive(r?.sourceTimestamp)),
    receivedAt,
    ...put('lastEventId', str(r?.lastEventId, 160))
  }
}

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'stopped' | 'failed'

const CONNECTIONS: readonly ConnectionState[] = ['connecting', 'open', 'reconnecting', 'stopped', 'failed']

export interface FollowingView {
  provider: string
  eventId: string
  generation: number
  state: ConnectionState
}

/** Counters worth having when somebody reports that the board froze. Every one of them is really counted. */
export interface LiveHealthView {
  games: number
  generation: number
  lateDropped: number
  batches: number
  payloads: number
  pending: number
}

export interface LiveStateView {
  following: FollowingView | null
  games: LiveGameRecord[]
  /**
   * The freshness the main process worked out, by game id, where it sent one.
   *
   * Kept apart from the records on purpose. It is a judgement about a moment that has already passed by the time
   * the window draws, so the screen recomputes it against now -- with the same `freshness` function from
   * `live.ts`, and with the embargo the provider declared, which the main process does not have to hand.
   */
  reported: Record<string, Freshness>
  health: LiveHealthView | null
  /** Games that arrived and could not be read. Counted, never quietly dropped. */
  unreadable: number
}

const FRESHNESSES: readonly Freshness[] = ['live', 'delayed', 'stale', 'unknown']

/**
 * Everything currently held, read back off the wire.
 *
 * Deliberately tolerant and deliberately not an `LiveAnswer`: this is polled, and one unreadable answer in the
 * middle of a round must not blank the screen. It returns what it could read and counts what it could not.
 */
export function readLiveState(raw: unknown): LiveStateView {
  const top = obj(raw)
  const followRaw = obj(top?.following)
  const provider = str(followRaw?.provider, 60)
  const eventId = str(followRaw?.eventId, 120)
  const following: FollowingView | null =
    followRaw && provider && eventId
      ? {
          provider,
          eventId,
          generation: num(followRaw.generation) ?? 0,
          state: CONNECTIONS.includes(followRaw.state as ConnectionState) ? (followRaw.state as ConnectionState) : 'connecting'
        }
      : null
  const games: LiveGameRecord[] = []
  const reported: Record<string, Freshness> = {}
  let unreadable = 0
  for (const item of Array.isArray(top?.games) ? top.games : []) {
    /*
     * Each entry is either a game as the manager views it -- `{ record, freshness, clocks }` -- or a bare record,
     * because the channel falls back to the record when the manager has no view for it. Both are accepted; a
     * reader that only understood one of them would show an empty round whenever the other arrived.
     */
    const wrapper = obj(item)
    const record = readRecord(wrapper?.record ?? item)
    if (!record) {
      unreadable += 1
      continue
    }
    games.push(record)
    const said = wrapper?.freshness
    if (FRESHNESSES.includes(said as Freshness)) reported[record.id] = said as Freshness
  }
  const healthRaw = obj(top?.health)
  const health: LiveHealthView | null = healthRaw
    ? {
        games: num(healthRaw.games) ?? 0,
        generation: num(healthRaw.generation) ?? 0,
        lateDropped: num(healthRaw.lateDropped) ?? 0,
        batches: num(healthRaw.batches) ?? 0,
        payloads: num(healthRaw.payloads) ?? 0,
        pending: num(healthRaw.pending) ?? 0
      }
    : null
  return { following, games, reported, health, unreadable }
}

/** A fault pushed from the main process, read off the wire. */
export function readDiagnostic(raw: unknown): LiveDiagnostic | null {
  const d = obj(raw)
  const message = str(d?.message, 600)
  const provider = str(d?.provider, 60)
  const operation = str(d?.operation, 200)
  const kind = asKind(d?.kind)
  if (!message || !provider || !operation || !kind) return null
  return {
    provider,
    operation,
    kind,
    message,
    ...put('field', str(d?.field, 120)),
    ...put('status', num(d?.status)),
    at: positive(d?.at) ?? 0
  }
}

// ---- the dashboard ---------------------------------------------------------------------------------------------

/**
 * How interesting a status is, for ordering a list of tournaments.
 *
 * On now, then about to start, then nobody said, then over. This is the order somebody opening the page is looking
 * for things in, and it is not the alphabet.
 */
const STATUS_RANK: Record<LiveStatus, number> = { live: 0, scheduled: 1, unknown: 2, finished: 3 }

/** One tournament, with the rounds of it a provider actually listed. */
export interface TournamentGroup {
  /** Stable across refreshes: the provider and the tournament's name. */
  key: string
  provider: string
  name: string
  /** The rounds of this tournament the provider listed, liveliest first. */
  rounds: LiveEventView[]
  /** The liveliest status among the rounds, which is what the tournament as a whole is doing. */
  status: LiveStatus
  /** The earliest start and the latest end known across the rounds. Absent when the provider gave neither. */
  from?: number
  to?: number
  /** The provider's page, from the first round that has one. */
  url?: string
}

/*
 * There is deliberately no embargo on a tournament.
 *
 * A declared delay belongs to a *round* -- the provider sets it per round, and in a tournament where one round is
 * held back and another is not, a tournament-level figure would claim the embargo for rounds that never declared
 * one. So the screen says it on the round, where it is true.
 */

const liveliest = (rounds: readonly LiveEventView[]): LiveStatus =>
  rounds.reduce<LiveStatus>((best, one) => (STATUS_RANK[one.status] < STATUS_RANK[best] ? one.status : best), 'finished')

const least = (values: readonly (number | undefined)[]): number | undefined => {
  const known = values.filter((v): v is number => v !== undefined)
  return known.length ? Math.min(...known) : undefined
}
const most = (values: readonly (number | undefined)[]): number | undefined => {
  const known = values.filter((v): v is number => v !== undefined)
  return known.length ? Math.max(...known) : undefined
}

/**
 * A round's place in the running order, for sorting rounds within one tournament.
 *
 * The round on now first, then the next to start, then the ones with no time, then the finished ones latest-first.
 */
function roundOrder(a: LiveEventView, b: LiveEventView): number {
  const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
  if (rank !== 0) return rank
  if (a.status === 'finished') return (b.finishedAt ?? 0) - (a.finishedAt ?? 0)
  const starts = (a.startsAt ?? Number.POSITIVE_INFINITY) - (b.startsAt ?? Number.POSITIVE_INFINITY)
  if (starts !== 0 && Number.isFinite(starts)) return starts
  return a.name.localeCompare(b.name, undefined, { numeric: true })
}

/**
 * The rounds a provider listed, gathered into the tournaments they belong to.
 *
 * Gathered rather than invented: a tournament appears here only because at least one of its rounds was listed, and
 * it holds exactly the rounds that were. A provider that lists one round per tournament -- which is what the one
 * Orbis has does -- therefore produces one round per tournament here, and the screen says so rather than implying
 * the rest of the schedule is somewhere just out of sight.
 */
export function groupByTournament(events: readonly LiveEventView[]): TournamentGroup[] {
  const groups = new Map<string, TournamentGroup>()
  for (const event of events) {
    // With no series or tournament name the round's own name is the heading, which keeps a round that belongs to
    // nothing visible rather than filing it under a blank.
    const name = event.tournamentName ?? event.name
    const key = `${event.provider}|${name}`
    const held = groups.get(key)
    if (held) {
      held.rounds.push(event)
      continue
    }
    groups.set(key, { key, provider: event.provider, name, rounds: [event], status: event.status })
  }
  const out = [...groups.values()].map((group) => {
    const rounds = [...group.rounds].sort(roundOrder)
    const from = least(rounds.map((r) => r.startsAt))
    const to = most(rounds.map((r) => r.finishedAt))
    const url = rounds.find((r) => r.url !== undefined)?.url
    return {
      ...group,
      rounds,
      status: liveliest(rounds),
      ...put('from', from),
      ...put('to', to),
      ...put('url', url)
    }
  })
  return out.sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (rank !== 0) return rank
    /*
     * The provider's own featuring rank, where it gave one, before the alphabet. Lower is more prominent.
     *
     * A tournament the provider did not rank sorts after the ones it did. That is the provider's own ordering
     * being used as the provider means it, not a judgement of our own: it ranks what it is featuring, and most
     * tournaments carry no rank at all. Leading the page with the unranked ones would bury what is on.
     */
    const tierA = least(a.rounds.map((r) => r.tier)) ?? Number.POSITIVE_INFINITY
    const tierB = least(b.rounds.map((r) => r.tier)) ?? Number.POSITIVE_INFINITY
    if (tierA !== tierB) return tierA - tierB
    if (a.status === 'finished') return (b.to ?? 0) - (a.to ?? 0)
    const starts = (a.from ?? Number.POSITIVE_INFINITY) - (b.from ?? Number.POSITIVE_INFINITY)
    if (starts !== 0 && Number.isFinite(starts)) return starts
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
}

/**
 * A round's name with its tournament's name taken off the front.
 *
 * A provider's flat list of what is on can only carry one name per entry, so it carries "Tournament — Round 3".
 * Inside a tournament the first half is already on screen above, and a strip of five buttons each repeating it is
 * unreadable. Only an exact prefix is taken off, with the separator the provider actually used, so a round
 * genuinely called something else keeps the whole of its name.
 */
export function roundShortName(event: Pick<LiveEventView, 'name' | 'tournamentName'>): string {
  const whole = event.name.trim()
  const tour = event.tournamentName?.trim()
  if (!tour || whole === tour) return whole
  for (const separator of [' — ', ' – ', ' - ', ': ', ' | ']) {
    const prefix = tour + separator
    if (!whole.startsWith(prefix)) continue
    const rest = whole.slice(prefix.length).trim()
    // Never return nothing: a round whose name is only its tournament's name keeps that name.
    if (rest) return rest
  }
  return whole
}

/** The tournament a round belongs to, among the rounds a provider listed. Null when that round is not listed. */
export function tournamentOf(events: readonly LiveEventView[], eventId: string): TournamentGroup | null {
  return groupByTournament(events).find((group) => group.rounds.some((one) => one.eventId === eventId)) ?? null
}

// ---- saying things in words ------------------------------------------------------------------------------------

/** Where a round is, in words. `unknown` is a real answer and says so. */
export function statusWords(status: LiveStatus): string {
  switch (status) {
    case 'live':
      return 'Being played now'
    case 'scheduled':
      return 'Still to start'
    case 'finished':
      return 'Finished'
    default:
      return 'Not known'
  }
}

/** A result in words. `*` is "no result yet", which is what it means, and never a dash that looks like a draw. */
export function resultWords(result: GameResult): string {
  switch (result) {
    case '1-0':
      return 'White won'
    case '0-1':
      return 'Black won'
    case '1/2-1/2':
      return 'Drawn'
    default:
      return 'No result yet'
  }
}

/**
 * A provider's id said as a name.
 *
 * Capitalised rather than looked up in a table of one. A table would mean the day a second provider is registered,
 * the screen quietly shows "the provider" for it -- and whose data is on screen is not a detail to get vague about.
 */
export const providerWords = (provider: string): string =>
  provider.trim() ? provider.trim().slice(0, 1).toUpperCase() + provider.trim().slice(1) : 'the provider'

/** The connection, in words a person can act on. */
export function connectionWords(state: ConnectionState | null): string {
  switch (state) {
    case 'open':
      return 'Connected'
    case 'connecting':
      return 'Connecting'
    case 'reconnecting':
      return 'Reconnecting'
    case 'failed':
      return 'Not connected'
    case 'stopped':
      return 'Stopped'
    default:
      return 'Not following anything'
  }
}

/** The one word that goes on the freshness badge. */
export function freshnessWord(state: Freshness): string {
  switch (state) {
    case 'live':
      return 'Live'
    case 'delayed':
      return 'Behind'
    case 'stale':
      return 'Out of date'
    default:
      return 'Age not known'
  }
}

export interface FreshnessBadge {
  state: Freshness
  word: string
  /** The sentence that explains the word, from `live.ts` so there is one wording of it in the application. */
  note: string
  /** True when what is on screen must not be read as the position on the board over there. */
  behind: boolean
}

/**
 * How current what is being shown is.
 *
 * The judgement is `freshness` from `live.ts` -- the ingestion layer's own, not a second opinion -- asked against
 * now and against the embargo the provider declared on its own broadcast. The embargo matters: a feed published
 * ten minutes behind the board can never honestly be called live however promptly the delayed data arrives, and
 * the declared delay is carried on the round, which is why this is worked out where the round is known.
 */
export function freshnessBadge(o: {
  record: Pick<LiveGameRecord, 'provider' | 'receivedAt' | 'sourceTimestamp'>
  now: number
  delaySeconds?: number
}): FreshnessBadge {
  const state = freshness({
    ...put('sourceTimestamp', o.record.sourceTimestamp),
    receivedAt: o.record.receivedAt,
    now: o.now,
    provider: o.record.provider,
    ...put('delaySeconds', o.delaySeconds)
  })
  return {
    state,
    word: freshnessWord(state),
    note: describeFreshness(state, { ...put('delaySeconds', o.delaySeconds) }),
    behind: state !== 'live'
  }
}

/**
 * How long ago something happened, in words.
 *
 * Deliberately coarse above a minute: a feed that last spoke four and a half minutes ago is "4 minutes ago", and
 * pretending to the second would suggest a precision the arrival of a chunk over the internet does not have.
 * Below ten seconds it says "just now", because that is what it is.
 */
export function agoWords(at: number | undefined, now: number): string {
  if (at === undefined || !Number.isFinite(at) || at <= 0) return 'never'
  // A stamp in the future is two clocks disagreeing, not data from the future.
  const seconds = Math.floor(Math.max(0, now - at) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * A tournament's dates, where they are known.
 *
 * Returns null when the provider gave neither a start nor an end, so the screen can say the dates were not given
 * rather than printing an epoch or today's date. `format` is injected because a date belongs in the person's own
 * locale and time zone, and this file is not the place that knows either.
 */
export function dateRangeWords(
  o: { from?: number; to?: number },
  format: (at: number) => string
): string | null {
  const from = o.from !== undefined && o.from > 0 ? o.from : undefined
  const to = o.to !== undefined && o.to > 0 ? o.to : undefined
  if (from === undefined && to === undefined) return null
  if (from !== undefined && to === undefined) return format(from)
  if (from === undefined && to !== undefined) return `until ${format(to)}`
  const start = format(from as number)
  const end = format(to as number)
  return start === end ? start : `${start} – ${end}`
}

/**
 * A declared embargo, in words.
 *
 * Only ever said when the provider declared one. A broadcast with no declared delay is not "0 minutes behind"; it
 * is a broadcast nobody said anything about the timing of.
 */
export function delayWords(delaySeconds: number | undefined): string | null {
  if (delaySeconds === undefined || !Number.isFinite(delaySeconds) || delaySeconds <= 0) return null
  if (delaySeconds < 60) return `Published about ${Math.round(delaySeconds)} seconds behind the board, on purpose.`
  const minutes = Math.round(delaySeconds / 60)
  return `Published about ${minutes} minute${minutes === 1 ? '' : 's'} behind the board, on purpose.`
}

// ---- players ---------------------------------------------------------------------------------------------------

export interface PlayerLabel {
  /** The player's name, or null when the source did not give one. Never "?" and never "Unknown". */
  name: string | null
  rating: number | null
  title: string | null
  /** The word to show in place of a name, when there is none. A role, and marked as one on screen. */
  role: string
  /** True when anything about this player is missing, so the screen can say which part. */
  partial: boolean
}

/** A player as the screen shows them: what was given, and the fact of what was not. */
export function playerLabel(player: PlayerInfo | undefined, role: 'White' | 'Black'): PlayerLabel {
  const name = player?.name?.trim()
  const title = player?.title?.trim()
  const rating = typeof player?.rating === 'number' && Number.isFinite(player.rating) && player.rating > 0 ? Math.round(player.rating) : null
  return {
    name: name && name !== '?' ? name : null,
    rating,
    title: title && title !== '-' && title !== '?' ? title : null,
    role,
    partial: !(name && name !== '?') || rating === null
  }
}

/**
 * A pairing in one line, from the players rather than from the provider's label.
 *
 * Used where a provider sent no label of its own. A missing name becomes the role word, which is why the two are
 * never joined with something that reads like a name.
 */
export function pairingWords(white: PlayerInfo | undefined, black: PlayerInfo | undefined): string {
  const one = playerLabel(white, 'White')
  const two = playerLabel(black, 'Black')
  return `${one.name ?? one.role} – ${two.name ?? two.role}`
}

// ---- clocks ----------------------------------------------------------------------------------------------------

/**
 * A clock, as digits.
 *
 * Rounded **down**, always. A clock showing more time than a player has is the one rounding mistake that changes
 * what the screen is claiming, and 0.4 seconds left is not "1 second". Hours appear only when there are hours, so
 * an ordinary game does not read as a stopwatch.
 */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  const pad = (v: number): string => String(v).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

export interface ClockFace {
  text: string
  origin: ClockOrigin
  /** True when this value was worked out here by subtracting, rather than received from the source. */
  counted: boolean
  /** Said plainly, for the label that has to explain itself. */
  note: string
}

/** One side's clock, ready to show, saying where its value came from. Null when the source never sent one. */
export function clockFace(reading: ClockReading | null): ClockFace | null {
  if (!reading) return null
  const counted = reading.origin === 'extrapolated'
  return {
    text: formatClock(reading.seconds),
    origin: reading.origin,
    counted,
    note: counted
      ? 'Counted down by this computer from the last reading that arrived. Not a value the source sent.'
      : 'As the source sent it.'
  }
}

export interface ClockPair {
  white: ClockFace | null
  black: ClockFace | null
  /** When the reading everything here is based on was taken. Null when there is no reading at all. */
  at: number | null
  /** True when either side shown was worked out here. */
  anyCounted: boolean
  /** True when the source has never sent a clock for this game, so there is nothing to show. */
  none: boolean
}

/** Both clocks, ready to show. Takes `clockDisplay`'s answer from `live.ts` and says it in the screen's terms. */
export function clockPair(display: ClockDisplay): ClockPair {
  const white = clockFace(display.white)
  const black = clockFace(display.black)
  return {
    white,
    black,
    at: display.at,
    anyCounted: display.anyExtrapolated,
    none: white === null && black === null
  }
}

// ---- where the board is ----------------------------------------------------------------------------------------

export interface ViewerPosition {
  /** How many moves of the game are being shown. 0 is the starting position. */
  ply: number
  fen: string
  lastMove: { from: string; to: string } | null
  /** How many moves have arrived that are not being shown. */
  behind: number
  total: number
  /** True when the board is not the latest position Orbis holds, and must be marked as such. */
  historical: boolean
}

/**
 * The position to draw, and whether it is the current one.
 *
 * `at` is null for "wherever the game has got to", which is what watching means, and a number for a ply somebody
 * has walked back to. The distinction is the whole reason this is not a plain index: a watcher sitting at the tip
 * must move forward when a move arrives, and a watcher who has walked back must not be dragged forward under
 * their hands. Holding the tip as null is what makes both true without any watching of its own.
 *
 * An `at` past the end is clamped rather than refused: a correction can shorten a game under a reader who was
 * looking at a move that no longer exists.
 */
export function viewerPosition(record: Pick<LiveGameRecord, 'startFen' | 'moves'>, at: number | null): ViewerPosition {
  const total = record.moves.length
  const ply = at === null ? total : Math.max(0, Math.min(Math.floor(at), total))
  const fen = ply === total ? currentFen(record) : record.moves[ply - 1]?.fen ?? record.startFen
  const move = ply > 0 ? record.moves[ply - 1] : undefined
  return {
    ply,
    fen,
    lastMove: move ? { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4) } : null,
    behind: total - ply,
    total,
    historical: ply < total
  }
}

// ---- a provider changing its mind ------------------------------------------------------------------------------

export interface LineChange {
  /** Moves on the end that were not there before. */
  added: number
  /** The ply at which the provider's line stopped agreeing with the one we were shown, or null if it never did. */
  divergedAt: number | null
  /** Moves that were there before and are not any more, with nothing put in their place. */
  removed: number
}

/**
 * What changed between the line we were showing and the line that has just arrived.
 *
 * `live.ts` already does this when it ingests, and reports it on the change event -- which the window has no way
 * to receive yet (see the report beside this work). So the window works it out again from the records it polls,
 * because a correction that is not announced is the one change a watcher must not miss: the moves on screen
 * silently become a different game, and the move somebody was looking at is now a different move.
 */
export function compareLines(before: readonly { uci: string }[], after: readonly { uci: string }[]): LineChange {
  const shared = Math.min(before.length, after.length)
  let divergedAt: number | null = null
  for (let i = 0; i < shared; i++) {
    if (before[i].uci !== after[i].uci) {
      divergedAt = i
      break
    }
  }
  return {
    added: divergedAt === null ? Math.max(0, after.length - before.length) : Math.max(0, after.length - divergedAt),
    divergedAt,
    removed: divergedAt === null ? Math.max(0, before.length - after.length) : Math.max(0, before.length - divergedAt)
  }
}

/** A move number the way a person says it: 12 for White's twelfth, "12…" for Black's reply. */
export function moveNumberWords(ply: number, startFen: string): string {
  const parts = startFen.trim().split(/\s+/)
  const first = Number.parseInt(parts[5] ?? '1', 10) || 1
  const blackFirst = parts[1] === 'b'
  // `ply` is an index into the moves, so the first move played is 0.
  const offset = blackFirst ? ply + 1 : ply
  const number = first + Math.floor(offset / 2)
  const black = offset % 2 === 1
  return `${number}${black ? '…' : ''}`
}

/** A correction said out loud, or null when nothing was corrected. */
export function correctionWords(change: LineChange, startFen: string): string | null {
  if (change.divergedAt === null) return null
  return `The provider has changed move ${moveNumberWords(change.divergedAt, startFen)} and everything after it. What is shown now follows their corrected game.`
}

// ---- keeping a game --------------------------------------------------------------------------------------------

export interface Keepability {
  can: boolean
  /** What the button says. */
  label: string
  /** What will actually be saved, said before it is. */
  note: string
}

/**
 * Whether a broadcast game is worth keeping yet, and what keeping it would really save.
 *
 * A finished game is a whole game. A game still being played is the moves that have arrived, and saving it makes a
 * copy that will never catch up -- which is fine to offer and not fine to offer silently, because a half game that
 * looks like a whole one is the thing somebody discovers a year later.
 */
export function keepability(record: Pick<LiveGameRecord, 'status' | 'result' | 'moves'>): Keepability {
  if (!record.moves.length) {
    return {
      can: false,
      label: 'Keep this game',
      note: 'No moves have arrived for this game yet, so there is nothing to keep.'
    }
  }
  if (record.status === 'finished') {
    return {
      can: true,
      label: 'Keep this game',
      note: `This game is over (${resultWords(record.result).toLowerCase()}), so keeping it saves the whole game.`
    }
  }
  return {
    can: true,
    label: 'Keep it as it stands',
    note: `This game is still being played. Keeping it saves the ${record.moves.length} move${record.moves.length === 1 ? '' : 's'} that have arrived, and the saved copy will not keep up with the board.`
  }
}

// ---- putting the listing and the feed together -----------------------------------------------------------------

export interface MergedGame {
  id: string
  /** What the round's listing said. Absent for a game the feed carries that the listing did not. */
  listing: LiveGameListing | null
  /** What the feed has delivered. Absent for a listed game nothing has arrived for yet. */
  record: LiveGameRecord | null
  /** The pairing to show, from whichever source has it. */
  name: string
  white: PlayerInfo
  black: PlayerInfo
  status: LiveStatus
  result: GameResult
  /** True when nothing has arrived for this game yet, so the board for it would be empty. */
  waiting: boolean
}

const mergedFrom = (listing: LiveGameListing | null, record: LiveGameRecord | null): MergedGame => {
  const id = record?.id ?? listing?.id ?? ''
  /*
   * The feed wins over the listing, for everything the feed has.
   *
   * The listing is a snapshot of a request that was made once; the feed is what has arrived since. A result
   * announced on the feed therefore shows, and a listing fetched before the game finished does not overwrite it.
   * Names are merged the other way round only where the feed left one out -- a feed that stops sending a name has
   * not withdrawn it.
   */
  const white = { ...(listing?.white ?? {}), ...(record?.white ?? {}) }
  const black = { ...(listing?.black ?? {}), ...(record?.black ?? {}) }
  const name = (listing?.name ?? '').trim() || pairingWords(white, black)
  return {
    id,
    listing,
    record,
    name,
    white,
    black,
    status: record?.status ?? listing?.status ?? 'unknown',
    result: record?.result ?? listing?.result ?? '*',
    waiting: record === null || record.moves.length === 0
  }
}

/**
 * The round's games, in the order the provider listed them, with whatever the feed has delivered attached.
 *
 * Board order is the provider's order, so it is kept exactly. A game the feed carries that the listing did not is
 * appended rather than dropped -- it is a real game being played, and losing it because a listing was fetched a
 * minute earlier would be the screen deciding what the round contains.
 */
export function mergeGames(listings: readonly LiveGameListing[], records: readonly LiveGameRecord[]): MergedGame[] {
  const byId = new Map(records.map((one) => [one.id, one]))
  const used = new Set<string>()
  const out: MergedGame[] = []
  for (const listing of listings) {
    const record = byId.get(listing.id) ?? null
    if (record) used.add(record.id)
    out.push(mergedFrom(listing, record))
  }
  for (const record of records) {
    if (used.has(record.id)) continue
    out.push(mergedFrom(null, record))
  }
  return out
}

/** The game to show when a round has just been opened: the first one with moves, else the first listed. */
export function firstWorthWatching(games: readonly MergedGame[]): string | null {
  const playing = games.find((one) => one.record !== null && one.record.moves.length > 0 && one.status === 'live')
  if (playing) return playing.id
  const withMoves = games.find((one) => one.record !== null && one.record.moves.length > 0)
  if (withMoves) return withMoves.id
  return games.length ? games[0].id : null
}

// ---- faults ----------------------------------------------------------------------------------------------------

export interface FaultWords {
  /** What happened, in the provider's or the manager's own words. */
  what: string
  /** What it means for the person, and what if anything will happen next. */
  next: string
  /** True when waiting is the answer and asking again now would make it worse. */
  wait: boolean
}

/**
 * A fault turned into the two sentences a screen needs: what happened, and what happens now.
 *
 * The kinds are not decoration. A rate limit means stop asking; a schema fault means Orbis is wrong and no amount
 * of retrying will help; a circuit that is open means Orbis has already decided to leave the provider alone. A
 * screen that showed all three as "something went wrong, try again" would be wrong twice and rude once.
 */
export function faultWords(fault: { reason: string; kind?: DiagnosticKind; provider?: string; status?: number }): FaultWords {
  const what = fault.reason
  switch (fault.kind) {
    case 'rate-limit':
      return { what, next: 'The provider has asked for fewer requests, so Orbis is waiting before it asks again. Nothing is being fetched in the meantime.', wait: true }
    case 'circuit-open':
      return { what, next: 'Several attempts in a row failed, so Orbis has stopped asking for a short while rather than keep hammering the provider.', wait: true }
    case 'schema':
      return { what, next: 'This is a fault in Orbis, not a tournament being off: the provider has changed the shape of its answer. Trying again will not help, and nothing was guessed at.', wait: false }
    case 'timeout':
      return { what, next: 'The provider did not answer in time. Trying again may well work.', wait: false }
    case 'network':
      return { what, next: 'The provider could not be reached. Check this computer is online, then try again.', wait: false }
    case 'pgn':
      return { what, next: 'One game could not be read. The rest of the round is unaffected, and nothing was guessed at.', wait: false }
    case 'http':
      return { what, next: fault.status === 404 ? 'There is nothing at that address any more.' : 'The provider refused the request. Trying again later may work.', wait: false }
    case 'refused':
      return { what, next: 'Orbis did not make this request. Nothing was changed.', wait: false }
    default:
      return { what, next: 'Nothing was fetched, and nothing was guessed at.', wait: false }
  }
}

/**
 * Whether an address a provider sent may be handed to the system browser.
 *
 * Only ordinary secure web addresses. The address arrived inside a provider's answer, which is data and not a
 * decision, so `file:`, `javascript:` and anything that could name a program on this computer must never reach
 * the system browser merely because a provider put it in a field Orbis shows a link for.
 */
export const isWebLink = (url: string): boolean => /^https:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(url.trim())

/**
 * Whether a diagnostic is worth putting in front of somebody at all.
 *
 * A cancelled request is the ordinary result of switching rounds, and reporting it would teach people that the red
 * line means nothing.
 */
export const worthShowing = (fault: { kind?: DiagnosticKind }): boolean => fault.kind !== 'cancelled'
