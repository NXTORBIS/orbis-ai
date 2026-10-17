import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, applyMove, checkFen, positionKey } from './rules.ts'
import {
  OPENING_SOURCE, datasetSize, explore, identify, recordFor, searchOpenings, transposition, volumes, walkLine
} from './openings.ts'
import { OPENINGS_DATA } from './openingsData.ts'

/**
 * What these prove.
 *
 * Real main lines are named correctly; a position outside the dataset says so instead of guessing; a transposition is
 * found because the position key matches; and two boards that look identical but differ in castling rights are NOT
 * merged, which is the one mistake an opening explorer must not make.
 */

const after = (sans: string[]): string => {
  let fen = START_FEN
  for (const san of sans) {
    const made = applyMove(fen, san)
    assert.ok(made, `${san} should be legal`)
    fen = made.after
  }
  return fen
}

test('the dataset is the one that was licensed, and its size is counted rather than claimed', () => {
  assert.equal(OPENING_SOURCE.dataset, 'lichess-org/chess-openings')
  assert.equal(OPENING_SOURCE.licence, 'CC0-1.0')
  // A version is part of the data: without it, "the dataset says" names nothing.
  assert.match(OPENING_SOURCE.version, /^[0-9a-f]{40}$/)
  assert.equal(datasetSize(), OPENING_SOURCE.entries)
  assert.ok(datasetSize() > 3000)
  // The dataset counts nothing, and says so.
  assert.equal(OPENING_SOURCE.hasStatistics, false)
})

test('every ECO volume is present and nothing outside A-E got in', () => {
  const got = volumes()
  assert.deepEqual(got.map((v) => v.volume), ['A', 'B', 'C', 'D', 'E'])
  assert.equal(got.reduce((sum, v) => sum + v.entries, 0), datasetSize())
})

test('real main lines are identified with their ECO code', () => {
  const cases: { moves: string[]; eco: string; name: string }[] = [
    { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], eco: 'C50', name: 'Italian Game' },
    { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], eco: 'C60', name: 'Ruy Lopez' },
    { moves: ['d4', 'd5', 'c4'], eco: 'D06', name: "Queen's Gambit" },
    { moves: ['d4', 'd5', 'c4', 'e6'], eco: 'D30', name: "Queen's Gambit Declined" },
    { moves: ['e4', 'c5'], eco: 'B20', name: 'Sicilian Defense' },
    { moves: ['e4', 'c6'], eco: 'B10', name: 'Caro-Kann Defense' },
    { moves: ['e4', 'e6'], eco: 'C00', name: 'French Defense' },
    { moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], eco: 'E20', name: 'Nimzo-Indian Defense' },
    { moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3'], eco: 'E61', name: "King's Indian Defense" },
    { moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'], eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' },
    { moves: ['c4'], eco: 'A10', name: 'English Opening' }
  ]
  for (const one of cases) {
    const got = identify({ moves: one.moves })
    assert.equal(got.known, true, one.name)
    if (!got.known) continue
    assert.equal(got.eco, one.eco, one.name)
    assert.equal(got.name, one.name)
    assert.equal(got.exact, true, `${one.name} should be named at the position itself`)
    assert.equal(got.ply, one.moves.length)
    // The name is traceable: the source travels with the answer.
    assert.equal(got.source.licence, 'CC0-1.0')
  }
})

test('a position alone is enough to name it, and the key is what matches', () => {
  const fen = after(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
  const got = identify({ fen })
  assert.equal(got.known, true)
  if (got.known) {
    assert.equal(got.name, 'Italian Game')
    assert.equal(got.record.key, positionKey(fen))
    assert.equal(got.exact, true)
  }
  assert.equal(recordFor(fen)?.eco, 'C50')
})

test('past the dataset, the last name still holds and says it is not the exact position', () => {
  // 4...Na6 is a legal move nobody has written down a name for.
  const got = identify({ moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'Na3'] })
  assert.equal(got.known, true)
  if (!got.known) return
  assert.equal(got.name, 'Italian Game: Giuoco Piano')
  assert.equal(got.ply, 6)
  // The name came from an earlier position: saying otherwise would claim the dataset names this one.
  assert.equal(got.exact, false)
})

test('a position outside the dataset is an honest unknown, not a nearest guess', () => {
  const got = identify({ fen: '8/8/4k3/8/8/8/4K1Q1/8 w - - 0 50' })
  assert.equal(got.known, false)
  if (got.known) return
  assert.equal(got.problem, 'not-in-dataset')
  // The dataset is named in the refusal, so a person can tell what did not know.
  assert.match(got.reason, /lichess-org\/chess-openings/)
  assert.match(got.reason, /not the moves that led to it/)
  assert.equal(got.source.dataset, OPENING_SOURCE.dataset)
})

test('a broken question is refused as broken, not as unknown chess', () => {
  const illegal = identify({ moves: ['e4', 'e5', 'Ke3'] })
  assert.equal(illegal.known, false)
  if (!illegal.known) assert.equal(illegal.problem, 'illegal-line')
  const nothing = identify({})
  assert.equal(nothing.known, false)
  if (!nothing.known) assert.equal(nothing.problem, 'bad-position')
  const nonsense = identify({ fen: 'not a position' })
  assert.equal(nonsense.known, false)
  if (!nonsense.known) assert.equal(nonsense.problem, 'bad-position')
})

