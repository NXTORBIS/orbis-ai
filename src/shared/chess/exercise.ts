import type { Side } from './evaluation.ts'
import {
  applyMove, boardSquares, checkFen, destinationsFrom, legalMoves, outcome, positionKey,
  sideToMove as turnOf, type ChessMove, type PieceLetter
} from './rules.ts'

/**
 * What a chess exercise is, and whether it is real (Sections 202, 204).
 *
 * Everything the Academy, the puzzle trainer, the Calculation Gym and the blindfold trainer put in front of somebody
 * is one of these. One shape serves all of them because they are the same thing underneath: a position, something to
 * achieve from it, and the answers that achieve it.
 *
 * ## The rule this file exists for
 *
 * **A puzzle is not a puzzle until a machine has checked it.** A position typed in by hand, or produced by a model,
 * or read out of a file, is a *claim*: that the position is legal, that the moves can be played, and that playing
 * them does what the exercise says. Any of the three can be wrong, and all three are wrong silently -- a "mate in
 * two" that is really mate in three looks exactly like one that is right until somebody spends five minutes failing
 * to solve it and concludes they are bad at chess.
 *
 * So an exercise carries its own verification status, `newExercise` always stamps it **unverified**, and
 * `validateExercise` recomputes the answer from the position rather than believing what the record claims. An
 * exercise that says `verified` and does not survive the check comes back `rejected`.
 *
 * ## Many answers, not one
 *
 * The solution is a tree, not a line (Section 204). Positions often have two mates in one, and a trainer that
 * accepts only the move the author happened to write is telling a solver they are wrong when they are right. The
 * tree alternates: depth 0 is the solver's move, depth 1 is the opponent's reply, depth 2 is the solver again.
 * Siblings are alternatives.
 *
 * ## What "verified" can and cannot mean
 *
 * Rules alone settle some claims completely and others not at all, and the difference is written down rather than
 * blurred:
 *
 *   - `mate-in-n`     -- settled. Every defence must be listed and every line must end in checkmate, because one
 *                        unlisted reply is enough to make the claim false.
 *   - `win-material`  -- settled on the lines given, with a two-ply recapture check so a line cannot stop one move
 *                        before the material comes straight back. Coverage says whether every reply was listed.
 *   - `hold-draw`     -- settled when the line actually ends in a draw by the rules (stalemate, bare kings). A
 *                        position that is merely *holdable* needs a search, and says so.
 *   - `answer`        -- settled for the answer forms that are facts about the position (which squares a piece can
 *                        reach, how many pieces a side has). Free text needs a person.
 *   - `reconstruct`   -- settled: the final position must be the one the line actually reaches.
 *   - `find-best`     -- never settled here. "Best" is an engine's opinion, and this module does not have one.
 *
 * Pure: no clock of its own, no storage, no network. `now` is always passed in.
 */

// ---------------------------------------------------------------- the shape of an exercise

export type ExerciseKind = 'puzzle' | 'lesson-task' | 'calculation' | 'blindfold' | 'endgame' | 'recall'

export type Objective =
  /** Force checkmate in `movesToMate` of the solver's own moves. */
  | 'mate-in-n'
  /** Come out at least `materialAtLeast` centipawns ahead of where the position started. */
  | 'win-material'
  /** The engine's best move. Not decidable here, and marked as such. */
  | 'find-best'
  /** Reach a drawn position from a worse one. */
  | 'hold-draw'
  /** Play out a given line and arrive at the right position -- the blindfold and memory exercises. */
  | 'reconstruct'
  /** The answer is not a move: a square, a count, a list. */
  | 'answer'

/**
 * One move in the solution, and what may follow it.
 *
 * `move` is anything `applyMove` accepts -- "Nf3", "g1f3", "e7e8q" -- and is resolved against the position it is
 * attached to, never parsed on its own. Siblings are alternatives; at a solver's move they are different correct
 * answers, at the opponent's they are different defences.
 */
export interface MoveNode {
  move: string
  /** Said after the attempt, in a person's words. Never written by Orbis from the position. */
  why?: string
  children?: MoveNode[]
}

export interface Solution {
  /** Every accepted first move. More than one means the exercise really has more than one answer. */
  lines: MoveNode[]
}

/** What ends an attempt as a failure (Section 205). Nothing here is about how long somebody took to think. */
export type FailureCondition =
  /** A legal move that is not one of the answers. `allowed` is how many are forgiven before the attempt ends. */
  | { kind: 'wrong-moves'; allowed: number }
  /** The solver may play this many moves and no more. */
  | { kind: 'move-limit'; moves: number }
  /** Seconds of thinking time. Counted by the caller; this only records that there is a limit. */
  | { kind: 'time-limit'; seconds: number }

