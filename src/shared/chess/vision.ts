import { boardSquares, outcome, sideToMove, START_FEN } from './rules.ts'
import type { Side } from './evaluation.ts'
import { canPlayFrom, viewRules, type Phase } from './trainingView.ts'

/**
 * The coordinate trainer: a square is named and you find it, or a square is marked and you name it.
 *
 * It is the drill people use to stop counting ranks with a finger, and the thing it is really testing is the board
 * seen from the other side -- h1 is at the bottom right from White and at the top left from Black, and that is the
 * mistake. So the point of view is part of the setup and `visionRows` is the one place that lays the board out.
 *
 * Pure: no clock of its own (`now` is an argument everywhere), no storage, no network, no React.
 *
 * ## Four things it refuses to do
 *
 * **It will not draw a piece it was not given.** Whether a position may be on screen is not decided here: it is
 * asked of `viewRules` in `trainingView.ts`, the same function the blindfold screen asks, and `visionView` only
 * puts the gym's words round the answer. A round with the pieces turned off hands back `boardFen: null`, and a
 * screen that has no other way to get a position cannot leak one into the document.
 *
 * **It will not score a round that had the answers on screen.** With the file and rank labels on the edge of the
 * board, "where is e4" is answered by reading the board, so `scored` is false and the round says why. That is the
 * same rule the blindfold ladder applies to its read-out mode, for the same reason.
 *
 * **It will not work out a rate from nothing.** Two answers in three seconds does not establish a speed, so
 * `perMinute` is null below the stated floor rather than a number somebody could believe. Nothing here is an
 * average of one.
 *
 * **It has a stated pass mark rather than a hidden one.** `VISION_PASS` is on screen in words. A trainer whose
 * threshold nobody can see does not have a threshold.
 */

// ---------------------------------------------------------------- the board, from either side

export const FILES: readonly string[] = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
export const RANKS: readonly string[] = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8'])

/** Every square, in no particular order. Sixty-four of them, always. */
export const ALL_SQUARES: readonly string[] = Object.freeze(
  FILES.flatMap((file) => RANKS.map((rank) => `${file}${rank}`))
)

export function isSquareName(text: string): boolean {
  return /^[a-h][1-8]$/.test(text)
}

/**
 * What somebody typed, as a square, or null.
 *
 * Tolerant of the three things people really type -- a capital file, a space in the middle, surrounding spaces --
 * and of nothing else. "E 4" is the same answer as "e4" and marking it wrong would be marking their typing.
 */
export function readSquareName(text: string): string | null {
  const tidy = text.trim().toLowerCase().replace(/\s+/g, '')
  return isSquareName(tidy) ? tidy : null
}

/** Light or dark, worked out from the square rather than from how a board happens to be drawn. */
export function squareColour(square: string): 'light' | 'dark' {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1]) - 1
  return (file + rank) % 2 === 0 ? 'dark' : 'light'
}

/**
 * The board laid out as it is drawn, from one side's point of view: eight rows of eight, top row first.
 *
 * The whole trainer turns on this being right, which is why it is a function with a test rather than two reversed
 * arrays inside a component. From White, the top left square is a8 and the bottom right is h1; from Black it is h1
 * at the top left and a8 at the bottom right.
 */
export function visionRows(from: Side): string[][] {
  const files = from === 'w' ? [...FILES] : [...FILES].reverse()
  const ranks = from === 'w' ? [...RANKS].reverse() : [...RANKS]
  return ranks.map((rank) => files.map((file) => `${file}${rank}`))
}

// ---------------------------------------------------------------- what a round is

export type VisionDirection =
  /** A square is named and you click it. */
  | 'find-the-square'
  /** A square is marked and you name it. */
  | 'name-the-square'

export interface DirectionNote {
  id: VisionDirection
  title: string
  /** What it asks of somebody, in a sentence. */
  asks: string
}

export const VISION_DIRECTIONS: readonly DirectionNote[] = Object.freeze([
  Object.freeze({
    id: 'find-the-square' as const,
    title: 'Find the square',
    asks: 'A square is named. Click it on the board.'
  }),
  Object.freeze({
    id: 'name-the-square' as const,
    title: 'Name the square',
    asks: 'A square on the board is marked. Type its name.'
  })
])

export function directionNote(id: VisionDirection): DirectionNote {
  return VISION_DIRECTIONS.find((one) => one.id === id) ?? VISION_DIRECTIONS[0]
}

