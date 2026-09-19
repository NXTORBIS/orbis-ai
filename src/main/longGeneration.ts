import type { ChatMessage, StreamEvent } from '../shared/types'
import {
  continuationInstruction,
  dedupeSeam,
  detectRequestedLength,
  MAX_DURATION_MS,
  shouldContinue,
  wordCount
} from '../shared/longGeneration.ts'

/**
 * Continuing an answer automatically when one backend call reached its output limit, so a long request is one
 * request, not one the person has to keep nudging along.
 *
 * This wraps whatever actually talks to a model — `runSegment` — without knowing anything about Groq, streaming
 * transport or retries; nim.ts's `streamChat` already owns all of that, unchanged. All this adds is: notice a
 * `truncated: true` on 'done', decide from shared/longGeneration.ts's pure rules whether more was asked for, and if
 * so make one more call with the right instruction, forwarding everything the person sees as one continuous stream.
 */

export interface RunSegment {
  (messages: ChatMessage[], emit: (event: StreamEvent) => void): Promise<void>
}

export interface GenerateWithContinuationOptions {
  messages: ChatMessage[]
  emit: (event: StreamEvent) => void
  runSegment: RunSegment
  signal: AbortSignal
  /** Overridable for tests, so a continuation chain does not have to run for real minutes to be checked. */
  now?: () => number
}

/**
 * Runs one answer to completion, transparently continuing it as many times as `shouldContinue` allows.
 *
 * Everything the caller's `emit` receives is exactly what one ordinary, uninterrupted answer would have produced:
 * one 'start', a continuous run of 'delta's, then one final 'done' (or 'error'/'aborted'). No segment boundary,
 * no internal status, ever reaches it — the loop is invisible on purpose.
 */
export async function generateWithContinuation(opts: GenerateWithContinuationOptions): Promise<void> {
  const now = opts.now ?? Date.now
  const startedAt = now()
  const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')
  const length = detectRequestedLength(lastUser?.content ?? '')

  let attemptMessages = opts.messages
  let combined = ''
  let segments = 0
  let settled = false

  for (;;) {
    segments++
    let segmentTruncated = false
    let finalModel = ''
    let sawStart = false
    let pendingErrorOrAbort = false
    // The start of a continuation segment is held in a small buffer, not emitted chunk by chunk, until there is
    // enough of it to actually check for an accidental repeat — a restarted phrase can easily span more than one
    // streamed piece, and checking each piece alone would never see it. The first segment has nothing to repeat,
    // so it is never buffered at all.
    const DEDUPE_WINDOW = 120
    let pending = ''
    let flushed = segments === 1

    const flushPending = (): void => {
      if (flushed) return
      flushed = true
      const deduped = dedupeSeam(combined, pending)
      combined += deduped
      if (deduped) opts.emit({ type: 'delta', content: deduped })
      pending = ''
    }

    await opts.runSegment(attemptMessages, (event) => {
      if (settled || pendingErrorOrAbort) return
      switch (event.type) {
        case 'start':
          finalModel = event.model
          // A continuation's own 'start' is not a new answer beginning; the person already saw one.
          if (!sawStart) {
            sawStart = true
            if (segments === 1) opts.emit(event)
          }
          return
        case 'delta': {
          // Reasoning is never part of the seam being checked; it streams through immediately either way.
          if (event.reasoning) opts.emit({ type: 'delta', reasoning: event.reasoning })
          if (typeof event.content !== 'string' || !event.content) return
          if (flushed) {
            combined += event.content
            opts.emit({ type: 'delta', content: event.content })
            return
          }
          pending += event.content
          if (pending.length >= DEDUPE_WINDOW) flushPending()
          return
        }
        case 'done':
          flushPending()
          segmentTruncated = event.truncated
          finalModel = event.model
          return
        case 'error':
          flushPending()
          pendingErrorOrAbort = true
          settled = true
          opts.emit(event)
          return
        case 'aborted':
          flushPending()
          pendingErrorOrAbort = true
          settled = true
          opts.emit(event)
          return
        default:
          // Research, status, image and every browser/automation event pass straight through unchanged.
          opts.emit(event)
      }
    })

    if (settled) return

    const continuing = shouldContinue({
      truncated: segmentTruncated,
      length,
      generatedWords: wordCount(combined),
      segments,
      elapsedMs: now() - startedAt
    })
    if (!continuing) {
      opts.emit({ type: 'done', model: finalModel, truncated: false })
      return
    }
    if (opts.signal.aborted) {
      opts.emit({ type: 'aborted' })
      return
    }

    const instruction = continuationInstruction({
      originalRequest: lastUser?.content ?? '',
      length,
      generatedWords: wordCount(combined)
    })
    const createdAt = now()
    attemptMessages = [
      ...opts.messages,
      { id: `continuation-${segments}-assistant`, role: 'assistant', content: combined, createdAt },
      { id: `continuation-${segments}-instruction`, role: 'user', content: instruction, createdAt }
    ]
  }
}

// Re-exported so callers only need one import for the whole feature.
export { MAX_DURATION_MS }
