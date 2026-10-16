import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { deflateRawSync } from 'node:zlib'
import type { ChildProcess } from 'node:child_process'
import { START_FEN } from '../../shared/chess/rules.ts'
import { ZipWriter } from '../../shared/portable/zip.ts'
import {
  ChessEngine,
  ChessEngineError,
  cleanLimits,
  clampOption,
  defaultHash,
  defaultThreads,
  type AnalysisUpdate
} from './engine.ts'

/**
 * The whole engine lifecycle, driven against a scripted engine process.
 *
 * The process is a fake: a pair of pipes and a function that decides what the engine says back. That is not a
 * shortcut, it is the only way to test the things that actually go wrong. A real Stockfish cannot be made to split a
 * line across two reads, answer `isready` and then die, print an unplayable variation, or ignore `stop` -- and those
 * are exactly the cases where an analysis board silently shows the wrong number or waits for ever.
 *
 * Every test here therefore scripts a specific misbehaviour and checks what Orbis does with it.
 */

// ---------------------------------------------------------------- the scripted engine

/** What Stockfish really advertises, shortened: enough shapes to exercise the option handling. */
const OPTION_LINES = [
  'option name Debug Log File type string default',
  'option name NumaPolicy type string default auto',
  'option name Threads type spin default 1 min 1 max 1024',
  'option name Hash type spin default 16 min 1 max 33554432',
  'option name Clear Hash type button',
  'option name Ponder type check default false',
  'option name MultiPV type spin default 1 min 1 max 256',
  'option name Skill Level type spin default 20 min 0 max 20',
  'option name UCI_Chess960 type check default false',
  'option name UCI_Variant type combo default chess var chess var crazyhouse',
  'option name EvalFile type string default nn-1111cefa1111.nnue'
]

class Fake extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly commands: string[] = []
  /** How often a `go` arrived while an earlier one had not been answered. Must stay zero. */
  overlaps = 0
  killed = false
  closed = false
  handler: (self: Fake, command: string) => void = () => undefined
  private searching = false
  private rest = ''

  constructor() {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      this.rest += chunk.toString('utf8')
      const parts = this.rest.split('\n')
      this.rest = parts.pop() ?? ''
      for (const part of parts) {
        const command = part.trim()
        if (!command) continue
        this.commands.push(command)
        if (command.startsWith('go')) {
          if (this.searching) this.overlaps += 1
          this.searching = true
        }
        this.handler(this, command)
      }
    })
  }

  /** Raw bytes, so a test can cut a line in half. */
  say(text: string): void {
    if (!this.closed) this.stdout.write(text)
  }

  line(text: string): void {
    if (text.startsWith('bestmove')) this.searching = false
    this.say(`${text}\n`)
  }

  err(text: string): void {
    if (!this.closed) this.stderr.write(`${text}\n`)
  }

  die(code: number | null, signal: string | null = null): void {
    if (this.closed) return
    this.closed = true
    this.searching = false
    this.stdout.end()
    this.stderr.end()
    setTimeout(() => this.emit('close', code, signal), 0)
  }

  kill(): boolean {
    this.killed = true
    this.die(null, 'SIGTERM')
    return true
  }

  /** The commands of one kind, for asserting what was and was not sent. */
  sent(prefix: string): string[] {
    return this.commands.filter((c) => c.startsWith(prefix))
  }
}

/** Answers everything that is not a search. Returns false for anything a test is expected to script itself. */
function housekeeping(f: Fake, command: string): boolean {
  if (command === 'uci') {
    f.line('Fakefish 1.2 by the Orbis test suite')
    f.line('id name Fakefish 1.2')
    f.line('id author The Orbis test suite')
    for (const line of OPTION_LINES) f.line(line)
    f.line('uciok')
    return true
  }
  if (command === 'isready') {
    f.line('readyok')
    return true
  }
  if (command === 'quit') {
    f.die(0)
    return true
  }
  return command === 'ucinewgame' || command.startsWith('setoption') || command.startsWith('position')
}

/** A search that answers straight away, the way a short `movetime` does. */
function prompt(f: Fake, command: string): void {
  if (housekeeping(f, command)) return
  if (command.startsWith('go')) {
    f.line('info depth 1 seldepth 1 multipv 1 score cp 13 nodes 20 nps 20000 time 1 pv e2e4')
    f.line('info depth 12 seldepth 16 multipv 1 score cp 24 nodes 123456 nps 987654 time 125 hashfull 12 tbhits 0 pv e2e4 e7e5 g1f3')
    f.line('bestmove e2e4 ponder e7e5')
  }
}

const MARKER_RECORD = {
  version: 'sf_19',
  asset: 'stockfish-windows-x86-64-universal.zip',
  archiveUrl: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip',
  sha256: 'a'.repeat(64),
  verified: true,
  bytes: 81431614,
  binary: 'stockfish-windows-x86-64-universal.exe',
  licence: 'Copying.txt',
  licenceId: 'GPL-3.0-or-later',
  sourceUrl: 'https://github.com/official-stockfish/Stockfish/releases/tag/sf_19',
  installedAt: 1760000000000
}

/** A folder that looks installed. The binary is never run: `spawnFn` is replaced. */
function installedHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-chess-engine-'))
  writeFileSync(join(dir, MARKER_RECORD.binary), 'not really a program')
  writeFileSync(join(dir, 'Copying.txt'), 'GNU GENERAL PUBLIC LICENSE Version 3')
  writeFileSync(join(dir, 'installed.json'), JSON.stringify(MARKER_RECORD))
  return dir
}

