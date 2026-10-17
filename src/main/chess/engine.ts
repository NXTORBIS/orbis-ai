import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { availableParallelism, totalmem } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { LineReader, goCommand, parseLine, safeOptionValue, type EngineOption, type InfoLine } from '../../shared/chess/uci.ts'
import { SKILL_OPTION } from '../../shared/chess/opponents.ts'
import { fromEngine, type Score, type Side } from '../../shared/chess/evaluation.ts'
import { applyMove, checkFen, sideToMove, uciLineToSan } from '../../shared/chess/rules.ts'
import {
  CACHE_SCHEMA,
  halfmoveOf,
  keyFor,
  reusedFrom,
  type AnalysisAsk,
  type AnalysisScope,
  type CachedAnalysis,
  type CachedLine,
  type EngineIdentity,
  type ReusedFrom
} from '../../shared/chess/analysisCache.ts'
import {
  KNOWN_TAG,
  LICENCE_ID,
  LICENCE_NAME,
  MARKER,
  PROJECT_URL,
  checkBinaryPath,
  chooseAsset,
  defaultHome,
  downloadAsset,
  InstallError,
  readInstalled,
  resolveRelease,
  unpackEngine,
  writeInstalled,
  type InstallRecord
} from './install.ts'

/**
 * The chess engine Orbis analyses with, driven over UCI.
 *
 * Node only: no Electron anywhere in this folder, and every path, every spawn and every fetch arrives as an option,
 * so the same service runs in the application, in the helper process and in a test without any of them knowing
 * about each other.
 *
 * ## What this is careful about, and why
 *
 * **A result belongs to a position.** Every update carries the `requestId` it came from and the `fen` it was
 * calculated in. An analysis board moves on while the engine is still thinking about the position before; a stream
 * of bare depths and scores with nothing to attach them to is how an evaluation from two moves ago ends up on the
 * screen under the current position. Nothing here emits an update that cannot be matched to the request that asked
 * for it, and an update from a search that is no longer the running one is dropped rather than relabelled.
 *
 * **A bound is not an evaluation.** `lowerbound` and `upperbound` mean the engine stopped looking once it knew the
 * score was past a window -- the number is a limit, not a verdict. It is passed on marked, and whatever shows it can
 * decide to wait; it is never recorded as a settled score.
 *
 * **A line is only shown if it can be played.** The engine's principal variation is coordinates. It is converted
 * through the one module that knows the rules, against the position it was calculated in, and if any move in it does
 * not fit -- an engine bug, a position Orbis read wrongly, a line truncated across two reads -- the readable line is
 * dropped. The coordinates are kept, so the fault is visible rather than papered over with a guess.
 *
 * **"Ready" is something that happened, not something inferred.** A binary existing on disk is not an engine. The
 * state only reaches `ready` after `uci` was answered with `uciok`, the options were read, the ones Orbis sets were
 * accepted, and `isready` came back `readyok`. The name and author in the status are the ones the engine said about
 * itself in this process, not a version parsed out of a filename.
 *
 * **A process that dies is a failure, not a wait.** If the engine exits in the middle of a search -- out of memory,
 * an illegal instruction on the wrong build, killed from outside -- the search is rejected with the exit code and the
 * last thing the engine wrote to its error stream. It never leaves a request sitting in `searching` for ever.
 *
 * **One search at a time, and the commands never interleave.** UCI is a single conversation: a `go` while the last
 * search is still running, or a `setoption` between them, produces answers that belong to neither. Requests queue,
 * interactive ones ahead of batch ones, and a cancelled search is not finished until its `bestmove` has arrived --
 * because until then the engine is still mid-sentence.
 */

export type EngineStateName =
  | 'not-installed'
  | 'installing'
  | 'stopped'
  | 'starting'
  | 'handshaking'
  | 'ready'
  | 'searching'
  | 'stopping'
  | 'failed'

export class ChessEngineError extends Error {
  readonly code:
    | 'not-installed'
    | 'install-failed'
    | 'bad-path'
    | 'start-failed'
    | 'handshake-failed'
    | 'bad-request'
    | 'duplicate-request'
    | 'engine-gone'
    | 'cancelled'
    | 'timeout'
    | 'shutting-down'
  /** True when trying again makes sense: the next analysis starts the engine afresh. */
  readonly recoverable: boolean
  constructor(code: ChessEngineError['code'], message: string, recoverable = true) {
    super(message)
    this.name = 'ChessEngineError'
    this.code = code
    this.recoverable = recoverable
  }
}

// ---------------------------------------------------------------- what a request and a result are

export interface AnalysisLimits {
  /** Milliseconds to think for. */
  movetime?: number
  depth?: number
  nodes?: number
}

export interface AnalysisRequest {
  fen: string
  limits: AnalysisLimits
  /** How many lines to ask for. Clamped to what the engine advertises, and 1 when it has no MultiPV at all. */
  multipv?: number
  /** Supplied by the caller so its own updates can be matched; generated when absent. */
  requestId?: string
  /** A board waiting for a number comes before a game being swept through. */
  priority?: 'interactive' | 'batch'
  /**
   * The engine's own strength dial for this one search, 0 to 20. Absent means nothing held back.
   *
   * Per search rather than set once on the engine, because one engine process answers everybody: the game you are
   * playing against a gentle opponent, the hint you asked for, the analysis board and a whole-game sweep. A dial
   * left turned down would answer all of them, and nothing on screen would show it. So it is set immediately before
   * the `go` that wants it and the engine is put back to its own default before any search that does not.
   */
  skill?: number
  /** True for the first position of a new game, so the engine clears what it learnt about the last one. */
  newGame?: boolean
  /** Which game this is, so a variant's answers are never kept beside standard chess's. `standard` when absent. */
  variant?: string
  /**
   * False to insist on a fresh search.
   *
   * For the one case where a stored answer is not what somebody is asking for: "search this again" means search it
   * again. The answer is still kept afterwards, because a fresh search is exactly what the cache wants to hold.
   */
  useCache?: boolean
  signal?: AbortSignal
  /** Called for every update, including the final one. */
  onUpdate?: (update: AnalysisUpdate) => void
}

export interface AnalysisBase {
  /** The request this belongs to. Present on every update, so a stale one can be recognised and ignored. */
  requestId: string
  /** The position this was calculated in. Present for the same reason. */
  fen: string
  /** From White's point of view, turned round once by `fromEngine`. `none` when the engine has not scored yet. */
  score: Score
  depth: number | null
  seldepth: number | null
  nodes: number | null
  nps: number | null
  timeMs: number | null
  /** Readable notation, or null when the engine's line could not be played in this position. */
  pvSan: string[] | null
  /** The engine's own coordinates, always kept. */
  pvUci: string[]
  multipv: number
  /** Set when the engine said the score is only a bound, so it is not settled. */
  bound: 'lower' | 'upper' | null
}

export interface AnalysisInfo extends AnalysisBase {
  complete: false
}

export interface AnalysisResult extends AnalysisBase {
  complete: true
  /** Checked against the position that was asked about. Null when the engine offered no legal move. */
  bestmove: string | null
  bestmoveSan: string | null
  ponder: string | null
  /** The settled line for each MultiPV slot, best first. */
  lines: AnalysisInfo[]
  /** Said plainly when the answer could not be used as the engine gave it. */
  note: string | null
  /**
   * Set when this answer was kept from an earlier search rather than found now, with what it was found under.
   *
   * Null on everything the engine really searched. A screen that shows a reused answer without showing this is a
   * screen claiming a search happened that did not (Section 423).
   */
  from?: ReusedFrom | null
}

export type AnalysisUpdate = AnalysisInfo | AnalysisResult

/**
 * What the engine needs of the store that keeps its answers.
 *
 * An interface rather than the store itself, so this file stays plain Node with no database in it and the whole
 * engine can still be tested against a cache that is a Map. `src/main/chess/analysisStore.ts` is the real one.
 */
export interface AnalysisCachePort {
  look(ask: AnalysisAsk): { kind: 'hit'; entry: CachedAnalysis } | { kind: 'miss'; explain: string }
  keep(entry: CachedAnalysis): { kind: 'stored' } | { kind: 'refused'; because: string }
}

// ---------------------------------------------------------------- resources

