import { checkAudio, describeError, isBusy, nextState, pickFormat } from '../../src/shared/voiceInput.ts'
import type { VoiceErrorCode, VoiceState, VoiceTarget } from '../../src/shared/voiceInput.ts'
import { toPulsarWav } from '../../src/renderer/src/lib/audioToWav.ts'

/**
 * Speaking to a built-in Orbis page, through the microphone Orbis already has.
 *
 * This is not a second voice system, and the distinction matters enough to be precise about. Orbis's voice input is
 * one thing in three parts: a state machine and the rules about what may be recorded (src/shared/voiceInput.ts), a
 * converter that turns whatever the microphone produced into what Pulsar wants (audioToWav.ts), and a helper channel
 * that runs the model on this machine (`voice:transcribe`). All three are used here exactly as the Orbis window uses
 * them. What this file adds is the only part that genuinely differs: a `chrome://` page cannot reach Electron's
 * renderer service, so it opens the microphone itself and asks the same helper the same question.
 *
 * Two rules it keeps, both of which are about not surprising anybody:
 *
 *   **The words go where the microphone was opened, and nowhere else.** A session names its target when it starts and
 *   carries it to the end, so a transcript begun at the address bar cannot arrive in a chat.
 *
 *   **The microphone is released the moment recording stops** -- success, cancellation or failure alike. A recording
 *   light that stays on after somebody thought they had finished is the worst thing a feature like this can do.
 *
 * Nothing is invented. There is no partial text, no guessed transcript, and a failure is reported as a failure with
 * the reason the pipeline actually gave.
 */

export interface VoiceUpdate {
  state: VoiceState
  target: VoiceTarget
  /** Only ever set by the real pipeline. */
  text?: string
  error?: { code: VoiceErrorCode; message: string }
  /** How long the microphone has been open, for showing a timer. */
  ms?: number
}

export interface VoiceSessionHandle {
  /** Starts recording. Stops any session already running, because two recordings of one person is never the intent. */
  start(): Promise<void>
  /** Stops and transcribes. The words arrive through `onUpdate`. */
  stop(): Promise<void>
  /** Stops and throws the recording away. Nothing is transcribed and no input is touched. */
  cancel(): void
  state(): VoiceState
  /** Whether this page can record at all, so a control is never offered where it cannot work. */
  available(): boolean
}

export interface VoiceSessionOptions {
  target: VoiceTarget
  /** The helper channel, as the page already talks to it. */
  call(channel: string, args?: unknown[]): Promise<unknown>
  onUpdate(update: VoiceUpdate): void
  /** Longest recording, so a forgotten microphone does not run forever. */
  maxMs?: number
}

const DEFAULT_MAX_MS = 60_000

/** Bytes to base64 without blowing the stack on a long recording. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function createVoiceSession(options: VoiceSessionOptions): VoiceSessionHandle {
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS
  let state: VoiceState = 'idle'
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: Blob[] = []
  let startedAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let ticker: ReturnType<typeof setInterval> | null = null

  const move = (event: Parameters<typeof nextState>[1], extra: Partial<VoiceUpdate> = {}): void => {
    state = nextState(state, event)
    options.onUpdate({ state, target: options.target, ...extra })
  }
  const isBusyNow = (): boolean => isBusy(state)

  const fail = (code: VoiceErrorCode, message?: string): void => {
    release()
    state = nextState(state, { type: 'failed', code })
    options.onUpdate({ state, target: options.target, error: { code, message: message ?? describeError(code) } })
  }

  /**
   * Lets the microphone go.
   *
   * Every track is stopped explicitly rather than trusting the recorder's own teardown: the browser's recording
   * indicator follows the tracks, and a person watching that light is entitled to believe it.
   */
  function release(): void {
    if (timer) clearTimeout(timer)
    if (ticker) clearInterval(ticker)
    timer = null
    ticker = null
    try {
      recorder?.stream?.getTracks().forEach((t) => t.stop())
      stream?.getTracks().forEach((t) => t.stop())
    } catch {
      /* already gone */
    }
    recorder = null
    stream = null
  }

  return {
    state: () => state,
    available: () => Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder === 'function',

    async start() {
      if (isBusyNow()) this.cancel()
      chunks = []
      const format = pickFormat((type) => MediaRecorder.isTypeSupported(type))
      if (!format) return fail('recording-error', 'This page cannot record audio in a format Orbis can transcribe.')

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (error) {
        // The two that mean different things to a person: refused, and not there at all.
        const name = (error as { name?: string })?.name ?? ''
        return fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'permission-denied' : 'no-microphone')
      }

      try {
        recorder = new MediaRecorder(stream, { mimeType: format })
      } catch {
        return fail('recording-error', 'The microphone could not be started.')
      }
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data?.size) chunks.push(e.data)
      })
      // The state machine walks the real stages, so a person is told "asking", "starting" and "listening" as they
      // really happen rather than jumping straight to listening before the microphone is open.
      move({ type: 'start' })
      move({ type: 'permitted' })
      recorder.start()
      startedAt = Date.now()
      move({ type: 'capturing' }, { ms: 0 })
      // A timer for the display, and a hard stop so a forgotten microphone cannot run all day.
      ticker = setInterval(() => options.onUpdate({ state, target: options.target, ms: Date.now() - startedAt }), 250)
      timer = setTimeout(() => void this.stop(), maxMs)
    },

    async stop() {
      if (state !== 'listening' || !recorder) return
      const done = new Promise<void>((resolve) => recorder!.addEventListener('stop', () => resolve(), { once: true }))
      try {
        recorder.stop()
        await done
      } catch {
        return fail('recording-error')
      }
      release()
      move({ type: 'stop' })

      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' })
      chunks = []
      if (!blob.size) return fail('no-speech', 'Nothing was recorded.')

      let wav: Uint8Array
      try {
        wav = await toPulsarWav(blob)
      } catch {
        return fail('bad-audio')
      }
      // The same size rule the helper enforces, checked here too so a long recording fails before it is sent.
      const problem = checkAudio(wav.length)
      if (problem) return fail(problem)

      try {
        const result = (await options.call('voice:transcribe', [toBase64(wav), {}])) as
          | { ok: true; text: string }
          | { ok: false; code: VoiceErrorCode; message: string }
        if (!result || result.ok !== true) {
          return fail(result?.code ?? 'runtime-error', result?.message)
        }
        const text = String(result.text ?? '').trim()
        // An empty transcript is not a success with nothing in it; it is Pulsar hearing no speech, and it says so.
        if (!text) return fail('no-speech')
        state = nextState(state, { type: 'transcribed' })
        options.onUpdate({ state, target: options.target, text })
      } catch (error) {
        fail('runtime-error', (error as { message?: string })?.message)
      }
    },

    cancel() {
      const wasRunning = isBusyNow()
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* stopping a recorder that has already stopped is not a problem */
      }
      release()
      chunks = []
      if (wasRunning) void options.call('voice:cancel', []).catch(() => undefined)
      state = nextState(state, { type: 'reset' })
      // No text, no error: a cancellation is neither, and nothing downstream should treat it as either.
      options.onUpdate({ state, target: options.target })
    }
  }
}
