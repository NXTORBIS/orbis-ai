import { readPgn } from '../../../shared/chess/pgn.ts'
import type { GameResult, PlayerInfo } from '../../../shared/chess/model.ts'
import type { DiagnosticKind, LiveDiagnostic, LiveOutcomeOf, LivePayload, LiveStatus, WrittenMove } from '../../../shared/chess/live.ts'
import type { LiveEventSummary, LiveProviderPort } from './manager.ts'

/**
 * Lichess broadcasts, as the one live source Orbis actually has.
 *
 * Every path below was read out of the published OpenAPI source
 * (https://raw.githubusercontent.com/lichess-org/api/master/doc/specs/lichess-api.yaml) and then confirmed against
 * the running service. Nothing here is guessed, and nothing here scrapes: if a response stops looking like the
 * documented schema this adapter says so and stops, rather than reaching for the HTML version of the same page
 * (Sections 082, 352).
 *
 * The endpoints used:
 *
 *   GET /api/broadcast?nb=&html=&live=                      application/x-ndjson, one tournament per line
 *   GET /api/broadcast/top?page=                            application/json
 *   GET /api/broadcast/{tourId}                             application/json, the tournament and its rounds
 *   GET /api/broadcast/{tourSlug}/{roundSlug}/{roundId}     application/json, one round and its games
 *   GET /api/stream/broadcast/round/{roundId}.pgn           application/x-chess-pgn, chunked and long-lived
 *
 * The slugs in the round path are documented as being for search engines only and safely replaceable with "-", so
 * this adapter asks for `/api/broadcast/-/-/{roundId}` and never has to carry a slug around.
 *
 * Four things about Lichess shape everything in this file:
 *
 *  1. **The stream re-sends whole games.** Documented: "it waits for new moves to be played. As soon as it happens,
 *     the entire PGN of the game is sent to the stream." So every game that arrives is a *snapshot*, and it is
 *     labelled one, which is what stops `live.ts` replaying a 56-move game as 56 new moves.
 *
 *  2. **One request at a time.** Documented under rate limiting: "Only make one request at a time." This is not
 *     advice to be clever about -- asking twice at once really is refused. Observed, on the PGN stream: HTTP 429
 *     with a JSON body, `{"error":"Please only run 2 request(s) at a time"}`, on an endpoint that otherwise serves
 *     `application/x-chess-pgn`. So a 429 here can arrive wearing the wrong content type, and requests are put
 *     through one lane.
 *
 *  3. **There is no heartbeat.** Nothing in the documentation promises an idle keep-alive, and a classical game is
 *     entitled to send nothing for twenty minutes because a player is entitled to think for twenty minutes. An idle
 *     timeout tight enough to notice a dead socket quickly would therefore spend the day reconnecting to a perfectly
 *     healthy broadcast, so the idle timeout here is deliberately long.
 *
 *  4. **On 429, wait.** Documented: "In most cases, waiting one minute before retrying will be sufficient, but some
 *     limits may require longer. Reduce your request frequency before retrying." So a 429 blocks the provider for at
 *     least a minute and is never retried tightly.
 *
 * No Electron, no filesystem, no global fetch: the caller passes `fetchFn`, so all of the above is testable with no
 * tournament being on.
 */

// ---- the shape of a response, kept small enough to be trivially faked -------------------------------------------

export interface LiveFetchResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  /**
   * The body as it arrives, for the streaming endpoint. Either an async iterable of chunks or a web
   * `ReadableStream`; both are accepted so a real `fetch` Response and a test's async generator both fit.
   */
  body?: StreamBody | null
}

export type StreamBody =
  | AsyncIterable<Uint8Array | string>
  | { getReader(): { read(): Promise<{ done?: boolean; value?: Uint8Array | string }>; cancel?(): unknown } }

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<LiveFetchResponse>

// ---- what the adapter reports when something is wrong -----------------------------------------------------------

/**
 * The fault vocabulary lives with the model, in `shared/chess/live.ts`, not here.
 *
 * That is what lets the manager report a fault without knowing which provider made it, and lets this adapter report
 * one without knowing who is listening. It is re-exported for the convenience of anything wiring this adapter up.
 */
export type { DiagnosticKind, LiveDiagnostic } from '../../../shared/chess/live.ts'

export type Outcome<T> = LiveOutcomeOf<T>

// ---- the normalised listing types ------------------------------------------------------------------------------

export interface BroadcastTournament {
  id: string
  name: string
  slug: string
  /** Lichess's own page for it, which is what an attribution link points at. */
  url?: string
  createdAt?: number
  /** Start, and end when it has one, as the provider gave them. */
  dates?: number[]
  /** Lichess's featuring rank. Lower-numbered tiers are the ones it puts on its own front page. */
  tier?: number
  /** Free-text facts the provider supplies; never parsed into anything Orbis claims to understand. */
  info?: { format?: string; timeControl?: string; location?: string; players?: string; website?: string; standings?: string }
  /** The series this tournament belongs to, when it is part of one. */
  groupName?: string
}

export interface BroadcastRoundInfo {
  id: string
  name: string
  slug: string
  url?: string
  startsAt?: number
  /** Present when the provider says a round is under way. */
  ongoing?: boolean
  /** When it ended. The provider's `finished` boolean is deprecated in its own documentation; this is the one to use. */
  finishedAt?: number
  /** The provider has no documented start time and will begin this round when the previous one ends. */
  startsAfterPrevious?: boolean
  /**
   * Seconds the broadcast is deliberately held behind the board.
   *
   * Not documented on any read response -- the only documented `delay` is a write-only field when creating a round --
   * but it is present in practice on the round endpoint, and it changes whether anything may honestly be called live.
   * So it is read when offered and simply absent when not. It is never defaulted to 0, because "no embargo" and
   * "nobody said" are different claims.
   */
  delaySeconds?: number
}

export interface BroadcastGameInfo {
  id: string
  /** The provider's label, usually "White, Name - Black, Name". Not split into players: that is what `players` is for. */
  name: string
  white: PlayerInfo
  black: PlayerInfo
  /** Seconds remaining, when the provider sent clocks. */
  clocks?: { white?: number; black?: number }
  result: GameResult
  status: LiveStatus
  /** The position the provider says the game stands in. Advisory: the moves come from the PGN, which can be replayed. */
  fen?: string
  /** The last move in coordinates, as the provider gave it. */
  lastMove?: string
}

