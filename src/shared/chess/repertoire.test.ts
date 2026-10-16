import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, applyMove } from './rules.ts'
import type { StoredGame } from './model.ts'
import {
  REPERTOIRE_TAG, SIDE_TAG, addLine, bookProblems, buildBook, drillAnswer, drillReveal, drillSkipLine, editLine,
  emptyRepertoire, gradeRecall, lineFromStored, lineToStored, linesFor, linesFromPgn, linesToPgn, makeLine, removeLine,
  replaceMoves, startDrill, summarise, type RepertoireLine
} from './repertoire.ts'

/**
 * What these prove.
 *
 * A line is only stored if it can be played; the book is built by position so transpositions inside your own lines
 * meet; and the trainer tells "not in your repertoire" apart from "a mistake", only ever saying the second when an
 * engine score was handed to it.
 */

const NOW = 1_700_000_000_000

const line = (id: string, side: 'w' | 'b', name: string, moves: string[]): RepertoireLine => {
  const made = makeLine({ id, side, name, moves, now: NOW })
  assert.equal(made.ok, true, `${name} should be a legal line`)
  if (!made.ok) throw new Error('unreachable')
  return made.line
}

const after = (sans: string[]): string => {
  let fen = START_FEN
  for (const san of sans) {
    const made = applyMove(fen, san)
    assert.ok(made, san)
    fen = made.after
  }
  return fen
}

test('a line is played before it is stored, and it names its own opening', () => {
  const made = makeLine({ id: 'l1', side: 'w', name: 'My Italian', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], now: NOW })
  assert.equal(made.ok, true)
  if (!made.ok) return
  assert.equal(made.line.moves.length, 5)
  assert.equal(made.line.moves[4].uci, 'f1c4')
  // The name comes from the opening dataset, not from anything typed in.
  assert.equal(made.line.eco, 'C50')
  assert.equal(made.line.opening, 'Italian Game')
  assert.equal(made.line.createdAt, NOW)
})

test('a line with a move that will not play is refused, and the typing is handed back', () => {
  const made = makeLine({ id: 'l2', side: 'w', name: 'Nonsense', moves: ['e4', 'e5', 'Qd4'], now: NOW })
  assert.equal(made.ok, false)
  if (made.ok) return
  assert.equal(made.problem, 'illegal-move')
  assert.match(made.reason, /"Qd4" cannot be played/)
  assert.equal(made.kept.length, 2)
})

test('a line has to have a name, some moves, and a move of your own', () => {
  const noName = makeLine({ id: 'a', side: 'w', name: '   ', moves: ['e4'], now: NOW })
  assert.equal(noName.ok, false)
  if (!noName.ok) assert.equal(noName.problem, 'no-name')
  const noMoves = makeLine({ id: 'b', side: 'w', name: 'Empty', moves: [], now: NOW })
  assert.equal(noMoves.ok, false)
  if (!noMoves.ok) assert.equal(noMoves.problem, 'no-moves')
  // 1.e4 on its own is White's move, so it is nothing for a Black repertoire to remember.
  const notYours = makeLine({ id: 'c', side: 'b', name: 'Only their move', moves: ['e4'], now: NOW })
  assert.equal(notYours.ok, false)
  if (!notYours.ok) {
    assert.equal(notYours.problem, 'nothing-of-yours')
    assert.match(notYours.reason, /no move of your own/)
  }
})

test('a bad starting position is refused as a position, not as a move', () => {
  const made = makeLine({ id: 'd', side: 'w', name: 'From nowhere', moves: ['e4'], startFen: 'nonsense', now: NOW })
  assert.equal(made.ok, false)
  if (!made.ok) assert.equal(made.problem, 'bad-start-position')
})

