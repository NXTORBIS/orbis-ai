import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCURACY_FORMULA, ACCURACY_NOTES, CALENDAR_RULES, CANNOT_ESTABLISH, COMPLETION_RULE, DEFAULT_DAY_RULES, FIRM_AT,
  GOOD_CLASSES, MOST_POINTS, WHAT_THESE_ARE, accuracyIn, addDays, bestBucket, changeBetween, completionIn, countsIn,
  dayEnd, dayKey, dayLabel, dayStart, daysBetween, eventsFromAnalyses, eventsFromGames, eventsFromOpenings,
  eventsFromTraining, mergeEvents, monthStart, progressReport, rangeBetween, rangeOf, rate, series, shortDayLabel,
  successIn, weekStart, type ActivityEvent, type CompletionRecord, type DayRules
} from './progress.ts'
import { EVIDENCE, type AnalysedGame, type AnalysedMove, type OpeningRecallRecord, type TrainingRecord } from './coach.ts'
import { START_FEN } from './rules.ts'
import type { MoveClass } from './evaluation.ts'
import type { StoredGame } from './model.ts'

/**
 * The measures, and the honesty rules that make them measures rather than decoration.
 *
 * Two of these tests matter more than the rest. One is the gap: a bucket with nothing in it must come out as null and
 * not as nought, because a quiet week shown as a nought per cent solve rate is a lie drawn as a chart. The other is
 * the accuracy definition: the formula the screen shows and the arithmetic the number comes from are checked against
 * each other here, so they cannot drift.
 */

const D = (y: number, m: number, d: number, h = 0, mi = 0): number => Date.UTC(y, m - 1, d, h, mi)
const DAY = 86_400_000

// ---------------------------------------------------------------- the calendar

describe('the calendar', () => {
  const plain = DEFAULT_DAY_RULES
  /** India, half an hour off the hour, with a day that starts at four in the morning. */
  const india: DayRules = { offsetMinutes: 330, dayStartHour: 4 }

  test('a day is the local day, and an offset that is not a whole hour is handled', () => {
    assert.equal(dayKey(D(2026, 10, 16, 12), plain), '2026-10-16')
    assert.equal(dayKey(D(2026, 10, 16, 23, 59), plain), '2026-10-16')
    assert.equal(dayKey(D(2026, 10, 17, 0, 1), plain), '2026-10-17')
    // 20:00 UTC is 01:30 the next day in India, which is before four in the morning, so it is still the 16th.
    assert.equal(dayKey(D(2026, 10, 16, 20), india), '2026-10-16')
    // 23:00 UTC is 04:30, which is after it.
    assert.equal(dayKey(D(2026, 10, 16, 23), india), '2026-10-17')
  })

  test('a day starts and ends where the key says it does', () => {
    const at = D(2026, 10, 16, 20)
    assert.equal(dayKey(dayStart(at, india), india), '2026-10-16')
    assert.equal(dayEnd(at, india) - dayStart(at, india), DAY)
    assert.equal(dayKey(dayEnd(at, india), india), '2026-10-17')
    // The boundary itself belongs to the day it opens, not the one it closes.
    assert.equal(dayStart(dayEnd(at, india) - 1, india), dayStart(at, india))
    assert.equal(dayStart(dayEnd(at, india), india), dayEnd(at, india))
  })

  test('a week begins on Monday, on the same hours', () => {
    // 16 October 2026 is a Friday.
    assert.equal(dayKey(weekStart(D(2026, 10, 16, 12), plain), plain), '2026-10-12')
    assert.equal(dayKey(weekStart(D(2026, 10, 12, 0), plain), plain), '2026-10-12')
    assert.equal(dayKey(weekStart(D(2026, 10, 18, 23), plain), plain), '2026-10-12')
    assert.equal(dayKey(weekStart(D(2026, 10, 19, 0), plain), plain), '2026-10-19')
    assert.equal(dayKey(weekStart(D(2026, 10, 16, 20), india), india), '2026-10-12')
  })

  test('a month begins on the first', () => {
    assert.equal(dayKey(monthStart(D(2026, 10, 16, 12), plain), plain), '2026-10-01')
    assert.equal(dayKey(monthStart(D(2026, 1, 31, 23), plain), plain), '2026-01-01')
  })

  test('days are added and counted whole', () => {
    assert.equal(dayKey(addDays(D(2026, 10, 16, 12), -7, plain), plain), '2026-10-09')
    assert.equal(dayKey(addDays(D(2026, 2, 28, 12), 1, plain), plain), '2026-03-01')
    assert.equal(daysBetween(D(2026, 10, 9, 23), D(2026, 10, 16, 1), plain), 7)
    assert.equal(daysBetween(D(2026, 10, 16, 1), D(2026, 10, 16, 23), plain), 0)
  })

  test('dates are written out, not left to a locale', () => {
    assert.equal(dayLabel(D(2026, 10, 16, 12), plain), '16 October 2026')
    assert.equal(shortDayLabel(D(2026, 1, 3, 12), plain), '3 Jan')
  })

  test('the rules are written down, including the one about daylight saving', () => {
    assert.ok(CALENDAR_RULES.some((one) => /Monday to Sunday/.test(one)))
    assert.ok(CALENDAR_RULES.some((one) => /daylight-saving/.test(one)))
    assert.ok(CALENDAR_RULES.some((one) => /later than now is ignored/.test(one)))
  })
})

