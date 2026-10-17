import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newPuzzle, verifyPuzzle, type Puzzle } from './puzzles.ts'
import type { Provenance } from './exercise.ts'
import {
  BANDS_FOR_A_CLIMB, COUNTED_WEIGHTS, FEWEST_PUZZLES, MODE_LABEL, RATED_FOR_A_CLIMB, RUNS_KEPT, RUN_LIVES,
  RUN_MODES, addRunRecord, bestRun, countedWeight, isRunning, ladderFor, limitMs, modeStanding, queueFor,
  readRunRow, recordMissed, recordSolved, recordWordsFor, remainingMs, runModeById, runRecordOf, runWords,
  runsFor, settleRun, skipPuzzle, startRun, stopRun, timeUpAt,
  type Run, type RunRecord
} from './puzzleRun.ts'

/**
 * A run of puzzles against the clock: the modes, the lives, the climb, and the refusals.
 *
 * ## The positions here are real
 *
 * Every one is a legal position and every mate claimed is a mate the rules can prove -- `verifyPuzzle` is run over
 * each puzzle below and the tests assert it came back verified, so a position that stopped being a mate would fail
 * here rather than quietly become a puzzle with no answer.
 *
 *   - `MATE_1`   -- `6k1/5ppp/8/8/8/8/5PPP/R5K1 w` -- Ra8 is mate, and it is the only mate.
 *   - `TWO_WAYS` -- `6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w` -- Ra8 and Rd8 both mate.
 *   - `QUIET`    -- `3q1r1k/8/8/2N5/8/8/8/4K3 w` -- Nc5-e6 takes nothing and gives no check.
 *
 * ## What is checked, and why each one is here
 *
 * The clock is the heart of it. A run holds the moment it started, so the two things that break a counter-driven
 * clock are tested directly: a window that was not drawn for four seconds comes back to the right time, and a solve
 * reported after the clock ran out is **not** counted and says why. The second is the one that matters -- it is the
 * difference between a score and a score with a few extra points in it.
 *
 * The other half is the climb. In this product no puzzle has a rating, so a rated climb cannot be built, and the
 * test that says so is the honest one: `ladderFor` must answer `counted` and must say what is missing, rather than
 * shuffling the list and calling itself a rush.
 */

const MATE_1 = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'
const TWO_WAYS = '6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1'
const QUIET = '3q1r1k/8/8/2N5/8/8/8/4K3 w - - 0 1'

const AUTHORED: Provenance = { kind: 'authored', by: 'the test' }
const NOW = 1_700_000_000_000

function mate(o: { id: string; fen?: string; lines?: string[][]; rating?: number }): Puzzle {
  const draft = newPuzzle({
    id: o.id,
    kind: 'puzzle',
    startFen: o.fen ?? MATE_1,
    objective: 'mate-in-n',
    movesToMate: 1,
    prompt: `Mate in one (${o.id}).`,
    solution: { lines: (o.lines ?? [['a1a8']]).map((line) => ({ move: line[0] })) },
    source: AUTHORED,
    addedAt: NOW,
    ...(o.rating !== undefined ? { rating: o.rating } : {})
  })
  const done = verifyPuzzle(draft, NOW)
  assert.equal(done.puzzle.exercise.verification.status, 'verified', `${o.id} should have been provable`)
  return done.puzzle
}

/** A material-win puzzle whose answer takes nothing and gives no check, so the quiet-move weight applies. */
function quiet(id: string, rating?: number): Puzzle {
  const draft = newPuzzle({
    id,
    kind: 'puzzle',
    startFen: QUIET,
    objective: 'win-material',
    materialAtLeast: 500,
    prompt: 'Win material.',
    solution: { lines: [{ move: 'c5e6' }] },
    source: AUTHORED,
    addedAt: NOW,
    ...(rating !== undefined ? { rating } : {})
  })
  return verifyPuzzle(draft, NOW).puzzle
}

/** Enough puzzles for a run, all of them unrated, which is what a real profile has. */
function pool(count: number): Puzzle[] {
  const out: Puzzle[] = []
  for (let at = 0; at < count; at++) out.push(mate({ id: `m${at}`, fen: at % 2 === 0 ? MATE_1 : TWO_WAYS, lines: at % 2 === 0 ? [['a1a8']] : [['a1a8'], ['d1d8']] }))
  return out
}

function started(mode: 'three-minute' | 'five-minute' | 'survival', puzzles: Puzzle[], now = NOW): Run {
  const begun = startRun({ mode, puzzles, now, seed: 7, id: 'run-under-test' })
  assert.ok(begun.ok && begun.run, begun.says)
  return begun.run as Run
}

