import type { ChatMessage, ReasoningEffort, StreamEvent } from '../shared/types'
import { MODELS, modelInfo, modelLabel } from '../shared/models.ts'
import { SseParser, ThinkTagSplitter } from './sse.ts'

// Overridable for local testing or another OpenAI-compatible endpoint.
export const GROQ_BASE_URL = process.env.ORBIS_GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

export interface ChatOptions {
  /** Keys from the user's own GroqCloud account, tried in order when Groq rejects one. */
  apiKeys: string[]
  model: string
  messages: ChatMessage[]
  /** Complete system prompt; omitted from the request when empty. */
  systemPrompt: string
  reasoningEffort: ReasoningEffort
  autoFallback: boolean
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
  if (opts.apiKeys.length === 0) {
    return opts.emit({ type: 'error', message: 'This copy of Orbis has no Groq API key. Add it to .env.local and rebuild.' })
  }
  const chain = opts.autoFallback ? [opts.model, ...MODELS.map((m) => m.id).filter((id) => id !== opts.model)] : [opts.model]

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]
    try {
      await streamWithKeys(model, opts)
      return
    } catch (err) {
      if (opts.signal.aborted) return opts.emit({ type: 'aborted' })
      if (!(err instanceof HttpError) || !FALLBACK_STATUSES.has(err.status)) {
        return opts.emit({ type: 'error', message: describeError(err, model) })
      }
      const next = chain[i + 1]
      if (next) {
        const reason = err.status === 429 ? 'is rate-limited' : 'is unavailable right now'
        opts.emit({ type: 'status', message: `${modelLabel(model)} ${reason}. Switching to ${modelLabel(next)}…` })
      }
    }
  }
  return opts.emit({ type: 'error', message: describeError(new Error('All keys exhausted'), opts.model) })
}

/**
 * Groq defaults gpt-oss to 2048 output tokens, which high effort can spend entirely on reasoning.
 * The budget also counts against the per-minute token limit, so it is generous but not huge.
 */
const REASONING_MAX_TOKENS = 8192
const RESCUE_MAX_TOKENS = 4096

interface StreamResult {
  hasContent: boolean
  finishReason: string | null
}

/** Streams a reply, then silently retries once at low effort if reasoning left no answer. */
async function streamWithKeys(model: string, opts: ChatOptions): Promise<void> {
  let result = await withKeyRotation(opts, (key) => streamOnce(model, opts, key))
  if (!result.hasContent && modelInfo(model).reasoningEffort && !opts.signal.aborted) {
    console.warn(`[chat] ${model} finished with no answer (finish_reason=${result.finishReason}); retrying at low reasoning effort`)
    try {
      result = await withKeyRotation(opts, (key) => streamOnce(model, opts, key, 'rescue'))
    } catch (err) {
      // Nothing new was shown, so keep the reply as it is rather than switching models.
      if (!(err instanceof HttpError) || opts.signal.aborted) throw err
    }
  }
  opts.emit({ type: 'done', model, truncated: result.finishReason === 'length' })
}

/**
 * Moves to the next key when Groq rejects one (revoked/mistyped/rate-limited).
 */
async function withKeyRotation(opts: ChatOptions, attempt: (apiKey: string) => Promise<StreamResult>): Promise<StreamResult> {
  for (let k = 0; ; k++) {
    try {
      return await attempt(opts.apiKeys[k])
    } catch (err) {
      const isRejected = err instanceof HttpError && err.status === 401
      const isRateLimited = err instanceof HttpError && err.status === 429
      const shouldRetry = (isRejected || isRateLimited) && k < opts.apiKeys.length - 1 && !opts.signal.aborted
      if (!shouldRetry) throw err
      // Silently switch to next key without notifying user
    }
  }
}

/** Groq's reasoning models accept low, medium and high. */
function groqEffort(effort: ReasoningEffort): string {
  return effort === 'max' ? 'high' : effort
}

/** 'lean' drops optional params after a 400; 'rescue' is the low-effort retry for an empty answer. */
type Variant = 'normal' | 'lean' | 'rescue'

