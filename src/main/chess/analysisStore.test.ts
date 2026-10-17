import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AnalysisCacheStore } from './analysisStore.ts'
import {
  CACHE_SCHEMA,
  DEFAULT_CACHE_LIMITS,
  halfmoveOf,
  keyFor,
  normaliseLimits,
  type AnalysisAsk,
  type CachedAnalysis,
  type CachedLine,
  type EngineIdentity
} from '../../shared/chess/analysisCache.ts'

/**
 * The engine's answers on disk.
 *
 * These are about the promises the store makes rather than about SQLite: that the same position asked about twice is
 * answered from what is kept, that an answer which does not fit the ask is refused *and says why*, that a profile's
 * answers are that profile's alone, that closing Orbis and opening it again does not lose them, that an evicted
 * answer becomes a miss rather than a wrong answer, and that every figure a developer is shown was counted.
 *
 * Between them and `src/shared/chess/analysisCache.test.ts` they are the fifteen cases Section 430 asks for. The ten
 * about storage are here; repeated requests, differing limits, engine version and option changes, castling rights,
 * side to move, mate scores, perspective and the stopped search are proved in both places -- in the pure module as a
 * decision and here as a row really written and really refused.
 */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const NO_CASTLING = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1'
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'

let clock = 1_760_000_000_000

const engine = (over: Partial<EngineIdentity> = {}): EngineIdentity => ({
  name: 'Fakefish 1.2',
  version: 'sf_19',
  build: 'C:/engine/stockfish.exe:81431614:1760000000000',
  applied: { Threads: '4', Hash: '512', MultiPV: '1' },
  ...over
})

const ask = (over: Partial<AnalysisAsk> = {}): AnalysisAsk => ({
  fen: START,
  limits: { depth: 20 },
  lines: 1,
  variant: 'standard',
  engine: engine(),
  scope: 'position',
  ...over
})

const line = (over: Partial<CachedLine> = {}): CachedLine => ({
  multipv: 1,
  score: { kind: 'cp', cp: 24 },
  depth: 20,
  seldepth: 26,
  nodes: 1_200_000,
  timeMs: 1980,
  bound: null,
  pvUci: ['e2e4', 'e7e5', 'g1f3'],
  ...over
})

/** An answer as a real search would have left it. Built through `keyFor`, so nothing here invents a key. */
function answerTo(a: AnalysisAsk, over: Partial<CachedAnalysis> = {}): CachedAnalysis {
  const key = keyFor(a)
  assert.equal(key.kind, 'key')
  if (key.kind !== 'key') throw new Error('unreachable')
  const k = key.key
  return {
    schema: CACHE_SCHEMA,
    bucket: k.bucket,
    request: k.request,
    fen: a.fen,
    position: k.position,
    halfmove: halfmoveOf(a.fen),
    variant: k.variant,
    engineName: a.engine.name,
    engineVersion: a.engine.version,
    engineBuild: a.engine.build,
    options: k.options,
    asked: normaliseLimits(a.limits),
    askedLines: a.lines,
    scope: a.scope,
    score: { kind: 'cp', cp: 24 },
    depth: 20,
    seldepth: 26,
    nodes: 1_200_000,
    timeMs: 1980,
    elapsedMs: 2010,
    bound: null,
    bestmove: 'e2e4',
    pvUci: ['e2e4', 'e7e5', 'g1f3'],
    lines: [line()],
    status: 'complete',
    stoppedBecause: null,
    note: null,
    trimmedBecause: null,
    createdAt: clock,
    lastUsedAt: clock,
    uses: 0,
    pinned: false,
    bytes: 0,
    ...over
  }
}

interface Bench {
  store: AnalysisCacheStore
  dir: string
  done: () => Promise<void>
}