/**
 * How many threads to take.
 *
 * About half the logical processors, never all of them and never more than eight. The machine this was written for is
 * an i7-1355U laptop: a search that takes every core makes the rest of Orbis stutter and the fan audible, which is a
 * poor trade for the last fraction of a pawn in an evaluation nobody is waiting on.
 */
export function defaultThreads(cores: number): number {
  const n = Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 1
  return Math.max(1, Math.min(8, Math.min(n - 1 > 0 ? n - 1 : 1, Math.floor(n / 2))))
}

/** How much memory for the transposition table: a thirty-second of what the machine has, between 16 and 512 MB. */
export function defaultHash(memoryMb: number): number {
  const mb = Number.isFinite(memoryMb) && memoryMb > 0 ? memoryMb : 2048
  return Math.max(16, Math.min(512, 2 ** Math.floor(Math.log2(Math.max(16, mb / 32)))))
}

/**
 * A value for an option, within what the engine said it accepts, or null.
 *
 * Null rather than a clamp when the engine does not take values of that shape at all: a combo it has never heard of
 * and a button given a value are not "nearly right", and sending them anyway is how an engine ends up in a state
 * nobody asked for.
 */
export function clampOption(option: EngineOption, value: string | number | boolean): string | null {
  switch (option.type) {
    case 'spin': {
      const raw = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value)
      if (!Number.isFinite(raw)) return null
      const min = option.min ?? Number.NEGATIVE_INFINITY
      const max = option.max ?? Number.POSITIVE_INFINITY
      if (min > max) return null
      return safeOptionValue(Math.round(Math.min(max, Math.max(min, raw))))
    }
    case 'check': {
      if (typeof value === 'boolean') return safeOptionValue(value)
      const text = String(value).trim().toLowerCase()
      if (text === 'true' || text === 'false') return text
      return null
    }
    case 'combo': {
      const text = String(value)
      return option.vars?.includes(text) ? safeOptionValue(text) : null
    }
    case 'string':
      return safeOptionValue(String(value))
    // A button is pressed, not set. There is no value it could be given.
    case 'button':
      return null
  }
}

// ---------------------------------------------------------------- options for the service

export interface Timeouts {
  /** From spawn to `uciok`. */
  handshakeMs: number
  /** For any `isready`. */
  readyMs: number
  /** How long a `stop` is given to produce a `bestmove` before the process is restarted. */
  stopMs: number
  /** Added to `movetime` before a search is treated as hung. */
  searchGraceMs: number
  /** The ceiling for a search with no time limit of its own (depth or nodes). */
  maxSearchMs: number
}

export const DEFAULT_TIMEOUTS: Readonly<Timeouts> = Object.freeze({
  handshakeMs: 20_000,
  readyMs: 20_000,
  stopMs: 5_000,
  searchGraceMs: 5_000,
  maxSearchMs: 300_000
})

export interface ChessEngineOptions {
  /** Where an installed engine lives, and where `install` puts one. */
  home?: string
  /** A binary the person chose. Validated before use; never a path that arrived in game or provider data. */
  binaryPath?: string
  spawnFn?: typeof spawn
  fetchFn?: typeof fetch
  /** Logical processors, for sizing Threads. */
  cores?: number
  /** Megabytes of memory, for sizing Hash. */
  memoryMb?: number
  timeouts?: Partial<Timeouts>
  /** Values to set once the engine has said what it accepts. Anything it does not advertise is not sent. */
  options?: Record<string, string | number | boolean>
  platform?: string
  arch?: string
  /** Accept a release that publishes no checksum. Off, deliberately: the thing being downloaded gets executed. */
  allowUnverified?: boolean
  /**
   * Where answers are kept between searches. Absent means every position is searched afresh, which is what Chess
   * World did before this existed: correct, and slow.
   */
  cache?: AnalysisCachePort
  /** A line of diagnostics. Never the place anything is decided. */
  onLog?: (line: string) => void
}

export interface EngineStatus {
  state: EngineStateName
  /** Said plainly: what it is doing, or why it cannot. */
  detail: string
  /** What the engine called itself, in this process, after a real handshake. Null before one. */
  name: string | null
  author: string | null
  /** The release tag recorded when it was installed. Upstream's version, not the engine's claim about itself. */
  installedVersion: string | null
  /** False only when a release with no published checksum was accepted on purpose. */
  verified: boolean | null
  binaryPath: string | null
  binaryFrom: 'configured' | 'app-data' | null
  licencePath: string | null
  licenceId: string | null
  sourceUrl: string | null
  /** Only what this engine advertised. Empty until it has been asked. */
  options: EngineOption[]
  /** What was actually set, after clamping. */
  applied: Record<string, string>
  searching: { requestId: string; fen: string; startedAt: number } | null
  queued: number
  lastError: string | null
  recoverable: boolean
  /** Something is there and cannot be used or read. Never reported as "not installed". */
  problem: string | null
}

// ---------------------------------------------------------------- the running process

interface ActiveSearch {
  requestId: string
  fen: string
  side: Side
  startedAt: number
  emit: (update: AnalysisUpdate) => void
  settle: (result: AnalysisResult) => void
  fail: (error: Error) => void
  /** The last settled (unbounded) line for each MultiPV slot. */
  lines: Map<number, AnalysisInfo>
  /** The last line of any kind, so a search that only ever reported bounds still returns something true. */
  last: AnalysisInfo | null
  timer: ReturnType<typeof setTimeout> | null
  done: boolean
}

interface Waiter {
  resolve: () => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * One engine process and the conversation with it.
 *
 * Deliberately dumb about queues and installing: it starts, shakes hands, runs one search, and reports what it saw.
 * Everything about what runs when is in `ChessEngine` above it.
 */
class EngineProcess {
  private readonly child: ChildProcess
  private readonly reader = new LineReader()
  private readonly log: (line: string) => void
  private readonly timeouts: Timeouts
  readonly options = new Map<string, EngineOption>()
  readonly applied = new Map<string, string>()
  name: string | null = null
  author: string | null = null
  gone = false
  exitDetail: string | null = null
  private readonly errors: string[] = []
  private active: ActiveSearch | null = null
  /** What the last search that was thrown away had reached. See `abandon` and `takeAbandoned`. */
  private abandoned: { requestId: string; info: AnalysisInfo | null } | null = null
  /** A `bestmove` is still owed from a search that was abandoned. Until it arrives the engine is mid-sentence. */
  private owed = false
  private owedWaiters: Waiter[] = []
  private readyWaiters: Waiter[] = []
  private uciWaiter: Waiter | null = null
  private appliedMultiPv = 1
  /**
   * The strength dial as this process last set it, or null while it has never been touched.
   *
   * Null is not "20". It means Orbis has not sent the option at all, so the engine is on whatever it starts at --
   * and the dial is then left alone, which keeps a build that never plays a weakened game exactly as it was before
   * any of this existed.
   */
  private appliedSkill: number | null = null
  private seenNewGame = false