describe('the range', () => {
  const now = D(2026, 10, 16, 12)

  test('a window of days ends at the end of today, so the last bucket does not shrink as the day goes on', () => {
    const range = rangeOf(now, 'week')
    assert.equal(range.days, 7)
    assert.equal(dayKey(range.from), '2026-10-10')
    assert.equal(dayKey(range.to - 1), '2026-10-16')
    assert.equal(range.label, 'the last 7 days, 10 October 2026 to 16 October 2026')
    assert.equal(rangeOf(now, 'month').days, 30)
    assert.equal(rangeOf(now, 'quarter').days, 90)
    assert.equal(rangeOf(now, 'year').days, 365)
  })

  test('everything recorded needs a first record before it can name a date', () => {
    assert.equal(rangeOf(now, 'all').label, 'everything recorded')
    const withOne = rangeOf(now, 'all', DEFAULT_DAY_RULES, D(2026, 3, 2, 9))
    assert.match(withOne.label, /everything recorded, 2 March 2026 to 16 October 2026/)
    assert.equal(dayKey(withOne.from), '2026-03-02')
  })

  test('a range the person chose covers both of its days whole, whichever way round they came', () => {
    const range = rangeBetween(D(2026, 10, 16, 23), D(2026, 10, 10, 1))
    assert.equal(range.days, 7)
    assert.equal(range.label, '10 October 2026 to 16 October 2026')
  })
})

// ---------------------------------------------------------------- rates

describe('a rate', () => {
  test('with nothing to divide it has no value, and that is not nought', () => {
    const empty = rate(0, 0, { what: 'came out right', outOf: 'attempts' })
    assert.equal(empty.value, null)
    assert.equal(empty.firm, false)
    assert.match(empty.says, /No attempts yet, so there is no rate to give/)
  })

  test('it always carries both of its numbers and says when there are too few', () => {
    const thin = rate(2, 3, { what: 'came out right', outOf: 'attempts' })
    assert.equal(thin.hits, 2)
    assert.equal(thin.of, 3)
    assert.equal(thin.value, 2 / 3)
    assert.equal(thin.firm, false)
    assert.match(thin.says, /2 of 3 attempts came out right \(67 per cent\)/)
    assert.match(thin.says, /3 is few/)
    assert.match(thin.says, new RegExp(`${FIRM_AT.success} is where it starts to mean something`))
  })

  test('above the threshold it stops apologising for itself', () => {
    const firm = rate(15, 30, { what: 'came out right', outOf: 'attempts' })
    assert.equal(firm.firm, true)
    assert.match(firm.says, /15 of 30 attempts came out right \(50 per cent\)\.$/)
  })
})