/** `maxTokens` overrides the default output budget; null omits it and leaves Groq's default. */
async function streamOnce(model: string, opts: ChatOptions, apiKey: string, variant: Variant = 'normal', maxTokens?: number | null): Promise<StreamResult> {
  const recentMessages = fitToContext(opts.messages.slice(-15), opts.systemPrompt, modelInfo(model).contextWindow)

  const body: Record<string, unknown> = {
    model,
    messages: toApiMessages(recentMessages, opts.systemPrompt, model),
    stream: true
  }
  if (variant !== 'lean' && modelInfo(model).reasoningEffort) {
    body.reasoning_effort = variant === 'rescue' ? 'low' : groqEffort(opts.reasoningEffort)
    const budget = maxTokens === undefined ? (variant === 'rescue' ? RESCUE_MAX_TOKENS : REASONING_MAX_TOKENS) : maxTokens
    if (budget !== null) body.max_completion_tokens = budget
  }

  const res = await opts.fetchFn(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(body),
    signal: opts.signal
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const errorMsg = extractErrorMessage(text) || res.statusText

    // Groq counts the output budget against the per-minute token limit; shrink it to fit.
    if ((res.status === 413 || res.status === 400) && errorMsg.toLowerCase().includes('token') && typeof body.max_completion_tokens === 'number') {
      return streamOnce(model, opts, apiKey, variant, fitBudget(errorMsg, body.max_completion_tokens))
    }

    // Handle token limit errors
    if ((res.status === 413 || res.status === 400) && errorMsg.toLowerCase().includes('token')) {
      throw new HttpError(res.status, 'Message too long for this model. Try clearing old messages or using a shorter conversation history.', parseRetryAfter(res.headers.get('retry-after')))
    }

    // Handle unsupported model errors
    if ((res.status === 400) && (errorMsg.toLowerCase().includes('classification') || errorMsg.toLowerCase().includes('streaming') || errorMsg.toLowerCase().includes('does not support'))) {
      throw new HttpError(res.status, `Model ${model} is not available or does not support this operation. Please select a different model.`, parseRetryAfter(res.headers.get('retry-after')))
    }

    // A model may reject optional params; retry once with a minimal request.
    if (res.status === 400 && variant === 'normal') return streamOnce(model, opts, apiKey, 'lean')
    throw new HttpError(res.status, errorMsg, parseRetryAfter(res.headers.get('retry-after')))
  }
  if (!res.body) throw new HttpError(502, 'Empty response from Groq')

  // The rescue continues the reply that already started.
  if (variant !== 'rescue') opts.emit({ type: 'start', model })
  return readStream(res.body, opts)
}

/** Relays an OpenAI-style SSE body as delta events. */
async function readStream(stream: ReadableStream<Uint8Array>, opts: ChatOptions): Promise<StreamResult> {
  const parser = new SseParser()
  const splitter = new ThinkTagSplitter()
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let finishReason: string | null = null
  let hasContent = false

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
    if (content.trim()) hasContent = true
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
  if (tail.content.trim()) hasContent = true
  if (tail.content || tail.reasoning) {
    opts.emit({ type: 'delta', content: tail.content || undefined, reasoning: tail.reasoning || undefined })
  }
  return { hasContent, finishReason }
}

interface StreamChunk {
  choices?: { delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: string | null }[]
  error?: { message?: string }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const DATA_IMAGE_MARKDOWN = /!\[[^\]]*\]\(data:image\/[^)]+\)/g

function messageSize(m: ChatMessage): number {
  const files = (m.attachments ?? []).reduce((n, a) => n + (a.type === 'image' ? 0 : a.content.length), 0)
  return m.content.replace(DATA_IMAGE_MARKDOWN, '[generated image]').length + files
}

/** Drops the oldest messages until the request fits the model's context, always keeping the newest. */
function fitToContext(messages: ChatMessage[], systemPrompt: string, contextWindow: number): ChatMessage[] {
  // Roughly 4 characters per token, keeping 40% of the window free for the reply.
  const budget = contextWindow * 0.6 * 4 - systemPrompt.length
  let total = messages.reduce((n, m) => n + messageSize(m), 0)
  let start = 0
  while (start < messages.length - 1 && total > budget) total -= messageSize(messages[start++])
  return messages.slice(start)
}

