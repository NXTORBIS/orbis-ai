import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bestMove, C4_COLS, C4_LEVELS, C4_ROWS, c4Score, cellIndex, chooseMove, columnHeight, dropAt, immediateWins, isC4Board, legalColumns, newC4Board, otherPlayer, runThrough } from './connectFour.ts'
import type { C4Board, C4Player } from './connectFour.ts'

const rng = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

/** Plays `plies` random legal moves, stopping early if the game finishes. */
function randomPosition(random: () => number, plies: number): { board: C4Board; next: C4Player } {
  let board = newC4Board()
  let next: C4Player = 1
  for (let i = 0; i < plies; i++) {
    const moves = legalColumns(board)
    if (!moves.length) break
    const played = dropAt(board, moves[Math.floor(random() * moves.length)], next)
    if (!played) break
    board = played
    if (board.winner || board.draw) break
    next = otherPlayer(next)
  }
  return { board, next }
}

test('a line counts in all four directions, and nowhere else', () => {
  let board = newC4Board()
  for (const col of [0, 1, 2, 3]) board = dropAt(board, col, 1)!
  assert.equal(board.winner, 1, 'four across wins')
  assert.equal(board.line.length, 4)

  let up = newC4Board()
  for (let i = 0; i < 4; i++) up = dropAt(up, 2, 2)!
  assert.equal(up.winner, 2, 'four up one column wins')

  // A rising diagonal: columns 0..3 filled to increasing heights with the line on top.
  let rising = newC4Board()
  for (const [col, filler] of [[1, 1], [2, 2], [3, 3]] as const) for (let i = 0; i < filler; i++) rising = dropAt(rising, col, 2)!
  for (const col of [0, 1, 2, 3]) rising = dropAt(rising, col, 1)!
  assert.equal(rising.winner, 1, 'a rising diagonal wins')

  let falling = newC4Board()
  for (const [col, filler] of [[3, 1], [2, 2], [1, 3]] as const) for (let i = 0; i < filler; i++) falling = dropAt(falling, col, 2)!
  for (const col of [4, 3, 2, 1]) falling = dropAt(falling, col, 1)!
  assert.equal(falling.winner, 1, 'a falling diagonal wins')

  let three = newC4Board()
  for (const col of [0, 1, 2]) three = dropAt(three, col, 1)!
  assert.equal(three.winner, 0, 'three in a row is not a win')
  assert.deepEqual(runThrough(three.cells, 0, 0), [], 'and has no run')
})

test('counters stack, full columns and finished games refuse a counter', () => {
  let board = newC4Board()
  for (let i = 0; i < C4_ROWS; i++) {
    board = dropAt(board, 5, i % 2 ? 1 : 2)!
    assert.equal(columnHeight(board.cells, 5), i + 1)
  }
  assert.equal(dropAt(board, 5, 1), null, 'a full column takes no more')
  assert.equal(board.cells[cellIndex(5, 0)], 2)
  assert.equal(legalColumns(board).includes(5), false)

  let won = newC4Board()
  for (const col of [0, 1, 2, 3]) won = dropAt(won, col, 1)!
  assert.equal(dropAt(won, 6, 2), null, 'a finished game takes no more')

  // A full board with nobody winning is a draw: columns of alternating pairs never make four of anything.
  let full = newC4Board()
  for (let col = 0; col < C4_COLS; col++)
    for (let row = 0; row < C4_ROWS; row++) {
      const player: C4Player = (Math.floor(row / 2) + col) % 2 ? 1 : 2
      const next = dropAt(full, col, player)
      assert.ok(next, `column ${col} row ${row} should accept a counter`)
      full = next
      assert.equal(full.winner, 0, `no line should appear while filling column ${col}`)
    }
  assert.equal(full.moves, C4_COLS * C4_ROWS)
  assert.equal(full.draw, true)
  assert.deepEqual(legalColumns(full), [])
})

test('the opponent never misses a win it can take now, at every depth it plays at', () => {
  const random = rng(20260416)
  let winsSeen = 0
  for (let game = 0; game < 400; game++) {
    const { board, next } = randomPosition(random, 4 + Math.floor(random() * 22))
    if (board.winner || board.draw) continue
    const wins = immediateWins(board, next)
    if (!wins.length) continue
    winsSeen++
    for (const depth of [1, 2, 4, C4_LEVELS.hard.depth]) {
      const move = bestMove(board, next, depth, random)
      assert.ok(wins.includes(move), `depth ${depth} walked past a win in column ${wins.join(',')} and played ${move}`)
    }
  }
  assert.ok(winsSeen > 40, `the test only found ${winsSeen} positions with a win available`)
})