// ---------------------------------------------------------------- sittings

const event = (o: Partial<ActivityEvent> & { id: string; at: number }): ActivityEvent => ({
  activity: 'puzzle',
  thing: 'e1',
  worked: true,
  succeeded: true,
  clean: true,
  ...o
})

describe('counting what happened', () => {
  const now = D(2026, 10, 16, 12)
  const range = rangeOf(now, 'week')

  test('a sitting that produced nothing is counted apart, never as activity', () => {
    const counts = countsIn([
      event({ id: 'a', at: D(2026, 10, 14, 10) }),
      event({ id: 'b', at: D(2026, 10, 14, 11), worked: false }),
      event({ id: 'c', at: D(2026, 10, 14, 12), worked: false })
    ], range)
    assert.equal(counts.attempts, 1)
    assert.equal(counts.reopened, 2)
    assert.equal(counts.byActivity.puzzle, 1)
    assert.match(counts.says, /2 times something finished was opened again, which is not counted as activity/)
  })

  test('minutes come only from sittings that recorded a time, and the number that did is reported', () => {
    const counts = countsIn([
      event({ id: 'a', at: D(2026, 10, 14, 10), seconds: 300 }),
      event({ id: 'b', at: D(2026, 10, 14, 11), seconds: 600 }),
      event({ id: 'c', at: D(2026, 10, 14, 12) })
    ], range)
    assert.equal(counts.minutes, 15)
    assert.equal(counts.timed, 2)
    assert.equal(counts.attempts, 3)
  })

  test('days active and different things are counted as what they are', () => {
    const counts = countsIn([
      event({ id: 'a', at: D(2026, 10, 14, 10), thing: 'x' }),
      event({ id: 'b', at: D(2026, 10, 14, 23), thing: 'x' }),
      event({ id: 'c', at: D(2026, 10, 15, 10), thing: 'y' })
    ], range)
    assert.equal(counts.attempts, 3)
    assert.equal(counts.daysActive, 2)
    assert.equal(counts.things, 2)
  })

  test('anything outside the range is left out of all of it', () => {
    const counts = countsIn([
      event({ id: 'a', at: D(2026, 10, 1, 10) }),
      event({ id: 'b', at: D(2026, 10, 14, 10) })
    ], range)
    assert.equal(counts.attempts, 1)
    assert.match(counts.says, /the last 7 days/)
  })

  test('with nothing in the range it says so rather than showing noughts', () => {
    const counts = countsIn([], range)
    assert.equal(counts.attempts, 0)
    assert.match(counts.says, /^Nothing recorded in the last 7 days/)
  })
})

