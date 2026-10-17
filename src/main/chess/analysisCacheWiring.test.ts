import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { ChessEngine, ChessEngineError, resultFromEntry, type AnalysisCachePort, type AnalysisResult } from './engine.ts'
import { AnalysisCacheStore } from './analysisStore.ts'
import {
  keyFor,
  servable,
  type AnalysisAsk,
  type CachedAnalysis
} from '../../shared/chess/analysisCache.ts'

/**
 * Whether the engine really serves an answer it has already found.
 *
 * `analysisCache.test.ts` proves what may be reused and `analysisStore.test.ts` proves what is really written to
 * disk. Neither of them would notice the one failure that matters most: a cache nothing consults. So these drive the
 * whole engine against a scripted process and count the searches it was asked to run. A second ask about the same
 * position must not produce a second `go`.
 */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'

const OPTION_LINES = [
  'option name Threads type spin default 1 min 1 max 1024',
  'option name Hash type spin default 16 min 1 max 33554432',
  'option name MultiPV type spin default 1 min 1 max 256'
]

/** A pair of pipes and a script. The binary is never run: `spawnFn` is replaced. */
class Fake extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly commands: string[] = []
  closed = false
  handler: (self: Fake, command: string) => void = () => undefined
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
        this.handler(this, command)
      }
    })
  }

  line(text: string): void {
    if (!this.closed) this.stdout.write(`${text}\n`)
  }

  kill(): boolean {
    if (this.closed) return true
    this.closed = true
    this.stdout.end()
    this.stderr.end()
    setTimeout(() => this.emit('close', null, 'SIGTERM'), 0)
    return true
  }

  /** How many searches this engine was really asked to run. The figure the whole file is about. */
  searches(): number {
    return this.commands.filter((c) => c.startsWith('go')).length
  }
}

function housekeeping(f: Fake, command: string): boolean {
  if (command === 'uci') {
    f.line('id name Fakefish 1.2')
    f.line('id author The Orbis test suite')
    for (const option of OPTION_LINES) f.line(option)
    f.line('uciok')
    return true
  }
  if (command === 'isready') {
    f.line('readyok')
    return true
  }
  if (command === 'quit') {
    f.kill()
    return true
  }
  return command === 'ucinewgame' || command.startsWith('setoption') || command.startsWith('position')
}

/** Answers a search straight away, the way a short time limit does. */
function answers(f: Fake, command: string): void {
  if (housekeeping(f, command)) return
  if (command.startsWith('go')) {
    f.line('info depth 1 seldepth 1 multipv 1 score cp 13 nodes 20 nps 20000 time 1 pv e2e4')
    f.line('info depth 22 seldepth 28 multipv 1 score cp 24 nodes 1234567 nps 987654 time 1980 pv e2e4 e7e5 g1f3')
    f.line('bestmove e2e4 ponder e7e5')
  }
}

/**
 * Thinks for a moment before answering, so a time limit can really be met.
 *
 * Needed because `answers` above replies in under a millisecond, and a search that thought for a millisecond
 * honestly cannot answer somebody who asked for fifty of them. That is why most of the tests below ask by depth:
 * the scripted engine reports depth 22 whatever it is given, so a depth limit is something it can really satisfy.
 */
function thinks(f: Fake, command: string): void {
  if (housekeeping(f, command)) return
  if (command.startsWith('go')) {
    setTimeout(() => {
      f.line('info depth 20 seldepth 24 multipv 1 score cp 18 nodes 900000 nps 500000 time 55 pv e2e4 e7e5')
      f.line('bestmove e2e4')
    }, 60)
  }
}

/** Reports a depth and then stalls, so a search can be stopped halfway. */
function stalls(f: Fake, command: string): void {
  if (housekeeping(f, command)) return
  if (command === 'stop') {
    f.line('bestmove e2e4')
    return
  }
  if (command.startsWith('go')) {
    f.line('info depth 14 seldepth 18 multipv 1 score cp 30 nodes 400000 nps 300000 time 500 pv e2e4 e7e5')
  }
}