interface Harness {
  engine: ChessEngine
  dir: string
  fakes: Fake[]
  last: () => Fake
  /**
   * Changes how the engine behaves from now on, for the process that is running and for any started after it.
   *
   * Set on every process rather than on one of them, because a test that scripts a crash and then expects a recovery
   * is testing the engine Orbis starts *next* -- and setting the behaviour on the dead one proves nothing.
   */
  behave: (handler: (f: Fake, command: string) => void) => void
}

function harness(o: {
  handler?: (f: Fake, command: string) => void
  home?: string
  cores?: number
  memoryMb?: number
  options?: Record<string, string | number | boolean>
  binaryPath?: string
  timeouts?: Partial<{ handshakeMs: number; readyMs: number; stopMs: number; searchGraceMs: number; maxSearchMs: number }>
  optionLines?: string[]
} = {}): Harness {
  const dir = o.home ?? installedHome()
  const fakes: Fake[] = []
  let handler = o.handler ?? prompt
  const engine = new ChessEngine({
    home: dir,
    platform: 'win32',
    cores: o.cores ?? 10,
    memoryMb: o.memoryMb ?? 16384,
    options: o.options,
    binaryPath: o.binaryPath,
    timeouts: { handshakeMs: 2000, readyMs: 2000, stopMs: 300, searchGraceMs: 120, maxSearchMs: 1500, ...(o.timeouts ?? {}) },
    spawnFn: (() => {
      const f = new Fake()
      f.handler = (self, command) => handler(self, command)
      fakes.push(f)
      return f as unknown as ChildProcess
    }) as never,
    onLog: () => undefined
  })
  return {
    engine,
    dir,
    fakes,
    last: () => fakes[fakes.length - 1],
    behave: (next) => {
      handler = next
    }
  }
}

const settle = (p: Promise<unknown>): Promise<unknown> => p.then((v) => v, (e: unknown) => e)
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- the pure parts

test('threads and memory are sized for a laptop, and never take every core', () => {
  // The machine this was written for: 10 logical processors. Half of them, so the rest of Orbis stays responsive.
  assert.equal(defaultThreads(10), 5)
  assert.equal(defaultThreads(12), 6)
  assert.equal(defaultThreads(2), 1)
  assert.equal(defaultThreads(1), 1)
  assert.equal(defaultThreads(0), 1)
  assert.equal(defaultThreads(Number.NaN), 1)
  // Never all of them, however many there are.
  for (const cores of [1, 2, 4, 8, 10, 12, 16, 32, 64]) assert.ok(defaultThreads(cores) < cores || cores === 1, String(cores))
  assert.equal(defaultHash(16384), 512)
  assert.equal(defaultHash(8192), 256)
  assert.equal(defaultHash(1024), 32)
  assert.equal(defaultHash(256), 16)
  assert.equal(defaultHash(0), 64)
})

test('an option value is kept inside what the engine said it accepts, or not sent at all', () => {
  const spin = { name: 'Threads', type: 'spin' as const, min: 1, max: 4 }
  assert.equal(clampOption(spin, 64), '4')
  assert.equal(clampOption(spin, 0), '1')
  assert.equal(clampOption(spin, 2.6), '3')
  assert.equal(clampOption(spin, 'nonsense'), null)
  assert.equal(clampOption({ name: 'Ponder', type: 'check' }, true), 'true')
  assert.equal(clampOption({ name: 'Ponder', type: 'check' }, 'TRUE'), 'true')
  assert.equal(clampOption({ name: 'Ponder', type: 'check' }, 'yes'), null)
  const combo = { name: 'UCI_Variant', type: 'combo' as const, vars: ['chess', 'crazyhouse'] }
  assert.equal(clampOption(combo, 'crazyhouse'), 'crazyhouse')
  assert.equal(clampOption(combo, 'shogi'), null)
  // A button is pressed, not set: there is no value it could be given.
  assert.equal(clampOption({ name: 'Clear Hash', type: 'button' }, 1), null)
  // A value that could break the line it is sent on is refused by `safeOptionValue`, not escaped.
  assert.equal(clampOption({ name: 'Debug Log File', type: 'string' }, 'a\nquit'), null)
  assert.equal(clampOption({ name: 'Debug Log File', type: 'string' }, 'log.txt'), 'log.txt')
})

test('limits are read defensively, and nonsense does not become an unbounded search', () => {
  assert.deepEqual(cleanLimits({ movetime: 1500 }), { movetime: 1500 })
  assert.deepEqual(cleanLimits({ movetime: 1e9, depth: 500, nodes: 1e20 }), { movetime: 600_000, depth: 99, nodes: 1e12 })
  assert.deepEqual(cleanLimits({ movetime: 0, depth: -3 }), {})
  assert.deepEqual(cleanLimits({ movetime: Number.NaN }), {})
  assert.deepEqual(cleanLimits(undefined), {})
})

// ---------------------------------------------------------------- handshake and options

