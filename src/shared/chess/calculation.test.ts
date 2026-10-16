import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareLine, enterLine, interleave, readMove, splitLine } from './calculation.ts'
import { FORGIVING_FAILURE, newExercise, validateExercise, type Exercise } from './exercise.ts'
import { START_FEN } from './rules.ts'

/**
 * The distinction the Gym exists to keep: the writing was wrong, or the chess was wrong. They never share a message.
 */

const fork: Exercise = newExercise({
  id: 'fork',
  kind: 'calculation',
  startFen: '3q3k/6p1/3N4/8/8/8/8/6K1 w - - 0 1',
  objective: 'win-material',
  materialAtLeast: 900,
  prompt: 'Type the line that wins the queen.',
  solution: {
    lines: [
      {
        move: 'd6f7',
        children: [
          { move: 'h8g8', children: [{ move: 'f7d8' }] },
          { move: 'h8h7', children: [{ move: 'f7d8' }] }
        ]
      }
    ]
  },
  failure: FORGIVING_FAILURE,
  hints: [{ level: 1, text: 'One square, two targets.', shows: 'theme' }],
  source: { kind: 'generated', by: 'winMaterialTree' }
})

test('the exercise behind these tests is sound', () => {
  const check = validateExercise(fork)
  assert.equal(check.ok, true, check.problems.map((p) => p.says).join(' / '))
  assert.equal(check.coverage, 'complete')
})

// ---------------------------------------------------------------- reading one move

test('a move that can be played comes back played, with the proper way of writing it', () => {
  const read = readMove(START_FEN, 'e4')
  assert.equal(read.ok, true)
  if (read.ok) {
    assert.equal(read.move.uci, 'e2e4')
    assert.equal(read.tidied, undefined)
  }
  const sloppy = readMove(START_FEN, 'g1f3')
  assert.equal(sloppy.ok, true)
  if (sloppy.ok) assert.equal(sloppy.tidied, 'Nf3', 'coordinates are playable, and the move has a name')
  const decorated = readMove(START_FEN, 'e4!?')
  assert.equal(decorated.ok, true, 'an opinion attached to a move is not part of the move')
})

test('writing that cannot be read is a notation problem and says what a move looks like', () => {
  for (const text of ['hello', 'Nf9', 'e0', '', 'xyz123', '!!']) {
    const read = readMove(START_FEN, text)
    assert.equal(read.ok, false, text)
    if (!read.ok) {
      assert.equal(read.fault, 'notation', text)
      assert.equal(read.code, 'cannot-read', text)
    }
  }
  const read = readMove(START_FEN, 'hello')
  if (!read.ok) assert.match(read.says, /e4, Nf3, exd5, O-O or e8=Q/)
})

test('an ambiguous move is a notation problem, and the answers are offered', () => {
  const twoKnights = '8/8/8/3N1N2/8/8/8/K6k w - - 0 1'
  const read = readMove(twoKnights, 'Ne7')
  assert.equal(read.ok, false)
  if (!read.ok) {
    assert.equal(read.fault, 'notation')
    assert.equal(read.code, 'ambiguous')
    assert.deepEqual([...(read.suggest ?? [])].sort(), ['Nde7', 'Nfe7'])
    assert.match(read.says, /could be/)
  }
  assert.equal(readMove(twoKnights, 'Nde7').ok, true)
})

test('a promotion with no piece named is a notation problem', () => {
  const promoting = '8/P7/8/8/8/8/8/K6k w - - 0 1'
  for (const text of ['a8', 'a7a8']) {
    const read = readMove(promoting, text)
    assert.equal(read.ok, false, text)
    if (!read.ok) {
      assert.equal(read.fault, 'notation', text)
      assert.equal(read.code, 'needs-promotion', text)
      assert.ok((read.suggest ?? []).length >= 4, text)
    }
  }
  assert.equal(readMove(promoting, 'a8=Q').ok, true)
  assert.equal(readMove(promoting, 'a7a8n').ok, true)
})

