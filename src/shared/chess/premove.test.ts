import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  canSetPremove, nextPremove, premove, premoveSquares, premoveStatus, premoveWords, samePremove
} from './premove.ts'

test('a premove is two real squares, and a square to itself is not one', () => {
  assert.deepEqual(premove('e2', 'e4'), { from: 'e2', to: 'e4' })
  assert.equal(premove('e2', 'e2'), null)
  assert.equal(premove('z9', 'e4'), null)
})

test('a pawn can only be promised a piece it could really become', () => {
  assert.deepEqual(premove('a7', 'a8', 'q'), { from: 'a7', to: 'a8', promotion: 'q' })
  assert.equal(premove('a7', 'a8', 'k'), null)
  assert.equal(premove('a7', 'a8', 'p'), null)
})

test('it waits while it is the other side to move, and is due when it is yours', () => {
  const held = premove('e7', 'e5')
  assert.equal(premoveStatus(held, 'w', 'b'), 'waiting')
  assert.equal(premoveStatus(held, 'b', 'b'), 'due')
  assert.equal(premoveStatus(null, 'b', 'b'), 'none')
})

test('on a board where you play both sides there is nothing to wait for', () => {
  assert.equal(premoveStatus(premove('e2', 'e4'), 'w', null), 'due')
})

test('putting the same move down again takes it off', () => {
  const first = nextPremove(null, 'g1', 'f3')
  assert.deepEqual(first, { from: 'g1', to: 'f3' })
  assert.equal(nextPremove(first, 'g1', 'f3'), null)
})

test('a different move replaces it, and nonsense leaves what was held alone', () => {
  const first = nextPremove(null, 'g1', 'f3')
  assert.deepEqual(nextPremove(first, 'b1', 'c3'), { from: 'b1', to: 'c3' })
  assert.deepEqual(nextPremove(first, 'g1', 'g1'), first)
})

test('a promotion and a plain move to the same squares are not the same premove', () => {
  assert.equal(samePremove(premove('a7', 'a8'), premove('a7', 'a8', 'q')), false)
  assert.equal(samePremove(premove('a7', 'a8', 'q'), premove('a7', 'a8', 'q')), true)
  assert.equal(samePremove(null, null), true)
})

test('the squares it is drawn on', () => {
  assert.deepEqual(premoveSquares(premove('e2', 'e4')), ['e2', 'e4'])
  assert.deepEqual(premoveSquares(null), [])
})

test('one may only be set up while it is not your turn, and never on a board that cannot be played', () => {
  assert.equal(canSetPremove({ turn: 'w', you: 'b', playable: true }), true)
  assert.equal(canSetPremove({ turn: 'b', you: 'b', playable: true }), false)
  assert.equal(canSetPremove({ turn: 'w', you: 'b', playable: false }), false)
  assert.equal(canSetPremove({ turn: 'w', you: null, playable: true }), false)
})

test('a premove that did not fit the position is said to have been taken off, not quietly changed', () => {
  const held = { from: 'e7', to: 'e5' }
  assert.equal(premoveWords(held, 'played'), 'Your move e7 to e5 was played.')
  assert.match(premoveWords(held, 'dropped'), /could not be played in the position that arrived/)
})
