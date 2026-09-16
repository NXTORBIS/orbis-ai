import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canMove, chord, deal, isBoard, isGrid, memoryScore, move, newBoard, reveal, slideRow, spawnTile, toggleFlag, typingStats } from '../shared/gameLogic.ts'

test('sliding merges each pair once and reports the points gained', () => {
  assert.deepEqual(slideRow([2, 2, 2, 2]), { row: [4, 4, 0, 0], gained: 8, moved: true })
  assert.deepEqual(slideRow([2, 0, 2, 4]), { row: [4, 4, 0, 0], gained: 4, moved: true })
  assert.deepEqual(slideRow([4, 2, 0, 0]).moved, false)
  const grid = [[0, 0, 2, 2], [0, 0, 0, 0], [0, 4, 0, 4], [0, 0, 0, 0]]
  assert.deepEqual(move(grid, 'right').grid[0], [0, 0, 0, 4])
  assert.deepEqual(move(grid, 'down').grid[3], [0, 4, 2, 4])
  assert.equal(move(grid, 'left').gained, 12)
  assert.equal(canMove([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]), false)
  assert.equal(canMove([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]]), true)
  const spawned = spawnTile([[0, 2], [2, 2]], () => 0)
  assert.equal(spawned[0][0], 2)
  assert.equal(isGrid([[0, 2, 4], [0, 0, 0], [8, 0, 0]]), true)
  assert.equal(isGrid([[1]]), false)
})

test('minesweeper keeps the first reveal and its neighbours safe, opens empty areas, and detects win and loss', () => {
  let seed = 12345
  const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  let board = newBoard(9, 9, 10)
  board = reveal(board, 40, random)
  assert.equal(board.won, false)
  assert.equal(board.placed, true)
  assert.equal(board.cells.filter((c) => c.mine).length, 10)
  for (const i of [30, 31, 32, 39, 40, 41, 48, 49, 50]) assert.equal(board.cells[i].mine, false)
  assert.ok(board.cells.filter((c) => c.revealed).length >= 9)
  assert.equal(board.lost, false)

  const mine = board.cells.findIndex((c) => c.mine)
  const flagged = toggleFlag(board, mine)
  assert.equal(flagged.cells[mine].flagged, true)
  assert.equal(reveal(flagged, mine).lost, false, 'a flagged cell is not revealed')
  assert.equal(reveal(board, mine).lost, true)

  // Revealing every safe cell wins.
  let winning = board
  board.cells.forEach((c, i) => {
    if (!c.mine) winning = reveal(winning, i)
  })
  assert.equal(winning.won, true)
  assert.equal(isBoard(winning), true)
  assert.equal(chord(board, 0), board)
})

test('memory decks hold each face exactly twice; scores reward fewer moves', () => {
  const deck = deal(['a', 'b', 'c', 'd'], 3, () => 0.5)
  assert.equal(deck.length, 6)
  for (const face of ['a', 'b', 'c']) assert.equal(deck.filter((x) => x === face).length, 2)
  assert.ok(memoryScore(8, 8, 30) > memoryScore(8, 20, 30))
  assert.ok(memoryScore(8, 200, 900) >= 80)
})

test('typing speed counts correct characters per five-letter word; accuracy counts mistakes', () => {
  assert.deepEqual(typingStats('hello world', 'hello world', 6000), { wpm: 22, accuracy: 100, correct: 11, errors: 0 })
  const sloppy = typingStats('hello', 'hxllo', 60000)
  assert.equal(sloppy.errors, 1)
  assert.equal(sloppy.accuracy, 80)
})