export interface BroadcastRoundDetail {
  round: BroadcastRoundInfo
  tour: BroadcastTournament
  games: BroadcastGameInfo[]
  /** Faults that did not stop the round being read: one unreadable game in thirty, say. */
  warnings: LiveDiagnostic[]
}

export interface BroadcastListing {
  tournaments: { tour: BroadcastTournament; rounds: BroadcastRoundInfo[]; defaultRoundId?: string }[]
  warnings: LiveDiagnostic[]
}

export const LICHESS = 'lichess'

// ---- reading values without ever throwing ----------------------------------------------------------------------

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

/** `{ key: value }` when there is a value, and nothing at all when there is not. "Missing stays missing", in code. */
const put = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>

/**
 * The provider's result vocabulary turned into Orbis's.
 *
 * The trap: the JSON `status` field uses the typographic "½-½" -- that is what its own schema documents -- while the
 * PGN `Result` tag on the very same game uses "1/2-1/2". Reading only the PGN spelling would quietly turn every
 * drawn game in a listing into "no result yet", which looks like a feed that works.
 */
export function readResult(value: unknown): GameResult | undefined {
  const text = str(value)?.trim()
  if (!text) return undefined
  if (text === '1-0' || text === '0-1' || text === '*') return text
  if (text === '1/2-1/2' || text === '½-½' || text === '0.5-0.5') return '1/2-1/2'
  return undefined
}

/**
 * The provider's player clock, in seconds.
 *
 * The unit is *not documented*: the schema says only `clock: integer`. It is centiseconds in practice -- a game whose
 * `TimeControl` is "45+30" reports 273000, which is 2730 seconds, which is exactly 45 minutes plus the 30-second
 * increment -- so that is the conversion used, and it is marked as inferred rather than dressed up as documented.
 * Where a clock is available from the PGN instead, that one is preferred: `[%clk 1:01:27]` is documented, is
 * unambiguous, and needs no inference at all.
 */
export function readClockSeconds(value: unknown): number | undefined {
  const raw = int(value)
  if (raw === undefined || raw < 0) return undefined
  const seconds = raw / 100
  // A clock of more than a day is not a time control; it is a unit this adapter has guessed wrong about.
  if (seconds > 24 * 60 * 60) return undefined
  return seconds
}

function readPlayer(raw: unknown): PlayerInfo {
  const p = obj(raw)
  if (!p) return {}
  const name = str(p.name)?.trim()
  const rating = int(p.rating)
  const title = str(p.title)?.trim()
  return {
    ...(name && name !== '?' ? { name: name.slice(0, 120) } : {}),
    ...(rating !== undefined && rating > 0 ? { rating: Math.round(rating) } : {}),
    ...(title && title !== '-' ? { title: title.slice(0, 12) } : {})
  }
}

/**
 * The series a tournament belongs to.
 *
 * `group` sits *beside* `tour`, not inside it, and it is a plain string on the listing schemas and a full object on
 * the single-tournament one. Reading it off the tour object finds nothing; reading it as one type prints
 * "[object Object]" in half the cases. Hence both, from the right place.
 */
const groupNameOf = (raw: unknown): string | undefined => str(raw) ?? str(obj(raw)?.name)

function readTour(raw: unknown, group?: unknown): BroadcastTournament | null {
  const t = obj(raw)
  // id, name and slug are `required` in the published schema. Without them this is not a tournament.
  const id = str(t?.id)
  const name = str(t?.name)
  const slug = str(t?.slug)
  if (!t || !id || !name || !slug) return null
  const info = obj(t.info)
  const readInfo = (): BroadcastTournament['info'] | undefined => {
    if (!info) return undefined
    const out = {
      ...put('format', str(info.format)),
      ...put('timeControl', str(info.tc)),
      ...put('location', str(info.location)),
      ...put('players', str(info.players)),
      ...put('website', str(info.website)),
      ...put('standings', str(info.standings))
    }
    return Object.keys(out).length ? out : undefined
  }
  // The enclosing entry's group is preferred, because that is where the published schemas put it. A `group` on the
  // tour object itself is read as a fallback only, so a provider that ever moved it would still be understood.
  const groupName = groupNameOf(group) ?? groupNameOf(t.group)
  return {
    id,
    name,
    slug,
    ...put('url', str(t.url)),
    ...put('createdAt', int(t.createdAt)),
    ...put('dates', Array.isArray(t.dates) ? t.dates.filter((d): d is number => int(d) !== undefined) : undefined),
    ...put('tier', int(t.tier)),
    ...put('info', readInfo()),
    ...put('groupName', groupName)
  }
}

function readRoundInfo(raw: unknown): BroadcastRoundInfo | null {
  const r = obj(raw)
  const id = str(r?.id)
  const name = str(r?.name)
  const slug = str(r?.slug)
  if (!r || !id || !name || !slug) return null
  const delay = int(r.delay)
  return {
    id,
    name,
    slug,
    ...put('url', str(r.url)),
    ...put('startsAt', int(r.startsAt)),
    ...put('ongoing', bool(r.ongoing)),
    ...put('finishedAt', int(r.finishedAt)),
    ...put('startsAfterPrevious', bool(r.startsAfterPrevious)),
    ...put('delaySeconds', delay !== undefined && delay > 0 ? delay : undefined)
  }
}

/** Where a round is, from the round's own fields rather than from a guess about the clock. */
export function roundStatus(round: BroadcastRoundInfo): LiveStatus {
  if (round.finishedAt !== undefined) return 'finished'
  if (round.ongoing === true) return 'live'
  if (round.startsAt !== undefined || round.startsAfterPrevious === true) return 'scheduled'
  return 'unknown'
}

