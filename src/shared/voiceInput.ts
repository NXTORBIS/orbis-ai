/**
 * Orbis voice input: what a voice session is, and what may happen to it.
 *
 * Every microphone in Orbis — the chat composer, the browser's assistant, the address bar, the search box — is the
 * same thing: hold down, speak, get the words. There is one service behind all of them and one place speech is turned
 * into text, so a fix to any of it is a fix to all of it.
 *
 * This file is the part with no microphone and no network in it: the states a session moves through, what counts as
 * usable audio, what a failure means in words a person can act on, and the rule that a transcript can only ever reach
 * the input that asked for it.
 *
 * Nothing here transcribes anything. Nothing here invents a transcript.
 */

// ---------------------------------------------------------------- the model

/** Groq's Whisper models. The turbo one is the default because it is fast enough to feel immediate. */
export const DEFAULT_MODEL = 'whisper-large-v3-turbo'
/** Slower, and better with accents, quiet speech and unusual words. */
export const ACCURATE_MODEL = 'whisper-large-v3'
export const MODELS = [DEFAULT_MODEL, ACCURATE_MODEL] as const
export type VoiceModel = (typeof MODELS)[number]

export const isVoiceModel = (value: unknown): value is VoiceModel => MODELS.includes(value as VoiceModel)

// ---------------------------------------------------------------- where a transcript is allowed to go

/**
 * Which input started a session.
 *
 * Fixed when the session begins and never reconsidered: the words somebody speaks into the browser's assistant belong
 * to the browser's assistant, and must not turn up in the chat box.
 */
export type VoiceTarget = 'chat' | 'browser-orion' | 'search' | 'url-bar'

export const VOICE_TARGETS: VoiceTarget[] = ['chat', 'browser-orion', 'search', 'url-bar']

export interface VoiceSession {
  sessionId: string
  target: VoiceTarget
  /** Which particular box, when a target has more than one (a tab's address bar, say). */
  inputId?: string
  profileId?: string
  startedAt: number
}

// ---------------------------------------------------------------- the states a session moves through

export type VoiceState =
  | 'idle'
  | 'requesting-permission'
  | 'initializing'
  | 'listening'
  | 'processing'
  | 'completed'
  | 'error'

export type VoiceErrorCode =
  | 'permission-denied'
  | 'no-microphone'
  | 'microphone-lost'
  | 'recording-error'
  | 'no-speech'
  | 'too-long'
  | 'bad-audio'
  | 'auth-failed'
  | 'rate-limited'
  | 'api-error'
  | 'network-error'
  | 'timeout'
  | 'cancelled'

/** What happens to a session. The UI shows the state; the state only ever changes through one of these. */
export type VoiceEvent =
  | { type: 'start' }
  | { type: 'permitted' }
  | { type: 'capturing' }
  | { type: 'stop' }
  | { type: 'transcribed' }
  | { type: 'failed'; code: VoiceErrorCode }
  | { type: 'reset' }

/**
 * Where a session goes next.
 *
 * An event that makes no sense where the session is leaves it exactly where it was, so a stray callback after a
 * cancel — which is the usual way these things go wrong — cannot put "listening" back on screen.
 */
export function nextState(state: VoiceState, event: VoiceEvent): VoiceState {
  if (event.type === 'failed') return state === 'idle' ? 'idle' : 'error'
  if (event.type === 'reset') return 'idle'

  switch (state) {
    case 'idle':
      return event.type === 'start' ? 'requesting-permission' : state
    case 'requesting-permission':
      return event.type === 'permitted' ? 'initializing' : state
    case 'initializing':
      return event.type === 'capturing' ? 'listening' : state
    case 'listening':
      return event.type === 'stop' ? 'processing' : state
    case 'processing':
      return event.type === 'transcribed' ? 'completed' : state
    case 'completed':
    case 'error':
      return event.type === 'start' ? 'requesting-permission' : state
  }
}

/** Whether the microphone is open. "Listening" is never shown unless this is true. */
export const isCapturing = (state: VoiceState): boolean => state === 'listening'

/** Whether a session is doing something, so a second one is not started on top of it. */
export const isBusy = (state: VoiceState): boolean => state !== 'idle' && state !== 'completed' && state !== 'error'

/**
 * What went wrong, said to the person who has to do something about it.
 *
 * Every one of these is a real thing that happens. None of them says "try again" without saying what to try.
 */
export function describeError(code: VoiceErrorCode): string {
  switch (code) {
    case 'permission-denied':
      return 'Orbis is not allowed to use your microphone. Allow it in Windows privacy settings, then try again.'
    case 'no-microphone':
      return 'No microphone was found. Plug one in, or pick one in Windows sound settings.'
    case 'microphone-lost':
      return 'The microphone stopped part way through. Check it is still connected.'
    case 'recording-error':
      return "Your microphone couldn't be recorded from. Check that nothing else has taken it."
    case 'no-speech':
      return 'Nothing was recorded. Check your microphone is not muted, and speak a little longer.'
    case 'too-long':
      return 'That recording is too long to transcribe. Try it in shorter pieces.'
    case 'bad-audio':
      return "The recording couldn't be read. Try again."
    case 'auth-failed':
      return 'Orbis could not sign in to the transcription service. Check your API key in settings.'
    case 'rate-limited':
      return 'Too many transcriptions at once. Wait a moment and try again.'
    case 'api-error':
      return 'The transcription service could not answer just now.'
    case 'network-error':
      return 'Orbis could not reach the transcription service. Check your connection.'
    case 'timeout':
      return 'Transcribing took too long and was stopped.'
    case 'cancelled':
      return 'Voice input was cancelled.'
  }
}

