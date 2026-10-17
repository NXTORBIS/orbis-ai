import { fenAt, type StoredGame } from './model.ts'
import { legalMoves, moveNumber, sideToMove, uciLineToSan } from './rules.ts'
import { materialSwing } from './exercise.ts'
import {
  CLASS_LABEL, forSide, formatScore,
  type MoveClass, type Score, type Side
} from './evaluation.ts'
import {
  buildReport, writeLine,
  type AnalysisReport, type AnalysisSession, type GraphPoint, type PositionEval, type ReportOptions
} from './analysis.ts'
import { recordFor } from './openings.ts'
import { ACCURACY_FORMULA } from './progress.ts'
import { EVIDENCE, type AnalysedGame, type AnalysedMove } from './coach.ts'

/**
 * Going over a finished game: how well each side played, what each move was, and the moments that decided it
 * (Sections 111-120).
 *
 * This is the walk-through a person wants after a game. It is built on top of what already measures a game rather
 * than beside it: `buildReport` in analysis.ts does the evaluations, the graph and the per-move judgement, and
 * nothing here recalculates any of that. What is added is the four things a report does not have -- an accuracy
 * figure per side, the two best-move awards, the moves that were theory rather than discovery, and the moments the
 * evaluation really moved.
 *
 * ## Four rules, which are the whole design
 *
 *   - **A name needs the evidence for that name.** `classify` returns `unclear` when the search was too shallow to
 *     tell a good move from an inaccuracy, and every row here carries the depth its name rests on. An award is a
 *     bigger claim than a class, so it needs more: the engine's own ranked alternatives, searched to one depth, with
 *     no bound among them. Without those the award question is not answered wrongly, it is left unanswered.
 *
 *   - **Accuracy is a share of what was judged, never of the whole game.** A sweep that covered half the moves gives
 *     an accuracy for that half and says so in the same breath. It is never scaled up to the rest, because the moves
 *     nobody searched are not known to be like the ones that were.
 *
 *   - **A moment is measured, not chosen.** The key moments come off the graph: the height of the line is what moved
 *     or did not, and the moves where it moved most are the moments. There is no rule here about move numbers, no
 *     "look at move 20", and no moment at all across a stretch nobody analysed -- that stretch is reported as a
 *     place where a moment could be hiding.
 *
 *   - **Theory is not discovery.** A move that reaches a named position in the opening dataset is called Book, so
 *     the first eight moves of a Caro-Kann do not read as eight excellent finds.
 *
 * Pure: no engine, no clock, no store. Everything is a function of the game and the evaluations handed in.
 */

// ---------------------------------------------------------------- the two awards, written down

export type Award = 'brilliant' | 'great'

/**
 * The thresholds the awards rest on.
 *
 * These are the definition, not a tuning knob: they are shown on screen beside the awards, so what the screen claims
 * and what the code checks are the same sentence.
 */
export const AWARD_RULES = Object.freeze({
  /** At or above this, from the mover's own side, the position is still being held. Below it, it is materially lost. */
  holdCp: -100,
  /** The engine's next-best move has to be at least this much worse. A 20-centipawn gap is not holding versus losing. */
  gapCp: 150,
  /** Material down, at the lowest point of the engine's own line, before the move counts as giving material up. */
  sacrificeCp: 100,
  /** Lines the engine must have ranked at this position before the question can be asked at all. */
  linesNeeded: 2
})

export const GREAT_RULE =
  'Great: the only move that holds the position. The engine\'s own first choice, with the position still level or '
  + `better for you after it (not worse than ${(AWARD_RULES.holdCp / -100).toFixed(2)} of a pawn down), while its next-best move is `
  + `materially lost and at least ${(AWARD_RULES.gapCp / 100).toFixed(2)} of a pawn worse. The engine ranks its lines, so the second line being lost `
  + 'means every other move is at least as bad -- which is what makes "only move" something that can be checked '
  + 'rather than felt.'

export const BRILLIANT_RULE =
  'Brilliant: a Great move that gives material up to do it. Material is counted along the engine\'s own line from '
  + `that position; if you are at least ${(AWARD_RULES.sacrificeCp / 100).toFixed(2)} of a pawn down at the lowest point of it, the move gave material up.`

export const AWARD_NOTES: readonly string[] = Object.freeze([
  'Both awards need the engine to have ranked at least two moves in the position, both searched to the same depth, '
    + 'with neither score still a bound. Short of that the question is left open rather than answered.',
  'A position with one legal move is never an award. Finding the only move there was says nothing.',
  'Neither award changes the accuracy figure. Both are the engine\'s own first choice, so they already count with '
    + 'the best moves.'
])

/** One of the engine's ranked lines at a position. `multipv` is 1 for its first choice. */
export interface CandidateLine {
  multipv: number
  /** White-positive, as every score in Orbis is. */
  score: Score
  depth: number | null
  /** The line in the engine's own coordinates, its first move first. */
  pvUci: string[]
  /** True when the engine only gave a bound for this line, so the number is not settled. */
  provisional?: boolean
}

/** What the engine ranked at one position of the game. `ply` 0 is the position before the first move. */
export interface PositionLines {
  ply: number
  fen: string
  lines: CandidateLine[]
}