export const STRICT_FAILURE: readonly FailureCondition[] = Object.freeze([{ kind: 'wrong-moves' as const, allowed: 0 }])
export const FORGIVING_FAILURE: readonly FailureCondition[] = Object.freeze([{ kind: 'wrong-moves' as const, allowed: 2 }])

/**
 * What a hint shows, and what an attempt is still worth once it has been taken.
 *
 * The ladder is the Student one (`src/shared/student/practice.ts`) said in chess: where to look, then what to look
 * for, then which piece, then the move itself. A hint is not a punishment -- but an answer reached with the answer
 * on screen is not a solve, and recording it as one would put a lie in the training history.
 */
export type HintShows = 'theme' | 'target' | 'piece' | 'square' | 'move'

export const HINT_WORTH: Readonly<Record<HintShows, number>> = Object.freeze({
  theme: 0.85,
  target: 0.7,
  piece: 0.5,
  square: 0.3,
  move: 0
})

export interface ExerciseHint {
  /** 1 upward. Offered in order, one at a time. */
  level: number
  text: string
  shows: HintShows
}

/** Where an exercise came from. An exercise with no provenance is an exercise nobody can check (Section 202). */
export interface Provenance {
  kind: 'authored' | 'generated' | 'imported' | 'from-game'
  /** Who or what produced it: a person, a generator, a file, a model. */
  by?: string
  /** For a position lifted out of a game. */
  game?: { white?: string; black?: string; event?: string; date?: string; ply?: number }
  file?: string
  at?: number
  note?: string
}

export type Coverage =
  /** Every legal reply is accounted for, so the claim holds against any defence. */
  | 'complete'
  /** Only the replies written down were checked. True of the lines given, and silent about the rest. */
  | 'partial'
  /** Nothing to cover: the exercise is one move long, or is not about moves. */
  | 'none'

export interface Verification {
  status: 'unverified' | 'verified' | 'rejected'
  /** What did the checking. 'rules' is this module. An engine verdict would say so. */
  by?: 'rules'
  at?: number
  /** Why it is not verified: a search is needed, a person is needed, or it is broken. */
  needs?: 'engine' | 'review' | 'fixing'
  coverage?: Coverage
  /** Said plainly, so a rejected exercise can be fixed rather than guessed at. */
  problems?: readonly string[]
}

export const UNVERIFIED: Verification = Object.freeze({ status: 'unverified' as const, needs: 'review' as const })

/**
 * An answer that is not a move.
 *
 * Only the forms that are *facts about the position* can be checked here, and those are the ones worth authoring:
 * `destinations` is read straight out of `destinationsFrom`, `count` out of the board, `fen` out of the line. Free
 * text is kept because imported material has it, and it is never called verified.
 */
export type ExpectedAnswer =
  | { kind: 'fen'; fen: string }
  | { kind: 'destinations'; from: string; squares: string[] }
  | { kind: 'count'; of: 'all' | PieceLetter; side: Side; value: number }
  | { kind: 'text'; accepts: string[] }

export interface Exercise {
  id: string
  kind: ExerciseKind
  startFen: string
  /** Who solves it. Must be the side to move in `startFen`; a mismatch is a broken exercise, not a detail. */
  sideToMove: Side
  objective: Objective
  /** What the solver is asked, in words. */
  prompt: string
  /** The solver's own moves to mate, for 'mate-in-n'. */
  movesToMate?: number
  /** Centipawns, for 'win-material'. */
  materialAtLeast?: number
  solution: Solution
  /** For the objectives whose answer is not a move. */
  answer?: ExpectedAnswer
  failure: readonly FailureCondition[]
  hints: readonly ExerciseHint[]
  source: Provenance
  verification: Verification
  tags: readonly string[]
  /** A difficulty number if the source carried one. Never invented. */
  rating?: number
  /** Said after a solve: what the exercise was about. */
  lesson?: string
}

export interface NewExercise {
  id: string
  kind: ExerciseKind
  startFen: string
  objective: Objective
  prompt: string
  solution?: Solution
  movesToMate?: number
  materialAtLeast?: number
  answer?: ExpectedAnswer
  failure?: readonly FailureCondition[]
  hints?: readonly ExerciseHint[]
  source: Provenance
  tags?: readonly string[]
  rating?: number
  lesson?: string
}

