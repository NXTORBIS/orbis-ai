import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { BOARD_MIN, boardSize, squareSize, squeezed } from './boardSize.ts'

test('the board is as big as the smaller side of the room', () => {
  assert.equal(boardSize({ width: 1200, height: 800 }), 800)
  assert.equal(boardSize({ width: 600, height: 900 }), 600)
})

test('the side is a multiple of eight, so every square is the same width', () => {
  const side = boardSize({ width: 1000, height: 501 })
  assert.equal(side, 496)
  assert.equal(squareSize(side), 62)
  assert.equal(side % 8, 0)
})

test('a ceiling is honoured, and no ceiling means the room decides', () => {
  assert.equal(boardSize({ width: 2000, height: 2000 }, { max: 720 }), 720)
  assert.equal(boardSize({ width: 2000, height: 2000 }), 2000)
})

test('a board is never drawn below the size it stops being readable at', () => {
  assert.equal(boardSize({ width: 90, height: 90 }), BOARD_MIN)
  assert.equal(boardSize({ width: 0, height: 0 }), BOARD_MIN)
})

test('a box that has not been laid out yet gets a real board, not a collapsed one', () => {
  assert.equal(boardSize({ width: Number.NaN, height: 600 }), BOARD_MIN)
})

test('a smaller floor than the default is allowed, for a board inside a small panel', () => {
  assert.equal(boardSize({ width: 100, height: 100 }, { min: 96 }), 96)
})

test('being squeezed is reported rather than drawn silently', () => {
  assert.equal(squeezed({ width: 1200, height: 800 }), false)
  assert.equal(squeezed({ width: 120, height: 120 }), true)
})