const bench = async (o: { profile?: string; limits?: Partial<typeof DEFAULT_CACHE_LIMITS>; protect?: number } = {}): Promise<Bench> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-chess-cache-'))
  const store = new AnalysisCacheStore(dir, o.profile ?? 'default', { now: () => clock, limits: o.limits, protect: o.protect })
  return {
    store,
    dir,
    done: async () => {
      store.close()
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
}

// ---------------------------------------------------------------- the same question twice (case 1)

test('the same position asked about twice is answered from what was kept', async () => {
  const { store, done } = await bench()
  const a = ask()
  assert.equal(store.look(a).kind, 'miss')
  assert.equal(store.keep(answerTo(a)).kind, 'stored')

  const again = store.look(a)
  assert.equal(again.kind, 'hit')
  if (again.kind !== 'hit') return await done()
  assert.deepEqual(again.entry.score, { kind: 'cp', cp: 24 })
  assert.equal(again.entry.depth, 20)
  // Counted, not estimated: one miss, one hit, and the one answer that is held says it has been used once.
  const counters = store.stats()
  assert.equal(counters.lookups, 2)
  assert.equal(counters.hits, 1)
  assert.equal(counters.misses, 1)
  assert.equal(again.entry.uses, 1)
  await done()
})

test('a miss for a position nothing is stored for says exactly that', async () => {
  const { store, done } = await bench()
  const look = store.look(ask())
  assert.equal(look.kind, 'miss')
  if (look.kind !== 'miss') return await done()
  assert.equal(look.because, 'nothing-stored')
  assert.match(look.explain, /Nothing has been stored for this position yet/)
  assert.deepEqual(look.rejected, [])
  await done()
})

// ---------------------------------------------------------------- a different ask (cases 2, 3, 4)

test('a shallower kept answer is a miss for a deeper ask, and the miss says why', async () => {
  const { store, done } = await bench()
  store.keep(answerTo(ask({ limits: { depth: 12 } }), { depth: 12 }))

  const look = store.look(ask({ limits: { depth: 30 } }))
  assert.equal(look.kind, 'miss')
  if (look.kind !== 'miss') return await done()
  assert.equal(look.because, 'nothing-usable')
  assert.equal(look.rejected.length, 1)
  assert.equal(look.rejected[0].reason, 'depth')
  assert.match(look.explain, /only reached depth 12/)
  // The refusal is counted under its own reason, so a developer can see what the cache is refusing and why.
  assert.equal(store.stats().rejected.depth, 1)
  assert.equal(store.stats().hits, 0)
  await done()
})

test('an answer from an earlier engine version is never served, and the newer one sits beside it', async () => {
  const { store, done } = await bench()
  const old = ask({ engine: engine({ version: 'sf_17', build: 'C:/engine/stockfish.exe:7000000:1700000000000' }) })
  store.keep(answerTo(old, { depth: 40 }))

  const look = store.look(ask())
  assert.equal(look.kind, 'miss')
  if (look.kind !== 'miss') return await done()
  // Deeper than anything the new engine has found, and still refused: a depth-40 answer from a different engine is
  // not a better answer, it is an answer to a different question.
  assert.equal(look.rejected[0].reason, 'engine-version')
  assert.match(look.explain, /sf_17/)

  // The new engine's answer does not replace the old one; both are kept, segregated by the key.
  assert.equal(store.keep(answerTo(ask())).kind, 'stored')
  assert.equal(store.size().entries, 2)
  assert.equal(store.look(ask()).kind, 'hit')
  await done()
})

test('a change to how the engine is set up is a miss, and a change that only affects speed is not', async () => {
  const { store, done } = await bench()
  store.keep(answerTo(ask({ engine: engine({ applied: { 'Skill Level': '20' } }) })))

  const limited = store.look(ask({ engine: engine({ applied: { 'Skill Level': '3' } }) }))
  assert.equal(limited.kind, 'miss')
  if (limited.kind !== 'miss') return await done()
  assert.equal(limited.rejected[0].reason, 'options')

  // More threads and a bigger table are the same question asked on a less busy machine.
  const faster = store.look(ask({ engine: engine({ applied: { 'Skill Level': '20', Threads: '16', Hash: '2048' } }) }))
  assert.equal(faster.kind, 'hit')
  await done()
})

test('bounded cleanup removes the answers of an engine no longer in use, without touching the current one', async () => {
  const { store, done } = await bench()
  store.keep(answerTo(ask({ engine: engine({ version: 'sf_17', build: 'old' }) })))
  store.keep(answerTo(ask()))
  assert.equal(store.size().entries, 2)

  const identity = engine()
  assert.equal(store.forgetOtherEngines(identity.version, identity.build), 1)
  assert.equal(store.size().entries, 1)
  assert.equal(store.look(ask()).kind, 'hit')
  await done()
})

// ---------------------------------------------------------------- positions that look alike (cases 5, 6)

test('two boards differing only in a castling right keep separate answers', async () => {
  const { store, done } = await bench()
  store.keep(answerTo(ask({ fen: START }), { score: { kind: 'cp', cp: 24 } }))

  const other = store.look(ask({ fen: NO_CASTLING }))
  // Not a refusal: a different position is not stored under this one at all, which is the point of keying on
  // `positionKey`. The answer for the first board is simply not found for the second.
  assert.equal(other.kind, 'miss')
  if (other.kind !== 'miss') return await done()
  assert.equal(other.because, 'nothing-stored')

  store.keep(answerTo(ask({ fen: NO_CASTLING }), { score: { kind: 'cp', cp: -8 } }))
  const first = store.look(ask({ fen: START }))
  const second = store.look(ask({ fen: NO_CASTLING }))
  assert.equal(first.kind, 'hit')
  assert.equal(second.kind, 'hit')
  if (first.kind !== 'hit' || second.kind !== 'hit') return await done()
  assert.deepEqual(first.entry.score, { kind: 'cp', cp: 24 })
  assert.deepEqual(second.entry.score, { kind: 'cp', cp: -8 })
  await done()
})

test('the same pieces with the other side to move keeps a separate answer', async () => {
  const { store, done } = await bench()
  store.keep(answerTo(ask({ fen: START })))
  assert.equal(store.look(ask({ fen: BLACK_TO_MOVE })).kind, 'miss')
  await done()
})

// ---------------------------------------------------------------- scores survive being stored (cases 7, 8)

test('a forced mate comes back a forced mate, with its sign unchanged', async () => {
  const { store, done } = await bench()
  const a = ask({ fen: AFTER_E4 })
  // Stored from White's point of view, which is the one convention in Orbis. Black mating is a negative mate.
  store.keep(answerTo(a, { score: { kind: 'mate', moves: -3 }, bestmove: 'e7e5', pvUci: ['e7e5'], lines: [line({ score: { kind: 'mate', moves: -3 }, pvUci: ['e7e5'] })] }))

  const look = store.look(a)
  assert.equal(look.kind, 'hit')
  if (look.kind !== 'hit') return await done()
  // Nothing in the store turns it into a number of pawns, and nothing turns the sign round: whose point of view a
  // score is shown from is decided when it is drawn, by `forSide`, not by what was written to disk.
  assert.deepEqual(look.entry.score, { kind: 'mate', moves: -3 })
  assert.deepEqual(look.entry.lines[0].score, { kind: 'mate', moves: -3 })
  await done()
})

test('an answer with no settled score is not stored at all, and the refusal is counted', async () => {
  const { store, done } = await bench()
  const bounded = store.keep(answerTo(ask(), { bound: 'lower' }))
  assert.equal(bounded.kind, 'refused')
  if (bounded.kind !== 'refused') return await done()
  assert.match(bounded.because, /above or below a limit/)

  const scoreless = store.keep(answerTo(ask(), { score: { kind: 'none' } }))
  assert.equal(scoreless.kind, 'refused')
  assert.equal(store.size().entries, 0)
  assert.equal(store.stats().refusedUnsettled, 2)
  await done()
})

// ---------------------------------------------------------------- a search that was stopped (case 9)

test('a search that was stopped is kept as one, never served, and never lands on a finished answer', async () => {
  const { store, done } = await bench()
  const a = ask()
  store.keep(answerTo(a, { status: 'cancelled', stoppedBecause: 'Cancelled.', depth: 14 }))

  const look = store.look(a)
  assert.equal(look.kind, 'miss')
  if (look.kind !== 'miss') return await done()
  assert.equal(look.rejected[0].reason, 'incomplete')
  assert.equal(store.size().unfinished, 1)

  // Then a real search finishes and replaces it.
  clock += 1000
  assert.equal(store.keep(answerTo(a, { depth: 24, createdAt: clock })).kind, 'stored')
  assert.equal(store.look(a).kind, 'hit')

  // And a later arrival from a search that was stopped -- deeper, and newer -- does not get to overwrite it. This
  // is the fault itself: stepping forward through a game used to wipe the answer for the position just left.
  clock += 1000
  const late = store.keep(answerTo(a, { status: 'cancelled', depth: 30, createdAt: clock }))
  assert.equal(late.kind, 'refused')
  if (late.kind !== 'refused') return await done()
  assert.match(late.because, /finished answer.*already stored/)
  assert.equal(store.stats().superseded, 1)

  const still = store.look(a)
  assert.equal(still.kind, 'hit')
  if (still.kind !== 'hit') return await done()
  assert.equal(still.entry.depth, 24)
  assert.equal(still.entry.status, 'complete')
  await done()
})

// ---------------------------------------------------------------- staying inside its size (case 10)

test('an evicted answer is a miss and not a wrong answer, and what is being looked at is never evicted', async () => {
  // One question protected, so the eviction rule itself is what is being watched here rather than the protection.
  const { store, done } = await bench({ limits: { maxEntries: 2, evictBatch: 10 }, protect: 1 })
  const first = ask({ fen: START })
  const second = ask({ fen: NO_CASTLING })
  const third = ask({ fen: BLACK_TO_MOVE })

  clock += 1
  store.keep(answerTo(first))
  clock += 1
  store.keep(answerTo(second))
  clock += 1
  // Storing the third puts it over its size, so the coldest of the three goes -- and `first` is the coldest.
  store.keep(answerTo(third))

  assert.equal(store.size().entries, 2)
  assert.equal(store.stats().evicted, 1)
  const gone = store.look(first)
  assert.equal(gone.kind, 'miss')
  if (gone.kind !== 'miss') return await done()
  // The whole point: it is a miss, so the position is searched again. It is not a different position's answer.
  assert.equal(gone.because, 'nothing-stored')
  assert.equal(store.look(third).kind, 'hit')
  await done()
})

test('the answer somebody is looking at is not the one dropped to make room', async () => {
  // A size of one, and a batch sweep storing a second answer straight afterwards. Without the protection the
  // position on the screen is exactly what goes, because it is the coldest thing in the table.
  const { store, done } = await bench({ limits: { maxEntries: 1, evictBatch: 10 }, protect: 2 })
  const looking = ask({ fen: START })
  store.keep(answerTo(looking))
  assert.equal(store.look(looking).kind, 'hit')
  clock += 5000
  store.keep(answerTo(ask({ fen: NO_CASTLING }), { scope: 'game-sweep' }))
  assert.equal(store.look(looking).kind, 'hit', 'the position being looked at was evicted')
  // And what is protected is something that can be shown rather than taken on trust.
  assert.equal(store.protected().length, 2)
  await done()
})

test('a pinned answer is never evicted, however cold it is', async () => {
  const { store, done } = await bench({ limits: { maxEntries: 1, evictBatch: 10 }, protect: 1 })
  const pinned = ask({ fen: START })
  const kept = store.keep(answerTo(pinned))
  assert.equal(kept.kind, 'stored')
  if (kept.kind !== 'stored') return await done()
  assert.equal(store.pin(kept.bucket), true)

  // Four more answers, each one past the limit of one, and each one looked at so the pinned one is not protected
  // by being recent either.
  for (const fen of [NO_CASTLING, BLACK_TO_MOVE, AFTER_E4]) {
    clock += 10_000
    store.keep(answerTo(ask({ fen })))
    store.look(ask({ fen }))
  }
  assert.equal(store.look(pinned).kind, 'hit', 'a pinned answer was evicted')
  assert.equal(store.size().pinned, 1)
  await done()
})

test('a pin belongs to the question, so a better answer to it keeps the pin', async () => {
  const { store, done } = await bench()
  const a = ask()
  const kept = store.keep(answerTo(a, { depth: 12 }))
  assert.equal(kept.kind, 'stored')
  if (kept.kind !== 'stored') return await done()
  store.pin(kept.bucket)
  clock += 1000
  store.keep(answerTo(a, { depth: 24, createdAt: clock }))
  assert.equal(store.size().pinned, 1)
  await done()
})

test('one answer too big to keep is refused and nothing else is disturbed', async () => {
  const { store, done } = await bench()
  store.keep(answerTo(ask({ fen: START })))
  const huge = Array.from({ length: 40 }, () => 'x'.repeat(4000))
  const refused = store.keep(answerTo(ask({ fen: NO_CASTLING }), { pvUci: huge, lines: [] }))
  assert.equal(refused.kind, 'refused')
  assert.equal(store.stats().refusedTooBig, 1)
  assert.equal(store.size().entries, 1)
  assert.equal(store.look(ask({ fen: START })).kind, 'hit')
  await done()
})

test('a long line is shortened rather than the answer being lost', async () => {
  const { store, done } = await bench({ limits: { maxPvMoves: 4 } })
  const long = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4']
  store.keep(answerTo(ask(), { pvUci: long, lines: [line({ pvUci: long })] }))
  const look = store.look(ask())
  assert.equal(look.kind, 'hit')
  if (look.kind !== 'hit') return await done()
  assert.equal(look.entry.pvUci.length, 4)
  assert.match(look.entry.trimmedBecause ?? '', /shortened to 4 moves/)
  // The size is measured from what was really written, so the figure a developer sees is real.
  assert.ok(look.entry.bytes > 0)
  assert.equal(store.size().bytes, look.entry.bytes)
  await done()
})

// ---------------------------------------------------------------- when the file is wrong (case 11)

test('a file that is not a database is moved aside, said plainly, and a new one started', async () => {
  const { store, dir, done } = await bench()
  const file = store.path()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, 'this is not a database, it is a shopping list')

  // The cache carries on working, because every answer in it can be worked out again by asking the engine.
  assert.equal(store.keep(answerTo(ask())).kind, 'stored')
  assert.equal(store.look(ask()).kind, 'hit')
  assert.match(store.problem() ?? '', /could not be read, so it was moved to/)
  // Moved, never deleted: the bytes are still on the disk under their own name with the time on them.
  const aside = readdirSync(dirname(file)).filter((name) => name.includes('.unreadable-'))
  assert.equal(aside.length, 1)
  void dir
  await done()
})

