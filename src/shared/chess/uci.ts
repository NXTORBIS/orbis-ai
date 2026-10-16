
/**
 * Reading what a chess engine says.
 *
 * Pure text in, structured facts out: no process, no network, so every odd line an engine has ever printed can be put
 * through it in a test. Three rules hold throughout (Sections 311-320):
 *
 *   - Every field is optional. A line with a depth and no score is not a score of zero.
 *   - Unknown fields are skipped, not guessed at. Engines add fields between versions.
 *   - A score is kept as the engine gave it, from the side to move. Turning it round is the caller's job, done once,
 *     at the edge (`fromEngine`), so the convention cannot drift apart in two places.
 */

export interface InfoLine {
  depth?: number
  seldepth?: number
  multipv?: number
  /** From the side to move, as the engine reports it. */
  score?: { kind: 'cp'; cp: number } | { kind: 'mate'; moves: number }
  /** True when the engine says this score is only a bound, so it is not a settled evaluation. */
  bound?: 'lower' | 'upper'
  nodes?: number
  nps?: number
  /** Milliseconds, as the engine reports them. */
  time?: number
  hashfull?: number
  tbhits?: number
  /** The line, in the engine's own coordinate notation ("e2e4", "e7e8q"). Not yet checked for legality. */
  pv?: string[]
  currmove?: string
  currmovenumber?: number
  /** Anything the engine said that this parser does not model, kept for diagnostics. */
  rest?: string
}

export type EngineMessage =
  | { type: 'id'; name?: string; author?: string }
  | { type: 'uciok' }
  | { type: 'readyok' }
  | { type: 'option'; option: EngineOption }
  | { type: 'info'; info: InfoLine }
  | { type: 'bestmove'; move: string | null; ponder?: string }
  | { type: 'other'; line: string }

export interface EngineOption {
  name: string
  type: 'check' | 'spin' | 'combo' | 'button' | 'string'
  default?: string
  min?: number
  max?: number
  vars?: string[]
}

const int = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}

/** The words that start a new field in an `info` line. Everything else belongs to the field before it. */
const INFO_KEYS = new Set([
  'depth', 'seldepth', 'multipv', 'score', 'nodes', 'nps', 'time', 'hashfull', 'tbhits', 'pv', 'currmove',
  'currmovenumber', 'cpuload', 'string', 'refutation', 'currline', 'lowerbound', 'upperbound'
])

export function parseInfo(line: string): InfoLine {
  const parts = line.trim().split(/\s+/)
  const info: InfoLine = {}
  const unknown: string[] = []
  let i = parts[0] === 'info' ? 1 : 0
  while (i < parts.length) {
    const key = parts[i]
    i += 1
    switch (key) {
      case 'depth': info.depth = int(parts[i]); i += 1; break
      case 'seldepth': info.seldepth = int(parts[i]); i += 1; break
      case 'multipv': info.multipv = int(parts[i]); i += 1; break
      case 'nodes': info.nodes = int(parts[i]); i += 1; break
      case 'nps': info.nps = int(parts[i]); i += 1; break
      case 'time': info.time = int(parts[i]); i += 1; break
      case 'hashfull': info.hashfull = int(parts[i]); i += 1; break
      case 'tbhits': info.tbhits = int(parts[i]); i += 1; break
      case 'currmove': info.currmove = parts[i]; i += 1; break
      case 'currmovenumber': info.currmovenumber = int(parts[i]); i += 1; break
      case 'lowerbound': info.bound = 'lower'; break
      case 'upperbound': info.bound = 'upper'; break
      case 'score': {
        const kind = parts[i]
        const value = int(parts[i + 1])
        i += 2
        if (kind === 'cp' && value !== undefined) info.score = { kind: 'cp', cp: value }
        else if (kind === 'mate' && value !== undefined) info.score = { kind: 'mate', moves: value }
        // A bound can follow the score rather than stand on its own.
        if (parts[i] === 'lowerbound') { info.bound = 'lower'; i += 1 }
        else if (parts[i] === 'upperbound') { info.bound = 'upper'; i += 1 }
        break
      }
      case 'pv': {
        const moves: string[] = []
        while (i < parts.length && !INFO_KEYS.has(parts[i])) { moves.push(parts[i]); i += 1 }
        if (moves.length) info.pv = moves
        break
      }
      case 'string': {
        // Everything after `string` is free text the engine wanted to say.
        unknown.push(parts.slice(i).join(' '))
        i = parts.length
        break
      }
      default: {
        // An unmodelled field: keep its words for diagnostics, and stop at the next field we do know.
        const words = [key]
        while (i < parts.length && !INFO_KEYS.has(parts[i])) { words.push(parts[i]); i += 1 }
        unknown.push(words.join(' '))
      }
    }
  }
  if (unknown.length) info.rest = unknown.join(' | ').slice(0, 500)
  return info
}