  constructor(child: ChildProcess, timeouts: Timeouts, log: (line: string) => void) {
    this.child = child
    this.timeouts = timeouts
    this.log = log
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      for (const line of this.reader.push(String(chunk))) this.take(line)
    })
    // Drained, not ignored: a full pipe stops the engine, and the last few lines are the only explanation a crash gives.
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue
        this.errors.push(line.trim().slice(0, 300))
        if (this.errors.length > 50) this.errors.splice(0, 25)
        this.log(`engine stderr: ${line.trim().slice(0, 300)}`)
      }
    })
    child.on('error', (e) => {
      this.exitDetail = `the engine could not be run: ${e.message}`
      this.finishGone()
    })
    child.on('close', (code, signal) => {
      for (const line of this.reader.flush()) this.take(line)
      this.exitDetail = signal ? `the engine was stopped by ${signal}` : `the engine exited with code ${code ?? 'unknown'}`
      this.finishGone()
    })
  }

  get stderrTail(): string {
    return this.errors.slice(-3).join(' | ')
  }

  get searching(): { requestId: string; fen: string; startedAt: number } | null {
    return this.active ? { requestId: this.active.requestId, fen: this.active.fen, startedAt: this.active.startedAt } : null
  }

  get owing(): boolean {
    return this.owed
  }

  // ------------------------------------------------------------ writing

  private send(line: string): void {
    if (this.gone || !this.child.stdin || this.child.stdin.destroyed) {
      throw new ChessEngineError('engine-gone', `The engine is not running (${this.exitDetail ?? 'it was stopped'}).`)
    }
    // A line protocol: anything that could carry a newline could carry a second command.
    if (/[\r\n]/.test(line)) throw new ChessEngineError('bad-request', 'An engine command cannot contain a line break.')
    this.log(`> ${line}`)
    this.child.stdin.write(`${line}\n`)
  }

  // ------------------------------------------------------------ reading

  private take(raw: string): void {
    const message = parseLine(raw)
    switch (message.type) {
      case 'id':
        if (message.name) this.name = message.name.slice(0, 200)
        if (message.author) this.author = message.author.slice(0, 200)
        return
      case 'option': {
        if (/[\r\n]/.test(message.option.name)) return
        this.options.set(message.option.name, message.option)
        return
      }
      case 'uciok': {
        const waiter = this.uciWaiter
        this.uciWaiter = null
        if (waiter) {
          clearTimeout(waiter.timer)
          waiter.resolve()
        }
        return
      }
      case 'readyok': {
        const waiter = this.readyWaiters.shift()
        if (waiter) {
          clearTimeout(waiter.timer)
          waiter.resolve()
        }
        return
      }
      case 'info':
        this.onInfo(message.info)
        return
      case 'bestmove':
        this.onBestmove(message.move, message.ponder ?? null)
        return
      default:
        if (message.line) this.log(`< ${message.line.slice(0, 300)}`)
    }
  }

  private onInfo(info: InfoLine): void {
    const search = this.active
    // No running search: this belongs to one that was cancelled or has already finished, and attaching it to whatever
    // runs next would put an old position's numbers under a new one.
    if (!search || search.done) return
    // A line with no depth, no score and no variation says nothing; `currmove` chatter is not an evaluation.
    if (info.depth === undefined && info.score === undefined && info.pv === undefined) return
    const pvUci = info.pv ?? []
    let pvSan: string[] | null = null
    if (pvUci.length) {
      const read = uciLineToSan(search.fen, pvUci)
      pvSan = read.legal ? read.san : null
      if (!read.legal) {
        this.log(`dropped an unplayable line from the engine after ${read.san.length} of ${pvUci.length} moves`)
      }
    }
    const update: AnalysisInfo = {
      requestId: search.requestId,
      fen: search.fen,
      score: info.score ? fromEngine(info.score, search.side) : { kind: 'none' },
      depth: info.depth ?? null,
      seldepth: info.seldepth ?? null,
      nodes: info.nodes ?? null,
      nps: info.nps ?? null,
      timeMs: info.time ?? null,
      pvSan,
      pvUci,
      multipv: info.multipv ?? 1,
      bound: info.bound ?? null,
      complete: false
    }
    search.last = update
    // Only a settled score becomes the line for its slot. A bound is passed on marked and never recorded as the answer.
    if (update.bound === null && update.score.kind !== 'none' && update.pvUci.length) search.lines.set(update.multipv, update)
    search.emit(update)
  }

  private onBestmove(move: string | null, ponder: string | null): void {
    const search = this.active
    if (!search || search.done) {
      // The answer to a search that was abandoned. It is not reported; it is what makes the engine reusable.
      this.owed = false
      const waiters = this.owedWaiters
      this.owedWaiters = []
      for (const w of waiters) {
        clearTimeout(w.timer)
        w.resolve()
      }
      return
    }
    search.done = true
    this.active = null
    this.owed = false
    if (search.timer) clearTimeout(search.timer)

    const best = search.lines.get(1) ?? search.last
    let note: string | null = null
    let bestmove: string | null = null
    let bestmoveSan: string | null = null
    if (move) {
      // The engine's own answer, checked against the position that was asked about. An engine that offers a move
      // that cannot be played has not answered the question, and playing it would corrupt the game.
      const played = applyMove(search.fen, move)
      if (played) {
        bestmove = played.uci
        bestmoveSan = played.san
      } else {
        note = `The engine offered "${move}", which is not a legal move in this position, so it was not used.`
        this.log(note)
      }
    } else {
      note = 'The engine reported no move for this position.'
    }
    // A ponder move is the reply the engine expects. It is only passed on if it is legal after the move it follows,
    // because an unplayable ponder move would be shown as the opponent's answer.
    let ponderMove: string | null = null
    if (ponder && bestmove) {
      const after = applyMove(search.fen, bestmove)
      if (after && applyMove(after.after, ponder)) ponderMove = ponder
    }
    const lines = [...search.lines.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line)
    const result: AnalysisResult = {
      requestId: search.requestId,
      fen: search.fen,
      score: best?.score ?? { kind: 'none' },
      depth: best?.depth ?? null,
      seldepth: best?.seldepth ?? null,
      nodes: best?.nodes ?? null,
      nps: best?.nps ?? null,
      timeMs: best?.timeMs ?? null,
      pvSan: best?.pvSan ?? null,
      pvUci: best?.pvUci ?? [],
      multipv: best?.multipv ?? 1,
      bound: best?.bound ?? null,
      complete: true,
      bestmove,
      bestmoveSan,
      ponder: ponderMove,
      lines,
      note,
      // Said rather than left out: this search really happened, just now. Only a kept answer carries a `from`.
      from: null
    }
    search.emit(result)
    search.settle(result)
  }

  private finishGone(): void {
    if (this.gone) return
    this.gone = true
    const detail = `${this.exitDetail ?? 'the engine stopped'}${this.stderrTail ? `. Its last words: ${this.stderrTail}` : ''}`
    const search = this.active
    this.active = null
    if (search && !search.done) {
      search.done = true
      if (search.timer) clearTimeout(search.timer)
      search.fail(new ChessEngineError('engine-gone', `The engine stopped while it was thinking: ${detail}`))
    }
    const waiters = [...this.readyWaiters, ...this.owedWaiters, ...(this.uciWaiter ? [this.uciWaiter] : [])]
    this.readyWaiters = []
    this.owedWaiters = []
    this.uciWaiter = null
    this.owed = false
    for (const w of waiters) {
      clearTimeout(w.timer)
      w.reject(new ChessEngineError('engine-gone', `The engine stopped: ${detail}`))
    }
  }

  private wait(into: 'ready' | 'uci' | 'owed', ms: number, what: string): Promise<void> {
    if (this.gone) {
      return Promise.reject(new ChessEngineError('engine-gone', `The engine is not running (${this.exitDetail ?? 'it was stopped'}).`))
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const drop = (list: Waiter[]): Waiter[] => list.filter((w) => w !== waiter)
          this.readyWaiters = drop(this.readyWaiters)
          this.owedWaiters = drop(this.owedWaiters)
          if (this.uciWaiter === waiter) this.uciWaiter = null
          reject(new ChessEngineError('timeout', `The engine did not ${what} within ${ms} ms.`))
        }, ms)
      }
      if (into === 'ready') this.readyWaiters.push(waiter)
      else if (into === 'owed') this.owedWaiters.push(waiter)
      else this.uciWaiter = waiter
    })
  }

  // ------------------------------------------------------------ handshake

  /** `uci` -> `uciok`, reading the name, the author and every option the engine advertises. */
  async handshake(): Promise<void> {
    const done = this.wait('uci', this.timeouts.handshakeMs, 'answer "uci" with "uciok"')
    this.send('uci')
    await done
    if (!this.name) this.log('the engine answered "uciok" without saying what it is called')
  }

  async ready(): Promise<void> {
    const done = this.wait('ready', this.timeouts.readyMs, 'answer "isready" with "readyok"')
    this.send('isready')
    await done
  }

  /**
   * Sets an option, if the engine advertises it and the value fits what it said it accepts.
   *
   * Returns what was really sent, or null. An option the engine has never mentioned is not sent at all: guessing at
   * a name is how `setoption name Threads` ends up in an engine that calls it something else and silently does
   * nothing while the status claims eight threads.
   */
  setOption(name: string, value: string | number | boolean): string | null {
    const advertised = this.options.get(name)
    if (!advertised) {
      this.log(`the engine does not offer an option called "${name}", so it was not set`)
      return null
    }
    const text = clampOption(advertised, value)
    if (text === null) {
      this.log(`"${String(value).slice(0, 40)}" is not a value ${name} accepts, so it was not set`)
      return null
    }
    this.send(`setoption name ${name} value ${text}`)
    this.applied.set(name, text)
    if (name === 'MultiPV') this.appliedMultiPv = Number(text)
    if (name === SKILL_OPTION) this.appliedSkill = Number(text)
    return text
  }

  /**
   * The value the strength dial goes back to when a search does not want it turned down.
   *
   * The engine's own advertised default, because "nothing held back" is the engine's idea of that and not Orbis's.
   * Its maximum if it published no default, and null if it published neither -- in which case the dial cannot be
   * restored honestly and is reported rather than guessed at.
   */
  private fullStrengthDial(option: EngineOption): number | null {
    const stated = Number(option.default)
    if (Number.isFinite(stated)) return stated
    if (typeof option.max === 'number' && Number.isFinite(option.max)) return option.max
    return null
  }

  /**
   * Puts the strength dial where this search wants it.
   *
   * Three cases, and the third is the one that matters. A search that asks for a weaker engine sets the dial. A
   * search that does not, on an engine whose dial Orbis has already turned down, sets it back to the engine's own
   * default -- otherwise a hint, an evaluation or a game review would quietly be answered by a weakened engine. And
   * a search that does not, on an engine whose dial has never been touched, does nothing at all.
   */
  private async setStrength(wanted: number | null): Promise<void> {
    const option = this.options.get(SKILL_OPTION)
    if (!option) {
      // Never sent to an engine that does not advertise it. A screen asks `handicapReach` to find this out and say so.
      if (wanted !== null) this.log(`this engine offers no "${SKILL_OPTION}", so nothing was held back for this search`)
      return
    }
    if (wanted === null && this.appliedSkill === null) return
    const target = wanted ?? this.fullStrengthDial(option)
    if (target === null) {
      this.log(`this engine published neither a default nor a maximum for "${SKILL_OPTION}", so it cannot be put back to full strength`)
      return
    }
    if (target === this.appliedSkill) return
    if (this.setOption(SKILL_OPTION, target) !== null) await this.ready()
  }

  // ------------------------------------------------------------ searching

  /** How many lines this engine can really be asked for. */
  multiPvCeiling(): number {
    const option = this.options.get('MultiPV')
    if (!option) return 1
    return Math.max(1, option.max ?? 1)
  }

  async search(job: {
    requestId: string
    fen: string
    limits: AnalysisLimits
    multipv: number
    newGame: boolean
    /** The strength dial for this search. Null means nothing held back, and puts a turned-down dial back. */
    skill: number | null
    emit: (update: AnalysisUpdate) => void
  }): Promise<AnalysisResult> {
    // A `go` while the engine still owes a `bestmove` produces one stream of answers to two questions.
    if (this.owed) await this.wait('owed', this.timeouts.stopMs, 'finish the search before this one')
    if (this.active) throw new ChessEngineError('bad-request', 'The engine is already searching.', true)

    const side = sideToMove(job.fen)
    if (job.newGame || !this.seenNewGame) {
      this.send('ucinewgame')
      this.seenNewGame = true
      await this.ready()
    }
    const wanted = Math.max(1, Math.min(this.multiPvCeiling(), Math.floor(job.multipv)))
    if (this.options.has('MultiPV') && wanted !== this.appliedMultiPv) {
      this.setOption('MultiPV', wanted)
      await this.ready()
    }
    // Both option changes happen here, between the wait for the last search and this one's `go`, because UCI is one
    // conversation: a `setoption` sent while a search is running belongs to neither search.
    await this.setStrength(job.skill)

    return new Promise<AnalysisResult>((resolve, reject) => {
      const budget = job.limits.movetime
        ? job.limits.movetime + this.timeouts.searchGraceMs
        : this.timeouts.maxSearchMs
      const search: ActiveSearch = {
        requestId: job.requestId,
        fen: job.fen,
        side,
        startedAt: Date.now(),
        emit: job.emit,
        settle: resolve,
        fail: reject,
        lines: new Map(),
        last: null,
        timer: null,
        done: false
      }
      search.timer = setTimeout(() => {
        if (search.done) return
        // Hung: the engine was asked for a bounded search and has not answered. The request fails now rather than
        // waiting for ever, and the process is left owing a bestmove so it is not reused until it has settled.
        this.abandon(search, new ChessEngineError('timeout', `The engine did not finish within ${budget} ms.`))
        try {
          this.send('stop')
        } catch {
          /* already gone; `close` has dealt with it */
        }
      }, budget)
      this.active = search
      try {
        this.send(`position fen ${job.fen}`)
        this.send(goCommand(job.limits))
      } catch (e) {
        this.abandon(search, e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /** Takes a search out of the running slot and fails it. The engine still owes a `bestmove` for it. */
  private abandon(search: ActiveSearch, error: Error): void {
    if (search.done) return
    search.done = true
    if (search.timer) clearTimeout(search.timer)
    /*
     * What it had reached is kept to one side before the search is thrown away.
     *
     * A search that was stopped halfway is not nothing: an engine told to stop at depth 14 has really looked
     * fourteen moves ahead. The request still fails -- nobody is handed a partial answer as though it finished --
     * but the numbers are available to whoever wants to keep them, marked as a search that did not finish. Without
     * this they are lost inside this object, which is why Chess World searched a position from nothing every time
     * somebody stepped through a game quickly.
     */
    this.abandoned = { requestId: search.requestId, info: search.lines.get(1) ?? search.last }
    if (this.active === search) {
      this.active = null
      this.owed = !this.gone
    }
    search.fail(error)
  }

  /**
   * What the last abandoned search had reached, if it is the one being asked about.
   *
   * Taken, not read: it is handed over once and forgotten, so the same partial can never be attached to a second
   * request. The request id has to match for the same reason every update here carries one.
   */
  takeAbandoned(requestId: string): AnalysisInfo | null {
    const held = this.abandoned
    if (!held || held.requestId !== requestId) return null
    this.abandoned = null
    return held.info
  }

  /**
   * Abandons the running search and waits for the engine to settle.
   *
   * Two separate things, which is the whole point. The request fails as soon as the cancel is asked for, so nothing is
   * waiting on it; the engine is not reusable until its `bestmove` has arrived, because a UCI engine that is still
   * finishing a search will answer the next `go` with a mixture of both. `false` comes back when it never settled, and
   * the caller restarts it rather than pretending it is idle.
   */
  async cancel(reason: Error): Promise<boolean> {
    const search = this.active
    if (search) {
      this.abandon(search, reason)
      try {
        this.send('stop')
      } catch {
        return true
      }
    }
    if (!this.owed) return true
    try {
      await this.wait('owed', this.timeouts.stopMs, 'answer "stop" with a move')
      return true
    } catch {
      return false
    }
  }

  /** `quit`, then make sure it is really gone. */
  async shutdown(killAfterMs = 2000): Promise<void> {
    if (this.gone) return
    try {
      this.send('quit')
    } catch {
      /* already closing */
    }
    const closed = new Promise<void>((resolve) => {
      if (this.gone) {
        resolve()
        return
      }
      this.child.once('close', () => resolve())
    })
    const timer = setTimeout(() => this.child.kill(), killAfterMs)
    try {
      await closed
    } finally {
      clearTimeout(timer)
    }
  }

  kill(): void {
    if (!this.gone) this.child.kill()
  }
}

// ---------------------------------------------------------------- the service

interface Job {
  requestId: string
  fen: string
  limits: AnalysisLimits
  multipv: number
  priority: 'interactive' | 'batch'
  newGame: boolean
  variant: string
  /** The strength dial for this search, or null for nothing held back. */
  skill: number | null
  useCache: boolean
  /**
   * When the engine really began searching, by Orbis's own clock.
   *
   * Set again just before the `go`, not when the request was queued. Waiting in the queue and starting the engine
   * are not thinking, and counting them would let a search that thought for no time at all be reused for somebody
   * who asked for two seconds of it.
   */
  startedAt: number
  signal?: AbortSignal
  emit: (update: AnalysisUpdate) => void
  resolve: (result: AnalysisResult) => void
  reject: (error: Error) => void
  /** Removes the abort listener, whatever happens. */
  release: () => void
}

/** Checks a request's limits. A search with no limit at all is refused rather than left to run for ever. */
export function cleanLimits(raw: AnalysisLimits | undefined): AnalysisLimits {
  const r = raw ?? {}
  const out: AnalysisLimits = {}
  const whole = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
  }
  const movetime = whole(r.movetime)
  const depth = whole(r.depth)
  const nodes = whole(r.nodes)
  if (movetime !== null) out.movetime = Math.min(600_000, movetime)
  if (depth !== null) out.depth = Math.min(99, depth)
  if (nodes !== null) out.nodes = Math.min(1e12, nodes)
  return out
}

// ---------------------------------------------------------------- turning answers into stored answers and back

/** Option values as the cache keys them: text, because that is what UCI sends and what the engine confirms. */
function asStrings(options: Record<string, string | number | boolean>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(options)) out[name] = String(value)
  return out
}

/** One line of a search, as it is kept. The notation is not kept: it is worked out again from the position. */
function toCachedLine(line: AnalysisInfo): CachedLine {
  return {
    multipv: line.multipv,
    score: line.score,
    depth: line.depth,
    seldepth: line.seldepth,
    nodes: line.nodes,
    timeMs: line.timeMs,
    bound: line.bound,
    pvUci: line.pvUci
  }
}

/**
 * A stored answer, as the answer a caller is waiting for.
 *
 * Everything readable is built again here against the position: the notation of each line, and the best move checked
 * for legality exactly as it was when the engine first offered it. A stored line that no longer plays in the
 * position -- which would mean the position and the key had come apart -- is dropped as notation and kept as
 * coordinates, the same refusal the live search makes, so the fault is visible instead of guessed at.
 */
export function resultFromEntry(entry: CachedAnalysis, requestId: string, fen: string): AnalysisResult {
  const asInfo = (line: CachedLine): AnalysisInfo => {
    const read = line.pvUci.length ? uciLineToSan(fen, [...line.pvUci]) : null
    return {
      requestId,
      fen,
      score: line.score,
      depth: line.depth,
      seldepth: line.seldepth,
      nodes: line.nodes,
      // How fast the machine was while it searched. A fact about that moment, not about this position, so it is
      // not kept and is not invented from the stored nodes and seconds either.
      nps: null,
      timeMs: line.timeMs,
      pvSan: read && read.legal ? read.san : null,
      pvUci: [...line.pvUci],
      multipv: line.multipv,
      bound: line.bound,
      complete: false
    }
  }
  const lines = entry.lines.map(asInfo)
  const topRead = entry.pvUci.length ? uciLineToSan(fen, [...entry.pvUci]) : null
  let bestmove: string | null = null
  let bestmoveSan: string | null = null
  let note = entry.note
  if (entry.bestmove) {
    const played = applyMove(fen, entry.bestmove)
    if (played) {
      bestmove = played.uci
      bestmoveSan = played.san
    } else {
      note = `The kept answer offered "${entry.bestmove}", which is not a legal move in this position, so it was not used.`
    }
  }
  return {
    requestId,
    fen,
    score: entry.score,
    depth: entry.depth,
    seldepth: entry.seldepth,
    nodes: entry.nodes,
    nps: null,
    timeMs: entry.timeMs,
    pvSan: topRead && topRead.legal ? topRead.san : null,
    pvUci: [...entry.pvUci],
    multipv: 1,
    bound: entry.bound,
    complete: true,
    bestmove,
    bestmoveSan,
    // What the engine expected in reply is not kept: it belongs to the search, and a ponder move is only ever used
    // while the engine is still running.
    ponder: null,
    lines,
    note,
    from: reusedFrom(entry)
  }
}

export class ChessEngine {
  private readonly o: ChessEngineOptions
  private readonly home: string
  private readonly timeouts: Timeouts
  private readonly platform: string
  private readonly cores: number
  private readonly memoryMb: number
  private process: EngineProcess | null = null
  private phase: EngineStateName = 'stopped'
  private detail = ''
  private lastError: string | null = null
  private recoverable = true
  private problem: string | null = null
  private record: InstallRecord | null = null
  private binary: { path: string; from: 'configured' | 'app-data' } | null = null
  private installing: Promise<InstallRecord> | null = null
  private startingUp: Promise<EngineProcess> | null = null
  private readonly queue: Job[] = []
  private current: Job | null = null
  private pumping = false
  private closing = false

  constructor(o: ChessEngineOptions = {}) {
    this.o = o
    this.home = o.home ?? process.env.ORBIS_CHESS_ENGINE_HOME ?? defaultHome()
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...(o.timeouts ?? {}) }
    this.platform = o.platform ?? process.platform
    this.cores = o.cores ?? availableParallelism()
    this.memoryMb = o.memoryMb ?? Math.round(totalmem() / (1024 * 1024))
  }

  get directory(): string {
    return this.home
  }

  private log(line: string): void {
    this.o.onLog?.(line.slice(0, 400))
  }

  private note(state: EngineStateName, detail: string): void {
    this.phase = state
    this.detail = detail
  }

  // ------------------------------------------------------------ finding a binary

  /**
   * The engine on this machine: the one the person pointed at, or the one `install` put in the app-data folder.
   *
   * A configured path that is wrong is reported as a problem rather than quietly falling back to the installed one.
   * Somebody who named a file meant that file, and silently analysing with a different engine is worse than saying so.
   */
  async discover(): Promise<{ path: string; from: 'configured' | 'app-data' } | null> {
    this.problem = null
    const configured = this.o.binaryPath ?? process.env.ORBIS_CHESS_ENGINE_PATH
    if (configured) {
      const check = checkBinaryPath(configured, { platform: this.platform })
      if (check.ok) {
        this.binary = { path: check.path, from: 'configured' }
        this.record = null
        return this.binary
      }
      this.problem = `The engine you chose cannot be used: ${check.why}.`
      this.binary = null
      return null
    }
    const installed = await readInstalled(this.home)
    if (installed.problem) this.problem = installed.problem
    if (!installed.record) {
      this.binary = null
      this.record = null
      return null
    }
    const path = join(this.home, installed.record.binary)
    const check = checkBinaryPath(path, { platform: this.platform })
    if (!check.ok) {
      this.problem = `The installed engine cannot be used: ${check.why}.`
      this.binary = null
      return null
    }
    this.record = installed.record
    this.binary = { path: check.path, from: 'app-data' }
    return this.binary
  }

  // ------------------------------------------------------------ installing

  /**
   * Downloads the engine into the app-data folder, verifies it, and keeps its licence beside it.
   *
   * Safe to repeat: an install that is already there and already the resolved version is left alone. Anything running
   * is stopped first -- a binary cannot be replaced underneath a process that is executing it.
   */
  install(onStatus?: (message: string) => void, signal?: AbortSignal): Promise<InstallRecord> {
    if (this.installing) return this.installing
    this.installing = (async () => {
      const say = (message: string): void => {
        this.detail = message
        this.log(message)
        onStatus?.(message)
      }
      const dir = this.home
      try {
        // Nothing may be running: a binary cannot be replaced underneath a process that is executing it.
        await this.shutdown()
        this.note('installing', 'Setting up the chess engine…')
        say('Looking up the engine’s latest release…')
        const release = await resolveRelease({ fetchFn: this.o.fetchFn, signal })
        const choice = chooseAsset(release, { platform: this.platform, arch: this.o.arch })
        if (!choice.asset) throw new InstallError('no-asset', choice.reason)
        const asset = choice.asset

        const existing = await readInstalled(dir)
        if (existing.record && existing.record.version === release.tag && existing.record.asset === asset.name) {
          this.record = existing.record
          say(`The engine is already installed (${release.tag}).`)
          this.note('stopped', `The engine is installed (${release.tag}) and not running.`)
          return existing.record
        }

        const archive = join(dir, 'download', asset.name)
        say(`Downloading ${asset.name} (${Math.round(asset.size / (1024 * 1024))} MB)…`)
        let lastPercent = -1
        const got = await downloadAsset(asset, archive, {
          fetchFn: this.o.fetchFn,
          signal,
          allowUnverified: this.o.allowUnverified === true,
          onProgress: ({ received, total }) => {
            if (!total) return
            const percent = Math.floor((received / total) * 100)
            if (percent === lastPercent || percent % 5 !== 0) return
            lastPercent = percent
            say(`Downloading the engine… ${percent}%`)
          }
        })
        say(got.verified ? 'Checking the download against the checksum upstream published…' : 'The release published no checksum; the download could not be verified.')
        say('Unpacking the engine and its licence…')
        const unpacked = await unpackEngine(archive, dir, { platform: this.platform })
        // The archive is around 80 MB and holds the whole source tree and a copy of the wiki; nothing reads it again.
        await rm(join(dir, 'download'), { recursive: true, force: true })

        const record: InstallRecord = {
          version: release.tag,
          asset: asset.name,
          archiveUrl: asset.url,
          sha256: got.sha256,
          verified: got.verified,
          bytes: got.bytes,
          binary: basename(unpacked.binary),
          licence: unpacked.licence ? LICENCE_NAME : null,
          licenceId: LICENCE_ID,
          sourceUrl: `${PROJECT_URL}/releases/tag/${release.tag}`,
          installedAt: Date.now()
        }
        await writeInstalled(dir, record)
        this.record = record
        this.binary = { path: unpacked.binary, from: 'app-data' }
        this.lastError = null
        if (!unpacked.licence) {
          say(`The archive carried no ${LICENCE_NAME}; the engine is ${LICENCE_ID} and its licence is at ${record.sourceUrl}.`)
        }
        say(`The engine is installed (${release.tag}).`)
        this.note('stopped', `The engine is installed (${release.tag}) and not running.`)
        return record
      } catch (e) {
        const message = e instanceof Error ? e.message : 'The engine could not be installed.'
        this.lastError = message
        this.recoverable = true
        this.note('failed', message)
        if (e instanceof InstallError || e instanceof ChessEngineError) throw e
        throw new ChessEngineError('install-failed', message)
      } finally {
        this.installing = null
      }
    })()
    return this.installing
  }

  // ------------------------------------------------------------ starting

  private async start(): Promise<EngineProcess> {
    if (this.process && !this.process.gone) return this.process
    if (this.startingUp) return this.startingUp
    this.startingUp = (async () => {
      const found = this.binary ?? (await this.discover())
      if (!found) {
        const why = this.problem ?? 'The chess engine has not been installed yet.'
        this.note('not-installed', why)
        throw new ChessEngineError('not-installed', why, true)
      }
      this.note('starting', 'Starting the chess engine…')
      let child: ChildProcess
      try {
        // An argument array, never a command string: the path is a path, not something a shell gets to interpret.
        child = (this.o.spawnFn ?? spawn)(found.path, [], {
          cwd: dirname(found.path),
          windowsHide: true,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } catch (e) {
        const message = `The chess engine could not be started: ${e instanceof Error ? e.message : String(e)}`
        this.lastError = message
        this.note('failed', message)
        throw new ChessEngineError('start-failed', message)
      }
      const engine = new EngineProcess(child, this.timeouts, (line) => this.log(line))
      this.process = engine
      try {
        this.note('handshaking', 'Asking the engine what it is and what it can do…')
        await engine.handshake()
        for (const [name, value] of Object.entries(this.defaultOptions(engine))) engine.setOption(name, value)
        await engine.ready()
      } catch (e) {
        engine.kill()
        if (this.process === engine) this.process = null
        const message = e instanceof Error ? e.message : 'The engine did not answer.'
        this.lastError = message
        this.note('failed', `The engine started but never finished saying hello: ${message}`)
        throw e instanceof ChessEngineError ? e : new ChessEngineError('handshake-failed', message)
      }
      child.on('close', () => {
        if (this.process !== engine) return
        this.process = null
        if (this.closing) {
          this.note('stopped', 'The engine is not running.')
          return
        }
        const detail = `${engine.exitDetail ?? 'the engine stopped'}${engine.stderrTail ? `. Its last words: ${engine.stderrTail}` : ''}`
        this.lastError = detail
        this.recoverable = true
        this.note('failed', `The engine stopped on its own: ${detail}`)
      })
      this.lastError = null
      this.note('ready', `${engine.name ?? 'The engine'} is ready.`)
      return engine
    })()
    try {
      return await this.startingUp
    } finally {
      this.startingUp = null
    }
  }

  /** The values Orbis sets, within what this engine says it takes. Anything it does not advertise is not sent. */
  private defaultOptions(engine: EngineProcess): Record<string, string | number | boolean> {
    const wanted: Record<string, string | number | boolean> = {
      Threads: defaultThreads(this.cores),
      Hash: defaultHash(this.memoryMb),
      MultiPV: 1,
      ...(this.o.options ?? {})
    }
    const out: Record<string, string | number | boolean> = {}
    for (const [name, value] of Object.entries(wanted)) if (engine.options.has(name)) out[name] = value
    return out
  }

  /**
   * Throws this engine away and lets the next request start a new one.
   *
   * Forceful on purpose. A restart is what happens when the engine is not answering, so asking it politely first
   * would mean waiting on exactly the thing that has stopped working. `shutdown` is the polite path, for quitting.
   */
  async restart(): Promise<void> {
    const engine = this.process
    this.process = null
    if (engine) engine.kill()
    this.note('stopped', 'The engine was restarted.')
  }

  // ------------------------------------------------------------ analysing

  /**
   * One position, analysed.
   *
   * Resolves with the engine's final answer; every update along the way goes to `onUpdate`, the last of them being
   * that same final answer, so a caller forwarding updates to a screen sees the whole search in one place.
   */
  analyse(request: AnalysisRequest): Promise<AnalysisResult> {
    if (this.closing) return Promise.reject(new ChessEngineError('shutting-down', 'Orbis is closing the engine.', false))
    const fen = String(request.fen ?? '').trim()
    const check = checkFen(fen)
    if (!check.ok) {
      return Promise.reject(new ChessEngineError('bad-request', check.reason ?? 'That is not a position the engine can be asked about.', false))
    }
    const limits = cleanLimits(request.limits)
    if (limits.movetime === undefined && limits.depth === undefined && limits.nodes === undefined) {
      return Promise.reject(
        new ChessEngineError('bad-request', 'An analysis needs a limit: a time to think for, a depth, or a number of positions.', false)
      )
    }
    const requestId = request.requestId ?? randomUUID()
    if (this.current?.requestId === requestId || this.queue.some((j) => j.requestId === requestId)) {
      return Promise.reject(
        new ChessEngineError('duplicate-request', `An analysis called "${requestId}" is already running, so a second one would be impossible to tell apart.`, false)
      )
    }
    const multipv = Math.max(1, Math.floor(Number(request.multipv) || 1))
    const variant = (request.variant || 'standard').trim().toLowerCase()
    /*
     * A weakened search is never kept and never served from what was kept.
     *
     * Two answers to the same position from the same engine at two different strengths are two different answers,
     * and the key an answer is stored under is built from the options the engine had applied -- which, around a
     * search that changes one of them, is read at two different moments. Rather than make that right, a search that
     * holds the engine back stays out of the store entirely: it is a move in a game you are playing, so nobody will
     * ever ask for it again, and the cost of searching it afresh is the hundred milliseconds it was given anyway.
     */
    // `typeof`, not `Number(...)`: `Number(null)` is 0, which is the weakest setting the dial has. A request that
    // said nothing about strength must mean nothing held back, never the gentlest engine there is.
    const skill = typeof request.skill === 'number' && Number.isFinite(request.skill) ? Math.floor(request.skill) : null
    const useCache = request.useCache !== false && skill === null
    const search = (): Promise<AnalysisResult> => this.queued(request, { requestId, fen, limits, multipv, variant, skill, useCache })
    /*
     * The stored answer first, and only then the engine.
     *
     * The lookup is its own step rather than part of the queue because a kept answer must not wait behind a search:
     * the whole point is that stepping back to a position you have already looked at costs nothing. If anything
     * about the lookup does not fit -- a different engine, not deep enough, a search that was stopped -- it is a
     * miss and the search runs exactly as it did before this existed.
     */
    if (!this.o.cache || !useCache) return search()
    return this.served({ requestId, fen, limits, multipv, variant }, request).then((hit) => {
      if (!hit) return search()
      /*
       * Cancelled while the stored answer was being looked for.
       *
       * Nothing is delivered and nothing is sent to the screen. Whatever asked has moved on -- the board is on the
       * next position -- and handing it an answer for the one it left is the fault Section 429 is about, free answer
       * or not. This is the only gate the answer passes through, which is why the update is sent from here rather
       * than from inside the lookup.
       */
      if (request.signal?.aborted) throw new ChessEngineError('cancelled', 'Cancelled.', false)
      // Sent as an update as well, so a screen following the search sees a kept answer arrive exactly where a fresh
      // one would have, and shows `from` beside it rather than claiming a search just happened.
      try {
        request.onUpdate?.(hit)
      } catch (e) {
        this.log(`an update listener threw: ${e instanceof Error ? e.message : String(e)}`)
      }
      return hit
    })
  }

  /** The request as it was really asked, once the sync checks have passed. */
  private queued(
    request: AnalysisRequest,
    o: { requestId: string; fen: string; limits: AnalysisLimits; multipv: number; variant: string; skill: number | null; useCache: boolean }
  ): Promise<AnalysisResult> {
    const { requestId, fen, limits } = o
    return new Promise<AnalysisResult>((resolve, reject) => {
      let listener: (() => void) | null = null
      const job: Job = {
        requestId,
        fen,
        limits,
        multipv: o.multipv,
        priority: request.priority === 'batch' ? 'batch' : 'interactive',
        newGame: request.newGame === true,
        variant: o.variant,
        skill: o.skill,
        useCache: o.useCache,
        startedAt: Date.now(),
        signal: request.signal,
        emit: (update) => {
          try {
            request.onUpdate?.(update)
          } catch (e) {
            this.log(`an update listener threw: ${e instanceof Error ? e.message : String(e)}`)
          }
        },
        resolve,
        reject,
        release: () => {
          if (listener) request.signal?.removeEventListener('abort', listener)
          listener = null
        }
      }
      if (request.signal) {
        listener = () => {
          // Still waiting its turn: it leaves the queue and nothing is ever sent to the engine for it.
          const at = this.queue.indexOf(job)
          if (at >= 0) {
            this.queue.splice(at, 1)
            job.release()
            reject(new ChessEngineError('cancelled', 'Cancelled.', false))
            return
          }
          if (this.current === job) void this.cancelCurrent(new ChessEngineError('cancelled', 'Cancelled.', false))
        }
        if (request.signal.aborted) {
          job.release()
          reject(new ChessEngineError('cancelled', 'Cancelled.', false))
          return
        }
        request.signal.addEventListener('abort', listener, { once: true })
      }
      this.queue.push(job)
      this.pump()
    })
  }

  // ------------------------------------------------------------ keeping and reusing answers

  /**
   * Which engine an answer would come from.
   *
   * Readable without starting the engine, deliberately: a kept answer must not cost a process start, which is most
   * of what it was saving. The release tag comes from the install record and the build from the binary on disk --
   * both facts Orbis established. The name is the engine's own claim about itself and is only there once one has
   * shaken hands, so it is recorded as provenance and is never part of deciding whether an answer may be reused.
   *
   * Null when there is nothing to identify: no engine, no key, no cache. An evaluation that cannot say which engine
   * produced it could never be judged usable, so it is better not stored at all.
   */
  engineIdentity(): EngineIdentity | null {
    const version = this.record?.version ?? null
    let build: string | null = null
    if (this.binary) {
      try {
        const stat = statSync(this.binary.path)
        // Where it is, how big it is and when it was written. Enough to notice a different engine put at the same
        // path, which is exactly what somebody doing their own build does.
        build = `${this.binary.path}:${stat.size}:${Math.round(stat.mtimeMs)}`
      } catch {
        build = this.binary.path
      }
    }
    if (!version && !build) return null
    return {
      name: this.process && !this.process.gone ? this.process.name : null,
      version,
      build,
      /*
       * What the engine really accepted, once it is running. Before that, what Orbis was told to set on it -- which
       * is the same thing for every option the engine advertises. The one case where the two differ is an option
       * the engine refuses, and that costs one wasted search on the first analysis of a session rather than a wrong
       * answer, because a mismatch here is always a miss.
       */
      applied: this.process ? Object.fromEntries(this.process.applied) : asStrings(this.o.options ?? {})
    }
  }

  /** What a lookup is asking about. */
  private askFor(o: { fen: string; limits: AnalysisLimits; multipv: number; variant: string; scope: AnalysisScope }): AnalysisAsk | null {
    const engine = this.engineIdentity()
    if (!engine) return null
    return { fen: o.fen, limits: o.limits, lines: o.multipv, variant: o.variant, engine, scope: o.scope }
  }

  /**
   * A stored answer, turned back into the answer the caller is waiting for, or null for a miss.
   *
   * The notation of every line is worked out again here, against the position, rather than stored: `rules.ts` is the
   * one module that decides what a move is, and keeping a second copy of its answer in a database is how the two
   * drift apart. `nps` is not kept at all -- it is how fast the machine was at the time, which says nothing about a
   * position -- so it comes back as null rather than as a figure made up from the stored nodes and seconds.
   */
  private async served(
    o: { requestId: string; fen: string; limits: AnalysisLimits; multipv: number; variant: string },
    request: AnalysisRequest
  ): Promise<AnalysisResult | null> {
    const cache = this.o.cache
    if (!cache) return null
    try {
      // Reads the install record if it has not been read. A file read, not a process start.
      if (!this.installing && !this.binary && !this.record) await this.discover()
      const ask = this.askFor({ ...o, scope: request.priority === 'batch' ? 'game-sweep' : 'position' })
      if (!ask) return null
      const look = cache.look(ask)
      if (look.kind !== 'hit') {
        if (look.explain) this.log(`no stored answer for this position: ${look.explain}`)
        return null
      }
      // Built, not sent: `analyse` above is the one place that decides whether this answer is still wanted.
      return resultFromEntry(look.entry, o.requestId, o.fen)
    } catch (e) {
      // A cache is never allowed to break an analysis. Whatever went wrong, the search runs.
      this.log(`looking for a stored answer failed, so the position is being searched: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /** Keeps what a search found, if there is somewhere to keep it. Never throws into the search's own path. */
  private remember(job: Job, found: AnalysisBase, o: { status: CachedAnalysis['status']; stoppedBecause: string | null; bestmove: string | null; note: string | null; lines: readonly AnalysisInfo[] }): void {
    const cache = this.o.cache
    if (!cache || !job.useCache) return
    try {
      const ask = this.askFor({
        fen: job.fen,
        limits: job.limits,
        multipv: job.multipv,
        variant: job.variant,
        scope: job.priority === 'batch' ? 'game-sweep' : 'position'
      })
      if (!ask) return
      const key = keyFor(ask)
      if (key.kind === 'no-key') return
      const at = Date.now()
      const entry: CachedAnalysis = {
        schema: CACHE_SCHEMA,
        bucket: key.key.bucket,
        request: key.key.request,
        fen: job.fen,
        position: key.key.position,
        halfmove: halfmoveOf(job.fen),
        variant: key.key.variant,
        engineName: ask.engine.name,
        engineVersion: ask.engine.version,
        engineBuild: ask.engine.build,
        options: key.key.options,
        asked: job.limits,
        askedLines: job.multipv,
        scope: ask.scope,
        score: found.score,
        depth: found.depth,
        seldepth: found.seldepth,
        nodes: found.nodes,
        timeMs: found.timeMs,
        // Orbis's own clock, which is the only figure that can honestly be weighed against a time limit: the
        // engine's own is the time at the moment it printed the line, and is always a little short of the search.
        elapsedMs: Math.max(0, at - job.startedAt),
        bound: found.bound,
        bestmove: o.bestmove,
        pvUci: found.pvUci,
        lines: o.lines.map(toCachedLine),
        status: o.status,
        stoppedBecause: o.stoppedBecause,
        note: o.note,
        trimmedBecause: null,
        createdAt: at,
        lastUsedAt: at,
        uses: 0,
        pinned: false,
        bytes: 0
      }
      const kept = cache.keep(entry)
      if (kept.kind === 'refused') this.log(`that answer was not kept: ${kept.because}`)
    } catch (e) {
      this.log(`keeping that answer failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** The next request to run: anything interactive before anything batched, and first in first out within each. */
  private take(): Job | null {
    const at = this.queue.findIndex((j) => j.priority === 'interactive')
    const index = at >= 0 ? at : this.queue.length ? 0 : -1
    if (index < 0) return null
    return this.queue.splice(index, 1)[0]
  }

  private pump(): void {
    if (this.pumping) return
    this.pumping = true
    void (async () => {
      try {
        for (;;) {
          const job = this.take()
          if (!job) return
          this.current = job
          try {
            if (job.signal?.aborted) throw new ChessEngineError('cancelled', 'Cancelled.', false)
            const engine = await this.start()
            this.note('searching', 'Thinking about the position…')
            // From here, not from when it was queued: see `Job.startedAt`.
            job.startedAt = Date.now()
            const result = await engine.search({
              requestId: job.requestId,
              fen: job.fen,
              limits: job.limits,
              multipv: job.multipv,
              newGame: job.newGame,
              skill: job.skill,
              emit: job.emit
            })
            if (this.phase === 'searching') this.note('ready', `${engine.name ?? 'The engine'} is ready.`)
            // Kept before the caller is told, so a second ask for the same position in the same breath finds it.
            this.remember(job, result, {
              status: 'complete',
              stoppedBecause: null,
              bestmove: result.bestmove,
              note: result.note,
              lines: result.lines
            })
            job.resolve(result)
          } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e))
            /*
             * A search that was stopped is kept as a search that was stopped.
             *
             * It is marked `cancelled`, so nothing will ever serve it as an answer -- `servable` refuses it outright.
             * It is kept anyway for two reasons: it is the first thing evicted when room is needed, so it costs
             * almost nothing; and a cache that shows how many searches were interrupted is a cache that shows
             * somebody clicking through a game faster than the engine can answer, which is worth knowing.
             */
            const partial = this.process?.takeAbandoned(job.requestId) ?? null
            if (partial) {
              this.remember(job, partial, {
                status: error instanceof ChessEngineError && (error.code === 'cancelled' || error.code === 'timeout') ? 'cancelled' : 'failed',
                stoppedBecause: error.message,
                bestmove: null,
                note: null,
                lines: []
              })
            }
            if (error instanceof ChessEngineError && error.code !== 'cancelled') {
              this.lastError = error.message
              this.recoverable = error.recoverable
            }
            if (this.phase === 'searching' || this.phase === 'stopping') {
              this.note(this.process && !this.process.gone ? 'ready' : 'failed', error.message)
            }
            job.reject(error)
            /*
             * A search that ran over its own limit was told to stop. Whether the engine may be used again depends on
             * whether it answers: until its `bestmove` arrives it is mid-sentence, and the next `go` would be answered
             * with a mixture of two searches. So it is given the stop timeout to settle, and replaced if it does not.
             *
             * Only a timeout is escalated here. A cancel -- from `stop` or an abort signal -- is settled by whoever
             * asked for it, which is the only place that knows it is still waiting on the answer.
             */
            if (error instanceof ChessEngineError && error.code === 'timeout' && this.process?.owing) {
              if (!(await this.process.cancel(error))) {
                this.log('the engine never finished the search it was told to stop, so it is being restarted')
                await this.restart()
              }
            }
          } finally {
            job.release()
            this.current = null
          }
        }
      } finally {
        this.pumping = false
        // Something may have been queued in the gap between the last job finishing and the loop ending.
        if (this.queue.length) this.pump()
      }
    })()
  }

  private async cancelCurrent(reason: ChessEngineError): Promise<void> {
    const engine = this.process
    if (!engine) return
    this.note('stopping', 'Stopping the search…')
    const settled = await engine.cancel(reason)
    if (settled) {
      this.note(engine.gone ? 'failed' : 'ready', engine.gone ? (engine.exitDetail ?? 'The engine stopped.') : `${engine.name ?? 'The engine'} is ready.`)
      return
    }
    // It was told to stop and never answered. It is not idle, whatever it looks like, so it is replaced.
    this.log('the engine did not answer "stop", so it is being restarted')
    await this.restart()
  }

  /** Cancels one analysis, whether it is running or still waiting its turn. */
  async stop(requestId?: string): Promise<void> {
    if (requestId !== undefined) {
      const at = this.queue.findIndex((j) => j.requestId === requestId)
      if (at >= 0) {
        const [job] = this.queue.splice(at, 1)
        job.release()
        job.reject(new ChessEngineError('cancelled', 'Cancelled.', false))
        return
      }
      if (this.current?.requestId !== requestId) return
    }
    await this.cancelCurrent(new ChessEngineError('cancelled', 'Cancelled.', false))
  }

  /** Cancels everything: the running search and everything waiting. */
  async stopAll(): Promise<void> {
    const waiting = this.queue.splice(0, this.queue.length)
    for (const job of waiting) {
      job.release()
      job.reject(new ChessEngineError('cancelled', 'Cancelled.', false))
    }
    if (this.current) await this.cancelCurrent(new ChessEngineError('cancelled', 'Cancelled.', false))
  }

  /** Ends the engine process. Used when the engine is being replaced and when Orbis is closing. */
  async shutdown(): Promise<void> {
    this.closing = true
    try {
      await this.stopAll()
      const engine = this.process
      this.process = null
      if (engine) await engine.shutdown()
      this.note(this.binary || existsSync(join(this.home, MARKER)) ? 'stopped' : 'not-installed', 'The engine is not running.')
    } finally {
      this.closing = false
    }
  }

  /** Sets an option on the running engine, clamped to what it advertises, and makes sure it took effect. */
  async setOption(name: string, value: string | number | boolean): Promise<string | null> {
    if (this.current || this.queue.length) {
      throw new ChessEngineError('bad-request', 'An option cannot be changed while the engine is searching.', false)
    }
    const engine = await this.start()
    const applied = engine.setOption(name, value)
    if (applied !== null) await engine.ready()
    return applied
  }

  /** What the engine advertised, in this process. Empty before a handshake: nothing here is assumed. */
  advertised(): EngineOption[] {
    return this.process ? [...this.process.options.values()] : []
  }

  /**
   * What is really going on.
   *
   * `ready` means a handshake completed in this process, not that a file is on disk. The name and author are what the
   * engine said about itself; `installedVersion` is the release tag that was downloaded, which is a different kind of
   * fact and is labelled as one.
   */
  async status(): Promise<EngineStatus> {
    if (!this.installing && !this.process) await this.discover()
    const engine = this.process
    let state = this.phase
    if (this.installing) state = 'installing'
    else if (this.binary && state === 'not-installed') state = 'stopped'
    else if (!this.binary && (state === 'stopped' || state === 'ready')) state = 'not-installed'
    if (state === 'not-installed' && !this.detail) this.detail = 'The chess engine has not been installed yet.'
    return {
      state,
      detail: this.detail || (state === 'ready' ? 'The engine is ready.' : ''),
      name: engine && !engine.gone ? engine.name : null,
      author: engine && !engine.gone ? engine.author : null,
      installedVersion: this.record?.version ?? null,
      verified: this.record ? this.record.verified : null,
      binaryPath: this.binary?.path ?? null,
      binaryFrom: this.binary?.from ?? null,
      licencePath: this.record?.licence ? join(this.home, this.record.licence) : null,
      licenceId: this.record?.licenceId ?? null,
      sourceUrl: this.record?.sourceUrl ?? `${PROJECT_URL}/releases/tag/${KNOWN_TAG}`,
      options: this.advertised(),
      applied: engine ? Object.fromEntries(engine.applied) : {},
      searching: engine?.searching ?? null,
      queued: this.queue.length,
      lastError: this.lastError,
      recoverable: this.recoverable,
      problem: this.problem
    }
  }
}

/** The one engine for this process, built the first time it is asked for. */
let shared: ChessEngine | null = null

export function sharedChessEngine(o: ChessEngineOptions = {}): ChessEngine {
  if (!shared) shared = new ChessEngine(o)
  return shared
}

/** Replaces the shared engine. For tests, and for a settings change that moves where the engine lives. */
export function setSharedChessEngine(engine: ChessEngine | null): void {
  shared = engine
}