/**
 * A new exercise, always unverified.
 *
 * There is deliberately no way to build one that claims to be verified: `verifyExercise` is the only thing that
 * stamps that, and it only does so after the check passes.
 */
export function newExercise(input: NewExercise): Exercise {
  return {
    id: input.id,
    kind: input.kind,
    startFen: input.startFen,
    sideToMove: turnOf(input.startFen),
    objective: input.objective,
    prompt: input.prompt,
    ...(input.movesToMate !== undefined ? { movesToMate: input.movesToMate } : {}),
    ...(input.materialAtLeast !== undefined ? { materialAtLeast: input.materialAtLeast } : {}),
    solution: input.solution ?? { lines: [] },
    ...(input.answer ? { answer: input.answer } : {}),
    failure: input.failure ?? STRICT_FAILURE,
    hints: input.hints ?? [],
    source: input.source,
    verification: UNVERIFIED,
    tags: input.tags ?? [],
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(input.lesson ? { lesson: input.lesson } : {})
  }
}

// ---------------------------------------------------------------- material

/**
 * What the pieces are worth, for counting what a line won.
 *
 * These are for settling a "wins a rook" claim, not for judging a position: there is no bishop pair here, no
 * compensation, no activity. A king is zero because it is never captured, not because it does not matter.
 */
export const PIECE_VALUE: Readonly<Record<PieceLetter, number>> = Object.freeze({ p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 })

// ---------------------------------------------------------------- positions that cannot happen

/**
 * Whether a position can be played from at all.
 *
 * `checkFen` accepts a position in which the side *not* to move is in check -- it is a legal arrangement of pieces,
 * just one no game can reach, because the player in check would have had to leave their king there. It matters more
 * than a curiosity: in such a position the move generator produces a capture of the king, and reading the position
 * after that capture throws, because a board with one king is not a board. So every entry point here that is handed
 * a position from outside asks this first, and refuses the position rather than crashing inside the rules.
 */
export function playablePosition(fen: string): { ok: boolean; reason?: string } {
  const basic = checkFen(fen)
  if (!basic.ok) return { ok: false, reason: basic.reason ?? 'This position is not legal.' }
  const fields = fen.trim().split(/\s+/)
  // The same board with the other side to move: if *they* are in check, the position cannot have arisen.
  const flipped = `${fields[0]} ${fields[1] === 'w' ? 'b' : 'w'} ${fields[2] ?? '-'} - 0 1`
  if (!checkFen(flipped).ok) {
    return { ok: false, reason: 'This position cannot be reached in a game.' }
  }
  const other = outcome(flipped)
  const inCheck = other.over ? other.reason === 'checkmate' : other.check
  if (inCheck) {
    return {
      ok: false,
      reason: `${fields[1] === 'w' ? 'Black' : 'White'} is in check, and it is ${fields[1] === 'w' ? 'White' : 'Black'} to move. No game can reach that.`
    }
  }
  return { ok: true }
}

/** What one side has on the board, in centipawns. */
export function materialFor(fen: string, side: Side): number {
  let total = 0
  for (const square of boardSquares(fen)) if (square.color === side) total += PIECE_VALUE[square.type]
  return total
}

/** How much better off `side` is than when the position started. Negative means they have lost ground. */
export function materialSwing(startFen: string, endFen: string, side: Side): number {
  const other: Side = side === 'w' ? 'b' : 'w'
  const before = materialFor(startFen, side) - materialFor(startFen, other)
  const after = materialFor(endFen, side) - materialFor(endFen, other)
  return after - before
}

// ---------------------------------------------------------------- walking the solution

export type ProblemCode =
  | 'no-id'
  | 'no-prompt'
  | 'bad-position'
  | 'side-mismatch'
  | 'already-over'
  | 'needs-mate-count'
  | 'needs-material-target'
  | 'needs-answer'
  | 'no-solution'
  | 'illegal-move'
  | 'duplicate-line'
  | 'dead-end'
  | 'line-continues-after-end'
  | 'opponent-ends-line'
  | 'incomplete-replies'
  | 'objective-not-met'
  | 'wrong-mate-count'
  | 'premature-end'
  | 'answer-wrong'
  | 'needs-engine'
  | 'needs-review'
  | 'hint-order'
  | 'hint-shows-move-early'
  | 'bad-failure'

export interface ExerciseProblem {
  code: ProblemCode
  /** A fault means the exercise is wrong. A caution means it is not wrong but cannot be called verified. */
  severity: 'fault' | 'caution'
  says: string
  /** Where in the solution it went wrong, when it was a move. */
  at?: { ply: number; move: string; fen: string; line: string[] }
}