function readGame(raw: unknown, round: BroadcastRoundInfo): BroadcastGameInfo | null {
  const g = obj(raw)
  const id = str(g?.id)
  const name = str(g?.name)
  // Only `id` and `name` are required by the published schema; everything else is genuinely optional.
  if (!g || !id || !name) return null
  const players = Array.isArray(g.players) ? g.players : []
  // The schema does not actually state that index 0 is White. Its own example reads that way and the service
  // behaves that way, so the order is used -- but the PGN's White/Black tags are what the stored game is built
  // from, and those are unambiguous, so a provider that ever reversed this would not corrupt a saved game.
  const white = readPlayer(players[0])
  const black = readPlayer(players[1])
  const whiteClock = readClockSeconds(obj(players[0])?.clock)
  const blackClock = readClockSeconds(obj(players[1])?.clock)
  const result = readResult(g.status) ?? '*'
  const clocks = whiteClock !== undefined || blackClock !== undefined
    ? { ...put('white', whiteClock), ...put('black', blackClock) }
    : undefined
  return {
    id,
    name,
    white,
    black,
    ...put('clocks', clocks),
    result,
    status: result !== '*' ? 'finished' : roundStatus(round) === 'finished' ? 'unknown' : roundStatus(round),
    ...put('fen', str(g.fen)),
    ...put('lastMove', str(g.lastMove))
  }
}

// ---- framing a chunked PGN stream ------------------------------------------------------------------------------

const RESULT_THEN_BLANK = /(?:^|\s)(?:1-0|0-1|1\/2-1\/2|\*)[ \t]*\r?\n[ \t]*\r?\n/

/**
 * Cutting a chunked PGN stream into whole games.
 *
 * The documentation fixes the content type and the order of things but defines no delimiter, so the framing is taken
 * from what the service actually sends: each game begins with an `[Event ...]` tag at the start of a line, and ends
 * with its result token followed by a blank line.
 *
 * A game is only emitted once it is certainly complete, which is either because another `[Event` has begun after it
 * or because its own result token has been followed by a blank line. Anything else stays in `rest` and waits. Half a
 * game is worse than no game: it parses, it looks plausible, and it is missing the end of the move list.
 */
export function splitPgnGames(buffer: string): { games: string[]; rest: string } {
  const starts: number[] = []
  const re = /(?:^|\n)\[Event[ \t]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(buffer)) !== null) {
    starts.push(match[0].startsWith('\n') ? match.index + 1 : match.index)
    re.lastIndex = match.index + match[0].length
  }
  if (!starts.length) return { games: [], rest: buffer }
  const games: string[] = []
  for (let i = 0; i < starts.length - 1; i++) games.push(buffer.slice(starts[i], starts[i + 1]))
  const tail = buffer.slice(starts[starts.length - 1])
  if (RESULT_THEN_BLANK.test(tail)) {
    games.push(tail)
    return { games, rest: '' }
  }
  return { games, rest: tail }
}

/** The game id out of a broadcast PGN's own links: the last segment of the game URL. */
export function gameIdFromPgnTags(tags: { site?: string; gameUrl?: string }): string | undefined {
  for (const value of [tags.gameUrl, tags.site]) {
    const text = value?.trim()
    if (!text) continue
    const segment = text.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop()
    // A broadcast game id is 8 characters of Lichess's own alphabet. Anything else is a URL that does not name one.
    if (segment && /^[A-Za-z0-9]{6,12}$/.test(segment)) return segment
  }
  return undefined
}

/**
 * One chunk of broadcast PGN turned into payloads `live.ts` can ingest.
 *
 * Every game is marked `kind: 'snapshot'`, because that is what the provider sends, and that label is the whole
 * defence against a game being appended to itself.
 *
 * A game that cannot be read is reported and skipped, never guessed at: twenty-nine readable games should not be
 * lost because the thirtieth has an operator's typo in it.
 */
export function payloadsFromPgn(
  text: string,
  ctx: { eventId: string; receivedAt: number; eventName?: string }
): { payloads: LivePayload[]; problems: LiveDiagnostic[] } {
  const payloads: LivePayload[] = []
  const problems: LiveDiagnostic[] = []
  const read = readPgn(text)
  for (const game of read.games) {
    const extra = game.meta.extra ?? {}
    const providerGameId = gameIdFromPgnTags({
      ...put('site', game.meta.site),
      ...put('gameUrl', extra.GameURL)
    })
    if (!providerGameId) {
      problems.push({
        provider: LICHESS,
        operation: `the PGN of round ${ctx.eventId}`,
        kind: 'pgn',
        message: 'A game arrived with no link in it, so there is no way to tell which game it is. It was not applied.',
        field: 'GameURL',
        at: ctx.receivedAt
      })
      continue
    }
    if (!game.ok) {
      problems.push({
        provider: LICHESS,
        operation: `the PGN of round ${ctx.eventId}`,
        kind: 'pgn',
        message: `Game ${providerGameId} could not be read: ${game.reason ?? 'its moves could not be played.'}`,
        field: 'moves',
        at: ctx.receivedAt
      })
      continue
    }
    const moves: WrittenMove[] = game.moves.map((m) => ({
      san: m.san,
      ...put('comment', m.comment),
      ...put('nag', m.nag),
      ...put('clock', m.clock)
    }))
    /*
     * The clocks that go on the record belong to the last move each side made, because that is the last moment
     * either clock was actually read. Nothing is extrapolated here -- `live.ts` does that, and marks it.
     *
     * Only the *last* move's clock counts, even when it has none. An older reading from the same side would be a
     * stale number shown beside a fresh one, which reads as a position neither player was ever in.
     *
     * Which side a ply belongs to comes from the starting position, not from the index being even: a round shown
     * from a position can perfectly well have Black to move first.
     */
    const blackFirst = game.startFen.trim().split(/\s+/)[1] === 'b'
    const lastOf = (side: 'w' | 'b'): number | undefined => {
      for (let i = game.moves.length - 1; i >= 0; i--) {
        const isWhite = blackFirst ? i % 2 === 1 : i % 2 === 0
        if (isWhite === (side === 'w')) return game.moves[i].clock
      }
      return undefined
    }
    const whiteClock = lastOf('w')
    const blackClock = lastOf('b')
    const clocks = whiteClock !== undefined || blackClock !== undefined
      ? { ...put('white', whiteClock), ...put('black', blackClock) }
      : undefined
    payloads.push({
      provider: LICHESS,
      providerGameId,
      eventId: ctx.eventId,
      ...put('eventName', str(extra.BroadcastName) ?? ctx.eventName),
      ...put('round', game.meta.round),
      white: game.meta.white,
      black: game.meta.black,
      startFen: game.startFen,
      moves,
      kind: 'snapshot',
      result: game.meta.result,
      status: game.meta.result !== '*' ? 'finished' : game.moves.length ? 'live' : 'unknown',
      ...put('clocks', clocks),
      receivedAt: ctx.receivedAt
    })
  }
  for (const warning of read.warnings) {
    problems.push({
      provider: LICHESS,
      operation: `the PGN of round ${ctx.eventId}`,
      kind: 'pgn',
      message: warning.message,
      at: ctx.receivedAt
    })
  }
  return { payloads, problems }
}