export interface AwardVerdict {
  award: Award | null
  /**
   * True when the evidence settled the question, either way. False means it could not be asked -- and then `award`
   * being null is not "no award", it is "not known".
   */
  settled: boolean
  /** Why, in words, including why it could not be asked. */
  why: string
  /** The depth the verdict rests on. Null when there was no verdict. */
  depth: number | null
  /** Centipawns of material down at the lowest point of the engine's line. Null when it was not measured. */
  gaveUp: number | null
}

const unsettled = (why: string): AwardVerdict => ({ award: null, settled: false, why, depth: null, gaveUp: null })
const settledNo = (why: string, depth: number | null): AwardVerdict => ({ award: null, settled: true, why, depth, gaveUp: null })

/** Is the position still being held, from this side's point of view? */
function holds(seen: Score): boolean {
  if (seen.kind === 'none') return false
  if (seen.kind === 'mate') return seen.moves > 0
  return seen.cp >= AWARD_RULES.holdCp
}

const pawns = (cp: number): string => `${(Math.abs(cp) / 100).toFixed(2)} of a pawn`

/**
 * Was this the only move -- and did it cost material?
 *
 * The argument the verdict rests on, because it is the part that is easy to get wrong: a MultiPV search ranks its
 * lines, best first. So if the second line is materially lost, every move outside the top two is at least as bad as
 * the second line and is lost too. That is what lets two lines settle a claim about every alternative. It only holds
 * while the lines are comparable, which is why they must share a depth and none of them may still be a bound -- a
 * line from a finished iteration and a line from an unfinished one are not on one list.
 */
export function judgeAward(
  played: { uci: string },
  at: PositionLines,
  options: { minDepth?: number } = {}
): AwardVerdict {
  const minDepth = options.minDepth ?? 8
  const legal = legalMoves(at.fen)
  if (legal.length === 0) return settledNo('There are no legal moves in this position.', null)
  if (legal.length === 1) return settledNo('There was only one legal move here, so finding it says nothing.', null)

  const ranked = [...at.lines].sort((a, b) => a.multipv - b.multipv)
  const first = ranked.find((line) => line.multipv === 1) ?? null
  const second = ranked.find((line) => line.multipv > 1) ?? null
  if (!first) return unsettled('The engine gave no first choice in this position, so there is nothing to rank against.')
  if (!first.pvUci.length) return unsettled('The engine\'s first choice here came with no line, so the move cannot be compared with it.')

  const top = first.pvUci[0].toLowerCase()
  if (top !== played.uci.toLowerCase()) {
    return settledNo('The engine would have played something else here, so this is not the only move that holds.', first.depth)
  }
  if (!second) {
    return unsettled(
      `Only one line was searched here, and ${AWARD_RULES.linesNeeded} are needed: whether every other move loses cannot be said from one.`
    )
  }
  if (first.provisional || second.provisional) {
    return unsettled('One of the two lines was still a bound rather than a settled number, so they cannot be ranked against each other.')
  }
  if (first.depth === null || second.depth === null) {
    return unsettled('The depth of one of the lines was not recorded, so there is no way to know the two can be compared.')
  }
  if (first.depth !== second.depth) {
    return unsettled(
      `The two lines were searched to different depths (${first.depth} and ${second.depth}), so the engine's ranking of them cannot be relied on.`
    )
  }
  if (first.depth < minDepth) {
    return unsettled(`Searched only ${first.depth} deep, which is not enough to call a move the only one; ${minDepth} is the least that would be.`)
  }

  const mover = sideToMove(at.fen)
  const best = forSide(first.score, mover)
  const next = forSide(second.score, mover)
  const depth = first.depth
  if (best.kind === 'none' || next.kind === 'none') {
    return unsettled('One of the two lines came back without a score, so they cannot be compared.')
  }
  if (!holds(best)) {
    return settledNo('This move does not hold the position either, so there was nothing here to hold on to.', depth)
  }
  if (holds(next)) {
    return settledNo('Another move holds the position too, so this was not the only one.', depth)
  }
  // Both ordinary numbers: the gap has to be the difference between holding and losing, not a rounding of it. When a
  // forced mate sits on either side there is no gap to measure and none is needed -- a mate for the mover beats any
  // centipawn score, and a mate against them is as lost as a position gets.
  if (best.kind === 'cp' && next.kind === 'cp') {
    const gap = best.cp - next.cp
    if (gap < AWARD_RULES.gapCp) {
      return settledNo(
        `The next-best move is only ${pawns(gap)} worse, which is not the difference between holding the position and losing it.`,
        depth
      )
    }
  }

  const held = best.kind === 'mate' ? `a forced mate in ${Math.abs(best.moves)}` : formatScore(first.score, mover)
  const lost = next.kind === 'mate' ? `a forced mate against you in ${Math.abs(next.moves)}` : formatScore(second.score, mover)
  const only = `The only move that holds here: this keeps ${held}, and the engine's next-best move leaves ${lost}. Searched ${depth} deep.`

  // The sacrifice is measured along the engine's own line, not guessed from the move. A capture-free move can give a
  // piece up two moves later, and a capture can win material back, so the only honest place to look is the line.
  const walked = uciLineFens(at.fen, first.pvUci)
  if (!walked.legal || walked.fens.length < 2) {
    return {
      award: 'great',
      settled: true,
      why: `${only} Whether it gives material up could not be checked: the engine's line is too short to see the reply to it.`,
      depth,
      gaveUp: null
    }
  }
  let worst = 0
  for (const fen of walked.fens) worst = Math.min(worst, materialSwing(at.fen, fen, mover))
  const gaveUp = worst < 0 ? -worst : 0
  if (gaveUp >= AWARD_RULES.sacrificeCp) {
    return {
      award: 'brilliant',
      settled: true,
      why: `${only} And it gives material up to do it: ${pawns(gaveUp)} down at the lowest point of the engine's own line.`,
      depth,
      gaveUp
    }
  }
  return {
    award: 'great',
    settled: true,
    why: `${only} No material is given up for it${gaveUp > 0 ? ` -- ${pawns(gaveUp)} at the lowest point, which is not a sacrifice` : ''}.`,
    depth,
    gaveUp
  }
}

