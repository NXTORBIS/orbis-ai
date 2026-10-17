import { useCallback, useEffect, useRef, useState } from 'react'
import { boardSize, squeezed } from '../../../../shared/chess/boardSize'
import { Board, type BoardProps } from './Board'
import './stage.css'

/**
 * The layout every area of Chess World shares: the board in the middle at the largest size the room allows, a
 * column on the right for the move list and the controls, an optional column on the left, and the evaluation strip
 * beside the board.
 *
 * ## Why this exists rather than each area arranging its own board
 *
 * Because each area did, and the result was the fault the owner named: the board was missing from seven of the
 * twenty areas and tiny in the rest. Twelve areas capped it at 420 or 560 pixels and the other eight left it to
 * collapse to the shrink-to-fit 357 pixels. One of them -- the board-sight trainer -- printed the position as a
 * sentence instead of showing it. There was no single place where "the board is the biggest thing on the screen"
 * could be true.
 *
 * So the board is not something an area draws. An area hands this component the board's props, and this component
 * decides how big the board is: it measures the space left after the columns beside it, and hands `Board` a pixel
 * size. An area cannot draw a small board, because an area no longer draws the board at all.
 *
 * ## How the size is worked out
 *
 * The middle column is measured with a resize observer -- not a media query, because the board sits beside panels
 * and what matters is the room it actually has, not how wide the window is. `boardSize` in `src/shared/chess`
 * turns the two numbers into the side of the board, and it is tested there. Two things are taken off the room
 * before it is measured: the width of the evaluation strip when one is asked for, and the height of the line of
 * words under a board that can be drawn on. Both are real and both would otherwise make the board a little too
 * big for its box and push the bottom rank out of sight.
 */

/** The width the evaluation strip and its gap take out of the room, which `board.css` sets as padding. */
const EVAL_WIDTH = 36
/** The height the line of words under a board that can be drawn on takes. */
const NOTE_HEIGHT = 26

export interface ChessStageProps {
  /**
   * Everything the board needs, except how big it is. The stage passes `size` itself, so anything given here for
   * it is ignored.
   */
  board: Omit<BoardProps, 'size'>
  /** Above the board, across the middle column: who is playing, the clock, the piece one side is up. */
  above?: React.ReactNode
  /** Under the board: the buttons that walk the game, a line about what just happened. */
  below?: React.ReactNode
  /** The left column, for anything an area needs beside the board. Left out, there is no left column. */
  left?: React.ReactNode
  /** The right column: the move list and the controls. Left out, the board gets the width. */
  right?: React.ReactNode
  /** A ceiling on the board, for the few screens where a huge board would be wrong. Normally left out. */
  maxBoard?: number
  /** Put on the stage, for an area that needs to reach its own parts. */
  className?: string
  /** Said as the name of the whole arrangement, for anybody moving through the screen by region. */
  label?: string
}

export function ChessStage({
  board, above, below, left, right, maxBoard, className, label = 'Board'
}: ChessStageProps): React.JSX.Element {
  const slot = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  const measure = useCallback((): void => {
    const element = slot.current
    if (!element) return
    const box = element.getBoundingClientRect()
    setRoom({ width: box.width, height: box.height })
  }, [])

  useEffect(() => {
    const element = slot.current
    if (!element) return
    measure()
    if (typeof ResizeObserver !== 'function') return
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [measure])

  const wantsBar = board.evalBar !== null && board.evalBar !== undefined
  const canDraw = typeof board.onMarksChange === 'function'
  const rules = maxBoard === undefined ? {} : { max: maxBoard }
  const space = {
    width: Math.max(0, room.width - (wantsBar ? EVAL_WIDTH : 0)),
    height: Math.max(0, room.height - (canDraw ? NOTE_HEIGHT : 0))
  }
  const side = boardSize(space, rules)
  const tight = squeezed(space, rules)

  return (
    <div className={`cw-stage${left ? ' has-left' : ''}${right ? ' has-right' : ''}${className ? ` ${className}` : ''}`}>
      {left && <aside className="cw-stage-left">{left}</aside>}
      <section className="cw-stage-mid" aria-label={label}>
        {above && <div className="cw-stage-above">{above}</div>}
        <div className="cw-stage-slot" ref={slot}>
          {/* The board is given a measured size, so it is as large as the room allows and never shrink-to-fit. */}
          <Board {...board} size={side} />
        </div>
        {below && <div className="cw-stage-below">{below}</div>}
        {/* Said out loud rather than drawn as a board that quietly does not fit. */}
        {tight && (
          <p className="cw-stage-tight" role="status">
            The window is too small for the board to fit. Make it wider, or close a panel.
          </p>
        )}
      </section>
      {right && <aside className="cw-stage-right">{right}</aside>}
    </div>
  )
}

export default ChessStage