test('a move that reads perfectly and cannot be played is a chess problem, and says which', () => {
  const cases: [string, string, string, RegExp][] = [
    ['no such move', START_FEN, 'Nd4', /No knight can go to d4/],
    ['nothing of that kind', '4k3/8/8/8/8/8/8/3QK3 w - - 0 1', 'Nf3', /no knight/],
    ['your own piece is there', START_FEN, 'Ke2', /own pawn is on e2/],
    ['in check', '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1', 'Kd2', /in check/],
    ['the piece cannot move at all', '4k3/8/8/4n3/8/8/8/4RK2 b - - 0 1', 'Nd3', /no legal move at all/]
  ]
  for (const [name, fen, text, says] of cases) {
    const read = readMove(fen, text)
    assert.equal(read.ok, false, name)
    if (!read.ok) {
      assert.equal(read.fault, 'chess', `${name} is a chess problem, not a typing one`)
      assert.match(read.says, says, name)
    }
  }
})

test('castling that is not available says why, and the reasons are different reasons', () => {
  const noRights = readMove('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1', 'O-O')
  assert.equal(noRights.ok, false)
  if (!noRights.ok) {
    assert.equal(noRights.code, 'no-castling')
    assert.match(noRights.says, /already moved/)
  }
  const blocked = readMove('r3k2r/8/8/8/8/8/8/R2QK2R w KQkq - 0 1', 'O-O-O')
  assert.equal(blocked.ok, false)
  if (!blocked.ok) assert.match(blocked.says, /queen on d1 is in the way/)

  const inCheck = readMove('r3k2r/8/8/8/8/8/4q3/R3K2R w KQkq - 0 1', 'O-O')
  assert.equal(inCheck.ok, false)
  if (!inCheck.ok) {
    assert.equal(inCheck.code, 'in-check')
    assert.match(inCheck.says, /out of check/)
  }
  const crossed = readMove('r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1', 'O-O')
  assert.equal(crossed.ok, false)
  if (!crossed.ok) assert.match(crossed.says, /the king crosses is attacked/)
  // The same position castles long perfectly well.
  assert.equal(readMove('r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1', 'O-O-O').ok, true)
})

// ---------------------------------------------------------------- a whole line

test('a line is read against the position reached, not the one it started from', () => {
  const entry = enterLine(fork.startFen, ['Nf7+', 'Kg8', 'Nxd8'])
  assert.equal(entry.ok, true)
  assert.deepEqual(entry.moves.map((m) => m.san), ['Nf7+', 'Kg8', 'Nxd8'])
  assert.equal(entry.fens.length, 3)
  assert.equal(entry.stopped, null)

  // The same Nxd8 is a move at ply three and not a move at all at ply one: d6 to d8 is not a knight move.
  const wrongOrder = enterLine(fork.startFen, ['Nxd8', 'Kg8', 'Nf7+'])
  assert.equal(wrongOrder.ok, false)
  assert.equal(wrongOrder.stopped?.at, 0)
  assert.equal(wrongOrder.stopped?.fault, 'chess')
  assert.match(wrongOrder.stopped?.says ?? '', /No knight can go to d8/)
})

test('a line stops at the first thing that cannot be read, and says what it was read against', () => {
  const entry = enterLine(fork.startFen, ['Nf7+', 'Kg9', 'Nxd8'])
  assert.equal(entry.ok, false)
  assert.equal(entry.stopped?.at, 1)
  assert.equal(entry.stopped?.fault, 'notation')
  assert.equal(entry.stopped?.wrote, 'Kg9')
  assert.equal(entry.stopped?.fen, entry.fens[0], 'the position the bad move was read in')
  assert.equal(entry.moves.length, 1, 'nothing after an unreadable move is pretended to have happened')
})