test('adding, editing, replacing and removing lines', () => {
  let rep = emptyRepertoire()
  rep = addLine(rep, line('l1', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']))
  rep = addLine(rep, line('l2', 'b', 'Najdorf', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']))
  assert.equal(rep.lines.length, 2)
  assert.equal(linesFor(rep, 'w').length, 1)
  assert.equal(linesFor(rep, 'b')[0].name, 'Najdorf')

  rep = editLine(rep, 'l1', { name: 'Italian Game, main', note: 'Castle early.' }, NOW + 1)
  assert.equal(linesFor(rep, 'w')[0].name, 'Italian Game, main')
  assert.equal(linesFor(rep, 'w')[0].note, 'Castle early.')
  assert.equal(linesFor(rep, 'w')[0].updatedAt, NOW + 1)

  const swapped = replaceMoves(rep, 'l1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], NOW + 2)
  assert.equal(swapped.result.ok, true)
  const changed = linesFor(swapped.repertoire, 'w')[0]
  assert.equal(changed.opening, 'Ruy Lopez')
  // A replacement keeps the line's name, its note and when it was made.
  assert.equal(changed.name, 'Italian Game, main')
  assert.equal(changed.note, 'Castle early.')
  assert.equal(changed.createdAt, NOW)

  const refused = replaceMoves(swapped.repertoire, 'l1', ['e4', 'e5', 'Kf2', 'Nc6', 'Bb5'], NOW + 3)
  assert.equal(refused.result.ok, false)
  // Nothing changed: a refused edit does not half-happen.
  assert.equal(linesFor(refused.repertoire, 'w')[0].moves[4].san, 'Bb5')

  rep = removeLine(swapped.repertoire, 'l1')
  assert.equal(rep.lines.length, 1)
  assert.equal(removeLine(rep, 'nope').lines.length, 1)
})

test('the book is built by position, so two of your own lines meet where they transpose', () => {
  const rep = addLine(
    addLine(emptyRepertoire(), line('a', 'w', 'Via d4', ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'Bb4+'])),
    line('b', 'w', 'Via Nf3', ['Nf3', 'Nf6', 'c4', 'e6', 'd4', 'Bb4+'])
  )
  const book = buildBook(rep.lines, 'w')
  assert.equal(book.lineCount, 2)
  // The position after five moves is one position in the book, reached by both orders.
  const meeting = book.positions.get('rnbqkb1r/pppp1ppp/4pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R b KQkq -')
  assert.ok(meeting, 'the transposition should be one entry')
  assert.equal(meeting.theirs.length, 1)
  assert.equal(meeting.theirs[0].san, 'Bb4+')
  assert.deepEqual(meeting.theirs[0].lineIds.sort(), ['a', 'b'])
  // Each line passes through seven positions. Three of them are the same position in both -- the start, the one they
  // transpose into, and the one they end in -- so the book holds eleven, not fourteen.
  assert.equal(book.positions.size, 11)
  // They do disagree about the very first move, and that is reported as what it is: two first moves to choose from.
  assert.equal(book.conflicts.length, 1)
  assert.deepEqual(book.conflicts[0].moves.sort(), ['Nf3', 'd4'])
  assert.equal(book.conflicts[0].fen, START_FEN)
})

test('two of your lines answering one position differently is reported, not quietly resolved', () => {
  const rep = addLine(
    addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])),
    line('b', 'w', 'Ruy Lopez', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
  )
  const book = buildBook(rep.lines, 'w')
  assert.equal(book.conflicts.length, 1)
  assert.deepEqual(book.conflicts[0].moves.sort(), ['Bb5', 'Bc4'])
  assert.deepEqual(book.conflicts[0].lineIds.sort(), ['a', 'b'])
  assert.match(book.conflicts[0].reason, /2 different answers/)
  // Both are still yours: the trainer accepts either.
  const grade = gradeRecall(book, after(['e4', 'e5', 'Nf3', 'Nc6']), 'Bb5')
  assert.equal(grade.verdict, 'right')
  assert.match(grade.message, /also gives Bc4/)
})

test('recall grading: the move you wrote down', () => {
  const rep = addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']))
  const book = buildBook(rep.lines, 'w')
  const grade = gradeRecall(book, after(['e4', 'e5', 'Nf3', 'Nc6']), 'Bc4')
  assert.equal(grade.verdict, 'right')
  assert.equal(grade.played?.san, 'Bc4')
  assert.deepEqual(grade.lineIds, ['a'])
  assert.equal(grade.quality, undefined, 'no engine was asked, so no judgement is made')
})

test('recall grading: off book is NOT called bad', () => {
  const rep = addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']))
  const book = buildBook(rep.lines, 'w')
  const grade = gradeRecall(book, after(['e4', 'e5', 'Nf3', 'Nc6']), 'Bb5')
  assert.equal(grade.verdict, 'off-book')
  assert.equal(grade.expected[0].san, 'Bc4')
  assert.match(grade.message, /legal move, but it is not in your repertoire/)
  assert.match(grade.message, /says nothing about whether it is good/)
  // Bb5 is the Ruy Lopez. Nothing anywhere may call it a mistake without evidence.
  for (const word of ['mistake', 'blunder', 'bad', 'wrong', 'inaccuracy']) {
    assert.ok(!grade.message.toLowerCase().includes(word), `"${word}" must not appear: ${grade.message}`)
  }
  assert.equal(grade.quality, undefined)
})

test('recall grading: a position your repertoire does not cover is not a failure', () => {
  const rep = addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']))
  const book = buildBook(rep.lines, 'w')
  const grade = gradeRecall(book, after(['d4', 'd5', 'c4', 'e6']), 'Nc3')
  assert.equal(grade.verdict, 'not-in-book')
  assert.deepEqual(grade.expected, [])
  assert.match(grade.message, /not in your White repertoire/)
  assert.match(grade.message, /good move or a bad one/)
})

test('recall grading: a move only becomes a mistake when an engine says so', () => {
  const rep = addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']))
  const book = buildBook(rep.lines, 'w')
  const fen = after(['e4', 'e5', 'Nf3', 'Nc6'])
  // White-positive scores, as everything in Orbis stores them: the move thrown away three pawns.
  const withEngine = gradeRecall(book, fen, 'Ng5', {
    best: { kind: 'cp', cp: 30 },
    played: { kind: 'cp', cp: -300 },
    depth: 20,
    engine: 'Stockfish 17'
  })
  // It is still off book -- that is a fact about the repertoire -- and now it also carries a judgement.
  assert.equal(withEngine.verdict, 'off-book')
  assert.equal(withEngine.quality?.verdict, 'blunder')
  assert.equal(withEngine.quality?.depth, 20)
  assert.equal(withEngine.quality?.engine, 'Stockfish 17')
  assert.match(withEngine.message, /Stockfish 17/)
  assert.match(withEngine.message, /blunder/)

  // A search too shallow to trust is not evidence, and `classify` says so rather than guessing.
  const shallow = gradeRecall(book, fen, 'Ng5', { best: { kind: 'cp', cp: 30 }, played: { kind: 'cp', cp: -300 }, depth: 2 })
  assert.equal(shallow.quality?.verdict, 'unclear')
  assert.equal(shallow.quality?.label, 'Not judged')
})

test('recall grading: an illegal move, the wrong turn, and a broken position are three different answers', () => {
  const rep = addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']))
  const book = buildBook(rep.lines, 'w')
  const fen = after(['e4', 'e5', 'Nf3', 'Nc6'])
  const illegal = gradeRecall(book, fen, 'Qd5')
  assert.equal(illegal.verdict, 'illegal')
  assert.match(illegal.message, /cannot be played in this position/)
  // Still tells you what you meant to play here.
  assert.equal(illegal.expected[0].san, 'Bc4')

  const theirs = gradeRecall(book, after(['e4', 'e5', 'Nf3']), 'Nc6')
  assert.equal(theirs.verdict, 'their-move')
  assert.match(theirs.message, /Black to move/)

  const broken = gradeRecall(book, 'not a position', 'e4')
  assert.equal(broken.verdict, 'bad-position')
})

test('a drill plays the other side for you and only moves on when you play this line', () => {
  const rep = addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3']))
  const drill = startDrill(rep.lines, 'w')
  assert.ok(drill)
  assert.equal(drill.fen, START_FEN, 'it starts where it is your move')
  assert.equal(drill.done, false)

  const first = drillAnswer(drill, rep.lines, 'e4')
  assert.equal(first.grade.verdict, 'right')
  assert.equal(first.advanced, true)
  assert.equal(first.drill.right, 1)
  // Black's 1...e5 was played for you, so the next question is White's second move.
  assert.equal(first.drill.fen, after(['e4', 'e5']))
  assert.equal(first.drill.ply, 2)

  const wrong = drillAnswer(first.drill, rep.lines, 'd4')
  assert.equal(wrong.grade.verdict, 'off-book')
  assert.equal(wrong.advanced, false)
  assert.equal(wrong.drill.fen, after(['e4', 'e5']), 'an off-book answer leaves the position where it was')
  assert.equal(wrong.drill.offBook, 1)
  assert.equal(wrong.drill.asked, 2)
  assert.equal(wrong.expected, 'Nf3')

  const second = drillAnswer(wrong.drill, rep.lines, 'Nf3')
  assert.equal(second.advanced, true)
  assert.equal(second.drill.fen, after(['e4', 'e5', 'Nf3', 'Nc6']))

  const third = drillAnswer(second.drill, rep.lines, 'Bc4')
  const fourth = drillAnswer(third.drill, rep.lines, 'c3')
  assert.equal(fourth.advanced, true)
  assert.equal(fourth.drill.done, true, 'the line has run out, so the drill is finished')
  assert.equal(fourth.drill.right, 4)
  assert.equal(fourth.drill.history.length, 5)
  assert.deepEqual(fourth.drill.history.map((h) => h.outcome), ['right', 'off-book', 'right', 'right', 'right'])

  // Nothing more is asked of a finished drill, and it says so instead of starting again.
  const after2 = drillAnswer(fourth.drill, rep.lines, 'd4')
  assert.equal(after2.advanced, false)
  assert.match(after2.grade.message, /finished/)
})

test('a drill can be shown the answer, and a line can be skipped', () => {
  const rep = addLine(
    addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])),
    line('b', 'w', 'Queen\'s Gambit', ['d4', 'd5', 'c4'])
  )
  const drill = startDrill(rep.lines, 'w', 'shortest-first')
  assert.ok(drill)
  // Shortest first: the three-move line is asked about first.
  assert.equal(drill.lineIds[0], 'b')
  const shown = drillReveal(drill, rep.lines)
  assert.equal(shown.answer, 'd4')
  assert.equal(shown.drill.revealed, 1)
  assert.equal(shown.drill.right, 0)
  assert.equal(shown.drill.history[0].san, null)
  assert.equal(shown.drill.history[0].outcome, 'revealed')
  assert.equal(shown.drill.fen, after(['d4', 'd5']))

  const skipped = drillSkipLine(shown.drill, rep.lines)
  assert.equal(skipped.at, 1, 'skipping a line moves to the next one')
  assert.equal(skipped.done, false)
  assert.equal(skipped.fen, START_FEN)
  assert.equal(drillSkipLine(skipped, rep.lines).done, true)
})

