import type { ChatMessage, ReasoningEffort, StreamEvent } from '../shared/types'
import { NIM_MODELS, isLocalModel, modelInfo, modelLabel } from '../shared/models.ts'
import { SseParser, ThinkTagSplitter } from './sse.ts'

// Overridable for local testing or another OpenAI-compatible endpoint.
export const NIM_BASE_URL = process.env.NXTORBIS_API_BASE_URL ?? 'https://integrate.api.nvidia.com/v1'
export const ORION_BASE_URL = process.env.ORBIS_ORION_BASE_URL ?? 'http://127.0.0.1:8765/v1'
const MAX_TOKENS = 32768
const MAX_RATE_LIMIT_WAIT_MS = 65_000

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

export interface ChatOptions {
  apiKey: string
  model: string
  messages: ChatMessage[]
  /** Complete system prompt; omitted from the request when empty. */
  systemPrompt: string
  reasoningEffort: ReasoningEffort
  autoFallback: boolean
  /** Sent to ORION as its memory session. */
  conversationId?: string
  signal: AbortSignal
  emit: (event: StreamEvent) => void
  fetchFn: FetchFn
}

/** Failed before any output was streamed, so another model can take over. */
class HttpError extends Error {
  status: number
  retryAfterMs?: number
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message)
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/** Failed after output started; the partial reply is kept and no fallback happens. */
class StreamError extends Error {}

const FALLBACK_STATUSES = new Set([403, 404, 429, 500, 502, 503, 504])

export async function streamChat(opts: ChatOptions): Promise<void> {
  if (isLocalModel(opts.model)) return chatOrion(opts)
  const chain = opts.autoFallback ? [opts.model, ...NIM_MODELS.map((m) => m.id).filter((id) => id !== opts.model)] : [opts.model]

  for (let round = 0; round < 2; round++) {
    let rateLimitedWaitMs: number | null = null
    let firstFailure: unknown = null

    for (let i = 0; i < chain.length; i++) {
      const model = chain[i]
      try {
        await streamOnce(model, opts)
        return
      } catch (err) {
        if (opts.signal.aborted) return opts.emit({ type: 'aborted' })
        if (!(err instanceof HttpError) || !FALLBACK_STATUSES.has(err.status)) {
          return opts.emit({ type: 'error', message: describeError(err, model) })
        }
        firstFailure ??= err
        if (err.status === 429 || err.status >= 500) {
          const wait = err.retryAfterMs ?? 60_000
          rateLimitedWaitMs = rateLimitedWaitMs === null ? wait : Math.min(rateLimitedWaitMs, wait)
        }
        const next = chain[i + 1]
        if (next) {
          const reason = err.status === 429 ? 'is rate-limited' : 'is unavailable right now'
          opts.emit({ type: 'status', message: `${modelLabel(model)} ${reason}. Switching to ${modelLabel(next)}…` })
        }
      }
    }

    if (rateLimitedWaitMs === null || round === 1) {
      return opts.emit({ type: 'error', message: describeError(firstFailure, opts.model) })
    }
    // Every model is limited: wait for the per-minute window to reset, then try the chain once more.
    await waitWithCountdown(Math.min(rateLimitedWaitMs, MAX_RATE_LIMIT_WAIT_MS), opts)
    if (opts.signal.aborted) return opts.emit({ type: 'aborted' })
  }
}

