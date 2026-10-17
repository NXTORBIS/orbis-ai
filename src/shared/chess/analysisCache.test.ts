import test from 'node:test'
import assert from 'node:assert/strict'
import { positionKey } from './rules.ts'
import type { Score } from './evaluation.ts'
import {
  CACHE_SCHEMA,
  CLOCK_REACH,
  DEFAULT_CACHE_LIMITS,
  NEEDS_GAME,
  POSITION_FIELDS,
  averageLookupMs,
  better,
  cacheReport,
  chooseEvictions,
  clockMatters,
  emptyCounters,
  fit,
  halfmoveOf,
  hitRate,
  keyFor,
  materialOptions,
  normaliseLimits,
  reusedFrom,
  reusedSentence,
  servable,
  type AnalysisAsk,
  type CachedAnalysis,
  type CachedLine,
  type EngineIdentity
} from './analysisCache.ts'

/**
 * The decisions about reusing an engine's answer.
 *
 * Every test here is about a refusal, because every way this feature can go wrong is a reuse that should not have
 * happened. A cache that misses too often is slow. A cache that hits when it should not have shows somebody a
 * depth-12 evaluation under the words "depth 30", and they believe it.
 */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const NO_CASTLING = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1'
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1'
const CLOCK_FIVE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 9'
const CLOCK_SEVEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 10'
/** Deep into the fifty-move count: from here a search really does run into the draw. */
const CLOCK_SIXTY = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 60 40'
const CLOCK_SIXTY_TWO = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 62 41'

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

/** An answer as it would have been stored by a search that really ran. */
const entryFor = (a: AnalysisAsk, over: Partial<CachedAnalysis> = {}): CachedAnalysis => {
  const key = keyFor(a)
  assert.equal(key.kind, 'key', 'the fixture needs a keyable ask')
  const k = key.kind === 'key' ? key.key : null
  assert.ok(k)
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
    createdAt: 1_760_000_000_000,
    lastUsedAt: 1_760_000_000_000,
    uses: 0,
    pinned: false,
    bytes: 900,
    ...over
  }
}

const bucketOf = (a: AnalysisAsk): string => {
  const key = keyFor(a)
  assert.equal(key.kind, 'key')
  return key.kind === 'key' ? key.key.bucket : ''
}

// ---------------------------------------------------------------- the key (Sections 421, 422)

test('the name of a position in a key is the one rules.ts gives it, character for character', () => {
  const key = keyFor(ask())
  assert.equal(key.kind, 'key')
  if (key.kind !== 'key') return
  assert.equal(key.key.position, positionKey(START))
  // Not merely equal: the key is built from it, so there is no second opinion about what makes two boards the same
  // question. This is the assertion that fails the day somebody writes their own position hash here.
  assert.ok(key.key.bucket.includes(`p:${positionKey(START)}`))
})

test('two boards identical but for a castling right are different questions', () => {
  assert.notEqual(bucketOf(ask({ fen: START })), bucketOf(ask({ fen: NO_CASTLING })))
})

test('the same pieces with the other side to move is a different question', () => {
  assert.notEqual(bucketOf(ask({ fen: START })), bucketOf(ask({ fen: BLACK_TO_MOVE })))
})

test('a different halfmove clock is the same question while the draw is out of reach', () => {
  // Five moves and seven moves into the fifty-move count: no search Orbis runs can see the hundredth halfmove from
  // either, so the two are the same question and one answer serves both.
  assert.equal(bucketOf(ask({ fen: CLOCK_FIVE })), bucketOf(ask({ fen: CLOCK_SEVEN })))
  assert.equal(clockMatters(5, { depth: 20 }), false)
})

test('a different halfmove clock is a different question once the draw is in reach', () => {
  assert.equal(clockMatters(60, { depth: 20 }), true)
  assert.notEqual(bucketOf(ask({ fen: CLOCK_SIXTY })), bucketOf(ask({ fen: CLOCK_SIXTY_TWO })))
})

test('a search deep enough to see the draw puts the clock in the question whatever the clock is', () => {
  // The stated reach is what decides it when nothing in the ask says. A deeper ask than that lowers the threshold,
  // because the reach is an assumption and the ask's own depth is a fact.
  assert.equal(clockMatters(5, { depth: 99 }), true)
  assert.equal(clockMatters(19, {}), false)
  assert.equal(clockMatters(20, {}), true)
  assert.equal(CLOCK_REACH, 80)
})

