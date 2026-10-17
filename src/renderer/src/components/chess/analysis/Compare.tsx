import { Board } from '../Board'
import { formatScore } from '../../../../../shared/chess/evaluation'
import { describeEvaluation } from '../../../../../shared/chess/study'
import { describeGap, type EndComparison } from '../../../../../shared/chess/compare'

/**
 * Where two lines end, side by side (Section 128).
 *
 * The honest part of this screen is not the two boards. It is the sentence under them, which says whether the two
 * positions are the same position -- and two boards can look identical and not be: a rook that went to g1 and came
 * back leaves the pieces where they were and the castling rights changed. `compareEnds` asks the one module that
 * decides that question, and what it answers is printed as it comes rather than summarised into "the same".
 *
 * The numbers are shown with what each one rests on beside it, and anything wrong with putting the two next to each
 * other is listed under them. A difference between two scores from searches of different depths is not a difference
 * between two moves, and the screen says so rather than leaving somebody to work it out.
 */

export interface CompareProps {
  comparison: EndComparison
  orientation: 'w' | 'b'
  /** Goes to that end position in the move list. */
  onJump: (nodeId: string) => void
}

export function Compare({ comparison, orientation, onJump }: CompareProps): React.JSX.Element {
  const gap = describeGap(comparison)
  const sides = [
    { end: comparison.a, score: comparison.scores.a, which: 'First line' },
    { end: comparison.b, score: comparison.scores.b, which: 'Second line' }
  ]

  return (
    <section className="cw-an-compare" aria-label="Where the two lines end">
      <div className="cw-an-cmp-pair">
        {sides.map(({ end, score, which }) => (
          <article className="cw-an-cmp-side" key={end.fromId}>
            <h5 className="cw-an-cmp-name">
              {which}: {end.label ?? end.lastMove ?? 'the starting position'}
            </h5>
            <Board fen={end.fen} orientation={orientation} interactive={false} label={`${which}, the position it ends in`} showLegal={false} />
            <p className="cw-an-cmp-line">{end.line}</p>
            <p className="cw-an-cmp-turn">{end.turn} to move, after {end.ply} move{end.ply === 1 ? '' : 's'}.</p>
            <p className={`cw-an-cmp-score${score && score.kind !== 'none' ? '' : ' is-none'}`}>
              {score && score.kind !== 'none' ? formatScore(score) : '—'}
              <span className="cw-an-depth"> {describeEvaluation(end.evaluation)}</span>
            </p>
            <button type="button" className="cw-an-jump" onClick={() => onJump(end.nodeId)}>Go to this move</button>
          </article>
        ))}
      </div>

      <p className={`cw-an-cmp-verdict${comparison.same ? ' is-same' : ''}`}>
        {comparison.ok
          ? comparison.reason
          : `These lines cannot be compared: ${comparison.reason}`}
      </p>

      {comparison.ok && !comparison.same && comparison.differences.length > 0 && (
        <ul className="cw-an-counts" aria-label="What differs between the two positions">
          {comparison.differences.map((one) => (
            <li key={one}>
              {one === 'placement' ? 'the pieces' : one === 'turn' ? 'whose turn it is' : one === 'castling' ? 'castling rights' : 'the en passant square'}
            </li>
          ))}
        </ul>
      )}

      {gap && <p className="cw-an-cmp-gap">{gap}</p>}

      {comparison.cautions.length > 0 && (
        <ul className="cw-an-ignored" aria-label="What to know about these numbers">
          {comparison.cautions.map((one) => <li key={one}>{one}</li>)}
        </ul>
      )}
      {comparison.cautions.length === 0 && comparison.canCompare && (
        <p className="cw-an-faint">Both numbers come from searches of the same depth, so they can be read against each other.</p>
      )}
    </section>
  )
}
