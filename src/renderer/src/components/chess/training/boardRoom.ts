import { useCallback, useEffect, useRef, useState } from 'react'
import { boardSize, squeezed } from '../../../../../shared/chess/boardSize'

/**
 * How many pixels square the board has room for, measured off a real box on the screen.
 *
 * The shared `ChessStage` does this for itself, and every Train screen that has a position to show uses it. Two
 * things in this group are not a position on a board and still have to be exactly the size of one: the square the
 * board is *not* in while a blindfold or hidden-board round is running, and Board Vision's own grid of squares,
 * which cannot be the shared board because the shared board names its squares and the name is the answer.
 *
 * Both of those need the same measurement, and getting it wrong is what made the old screens tiny: a board sized
 * as a percentage of a shrink-to-fit box settles at whatever width the text underneath happens to be. So the
 * measurement is taken here, from the box itself, with a resize observer, and `boardSize` in `src/shared/chess`
 * turns the two numbers into a side -- rounded down to a multiple of eight so every square is the same width.
 */

export interface BoardRoom {
  /** Put on the box the board has to fit inside. Nothing is measured until it is. */
  ref: React.RefObject<HTMLDivElement | null>
  /** The side of the board, in pixels. Never below the floor `boardSize` keeps. */
  side: number
  /** True when the room is smaller than the smallest board worth drawing, so a screen can say so out loud. */
  tight: boolean
}

export function useBoardRoom(max?: number): BoardRoom {
  const ref = useRef<HTMLDivElement | null>(null)
  const [room, setRoom] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  const measure = useCallback((): void => {
    const element = ref.current
    if (!element) return
    const box = element.getBoundingClientRect()
    setRoom({ width: box.width, height: box.height })
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    measure()
    if (typeof ResizeObserver !== 'function') return
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [measure])

  const rules = max === undefined ? {} : { max }
  return { ref, side: boardSize(room, rules), tight: squeezed(room, rules) }
}