/** Which failures are worth trying again on their own, and which are somebody's to fix. */
export const isTransient = (code: VoiceErrorCode): boolean => code === 'rate-limited' || code === 'api-error' || code === 'network-error' || code === 'timeout'

/** What an HTTP answer from the transcription service means. */
export function classifyStatus(status: number): VoiceErrorCode {
  if (status === 401 || status === 403) return 'auth-failed'
  if (status === 429) return 'rate-limited'
  if (status === 413) return 'too-long'
  if (status === 400 || status === 415 || status === 422) return 'bad-audio'
  return 'api-error'
}

// ---------------------------------------------------------------- what may be sent

/**
 * The service takes 25 MB. Orbis stops well short of it: a recording that big is minutes of speech, and it is better
 * to say so before uploading than to have it refused afterwards.
 */
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024
/** Below this there is no speech in it — a click on the microphone and a click back. */
export const MIN_AUDIO_BYTES = 1200
/** A session stops itself here rather than recording for ever because somebody forgot it was on. */
export const MAX_DURATION_MS = 5 * 60_000
/** How long a transcription may take before it is given up on. */
export const TRANSCRIBE_TIMEOUT_MS = 60_000

/** Whether what was recorded is worth sending. Returns the reason when it is not. */
export function checkAudio(bytes: number): VoiceErrorCode | null {
  if (bytes < MIN_AUDIO_BYTES) return 'no-speech'
  if (bytes > MAX_AUDIO_BYTES) return 'too-long'
  return null
}

/**
 * The formats to record in, best first.
 *
 * Opus in WebM is what Chromium records natively and what the service reads happily. The rest are here because a
 * container that is not supported makes the recorder throw at the moment somebody presses the button, which is the
 * worst possible time to find out.
 */
export const AUDIO_FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'] as const

/** The first format this machine can actually record, or null when it can record none of them. */
export function pickFormat(supported: (type: string) => boolean): string | null {
  return AUDIO_FORMATS.find((type) => supported(type)) ?? null
}

/** The file name the service is given, which is how it is told what the audio is. */
export function fileNameFor(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  const extension = base === 'audio/ogg' ? 'ogg' : base === 'audio/mp4' ? 'm4a' : base === 'audio/mpeg' ? 'mp3' : 'webm'
  return `speech.${extension}`
}

// ---------------------------------------------------------------- the words that come back

/**
 * The transcript, tidied only as far as is honest.
 *
 * Whisper sometimes returns its own padding for silence, and leading and trailing space is never wanted. Beyond that
 * nothing is touched: the words somebody said are the words they said, and rewriting them would make voice input a
 * guess rather than a transcription.
 */
export function tidyTranscript(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const text = raw.replace(/\s+/g, ' ').trim()
  // What Whisper returns for a recording with nothing in it.
  if (/^(?:you|thank you|thanks for watching|\.|,|-)?$/i.test(text)) return ''
  return text
}

/**
 * Several pieces of one long recording, joined.
 *
 * Segments overlap slightly so a word is not lost on the boundary, which means the same words can appear at the end of
 * one piece and the start of the next. Where that happens the repeat is dropped, so nothing is said twice and nothing
 * earlier is silently thrown away.
 */
export function joinTranscripts(parts: string[]): string {
  const pieces = parts.map((p) => tidyTranscript(p)).filter(Boolean)
  if (!pieces.length) return ''

  let joined = pieces[0]
  for (const piece of pieces.slice(1)) {
    const overlap = longestOverlap(joined, piece)
    joined = overlap ? `${joined}${piece.slice(overlap.length)}` : `${joined} ${piece}`
  }
  return joined.replace(/\s+/g, ' ').trim()
}

/** The longest run of words that ends one piece and begins the next. */
function longestOverlap(before: string, after: string): string | null {
  const words = before.split(' ')
  for (let take = Math.min(12, words.length); take >= 2; take--) {
    const tail = words.slice(-take).join(' ')
    if (after.toLowerCase().startsWith(tail.toLowerCase())) return tail
  }
  return null
}

// ---------------------------------------------------------------- how voice input is set up

export interface VoiceInputConfig {
  model: VoiceModel
  /** An ISO-639-1 code, or null to let the model work it out — which is what handles Tamil, Hindi and the rest. */
  language: string | null
  /** A particular microphone, or null for whichever Windows is using. */
  deviceId: string | null
  maxDurationMs: number
  timeoutMs: number
}

export function defaultVoiceConfig(): VoiceInputConfig {
  return { model: DEFAULT_MODEL, language: null, deviceId: null, maxDurationMs: MAX_DURATION_MS, timeoutMs: TRANSCRIBE_TIMEOUT_MS }
}

/** A configuration read back from settings, made safe. Anything unrecognised falls back rather than breaking voice. */
export function normalizeVoiceConfig(raw: unknown): VoiceInputConfig {
  const base = defaultVoiceConfig()
  const input = (raw ?? {}) as Partial<VoiceInputConfig>
  if (!input || typeof input !== 'object') return base
  const clamp = (n: unknown, low: number, high: number, fallback: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(high, Math.max(low, Math.round(n))) : fallback
  return {
    model: isVoiceModel(input.model) ? input.model : base.model,
    // Two letters, the way the service expects them. Anything else means "work it out".
    language: typeof input.language === 'string' && /^[a-z]{2}$/i.test(input.language) ? input.language.toLowerCase() : null,
    deviceId: typeof input.deviceId === 'string' && input.deviceId ? input.deviceId.slice(0, 200) : null,
    maxDurationMs: clamp(input.maxDurationMs, 5_000, MAX_DURATION_MS, base.maxDurationMs),
    timeoutMs: clamp(input.timeoutMs, 5_000, 180_000, base.timeoutMs)
  }
}
