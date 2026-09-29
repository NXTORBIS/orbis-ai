/**
 * What a screen says back to the person, and what a reply looks like while it is arriving.
 *
 * These three types lived in `App.tsx`, which meant forty files imported the application shell to get a string union
 * of three words. Twenty-six of them imported nothing else from it. That is not a dependency on the shell; it is an
 * accident of where the type was written down, and it is what made `App.tsx` look impossible to split.
 *
 * Nothing here knows about React, the DOM or Electron. It is three shapes and a severity.
 */

/** A reply being written, while it is being written. */
export interface StreamState {
  requestId: string
  messageId: string
  /** Rate-limit or fallback notices from the main process, shown beside the reply as it arrives. */
  status?: string
}

/**
 * How much a notice matters.
 *
 * Three, not five. A scale with more steps than somebody can tell apart at a glance is a scale nobody applies
 * consistently -- and a warning that looks like an error teaches people to ignore errors.
 */
export type NoticeKind = 'info' | 'warn' | 'error'

export interface Notice {
  id: string
  text: string
  kind: NoticeKind
  /** When it arrived, so it can be ordered and aged out. */
  at: number
}