function toApiMessages(messages: ChatMessage[], systemPrompt: string, model: string): Record<string, unknown>[] {
  const info = modelInfo(model)
  const out: Record<string, unknown>[] = systemPrompt.trim() ? [{ role: 'system', content: systemPrompt }] : []
  for (const m of messages) {
    // Generated images are inline base64; sending them back would blow the token limit.
    const content = m.role === 'user' ? toMessageContent(m, info) : m.content.replace(DATA_IMAGE_MARKDOWN, '[generated image]')
    // Failed replies with no text would break role alternation, so they are left out.
    if (m.role === 'assistant' && !content) continue
    const prev = out[out.length - 1]
    if (prev?.role === 'user' && m.role === 'user' && typeof content === 'string' && typeof prev.content === 'string') {
      prev.content = `${prev.content}\n\n${content}`
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

function toMessageContent(message: ChatMessage, model: ReturnType<typeof modelInfo>): string | Record<string, unknown>[] {
  if (!message.attachments?.length) return message.content

  const hasImages = message.attachments.some(a => a.type === 'image')
  const supportsVision = model.vision

  // Without images (or vision), send plain text so text-only models accept it
  if (!hasImages || !supportsVision) {
    const textParts = message.attachments.filter(a => a.type !== 'image').map(a => `<file name="${a.name}">\n${a.content}\n</file>`)
    const textContent = textParts.length > 0 ? textParts.join('\n\n') : ''
    if (message.content) {
      return textContent ? `${textContent}\n\n${message.content}` : message.content
    }
    return textContent || message.content
  }

  const parts: Record<string, unknown>[] = []

  for (const a of message.attachments) {
    if (a.type === 'image') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${a.mimeType || 'image/jpeg'};base64,${a.content}`
        }
      })
    } else {
      parts.push({
        type: 'text',
        text: `<file name="${a.name}">\n${a.content}\n</file>`
      })
    }
  }

  if (message.content) {
    parts.push({ type: 'text', text: message.content })
  }

  return parts.length === 1 && typeof parts[0].text === 'string' ? (parts[0].text as string) : parts
}

/**
 * Reads "Limit 8000, Requested 11000" from a too-large error and returns the biggest budget that fits,
 * or null (Groq's default) when it can't be worked out or would be smaller than that default.
 */
function fitBudget(message: string, requested: number): number | null {
  const match = /limit\D*(\d+).*?requested\D*(\d+)/i.exec(message)
  if (!match) return null
  const promptTokens = Number(match[2]) - requested
  const fit = Number(match[1]) - promptTokens - 256
  return fit >= 2048 ? Math.min(fit, requested - 1) : null
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
        return 'Groq rejected the API key. Put a valid key in .env.local and rebuild.'
      case 403:
        return `The Groq API key doesn't have access to ${modelLabel(model)}. (${err.message})`
      case 404:
        return `${modelLabel(model)} isn't available on Groq right now.`
      case 429:
        return "Groq's rate limit is reached. Wait a minute and try again."
      default:
        return `Groq returned ${err.status}: ${err.message}`
    }
  }
  if (err instanceof StreamError) return err.message
  if (err instanceof Error) return `Couldn't reach Groq: ${err.message}`
  return 'Something went wrong.'
}


/** Lists models with each key. 429 still proves a key is valid. */
export async function testApiKey(apiKeys: string[], fetchFn: FetchFn): Promise<{ ok: boolean; message: string }> {
  if (apiKeys.length === 0) return { ok: false, message: 'No Groq API key is built into this copy of Orbis.' }
  let accepted = 0
  for (const key of apiKeys) {
    try {
      const res = await fetchFn(`${GROQ_BASE_URL}/models`, { headers: { Authorization: `Bearer ${key}` } })
      if (res.ok || res.status === 429) accepted++
    } catch (err) {
      return { ok: false, message: `Couldn't reach Groq: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  return { ok: accepted > 0, message: `Groq accepted ${accepted} of ${apiKeys.length} API key${apiKeys.length === 1 ? '' : 's'}.` }
}
