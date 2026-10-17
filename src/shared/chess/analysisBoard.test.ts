import test from 'node:test'
import assert from 'node:assert/strict'
import { depthWords, lineMoves, looksLikeFen, readPasted, PASTE_LIMIT } from './analysisBoard.ts'
import { START_FEN } from './rules.ts'

const ITALIAN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b kq - 5 4'

test('a one-line position with eight ranks looks like a position', () => {
  assert.equal(looksLikeFen(START_FEN), true)
  assert.equal(looksLikeFen(ITALIAN), true)
})

test('a game, a tag and a run of moves do not look like a position', () => {
  assert.equal(looksLikeFen('[Event "x"]\n1. e4 e5'), false)
  assert.equal(looksLikeFen('1. e4 e5 2. Nf3 Nc6'), false)
  assert.equal(looksLikeFen(''), false)
  // Eight ranks but only two fields: not enough of a position to be read as one.
  assert.equal(looksLikeFen('8/8/8/8/8/8/8/8 w'), false)
})

test('a pasted position loads with no moves and keeps the position exactly', () => {
  const read = readPasted(`  ${ITALIAN}  `)
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.equal(read.loaded.kind, 'fen')
  assert.equal(read.loaded.startFen, ITALIAN)
  assert.deepEqual(read.loaded.moves, [])
  assert.deepEqual(read.loaded.notes, [])
})

test('a position with a real mistake in it is refused in words, not read as a game', () => {
  const read = readPasted('8/8/8/8/8/8/8/8 w - - 0 1')
  assert.equal(read.ok, false)
  if (read.ok) return
  assert.ok(read.problem.length > 0)
  assert.ok(!read.problem.includes('neither'))
})

test('a pasted game loads its moves and takes its name from the players', () => {
  const pgn = '[Event "Club night"]\n[White "Ada"]\n[Black "Bram"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 *'
  const read = readPasted(pgn)
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.equal(read.loaded.kind, 'pgn')
  assert.deepEqual(read.loaded.moves, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
  assert.equal(read.loaded.name, 'Ada vs Bram')
  assert.equal(read.loaded.startFen, START_FEN)
})

test('a bare run of moves with no tags still loads as a game', () => {
  const read = readPasted('1. d4 d5 2. c4 e6')
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.equal(read.loaded.kind, 'pgn')
  assert.deepEqual(read.loaded.moves, ['d4', 'd5', 'c4', 'e6'])
})

test('nothing pasted is said as nothing pasted, not as a broken game', () => {
  const read = readPasted('   ')
  assert.equal(read.ok, false)
  if (read.ok) return
  assert.ok(read.problem.includes('nothing'))
})

test('a paste over the limit is refused without being parsed', () => {
  const read = readPasted('1. e4 e5 '.repeat(Math.ceil(PASTE_LIMIT / 9) + 10))
  assert.equal(read.ok, false)
  if (read.ok) return
  assert.ok(read.problem.includes('KB'))
})

test('an engine line becomes one move per step, each with the position it reaches', () => {
  const walked = lineMoves(START_FEN, ['e2e4', 'e7e5', 'g1f3'])
  assert.equal(walked.whole, true)
  assert.equal(walked.given, 3)
  assert.deepEqual(walked.moves.map((one) => one.san), ['e4', 'e5', 'Nf3'])
  assert.deepEqual(walked.moves.map((one) => one.step), [1, 2, 3])
  assert.ok(walked.moves[2].fen.includes('w') || walked.moves[2].fen.includes('b'))
  // Every step carries a different position, which is what makes clicking one of them go somewhere.
  assert.equal(new Set(walked.moves.map((one) => one.fen)).size, 3)
})

test('a line that stops being legal is cut there and says it is not the whole line', () => {
  const walked = lineMoves(START_FEN, ['e2e4', 'd2d4'])
  assert.equal(walked.moves.length, 1)
  assert.equal(walked.whole, false)
  assert.equal(walked.given, 2)
})

test('a line longer than the limit is cut and does not claim to be whole', () => {
  const walked = lineMoves(START_FEN, ['e2e4', 'e7e5', 'g1f3'], 2)
  assert.equal(walked.moves.length, 2)
  assert.equal(walked.whole, false)
  assert.equal(walked.given, 3)
})

test('an empty line is whole and has nothing in it', () => {
  const walked = lineMoves(START_FEN, [])
  assert.deepEqual(walked.moves, [])
  assert.equal(walked.whole, true)
})

test('a depth the engine never gave is not printed as zero', () => {
  assert.equal(depthWords(null), 'depth not reported')
  assert.equal(depthWords(18), 'depth 18')
  assert.equal(depthWords(18, 18), 'depth 18')
  assert.equal(depthWords(18, 24), 'depth 18, 24 in places')
  assert.equal(depthWords(0), 'depth 0')
})