// ---- the adapter ------------------------------------------------------------------------------------------------

export interface LichessOptions {
  fetchFn: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** For the backoff's jitter. Injectable so a test can get a predictable delay. */
  random?: () => number
  /**
   * A `study:read` token. The broadcast read endpoints work without one today, but the provider's own documentation
   * warns that unauthenticated broadcast endpoints are "heavily rate-limited and might stop functioning", so a
   * person who has supplied a token gets it used. Never logged, never put in a URL.
   */
  token?: string
  /**
   * Sent as `User-Agent`. Lichess does not document a requirement for this -- it is courtesy, so that an operator
   * looking at their own traffic can see who is asking and get in touch.
   */
  userAgent?: string
  baseUrl?: string
  /** How long one ordinary request may take. */
  timeoutMs?: number
  /**
   * How long the live stream may be silent before the connection is assumed dead.
   *
   * Long on purpose. There is no documented heartbeat, and a classical game legitimately sends nothing while
   * somebody thinks, so a short idle timeout would reconnect all day against a working broadcast.
   */
  idleTimeoutMs?: number
  /** Consecutive failures that open the circuit. */
  breakerThreshold?: number
  /** How long the circuit stays open. */
  breakerCooldownMs?: number
}

const DEFAULTS = {
  baseUrl: 'https://lichess.org',
  timeoutMs: 20_000,
  idleTimeoutMs: 15 * 60_000,
  breakerThreshold: 4,
  breakerCooldownMs: 60_000,
  /** The documented wait after a 429: "waiting one minute before retrying will be sufficient" -- at least. */
  rateLimitCooldownMs: 60_000,
  reconnectBaseMs: 2_000,
  reconnectMaxMs: 5 * 60_000,
  maxReconnects: 10
}

export interface RoundSubscription {
  /** Stops the stream. Safe to call more than once. */
  stop(): void
  /** Resolves when the stream has finished, whether it ended, failed, or was stopped. */
  done: Promise<void>
}

export interface SubscribeHandlers {
  /** Games as they arrive. Always snapshots, because that is what the provider sends. */
  onPayloads: (payloads: LivePayload[]) => void
  /** Something went wrong. The stream may still recover; `onState` says whether it is trying. */
  onDiagnostic?: (d: LiveDiagnostic) => void
  onState?: (state: 'connecting' | 'open' | 'reconnecting' | 'stopped' | 'failed', detail?: string) => void
}

export class LichessBroadcasts {
  private readonly fetchFn: FetchLike
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private readonly options: Required<Pick<LichessOptions, 'baseUrl' | 'timeoutMs' | 'idleTimeoutMs' | 'breakerThreshold' | 'breakerCooldownMs'>>
  private readonly token?: string
  private readonly userAgent?: string

  /** Requests go through one lane, because the provider documents "only make one request at a time". */
  private lane: Promise<unknown> = Promise.resolve()
  /** The same question asked twice while the first is still in the air gets the first answer. */
  private readonly inFlight = new Map<string, Promise<Outcome<string>>>()
  private failures = 0
  private openUntil = 0
  private lastDiagnostic: LiveDiagnostic | null = null

  constructor(o: LichessOptions) {
    this.fetchFn = o.fetchFn
    this.now = o.now ?? Date.now
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.random = o.random ?? Math.random
    this.options = {
      baseUrl: (o.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, ''),
      timeoutMs: o.timeoutMs ?? DEFAULTS.timeoutMs,
      idleTimeoutMs: o.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs,
      breakerThreshold: o.breakerThreshold ?? DEFAULTS.breakerThreshold,
      breakerCooldownMs: o.breakerCooldownMs ?? DEFAULTS.breakerCooldownMs
    }
    if (o.token) this.token = o.token
    if (o.userAgent) this.userAgent = o.userAgent
  }

  /** What the adapter currently thinks of the provider, for a status line that does not have to guess. */
  health(): { circuitOpen: boolean; openForMs: number; consecutiveFailures: number; lastDiagnostic: LiveDiagnostic | null } {
    const remaining = Math.max(0, this.openUntil - this.now())
    return {
      circuitOpen: remaining > 0,
      openForMs: remaining,
      consecutiveFailures: this.failures,
      lastDiagnostic: this.lastDiagnostic
    }
  }