// ---------------------------------------------------------------- the modes

test('there are three modes, no more, and no multiplayer among them', () => {
  assert.deepEqual(RUN_MODES.map((one) => one.id), ['three-minute', 'five-minute', 'survival'])
  assert.equal(limitMs('three-minute'), 180_000)
  assert.equal(limitMs('five-minute'), 300_000)
  assert.equal(limitMs('survival'), null, 'survival has no clock, and that is not a clock of zero')
  for (const mode of RUN_MODES) {
    assert.equal(mode.lives, RUN_LIVES)
    assert.ok(mode.what.length > 20, `${mode.id} should say in words what happens`)
    assert.equal(MODE_LABEL[mode.id], mode.label)
  }
  assert.equal(runModeById('battle'), null, 'there is no battle mode: that would need another person')
})

// ---------------------------------------------------------------- the climb, and what it refuses

test('no puzzle in this product has a rating, so a run cannot be ordered by rating and says so', () => {
  const ladder = ladderFor(pool(30))
  assert.equal(ladder.kind, 'counted')
  assert.equal(ladder.rated, 0)
  assert.equal(ladder.order.length, 30)
  // The refusal has to be in words a screen can show, and it has to name both reasons.
  assert.ok(ladder.shortOf.length >= 2, 'what is missing for a rated climb should be listed')
  assert.ok(ladder.shortOf.some((one) => one.includes(String(RATED_FOR_A_CLIMB))), 'it should say how many rated puzzles a climb needs')
  assert.ok(ladder.shortOf.some((one) => one.toLowerCase().includes('own games')), 'it should say why none of them has one')
  // And the order must say it is counted and say it is not rated, in the sentence a screen shows.
  assert.ok(ladder.says.toLowerCase().includes('counted off the board'))
  assert.ok(ladder.says.toLowerCase().includes('not rated'))
  assert.ok(ladder.why.toLowerCase().includes('not a rating'))
})

test('a rated climb is built only when there are enough rated puzzles over enough bands', () => {
  // Twenty rated puzzles, all within one band: enough of them, and still not a climb.
  const oneBand = Array.from({ length: RATED_FOR_A_CLIMB }, (_, at) => mate({ id: `b${at}`, rating: 1000 + at }))
  const flat = ladderFor(oneBand)
  assert.equal(flat.kind, 'counted', 'twenty puzzles of the same difficulty is a list, not a climb')
  assert.ok(flat.shortOf.some((one) => one.includes(String(BANDS_FOR_A_CLIMB))))

  // Spread over bands: now it is a climb, and it is ordered easiest first.
  const spread = Array.from({ length: RATED_FOR_A_CLIMB }, (_, at) => mate({ id: `s${at}`, rating: 700 + at * 110 }))
  const climb = ladderFor(spread)
  assert.equal(climb.kind, 'rated')
  assert.deepEqual(climb.shortOf, [])
  const ratings = climb.order.map((id) => spread.find((one) => one.id === id)?.rating ?? 0)
  assert.deepEqual(ratings, [...ratings].sort((a, b) => a - b), 'a rated climb goes easiest first')
})

test('a rated climb leaves the unrated ones out rather than ordering half a list', () => {
  const rated = Array.from({ length: RATED_FOR_A_CLIMB }, (_, at) => mate({ id: `r${at}`, rating: 700 + at * 110 }))
  const ladder = ladderFor([...rated, ...pool(8)])
  assert.equal(ladder.kind, 'rated')
  assert.equal(ladder.order.length, RATED_FOR_A_CLIMB)
  assert.equal(ladder.usable, RATED_FOR_A_CLIMB + 8)
  assert.ok(ladder.why.includes('8'), 'it should say how many were left out')
})

test('too few puzzles is no run at all, and the number is said', () => {
  const ladder = ladderFor(pool(FEWEST_PUZZLES - 1))
  assert.equal(ladder.kind, 'none')
  assert.deepEqual(ladder.order, [])
  assert.ok(ladder.why.includes(String(FEWEST_PUZZLES)))
  const begun = startRun({ mode: 'survival', puzzles: pool(FEWEST_PUZZLES - 1), now: NOW })
  assert.equal(begun.ok, false)
  assert.equal(begun.run, null)
})