export interface WalkedLine {
  san: readonly string[]
  uci: readonly string[]
  /** The position after each move. */
  fens: readonly string[]
  /** How it finishes, by the rules, with no history behind it. */
  endsIn: 'checkmate' | 'stalemate' | 'draw' | 'open'
  /** The solver's own moves in this line. */
  solverMoves: number
}

export interface ExerciseCheck {
  ok: boolean
  problems: readonly ExerciseProblem[]
  coverage: Coverage
  /** What the rules could settle about the objective. */
  objective: 'proved' | 'disproved' | 'needs-engine' | 'needs-review' | 'not-applicable'
  /** The verification this check earns. Use it; do not keep what the record claimed. */
  verification: Verification
  lines: readonly WalkedLine[]
}

interface Trail {
  san: string[]
  uci: string[]
  fens: string[]
}

const PIECE_NAME: Readonly<Record<PieceLetter, string>> = Object.freeze({
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
})

/** The squares a piece can really reach, one entry per square (a promotion is four moves to one square). */
function destinationSquares(fen: string, from: string): string[] {
  return [...new Set(destinationsFrom(fen, from).map((m) => m.to))].sort()
}

function countPieces(fen: string, side: Side, of: 'all' | PieceLetter): number {
  return boardSquares(fen).filter((s) => s.color === side && (of === 'all' || s.type === of)).length
}

/**
 * Whether an exercise is what it says it is.
 *
 * Reads nothing from `ex.verification` -- the point is to work the answer out again. Everything it finds is said in
 * a way that can be acted on: which move, in which line, and what the position actually does there.
 */