test('a file that merely cannot be opened is left exactly where it is, and the cache switches itself off', async () => {
  const { store, done } = await bench()
  const file = store.path()
  // A folder in the file's place: there, and impossible to open as a database. Which is what antivirus holding a
  // file looks like from here, and the one case where writing defaults over it would be unrecoverable.
  mkdirSync(file, { recursive: true })
  mkdirSync(join(file, 'something-of-mine'), { recursive: true })

  assert.equal(store.available(), false)
  assert.match(store.problem() ?? '', /could not open the chess analysis cache/)
  const look = store.look(ask())
  assert.equal(look.kind, 'miss')
  if (look.kind !== 'miss') return await done()
  assert.equal(look.because, 'unavailable')
  // Every search still runs and is still right. Nothing was written over anything.
  assert.equal(store.keep(answerTo(ask())).kind, 'refused')
  assert.equal(existsSync(join(file, 'something-of-mine')), true)
  // And it is not reported as an empty cache, which would be a lie dressed up as a fact.
  assert.equal(store.size().entries, 0)
  assert.notEqual(store.problem(), null)
  await done()
})

test('a row that cannot be made sense of is stepped over, counted, and left alone', async () => {
  const { store, dir, done } = await bench()
  const a = ask()
  store.keep(answerTo(a))
  assert.equal(store.look(a).kind, 'hit')

  // One row's text ruined, as a half-written line or a bad sector would leave it.
  const bucket = (() => {
    const key = keyFor(a)
    return key.kind === 'key' ? key.key.bucket : ''
  })()
  store.close()
  const db = new (await import('node:sqlite')).DatabaseSync(store.path())
  db.prepare('UPDATE analysis SET payload = ? WHERE bucket = ?').run('{not json', bucket)
  db.close()

  const store2 = new AnalysisCacheStore(dir, 'default', { now: () => clock })
  const look = store2.look(a)
  assert.equal(look.kind, 'miss')
  if (look.kind !== 'miss') return await done()
  assert.equal(look.because, 'nothing-stored')
  assert.equal(store2.stats().readFailures, 1)
  store2.close()
  await done()
})