function parseOption(line: string): EngineOption | null {
  // option name Hash type spin default 16 min 1 max 33554432
  const m = /^option\s+name\s+(.+?)\s+type\s+(check|spin|combo|button|string)(.*)$/.exec(line.trim())
  if (!m) return null
  const option: EngineOption = { name: m[1], type: m[2] as EngineOption['type'] }
  const tail = m[3] ?? ''
  const def = /\sdefault\s+(.*?)(?=\s(?:min|max|var)\s|$)/.exec(tail)
  if (def) option.default = def[1].trim()
  const min = /\smin\s+(-?\d+)/.exec(tail)
  if (min) option.min = Number.parseInt(min[1], 10)
  const max = /\smax\s+(-?\d+)/.exec(tail)
  if (max) option.max = Number.parseInt(max[1], 10)
  const vars = [...tail.matchAll(/\svar\s+(.*?)(?=\s(?:var|min|max|default)\s|$)/g)].map((v) => v[1].trim()).filter(Boolean)
  if (vars.length) option.vars = vars
  return option
}

/** One line from the engine, read. Anything unrecognised comes back as `other` rather than being dropped. */
export function parseLine(line: string): EngineMessage {
  const text = line.trim()
  if (!text) return { type: 'other', line: '' }
  if (text === 'uciok') return { type: 'uciok' }
  if (text === 'readyok') return { type: 'readyok' }
  if (text.startsWith('id ')) {
    const name = /^id\s+name\s+(.+)$/.exec(text)
    if (name) return { type: 'id', name: name[1].trim() }
    const author = /^id\s+author\s+(.+)$/.exec(text)
    if (author) return { type: 'id', author: author[1].trim() }
    return { type: 'other', line: text }
  }
  if (text.startsWith('option ')) {
    const option = parseOption(text)
    return option ? { type: 'option', option } : { type: 'other', line: text }
  }
  if (text.startsWith('bestmove')) {
    const m = /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(text)
    if (!m) return { type: 'bestmove', move: null }
    // "(none)" is what an engine says in a position with no legal move; it is not a move.
    const move = m[1] === '(none)' || m[1] === '0000' ? null : m[1]
    return { type: 'bestmove', move, ...(m[2] ? { ponder: m[2] } : {}) }
  }
  if (text.startsWith('info')) return { type: 'info', info: parseInfo(text) }
  return { type: 'other', line: text }
}

/**
 * Turning a byte stream into whole lines.
 *
 * A read from a pipe is not a line: it can hold half a line, three lines, or a line split across two reads. Feeding
 * fragments to the parser is how an engine's evaluation silently goes missing, so the splitting happens here and is
 * tested on its own (Section 315).
 */
export class LineReader {
  private buffer = ''
  private readonly limit: number

  constructor(limit = 1_000_000) { this.limit = limit }

  push(chunk: string): string[] {
    this.buffer += chunk
    if (this.buffer.length > this.limit) {
      // A line this long is not something an engine meant to say; keep the tail and carry on rather than grow forever.
      this.buffer = this.buffer.slice(-this.limit)
    }
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    return lines.filter((l) => l.trim().length > 0)
  }

  /** What is left when the stream closes. */
  flush(): string[] {
    const rest = this.buffer.trim()
    this.buffer = ''
    return rest ? [rest] : []
  }
}

/** Builds a `go` command from limits, leaving out anything the caller did not ask for. */
export function goCommand(limits: { movetime?: number; depth?: number; nodes?: number; infinite?: boolean }): string {
  const parts = ['go']
  if (limits.infinite) parts.push('infinite')
  if (limits.movetime !== undefined && limits.movetime > 0) parts.push('movetime', String(Math.round(limits.movetime)))
  if (limits.depth !== undefined && limits.depth > 0) parts.push('depth', String(Math.round(limits.depth)))
  if (limits.nodes !== undefined && limits.nodes > 0) parts.push('nodes', String(Math.round(limits.nodes)))
  return parts.join(' ')
}

/** A value is safe to send as an option only if it cannot break the line it is sent on. */
export function safeOptionValue(value: string | number | boolean): string | null {
  const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
  if (text.length > 200 || /[\r\n]/.test(text)) return null
  return text
}
