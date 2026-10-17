import { useEffect, useRef } from 'react'
import { moveRows, placeWords, stepForKey, stepPly, type MoveCell } from '../../../../shared/chess/moveList'
import './stage.css'

/**
 * The move list.
 *
 * A column of numbered rows with White's move and Black's move beside each other, the move you are looking at
 * marked, every move a button you can click, and the whole list walkable with the arrow keys, Home and End. It
 * replaces a run of words -- "1. e4 e5 2. Nf3" -- which is a sentence about a game rather than a way through one.
 *
 * All the counting is in `moveList.ts`, where it is tested without a window: which rows there are, how a move is
 * written when it is said on its own, what a step lands on, and which keys step. This file draws the answer.
 *
 * ## What it refuses to invent
 *
 * A mark beside a move -- a blunder, a brilliant move, a book move -- is only drawn when the area hands one over,
 * and an area only has one when something really measured it. A list that marked moves by guessing would be a list
 * of made-up judgements, so a move nothing has looked at carries no mark at all, which is the honest answer and
 * looks like one.
 */

/** A judgement about one move, measured by the area and handed over. Never worked out here. */
export interface MoveNote {
  /** The one or two characters drawn beside the move: "!!", "?", "⨯". */
  symbol: string
  /** What it means, in words, for a tooltip and for anybody who cannot see the symbol. */
  title: string
  /** Which colour it is drawn in. One of the move classes, or 'book'. */
  kind: string
}

export interface MoveListProps {
  /** The moves as they are written: "e4", "Nf3", "Qxd5+". */
  moves: readonly string[]
  /** How many moves have been played in the position you are looking at. 0 is the starting position. */
  ply: number
  /** Called with a ply to go to. Without it the list is read-only, which is right for a game being broadcast. */
  onJump?: (ply: number) => void
  /** Which side plays the first move in the list, for a position that did not start at the beginning. */
  firstSide?: 'w' | 'b'
  /** The number the first move is written as. */
  firstNumber?: number
  /** A judgement per ply, from something that really measured it. */
  notes?: Readonly<Record<number, MoveNote>>
  /** What to say when there are no moves yet. Said plainly; it is not an error. */
  empty?: string
  className?: string
}

export function MoveList({
  moves, ply, onJump, firstSide = 'w', firstNumber = 1, notes, empty = 'No moves yet.', className
}: MoveListProps): React.JSX.Element {
  const shape = { firstSide, firstNumber }
  const rows = moveRows(moves, shape)
  const here = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)

  /*
   * The move you are on is scrolled into view, and only within the list.
   *
   * `nearest` rather than `center`, and the list is the box that scrolls, because a move list that scrolls the
   * whole screen every time you step forward is how a long game becomes unusable.
   */
  useEffect(() => {
    const button = here.current
    const list = box.current
    if (!button || !list) return
    const top = button.offsetTop
    const bottom = top + button.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top - 8
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8
  }, [ply, moves.length])

  const onKey = (event: React.KeyboardEvent): void => {
    if (!onJump) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const step = stepForKey(event.key)
    if (step === null) return
    event.preventDefault()
    onJump(stepPly(ply, moves.length, step))
  }

  const cell = (one: MoveCell | null): React.JSX.Element => {
    if (one === null) return <span className="cw-ml-blank" aria-hidden="true">·</span>
    const note = notes?.[one.ply]
    const current = one.ply === ply
    return (
      <button
        type="button"
        ref={current ? here : undefined}
        className={`cw-ml-move${current ? ' is-here' : ''}`}
        aria-current={current ? 'true' : undefined}
        aria-label={note ? `${one.san}, ${note.title}` : one.san}
        disabled={!onJump}
        onClick={() => onJump?.(one.ply)}
      >
        <span className="cw-ml-san">{one.san}</span>
        {note && <span className={`cw-ml-note is-${note.kind}`} title={note.title}>{note.symbol}</span>}
      </button>
    )
  }

  return (
    <div className={`cw-ml${className ? ` ${className}` : ''}`}>
      <div
        className="cw-ml-scroll"
        ref={box}
        role="list"
        tabIndex={onJump ? 0 : -1}
        aria-label="Moves"
        onKeyDown={onKey}
      >
        {rows.length === 0 && <p className="cw-ml-empty">{empty}</p>}
        {rows.map((row) => (
          <div className="cw-ml-row" role="listitem" key={`${row.number}-${row.white?.ply ?? 'b'}`}>
            <span className="cw-ml-num">{row.number}.</span>
            {cell(row.white)}
            {cell(row.black)}
          </div>
        ))}
      </div>
      {/* Where you are, in words, because which row is marked is a colour and nothing else. */}
      <p className="cw-ml-place" role="status">{placeWords(ply, moves.length)}</p>
    </div>
  )
}

export interface MoveNavProps {
  ply: number
  total: number
  onJump: (ply: number) => void
  /** Turning the board round. Left out, there is no button for it. */
  onFlip?: () => void
  /** Anything else the area wants on the same row: ask the engine, offer a draw, start again. */
  children?: React.ReactNode
}

/**
 * The buttons that walk a game: to the start, back one, forward one, to the end, and turn the board round.
 *
 * They are here rather than in each area because every area was writing them and they disagreed about what
 * stepping back from the first move should do. `stepPly` answers that in one place: it lands on the starting
 * position, not on nothing.
 */
export function MoveNav({ ply, total, onJump, onFlip, children }: MoveNavProps): React.JSX.Element {
  return (
    <div className="cw-nav" role="group" aria-label="Walk the game">
      <button type="button" className="cw-nav-btn" title="The starting position (Home)" aria-label="The starting position" disabled={ply <= 0} onClick={() => onJump(stepPly(ply, total, 'first'))}>⏮</button>
      <button type="button" className="cw-nav-btn" title="Back one move (Left arrow)" aria-label="Back one move" disabled={ply <= 0} onClick={() => onJump(stepPly(ply, total, 'back'))}>◀</button>
      <button type="button" className="cw-nav-btn" title="Forward one move (Right arrow)" aria-label="Forward one move" disabled={ply >= total} onClick={() => onJump(stepPly(ply, total, 'forward'))}>▶</button>
      <button type="button" className="cw-nav-btn" title="The last move (End)" aria-label="The last move" disabled={ply >= total} onClick={() => onJump(stepPly(ply, total, 'last'))}>⏭</button>
      {onFlip && <button type="button" className="cw-nav-btn" title="Turn the board round (F)" aria-label="Turn the board round" onClick={onFlip}>⇅</button>}
      {children}
    </div>
  )
}

export default MoveList
