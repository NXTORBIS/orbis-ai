import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ARROW_GRID,
  MARKED_POSITIONS,
  MARKS_PER_POSITION,
  arrowMark,
  arrowShape,
  colourFor,
  countMarks,
  describeMark,
  describeMarks,
  emptyBook,
  isSquare,
  markOn,
  marksAt,
  nextColour,
  readMarkBook,
  readMarks,
  sameSpot,
  squareCentre,
  squareMark,
  toggle,
  withMarksAt,
  type Mark,
  type MarkColour
} from './marks.ts'

/** The board as White sees it, which is what `arrowShape` and `squareCentre` are handed. */
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']
const green = (square: string): Mark => squareMark(square, 'green')!
const arrow = (from: string, to: string): Mark => arrowMark(from, to, 'green')!

// ---------------------------------------------------------------- what a mark is

test('a mark is a real square and a known colour, or it is not a mark at all', () => {
  assert.ok(isSquare('e4'))
  assert.ok(!isSquare('e9'), 'there is no ninth rank')
  assert.ok(!isSquare('i4'), 'there is no i file')
  assert.ok(!isSquare('E4'), 'a square name is lower case')
  assert.ok(!isSquare(''))
  assert.ok(!isSquare(4))

  assert.deepEqual(squareMark('d5', 'red'), { kind: 'square', square: 'd5', colour: 'red' })
  assert.equal(squareMark('d9', 'red'), null)
  // A colour nobody has heard of is refused rather than drawn in some default.
  assert.equal(squareMark('d5', 'purple' as unknown as MarkColour), null)
})

test('an arrow has to go somewhere', () => {
  assert.deepEqual(arrowMark('e2', 'e4', 'blue'), { kind: 'arrow', from: 'e2', to: 'e4', colour: 'blue' })
  assert.equal(arrowMark('e2', 'e2', 'blue'), null, 'a square to itself is a click, not a drag')
  assert.equal(arrowMark('e2', 'z9', 'blue'), null)
})

test('an arrow may point anywhere, because it is a thought and not a move', () => {
  // A knight cannot go from a1 to h8 and a person may well want to draw that line anyway.
  assert.ok(arrowMark('a1', 'h8', 'green'))
  assert.ok(arrowMark('h8', 'a1', 'yellow'))
})

// ---------------------------------------------------------------- drawing and undrawing

test('the same mark again takes it off', () => {
  const one = toggle([], green('d5'))
  assert.deepEqual(one.marks, [green('d5')])
  assert.equal(one.note, null)
  const off = toggle(one.marks, green('d5'))
  assert.deepEqual(off.marks, [])
})

test('the same square in another colour changes its colour and stays where it was', () => {
  const marks = [green('a1'), green('d5'), green('h8')]
  const next = toggle(marks, squareMark('d5', 'red')!)
  assert.deepEqual(next.marks, [green('a1'), squareMark('d5', 'red')!, green('h8')])
})

test('an arrow is the same arrow only when it points the same way', () => {
  const marks = toggle([], arrow('e2', 'e4')).marks
  assert.deepEqual(toggle(marks, arrow('e4', 'e2')).marks.length, 2, 'the other way round is a different arrow')
  assert.deepEqual(toggle(marks, arrow('e2', 'e4')).marks, [], 'the same way round takes it off')
  assert.ok(!sameSpot(green('e2'), arrow('e2', 'e4')), 'a square and an arrow are never the same mark')
})

test('a drawing that cannot be added says so rather than failing silently', () => {
  let marks: Mark[] = []
  // Every square on the board, which is exactly the cap.
  for (const file of FILES) for (const rank of RANKS) marks = toggle(marks, green(`${file}${rank}`)).marks
  assert.equal(marks.length, MARKS_PER_POSITION)
  const refused = toggle(marks, arrow('e2', 'e4'))
  assert.equal(refused.marks.length, MARKS_PER_POSITION, 'the cap was passed')
  assert.match(refused.note ?? '', /already 64 marks/)
  assert.match(refused.note ?? '', /Take one off/)
  // And the cap never stops you removing one, or recolouring one that is already there.
  assert.equal(toggle(marks, green('e4')).marks.length, MARKS_PER_POSITION - 1)
  assert.equal(toggle(marks, squareMark('e4', 'red')!).note, null)
})

test('a colour comes from what is held down, and the keyboard walks the same four', () => {
  assert.equal(colourFor({}), 'green')
  assert.equal(colourFor({ shiftKey: true }), 'red')
  assert.equal(colourFor({ altKey: true }), 'blue')
  assert.equal(colourFor({ ctrlKey: true }), 'yellow')
  assert.equal(colourFor({ metaKey: true }), 'yellow', 'Cmd is Ctrl, as everywhere else in Orbis')
  assert.equal(colourFor({ shiftKey: true, altKey: true }), 'red', 'the first one in the order wins')

  assert.equal(nextColour('green'), 'red')
  assert.equal(nextColour('yellow'), 'green', 'it comes round')
})

