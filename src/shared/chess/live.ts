import { START_FEN, checkFen, sideToMove } from './rules.ts'
import { buildMoves, type GameMove, type GameResult, type PlayerInfo } from './model.ts'

/**
 * A game that is being played somewhere else, right now.
 *
 * A broadcast is not an import that happens to be arriving slowly. It is the same game told to us many times, each
 * time a little further on, over a connection that drops, from a provider that may correct itself and that is often
 * deliberately behind the board. Everything in this file exists to keep those four facts from turning into a game
 * nobody actually played (Sections 081-083, 351-358).
 *
 * The rules that hold everywhere below:
 *
 *   - **Nothing is invented.** A clock that was not sent is absent, not zero. A rating that was not sent is absent,
 *     not 0 and not "unrated". A player with no name has no name. A result nobody has announced is `*`.
 *   - **Moves are played, never trusted.** Every move that arrives is replayed through `rules.ts` before it is
 *     believed. A provider sending an impossible move gets a refusal, not a corrupted game.
 *   - **A re-send is not progress.** Most live feeds re-send the whole game every time anything happens, so the
 *     dangerous bug is not losing a move but adding fifty-six of them again. `reconcileSnapshot` is the answer to
 *     that, and it is the single most important function here.
 *   - **A shown value says where it came from.** A clock that was received and a clock that this computer worked out
 *     by subtracting are different things, and a screen that cannot tell them apart will present a guess as a fact.
 *
 * There is deliberately no network, no timer and no provider in this file. It takes payloads and returns records, so
 * every rule above can be tested without a tournament being on.
 */

/** Where a game is in its life, as far as anyone has told us. `unknown` is a real answer and is used. */
export type LiveStatus = 'scheduled' | 'live' | 'finished' | 'unknown'

/**
 * What went wrong, in a shape code can branch on and a person can read.
 *
 * It lives here, with the model, rather than in any one provider's adapter, so that the manager can report a fault
 * without knowing which provider produced it and an adapter can report one without knowing who is listening.
 *
 * `schema` is deliberately its own kind. It is the only fault that means "a provider changed and this needs a
 * person" rather than "try again shortly", and a provider that has quietly changed shape will otherwise look exactly
 * like a provider having a bad afternoon, for as long as nobody checks.
 */
export type DiagnosticKind =
  | 'http'
  | 'rate-limit'
  | 'schema'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'circuit-open'
  | 'pgn'
  | 'refused'

export interface LiveDiagnostic {
  provider: string
  /** Which call, in words: "official broadcasts", "round GSmX7fQ2", "the live PGN of round GSmX7fQ2". */
  operation: string
  kind: DiagnosticKind
  /** Said plainly, for a person reading a panel or a log. */
  message: string
  /** The field that did not look as documented, on a schema fault. */
  field?: string
  status?: number
  at: number
}

/** Either the answer, or a fault that says what happened. Nothing in between, and never a half-answer. */
export type LiveOutcomeOf<T> = { ok: true; value: T } | { ok: false; diagnostic: LiveDiagnostic }

/** How old what is on screen is. `delayed` is not a fault: a broadcast may be embargoed on purpose. */
export type Freshness = 'live' | 'delayed' | 'stale' | 'unknown'

/** A move as a provider wrote it, before it has been played. The shape `buildMoves` takes. */
export interface WrittenMove {
  san: string
  comment?: string
  nag?: string[]
  /** Seconds left after the move, when the source said. */
  clock?: number
}

/**
 * The clocks, as received.
 *
 * `at` is when this reading was taken, and it is not decoration: without it a clock cannot be shown honestly a minute
 * later. Both sides are optional because providers routinely give one, neither, or both.
 */
export interface LiveClocks {
  /** Seconds remaining. */
  white?: number
  black?: number
  at: number
}

