import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { asPeriod, PERIODS, readSpan, spanOf } from './timePeriod.ts'

/** Wednesday 1 October 2026, 14:30 local time. Mid-week and mid-afternoon, so every boundary below is a real one. */
const NOW = new Date(2026, 9, 1, 14, 30, 0).getTime()
const midnight = new Date(2026, 9, 1).getTime()
const DAY = 86_400_000

test('a period is recognised however a model happens to write it', () => {
  for (const spelling of ['today', 'Today', "today's", 'the today', ' TODAY ']) assert.equal(asPeriod(spelling), 'today', spelling)
  for (const spelling of ['last hour', 'the past hour', 'an hour', '1 hour']) assert.equal(asPeriod(spelling), 'last-hour', spelling)
  for (const spelling of ['all time', 'everything', 'the beginning', 'all']) assert.equal(asPeriod(spelling), 'everything', spelling)
})

test('a longer name is not eaten by a shorter one it contains', () => {
  // "last 24 hours" contains "hour". Reading it as the last hour would keep 23 hours somebody asked to be rid of.
  assert.equal(asPeriod('last 24 hours'), 'last-24-hours')
  assert.equal(asPeriod('the past 24 hours'), 'last-24-hours')
  assert.equal(asPeriod('last 7 days'), 'last-7-days')
})

test('a word nobody listed is refused rather than guessed', () => {
  for (const nonsense of ['', 'soon', 'recently', 'a bit ago', 'last fortnight']) assert.equal(asPeriod(nonsense), null, nonsense)
})

test('every listed period resolves to a span, and every span is forwards', () => {
  for (const p of PERIODS) {
    const span = spanOf(p.id, NOW)
    assert.ok(span.to > span.from, `${p.id} ends after it starts`)
    assert.ok(span.from >= 0, `${p.id} does not start before the epoch`)
    assert.equal(span.what, p.what)
  }
})

test('today starts at midnight, not 24 hours ago', () => {
  assert.equal(spanOf('today', NOW).from, midnight)
  assert.equal(spanOf('last-24-hours', NOW).from, NOW - DAY)
})

test('yesterday leaves today alone', () => {
  const span = spanOf('yesterday', NOW)
  assert.equal(span.from, new Date(2026, 8, 30).getTime())
  // It ends where today begins. Including today would delete the day somebody asked to keep.
  assert.equal(span.to, midnight)
})

test('this week starts on Monday', () => {
  // 1 October 2026 is a Thursday, so Monday is the 28th of September.
  assert.equal(spanOf('this-week', NOW).from, new Date(2026, 8, 28).getTime())
})

test('this month starts on the first', () => {
  assert.equal(spanOf('this-month', NOW).from, new Date(2026, 9, 1).getTime())
})

test('everything starts at the beginning of time', () => {
  assert.equal(spanOf('everything', NOW).from, 0)
})

test('explicit instants win over a name', () => {
  const span = readSpan({ period: 'today', from: 100, to: 200 }, NOW)
  assert.deepEqual('problem' in span ? span : { from: span.from, to: span.to }, { from: 100, to: 200 })
})

test('a name plus one instant narrows the name', () => {
  const span = readSpan({ period: 'today', to: midnight + 3_600_000 }, NOW)
  assert.ok(!('problem' in span))
  if ('problem' in span) return
  assert.equal(span.from, midnight)
  assert.equal(span.to, midnight + 3_600_000)
})

test('saying nothing is an error, not everything', () => {
  // The one default here that could clear a whole history because a parameter went missing.
  const span = readSpan({}, NOW)
  assert.ok('problem' in span)
})

test('a backwards range is an error', () => {
  assert.ok('problem' in readSpan({ from: 500, to: 100 }, NOW))
})

test('an unknown name says which names exist', () => {
  const span = readSpan({ period: 'last fortnight' }, NOW)
  assert.ok('problem' in span)
  if (!('problem' in span)) return
  assert.match(span.problem, /today/)
})