test('a drill for a colour with no lines is nothing, said plainly', () => {
  const rep = addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']))
  assert.equal(startDrill(rep.lines, 'b'), null)
  assert.equal(startDrill([], 'w'), null)
})

test('a drill of a Black repertoire asks for Black moves and plays White for you', () => {
  const rep = addLine(emptyRepertoire(), line('a', 'b', 'Najdorf', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']))
  const drill = startDrill(rep.lines, 'b')
  assert.ok(drill)
  // 1.e4 was played for you: the first question is Black's reply.
  assert.equal(drill.fen, after(['e4']))
  const first = drillAnswer(drill, rep.lines, 'c5')
  assert.equal(first.grade.verdict, 'right')
  assert.equal(first.drill.fen, after(['e4', 'c5', 'Nf3']))
})

test('the problems a book has are named, and an empty one says it is empty', () => {
  const empty = bookProblems([], 'w')
  assert.equal(empty.length, 1)
  assert.equal(empty[0].kind, 'no-lines')
  assert.match(empty[0].message, /White repertoire/)

  const ends = line('a', 'w', 'Stops short', ['e4', 'e5'])
  const problems = bookProblems([ends], 'w')
  assert.equal(problems.length, 1)
  assert.equal(problems[0].kind, 'ends-on-their-move')
  assert.match(problems[0].message, /does not say what you play there/)

  const twice = bookProblems([line('a', 'w', 'One', ['e4', 'e5', 'Nf3']), line('b', 'w', 'The same', ['e4', 'e5', 'Nf3'])], 'w')
  assert.ok(twice.some((p) => p.kind === 'duplicate'))
  assert.ok(twice.some((p) => p.kind === 'conflict') === false, 'the same move twice is not a conflict')
})

test('a summary counts what is really there', () => {
  const rep = addLine(
    addLine(emptyRepertoire(), line('a', 'w', 'Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])),
    line('b', 'w', 'Ruy Lopez', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
  )
  const got = summarise(rep.lines, 'w')
  assert.equal(got.lines, 2)
  assert.equal(got.yourMoves, 6, 'three White moves in each line')
  assert.equal(got.deepest?.plies, 5)
  assert.deepEqual(got.eco, ['C50', 'C60'])
  assert.equal(got.conflicts, 1)
  // The two lines share their first four plies, so the book holds fewer positions than ten moves would suggest:
  // five positions a move was made in, plus the two the lines end in.
  assert.equal(got.positions, 7)
  assert.equal(summarise(rep.lines, 'b').lines, 0)
})

test('a repertoire goes out to a file and comes back the same', () => {
  const lines = [
    line('a', 'w', 'My Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']),
    line('b', 'b', 'My Najdorf', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'])
  ]
  const text = linesToPgn(lines)
  assert.match(text, /\[Event "Orbis repertoire"\]/)
  assert.match(text, new RegExp(`\\[${SIDE_TAG} "white"\\]`))
  assert.match(text, /\[OrbisLineName "My Najdorf"\]/)
  // No players, no date, no result are invented for a line nobody played.
  assert.match(text, /\[White "\?"\]/)
  assert.match(text, /\[Date "\?\?\?\?\.\?\?\.\?\?"\]/)

  const back = linesFromPgn(text, { now: NOW, makeId: (i) => `in-${i}` })
  assert.equal(back.failed.length, 0)
  assert.equal(back.needSide.length, 0)
  assert.equal(back.assumed.length, 0)
  assert.equal(back.lines.length, 2)
  assert.equal(back.lines[0].name, 'My Italian')
  assert.equal(back.lines[0].side, 'w')
  assert.deepEqual(back.lines[0].moves.map((m) => m.san), lines[0].moves.map((m) => m.san))
  assert.equal(back.lines[1].side, 'b')
  assert.equal(back.lines[1].eco, 'B90')
})

test('a file that does not say which colour a line is for is not guessed at', () => {
  const plain = '[Event "Something"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 *\n'
  const refused = linesFromPgn(plain, { now: NOW, makeId: (i) => `x-${i}` })
  assert.equal(refused.lines.length, 0)
  assert.equal(refused.needSide.length, 1)
  assert.equal(refused.needSide[0].name, 'Something')

  // Told which colour, it takes you at your word and says which lines that applied to.
  const taken = linesFromPgn(plain, { now: NOW, makeId: (i) => `x-${i}`, side: 'w' })
  assert.equal(taken.lines.length, 1)
  assert.deepEqual(taken.assumed, ['x-0'])
  assert.equal(taken.lines[0].side, 'w')
})

test('a file with a move that cannot be played is reported, not dropped', () => {
  const bad = '[Event "Orbis repertoire"]\n[OrbisRepertoireSide "white"]\n\n1. e4 e5 2. Qd4 *\n'
  const got = linesFromPgn(bad, { now: NOW, makeId: (i) => `y-${i}` })
  assert.equal(got.lines.length, 0)
  assert.equal(got.failed.length, 1)
  assert.match(got.failed[0].reason, /Qd4/)
})

test('a line stored as a game, and read back as a line', () => {
  const original = line('a', 'w', 'My Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
  const payload = lineToStored(original)
  assert.equal(payload.source.kind, 'study')
  assert.deepEqual(payload.tags, [REPERTOIRE_TAG, 'repertoire:white'])
  assert.equal(payload.meta.extra?.[SIDE_TAG], 'white')
  assert.equal(payload.meta.eco, 'C50')

  const stored: StoredGame = {
    id: 'a',
    profileId: 'p',
    source: { kind: 'study' },
    startFen: original.startFen,
    moves: original.moves,
    meta: payload.meta,
    variant: 'standard',
    createdAt: NOW,
    updatedAt: NOW + 5,
    tags: payload.tags,
    fingerprint: 'abc'
  }
  const back = lineFromStored(stored)
  assert.ok(back)
  assert.equal(back.name, 'My Italian')
  assert.equal(back.side, 'w')
  assert.equal(back.eco, 'C50')
  assert.equal(back.updatedAt, NOW + 5)
  assert.deepEqual(back.moves.map((m) => m.san), original.moves.map((m) => m.san))

  // An ordinary game in the library is not a repertoire line and is not read as one.
  assert.equal(lineFromStored({ ...stored, tags: [] }), null)
  assert.equal(lineFromStored({ ...stored, tags: ['something-else'] }), null)
  // Tagged, but with nothing saying which colour: refused rather than filed under a guess.
  assert.equal(lineFromStored({ ...stored, tags: [REPERTOIRE_TAG], meta: { white: {}, black: {}, result: '*' } }), null)
})