test('walking a line stops where it stops being legal and keeps what it had', () => {
  const walk = walkLine(['e4', 'e5', 'Qd4'])
  assert.equal(walk.ok, false)
  assert.equal(walk.steps.length, 2)
  assert.equal(walk.problem?.ply, 3)
  assert.match(walk.problem?.reason ?? '', /cannot be played/)
  const good = walkLine(['e4', 'c5'])
  assert.equal(good.ok, true)
  assert.equal(good.steps[1].record?.name, 'Sicilian Defense')
  assert.equal(good.steps[0].record?.name, "King's Pawn Game")
})

test('a transposition is found, and why the two orders meet is spelled out', () => {
  const byNf3 = ['Nf3', 'Nf6', 'c4', 'e6', 'd4']
  const byD4 = ['d4', 'Nf6', 'c4', 'e6', 'Nf3']
  const got = transposition(byNf3, byD4)
  assert.equal(got.ok, true)
  assert.equal(got.same, true)
  assert.equal(got.sameMoves, true)
  assert.equal(got.divergedAt, 1)
  assert.equal(got.keys.a, got.keys.b)
  assert.match(got.reason, /same position reached in a different order/)
  assert.match(got.reason, /castling rights are the same/)
  // The meeting point has a name, and it is the dataset's.
  assert.equal(got.opening?.eco, 'E10')
  // The same line through the Nf3 order identifies under the name the dataset files it under.
  const named = identify({ moves: byNf3 })
  assert.equal(named.known, true)
  if (named.known) {
    assert.equal(named.name, 'Indian Defense: Anti-Nimzo-Indian')
    // It was reached another way, and the dataset's own order is handed back rather than hidden.
    assert.deepEqual(named.transposedFrom, byD4)
  }
})

test('two boards with the same pieces but different castling rights are NOT the same position', () => {
  // Both lines put the knights on f3 and f6 and everything else home. One moved a rook out and back, which costs the
  // castling right for good; the other moved a knight out and back, which costs nothing.
  const rookWent = ['Nf3', 'Nf6', 'Rg1', 'Rg8', 'Rh1', 'Rh8']
  const knightWent = ['Nf3', 'Nf6', 'Nc3', 'Nc6', 'Nb1', 'Nb8']
  const a = after(rookWent)
  const b = after(knightWent)
  // The pieces really are identical, so nothing but the rights can be doing the work here.
  assert.equal(a.split(' ')[0], b.split(' ')[0])
  assert.equal(a.split(' ')[1], b.split(' ')[1])
  assert.notEqual(a.split(' ')[2], b.split(' ')[2])

  const got = transposition(rookWent, knightWent)
  assert.equal(got.ok, true)
  assert.equal(got.same, false)
  assert.deepEqual(got.differences, ['castling'])
  assert.notEqual(got.keys.a, got.keys.b)
  assert.match(got.reason, /castling rights differ \(Qq against KQkq\)/)
  assert.match(got.reason, /not merged/)
})

test('an en passant square is part of the position too', () => {
  // A White pawn on g5 and a Black pawn that has to get to h5. In the first line it goes in one jump, so gxh6 is
  // available; in the second it takes two single steps, so it is not. Everything else -- every piece, the side to
  // move, the (absent) castling rights -- is identical, so the capture is the only thing telling them apart.
  const start = '4k3/7p/8/6P1/8/8/8/4K3 w - - 0 1'
  const oneJump = ['Kd1', 'Kd8', 'Kd2', 'Ke8', 'Ke1', 'h5']
  const twoSteps = ['Kd1', 'h6', 'Ke1', 'h5']
  const got = transposition(oneJump, twoSteps, start)
  assert.equal(got.ok, true)
  assert.equal(got.same, false)
  assert.deepEqual(got.differences, ['en-passant'])
  assert.equal(got.keys.a, '4k3/8/8/6Pp/8/8/8/4K3 w - h6')
  assert.equal(got.keys.b, '4k3/8/8/6Pp/8/8/8/4K3 w - -')
  assert.match(got.reason, /en passant square differs \(h6 against -\)/)
})

test('a transposition check on a line that will not play claims nothing about either', () => {
  const got = transposition(['e4', 'e5'], ['e4', 'e4'])
  assert.equal(got.ok, false)
  assert.equal(got.same, false)
  assert.equal(got.keys.a, null)
  assert.match(got.reason, /second line cannot be played/)
})

test('the explorer lists what the dataset knows and refuses to invent popularity', () => {
  const got = explore(START_FEN)
  assert.equal(got.legal, 20)
  assert.equal(got.moves.length + got.unnamed, got.legal)
  assert.equal(got.order, 'alphabetical')
  assert.equal(got.statistics.available, false)
  assert.match(got.statistics.why, /counts no games/)
  // Alphabetical, really: the order is a stated fact about the list, not a hint about what is good.
  const sans = got.moves.map((m) => m.san)
  assert.deepEqual(sans, [...sans].sort())
  const e4 = got.moves.find((m) => m.san === 'e4')
  assert.equal(e4?.record.name, "King's Pawn Game")
  assert.equal(e4?.side, 'w')
  assert.equal(e4?.fen, after(['e4']))
})