  private headers(accept: string): Record<string, string> {
    return {
      Accept: accept,
      ...(this.userAgent ? { 'User-Agent': this.userAgent } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
    }
  }

  private fault(operation: string, kind: DiagnosticKind, message: string, extra: { field?: string; status?: number } = {}): LiveDiagnostic {
    const d: LiveDiagnostic = {
      provider: LICHESS,
      operation,
      kind,
      message,
      ...put('field', extra.field),
      ...put('status', extra.status),
      at: this.now()
    }
    this.lastDiagnostic = d
    return d
  }

  /**
   * One failure, counted.
   *
   * A schema fault counts too. It will not fix itself by being retried, and the circuit opening is what stops this
   * adapter asking a changed API the same question four times a second until somebody notices.
   */
  private recordFailure(cooldownMs = this.options.breakerCooldownMs): void {
    this.failures += 1
    if (this.failures >= this.options.breakerThreshold) this.openUntil = this.now() + cooldownMs
  }

  private recordSuccess(): void {
    this.failures = 0
    this.openUntil = 0
  }

  /**
   * One ordinary request: queued behind any other, de-duplicated, timed out, and counted.
   *
   * De-duplication is by URL and only covers the window in which a request is actually in the air, so it folds the
   * burst that happens when three screens ask for the same round at once without ever serving a cached answer as if
   * it were new.
   */
  private request(operation: string, url: string, accept: string): Promise<Outcome<string>> {
    const existing = this.inFlight.get(url)
    if (existing) return existing
    const job = this.runQueued(operation, url, accept).finally(() => {
      this.inFlight.delete(url)
    })
    this.inFlight.set(url, job)
    return job
  }

  private runQueued(operation: string, url: string, accept: string): Promise<Outcome<string>> {
    const run = this.lane.then(() => this.send(operation, url, accept))
    // The lane must not break on a rejection, or every later request queues behind a dead promise.
    this.lane = run.then(() => undefined, () => undefined)
    return run
  }

  private async send(operation: string, url: string, accept: string): Promise<Outcome<string>> {
    const open = this.openUntil - this.now()
    if (open > 0) {
      return {
        ok: false,
        diagnostic: this.fault(
          operation,
          'circuit-open',
          `Lichess is not being asked just now: ${this.failures} attempts in a row failed, so it is being left alone for another ${Math.ceil(open / 1000)} seconds.`
        )
      }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    try {
      const res = await this.fetchFn(url, { signal: controller.signal, headers: this.headers(accept) })
      const body = await res.text()
      if (res.status === 429) {
        this.recordFailure(DEFAULTS.rateLimitCooldownMs)
        this.openUntil = this.now() + DEFAULTS.rateLimitCooldownMs
        return {
          ok: false,
          diagnostic: this.fault(operation, 'rate-limit', `Lichess asked for fewer requests${describeError(body) ? ` (${describeError(body)})` : ''}. Waiting a minute before asking again.`, { status: 429 })
        }
      }
      if (!res.ok) {
        this.recordFailure()
        return { ok: false, diagnostic: this.fault(operation, 'http', `Lichess answered ${res.status}${describeError(body) ? `: ${describeError(body)}` : '.'}`, { status: res.status }) }
      }
      // A 200 whose body is an error object. Observed on the PGN stream when too many requests are open at once,
      // where it arrives with the PGN content type, so the body has to be looked at rather than the status trusted.
      const stated = describeError(body)
      if (stated) {
        this.recordFailure(DEFAULTS.rateLimitCooldownMs)
        return { ok: false, diagnostic: this.fault(operation, 'rate-limit', `Lichess refused the request: ${stated}`, { status: res.status }) }
      }
      this.recordSuccess()
      return { ok: true, value: body }
    } catch (e) {
      const aborted = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
      this.recordFailure()
      return {
        ok: false,
        diagnostic: this.fault(
          operation,
          aborted ? 'timeout' : 'network',
          aborted
            ? `Lichess did not answer within ${Math.round(this.options.timeoutMs / 1000)} seconds.`
            : `Lichess could not be reached: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private parse<T>(operation: string, text: string, read: (value: unknown) => T | null, field: string): Outcome<T> {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return { ok: false, diagnostic: this.schemaFault(operation, 'Lichess sent something that is not JSON where JSON was expected.', field) }
    }
    const made = read(value)
    if (made === null) {
      return {
        ok: false,
        diagnostic: this.schemaFault(
          operation,
          `Lichess's answer no longer has the shape this adapter was written against: "${field}" is missing or not what was expected. Nothing was read from it.`,
          field
        )
      }
    }
    return { ok: true, value: made }
  }

  /**
   * A schema fault.
   *
   * It counts as a failure and can open the circuit, because a changed API answers identically however many times it
   * is asked. What it must never do is cause a fallback: there is no scraping path here, and an adapter that quietly
   * started reading Lichess's HTML when its API changed would be both fragile and rude.
   */
  private schemaFault(operation: string, message: string, field: string): LiveDiagnostic {
    this.recordFailure()
    return this.fault(operation, 'schema', message, { field })
  }

  // ---- discovery ------------------------------------------------------------------------------------------------

  /**
   * The broadcasts Lichess is featuring: `GET /api/broadcast`, which answers NDJSON, one tournament per line.
   *
   * A line that cannot be read is reported as a warning and skipped. Thirty readable tournaments are worth more than
   * a clean failure because the thirty-first changed shape.
   */
  async official(o: { max?: number; onlyLive?: boolean } = {}): Promise<Outcome<BroadcastListing>> {
    const max = Math.min(Math.max(Math.trunc(o.max ?? 20), 1), 100)
    const url = `${this.options.baseUrl}/api/broadcast?nb=${max}${o.onlyLive ? '&live=true' : ''}`
    const operation = 'official broadcasts'
    const got = await this.request(operation, url, 'application/x-ndjson')
    if (!got.ok) return got
    const warnings: LiveDiagnostic[] = []
    const tournaments: BroadcastListing['tournaments'] = []
    const lines = got.value.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return { ok: true, value: { tournaments: [], warnings } }
    for (const [index, line] of lines.entries()) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        warnings.push(this.fault(operation, 'schema', `Line ${index + 1} of the broadcast list was not JSON and was skipped.`, { field: `line ${index + 1}` }))
        continue
      }
      const entry = obj(parsed)
      const tour = readTour(entry?.tour, entry?.group)
      if (!tour) {
        warnings.push(this.fault(operation, 'schema', `A broadcast in the list had no readable tournament and was skipped.`, { field: 'tour' }))
        continue
      }
      const rounds = (Array.isArray(entry?.rounds) ? entry.rounds : [])
        .map(readRoundInfo)
        .filter((r): r is BroadcastRoundInfo => r !== null)
      tournaments.push({ tour, rounds, ...put('defaultRoundId', str(entry?.defaultRoundId)) })
    }
    if (!tournaments.length) {
      return {
        ok: false,
        diagnostic: this.schemaFault(operation, `Lichess answered with ${lines.length} broadcasts and none of them could be read. The shape of its answer has probably changed.`, 'tour')
      }
    }
    return { ok: true, value: { tournaments, warnings } }
  }