/**
 * One live game, normalised.
 *
 * `eventId` is the tournament or round the game belongs to. `lastEventId` is something else entirely -- the provider's
 * own id for the last delivery we accepted, used to recognise a repeat. They are easy to confuse and mean nothing
 * like each other.
 */
export interface LiveGameRecord {
  /** Orbis's own name for this game: `provider:providerGameId`. */
  id: string
  provider: string
  providerGameId: string
  /** The round or tournament this game is part of, in the provider's terms. */
  eventId: string
  eventName?: string
  round?: string
  white: PlayerInfo
  black: PlayerInfo
  startFen: string
  moves: GameMove[]
  status: LiveStatus
  result: GameResult
  /** Present only when a source actually sent clocks. */
  clocks?: LiveClocks
  /** The provider's own time for this data, when it supplies one. Most PGN feeds do not. */
  sourceTimestamp?: number
  /** When this computer received it. Always known, because we were there. */
  receivedAt: number
  /** The provider's id for the last delivery accepted, when the provider has such ids. */
  lastEventId?: string
}

/**
 * What a provider hands over for one game, once it has been read out of whatever the provider actually sent.
 *
 * `kind` is the field that matters most. A `snapshot` carries the whole game from its start; an `update` carries only
 * what is new. Getting this wrong in an adapter is how a game ends up with every move twice, so a provider that
 * re-sends whole games must say `snapshot` -- and `applyLiveUpdate` guards against the mistake anyway.
 */
export interface LivePayload {
  provider: string
  providerGameId: string
  eventId: string
  eventName?: string
  round?: string
  white?: PlayerInfo
  black?: PlayerInfo
  /** Where the game starts. Left out means the ordinary starting position. */
  startFen?: string
  moves: WrittenMove[]
  kind: 'snapshot' | 'update'
  /** What the provider says about the game's state, when it says anything. */
  status?: LiveStatus
  result?: GameResult
  /** Seconds remaining, as sent. Left out stays out. */
  clocks?: { white?: number; black?: number }
  sourceTimestamp?: number
  receivedAt: number
  /** The provider's own id for this delivery. Providers without one leave it out, and content is compared instead. */
  deliveryId?: string
  /** A counter the provider promises only ever goes up. Providers without one leave it out. */
  sequence?: number
}

/** Why a payload could not be believed. */
export type LiveProblem =
  | 'empty'
  | 'wrong-game'
  | 'bad-start-position'
  | 'illegal-move'
  | 'start-position-changed'

/**
 * What ingesting a payload did.
 *
 *   - `created`      first time this game has been seen.
 *   - `advanced`     something genuinely new: moves, or the game finishing.
 *   - `unchanged`    the payload said only what we already knew.
 *   - `duplicate`    this exact delivery had already been applied.
 *   - `out-of-order` the payload is older than what we hold, and was ignored.
 *   - `corrected`    the provider changed something it had already published.
 *   - `refused`      the payload could not be believed; nothing changed.
 */
export type LiveOutcome = 'created' | 'advanced' | 'unchanged' | 'duplicate' | 'out-of-order' | 'corrected' | 'refused'

/**
 * A game plus the bookkeeping that decides what may be done to it.
 *
 * The bookkeeping is kept beside the record rather than inside it so that what gets stored, shown and exported stays
 * exactly a game, with no feed plumbing smuggled into it.
 */
export interface LiveGameState {
  record: LiveGameRecord
  /** Delivery ids already applied, oldest first. Bounded, because a round can run for seven hours. */
  seen: readonly string[]
  /** The highest sequence accepted so far, when the provider supplies sequences. */
  sequence?: number
}

export interface LiveApplyResult {
  outcome: LiveOutcome
  /** The state afterwards. On `refused`, `duplicate` and `out-of-order` this is the state unchanged. */
  state: LiveGameState
  /** How many moves were genuinely added. */
  added: number
  /** Said plainly, for a person or a log: what happened and why. */
  note?: string
  problem?: LiveProblem
  /** On a correction of the moves: the ply at which the provider's line stopped agreeing with ours. */
  divergedAt?: number
}

