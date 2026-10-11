/**
 * What `choose:do` answers with, and how to tell the three answers apart.
 *
 * Shared rather than declared in the main process, because the window has to read exactly the shape main writes,
 * and the guards below are the only thing standing between "a comparison came back" and "something else came
 * back". Written twice they would drift, and the drift would show up as a card drawn from a refusal.
 *
 * Three outcomes, and each means something different to the caller:
 *
 *   - **A verdict.** Draw the card.
 *   - **Not a decision.** Orion read the message and handed it back. The ordinary reply runs, and as far as
 *     anybody can tell nothing happened.
 *   - **A refusal.** Something went wrong, and it is named. Shown when the message was plainly about deciding
 *     something, swallowed in favour of the ordinary reply when it was only probably about that.
 */
import type { Verdict } from './explain.ts'
import type { Difference } from './scenario.ts'
import type { Refusal } from './types.ts'

/** A comparison, with whatever the operation that produced it has to add. */
export interface Answered {
  verdict: Verdict
  /** What a follow-up actually changed, in words. */
  applied?: readonly string[]
  /** What it could not change, and why. */
  refused?: readonly string[]
  /** For a what-if: what it did to the answer. */
  difference?: Difference
  /** For a what-if: what it was called. */
  scenario?: string
  /**
   * True when a newer message for this conversation has already been answered.
   *
   * The caller drops it. The arithmetic is not wrong -- it is about a decision that has since moved, and putting
   * it in the conversation would show an older state underneath a newer one.
   */
  stale?: boolean
}

/** Orion read the message and it is not a decision. A normal answer, not a failure. */
export interface HandedBack {
  notADecision: true
  because: string
}

export type ChooseReply = Answered | HandedBack | Refusal

export const isAnswered = (held: unknown): held is Answered =>
  typeof held === 'object' && held !== null && 'verdict' in held

export const isHandedBack = (held: unknown): held is HandedBack =>
  typeof held === 'object' && held !== null && (held as { notADecision?: unknown }).notADecision === true

/** Kept, with the name it was kept under. The one operation that answers with neither a verdict nor a refusal. */
export interface Kept {
  kept: true
  title: string
}

export const wasKept = (held: unknown): held is Kept =>
  typeof held === 'object' && held !== null && (held as { kept?: unknown }).kept === true

/**
 * A refusal's words, for a screen.
 *
 * Takes `unknown` on purpose: it is called on whatever came back after the guards above have ruled out the
 * answers that are not refusals, and the one thing it must never do is throw while trying to report a failure.
 */
export const whyNot = (answer: unknown): string => {
  const held = (answer ?? {}) as { problem?: unknown; fix?: unknown }
  const problem = typeof held.problem === 'string' ? held.problem : 'That could not be worked out.'
  const fix = typeof held.fix === 'string' ? held.fix : ''
  return `${problem} ${fix}`.trim()
}