/**
 * Walking a line of engine coordinates out, keeping the position after each move.
 *
 * The walk itself is `uciLineToSan` in rules.ts, because that is the module that knows what a move does. A line with
 * an unplayable move in it comes back as not legal and is not used for anything.
 */
function uciLineFens(fen: string, uciMoves: string[]): { fens: string[]; legal: boolean } {
  const read = uciLineToSan(fen, uciMoves)
  return { fens: read.fens, legal: read.legal }
}

// ---------------------------------------------------------------- book moves

export interface BookMove {
  /** The move's own ply: 1 is the first move of the game. */
  ply: number
  san: string
  eco: string
  name: string
}

export interface BookRun {
  /** The moves that were still theory, in order. Empty when the game left the dataset at once. */
  moves: BookMove[]
  /** The last named position reached, which is what the opening is called. Null when none was. */
  last: BookMove | null
  /** The ply the game left theory on, or null when it never did (every move looked at was in the dataset). */
  leftAt: number | null
  /** That move, written as a move list writes it ("7.Nf3"). Null when the game never left theory. */
  leftLabel: string | null
  says: string
}

export const BOOK_RULE =
  'Book: the move reached a position the opening dataset names. The run stops at the first move that does not, even '
  + 'if a later position happens to be named -- once a game has left theory, coming back to it was not theory either.'

/**
 * How far the game stayed in the opening dataset.
 *
 * Asked position by position, because a name belongs to a position and not to a move list -- which is also what
 * makes a transposition name itself with no special handling. A game set up from a position rather than played from
 * the start has no book run unless that position itself is named.
 */
export function bookRun(game: Pick<StoredGame, 'startFen' | 'moves'>, limit = 40): BookRun {
  const moves: BookMove[] = []
  let leftAt: number | null = null
  for (let ply = 1; ply <= Math.min(game.moves.length, limit); ply++) {
    const move = game.moves[ply - 1]
    const record = recordFor(move.fen)
    if (!record) {
      leftAt = ply
      break
    }
    moves.push({ ply, san: move.san, eco: record.eco, name: record.name })
  }
  const last = moves.length ? moves[moves.length - 1] : null
  const leftLabel = leftAt === null ? null : moveLabel(game, leftAt)
  const says = !moves.length
    ? leftAt === 1
      ? 'The first move is not in the opening dataset, so no move of this game is called Book.'
      : 'This game has no moves to look up.'
    : `${moves.length} ${moves.length === 1 ? 'move was' : 'moves were'} still theory: ${last?.eco} ${last?.name}.`
      + (leftLabel === null
        ? ' Every move looked at was in the dataset.'
        : ` The game left the dataset at ${leftLabel}.`)
  return { moves, last, leftAt, leftLabel, says }
}

function moveLabel(game: Pick<StoredGame, 'startFen' | 'moves'>, ply: number): string {
  const fenBefore = fenAt(game, ply - 1)
  const number = moveNumber(fenBefore)
  const side = sideToMove(fenBefore)
  const move = game.moves[ply - 1]
  return `${number}${side === 'w' ? '.' : '…'}${move ? move.san : '?'}`
}

// ---------------------------------------------------------------- accuracy, per side

/** The classes that count as a move played well. The same three the formula names, and nothing else. */
export const GOOD_CLASSES: readonly MoveClass[] = Object.freeze(['best', 'excellent', 'good'])

export const REVIEW_ACCURACY_NOTES: readonly string[] = Object.freeze([
  'Moves the engine could not judge are left out of both halves of the division and counted separately, rather than '
    + 'being treated as mistakes.',
  'A game that was only partly analysed gives an accuracy for the part that was analysed. It is never scaled up to '
    + 'the rest: the moves nobody searched are not known to be like the ones that were.',
  'Brilliant and Great are the engine\'s own first choice, so they are already counted with the best moves.',
  'A Book move keeps whatever the engine called it. Being theory changes what the move is called on screen, not what '
    + 'it was worth.',
  'It is a share of moves, not a measure of strength. A quiet game of obvious moves scores higher than a hard one '
    + 'played well, and it can only be compared with another game analysed by the same engine to the same depth.'
])