// ---------------------------------------------------------------- one profile's answers (case 12)

test("one profile's answers are that profile's alone", async () => {
  const { store, dir, done } = await bench({ profile: 'one' })
  store.keep(answerTo(ask()))
  assert.equal(store.look(ask()).kind, 'hit')

  store.useProfile('two')
  const other = store.look(ask())
  assert.equal(other.kind, 'miss')
  if (other.kind !== 'miss') return await done()
  assert.equal(other.because, 'nothing-stored')

  // And the first profile still has it when it comes back.
  store.useProfile('one')
  assert.equal(store.look(ask()).kind, 'hit')
  assert.notEqual(store.path('one'), store.path('two'))
  void dir
  await done()
})

// ---------------------------------------------------------------- closing and opening again (case 13)

test('closing Orbis and opening it again does not lose the answers', async () => {
  const { store, dir, done } = await bench()
  store.keep(answerTo(ask()))
  store.close()

  const after = new AnalysisCacheStore(dir, 'default', { now: () => clock })
  const look = after.look(ask())
  assert.equal(look.kind, 'hit')
  if (look.kind !== 'hit') return await done()
  assert.equal(look.entry.depth, 20)
  assert.deepEqual(look.entry.pvUci, ['e2e4', 'e7e5', 'g1f3'])
  after.close()
  await done()
})

