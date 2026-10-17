import {
  applyMove, boardSquares, destinationsFrom, legalMoves, moveNumber, outcome, sideToMove, START_FEN,
  type ChessMove, type PieceLetter
} from './rules.ts'
import type { Side } from './evaluation.ts'
import {
  newExercise, playablePosition, verifyExercise, HINT_WORTH,
  type Exercise, type ExerciseHint, type MoveNode
} from './exercise.ts'
import { compareLine, enterLine, interleave, readMove, splitLine, type Comparison, type LineEntry, type ReadResult } from './calculation.ts'
import {
  markAnswer, questionsFor, scoreRecall, trackPieces, trackingAgrees,
  type BlindQuestion, type Marked, type Placement, type RecallScore, type Tracking
} from './blindfold.ts'
import { CHESS_CURRICULUM } from './curriculum.ts'
import { allTasks } from './lessons.ts'

/**
 * What the Calculation Gym and the Blindfold screens need to know, with no React in it (Sections 211-230).
 *
 * The thinking is all in `calculation.ts`, `blindfold.ts`, `exercise.ts` and `rules.ts`; this file is the part that
 * stands between those and a screen, and it exists for three reasons.
 *
 * ## 1. Hiding the board is a rule, not a style
 *
 * A blindfold trainer that draws the board and hides it with CSS has not hidden it. The position is then in the
 * document, in the accessibility tree, in a tooltip, in a screenshot of the window, and in the move list down the
 * side. So the decision "may the position be on screen right now" is one function -- `viewRules` -- and the screen
 * draws a board only when it hands one back. Nothing else in the screen is allowed an opinion about it, which is
 * what makes the rule testable: `trainingView.test.ts` walks every level, phase and mode and checks that while the
 * board is meant to be hidden, nothing coming out of here names a square, a piece or a position.
 *
 * ## 2. An exercise is only as good as its check
 *
 * The mate positions in `GYM_CATALOGUE` carry a solution tree, and not one of those trees was written by hand: each
 * is the output of `forcedMateTree`, an exhaustive search over the real rules, so every defence is in it by
 * construction. The test runs the same search again from the position and refuses the file if the stored tree is not
 * what comes back -- and it checks that no shorter mate exists, because a "mate in two" that is really a mate in one
 * teaches somebody to calculate a move they did not need.
 *
 * Everything else the gym offers comes from the Academy's own verified tasks. Nothing in here invents a rating, a
 * success rate or an engine's opinion; where something is not known, the report says so in words.
 *
 * ## 3. What an attempt proves is not a score
 *
 * `calculationReport` answers a different question from "how many did you get right": what did this attempt
 * *establish*. A line that matches the recorded answer with the pieces moved about on the board first establishes
 * that the person can find the line with a board; it says nothing about holding it in their head, and the report
 * says that out loud. Hints, supplied defences and non-strict mode each take something away from the claim, and each
 * is named rather than folded into a number.
 *
 * Pure: no clock of its own (`now` is passed in), no storage (the store is read and written as text by the screen),
 * no network, no React.
 */

// ---------------------------------------------------------------- a position nothing can be played from

export interface PlayCheck {
  ok: boolean
  says?: string
}

/**
 * Whether a position may be handed to the move generator at all.
 *
 * `playablePosition` is the right question and has one hole: it asks `outcome` whether the side not to move is in
 * check, and `outcome` answers "the game is over, insufficient material" first for a position like king and two
 * same-coloured bishops against a bare king. `playablePosition` then reads `over` and reports no check, the position
 * is accepted, and the move generator offers the capture of the black king -- at which point reading the position
 * after that move throws, because a board with one king is not a board.
 *
 * That is not this module's bug to fix (`exercise.ts` belongs to the training engine), so this guard sits in front
 * of it: the rules refuse such a position loudly, and a refusal is a far better answer than a crash. Everything in
 * this file that is handed a position from outside asks here first.
 */