describe('success rates and completion rates are different things', () => {
  const now = D(2026, 10, 16, 12)
  const range = rangeOf(now, 'month')

  test('a game is counted and never rated, because losing a good game is not failing', () => {
    const rates = successIn([
      event({ id: 'g', at: D(2026, 10, 14), activity: 'play', succeeded: null, clean: null }),
      event({ id: 'p', at: D(2026, 10, 14), succeeded: true }),
      event({ id: 'q', at: D(2026, 10, 14), succeeded: false, clean: false })
    ], range)
    assert.equal(rates.overall.of, 2)
    assert.equal(rates.overall.hits, 1)
    assert.equal(rates.notRateable, 1)
    assert.match(rates.says, /a game is not passed or failed/)
    assert.equal(rates.byActivity.some((one) => one.activity === 'play'), false)
  })

  test('coming out right and coming out right unaided are two rates', () => {
    const rates = successIn([
      event({ id: 'a', at: D(2026, 10, 14), succeeded: true, clean: false }),
      event({ id: 'b', at: D(2026, 10, 14), succeeded: true, clean: true })
    ], range)
    assert.equal(rates.overall.hits, 2)
    assert.equal(rates.clean.hits, 1)
    assert.equal(rates.clean.of, 2)
  })

  test('a completion rate counts things started inside the range, and says that is what it does', () => {
    const records: CompletionRecord[] = [
      { kind: 'lesson', id: 'l1', startedAt: D(2026, 10, 2), completedAt: D(2026, 10, 3) },
      { kind: 'lesson', id: 'l2', startedAt: D(2026, 10, 2), completedAt: null },
      // Started long before the range and finished inside it: counted neither way.
      { kind: 'course', id: 'c1', startedAt: D(2025, 1, 1), completedAt: D(2026, 10, 4) }
    ]
    const rates = completionIn(records, range)
    assert.equal(rates.overall.of, 2)
    assert.equal(rates.overall.hits, 1)
    assert.equal(rates.rule, COMPLETION_RULE)
    assert.match(rates.rule, /Something started earlier is not counted either way/)
    assert.deepEqual(rates.byKind.map((one) => one.kind), ['lesson'])
  })

  test('with nothing started, the completion rate has no value and says so', () => {
    const rates = completionIn([], range)
    assert.equal(rates.overall.value, null)
    assert.match(rates.says, /Nothing was started inside/)
  })
})

// ---------------------------------------------------------------- accuracy

describe('accuracy', () => {
  const now = D(2026, 10, 16, 12)
  const range = rangeOf(now, 'month')

  const analysedMoves = (n: number, klass: MoveClass, from = 0): AnalysedMove[] =>
    Array.from({ length: n }, (_, i) => ({ ply: from + i, side: 'w' as const, san: 'Nf3', before: START_FEN, klass, loss: null }))

  const analysed = (o: { id?: string; depth?: number; at?: number; you?: 'w' | 'b' | null; moves: AnalysedMove[] }): AnalysedGame => ({
    gameId: o.id ?? 'g',
    you: o.you === undefined ? 'w' : o.you,
    analysedAt: o.at ?? D(2026, 10, 10),
    depth: o.depth ?? 20,
    moves: o.moves
  })

  test('the formula the screen shows is the arithmetic the number comes from', () => {
    const game = analysed({ moves: [...analysedMoves(30, 'good'), ...analysedMoves(20, 'mistake', 100), ...analysedMoves(10, 'unclear', 200)] })
    const result = accuracyIn([game], range)
    assert.equal(result.judged, 50)
    assert.equal(result.good, 30)
    assert.equal(result.unjudged, 10)
    assert.equal(result.value, 30 / 50)
    assert.equal(result.good / result.judged, result.value)
    assert.equal(result.formula, ACCURACY_FORMULA)
    assert.deepEqual(result.notes, ACCURACY_NOTES)
    assert.match(result.says, /60 per cent: 30 of 50 judged moves/)
    assert.match(result.says, /10 moves were left out because the engine could not judge them/)
    assert.equal(result.firm, true)
  })

  test('best, excellent and good are what counts as the engine agreeing; a missed mate is not', () => {
    assert.deepEqual([...GOOD_CLASSES], ['best', 'excellent', 'good'])
    const game = analysed({ moves: [...analysedMoves(2, 'best'), ...analysedMoves(2, 'excellent', 10), ...analysedMoves(2, 'missed-mate', 20)] })
    const result = accuracyIn([game], range)
    assert.equal(result.good, 4)
    assert.equal(result.judged, 6)
  })

  test('with nothing judgeable there is no figure at all, and never a nought', () => {
    const result = accuracyIn([analysed({ moves: analysedMoves(20, 'unclear') })], range)
    assert.equal(result.value, null)
    assert.equal(result.unjudged, 20)
    assert.match(result.says, /no accuracy figure/)
  })

  test('shallow games and games that do not name your side are left out, and the reason is counted', () => {
    const games = [
      analysed({ id: 'shallow', depth: 6, moves: analysedMoves(60, 'good') }),
      analysed({ id: 'nobody', you: null, moves: analysedMoves(60, 'good') }),
      analysed({ id: 'old', at: D(2026, 1, 1), moves: analysedMoves(60, 'good') })
    ]
    const result = accuracyIn(games, range)
    assert.equal(result.value, null)
    assert.equal(result.games, 0)
    assert.deepEqual(result.skipped, { tooShallow: 1, noSide: 1, outOfRange: 1 })
    assert.ok(ACCURACY_NOTES.some((one) => one.includes(`depth ${EVIDENCE.minDepth}`)))
  })

  test('games analysed at different depths are still added up, and the mixture is declared', () => {
    const games = [
      analysed({ id: 'a', depth: 14, moves: analysedMoves(30, 'good') }),
      analysed({ id: 'b', depth: 22, moves: analysedMoves(30, 'best', 100) })
    ]
    const result = accuracyIn(games, range)
    assert.deepEqual([...result.depths], [14, 22])
    assert.match(result.says, /analysed at different depths \(14, 22\)/)
  })

  test('too few judged moves is said beside the number rather than hidden', () => {
    const result = accuracyIn([analysed({ moves: analysedMoves(10, 'good') })], range)
    assert.equal(result.firm, false)
    assert.match(result.says, new RegExp(`${FIRM_AT.accuracy} is where this starts to mean something`))
  })
})

