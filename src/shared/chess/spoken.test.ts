import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hearMove, hearSquares, moveReadings, words } from './spoken.ts'
import { START_FEN } from './rules.ts'

/**
 * Words into squares and moves, and the refusals that matter more than the successes (Section 224).
 *
 * The one thing worth testing hardest: a transcript has no capital letters, so "bee four" is the square b4 and the
 * bishop's move Bb4 at the same time. In a position where both can be played there is no way to tell, and the
 * answer has to be a question. A guess here would mark somebody wrong for a move they never made.
 */

// White bishop on a3 and a pawn on b2, so both b4 and Bb4 are legal from one spoken phrase.
const BOTH_B4 = '4k3/8/8/8/8/B7/1P6/4K3 w - - 0 1'

describe('the words', () => {
  test('punctuation goes and hyphens stay', () => {
    assert.deepEqual(words('Knight, f-three!'), ['knight', 'f-three'])
    assert.deepEqual(words(''), [])
    assert.deepEqual(words('   '), [])
  })
})

describe('squares', () => {
  test('a letter word and a number word make a square', () => {
    const heard = hearSquares('ee four')
    assert.equal(heard.ok, true)
    assert.equal(heard.text, 'e4')
  })

  test('the spelling alphabets people actually use', () => {
    assert.equal(hearSquares('charlie three').text, 'c3')
    assert.equal(hearSquares('hector eight').text, 'h8')
    assert.equal(hearSquares('bravo one').text, 'b1')
  })

  test('what a transcriber writes instead of a number', () => {
    assert.equal(hearSquares('a to').text, 'a2')
    assert.equal(hearSquares('g ate').text, 'g8')
    assert.equal(hearSquares('see won').text, 'c1')
  })

  test('several squares, with filler between them', () => {
    const heard = hearSquares('um, e four and then d five please')
    assert.equal(heard.text, 'e4 d5')
  })

  test('a square already written as one is taken as it is', () => {
    assert.equal(hearSquares('f6').text, 'f6')
  })

  test('the same square twice is one square', () => {
    assert.equal(hearSquares('e four e four').text, 'e4')
  })

  test('"it has been taken" is a real answer and is kept', () => {
    const heard = hearSquares('it has been taken')
    assert.equal(heard.ok, true)
    assert.equal(heard.text, 'taken')
  })

  test('nothing said is told apart from nothing understood', () => {
    assert.equal(hearSquares('').fault, 'nothing-heard')
    assert.equal(hearSquares('I have no idea').fault, 'not-understood')
  })

  test('the words heard come back either way, so they can be corrected by hand', () => {
    assert.equal(hearSquares('I have no idea').heard, 'I have no idea')
    assert.equal(hearSquares('ee four').heard, 'ee four')
  })
})

describe('the readings of a move', () => {
  test('a word that can only be a piece drops the bare square', () => {
    // "knight f three" means the knight. Offering `f3` beside `Nf3` would make the phrase look ambiguous in every
    // position where the pawn can move too, which is most of them.
    assert.deepEqual(moveReadings('knight f three'), ['Nf3'])
  })

  test('a word that is a piece and a file keeps both readings', () => {
    // "bee four" is the only real overlap on the board, and it has to reach the position intact.
    const readings = moveReadings('bee four')
    assert.ok(readings.includes('Bb4'))
    assert.ok(readings.includes('b4'))
  })

  test('"pawn" adds no letter and leaves the square alone', () => {
    assert.deepEqual(moveReadings('pawn e four'), ['e4'])
  })

  test('from and to squares are offered as the longest reading', () => {
    const readings = moveReadings('e two e four')
    assert.equal(readings[0], 'e2e4')
  })

  test('"takes" becomes the capture mark', () => {
    assert.ok(moveReadings('knight takes d five').includes('Nxd5'))
    assert.ok(moveReadings('e takes d five').includes('exd5'))
  })

  test('castling, both ways, and plain "castles" means short', () => {
    assert.deepEqual(moveReadings('castles'), ['O-O'])
    assert.deepEqual(moveReadings('castles long'), ['O-O-O'])
    assert.deepEqual(moveReadings('castle queenside'), ['O-O-O'])
  })

  test('a promotion piece is not also read as the piece that moved', () => {
    const readings = moveReadings('e seven e eight promotes to queen')
    assert.ok(readings.includes('e7e8=Q'))
    assert.ok(!readings.some((one) => one.startsWith('Q')))
  })

  test('nothing said has no readings', () => {
    assert.deepEqual(moveReadings(''), [])
  })
})

describe('a move against a position', () => {
  test('one legal reading is the move, written properly', () => {
    const heard = hearMove(START_FEN, 'knight f three')
    assert.equal(heard.ok, true)
    assert.equal(heard.text, 'Nf3')
  })

  test('three readings of one move are one answer, not three', () => {
    // "e two e four", "e4" and "e2e4" all come out of this phrase. Counting them separately would make every
    // clearly spoken move look ambiguous.
    const heard = hearMove(START_FEN, 'e two e four')
    assert.equal(heard.ok, true)
    assert.equal(heard.text, 'e4')
  })

  test('the bishop and the b file are not chosen between', () => {
    const heard = hearMove(BOTH_B4, 'bee four')
    assert.equal(heard.ok, false)
    assert.equal(heard.fault, 'ambiguous')
    assert.deepEqual([...heard.choices].sort(), ['Bb4', 'b4'])
    assert.ok(heard.says.includes('Which did you mean?'))
  })

  test('the same words where only one reading is legal are not ambiguous', () => {
    // From the standard start a bishop cannot reach b4, so "bee four" can only be the pawn.
    const heard = hearMove(START_FEN, 'bee four')
    assert.equal(heard.ok, true)
    assert.equal(heard.text, 'b4')
  })

  test('a reading that is not legal here carries the rules\' own reason', () => {
    const heard = hearMove(START_FEN, 'knight f six')
    assert.equal(heard.ok, false)
    assert.equal(heard.fault, 'not-understood')
    assert.ok(heard.says.length > 0)
  })

  test('words with no move in them say so, and keep the words', () => {
    const heard = hearMove(START_FEN, 'what was I doing')
    assert.equal(heard.ok, false)
    assert.equal(heard.heard, 'what was I doing')
  })

  test('nothing heard is its own fault', () => {
    assert.equal(hearMove(START_FEN, '   ').fault, 'nothing-heard')
  })

  test('nothing legal is ever returned as a move', () => {
    for (const spoken of ['queen h five', 'rook takes a eight', 'king e two', 'castles']) {
      const heard = hearMove(START_FEN, spoken)
      assert.equal(heard.ok, false, `${spoken} is not legal from the start and must not come back as a move`)
      assert.equal(heard.text, '')
    }
  })
})
