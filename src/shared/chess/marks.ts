/**
 * The arrows and coloured squares somebody draws on a board.
 *
 * Right-drag across the board and you get an arrow; right-click a square and it takes a colour. They are how a
 * person thinks out loud over a position -- "this knight wants to be here, that pawn is the problem" -- and they
 * are worth nothing if they vanish the moment you step forward a move and come back.
 *
 * ## A mark belongs to a position, not to the board
 *
 * That is the whole reason this file exists rather than four `useState` calls inside `Board.tsx`. The board widget
 * is the same widget whatever position it is showing; the marks are not. So the board takes them as a prop and
 * reports a change upward, and whoever owns the position keeps them -- keyed by the node in the Analysis Studio
 * (which is how `analysis.ts` already keys a note), and by `positionKey(fen)` anywhere a board walks a game without
 * a tree behind it. A `MarkBook` below is that store: a key, and what was drawn there.
 *
 * Nothing here decides anything about chess. A mark is a square name and a colour. It never asks whether a move is
 * legal, and an arrow may point anywhere a person wants to point -- that is what makes it a thought and not a move.
 *
 * ## Reading one back
 *
 * `readMarks` and `readMarkBook` are deliberately grudging. An entry they cannot make sense of is left out and
 * said out loud, and the rest of the list still arrives; what they never do is substitute something. A caller that
 * gets a note back must not then save the book over the file it came from -- what could not be read is still in
 * there, and that save is the moment it would be lost (Sections 034, 038, 126).
 */

/** The four colours. Chess.com's four, in the order a modifier picks them: see `colourFor`. */
export type MarkColour = 'green' | 'red' | 'blue' | 'yellow'

export const MARK_COLOURS: readonly MarkColour[] = Object.freeze(['green', 'red', 'blue', 'yellow'])

export interface SquareMark {
  kind: 'square'
  square: string
  colour: MarkColour
}

export interface ArrowMark {
  kind: 'arrow'
  from: string
  to: string
  colour: MarkColour
}

export type Mark = SquareMark | ArrowMark

/**
 * How many marks one position may hold.
 *
 * A ceiling on a runaway rather than a budget: sixty-four is one for every square, and far more than anybody draws
 * by hand. It is said out loud when it bites, because a mark that silently fails to appear reads as a broken board.
 */
export const MARKS_PER_POSITION = 64

/** How many positions one book may hold, for the same reason. */
export const MARKED_POSITIONS = 512

const SQUARE = /^[a-h][1-8]$/

export function isSquare(value: unknown): value is string {
  return typeof value === 'string' && SQUARE.test(value)
}

export function isColour(value: unknown): value is MarkColour {
  return typeof value === 'string' && (MARK_COLOURS as readonly string[]).includes(value)
}

/** A coloured square, or null when that is not a square on a chessboard. */
export function squareMark(square: string, colour: MarkColour): SquareMark | null {
  if (!isSquare(square) || !isColour(colour)) return null
  return { kind: 'square', square, colour }
}

/** An arrow, or null when it goes nowhere: a square to itself is a click, and is a coloured square instead. */
export function arrowMark(from: string, to: string, colour: MarkColour): ArrowMark | null {
  if (!isSquare(from) || !isSquare(to) || from === to || !isColour(colour)) return null
  return { kind: 'arrow', from, to, colour }
}

/** The same place on the board, whatever colour it was drawn in. What decides whether drawing again removes it. */
export function sameSpot(a: Mark, b: Mark): boolean {
  if (a.kind === 'square' && b.kind === 'square') return a.square === b.square
  if (a.kind === 'arrow' && b.kind === 'arrow') return a.from === b.from && a.to === b.to
  return false
}

export interface MarkChange {
  marks: Mark[]
  /** What was refused, in words to show. Null when nothing was. */
  note: string | null
}

/**
 * Drawing one mark.
 *
 * The same mark again takes it off, which is the only way a mouse has of removing one. The same place in another
 * colour changes its colour and stays where it was in the list, so re-colouring an arrow does not move it behind
 * the ones drawn after it.
 */
