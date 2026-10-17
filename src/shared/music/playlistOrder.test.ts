import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  dropBefore,
  landingMove,
  moved,
  notAlready,
  playlistSums,
  realMove,
  renameTo,
  stepMove,
  sumsWords
} from './playlistOrder.ts'

const track = (id: string, duration: number, availability = 'local', file: string | undefined = 'f') => ({ id, duration, availability, file })

test('moved takes a song out and puts it back where it ends up', () => {
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c'])
})

test('moved changes nothing when the move is not a move', () => {
  assert.deepEqual(moved(['a', 'b'], 1, 1), ['a', 'b'])
  assert.deepEqual(moved(['a', 'b'], -1, 0), ['a', 'b'])
  assert.deepEqual(moved(['a', 'b'], 0, 9), ['a', 'b'])
})

test('dropBefore answers the gap the pointer is nearest', () => {
  const middles = [10, 30, 50]
  assert.equal(dropBefore(middles, 4), 0)
  assert.equal(dropBefore(middles, 20), 1)
  assert.equal(dropBefore(middles, 40), 2)
  assert.equal(dropBefore(middles, 400), 3)
  assert.equal(dropBefore([], 7), 0)
})

test('landingMove turns a gap into a final position', () => {
  assert.deepEqual(landingMove({ from: 0, before: 3 }, 4), { from: 0, to: 2 })
  assert.deepEqual(landingMove({ from: 3, before: 1 }, 4), { from: 3, to: 1 })
  assert.deepEqual(landingMove({ from: 1, before: 4 }, 4), { from: 1, to: 3 })
})

test('landingMove refuses a drop that would change nothing', () => {
  assert.equal(landingMove({ from: 2, before: 2 }, 4), null)
  assert.equal(landingMove({ from: 2, before: 3 }, 4), null)
  assert.equal(landingMove({ from: 9, before: 0 }, 4), null)
  assert.equal(landingMove({ from: 0, before: 9 }, 4), null)
})

test('stepMove walks one row and stops at the ends', () => {
  assert.deepEqual(stepMove(1, -1, 3), { from: 1, to: 0 })
  assert.deepEqual(stepMove(1, 1, 3), { from: 1, to: 2 })
  assert.equal(stepMove(0, -1, 3), null)
  assert.equal(stepMove(2, 1, 3), null)
})

test('realMove counts against the playlist and not against the rows', () => {
  // The playlist holds four ids; the song behind 'gone' is not in the library, so only three rows are on screen.
  const order = ['a', 'gone', 'b', 'c']
  const shown = ['a', 'b', 'c']
  assert.deepEqual(realMove(order, shown, { from: 2, to: 0 }), { from: 3, to: 0 })
  assert.deepEqual(realMove(order, shown, { from: 0, to: 2 }), { from: 0, to: 3 })
})

test('realMove keeps a missing id in its place rather than stepping over it', () => {
  const order = ['a', 'b', 'gone', 'c']
  const shown = ['a', 'b', 'c']
  // 'b' moves below 'c', which is the end of the shown list; in the playlist that is the very end, after 'gone'.
  assert.deepEqual(realMove(order, shown, { from: 1, to: 2 }), { from: 1, to: 3 })
})

test('realMove gives up when the page and the playlist have gone out of step', () => {
  assert.equal(realMove(['a', 'b'], ['a', 'x'], { from: 1, to: 0 }), null)
  assert.equal(realMove(['a', 'b'], ['a', 'b'], { from: 5, to: 0 }), null)
})

test('playlistSums adds only the lengths it has', () => {
  const sums = playlistSums([track('a', 60), track('b', 0), track('c', 120, 'reference', undefined)])
  assert.deepEqual(sums, { count: 3, seconds: 180, unknown: 1, playable: 2 })
})

test('sumsWords says at least when a length is missing', () => {
  const span = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : '')
  assert.equal(sumsWords({ count: 3, seconds: 180, unknown: 1, playable: 3 }, span), '3 songs · at least 3 min')
  assert.equal(sumsWords({ count: 3, seconds: 180, unknown: 0, playable: 2 }, span), '3 songs · 3 min · 2 playable here')
  assert.equal(sumsWords({ count: 1, seconds: 0, unknown: 1, playable: 1 }, span), '1 song')
  assert.equal(sumsWords({ count: 0, seconds: 0, unknown: 0, playable: 0 }, span), '0 songs')
})

test('notAlready leaves out songs the playlist has', () => {
  assert.deepEqual(notAlready([{ id: 'a' }, { id: 'b' }], ['b']), [{ id: 'a' }])
})

test('renameTo refuses nothing, blanks and the name it already has', () => {
  assert.equal(renameTo('  Evening  ', 'Morning'), 'Evening')
  assert.equal(renameTo('   ', 'Morning'), null)
  assert.equal(renameTo('Morning ', 'Morning'), null)
  assert.equal(renameTo(7, 'Morning'), null)
  assert.equal(renameTo('x'.repeat(260), 'Morning')?.length, 200)
})
