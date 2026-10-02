import type { ChatMessage, ModelInfo, ReasoningEffort, StreamEvent } from '../shared/types'
import { CHAT_MODELS, modelInfo, modelLabel, providerOf } from '../shared/models.ts'
import { PROVIDERS } from '../shared/providers.ts'
import { AUTO_MODEL } from '../shared/modelRoute.ts'
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
  /** 'key': this key can never be used (its organization is restricted). */
  reason?: 'key'
  constructor(status: number, message: string, retryAfterMs?: number, reason?: 'key') {
    super(message)
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.reason = reason
  }
}

/** Failed after output started; the partial reply is kept and no fallback happens. */
class StreamError extends Error {
  /** Whether any answer text had been shown before the failure. */
  hasContent = false
}

const FALLBACK_STATUSES = new Set([403, 404, 413, 429, 500, 502, 503, 504])

interface Attempt {
  model: string
  variant: Variant
}

export async function streamChat(opts: ChatOptions): Promise<void> {
  if (opts.apiKeys.length === 0) {
    return opts.emit({ type: 'error', message: 'This copy of Orbis has no Groq API key. Add it to .env.local and rebuild.' })
  }
  // Auto is never a model Groq knows; it is resolved before this point, and is never a fallback.
  const chain: Attempt[] = [opts.model, ...(opts.autoFallback ? CHAT_MODELS.map((m) => m.id).filter((id) => id !== opts.model && id !== AUTO_MODEL) : [])].map((model) => ({
    model,
    variant: 'normal'
  }))
  let lastError: unknown = new Error('All keys exhausted')
  let lastModel = opts.model

  for (let i = 0; i < chain.length; i++) {
    const { model, variant } = chain[i]
    try {
      await streamWithKeys(model, opts, variant)
      return
    } catch (err) {
      if (opts.signal.aborted) return opts.emit({ type: 'aborted' })
      lastError = err
      lastModel = model
      if (!(err instanceof HttpError) || !FALLBACK_STATUSES.has(err.status)) {
        return opts.emit({ type: 'error', message: describeError(err, model) })
      }
      const next = chain[i + 1]
      if (next) {
        const reason = err.status === 429 ? 'is rate-limited' : err.status === 413 ? "can't take a message this long" : 'is unavailable right now'
        opts.emit({ type: 'status', message: `${modelLabel(model)} ${reason}. Switching to ${modelLabel(next.model)}…` })
      }
    }
  }
  return opts.emit({ type: 'error', message: describeError(lastError, lastModel) })
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
async function streamWithKeys(model: string, opts: ChatOptions, variant: Variant = 'normal'): Promise<void> {
  const info = modelInfo(model)
  let result = await withKeyRotation(opts, (key) => streamOnce(model, opts, key, variant))
  if (!result.hasContent && info.reasoningEffort && !opts.signal.aborted) {
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

/** Keys Groq refuses outright (revoked, or their organization restricted), skipped for the rest of the session. */
const unusableKeys = new Set<string>()
/** The key that last worked. Requests start from it, so spent keys aren't retried from the top of the list every time. */
let preferredKey: string | null = null

/**
 * Moves to the next key when Groq rejects one (revoked, restricted, without access, or rate-limited).
 * `skipPreferred` starts one key further along, for when the last key's per-minute allowance ran out mid-reply.
 */
async function withKeyRotation(
  opts: ChatOptions,
  attempt: (apiKey: string) => Promise<StreamResult>,
  skipPreferred = false
): Promise<StreamResult> {
  const usable = opts.apiKeys.filter((key) => !unusableKeys.has(key))
  // If every key has been refused before, ask Groq again rather than giving up without trying.
  const keys = usable.length > 0 ? usable : opts.apiKeys
  const preferred = preferredKey === null ? -1 : keys.indexOf(preferredKey)
  const start = preferred === -1 ? 0 : (preferred + (skipPreferred ? 1 : 0)) % keys.length
  for (let k = 0; ; k++) {
    const key = keys[(start + k) % keys.length]
    try {
      const result = await attempt(key)
      preferredKey = key
      return result
    } catch (err) {
      const refused = err instanceof HttpError && (err.status === 401 || err.reason === 'key')
      if (refused) unusableKeys.add(key)
      const rotate = refused || (err instanceof HttpError && (err.status === 403 || err.status === 429))
      if (!rotate || k >= keys.length - 1 || opts.signal.aborted) throw err
      // Silently switch to next key without notifying user
    }
  }
}

/** Groq's reasoning models accept low, medium and high. */
function groqEffort(effort: ReasoningEffort): string {
  return effort === 'max' ? 'high' : effort
}

/**
 * 'lean' drops optional params after a 400; 'rescue' is the low-effort retry for an empty answer.
 */
type Variant = 'normal' | 'lean' | 'rescue'

/**
 * `maxTokens` overrides the default output budget; null omits it and leaves Groq's default.
 * `charBudget` overrides how much history is sent, in characters, after Groq says a request is too large.
 */
async function streamOnce(
  model: string,
  opts: ChatOptions,
  apiKey: string,
  variant: Variant = 'normal',
  maxTokens?: number | null,
  charBudget?: number
): Promise<StreamResult> {
  const info = modelInfo(model)
  const recentMessages = fitToContext(opts.messages.slice(-15), opts.systemPrompt, charBudget ?? inputCharBudget(info))

  const body: Record<string, unknown> = {
    // An Orbis model can be a variant of a Groq model (ORION Pro is Qwen 3.8 with thinking off).
    model: info.apiModel ?? model,
    messages: toApiMessages(recentMessages, opts.systemPrompt, model),
    stream: true
  }
  if (variant !== 'lean' && info.reasoningEffort) {
    body.reasoning_effort = variant === 'rescue' ? 'low' : groqEffort(opts.reasoningEffort)
    const budget = maxTokens === undefined ? (variant === 'rescue' ? RESCUE_MAX_TOKENS : REASONING_MAX_TOKENS) : maxTokens
    if (budget !== null) body.max_completion_tokens = budget
  } else if (variant !== 'lean') {
    // A smaller reply budget asked for after Groq reported a per-minute output limit.
    if (typeof maxTokens === 'number') body.max_completion_tokens = maxTokens
    if (info.disableReasoning) body.reasoning_effort = 'none'
  }

  const sending = requestBodyFor(model, body)

  /*
   * The address follows the model, not the other way round.
   *
   * Hardcoding one base url was fine while there was one service. It stopped being fine the moment a model existed
   * that Groq does not serve: the request would go to Groq's address with a Mistral model name and come back as an
   * unknown-model error, which reads as Orbis being broken rather than as a request sent to the wrong place.
   */
  const res = await opts.fetchFn(`${PROVIDERS[providerOf(model)].baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(sending),
    signal: opts.signal
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const errorMsg = extractErrorMessage(text) || res.statusText
    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))

    // Every request fails on a key whose organization Groq has restricted; another key can take over.
    if (/organization[_ ]restricted|organization has been restricted/i.test(`${errorMsg} ${text}`)) {
      throw new HttpError(403, errorMsg, retryAfterMs, 'key')
    }

    // A reply budget above the model's per-minute output limit fails on every key; ask for less and try again.
    if (res.status === 429 && /output tokens per minute|\bOTPM\b/i.test(errorMsg) && variant !== 'lean') {
      const limits = parseLimits(errorMsg)
      if (limits && limits.requested > limits.limit) return streamOnce(model, opts, apiKey, variant, limits.limit, charBudget)
    }

    if ((res.status === 413 || res.status === 400) && errorMsg.toLowerCase().includes('token')) {
      // Groq counts the output budget against the per-minute token limit; shrink it to fit.
      const inputOnly = /\bITPM\b|input tokens/i.test(errorMsg)
      if (!inputOnly && typeof body.max_completion_tokens === 'number') {
        return streamOnce(model, opts, apiKey, variant, fitBudget(errorMsg, body.max_completion_tokens), charBudget)
      }
      // More history than this model's per-minute limit allows: send proportionally less and try again.
      const limits = parseLimits(errorMsg)
      if (limits && limits.requested > limits.limit) {
        const sent = opts.systemPrompt.length + recentMessages.reduce((n, m) => n + messageSize(m), 0)
        const smaller = sent * (limits.limit / limits.requested) * 0.85
        if (fitToContext(opts.messages.slice(-15), opts.systemPrompt, smaller).length < recentMessages.length) {
          return streamOnce(model, opts, apiKey, variant, maxTokens, smaller)
        }
      }
      // Even the newest message alone is too much; a model with more room can take it.
      throw new HttpError(413, errorMsg, retryAfterMs)
    }

    // Handle unsupported model errors
    if ((res.status === 400) && (errorMsg.toLowerCase().includes('classification') || errorMsg.toLowerCase().includes('streaming') || errorMsg.toLowerCase().includes('does not support'))) {
      throw new HttpError(res.status, `Model ${model} is not available or does not support this operation. Please select a different model.`, retryAfterMs)
    }

    // A model may reject optional params; retry once with a minimal request.
    if (res.status === 400 && variant === 'normal') return streamOnce(model, opts, apiKey, 'lean', undefined, charBudget)
    throw new HttpError(res.status, errorMsg, retryAfterMs)
  }
  if (!res.body) throw new HttpError(502, 'Empty response from Groq')

  // The rescue continues the reply that already started.
  if (variant !== 'rescue') opts.emit({ type: 'start', model })
  return readStream(res.body, opts)
}

/** Relays an OpenAI-style SSE body as delta events. `holdReasoning` keeps reasoning back until the answer starts. */
async function readStream(stream: ReadableStream<Uint8Array>, opts: ChatOptions): Promise<StreamResult> {
  const parser = new SseParser()
  const splitter = new ThinkTagSplitter()
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let finishReason: string | null = null
  let hasContent = false

  const relay = (content: string, reasoning: string): void => {
    if (content.trim()) hasContent = true
    if (content || reasoning) opts.emit({ type: 'delta', content: content || undefined, reasoning: reasoning || undefined })
  }

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
    relay(content, reasoning)
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
    if (opts.signal.aborted) throw err
    const failure = err instanceof StreamError ? err : new StreamError(`Connection lost: ${err instanceof Error ? err.message : String(err)}`)
    failure.hasContent = hasContent
    throw failure
  }

  const tail = splitter.flush()
  if (tail.content.trim()) hasContent = true
  if (tail.content || tail.reasoning) opts.emit({ type: 'delta', content: tail.content || undefined, reasoning: tail.reasoning || undefined })
  return { hasContent, finishReason }
}

interface StreamChunk {
  choices?: {
    delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; executed_tools?: unknown }
    finish_reason?: string | null
  }[]
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

/** How much history, in characters, a model takes: its context window, or its per-minute input limit when smaller. */
function inputCharBudget(info: ModelInfo): number {
  // Roughly 4 characters per token, keeping 40% of the window free for the reply; 3.5 against the stricter input limit.
  return Math.min(info.contextWindow * 0.6 * 4, (info.inputTokenLimit ?? Infinity) * 3.5)
}

/** Drops the oldest messages until the request fits `budget` characters, always keeping the newest. */
function fitToContext(messages: ChatMessage[], systemPrompt: string, budget: number): ChatMessage[] {
  const available = budget - systemPrompt.length
  let total = messages.reduce((n, m) => n + messageSize(m), 0)
  let start = 0
  while (start < messages.length - 1 && total > available) total -= messageSize(messages[start++])
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

/**
 * The body as the chosen service expects it.
 *
 * Every branch above is written in Groq's terms, because Groq came first and because one vocabulary is easier to read
 * than two interleaved. The difference lives here: Groq takes `max_completion_tokens` and understands
 * `reasoning_effort`, while Mistral takes `max_tokens` and **rejects** `reasoning_effort` outright -- which fails the
 * whole request rather than being politely ignored.
 */
export function requestBodyFor(model: string, body: Record<string, unknown>): Record<string, unknown> {
  if (providerOf(model) !== 'mistral') return body
  const out: Record<string, unknown> = { ...body }
  if (typeof out.max_completion_tokens === 'number') out.max_tokens = out.max_completion_tokens
  delete out.max_completion_tokens
  delete out.reasoning_effort
  return out
}

export function toMessageContent(message: ChatMessage, model: ReturnType<typeof modelInfo>): string | Record<string, unknown>[] {
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
  const limits = parseLimits(message)
  if (!limits) return null
  const promptTokens = limits.requested - requested
  const fit = limits.limit - promptTokens - 256
  return fit >= 2048 ? Math.min(fit, requested - 1) : null
}

/** Reads "Limit 7000, Requested 12630" from Groq's too-large errors. */
function parseLimits(message: string): { limit: number; requested: number } | null {
  const match = /limit\D*(\d+).*?requested\D*(\d+)/i.exec(message)
  return match ? { limit: Number(match[1]), requested: Number(match[2]) } : null
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
      case 413:
        return `This message is too long for ${modelLabel(model)} on Groq's free tier. Try a shorter message, or start a new chat.`
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
/**
 * Whether the keys work, said per service and per kind of failure.
 *
 * "Groq accepted 48 of 75" was the old answer, and it hid the thing worth knowing: 26 of those keys belonged to
 * organisations that had been restricted, which never recovers, and one was simply wrong. A busy key and a dead key
 * read identically in a count, and only one of them is worth keeping.
 *
 * Both services are asked, because a copy of Orbis with Groq keys and no Mistral key cannot look at anything -- and
 * somebody checking their keys should be told that rather than discovering it when a picture is quietly ignored.
 */
export async function testApiKey(apiKeys: string[], fetchFn: FetchFn, mistralKeys: string[] = []): Promise<{ ok: boolean; message: string }> {
  const check = async (label: string, base: string, keys: string[]): Promise<string | null> => {
    if (!keys.length) return null
    let working = 0
    let dead = 0
    let busy = 0
    for (const key of keys) {
      try {
        const res = await fetchFn(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } })
        if (res.ok) working++
        else if (res.status === 429) busy++
        else dead++
      } catch (err) {
        return `Couldn't reach ${label}: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    const parts = [`${label}: ${working} of ${keys.length} key${keys.length === 1 ? '' : 's'} working`]
    if (busy) parts.push(`${busy} busy`)
    // Said separately because it does not recover: a restricted or invalid key is worth removing, not retrying.
    if (dead) parts.push(`${dead} refused outright (restricted or invalid)`)
    return parts.join(', ')
  }

  if (!apiKeys.length && !mistralKeys.length) {
    return { ok: false, message: 'No API key is built into this copy of Orbis.' }
  }

  const lines = [await check('Groq', PROVIDERS.groq.baseUrl, apiKeys), await check('Mistral', PROVIDERS.mistral.baseUrl, mistralKeys)].filter(
    (line): line is string => line !== null
  )
  if (!mistralKeys.length) {
    lines.push('No Mistral key, so Orbis cannot look at an image: nothing on Groq can see.')
  }
  const ok = lines.some((line) => /[1-9]\d* of \d+ keys? working/.test(line))
  return { ok, message: lines.join(String.fromCharCode(10)) }
}
