import { ChessStage } from '../ChessStage'
import type { BoardProps } from '../Board'
import { useBoardRoom } from './boardRoom'
import './trainstage.css'

/**
 * The Train group's one arrangement: the board in the middle at the largest size the room allows, with panels
 * beside it -- and, when the whole point of the round is that there is no board, the empty square the board would
 * have been in, exactly that size, with the reason in it.
 *
 * ## Why this wraps the shared layout rather than replacing it
 *
 * `ChessStage` is the shared layout and it always draws a board, because every other area of Chess World always
 * has a position to show. Three of the four Train screens do not: the calculation gym takes the board away on
 * purpose, the blindfold ladder is nothing but taking the board away, and board vision cannot use the shared board
 * at all because the shared board names its squares and in that drill the name of the square is the answer.
 *
 * So when there is a position, this hands the whole job to `ChessStage` and the board is as big as the shared
 * layout can make it. When there is not, this draws the same three columns itself and puts the empty square in the
 * middle -- measured with the same `boardSize` the stage uses, so the layout does not jump when the position comes
 * back at the end of a round.
 *
 * ## The empty square is empty
 *
 * There is no board in the document when `away` is given. Not a board with `display: none`, not one behind an
 * opacity, not one the colour of the background. A hidden board is still in the accessibility tree, in a tooltip,
 * in the inspector and in a screenshot of the window, and the screens that take the board away are the ones where
 * that would hand the answer over. Whether a position may be drawn is decided in `trainingView.ts`; this only
 * draws what it is told.
 */

export interface TrainStageProps {
  /** Everything the board needs except how big it is. Null when this round has no board, and then `away` is used. */
  board: Omit<BoardProps, 'size'> | null
  /** What to put where the board would be, when there is no board. What it is, and why it is not there. */
  away?: { label: string; because: string | null } | null
  above?: React.ReactNode
  below?: React.ReactNode
  left?: React.ReactNode
  right?: React.ReactNode
  /** A ceiling on the board in pixels. Normally left out, which means as big as the room allows. */
  maxBoard?: number
  label?: string
  className?: string
}

export function TrainStage({
  board, away = null, above, below, left, right, maxBoard, label = 'Board', className
}: TrainStageProps): React.JSX.Element {
  if (board !== null) {
    return (
      <ChessStage
        board={board}
        {...(above === undefined ? {} : { above })}
        {...(below === undefined ? {} : { below })}
        {...(left === undefined ? {} : { left })}
        {...(right === undefined ? {} : { right })}
        {...(maxBoard === undefined ? {} : { maxBoard })}
        label={label}
        className={`cw-ts${className ? ` ${className}` : ''}`}
      />
    )
  }
  return <AwayStage {...{ away, above, below, left, right, maxBoard, label, className }} />
}

/**
 * The same three columns, with the place the board is not in the middle of them.
 *
 * It is a separate component rather than a branch inside the one above because it measures, and a hook cannot be
 * called on one branch and not the other.
 */
function AwayStage({
  away, above, below, left, right, maxBoard, label, className
}: Omit<TrainStageProps, 'board'> & { label: string }): React.JSX.Element {
  const room = useBoardRoom(maxBoard)
  return (
    <div
      className={`cw-ts cw-ts-away${left ? ' has-left' : ''}${right ? ' has-right' : ''}${className ? ` ${className}` : ''}`}
    >
      {left && <aside className="cw-ts-left">{left}</aside>}
      <section className="cw-ts-mid" aria-label={label}>
        {above && <div className="cw-ts-above">{above}</div>}
        <div className="cw-ts-slot" ref={room.ref}>
          <div
            className="cw-ts-empty"
            role="status"
            aria-label={away?.label ?? label}
            style={{ width: `${room.side}px`, height: `${room.side}px` }}
          >
            <p className="cw-ts-empty-label">{away?.label ?? label}</p>
            {away?.because != null && <p className="cw-ts-empty-why">{away.because}</p>}
          </div>
        </div>
        {below && <div className="cw-ts-below">{below}</div>}
        {room.tight && (
          <p className="cw-ts-tight" role="status">
            The window is too small for the board to fit. Make it wider, or close a panel.
          </p>
        )}
      </section>
      {right && <aside className="cw-ts-right">{right}</aside>}
    </div>
  )
}

export default TrainStage