export function canPlayFrom(fen: string): PlayCheck {
  const basic = playablePosition(fen)
  if (!basic.ok) return { ok: false, says: basic.reason ?? 'This position cannot be played from.' }
  try {
    // A king capture on the list means the other side was left in check, which no game can reach.
    const moves = legalMoves(fen)
    if (moves.some((move) => move.captured === 'k')) {
      return { ok: false, says: 'This position cannot be reached in a game: the side not to move is in check.' }
    }
    if (moves.length === 0) {
      const state = outcome(fen)
      return { ok: false, says: state.over ? `This position is already finished (${state.reason}).` : 'There are no moves in this position.' }
    }
  } catch {
    return { ok: false, says: 'This position cannot be reached in a game: the side not to move is in check.' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------- the gym's own mate positions

export interface GymEntry {
  id: string
  fen: string
  /** The solver's own moves to mate. */
  mateIn: number
  /** How many pieces are on the board, so a screen can offer the small ones first. */
  pieces: number
  /**
   * The complete forced-mate tree in coordinates, exactly as `forcedMateTree` produced it.
   *
   * Stored rather than searched at run time because the search costs a tenth of a second per position and a screen
   * that opens fourteen of them would stall. The test does the search again, so a stored tree that is not the real
   * one fails the suite rather than reaching anybody.
   */
  lines: readonly MoveNode[]
}

export const GYM_CATALOGUE: readonly GymEntry[] = Object.freeze([
  {
    id: 'gym-pawn-promote',
    fen: 'k7/3P4/P1K5/8/8/8/8/8 w - - 0 1',
    mateIn: 2,
    pieces: 4,
    lines: [
      {
        move: 'c6b6',
        children: [
          {
            move: 'a8b8',
            children: [
              { move: 'd7d8r' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'gym-queen-and-rook',
    fen: '8/3k4/2R5/8/4Q3/8/3K4/8 w - - 0 1',
    mateIn: 2,
    pieces: 4,
    lines: [
      {
        move: 'e4e6',
        children: [
          {
            move: 'd7d8',
            children: [
              { move: 'c6c8' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'gym-queen-and-bishop',
    fen: '5BK1/8/6k1/3Q4/8/8/8/8 w - - 0 1',
    mateIn: 2,
    pieces: 4,
    lines: [
      {
        move: 'f8e7',
        children: [
          {
            move: 'g6h6',
            children: [
              { move: 'd5g5' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'gym-bishop-and-pawn',
    fen: '6k1/1P6/5K2/8/8/8/8/3B4 w - - 0 1',
    mateIn: 2,
    pieces: 4,
    lines: [
      {
        move: 'd1c2',
        children: [
          {
            move: 'g8h8',
            children: [
              { move: 'b7b8r' }
            ]
          },
          {
            move: 'g8f8',
            children: [
              { move: 'b7b8r' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'gym-three-small-pieces',
    fen: '8/8/4K3/8/8/1N3R2/8/1B2k3 w - - 0 1',
    mateIn: 2,
    pieces: 5,
    lines: [
      {
        move: 'b1d3',
        children: [
          {
            move: 'e1d1',
            children: [
              { move: 'f3f1' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'gym-take-the-rook',
    fen: '8/8/3Q4/8/8/2r2K1k/1B6/8 w - - 0 1',
    mateIn: 2,
    pieces: 5,
    lines: [
      {
        move: 'b2c3',
        children: [
          {
            move: 'h3h4',
            children: [
              { move: 'd6h6' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'gym-queen-bishop-rook',
    fen: '6k1/8/8/Q7/8/6B1/R3K3/8 w - - 0 1',
    mateIn: 2,
    pieces: 5,
    lines: [
      {
        move: 'a5c7',
        children: [
          {
            move: 'g8h8',
            children: [
              { move: 'a2a8' }
            ]
          },
          {
            move: 'g8f8',
            children: [
              { move: 'a2a8' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'gym-two-rooks-bishop',
    fen: 'B7/8/5R2/pR6/k7/8/8/1K6 w - - 0 1',
    mateIn: 2,
    pieces: 6,
    lines: [
      {
        move: 'f6b6',
        children: [
          {
            move: 'a4a3',
            children: [
              { move: 'b5a5' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'gym-black-has-pieces',
    fen: '8/6p1/8/4n1N1/1k6/8/2R5/K2Q4 w - - 0 1',
    mateIn: 2,
    pieces: 7,
    lines: [
      {
        move: 'd1b1',
        children: [
          {
            move: 'b4a5',
            children: [
              { move: 'c2a2' }
            ]
          },
          {
            move: 'b4a3',
            children: [
              { move: 'c2a2' }
            ]
          },
          {
            move: 'b4a4',
            children: [
              { move: 'c2a2' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'gym-quiet-mate-in-three',
    fen: '8/p7/8/BP6/Q7/3k4/5p2/6K1 w - - 0 1',
    mateIn: 3,
    pieces: 7,
    lines: [
      {
        move: 'g1f2',
        children: [
          {
            move: 'a7a6',
            children: [
              {
                move: 'f2f3',
                children: [
                  {
                    move: 'a6b5',
                    children: [
                      { move: 'a4e4' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
])

/** The ids whose first moves are the complete set, because a search produced them. Nothing else may claim that. */
export const EXHAUSTIVE_ROOT_IDS: readonly string[] = Object.freeze(GYM_CATALOGUE.map((entry) => entry.id))

const WORD_NUMBER: readonly string[] = Object.freeze(['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'])

/** "two" for 2, and the digits past eight, because "in thirteen moves" reads worse than "in 13". */
export function sayCount(n: number): string {
  return n >= 0 && n < WORD_NUMBER.length ? WORD_NUMBER[n] : String(n)
}

const PIECE_WORD: Readonly<Record<PieceLetter, string>> = Object.freeze({
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
})

const SIDE_WORD: Readonly<Record<Side, string>> = Object.freeze({ w: 'White', b: 'Black' })

/**
 * Hints worked out from the solution, in the order the ladder goes.
 *
 * Authored hints would be four more things to get wrong, and these are facts about the tree: whether the first move
 * is a check, a capture or neither; which piece makes it; where it goes; and finally the move. Only offered where
 * there is a single first move, because "the knight moves" is a lie when there are two answers.
 */
function hintsFor(fen: string, lines: readonly MoveNode[], mateIn: number): ExerciseHint[] {
  if (lines.length !== 1) return []
  const first = applyMove(fen, lines[0].move)
  if (!first) return []
  const shape = first.check
    ? 'The first move is a check.'
    : first.captured
      ? 'The first move takes something.'
      : 'The first move is neither a check nor a capture. It is quiet, and it takes every square the king has.'
  return [
    { level: 1, text: `Mate in ${sayCount(mateIn)}. ${shape}`, shows: 'theme' },
    { level: 2, text: `It is the ${PIECE_WORD[first.piece]} on ${first.from} that moves.`, shows: 'piece' },
    { level: 3, text: `It goes to ${first.to}.`, shows: 'square' },
    { level: 4, text: first.san, shows: 'move' }
  ]
}

/** What the position holds, as tags a scheduler can group by. Read off the board; never a pattern name. */
function tagsFor(fen: string, mateIn: number): string[] {
  const pieces = boardSquares(fen)
  const mine = sideToMove(fen)
  const white = [...new Set(pieces.filter((p) => p.color === mine && p.type !== 'k').map((p) => PIECE_WORD[p.type]))].sort()
  const theyHave = pieces.some((p) => p.color !== mine && p.type !== 'k')
  return [
    'calculation',
    `mate-in-${mateIn}`,
    ...white.map((word) => `with-${word}`),
    theyHave ? 'they-have-pieces' : 'bare-king'
  ]
}

/**
 * Every mate, where the search kept only one.
 *
 * `forcedMateTree` keeps alternatives at the root and one answer per defence below it, which is the right thing for
 * a search and the wrong thing for marking: in `k7/3P4/P1K5/8/8/8/8/8` the search answers 1.Kb6 Kb8 with 2.d8=R#,
 * and a solver who writes 2.d8=Q# -- which is also mate -- would be told their line parted from the answer. It
 * would be the exercise that was wrong.
 *
 * So wherever the tree has a solver move that ends the line, every move that gives mate in that position is added
 * beside it. Nothing is invented: a move is added only when the rules say it is checkmate, and the test checks both
 * directions -- every accepted finish is a mate, and every mate is accepted.
 */
function withEveryMate(fen: string, nodes: readonly MoveNode[], depth: number): MoveNode[] {
  const solverTurn = depth % 2 === 0
  const out: MoveNode[] = []
  const have = new Set<string>()
  for (const node of nodes) {
    const made = applyMove(fen, node.move)
    if (!made) { out.push(cloneNode(node)); continue }
    have.add(made.uci)
    const kids = node.children ?? []
    out.push({
      ...cloneNode(node),
      ...(kids.length ? { children: withEveryMate(made.after, kids, depth + 1) } : {})
    })
  }
  if (!solverTurn) return out
  const endsHere = nodes.some((node) => (node.children ?? []).length === 0)
  if (!endsHere) return out
  for (const move of legalMoves(fen)) {
    if (!move.checkmate || have.has(move.uci)) continue
    out.push({ move: move.uci })
  }
  return out
}

/** One catalogue entry as an exercise, with its verification worked out rather than claimed. */
export function gymExercise(entry: GymEntry): { exercise: Exercise; ok: boolean; problems: readonly string[] } {
  const draft = newExercise({
    id: entry.id,
    kind: 'calculation',
    startFen: entry.fen,
    objective: 'mate-in-n',
    movesToMate: entry.mateIn,
    prompt: `${SIDE_WORD[sideToMove(entry.fen)]} to move. Force mate in ${sayCount(entry.mateIn)}.`,
    solution: { lines: withEveryMate(entry.fen, entry.lines, 0) },
    hints: hintsFor(entry.fen, entry.lines, entry.mateIn),
    source: {
      kind: 'generated',
      by: 'forcedMateTree',
      note: 'Position composed in Orbis; the solution is the complete output of an exhaustive search over the rules.'
    },
    tags: tagsFor(entry.fen, entry.mateIn)
  })
  const { exercise, check } = verifyExercise(draft)
  return { exercise, ok: check.verification.status === 'verified', problems: check.problems.map((one) => one.says) }
}

function cloneNode(node: MoveNode): MoveNode {
  return { move: node.move, ...(node.why ? { why: node.why } : {}), ...(node.children ? { children: node.children.map(cloneNode) } : {}) }
}

export interface GymPool {
  exercises: readonly Exercise[]
  /** Exercises that did not pass the check and are therefore not offered, with the reason. */
  refused: readonly { id: string; says: string }[]
  /** Where they came from, for a screen that has to be able to say. */
  says: string
}

let poolCache: GymPool | null = null

/**
 * Every exercise the gym may offer.
 *
 * Two sources, both checked here: the catalogue above, and the Academy's own tasks that are worth calculating --
 * a mate in two or more, or a task the curriculum itself calls calculation. A one-move task is not calculation and
 * is left to the puzzle trainer. Nothing that fails `verifyExercise` is offered, and what was refused is kept so
 * the screen can say how many and why rather than quietly showing fewer.
 */
export function gymPool(): GymPool {
  if (poolCache) return poolCache
  const exercises: Exercise[] = []
  const refused: { id: string; says: string }[] = []

  for (const entry of GYM_CATALOGUE) {
    const guard = canPlayFrom(entry.fen)
    if (!guard.ok) {
      refused.push({ id: entry.id, says: guard.says ?? 'The position cannot be played from.' })
      continue
    }
    const built = gymExercise(entry)
    if (built.ok) exercises.push(built.exercise)
    else refused.push({ id: entry.id, says: built.problems[0] ?? 'It did not pass the check.' })
  }

  for (const task of academyCalculationTasks()) {
    const guard = canPlayFrom(task.startFen)
    if (!guard.ok) {
      refused.push({ id: task.id, says: guard.says ?? 'The position cannot be played from.' })
      continue
    }
    const { exercise, check } = verifyExercise(task)
    if (check.verification.status === 'verified') exercises.push(exercise)
    else refused.push({ id: task.id, says: check.problems[0]?.says ?? 'It did not pass the check.' })
  }

  poolCache = {
    exercises,
    refused,
    says: `${exercises.length} positions: ${GYM_CATALOGUE.length} composed here with the mate found by search, and the Academy's own calculation tasks. Every one is re-checked against the rules when this screen opens.`
  }
  return poolCache
}

/** The curriculum's tasks that are worth calculating a line for. Read-only: the curriculum is somebody else's file. */
function academyCalculationTasks(): Exercise[] {
  return allTasks(CHESS_CURRICULUM).filter((task) =>
    task.kind === 'calculation' || (task.objective === 'mate-in-n' && (task.movesToMate ?? 0) >= 2)
  )
}

/** For the tests, and for a screen that reloads its pool after a change. */
export function forgetPool(): void {
  poolCache = null
}

export function rootsAreComplete(exerciseId: string): boolean {
  return EXHAUSTIVE_ROOT_IDS.includes(exerciseId)
}

// ---------------------------------------------------------------- candidate moves

export type Forcing = 'check' | 'capture' | 'quiet'

export interface Candidate {
  uci: string
  /** Standard notation for this position, mate mark and all. Used to play and to compare, never shown. */
  san: string
  /**
   * The notation to put on screen: the same move with a mate written as a check.
   *
   * A mate is a check, so "Qh7+" is true of "Qh7#" -- and it does not tell somebody which of thirty moves is the
   * one that ends it. A candidate list is the step *before* calculating, and a hash in it is the answer.
   */
  shown: string
  from: string
  to: string
  piece: PieceLetter
  forcing: Forcing
  /** What it takes, when it takes something. */
  takes?: PieceLetter
  /** For a list that reads like a person's: "the rook on f3 to f1". */
  says: string
}

export const FORCING_LABEL: Readonly<Record<Forcing, string>> = Object.freeze({
  check: 'Checks',
  capture: 'Captures',
  quiet: 'Everything else'
})

/**
 * The moves in a position, as the things a person chooses between before calculating.
 *
 * Grouped checks, captures, then the rest, because that is the order calculation is taught in: the forcing moves
 * are the ones whose consequences can be worked out at all. Within a group they are in notation order and nothing
 * else -- in particular **a mate is not sorted first and is not marked**, which it would be if this passed on
 * `checkmate` from the rules. That would hand over the answer to every mate in one in the list.
 */
export function candidateMoves(fen: string): Candidate[] {
  const guard = canPlayFrom(fen)
  if (!guard.ok) return []
  const out = legalMoves(fen).map((move) => describeCandidate(move))
  const rank: Readonly<Record<Forcing, number>> = { check: 0, capture: 1, quiet: 2 }
  return out.sort((a, b) => rank[a.forcing] - rank[b.forcing] || a.san.localeCompare(b.san))
}

function describeCandidate(move: ChessMove): Candidate {
  const forcing: Forcing = move.check ? 'check' : move.captured ? 'capture' : 'quiet'
  const says = move.captured
    ? `${PIECE_WORD[move.piece]} on ${move.from} takes the ${PIECE_WORD[move.captured]} on ${move.to}`
    : `${PIECE_WORD[move.piece]} on ${move.from} to ${move.to}`
  return {
    uci: move.uci,
    san: move.san,
    shown: move.san.replace(/#$/, '+'),
    from: move.from,
    to: move.to,
    piece: move.piece,
    forcing,
    ...(move.captured ? { takes: move.captured } : {}),
    says
  }
}

export function groupCandidates(fen: string): { forcing: Forcing; label: string; moves: Candidate[] }[] {
  const all = candidateMoves(fen)
  const groups: Forcing[] = ['check', 'capture', 'quiet']
  return groups
    .map((forcing) => ({ forcing, label: FORCING_LABEL[forcing], moves: all.filter((one) => one.forcing === forcing) }))
    .filter((group) => group.moves.length > 0)
}

export type CandidateStanding = 'an-answer' | 'not-recorded' | 'refuted'

export interface CandidateVerdict {
  uci: string
  san: string
  standing: CandidateStanding
  says: string
}

/**
 * What the chosen candidates turned out to be worth, said no more strongly than it can be.
 *
 * "Not an answer" is a claim about every line there is, and only an exhaustive search can make it. Where the
 * exercise's first moves came out of such a search the verdict is `refuted` and says so; where they were written
 * down by an author it is `not-recorded`, which is a fact about the exercise and not about the move.
 */
export function reviewCandidates(exercise: Exercise, chosen: readonly string[]): CandidateVerdict[] {
  const complete = rootsAreComplete(exercise.id)
  const roots = new Set<string>()
  for (const line of exercise.solution.lines) {
    const made = applyMove(exercise.startFen, line.move)
    if (made) roots.add(made.uci)
  }
  const out: CandidateVerdict[] = []
  for (const text of chosen) {
    const made = applyMove(exercise.startFen, text)
    if (!made) continue
    if (roots.has(made.uci)) {
      out.push({ uci: made.uci, san: made.san, standing: 'an-answer', says: `${made.san} is one of the exercise's answers.` })
      continue
    }
    out.push(
      complete
        ? {
            uci: made.uci,
            san: made.san,
            standing: 'refuted',
            says: `${made.san} does not force the mate. The answers here came out of a search over every move, so that is settled.`
          }
        : {
            uci: made.uci,
            san: made.san,
            standing: 'not-recorded',
            says: `${made.san} is not one of the recorded answers. Whether it works anyway was not checked, so this says nothing more than that.`
          }
    )
  }
  return out
}

// ---------------------------------------------------------------- entering a line, move by move

export interface LineDraft {
  startFen: string
  /** What was typed, in order, as typed. */
  texts: readonly string[]
}

export function newDraft(startFen: string): LineDraft {
  return { startFen, texts: [] }
}

/** The position the next move will be read against. Always the position the line has actually reached. */
export function draftFen(draft: LineDraft): string {
  const walk = enterLine(draft.startFen, draft.texts)
  return walk.fens.length ? walk.fens[walk.fens.length - 1] : draft.startFen
}

export interface Appended {
  draft: LineDraft
  read: ReadResult
  /** False when nothing was added, in which case `read` says why. */
  added: boolean
}

/**
 * One more move on the end of the line, read against the position the line has reached.
 *
 * The move is not kept unless it can be played. A gym that accepted a move it could not play would be asking the
 * person to calculate from a position that does not exist, and every move after it would be judged against an
 * imaginary board.
 */
export function appendMove(draft: LineDraft, text: string): Appended {
  const here = draftFen(draft)
  const guard = canPlayFrom(here)
  if (!guard.ok) {
    return {
      draft,
      added: false,
      read: { ok: false, fault: 'chess', code: 'no-such-move', says: guard.says ?? 'The line cannot go on from here.' }
    }
  }
  const read = readMove(here, text)
  if (!read.ok) return { draft, added: false, read }
  return { draft: { ...draft, texts: [...draft.texts, text.trim()] }, added: true, read }
}

/** The last move off the end. Used by the undo button, and by nothing else. */
export function dropLast(draft: LineDraft): LineDraft {
  return { ...draft, texts: draft.texts.slice(0, -1) }
}

/** A whole line pasted or typed at once, split the way people write them. */
export function draftFromText(startFen: string, text: string): LineDraft {
  return { startFen, texts: splitLine(text) }
}

export interface LineRow {
  number: number
  white: { ply: number; san: string; wrote: string; tidied: boolean } | null
  black: { ply: number; san: string; wrote: string; tidied: boolean } | null
}

/**
 * The line laid out the way a line is written: a number, White's move, Black's.
 *
 * The number comes from the position, not from counting from one -- an exercise that starts at move 34 with Black to
 * move is written "34...Kg7 35.Rd8", and a gym that wrote "1...Kg7" would be teaching a habit that makes notation
 * useless for finding the position again.
 */
export function lineRows(entry: LineEntry): { rows: LineRow[]; firstNumber: number; blackFirst: boolean } {
  const firstNumber = moveNumber(entry.startFen)
  const blackFirst = sideToMove(entry.startFen) === 'b'
  const tidied = new Map(entry.tidied.map((one) => [one.at, one]))
  const rows: LineRow[] = []
  for (const [at, move] of entry.moves.entries()) {
    const offset = blackFirst ? at + 1 : at
    const number = firstNumber + Math.floor(offset / 2)
    const isWhite = offset % 2 === 0
    const cell = { ply: at, san: move.san, wrote: entry.wrote[at] ?? move.san, tidied: tidied.has(at) }
    const last = rows[rows.length - 1]
    if (isWhite || !last || last.black !== null || last.number !== number) {
      rows.push({ number, white: isWhite ? cell : null, black: isWhite ? null : cell })
    } else {
      last.black = cell
    }
  }
  return { rows, firstNumber, blackFirst }
}

/** The line as one string, for copying out or for showing it back. */
export function lineText(entry: LineEntry): string {
  return writeLine(entry.startFen, entry.moves.map((move) => move.san))
}

// ---------------------------------------------------------------- submitting a line

export type ReplySource =
  /** The person writes both sides, which is what calculating a line is. */
  | 'both-sides'
  /** Orbis plays the exercise's own defence after each of the person's moves. */
  | 'from-the-exercise'

export interface GymSubmission {
  comparison: Comparison
  /** The line that was actually compared -- with replies supplied, that is not what was typed. */
  compared: readonly string[]
  /** Where `from-the-exercise` stopped supplying, because the person's move left the recorded answers. */
  stoppedSupplyingAt: number | null
}

/**
 * The line as submitted, compared with the exercise.
 *
 * With `from-the-exercise` the replies come out of the recorded defences, deterministically, so what is compared is
 * a real line rather than a guess at one. It is easier than writing both sides -- it tells the person which defence
 * the exercise expects -- and the report says so, because an easier exercise that is reported as the harder one is
 * a lie about what somebody can do.
 */
export function submitLine(exercise: Exercise, draft: LineDraft, replies: ReplySource): GymSubmission {
  if (replies === 'both-sides') {
    return { comparison: compareLine(exercise, draft.texts), compared: [...draft.texts], stoppedSupplyingAt: null }
  }
  const filled = interleave(exercise, draft.texts)
  return {
    comparison: compareLine(exercise, filled.line),
    compared: filled.line,
    stoppedSupplyingAt: filled.stoppedAt
  }
}

/**
 * The line as it will be compared, for showing it back.
 *
 * With `both-sides` that is the draft itself. With `from-the-exercise` it is not: the draft holds only the solver's
 * own moves, and the line being checked is that with Orbis's replies in it. Showing only the solver's moves would
 * be showing a line nobody submitted -- and it would not even be playable, because White's second move cannot be
 * played in a position where it is Black's turn.
 */
export function shownLine(exercise: Exercise, draft: LineDraft, replies: ReplySource): LineEntry {
  if (replies === 'both-sides') return enterLine(draft.startFen, draft.texts)
  return enterLine(exercise.startFen, interleave(exercise, draft.texts).line)
}

/**
 * The position the next move is written in.
 *
 * The bug this exists to stop: a box that read every move against the draft's own last position would refuse every
 * second move in `from-the-exercise` mode, because that position has the other side to move. The position the next
 * solver move is played in is the one after Orbis's reply to the last one.
 */
export function nextFen(exercise: Exercise, draft: LineDraft, replies: ReplySource): string {
  const walk = shownLine(exercise, draft, replies)
  return walk.fens.length ? walk.fens[walk.fens.length - 1] : exercise.startFen
}

/**
 * One more move on a draft, read against the position it will really be played in.
 *
 * `appendMove` is the `both-sides` case and this is both, so a screen has one function to call and no reason to
 * work out which position to use. As with `appendMove`, a move that cannot be played is **not kept**.
 */
export function appendSolverMove(exercise: Exercise, draft: LineDraft, replies: ReplySource, text: string): Appended {
  if (replies === 'both-sides') return appendMove(draft, text)
  const here = nextFen(exercise, draft, replies)
  const guard = canPlayFrom(here)
  if (!guard.ok) {
    return {
      draft,
      added: false,
      read: { ok: false, fault: 'chess', code: 'no-such-move', says: guard.says ?? 'The line cannot go on from here.' }
    }
  }
  const read = readMove(here, text)
  if (!read.ok) return { draft, added: false, read }
  return { draft: { ...draft, texts: [...draft.texts, text.trim()] }, added: true, read }
}

// ---------------------------------------------------------------- what the attempt established

export type Settled = 'yes' | 'no' | 'unknown'

export interface Established {
  settled: Settled
  says: string
}

export interface GymContext {
  /** True when the board could not be played with before the line was submitted. */
  strict: boolean
  /** True when the person did move the pieces about first. Recorded whether or not strict mode was on. */
  movedOnBoard: boolean
  hintsTaken: number
  replies: ReplySource
  /** The candidates they picked before calculating, if they used that step. */
  candidates: readonly string[]
}

export interface GymReport {
  heading: string
  /** Where the submitted line and the answer parted company, for the board. Null when they did not. */
  showFen: string | null
  showPly: number | null
  established: readonly Established[]
  candidates: readonly CandidateVerdict[]
  /** 0..1, what a solve is worth after the hints. Null when the line did not solve it. */
  worth: number | null
}

/**
 * What this attempt did and did not establish, in sentences.
 *
 * Not a mark. Every clause here is either read off the comparison, read off the exercise's own verification, or a
 * plain statement that something was not checked. The things that reduce the claim -- a hint, a supplied defence,
 * pieces moved on the board -- are each named, because one number with all of that folded into it cannot be read
 * back out later and would quietly become a rating.
 */
export function calculationReport(exercise: Exercise, submission: GymSubmission, context: GymContext): GymReport {
  const { comparison } = submission
  const established: Established[] = []
  const verified = exercise.verification.status === 'verified'
  const complete = exercise.verification.coverage === 'complete'

  const heading = comparison.verdict === 'solves'
    ? 'The line is right.'
    : comparison.verdict === 'short'
      ? 'Right as far as it goes.'
      : comparison.verdict === 'diverges'
        ? 'The line parts from the answer.'
        : 'The line could not be played.'

  if (comparison.verdict === 'unplayable') {
    const stopped = comparison.entry.stopped
    established.push({
      settled: 'no',
      says: stopped
        ? stopped.fault === 'notation'
          ? `Nothing was compared: move ${stopped.at + 1} could not be read. ${stopped.says}`
          : `Nothing was compared: move ${stopped.at + 1} cannot be played in the position it was written in. ${stopped.says}`
        : 'Nothing was compared.'
    })
  }

  if (comparison.verdict === 'solves') {
    established.push({ settled: 'yes', says: 'The whole line is one of the exercise\'s answers.' })
    if (exercise.objective === 'mate-in-n' && verified && complete) {
      established.push({
        settled: 'yes',
        says: `The mate is forced. Every legal defence is answered in the solution and the rules were asked again when this screen opened, so there is no defence left to find.`
      })
    } else if (exercise.objective === 'mate-in-n' && verified) {
      established.push({
        settled: 'unknown',
        says: 'Only the defences written into the exercise were checked. Whether every other defence is also answered is not known here.'
      })
    }
  }

  if (comparison.verdict === 'short') {
    established.push({
      settled: 'unknown',
      says: comparison.matched === 0
        ? 'Nothing was entered, so nothing was established.'
        : `The first ${sayCount(comparison.matched)} ${comparison.matched === 1 ? 'ply is' : 'plies are'} on an answering line, and the line stops before the end. Whether the rest would have been right is not known.`
    })
  }

  if (comparison.verdict === 'diverges' && comparison.divergence) {
    const d = comparison.divergence
    established.push({
      settled: 'no',
      says: d.by === 'solver'
        ? `At ply ${d.at + 1} you played ${d.played}; the exercise answers ${d.accepted.join(' or ') || 'something else'}.`
        : `At ply ${d.at + 1} you gave the other side ${d.played}, which the exercise does not record as a defence. Everything after that was calculated against a defence nobody checked.`
    })
    // "Your move may still be good" is only honest where the answers are not known to be the complete set. At the
    // first move of a catalogue exercise they are, because a search produced them; deeper in, they are not.
    if (d.by === 'solver' && !(d.at === 0 && rootsAreComplete(exercise.id))) {
      established.push({
        settled: 'unknown',
        says: 'Your move may still be good. The exercise records the answers somebody wrote down, not every move that works.'
      })
    }
  }

  // The conditions of the attempt. Each one takes something away from the claim, and each is said.
  if (context.replies === 'from-the-exercise') {
    established.push({
      settled: 'unknown',
      says: 'Orbis supplied the other side\'s moves from the exercise, so finding the defence was not part of this.'
    })
  }
  if (context.hintsTaken > 0) {
    const worth = hintWorth(exercise, context.hintsTaken)
    established.push({
      settled: 'unknown',
      says: `${sayCount(context.hintsTaken)} ${context.hintsTaken === 1 ? 'hint was' : 'hints were'} taken, so a solve here is worth ${Math.round(worth * 100)} per cent of an unaided one${worth === 0 ? ' -- the move itself was shown, so this was practice and not a solve' : ''}.`
    })
  }
  if (context.strict) {
    established.push({ settled: 'yes', says: 'The pieces could not be moved on the board before you submitted, so the line was held in your head.' })
  } else if (context.movedOnBoard) {
    established.push({ settled: 'no', says: 'You moved the pieces on the board first, so this does not show that you held the line in your head.' })
  } else {
    established.push({ settled: 'unknown', says: 'Strict mode was off. You did not move the pieces, as far as this screen can tell, but nothing stopped you.' })
  }
  if (exercise.objective === 'mate-in-n') {
    established.push({ settled: 'unknown', says: 'Nothing here says this is the best move in the position. That is an engine\'s opinion and no engine was asked.' })
  }

  const diverged = comparison.divergence
  // The board goes back to the position the parting move was played *in*, which is the one worth looking at. The
  // position after it is a position nobody needs to study.
  const showFen = diverged
    ? diverged.at === 0 ? comparison.entry.startFen : comparison.entry.fens[diverged.at - 1] ?? comparison.entry.startFen
    : comparison.entry.fens[comparison.entry.fens.length - 1] ?? null

  return {
    heading,
    showFen: showFen ?? null,
    showPly: diverged ? diverged.at : comparison.entry.moves.length > 0 ? comparison.entry.moves.length - 1 : null,
    established,
    candidates: context.candidates.length ? reviewCandidates(exercise, context.candidates) : [],
    worth: comparison.verdict === 'solves' ? hintWorth(exercise, context.hintsTaken) : null
  }
}

/** What a solve is worth after this many hints, by the exercise's own ladder. */
export function hintWorth(exercise: Exercise, taken: number): number {
  if (taken <= 0) return 1
  const hint = exercise.hints[Math.min(taken, exercise.hints.length) - 1]
  return hint ? HINT_WORTH[hint.shows] : 1
}

// ---------------------------------------------------------------- blindfold: the ladder

export type BlindLevelId = 'locate' | 'moves-from' | 'track' | 'reconstruct' | 'solve'

export interface BlindLevel {
  id: BlindLevelId
  order: number
  title: string
  /** What the level asks of somebody, in a sentence. */
  asks: string
  /** When it counts as passed. Stated, because a threshold nobody can see is not a threshold. */
  passes: string
  /** Whether the position is shown before the questions start. */
  study: boolean
}

export const BLIND_LEVELS: readonly BlindLevel[] = Object.freeze([
  {
    id: 'locate',
    order: 1,
    title: 'Where the pieces are',
    asks: 'Look at the position, then answer questions about it with the board gone.',
    passes: 'Every question right.',
    study: true
  },
  {
    id: 'moves-from',
    order: 2,
    title: 'Moves from a square',
    asks: 'Name every square one piece can go to, with the board gone.',
    passes: 'Every square, and no square that is not there.',
    study: true
  },
  {
    id: 'track',
    order: 3,
    title: 'Following a line',
    asks: 'A position and a line of moves in notation. Follow it in your head and say where things ended up.',
    passes: 'Every question right.',
    study: true
  },
  {
    id: 'reconstruct',
    order: 4,
    title: 'Putting the position back',
    asks: 'Look at the position, then build it again from memory.',
    passes: 'The whole board, piece for piece.',
    study: true
  },
  {
    id: 'solve',
    order: 5,
    title: 'Solving with no board',
    asks: 'A position to hold in your head, and a mate to find in it.',
    passes: 'A line that is one of the exercise\'s answers.',
    study: true
  }
])

export function blindLevel(id: BlindLevelId): BlindLevel {
  return BLIND_LEVELS.find((one) => one.id === id) ?? BLIND_LEVELS[0]
}

// ---------------------------------------------------------------- blindfold: what may be on screen

export type Phase = 'ready' | 'studying' | 'answering' | 'done'

export type BlindMode =
  /** The position is not on screen and is not described. Scored.  */
  | 'strict'
  /** The position is written out in words for anybody who needs it read. Not scored as blindfold work. */
  | 'read-out'

export interface ViewRules {
  /** The position to draw, or null when nothing may be drawn. The screen draws a board only when this is a string. */
  boardFen: string | null
  /** Why there is no board, for the person. Never contains anything about the position. */
  because: string | null
  /** The label for the place the board would be. Checked by the tests for square and piece names. */
  label: string
  /** The position written out, in `read-out` mode only. Empty otherwise. */
  readOut: string
  /** Whether this attempt counts towards the level. */
  scored: boolean
  /** May hints that name squares be offered now? */
  hintsAllowed: boolean
}

const SQUARE_PATTERN = /\b[a-h][1-8]\b/

/** Whether a sentence somebody else wrote may be shown while the position is hidden. */
export function safeWhileHidden(text: string): boolean {
  if (SQUARE_PATTERN.test(text)) return false
  // Notation gives the position away as surely as a square does: "Nf3", "exd5", "O-O".
  if (/\b[KQRBN]?[a-h]?x?[a-h][1-8]\b/.test(text)) return false
  if (/\bO-O(-O)?\b/.test(text)) return false
  return true
}

/**
 * Whether the position may be on screen, and what may be said about it.
 *
 * The one decision, in one place. The screen has no other way to get a position to draw, which is what makes
 * "hidden" mean hidden rather than mean "we remembered to hide it in the four places we thought of".
 *
 * While answering in strict mode there is no board, no written position, and no hint -- a hint names a square. On
 * `done` the real position comes back, because showing somebody the board they were working from is the whole point
 * of the feedback, and the attempt is already recorded by then.
 */
export function viewRules(input: {
  level: BlindLevelId
  phase: Phase
  mode: BlindMode
  /** The position being worked on. */
  fen: string
  /** The position to show afterwards, when it is not the starting one -- the end of a tracked line. */
  doneFen?: string
}): ViewRules {
  const { phase, mode } = input
  if (phase === 'ready') {
    return {
      boardFen: null,
      because: 'Nothing has started yet.',
      label: 'The board, before a round starts',
      readOut: '',
      scored: mode === 'strict',
      hintsAllowed: false
    }
  }
  if (phase === 'studying') {
    // Studying is looking at the position. The whole level depends on it being visible here and nowhere else.
    return {
      boardFen: input.fen,
      because: null,
      label: 'The position to remember',
      readOut: mode === 'read-out' ? sayPosition(input.fen) : '',
      scored: mode === 'strict',
      hintsAllowed: false
    }
  }
  if (phase === 'done') {
    const showing = input.doneFen ?? input.fen
    return {
      boardFen: showing,
      because: null,
      label: 'The position as it really is',
      readOut: mode === 'read-out' ? sayPosition(showing) : '',
      scored: mode === 'strict',
      hintsAllowed: true
    }
  }
  // Answering.
  return {
    boardFen: null,
    because: mode === 'strict'
      ? 'The board is not on screen. That is the exercise.'
      : 'The board is not on screen. The position is written out below instead, which is a different exercise -- this round is not scored as blindfold work.',
    label: 'The board is hidden while you answer',
    readOut: mode === 'read-out' ? sayPosition(input.fen) : '',
    scored: mode === 'strict',
    hintsAllowed: false
  }
}

// ---------------------------------------------------------------- the gym: what may be on screen

export type GymMode =
  /** The position goes off screen before the line is written. Section 215's hidden-board mode. */
  | 'hidden'
  /** The position stays on screen and the pieces may be moved about on it to work the line out. */
  | 'with-board'

export interface GymRules extends ViewRules {
  /**
   * Whether the pieces may be moved about on the board as a way of working the line out.
   *
   * Separate from `boardFen` because they are different permissions: after submitting, the board comes back and the
   * pieces still may not be moved -- the attempt is finished and a board somebody can play with would quietly turn
   * the review into a second go.
   */
  mayMovePieces: boolean
}

/** The gym's own words for the place the board is. None of them names a square, a piece or a position. */
const GYM_LABEL: Readonly<Record<Phase, string>> = Object.freeze({
  ready: 'The board, before a round starts',
  studying: 'The position, to look at before you start',
  answering: 'The board is hidden while you calculate',
  done: 'The position as it really is'
})

/**
 * Whether the board may be on screen in the Calculation Gym, and whether it may be played with.
 *
 * The gym's one decision, the way `viewRules` is the blindfold screen's. It exists because the gym has a round the
 * blindfold ladder does not -- one where the position stays on screen the whole time, which is most of what the gym
 * is for -- and because `scored` means something slightly different here: not "this counts towards a level" but
 * "this was a hidden-board attempt", which is the only kind that says anything about calculating in your head.
 *
 * **`boardFen` is not decided twice.** Every phase except calculating-with-the-board is the same question the
 * blindfold screen asks, so the answer comes straight out of `viewRules` and only the wording is the gym's. That is
 * what stops a change to the hiding rule reaching one screen and not the other.
 */
export function gymView(input: { mode: GymMode; phase: Phase; fen: string; doneFen?: string }): GymRules {
  const blind = viewRules({
    level: 'solve',
    phase: input.phase,
    mode: 'strict',
    fen: input.fen,
    ...(input.doneFen !== undefined ? { doneFen: input.doneFen } : {})
  })
  const hidden = input.mode === 'hidden'
  if (hidden || input.phase !== 'answering') {
    return {
      ...blind,
      label: GYM_LABEL[input.phase],
      // A round with the board on screen is not a hidden-board round, whatever phase it is in.
      scored: hidden,
      mayMovePieces: false
    }
  }
  // Calculating with the board on screen. The one case the blindfold ladder has no equivalent of.
  return {
    boardFen: input.fen,
    because: null,
    label: 'The position. You can move the pieces about on it.',
    readOut: '',
    scored: false,
    hintsAllowed: true,
    mayMovePieces: true
  }
}

/**
 * The position written out, for the mode that reads it out.
 *
 * Kept to what is on the board and whose move it is. Deliberately not a sentence about what the position *means*:
 * the point is that somebody who cannot see a board gets the same facts as somebody who can, not somebody's opinion
 * of them.
 */
export function sayPosition(fen: string): string {
  const pieces = boardSquares(fen)
  if (pieces.length === 0) return 'There is no position here.'
  const parts: string[] = []
  for (const side of ['w', 'b'] as const) {
    const kinds: string[] = []
    for (const type of ['k', 'q', 'r', 'b', 'n', 'p'] as const) {
      const squares = pieces.filter((p) => p.color === side && p.type === type).map((p) => p.square).sort()
      if (squares.length === 0) continue
      kinds.push(`${PIECE_WORD[type]}${squares.length > 1 ? 's' : ''} ${squares.join(', ')}`)
    }
    if (kinds.length) parts.push(`${SIDE_WORD[side]}: ${kinds.join('; ')}.`)
  }
  const state = outcome(fen)
  const check = state.over ? state.reason === 'checkmate' : state.check
  parts.push(`${SIDE_WORD[sideToMove(fen)]} to move${check ? ', in check' : ''}.`)
  return parts.join(' ')
}

const OBJECTIVE_WORD: Readonly<Record<Exercise['objective'], string>> = Object.freeze({
  'mate-in-n': 'Force checkmate.',
  'win-material': 'Win material.',
  'find-best': 'Find the strongest move.',
  'hold-draw': 'Hold the draw.',
  reconstruct: 'Play the line out.',
  answer: 'Answer the question.'
})

/**
 * The prompt a screen may show while the position is hidden.
 *
 * An exercise somebody else wrote may well name a square -- "the knight on c3 is pinned" is a perfectly good prompt
 * with a board on screen and gives the position away without one. So a prompt that is not safe is not patched up and
 * shown; one is built from the objective instead, and the real prompt waits until the board comes back.
 */
export function promptWhileHidden(exercise: Exercise): string {
  if (safeWhileHidden(exercise.prompt)) return exercise.prompt
  const side = `${SIDE_WORD[exercise.sideToMove]} to move.`
  if (exercise.objective === 'mate-in-n' && exercise.movesToMate) {
    return `${side} Force mate in ${sayCount(exercise.movesToMate)}.`
  }
  return `${side} ${OBJECTIVE_WORD[exercise.objective]}`
}

// ---------------------------------------------------------------- blindfold: positions to work from

interface BlindPositionSeed {
  id: string
  /** The position, or the moves that reach it from the standard start. A line is replayed; nothing is pasted. */
  from: 'start' | string
  moves: readonly string[]
  says: string
}

/**
 * The positions the blindfold levels draw from.
 *
 * Two kinds, and neither is a FEN somebody typed from memory. The sparse ones are the gym's own composed positions,
 * whose legality the search has already settled. The fuller ones are *lines*, replayed through the rules to get the
 * position -- so "after 1.e4 e5 2.Nf3 Nc6 3.Bc4" is a position that really arises after those moves, and if a move
 * in the list could not be played the position is left out rather than half-built.
 */
const BLIND_POSITION_SEEDS: readonly BlindPositionSeed[] = Object.freeze([
  { id: 'blind-start', from: 'start', moves: [], says: 'the position at the start of a game' },
  { id: 'blind-e4e5-nf3nc6-bc4', from: 'start', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], says: 'after 1.e4 e5 2.Nf3 Nc6 3.Bc4' },
  { id: 'blind-e4e5-nf3nc6-bb5', from: 'start', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], says: 'after 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6' },
  { id: 'blind-d4d5-c4e6', from: 'start', moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'], says: 'after 1.d4 d5 2.c4 e6 3.Nc3 Nf6' },
  { id: 'blind-e4c5-nf3d6', from: 'start', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'], says: 'after 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6' }
])

export interface BlindPosition {
  id: string
  fen: string
  says: string
  pieces: number
}

let blindPositionCache: BlindPosition[] | null = null

/** Every position the blindfold levels may use, sparse ones first. */
export function blindPositions(): BlindPosition[] {
  if (blindPositionCache) return blindPositionCache
  const out: BlindPosition[] = []
  for (const entry of GYM_CATALOGUE) {
    if (!canPlayFrom(entry.fen).ok) continue
    out.push({ id: entry.id, fen: entry.fen, says: `${entry.pieces} pieces`, pieces: entry.pieces })
  }
  for (const seed of BLIND_POSITION_SEEDS) {
    const start = seed.from === 'start' ? START_FEN : seed.from
    let fen = start
    let ok = true
    for (const move of seed.moves) {
      const made = applyMove(fen, move)
      if (!made) { ok = false; break }
      fen = made.after
    }
    if (!ok || !canPlayFrom(fen).ok) continue
    out.push({ id: seed.id, fen, says: seed.says, pieces: boardSquares(fen).length })
  }
  blindPositionCache = out.sort((a, b) => a.pieces - b.pieces)
  return blindPositionCache
}

export function forgetBlindPositions(): void {
  blindPositionCache = null
}

/**
 * A named generator, so a round can be reproduced from its seed.
 *
 * The same one `blindfold.ts` uses, for the same reason: a round somebody could not get back is a round whose
 * complaint cannot be looked into.
 */
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

/** A seeded shuffle. `sort` with a random comparator is not one: it is not even a permutation of the input. */
function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1)) % (i + 1)
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

// ---------------------------------------------------------------- blindfold: following a line

interface TrackSeed {
  id: string
  from: 'start' | string
  moves: readonly string[]
  /** What this line is for. The traps are the point of it. */
  says: string
}

/**
 * Lines to follow, chosen for the three things that make following a line in your head go wrong.
 *
 * En passant takes a pawn that is not on the square the capturing pawn lands on. Castling moves two pieces. A
 * promoted pawn is the same piece it was. `blindfold.ts` gets all three right; these lines are what ask it to.
 * Every one is replayed through the rules in the test, and the tracker's board is compared with the rules' board.
 */
const TRACK_SEEDS: readonly TrackSeed[] = Object.freeze([
  {
    id: 'track-short-castling',
    from: 'start',
    moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Bc4', 'Bc5', 'O-O', 'O-O'],
    says: 'both sides castle, which moves two pieces each time'
  },
  {
    id: 'track-en-passant',
    from: 'start',
    moves: ['e4', 'd5', 'e5', 'f5', 'exf6'],
    says: 'the last move takes en passant: the pawn that goes is not on the square the capturing pawn lands on'
  },
  {
    id: 'track-promotion',
    from: 'start',
    moves: ['e4', 'd5', 'exd5', 'c6', 'dxc6', 'Nf6', 'cxb7', 'Bg4', 'bxa8=Q'],
    says: 'a pawn walks up the board, takes twice and becomes a queen'
  },
  {
    id: 'track-captures',
    from: 'start',
    moves: ['d4', 'd5', 'c4', 'dxc4', 'e3', 'b5', 'a4', 'c6', 'axb5', 'cxb5'],
    says: 'pawns take each other on both wings'
  },
  {
    id: 'track-long-castling',
    from: 'start',
    moves: ['d4', 'd5', 'Nc3', 'Nc6', 'Bf4', 'Bf5', 'Qd2', 'Qd7', 'O-O-O', 'O-O-O'],
    says: 'both sides castle long'
  }
])

export type TrackAnswerKind = 'where-now' | 'gone-or-not' | 'what-is-on' | 'how-far'

export interface TrackQuestion {
  id: string
  kind: TrackAnswerKind
  ask: string
  /** The square the piece is on now, or null when it has been taken. */
  square: string | null
  /** The answer in words, for the feedback. Always known: it is read out of the tracking. */
  answer: string
  /** Why the answer is what it is, where that is the trap. */
  because: string
}

export interface TrackRound {
  kind: 'track'
  id: string
  startFen: string
  /** The moves, properly written for the position each was played in. This is the input: it is on screen. */
  san: readonly string[]
  finalFen: string
  says: string
  tracking: Tracking
  questions: readonly TrackQuestion[]
}

/**
 * Questions about where things ended up, every one answered out of the tracking.
 *
 * The identity questions -- "where is the piece that started on h1" -- are the ones worth asking, because they are
 * the ones a wrong mental model gets wrong: the rook that castled, the pawn that was taken en passant, the pawn
 * that is now a queen.
 */
export function trackQuestions(tracking: Tracking, seed: number, want: number): TrackQuestion[] {
  const finalFen = tracking.fens[tracking.fens.length - 1]
  if (!finalFen) return []
  const random = mulberry32(seed)
  const pool: TrackQuestion[] = []
  let serial = 0
  const add = (q: Omit<TrackQuestion, 'id'>): void => {
    serial += 1
    pool.push({ ...q, id: `t${serial}` })
  }

  for (const piece of tracking.pieces) {
    const started = piece.path[0]
    if (!started) continue
    const name = `${SIDE_WORD[piece.side]}'s ${PIECE_WORD[piece.startedAs]} that started on ${started}`
    if (piece.square === null) {
      add({
        kind: 'gone-or-not',
        ask: `Where is ${name} now?`,
        square: null,
        answer: 'it has been taken',
        because: piece.takenAtPly !== null ? `It was taken on move ${Math.ceil(piece.takenAtPly / 2)}.` : 'It is not on the board.'
      })
      continue
    }
    add({
      kind: 'where-now',
      ask: `Where is ${name} now?`,
      square: piece.square,
      answer: piece.square,
      because: piece.promotedAtPly !== null
        ? `It became ${PIECE_WORD[piece.type] === 'queen' ? 'a queen' : `a ${PIECE_WORD[piece.type]}`} on the way, and it is the same piece.`
        : piece.path.length > 2
          ? `It went ${piece.path.join(' to ')}.`
          : `It moved once, to ${piece.square}.`
    })
  }

  const chosen: TrackQuestion[] = []
  const left = [...pool]
  // Pieces that moved are worth more than pieces that never did, so they are drawn from first.
  const interesting = left.filter((q) => q.square === null || tracking.pieces.some((p) => p.path.length > 1 && p.square === q.square))
  const rest = left.filter((one) => !interesting.includes(one))
  const draw = (from: TrackQuestion[]): void => {
    while (chosen.length < want && from.length > 0) {
      const index = Math.floor(random() * from.length) % from.length
      chosen.push(from[index])
      from.splice(index, 1)
    }
  }
  draw(interesting)
  draw(rest)
  return chosen.map((q, i) => ({ ...q, id: `t${i + 1}` }))
}

export interface TrackMark {
  right: boolean
  answer: string
  says: string
}

/** Marking an answer that is a square, or "it has been taken". */
export function markTrack(question: TrackQuestion, given: string): TrackMark {
  const text = (given ?? '').trim().toLowerCase()
  if (!text) return { right: false, answer: question.answer, says: 'Nothing was answered.' }
  const squares = [...new Set(text.match(/[a-h][1-8]/g) ?? [])]
  const saidGone = /\b(taken|gone|captured|off|nowhere|none|dead)\b/.test(text)
  if (question.square === null) {
    return saidGone && squares.length === 0
      ? { right: true, answer: question.answer, says: `Yes -- ${question.because}` }
      : { right: false, answer: question.answer, says: `It is not on the board. ${question.because}` }
  }
  if (squares.length === 1 && squares[0] === question.square) {
    return { right: true, answer: question.answer, says: `${question.square}, yes. ${question.because}` }
  }
  if (squares.length === 0) {
    return { right: false, answer: question.answer, says: `It is on ${question.square}. ${question.because}` }
  }
  return {
    right: false,
    answer: question.answer,
    says: `It is on ${question.square}, not ${squares.join(' or ')}. ${question.because}`
  }
}

// ---------------------------------------------------------------- blindfold: naming the moves from a square

export interface MovesRound {
  kind: 'moves-from'
  id: string
  fen: string
  from: string
  piece: PieceLetter
  side: Side
  /** Every square that piece can really go to, read out of the rules. */
  squares: readonly string[]
  ask: string
}

export interface MovesMark {
  right: boolean
  missing: readonly string[]
  extra: readonly string[]
  answer: readonly string[]
  says: string
}

/**
 * Marking a list of squares.
 *
 * Both halves matter and they are reported separately: a square that was missed is something not seen, and a square
 * that is not there is something imagined. A trainer that scored them together would give the same mark to two
 * different mistakes.
 */
export function markMoves(round: MovesRound, given: string): MovesMark {
  const said = [...new Set((given ?? '').toLowerCase().match(/[a-h][1-8]/g) ?? [])].sort()
  const expected = [...round.squares].sort()
  const missing = expected.filter((square) => !said.includes(square))
  const extra = said.filter((square) => !expected.includes(square))
  const right = missing.length === 0 && extra.length === 0
  return {
    right,
    missing,
    extra,
    answer: expected,
    says: right
      ? `All ${sayCount(expected.length)}: ${expected.join(', ')}.`
      : `It can go to ${expected.join(', ') || 'nowhere'}.${missing.length ? ` Missed: ${missing.join(', ')}.` : ''}${extra.length ? ` Cannot go there: ${extra.join(', ')}.` : ''}`
  }
}

// ---------------------------------------------------------------- blindfold: a round

export interface LocateRound {
  kind: 'locate'
  id: string
  fen: string
  says: string
  questions: readonly BlindQuestion[]
}

export interface RecallRound {
  kind: 'reconstruct'
  id: string
  fen: string
  says: string
  /** How many pieces are on it, which is the only thing a person is told before they start. */
  pieces: number
}

export interface SolveRound {
  kind: 'solve'
  id: string
  fen: string
  says: string
  exercise: Exercise
  /** The prompt as it may be shown while the board is hidden. */
  prompt: string
}

export type BlindRound = LocateRound | MovesRound | TrackRound | RecallRound | SolveRound

export interface RoundOptions {
  seed: number
  /** How many questions to ask, where the level asks questions. */
  questions?: number
  /** Keep to positions with no more than this many pieces. */
  mostPieces?: number
}

/**
 * One round of a level, built from a seed.
 *
 * Everything a round needs is worked out here and nothing is worked out later, so a round is a value a screen can
 * hold, show, mark and store. Null comes back when the level cannot be built -- which happens, and is said rather
 * than papered over with an empty round that looks like a working one.
 */
export function buildRound(level: BlindLevelId, options: RoundOptions): BlindRound | null {
  const random = mulberry32(options.seed)
  const positions = blindPositions().filter((one) => one.pieces <= (options.mostPieces ?? 64))
  const pickOne = <T,>(list: readonly T[]): T | null => (list.length === 0 ? null : list[Math.floor(random() * list.length) % list.length])

  if (level === 'locate') {
    const chosen = pickOne(positions)
    if (!chosen) return null
    const questions = questionsFor(chosen.fen, {
      count: Math.max(1, Math.min(12, options.questions ?? 5)),
      seed: options.seed,
      kinds: ['piece-on-square', 'where-is', 'count', 'side-to-move']
    })
    if (questions.length === 0) return null
    return { kind: 'locate', id: chosen.id, fen: chosen.fen, says: chosen.says, questions }
  }

  if (level === 'moves-from') {
    // A square worth asking about: the side to move, more than one square to go to, and not the king, whose moves
    // are the easiest thing on the board.
    for (const position of shuffled(positions, random)) {
      const mine = sideToMove(position.fen)
      const pieces = boardSquares(position.fen).filter((p) => p.color === mine && p.type !== 'k')
      for (const piece of shuffled(pieces, random)) {
        const squares = [...new Set(destinationsFrom(position.fen, piece.square).map((m) => m.to))].sort()
        if (squares.length < 2) continue
        return {
          kind: 'moves-from',
          id: position.id,
          fen: position.fen,
          from: piece.square,
          piece: piece.type,
          side: mine,
          squares,
          ask: `Name every square ${SIDE_WORD[mine]}'s ${PIECE_WORD[piece.type]} on ${piece.square} can go to.`
        }
      }
    }
    return null
  }

  if (level === 'track') {
    const seed = pickOne(TRACK_SEEDS)
    if (!seed) return null
    const startFen = seed.from === 'start' ? START_FEN : seed.from
    const tracking = trackPieces(startFen, [...seed.moves])
    if (!tracking.ok || !trackingAgrees(tracking)) return null
    const finalFen = tracking.fens[tracking.fens.length - 1]
    if (!finalFen) return null
    const questions = trackQuestions(tracking, options.seed, Math.max(1, Math.min(8, options.questions ?? 4)))
    if (questions.length === 0) return null
    return {
      kind: 'track',
      id: seed.id,
      startFen,
      san: tracking.san,
      finalFen,
      says: seed.says,
      tracking,
      questions
    }
  }

  if (level === 'reconstruct') {
    const small = positions.filter((one) => one.pieces <= (options.mostPieces ?? 10))
    const chosen = pickOne(small.length ? small : positions)
    if (!chosen) return null
    return { kind: 'reconstruct', id: chosen.id, fen: chosen.fen, says: chosen.says, pieces: chosen.pieces }
  }

  const pool = gymPool().exercises.filter((one) => one.objective === 'mate-in-n' && (one.movesToMate ?? 0) <= 2)
  const chosen = pickOne(pool.length ? pool : gymPool().exercises)
  if (!chosen) return null
  return {
    kind: 'solve',
    id: chosen.id,
    fen: chosen.startFen,
    says: `${boardSquares(chosen.startFen).length} pieces`,
    exercise: chosen,
    prompt: promptWhileHidden(chosen)
  }
}

// ---------------------------------------------------------------- blindfold: marking a round

export interface QuestionResult {
  id: string
  ask: string
  given: string
  right: boolean
  answer: string
  says: string
}

export interface RoundResult {
  /** True when the level's own stated threshold was met. */
  passed: boolean
  /** How the threshold was worked out, in words, so the pass is never a bare verdict. */
  rule: string
  right: number
  outOf: number
  questions: readonly QuestionResult[]
  /** For the reconstruct level only. */
  recall: RecallScore | null
  /** For the solve level only. */
  comparison: Comparison | null
  says: string
}

/** Marking a set of question answers, for the levels that ask questions. */
export function markQuestions(questions: readonly BlindQuestion[], given: Readonly<Record<string, string>>): QuestionResult[] {
  return questions.map((question) => {
    const answer: Marked = markAnswer(question, given[question.id] ?? '')
    return {
      id: question.id,
      ask: question.ask,
      given: given[question.id] ?? '',
      right: answer.right,
      answer: answer.answer,
      says: answer.says
    }
  })
}

export function markTrackQuestions(questions: readonly TrackQuestion[], given: Readonly<Record<string, string>>): QuestionResult[] {
  return questions.map((question) => {
    const marked = markTrack(question, given[question.id] ?? '')
    return {
      id: question.id,
      ask: question.ask,
      given: given[question.id] ?? '',
      right: marked.right,
      answer: marked.answer,
      says: marked.says
    }
  })
}

export interface RoundAnswer {
  /** Keyed by question id, for the question levels. */
  answers?: Readonly<Record<string, string>>
  /** The typed list, for the moves-from level. */
  text?: string
  /** The board as remembered, for the reconstruct level. */
  placements?: readonly Placement[]
  /** The line, for the solve level. */
  line?: readonly string[]
}

/**
 * A round, marked.
 *
 * Each level's threshold is the one written on the level, and the rule comes back with the verdict every time. A
 * screen that shows "passed" without the rule beside it is asking to be believed; this does not give it the option.
 */
export function markRound(round: BlindRound, answer: RoundAnswer): RoundResult {
  // Every round's `kind` is the level it belongs to, which is deliberate: there is no mapping to get wrong.
  const level = blindLevel(round.kind)

  if (round.kind === 'locate') {
    const results = markQuestions(round.questions, answer.answers ?? {})
    const right = results.filter((one) => one.right).length
    return {
      passed: right === results.length && results.length > 0,
      rule: level.passes,
      right,
      outOf: results.length,
      questions: results,
      recall: null,
      comparison: null,
      says: `${right} of ${results.length} right.`
    }
  }

  if (round.kind === 'track') {
    const results = markTrackQuestions(round.questions, answer.answers ?? {})
    const right = results.filter((one) => one.right).length
    return {
      passed: right === results.length && results.length > 0,
      rule: level.passes,
      right,
      outOf: results.length,
      questions: results,
      recall: null,
      comparison: null,
      says: `${right} of ${results.length} right.`
    }
  }

  if (round.kind === 'moves-from') {
    const marked = markMoves(round, answer.text ?? '')
    return {
      passed: marked.right,
      rule: level.passes,
      right: marked.right ? 1 : 0,
      outOf: 1,
      questions: [{
        id: 'moves',
        ask: round.ask,
        given: answer.text ?? '',
        right: marked.right,
        answer: marked.answer.join(', '),
        says: marked.says
      }],
      recall: null,
      comparison: null,
      says: marked.says
    }
  }

  if (round.kind === 'reconstruct') {
    const recall = scoreRecall(round.fen, answer.placements ?? [])
    return {
      passed: recall.exact,
      rule: level.passes,
      right: recall.right,
      outOf: recall.outOf,
      questions: [],
      recall,
      comparison: null,
      says: recall.says
    }
  }

  const comparison = compareLine(round.exercise, answer.line ?? [])
  return {
    passed: comparison.verdict === 'solves',
    rule: level.passes,
    right: comparison.verdict === 'solves' ? 1 : 0,
    outOf: 1,
    questions: [],
    recall: null,
    comparison,
    says: comparison.says
  }
}

/** Where a reconstruction differs from the real board, worst first, for the feedback. */
export function reconstructionFaults(recall: RecallScore): { square: string; verdict: string; says: string }[] {
  const order: Readonly<Record<string, number>> = { missed: 0, invented: 1, nearly: 2, right: 3 }
  return recall.squares
    .filter((one) => one.verdict !== 'right')
    .sort((a, b) => (order[a.verdict] ?? 9) - (order[b.verdict] ?? 9) || a.square.localeCompare(b.square))
    .map((one) => ({
      square: one.square,
      verdict: one.verdict,
      says: one.verdict === 'missed'
        ? one.given
          ? `${one.square}: ${one.expected} is there; you said ${one.given}, which is the other side's.`
          : `${one.square}: ${one.expected} is there, and you did not mention it.`
        : one.verdict === 'invented'
          ? `${one.square}: empty. You put ${one.given ?? 'something'} there.`
          : `${one.square}: ${one.expected} is there, and you said ${one.given}. Right square, wrong piece.`
    }))
}

// ---------------------------------------------------------------- keeping what happened

export const TRAINING_KEY = 'orbis.chess.training'
export const TRAINING_VERSION = 1

/**
 * Which trainer an attempt belongs to.
 *
 * All four share this record because they are written at the same moments and read by the same screens. What each
 * one puts in `item` is its own business and is worked out by a named function in that trainer's module --
 * `visionItem`, `drillItem` -- so a record can always be read back to the thing it was about.
 */
export type TrainingArea = 'calculation' | 'blindfold' | 'vision' | 'drill'

const AREAS: readonly TrainingArea[] = ['calculation', 'blindfold', 'vision', 'drill']

export interface TrainingAttempt {
  /** Unique within the store, so a retry never lands on the same record. */
  id: string
  at: number
  area: TrainingArea
  /** The exercise id, or the level id for a blindfold round. */
  item: string
  /** The round within a blindfold level, so a round can be found again from its seed. */
  seed?: number
  /**
   * Whether nothing on screen gave the answer away. The whole point of the record.
   *
   * For the Calculation Gym and the blindfold ladder that means the board was kept off the screen. For Vision it
   * means the file and rank labels were off the edge of the board, which is the same idea: with them on, "where is
   * e4" is answered by reading the board rather than by knowing it. A drill is never strict -- the board is on
   * screen and being played on, which is what a drill is -- so it records `false` rather than pretending.
   */
  strict: boolean
  /** How it went, in the words of the thing that marked it. */
  verdict: string
  passed: boolean
  right?: number
  outOf?: number
  hints?: number
  /** The line that was submitted, for the gym. */
  line?: readonly string[]
  /** How long it took, in milliseconds, when the screen was able to measure it. */
  ms?: number
}

export interface TrainingSettings {
  strict: boolean
  replies: ReplySource
  mode: BlindMode
  studySeconds: number
  questions: number
  /**
   * The most pieces a blindfold position may have.
   *
   * One of the four things a round gets harder by, and the one a person is most likely to want turned down: a
   * position with thirty pieces in it is a different exercise from one with five, not a harder version of the same
   * one. Kept here with the others so a setting somebody chose survives closing the window (Section 226).
   */
  mostPieces: number
}

export const DEFAULT_SETTINGS: TrainingSettings = Object.freeze({
  strict: true,
  replies: 'both-sides' as ReplySource,
  mode: 'strict' as BlindMode,
  studySeconds: 20,
  questions: 5,
  mostPieces: 8
})

export interface TrainingStore {
  version: number
  attempts: readonly TrainingAttempt[]
  settings: TrainingSettings
}

export function emptyStore(): TrainingStore {
  return { version: TRAINING_VERSION, attempts: [], settings: { ...DEFAULT_SETTINGS } }
}

export interface StoreRead {
  store: TrainingStore
  /** Said to the person when what was there could not be used. Null when all was well. */
  note: string | null
  /**
   * False when there was something saved and it could not be read.
   *
   * The screen must not write in that case. Unreadable is not missing: a store that writes its defaults over text it
   * merely could not parse has destroyed the only copy of what somebody did, and this has happened in Orbis before.
   */
  safeToWrite: boolean
}

const MODES: readonly BlindMode[] = ['strict', 'read-out']
const REPLIES: readonly ReplySource[] = ['both-sides', 'from-the-exercise']

/**
 * Reading the store, tolerantly.
 *
 * Everything is optional and everything is checked: a missing field takes its default, a field of the wrong type
 * takes its default, and an attempt that is not an object is dropped rather than making the whole store unreadable.
 * Two cases are not tolerated, and both leave what is on disk alone: text that is not JSON, and a version from the
 * future -- a newer Orbis may have written fields this one would throw away on the next save.
 */
export function readTraining(raw: string | null | undefined): StoreRead {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { store: emptyStore(), note: null, safeToWrite: true }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      store: emptyStore(),
      note: 'What was saved from an earlier session could not be read, so this starts empty. Nothing new is being saved over it.',
      safeToWrite: false
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      store: emptyStore(),
      note: 'What was saved from an earlier session is not in the shape this screen writes, so this starts empty. Nothing new is being saved over it.',
      safeToWrite: false
    }
  }
  const record = parsed as Record<string, unknown>
  const version = typeof record.version === 'number' && Number.isFinite(record.version) ? Math.trunc(record.version) : 0
  if (version > TRAINING_VERSION) {
    return {
      store: emptyStore(),
      note: `This was saved by a newer version of Orbis (${version}, and this screen writes ${TRAINING_VERSION}). It is being left exactly as it is rather than written over.`,
      safeToWrite: false
    }
  }

  const settingsRaw = typeof record.settings === 'object' && record.settings !== null ? (record.settings as Record<string, unknown>) : {}
  const settings: TrainingSettings = {
    strict: typeof settingsRaw.strict === 'boolean' ? settingsRaw.strict : DEFAULT_SETTINGS.strict,
    replies: REPLIES.includes(settingsRaw.replies as ReplySource) ? (settingsRaw.replies as ReplySource) : DEFAULT_SETTINGS.replies,
    mode: MODES.includes(settingsRaw.mode as BlindMode) ? (settingsRaw.mode as BlindMode) : DEFAULT_SETTINGS.mode,
    studySeconds: clampNumber(settingsRaw.studySeconds, 5, 300, DEFAULT_SETTINGS.studySeconds),
    questions: clampNumber(settingsRaw.questions, 1, 12, DEFAULT_SETTINGS.questions),
    // Four is the fewest a position can have and still be worth remembering; sixty-four is every square full.
    mostPieces: clampNumber(settingsRaw.mostPieces, 4, 64, DEFAULT_SETTINGS.mostPieces)
  }

  const attempts: TrainingAttempt[] = []
  const list = Array.isArray(record.attempts) ? record.attempts : []
  let dropped = 0
  for (const one of list) {
    const attempt = readAttempt(one)
    if (attempt) attempts.push(attempt)
    else dropped += 1
  }
  attempts.sort((a, b) => a.at - b.at)

  return {
    store: { version: TRAINING_VERSION, attempts, settings },
    note: dropped > 0 ? `${dropped} saved ${dropped === 1 ? 'attempt' : 'attempts'} could not be read and ${dropped === 1 ? 'was' : 'were'} left out. The rest is here.` : null,
    safeToWrite: true
  }
}

function clampNumber(value: unknown, low: number, high: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(low, Math.min(high, Math.trunc(value)))
}

function readAttempt(value: unknown): TrainingAttempt | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const one = value as Record<string, unknown>
  const id = typeof one.id === 'string' && one.id.trim() ? one.id.slice(0, 80) : null
  const item = typeof one.item === 'string' && one.item.trim() ? one.item.slice(0, 120) : null
  const area = AREAS.includes(one.area as TrainingArea) ? (one.area as TrainingArea) : null
  if (!id || !item || !area) return null
  const at = typeof one.at === 'number' && Number.isFinite(one.at) ? Math.trunc(one.at) : 0
  return {
    id,
    at,
    area,
    item,
    ...(typeof one.seed === 'number' && Number.isFinite(one.seed) ? { seed: Math.trunc(one.seed) } : {}),
    strict: one.strict === true,
    verdict: typeof one.verdict === 'string' ? one.verdict.slice(0, 400) : '',
    passed: one.passed === true,
    ...(typeof one.right === 'number' && Number.isFinite(one.right) ? { right: Math.trunc(one.right) } : {}),
    ...(typeof one.outOf === 'number' && Number.isFinite(one.outOf) ? { outOf: Math.trunc(one.outOf) } : {}),
    ...(typeof one.hints === 'number' && Number.isFinite(one.hints) ? { hints: Math.trunc(one.hints) } : {}),
    ...(Array.isArray(one.line) ? { line: one.line.filter((move): move is string => typeof move === 'string').slice(0, 60) } : {}),
    ...(typeof one.ms === 'number' && Number.isFinite(one.ms) && one.ms >= 0 ? { ms: Math.trunc(one.ms) } : {})
  }
}

export function writeTraining(store: TrainingStore): string {
  return JSON.stringify({ version: TRAINING_VERSION, attempts: store.attempts, settings: store.settings })
}

/** How many attempts are kept for one item before the middle ones go. */
export const KEEP_PER_ITEM = 10

/**
 * One more attempt, keeping the first.
 *
 * A retry must not overwrite the first try. The first attempt is the only one that says whether somebody could do
 * it unaided, and a store that keeps the latest only turns every exercise into "solved eventually". So the record
 * is append-only, and when an item has to be trimmed it is the middle that goes: the first attempt and the most
 * recent nine stay, and the screen says so where it shows them.
 */
export function addAttempt(store: TrainingStore, attempt: TrainingAttempt): TrainingStore {
  const next = [...store.attempts, attempt].sort((a, b) => a.at - b.at)
  const byItem = new Map<string, TrainingAttempt[]>()
  for (const one of next) {
    const key = `${one.area}:${one.item}`
    const list = byItem.get(key) ?? []
    list.push(one)
    byItem.set(key, list)
  }
  const keep = new Set<string>()
  for (const list of byItem.values()) {
    if (list.length <= KEEP_PER_ITEM) {
      for (const one of list) keep.add(one.id)
      continue
    }
    keep.add(list[0].id)
    for (const one of list.slice(-(KEEP_PER_ITEM - 1))) keep.add(one.id)
  }
  return { ...store, attempts: next.filter((one) => keep.has(one.id)) }
}

export function attemptsFor(store: TrainingStore, area: TrainingAttempt['area'], item: string): TrainingAttempt[] {
  return store.attempts.filter((one) => one.area === area && one.item === item)
}

export interface ItemStanding {
  item: string
  attempts: number
  /** The first attempt, which is the one that says whether it was solved unaided. */
  first: TrainingAttempt | null
  latest: TrainingAttempt | null
  /** Passed with the board away at least once. */
  passedStrict: boolean
  /** Passed in a mode that is not scored as blindfold work. */
  passedAnyhow: boolean
}

export function standingOf(store: TrainingStore, area: TrainingAttempt['area'], item: string): ItemStanding {
  const mine = attemptsFor(store, area, item)
  return {
    item,
    attempts: mine.length,
    first: mine[0] ?? null,
    latest: mine[mine.length - 1] ?? null,
    passedStrict: mine.some((one) => one.passed && one.strict),
    passedAnyhow: mine.some((one) => one.passed)
  }
}

export interface LevelStanding extends ItemStanding {
  level: BlindLevel
  /** Open to start. The first level always is; the rest open when the one before has been passed with no board. */
  open: boolean
  /** Why it is not open, or what opened it. */
  says: string
}

/**
 * The ladder, as it stands.
 *
 * A level opens when the one before it has been passed with the board away. Passing in the read-out mode does not
 * open the next level, and the reason is on the screen rather than implied: that mode is a different exercise and
 * saying it had opened the next one would be a claim about blindfold work that nobody made.
 *
 * Nothing is locked shut. A level that is not open can still be started, and what that means is said out loud,
 * because a trainer that refuses to let somebody practise what they want to practise is wrong about whose practice
 * it is.
 */
export function ladder(store: TrainingStore): LevelStanding[] {
  const out: LevelStanding[] = []
  let previousStrict = true
  let previousAnyhow = true
  let previousTitle = ''
  for (const level of BLIND_LEVELS) {
    const standing = standingOf(store, 'blindfold', level.id)
    const open = previousStrict
    out.push({
      ...standing,
      level,
      open,
      says: open
        ? previousTitle === ''
          ? 'Open: this is where the ladder starts.'
          : `Open: you passed "${previousTitle}" with the board away.`
        : previousAnyhow
          // Passed, but with the position read out. That is a different exercise, so it does not open this one.
          ? `"${previousTitle}" has not been passed with the board away yet -- it was passed with the position read out, which is a different exercise. You can still start this one.`
          : `Opens when you pass "${previousTitle}" with the board away. You can still start it now.`
    })
    previousStrict = standing.passedStrict
    previousAnyhow = standing.passedAnyhow
    previousTitle = level.title
  }
  return out
}

export interface TrainingSummary {
  attempts: number
  /** Attempts with the board away. */
  strictAttempts: number
  calculation: { attempts: number; solved: number; items: number }
  blindfold: { attempts: number; passed: number; levels: number }
  /** The highest level passed with the board away, or null. */
  reached: BlindLevel | null
  says: string
}

export function summarise(store: TrainingStore): TrainingSummary {
  const calc = store.attempts.filter((one) => one.area === 'calculation')
  const blind = store.attempts.filter((one) => one.area === 'blindfold')
  const reachedList = ladder(store).filter((one) => one.passedStrict)
  const reached = reachedList.length ? reachedList[reachedList.length - 1].level : null
  return {
    attempts: store.attempts.length,
    strictAttempts: store.attempts.filter((one) => one.strict).length,
    calculation: {
      attempts: calc.length,
      solved: calc.filter((one) => one.passed).length,
      items: new Set(calc.map((one) => one.item)).size
    },
    blindfold: {
      attempts: blind.length,
      passed: blind.filter((one) => one.passed).length,
      levels: new Set(blind.filter((one) => one.passed && one.strict).map((one) => one.item)).size
    },
    reached,
    says: store.attempts.length === 0
      ? 'Nothing has been recorded yet.'
      : `${store.attempts.length} ${store.attempts.length === 1 ? 'attempt' : 'attempts'} kept on this computer, ${store.attempts.filter((one) => one.strict).length} of them with the board away.`
  }
}

/** An id for a new attempt. Time plus a counter, because two attempts can land in the same millisecond. */
let attemptSerial = 0
export function attemptId(now: number): string {
  attemptSerial = (attemptSerial + 1) % 100000
  return `a${Math.trunc(now).toString(36)}-${attemptSerial.toString(36)}`
}

// ---------------------------------------------------------------- the solution, for the feedback

export interface SolutionLine {
  san: readonly string[]
  /** The position after each move, so the feedback can walk it. */
  fens: readonly string[]
  text: string
}

/**
 * The exercise's answers written out, for after an attempt.
 *
 * Every branch, because an exercise with one answer and four defences has four lines and showing one of them would
 * suggest the other three were not answered.
 */
export function solutionLines(exercise: Exercise): SolutionLine[] {
  const out: SolutionLine[] = []
  const walk = (nodes: readonly MoveNode[], fen: string, san: string[], fens: string[]): void => {
    if (nodes.length === 0) {
      if (san.length) out.push({ san: [...san], fens: [...fens], text: writeLine(exercise.startFen, san) })
      return
    }
    for (const node of nodes) {
      const made = applyMove(fen, node.move)
      if (!made) continue
      walk(node.children ?? [], made.after, [...san, made.san], [...fens, made.after])
    }
  }
  walk(exercise.solution.lines, exercise.startFen, [], [])
  return out
}

/** A list of notation written out with move numbers, from the position it starts in. */
export function writeLine(startFen: string, san: readonly string[]): string {
  const first = moveNumber(startFen)
  const blackFirst = sideToMove(startFen) === 'b'
  const parts: string[] = []
  for (const [at, move] of san.entries()) {
    const offset = blackFirst ? at + 1 : at
    const number = first + Math.floor(offset / 2)
    if (offset % 2 === 0) parts.push(`${number}.${move}`)
    else if (at === 0) parts.push(`${number}...${move}`)
    else parts.push(move)
  }
  return parts.join(' ')
}

/** Whether a line of notation can be played from a position at all, for a screen that wants to offer "play it". */
export function playable(startFen: string, san: readonly string[]): boolean {
  const walk = enterLine(startFen, san)
  return walk.ok && walk.moves.length === san.length
}

export type { Comparison, LineEntry, ReadResult } from './calculation.ts'
export type { Exercise } from './exercise.ts'
export type { BlindQuestion, Placement, RecallScore, Tracking } from './blindfold.ts'