const INSTALLED = {
  version: 'sf_19',
  asset: 'stockfish-windows-x86-64-universal.zip',
  archiveUrl: 'https://example.invalid/sf.zip',
  sha256: 'a'.repeat(64),
  verified: true,
  bytes: 81431614,
  binary: 'stockfish-windows-x86-64-universal.exe',
  licence: 'Copying.txt',
  licenceId: 'GPL-3.0-or-later',
  sourceUrl: 'https://example.invalid/sf',
  installedAt: 1760000000000
}

function installedHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-chess-cache-engine-'))
  writeFileSync(join(dir, INSTALLED.binary), 'not really a program')
  writeFileSync(join(dir, 'Copying.txt'), 'GNU GENERAL PUBLIC LICENSE Version 3')
  writeFileSync(join(dir, 'installed.json'), JSON.stringify(INSTALLED))
  return dir
}

/** The cache as a Map, so what the engine asks of it is visible without a database in the way. */
class Remembering implements AnalysisCachePort {
  readonly held = new Map<string, CachedAnalysis>()
  readonly looked: string[] = []
  readonly refused: string[] = []

  look(ask: AnalysisAsk): { kind: 'hit'; entry: CachedAnalysis } | { kind: 'miss'; explain: string } {
    const key = keyFor(ask)
    if (key.kind !== 'key') return { kind: 'miss', explain: key.because }
    this.looked.push(key.key.bucket)
    const entry = this.held.get(key.key.bucket)
    if (!entry) return { kind: 'miss', explain: 'nothing stored' }
    const verdict = servable(entry, ask)
    if (!verdict.usable) {
      this.refused.push(verdict.reason)
      return { kind: 'miss', explain: verdict.because }
    }
    return { kind: 'hit', entry: { ...entry, uses: entry.uses + 1 } }
  }

  keep(entry: CachedAnalysis): { kind: 'stored' } | { kind: 'refused'; because: string } {
    if (entry.bound !== null || entry.score.kind === 'none') {
      this.refused.push('unsettled')
      return { kind: 'refused', because: 'no settled score' }
    }
    this.held.set(entry.bucket, entry)
    return { kind: 'stored' }
  }
}

interface Harness {
  engine: ChessEngine
  cache: Remembering
  dir: string
  fakes: Fake[]
  last: () => Fake
  behave: (next: (f: Fake, command: string) => void) => void
  done: () => Promise<void>
}