  /**
   * The front page's broadcasts: `GET /api/broadcast/top`, which answers one JSON object.
   *
   * Only page 1 carries `active`, which the provider documents. `upcoming` is deprecated in its own schema and
   * documented as always empty, so it is not read -- reading it would present an always-empty list as a feature.
   */
  async top(page = 1): Promise<Outcome<{ active: { tour: BroadcastTournament; round: BroadcastRoundInfo }[]; past: { tour: BroadcastTournament; round: BroadcastRoundInfo }[]; warnings: LiveDiagnostic[] }>> {
    const wanted = Math.min(Math.max(Math.trunc(page), 1), 20)
    const operation = 'featured broadcasts'
    const got = await this.request(operation, `${this.options.baseUrl}/api/broadcast/top?page=${wanted}`, 'application/json')
    if (!got.ok) return got
    const warnings: LiveDiagnostic[] = []
    const read = (raw: unknown): { tour: BroadcastTournament; round: BroadcastRoundInfo }[] => {
      const out: { tour: BroadcastTournament; round: BroadcastRoundInfo }[] = []
      for (const item of Array.isArray(raw) ? raw : []) {
        const entry = obj(item)
        const tour = readTour(entry?.tour, entry?.group)
        const round = readRoundInfo(entry?.round)
        if (!tour || !round) {
          warnings.push(this.fault(operation, 'schema', 'A featured broadcast could not be read and was left out.', { field: tour ? 'round' : 'tour' }))
          continue
        }
        out.push({ tour, round })
      }
      return out
    }
    const parsed = this.parse(operation, got.value, (v) => obj(v), 'the top-level object')
    if (!parsed.ok) return parsed
    return {
      ok: true,
      value: { active: read(parsed.value.active), past: read(obj(parsed.value.past)?.currentPageResults), warnings }
    }
  }

  /** One tournament and its rounds: `GET /api/broadcast/{broadcastTournamentId}`. */
  async tournament(tourId: string): Promise<Outcome<{ tour: BroadcastTournament; rounds: BroadcastRoundInfo[]; defaultRoundId?: string }>> {
    if (!isId(tourId)) return { ok: false, diagnostic: this.fault(`tournament ${tourId}`, 'schema', 'That is not a Lichess broadcast id.', { field: 'broadcastTournamentId' }) }
    const operation = `tournament ${tourId}`
    const got = await this.request(operation, `${this.options.baseUrl}/api/broadcast/${encodeURIComponent(tourId)}`, 'application/json')
    if (!got.ok) return got
    const parsed = this.parse(operation, got.value, (v) => obj(v), 'the top-level object')
    if (!parsed.ok) return parsed
    const tour = readTour(parsed.value.tour, parsed.value.group)
    if (!tour) return { ok: false, diagnostic: this.schemaFault(operation, 'This tournament has no readable details.', 'tour') }
    const rounds = (Array.isArray(parsed.value.rounds) ? parsed.value.rounds : [])
      .map(readRoundInfo)
      .filter((r): r is BroadcastRoundInfo => r !== null)
    return { ok: true, value: { tour, rounds, ...put('defaultRoundId', str(parsed.value.defaultRoundId)) } }
  }

  /**
   * One round and the games in it: `GET /api/broadcast/{tourSlug}/{roundSlug}/{roundId}`.
   *
   * The slugs are documented as decoration, so "-" is sent for both and no slug has to be carried around to ask
   * about a round.
   */
  async round(roundId: string): Promise<Outcome<BroadcastRoundDetail>> {
    if (!isId(roundId)) return { ok: false, diagnostic: this.fault(`round ${roundId}`, 'schema', 'That is not a Lichess broadcast round id.', { field: 'broadcastRoundId' }) }
    const operation = `round ${roundId}`
    const got = await this.request(operation, `${this.options.baseUrl}/api/broadcast/-/-/${encodeURIComponent(roundId)}`, 'application/json')
    if (!got.ok) return got
    const parsed = this.parse(operation, got.value, (v) => obj(v), 'the top-level object')
    if (!parsed.ok) return parsed
    const round = readRoundInfo(parsed.value.round)
    const tour = readTour(parsed.value.tour, parsed.value.group)
    if (!round || !tour) {
      return { ok: false, diagnostic: this.schemaFault(operation, 'This round did not arrive with the round and tournament details this adapter needs.', round ? 'tour' : 'round') }
    }
    const warnings: LiveDiagnostic[] = []
    const raw = Array.isArray(parsed.value.games) ? parsed.value.games : []
    const games: BroadcastGameInfo[] = []
    for (const item of raw) {
      const game = readGame(item, round)
      if (!game) {
        warnings.push(this.fault(operation, 'schema', 'A game in this round could not be read and was left out of the list.', { field: 'games[]' }))
        continue
      }
      games.push(game)
    }
    return { ok: true, value: { round, tour, games, warnings } }
  }

  /** One round's games as a file: `GET /api/broadcast/round/{roundId}.pgn`. One shot, and not for polling. */
  async roundPgn(roundId: string): Promise<Outcome<string>> {
    if (!isId(roundId)) return { ok: false, diagnostic: this.fault(`the PGN of round ${roundId}`, 'schema', 'That is not a Lichess broadcast round id.', { field: 'broadcastRoundId' }) }
    return this.request(
      `the PGN of round ${roundId}`,
      `${this.options.baseUrl}/api/broadcast/round/${encodeURIComponent(roundId)}.pgn?clocks=true&comments=true`,
      'application/x-chess-pgn'
    )
  }

  // ---- the live stream ------------------------------------------------------------------------------------------