export interface VisionSetup {
  direction: VisionDirection
  /** Whose point of view the board is drawn from. Black is the one people get wrong. */
  from: Side
  /** How long a round lasts. */
  seconds: number
  /** Whether the file and rank labels are on the edge of the board. With them on, the round is not scored. */
  coordinates: boolean
  /** Whether a real position is on the board behind the squares. */
  pieces: boolean
}

export const DEFAULT_VISION_SETUP: VisionSetup = Object.freeze({
  direction: 'find-the-square' as VisionDirection,
  from: 'w' as Side,
  seconds: 30,
  coordinates: false,
  pieces: false
})

export const SHORTEST_ROUND = 10
export const LONGEST_ROUND = 300

/** The setup, with anything out of range brought back into it. Never a silent default over a real choice. */
export function tidySetup(setup: VisionSetup): VisionSetup {
  const seconds = Number.isFinite(setup.seconds)
    ? Math.max(SHORTEST_ROUND, Math.min(LONGEST_ROUND, Math.trunc(setup.seconds)))
    : DEFAULT_VISION_SETUP.seconds
  return {
    direction: setup.direction === 'name-the-square' ? 'name-the-square' : 'find-the-square',
    from: setup.from === 'b' ? 'b' : 'w',
    seconds,
    coordinates: setup.coordinates === true,
    pieces: setup.pieces === true
  }
}

/**
 * What it takes to pass, stated.
 *
 * Chess.com's Vision gives a score and nothing else, and a score on its own cannot say whether somebody has the
 * board. These two facts can: enough squares to rule out luck, and no square missed. It is written on the screen in
 * these words, and `visionScore` applies exactly it.
 */
export const VISION_PASS = Object.freeze({
  least: 10,
  says: 'Ten squares or more, with none missed.'
})

/** Below this, a rate would be an average of almost nothing. */
export const RATE_FLOOR = Object.freeze({ ms: 5000, answers: 3 })

export interface VisionAsk {
  /** Which question of the round this is, from 0. */
  at: number
  square: string
}

export interface VisionAnswer {
  at: number
  /** The square that was asked about. */
  square: string
  /** What was given, as given. */
  given: string
  right: boolean
  /** How long this one took, from the moment it was asked. */
  ms: number
}

export interface VisionRound {
  setup: VisionSetup
  /** The seed the questions came from, so a round can be played again exactly. */
  seed: number
  startedAt: number
  /** The questions, worked out ahead from the seed. */
  asks: readonly VisionAsk[]
  answers: readonly VisionAnswer[]
  /**
   * The position behind the squares, or null when there is none.
   *
   * Null is also what a round gets when the setup asked for pieces and the position it was handed could not be
   * played from. `piecesNote` then says so; a position nobody checked is not put on a board.
   */
  fen: string | null
  /** Why there are no pieces, when the setup asked for them. Null when nothing needs saying. */
  piecesNote: string | null
  /** When the round was stopped early. Null while it is running or when it ran its full length. */
  stoppedAt: number | null
}

/**
 * How many questions are worked out when a round starts.
 *
 * A fast person answers about two a second, so a five-minute round could reach six hundred. Working them all out
 * up front costs nothing and means `askNow` is a lookup rather than a generator with a position in it -- which is
 * what makes a round reproducible from its seed.
 */
const ASKS_PER_SECOND = 3

/** A named generator, so a round can be got back from its seed. The same one the blindfold rounds use. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The questions for a round.
 *
 * No square follows itself. Asking for e4 twice in a row is not a harder question, it is a question somebody
 * answers with the mouse still over the answer, and a trainer that does it is measuring nothing for one of the two.
 */
export function visionAsks(seed: number, count: number): VisionAsk[] {
  const random = mulberry32(seed)
  const out: VisionAsk[] = []
  let last = ''
  for (let at = 0; at < count; at += 1) {
    let square = ALL_SQUARES[Math.floor(random() * ALL_SQUARES.length) % ALL_SQUARES.length]
    if (square === last) {
      // One step along the list rather than another roll, so the sequence stays a function of the seed alone.
      square = ALL_SQUARES[(ALL_SQUARES.indexOf(square) + 1) % ALL_SQUARES.length]
    }
    out.push({ at, square })
    last = square
  }
  return out
}

/**
 * A new round.
 *
 * `fen` is only looked at when the setup asked for pieces, and then it has to be a position that can be played
 * from -- the same guard the gym uses. A position that cannot is left out and said, rather than drawn.
 */