test('the counted order is arithmetic over things counted off the board, and is never a rating', () => {
  const one = countedWeight(mate({ id: 'one', fen: MATE_1, lines: [['a1a8']] }))
  const two = countedWeight(mate({ id: 'two', fen: TWO_WAYS, lines: [['a1a8'], ['d1d8']] }))
  assert.ok(one.legalMoves !== null && one.legalMoves > 0)
  assert.equal(one.answers, 1)
  assert.equal(two.answers, 2)
  // Two ways to do it is easier than one, by exactly the weight that is written down.
  assert.equal(two.weight, (two.legalMoves ?? 0) - COUNTED_WEIGHTS.perExtraAnswer, 'the arithmetic should be the weights, not a feel')
  assert.ok(one.facts.length >= 2, 'what went into it should be sayable')

  // A quiet move is counted as harder, and the quiet weight is why.
  const hushed = countedWeight(quiet('q'))
  assert.equal(hushed.quiet, true)
  assert.equal(hushed.weight, (hushed.legalMoves ?? 0) + COUNTED_WEIGHTS.quietMove - 0)
})

test('a position that will not load is counted as nothing and says so, rather than as easy', () => {
  const broken = { ...mate({ id: 'broken' }), exercise: { ...mate({ id: 'broken' }).exercise, startFen: 'not a position' } }
  const counted = countedWeight(broken as Puzzle)
  assert.equal(counted.legalMoves, null, 'nothing was counted, which is not the same as zero moves')
  assert.equal(counted.weight, 0)
  assert.ok(counted.facts[0].includes('will not load'))
})

// ---------------------------------------------------------------- the queue

test('the order is shuffled inside each tier and never across them, so the climb survives', () => {
  const ladder = ladderFor(pool(30))
  const first = queueFor(ladder, 1)
  const second = queueFor(ladder, 2)
  assert.equal(first.length, 30)
  assert.notDeepEqual(first, second, 'two seeds should not give the same run')
  // The same ids, in both, exactly once each: a run never serves a puzzle twice.
  assert.deepEqual([...first].sort(), [...ladder.order].sort())
  assert.equal(new Set(first).size, 30)
  // Tier by tier, nothing has crossed. Six tiers of five over thirty puzzles.
  const place = new Map(ladder.order.map((id, at) => [id, at]))
  for (const order of [first, second]) {
    for (let at = 0; at < order.length; at++) {
      const tier = Math.floor(at / 5)
      const wanted = Math.floor((place.get(order[at]) ?? 0) / 5)
      assert.equal(tier, wanted, `${order[at]} moved out of its tier`)
    }
  }
})

test('the same seed gives the same run, which is what makes a run testable at all', () => {
  const ladder = ladderFor(pool(20))
  assert.deepEqual(queueFor(ladder, 99), queueFor(ladder, 99))
})

// ---------------------------------------------------------------- the clock

test('the clock is worked out from when the run started, so four seconds nobody drew still cost four seconds', () => {
  const run = started('three-minute', pool(10))
  assert.equal(remainingMs(run, NOW), 180_000)
  assert.equal(remainingMs(run, NOW + 4000), 176_000, 'a window that stopped redrawing does not stop the clock')
  assert.equal(timeUpAt(run), NOW + 180_000)
  assert.equal(remainingMs(run, NOW + 500_000), 0, 'never below zero')
})

test('survival has no clock, and that is null rather than a number', () => {
  const run = started('survival', pool(10))
  assert.equal(timeUpAt(run), null)
  assert.equal(remainingMs(run, NOW + 9_999_999), null)
  assert.ok(runWords(run, NOW).startsWith('No clock'))
})

test('the run ends at the moment the clock really ran out, not when somebody noticed', () => {
  const run = started('three-minute', pool(10))
  const late = settleRun(run, NOW + 184_000)
  assert.equal(late.ended, 'time')
  assert.equal(late.endedAt, NOW + 180_000, 'the run ended when the clock did')
  assert.equal(remainingMs(late, NOW + 184_000), 0)
  // Idempotent: settling again changes nothing.
  assert.equal(settleRun(late, NOW + 999_999), late)
})

test('a solve reported after the clock had gone is not counted, and says why', () => {
  const run = started('three-minute', pool(10))
  const step = recordSolved(run, NOW + 190_000)
  assert.equal(step.counted, false)
  assert.equal(step.run.solved, 0, 'the score must not take a point from after the clock')
  assert.equal(step.run.ended, 'time')
  assert.ok(step.says.toLowerCase().includes('clock had already run out'))
  // And a wrong move after the clock does not count against somebody either.
  const against = recordMissed(run, 'wrong', NOW + 190_000)
  assert.equal(against.counted, false)
  assert.equal(against.run.livesLeft, RUN_LIVES)
})

