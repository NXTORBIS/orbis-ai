/**
 * What the Orb in the top bar is doing, from facts about the conversation and nothing else.
 *
 *  - `idle`      nothing is being produced;
 *  - `thinking`  a reply is on its way and no words have arrived yet (searching, reading, reasoning);
 *  - `answering` words are arriving;
 *  - `done`      a reply finished a moment ago and it did not fail (brief, then back to idle);
 *  - `error`     the last reply failed or was cut short.
 *
 * `done` and `error` are what stay true for a while after a reply ends, so the Orb says how it went instead of
 * snapping straight back to idle. The window of `done` is passed in as a time so the rule is testable without a clock.
 */
export type OrbMood = 'idle' | 'thinking' | 'answering' | 'done' | 'error'

export interface OrbFacts {
  streaming: boolean
  /** Words of the current reply have arrived. */
  hasContent: boolean
  /** The newest reply carries an error. */
  failed: boolean
  /** When the last reply finished successfully (ms since epoch), or null. */
  finishedAt: number | null
  now: number
}

export const DONE_FOR_MS = 2600

export function orbMood(f: OrbFacts): OrbMood {
  if (f.streaming) return f.hasContent ? 'answering' : 'thinking'
  if (f.failed) return 'error'
  if (f.finishedAt !== null && f.now - f.finishedAt < DONE_FOR_MS) return 'done'
  return 'idle'
}