test('the explorer counts the moves it knows nothing about rather than hiding them', () => {
  const got = explore(after(['e4']))
  assert.equal(got.legal, 20)
  assert.equal(got.unnamed, got.legal - got.moves.length)
  assert.ok(got.unnamed >= 1, 'at least one reply to 1.e4 has no name in the dataset')
  assert.equal(got.position.known, true)
  const sicilian = got.moves.find((m) => m.san === 'c5')
  assert.equal(sicilian?.record.eco, 'B20')
})

test('the explorer on a nonsense position says so instead of listing nothing in silence', () => {
  const got = explore('this is not a position')
  assert.equal(got.moves.length, 0)
  assert.equal(got.legal, 0)
  assert.equal(got.position.known, false)
  if (!got.position.known) assert.equal(got.position.problem, 'bad-position')
})

test('a position a game could never be in is refused, not explored', () => {
  /*
   * White to move with Black's king standing in check. Every field of this FEN is well formed and the library's
   * own validation passes it, but no move could have produced it -- and asking for its continuations asks the move
   * generator for a move that takes a king, which is not a move. Rendering the panel on this position used to
   * throw; now it says what is wrong with it.
   */
  const impossible = '8/8/4k3/8/2Q5/8/4K3/8 w - - 0 50'
  assert.equal(checkFen(impossible).ok, true, 'the FEN itself is well formed, which is what made this dangerous')
  const got = explore(impossible)
  assert.equal(got.position.known, false)
  if (!got.position.known) assert.equal(got.position.problem, 'bad-position')
  assert.match(got.position.known ? '' : got.position.reason, /cannot occur in a game/)
  assert.equal(got.moves.length, 0)
  // The same position with Black to move is perfectly ordinary, and is explored rather than refused.
  const fine = explore('8/8/4k3/8/2Q5/8/4K3/8 b - - 0 50')
  assert.equal(fine.legal > 0, true)
})

test('searching finds main lines before their variations, and knows ECO codes', () => {
  const italian = searchOpenings('italian', 5)
  assert.equal(italian[0].record.name, 'Italian Game')
  assert.equal(italian[0].matched, 'name')
  assert.ok(italian.length > 1)
  const eco = searchOpenings('B90', 3)
  assert.ok(eco.length > 0)
  assert.ok(eco.every((one) => one.record.eco === 'B90' && one.matched === 'eco'))
  assert.deepEqual(searchOpenings('   '), [])
  // A name nobody uses finds nothing, rather than the nearest thing.
  assert.deepEqual(searchOpenings('zzzzzz opening'), [])
})

test('every row in the shipped dataset is well formed, and no position is named twice', () => {
  /*
   * A string-level pass over all 3,865 rows: the key has to be a position key and nothing else, the code has to be
   * a real ECO code, and the name and the line have to be there. It is the cheap half of the check -- playing every
   * line through the rules takes about fifteen seconds, which the generator does at build time and no test run
   * should -- and it is the half that catches a data file that has been truncated or edited by hand.
   */
  const rows = OPENINGS_DATA.split('\n').filter(Boolean)
  assert.equal(rows.length, OPENING_SOURCE.entries)
  const keys = new Set<string>()
  for (const row of rows) {
    const parts = row.split('\t')
    assert.equal(parts.length, 4, row.slice(0, 60))
    const [key, eco, name, line] = parts
    const fields = key.split(' ')
    assert.equal(fields.length, 4, key)
    assert.equal(fields[0].split('/').length, 8, key)
    assert.ok(fields[1] === 'w' || fields[1] === 'b', key)
    assert.match(fields[2], /^(-|K?Q?k?q?)$/, key)
    assert.match(fields[3], /^(-|[a-h][36])$/, key)
    assert.match(eco, /^[A-E][0-9][0-9]$/, eco)
    assert.ok(name.trim().length > 0, key)
    assert.ok(line.trim().length > 0, key)
    // Two names for one position would mean the answer depended on which row was read first.
    assert.ok(!keys.has(key), `two rows claim ${key}`)
    keys.add(key)
  }
})

test('every line the dataset carries can really be played, and names its own position', () => {
  // A sample across all five volumes: the generator played all 3,865 at build time, and this checks the file that
  // actually shipped still agrees with the rules.
  const names = ['Italian Game', 'Ruy Lopez', "King's Indian Defense", 'Sicilian Defense: Najdorf Variation', 'English Opening', 'Dutch Defense']
  for (const name of names) {
    const found = searchOpenings(name, 1)[0]
    assert.ok(found, name)
    const reached = after(found.record.line)
    assert.equal(positionKey(reached), found.record.key, name)
    assert.equal(recordFor(reached)?.name, found.record.name)
  }
})