/** How many delivery ids are remembered for spotting a repeat. */
const SEEN_LIMIT = 128

export const liveIdOf = (provider: string, providerGameId: string): string => `${provider}:${providerGameId}`

const trimmed = (value: string | undefined, max: number): string | undefined => {
  const text = (value ?? '').trim()
  return text ? text.slice(0, max) : undefined
}

/**
 * A player, with only what was actually supplied.
 *
 * "?" is how PGN says it does not know, and several feeds pass it straight through. It is not a name, a title is not
 * "-", and a rating of 0 is not a rating.
 */
export function normalisePlayer(raw: PlayerInfo | undefined): PlayerInfo {
  const info: PlayerInfo = {}
  const name = trimmed(raw?.name, 120)
  if (name && name !== '?') info.name = name
  if (typeof raw?.rating === 'number' && Number.isFinite(raw.rating) && raw.rating > 0) info.rating = Math.round(raw.rating)
  const title = trimmed(raw?.title, 12)
  if (title && title !== '-' && title !== '?') info.title = title
  return info
}

const RESULTS = new Set<GameResult>(['1-0', '0-1', '1/2-1/2', '*'])
const asResult = (value: unknown): GameResult => (RESULTS.has(value as GameResult) ? (value as GameResult) : '*')
const decided = (result: GameResult): boolean => result !== '*'

/**
 * Where a game is, from what is known rather than from what would look tidy.
 *
 * A decided result settles it: a game with a result is over whatever a stale status field claims. Beyond that the
 * provider is believed if it said anything, moves mean it has started, and nothing known means `unknown` -- not
 * `scheduled`, which would be a guess about a game that may well be finished.
 */
export function statusFrom(o: { status?: LiveStatus; result: GameResult; moves: number }): LiveStatus {
  if (decided(o.result)) return 'finished'
  if (o.status && o.status !== 'finished') return o.status
  if (o.status === 'finished') return 'finished'
  if (o.moves > 0) return 'live'
  return 'unknown'
}

/** The position a game currently stands in. */
export const currentFen = (record: Pick<LiveGameRecord, 'startFen' | 'moves'>): string =>
  record.moves.length ? record.moves[record.moves.length - 1].fen : record.startFen

const clocksFrom = (payload: LivePayload): LiveClocks | undefined => {
  const white = payload.clocks?.white
  const black = payload.clocks?.black
  const ok = (v: number | undefined): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0
  if (!ok(white) && !ok(black)) return undefined
  return {
    ...(ok(white) ? { white: white as number } : {}),
    ...(ok(black) ? { black: black as number } : {}),
    at: payload.receivedAt
  }
}

const remember = (seen: readonly string[], deliveryId: string | undefined): readonly string[] => {
  if (!deliveryId) return seen
  const next = [...seen.filter((id) => id !== deliveryId), deliveryId]
  return next.length > SEEN_LIMIT ? next.slice(next.length - SEEN_LIMIT) : next
}

/**
 * The first payload for a game: a record, or a refusal that says which part could not be believed.
 *
 * The moves are played here, not stored as written. A feed can be perfectly well formed and contain a move that
 * cannot be made -- an operator mis-keying an entry does exactly that -- and the two are different problems a person
 * needs told apart (Section 401).
 */