test('nothing is ready until the engine has said hello, and then it says what it is', async () => {
  const { engine, last } = harness()
  const before = await engine.status()
  assert.equal(before.state, 'stopped')
  // A file on disk is not an engine: no name, no author, no options are claimed before a handshake.
  assert.equal(before.name, null)
  assert.equal(before.author, null)
  assert.deepEqual(before.options, [])
  assert.equal(before.installedVersion, 'sf_19')
  assert.equal(before.verified, true)
  assert.equal(before.licenceId, 'GPL-3.0-or-later')
  assert.match(before.licencePath ?? '', /Copying\.txt$/)

  await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'r1' })
  const after = await engine.status()
  assert.equal(after.state, 'ready')
  assert.equal(after.name, 'Fakefish 1.2')
  assert.equal(after.author, 'The Orbis test suite')
  assert.equal(after.lastError, null)

  // Every option the engine advertised, with the limits it gave, read from its own lines.
  const hash = after.options.find((o) => o.name === 'Hash')
  assert.deepEqual(hash, { name: 'Hash', type: 'spin', default: '16', min: 1, max: 33554432 })
  assert.deepEqual(after.options.find((o) => o.name === 'UCI_Variant')?.vars, ['chess', 'crazyhouse'])
  assert.equal(after.options.find((o) => o.name === 'Clear Hash')?.type, 'button')
  assert.equal(after.options.length, OPTION_LINES.length)

  // What was really set, and in what order. One conversation: no command is sent between a question and its answer.
  assert.equal(after.applied.Threads, '5')
  assert.equal(after.applied.Hash, '512')
  assert.equal(after.applied.MultiPV, '1')
  assert.deepEqual(last().commands, [
    'uci',
    'setoption name Threads value 5',
    'setoption name Hash value 512',
    'setoption name MultiPV value 1',
    'isready',
    'ucinewgame',
    'isready',
    `position fen ${START_FEN}`,
    'go movetime 10'
  ])
})

test('an option the engine never mentioned is not sent, and one it limits is clamped to its limit', async () => {
  const lines = ['option name Threads type spin default 1 min 1 max 3', 'option name Hash type spin default 16 min 1 max 64']
  const { engine, last } = harness({
    cores: 32,
    memoryMb: 65536,
    options: { 'Skill Level': 7, Nonsense: 5 },
    handler: (f, command) => {
      if (command === 'uci') {
        f.line('id name Spartan 1.0')
        for (const line of lines) f.line(line)
        f.line('uciok')
        return
      }
      prompt(f, command)
    }
  })
  await engine.analyse({ fen: START_FEN, limits: { movetime: 10 } })
  const sent = last().sent('setoption')
  assert.deepEqual(sent, ['setoption name Threads value 3', 'setoption name Hash value 64'])
  // Guessing at a name is how a status ends up claiming eight threads on an engine that calls them something else.
  assert.equal(sent.some((s) => s.includes('Nonsense') || s.includes('Skill Level') || s.includes('MultiPV')), false)
  const status = await engine.status()
  assert.deepEqual(status.applied, { Threads: '3', Hash: '64' })
})

test('an engine that never answers "uci" is a failed start, not a wait', async () => {
  const { engine } = harness({
    timeouts: { handshakeMs: 80 },
    handler: (f, command) => {
      if (command === 'uci') f.line('id name The Silent Engine')
      else housekeeping(f, command)
    }
  })
  const error = await settle(engine.analyse({ fen: START_FEN, limits: { movetime: 10 } }))
  assert.ok(error instanceof ChessEngineError)
  assert.equal(error.code, 'timeout')
  assert.match(error.message, /did not answer "uci" with "uciok"/)
  const status = await engine.status()
  assert.equal(status.state, 'failed')
  assert.match(status.detail, /never finished saying hello/)
})

test('an engine that answers "uci" and then never "readyok" does not reach ready either', async () => {
  const { engine } = harness({
    timeouts: { readyMs: 80 },
    handler: (f, command) => {
      if (command === 'isready') return
      prompt(f, command)
    }
  })
  const error = await settle(engine.analyse({ fen: START_FEN, limits: { movetime: 10 } }))
  assert.ok(error instanceof ChessEngineError)
  assert.match(error.message, /isready/)
  assert.notEqual((await engine.status()).state, 'ready')
})

// ---------------------------------------------------------------- reading what the engine says

test('a line split across reads, and several lines in one read, are both read correctly', async () => {
  const updates: AnalysisUpdate[] = []
  const { engine } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (!command.startsWith('go')) return
      // Fragments that are not lines: this is what a pipe really hands over.
      f.say('info depth 1 sc')
      f.say('ore cp 13 nodes 20 pv e2e4\ninfo depth 2 score cp 20 nodes 40 pv d2d4 d7d5\r\ninfo dep')
      f.say('th 3 score cp 31 nodes 90 pv g1f3 g8f6\nbestmo')
      f.say('ve g1f3 ponder g8f6\n')
    }
  })
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'r1', onUpdate: (u) => updates.push(u) })
  const infos = updates.filter((u) => !u.complete)
  assert.deepEqual(infos.map((u) => u.depth), [1, 2, 3])
  assert.deepEqual(infos.map((u) => (u.score.kind === 'cp' ? u.score.cp : null)), [13, 20, 31])
  assert.deepEqual(infos[1].pvSan, ['d4', 'd5'])
  assert.equal(result.bestmove, 'g1f3')
  assert.equal(result.bestmoveSan, 'Nf3')
  assert.equal(result.ponder, 'g8f6')
  // The final answer is the last update too, so a caller forwarding updates sees the whole search in one place.
  assert.equal(updates[updates.length - 1], result)
})

test('malformed lines are skipped and the search still finishes', async () => {
  const updates: AnalysisUpdate[] = []
  const { engine } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (!command.startsWith('go')) return
      f.line('info')
      f.line('info depth')
      f.line('info depth abc score cp xyz pv')
      f.line('info string NNUE evaluation using nn-1111cefa1111.nnue')
      f.line('info currmove e2e4 currmovenumber 1')
      f.line('   ')
      f.line('what on earth is this line')
      // A real line, with a depth and a variation but no score yet. It is an update, and its score is nothing.
      f.line('info depth 6 nodes 400 pv e2e4')
      f.line('info depth 7 score cp 44 nodes 900 pv e2e4')
      f.line('bestmove e2e4')
    }
  })
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, onUpdate: (u) => updates.push(u) })
  // Only the lines that said something became updates: a line with no depth, no score and no variation is not an
  // evaluation of zero, and `currmove` chatter is not an evaluation at all.
  const infos = updates.filter((u) => !u.complete)
  assert.deepEqual(infos.map((u) => u.depth), [6, 7])
  assert.equal(infos[0].score.kind, 'none')
  assert.equal(result.bestmove, 'e2e4')
  assert.equal(result.score.kind === 'cp' && result.score.cp, 44)
})

