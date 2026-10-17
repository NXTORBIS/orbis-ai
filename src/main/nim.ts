import type { ChatMessage, ModelInfo, ReasoningEffort, StreamEvent } from '../shared/types'
import { CHAT_MODELS, modelInfo, modelLabel, providerOf } from '../shared/models.ts'
import { PROVIDERS } from '../shared/providers.ts'
import { AUTO_MODEL, REFUSAL_MAX_CHARS, couldBeRefusal, isFlatRefusal } from '../shared/modelRoute.ts'
import { chooseContext, contextFrom } from '../shared/attachmentIndex.ts'
import { SseParser, ThinkTagSplitter } from './sse.ts'

// Overridable for local testing or another OpenAI-compatible endpoint.
export const GROQ_BASE_URL = process.env.ORBIS_GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

export interface ChatOptions {
  /** Keys from the user's own GroqCloud account, tried in order when Groq rejects one. */
  apiKeys: string[]
  /**
   * Keys for Mistral, used when the chosen model is one of theirs.
   *
   * Its own list, because a Groq key sent to Mistral is not a slow key or a busy key -- it is an authentication
   * failure. Mixed into one rotation it would look like the service being unreliable, and that is exactly how this
   * went wrong: the address was routed by provider and the key was not, so every vision request carried a Groq key
   * to Mistral, was refused, and came back as an empty answer. The Orb then said "nothing came back from looking at
   * the page", which was true and told nobody why.
   */
  mistralKeys?: string[]
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

/**
 * Models with a far larger window, tried when a message is too long for the one chosen, and when the chosen
 * service has no keys left. Largest first.
 */
const OVERFLOW_MODELS = ['ministral-14b-2512', 'ministral-8b-2512', 'codestral-2508']

/** Whether this request is more than the chosen model takes in one go, by the same measure used to trim history. */
function exceedsInput(model: string, opts: ChatOptions): boolean {
  const info = modelInfo(model)
  if (info.inputTokenLimit === undefined) return false
  const sent = opts.systemPrompt.length + opts.messages.slice(-15).reduce((n, m) => n + messageSize(m), 0)
  return sent > inputCharBudget(info)
}

export async function streamChat(opts: ChatOptions): Promise<void> {
  const second = opts.mistralKeys ?? []
  const ownKeys = providerOf(opts.model) === 'mistral' ? second.length : opts.apiKeys.length
  if (ownKeys === 0 && second.length === 0) {
    return opts.emit({ type: 'error', message: 'This copy of Orbis has no AI service key. Add one to .env.local and rebuild.' })
  }
  // Auto is never a model the service knows; it is resolved before this point, and is never a fallback.
  // The ordinary fallbacks are the other models of the chosen service; the larger-memory ones come from `roomy`.
  const same = opts.autoFallback
    ? CHAT_MODELS.filter((m) => m.id !== opts.model && m.id !== AUTO_MODEL && providerOf(m.id) === providerOf(opts.model)).map((m) => m.id)
    : []
  // Larger-memory models, for a long message (first) and for when every key of the chosen service is spent (last).
  const roomy = second.length > 0 ? OVERFLOW_MODELS.filter((id) => id !== opts.model) : []
  const long = providerOf(opts.model) !== 'mistral' && roomy.length > 0 && exceedsInput(opts.model, opts)
  // The other service's ordinary models come last, so a chosen larger-memory model can still fall back to the others.
  const other = opts.autoFallback
    ? CHAT_MODELS.filter((m) => m.id !== AUTO_MODEL && providerOf(m.id) !== providerOf(opts.model)).map((m) => m.id)
    : []
  const order = long ? [...roomy, opts.model, ...same, ...other] : [opts.model, ...same, ...roomy, ...other]
  const chain: Attempt[] = [...new Set(order)].map((model) => ({ model, variant: 'normal' }))
  if (long) opts.emit({ type: 'status', message: 'That is a long message, so a model with more memory is answering.' })

  let lastError: unknown = new Error('All keys exhausted')
  let lastModel = opts.model
  /** Services whose every key has been refused or has run out: nothing else of theirs is worth trying. */
  const spent = new Set<string>()
  /** What a model said when it declined, kept in case nothing in the chain ends up answering. */
  let refusal: RefusedError | null = null
  /*
   * How a dead end is reported.
   *
   * If a model declined, that is the honest thing to lead with: a later service failing for its own reason -- a
   * key it has not got, say -- is about a model nobody chose, while the refusal is about what was asked. It is
   * said as what happened rather than left to read as Orbis apologising.
   */
  const fail = (err: unknown, which: string): void => opts.emit({
    type: 'error',
    message: refusal
      ? `No model would answer that. The last one asked said: ${refusal.said}`
      : describeError(err, which)
  })
  let busy = 0

  for (let i = 0; i < chain.length; i++) {
    const { model, variant } = chain[i]
    if (spent.has(providerOf(model)) && i < chain.length - 1) continue
    try {
      await streamWithKeys(model, opts, variant)
      return
    } catch (err) {
      if (opts.signal.aborted) return opts.emit({ type: 'aborted' })
      lastError = err
      lastModel = model
      /*
       * A model that would not answer at all.
       *
       * This is a successful request -- the model simply declined -- so it used to sail straight through to the
       * screen. Asked for a reference on the rules of chess, one model replied only "I'm sorry, but I can't
       * provide that" while two others wrote thousands of words on the same request, so a flat refusal is the
       * model failing, not the request being refusable. Nothing was shown, so another model can answer instead,
       * and the refusal is only shown if every one of them declines.
       */
      if (err instanceof RefusedError) {
        refusal = err
        const next = chain.slice(i + 1).find((a) => !spent.has(providerOf(a.model)))
        if (!next) return fail(err, model)
        opts.emit({ type: 'status', message: `${modelLabel(model)} would not answer that. Asking ${modelLabel(next.model)}...` })
        continue
      }
      const refusedKey = err instanceof HttpError && (err.status === 401 || err.reason === 'key')
      if (!(err instanceof HttpError) || !(FALLBACK_STATUSES.has(err.status) || refusedKey)) {
        return fail(err, model)
      }
      // Keys this service refused, or that it keeps answering "busy" to, are not worth asking again for other models.
      if (refusedKey) spent.add(providerOf(model))
      else if (err.status === 429 && ++busy >= 2) spent.add(providerOf(model))
      if (refusedKey && !chain.slice(i + 1).some((a) => !spent.has(providerOf(a.model)))) {
        return fail(err, model)
      }
      const next = chain.slice(i + 1).find((a) => !spent.has(providerOf(a.model)))
      if (next) {
        const reason =
          err.status === 429 ? 'is busy' : err.status === 413 ? "can't take a message this long" : 'is unavailable right now'
        opts.emit({ type: 'status', message: `${modelLabel(model)} ${reason}. Switching to ${modelLabel(next.model)}…` })
      }
    }
  }
  // Nothing answered.
  return fail(lastError, lastModel)
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
  /** Everything this leg put on screen, so the next leg can be asked to carry on from it. */
  text: string
}

/**
 * Something that sits between the model and the screen and may hold text back for a moment.
 *
 * Two things need that. A reply that is nothing but a refusal must never be shown at all, and the second leg of a
 * long answer usually restates the sentence it is carrying on from, which has to be dropped before anybody sees
 * it twice. Both have to decide on text they have not finished receiving, so both hold the opening back.
 */
interface Gate {
  /** Returns what may be shown now; '' means it is still being held. */
  push(content: string): string
  /** The stream ended: returns whatever is still held, or throws if the whole reply was a refusal. */
  finish(finished: boolean): string
}

/** How much of a later leg is held back while looking for what it repeated. */
const OVERLAP_WINDOW = 600
/** The shortest repeat worth believing. Below this, matching text is coincidence and dropping it eats real words. */
const OVERLAP_FLOOR = 12

/**
 * Joins a later leg onto the answer so far, dropping whatever it restated.
 *
 * Models restate the last sentence however plainly they are asked not to, so the repeat is found rather than
 * trusted not to happen: the longest end of what is written that is also the start of what arrived. Only the end
 * is searched, so a sentence repeated early in a long answer cannot make the whole middle disappear.
 */
export function joinLegs(sofar: string, next: string): string {
  if (!next) return sofar
  if (!sofar) return next
  const window = sofar.slice(-OVERLAP_WINDOW)
  let drop = 0
  for (let len = Math.min(window.length, next.length); len >= OVERLAP_FLOOR; len--) {
    if (window.endsWith(next.slice(0, len))) { drop = len; break }
  }
  const rest = next.slice(drop)
  if (!rest) return sofar
  // Two words must not run together at the join, and a word split across legs must not be broken in two.
  const wordish = /[A-Za-z0-9]/
  const gap = wordish.test(sofar[sofar.length - 1]) && wordish.test(rest[0]) ? ' ' : ''
  return sofar + gap + rest
}

/** Holds the start of a later leg back, drops what it repeated, then lets everything through. */
class CarryOnFilter implements Gate {
  private held = ''
  private open = false
  private readonly sofar: string
  constructor(sofar: string) { this.sofar = sofar }