export function toggle(marks: readonly Mark[], mark: Mark): MarkChange {
  const at = marks.findIndex((one) => sameSpot(one, mark))
  if (at >= 0) {
    const found = marks[at]
    if (found.colour === mark.colour) return { marks: marks.filter((_, index) => index !== at), note: null }
    const next = [...marks]
    next[at] = mark
    return { marks: next, note: null }
  }
  if (marks.length >= MARKS_PER_POSITION) {
    return {
      marks: [...marks],
      note: `There are already ${MARKS_PER_POSITION} marks on this position. Take one off before you draw another.`
    }
  }
  return { marks: [...marks, mark], note: null }
}

/** The next colour round, for the keyboard, which has no modifier to hold while it presses a key. */
export function nextColour(colour: MarkColour): MarkColour {
  const at = MARK_COLOURS.indexOf(colour)
  return MARK_COLOURS[(at < 0 ? 0 : at + 1) % MARK_COLOURS.length]
}

/**
 * Which colour a mouse gesture draws in.
 *
 * Nothing held is green, Shift is red, Alt is blue, Ctrl (or Cmd) is yellow, and when more than one is held the
 * first of those wins. Written down here rather than in the board so the board has no colour rules of its own.
 */
export function colourFor(held: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): MarkColour {
  if (held.shiftKey) return 'red'
  if (held.altKey) return 'blue'
  if (held.ctrlKey || held.metaKey) return 'yellow'
  return 'green'
}

/** One mark in words, for a screen reader and for the line under the board. */
export function describeMark(mark: Mark): string {
  return mark.kind === 'square'
    ? `a ${mark.colour} square on ${mark.square}`
    : `a ${mark.colour} arrow from ${mark.from} to ${mark.to}`
}

/** Everything drawn on this position in one sentence, or null when nothing is. */
export function describeMarks(marks: readonly Mark[]): string | null {
  if (marks.length === 0) return null
  const said = marks.map(describeMark)
  const last = said[said.length - 1]
  const list = said.length === 1 ? last : `${said.slice(0, -1).join(', ')} and ${last}`
  return `Drawn here: ${list}.`
}

/** What is on one square, when anything is. Used to say a square's own state without colour alone. */
export function markOn(marks: readonly Mark[], square: string): SquareMark | null {
  for (const mark of marks) if (mark.kind === 'square' && mark.square === square) return mark
  return null
}

// ---------------------------------------------------------------- a position's marks, kept

/**
 * Every position's marks, keyed by whatever identifies a position to the screen that owns it.
 *
 * The key is the caller's business on purpose. The Analysis Studio has node ids and must use them, because two
 * different places in a game can be the same position and a note drawn in one of them does not belong in the
 * other. A screen walking a plain game has `positionKey(fen)` and nothing better.
 */
export type MarkBook = Readonly<Record<string, readonly Mark[]>>

export const emptyBook = (): MarkBook => Object.freeze({})

export function marksAt(book: MarkBook, key: string): readonly Mark[] {
  return book[key] ?? []
}

/** The book with one position's marks replaced. An empty list takes the key out rather than storing nothing. */
export function withMarksAt(book: MarkBook, key: string, marks: readonly Mark[]): MarkBook {
  const next: Record<string, readonly Mark[]> = { ...book }
  if (marks.length === 0) delete next[key]
  else next[key] = [...marks]
  return next
}

export function countMarks(book: MarkBook): number {
  return Object.values(book).reduce((all, one) => all + one.length, 0)
}

export interface ReadMarks {
  marks: Mark[]
  /** What could not be read, in sentences to show. Empty nearly always. */
  notes: string[]
}