export function newRound(setup: VisionSetup, o: { seed: number; now: number; fen?: string | null }): VisionRound {
  const tidy = tidySetup(setup)
  let fen: string | null = null
  let piecesNote: string | null = null
  if (tidy.pieces) {
    const offered = o.fen ?? null
    if (offered === null) {
      piecesNote = 'There is no position to put on the board, so the squares are empty. The drill is the same either way.'
    } else {
      const guard = canPlayFrom(offered)
      if (guard.ok) fen = offered
      else piecesNote = `The position offered for the board was not used: ${guard.says ?? 'it cannot be played from.'} The squares are empty instead.`
    }
  }
  return {
    setup: tidy,
    seed: Math.trunc(o.seed),
    startedAt: o.now,
    asks: visionAsks(Math.trunc(o.seed), Math.max(8, tidy.seconds * ASKS_PER_SECOND)),
    answers: [],
    fen,
    piecesNote,
    stoppedAt: null
  }
}

/** The question on screen, or null when the round is over or has run out of questions. */
export function askNow(round: VisionRound): VisionAsk | null {
  if (round.stoppedAt !== null) return null
  return round.asks[round.answers.length] ?? null
}

/** How long the round has left, never below zero. */
export function msLeft(round: VisionRound, now: number): number {
  if (round.stoppedAt !== null) return 0
  const ends = round.startedAt + round.setup.seconds * 1000
  return Math.max(0, ends - now)
}

export function roundOver(round: VisionRound, now: number): boolean {
  return round.stoppedAt !== null || msLeft(round, now) <= 0 || round.answers.length >= round.asks.length
}

/** The round, stopped. What has been answered stays answered; the clock stops where it is. */
export function stop(round: VisionRound, now: number): VisionRound {
  if (round.stoppedAt !== null) return round
  return { ...round, stoppedAt: now }
}

export interface VisionMark {
  right: boolean
  /** The square that was asked about. */
  asked: string
  given: string
  says: string
}

export interface Answered {
  round: VisionRound
  /** Null when nothing was recorded, in which case `says` has the reason. */
  mark: VisionMark | null
  says: string
}

/**
 * One answer.
 *
 * Nothing is recorded after the time is up. A round whose last answer landed two seconds late would be a round
 * with more time than it said it had, and the figure that comes out of it would be a figure for a different drill.
 */
export function answer(round: VisionRound, given: string, now: number): Answered {
  if (round.stoppedAt !== null) {
    return { round, mark: null, says: 'That round has already been stopped.' }
  }
  if (msLeft(round, now) <= 0) {
    return { round: stop(round, round.startedAt + round.setup.seconds * 1000), mark: null, says: 'The time was up, so that one was not counted.' }
  }
  const ask = askNow(round)
  if (!ask) {
    return { round, mark: null, says: 'There is nothing being asked just now.' }
  }
  const read = readSquareName(given)
  const right = read !== null && read === ask.square
  const askedAt = round.answers.length === 0
    ? round.startedAt
    : round.startedAt + round.answers.reduce((total, one) => total + one.ms, 0)
  const mark: VisionMark = {
    right,
    asked: ask.square,
    given: given.trim(),
    says: right
      ? `${ask.square}. Right.`
      : read === null
        ? `That was ${ask.square}. "${given.trim()}" is not a square on a chessboard.`
        : `That was ${ask.square}, not ${read}.`
  }
  const next: VisionRound = {
    ...round,
    answers: [...round.answers, { at: ask.at, square: ask.square, given: given.trim(), right, ms: Math.max(0, now - askedAt) }]
  }
  return { round: next, mark, says: mark.says }
}

// ---------------------------------------------------------------- what the round came to

export interface VisionScore {
  right: number
  wrong: number
  asked: number
  /** How much of the round really went by. */
  ms: number
  /** Right answers a minute, or null when too little happened for that to mean anything. */
  perMinute: number | null
  /** The average time to a right answer, or null when there were none. */
  msPerRight: number | null
  /** The longest run of right answers. */
  bestRun: number
  /** Whether this round says anything about finding squares unaided. */
  scored: boolean
  /** True only when the stated pass mark was met. */
  passed: boolean
  /** The whole thing in sentences, including what it does not establish. */
  says: readonly string[]
}

