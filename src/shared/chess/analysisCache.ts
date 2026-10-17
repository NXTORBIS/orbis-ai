import { positionKey } from './rules.ts'
import type { Score } from './evaluation.ts'

/**
 * Keeping the engine's answers, so the same position is not searched twice.
 *
 * Every analysis in Chess World used to cost a fresh search. Open a game, step forward, step back, and the position
 * you came from is calculated again from nothing -- the same engine, the same position, the same answer, two seconds
 * of fan noise. This is where an answer is kept so the second ask is free.
 *
 * It is a cache of *engine answers*, which makes it the one store in Chess World holding nothing a person wrote.
 * That is why it is allowed to be thrown away and rebuilt, and why nothing in here is ever the only copy of
 * anything. It is also why every rule below is about refusing to reuse rather than about reusing: a search that was
 * never run is a cost, and a search reported as something it was not is a wrong answer.
 *
 * ## The four refusals this is built on
 *
 * **A shallow answer is not a deep one.** Somebody asking for depth 30 and being handed a depth-12 evaluation has
 * been given a wrong answer quickly, which is worse than a right answer slowly. Every comparison below is between
 * what was *measured* -- the depth reached, the positions counted, the seconds that really passed -- and what was
 * asked for, in the same unit. Two limits of different kinds are never put on one scale, exactly as `comparable` in
 * `evaluation.ts` refuses to weigh a forced mate against a number of pawns.
 *
 * **An answer with no provenance is worthless.** An evaluation on its own is a number. An evaluation that says
 * which engine, which version, which binary, what it was asked for, how deep it got, how long it took and whether it
 * finished is a fact that can be checked, shown, and refused. Everything in `CachedAnalysis` below is there because
 * without it the entry could not be judged.
 *
 * **A different engine is a different answer.** A new version of the engine, a different binary at the same path, or
 * an option that changes what the search does, all mean the stored answer belongs to a question nobody asked. Those
 * go into the key, so the old answers sit beside the new ones rather than being confused with them, and the cleanup
 * removes them in its own time instead of one global wipe.
 *
 * **Position is not history.** The key names the position -- the pieces, the side to move, the castling rights, the
 * en-passant square -- through `positionKey` in `rules.ts`, which is the one place that decides what makes two boards
 * the same question. Nothing in here ever decides a draw by repetition or by the fifty-move rule: those depend on how
 * the game got here, `outcome` in `rules.ts` works them out from the move list, and a cached position answer has no
 * move list. The halfmove clock is the one piece of history that reaches a search, and it is handled explicitly
 * below.
 *
 * ## What is kept here, and what needs the whole game
 *
 * `POSITION_FIELDS` and `NEEDS_GAME` below are that split, written down as data so a screen can print it. The short
 * version: what the engine thinks of a position travels between games, and everything that depends on how the game
 * reached the position does not.
 */

// ---------------------------------------------------------------- the shape of an answer

/** Bumped when a stored entry's shape changes in a way that makes an older one unusable. */
export const CACHE_SCHEMA = 1

export interface AskLimits {
  /** Milliseconds to think for. */
  movetime?: number
  depth?: number
  nodes?: number
}

/**
 * Which engine produced an answer.
 *
 * `name` is what the engine called itself during its handshake, which is a claim it made. `version` is the release
 * tag Orbis downloaded and `build` is the binary on disk, which are facts Orbis established. The comparison below is
 * made on the facts, and the claim is kept only so a screen can show it -- an engine that reports its name
 * differently between two runs must not empty the cache.
 */
export interface EngineIdentity {
  name: string | null
  version: string | null
  /** The binary, as near as it can be told apart: where it is and how big it is. */
  build: string | null
  /** The options really set on it, after clamping. Everything, not just the ones that matter. */
  applied: Readonly<Record<string, string>>
}

/** Position-only, or one position inside a sweep through a whole game. Provenance, never part of the key. */
export type AnalysisScope = 'position' | 'game-sweep'

export interface AnalysisAsk {
  fen: string
  limits: AskLimits
  /** How many lines are wanted. */
  lines: number
  /** `standard` unless the game says otherwise. A variant's answers never mix with standard chess's. */
  variant: string
  engine: EngineIdentity
  scope: AnalysisScope
}