// ---------------------------------------------------------------- charts

describe('a series for a chart', () => {
  const now = D(2026, 10, 16, 12)
  const range = rangeOf(now, 'week')

  test('a count series has one bucket a day, labelled, with the axes named', () => {
    const made = series({
      key: 'k',
      title: 'How much you did',
      axisY: 'Sittings',
      unit: 'count',
      range,
      bucket: 'day',
      items: [{ at: D(2026, 10, 14, 1) }, { at: D(2026, 10, 14, 23) }, { at: D(2026, 10, 16, 5) }]
    })
    assert.equal(made.points.length, 7)
    assert.equal(made.axisX, 'Day')
    assert.equal(made.axisY, 'Sittings')
    assert.deepEqual(made.points.map((one) => one.value), [0, 0, 0, 0, 2, 0, 1])
    assert.equal(made.points[4].label, '14 Oct')
    assert.equal(made.max, 2)
  })

  test('a share bucket with nothing in it has no value, which is not a nought per cent', () => {
    const made = series({
      key: 'k',
      title: 'How much came out right',
      axisY: 'Share of attempts',
      unit: 'share',
      range,
      bucket: 'day',
      items: [{ at: D(2026, 10, 14, 1), hit: true }, { at: D(2026, 10, 14, 2), hit: false }]
    })
    const values = made.points.map((one) => one.value)
    assert.equal(values.filter((one) => one === null).length, 6)
    assert.equal(made.points[4].value, 0.5)
    assert.equal(made.points[4].n, 2)
    assert.equal(made.gaps, 6)
    assert.match(made.says, /shown as gaps/)
  })

  test('a share bucket where nothing came off is nought, which is not the same as nothing happening', () => {
    const made = series({
      key: 'k',
      title: 't',
      axisY: 'y',
      unit: 'share',
      range,
      bucket: 'day',
      items: [{ at: D(2026, 10, 16, 1), hit: false }, { at: D(2026, 10, 16, 2), hit: false }]
    })
    assert.equal(made.points[6].value, 0)
    assert.equal(made.points[6].n, 2)
    assert.equal(made.points[5].value, null)
    assert.equal(made.points[5].n, 0)
  })

  test('minutes are summed from the amounts, and an empty bucket again has no value', () => {
    const made = series({
      key: 'k',
      title: 't',
      axisY: 'Minutes',
      unit: 'minutes',
      range,
      bucket: 'day',
      items: [{ at: D(2026, 10, 15, 1), amount: 300 }, { at: D(2026, 10, 15, 2), amount: 120 }]
    })
    assert.equal(made.points[5].value, 7)
    assert.equal(made.points[4].value, null)
  })

  test('weeks and months bucket on their own boundaries', () => {
    const long = rangeOf(now, 'quarter')
    const weekly = series({ key: 'k', title: 't', axisY: 'y', unit: 'count', range: long, bucket: 'week', items: [] })
    assert.equal(weekly.axisX, 'Week beginning')
    assert.match(weekly.points[0].label, /^w\/b /)
    assert.equal(dayKey(weekly.points[0].from), dayKey(weekStart(long.from)))
    const monthly = series({ key: 'k', title: 't', axisY: 'y', unit: 'count', range: long, bucket: 'month', items: [] })
    assert.equal(monthly.points.length, 4)
    assert.equal(monthly.points[0].label, 'Jul 2026')
    assert.equal(dayKey(monthly.points[1].from), '2026-08-01')
  })

  test('the bucket is chosen so a chart cannot ask for a thousand bars', () => {
    assert.equal(bestBucket(rangeOf(now, 'week')), 'day')
    assert.equal(bestBucket(rangeOf(now, 'month')), 'day')
    assert.equal(bestBucket(rangeOf(now, 'quarter')), 'week')
    assert.equal(bestBucket(rangeOf(now, 'year')), 'week')
    assert.equal(bestBucket(rangeBetween(D(2020, 1, 1), now)), 'month')
    const silly = series({ key: 'k', title: 't', axisY: 'y', unit: 'count', range: rangeBetween(D(1990, 1, 1), now), bucket: 'day', items: [] })
    assert.equal(silly.points.length, MOST_POINTS)
  })
})