test('a malformed "bestmove" ends the search honestly instead of leaving it waiting', async () => {
  const { engine } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (command.startsWith('go')) {
        f.line('info depth 3 score cp 12 nodes 100 pv e2e4')
        f.line('bestmove')
      }
    }
  })
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 } })
  assert.equal(result.complete, true)
  assert.equal(result.bestmove, null)
  assert.match(result.note ?? '', /reported no move/)
  // The evaluation it did reach is still true and is still given.
  assert.deepEqual(result.score, { kind: 'cp', cp: 12 })
})

test('a move the engine offers that cannot be played is refused, and said so', async () => {
  const { engine } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (command.startsWith('go')) {
        f.line('info depth 4 score cp 20 pv e2e4')
        f.line('bestmove e7e8q ponder e2e4')
      }
    }
  })
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 } })
  assert.equal(result.bestmove, null)
  assert.equal(result.bestmoveSan, null)
  assert.equal(result.ponder, null)
  assert.match(result.note ?? '', /not a legal move in this position/)
  assert.equal(result.complete, true)
})

test('a variation that cannot be played is dropped as notation and kept as coordinates', async () => {
  const updates: AnalysisUpdate[] = []
  const { engine } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (command.startsWith('go')) {
        f.line('info depth 5 score cp 20 pv e2e4 e2e4 e7e5')
        f.line('info depth 6 score cp 22 pv e2e4 e7e5')
        f.line('bestmove e2e4')
      }
    }
  })
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, onUpdate: (u) => updates.push(u) })
  const broken = updates.find((u) => u.depth === 5)!
  assert.equal(broken.pvSan, null)
  // The engine's own words are kept, so the fault is visible rather than papered over with a guess.
  assert.deepEqual(broken.pvUci, ['e2e4', 'e2e4', 'e7e5'])
  assert.deepEqual(result.pvSan, ['e4', 'e5'])
})

test('a mate score is a mate, and it is turned round for the side to move exactly once', async () => {
  const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
  const mates = (f: Fake, command: string): void => {
    if (housekeeping(f, command)) return
    if (command.startsWith('go')) {
      f.line('info depth 9 score mate 3 nodes 5000 pv e7e5')
      f.line('info depth 10 score cp 55 nodes 9000 pv e7e5')
      f.line('bestmove e7e5')
    }
  }
  const { engine } = harness({ handler: mates })
  const updates: AnalysisUpdate[] = []
  await engine.analyse({ fen: blackToMove, limits: { movetime: 10 }, onUpdate: (u) => updates.push(u) })
  // The engine spoke from Black's side; Orbis stores every score from White's.
  assert.deepEqual(updates[0].score, { kind: 'mate', moves: -3 })
  assert.deepEqual(updates[1].score, { kind: 'cp', cp: -55 })

  const white = harness({ handler: mates })
  const whiteUpdates: AnalysisUpdate[] = []
  await white.engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, onUpdate: (u) => whiteUpdates.push(u) })
  assert.deepEqual(whiteUpdates[0].score, { kind: 'mate', moves: 3 })
  assert.deepEqual(whiteUpdates[1].score, { kind: 'cp', cp: 55 })
})

test('a bound is marked and never becomes the settled score', async () => {
  const updates: AnalysisUpdate[] = []
  const { engine } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (command.startsWith('go')) {
        f.line('info depth 8 score cp 900 lowerbound nodes 1000 pv e2e4')
        f.line('info depth 8 score cp -900 upperbound nodes 1200 pv d2d4')
        f.line('info depth 9 score cp 25 nodes 2000 pv e2e4 e7e5')
        f.line('bestmove e2e4')
      }
    }
  })
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, onUpdate: (u) => updates.push(u) })
  assert.equal(updates[0].bound, 'lower')
  assert.equal(updates[1].bound, 'upper')
  assert.equal(updates[2].bound, null)
  // A window the search stopped at is a limit, not a verdict: +9.00 must not be what the board settles on.
  assert.deepEqual(result.score, { kind: 'cp', cp: 25 })
  assert.equal(result.bound, null)
  assert.equal(result.lines.length, 1)
})

test('a search that only ever reported a bound says so rather than pretending it is settled', async () => {
  const { engine } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (command.startsWith('go')) {
        f.line('info depth 3 score cp 400 lowerbound nodes 500 pv e2e4')
        f.line('bestmove e2e4')
      }
    }
  })
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 } })
  assert.equal(result.bound, 'lower')
  assert.deepEqual(result.lines, [])
  assert.deepEqual(result.score, { kind: 'cp', cp: 400 })
})

test('several lines are asked for only within the engine’s own limit, and come back in order', async () => {
  const { engine, last } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (command.startsWith('go')) {
        f.line('info depth 12 multipv 1 score cp 30 nodes 100 pv e2e4 e7e5')
        f.line('info depth 12 multipv 3 score cp 10 nodes 100 pv g1f3 g8f6')
        f.line('info depth 12 multipv 2 score cp 20 nodes 100 pv d2d4 d7d5')
        f.line('bestmove e2e4')
      }
    }
  })
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, multipv: 3 })
  assert.deepEqual(last().sent('setoption name MultiPV'), ['setoption name MultiPV value 1', 'setoption name MultiPV value 3'])
  assert.deepEqual(result.lines.map((l) => l.multipv), [1, 2, 3])
  assert.deepEqual(result.lines.map((l) => l.pvSan?.[0]), ['e4', 'd4', 'Nf3'])
  // The first line is the answer, whatever order the engine printed them in.
  assert.deepEqual(result.score, { kind: 'cp', cp: 30 })

  // Asked for more than the engine advertises: clamped to what it said, never sent as asked.
  const second = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, multipv: 9999 })
  assert.deepEqual(last().sent('setoption name MultiPV').slice(-1), ['setoption name MultiPV value 256'])
  assert.equal(second.complete, true)
})