  push(content: string): string {
    if (this.open) return content
    this.held += content
    return this.held.length >= OVERLAP_WINDOW ? this.release() : ''
  }

  finish(): string {
    return this.open ? '' : this.release()
  }

  private release(): string {
    this.open = true
    const held = this.held
    this.held = ''
    return joinLegs(this.sofar, held).slice(this.sofar.length)
  }
}

/** A reply that was nothing but a refusal, so another model can be asked instead. */
class RefusedError extends Error {
  // Written out rather than a parameter property: the tests run under strip-only TypeScript, which rejects those.
  readonly said: string
  constructor(said: string) {
    super('The model would not answer.')
    this.said = said
  }
}

/**
 * Holds a reply back only while it could still be a refusal.
 *
 * Ordinary replies must not be slowed down by this, and text can only be held before it is shown -- so the guard
 * watches the opening and lets go the instant the reply cannot be a refusal, which for almost every answer is its
 * first word. Only a reply that really does open "I'm sorry, but I can't..." waits, and then only until it either
 * finishes (a refusal) or grows past a few hundred characters (an answer that merely began that way).
 */
class RefusalGuard implements Gate {
  private held = ''
  private open = false

  push(content: string): string {
    if (this.open) return content
    this.held += content
    // Not a refusal, or too long to be only a refusal: let it through and stop watching.
    if (this.held.length > REFUSAL_MAX_CHARS || !couldBeRefusal(this.held)) return this.release()
    return ''
  }

