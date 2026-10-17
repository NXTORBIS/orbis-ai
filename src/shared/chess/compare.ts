import { moveNumber, sideToMove } from './rules.ts'
import { pathTo } from './model.ts'
import { transposition, type PositionDifference } from './openings.ts'
import { formatScore, type Score } from './evaluation.ts'
import { writeLine, type AnalysisSession, type NodeEvaluation } from './analysis.ts'

/**
 * Putting the ends of two lines side by side (Section 128).
 *
 * The question people actually ask of two variations is "where do these get me, and are they the same place?" --
 * and the second half is the one a screen can get wrong. Two boards can look identical and not be the same position:
 * a rook that went to g1 and came back leaves the pieces where they were and the castling rights changed, so one
 * side may castle and the other may not. Calling those the same is wrong in the one way that matters.
 *
 * So the comparison does not compare pictures of boards. It hands both lines to `transposition` in `openings.ts`,
 * which is already the one place that decides whether two move orders arrive at the same position and which already
 * says why or why not in plain words -- placement, whose turn it is, castling rights, the en passant square. It is
 * tested against the whole opening dataset. A second implementation here would be a second answer.
 *
 * That is also why this is its own file rather than part of `study.ts`: it needs the opening dataset, and `study.ts`
 * is read in the main process every time Orbis opens.
 *
 * The scores are the other half, and the rule there is the same one that holds everywhere in Chess World: a number
 * is only shown against what it rests on. Two scores from searches of different depths are not the same kind of
 * evidence, a bound is not a settled score, and a forced mate and a centipawn count are not on one scale. Each of
 * those is said beside the numbers rather than left for somebody to assume (Sections 124, 128).
 */

export interface EndOfLine {
  /** The branch that was picked: its first move. */
  fromId: string
  /** The move the line ends on, which is where the position being compared comes from. */
  nodeId: string
  /** What somebody called this branch, when they named one. */
  label: string | null
  /** The last move of the line, written as it reads: "24… Nf3". Null at the starting position. */
  lastMove: string | null
  /** The whole line from the start of the game, in notation, as far as it is worth writing out. */
  line: string
  /** Moves from the start of the game. */
  ply: number
  fen: string
  /** Whose turn it is in the position the line ends in. */
  turn: 'White' | 'Black'
  evaluation: NodeEvaluation | null
}

export interface EndComparison {
  a: EndOfLine
  b: EndOfLine
  /** False when one of the lines cannot be played out, and then nothing is claimed about either. */
  ok: boolean
  /** Do the two lines arrive at the same position? */
  same: boolean
  /** Why they do, or why they do not, in plain words. */
  reason: string
  /** Which parts of the position differ, when they do. */
  differences: PositionDifference[]
  /** The two scores, when both are there to be shown. */
  scores: { a: Score | null; b: Score | null }
  /** True only when the two numbers can be set against each other at all. */
  canCompare: boolean
  /**
   * What is wrong with putting these two numbers side by side, in sentences meant to be shown as they are. Empty
   * when nothing is: an empty list is a claim, so it is only empty when the comparison really is clean.
   */
  cautions: string[]
  /** The difference between the two scores in centipawns, and only when that subtraction means something. */
  gapCp: number | null
}

/** The moves of a line, from the start of the game down to a node. */
function sansTo(s: AnalysisSession, nodeId: string): string[] {
  return pathTo(s.tree, nodeId).flatMap((node) => (node.move ? [node.move.san] : []))
}

/**
 * The end of the line a node starts: its own continuation, all the way down.
 *
 * Picking a variation means picking the whole line, so what is compared is where that line *gets to* rather than the
 * one move that starts it. A branch that itself branches is followed down its own main continuation, which is the
 * same line the move list draws it as.
 */
function tipOf(s: AnalysisSession, nodeId: string): string {
  let at = nodeId
  const seen = new Set([at])
  for (;;) {
    const child = s.tree.nodes[at]?.children[0]
    if (!child || seen.has(child)) break
    seen.add(child)
    at = child
  }
  return at
}