export interface SideAccuracy {
  side: Side
  /** 0..1, or null when not one move of that side could be judged. */
  value: number | null
  good: number
  judged: number
  unjudged: number
  /** That side's moves in the game, judged or not. */
  moves: number
  /** The depths the judged moves rest on. More than one means the figure mixes measurements. */
  depths: number[]
  /** True only when every one of that side's moves was judged. */
  whole: boolean
  formula: string
  notes: readonly string[]
  says: string
}

/**
 * One side's accuracy, over the moves that were judged.
 *
 * The formula is imported rather than restated: `ACCURACY_FORMULA` in progress.ts is both the definition and the
 * sentence shown beside the number, so the figure and its explanation cannot drift apart.
 */
export function sideAccuracy(rows: readonly ReviewMove[], side: Side): SideAccuracy {
  let good = 0
  let judged = 0
  let unjudged = 0
  let moves = 0
  const depths = new Set<number>()
  for (const row of rows) {
    if (row.mover !== side) continue
    moves += 1
    if (row.klass === 'unclear') {
      unjudged += 1
      continue
    }
    judged += 1
    if (row.depth !== null) depths.add(row.depth)
    if (GOOD_CLASSES.includes(row.klass)) good += 1
  }
  const value = judged ? good / judged : null
  const sorted = [...depths].sort((a, b) => a - b)
  const whole = moves > 0 && unjudged === 0
  const name = side === 'w' ? 'White' : 'Black'
  const says = value === null
    ? moves === 0
      ? `${name} has no moves in this game.`
      : `None of ${name}'s ${moves} moves could be judged, so there is no accuracy figure for ${name}.`
    : `${Math.round(value * 100)} per cent: ${good} of ${judged} of ${name}'s moves the engine could judge.`
      + (unjudged
        ? ` ${unjudged} of ${name}'s ${moves} moves ${unjudged === 1 ? 'was' : 'were'} not judged, so this is the accuracy of the part of the game that was analysed, not of the whole game.`
        : ` That is every one of ${name}'s moves.`)
      + (sorted.length > 1 ? ` The judged moves were searched to different depths (${sorted.join(', ')}), so the figure mixes measurements.` : '')
      + (sorted.length === 1 ? ` Searched ${sorted[0]} deep.` : '')
  return { side, value, good, judged, unjudged, moves, depths: sorted, whole, formula: ACCURACY_FORMULA, notes: REVIEW_ACCURACY_NOTES, says }
}

// ---------------------------------------------------------------- the moments that decided it

/** How far the graph has to move at one move for it to be a moment. */
export const MOMENT_MOVE = 0.1

export const MOMENT_RULE =
  `A key moment is a move where the graph moved at least ${Math.round(MOMENT_MOVE * 100)} per cent of its own height. `
  + 'That is about a pawn while the game is level, and more than a pawn once one side is far ahead -- which is right, '
  + 'because a change from four pawns up to five decides nothing. A move is not measured at all unless the position '
  + 'on both sides of it was analysed, deeply enough to judge a move, with a settled number rather than a bound. A '
  + 'move that puts a forced mate on the board moves the graph to the end of its scale and is reported with no '
  + 'centipawn figure, because there is not one.'

export interface KeyMoment {
  ply: number
  san: string
  mover: Side
  /** The move number, for showing "23…Nf3". */
  number: number
  before: Score
  after: Score
  /** How far the graph moved here, 0..1 of its height. What the moments are ranked on. */
  moved: number
  /** The same change in centipawns, when both scores were ordinary numbers. Null when a mate is on either side. */
  movedCp: number | null
  /** The side the change favoured. */
  gained: Side
  /** The depth behind it: the shallower of the two searches. */
  depth: number
  /**
   * What the engine called the move. `unclear` here does not mean the swing is in doubt -- it means there is no
   * centipawn number for it, which is what happens when a forced mate appears on one side of the move.
   */
  klass: MoveClass
  /** What the engine would have played instead, when it named a different move. */
  better?: { uci: string; san: string | null }
  /** The engine's line from the position before the move, written out. Empty when there was none to write. */
  line: string
  explain: string
}

export interface KeyMoments {
  moments: KeyMoment[]
  /** Moments past the number asked for, so nothing is dropped silently. */
  more: number
  /** Moves the graph could be measured across. */
  measured: number
  /** Moves it could not, counted by what stopped it. */
  unmeasured: { notAnalysed: number; tooShallow: number; unsettled: number }
  threshold: number
  rule: string
  says: string
}

// ---------------------------------------------------------------- a move, as the review shows it

