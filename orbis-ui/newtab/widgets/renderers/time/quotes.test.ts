import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LINES, lineFor } from './quotes.ts'

const day = (year: number, month: number, date: number, hour = 9): number => new Date(year, month - 1, date, hour).getTime()

test('every line has words and somebody who said them', () => {
  assert.ok(LINES.length >= 1)
  for (const line of LINES) {
    assert.ok(line.text.trim().length > 0, 'a line with no words')
    assert.ok(line.who.trim().length > 0, `"${line.text}" has nobody against it`)
    // A line has to end as a sentence does; a collection half of which is cut off is a collection nobody checked.
    assert.match(line.text, /[.!?]$/)
  }
})

test('every answer comes out of the collection and nowhere else', () => {
  const answers = [
    lineFor('daily', day(2026, 10, 5), 0, 0),
    lineFor('launch', day(2026, 10, 5), 0, 1_700_000_000_000),
    lineFor('manual', day(2026, 10, 5), 3, 0),
    lineFor('something else entirely', day(2026, 10, 5), 0, 0)
  ]
  for (const answer of answers) assert.ok(LINES.includes(answer), `"${answer.text}" is not one of Orbis's lines`)
})

test('one a day means the same one all day, and a different one tomorrow is possible', () => {
  const morning = lineFor('daily', day(2026, 10, 5, 0), 0, 0)
  const night = lineFor('daily', day(2026, 10, 5, 23), 0, 0)
  assert.deepEqual(morning, night)
  // Not every pair of days differs -- there are only eight lines -- but a fortnight must not be one line over and over.
  const fortnight = new Set(Array.from({ length: 14 }, (_, step) => lineFor('daily', day(2026, 10, 1 + step), 0, 0).text))
  assert.ok(fortnight.size >= 4, `only ${fortnight.size} different lines in a fortnight`)
})

test('every time Orbis starts holds still for as long as it is open', () => {
  const started = 1_700_000_000_000
  assert.deepEqual(lineFor('launch', day(2026, 10, 5, 9), 0, started), lineFor('launch', day(2026, 10, 6, 17), 0, started))
  // A different run of Orbis is allowed to land somewhere else.
  const runs = new Set(Array.from({ length: 20 }, (_, step) => lineFor('launch', day(2026, 10, 5), 0, started + step * 9_973).text))
  assert.ok(runs.size >= 3)
})

test('only when I ask walks the collection one at a time and comes back round', () => {
  const walked = Array.from({ length: LINES.length }, (_, step) => lineFor('manual', day(2026, 10, 5), step, 0))
  assert.deepEqual(walked, [...LINES])
  // Past the end it starts again, and a number that has gone backwards is still a line rather than nothing.
  assert.deepEqual(lineFor('manual', day(2026, 10, 5), LINES.length, 0), LINES[0])
  assert.deepEqual(lineFor('manual', day(2026, 10, 5), -1, 0), LINES[LINES.length - 1])
  assert.deepEqual(lineFor('manual', day(2026, 10, 5), Number.NaN, 0), LINES[0])
})