test('an engine with no MultiPV is never asked for it', async () => {
  const { engine, last } = harness({
    handler: (f, command) => {
      if (command === 'uci') {
        f.line('id name Narrow 1.0')
        f.line('option name Threads type spin default 1 min 1 max 8')
        f.line('uciok')
        return
      }
      prompt(f, command)
    }
  })
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, multipv: 5 })
  assert.deepEqual(last().sent('setoption name MultiPV'), [])
  assert.equal(result.multipv, 1)
})

// ---------------------------------------------------------------- cancellation

/** A search that will not finish on its own; `stop` is the only way out. */
function slow(f: Fake, command: string): void {
  if (housekeeping(f, command)) return
  if (command.startsWith('go')) {
    f.line('info depth 1 score cp 10 nodes 50 pv e2e4')
    return
  }
  if (command === 'stop') f.line('bestmove e2e4')
}

test('a cancelled search fails as cancelled, and the engine is usable again straight after', async () => {
  const { engine, fakes, last, behave } = harness({ handler: slow })
  const updates: AnalysisUpdate[] = []
  const running = settle(engine.analyse({ fen: START_FEN, limits: { movetime: 60_000 }, requestId: 'r1', onUpdate: (u) => updates.push(u) }))
  while (!updates.length) await tick()
  await engine.stop('r1')
  const error = await running
  assert.ok(error instanceof ChessEngineError)
  assert.equal(error.code, 'cancelled')
  assert.deepEqual(last().sent('stop'), ['stop'])
  // Nothing was torn down: the engine answered the stop, so it is the same process that runs the next search.
  const status = await engine.status()
  assert.equal(status.state, 'ready')
  assert.equal(status.searching, null)
  behave(prompt)
  const next = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'r2' })
  assert.equal(next.complete, true)
  assert.equal(fakes.length, 1)
  assert.equal(last().overlaps, 0)
})

test('an AbortSignal cancels a running search, and removes a waiting one without touching the engine', async () => {
  const { engine, last } = harness({ handler: slow })
  const first = new AbortController()
  const second = new AbortController()
  const updates: AnalysisUpdate[] = []
  const running = settle(engine.analyse({ fen: START_FEN, limits: { movetime: 60_000 }, requestId: 'r1', signal: first.signal, onUpdate: (u) => updates.push(u) }))
  while (!updates.length) await tick()
  const waiting = settle(engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'r2', signal: second.signal }))
  await tick()
  assert.equal((await engine.status()).queued, 1)

  second.abort()
  const dropped = await waiting
  assert.ok(dropped instanceof ChessEngineError && dropped.code === 'cancelled')
  // It never ran, so the engine was never told anything about it.
  assert.equal(last().sent('go').length, 1)

  first.abort()
  assert.ok((await running) instanceof ChessEngineError)
  // A signal that has already fired is refused before anything is queued.
  const already = await settle(engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, signal: second.signal }))
  assert.ok(already instanceof ChessEngineError && already.code === 'cancelled')
})

test('results that arrive after a cancel are dropped, and never land on the next position', async () => {
  const d4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'
  const { engine, fakes, behave } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (command.startsWith('go')) {
        f.line('info depth 1 score cp 10 nodes 50 pv e2e4')
        return
      }
      if (command === 'stop') {
        // The engine finishes what it was doing before it answers. These belong to a question nobody is asking.
        f.line('info depth 40 seldepth 50 score cp 900 nodes 99999999 pv e2e4')
        f.line('info depth 41 score mate 2 nodes 99999999 pv e2e4')
        f.line('bestmove e2e4')
      }
    }
  })
  const firstUpdates: AnalysisUpdate[] = []
  const running = settle(engine.analyse({ fen: START_FEN, limits: { movetime: 60_000 }, requestId: 'old', onUpdate: (u) => firstUpdates.push(u) }))
  while (!firstUpdates.length) await tick()
  await engine.stop('old')
  await running
  await tick(20)
  assert.deepEqual(firstUpdates.map((u) => u.depth), [1])
  assert.equal(firstUpdates.every((u) => u.requestId === 'old' && u.fen === START_FEN), true)

  // A new position, on the same process. Nothing from the old search may be attributed to it.
  const nextUpdates: AnalysisUpdate[] = []
  behave(prompt)
  const result = await engine.analyse({ fen: d4, limits: { movetime: 10 }, requestId: 'new', onUpdate: (u) => nextUpdates.push(u) })
  assert.equal(nextUpdates.every((u) => u.requestId === 'new' && u.fen === d4), true)
  assert.equal(nextUpdates.some((u) => u.depth !== null && u.depth > 20), false)
  assert.equal(result.score.kind, 'cp')
  assert.notEqual(result.score.kind === 'cp' && result.score.cp, 900)
  // The same process throughout: the old search's answers were dropped on the way in, not by replacing the engine.
  assert.equal(fakes.length, 1)
})