// ---------------------------------------------------------------- scoring, lives and ending

test('a solve is one point, and a run of them is kept as the best run', () => {
  let run = started('survival', pool(10))
  for (let at = 0; at < 4; at++) {
    const step = recordSolved(run, NOW + at * 5000)
    assert.equal(step.counted, true)
    run = step.run
  }
  assert.equal(run.solved, 4)
  assert.equal(run.streak, 4)
  assert.equal(run.bestStreak, 4)
  assert.equal(run.livesLeft, RUN_LIVES)
  assert.equal(run.at, 4)
  const broken = recordMissed(run, 'wrong', NOW + 30_000)
  assert.equal(broken.run.streak, 0)
  assert.equal(broken.run.bestStreak, 4, 'the best run of the day is kept once it has happened')
})

test('three lives, and the third one ends the run whatever the clock says', () => {
  let run = started('five-minute', pool(10))
  run = recordMissed(run, 'wrong', NOW + 1000).run
  assert.equal(run.livesLeft, 2)
  assert.ok(isRunning(run))
  run = recordMissed(run, 'shown', NOW + 2000).run
  assert.equal(run.livesLeft, 1)
  assert.ok(isRunning(run))
  const last = recordMissed(run, 'wrong', NOW + 3000)
  assert.equal(last.run.livesLeft, 0)
  assert.equal(last.run.ended, 'lives')
  assert.equal(last.run.endedAt, NOW + 3000)
  assert.equal(last.counted, true)
  // Nothing more goes in.
  assert.equal(recordSolved(last.run, NOW + 4000).counted, false)
})

test('asking to see it costs a life, because a run with no cost to that is not a run', () => {
  const run = started('survival', pool(10))
  const step = recordMissed(run, 'shown', NOW + 1000)
  assert.equal(step.run.livesLeft, RUN_LIVES - 1)
  assert.equal(step.run.results[0].why, 'shown')
  assert.equal(step.run.results[0].solved, false)
})

test('a run ends when the puzzles do, rather than serving one of them twice', () => {
  let run = started('survival', pool(FEWEST_PUZZLES))
  for (let at = 0; at < FEWEST_PUZZLES; at++) run = recordSolved(run, NOW + at * 1000).run
  assert.equal(run.ended, 'pool')
  assert.equal(run.solved, FEWEST_PUZZLES)
  assert.equal(new Set(run.results.map((one) => one.puzzleId)).size, FEWEST_PUZZLES, 'no puzzle was served twice')
  const record = runRecordOf(run)
  assert.ok(record)
  assert.equal(record?.served, FEWEST_PUZZLES)
  assert.ok(recordWordsFor(record as RunRecord).includes('every puzzle you had'))
})

test('a puzzle that cannot be finished is passed over and costs nothing', () => {
  const run = started('survival', pool(10))
  const step = skipPuzzle(run, NOW + 1000)
  assert.equal(step.run.livesLeft, RUN_LIVES)
  assert.equal(step.run.solved, 0)
  assert.equal(step.run.missed, 0)
  assert.deepEqual(step.run.results, [], 'it goes in no result, because nothing happened')
  assert.equal(step.run.at, 1)
})

test('stopping is a real run and is recorded as one', () => {
  let run = started('five-minute', pool(10))
  run = recordSolved(run, NOW + 2000).run
  const stopped = stopRun(run, NOW + 3000)
  assert.equal(stopped.ended, 'stopped')
  const record = runRecordOf(stopped)
  assert.equal(record?.score, 1)
  assert.equal(record?.seconds, 3)
  assert.equal(runRecordOf(run), null, 'a run still going has no record yet')
})

test('a per-puzzle time is counted from when that puzzle went up, not from the start of the run', () => {
  let run = started('survival', pool(10))
  run = recordSolved(run, NOW + 10_000).run
  run = recordSolved(run, NOW + 14_000).run
  assert.equal(run.results[0].seconds, 10)
  assert.equal(run.results[1].seconds, 4)
})

// ---------------------------------------------------------------- the record of runs