export function validateExercise(ex: Exercise, now?: number): ExerciseCheck {
  const problems: ExerciseProblem[] = []
  const lines: WalkedLine[] = []
  let complete = true
  let needsEngine = false
  let needsReview = false
  let deepestMate = 0

  const fault = (code: ProblemCode, says: string, at?: ExerciseProblem['at']): void => {
    problems.push({ code, severity: 'fault', says, ...(at ? { at } : {}) })
  }
  const caution = (code: ProblemCode, says: string, at?: ExerciseProblem['at']): void => {
    problems.push({ code, severity: 'caution', says, ...(at ? { at } : {}) })
  }

  // Whether this objective is about playing moves at all. Declared here because the early returns below report
  // through `finish`, which needs it.
  const movesWanted = ex.objective === 'mate-in-n' || ex.objective === 'win-material' || ex.objective === 'hold-draw' || ex.objective === 'find-best' || ex.objective === 'reconstruct'

  if (!ex.id.trim()) fault('no-id', 'An exercise with no id cannot be recorded against, so nothing could be learned from it.')
  if (!ex.prompt.trim()) fault('no-prompt', 'The exercise does not say what is being asked.')

  const fenCheck = playablePosition(ex.startFen)
  if (!fenCheck.ok) {
    fault('bad-position', `The starting position cannot be used: ${fenCheck.reason ?? 'it cannot be loaded.'}`)
    return finish()
  }

  const solver = turnOf(ex.startFen)
  if (ex.sideToMove !== solver) {
    fault('side-mismatch', `The exercise says ${ex.sideToMove === 'w' ? 'White' : 'Black'} solves it, but it is ${solver === 'w' ? 'White' : 'Black'} to move in the position.`)
  }

  const start = outcome(ex.startFen)
  if (movesWanted && start.over) {
    fault('already-over', `The position is already finished (${start.reason}), so there is nothing to play.`)
  }

  if (ex.objective === 'mate-in-n' && !(Number.isInteger(ex.movesToMate) && (ex.movesToMate as number) >= 1)) {
    fault('needs-mate-count', 'A mate exercise has to say in how many moves.')
  }
  if (ex.objective === 'win-material' && !(Number.isFinite(ex.materialAtLeast) && (ex.materialAtLeast as number) > 0)) {
    fault('needs-material-target', 'A material exercise has to say how much material, in centipawns.')
  }
  if ((ex.objective === 'answer' || ex.objective === 'reconstruct') && !ex.answer) {
    fault('needs-answer', 'The exercise asks for an answer and does not say what the answer is.')
  }
  if (movesWanted && ex.solution.lines.length === 0) {
    fault('no-solution', 'There is no solution recorded, so nothing could tell a solver whether they were right.')
  }

  for (const condition of ex.failure) {
    if (condition.kind === 'wrong-moves' && (!Number.isInteger(condition.allowed) || condition.allowed < 0)) {
      fault('bad-failure', 'The number of wrong moves forgiven has to be zero or more.')
    }
    if (condition.kind === 'move-limit' && (!Number.isInteger(condition.moves) || condition.moves < 1)) {
      fault('bad-failure', 'A move limit has to be at least one move.')
    }
    if (condition.kind === 'time-limit' && !(Number.isFinite(condition.seconds) && condition.seconds > 0)) {
      fault('bad-failure', 'A time limit has to be more than zero seconds.')
    }
  }

  // Hints: in order, and the move itself only at the end.
  const levels = ex.hints.map((h) => h.level)
  const ordered = levels.every((level, i) => level === i + 1)
  if (ex.hints.length > 0 && !ordered) {
    fault('hint-order', `Hints are offered one at a time, so their levels have to run 1, 2, 3 and so on. These are ${levels.join(', ')}.`)
  }
  for (const [i, hint] of ex.hints.entries()) {
    if (hint.shows === 'move' && i !== ex.hints.length - 1) {
      fault('hint-shows-move-early', `Hint ${hint.level} shows the move, so there is nothing left for the hints after it.`)
    }
    if (!hint.text.trim()) fault('hint-order', `Hint ${hint.level} has no text.`)
  }

  // ------------------------------------------------ the answer, when it is not a move

  if (ex.answer) {
    const a = ex.answer
    if (a.kind === 'destinations') {
      const real = destinationSquares(ex.startFen, a.from)
      const given = [...new Set(a.squares)].sort()
      const piece = boardSquares(ex.startFen).find((s) => s.square === a.from)
      if (!piece) {
        fault('answer-wrong', `The exercise asks about ${a.from}, and there is no piece there.`)
      } else if (piece.color !== solver) {
        fault('answer-wrong', `The ${PIECE_NAME[piece.type]} on ${a.from} belongs to the other side, so it cannot move now.`)
      }
      if (real.join(' ') !== given.join(' ')) {
        fault('answer-wrong', `The ${a.from} piece can reach ${real.length ? real.join(', ') : 'nowhere'}, but the answer says ${given.length ? given.join(', ') : 'nowhere'}.`)
      }
    } else if (a.kind === 'count') {
      const real = countPieces(ex.startFen, a.side, a.of)
      if (real !== a.value) {
        fault('answer-wrong', `${a.side === 'w' ? 'White' : 'Black'} has ${real} ${a.of === 'all' ? 'pieces' : `${PIECE_NAME[a.of]}s`} in this position, not ${a.value}.`)
      }
    } else if (a.kind === 'fen') {
      if (!checkFen(a.fen).ok) fault('answer-wrong', 'The position given as the answer is not a legal position.')
    } else {
      needsReview = true
      caution('needs-review', 'The answer is free text, which this module cannot check. Somebody has to read it.')
    }
  }

  // ------------------------------------------------ the solution tree

  const terminal = (fenAfter: string, trail: Trail, solverMoves: number): void => {
    const end = outcome(fenAfter)
    const endsIn: WalkedLine['endsIn'] = end.over ? (end.reason === 'checkmate' ? 'checkmate' : end.reason === 'stalemate' ? 'stalemate' : 'draw') : 'open'
    lines.push({ san: [...trail.san], uci: [...trail.uci], fens: [...trail.fens], endsIn, solverMoves })
    const where = { ply: trail.uci.length, move: trail.san[trail.san.length - 1] ?? '', fen: fenAfter, line: [...trail.san] }

    if (ex.objective === 'mate-in-n') {
      if (endsIn !== 'checkmate') {
        fault('objective-not-met', `The line ${trail.san.join(' ')} stops without mate -- the position after it is ${endsIn === 'open' ? 'simply a position' : endsIn}.`, where)
      } else {
        deepestMate = Math.max(deepestMate, solverMoves)
      }
      return
    }
    if (ex.objective === 'hold-draw') {
      if (end.over && end.result === '1/2-1/2') return
      needsEngine = true
      caution('needs-engine', `The line ${trail.san.join(' ')} ends in a position that is not yet a draw by the rules. Whether it holds needs a search, so this cannot be called verified.`, where)
      return
    }
    if (ex.objective === 'win-material') {
      const target = ex.materialAtLeast ?? 0
      const swing = materialSwing(ex.startFen, fenAfter, solver)
      if (swing < target) {
        fault('objective-not-met', `The line ${trail.san.join(' ')} ends ${swing} centipawns ahead, and the exercise claims at least ${target}.`, where)
        return
      }
      // A line that stops one move before the material comes back is the commonest authoring mistake. Look one
      // capture ahead, and then at the solver's recapture, because a protected capture is not a refutation.
      for (const reply of legalMoves(fenAfter)) {
        if (!reply.captured) continue
        if (materialSwing(ex.startFen, reply.after, solver) >= target) continue
        const saved = legalMoves(reply.after).some((again) => materialSwing(ex.startFen, again.after, solver) >= target)
        if (!saved) {
          fault('premature-end', `The line ${trail.san.join(' ')} stops too early: ${reply.san} takes the material straight back and there is no recapture.`, where)
          return
        }
      }
      return
    }
    if (ex.objective === 'reconstruct') {
      if (ex.answer?.kind === 'fen' && positionKey(ex.answer.fen) !== positionKey(fenAfter)) {
        fault('answer-wrong', `Playing ${trail.san.join(' ')} reaches a different position from the one given as the answer.`, where)
      }
      return
    }
    if (ex.objective === 'find-best') {
      needsEngine = true
      caution('needs-engine', 'Which move is best is an engine’s opinion. The moves here are legal, and nothing else about them has been checked.', where)
    }
  }

  const step = (node: MoveNode, fen: string, depth: number, trail: Trail): void => {
    const made = applyMove(fen, node.move)
    if (!made) {
      fault('illegal-move', `"${node.move}" cannot be played in the position it is attached to (after ${trail.san.length ? trail.san.join(' ') : 'the start'}).`, {
        ply: depth + 1, move: node.move, fen, line: [...trail.san]
      })
      return
    }
    const next: Trail = { san: [...trail.san, made.san], uci: [...trail.uci, made.uci], fens: [...trail.fens, made.after] }
    const isSolver = depth % 2 === 0
    const solverMoves = Math.floor(depth / 2) + (isSolver ? 1 : 0)
    const kids = node.children ?? []
    const end = outcome(made.after)

    if (isSolver) {
      if (kids.length === 0) {
        terminal(made.after, next, solverMoves)
        return
      }
      if (end.over) {
        fault('line-continues-after-end', `The line goes on after ${next.san.join(' ')}, and the game is already over there (${end.reason}).`, {
          ply: depth + 1, move: made.san, fen: made.after, line: [...next.san]
        })
        return
      }
      // Every defence, or an honest note that only some were checked.
      const replies = legalMoves(made.after)
      const listed = new Set<string>()
      for (const kid of kids) {
        const resolved = applyMove(made.after, kid.move)
        if (resolved) listed.add(resolved.uci)
      }
      const missing = replies.filter((r) => !listed.has(r.uci))
      if (missing.length > 0) {
        complete = false
        const says = `After ${next.san.join(' ')} the opponent has ${replies.length} legal ${replies.length === 1 ? 'reply' : 'replies'} and the solution answers ${replies.length - missing.length}. Unanswered: ${missing.slice(0, 6).map((m) => m.san).join(', ')}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''}.`
        const where = { ply: depth + 1, move: made.san, fen: made.after, line: [...next.san] }
        if (ex.objective === 'mate-in-n' || ex.objective === 'hold-draw') fault('incomplete-replies', says, where)
        else caution('incomplete-replies', says, where)
      }
      for (const kid of kids) step(kid, made.after, depth + 1, next)
      return
    }

    // The opponent has just moved.
    if (end.over) {
      if (ex.objective === 'hold-draw' && end.result === '1/2-1/2') {
        lines.push({ san: [...next.san], uci: [...next.uci], fens: [...next.fens], endsIn: end.reason === 'stalemate' ? 'stalemate' : 'draw', solverMoves })
        return
      }
      fault('opponent-ends-line', `The defence ${next.san.join(' ')} ends the game (${end.reason}), so the solver never gets to finish the exercise.`, {
        ply: depth + 1, move: made.san, fen: made.after, line: [...next.san]
      })
      lines.push({ san: [...next.san], uci: [...next.uci], fens: [...next.fens], endsIn: end.reason === 'checkmate' ? 'checkmate' : end.reason === 'stalemate' ? 'stalemate' : 'draw', solverMoves })
      return
    }
    if (kids.length === 0) {
      // A line to play out may stop on either side's move: the answer is the position the whole line reaches.
      if (ex.objective === 'reconstruct') {
        terminal(made.after, next, solverMoves)
        return
      }
      fault('dead-end', `The solution stops after the defence ${next.san.join(' ')}, with the solver to move and nothing recorded for them to play.`, {
        ply: depth + 1, move: made.san, fen: made.after, line: [...next.san]
      })
      lines.push({ san: [...next.san], uci: [...next.uci], fens: [...next.fens], endsIn: 'open', solverMoves })
      return
    }
    for (const kid of kids) step(kid, made.after, depth + 1, next)
  }

  const rootSeen = new Set<string>()
  for (const line of ex.solution.lines) {
    const resolved = applyMove(ex.startFen, line.move)
    if (resolved) {
      if (rootSeen.has(resolved.uci)) {
        fault('duplicate-line', `${resolved.san} is given twice as a first move, so one of the two branches can never be reached.`)
        continue
      }
      rootSeen.add(resolved.uci)
    }
    step(line, ex.startFen, 0, { san: [], uci: [], fens: [] })
  }

  if (ex.objective === 'mate-in-n' && ex.movesToMate !== undefined && lines.length > 0 && deepestMate > 0 && deepestMate !== ex.movesToMate) {
    fault('wrong-mate-count', `The longest line mates in ${deepestMate}, and the exercise says mate in ${ex.movesToMate}.`)
  }

  return finish()

  function finish(): ExerciseCheck {
    const faults = problems.filter((p) => p.severity === 'fault')
    const ok = faults.length === 0
    const coverage: Coverage = !movesWanted || lines.length === 0
      ? 'none'
      : complete ? 'complete' : 'partial'

    const settled: ExerciseCheck['objective'] = !ok
      ? 'disproved'
      : needsEngine
        ? 'needs-engine'
        : needsReview
          ? 'needs-review'
          : ex.objective === 'answer' || ex.objective === 'reconstruct' || ex.objective === 'mate-in-n' || ex.objective === 'win-material' || ex.objective === 'hold-draw'
            ? 'proved'
            : 'not-applicable'

    const verification: Verification = !ok
      ? {
          status: 'rejected',
          by: 'rules',
          ...(now !== undefined ? { at: now } : {}),
          needs: 'fixing',
          coverage,
          problems: faults.map((p) => p.says)
        }
      : needsEngine || needsReview
        ? {
            status: 'unverified',
            by: 'rules',
            ...(now !== undefined ? { at: now } : {}),
            needs: needsEngine ? 'engine' : 'review',
            coverage,
            problems: problems.map((p) => p.says)
          }
        : {
            status: 'verified',
            by: 'rules',
            ...(now !== undefined ? { at: now } : {}),
            coverage,
            ...(problems.length ? { problems: problems.map((p) => p.says) } : {})
          }

    return { ok, problems, coverage, objective: settled, verification, lines }
  }
}