function harness(o: { handler?: (f: Fake, command: string) => void; cache?: AnalysisCachePort; home?: string } = {}): Harness {
  const dir = o.home ?? installedHome()
  const fakes: Fake[] = []
  let handler = o.handler ?? answers
  const cache = new Remembering()
  const engine = new ChessEngine({
    home: dir,
    platform: 'win32',
    cores: 4,
    memoryMb: 8192,
    cache: o.cache ?? cache,
    timeouts: { handshakeMs: 2000, readyMs: 2000, stopMs: 500, searchGraceMs: 200, maxSearchMs: 1500 },
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
    cache,
    dir,
    fakes,
    last: () => fakes[fakes.length - 1],
    behave: (next) => {
      handler = next
    },
    done: async () => {
      await engine.shutdown()
      // Only the home this harness made. A home handed in belongs to the test, which tidies it up itself -- and
      // deleting it here is what made the restart test look as though the engine had been uninstalled.
      if (!o.home) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
}

const settle = (p: Promise<unknown>): Promise<unknown> => p.then((v) => v, (e: unknown) => e)

// ---------------------------------------------------------------- the engine really consults it

test('the same position asked about twice costs one search, and the second answer says it was kept', async () => {
  const h = harness()
  const first = await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
  assert.equal(h.last().searches(), 1)
  assert.equal(first.from, null, 'a search that really happened must not claim to have been kept')
  assert.equal(first.depth, 22)

  const second = await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'two' })
  assert.equal(h.last().searches(), 1, 'the engine was asked to search a position it had already answered')
  assert.equal(second.complete, true)
  assert.equal(second.depth, 22)
  assert.deepEqual(second.score, { kind: 'cp', cp: 24 })
  // The answer belongs to the request that asked for it, exactly as a fresh one would.
  assert.equal(second.requestId, 'two')
  assert.equal(second.fen, START)
  // And it says what it is: which engine, how deep, how long, and that it has now been used twice.
  assert.ok(second.from)
  assert.equal(second.from?.depth, 22)
  assert.equal(second.from?.engine, 'Fakefish 1.2')
  assert.ok((second.from?.searchedFor ?? 0) > 0)
  await h.done()
})

test('a kept answer arrives as an update too, so a screen sees it where a fresh one would be', async () => {
  const h = harness()
  await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
  const updates: AnalysisResult[] = []
  const second = await h.engine.analyse({
    fen: START,
    limits: { depth: 10 },
    requestId: 'two',
    onUpdate: (update) => {
      if (update.complete) updates.push(update)
    }
  })
  assert.equal(updates.length, 1)
  assert.equal(updates[0], second)
  assert.ok(updates[0].from, 'the update must carry the provenance, or the screen claims a search happened')
  await h.done()
})

test("the lines of a kept answer are read against the position, not stored as somebody's notation", async () => {
  const h = harness()
  await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
  const second = await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'two' })
  // Worked out again by `rules.ts`, which is the one module that decides what a move is.
  assert.deepEqual(second.pvSan, ['e4', 'e5', 'Nf3'])
  assert.deepEqual(second.pvUci, ['e2e4', 'e7e5', 'g1f3'])
  assert.equal(second.bestmoveSan, 'e4')
  // How fast the machine was is not kept: it is a fact about that moment, not about this position.
  assert.equal(second.nps, null)
  await h.done()
})

test('a deeper ask searches again rather than being handed the shallower answer', async () => {
  const h = harness()
  await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
  assert.equal(h.last().searches(), 1)
  // The scripted engine reports depth 22 whatever it is asked for, so 30 is past what it reached.
  await h.engine.analyse({ fen: START, limits: { depth: 30 }, requestId: 'two' })
  assert.equal(h.last().searches(), 2)
  assert.deepEqual(h.cache.refused, ['depth'])
  await h.done()
})

test('a search that really thought for long enough answers a time limit; one that did not, does not', async () => {
  const h = harness({ handler: thinks })
  await h.engine.analyse({ fen: START, limits: { movetime: 30 }, requestId: 'one' })
  assert.equal(h.last().searches(), 1)
  // It thought for about sixty milliseconds, which is more than the thirty asked for, so it answers again.
  const kept = await h.engine.analyse({ fen: START, limits: { movetime: 30 }, requestId: 'two' })
  assert.equal(h.last().searches(), 1)
  assert.ok(kept.from)
  assert.ok((kept.from?.searchedFor ?? 0) >= 30)

  // Two seconds of thinking is more than it did, so that is searched afresh rather than answered with less work.
  await h.engine.analyse({ fen: START, limits: { movetime: 2000 }, requestId: 'three' })
  assert.equal(h.last().searches(), 2)
  assert.ok(h.cache.refused.includes('time'))
  await h.done()
})

test('a different position is a different question, and really is searched', async () => {
  const h = harness()
  await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
  await h.engine.analyse({ fen: AFTER_E4, limits: { depth: 10 }, requestId: 'two' })
  assert.equal(h.last().searches(), 2)
  assert.equal(h.cache.held.size, 2)
  await h.done()
})

test('asking for a fresh search gets one, and the answer is still kept', async () => {
  const h = harness()
  await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
  const fresh = await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'two', useCache: false })
  assert.equal(h.last().searches(), 2, '"search this again" must mean search it again')
  assert.equal(fresh.from, null)
  // Nothing was looked up for the fresh one, so the cache was not even asked.
  assert.equal(h.cache.looked.length, 1)
  assert.equal(h.cache.held.size, 1)
  await h.done()
})