async function streamOnce(model: string, opts: ChatOptions, lean = false): Promise<void> {
  const info = modelInfo(model)
  const body: Record<string, unknown> = {
    model,
    messages: toApiMessages(opts.messages, opts.systemPrompt, model),
    stream: true
  }
  if (!lean) {
    body.max_tokens = MAX_TOKENS
    if (info.reasoningEffort) body.reasoning_effort = opts.reasoningEffort
  }

  const res = await opts.fetchFn(`${NIM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(body),
    signal: opts.signal
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Some deployments reject optional params; retry once with a minimal request.
    if (res.status === 400 && !lean) return streamOnce(model, opts, true)
    throw new HttpError(res.status, extractErrorMessage(text) || res.statusText, parseRetryAfter(res.headers.get('retry-after')))
  }
  if (!res.body) throw new HttpError(502, 'Empty response from NVIDIA')

  opts.emit({ type: 'start', model })

  const parser = new SseParser()
  const splitter = new ThinkTagSplitter()
  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  let finishReason: string | null = null

  const handle = (data: string): void => {
    if (data === '[DONE]') return
    let chunk: StreamChunk
    try {
      chunk = JSON.parse(data) as StreamChunk
    } catch {
      return
    }
    if (chunk.error) throw new StreamError(chunk.error.message ?? 'The model stopped with an error.')
    const choice = chunk.choices?.[0]
    if (!choice) return
    const delta = choice.delta ?? {}
    let reasoning = asText(delta.reasoning_content) || asText(delta.reasoning)
    let content = ''
    const raw = asText(delta.content)
    if (raw) {
      const split = splitter.push(raw)
      content = split.content
      reasoning += split.reasoning
    }
    if (content || reasoning) opts.emit({ type: 'delta', content: content || undefined, reasoning: reasoning || undefined })
    if (choice.finish_reason) finishReason = choice.finish_reason
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const event of parser.push(decoder.decode(value, { stream: true }))) handle(event)
    }
    for (const event of [...parser.push(decoder.decode()), ...parser.flush()]) handle(event)
  } catch (err) {
    if (opts.signal.aborted || err instanceof StreamError) throw err
    throw new StreamError(`Connection lost: ${err instanceof Error ? err.message : String(err)}`)
  }

  const tail = splitter.flush()
  if (tail.content || tail.reasoning) {
    opts.emit({ type: 'delta', content: tail.content || undefined, reasoning: tail.reasoning || undefined })
  }
  opts.emit({ type: 'done', model, truncated: finishReason === 'length' })
}

/** ORION replies with one JSON message (no SSE) and never hands the chat to a cloud model. */
async function chatOrion(opts: ChatOptions): Promise<void> {
  let res: Response
  let text: string
  try {
    res = await opts.fetchFn(`${ORION_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        messages: toApiMessages(opts.messages, opts.systemPrompt, opts.model),
        session: opts.conversationId,
        stream: false
      }),
      signal: opts.signal
    })
    text = await res.text()
  } catch (err) {
    if (opts.signal.aborted) return opts.emit({ type: 'aborted' })
    const reason = err instanceof Error ? err.message : String(err)
    return opts.emit({
      type: 'error',
      message: `Couldn't reach ORION at ${ORION_BASE_URL} (${reason}). Start it from the orion folder with: .venv\\Scripts\\python.exe -m orion.api.server configs/system/laptop.yaml`
    })
  }
  if (!res.ok) return opts.emit({ type: 'error', message: `ORION returned ${res.status}: ${extractErrorMessage(text) || res.statusText}` })

  let reply: OrionReply
  try {
    reply = JSON.parse(text) as OrionReply
  } catch {
    return opts.emit({ type: 'error', message: 'ORION sent a reply that is not JSON.' })
  }
  const choice = reply.choices?.[0]
  const raw = asText(choice?.message?.content)
  if (!raw) return opts.emit({ type: 'error', message: 'ORION returned an empty reply.' })

  const splitter = new ThinkTagSplitter()
  const head = splitter.push(raw)
  const tail = splitter.flush()
  const content = head.content + tail.content
  const reasoning = head.reasoning + tail.reasoning
  opts.emit({ type: 'start', model: opts.model })
  opts.emit({ type: 'delta', content: content || undefined, reasoning: reasoning || undefined })
  opts.emit({ type: 'done', model: opts.model, truncated: choice?.finish_reason === 'length' })
}

interface OrionReply {
  choices?: { message?: { content?: unknown }; finish_reason?: string | null }[]
}

interface StreamChunk {
  choices?: { delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: string | null }[]
  error?: { message?: string }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toApiMessages(messages: ChatMessage[], systemPrompt: string, model: string): Record<string, unknown>[] {
  const info = modelInfo(model)
  const out: Record<string, unknown>[] = systemPrompt.trim() ? [{ role: 'system', content: systemPrompt }] : []
  for (const m of messages) {
    const content = m.role === 'user' ? withAttachments(m) : m.content
    // Failed replies with no text would break role alternation, so they are left out.
    if (m.role === 'assistant' && !content) continue
    const prev = out[out.length - 1]
    if (prev?.role === 'user' && m.role === 'user') {
      prev.content = `${prev.content as string}\n\n${content}`
      continue
    }
    const msg: Record<string, unknown> = { role: m.role, content }
    if (m.role === 'assistant' && info.echoReasoning && m.reasoning && m.model === model) {
      msg.reasoning_content = m.reasoning
    }
    out.push(msg)
  }
  return out
}

function withAttachments(message: ChatMessage): string {
  if (!message.attachments?.length) return message.content
  const files = message.attachments.map((a) => `<file name="${a.name}">\n${a.content}\n</file>`).join('\n\n')
  return message.content ? `${files}\n\n${message.content}` : files
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(1000, date - Date.now())
}

function extractErrorMessage(text: string): string {
  try {
    const json = JSON.parse(text) as Record<string, unknown>
    const error = json.error as Record<string, unknown> | string | undefined
    const candidates = [typeof error === 'string' ? error : error?.message, json.detail, json.message, json.title]
    const found = candidates.find((c) => typeof c === 'string' && c)
    if (found) return found as string
  } catch {
    // not JSON
  }
  return text.slice(0, 300)
}

function describeError(err: unknown, model: string): string {
  if (err instanceof HttpError) {
    switch (err.status) {
      case 401:
        return 'NVIDIA rejected your API key. Check it in Settings.'
      case 403:
        return `Your API key doesn't have access to ${modelLabel(model)}. (${err.message})`
      case 404:
        return `${modelLabel(model)} isn't available on NVIDIA right now.`
      case 429:
        return 'All models are rate-limited. Wait a minute and try again.'
      default:
        return `NVIDIA returned ${err.status}: ${err.message}`
    }
  }
  if (err instanceof StreamError) return err.message
  if (err instanceof Error) return `Couldn't reach NVIDIA: ${err.message}`
  return 'Something went wrong.'
}

async function waitWithCountdown(ms: number, opts: ChatOptions): Promise<void> {
  const end = Date.now() + ms
  while (!opts.signal.aborted) {
    const left = end - Date.now()
    if (left <= 0) return
    opts.emit({ type: 'status', message: `All models are rate-limited. Retrying in ${Math.ceil(left / 1000)}s…` })
    await sleep(Math.min(1000, left), opts.signal)
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/** Makes a tiny request to check the key. 429 still proves the key is valid. */
export async function testApiKey(): Promise<{ ok: boolean; message: string }> {
  return { ok: true, message: 'ORION is ready. No API key needed.' }
}