describe('two stretches side by side', () => {
  test('it refuses the comparison when either side is thin, and says how thin', () => {
    const earlier = rate(2, 4, { what: 'came out right', outOf: 'attempts' })
    const later = rate(30, 40, { what: 'came out right', outOf: 'attempts' })
    const change = changeBetween(earlier, later)
    assert.equal(change.comparable, false)
    assert.equal(change.points, null)
    assert.match(change.says, /20 attempts are needed in each and there are 4 in the earlier one and 40 in the later/)
  })

  test('when it can compare, it gives percentage points and refuses to call it a trend', () => {
    const earlier = rate(10, 40, { what: 'came out right', outOf: 'attempts' })
    const later = rate(20, 40, { what: 'came out right', outOf: 'attempts' })
    const change = changeBetween(earlier, later)
    assert.equal(change.comparable, true)
    assert.equal(change.points, 25)
    assert.match(change.says, /25 percentage points higher/)
    assert.match(change.says, /not a trend and says nothing about the next one/)
  })
})

// ---------------------------------------------------------------- the adapters

describe('turning records into sittings', () => {
  const performance = (o: { id: string; at: number; solved: boolean; worth?: number; wrong?: number; seconds?: number }): TrainingRecord => ({
    kind: 'puzzle',
    themes: [],
    performance: {
      exerciseId: o.id,
      solved: o.solved,
      gaveUp: false,
      hintsUsed: 0,
      worth: o.worth ?? 1,
      wrongMoves: o.wrong ?? 0,
      illegalTries: 0,
      seconds: o.seconds ?? 20,
      at: o.at
    }
  })

  test('an attempt is a sitting that worked, and clean means no hint and no wrong move', () => {
    const made = eventsFromTraining([
      performance({ id: 'a', at: 10, solved: true }),
      performance({ id: 'b', at: 20, solved: true, worth: 0 }),
      performance({ id: 'c', at: 30, solved: true, wrong: 1 }),
      performance({ id: 'd', at: 40, solved: false })
    ])
    assert.deepEqual(made.map((one) => one.worked), [true, true, true, true])
    assert.deepEqual(made.map((one) => one.succeeded), [true, true, true, false])
    assert.deepEqual(made.map((one) => one.clean), [true, false, false, false])
    assert.deepEqual(made.map((one) => one.activity), ['puzzle', 'puzzle', 'puzzle', 'puzzle'])
    assert.equal(made[0].seconds, 20)
  })

  test('a second go at the same exercise is a second sitting, not the same one again', () => {
    const made = eventsFromTraining([performance({ id: 'a', at: 10, solved: false }), performance({ id: 'a', at: 99, solved: true })])
    assert.equal(new Set(made.map((one) => one.id)).size, 2)
    assert.equal(new Set(made.map((one) => one.thing)).size, 1)
  })

  test('an opening drill succeeds only when the whole line came back', () => {
    const records: OpeningRecallRecord[] = [
      { name: 'Catalan', side: 'w', correct: 4, length: 9, complete: false, at: 10 },
      { name: 'Catalan', side: 'w', correct: 9, length: 9, complete: true, at: 20 }
    ]
    const made = eventsFromOpenings(records)
    assert.deepEqual(made.map((one) => one.succeeded), [false, true])
    assert.deepEqual(made.map((one) => one.activity), ['opening-drill', 'opening-drill'])
  })

  test('a game is a sitting with no notion of succeeding, and an empty board is not a sitting at all', () => {
    const base = {
      profileId: 'p',
      startFen: START_FEN,
      meta: { white: {}, black: {}, result: '*' as const },
      variant: 'standard',
      updatedAt: 0,
      fingerprint: 'f'
    }
    const games: StoredGame[] = [
      { ...base, id: 'played', source: { kind: 'local-engine', engine: 'Stockfish' }, moves: [{ san: 'e4', uci: 'e2e4', fen: START_FEN }], createdAt: 10 },
      { ...base, id: 'empty', source: { kind: 'custom-position' }, moves: [], createdAt: 20 },
      { ...base, id: 'brought', source: { kind: 'import', importedAt: 5 }, moves: [{ san: 'e4', uci: 'e2e4', fen: START_FEN }], createdAt: 30 },
      { ...base, id: 'watched', source: { kind: 'broadcast', provider: 'x', providerGameId: 'y', retrievedAt: 1 }, moves: [{ san: 'e4', uci: 'e2e4', fen: START_FEN }], createdAt: 40 }
    ]
    const made = eventsFromGames(games)
    assert.deepEqual(made.map((one) => one.activity), ['play', 'play', 'import-game', 'watch-broadcast'])
    assert.deepEqual(made.map((one) => one.worked), [true, false, true, true])
    assert.ok(made.every((one) => one.succeeded === null && one.clean === null))
  })

  test('an analysis is its own sitting, separate from the game having been played', () => {
    const made = eventsFromAnalyses([{ gameId: 'g1', you: 'w', analysedAt: 50, depth: 20, moves: [{ ply: 1, side: 'w', san: 'e4', before: START_FEN, klass: 'best', loss: 0 }] }])
    assert.equal(made[0].activity, 'analyse-game')
    assert.equal(made[0].thing, 'g1')
    assert.equal(made[0].succeeded, null)
  })

  test('the same sitting reported twice is one sitting, and the earlier time is kept', () => {
    const merged = mergeEvents(
      [event({ id: 'a', at: 500 }), event({ id: 'b', at: 100 })],
      [event({ id: 'a', at: 200 })]
    )
    assert.equal(merged.length, 2)
    assert.deepEqual(merged.map((one) => one.at), [100, 200])
  })
})

