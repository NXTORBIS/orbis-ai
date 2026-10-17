import type { ChatMessage } from '../shared/types'
import {
  assembleHistory,
  buildSummaryPrompt,
  cleanSummary,
  makeSummary,
  planHistory,
  stepsOf,
  type HistorySummary,
  type SummaryPrompt
} from '../shared/historySummary.ts'
import { GROQ_BASE_URL } from './nim.ts'

/** One model call: the prompt in, the model's text out, or null when it could not answer. */
export type SummaryCall = (prompt: SummaryPrompt) => Promise<string | null>

/** Most steps one message may spend on summarising; beyond it the plain trimming is used instead. */
const MAX_STEPS = 3

export interface PreparedHistory {
  /** The messages to send: the turns kept word for word, or everything unchanged when no summary applies. */
  messages: ChatMessage[]
  /** Labelled note to append to the system prompt, or '' when none. */
  summaryMessage: string
  /** A summary that is new or extended and should be stored; null when nothing changed. */
  toStore: HistorySummary | null
  /**
   * What happened. `partial` is a summary that covers only the older part of what was folded, with the rest sent word
   * for word; `failed` means no summary at all and the messages exactly as they came in.
   */
  outcome: 'none' | 'reused' | 'extended' | 'built' | 'partial' | 'failed'
}

/**
 * Decides whether this history needs a summary and, if so, produces it with at most a few model calls. A failed call
 * means `outcome: 'failed'` with the messages UNCHANGED, so the sender's ordinary trimming applies exactly as before.
 */
export async function prepareHistory(input: {
  messages: ChatMessage[]
  systemChars: number
  roomChars: number
  stored: HistorySummary | null
  call: SummaryCall
  now: number
}): Promise<PreparedHistory> {
  const unchanged = (outcome: PreparedHistory['outcome']): PreparedHistory => ({ messages: input.messages, summaryMessage: '', toStore: null, outcome })
  const plan = planHistory({ messages: input.messages, systemChars: input.systemChars, roomChars: input.roomChars, stored: input.stored })
  if (plan.kind === 'none') return unchanged('none')
  if (plan.kind === 'reuse') return { ...assembleHistory(plan.summary.text, plan.keep), toStore: null, outcome: 'reused' }
  const steps = stepsOf(plan.add)
  if (steps.length > MAX_STEPS) return unchanged('failed')
  let text = plan.kind === 'extend' ? plan.previous.text : null
  let covered = plan.kind === 'extend' ? plan.previous.count : 0
  /*
   * A failure part way through does not throw away the summary already made.
   *
   * What there is honestly covers the first turns of the folded list, so those stay summarised and the turns it does
   * not cover are sent word for word instead. That is more text than planned, and still the better half of the only
   * two choices: the sender trims from the oldest end regardless, and this way the oldest end is the part that has a
   * summary. It is stored as far as it got, so the next message carries on from there rather than starting again.
   */
  const partial = (): PreparedHistory =>
    text && covered > 0
      ? {
          ...assembleHistory(text, [...plan.fold.slice(covered), ...plan.keep]),
          toStore: makeSummary(text, plan.fold.slice(0, covered), input.now),
          outcome: 'partial'
        }
      : unchanged('failed')
  try {
    for (const step of steps) {
      const clean = cleanSummary(await input.call(buildSummaryPrompt(text, step)))
      if (!clean) return partial()
      text = clean
      covered += step.length
    }
  } catch {
    return partial()
  }
  if (!text) return unchanged('failed')
  const summary = makeSummary(text, plan.fold.slice(0, covered), input.now)
  return { ...assembleHistory(text, plan.keep), toStore: summary, outcome: plan.kind === 'extend' ? 'extended' : 'built' }
}

/**
 * Summaries for chats that are never written to disk: an incognito chat is still a conversation that can run long, and
 * without this it would pay for a summarising call on every single message. Kept in memory only, and gone when Orbis
 * closes -- which is exactly what incognito means.
 */
const held = new Map<string, HistorySummary>()

export function heldSummary(key: string): HistorySummary | null {
  return held.get(key) ?? null
}

export function holdSummary(key: string, summary: HistorySummary): void {
  held.set(key, summary)
  // A handful of chats at a time is plenty; the oldest goes first.
  if (held.size > 20) held.delete(held.keys().next().value!)
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/**
 * The one real model call, on a fast Groq model (ORION Core), trying each key in turn. Any failure is null -- a summary
 * is never a reason for a reply to fail. Not exercised by tests, which fake `SummaryCall`.
 */
export function groqSummaryCall(apiKeys: string[], fetchFn: FetchFn, signal?: AbortSignal): SummaryCall {
  return async (prompt) => {
    for (const apiKey of apiKeys) {
      try {
        const res = await fetchFn(`${GROQ_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'openai/gpt-oss-20b',
            reasoning_effort: 'low',
            temperature: 0.2,
            max_completion_tokens: 900,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user }
            ]
          }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000)
        })
        if (res.status === 401 || res.status === 429) continue
        if (!res.ok) return null
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        return json.choices?.[0]?.message?.content?.trim() || null
      } catch {
        return null
      }
    }
    return null
  }
}