export interface CachedLine {
  multipv: number
  score: Score
  depth: number | null
  seldepth: number | null
  nodes: number | null
  timeMs: number | null
  bound: 'lower' | 'upper' | null
  /** The engine's own coordinates. Notation is worked out again from the position when the line is shown, so the
   * rules are read in one place rather than stored twice and allowed to drift. */
  pvUci: readonly string[]
}

export interface CachedAnalysis {
  schema: number
  /** Everything that makes two answers answers to the same question. Built by `keyFor`. */
  bucket: string
  /** The same, plus what was asked for: two asks with the same `request` are one question asked twice. */
  request: string
  /** The position exactly as it was searched, so nothing has to be rebuilt to show the line. */
  fen: string
  /** `positionKey(fen)`: what is indexed, and what makes a lookup able to explain itself. */
  position: string
  /** The halfmove clock the search ran with. See `clockMatters` for when it is part of the question. */
  halfmove: number
  variant: string
  engineName: string | null
  engineVersion: string | null
  engineBuild: string | null
  /** The options that went into the key, in the key's own spelling. */
  options: string
  /** What was asked for, which is not what was reached. */
  asked: AskLimits
  askedLines: number
  scope: AnalysisScope
  // ---- what was really reached. Measured. A figure the engine never reported is null, never 0.
  score: Score
  depth: number | null
  seldepth: number | null
  nodes: number | null
  /** What the engine said the search took. Its own clock, at the moment it printed the line. */
  timeMs: number | null
  /** What Orbis measured from asking to answering. The one that is compared with a time limit. */
  elapsedMs: number | null
  bound: 'lower' | 'upper' | null
  bestmove: string | null
  pvUci: readonly string[]
  lines: readonly CachedLine[]
  /** `complete` only when the engine answered with a move of its own accord. */
  status: 'complete' | 'cancelled' | 'failed'
  /** Why it stopped, when it did not finish. Null when it did. */
  stoppedBecause: string | null
  /** Said plainly when the answer could not be used as the engine gave it. The engine's note, not this file's. */
  note: string | null
  /** Said plainly when this entry was cut down to fit. Kept apart from `note` so neither rewrites the other. */
  trimmedBecause: string | null
  createdAt: number
  lastUsedAt: number
  /** How many asks this entry has answered. Counted. */
  uses: number
  /** Kept out of eviction because somebody asked for it to be. */
  pinned: boolean
  /** How much room this takes, in bytes of stored text. Measured at write time, never estimated. */
  bytes: number
}

// ---------------------------------------------------------------- what travels, and what does not

/** What the engine thinks of a position, which is the same whichever game reached it. */
export const POSITION_FIELDS: readonly { field: string; plain: string }[] = Object.freeze([
  Object.freeze({ field: 'score', plain: 'How much better one side stands, or a forced mate.' }),
  Object.freeze({ field: 'depth', plain: 'How many moves ahead the engine really looked.' }),
  Object.freeze({ field: 'bestmove', plain: 'The move the engine would play here.' }),
  Object.freeze({ field: 'lines', plain: 'The best lines it found, in its own coordinates.' }),
  Object.freeze({ field: 'nodes', plain: 'How many positions it counted.' })
])

/**
 * What a position answer can never say, because the answer to it depends on how the game got here.
 *
 * This is the list that stops a cache becoming a lie. A position reached twice in two games has one evaluation and
 * two sets of everything below.
 */
export const NEEDS_GAME: readonly { field: string; plain: string }[] = Object.freeze([
  Object.freeze({ field: 'repetition', plain: 'Whether this position has been reached before in this game.' }),
  Object.freeze({ field: 'fifty-move', plain: 'Whether a draw can be claimed, which counts the moves since the last capture or pawn move.' }),
  Object.freeze({ field: 'move quality', plain: 'Whether a move was a mistake, which compares this position with the one before it.' }),
  Object.freeze({ field: 'annotations', plain: "Anybody's note on the move, which belongs to their game." }),
  Object.freeze({ field: 'players and result', plain: 'Who played it and how it ended.' }),
  Object.freeze({ field: 'clock', plain: 'How much time was left, which is a fact about one game.' })
])

// ---------------------------------------------------------------- the key