test('everything can be forgotten, which is only safe because nothing in here was written by a person', async () => {
  const { store, done } = await bench()
  store.keep(answerTo(ask({ fen: START })))
  store.keep(answerTo(ask({ fen: NO_CASTLING })))
  assert.equal(store.clear(), 2)
  assert.equal(store.size().entries, 0)
  assert.equal(store.look(ask({ fen: START })).kind, 'miss')
  await done()
})

// ---------------------------------------------------------------- several at once (cases 14, 15)

test('several asks about the same position at once get one answer and do not cross', async () => {
  const { store, done } = await bench()
  const a = ask()
  const first = await Promise.all([0, 1, 2, 3].map(async () => store.look(a)))
  assert.deepEqual(first.map((l) => l.kind), ['miss', 'miss', 'miss', 'miss'])
  store.keep(answerTo(a))

  const second = await Promise.all([0, 1, 2, 3].map(async () => store.look(a)))
  assert.deepEqual(second.map((l) => l.kind), ['hit', 'hit', 'hit', 'hit'])
  // One row, used four times. Counted, so the figures and the table agree.
  assert.equal(store.size().entries, 1)
  const counters = store.stats()
  assert.equal(counters.hits, 4)
  assert.equal(counters.misses, 4)
  assert.equal(counters.lookups, 8)
  await done()
})