/**
 * What the round came to, said no more strongly than it can be.
 *
 * `perMinute` is the figure people care about and it is the one most easily made up. It is null below the floor,
 * and the floor is in `RATE_FLOOR` rather than buried here. `scored` carries the other refusal: a round with the
 * labels on the board had the answers on the screen.
 */
export function visionScore(round: VisionRound, now: number): VisionScore {
  const right = round.answers.filter((one) => one.right).length
  const wrong = round.answers.length - right
  const ended = round.stoppedAt ?? Math.min(now, round.startedAt + round.setup.seconds * 1000)
  const ms = Math.max(0, ended - round.startedAt)
  const enough = ms >= RATE_FLOOR.ms && round.answers.length >= RATE_FLOOR.answers
  const scored = !round.setup.coordinates
  const passed = scored && right >= VISION_PASS.least && wrong === 0

  let run = 0
  let bestRun = 0
  for (const one of round.answers) {
    run = one.right ? run + 1 : 0
    if (run > bestRun) bestRun = run
  }

  const rightOnes = round.answers.filter((one) => one.right)
  const says: string[] = []
  says.push(
    round.answers.length === 0
      ? 'Nothing was answered, so there is nothing to report.'
      : `${right} right and ${wrong} missed, out of ${round.answers.length} asked.`
  )
  if (!scored) {
    says.push(
      'The file and rank labels were on the edge of the board, so the answer was on the screen. This round is practice and is not counted as finding squares unaided.'
    )
  }
  if (!enough && round.answers.length > 0) {
    says.push(
      `There is no figure for squares a minute: that needs at least ${RATE_FLOOR.answers} answers over at least ${Math.round(RATE_FLOOR.ms / 1000)} seconds, and this round had ${round.answers.length} over ${Math.round(ms / 1000)}.`
    )
  }
  if (round.stoppedAt !== null && msLeft({ ...round, stoppedAt: null }, round.stoppedAt) > 0) {
    says.push('The round was stopped before its time was up. The figures are for the part that was played.')
  }
  if (round.setup.from === 'b') {
    says.push('The board was the way round Black sees it, which is the harder half of this.')
  }
  if (round.fen !== null) {
    says.push('There were pieces on the board. Finding a square with pieces in the way is not the same job as finding it on an empty one.')
  }
  says.push('Nothing here is a rating. It is a count of squares found in one sitting on this computer.')

  return {
    right,
    wrong,
    asked: round.answers.length,
    ms,
    perMinute: enough ? Math.round((right / ms) * 60000 * 10) / 10 : null,
    msPerRight: rightOnes.length ? Math.round(rightOnes.reduce((total, one) => total + one.ms, 0) / rightOnes.length) : null,
    bestRun,
    scored,
    passed,
    says
  }
}

/** The sentence a screen puts under a finished round. One line, for the places a list of them will not fit. */
export function scoreLine(score: VisionScore): string {
  if (score.asked === 0) return 'Nothing answered.'
  const rate = score.perMinute === null ? '' : `, ${score.perMinute} a minute`
  return `${score.right} right, ${score.wrong} missed${rate}${score.scored ? '' : ' (not counted: the labels were on)'}`
}

// ---------------------------------------------------------------- what may be on screen

export interface VisionRules {
  /**
   * The position to draw behind the squares, or null when no piece may be in the document.
   *
   * The screen draws a piece only when this is a string. There is no other route from a position to the markup,
   * which is what makes "no pieces" mean no pieces rather than pieces hidden in the four places somebody thought
   * of -- a board hidden with CSS is still in the accessibility tree, in a tooltip and in a screenshot.
   */
  boardFen: string | null
  /** Why there are no pieces. Never contains anything about a position. */
  because: string | null
  /** The label for the board. Checked by the tests for piece names and for squares. */
  label: string
  /** Whether this round counts as finding squares unaided. */
  scored: boolean
  /** Whether the file and rank labels may be drawn on the edge. */
  coordinates: boolean
}

/**
 * Whether a position may be on screen in Vision.
 *
 * It is not decided here. `viewRules` in `trainingView.ts` is the one function in Chess World that decides whether
 * a position may be drawn, and this asks it the same question the blindfold screen asks: pieces on means the
 * position is there to be looked at (`studying`), pieces off means nothing may be drawn (`answering`). Only the
 * wording is Vision's, exactly as `gymView` does it for the Calculation Gym. A change to the hiding rule therefore
 * reaches this screen too, rather than reaching one screen and not the other.
 *
 * Note the one thing this is *not* about. In "find the square" the question itself names a square -- that is the
 * question, not a leak. What must not be on screen is a piece the round did not ask for, and the labels that would
 * answer the question for you, which is `coordinates` and is why a round with them on is not scored.
 */