function endOf(s: AnalysisSession, fromId: string): EndOfLine | null {
  const picked = s.tree.nodes[fromId]
  if (!picked) return null
  const nodeId = tipOf(s, fromId)
  const node = s.tree.nodes[nodeId]
  if (!node) return null
  const path = pathTo(s.tree, nodeId)
  const parent = node.parentId ? s.tree.nodes[node.parentId] : null
  const uci = path.flatMap((one) => (one.move ? [one.move.uci] : []))
  return {
    fromId,
    nodeId,
    label: picked.label ?? node.label ?? null,
    lastMove: node.move && parent
      ? `${moveNumber(parent.fen)}${sideToMove(parent.fen) === 'w' ? '.' : '…'}${node.move.san}`
      : null,
    // Written against the position the game starts from, because notation depends on the position it is written in.
    line: uci.length ? writeLine(s.game.startFen, uci, uci.length).text : 'the starting position',
    ply: Math.max(0, path.length - 1),
    fen: node.fen,
    turn: sideToMove(node.fen) === 'w' ? 'White' : 'Black',
    evaluation: s.evaluations[nodeId] ?? null
  }
}

/**
 * Comparing where two lines end.
 *
 * Null when either node is not in this session's tree -- there is nothing to compare, and inventing an answer for a
 * branch that is not there is how a comparison ends up describing positions nobody is looking at.
 */
export function compareEnds(s: AnalysisSession, aId: string, bId: string): EndComparison | null {
  const a = endOf(s, aId)
  const b = endOf(s, bId)
  if (!a || !b) return null

  // The whole line of each, replayed from the game's own starting position by the module that decides what meets.
  const walked = transposition(sansTo(s, a.nodeId), sansTo(s, b.nodeId), s.game.startFen)
  const scores = { a: a.evaluation?.score ?? null, b: b.evaluation?.score ?? null }
  const cautions: string[] = []

  const missing = (side: 'a' | 'b', end: EndOfLine): boolean => {
    const score = side === 'a' ? scores.a : scores.b
    const which = end.lastMove ? `the position after ${end.lastMove}` : 'the starting position'
    if (!end.evaluation) {
      cautions.push(`Nothing has been searched at ${which}, so there is no number for it. A position that was not analysed is not a level one.`)
      return true
    }
    if (!score || score.kind === 'none') {
      cautions.push(`The engine gave no score at ${which}, so there is nothing to compare it with.`)
      return true
    }
    return false
  }
  const missingA = missing('a', a)
  const missingB = missing('b', b)
  let canCompare = !missingA && !missingB

  if (canCompare && scores.a && scores.b && scores.a.kind !== scores.b.kind) {
    cautions.push(`One of these is a forced mate (${formatScore(scores.a.kind === 'mate' ? scores.a : scores.b)}) and the other is a count of pawns (${formatScore(scores.a.kind === 'cp' ? scores.a : scores.b)}). There is no single scale that holds both, so they are shown as they are rather than subtracted.`)
    canCompare = false
  }

  if (a.evaluation?.provisional || b.evaluation?.provisional) {
    cautions.push('The engine only gave a bound for one of these, so that number is not settled and the difference between the two does not mean what it looks like.')
  }

  const depthA = a.evaluation?.depth ?? null
  const depthB = b.evaluation?.depth ?? null
  if (a.evaluation && b.evaluation) {
    if (depthA === null || depthB === null) {
      cautions.push('The depth behind one of these searches was not recorded, so there is no way to say whether the two numbers carry the same weight.')
    } else if (depthA !== depthB) {
      cautions.push(`One was searched ${depthA} deep and the other ${depthB}, so they are not equally good evidence. The deeper number is the better one, not the larger one.`)
    }
    const engineA = a.evaluation.engine ?? null
    const engineB = b.evaluation.engine ?? null
    if (engineA && engineB && engineA !== engineB) {
      cautions.push(`They came from different engines (${engineA} and ${engineB}), which do not have to agree.`)
    }
  }

  const gapCp = canCompare && scores.a?.kind === 'cp' && scores.b?.kind === 'cp' ? scores.a.cp - scores.b.cp : null

  return {
    a,
    b,
    ok: walked.ok,
    same: walked.same,
    reason: walked.reason,
    differences: walked.differences,
    scores,
    canCompare,
    cautions,
    gapCp
  }
}

/**
 * The difference between the two scores, in the words a person would use.
 *
 * Null when there is no difference to describe -- one of the positions was never searched, or the two numbers are
 * not on one scale. A nothing is not a nought: a missing comparison says nothing rather than "level".
 */
export function describeGap(comparison: EndComparison): string | null {
  if (comparison.gapCp === null) return null
  if (comparison.gapCp === 0) return 'The two scores are the same.'
  const pawns = Math.abs(comparison.gapCp / 100).toFixed(2)
  const better = comparison.gapCp > 0 ? 'first' : 'second'
  return `The ${better} line is ${pawns} of a pawn better for White, on what has been searched so far.`
}