test('the limits are out of the question and in the request, so a deeper answer can serve a shallower ask', () => {
  const shallow = keyFor(ask({ limits: { depth: 12 } }))
  const deep = keyFor(ask({ limits: { depth: 30 } }))
  assert.equal(shallow.kind, 'key')
  assert.equal(deep.kind, 'key')
  if (shallow.kind !== 'key' || deep.kind !== 'key') return
  assert.equal(shallow.key.bucket, deep.key.bucket)
  // The same question, two different requests. Both are needed: one so a deeper answer can be reused, the other so
  // "the same thing asked twice" can be told from "something else asked once".
  assert.notEqual(shallow.key.request, deep.key.request)
})

test('a variant never shares a question with standard chess', () => {
  assert.notEqual(bucketOf(ask()), bucketOf(ask({ variant: 'crazyhouse' })))
})

test('there is no key at all without an engine to attribute the answer to', () => {
  const key = keyFor(ask({ engine: engine({ version: null, build: null }) }))
  assert.equal(key.kind, 'no-key')
  if (key.kind !== 'no-key') return
  assert.match(key.because, /cannot tell which engine/i)
})

test('options that only change the speed are not part of the question, and anything unrecognised is', () => {
  // Threads and Hash change how fast a depth-20 search gets there, not what a depth-20 answer claims to be.
  assert.equal(materialOptions({ Threads: '8', Hash: '1024', MultiPV: '3' }), '')
  // Skill Level changes what the engine looks for, so it is part of the question.
  assert.equal(materialOptions({ Threads: '8', 'Skill Level': '10' }), 'Skill Level=10')
  // And so is an option this code has never heard of: not knowing whether it matters is not knowing that it does not.
  assert.equal(materialOptions({ SomeNewThing: 'on' }), 'SomeNewThing=on')
  assert.notEqual(
    bucketOf(ask({ engine: engine({ applied: { 'Skill Level': '10' } }) })),
    bucketOf(ask({ engine: engine({ applied: { 'Skill Level': '20' } }) }))
  )
  assert.equal(
    bucketOf(ask({ engine: engine({ applied: { Threads: '2' } }) })),
    bucketOf(ask({ engine: engine({ applied: { Threads: '16' } }) }))
  )
})

test('the key does not change with how the position is spelt out', () => {
  const spaced = `  ${START}  `
  assert.equal(bucketOf(ask({ fen: spaced })), bucketOf(ask({ fen: START })))
  // Nor with a limit written as a fraction: a limit is keyed as the whole number the engine is really sent.
  assert.equal(bucketOf(ask({ limits: { depth: 20.4 } })), bucketOf(ask({ limits: { depth: 20 } })))
})

// ---------------------------------------------------------------- whether an answer may be reused (423, 424)

test('the same request twice reuses the answer', () => {
  const a = ask()
  assert.deepEqual(servable(entryFor(a), a), { usable: true })
})

test('a shallower answer is not served to a deeper ask', () => {
  const stored = entryFor(ask({ limits: { depth: 12 } }), { depth: 12 })
  const verdict = servable(stored, ask({ limits: { depth: 30 } }))
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'depth')
  assert.match(verdict.because, /only reached depth 12.*asks for 30/)
})

test('a deeper answer is served to a shallower ask', () => {
  const stored = entryFor(ask({ limits: { depth: 30 } }), { depth: 31 })
  assert.equal(servable(stored, ask({ limits: { depth: 20 } })).usable, true)
})

test('an answer from a different engine version is not served', () => {
  const stored = entryFor(ask(), { engineVersion: 'sf_17' })
  const verdict = servable(stored, ask())
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'engine-version')
  assert.match(verdict.because, /sf_17.*sf_19/)
})

test('an answer from a different copy of the engine at the same path is not served', () => {
  const stored = entryFor(ask(), { engineBuild: 'C:/engine/stockfish.exe:99999999:1770000000000' })
  const verdict = servable(stored, ask())
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'engine-build')
})

test('the engine saying its own name differently does not throw an answer away', () => {
  // The release tag and the binary are facts Orbis established. The name is a claim the engine made about itself,
  // and a build that prints it differently must not cost somebody every answer they already have.
  const stored = entryFor(ask(), { engineName: 'Stockfish dev-20260101' })
  assert.equal(servable(stored, ask()).usable, true)
})