export function normaliseLiveGame(payload: LivePayload): { ok: true; state: LiveGameState } | { ok: false; problem: LiveProblem; reason: string } {
  if (!payload.provider.trim() || !payload.providerGameId.trim()) {
    return { ok: false, problem: 'empty', reason: 'This update does not say which game it is about.' }
  }
  const startFen = payload.startFen?.trim() || START_FEN
  const check = checkFen(startFen)
  if (!check.ok) {
    return { ok: false, problem: 'bad-start-position', reason: check.reason ?? 'The starting position is not one that can be played.' }
  }
  const built = buildMoves(startFen, payload.moves)
  if (!built.ok) {
    const at = built.failedAt
    return {
      ok: false,
      problem: 'illegal-move',
      reason: at
        ? `Move ${Math.floor(at.index / 2) + 1}${at.index % 2 === 0 ? '' : '…'} "${at.move}" cannot be played in the position it reaches, so this game was not accepted.`
        : 'A move in this game could not be played, so the game was not accepted.'
    }
  }
  const result = asResult(payload.result)
  const clocks = clocksFrom(payload)
  const record: LiveGameRecord = {
    id: liveIdOf(payload.provider, payload.providerGameId),
    provider: payload.provider,
    providerGameId: payload.providerGameId,
    eventId: payload.eventId,
    ...(trimmed(payload.eventName, 240) ? { eventName: trimmed(payload.eventName, 240) as string } : {}),
    ...(trimmed(payload.round, 120) ? { round: trimmed(payload.round, 120) as string } : {}),
    white: normalisePlayer(payload.white),
    black: normalisePlayer(payload.black),
    startFen,
    moves: built.moves,
    status: statusFrom({ ...(payload.status ? { status: payload.status } : {}), result, moves: built.moves.length }),
    result,
    ...(clocks ? { clocks } : {}),
    ...(payload.sourceTimestamp !== undefined ? { sourceTimestamp: payload.sourceTimestamp } : {}),
    receivedAt: payload.receivedAt,
    ...(payload.deliveryId ? { lastEventId: payload.deliveryId } : {})
  }
  return {
    ok: true,
    state: {
      record,
      seen: remember([], payload.deliveryId),
      ...(payload.sequence !== undefined ? { sequence: payload.sequence } : {})
    }
  }
}

/** The payload is about the game we are holding. A manager with a bug could hand over somebody else's. */
const sameGame = (state: LiveGameState, payload: LivePayload): boolean =>
  state.record.provider === payload.provider && state.record.providerGameId === payload.providerGameId

const unchanged = (state: LiveGameState, outcome: LiveOutcome, note?: string): LiveApplyResult => ({
  outcome,
  state,
  added: 0,
  ...(note ? { note } : {})
})

/**
 * The checks every payload faces before anything is believed, whatever kind it is.
 *
 * Returns a finished result when the payload must not be applied, and null when it may be.
 */
function guard(state: LiveGameState, payload: LivePayload): LiveApplyResult | null {
  if (!sameGame(state, payload)) {
    return {
      outcome: 'refused',
      state,
      added: 0,
      problem: 'wrong-game',
      note: 'This update is about a different game, so it was not applied.'
    }
  }
  // A repeat of a delivery we have already applied. Feeds re-send on reconnect, and a proxy may simply send twice.
  if (payload.deliveryId && state.seen.includes(payload.deliveryId)) {
    return unchanged(state, 'duplicate', 'This update had already been applied.')
  }
  // A provider that promises a counter is held to it: anything older than what we have accepted is thrown away.
  if (payload.sequence !== undefined && state.sequence !== undefined && payload.sequence < state.sequence) {
    return unchanged(
      state,
      'out-of-order',
      `This update is older than what is already shown (${payload.sequence} behind ${state.sequence}), so it was ignored.`
    )
  }
  if (payload.startFen && payload.startFen.trim() !== state.record.startFen) {
    return {
      outcome: 'refused',
      state,
      added: 0,
      problem: 'start-position-changed',
      note: 'This update starts the game from a different position than the one already being followed, so it was not applied.'
    }
  }
  return null
}

