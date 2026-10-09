import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  ghostOf,
  IDLE,
  PREDICTION_DEBOUNCE_MS,
  PREDICTION_TIMEOUT_MS,
  predictionReducer,
  worthAsking,
  type InvalidReason,
  type PredictionState
} from '../../../shared/chatPrediction'

/**
 * The one guess the message box is showing, and everything that can make it stop being true.
 *
 * All the deciding happens in `shared/chatPrediction.ts`, which is plain functions and can be tested without a
 * screen. This part is only the things a screen has: a pause before asking, a limit on how long to wait, and letting
 * go of timers when the box goes away.
 *
 * What it guarantees, and what the old version did not:
 *
 * - **An answer for text that has since changed is never shown.** Every ask carries the version of the box it was
 *   asked for; the reducer drops anything older. "Does it still fit the text?" was not enough, because a guess made
 *   for "Can you" usually does still fit "Can you explain" -- and then replaced the better guess made for it.
 * - **The guess goes on the first character, not when the next one arrives.** No stale faded text sits there while
 *   Orbis thinks.
 * - **One Tab, one acceptance.** A taken guess is remembered as taken, so the reply's own guess -- still sitting in
 *   the props it came from -- cannot continue the longer text it just made and be accepted again, for ever.
 * - **Nothing is left running.** The pause, the waiting and the answer all stop when the box is closed.
 */
export interface ChatPrediction {
  /** The faded part: what Orbis thinks comes next, minus what is already typed. Empty when there is nothing. */
  ghost: string
  /** The whole sentence if the guess were taken. Null when there is nothing to take. */
  full: string | null
  /** Takes the guess. Returns the text the box should now hold, or null when there was nothing to take. */
  accept(): string | null
  /** Escape: this guess is not wanted, and is not offered again. */
  dismiss(): void
  /** Something about the surroundings changed and the guess cannot be right any more. */
  reset(reason: InvalidReason): void
  /** The box changed because of the person. Call this from the one place the text is set. */
  changed(draft: string, reason?: 'typed' | 'pasted' | 'cleared'): void
  state: PredictionState
}

export function useChatPrediction(options: {
  /** What the box holds now. */
  draft: string
  /** The guess that came with the last reply, for an empty box. Undefined when there is none. */
  replyPrediction?: string
  /** Asks for a guess at the message being typed. Undefined when guessing is not available. */
  complete?: (draft: string) => Promise<string | null>
  /** Changes whenever the conversation, the last reply or the model changes. */
  contextKey: string
  /** True while a reply is being written, or a file is attached: no guessing then. */
  suspended: boolean
}): ChatPrediction {
  const [state, send] = useReducer(predictionReducer, IDLE)

  const draftRef = useRef(options.draft)
  draftRef.current = options.draft
  const versionRef = useRef(state.version)
  versionRef.current = state.version
  const completeRef = useRef(options.complete)
  completeRef.current = options.complete
  const fullRef = useRef(state.full)
  fullRef.current = state.full
  const statusRef = useRef(state.status)
  statusRef.current = state.status

  // Guesses already asked for, so the same text is not asked about twice -- which a re-render used to do.
  const answers = useRef(new Map<string, string | null>())

  // Another conversation, another reply, another model: the old guess is about something else now.
  useEffect(() => {
    answers.current.clear()
    send({ kind: 'reset', reason: 'conversation-changed' })
  }, [options.contextKey])

  const { draft, replyPrediction, suspended } = options

  // The guess that came with the reply. Offered only for a box the person has not written in.
  useEffect(() => {
    if (suspended || !replyPrediction) return
    send({ kind: 'reply', full: replyPrediction, draft })
    // Deliberately not watching `draft`: typing is handled below, and watching it here would re-offer this guess
    // after every keystroke -- including the keystrokes that are meant to end it.
  }, [replyPrediction, suspended])

  // Guessing at what is being typed. Asked once typing pauses; dropped if the box has moved on by the time it lands.
  useEffect(() => {
    if (suspended || !completeRef.current || !worthAsking(draft)) return
    /*
     * A guess that has just been taken does not immediately ask for another one.
     *
     * Taking a guess changes the box, which looks exactly like typing to this -- so one Tab produced a longer
     * sentence and then a fresh guess continuing it, which is a Tab that never stops being offered. Nothing is asked
     * for until the person types something of their own, which is what sets this back to idle.
     */
    if (statusRef.current === 'accepted') return
    const held = answers.current.get(draft)
    if (held !== undefined) {
      send({ kind: 'asked', draft })
      send({ kind: 'answered', version: versionRef.current, full: held, draft, source: 'typing' })
      return
    }

    let alive = true
    let giveUp = 0
    const pause = window.setTimeout(() => {
      if (!alive || draftRef.current !== draft) return
      const askedAt = versionRef.current
      send({ kind: 'asked', draft })
      // Nothing cancels the request itself -- there is one channel to the model and it answers or it does not -- so
      // waiting is given up on here and the answer, if it ever comes, is dropped by its version.
      giveUp = window.setTimeout(() => {
        if (alive && versionRef.current === askedAt) send({ kind: 'reset', reason: 'timeout' })
      }, PREDICTION_TIMEOUT_MS)
      completeRef.current?.(draft)
        .then((full) => {
          answers.current.set(draft, full)
          if (alive) send({ kind: 'answered', version: askedAt, full, draft, source: 'typing' })
        })
        .catch(() => {
          // No guess this time. The box works exactly the same without one.
          if (alive && versionRef.current === askedAt) send({ kind: 'reset', reason: 'error' })
        })
    }, PREDICTION_DEBOUNCE_MS)

    return () => {
      alive = false
      window.clearTimeout(pause)
      window.clearTimeout(giveUp)
    }
  }, [draft, suspended])

  const accept = useCallback((): string | null => {
    const full = fullRef.current
    const typed = draftRef.current
    if (!full || ghostOf({ ...IDLE, status: 'showing', full }, typed) === '') return null
    send({ kind: 'accept', draft: typed })
    return typed + full.slice(typed.length)
  }, [])

  const changed = useCallback((next: string, reason: 'typed' | 'pasted' | 'cleared' = 'typed') => {
    send({ kind: 'input', draft: next, reason: next === '' ? 'cleared' : reason })
  }, [])

  return {
    ghost: suspended ? '' : ghostOf(state, options.draft),
    full: state.status === 'showing' ? state.full : null,
    accept,
    dismiss: useCallback(() => send({ kind: 'dismiss' }), []),
    reset: useCallback((reason: InvalidReason) => send({ kind: 'reset', reason }), []),
    changed,
    state
  }
}