test('a line written the long way is tidied without being marked wrong', () => {
  const entry = enterLine(fork.startFen, ['d6f7', 'h8g8', 'f7d8'])
  assert.equal(entry.ok, true)
  assert.deepEqual(entry.tidied.map((one) => one.properly), ['Nf7+', 'Kg8', 'Nxd8'])
})

test('a written line is split the way people write them', () => {
  assert.deepEqual(splitLine('1.Nf7+ Kg8 2.Nxd8'), ['Nf7+', 'Kg8', 'Nxd8'])
  assert.deepEqual(splitLine('1... Kg8 2. Nxd8 {winning}'), ['Kg8', 'Nxd8'])
  assert.deepEqual(splitLine('e4 e5 1-0'), ['e4', 'e5'])
  assert.deepEqual(splitLine('   '), [])
})

// ---------------------------------------------------------------- comparing

test('a line that solves it is said to solve it', () => {
  const result = compareLine(fork, ['Nf7+', 'Kg8', 'Nxd8'])
  assert.equal(result.verdict, 'solves')
  assert.equal(result.matched, 3)
  assert.equal(result.divergence, null)
})

test('a line that is right as far as it goes is short, not wrong', () => {
  const result = compareLine(fork, ['Nf7+', 'Kg8'])
  assert.equal(result.verdict, 'short')
  assert.equal(result.matched, 2)
  assert.equal(result.shortestAnswer, 3)
  assert.match(result.says, /as far as it goes/)
  assert.equal(compareLine(fork, []).verdict, 'short')
})

test('a line that leaves the answers reports the first place it did, and nothing after it', () => {
  const result = compareLine(fork, ['Nf7+', 'Kg8', 'Ne5'])
  assert.equal(result.verdict, 'diverges')
  assert.equal(result.matched, 2)
  assert.equal(result.divergence?.at, 2)
  assert.equal(result.divergence?.by, 'solver')
  assert.equal(result.divergence?.played, 'Ne5')
  assert.deepEqual(result.divergence?.accepted, ['Nxd8'])

  const firstMove = compareLine(fork, ['Nc8'])
  assert.equal(firstMove.divergence?.at, 0)
  assert.deepEqual(firstMove.divergence?.accepted, ['Nf7+'])
})

test('a line that gives the opponent a defence the exercise does not cover says so', () => {
  const thin: Exercise = { ...fork, solution: { lines: [{ move: 'd6f7', children: [{ move: 'h8g8', children: [{ move: 'f7d8' }] }] }] } }
  const result = compareLine(thin, ['Nf7+', 'Kh7', 'Nxd8'])
  assert.equal(result.verdict, 'diverges')
  assert.equal(result.divergence?.by, 'opponent')
  assert.match(result.divergence?.says ?? '', /a defence it does not cover/)
})

test('a line that cannot be played is not compared at all', () => {
  const result = compareLine(fork, ['Nf7+', 'Kg9'])
  assert.equal(result.verdict, 'unplayable')
  assert.equal(result.matched, 0)
  assert.match(result.says, /could not be read/)
  // "Nd8" is accepted and tidied to Nxd8 -- missing the capture mark is not a refusal. Nd4 is no move at all.
  assert.equal(compareLine(fork, ['Nf7+', 'Kg8', 'Nd8']).verdict, 'solves')
  const illegal = compareLine(fork, ['Nf7+', 'Kg8', 'Nd4'])
  assert.equal(illegal.verdict, 'unplayable')
  assert.match(illegal.says, /cannot be played/)
})

test('typing only your own moves fills in the defences from the exercise', () => {
  const filled = interleave(fork, ['Nf7+', 'Nxd8'])
  assert.deepEqual(filled.line, ['Nf7+', 'Kg8', 'Nxd8'])
  assert.equal(filled.stoppedAt, null)
  const wrong = interleave(fork, ['Nc8'])
  assert.deepEqual(wrong.line, ['Nc8'])
  // A different pick takes the other recorded defence.
  const other = interleave(fork, ['Nf7+'], 1)
  assert.deepEqual(other.line, ['Nf7+', 'Kh7'])
})