/** Everything about a record that a payload may legitimately refresh without touching the moves. */
function withMeta(record: LiveGameRecord, payload: LivePayload, moves: GameMove[], result: GameResult): LiveGameRecord {
  const clocks = clocksFrom(payload)
  const white = normalisePlayer(payload.white)
  const black = normalisePlayer(payload.black)
  return {
    ...record,
    // Names and ratings are merged rather than replaced: a feed that stops sending a rating has not withdrawn it,
    // and blanking a name because one delivery omitted it would make the board flicker between known and unknown.
    white: { ...record.white, ...white },
    black: { ...record.black, ...black },
    ...(trimmed(payload.eventName, 240) ? { eventName: trimmed(payload.eventName, 240) as string } : {}),
    ...(trimmed(payload.round, 120) ? { round: trimmed(payload.round, 120) as string } : {}),
    moves,
    result,
    status: statusFrom({ ...(payload.status ? { status: payload.status } : {}), result, moves: moves.length }),
    // Clocks are replaced, never merged: a reading belongs to the moment it was taken, and pairing a fresh white
    // clock with a black one from four moves ago would read as a position neither player was ever in.
    ...(clocks ? { clocks } : record.clocks ? { clocks: record.clocks } : {}),
    ...(payload.sourceTimestamp !== undefined ? { sourceTimestamp: payload.sourceTimestamp } : {}),
    receivedAt: payload.receivedAt,
    ...(payload.deliveryId ? { lastEventId: payload.deliveryId } : {})
  }
}

const settled = (state: LiveGameState, payload: LivePayload, moves: GameMove[], result: GameResult, outcome: LiveOutcome, added: number, extra: { note?: string; divergedAt?: number } = {}): LiveApplyResult => ({
  outcome,
  state: {
    record: withMeta(state.record, payload, moves, result),
    seen: remember(state.seen, payload.deliveryId),
    ...(payload.sequence !== undefined ? { sequence: payload.sequence } : state.sequence !== undefined ? { sequence: state.sequence } : {})
  },
  added,
  ...(extra.note ? { note: extra.note } : {}),
  ...(extra.divergedAt !== undefined ? { divergedAt: extra.divergedAt } : {})
})

/**
 * Whether a result has been changed rather than merely announced.
 *
 * `*` becoming `1-0` is a game ending, which is ordinary progress. `1-0` becoming `1/2-1/2` is an arbiter overruling
 * something already published, which is a different event and must be visible as one (Section 356).
 */
const resultCorrected = (was: GameResult, now: GameResult): boolean => decided(was) && decided(now) && was !== now

/**
 * A snapshot -- the whole game as the provider currently has it -- reconciled against what we hold.
 *
 * This is the function the rest of the feed is built on, because the shape of nearly every live chess feed is "here
 * is the entire game again". Replaying such a snapshot as new moves is the defining bug of live ingestion: it
 * doubles the game, breaks every move number on screen, and looks at first glance like the feed working.
 *
 * So the snapshot's line is compared against ours move by move, and exactly one of four things is true:
 *
 *   - it extends ours            -> only the moves past the end of ours are added;
 *   - it is the same as ours     -> nothing is added, and the clocks and result are still refreshed;
 *   - it is shorter than ours and agrees as far as it goes -> it is an older copy, and is thrown away;
 *   - it disagrees with ours somewhere -> the provider has corrected itself, and the correction is taken from the
 *     point they stop agreeing, which is the only honest option once a published move turns out to be wrong.
 *
 * Reconnecting after a dropped connection is the same path: the feed re-sends everything, this adds only the moves
 * that were played while we were away, and no move is counted twice.
 */
