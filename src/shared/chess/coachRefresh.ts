/**
 * Reading the record again, and saying so.
 *
 * The coach reads games, puzzle attempts, opening recall and the saved analyses out of the profile. That read takes
 * a moment, it can fail, and it can be asked for again. Three states, and a screen that muddles them lies:
 *
 *  - **never read** -- nothing has come back yet. The coach says it is reading. It must not draw zeros, because a
 *    zero before the answer arrives is indistinguishable from "nothing you have done was recorded".
 *  - **reading** -- a read is running. There has to be something on screen saying so, or the button that asked for
 *    it looks dead. That was the real fault here: "Bring up to date" left the screen on "Still reading what you
 *    have done." for ever, because the read could throw and nothing ever turned the reading state off again.
 *  - **read** -- it finished, at a moment worth showing. "Last read four minutes ago" is the one sentence that
 *    tells somebody whether what they are looking at includes the game they just finished.
 *
 * There is a fourth state and it is the one that was missing: **it failed**. A read that threw has to say it threw.
 * Leaving the screen reading for ever is how a program claims to be working when it has stopped.
 *
 * Everything here is pure, so the words and the arithmetic are tested without a window.
 */

export type RefreshPhase = 'never' | 'reading' | 'read' | 'failed'

export interface RefreshState {
  phase: RefreshPhase
  /** When the read running now began. Null when none is running. */
  startedAt: number | null
  /** When a read last finished, successfully or not. Null until one has. */
  finishedAt: number | null
  /** Why the last read failed, in words meant to be shown as they are. Null when it did not fail. */
  problem: string | null
  /** How many reads have finished. Shown nowhere; it is what lets a screen tell a second read from the first. */
  reads: number
}

/** Before anything has been asked for. */
export const NEVER_READ: RefreshState = Object.freeze({
  phase: 'never' as RefreshPhase,
  startedAt: null,
  finishedAt: null,
  problem: null,
  reads: 0
})

/** A read has started. Anything said about the last failure goes, because it is being tried again. */
export function startedReading(state: RefreshState, at: number): RefreshState {
  return { phase: 'reading', startedAt: at, finishedAt: state.finishedAt, problem: null, reads: state.reads }
}

/** A read came back. */
export function finishedReading(state: RefreshState, at: number): RefreshState {
  return { phase: 'read', startedAt: null, finishedAt: at, problem: null, reads: state.reads + 1 }
}

/**
 * A read did not come back.
 *
 * The moment is still recorded, because "it tried four minutes ago and could not" is as much use as a success, and
 * the phase says which of the two it was. A state left on `reading` for ever is the bug this exists to stop.
 */
export function failedReading(state: RefreshState, at: number, problem: string): RefreshState {
  return {
    phase: 'failed',
    startedAt: null,
    finishedAt: at,
    problem: problem.length > 0 ? problem : 'The record could not be read, and nothing said why.',
    reads: state.reads + 1
  }
}

/** True while something is really running, which is the only thing that may draw a working state. */
export const reading = (state: RefreshState): boolean => state.phase === 'reading'

/**
 * How long ago, in the words somebody would use.
 *
 * A moment in the future is not reported as a negative age: clocks change, and "in 3 minutes" under a figure is
 * worse than "just now".
 */
export function howLongAgo(gap: number): string {
  if (!Number.isFinite(gap) || gap <= 45_000) return 'just now'
  const minutes = Math.round(gap / 60_000)
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`
  const hours = Math.round(gap / 3_600_000)
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`
  const days = Math.round(gap / 86_400_000)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** The line beside the button: what is happening, or when it last happened. */
export function refreshWords(state: RefreshState, now: number): string {
  if (state.phase === 'reading') return 'Reading your games, puzzles and saved analyses…'
  if (state.phase === 'never') return 'Your record has not been read yet.'
  const when = state.finishedAt === null ? 'just now' : howLongAgo(now - state.finishedAt)
  if (state.phase === 'failed') return `The last read, ${when}, did not finish. ${state.problem ?? ''}`.trim()
  return `Last read ${when}.`
}

/**
 * What the button says.
 *
 * `canReRead` is false when the screen was handed a fixed record and has nothing to go back to. Then the button
 * only moves the moment the figures are measured against, and it says that instead of promising a read.
 */
export function refreshButtonWords(state: RefreshState, canReRead: boolean): string {
  if (!canReRead) return 'Move the clock on'
  if (state.phase === 'reading') return 'Reading…'
  if (state.phase === 'failed') return 'Try again'
  return 'Bring up to date'
}

/** How old a read has to be before it is worth offering another one. */
export const STALE_AFTER = 300_000

/** True when what is on screen was measured long enough ago to be worth reading again. */
export function stale(state: RefreshState, now: number, afterMs: number = STALE_AFTER): boolean {
  if (state.phase === 'reading' || state.finishedAt === null) return false
  return now - state.finishedAt >= afterMs
}
