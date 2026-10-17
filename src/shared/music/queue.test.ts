/**
 * Tests for the queue maths.
 *
 * The one that matters is the round trip: take a list, pick a row, pick a gap, work out the number the player would
 * be given, do what the player does with it, and check the row ended up in the gap the hand let go of. Checking
 * `queueMoveTo` against hand-written numbers would only prove it matches the numbers somebody wrote down.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { canMove, gapNearest, moved, queueLength, queueMoveTo, queueParts } from './queue.ts'

test('a queue splits into what has gone, what is playing and what is next', () => {
  const parts = queueParts(['a', 'b', 'c', 'd'], 1)
  assert.deepEqual(
    parts.gone.map((one) => one.trackId),
    ['a']
  )
  assert.equal(parts.playing?.trackId, 'b')
  assert.equal(parts.playing?.index, 1)
  assert.deepEqual(
    parts.next.map((one) => one.index),
    [2, 3]
  )
})

test('nothing playing means the whole queue is still to come', () => {
  for (const at of [-1, 4, 1.5, Number.NaN]) {
    const parts = queueParts(['a', 'b', 'c', 'd'], at)
    assert.equal(parts.playing, null)
    assert.equal(parts.gone.length, 0)
    assert.equal(parts.next.length, 4)
  }
})

test('an empty queue is empty in all three parts', () => {
  const parts = queueParts([], 0)
  assert.deepEqual(parts, { gone: [], playing: null, next: [] })
})

test('only what is still to come may be dragged', () => {
  assert.equal(canMove(0, 1), false, 'already gone by')
  assert.equal(canMove(1, 1), false, 'playing now')
  assert.equal(canMove(2, 1), true)
  // With nothing playing the player says -1, so every row is still to come.
  assert.equal(canMove(0, -1), true)
})

test('dropping a row where it already is sends nothing', () => {
  // Gap 2 is above the row at index 2; gap 3 is below it. Both leave the order exactly as it was.
  assert.equal(queueMoveTo(2, 2, 5), null)
  assert.equal(queueMoveTo(2, 3, 5), null)
})

test('a row lands in the gap the hand let go of, moving either way', () => {
  const list = ['a', 'b', 'c', 'd', 'e']
  for (let from = 0; from < list.length; from += 1) {
    for (let gap = 0; gap <= list.length; gap += 1) {
      const to = queueMoveTo(from, gap, list.length)
      if (to === null) continue
      // What the hand meant: the row taken out, then put back into that gap of the shortened list.
      const without = list.filter((_, index) => index !== from)
      const wanted = [...without.slice(0, gap > from ? gap - 1 : gap), list[from] as string, ...without.slice(gap > from ? gap - 1 : gap)]
      assert.deepEqual(moved(list, from, to), wanted, `from ${from} into gap ${gap}`)
    }
  }
})

test('a move that makes no sense is refused rather than sent', () => {
  assert.equal(queueMoveTo(-1, 0, 3), null)
  assert.equal(queueMoveTo(0, 4, 3), null)
  assert.equal(queueMoveTo(0, -1, 3), null)
  assert.equal(queueMoveTo(1.5, 0, 3), null)
  assert.equal(queueMoveTo(0, 0, 0), null)
})

test('the player ignores a position outside the queue, so moved() leaves the list alone', () => {
  assert.deepEqual(moved(['a', 'b'], 5, 0), ['a', 'b'])
  assert.deepEqual(moved(['a', 'b'], 0, 9), ['a', 'b'])
})

test('the nearest gap is read from the middles of the rows', () => {
  const middles = [20, 60, 100]
  assert.equal(gapNearest(middles, 0), 0, 'above everything')
  assert.equal(gapNearest(middles, 19), 0)
  assert.equal(gapNearest(middles, 21), 1)
  assert.equal(gapNearest(middles, 61), 2)
  assert.equal(gapNearest(middles, 999), 3, 'below everything')
  assert.equal(gapNearest([], 50), 0)
})

test('what is left to play adds up, and says how much of it is unknown', () => {
  assert.deepEqual(queueLength([120, 180.4]), { seconds: 300, unknown: 0 })
  assert.deepEqual(queueLength([120, 0, Number.NaN, -5]), { seconds: 120, unknown: 3 })
  assert.deepEqual(queueLength([]), { seconds: 0, unknown: 0 })
})