export function reconcileSnapshot(state: LiveGameState, payload: LivePayload): LiveApplyResult {
  const blocked = guard(state, payload)
  if (blocked) return blocked

  const built = buildMoves(state.record.startFen, payload.moves)
  if (!built.ok) {
    const at = built.failedAt
    return {
      outcome: 'refused',
      state,
      added: 0,
      problem: 'illegal-move',
      note: at
        ? `"${at.move}" cannot be played in the position it reaches, so this update was not applied and the game is unchanged.`
        : 'A move in this update could not be played, so the game is unchanged.'
    }
  }

  const ours = state.record.moves
  const theirs = built.moves
  const shared = Math.min(ours.length, theirs.length)
  let diverged = -1
  for (let i = 0; i < shared; i++) {
    if (ours[i].uci !== theirs[i].uci) { diverged = i; break }
  }
  const result = payload.result === undefined ? state.record.result : asResult(payload.result)

  if (diverged >= 0) {
    return settled(state, payload, theirs, result, 'corrected', Math.max(0, theirs.length - diverged), {
      divergedAt: diverged,
      note: `The provider has changed move ${Math.floor(diverged / 2) + 1}${diverged % 2 === 0 ? '' : '…'} and everything after it. What is shown now follows their corrected game.`
    })
  }

  if (theirs.length < ours.length) {
    // Agrees with us as far as it goes, but stops earlier: an older copy of a game we are already further through.
    return unchanged(
      state,
      'out-of-order',
      `This update holds ${theirs.length} moves where ${ours.length} are already known, and agrees as far as it goes, so it is an older copy and was ignored.`
    )
  }

  const added = theirs.length - ours.length
  if (added > 0) {
    return settled(state, payload, theirs, result, 'advanced', added)
  }
  // Same moves. Still not nothing: the result may have been announced or corrected, and the clocks may have moved.
  if (resultCorrected(state.record.result, result)) {
    return settled(state, payload, theirs, result, 'corrected', 0, {
      note: `The result was corrected from ${state.record.result} to ${result}.`
    })
  }
  if (result !== state.record.result) {
    return settled(state, payload, theirs, result, 'advanced', 0, { note: `The game finished: ${result}.` })
  }
  return settled(state, payload, theirs, result, 'unchanged', 0)
}

/**
 * An incremental update -- only the moves that are new -- applied to what we hold.
 *
 * Providers that genuinely send deltas are served here. There is one guard that matters: if the "update" turns out to
 * restate the game from its beginning, it is handed to `reconcileSnapshot` instead of appended. An adapter labelling
 * a whole-game re-send as an update is a mistake somebody will make, and the cost of it is a game with every move
 * twice, so it is caught here rather than trusted not to happen.
 */
export function applyLiveUpdate(state: LiveGameState, payload: LivePayload): LiveApplyResult {
  const blocked = guard(state, payload)
  if (blocked) return blocked

  const ours = state.record.moves
  if (!payload.moves.length) {
    const result = payload.result === undefined ? state.record.result : asResult(payload.result)
    if (resultCorrected(state.record.result, result)) {
      return settled(state, payload, ours, result, 'corrected', 0, { note: `The result was corrected from ${state.record.result} to ${result}.` })
    }
    if (result !== state.record.result) {
      return settled(state, payload, ours, result, 'advanced', 0, { note: `The game finished: ${result}.` })
    }
    return settled(state, payload, ours, result, 'unchanged', 0)
  }

  // The whole-game-re-send guard. If these moves can be played from the start AND our line is a prefix of them or
  // disagrees with them, this is a snapshot wearing the wrong label.
  if (ours.length) {
    const fromStart = buildMoves(state.record.startFen, payload.moves)
    if (fromStart.ok && fromStart.moves.length >= ours.length && fromStart.moves[0].uci === ours[0].uci) {
      return reconcileSnapshot(state, { ...payload, kind: 'snapshot' })
    }
  }

  const built = buildMoves(currentFen(state.record), payload.moves)
  if (!built.ok) {
    const at = built.failedAt
    return {
      outcome: 'refused',
      state,
      added: 0,
      problem: 'illegal-move',
      note: at
        ? `"${at.move}" cannot be played in the position the game currently stands in, so nothing was added. The game may have moved on without us; a full update will settle it.`
        : 'A move in this update could not be played from the current position, so nothing was added.'
    }
  }
  const result = payload.result === undefined ? state.record.result : asResult(payload.result)
  const moves = [...ours, ...built.moves]
  if (resultCorrected(state.record.result, result)) {
    return settled(state, payload, moves, result, 'corrected', built.moves.length, {
      note: `The result was corrected from ${state.record.result} to ${result}.`
    })
  }
  return settled(state, payload, moves, result, 'advanced', built.moves.length)
}