/**
 * The same exercise with its verification worked out rather than claimed.
 *
 * This is the only way an exercise becomes `verified`. An exercise that arrived claiming to be verified and does not
 * survive the check comes back `rejected`, with the reasons attached.
 */
export function verifyExercise(ex: Exercise, now?: number): { exercise: Exercise; check: ExerciseCheck } {
  const check = validateExercise(ex, now)
  return { exercise: { ...ex, verification: check.verification }, check }
}

/** Whether this may be put in front of somebody as a checked exercise. */
export function isVerified(ex: Exercise): boolean {
  return ex.verification.status === 'verified'
}

/** What to say about an exercise's status, for a screen that must never imply more than is known. */
export function sayVerification(v: Verification): string {
  if (v.status === 'verified') {
    if (v.coverage === 'partial') return 'Checked: every move is legal and the lines given do what the exercise says. Only those lines were checked.'
    if (v.coverage === 'none') return 'Checked against the position itself.'
    return 'Checked: legal, and it does what it says against every defence.'
  }
  if (v.status === 'rejected') return `Not usable: ${v.problems?.[0] ?? 'it did not pass the check.'}`
  if (v.needs === 'engine') return 'Not checked: settling this one needs an engine.'
  return 'Not checked yet.'
}

// ---------------------------------------------------------------- following a line through the tree