test('an answer found with the engine set up differently is not served', () => {
  const careful = ask({ engine: engine({ applied: { 'Skill Level': '20' } }) })
  const limited = ask({ engine: engine({ applied: { 'Skill Level': '3' } }) })
  const verdict = servable(entryFor(careful), limited)
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'options')
})

test('a search that was stopped is never served as a finished answer', () => {
  const stored = entryFor(ask(), { status: 'cancelled', stoppedBecause: 'Cancelled.' })
  const verdict = servable(stored, ask())
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'incomplete')
  assert.match(verdict.because, /stopped before it finished/)
})

test('a score the engine only ever gave as a bound is not served as an evaluation', () => {
  const stored = entryFor(ask(), { bound: 'lower' })
  const verdict = servable(stored, ask())
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'bound')
})

test('an answer with no score is not served, and is never read as a score of nought', () => {
  const stored = entryFor(ask(), { score: { kind: 'none' } })
  const verdict = servable(stored, ask())
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'no-score')
})

test('a forced mate stays a forced mate and is never weighed against a number of pawns', () => {
  const mate: Score = { kind: 'mate', moves: 3 }
  const a = ask({ limits: { depth: 10 } })
  const stored = entryFor(a, { score: mate, depth: 18 })
  assert.equal(servable(stored, a).usable, true)
  assert.deepEqual(stored.score, { kind: 'mate', moves: 3 })
  // Nothing here turns a mate into centipawns, so the stored score comes back the kind it went in as.
  assert.equal(reusedFrom(stored).depth, 18)
})

test('a search shorter than the time asked for is not served, whatever depth it reached', () => {
  // A depth-30 answer that took 300 ms did less thinking than two seconds, and a busy laptop would not have got
  // there in two seconds. The two are the same unit, so they are compared; the depth is not what was asked about.
  const quick = entryFor(ask({ limits: { depth: 30 } }), { depth: 30, elapsedMs: 300, timeMs: 290 })
  const verdict = servable(quick, ask({ limits: { movetime: 2000 } }))
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'time')
  assert.match(verdict.because, /ran for 300 ms.*asks for 2.0 seconds/)
})

test('a search at least as long as the time asked for is served', () => {
  const long = entryFor(ask({ limits: { depth: 30 } }), { depth: 30, elapsedMs: 4300 })
  assert.equal(servable(long, ask({ limits: { movetime: 2000 } })).usable, true)
})

test('a time limit is weighed against the clock Orbis kept, not the one the engine reported', () => {
  // An engine's own figure is the time at the moment it printed the line, which is always a little short of the
  // search it was given -- so comparing with it would make the same request asked twice a miss.
  const stored = entryFor(ask({ limits: { movetime: 2000 } }), { timeMs: 1981, elapsedMs: 2043 })
  assert.equal(servable(stored, ask({ limits: { movetime: 2000 } })).usable, true)
})

test('how long a search took being unrecorded is said, not treated as nought', () => {
  const stored = entryFor(ask(), { elapsedMs: null, timeMs: null })
  const verdict = servable(stored, ask({ limits: { movetime: 1000 } }))
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.match(verdict.because, /never recorded/)
})

test('fewer lines than were asked for is a refusal, unless there were no more to find', () => {
  const one = entryFor(ask({ lines: 1 }), { askedLines: 1, lines: [line()] })
  const verdict = servable(one, ask({ lines: 3 }))
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'lines')
  // A position with two legal moves cannot produce three lines. A search that asked for three and finished has
  // found everything there was, so it answers an ask for three.
  const twoOfThree = entryFor(ask({ lines: 3 }), { askedLines: 3, lines: [line(), line({ multipv: 2 })] })
  assert.equal(servable(twoOfThree, ask({ lines: 3 })).usable, true)
})

test('an answer older than the cache keeps answers for is refused rather than quietly served', () => {
  const stored = entryFor(ask(), { createdAt: 1000 })
  const verdict = servable(stored, ask(), { now: 1000 + 5000, maxAgeMs: 1000 })
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'expired')
})

test('an answer stored by an older format is refused, not read wrongly', () => {
  const stored = entryFor(ask(), { schema: CACHE_SCHEMA - 1 })
  const verdict = servable(stored, ask())
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'schema')
})