/**
 * Options that change only how fast the search runs or how it is printed, so two answers found under different
 * values of them are answers to the same question.
 *
 * Everything else is treated as changing the answer -- including an option this list has never heard of. Not knowing
 * whether an option matters is not the same as knowing it does not, and the safe direction is a wasted search rather
 * than a wrong answer.
 *
 * `Threads` and `Hash` are the awkward pair. They really do change what a fixed-depth search returns, because a
 * parallel search visits positions in a different order and a bigger table remembers more of them. But both answers
 * are honest depth-24 evaluations by the same engine of the same position, and making them material would empty the
 * cache every time the machine's spare capacity changed -- which, on the laptop this was written for, is constantly.
 * `MultiPV` is left out because the number of lines is compared on its own, against the lines really found.
 */
export const SPEED_ONLY_OPTIONS: readonly string[] = Object.freeze([
  'Threads',
  'Hash',
  'Clear Hash',
  'MultiPV',
  'Ponder',
  'NumaPolicy',
  'Debug Log File',
  'Move Overhead',
  'Slow Mover',
  'UCI_ShowWDL'
])

const SPEED_ONLY = new Set(SPEED_ONLY_OPTIONS.map((name) => name.toLowerCase()))

/** The options that go into the key, spelled the same way every time so the key is stable. */
export function materialOptions(applied: Readonly<Record<string, string>>): string {
  return Object.entries(applied)
    .filter(([name]) => !SPEED_ONLY.has(name.trim().toLowerCase()))
    .map(([name, value]) => `${name.trim()}=${String(value).trim()}`)
    .sort()
    .join(',')
}

/**
 * How far past the clock a search is assumed to see, when nothing in the ask says.
 *
 * A time limit and a node limit say nothing about depth, so there has to be a stated number. Eighty plies is far
 * beyond anything an analysis in Orbis reaches -- the window's own channel will not ask for more than forty -- and
 * overestimating only costs a search, where underestimating would serve an answer found without the fifty-move rule
 * in sight to somebody for whom it is two moves away.
 */
export const CLOCK_REACH = 80

/**
 * Whether the halfmove clock is part of the question.
 *
 * `positionKey` leaves the clocks out, deliberately and for good reason: they change what a draw claim does, not
 * what is legal now, and keying on them would miss every real repeat of a position. But a search *does* see the
 * fifty-move rule, so an evaluation found at a clock of 2 is not the evaluation at a clock of 96, where every line
 * runs into a draw. So the clock joins the key exactly when a search could reach the hundredth halfmove from here,
 * and stays out of it otherwise.
 */
export function clockMatters(halfmove: number, limits: AskLimits): boolean {
  const reach = Math.max(CLOCK_REACH, limits.depth ?? 0)
  return halfmove + reach >= 100
}

/** The halfmove clock out of a position, or 0 when the position does not carry one. */
export function halfmoveOf(fen: string): number {
  const field = String(fen).trim().split(/\s+/)[4]
  const n = Number.parseInt(field ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** A limit as it will be keyed and compared: whole numbers, within the same bounds the engine applies. */
export function normaliseLimits(raw: AskLimits | undefined): AskLimits {
  const r = raw ?? {}
  const out: AskLimits = {}
  const whole = (v: unknown, max: number): number | null => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) && n >= 1 ? Math.min(max, Math.floor(n)) : null
  }
  const movetime = whole(r.movetime, 600_000)
  const depth = whole(r.depth, 99)
  const nodes = whole(r.nodes, 1e12)
  if (movetime !== null) out.movetime = movetime
  if (depth !== null) out.depth = depth
  if (nodes !== null) out.nodes = nodes
  return out
}

export interface CacheKey {
  /** What makes two answers answers to the same question. What a row is stored under. */
  bucket: string
  /** The bucket plus what was asked for. Two asks with the same one are the same request twice. */
  request: string
  /** `positionKey(fen)`. Indexed, so a lookup that finds nothing usable can still say what it did find. */
  position: string
  /** The clock, when it is part of the question. Null when it is not, and the key says so either way. */
  clock: number | null
  variant: string
  /** The engine, as it goes into the key: the release tag and the binary, never the engine's own claim. */
  engine: string
  options: string
}

export type KeyResult =
  | { kind: 'key'; key: CacheKey }
  /** No key can be built, so nothing is looked up and nothing is stored. */
  | { kind: 'no-key'; because: string }