test('an engine that ignores "stop" is replaced rather than treated as idle', async () => {
  const { engine, fakes, behave } = harness({
    timeouts: { stopMs: 100 },
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (command.startsWith('go')) f.line('info depth 1 score cp 10 pv e2e4')
      // `stop` is deliberately ignored: the engine is still mid-sentence and will never say so.
    }
  })
  const updates: AnalysisUpdate[] = []
  const running = settle(engine.analyse({ fen: START_FEN, limits: { movetime: 60_000 }, requestId: 'r1', onUpdate: (u) => updates.push(u) }))
  while (!updates.length) await tick()
  await engine.stop('r1')
  assert.ok((await running) instanceof ChessEngineError)
  assert.equal(fakes[0].killed, true)
  // The next search gets a fresh process, not a half-finished conversation.
  behave(prompt)
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'r2' })
  assert.equal(result.complete, true)
  assert.equal(fakes.length, 2)
})

test('cancelling everything empties the queue and stops what is running', async () => {
  const { engine } = harness({ handler: slow })
  const updates: AnalysisUpdate[] = []
  const running = settle(engine.analyse({ fen: START_FEN, limits: { movetime: 60_000 }, requestId: 'a', onUpdate: (u) => updates.push(u) }))
  while (!updates.length) await tick()
  const queued = [
    settle(engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'b' })),
    settle(engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'c' }))
  ]
  await tick()
  await engine.stopAll()
  for (const outcome of [running, ...queued]) {
    assert.ok((await outcome) instanceof ChessEngineError, 'every request should have been cancelled')
  }
  assert.equal((await engine.status()).queued, 0)
})

// ---------------------------------------------------------------- failure and recovery

test('an engine that dies mid-search fails the search with what it said, and can be started again', async () => {
  const { engine, fakes, behave } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (command.startsWith('go')) {
        f.line('info depth 2 score cp 15 nodes 100 pv e2e4')
        f.err('terminate called after throwing an instance of std::bad_alloc')
        f.die(3221225477)
      }
    }
  })
  const error = await settle(engine.analyse({ fen: START_FEN, limits: { movetime: 60_000 }, requestId: 'r1' }))
  assert.ok(error instanceof ChessEngineError)
  assert.equal(error.code, 'engine-gone')
  // The exit code and the last thing it wrote are the only explanation a crash gives, so both are kept.
  assert.match(error.message, /3221225477/)
  assert.match(error.message, /bad_alloc/)
  assert.equal(error.recoverable, true)

  const status = await engine.status()
  assert.equal(status.state, 'failed')
  assert.equal(status.name, null)
  assert.equal(status.recoverable, true)
  assert.match(status.lastError ?? '', /bad_alloc/)

  // Recoverable means recoverable: the next request starts a new process and works.
  behave(prompt)
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'r2' })
  assert.equal(result.bestmove, 'e2e4')
  assert.equal(fakes.length, 2)
  assert.equal((await engine.status()).state, 'ready')
})

test('an engine that dies during the handshake is a failure, not a request left searching', async () => {
  const { engine } = harness({
    handler: (f, command) => {
      if (command === 'uci') {
        f.line('id name Doomed 0.1')
        f.err('Illegal instruction')
        f.die(null, 'SIGILL')
      }
    }
  })
  const error = await settle(engine.analyse({ fen: START_FEN, limits: { movetime: 10 } }))
  assert.ok(error instanceof ChessEngineError)
  assert.equal(error.code, 'engine-gone')
  assert.match(error.message, /SIGILL/)
  assert.match(error.message, /Illegal instruction/)
})

test('a search the engine never answers times out, and the engine is restarted', async () => {
  const { engine, fakes, behave } = harness({
    timeouts: { searchGraceMs: 40, stopMs: 60 },
    handler: (f, command) => {
      housekeeping(f, command)
      // Neither `go` nor `stop` is ever answered.
    }
  })
  const error = await settle(engine.analyse({ fen: START_FEN, limits: { movetime: 20 }, requestId: 'r1' }))
  assert.ok(error instanceof ChessEngineError)
  assert.equal(error.code, 'timeout')
  assert.match(error.message, /did not finish within 60 ms/)
  behave(prompt)
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'r2' })
  assert.equal(result.complete, true)
  assert.equal(fakes.length, 2, 'a hung engine should have been replaced, not reused')
})

test('a depth search with no time limit of its own is still bounded', async () => {
  const { engine } = harness({
    timeouts: { maxSearchMs: 60, stopMs: 40 },
    handler: (f, command) => {
      housekeeping(f, command)
    }
  })
  const error = await settle(engine.analyse({ fen: START_FEN, limits: { depth: 40 } }))
  assert.ok(error instanceof ChessEngineError && error.code === 'timeout')
  assert.match(error.message, /within 60 ms/)
})

test('restart replaces the process, and shutdown asks it to quit', async () => {
  const { engine, fakes } = harness()
  await engine.analyse({ fen: START_FEN, limits: { movetime: 10 } })
  await engine.restart()
  assert.equal(fakes[0].killed, true)
  assert.equal((await engine.status()).state, 'stopped')
  await engine.analyse({ fen: START_FEN, limits: { movetime: 10 } })
  assert.equal(fakes.length, 2)
  await engine.shutdown()
  assert.deepEqual(fakes[1].sent('quit'), ['quit'])
  assert.equal((await engine.status()).state, 'stopped')
})

// ---------------------------------------------------------------- the queue