// ---------------------------------------------------------------- the whole report

describe('the report', () => {
  const now = D(2026, 10, 16, 12)

  test('with nothing recorded it says so and draws no empty charts', () => {
    const report = progressReport({}, now)
    assert.equal(report.series.length, 0)
    assert.equal(report.counts.attempts, 0)
    assert.equal(report.accuracy.value, null)
    assert.match(report.says, /Nothing has been recorded yet/)
  })

  test('it keeps the three kinds of number apart and says what each one is', () => {
    const report = progressReport({
      training: [{
        kind: 'puzzle',
        themes: [],
        performance: { exerciseId: 'e1', solved: true, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 0, illegalTries: 0, seconds: 60, at: D(2026, 10, 14) }
      }],
      completions: [{ kind: 'lesson', id: 'l1', startedAt: D(2026, 10, 14), completedAt: null }]
    }, now)
    assert.equal(report.counts.attempts, 1)
    assert.equal(report.success.overall.hits, 1)
    assert.equal(report.completion.overall.hits, 0)
    assert.equal(report.completion.overall.of, 1)
    assert.deepEqual(report.whatTheseAre, WHAT_THESE_ARE)
    assert.ok(report.whatTheseAre.some((one) => /Games are counted, never rated/.test(one)))
  })

  test('it draws the charts the records can fill and leaves out the ones they cannot', () => {
    const training: TrainingRecord[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'puzzle' as const,
      themes: [],
      performance: { exerciseId: `e${i}`, solved: i % 2 === 0, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 0, illegalTries: 0, seconds: 30, at: D(2026, 10, 10 + i) }
    }))
    const report = progressReport({ training }, now, { window: 'week' })
    const keys = report.series.map((one) => one.key)
    assert.deepEqual(keys, ['sittings', 'success', 'minutes'])
    assert.equal(report.series.every((one) => one.axisX.length > 0 && one.axisY.length > 0), true)
    // No games were analysed, so there is no accuracy chart rather than a flat empty one.
    assert.equal(keys.includes('accuracy'), false)
  })

  test('an accuracy chart appears once there are deeply analysed games, and not before', () => {
    const moves: AnalysedMove[] = Array.from({ length: 10 }, (_, i) => ({ ply: i, side: 'w' as const, san: 'e4', before: START_FEN, klass: (i < 7 ? 'good' : 'blunder') as MoveClass, loss: null }))
    const shallow = progressReport({ games: [{ gameId: 'g', you: 'w', analysedAt: D(2026, 10, 14), depth: 5, moves }] }, now, { window: 'week' })
    assert.equal(shallow.series.map((one) => one.key).includes('accuracy'), false)
    const deep = progressReport({ games: [{ gameId: 'g', you: 'w', analysedAt: D(2026, 10, 14), depth: 20, moves }] }, now, { window: 'week' })
    const chart = deep.series.find((one) => one.key === 'accuracy')
    assert.ok(chart)
    assert.equal(chart.unit, 'share')
    assert.equal(chart.points[4].value, 0.7)
  })

  test('it says what it cannot establish, every time', () => {
    const report = progressReport({}, now)
    assert.deepEqual(report.cannotEstablish, CANNOT_ESTABLISH)
    assert.ok(report.cannotEstablish.some((one) => /getting stronger/.test(one)))
    assert.ok(report.cannotEstablish.some((one) => /compare with anybody else/.test(one)))
    assert.deepEqual(report.calendarRules, CALENDAR_RULES)
  })

  test('the range is stated, and the sittings it counted are handed back for anything else to use', () => {
    const report = progressReport({
      training: [{
        kind: 'calculation',
        themes: [],
        performance: { exerciseId: 'e1', solved: false, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 1, illegalTries: 0, seconds: 10, at: D(2026, 10, 14) }
      }]
    }, now, { window: 'month' })
    assert.equal(report.window, 'month')
    assert.equal(report.range.days, 30)
    assert.match(report.range.label, /the last 30 days/)
    assert.equal(report.events.length, 1)
    assert.equal(report.events[0].activity, 'calculation')
    assert.equal(report.at, now)
  })

  test('records from outside the range are not silently counted inside it', () => {
    const report = progressReport({
      training: [{
        kind: 'puzzle',
        themes: [],
        performance: { exerciseId: 'e1', solved: true, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 0, illegalTries: 0, seconds: 10, at: D(2026, 1, 1) }
      }]
    }, now, { window: 'week' })
    assert.equal(report.counts.attempts, 0)
    assert.match(report.says, /Nothing was recorded in the last 7 days/)
    assert.equal(report.events.length, 1)
  })
})