test('an answer from an engine that was held back is neither kept nor served', async () => {
  const h = harness()
  /*
   * A move played by a gentle opponent is not an answer about the position.
   *
   * It came from the same engine with its strength dial turned down, so it is a different answer to the same
   * question -- and the key an answer is stored under is built from the options the engine had applied, read once
   * before the search and once after. Rather than make those two moments agree around a search that changes an
   * option, a held-back search stays out of the store entirely: the cache is not even asked, and nothing it found
   * is kept for anybody else to be handed later.
   */
  const weak = await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'gentle', skill: 3 })
  assert.equal(h.last().searches(), 1)
  assert.equal(weak.from, null, 'a search that really happened must not claim to have been kept')
  assert.equal(h.cache.looked.length, 0, 'the store was asked about a position being played, not analysed')
  assert.equal(h.cache.held.size, 0, 'a weakened answer was kept, and could be served to the analysis board')

  // And the same position asked about properly afterwards is really searched, not handed the weakened answer.
  const proper = await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'proper' })
  assert.equal(h.last().searches(), 2)
  assert.equal(proper.from, null)
  assert.equal(h.cache.held.size, 1)
  await h.done()
})

test('a variant never reuses standard chess’s answer', async () => {
  const h = harness()
  await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
  await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'two', variant: 'crazyhouse' })
  assert.equal(h.last().searches(), 2)
  await h.done()
})

test('a search that was stopped is kept as a stopped search, and is never served afterwards', async () => {
  const h = harness({ handler: stalls })
  const running = settle(h.engine.analyse({ fen: START, limits: { movetime: 5000 }, requestId: 'one' }))
  await new Promise((r) => setTimeout(r, 60))
  await h.engine.stop('one')
  const outcome = await running
  assert.ok(outcome instanceof ChessEngineError)
  assert.equal((outcome as ChessEngineError).code, 'cancelled')

  // What it had reached is kept, marked for what it is: a search of depth 14 that did not finish.
  assert.equal(h.cache.held.size, 1)
  const [entry] = [...h.cache.held.values()]
  assert.equal(entry.status, 'cancelled')
  assert.equal(entry.depth, 14)
  assert.match(entry.stoppedBecause ?? '', /Cancelled/)

  // And asking again searches again, because a stopped search is not an answer.
  h.behave(answers)
  const after = await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'two' })
  assert.equal(after.from, null)
  assert.ok(h.cache.refused.includes('incomplete'))
  await h.done()
})

test('an ask cancelled while the stored answer was being looked for is cancelled, not answered', async () => {
  const h = harness()
  await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
  const searches = h.last().searches()

  // Cancelled before the lookup settles. There is a perfectly good answer sitting there, and it is still not
  // delivered: the board has moved on, and an answer for the position somebody left is the wrong answer.
  const controller = new AbortController()
  const asking = settle(h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'two', signal: controller.signal }))
  controller.abort()
  const outcome = await asking
  assert.ok(outcome instanceof ChessEngineError)
  assert.equal((outcome as ChessEngineError).code, 'cancelled')
  // And no search was run for it either.
  assert.equal(h.last().searches(), searches)
  await h.done()
})

test('a stopped search does not overwrite the finished answer for the position just left', async () => {
  const h = harness()
  await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
  const [finished] = [...h.cache.held.values()]
  assert.equal(finished.status, 'complete')

  // Now the same position is asked about again and stopped halfway. The real store refuses the write; the Map here
  // accepts it, which is the point: the refusal has to live in the store, and `analysisStore.test.ts` proves it does.
  h.behave(stalls)
  const running = settle(h.engine.analyse({ fen: START, limits: { movetime: 5000 }, requestId: 'two', useCache: false }))
  await new Promise((r) => setTimeout(r, 60))
  await h.engine.stop('two')
  await running
  await h.done()
})

// ---------------------------------------------------------------- the real store, wired to the real engine