test('the best score is read off the runs rather than kept beside them', () => {
  const made = (mode: 'three-minute' | 'survival', score: number, at: number): RunRecord => ({
    id: `r${at}`, mode, climb: 'counted', startedAt: NOW + at, endedAt: NOW + at + 1000,
    seconds: 1, score, missed: 0, bestStreak: score, served: 10, ended: 'time'
  })
  let runs: readonly RunRecord[] = []
  runs = addRunRecord(runs, made('three-minute', 4, 1))
  runs = addRunRecord(runs, made('three-minute', 9, 2))
  runs = addRunRecord(runs, made('survival', 2, 3))
  assert.equal(bestRun(runs, 'three-minute')?.score, 9)
  assert.equal(bestRun(runs, 'survival')?.score, 2)
  assert.equal(bestRun(runs, 'five-minute'), null, 'a mode nobody has run has no best score, not a zero')
  assert.equal(runsFor(runs, 'three-minute').length, 2)

  const one = modeStanding(runs, 'survival')
  assert.ok(one.says.includes('One run is one run'), 'one run should not be dressed up as a measurement')
  assert.equal(modeStanding(runs, 'five-minute').says, 'No runs yet.')
})

test('only the last fifty runs are kept, and the oldest go first', () => {
  let runs: readonly RunRecord[] = []
  for (let at = 0; at < RUNS_KEPT + 5; at++) {
    runs = addRunRecord(runs, {
      id: `r${at}`, mode: 'survival', climb: 'counted', startedAt: NOW + at, endedAt: NOW + at + 1,
      seconds: 1, score: at, missed: 0, bestStreak: 0, served: 10, ended: 'lives'
    })
  }
  assert.equal(runs.length, RUNS_KEPT)
  assert.equal(runs[0].id, 'r5')
  assert.equal(runs[runs.length - 1].id, `r${RUNS_KEPT + 4}`)
})

// ---------------------------------------------------------------- reading one back

test('a stored run is read back as it was stored, with fields this version does not know kept', () => {
  const read = readRunRow({
    id: 'r1', mode: 'three-minute', climb: 'counted', startedAt: NOW, endedAt: NOW + 180_000,
    seconds: 180, score: 11, missed: 2, bestStreak: 6, served: 40, ended: 'time',
    somethingLater: 'kept'
  })
  assert.ok(read)
  assert.equal(read?.score, 11)
  assert.equal(read?.ended, 'time')
  assert.equal((read as unknown as { somethingLater: string }).somethingLater, 'kept')
})

test('a run missing what it scored is left out rather than counted as nothing', () => {
  assert.equal(readRunRow({ mode: 'survival', startedAt: NOW, endedAt: NOW + 10 }), null, 'no score is not a score of zero')
  assert.equal(readRunRow({ mode: 'survival', startedAt: NOW, score: 4 }), null)
  assert.equal(readRunRow({ mode: 'what', startedAt: NOW, endedAt: NOW + 10, score: 4 }), null)
  assert.equal(readRunRow({}), null)
})

/*
 * The round trip through the file the runs really live in.
 *
 * `readTrainingFile` is the reader for `personal/chess-training.json`, and it is pure -- no files, no Electron --
 * so it can be driven from here. It is worth driving from here rather than only through the store, because the one
 * thing that would make a best score quietly wrong is a run log that survives being written and not being read.
 */
test('runs survive the training file they are kept in, and a bad row does not take the good ones with it', async () => {
  const { readTrainingFile } = await import('../../main/chess/shapes.ts')
  const run: RunRecord = {
    id: 'r1', mode: 'five-minute', climb: 'counted', startedAt: NOW, endedAt: NOW + 300_000,
    seconds: 300, score: 13, missed: 1, bestStreak: 7, served: 40, ended: 'time'
  }
  const read = readTrainingFile({ runs: [run, { mode: 'five-minute' }, run] }, NOW)
  assert.equal(read.value.runs.length, 2, 'the two readable runs were kept')
  assert.equal(read.value.runs[0].score, 13)
  assert.ok(read.notes.some((one) => one.includes('puzzle runs')), 'the row that could not be read is said out loud')

  // Nothing stored means no runs, which is not the same as a file that could not be read.
  assert.deepEqual(readTrainingFile(null, NOW).value.runs, [])
  assert.deepEqual(readTrainingFile({}, NOW).value.runs, [])
})

test('a stored run with an odd ending or climb is kept, with the odd value named plainly', () => {
  const read = readRunRow({ mode: 'survival', startedAt: NOW, endedAt: NOW + 5000, score: 3, ended: 'exploded', climb: 'vibes' })
  assert.ok(read)
  assert.equal(read?.ended, 'stopped', 'an ending this version does not know reads as having been stopped')
  assert.equal(read?.climb, 'none', 'a climb this version does not know is no climb, not a rated one')
  assert.equal(read?.seconds, 5, 'a missing length is worked out from the two times it does have')
})