/** One position's marks, out of whatever was in the file. */
export function readMarks(raw: unknown, where = 'this position'): ReadMarks {
  if (raw === undefined || raw === null) return { marks: [], notes: [] }
  if (!Array.isArray(raw)) {
    return { marks: [], notes: [`What was saved for ${where} was not a list of marks, so none were read from it.`] }
  }
  const marks: Mark[] = []
  const notes: string[] = []
  raw.forEach((entry, index) => {
    const at = `${where}, mark ${index + 1}`
    if (typeof entry !== 'object' || entry === null) {
      notes.push(`${at} was not a mark at all, so it was left out.`)
      return
    }
    const one = entry as Record<string, unknown>
    if (!isColour(one.colour)) {
      notes.push(`${at} was drawn in a colour Orbis does not know (${String(one.colour)}), so it was left out.`)
      return
    }
    if (one.kind === 'square') {
      const made = squareMark(String(one.square), one.colour)
      if (!made) notes.push(`${at} named ${String(one.square)}, which is not a square, so it was left out.`)
      else if (marks.length >= MARKS_PER_POSITION) notes.push(`${at} is past the ${MARKS_PER_POSITION} this version keeps, so it was left out.`)
      else marks.push(made)
      return
    }
    if (one.kind === 'arrow') {
      const made = arrowMark(String(one.from), String(one.to), one.colour)
      if (!made) notes.push(`${at} pointed from ${String(one.from)} to ${String(one.to)}, which is not an arrow across a board, so it was left out.`)
      else if (marks.length >= MARKS_PER_POSITION) notes.push(`${at} is past the ${MARKS_PER_POSITION} this version keeps, so it was left out.`)
      else marks.push(made)
      return
    }
    notes.push(`${at} is a kind of mark this version has never heard of (${String(one.kind)}), so it was left out.`)
  })
  return { marks, notes }
}

export interface ReadMarkBook {
  book: MarkBook
  notes: string[]
}

/**
 * A whole book, out of whatever was in the file.
 *
 * Nothing is thrown away quietly and nothing is replaced by a default. A key whose marks will not read comes back
 * with no marks and a sentence saying so, which is the difference between "you drew nothing here" and "Orbis could
 * not read what you drew here" -- and the caller must not save over the file while any of these notes stand.
 */
export function readMarkBook(raw: unknown): ReadMarkBook {
  if (raw === undefined || raw === null) return { book: emptyBook(), notes: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { book: emptyBook(), notes: ['What was saved was not a set of marked positions, so none were read.'] }
  }
  const book: Record<string, readonly Mark[]> = {}
  const notes: string[] = []
  let positions = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length === 0 || key.length > 200) {
      notes.push('One set of marks was saved against a position Orbis cannot identify, so it was left out.')
      continue
    }
    if (positions >= MARKED_POSITIONS) {
      notes.push(`Marks were saved for more than the ${MARKED_POSITIONS} positions this version keeps, so the rest were left out.`)
      break
    }
    const read = readMarks(value, key)
    notes.push(...read.notes)
    positions += 1
    if (read.marks.length > 0) book[key] = read.marks
  }
  return { book: Object.freeze(book), notes }
}

// ---------------------------------------------------------------- drawing an arrow

/**
 * Where an arrow's line and head go, on a board eight units wide and eight tall.
 *
 * The units are squares, so the shape does not care how big the board is on the screen -- an SVG over the board
 * with `viewBox="0 0 8 8"` draws these numbers straight. The files and ranks are passed in **as the screen shows
 * them**, which is what makes a flipped board work without this function knowing which way up the board is.
 */
export interface Point {
  x: number
  y: number
}

export interface ArrowShape {
  colour: MarkColour
  /**
   * The shaft, as a path rather than a single line.
   *
   * Two points for an ordinary arrow. **Three for a knight's move**, which bends: it goes two squares the way it
   * mostly goes and then turns one. A knight drawn as a straight diagonal is the thing that made these arrows look
   * wrong -- it crosses two squares the knight never visits and points at the target from an angle no move takes.
   */
  shaft: readonly Point[]
  /** The point of the arrow, and the two back corners, in the order a polygon takes them. */
  head: readonly [Point, Point, Point]
  /** The centre of the square it starts from, kept because a key and a description both want it. */
  start: Point
}

