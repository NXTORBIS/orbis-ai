import { useMemo } from 'react'
import { Button, EmptyState } from '../../../ui'
import { positionKey, sideToMove } from '../../../../../shared/chess/rules'
import type { Book, Drill, DrillOrder, RecallVerdict, RepertoireLine } from '../../../../../shared/chess/repertoire'

/**
 * Do you remember your own lines?
 *
 * The drill plays the other side for you from the line itself and asks for your moves on the board. What comes back
 * is one of a few genuinely different answers, and keeping them apart is the whole point of this screen
 * (Sections 139, 140):
 *
 *   - **the move you wrote down** -- right, and it moves on.
 *   - **off book** -- a legal move that is not in your repertoire. It is not called a mistake, because this screen
 *     has asked no engine and so has no evidence that it is one.
 *   - **not in your repertoire** -- the position itself is not covered, so there was nothing to remember.
 *   - **not a move** -- it would not play.
 *
 * `gradeRecall` will carry an engine's verdict when a caller hands it one. Nothing on this screen does, and the note
 * at the bottom says so rather than leaving a person to assume a silence means approval.
 */

export interface RecallTrainerProps {
  side: 'w' | 'b'
  lines: RepertoireLine[]
  book: Book
  fen: string
  drill: Drill | null
  drillLineName: string | null
  onStart: (order: DrillOrder) => void
  onStop: () => void
  onReveal: () => void
  onSkip: () => void
}

const VERDICT_CLASS: Record<RecallVerdict, string> = {
  right: 'is-right',
  'off-book': 'is-offbook',
  'not-in-book': 'is-unknown',
  illegal: 'is-illegal',
  'their-move': 'is-unknown',
  'bad-position': 'is-illegal'
}

const sideWord = (side: 'w' | 'b'): string => (side === 'w' ? 'White' : 'Black')

export function RecallTrainer({
  side, lines, book, fen, drill, drillLineName, onStart, onStop, onReveal, onSkip
}: RecallTrainerProps): React.JSX.Element {
  const mine = useMemo(() => lines.filter((one) => one.side === side), [lines, side])
  /** What your own book plays in the position on the board, when it is your move and it covers it. */
  const here = useMemo(() => book.positions.get(positionKey(fen)) ?? null, [book, fen])
  const yourTurn = sideToMove(fen) === side

  if (!drill) {
    return (
      <div className="cw-ol-pane">
        <h4 className="cw-ol-h">Recall</h4>
        {mine.length === 0
          ? <EmptyState>There is nothing in your {sideWord(side)} repertoire to be asked about yet. Save a line first.</EmptyState>
          : (
            <>
              <p className="cw-ol-faint">
                {mine.length} {mine.length === 1 ? 'line' : 'lines'} to go through. The other side's moves are played for
                you from the line; you play yours on the board.
              </p>
              <div className="cw-ol-row">
                <Button size="small" kind="primary" onClick={() => onStart('given')}>Start the drill</Button>
                <Button size="small" onClick={() => onStart('shortest-first')}>Shortest lines first</Button>
              </div>
            </>
          )}

        <section aria-label="What your repertoire says about this position">
          <h4 className="cw-ol-h">This position</h4>
          {!here
            ? <p className="cw-ol-faint">This position is not in your {sideWord(side)} repertoire.</p>
            : !yourTurn
              ? (
                <p className="cw-ol-faint">
                  It is {sideWord(sideToMove(fen))} to move here, so it is not your decision in this repertoire.
                  {here.theirs.length > 0 && ` Your lines expect ${here.theirs.map((m) => m.san).join(' or ')}.`}
                </p>
              )
              : here.yours.length === 0
                ? <p className="cw-ol-faint">Your lines reach this position but stop here, so they do not say what you play.</p>
                : (
                  <p className="cw-ol-faint">
                    You play {here.yours.map((m) => m.san).join(' or ')} here
                    {here.yours.length > 1 ? ', depending on the line' : ''}.
                  </p>
                )}
        </section>

        <p className="cw-ol-note">
          This drill compares your move with your own repertoire and nothing else. It never calls a move good or bad:
          no engine is asked here, so there would be nothing behind the word.
        </p>
      </div>
    )
  }

  const grade = drill.last
  return (
    <div className="cw-ol-pane">
      <h4 className="cw-ol-h">{drill.done ? 'Drill finished' : `Recall: ${drillLineName ?? 'your line'}`}</h4>

      <p className="cw-ol-score">
        {drill.right} right of {drill.asked} asked
        {drill.offBook > 0 && ` · ${drill.offBook} off book`}
        {drill.illegal > 0 && ` · ${drill.illegal} could not be played`}
        {drill.revealed > 0 && ` · ${drill.revealed} shown`}
        {!drill.done && ` · line ${drill.at + 1} of ${drill.lineIds.length}`}
      </p>

      {grade && (
        <p className={`cw-ol-grade ${VERDICT_CLASS[grade.verdict]}`} role="status">{grade.message}</p>
      )}

      {!drill.done && (
        <>
          <p className="cw-ol-faint">
            Play your move as {sideWord(side)} on the board.
          </p>
          <div className="cw-ol-row">
            <Button size="small" onClick={onReveal}>Show me the move</Button>
            <Button size="small" onClick={onSkip}>Skip this line</Button>
            <Button size="small" kind="quiet" onClick={onStop}>Stop</Button>
          </div>
        </>
      )}

      {drill.done && (
        <>
          <p className="cw-ol-faint">
            That is every line in your {sideWord(side)} repertoire.
            {drill.offBook + drill.revealed > 0
              ? ` ${drill.offBook + drill.revealed} of them did not come back to you. That is a count, not a verdict on the moves you played instead.`
              : ' Every answer was the move you wrote down.'}
          </p>
          <div className="cw-ol-row">
            <Button size="small" kind="primary" onClick={() => onStart('given')}>Go again</Button>
            <Button size="small" kind="quiet" onClick={onStop}>Done</Button>
          </div>
        </>
      )}

      {drill.history.length > 0 && (
        <section aria-label="What you answered">
          <h4 className="cw-ol-h">What you answered</h4>
          <ul className="cw-ol-history">
            {drill.history.map((step, index) => (
              <li key={`${index}-${step.expected}`} className={step.outcome === 'right' ? 'is-right' : 'is-offbook'}>
                <span className="cw-ol-hsan">{step.san ?? '—'}</span>
                <span className="cw-ol-hwas">
                  {step.outcome === 'right'
                    ? 'yours'
                    : step.outcome === 'revealed'
                      ? `shown: ${step.expected}`
                      : `your line plays ${step.expected}`}
                </span>
                <span className="cw-ol-hline">{lines.find((one) => one.id === step.lineId)?.name ?? ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="cw-ol-note">
        Right and off book are the only two things measured here, and off book means exactly that: not in your
        repertoire. No engine was asked, so nothing on this screen claims a move is weak.
      </p>
    </div>
  )
}