test('one search at a time, interactive before batch, and never two conversations at once', async () => {
  const finished: string[] = []
  const { engine, last } = harness({
    handler: (f, command) => {
      if (housekeeping(f, command)) return
      if (!command.startsWith('go')) return
      setTimeout(() => {
        f.line('info depth 3 score cp 12 nodes 300 pv e2e4')
        f.line('bestmove e2e4')
      }, 15)
    }
  })
  // Warm the engine up, then occupy it, so the three below are all really waiting when a slot frees up. Without
  // something holding the engine, whichever request arrives first is taken before the others exist, and the test
  // would be measuring arrival order rather than priority.
  await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'warm' })
  const jobs = [
    engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'holding' }).then(() => finished.push('holding')),
    engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'batch-1', priority: 'batch' }).then(() => finished.push('batch-1')),
    engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'batch-2', priority: 'batch' }).then(() => finished.push('batch-2')),
    engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'board', priority: 'interactive' }).then(() => finished.push('board'))
  ]
  await Promise.all(jobs)
  // The board was asked for last and answered first of the three that queued: somebody is looking at it.
  assert.deepEqual(finished, ['holding', 'board', 'batch-1', 'batch-2'])
  // Five searches on one process, and the engine never saw a `go` while an earlier one was unanswered.
  assert.equal(last().sent('go').length, 5)
  assert.equal(last().overlaps, 0, 'two searches overlapped on one engine')
})

test('two requests cannot share an id, because then their results could not be told apart', async () => {
  const { engine } = harness({ handler: slow })
  const updates: AnalysisUpdate[] = []
  const running = settle(engine.analyse({ fen: START_FEN, limits: { movetime: 60_000 }, requestId: 'same', onUpdate: (u) => updates.push(u) }))
  while (!updates.length) await tick()
  const clash = await settle(engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, requestId: 'same' }))
  assert.ok(clash instanceof ChessEngineError)
  assert.equal(clash.code, 'duplicate-request')
  assert.equal(clash.recoverable, false)
  await engine.stopAll()
  await running
})

test('an id is generated when none is given, and it is on every update', async () => {
  const updates: AnalysisUpdate[] = []
  const { engine } = harness()
  const result = await engine.analyse({ fen: START_FEN, limits: { movetime: 10 }, onUpdate: (u) => updates.push(u) })
  assert.match(result.requestId, /^[0-9a-f-]{36}$/)
  assert.ok(updates.length >= 2)
  assert.equal(updates.every((u) => u.requestId === result.requestId && u.fen === START_FEN), true)
})

test('an update listener that throws does not take the search down with it', async () => {
  const { engine } = harness()
  const result = await engine.analyse({
    fen: START_FEN,
    limits: { movetime: 10 },
    onUpdate: () => {
      throw new Error('the screen is on fire')
    }
  })
  assert.equal(result.complete, true)
  assert.equal(result.bestmove, 'e2e4')
})

// ---------------------------------------------------------------- what cannot be asked

test('a position that is not a position is refused before the engine is touched', async () => {
  const { engine, fakes } = harness()
  for (const fen of ['', 'not a fen', '8/8/8/8/8/8/8/8 w - - 0 1', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1']) {
    const error = await settle(engine.analyse({ fen, limits: { movetime: 10 } }))
    assert.ok(error instanceof ChessEngineError, fen)
    assert.equal(error.code, 'bad-request')
    assert.equal(error.recoverable, false)
  }
  // Nothing was started: a bad position must not cost an engine launch.
  assert.equal(fakes.length, 0)
})

test('a search with no limit at all is refused rather than left to run for ever', async () => {
  const { engine, fakes } = harness()
  const error = await settle(engine.analyse({ fen: START_FEN, limits: {} }))
  assert.ok(error instanceof ChessEngineError)
  assert.equal(error.code, 'bad-request')
  assert.match(error.message, /needs a limit/)
  assert.equal(fakes.length, 0)
})

test('an option cannot be changed in the middle of a search', async () => {
  const { engine } = harness({ handler: slow })
  await engine.setOption('Hash', 128)
  assert.equal((await engine.status()).applied.Hash, '128')
  const updates: AnalysisUpdate[] = []
  const running = settle(engine.analyse({ fen: START_FEN, limits: { movetime: 60_000 }, onUpdate: (u) => updates.push(u) }))
  while (!updates.length) await tick()
  await assert.rejects(() => engine.setOption('Hash', 64), (e: unknown) => e instanceof ChessEngineError && /while the engine is searching/.test(e.message))
  await engine.stopAll()
  await running
})

// ---------------------------------------------------------------- finding an engine

test('with nothing installed the state says so, and an analysis is refused honestly', async () => {
  const { engine, fakes } = harness({ home: mkdtempSync(join(tmpdir(), 'orbis-chess-empty-')) })
  const status = await engine.status()
  assert.equal(status.state, 'not-installed')
  assert.equal(status.binaryPath, null)
  assert.equal(status.installedVersion, null)
  assert.match(status.detail, /has not been installed yet/)
  const error = await settle(engine.analyse({ fen: START_FEN, limits: { movetime: 10 } }))
  assert.ok(error instanceof ChessEngineError)
  assert.equal(error.code, 'not-installed')
  assert.equal(fakes.length, 0)
})

test('an engine somebody chose is used, and a bad choice is reported rather than swapped for another', async () => {
  const dir = installedHome()
  const chosen = join(dir, 'my-engine.exe')
  writeFileSync(chosen, 'x')
  const good = harness({ home: dir, binaryPath: chosen })
  await good.engine.analyse({ fen: START_FEN, limits: { movetime: 10 } })
  const status = await good.engine.status()
  assert.equal(status.binaryPath, chosen)
  assert.equal(status.binaryFrom, 'configured')
  // It is not the installed one, so nothing is claimed about a version that was never downloaded.
  assert.equal(status.installedVersion, null)

  // A path that cannot be used: said so, rather than quietly analysing with a different engine.
  const bad = harness({ home: dir, binaryPath: 'stockfish.exe' })
  const badStatus = await bad.engine.status()
  assert.equal(badStatus.binaryPath, null)
  assert.match(badStatus.problem ?? '', /not a full path/)
  const error = await settle(bad.engine.analyse({ fen: START_FEN, limits: { movetime: 10 } }))
  assert.ok(error instanceof ChessEngineError && error.code === 'not-installed')
  assert.equal(bad.fakes.length, 0)
})

test('an install record that cannot be read is a problem, not a missing engine', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-chess-broken-'))
  writeFileSync(join(dir, 'installed.json'), '{ truncated')
  const { engine } = harness({ home: dir })
  const status = await engine.status()
  assert.equal(status.state, 'not-installed')
  assert.match(status.problem ?? '', /could not be read/)
})

