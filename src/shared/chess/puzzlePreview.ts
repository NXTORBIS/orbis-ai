/**
 * Which puzzle the big board shows while the list of puzzles is still on screen.
 *
 * A puzzle list beside an empty board is a page of text about chess. So while you pick from the list, the board
 * shows the position of the puzzle you have picked, and you can see it before you commit to solving it. This file
 * decides which puzzle that is. It is kept out of the screen so the choice can be tested without a window.
 *
 * ## Why the choice is a plain rule
 *
 * The board must always show a real puzzle from the collection, or nothing. So the preview is the puzzle you
 * selected when it is still in the list you are looking at, and otherwise the first puzzle in that list. When the
 * list is empty there is no preview at all, and the screen shows the empty state instead of a made-up board.
 */

import type { Puzzle } from './puzzles'

/**
 * The puzzle to preview.
 *
 * `selectedId` is the one the person last picked. If it is no longer in the list (a filter just hid it, or it was
 * removed), the first puzzle in the list is shown instead, so the board never goes blank while there are puzzles.
 */
export function previewPuzzle(pool: readonly Puzzle[], selectedId: string | null): Puzzle | null {
  if (pool.length === 0) return null
  if (selectedId !== null) {
    const picked = pool.find((one) => one.id === selectedId)
    if (picked) return picked
  }
  return pool[0]
}

/**
 * The position a puzzle starts from, as the board should draw it. This is the exercise's own starting position and
 * is never changed here, so the preview is exactly the puzzle a person would then be asked to solve.
 */
export function previewFen(puzzle: Puzzle): string {
  return puzzle.exercise.startFen
}