export interface ReviewMove {
  ply: number
  san: string
  uci: string
  mover: Side
  number: number
  /** The position the move was played in. Carried so a screen can show the board here without replaying the game. */
  fenBefore: string
  before: Score | null
  after: Score | null
  loss: number | null
  /** What the engine called it, exactly as `classify` gave it. This is what the accuracy figure counts. */
  klass: MoveClass
  /** The depth that judgement rests on. Null when it is not known -- and then the move is not judged. */
  depth: number | null
  why: string
  analysed: boolean
  better?: { uci: string; san: string | null }
  /** Brilliant or Great, when the engine's own ranked lines established it. Null when they did not, or could not. */
  award: Award | null
  /** False when the award question could not be asked at all. Then `award: null` means "not known". */
  awardSettled: boolean
  awardWhy: string
  /** Material down at the lowest point of the engine's line, in centipawns. Null when it was not measured. */
  gaveUp: number | null
  /** The opening the position after this move is named as, while the game was still in theory. */
  book: { eco: string; name: string } | null
  /** What the screen calls this move. */
  label: string
}

export interface ReviewCounts {
  /** The engine's own classes, every one of them, including the moves it would not name. */
  classes: Record<MoveClass, number>
  brilliant: number
  great: number
  book: number
  /** Moves where the award question could not be asked. */
  awardUnknown: number
  moves: number
}

export interface NextStep {
  /** The position it came from, so a step is always something that really happened in this game. */
  ply: number
  what: string
}

export interface GameReview {
  gameId: string
  /** The report everything here is built on, so a screen can show both without measuring the game twice. */
  report: AnalysisReport
  moves: ReviewMove[]
  accuracy: Record<Side, SideAccuracy>
  counts: Record<Side, ReviewCounts>
  key: KeyMoments
  book: BookRun
  /** How the award question went across the game. */
  awards: { asked: number; settled: number; unknown: number; notLookedAt: number; says: string }
  /** What to do next, drawn from the positions in this game and nothing else. Empty when nothing was found. */
  nextSteps: NextStep[]
  /** The rules on screen beside the numbers, so what is claimed and what was checked are the same sentence. */
  rules: readonly string[]
  says: string
}

export interface GameReviewOptions extends ReportOptions {
  /** The engine's ranked lines, by position. Without them no move can be called Brilliant or Great. */
  alternatives?: readonly PositionLines[]
  /** How many key moments to show. The rest are counted. */
  maxMoments?: number
  /** How far the graph has to move for a moment. */
  momentMove?: number
  /** How far into the game to look moves up in the opening dataset. */
  bookLimit?: number
}

const EMPTY_CLASSES = (): Record<MoveClass, number> => ({
  best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, 'missed-mate': 0, unclear: 0
})

const emptyCounts = (): ReviewCounts => ({ classes: EMPTY_CLASSES(), brilliant: 0, great: 0, book: 0, awardUnknown: 0, moves: 0 })

/**
 * The whole review.
 *
 * It takes the game and the evaluations that were recorded for it, hands them to `buildReport` -- which is where the
 * graph, the per-move judgement and the coverage already live -- and then adds what a person wants after a game and
 * a report has not got. Nothing is measured twice, and the report comes back on the review so a screen can show the
 * coverage and the graph from the same object.
 */
export function buildGameReview(
  game: Pick<StoredGame, 'id' | 'startFen' | 'moves'>,
  evaluations: readonly PositionEval[],
  options: GameReviewOptions = {}
): GameReview {
  const minDepth = options.minDepth ?? 8
  const report = buildReport(game, [...evaluations], options)
  const book = bookRun(game, options.bookLimit ?? 40)
  const bookByPly = new Map(book.moves.map((m) => [m.ply, m]))
  const linesByPly = new Map<number, PositionLines>()
  for (const found of options.alternatives ?? []) linesByPly.set(found.ply, found)

  const moves: ReviewMove[] = []
  const counts: Record<Side, ReviewCounts> = { w: emptyCounts(), b: emptyCounts() }
  let asked = 0
  let settled = 0

  for (const row of report.moves) {
    const theory = bookByPly.get(row.ply) ?? null
    /*
     * The award question is asked wherever the engine's own ranked lines for the position were recorded, and nowhere
     * else. It is deliberately not filtered by what `classify` called the move first: the two numbers come from
     * searches of two different positions and can disagree by a few centipawns, so a move the engine would itself
     * have played can land in `good` -- and a filter on the class would then quietly refuse to award it.
     */
    const at = linesByPly.get(row.ply - 1) ?? null
    const verdict: AwardVerdict = at
      ? judgeAward({ uci: row.uci }, at, { minDepth })
      : unsettled('The engine\'s other moves in this position were never searched, so whether this was the only move cannot be said.')
    if (at) {
      asked += 1
      if (verdict.settled) settled += 1
    }

    const move: ReviewMove = {
      ply: row.ply,
      san: row.san,
      uci: row.uci,
      mover: row.mover,
      number: row.number,
      fenBefore: fenAt(game, row.ply - 1),
      before: row.before,
      after: row.after,
      loss: row.loss,
      klass: row.klass,
      depth: row.depth,
      why: row.why,
      analysed: row.analysed,
      ...(row.better ? { better: row.better } : {}),
      award: verdict.award,
      awardSettled: verdict.settled,
      awardWhy: verdict.why,
      gaveUp: verdict.gaveUp,
      book: theory ? { eco: theory.eco, name: theory.name } : null,
      label: labelFor(row.klass, verdict.award, theory !== null)
    }
    moves.push(move)

    const side = counts[row.mover]
    side.moves += 1
    side.classes[row.klass] += 1
    if (verdict.award === 'brilliant') side.brilliant += 1
    if (verdict.award === 'great') side.great += 1
    if (theory) side.book += 1
    if (!verdict.settled) side.awardUnknown += 1
  }

  const accuracy: Record<Side, SideAccuracy> = { w: sideAccuracy(moves, 'w'), b: sideAccuracy(moves, 'b') }
  const key = keyMoments(report.graph, moves, evaluations, {
    minDepth,
    max: options.maxMoments ?? 6,
    move: options.momentMove ?? MOMENT_MOVE
  })

  const unknown = asked - settled
  const notLookedAt = moves.length - asked
  const awards = {
    asked,
    settled,
    unknown,
    notLookedAt,
    says: asked === 0
      ? `No move of this game has the engine's ranked moves recorded for the position before it, so no move here can be called `
        + 'Brilliant or Great. That needs a search that asks for more than one line.'
      : `${settled} of ${asked} moves could be settled either way.`
        + (unknown ? ` ${unknown} had the lines but not comparable ones.` : '')
        + (notLookedAt
          ? ` The other ${notLookedAt} ${notLookedAt === 1 ? 'move was' : 'moves were'} never searched for alternatives, so nothing is claimed about them.`
          : '')
  }

  const rules: readonly string[] = Object.freeze([GREAT_RULE, BRILLIANT_RULE, BOOK_RULE, MOMENT_RULE, ACCURACY_FORMULA])

  return {
    gameId: game.id,
    report,
    moves,
    accuracy,
    counts,
    key,
    book,
    awards,
    nextSteps: nextSteps(moves, key, book),
    rules,
    says: summarise(accuracy, counts, key, report)
  }
}