/** The one door the manager uses: dispatches on what the payload says it is. */
export function ingestLivePayload(state: LiveGameState | null, payload: LivePayload): LiveApplyResult {
  if (!state) {
    const made = normaliseLiveGame(payload)
    if (!made.ok) {
      return {
        outcome: 'refused',
        state: { record: emptyRecord(payload), seen: [] },
        added: 0,
        problem: made.problem,
        note: made.reason
      }
    }
    return { outcome: 'created', state: made.state, added: made.state.record.moves.length }
  }
  return payload.kind === 'snapshot' ? reconcileSnapshot(state, payload) : applyLiveUpdate(state, payload)
}

/**
 * A placeholder record for a payload that could not be made into a game.
 *
 * It exists so a refusal has something to carry without the caller having to handle a null, and it holds no moves and
 * no result -- it never pretends to be a game that was accepted. `status` is `unknown`, which is exactly true.
 */
function emptyRecord(payload: LivePayload): LiveGameRecord {
  return {
    id: liveIdOf(payload.provider, payload.providerGameId),
    provider: payload.provider,
    providerGameId: payload.providerGameId,
    eventId: payload.eventId,
    white: {},
    black: {},
    startFen: START_FEN,
    moves: [],
    status: 'unknown',
    result: '*',
    receivedAt: payload.receivedAt
  }
}

/**
 * How behind a provider's data is allowed to be before what is on screen stops deserving the word "live".
 *
 * These are per-provider because the honest number depends entirely on what is being broadcast. The trap worth
 * naming: a classical game is allowed to send nothing for twenty minutes, because a player is allowed to think for
 * twenty minutes. A threshold tight enough to catch a broken feed would therefore call a perfectly healthy broadcast
 * stale every time somebody had a long think, so these windows are generous and the question "is the connection up?"
 * is answered separately, by the manager, which actually knows.
 */
export interface FreshnessWindow {
  /** Data newer than this is live. */
  liveMs: number
  /** Data newer than this, but not live, is merely behind. Beyond it, it is stale. */
  delayedMs: number
}

export const FRESHNESS_WINDOWS: Record<string, FreshnessWindow> = {
  // Lichess broadcasts carry classical games, where a quarter of an hour between moves is ordinary.
  lichess: { liveMs: 15 * 60_000, delayedMs: 60 * 60_000 },
  default: { liveMs: 5 * 60_000, delayedMs: 30 * 60_000 }
}

export const freshnessWindow = (provider: string): FreshnessWindow => FRESHNESS_WINDOWS[provider] ?? FRESHNESS_WINDOWS.default

/**
 * How old what is being shown is.
 *
 * `sourceTimestamp` is preferred when a provider gives one, because it is the provider's own account of when the data
 * was true; `receivedAt` is the fallback and means "when we last heard anything about this game". With neither, the
 * answer is `unknown` -- which is a real answer and much better than calling an unknown age live.
 *
 * `delaySeconds` is the embargo a provider declares on itself. A broadcast deliberately held ten minutes behind the
 * board can never be called live, however promptly the delayed data reaches us, so a declared delay caps the answer
 * at `delayed`. Saying "live" over an embargoed feed would be a lie told by arithmetic.
 */
export function freshness(o: { sourceTimestamp?: number; receivedAt?: number; now: number; provider: string; delaySeconds?: number }): Freshness {
  if (!Number.isFinite(o.now)) return 'unknown'
  const usable = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  const stamp = usable(o.sourceTimestamp) ? o.sourceTimestamp : usable(o.receivedAt) ? o.receivedAt : undefined
  if (stamp === undefined) return 'unknown'
  // A stamp in the future is a clock disagreeing, not data from the future. Treat it as brand new rather than
  // letting a negative age sail past every threshold.
  const age = Math.max(0, o.now - stamp)
  const window = freshnessWindow(o.provider)
  const delay = typeof o.delaySeconds === 'number' && Number.isFinite(o.delaySeconds) && o.delaySeconds > 0 ? o.delaySeconds * 1000 : 0
  if (age <= window.liveMs + delay) return delay > 0 ? 'delayed' : 'live'
  if (age <= window.delayedMs + delay) return 'delayed'
  return 'stale'
}