  /**
   * Following a round as it is played: `GET /api/stream/broadcast/round/{roundId}.pgn`.
   *
   * The connection is long-lived, so the ordinary request path is not used: this one is not queued behind other
   * requests (it would hold the lane for seven hours), is not de-duplicated, and has an idle timeout rather than a
   * total one. What it does share is the circuit breaker and the rate-limit rule.
   *
   * Reconnecting is bounded and jittered. Unbounded retrying against a provider that has just asked for fewer
   * requests is how a client gets blocked, and a fixed delay is how a hundred clients reconnect in the same
   * millisecond.
   */
  subscribeRound(roundId: string, handlers: SubscribeHandlers, o: { maxReconnects?: number } = {}): RoundSubscription {
    const operation = `the live PGN of round ${roundId}`
    let stopped = false
    let controller: AbortController | null = null
    const stop = (): void => {
      if (stopped) return
      stopped = true
      controller?.abort()
      handlers.onState?.('stopped')
    }
    if (!isId(roundId)) {
      const diagnostic = this.fault(operation, 'schema', 'That is not a Lichess broadcast round id.', { field: 'broadcastRoundId' })
      handlers.onDiagnostic?.(diagnostic)
      handlers.onState?.('failed', diagnostic.message)
      return { stop: () => undefined, done: Promise.resolve() }
    }

    const maxReconnects = o.maxReconnects ?? DEFAULTS.maxReconnects
    const url = `${this.options.baseUrl}/api/stream/broadcast/round/${encodeURIComponent(roundId)}.pgn?clocks=true&comments=true`

    const done = (async () => {
      let attempt = 0
      while (!stopped) {
        const open = this.openUntil - this.now()
        if (open > 0) {
          handlers.onDiagnostic?.(this.fault(operation, 'circuit-open', `Not connecting to Lichess for another ${Math.ceil(open / 1000)} seconds: too many attempts have failed in a row.`))
          await this.sleep(open)
          if (stopped) break
        }
        handlers.onState?.(attempt === 0 ? 'connecting' : 'reconnecting')
        controller = new AbortController()
        const result = await this.readStream(operation, url, roundId, controller, handlers, () => stopped)
        if (stopped) break
        if (result.kind === 'rate-limit') {
          // Honour the documented minute, whatever the backoff would otherwise have said.
          this.openUntil = Math.max(this.openUntil, this.now() + DEFAULTS.rateLimitCooldownMs)
        }
        attempt += 1
        if (attempt > maxReconnects) {
          handlers.onState?.('failed', `Gave up after ${maxReconnects} attempts to follow this round.`)
          handlers.onDiagnostic?.(this.fault(operation, result.kind === 'rate-limit' ? 'rate-limit' : 'network', `This round could not be followed after ${maxReconnects} attempts, so Orbis stopped trying. What is shown is the last that arrived.`))
          return
        }
        const wait = this.backoff(attempt)
        handlers.onState?.('reconnecting', `Reconnecting in ${Math.round(wait / 1000)} seconds (attempt ${attempt} of ${maxReconnects}).`)
        await this.sleep(wait)
      }
    })()

    return { stop, done }
  }

  /** Exponential, capped, and jittered over the whole delay so two clients never line up. */
  private backoff(attempt: number): number {
    const ceiling = Math.min(DEFAULTS.reconnectBaseMs * 2 ** (attempt - 1), DEFAULTS.reconnectMaxMs)
    return Math.round(ceiling * (0.5 + this.random() * 0.5))
  }

  private async readStream(
    operation: string,
    url: string,
    roundId: string,
    controller: AbortController,
    handlers: SubscribeHandlers,
    cancelled: () => boolean
  ): Promise<{ kind: 'ended' | 'rate-limit' | 'failed' }> {
    let idle: ReturnType<typeof setTimeout> | null = null
    /*
     * Whether the silence was ours to call.
     *
     * Aborting a body does not reliably *throw*: depending on the source it may simply finish, and a server closing
     * the connection in the same instant looks identical. Without this flag a connection that went quiet and was
     * cut for it would be reported as a stream that ended normally -- which reads as "the round is over" when what
     * happened is "we stopped hearing anything".
     */
    let idleFired = false
    const resetIdle = (): void => {
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => {
        idleFired = true
        controller.abort()
      }, this.options.idleTimeoutMs)
    }
    const idleFault = (): LiveDiagnostic =>
      this.fault(
        operation,
        'timeout',
        `Nothing arrived from this broadcast for ${Math.round(this.options.idleTimeoutMs / 60_000)} minutes, so the connection was treated as lost.`
      )
    try {
      resetIdle()
      const res = await this.fetchFn(url, { signal: controller.signal, headers: this.headers('application/x-chess-pgn') })
      if (res.status === 429) {
        const body = await res.text().catch(() => '')
        this.recordFailure(DEFAULTS.rateLimitCooldownMs)
        handlers.onDiagnostic?.(this.fault(operation, 'rate-limit', `Lichess asked for fewer requests${describeError(body) ? ` (${describeError(body)})` : ''}. Waiting at least a minute before following this round again.`, { status: 429 }))
        return { kind: 'rate-limit' }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        this.recordFailure()
        handlers.onDiagnostic?.(this.fault(operation, 'http', `Lichess answered ${res.status}${describeError(body) ? `: ${describeError(body)}` : ' and the round could not be followed.'}`, { status: res.status }))
        return { kind: 'failed' }
      }
      if (!res.body) {
        this.recordFailure()
        handlers.onDiagnostic?.(this.fault(operation, 'network', 'Lichess accepted the request but sent no stream to read.'))
        return { kind: 'failed' }
      }

      handlers.onState?.('open')
      const decoder = new TextDecoder()
      let buffer = ''
      let opened = false
      for await (const chunk of chunksOf(res.body)) {
        if (cancelled()) break
        resetIdle()
        buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
        // A refusal can arrive on this endpoint as a JSON body under the PGN content type, so it has to be
        // recognised in the stream rather than inferred from the status alone.
        const stated = describeError(buffer)
        if (stated) {
          this.recordFailure(DEFAULTS.rateLimitCooldownMs)
          handlers.onDiagnostic?.(this.fault(operation, 'rate-limit', `Lichess refused the stream: ${stated}`, { status: res.status }))
          return { kind: 'rate-limit' }
        }
        const { games, rest } = splitPgnGames(buffer)
        buffer = rest
        if (!games.length) continue
        if (!opened) {
          opened = true
          this.recordSuccess()
        }
        const receivedAt = this.now()
        const payloads: LivePayload[] = []
        for (const game of games) {
          const read = payloadsFromPgn(game, { eventId: roundId, receivedAt })
          payloads.push(...read.payloads)
          for (const problem of read.problems) handlers.onDiagnostic?.(problem)
        }
        if (payloads.length) handlers.onPayloads(payloads)
        // A buffer that keeps growing without ever yielding a game means the framing no longer matches what the
        // provider sends. Say so, rather than filling memory for the rest of the tournament.
        if (buffer.length > 4 * 1024 * 1024) {
          handlers.onDiagnostic?.(this.schemaFault(operation, 'The PGN arriving from Lichess no longer breaks into games where this adapter expects it to. The stream was stopped rather than left to grow.', 'pgn framing'))
          return { kind: 'failed' }
        }
      }
      if (idleFired && !cancelled()) {
        this.recordFailure()
        handlers.onDiagnostic?.(idleFault())
        return { kind: 'failed' }
      }
      return { kind: 'ended' }
    } catch (e) {
      if (cancelled()) return { kind: 'ended' }
      const aborted = idleFired || (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError'))
      this.recordFailure()
      handlers.onDiagnostic?.(
        aborted
          ? idleFault()
          : this.fault(operation, 'network', `The connection to this broadcast failed: ${e instanceof Error ? e.message : String(e)}`)
      )
      return { kind: 'failed' }
    } finally {
      if (idle) clearTimeout(idle)
    }
  }
}