test('with the store on disk, a position asked about twice costs one search and survives a restart', async () => {
  const data = mkdtempSync(join(tmpdir(), 'orbis-chess-cache-data-'))
  // The same engine home across both runs, because it is the same computer starting up again. A different binary
  // would be a different engine and would correctly be a miss, which is what the version tests are about.
  const home = installedHome()
  const store = new AnalysisCacheStore(data, 'default')
  const h = harness({ cache: store, home })
  try {
    await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'one' })
    assert.equal(h.last().searches(), 1)
    assert.equal(store.size().entries, 1)

    const second = await h.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'two' })
    assert.equal(h.last().searches(), 1, 'the store and the engine do not fit together')
    assert.ok(second.from)
    assert.equal(store.stats().hits, 1)
    assert.equal(store.stats().misses, 1)
    assert.deepEqual(second.pvSan, ['e4', 'e5', 'Nf3'])
  } finally {
    store.close()
    await h.done()
  }

  // Opened again over the same folder, as Orbis does when it starts: the answer is still there.
  const after = new AnalysisCacheStore(data, 'default')
  const h2 = harness({ cache: after, home })
  try {
    const kept = await h2.engine.analyse({ fen: START, limits: { depth: 10 }, requestId: 'three' })
    // No engine process at all. The saving is not only the search: it is the whole start-up as well.
    assert.equal(h2.fakes.length, 0, 'nothing should have been started or searched after a restart')
    assert.ok(kept.from)
    assert.equal(kept.depth, 22)
  } finally {
    after.close()
    await h2.done()
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('the engine can say which engine an answer would come from without starting one', async () => {
  const h = harness()
  const identity = h.engine.engineIdentity()
  // Null before the install record has been read, because nothing has been established yet. After `status` -- which
  // reads the record and starts nothing -- it is the release tag and the binary, and never the engine's own claim.
  await h.engine.status()
  const after = h.engine.engineIdentity()
  assert.ok(after)
  assert.equal(after?.version, 'sf_19')
  assert.match(after?.build ?? '', /stockfish-windows-x86-64-universal\.exe:\d+:\d+/)
  assert.equal(after?.name, null, 'the engine has not said its name yet, so nothing may claim it has')
  assert.equal(h.fakes.length, 0, 'reading who the engine is must not start one')
  void identity
  await h.done()
})

// ---------------------------------------------------------------- reading a kept answer back

test('a kept move that cannot be played in the position is refused, in words, not guessed at', () => {
  const ask: AnalysisAsk = {
    fen: START,
    limits: { depth: 20 },
    lines: 1,
    variant: 'standard',
    engine: { name: 'Fakefish', version: 'sf_19', build: 'x', applied: {} },
    scope: 'position'
  }
  const key = keyFor(ask)
  assert.equal(key.kind, 'key')
  if (key.kind !== 'key') return
  const entry: CachedAnalysis = {
    schema: 1,
    bucket: key.key.bucket,
    request: key.key.request,
    fen: START,
    position: key.key.position,
    halfmove: 0,
    variant: 'standard',
    engineName: 'Fakefish',
    engineVersion: 'sf_19',
    engineBuild: 'x',
    options: '',
    asked: { depth: 20 },
    askedLines: 1,
    scope: 'position',
    score: { kind: 'cp', cp: 24 },
    depth: 20,
    seldepth: 24,
    nodes: 1000,
    timeMs: 100,
    elapsedMs: 120,
    bound: null,
    // A move that cannot be played from the starting position, which would mean the key and the position had come
    // apart. The coordinates are kept and the notation is not invented.
    bestmove: 'e4e5',
    pvUci: ['e4e5'],
    lines: [],
    status: 'complete',
    stoppedBecause: null,
    note: null,
    trimmedBecause: null,
    createdAt: 1,
    lastUsedAt: 1,
    uses: 0,
    pinned: false,
    bytes: 10
  }
  const result = resultFromEntry(entry, 'req', START)
  assert.equal(result.bestmove, null)
  assert.equal(result.bestmoveSan, null)
  assert.match(result.note ?? '', /not a legal move in this position/)
  assert.deepEqual(result.pvUci, ['e4e5'])
  assert.equal(result.pvSan, null, 'a line that cannot be played is dropped as notation, never half read')
})