test('the opponent blocks the only threat against it whenever blocking is safe', () => {
  const random = rng(777001)
  let blocksSeen = 0
  for (let game = 0; game < 900; game++) {
    const { board, next } = randomPosition(random, 4 + Math.floor(random() * 24))
    if (board.winner || board.draw) continue
    const foe = otherPlayer(next)
    if (immediateWins(board, next).length) continue
    const threats = immediateWins(board, foe)
    if (threats.length !== 1) continue
    const blocked = dropAt(board, threats[0], next)
    if (!blocked || blocked.winner || immediateWins(blocked, foe).length) continue
    blocksSeen++
    for (const depth of [2, 4, C4_LEVELS.normal.depth]) {
      const move = bestMove(board, next, depth, random)
      assert.equal(move, threats[0], `depth ${depth} left the threat in column ${threats[0]} open and played ${move}`)
    }
  }
  assert.ok(blocksSeen > 40, `the test only found ${blocksSeen} positions with one threat to block`)
})

test('looking further ahead wins the game: the deep search beats the shallow one', () => {
  const random = rng(4242)
  let deepWins = 0
  const games = 4
  for (let game = 0; game < games; game++) {
    let board = newC4Board()
    // The deep player goes second in half the games, so neither result is just the first-move advantage.
    let next: C4Player = 1
    const deep: C4Player = game % 2 ? 1 : 2
    while (!board.winner && !board.draw) {
      const move = bestMove(board, next, next === deep ? 6 : 2, random)
      const played = dropAt(board, move, next)
      if (!played) break
      board = played
      next = otherPlayer(next)
    }
    if (board.winner === deep) deepWins++
  }
  assert.ok(deepWins >= games - 1, `the deep search only won ${deepWins} of ${games}`)
})

test('the easy opponent really does play badly, and the hard one never does', () => {
  let board = newC4Board()
  board = dropAt(board, 0, 2)!
  board = dropAt(board, 1, 2)!
  board = dropAt(board, 2, 2)!
  // Player 2 wins by dropping into column 3. Player 1 has to stop it.
  assert.deepEqual(immediateWins(board, 2), [3])
  assert.equal(chooseMove(board, 1, 'hard', () => 0.99), 3, 'hard blocks')
  assert.equal(chooseMove(board, 1, 'normal', () => 0.99), 3, 'normal blocks')
  // A blunder roll of 0 takes the first legal column instead of the right one.
  assert.equal(chooseMove(board, 1, 'easy', () => 0), 0, 'easy sometimes just plays the first column')
  assert.equal(chooseMove(board, 1, 'easy', () => 0.99), 3, 'and blocks when it is not blundering')
  assert.ok(C4_LEVELS.easy.depth < C4_LEVELS.normal.depth && C4_LEVELS.normal.depth < C4_LEVELS.hard.depth)
  assert.equal(chooseMove(newC4Board(), 1, 'hard', () => 0.5), 3, 'the opening move is the middle column')
})

test('points reward winning, winning quickly, and a harder opponent', () => {
  assert.ok(c4Score('win', 10, 'hard') > c4Score('win', 10, 'normal'))
  assert.ok(c4Score('win', 10, 'normal') > c4Score('win', 30, 'normal'))
  assert.ok(c4Score('win', 30, 'normal') > c4Score('draw', 42, 'normal'))
  assert.ok(c4Score('draw', 42, 'normal') > c4Score('loss', 20, 'normal'))
  assert.ok(c4Score('loss', 20, 'easy') > 0, 'a game played still counts for something')
})

test('a saved board is checked before it is trusted', () => {
  let board = newC4Board()
  board = dropAt(board, 3, 1)!
  board = dropAt(board, 3, 2)!
  assert.equal(isC4Board(board), true)
  assert.equal(isC4Board(null), false)
  assert.equal(isC4Board({ cells: [], moves: 0 }), false)
  const floating = newC4Board()
  floating.cells[cellIndex(2, 3)] = 1
  floating.moves = 1
  assert.equal(isC4Board(floating), false, 'a counter hanging above a gap never came from this game')
  const miscounted = { ...board, moves: 9 }
  assert.equal(isC4Board(miscounted), false)
})