/** The one door the rest of Orbis uses. */
export const createLichessBroadcasts = (o: LichessOptions): LichessBroadcasts => new LichessBroadcasts(o)

/**
 * This adapter, wearing the manager's shape.
 *
 * The dependency points this way round on purpose: the manager knows nothing about Lichess, and this function is the
 * only place the two meet. Adding a second provider means writing another one of these, and changing nothing in the
 * manager.
 *
 * A round is the unit of broadcast that is offered as an "event", because a round is what has games in it and what
 * can be streamed. The listing flattens each tournament to its most interesting round -- the one under way, else the
 * next to start, else the last to finish -- because that is the one a person means when they name a tournament.
 */
export function lichessProviderPort(broadcasts: LichessBroadcasts): LiveProviderPort {
  const summarise = (tour: BroadcastTournament, round: BroadcastRoundInfo): LiveEventSummary => ({
    provider: LICHESS,
    eventId: round.id,
    name: tour.name === round.name ? tour.name : `${tour.name} — ${round.name}`,
    status: roundStatus(round),
    ...put('url', round.url ?? tour.url),
    ...put('startsAt', round.startsAt),
    ...put('finishedAt', round.finishedAt),
    ...put('delaySeconds', round.delaySeconds),
    ...put('tournamentName', tour.groupName ?? tour.name),
    ...put('tier', tour.tier)
  })

  /** The round of a tournament a person means: the one on now, else the next one, else the last one. */
  const chosenRound = (rounds: BroadcastRoundInfo[], defaultRoundId?: string): BroadcastRoundInfo | null => {
    if (!rounds.length) return null
    const named = defaultRoundId ? rounds.find((r) => r.id === defaultRoundId) : undefined
    if (named) return named
    return (
      rounds.find((r) => r.ongoing === true && r.finishedAt === undefined) ??
      rounds.filter((r) => r.finishedAt === undefined).sort((a, b) => (a.startsAt ?? Infinity) - (b.startsAt ?? Infinity))[0] ??
      rounds.reduce((latest, r) => ((r.finishedAt ?? 0) > (latest.finishedAt ?? 0) ? r : latest), rounds[0])
    )
  }

  return {
    name: LICHESS,
    async discover(o) {
      const got = await broadcasts.official({ ...(o.max !== undefined ? { max: o.max } : {}), ...(o.onlyLive !== undefined ? { onlyLive: o.onlyLive } : {}) })
      if (!got.ok) return got
      const events: LiveEventSummary[] = []
      for (const entry of got.value.tournaments) {
        const round = chosenRound(entry.rounds, entry.defaultRoundId)
        if (!round) continue
        events.push(summarise(entry.tour, round))
      }
      return { ok: true, value: { events, warnings: got.value.warnings } }
    },
    async games(eventId) {
      const got = await broadcasts.round(eventId)
      if (!got.ok) return got
      const { round, tour, games, warnings } = got.value
      return {
        ok: true,
        value: {
          event: summarise(tour, round),
          games: games.map((g) => ({
            provider: LICHESS,
            providerGameId: g.id,
            eventId: round.id,
            name: g.name,
            white: g.white,
            black: g.black,
            status: g.status,
            result: g.result
          })),
          warnings
        }
      }
    },
    subscribe(eventId, handlers) {
      return broadcasts.subscribeRound(eventId, {
        onPayloads: handlers.onPayloads,
        ...(handlers.onDiagnostic ? { onDiagnostic: handlers.onDiagnostic } : {}),
        ...(handlers.onState ? { onState: handlers.onState } : {})
      })
    }
  }
}

/** A Lichess broadcast id: eight characters of its own alphabet, which its schemas state as minLength/maxLength 8. */
const isId = (value: string): boolean => /^[A-Za-z0-9]{8}$/.test(value ?? '')

/**
 * The provider's own words for a refusal, when its body carries them.
 *
 * Lichess answers `{"error":"..."}`, and does so on endpoints whose content type says PGN, so the body is worth
 * looking at even when the status says the request was fine. Only a body that is *just* an error object counts: a
 * PGN that happens to contain the word error is not a refusal.
 */
export function describeError(body: string): string | null {
  const text = (body ?? '').trim()
  if (!text.startsWith('{') || text.length > 2_000) return null
  try {
    const parsed = JSON.parse(text) as unknown
    const message = obj(parsed)?.error
    return typeof message === 'string' && message.trim() ? message.trim() : null
  } catch {
    return null
  }
}

/** Reads either an async iterable or a web `ReadableStream`, so a real response and a test's generator both fit. */
async function* chunksOf(body: StreamBody): AsyncGenerator<Uint8Array | string> {
  if (Symbol.asyncIterator in body) {
    yield* body as AsyncIterable<Uint8Array | string>
    return
  }
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value !== undefined) yield value
    }
  } finally {
    reader.cancel?.()
  }
}