export const AWARD_LABEL: Readonly<Record<Award, string>> = Object.freeze({ brilliant: 'Brilliant', great: 'Great' })

function labelFor(klass: MoveClass, award: Award | null, theory: boolean): string {
  // Theory first: a move somebody read in a book is not a move they found, whatever the engine thinks of it. Then the
  // awards, which are refinements of "best", then the engine's own name for it.
  if (theory) return 'Book'
  if (award) return AWARD_LABEL[award]
  return CLASS_LABEL[klass]
}

/**
 * The moments, off the graph.
 *
 * The graph's height is the measurement: `barFraction` is what draws it, so what the eye sees moving is what gets
 * ranked. It handles a forced mate and a six-pawn advantage on the same scale, which a centipawn difference does
 * not -- and the centipawn difference is reported as well, for the moves where it means something.
 */
export function keyMoments(
  graph: readonly GraphPoint[],
  moves: readonly ReviewMove[],
  evaluations: readonly PositionEval[],
  options: { minDepth?: number; max?: number; move?: number } = {}
): KeyMoments {
  const minDepth = options.minDepth ?? 8
  const max = Math.max(0, options.max ?? 6)
  const threshold = options.move ?? MOMENT_MOVE
  const byPly = new Map(graph.map((point) => [point.ply, point]))
  const pvByPly = new Map<number, string[]>()
  const bounded = new Set<number>()
  for (const found of evaluations) {
    if (found.pvUci && found.pvUci.length) pvByPly.set(found.ply, found.pvUci)
    if (found.provisional) bounded.add(found.ply)
  }

  const found: KeyMoment[] = []
  const unmeasured = { notAnalysed: 0, tooShallow: 0, unsettled: 0 }
  let measured = 0

  for (const row of moves) {
    const before = byPly.get(row.ply - 1) ?? null
    const after = byPly.get(row.ply) ?? null
    if (!before || !after || before.fraction === null || after.fraction === null || row.before === null || row.after === null) {
      unmeasured.notAnalysed += 1
      continue
    }
    if (row.depth === null || row.depth < minDepth) {
      unmeasured.tooShallow += 1
      continue
    }
    if (bounded.has(row.ply - 1) || bounded.has(row.ply)) {
      // The engine gave a bound rather than a settled number on one side of this move. The graph moved, but not by a
      // distance anybody knows, so no moment is taken from it.
      unmeasured.unsettled += 1
      continue
    }
    measured += 1
    const moved = Math.abs(after.fraction - before.fraction)
    if (moved < threshold) continue
    const gained: Side = after.fraction > before.fraction ? 'w' : 'b'
    const movedCp = row.before.kind === 'cp' && row.after.kind === 'cp' ? Math.abs(row.after.cp - row.before.cp) : null
    const pv = pvByPly.get(row.ply - 1)
    const written = pv ? writeLine(row.fenBefore, pv, 6) : null
    found.push({
      ply: row.ply,
      san: row.san,
      mover: row.mover,
      number: row.number,
      before: row.before,
      after: row.after,
      moved,
      movedCp,
      gained,
      depth: row.depth,
      klass: row.klass,
      ...(row.better ? { better: row.better } : {}),
      line: written && written.shown ? written.text : '',
      explain: explainMoment(row, gained, movedCp)
    })
  }

  found.sort((a, b) => (b.moved - a.moved) || (a.ply - b.ply))
  const moments = found.slice(0, max)
  // What could not be measured is said in the same breath as what could, and in every case -- a review that measured
  // nothing has to explain why, or it reads as a game in which nothing happened.
  const missing = [
    unmeasured.notAnalysed
      ? `${unmeasured.notAnalysed} ${unmeasured.notAnalysed === 1 ? 'move was' : 'moves were'} not measured at all, because the position on one side of ${unmeasured.notAnalysed === 1 ? 'it' : 'them'} was never analysed, so a moment could be hiding among ${unmeasured.notAnalysed === 1 ? 'them' : 'those'}.`
      : '',
    unmeasured.tooShallow ? `${unmeasured.tooShallow} were searched too shallowly to take a moment from.` : '',
    unmeasured.unsettled ? `${unmeasured.unsettled} had a bound rather than a settled number on one side, so nothing is claimed about them.` : ''
  ].filter(Boolean)
  const says = (measured === 0
    ? 'Not one move could be measured for a swing.'
    : `${found.length} of ${measured} measured moves moved the graph by ${Math.round(threshold * 100)} per cent or more.`)
    + (missing.length ? ` ${missing.join(' ')}` : '')

  return { moments, more: Math.max(0, found.length - moments.length), measured, unmeasured, threshold, rule: MOMENT_RULE, says }
}