/** The board is eight squares across, which is the coordinate space `arrowShape` works in. */
export const ARROW_GRID = 8

/*
 * The head, in squares.
 *
 * It was 0.34 long and 0.42 across, which read as a hairline with a dart on the end. Going to 0.38 by 0.52 fixed
 * the hairline and overshot the head: at board size it covered most of the square it pointed at, so the arrow
 * looked like a traffic cone and you could not see the piece it was pointing at. These are the settled numbers --
 * a head about a third of a square long and two fifths across, which is heavy enough to read at a glance and
 * light enough to leave the target square visible.
 */
const HEAD_LENGTH = 0.3
const HEAD_HALF_WIDTH = 0.19
/**
 * How far from the middle of its own square an arrow begins.
 *
 * It used to begin at the centre, which buried the piece it was about: you drew an arrow to say "this knight goes
 * there" and the arrow covered the knight. Starting clear of the piece is why a drawn board stays readable.
 */
const TAIL_GAP = 0.34

const round = (value: number): number => Math.round(value * 10_000) / 10_000

/** The middle of a square, as the screen is showing the board. Null when that square is not on it. */
export function squareCentre(square: string, files: readonly string[], ranks: readonly string[]): Point | null {
  if (!isSquare(square)) return null
  const file = files.indexOf(square[0])
  const rank = ranks.indexOf(square[1])
  if (file < 0 || rank < 0) return null
  return { x: file + 0.5, y: rank + 0.5 }
}

export function arrowShape(mark: ArrowMark, files: readonly string[], ranks: readonly string[]): ArrowShape | null {
  const start = squareCentre(mark.from, files, ranks)
  const tip = squareCentre(mark.to, files, ranks)
  if (!start || !tip) return null
  const dx = tip.x - start.x
  const dy = tip.y - start.y
  if (dx === 0 && dy === 0) return null

  /*
   * A knight's move bends, and every other move is straight.
   *
   * The test for it is the move itself: one square one way and two the other. The corner is the point the knight
   * really turns at -- along the long leg first, then the short one -- which is how the move is read aloud and how
   * every board that draws these shows it.
   */
  const steps = { x: Math.abs(dx), y: Math.abs(dy) }
  const bends = (steps.x === 1 && steps.y === 2) || (steps.x === 2 && steps.y === 1)
  const corner: Point | null = bends
    ? (steps.y === 2 ? { x: start.x, y: tip.y } : { x: tip.x, y: start.y })
    : null

  // The last leg decides which way the head points and where the shaft has to stop.
  const from = corner ?? start
  const legX = tip.x - from.x
  const legY = tip.y - from.y
  const legLength = Math.hypot(legX, legY)
  if (legLength === 0) return null
  const ux = legX / legLength
  const uy = legY / legLength
  const back: Point = { x: tip.x - ux * HEAD_LENGTH, y: tip.y - uy * HEAD_LENGTH }
  const px = -uy
  const py = ux

  // The tail steps back out of its own square, along the first leg, so the piece underneath stays visible.
  const firstX = (corner ?? tip).x - start.x
  const firstY = (corner ?? tip).y - start.y
  const firstLength = Math.hypot(firstX, firstY)
  const tail: Point = firstLength === 0
    ? start
    : { x: start.x + (firstX / firstLength) * TAIL_GAP, y: start.y + (firstY / firstLength) * TAIL_GAP }

  const at = (point: Point): Point => ({ x: round(point.x), y: round(point.y) })
  return {
    colour: mark.colour,
    start: at(start),
    shaft: corner ? [at(tail), at(corner), at(back)] : [at(tail), at(back)],
    head: [
      at(tip),
      { x: round(back.x + px * HEAD_HALF_WIDTH), y: round(back.y + py * HEAD_HALF_WIDTH) },
      { x: round(back.x - px * HEAD_HALF_WIDTH), y: round(back.y - py * HEAD_HALF_WIDTH) }
    ]
  }
}