test('an answer about a different position is refused even if it somehow reaches the ask', () => {
  const stored = entryFor(ask({ fen: NO_CASTLING }))
  const verdict = servable(stored, ask({ fen: START }))
  assert.equal(verdict.usable, false)
  if (verdict.usable) return
  assert.equal(verdict.reason, 'position')
})

// ---------------------------------------------------------------- what replaces what (Section 429)

test('a search that was stopped never lands on top of one that finished', () => {
  const a = ask()
  const finished = entryFor(a, { depth: 24, createdAt: 100 })
  // The later arrival. Deeper than nothing, newer than the finished one, and still not allowed to replace it: this
  // is exactly the case where stepping forward through a game wiped the answer for the position just left.
  const stopped = entryFor(a, { status: 'cancelled', depth: 30, createdAt: 200 })
  assert.equal(better(stopped, finished), false)
  assert.equal(better(finished, stopped), true)
})

test('a deeper finished answer replaces a shallower one, and a shallower one does not replace a deeper', () => {
  const a = ask()
  const shallow = entryFor(a, { depth: 12, createdAt: 100 })
  const deep = entryFor(a, { depth: 30, createdAt: 50 })
  assert.equal(better(deep, shallow), true)
  assert.equal(better(shallow, deep), false)
})

test('a settled score replaces one that was only ever a bound', () => {
  const a = ask()
  const bounded = entryFor(a, { bound: 'upper', depth: 30 })
  const settled = entryFor(a, { bound: null, depth: 22 })
  assert.equal(better(settled, bounded), true)
})

// ---------------------------------------------------------------- size and eviction (Section 427)

test('a line too long to store is shortened rather than the answer being thrown away', () => {
  const long = Array.from({ length: 90 }, (_, i) => `m${i}`)
  const fitted = fit(entryFor(ask(), { pvUci: long, lines: [line({ pvUci: long })] }))
  assert.equal(fitted.kind, 'fits')
  if (fitted.kind !== 'fits') return
  assert.equal(fitted.entry.pvUci.length, DEFAULT_CACHE_LIMITS.maxPvMoves)
  assert.match(fitted.entry.trimmedBecause ?? '', /shortened to 40 moves/)
  // The engine's own note is not where Orbis's bookkeeping goes.
  assert.equal(fitted.entry.note, null)
  // And the size is measured, not guessed.
  assert.ok(fitted.entry.bytes > 0)
})

test('one answer too big even shortened is refused, and says how big it was', () => {
  const huge = Array.from({ length: 40 }, () => 'x'.repeat(4000))
  const fitted = fit(entryFor(ask(), { pvUci: huge, lines: [] }))
  assert.equal(fitted.kind, 'too-big')
  if (fitted.kind !== 'too-big') return
  assert.match(fitted.because, /kB.*not kept/)
})

test('eviction never drops what somebody is looking at, nor anything pinned', () => {
  const now = 10_000_000
  const candidates = [
    { bucket: 'looking-at', bytes: 100, lastUsedAt: 1, createdAt: 1, status: 'complete' as const, pinned: false },
    { bucket: 'pinned', bytes: 100, lastUsedAt: 2, createdAt: 2, status: 'complete' as const, pinned: true },
    { bucket: 'cold', bytes: 100, lastUsedAt: 3, createdAt: 3, status: 'complete' as const, pinned: false },
    { bucket: 'warm', bytes: 100, lastUsedAt: 9_999_999, createdAt: 4, status: 'complete' as const, pinned: false }
  ]
  const limits = { ...DEFAULT_CACHE_LIMITS, maxEntries: 3 }
  const dropping = chooseEvictions(candidates, limits, { now, keep: new Set(['looking-at']) })
  assert.deepEqual(dropping.map((d) => d.bucket), ['cold'])
  assert.equal(dropping[0].reason, 'least-recently-used')
})

test('a search that never finished is dropped before one that did', () => {
  const now = 10_000_000
  const candidates = [
    { bucket: 'stopped', bytes: 100, lastUsedAt: 500, createdAt: 1, status: 'cancelled' as const, pinned: false },
    { bucket: 'older-but-finished', bytes: 100, lastUsedAt: 1, createdAt: 1, status: 'complete' as const, pinned: false }
  ]
  const dropping = chooseEvictions(candidates, { ...DEFAULT_CACHE_LIMITS, maxEntries: 1 }, { now })
  assert.deepEqual(dropping.map((d) => d.bucket), ['stopped'])
  assert.equal(dropping[0].reason, 'unfinished')
})