function explainMoment(row: ReviewMove, gained: Side, movedCp: number | null): string {
  const who = row.mover === 'w' ? 'White' : 'Black'
  const other = gained === 'w' ? 'White' : 'Black'
  const from = row.before === null ? '—' : formatScore(row.before)
  const to = row.after === null ? '—' : formatScore(row.after)
  const amount = movedCp === null ? '' : ` -- ${pawns(movedCp)}`
  const swung = `${from} became ${to}${amount}, on a search ${row.depth} deep.`
  if (row.klass === 'missed-mate') return `${who} had a forced mate here and ${row.san} did not take it. ${swung}`
  // A mate on the board after the move is what moved the graph, and saying it in centipawns would be inventing a
  // number. The mate itself is the explanation.
  const after = row.after === null ? null : forSide(row.after, row.mover)
  if (after && after.kind === 'mate') {
    return after.moves > 0
      ? `${row.san} put a forced mate on the board for ${who}. ${swung}`
      : `${row.san} walked into a forced mate. ${swung}`
  }
  if (gained === row.mover) return `${row.san} turned the game ${who}'s way. ${swung}`
  return `${row.san} handed the game to ${other}. ${swung}`
}

/**
 * What to do next, from what this game actually shows.
 *
 * Every step names a position in this game. There is no list of generic advice here to fall back on: a review that
 * found nothing worth working on says so, which is a perfectly good thing for a review of a well-played game to say
 * (Section 120).
 */
export function nextSteps(moves: readonly ReviewMove[], key: KeyMoments, book: BookRun): NextStep[] {
  const steps: NextStep[] = []
  const missed = moves.filter((row) => row.klass === 'missed-mate')
  for (const row of missed.slice(0, 2)) {
    steps.push({
      ply: row.ply,
      what: `A forced mate was there at ${row.number}${row.mover === 'w' ? '.' : '…'}${row.san} and the game went on instead.`
        + ` Play the position out from there until the mate comes.`
    })
  }
  for (const moment of key.moments.slice(0, 3)) {
    const at = `${moment.number}${moment.mover === 'w' ? '.' : '…'}${moment.san}`
    const instead = moment.better?.san ? ` The engine would have played ${moment.better.san}.` : ''
    steps.push({ ply: moment.ply, what: `Go back to ${at}, where the game turned, and play it out both ways.${instead}` })
  }
  // The opening is only worth mentioning when leaving theory was followed quickly by a real error. Saying "revise
  // your opening" because a game left the dataset on move six would be advice about nothing.
  const leftAt = book.leftAt
  if (leftAt !== null && book.last) {
    const soon = moves.find((row) => row.ply >= leftAt && row.ply <= leftAt + 6
      && (row.klass === 'mistake' || row.klass === 'blunder'))
    if (soon) {
      steps.push({
        ply: leftAt,
        what: `The game left ${book.last.eco} ${book.last.name} at ${book.leftLabel ?? 'that move'},`
          + ` and ${soon.number}${soon.mover === 'w' ? '.' : '…'}${soon.san} went wrong soon after. That line is worth knowing a few moves further.`
      })
    }
  }
  const seen = new Set<number>()
  return steps.filter((step) => (seen.has(step.ply) ? false : (seen.add(step.ply), true)))
}

