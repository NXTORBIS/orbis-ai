/**
 * What an engine score is, and which side it favours.
 *
 * Two kinds of score exist and they are not the same thing. A centipawn score says how much better one side stands,
 * in hundredths of a pawn. A mate score says a forced mate was found and how many moves away it is. Treating the
 * second as the first is how a forced mate in three ends up drawn on screen as "+327.68", so they are separate types
 * here and nothing converts one into the other.
 *
 * The convention inside Orbis: a score is always stored from WHITE's point of view. Positive favours White. The
 * engine speaks from the side to move, so `fromEngine` turns its number round once, at the edge, and nothing else in
 * the application has to think about it again (Sections 046, 111, 426).
 */

export type Score =
  | { kind: 'cp'; cp: number }
  /** `moves` is the number of moves (not plies) to mate, positive when White mates, negative when Black does. */
  | { kind: 'mate'; moves: number }
  /** No score: the search has not produced one yet, or the engine did not report one. Never shown as 0. */
  | { kind: 'none' }

export type Side = 'w' | 'b'

/** The engine reports from the side to move. This turns that into Orbis's White-is-positive convention. */
export function fromEngine(raw: { kind: 'cp'; cp: number } | { kind: 'mate'; moves: number }, sideToMove: Side): Score {
  const flip = sideToMove === 'b' ? -1 : 1
  return raw.kind === 'cp' ? { kind: 'cp', cp: raw.cp * flip } : { kind: 'mate', moves: raw.moves * flip }
}

/** The same score seen by one player: what Black sees is the negative of what White sees. */
export function forSide(score: Score, side: Side): Score {
  if (score.kind === 'none' || side === 'w') return score
  return score.kind === 'cp' ? { kind: 'cp', cp: -score.cp } : { kind: 'mate', moves: -score.moves }
}

/** For display: "+1.24", "M3", "M-2", or a dash when there is no score. Never "0.00" for a missing score. */
export function formatScore(score: Score, side: Side = 'w'): string {
  const s = forSide(score, side)
  if (s.kind === 'none') return '—'
  if (s.kind === 'mate') return s.moves === 0 ? 'mate' : `M${s.moves > 0 ? '' : '-'}${Math.abs(s.moves)}`
  const pawns = s.cp / 100
  return `${pawns > 0 ? '+' : pawns < 0 ? '−' : ''}${Math.abs(pawns).toFixed(2)}`
}

/**
 * Where to draw the bar, 0 (Black winning) to 1 (White winning). A mate is the end of the bar, not a huge number, so
 * one forced mate does not flatten every ordinary evaluation in a graph.
 */
export function barFraction(score: Score): number {
  if (score.kind === 'none') return 0.5
  if (score.kind === 'mate') return score.moves > 0 ? 1 : score.moves < 0 ? 0 : 0.5
  // A smooth curve: ±4 pawns covers most of the bar, and nothing ever reaches the very end except mate.
  const x = Math.max(-2000, Math.min(2000, score.cp)) / 400
  return 0.5 + 0.49 * (x / (1 + Math.abs(x)))
}

/** Can these two be compared at all? Two scores of different kinds are not on one scale. */
export function comparable(a: Score, b: Score): boolean {
  return a.kind !== 'none' && b.kind !== 'none'
}

/**
 * How much worse `played` is than `best`, in centipawns, from the mover's point of view. Null when the two cannot be
 * put on one scale -- missing a forced mate is not "350 centipawns", and saying so would invent a number.
 */
export function lossFrom(best: Score, played: Score, mover: Side): number | null {
  const b = forSide(best, mover)
  const p = forSide(played, mover)
  if (b.kind === 'cp' && p.kind === 'cp') return Math.max(0, b.cp - p.cp)
  return null
}

export type MoveClass = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'missed-mate' | 'unclear'

/**
 * Naming a move from the two scores, with the thresholds written down rather than buried (Section 114).
 *
 * `unclear` is a real answer and is used whenever the evidence does not support a name: no score, a search too shallow
 * to trust, or a change between a mate score and an ordinary one that no centipawn number describes.
 */
export const CLASS_THRESHOLDS = { excellent: 20, good: 50, inaccuracy: 100, mistake: 250 } as const

export function classify(best: Score, played: Score, mover: Side, opts: { depth?: number; minDepth?: number } = {}): MoveClass {
  const minDepth = opts.minDepth ?? 8
  if (opts.depth !== undefined && opts.depth < minDepth) return 'unclear'
  const b = forSide(best, mover)
  const p = forSide(played, mover)
  if (b.kind === 'none' || p.kind === 'none') return 'unclear'
  // A mate that was available and was not played: say that, rather than a made-up centipawn loss.
  if (b.kind === 'mate' && b.moves > 0 && !(p.kind === 'mate' && p.moves > 0)) return 'missed-mate'
  // Walking into a mate against you is the worst thing a move can do.
  if (p.kind === 'mate' && p.moves < 0 && !(b.kind === 'mate' && b.moves < 0)) return 'blunder'
  if (b.kind === 'mate' || p.kind === 'mate') return 'unclear'
  const loss = Math.max(0, b.cp - p.cp)
  if (loss <= 0) return 'best'
  if (loss < CLASS_THRESHOLDS.excellent) return 'excellent'
  if (loss < CLASS_THRESHOLDS.good) return 'good'
  if (loss < CLASS_THRESHOLDS.inaccuracy) return 'inaccuracy'
  if (loss < CLASS_THRESHOLDS.mistake) return 'mistake'
  return 'blunder'
}

export const CLASS_LABEL: Record<MoveClass, string> = {
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  'missed-mate': 'Missed a forced mate',
  unclear: 'Not judged'
}