// ---------------------------------------------------------------- installing

/** The archive upstream builds, in miniature: one folder, the program, the licence and some noise. */
function archive(): Buffer {
  const writer = new ZipWriter((d) => new Uint8Array(deflateRawSync(d)))
  const chunks: Uint8Array[] = []
  const add = (path: string, data: Buffer): void => {
    chunks.push(writer.add({ path, data: new Uint8Array(data), compress: true }) as Uint8Array)
  }
  add('stockfish/stockfish-windows-x86-64-universal.exe', Buffer.alloc(2 * 1024 * 1024, 0x41))
  add('stockfish/Copying.txt', Buffer.from('GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007'))
  add('stockfish/src/main.cpp', Buffer.from('int main() {}'))
  chunks.push(writer.finish())
  return Buffer.concat(chunks)
}

test('installing downloads the verified archive, keeps the licence, and is safe to repeat', async () => {
  const zip = archive()
  const sha = createHash('sha256').update(zip).digest('hex')
  const dir = mkdtempSync(join(tmpdir(), 'orbis-chess-install-'))
  const asked: string[] = []
  const fetchFn = (async (url: string | URL | Request) => {
    const u = String(url)
    asked.push(u)
    if (u.includes('api.github.com')) {
      return new Response(
        JSON.stringify([
          { tag_name: 'stockfish-dev-20261013', prerelease: true, assets: [] },
          {
            tag_name: 'sf_19',
            prerelease: false,
            assets: [
              {
                name: 'stockfish-windows-x86-64-universal.zip',
                browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip',
                size: zip.length,
                digest: `sha256:${sha}`
              }
            ]
          }
        ]),
        { headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response(zip, { headers: { 'content-type': 'application/zip', 'content-length': String(zip.length) } })
  }) as typeof fetch

  const steps: string[] = []
  const engine = new ChessEngine({ home: dir, platform: 'win32', arch: 'x64', fetchFn, cores: 10, memoryMb: 16384, spawnFn: (() => new Fake() as unknown as ChildProcess) as never })
  const record = await engine.install((m) => steps.push(m))
  assert.equal(record.version, 'sf_19')
  assert.equal(record.verified, true)
  assert.equal(record.sha256, sha)
  assert.equal(record.licenceId, 'GPL-3.0-or-later')
  assert.equal(record.licence, 'Copying.txt')
  assert.equal(record.sourceUrl, 'https://github.com/official-stockfish/Stockfish/releases/tag/sf_19')
  assert.ok(existsSync(join(dir, 'stockfish-windows-x86-64-universal.exe')))
  // The licence that came with the binary, kept beside it.
  assert.ok(existsSync(join(dir, 'Copying.txt')))
  // The 80 MB archive, and the source tree inside it, are not left on the disk.
  assert.equal(existsSync(join(dir, 'download')), false)
  assert.equal(existsSync(join(dir, 'src')), false)
  assert.ok(steps.some((s) => /Downloading/.test(s)))
  assert.ok(steps.some((s) => /installed \(sf_19\)/.test(s)))

  const status = await engine.status()
  assert.equal(status.state, 'stopped')
  assert.equal(status.installedVersion, 'sf_19')
  assert.equal(status.verified, true)
  // Installed is not running: no name is claimed until an engine has said one.
  assert.equal(status.name, null)

  // Again: the same version is already there, so nothing is downloaded a second time.
  const downloads = asked.filter((u) => u.includes('/releases/download/')).length
  const second = await engine.install()
  assert.equal(second.installedAt, record.installedAt)
  assert.equal(asked.filter((u) => u.includes('/releases/download/')).length, downloads)
})

test('an install that cannot be verified leaves nothing behind and says why', async () => {
  const zip = archive()
  const dir = mkdtempSync(join(tmpdir(), 'orbis-chess-bad-'))
  const fetchFn = (async (url: string | URL | Request) => {
    if (String(url).includes('api.github.com')) {
      return new Response(
        JSON.stringify([
          {
            tag_name: 'sf_19',
            prerelease: false,
            assets: [
              {
                name: 'stockfish-windows-x86-64-universal.zip',
                browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip',
                size: zip.length,
                digest: `sha256:${'b'.repeat(64)}`
              }
            ]
          }
        ]),
        { headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response(zip, { headers: { 'content-type': 'application/zip', 'content-length': String(zip.length) } })
  }) as typeof fetch
  const engine = new ChessEngine({ home: dir, platform: 'win32', arch: 'x64', fetchFn })
  await assert.rejects(() => engine.install(), /does not match the checksum/)
  assert.equal(existsSync(join(dir, 'stockfish-windows-x86-64-universal.exe')), false)
  assert.equal(existsSync(join(dir, 'installed.json')), false)
  const status = await engine.status()
  // `failed`, not `not-installed`: nothing is installed, but why that is is the more useful of the two facts.
  assert.equal(status.state, 'failed')
  assert.equal(status.binaryPath, null)
  assert.equal(status.installedVersion, null)
  assert.match(status.lastError ?? '', /does not match the checksum/)
})