export function visionView(input: { setup: VisionSetup; fen: string | null; phase?: Phase }): VisionRules {
  const showing = input.setup.pieces && input.fen !== null
  const asked = viewRules({
    level: 'locate',
    phase: input.phase ?? (showing ? 'studying' : 'answering'),
    mode: 'strict',
    fen: input.fen ?? START_FEN
  })
  if (showing && asked.boardFen !== null) {
    return {
      boardFen: asked.boardFen,
      because: null,
      label: 'The board, with a position on it',
      scored: !input.setup.coordinates,
      coordinates: input.setup.coordinates
    }
  }
  return {
    boardFen: null,
    because: input.setup.pieces
      ? 'There are no pieces on this board. The squares are what the drill is about.'
      : 'There are no pieces on this board. That is the drill: the squares on their own.',
    label: 'The board, with no pieces on it',
    scored: !input.setup.coordinates,
    coordinates: input.setup.coordinates
  }
}

/** The position written out, for a screen that has one and wants to say what is on it. Empty when there is none. */
export function piecesOnBoard(fen: string | null): string {
  if (fen === null) return ''
  const pieces = boardSquares(fen)
  if (pieces.length === 0) return ''
  const state = outcome(fen)
  const check = state.over ? state.reason === 'checkmate' : state.check
  return `${pieces.length} pieces, ${sideToMove(fen) === 'w' ? 'White' : 'Black'} to move${check ? ', in check' : ''}.`
}

// ---------------------------------------------------------------- the record

/** The item a Vision round is filed under: one record per direction, per point of view. */
export function visionItem(setup: VisionSetup): string {
  const tidy = tidySetup(setup)
  return `${tidy.direction}:${tidy.from}`
}

export interface VisionItemRead {
  direction: VisionDirection
  from: Side
}

export function readVisionItem(item: string): VisionItemRead | null {
  const parts = item.split(':')
  if (parts.length !== 2) return null
  const direction = parts[0] === 'find-the-square' || parts[0] === 'name-the-square' ? parts[0] : null
  const from = parts[1] === 'w' || parts[1] === 'b' ? parts[1] : null
  if (!direction || !from) return null
  return { direction, from }
}

/** The one line a record of a round reads as. Used for the verdict kept with the attempt. */
export function visionVerdict(round: VisionRound, score: VisionScore): string {
  const note = directionNote(round.setup.direction)
  const side = round.setup.from === 'w' ? 'from White' : 'from Black'
  return `${note.title}, ${side}: ${scoreLine(score)}.`
}

export interface VisionBest {
  /** The best round that counted, or null when none has. */
  best: { right: number; perMinute: number | null; at: number } | null
  /** Rounds that were played but not counted, so a screen can say why its best is empty. */
  notCounted: number
  says: string
}

/**
 * The best round so far, out of the rounds that counted.
 *
 * Rounds with the labels on are kept and are not candidates, and the count of them is here so a screen with
 * twenty rounds played and no best can say which it is: nothing recorded, or nothing that counted.
 */
export function visionBest(
  attempts: readonly { at: number; strict: boolean; right?: number; outOf?: number; ms?: number }[]
): VisionBest {
  const counted = attempts.filter((one) => one.strict)
  let best: { right: number; perMinute: number | null; at: number } | null = null
  for (const one of counted) {
    const right = one.right ?? 0
    const perMinute =
      one.ms !== undefined && one.ms >= RATE_FLOOR.ms && (one.outOf ?? 0) >= RATE_FLOOR.answers
        ? Math.round((right / one.ms) * 60000 * 10) / 10
        : null
    if (!best || right > best.right) best = { right, perMinute, at: one.at }
  }
  const notCounted = attempts.length - counted.length
  return {
    best,
    notCounted,
    says: best
      ? `Best so far: ${best.right} squares${best.perMinute === null ? '' : `, ${best.perMinute} a minute`}.`
      : attempts.length === 0
        ? 'No rounds recorded yet.'
        : `${notCounted} ${notCounted === 1 ? 'round' : 'rounds'} recorded, and none of them counted: the labels were on the board.`
  }
}