/** Freshness said in words, for a label that has to explain itself. */
export function describeFreshness(state: Freshness, o: { delaySeconds?: number } = {}): string {
  const embargo = typeof o.delaySeconds === 'number' && o.delaySeconds > 0 ? Math.round(o.delaySeconds / 60) : 0
  switch (state) {
    case 'live':
      return 'Live. Moves are arriving as they are played.'
    case 'delayed':
      return embargo
        ? `Delayed on purpose. This broadcast is published about ${embargo} minute${embargo === 1 ? '' : 's'} behind the board.`
        : 'Behind the board. The last update was a while ago, so the position may have moved on.'
    case 'stale':
      return 'Out of date. Nothing has arrived for a long time, so treat this as the last thing known rather than the current position.'
    default:
      return 'Not known how current this is.'
  }
}

/** Where a shown clock came from. The distinction exists so a worked-out value is never presented as a reading. */
export type ClockOrigin = 'received' | 'extrapolated'

export interface ClockReading {
  /** Seconds remaining, never below zero. */
  seconds: number
  origin: ClockOrigin
}

export interface ClockDisplay {
  white: ClockReading | null
  black: ClockReading | null
  /** When the reading all of this is based on was taken, or null when there is no reading at all. */
  at: number | null
  /** True when any shown value was worked out here rather than received. */
  anyExtrapolated: boolean
}

const NOTHING: ClockDisplay = { white: null, black: null, at: null, anyExtrapolated: false }

/**
 * The clocks as they should go on screen.
 *
 * Only one clock is running at a time, so only the side to move may be counted down, and only from a reading that
 * actually exists. Everything else is shown exactly as received. Four cases are deliberately refused:
 *
 *   - no clocks were ever sent    -> nothing is shown. A blank clock is honest; a zero is a claim.
 *   - the game is over            -> the clocks stopped when it did, so neither side is counted down.
 *   - the reading is in the future -> clocks disagree; nothing is counted down rather than counted up.
 *   - the side to move has no reading -> that side stays blank, and the other side is still shown as received.
 *
 * Counting down stops at zero. A negative clock would say a flag fell, which is a claim about the game that only an
 * arbiter can make -- and a player whose clock reads zero here may well have moved already, with the move still on
 * its way to us (Section 357).
 */
export function clockDisplay(o: { record: Pick<LiveGameRecord, 'startFen' | 'moves' | 'clocks' | 'status'>; now: number; extrapolate?: boolean }): ClockDisplay {
  const clocks = o.record.clocks
  if (!clocks) return NOTHING
  const received = (v: number | undefined): ClockReading | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? { seconds: v, origin: 'received' } : null
  const white = received(clocks.white)
  const black = received(clocks.black)
  if (!white && !black) return NOTHING
  const plain: ClockDisplay = { white, black, at: clocks.at, anyExtrapolated: false }

  if (o.extrapolate === false) return plain
  if (o.record.status === 'finished' || o.record.status === 'scheduled') return plain
  if (!Number.isFinite(o.now) || o.now <= clocks.at) return plain

  const turn = sideToMove(currentFen(o.record))
  const running = turn === 'w' ? white : black
  if (!running) return plain
  const elapsed = (o.now - clocks.at) / 1000
  const counted: ClockReading = { seconds: Math.max(0, running.seconds - elapsed), origin: 'extrapolated' }
  return {
    white: turn === 'w' ? counted : white,
    black: turn === 'w' ? black : counted,
    at: clocks.at,
    anyExtrapolated: true
  }
}
