import type { ModelInfo, Research, StreamEvent } from '../shared/types'
import { modelLabel } from '../shared/models.ts'
import { assessReply, canRetry, strongerModel } from '../shared/replyQuality.ts'
import { acceptRevision, buildRevisionPrompt, unsupportedClaims, type RevisionPrompt } from '../shared/researchVerify.ts'

/**
 * The checks that run once an answer has finished streaming and before it is announced as done.
 *
 * Nothing is buffered: the answer streams to the window exactly as before. Only the closing `done` is held back for as
 * long as the checks take, and if a check produces a better text it goes out as one `replace` event just before `done`.
 * A reply that passes every check costs nothing but the check itself, which makes no model call.
 *
 *  - **Weak reply.** If the text is plainly broken (empty, cut off, looping, a pointless refusal) it is generated once
 *    more by a different model with more reasoning behind it. The new text replaces the old only if it passes the same
 *    check. At most one retry per message.
 *  - **Unsupported claims.** If a research answer cites sources that do not say what is claimed, it is rewritten once
 *    by the model that wrote it. The rewrite is taken only if it passes `acceptRevision`.
 *
 * Both model calls are injected, so this file knows nothing about services or keys and is tested with fakes.
 */

export interface ReplyGuardDeps {
  /** The real emit. Everything except the closing `done` is passed straight through. */
  emit: (event: StreamEvent) => void
  signal: AbortSignal
  /** The model the message was sent to. */
  model: string
  question: string
  hasAttachments: boolean
  hasPageContext: boolean
  hasImages: boolean
  /** Characters the message and its attachments take, for choosing a model with room. */
  roomNeeded: number
  /** Another full answer to the same conversation from this model, as text, or null when it failed. */
  generateAgain: (model: string) => Promise<string | null>
  /** A rewrite of a draft from this model, as text, or null when it failed. */
  revise: (model: string, prompt: RevisionPrompt) => Promise<string | null>
  models?: readonly ModelInfo[]
  log?: (line: string) => void
}

export interface ReplyGuard {
  /** Give this to whatever produces the answer. */
  emit: (event: StreamEvent) => void
  /** Run the checks and announce the end. Call once, after the answer has finished. */
  settle: () => Promise<void>
}

export function createReplyGuard(deps: ReplyGuardDeps): ReplyGuard {
  let text = ''
  let answeredBy = ''
  let research: Research | undefined
  let held: Extract<StreamEvent, { type: 'done' }> | null = null
  let ended = false
  let settled = false

  const emit = (event: StreamEvent): void => {
    switch (event.type) {
      case 'start':
        answeredBy = event.model
        deps.emit(event)
        return
      case 'delta':
        if (typeof event.content === 'string') text += event.content
        deps.emit(event)
        return
      case 'research':
        research = event.research
        deps.emit(event)
        return
      case 'done':
        held = event
        return
      case 'error':
      case 'aborted':
        ended = true
        deps.emit(event)
        return
      default:
        deps.emit(event)
    }
  }

  const log = (line: string): void => deps.log?.(line)

  async function settle(): Promise<void> {
    if (settled) return
    settled = true
    const done = held
    if (ended || !done) return

    let final = text
    let model = answeredBy || done.model || deps.model
    let doneModel = done.model
    let retried = false

    try {
      // ----- a weak reply: one more try from a different model -----
      const first = assessReply(final, { userText: deps.question, hasAttachments: deps.hasAttachments, hasPageContext: deps.hasPageContext })
      if (!first.ok && canRetry({ hasImages: deps.hasImages, aborted: deps.signal.aborted })) {
        const next = strongerModel(model, { roomNeeded: deps.roomNeeded }, deps.models)
        if (next) {
          retried = true
          log(`weak reply (${first.problems.map((p) => p.code).join(', ')}); trying ${next.id}`)
          deps.emit({ type: 'status', message: `That answer looked ${first.problems[0].code === 'empty' ? 'empty' : 'incomplete'}, so ${modelLabel(next.id)} is trying it again.` })
          const again = await deps.generateAgain(next.id).catch(() => null)
          if (again !== null && !deps.signal.aborted) {
            const second = assessReply(again, { userText: deps.question, hasAttachments: deps.hasAttachments, hasPageContext: deps.hasPageContext })
            if (second.ok) {
              final = again
              model = next.id
              doneModel = next.id
            } else {
              log(`retry was weak too (${second.problems.map((p) => p.code).join(', ')}); keeping the first reply`)
            }
          }
        }
      }

      // ----- research claims that cite a source which does not say them -----
      const sources = research?.sources ?? []
      if (sources.length > 0 && final.trim() !== '' && !deps.signal.aborted) {
        const claims = unsupportedClaims(final, sources)
        if (claims.length > 0) {
          deps.emit({ type: 'status', message: 'Some claims were not in the sources they cite, so the answer is being checked once more.' })
          const prompt = buildRevisionPrompt({ question: deps.question, draft: final, sources, claims })
          const revision = await deps.revise(model, prompt).catch(() => null)
          if (revision !== null && !deps.signal.aborted) {
            const verdict = acceptRevision({ draft: final, revision, sources })
            log(`revision ${verdict.accept ? 'accepted' : 'rejected'}: ${verdict.reason} (${verdict.before} -> ${verdict.after})`)
            if (verdict.accept) final = revision.trim()
          }
        }
      }
    } catch (err) {
      // The checks are an extra. Whatever went wrong, the reply the person already has stands.
      log(`reply checks failed: ${err instanceof Error ? err.message : String(err)}`)
      final = text
      doneModel = done.model
    }

    if (final !== text) deps.emit({ type: 'replace', content: final, model: doneModel || undefined, retried })
    deps.emit({ ...done, model: doneModel })
  }

  return { emit, settle }
}