// ---------------------------------------------------------------- saying what is drawn

test('a mark says what it is in words somebody can read out', () => {
  assert.equal(describeMark(green('d5')), 'a green square on d5')
  assert.equal(describeMark(arrowMark('e2', 'e4', 'red')!), 'a red arrow from e2 to e4')
  assert.equal(describeMarks([]), null, 'nothing drawn is nothing to say')
  assert.equal(describeMarks([green('d5')]), 'Drawn here: a green square on d5.')
  assert.equal(
    describeMarks([green('d5'), arrowMark('e2', 'e4', 'blue')!]),
    'Drawn here: a green square on d5 and a blue arrow from e2 to e4.'
  )
})

test('a square knows its own colour, so it can be said without looking at it', () => {
  const marks = [arrow('e2', 'e4'), squareMark('d5', 'yellow')!]
  assert.equal(markOn(marks, 'd5')?.colour, 'yellow')
  assert.equal(markOn(marks, 'e2'), null, 'an arrow starting here does not colour the square')
})

// ---------------------------------------------------------------- marks belong to a position

test('marks are kept against a position, and stepping away and back finds them again', () => {
  let book = emptyBook()
  book = withMarksAt(book, 'node-4', [green('d5')])
  book = withMarksAt(book, 'node-9', [arrow('e2', 'e4'), green('f7')])
  assert.deepEqual(marksAt(book, 'node-4'), [green('d5')])
  assert.deepEqual(marksAt(book, 'node-9').length, 2)
  // The position nobody drew on has nothing, which is not the same as not being there.
  assert.deepEqual(marksAt(book, 'node-5'), [])
  assert.equal(countMarks(book), 3)

  // Clearing a position takes its key out rather than leaving an empty list behind.
  const cleared = withMarksAt(book, 'node-4', [])
  assert.deepEqual(Object.keys(cleared).sort(), ['node-9'])
  assert.deepEqual(marksAt(cleared, 'node-9').length, 2, 'clearing one position touched another')
})

test('a book is never changed in place', () => {
  const book = withMarksAt(emptyBook(), 'a', [green('d5')])
  const next = withMarksAt(book, 'a', [green('d5'), green('e5')])
  assert.equal(marksAt(book, 'a').length, 1, 'the first book changed under the caller')
  assert.equal(marksAt(next, 'a').length, 2)
})

// ---------------------------------------------------------------- reading one back

test('what will not read is reported and left out, and the rest still arrives', () => {
  const read = readMarks(
    [
      { kind: 'square', square: 'd5', colour: 'green' },
      { kind: 'square', square: 'd9', colour: 'green' },
      { kind: 'arrow', from: 'e2', to: 'e4', colour: 'purple' },
      { kind: 'ring', square: 'd5', colour: 'red' },
      'not a mark',
      { kind: 'arrow', from: 'g1', to: 'f3', colour: 'blue' }
    ],
    'move 12'
  )
  assert.deepEqual(read.marks, [
    { kind: 'square', square: 'd5', colour: 'green' },
    { kind: 'arrow', from: 'g1', to: 'f3', colour: 'blue' }
  ])
  assert.equal(read.notes.length, 4, read.notes.join(' / '))
  for (const note of read.notes) {
    assert.match(note, /move 12/, 'a note does not say which position it is about')
    assert.match(note, /left out/, `a note does not say what happened: ${note}`)
  }
})

test('nothing saved is not the same as something unreadable', () => {
  assert.deepEqual(readMarks(undefined), { marks: [], notes: [] })
  assert.deepEqual(readMarks(null), { marks: [], notes: [] })
  const wrong = readMarks('all my arrows', 'node-3')
  assert.deepEqual(wrong.marks, [])
  assert.equal(wrong.notes.length, 1)
  assert.match(wrong.notes[0], /not a list of marks/)
})

test('a book that will not read gives back no marks and a sentence, not a default', () => {
  assert.deepEqual(readMarkBook(undefined), { book: {}, notes: [] })
  const wrong = readMarkBook(['this', 'was', 'a', 'list'])
  assert.deepEqual(wrong.book, {})
  assert.equal(wrong.notes.length, 1)
  assert.match(wrong.notes[0], /not a set of marked positions/)

  const mixed = readMarkBook({
    'node-1': [{ kind: 'square', square: 'd5', colour: 'green' }],
    'node-2': 'what I drew here',
    'node-3': [{ kind: 'arrow', from: 'e2', to: 'e4', colour: 'red' }]
  })
  assert.deepEqual(Object.keys(mixed.book).sort(), ['node-1', 'node-3'], 'one bad position cost another one its marks')
  assert.equal(mixed.notes.length, 1)
  assert.match(mixed.notes[0], /node-2/)
})