test('asks about different positions at once each get their own answer', async () => {
  const { store, done } = await bench()
  const asks = [START, NO_CASTLING, BLACK_TO_MOVE, AFTER_E4].map((fen, i) =>
    ask({ fen, limits: { depth: 20 } , lines: 1, scope: i === 3 ? 'game-sweep' : 'position' })
  )
  await Promise.all(asks.map(async (a, i) => store.keep(answerTo(a, { score: { kind: 'cp', cp: i * 10 } }))))

  const found = await Promise.all(asks.map(async (a) => store.look(a)))
  for (const [i, look] of found.entries()) {
    assert.equal(look.kind, 'hit', `position ${i} was not found`)
    if (look.kind !== 'hit') continue
    assert.deepEqual(look.entry.score, { kind: 'cp', cp: i * 10 }, `position ${i} got another position's answer`)
  }
  assert.equal(store.size().entries, 4)
  await done()
})

// ---------------------------------------------------------------- the figures agree with what happened

test('every figure a developer is shown was counted, and matches what really happened', async () => {
  const { store, done } = await bench()
  const shallow = ask({ limits: { depth: 12 } })
  const deeper = ask({ limits: { depth: 30 } })

  store.look(shallow)                                           // miss: nothing stored
  store.keep(answerTo(shallow, { depth: 12 }))                  // stored
  store.look(shallow)                                           // hit
  store.look(deeper)                                            // miss: refused, not deep enough
  clock += 1000
  store.keep(answerTo(deeper, { depth: 30, createdAt: clock })) // replaced, and a re-analysis
  store.look(deeper)                                            // hit

  const counters = store.stats()
  assert.equal(counters.lookups, 4)
  assert.equal(counters.hits, 2)
  assert.equal(counters.misses, 2)
  assert.equal(counters.rejected.depth, 1)
  assert.equal(counters.stored, 2)
  assert.equal(counters.replaced, 1)
  assert.equal(counters.reanalysed, 1)
  assert.equal(counters.readFailures, 0)
  assert.equal(counters.writeFailures, 0)
  assert.deepEqual(store.rejections(), [{ reason: 'depth', plain: 'not deep enough for what was asked', count: 1 }])

  // The table and the figures agree: one question, one row, and the size is what was really written.
  const size = store.size()
  assert.equal(size.entries, 1)
  assert.ok(size.bytes > 0)
  assert.equal(size.oldestAt, clock)
  assert.equal(size.unfinished, 0)
  await done()
})

test('a lookup with no engine to attribute an answer to is not counted as a lookup at all', async () => {
  const { store, done } = await bench()
  const look = store.look(ask({ engine: engine({ version: null, build: null }) }))
  assert.equal(look.kind, 'miss')
  if (look.kind !== 'miss') return await done()
  assert.equal(look.because, 'no-key')
  // Counting it would make the hit rate a lie about a question that was never asked.
  assert.equal(store.stats().lookups, 0)
  await done()
})