/**
 * The key for one ask.
 *
 * Two parts on purpose. The **bucket** is the question: this position, in this variant, from this engine build, under
 * the options that change what it finds. The **request** is the bucket plus the limits and the number of lines, which
 * is what tells "the same thing asked twice" from "something else asked once". Keeping the limits out of the bucket is
 * what lets a depth-30 answer serve a depth-20 ask; `servable` below is what stops it going the other way.
 *
 * There is no key at all without an engine identity. An evaluation that cannot say which engine produced it can
 * never be judged usable, so storing one would be storing a number nobody could ever trust (Section 423).
 */
export function keyFor(ask: AnalysisAsk): KeyResult {
  const fen = String(ask.fen ?? '').trim()
  if (!fen) return { kind: 'no-key', because: 'There is no position to look up.' }
  const engineVersion = (ask.engine.version ?? '').trim()
  const engineBuild = (ask.engine.build ?? '').trim()
  if (!engineVersion && !engineBuild) {
    return {
      kind: 'no-key',
      because: 'Orbis cannot tell which engine this answer would come from, so it is not kept: an evaluation nobody can check against an engine is worth nothing.'
    }
  }
  const limits = normaliseLimits(ask.limits)
  const position = positionKey(fen)
  const halfmove = halfmoveOf(fen)
  const clock = clockMatters(halfmove, limits) ? halfmove : null
  const variant = (ask.variant || 'standard').trim().toLowerCase()
  const engine = `${engineVersion || '?'}@${engineBuild || '?'}`
  const options = materialOptions(ask.engine.applied ?? {})
  const lines = Math.max(1, Math.floor(Number(ask.lines) || 1))
  const bucket = [
    `s${CACHE_SCHEMA}`,
    `p:${position}`,
    `hm:${clock === null ? '-' : clock}`,
    `v:${variant}`,
    `e:${engine}`,
    `o:${options}`
  ].join('|')
  const limitText = [
    limits.movetime === undefined ? '' : `t${limits.movetime}`,
    limits.depth === undefined ? '' : `d${limits.depth}`,
    limits.nodes === undefined ? '' : `n${limits.nodes}`
  ].filter((part) => part !== '').join('+') || 'none'
  return {
    kind: 'key',
    key: { bucket, request: `${bucket}|l:${limitText}|m:${lines}`, position, clock, variant, engine, options }
  }
}

// ---------------------------------------------------------------- can this answer that?

export type UnusableReason =
  | 'schema'
  | 'variant'
  | 'engine-version'
  | 'engine-build'
  | 'options'
  | 'position'
  | 'clock'
  | 'incomplete'
  | 'bound'
  | 'no-score'
  | 'depth'
  | 'nodes'
  | 'time'
  | 'lines'
  | 'expired'

export type Usable =
  | { usable: true }
  | { usable: false; reason: UnusableReason; because: string }

const YES: Usable = Object.freeze({ usable: true })

const no = (reason: UnusableReason, because: string): Usable => ({ usable: false, reason, because })