test('a book past the cap keeps what it can and says the rest was left out', () => {
  const raw: Record<string, unknown> = {}
  for (let index = 0; index < MARKED_POSITIONS + 5; index++) {
    raw[`node-${index}`] = [{ kind: 'square', square: 'd5', colour: 'green' }]
  }
  const read = readMarkBook(raw)
  assert.equal(Object.keys(read.book).length, MARKED_POSITIONS)
  assert.equal(read.notes.length, 1)
  assert.match(read.notes[0], /more than the 512 positions/)
})

// ---------------------------------------------------------------- the shape of an arrow

test('an arrow is drawn in squares, so it fits any size of board', () => {
  const shape = arrowShape(arrowMark('e2', 'e4', 'green')!, FILES, RANKS)!
  assert.ok(shape)
  // e2 is the fifth file and the seventh rank from the top as White sees it: (4.5, 6.5).
  assert.deepEqual(shape.start, { x: 4.5, y: 6.5 })
  // An ordinary move is one straight leg, so the shaft is two points.
  assert.equal(shape.shaft.length, 2, 'a straight arrow has no corner')
  // It begins a third of a square up from e2's centre, rather than on top of the piece it is about.
  assert.deepEqual(shape.shaft[0], { x: 4.5, y: 6.16 })
  // And stops a head's length short of e4's centre at (4.5, 4.5).
  assert.deepEqual(shape.shaft[1], { x: 4.5, y: 4.8 })
  assert.deepEqual(shape.head[0], { x: 4.5, y: 4.5 }, 'the point of the arrow is the middle of the square')
  assert.deepEqual([shape.head[1].y, shape.head[2].y], [4.8, 4.8], 'the back corners are level with each other')
  assert.equal(Math.round(Math.abs(shape.head[1].x - shape.head[2].x) * 100) / 100, 0.38, 'the head is 0.38 of a square wide')
  assert.equal(shape.colour, 'green')
})

test('a knight is drawn bent, along the way the move is really made', () => {
  // g1 to f3: one file across, two ranks up. The long leg goes first, so the corner is above g1.
  const knight = arrowShape(arrowMark('g1', 'f3', 'green')!, FILES, RANKS)!
  assert.equal(knight.shaft.length, 3, 'a knight bends, so the shaft has a corner')
  assert.deepEqual(knight.shaft[1], { x: 6.5, y: 5.5 }, 'two ranks up the g file, then across')
  assert.equal(knight.head[0].x, 5.5, 'and it points at f3')

  // b1 to c3 is the mirror of it, and must bend the same way round.
  const other = arrowShape(arrowMark('b1', 'c3', 'green')!, FILES, RANKS)!
  assert.deepEqual(other.shaft[1], { x: 1.5, y: 5.5 })

  // Two across and one up turns the other way: along the rank first.
  const wide = arrowShape(arrowMark('b1', 'd2', 'green')!, FILES, RANKS)!
  assert.equal(wide.shaft.length, 3)
  assert.deepEqual(wide.shaft[1], { x: 3.5, y: 7.5 }, 'two files across the first rank, then up')

  // A bishop goes two squares diagonally and does not bend.
  const bishop = arrowShape(arrowMark('c1', 'e3', 'green')!, FILES, RANKS)!
  assert.equal(bishop.shaft.length, 2, 'a diagonal is one straight leg')
})

test('the arrow turns round when the board does', () => {
  const flippedFiles = [...FILES].reverse()
  const flippedRanks = [...RANKS].reverse()
  const up = arrowShape(arrowMark('e2', 'e4', 'green')!, FILES, RANKS)!
  const down = arrowShape(arrowMark('e2', 'e4', 'green')!, flippedFiles, flippedRanks)!
  assert.ok(up.start.y > up.head[0].y, "White at the bottom: e2 to e4 points up the screen")
  assert.ok(down.start.y < down.head[0].y, 'Black at the bottom: the same move points down the screen')
  // And it is the same length either way round.
  const length = (one: typeof up): number => Math.hypot(one.head[0].x - one.start.x, one.head[0].y - one.start.y)
  assert.equal(length(up), length(down))
})

test('every square has a middle, and a square that is not on the board has none', () => {
  assert.deepEqual(squareCentre('a8', FILES, RANKS), { x: 0.5, y: 0.5 })
  assert.deepEqual(squareCentre('h1', FILES, RANKS), { x: 7.5, y: 7.5 })
  assert.equal(squareCentre('j1', FILES, RANKS), null)
  // Nothing ever lands outside the board the arrows are drawn over.
  for (const file of FILES) {
    for (const rank of RANKS) {
      const centre = squareCentre(`${file}${rank}`, FILES, RANKS)!
      assert.ok(centre.x > 0 && centre.x < ARROW_GRID && centre.y > 0 && centre.y < ARROW_GRID)
    }
  }
})

test('an arrow whose squares are not on this board is not drawn', () => {
  // Four files only, as a smaller board would hand in. The arrow has nowhere to be.
  assert.equal(arrowShape(arrowMark('e2', 'e4', 'green')!, ['a', 'b', 'c', 'd'], RANKS), null)
})