export interface Follow {
  /** The position after the moves that could be played. */
  fen: string
  /** The resolved moves, in order, up to the first one that could not be played. */
  moves: readonly ChessMove[]
  /** The first move that is not legal in the position it was played in. */
  illegalAt: number | null
  /** The first move that is legal but is not in the recorded lines. */
  divergedAt: number | null
  /** What the tree accepts next, where the matched part ended. */
  accepted: readonly MoveNode[]
  /** The node the matched part ended on, or null at the root. */
  node: MoveNode | null
  /** Whose move it is where the matched part ended. */
  turn: 'solver' | 'opponent'
  /** True when the matched part reached the end of a recorded line. */
  lineComplete: boolean
}

/**
 * Walking a played sequence through the solution tree.
 *
 * One primitive, used by judging, by the Calculation Gym and by the Academy, so all three agree about what "wrong"
 * means. It keeps the two questions apart: whether a move can be played at all, and whether it is one of the
 * answers. `illegalAt` is the first; `divergedAt` is the second.
 */
export function follow(ex: Exercise, played: readonly string[]): Follow {
  let fen = ex.startFen
  let accepted: MoveNode[] = [...ex.solution.lines]
  let node: MoveNode | null = null
  const moves: ChessMove[] = []
  let divergedAt: number | null = null

  for (const [i, text] of played.entries()) {
    const made = applyMove(fen, text)
    if (!made) {
      return {
        fen, moves, illegalAt: i, divergedAt, accepted, node,
        turn: i % 2 === 0 ? 'solver' : 'opponent',
        lineComplete: false
      }
    }
    moves.push(made)
    fen = made.after
    if (divergedAt === null) {
      const match = accepted.find((candidate) => {
        const resolved = applyMove(made.before, candidate.move)
        return resolved?.uci === made.uci
      })
      if (match) {
        node = match
        accepted = [...(match.children ?? [])]
      } else {
        divergedAt = i
        accepted = []
      }
    }
  }

  return {
    fen,
    moves,
    illegalAt: null,
    divergedAt,
    accepted,
    node,
    turn: played.length % 2 === 0 ? 'solver' : 'opponent',
    lineComplete: divergedAt === null && node !== null && accepted.length === 0
  }
}