  finish(finished: boolean): string {
    if (this.open) return ''
    if (isFlatRefusal(this.held, finished)) {
      const said = this.held.trim()
      this.held = ''
      this.open = true
      throw new RefusedError(said)
    }
    return this.release()
  }

  private release(): string {
    this.open = true
    const held = this.held
    this.held = ''
    return held
  }
}

/** The most legs one answer may run to, so a model that never finishes cannot loop for ever. */
const MAX_LEGS = 12
/** How much of the answer so far the next leg is shown, so it knows where to carry on from. */
const TAIL_CHARS = 1400

/** What the next key is asked, so it carries straight on instead of starting again or apologising. */
function carryOnPrompt(tail: string): string {
  return [
    'Carry straight on from exactly where the text below stops, and finish the answer.',
    '',
    'Do not start again, do not summarise what is already written, do not repeat the last sentence, and do not',
    'mention being cut off or continued -- what you write is joined onto it and read as one answer. If it',
    'stops mid-sentence or mid-word, carry on mid-sentence.',
    '',
    '--- the answer so far ends here ---',
    tail
  ].join('\n')
}

/**
 * Streams a reply, and keeps asking until the answer is really finished.
 *
 * A model stops with `finish_reason: "length"` when it runs out of room, and Orbis used to stop with it, so a long
 * answer simply ended mid-sentence. Each further leg goes out on the next key and is asked to carry on from the
 * tail of what is written; what it restates anyway is dropped before anybody sees it, so the person reads one
 * unbroken answer rather than several.
 */
async function streamWithKeys(model: string, opts: ChatOptions, variant: Variant = 'normal'): Promise<void> {
  const info = modelInfo(model)
  // The first leg is watched for a flat refusal, which must never reach the screen.
  let result = await withKeyRotation(model, opts, (key) => streamOnce(model, opts, key, variant, undefined, undefined, new RefusalGuard()))
  if (!result.hasContent && info.reasoningEffort && !opts.signal.aborted) {
    console.warn(`[chat] ${model} finished with no answer (finish_reason=${result.finishReason}); retrying at low reasoning effort`)
    try {
      result = await withKeyRotation(model, opts, (key) => streamOnce(model, opts, key, 'rescue'))
    } catch (err) {
      // Nothing new was shown, so keep the reply as it is rather than switching models.
      if (!(err instanceof HttpError) || opts.signal.aborted) throw err
    }
  }

  let whole = result.text
  for (let leg = 1; result.finishReason === 'length' && leg <= MAX_LEGS && !opts.signal.aborted; leg++) {
    const carryOn: ChatOptions = {
      ...opts,
      messages: [
        ...opts.messages,
        { id: `carry-${leg}-so-far`, role: 'assistant', content: whole, createdAt: 0 },
        { id: `carry-${leg}-ask`, role: 'user', content: carryOnPrompt(whole.slice(-TAIL_CHARS)), createdAt: 0 }
      ]
    }
    const filter = new CarryOnFilter(whole)
    try {
      // `skipPreferred` starts on the next key: the one that just ran out of room is the one with least left.
      result = await withKeyRotation(model, carryOn, (key) => streamOnce(model, carryOn, key, 'carry-on', undefined, undefined, filter), true)
    } catch (err) {
      // What is already written stands. Ending it here is better than losing it.
      if (opts.signal.aborted) throw err
      console.warn(`[chat] ${model} could not carry on after leg ${leg}: ${err instanceof Error ? err.message : String(err)}`)
      break
    }
    if (!result.text) break
    whole = joinLegs(whole, result.text)
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
  model: string,
  opts: ChatOptions,
  attempt: (apiKey: string) => Promise<StreamResult>,
  skipPreferred = false
): Promise<StreamResult> {
  // The keys of whichever service serves THIS model (the one being tried, which a fallback may have changed). A key
  // is not a credential for "the API"; it is for one service.
  const forThisModel = providerOf(model) === 'mistral' ? (opts.mistralKeys ?? []) : opts.apiKeys
  if (forThisModel.length === 0) throw new HttpError(401, 'No key for this service.')
  const usable = forThisModel.filter((key) => !unusableKeys.has(key))
  // If every key has been refused before, ask again rather than giving up without trying.
  const keys = usable.length > 0 ? usable : forThisModel
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
type Variant = 'normal' | 'lean' | 'rescue' | 'carry-on'

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
  charBudget?: number,
  gate?: Gate
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
      if (limits && limits.requested > limits.limit) return streamOnce(model, opts, apiKey, variant, limits.limit, charBudget, gate)
    }

    // Some answers say only "reduce the length of the messages or completion": a size error with no unit in it.
    // The history is already trimmed to what the model takes, so what is left is a message that will not fit here;
    // a model with more room can take it.
    if (res.status === 400 && /reduce the length|too long|context length|maximum context|exceeds? the (?:model|context)/i.test(errorMsg)) {
      throw new HttpError(413, errorMsg, retryAfterMs)
    }

    if ((res.status === 413 || res.status === 400) && errorMsg.toLowerCase().includes('token')) {
      // Groq counts the output budget against the per-minute token limit; shrink it to fit.
      const inputOnly = /\bITPM\b|input tokens/i.test(errorMsg)
      if (!inputOnly && typeof body.max_completion_tokens === 'number') {
        return streamOnce(model, opts, apiKey, variant, fitBudget(errorMsg, body.max_completion_tokens), charBudget, gate)
      }
      // More history than this model's per-minute limit allows: send proportionally less and try again.
      const limits = parseLimits(errorMsg)
      if (limits && limits.requested > limits.limit) {
        const sent = opts.systemPrompt.length + recentMessages.reduce((n, m) => n + messageSize(m), 0)
        const smaller = sent * (limits.limit / limits.requested) * 0.85
        if (fitToContext(opts.messages.slice(-15), opts.systemPrompt, smaller).length < recentMessages.length) {
          return streamOnce(model, opts, apiKey, variant, maxTokens, smaller, gate)
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
    if (res.status === 400 && variant === 'normal') return streamOnce(model, opts, apiKey, 'lean', undefined, charBudget, gate)
    throw new HttpError(res.status, errorMsg, retryAfterMs)
  }
  if (!res.body) throw new HttpError(502, 'The AI service sent an empty response.')

  // The rescue and the later legs continue the reply that already started, so they must not start a new one.
  if (variant !== 'rescue' && variant !== 'carry-on') opts.emit({ type: 'start', model })
  return readStream(res.body, opts, gate)
}

/** Relays an OpenAI-style SSE body as delta events. `holdReasoning` keeps reasoning back until the answer starts. */
async function readStream(stream: ReadableStream<Uint8Array>, opts: ChatOptions, gate?: Gate): Promise<StreamResult> {
  const parser = new SseParser()
  const splitter = new ThinkTagSplitter()
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let finishReason: string | null = null
  let hasContent = false
  let text = ''

  const relay = (content: string, reasoning: string): void => {
    if (content.trim()) hasContent = true
    const shown = gate && content ? gate.push(content) : content
    text += shown
    if (shown || reasoning) opts.emit({ type: 'delta', content: shown || undefined, reasoning: reasoning || undefined })
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
  relay(tail.content, tail.reasoning)
  if (gate) {
    // Anything still held goes out now -- unless the whole reply was a refusal, in which case this throws.
    const last = gate.finish(finishReason !== 'length')
    if (last) {
      text += last
      opts.emit({ type: 'delta', content: last })
    }
  }
  return { hasContent, finishReason, text }
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

/** A single file up to this size is sent whole: searching it could only lose something. */
const ATTACHMENT_WHOLE_FILE = 24_000
/** How much of several files' text may travel with one message. Past this, the relevant parts are chosen. */
const ATTACHMENT_BUDGET = 40_000

/**
 * The attached files, as the model should be shown them.
 *
 * One short file is sent whole, because searching it could only lose something and sending it costs nothing. Several
 * files, or a long one, are searched instead: flattening them meant the later files were cut to nothing once the
 * budget ran out, and the model had to find the relevant paragraph itself inside everything else, which is the thing
 * it is worst at. See src/shared/attachmentIndex.ts for how the passages are chosen, why each carries the name of the
 * file it came from, and why a file with nothing matching is named rather than silently left out.
 */
function attachedText(message: ChatMessage): string {
  const files = (message.attachments ?? []).filter((a) => a.type !== 'image').map((a) => ({ name: a.name, text: a.content }))
  if (!files.length) return ''
  const total = files.reduce((n, one) => n + one.text.length, 0)
  if (files.length === 1 && total <= ATTACHMENT_WHOLE_FILE) return `<file name="${files[0].name}">\n${files[0].text}\n</file>`
  // The question is the message itself: what the person actually asked is what the passages are chosen against.
  return contextFrom(chooseContext(message.content ?? '', files, ATTACHMENT_BUDGET))
}

export function toMessageContent(message: ChatMessage, model: ReturnType<typeof modelInfo>): string | Record<string, unknown>[] {
  if (!message.attachments?.length) return message.content

  const hasImages = message.attachments.some(a => a.type === 'image')
  const supportsVision = model.vision

  // Without images (or vision), send plain text so text-only models accept it
  if (!hasImages || !supportsVision) {
    const textContent = attachedText(message)
    if (message.content) {
      return textContent ? `${textContent}\n\n${message.content}` : message.content
    }
    return textContent || message.content
  }

  const parts: Record<string, unknown>[] = []

  for (const a of message.attachments) {
    if (a.type === 'image') {
      /*
       * The content may already be a complete data url, and prefixing it again produces nonsense.
       *
       * Both of Orbis's own vision paths hand over what `page.screenshot` returned, which is
       * `data:image/png;base64,...` in full. Prefixed a second time it became
       * `data:image/png;base64,data:image/png;base64,...` -- a url no service can decode. Mistral answered 200 with
       * no content at all, so the Orb reported "nothing came back from looking at the page": a true sentence about a
       * malformed request, and the reason its eyes appeared not to work.
       *
       * Fixed here rather than at each call site, because a screenshot arriving as a data url is the normal case and
       * every future caller would have had to remember to undress it first.
       */
      parts.push({
        type: 'image_url',
        image_url: {
          url: a.content.startsWith('data:') ? a.content : `data:${a.mimeType || 'image/jpeg'};base64,${a.content}`
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
        return 'The AI service rejected this copy of Orbis\u2019s key. Put a valid key in .env.local and rebuild.'
      case 403:
        return `This key doesn't have access to ${modelLabel(model)}.`
      case 404:
        return `${modelLabel(model)} isn't available right now.`
      case 413:
        return `This message is too long for ${modelLabel(model)}. Try a shorter message, or start a new chat.`
      case 429:
        return 'Every model is busy at the moment. Wait a minute and try again.'
      default:
        return `The AI service answered with an error (${err.status}). ${err.message}`
    }
  }
  if (err instanceof StreamError) return err.message
  if (err instanceof Error) return `Couldn't reach the AI service: ${err.message}`
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
    // Eight at a time: a copy with hundreds of keys took minutes one by one, and the answer is the same either way.
    for (let i = 0; i < keys.length; i += 8) {
      try {
        const results = await Promise.all(keys.slice(i, i + 8).map((key) => fetchFn(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } })))
        for (const res of results) {
          if (res.ok) working++
          else if (res.status === 429) busy++
          else dead++
        }
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

  const lines = [await check('Orion', PROVIDERS.groq.baseUrl, apiKeys), await check('Sight', PROVIDERS.mistral.baseUrl, mistralKeys)].filter(
    (line): line is string => line !== null
  )
  if (!mistralKeys.length) {
    lines.push('No Sight key, so Orbis cannot look at an image: none of the Orion models can see.')
  }
  const ok = lines.some((line) => /[1-9]\d* of \d+ keys? working/.test(line))
  return { ok, message: lines.join(String.fromCharCode(10)) }
}
