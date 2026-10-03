import { dayKey, pickByKey } from './sums.ts'

/**
 * The small collection of lines Orbis keeps, and which one is shown.
 *
 * These are Orbis's own eight lines, word for word and author for author. They were written down when the widget
 * engine was first built and lived in the Electron app's widget views (src/renderer/src/components/widgets/views.tsx,
 * as that file stood in commit 396d077); the screen that held them was deleted when the start page took the widgets
 * over, and they are here because this is now the only place that draws them. Not one word of this is new: the quote
 * widget says what Orbis already held or it says nothing, because a line nobody said, under the name of somebody who
 * never said it, is the one thing a quote must never be.
 *
 * If the widget is ever to show more than these eight, the lines belong in the app beside the rest of the widget
 * engine, not in the start page's bundle -- see the note in this folder's report.
 *
 * Pure.
 */

export interface Line {
  text: string
  /** Who said it. Never guessed, never left to the reader to assume. */
  who: string
}

export const LINES: readonly Line[] = Object.freeze([
  { text: 'The way to get started is to quit talking and begin doing.', who: 'Walt Disney' },
  { text: 'Simplicity is the soul of efficiency.', who: 'Austin Freeman' },
  { text: 'It always seems impossible until it’s done.', who: 'Nelson Mandela' },
  { text: 'What we know is a drop, what we don’t know is an ocean.', who: 'Isaac Newton' },
  { text: 'Make it work, make it right, make it fast.', who: 'Kent Beck' },
  { text: 'An ounce of practice is worth more than tons of preaching.', who: 'Mahatma Gandhi' },
  { text: 'Perfection is achieved when there is nothing left to take away.', who: 'Antoine de Saint-Exupéry' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', who: 'Proverb' }
])

/**
 * Which line to show, by the way the person asked for it to change.
 *
 * "Every day" is the date and nothing else, so every window of Orbis shows the same line all day and tomorrow's is
 * not today's. "Every time Orbis starts" hangs on when this page began, so it holds still while the page is open.
 * "Only when I ask" counts presses, which is the one place a person's own number decides it.
 */
export function lineFor(rotation: string, now: number, pick: number, startedAt: number): Line {
  const count = LINES.length
  if (rotation === 'manual') {
    const asked = Number.isFinite(pick) ? Math.trunc(pick) : 0
    return LINES[((asked % count) + count) % count]
  }
  const key = rotation === 'launch' ? `start:${Math.round(startedAt)}` : `day:${dayKey(now)}`
  return LINES[pickByKey(count, key)]
}
