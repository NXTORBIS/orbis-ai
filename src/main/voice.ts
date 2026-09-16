import { classifyStatus, DEFAULT_MODEL, fileNameFor, isTransient, tidyTranscript } from '../shared/voiceInput.ts'
import type { VoiceErrorCode, VoiceModel } from '../shared/voiceInput'

/**
 * Turning speech into text.
 *
 * One place, for every microphone in Orbis. The audio recorded in the window is sent to Groq's Whisper service and the
 * words come back; nothing here guesses, pads or invents a transcript, and a failure is reported as what it was rather
 * than as an empty result.
 *
 * Neither the audio nor the words are written down or logged. They pass through and are gone.
 */

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'
/** Transient failures are worth one more go; beyond that something is actually wrong. */
const ATTEMPTS = 3
const BACKOFF_MS = [700, 2_200]

/** A failure with a reason the window can act on, rather than a string it has to guess at. */
export class VoiceError extends Error {
  readonly code: VoiceErrorCode
  /** How long the service asked us to wait, when it said. */
  readonly retryAfterMs?: number

  constructor(code: VoiceErrorCode, message?: string, retryAfterMs?: number) {
    super(message ?? code)
    this.name = 'VoiceError'
    this.code = code
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}

export interface TranscribeOptions {
  audio: Buffer
  mimeType: string
  model?: VoiceModel
  /** ISO-639-1, or nothing to let Whisper work it out — which is what handles Tamil, Hindi and the rest. */
  language?: string | null
  fetchFn: FetchFn
  apiKeys: string[]
  timeoutMs?: number
  signal?: AbortSignal
  /** Overridable so the backoff does not make tests slow. */
  wait?: (ms: number) => Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** How long the service asked us to wait, if it said so in a way we understand. */
function retryAfter(res: Response): number | undefined {
  const header = res.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1000))
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.min(30_000, Math.max(0, at - Date.now())) : undefined
}

/**
 * The words in a recording.
 *
 * Keys are tried in turn only for the failures another key could fix — one that is rejected or rate limited. A request
 * the service refused on its merits is not retried against every key in turn, which would only be refused every time.
 */
export async function transcribeAudio(options: TranscribeOptions): Promise<string> {
  const { audio, mimeType, fetchFn, apiKeys } = options
  if (!apiKeys.length) throw new VoiceError('auth-failed', 'No Groq API key is set.')
  if (!audio.length) throw new VoiceError('no-speech')

  const model = options.model ?? DEFAULT_MODEL
  const timeoutMs = options.timeoutMs ?? 60_000
  const wait = options.wait ?? sleep

  let lastError: VoiceError = new VoiceError('api-error')
  let keyIndex = 0

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (options.signal?.aborted) throw new VoiceError('cancelled')
    const key = apiKeys[keyIndex % apiKeys.length]

    // Rebuilt per attempt: a body is read once, so a retry needs its own.
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), fileNameFor(mimeType))
    form.append('model', model)
    form.append('response_format', 'json')
    if (options.language) form.append('language', options.language)

    const timeout = AbortSignal.timeout(timeoutMs)
    let res: Response
    try {
      res = await fetchFn(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      })
    } catch (err) {
      if (options.signal?.aborted) throw new VoiceError('cancelled')
      lastError = new VoiceError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network-error')
      if (attempt < ATTEMPTS - 1) await wait(BACKOFF_MS[attempt] ?? 2_200)
      continue
    }

    if (res.ok) {
      let text: string
      try {
        text = tidyTranscript(((await res.json()) as { text?: unknown }).text)
      } catch {
        throw new VoiceError('api-error', 'The transcription service sent something unreadable.')
      }
      // A recording with nothing in it is not an error worth retrying; it is silence, and is said as such.
      if (!text) throw new VoiceError('no-speech')
      return text
    }

    const code = classifyStatus(res.status)
    // The body can carry the service's own explanation, but never the audio or the words, so it is safe to keep.
    const detail = await res.text().catch(() => '')
    lastError = new VoiceError(code, detail.slice(0, 300) || `${res.status}`, retryAfter(res))

    // Another key may be allowed where this one was not.
    if ((code === 'auth-failed' || code === 'rate-limited') && apiKeys.length > 1 && keyIndex < apiKeys.length - 1) {
      keyIndex += 1
      continue
    }
    if (!isTransient(code) || attempt === ATTEMPTS - 1) throw lastError
    await wait(lastError.retryAfterMs ?? BACKOFF_MS[attempt] ?? 2_200)
  }

  throw lastError
}