test('an answer past its age goes whether or not there is any pressure on the size', () => {
  const now = 10_000_000
  const candidates = [
    { bucket: 'old', bytes: 1, lastUsedAt: now, createdAt: 0, status: 'complete' as const, pinned: false },
    { bucket: 'fresh', bytes: 1, lastUsedAt: now, createdAt: now, status: 'complete' as const, pinned: false }
  ]
  const dropping = chooseEvictions(candidates, { ...DEFAULT_CACHE_LIMITS, maxAgeMs: 1000 }, { now })
  assert.deepEqual(dropping.map((d) => d.bucket), ['old'])
  assert.equal(dropping[0].reason, 'expired')
})

test('one eviction pass is bounded, so a save is never a long pause', () => {
  const now = 10_000_000
  const many = Array.from({ length: 50 }, (_, i) => ({
    bucket: `b${i}`, bytes: 1000, lastUsedAt: i, createdAt: now, status: 'complete' as const, pinned: false
  }))
  const dropping = chooseEvictions(many, { ...DEFAULT_CACHE_LIMITS, maxEntries: 1, evictBatch: 10 }, { now })
  assert.equal(dropping.length, 10)
})

// ---------------------------------------------------------------- what the counters say (Section 428)

test('nothing measured is reported as nothing measured, never as nought', () => {
  const counters = emptyCounters()
  assert.equal(averageLookupMs(counters), null)
  assert.equal(hitRate(counters), null)
  assert.deepEqual(cacheReport(counters, { entries: 0, bytes: 0, oldestAt: null, newestAt: null, unfinished: 0, pinned: 0 })[0],
    'Nothing has been looked up yet.')
})

test('the average lookup is a division of two counted figures', () => {
  const counters = { ...emptyCounters(), lookups: 4, lookupMs: 10, hits: 3 }
  assert.equal(averageLookupMs(counters), 2.5)
  assert.equal(hitRate(counters), 0.75)
})

test('a refusal is reported in words a developer can read, with the count beside it', () => {
  const counters = { ...emptyCounters(), lookups: 2, hits: 0, misses: 2, rejected: { depth: 2, 'engine-version': 1 } }
  const report = cacheReport(counters, { entries: 5, bytes: 5000, oldestAt: 1, newestAt: 2, unfinished: 1, pinned: 1 })
  assert.ok(report.some((l) => l.includes('not deep enough for what was asked')))
  assert.ok(report.some((l) => l.includes('a different engine version')))
  assert.ok(report.some((l) => l.includes('never served as answers')))
  assert.ok(report.some((l) => l.includes('pinned')))
})

// ---------------------------------------------------------------- what travels between games (Section 425)

test('what a position answer may say, and what needs the whole game, are written down and do not overlap', () => {
  const position = new Set(POSITION_FIELDS.map((f) => f.field))
  for (const needs of NEEDS_GAME) assert.equal(position.has(needs.field), false, `${needs.field} cannot be both`)
  // The three that make a cache a lie if they travel: whether the position has been reached before, whether a draw
  // can be claimed, and anybody's note on the move.
  const names = NEEDS_GAME.map((f) => f.field)
  assert.ok(names.includes('repetition'))
  assert.ok(names.includes('fifty-move'))
  assert.ok(names.includes('annotations'))
  for (const field of [...POSITION_FIELDS, ...NEEDS_GAME]) assert.ok(field.plain.length > 10, `${field.field} needs plain words`)
})

test('a reused answer can say what it was, and never claims a figure it has not got', () => {
  const stored = entryFor(ask(), { depth: null, elapsedMs: null, timeMs: null })
  const sentence = reusedSentence(stored)
  assert.match(sentence, /did not report/)
  assert.ok(!/depth null/.test(sentence))
  const known = reusedSentence(entryFor(ask(), { depth: 24, elapsedMs: 2100 }))
  assert.match(known, /depth 24/)
  assert.match(known, /2\.1 seconds/)
})

test('a limit is normalised to what the engine is really sent', () => {
  assert.deepEqual(normaliseLimits({ depth: 200 }), { depth: 99 })
  assert.deepEqual(normaliseLimits({ movetime: 0 }), {})
  assert.deepEqual(normaliseLimits({ movetime: 2500.7 }), { movetime: 2500 })
  assert.deepEqual(normaliseLimits(undefined), {})
})