function summarise(
  accuracy: Record<Side, SideAccuracy>,
  counts: Record<Side, ReviewCounts>,
  key: KeyMoments,
  report: AnalysisReport
): string {
  const share = (seen: SideAccuracy): string => (seen.value === null ? 'no figure' : `${Math.round(seen.value * 100)}%`)
  const parts: string[] = [`White ${share(accuracy.w)}, Black ${share(accuracy.b)}, over the moves the engine could judge.`]
  const awards = counts.w.brilliant + counts.b.brilliant + counts.w.great + counts.b.great
  if (awards) {
    const bits: string[] = []
    const brilliant = counts.w.brilliant + counts.b.brilliant
    const great = counts.w.great + counts.b.great
    if (brilliant) bits.push(`${brilliant} brilliant`)
    if (great) bits.push(`${great} great`)
    parts.push(`${bits.join(' and ')}.`)
  }
  parts.push(key.moments.length
    ? `${key.moments.length} key moment${key.moments.length === 1 ? '' : 's'}.`
    : 'No move moved the graph far enough to be a key moment.')
  if (report.coverage.notAnalysed.length) {
    parts.push(`${report.coverage.notAnalysed.length} of ${report.coverage.total} positions were not analysed, so this is a review of part of the game.`)
  }
  return parts.join(' ')
}

// ---------------------------------------------------------------- handing the review to the coach

/**
 * The review as a record the coach can use.
 *
 * `weaknessProfile` and the progress charts work over an `AnalysedGame`, and nothing in the tree ever built one from
 * a report, so a game could be reviewed in full and leave no trace in what Orbis says you are bad at. This is that
 * record -- and it refuses rather than rounds: a game with no judged move is evidence about nobody, and the depth it
 * records is the shallowest of the judgements in it, because a claim about a player is only as good as its weakest
 * measurement.
 */
export function analysedGameFrom(
  review: GameReview,
  about: { you: Side | null; analysedAt: number; opening?: { eco?: string; name?: string } }
): AnalysedGame | null {
  const judged = review.moves.filter((row) => row.klass !== 'unclear' && row.depth !== null)
  if (!judged.length) return null
  let depth = Number.POSITIVE_INFINITY
  for (const row of judged) depth = Math.min(depth, row.depth as number)
  if (!Number.isFinite(depth)) return null
  const moves: AnalysedMove[] = review.moves.map((row) => ({
    ply: row.ply,
    side: row.mover,
    san: row.san,
    before: row.fenBefore,
    klass: row.klass,
    loss: row.loss
  }))
  const opening = about.opening ?? (review.book.last ? { eco: review.book.last.eco, name: review.book.last.name } : undefined)
  return {
    gameId: review.gameId,
    you: about.you,
    analysedAt: about.analysedAt,
    depth,
    moves,
    ...(opening ? { opening } : {})
  }
}

/** Whether the coach would count this review at all, said in words rather than discovered by it going quiet. */
export function coachWouldCount(review: GameReview, you: Side | null): { counts: boolean; why: string } {
  const judged = review.moves.filter((row) => row.klass !== 'unclear' && row.depth !== null)
  if (!judged.length) {
    return { counts: false, why: 'Not one move was judged, so this game is evidence about nobody.' }
  }
  let depth = Number.POSITIVE_INFINITY
  for (const row of judged) depth = Math.min(depth, row.depth as number)
  if (you === null) {
    return { counts: false, why: 'This game does not record which side you played, so it cannot say anything about you.' }
  }
  if (depth < EVIDENCE.minDepth) {
    return {
      counts: false,
      why: `The shallowest judgement here is ${depth} deep, and ${EVIDENCE.minDepth} is what a claim about a player needs. Search the game again for longer.`
    }
  }
  return { counts: true, why: `${judged.length} judged moves, the shallowest ${depth} deep. This game counts towards what the coach says.` }
}

/**
 * The review of a game that is open for analysis.
 *
 * The evaluations come off the session's own nodes, which is where the Studio puts them and where a saved study puts
 * them back. So a game somebody already went over keeps its numbers: opening the review does not ask the engine for
 * anything that was asked before, and a game analysed last week can be reviewed with no engine on the computer at
 * all. The ranked alternatives are the one thing a session does not hold -- nothing writes them to disk -- so the
 * awards need a pass run in the review itself, and the review says so rather than reading as "no brilliant moves".
 */
export function reviewFromSession(session: AnalysisSession, options: GameReviewOptions = {}): GameReview {
  const evaluations: PositionEval[] = []
  for (const [ply, nodeId] of session.original.entries()) {
    const found = session.evaluations[nodeId]
    if (!found) continue
    evaluations.push({
      ply,
      fen: found.fen,
      score: found.score,
      depth: found.depth,
      ...(found.bestmove !== undefined ? { bestmove: found.bestmove } : {}),
      ...(found.pvUci ? { pvUci: found.pvUci } : {}),
      ...(found.engine ? { engine: found.engine } : {}),
      ...(found.at !== undefined ? { at: found.at } : {}),
      ...(found.provisional !== undefined ? { provisional: found.provisional } : {})
    })
  }
  return buildGameReview(session.game, evaluations, options)
}

/** The engine's ranked lines at a position, taken from what a search came back with. */
export function linesFrom(
  ply: number,
  fen: string,
  lines: readonly { multipv: number; score: Score; depth: number | null; pvUci: string[]; bound?: 'lower' | 'upper' | null }[]
): PositionLines {
  return {
    ply,
    fen,
    lines: lines.map((line) => ({
      multipv: line.multipv,
      score: line.score,
      depth: line.depth,
      pvUci: [...line.pvUci],
      ...(line.bound ? { provisional: true } : {})
    }))
  }
}
