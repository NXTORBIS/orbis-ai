import { useEffect, useMemo, useState } from 'react'
import { ChessStage } from '../ChessStage'
import {
  coachMoments, momentCounts, type CoachMoment, type CoachMoments as Moments
} from '../../../../../shared/chess/coachMoments'
import type { CoachEvidence } from '../../../../../shared/chess/coach'
import { CLASS_LABEL } from '../../../../../shared/chess/evaluation'

/**
 * The coach, with the chess put back on it.
 *
 * The coach was four tabs of tables and warning paragraphs and no board anywhere, which made a screen about this
 * person's chess into a page of writing about them. This tab is the answer to the question all of that writing was
 * circling: *which move, then?* It puts the positions of their own worst measured moves on the biggest board the
 * window will hold, worst first, and says what the engine measured about each one.
 *
 * ## Nothing here is generated
 *
 * Every position comes out of a game they played, and every figure beside it came out of a search that really ran:
 * `coachMoments` in `src/shared/chess` does the picking and the arithmetic and is tested there. With nothing
 * analysed there is no board and the screen says why -- it does not show a position as an illustration, because an
 * illustration on this screen would read as "this is one of yours".
 *
 * ## A model may say what this means. It may never work it out
 *
 * There is no text on this tab that was written by anything but this file and `coachMoments`. If Orion is ever
 * asked to talk about one of these positions, the move, the class and the loss still come from here and the origin
 * line stays under them.
 */

export interface CoachMomentsProps {
  evidence?: CoachEvidence
  /** True while the record is still being read: a board drawn before the answer is a board about nothing. */
  loading?: boolean
  /** How many moments to offer. The pure module decides the order. */
  limit?: number
}

export function CoachMoments({ evidence, loading = false, limit }: CoachMomentsProps): React.JSX.Element {
  const found: Moments = useMemo(
    () => coachMoments(evidence, limit === undefined ? {} : { limit }),
    [evidence, limit]
  )
  const [at, setAt] = useState(0)

  // A fresh read can hand back fewer moments than the one before it, and the place somebody was on may be gone.
  useEffect(() => { setAt((held) => (held < found.moments.length ? held : 0)) }, [found.moments.length])

  if (loading) {
    return (
      <div className="cw-co-moments is-empty">
        <p className="cw-co-moments-says" role="status">Reading your games…</p>
      </div>
    )
  }

  const here: CoachMoment | undefined = found.moments[at]

  if (here === undefined) {
    /*
     * No board, and the reason rather than a paragraph of apology.
     *
     * The counts are the useful part: "two games read, nothing faulted" and "no game has been analysed" are
     * different situations and lead to different next steps, so both are shown as figures.
     */
    return (
      <div className="cw-co-moments is-empty">
        <p className="cw-co-moments-says">{found.says}</p>
        <dl className="cw-co-moments-counts">
          <div><dt>Games read</dt><dd>{found.gamesRead}</dd></div>
          <div><dt>Your moves judged</dt><dd>{found.movesJudged}</dd></div>
          <div><dt>Too shallow to count</dt><dd>{found.gamesTooShallow}</dd></div>
          <div><dt>Side not recorded</dt><dd>{found.gamesWithoutASide}</dd></div>
        </dl>
        <p className="cw-co-moments-origin">{found.origin}</p>
      </div>
    )
  }

  const counts = momentCounts(found.moments)

  return (
    <ChessStage
      className="cw-co-stage"
      label="Your own moves the engine faulted"
      board={{
        fen: here.fen,
        // The board is turned to the side they were playing, because that is the way they saw it.
        orientation: here.side,
        interactive: false,
        showCoordinates: true,
        label: `The position before your move ${here.moveNumber}`
      }}
      above={(
        <div className="cw-co-moments-head">
          <strong className={`cw-co-moments-class is-${here.klass}`}>{CLASS_LABEL[here.klass]}</strong>
          <span className="cw-co-moments-move">
            Move {here.moveNumber}, {here.side === 'w' ? 'White' : 'Black'} to play — you played {here.san}
          </span>
          <span className="cw-co-moments-loss">
            {here.loss === null ? 'cost not on one scale' : `−${(here.loss / 100).toFixed(1)} pawns`}
          </span>
        </div>
      )}
      below={(
        <div className="cw-co-moments-foot">
          <p className="cw-co-moments-says">{here.says}</p>
          <p className="cw-co-moments-origin">{here.origin}</p>
        </div>
      )}
      right={(
        <div className="cw-co-moments-list">
          <p className="cw-co-moments-says">{found.says}</p>
          <ul className="cw-co-moments-chips">
            {counts.map((one) => (
              <li key={one.klass} className={`cw-co-moments-chip is-${one.klass}`}>
                <span className="cw-co-moments-chip-n">{one.count}</span> {CLASS_LABEL[one.klass]}
              </li>
            ))}
          </ul>
          <ol className="cw-co-moments-rows">
            {found.moments.map((one, index) => (
              <li key={one.id}>
                <button
                  type="button"
                  className="cw-co-moments-row"
                  aria-current={index === at}
                  onClick={() => setAt(index)}
                >
                  {/* The class is said as well as coloured: a row that only differs by colour says nothing to
                      anybody who cannot tell the two colours apart. */}
                  <span className={`cw-co-moments-dot is-${one.klass}`} aria-hidden="true" />
                  <span className="cw-co-moments-row-move">{one.moveNumber}. {one.san}</span>
                  <span className="cw-co-moments-row-class">{CLASS_LABEL[one.klass]}</span>
                  <span className="cw-co-moments-row-loss">
                    {one.loss === null ? '—' : `−${(one.loss / 100).toFixed(1)}`}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="cw-co-moments-origin">{found.origin}</p>
        </div>
      )}
    />
  )
}

export default CoachMoments