const seconds = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} seconds` : `${ms} ms`)

/**
 * Whether a stored answer answers this ask, and in plain words why not when it does not.
 *
 * The order of the checks is the order somebody would want to be told about: what the answer *is* before what it
 * reached, so "that was a different engine" is said instead of "that was not deep enough".
 *
 * Every comparison is between the ask's limit and something that was measured. A depth is compared with a depth, a
 * count of positions with a count of positions, and a time limit with the time Orbis itself measured from asking to
 * answering -- not with the engine's own figure, which is the time at the moment it printed the line and is always a
 * little short of the search it was given.
 */
export function servable(entry: CachedAnalysis, ask: AnalysisAsk, options: { now?: number; maxAgeMs?: number } = {}): Usable {
  if (entry.schema !== CACHE_SCHEMA) {
    return no('schema', `That answer was stored by a different version of Orbis (format ${entry.schema}, this one reads ${CACHE_SCHEMA}).`)
  }
  const limits = normaliseLimits(ask.limits)
  const wantVariant = (ask.variant || 'standard').trim().toLowerCase()
  if (entry.variant !== wantVariant) {
    return no('variant', `That answer is about ${entry.variant}, and this is ${wantVariant}.`)
  }
  // The engine's release tag and its binary, never the name it reports about itself: an engine that prints its name
  // differently between two runs must not throw away every answer it has already given.
  const askVersion = (ask.engine.version ?? '').trim()
  const askBuild = (ask.engine.build ?? '').trim()
  if (askVersion && (entry.engineVersion ?? '') !== askVersion) {
    return no('engine-version', `That answer came from engine version ${entry.engineVersion ?? 'an unrecorded version'}, and this one is ${askVersion}.`)
  }
  if (askBuild && (entry.engineBuild ?? '') !== askBuild) {
    return no('engine-build', 'That answer came from a different copy of the engine, so it is not reused.')
  }
  const askOptions = materialOptions(ask.engine.applied ?? {})
  if (entry.options !== askOptions) {
    return no('options', 'The engine is set up differently now, in a way that changes what it finds, so the old answer is not reused.')
  }
  if (entry.position !== positionKey(ask.fen)) {
    return no('position', 'That answer is about a different position.')
  }
  const halfmove = halfmoveOf(ask.fen)
  // Only when it is in play. Below that it cannot reach the draw inside any search Orbis runs, which is why
  // `positionKey` leaves it out and why this is the one piece of game history a position answer looks at.
  if (clockMatters(halfmove, limits) && entry.halfmove !== halfmove) {
    return no('clock', `That answer was found ${entry.halfmove} halfmoves into the fifty-move count and this position is ${halfmove}, which is close enough to the draw to change what the engine finds.`)
  }
  if (entry.status !== 'complete') {
    return no('incomplete', entry.status === 'cancelled'
      ? 'That search was stopped before it finished, so it is kept as a partial answer and not shown as a finished one.'
      : 'That search failed, so what it reached is not shown as an answer.')
  }
  if (entry.bound !== null) {
    return no('bound', 'The engine only ever said that score was above or below a limit, not what it is, so it is not reused as an evaluation.')
  }
  if (entry.score.kind === 'none') {
    return no('no-score', 'That search never produced a score.')
  }
  if (limits.depth !== undefined && (entry.depth ?? -1) < limits.depth) {
    return no('depth', `That answer only reached depth ${entry.depth ?? 'an unreported depth'}, and this asks for ${limits.depth}.`)
  }
  if (limits.nodes !== undefined && (entry.nodes ?? -1) < limits.nodes) {
    return no('nodes', `That answer counted ${entry.nodes ?? 'an unreported number of'} positions, and this asks for ${limits.nodes}.`)
  }
  if (limits.movetime !== undefined) {
    const spent = entry.elapsedMs ?? entry.timeMs
    if (spent === null || spent < limits.movetime) {
      return no('time', spent === null
        ? 'How long that search took was never recorded, so it cannot be weighed against a time limit.'
        : `That search ran for ${seconds(spent)}, and this asks for ${seconds(limits.movetime)} of thinking.`)
    }
  }
  const wantLines = Math.max(1, Math.floor(Number(ask.lines) || 1))
  // Either it really found that many, or it asked for that many and finished -- in which case there were no more to
  // find. A position with two legal moves can never produce three lines, and asking for ever would be the bug.
  if (entry.lines.length < wantLines && entry.askedLines < wantLines) {
    return no('lines', `That answer has ${entry.lines.length} line${entry.lines.length === 1 ? '' : 's'}, and this asks for ${wantLines}.`)
  }
  const maxAge = options.maxAgeMs
  if (maxAge !== undefined && options.now !== undefined && options.now - entry.createdAt > maxAge) {
    return no('expired', 'That answer is older than the cache keeps answers for.')
  }
  return YES
}

/**
 * Whether a new answer should replace one already held.
 *
 * This is what stops a cancelled search landing on top of a finished one, which is the fault Section 429 is about: a
 * person steps forward, the search for the position they left is stopped, and its half-finished numbers arrive after
 * the finished ones and overwrite them. A finished search always beats an unfinished one; between two of the same
 * kind, the one that did more work wins, and only when nothing else separates them does the newer one win.
 */
export function better(next: CachedAnalysis, held: CachedAnalysis): boolean {
  const rank = (e: CachedAnalysis): number => (e.status === 'complete' ? 2 : e.status === 'cancelled' ? 1 : 0)
  if (rank(next) !== rank(held)) return rank(next) > rank(held)
  const settled = (e: CachedAnalysis): number => (e.bound === null && e.score.kind !== 'none' ? 1 : 0)
  if (settled(next) !== settled(held)) return settled(next) > settled(held)
  if ((next.depth ?? -1) !== (held.depth ?? -1)) return (next.depth ?? -1) > (held.depth ?? -1)
  if (next.lines.length !== held.lines.length) return next.lines.length > held.lines.length
  if ((next.nodes ?? -1) !== (held.nodes ?? -1)) return (next.nodes ?? -1) > (held.nodes ?? -1)
  if ((next.elapsedMs ?? -1) !== (held.elapsedMs ?? -1)) return (next.elapsedMs ?? -1) > (held.elapsedMs ?? -1)
  return next.createdAt > held.createdAt
}

/** What a screen can say about a reused answer, so it is never mistaken for a search that just happened. */
export interface ReusedFrom {
  engine: string
  depth: number | null
  lines: number
  searchedFor: number | null
  storedAt: number
  uses: number
}

export function reusedFrom(entry: CachedAnalysis): ReusedFrom {
  return {
    engine: entry.engineName ?? entry.engineVersion ?? 'the engine',
    depth: entry.depth,
    lines: entry.lines.length,
    searchedFor: entry.elapsedMs ?? entry.timeMs,
    storedAt: entry.createdAt,
    uses: entry.uses
  }
}

/** The same in one sentence, for the line under an evaluation. Never says a figure it does not have. */
export function reusedSentence(entry: CachedAnalysis): string {
  const parts: string[] = []
  parts.push(entry.depth === null ? 'at a depth it did not report' : `to depth ${entry.depth}`)
  const spent = entry.elapsedMs ?? entry.timeMs
  if (spent !== null) parts.push(`in ${seconds(spent)}`)
  return `Kept from an earlier search: ${entry.engineName ?? entry.engineVersion ?? 'the engine'} looked at this position ${parts.join(' ')}.`
}

// ---------------------------------------------------------------- how big it may get

export interface CacheLimits {
  /** How many answers may be held at once. */
  maxEntries: number
  /** How much room they may take altogether, in bytes of stored text. */
  maxBytes: number
  /** How much room one answer may take. A single enormous search does not get to fill the cache. */
  maxEntryBytes: number
  /** How long a line may be before it is cut down. A 99-ply variation is not worth storing whole. */
  maxPvMoves: number
  /** How many lines of one answer are kept. */
  maxLines: number
  /** How old an answer may be before it stops being served. */
  maxAgeMs: number
  /** How many rows one eviction pass may drop, so a save is never a long pause. */
  evictBatch: number
}

/**
 * The defaults.
 *
 * Twenty thousand answers at about a kilobyte each is twenty megabytes, which is a few minutes of analysis and sits
 * comfortably beside the games themselves. The per-entry cap of 64 kB is what stops one depth-60 MultiPV-5 search
 * with five hundred-move variations from being bigger than the rest of the cache put together.
 */
export const DEFAULT_CACHE_LIMITS: Readonly<CacheLimits> = Object.freeze({
  maxEntries: 20_000,
  maxBytes: 20 * 1024 * 1024,
  maxEntryBytes: 64 * 1024,
  maxPvMoves: 40,
  maxLines: 5,
  maxAgeMs: 180 * 24 * 60 * 60 * 1000,
  evictBatch: 200
})

export type Fitted =
  | { kind: 'fits'; entry: CachedAnalysis }
  /** Too big even cut down. Not stored, and the reason is counted and can be shown. */
  | { kind: 'too-big'; because: string }

/**
 * Cuts an answer down to the size one answer may be, and measures what is left.
 *
 * Trimming before refusing, in that order, because a long variation is the only part of an answer nobody minds
 * losing -- the evaluation, the depth and the best move are the answer, and the thirty-ninth move of the line is
 * decoration. What was cut is said in its own field, so the engine's own note is not rewritten to carry Orbis's
 * bookkeeping.
 */
export function fit(entry: CachedAnalysis, limits: CacheLimits = DEFAULT_CACHE_LIMITS): Fitted {
  const measure = (e: CachedAnalysis): number => JSON.stringify({ ...e, bytes: 0 }).length
  let next = entry
  let cut: string | null = null
  if (next.lines.length > limits.maxLines) {
    next = { ...next, lines: next.lines.slice(0, limits.maxLines) }
    cut = `Only the best ${limits.maxLines} lines were kept.`
  }
  const longPv = next.pvUci.length > limits.maxPvMoves || next.lines.some((line) => line.pvUci.length > limits.maxPvMoves)
  if (longPv) {
    next = {
      ...next,
      pvUci: next.pvUci.slice(0, limits.maxPvMoves),
      lines: next.lines.map((line) => ({ ...line, pvUci: line.pvUci.slice(0, limits.maxPvMoves) }))
    }
    cut = cut
      ? `${cut} The lines were shortened to ${limits.maxPvMoves} moves.`
      : `The lines were shortened to ${limits.maxPvMoves} moves.`
  }
  const bytes = measure(next)
  if (bytes > limits.maxEntryBytes) {
    return {
      kind: 'too-big',
      because: `That answer takes ${Math.round(bytes / 1024)} kB even after shortening its lines, and one answer may take ${Math.round(limits.maxEntryBytes / 1024)} kB, so it was not kept.`
    }
  }
  return { kind: 'fits', entry: { ...next, bytes, trimmedBecause: cut } }
}

/** What eviction needs to know about a row, which is far less than the whole row. */
export interface EvictionCandidate {
  bucket: string
  bytes: number
  lastUsedAt: number
  createdAt: number
  status: CachedAnalysis['status']
  pinned: boolean
}

export interface Eviction {
  bucket: string
  reason: 'expired' | 'unfinished' | 'least-recently-used'
  because: string
}

/**
 * Which answers to drop, and why each one.
 *
 * `keep` is what must survive whatever happens: the position on the board now, and anything else somebody is
 * looking at. Nothing in it is ever dropped, and neither is anything pinned -- which is the whole point of the
 * eviction rule. A cache that frees room by throwing away the thing being shown is worse than no cache.
 *
 * The order is expired first, then unfinished searches, then whatever has gone longest without being asked for. An
 * unfinished search goes before a finished one because it is the one answer that cannot be served anyway.
 */
export function chooseEvictions(
  candidates: readonly EvictionCandidate[],
  limits: CacheLimits,
  o: { now: number; keep?: ReadonlySet<string> }
): Eviction[] {
  const keep = o.keep ?? new Set<string>()
  const droppable = candidates.filter((c) => !c.pinned && !keep.has(c.bucket))
  const out: Eviction[] = []
  const gone = new Set<string>()
  let entries = candidates.length
  let bytes = candidates.reduce((sum, c) => sum + c.bytes, 0)

  const drop = (c: EvictionCandidate, reason: Eviction['reason'], because: string): void => {
    if (gone.has(c.bucket)) return
    gone.add(c.bucket)
    entries -= 1
    bytes -= c.bytes
    out.push({ bucket: c.bucket, reason, because })
  }

  // Expired answers go whether or not there is pressure: they would be refused at lookup anyway.
  for (const c of droppable) {
    if (out.length >= limits.evictBatch) return out
    if (o.now - c.createdAt > limits.maxAgeMs) drop(c, 'expired', 'It is older than the cache keeps answers for.')
  }

  const over = (): boolean => entries > limits.maxEntries || bytes > limits.maxBytes
  if (!over()) return out

  const byAge = droppable.filter((c) => !gone.has(c.bucket)).sort((a, b) => a.lastUsedAt - b.lastUsedAt)
  for (const c of byAge) {
    if (!over() || out.length >= limits.evictBatch) return out
    if (c.status !== 'complete') drop(c, 'unfinished', 'That search never finished, so it could not have been served.')
  }
  for (const c of byAge) {
    if (!over() || out.length >= limits.evictBatch) return out
    drop(c, 'least-recently-used', 'Nothing has asked for it for longer than anything else kept.')
  }
  return out
}

// ---------------------------------------------------------------- counting what happened

/** Why a lookup found nothing. Every one of them is counted. */
export interface Rejection {
  bucket: string
  reason: UnusableReason
  because: string
}

export interface CacheCounters {
  /** How many lookups were made, and how long they took altogether, so the average is a division. */
  lookups: number
  lookupMs: number
  hits: number
  misses: number
  /** Answers found for the position and refused, counted by the reason they were refused for. */
  rejected: Record<string, number>
  stored: number
  /** A write that replaced a worse answer for the same question. */
  replaced: number
  /** A write refused because what was already there was better. The fault Section 429 is about. */
  superseded: number
  /** A write refused because one answer may not be that big. */
  refusedTooBig: number
  /** A write refused because the answer had no settled score to keep. */
  refusedUnsettled: number
  /** A write refused because no key could be built for it. */
  refusedNoKey: number
  evicted: number
  /** Reads that failed -- the file was locked, or could not be made sense of. */
  readFailures: number
  writeFailures: number
  /** Positions searched again although something was already stored for them. */
  reanalysed: number
}

export function emptyCounters(): CacheCounters {
  return {
    lookups: 0,
    lookupMs: 0,
    hits: 0,
    misses: 0,
    rejected: {},
    stored: 0,
    replaced: 0,
    superseded: 0,
    refusedTooBig: 0,
    refusedUnsettled: 0,
    refusedNoKey: 0,
    evicted: 0,
    readFailures: 0,
    writeFailures: 0,
    reanalysed: 0
  }
}

/** How long a lookup takes on average, or null when none has been made. Never 0 for "nothing measured". */
export function averageLookupMs(counters: CacheCounters): number | null {
  return counters.lookups > 0 ? counters.lookupMs / counters.lookups : null
}

/**
 * How often a lookup found an answer, 0 to 1, or null when nothing has been looked up.
 *
 * Null rather than 0, because "no lookups" and "no hits" are not the same thing and a cache reported as 0% effective
 * before it has been asked anything is how a working feature gets taken out.
 */
export function hitRate(counters: CacheCounters): number | null {
  return counters.lookups > 0 ? counters.hits / counters.lookups : null
}

export interface CacheSize {
  entries: number
  bytes: number
  oldestAt: number | null
  newestAt: number | null
  unfinished: number
  pinned: number
}

/** What the diagnostics panel shows: counted figures, and the refusals named. Nothing worked out from a guess. */
export function cacheReport(counters: CacheCounters, size: CacheSize): string[] {
  const out: string[] = []
  const rate = hitRate(counters)
  out.push(counters.lookups === 0
    ? 'Nothing has been looked up yet.'
    : `${counters.hits} of ${counters.lookups} lookups were answered from what was already stored (${Math.round((rate ?? 0) * 100)}%).`)
  const average = averageLookupMs(counters)
  if (average !== null) out.push(`A lookup takes ${average.toFixed(2)} ms on average.`)
  out.push(`${size.entries} answers are stored, taking ${(size.bytes / 1024).toFixed(0)} kB.`)
  if (size.unfinished > 0) out.push(`${size.unfinished} of them are from searches that never finished, and are never served as answers.`)
  if (size.pinned > 0) out.push(`${size.pinned} are pinned and are never evicted.`)
  const reasons = Object.entries(counters.rejected).sort((a, b) => b[1] - a[1])
  for (const [reason, count] of reasons) out.push(`${count} stored answer${count === 1 ? '' : 's'} refused: ${REJECTION_PLAIN[reason] ?? reason}.`)
  if (counters.evicted > 0) out.push(`${counters.evicted} were dropped to stay inside the size it is allowed.`)
  if (counters.superseded > 0) out.push(`${counters.superseded} write${counters.superseded === 1 ? '' : 's'} refused because what was already there was better.`)
  if (counters.refusedTooBig > 0) out.push(`${counters.refusedTooBig} answers were too big to keep.`)
  if (counters.readFailures > 0 || counters.writeFailures > 0) {
    out.push(`${counters.readFailures} reads and ${counters.writeFailures} writes failed.`)
  }
  return out
}

/** The reasons in the words a developer reading the panel would use. */
export const REJECTION_PLAIN: Readonly<Record<string, string>> = Object.freeze({
  schema: 'stored in an older format',
  variant: 'a different variant',
  'engine-version': 'a different engine version',
  'engine-build': 'a different copy of the engine',
  options: 'the engine was set up differently',
  position: 'a different position',
  clock: 'a different point in the fifty-move count',
  incomplete: 'the search never finished',
  bound: 'the score was only a bound',
  'no-score': 'there was no score',
  depth: 'not deep enough for what was asked',
  nodes: 'not enough positions counted',
  time: 'the search was shorter than the time asked for',
  lines: 'fewer lines than were asked for',
  expired: 'too old to serve'
})