/** The moves the tree accepts at the start, written out for the position. */
export function firstMoves(ex: Exercise): ChessMove[] {
  const out: ChessMove[] = []
  for (const line of ex.solution.lines) {
    const made = applyMove(ex.startFen, line.move)
    if (made) out.push(made)
  }
  return out
}

// ---------------------------------------------------------------- building verified mate exercises

export interface MateSearch {
  /** Every first move that forces mate within the number asked, with every defence answered. */
  solution: Solution | null
  /** How many positions were looked at. */
  nodes: number
  /** True when the search ran out of budget, in which case `solution` says nothing. */
  exceeded: boolean
}

/**
 * The forced mates in a position, as a complete solution tree.
 *
 * This is how a mate puzzle gets made rather than asserted: the tree comes out of a search over the real rules, so
 * every defence is in it by construction and `validateExercise` has something it can actually prove. The search is
 * exhaustive and therefore cheap only for one and two movers on a sparse board -- `budget` caps it, and running out
 * returns nothing rather than a half-searched answer that would look like a finding.
 *
 * Deeper in the tree one answer per defence is kept. Alternatives are kept at the root, because that is where a
 * solver is entitled to find a different mate from the one the author had in mind.
 */
export function forcedMateTree(fen: string, moves: number, budget = 300_000): MateSearch {
  if (!playablePosition(fen).ok || !Number.isInteger(moves) || moves < 1) return { solution: null, nodes: 0, exceeded: false }
  let nodes = 0
  let exceeded = false

  const search = (position: string, left: number, keepAll: boolean): MoveNode[] => {
    const found: MoveNode[] = []
    for (const move of legalMoves(position)) {
      if (exceeded) return []
      nodes += 1
      if (nodes > budget) { exceeded = true; return [] }
      if (move.checkmate) {
        found.push({ move: move.uci })
        if (!keepAll) return found
        continue
      }
      if (left <= 1) continue
      const replies = legalMoves(move.after)
      // No replies and not mate is stalemate: the opposite of what is wanted.
      if (replies.length === 0) continue
      const kids: MoveNode[] = []
      let forced = true
      for (const reply of replies) {
        const answers = search(reply.after, left - 1, false)
        if (exceeded) return []
        if (answers.length === 0) { forced = false; break }
        kids.push({ move: reply.uci, children: [answers[0]] })
      }
      if (!forced) continue
      found.push({ move: move.uci, children: kids })
      if (!keepAll) return found
    }
    return found
  }

  const lines = search(fen, moves, true)
  if (exceeded) return { solution: null, nodes, exceeded: true }
  return { solution: lines.length ? { lines } : null, nodes, exceeded: false }
}

/** Whether a mate exists in this many moves at all. Used to tell a mate in two from a mate in one dressed up. */
export function hasMateIn(fen: string, moves: number, budget = 300_000): boolean {
  return forcedMateTree(fen, moves, budget).solution !== null
}
