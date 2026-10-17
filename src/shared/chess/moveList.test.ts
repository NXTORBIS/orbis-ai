import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { clampPly, moveRows, placeWords, plyLabel, sideOfPly, stepForKey, stepPly } from './moveList.ts'

test('moves become numbered rows with the two sides beside each other', () => {
  const rows = moveRows(['e4', 'e5', 'Nf3', 'Nc6'])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { number: 1, white: { ply: 1, san: 'e4', side: 'w' }, black: { ply: 2, san: 'e5', side: 'b' } })
  assert.deepEqual(rows[1].white, { ply: 3, san: 'Nf3', side: 'w' })
})

test('a game stopped after White has moved has one row with Black empty, not a blank row after it', () => {
  const rows = moveRows(['e4', 'e5', 'Nf3'])
  assert.equal(rows.length, 2)
  assert.equal(rows[1].black, null)
})

test('no moves is no rows', () => {
  assert.deepEqual(moveRows([]), [])
})

test('a position that begins with Black to move leaves the first White cell empty and keeps the real numbers', () => {
  const rows = moveRows(['Nf6', 'c4', 'e6'], { firstSide: 'b', firstNumber: 24 })
  assert.equal(rows[0].number, 24)
  assert.equal(rows[0].white, null)
  assert.deepEqual(rows[0].black, { ply: 1, san: 'Nf6', side: 'b' })
  assert.equal(rows[1].number, 25)
  assert.deepEqual(rows[1].white, { ply: 2, san: 'c4', side: 'w' })
})

test('which side moved to reach a ply, and nobody moved to reach the start', () => {
  assert.equal(sideOfPly(0), null)
  assert.equal(sideOfPly(1), 'w')
  assert.equal(sideOfPly(2), 'b')
  assert.equal(sideOfPly(1, { firstSide: 'b' }), 'b')
  assert.equal(sideOfPly(2, { firstSide: 'b' }), 'w')
})

test('a move said on its own is written the way it is written down', () => {
  assert.equal(plyLabel(1, 'e4'), '1. e4')
  assert.equal(plyLabel(2, 'e5'), '1… e5')
  assert.equal(plyLabel(3, 'Nf3'), '2. Nf3')
  assert.equal(plyLabel(1, 'Nf6', { firstSide: 'b', firstNumber: 24 }), '24… Nf6')
  assert.equal(plyLabel(2, 'c4', { firstSide: 'b', firstNumber: 24 }), '25. c4')
  assert.equal(plyLabel(0, 'e4'), 'the starting position')
})

test('a ply is kept inside the game', () => {
  assert.equal(clampPly(-4, 10), 0)
  assert.equal(clampPly(99, 10), 10)
  assert.equal(clampPly(4.7, 10), 4)
  assert.equal(clampPly(3, 0), 0)
})

test('stepping back from the first move lands on the starting position, not on nothing', () => {
  assert.equal(stepPly(1, 10, 'back'), 0)
  assert.equal(stepPly(0, 10, 'back'), 0)
  assert.equal(stepPly(10, 10, 'forward'), 10)
  assert.equal(stepPly(5, 10, 'first'), 0)
  assert.equal(stepPly(5, 10, 'last'), 10)
})

test('the keys the board and the list both walk with', () => {
  assert.equal(stepForKey('ArrowLeft'), 'back')
  assert.equal(stepForKey('ArrowRight'), 'forward')
  assert.equal(stepForKey('Home'), 'first')
  assert.equal(stepForKey('End'), 'last')
  assert.equal(stepForKey('q'), null)
})

test('where you are is said as a place in the game, not as a percentage', () => {
  assert.equal(placeWords(0, 41), 'The starting position, before the first of 41 moves.')
  assert.equal(placeWords(12, 41), 'Move 12 of 41.')
  assert.equal(placeWords(0, 0), 'No moves have been played.')
})
