import {
  checkAudio,
  defaultVoiceConfig,
  describeError,
  isBusy,
  nextState,
  pickFormat
} from '../../../shared/voiceInput'
import type { VoiceErrorCode, VoiceInputConfig, VoiceSession, VoiceState, VoiceTarget } from '../../../shared/voiceInput'

/**
 * The Orbis voice input service.
 *
 * One microphone for the whole of Orbis. The chat composer, the browser's assistant, the address bar and the search
 * box all start a session here, and the words come back to whichever of them asked — never to any of the others.
 *
 * There is exactly one session at a time. Starting one while another is running stops the first, because two
 * recordings of the same person talking is never what anybody meant.
 *
 * The microphone is opened when recording starts and released the moment it stops, whether that was a success, a
 * cancellation or a failure. Nothing is kept: the audio goes to be transcribed and is dropped.
 */

export interface VoiceStatus {
  state: VoiceState
  session: VoiceSession | null
  /** Why it stopped, when it stopped badly. */
  error: { code: VoiceErrorCode; message: string } | null
  /** How long the current recording has been running, for showing the time. */
  recordingMs: number
}

type Listener = (status: VoiceStatus) => void

export interface StartOptions {
  target: VoiceTarget
  inputId?: string
  profileId?: string
  config?: Partial<VoiceInputConfig>
}

class VoiceInputService {
  private state: VoiceState = 'idle'
  private session: VoiceSession | null = null
  private error: VoiceStatus['error'] = null
  private readonly listeners = new Set<Listener>()

  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private mimeType = ''
  private startedAt = 0
  private tick: ReturnType<typeof setInterval> | null = null
  private limit: ReturnType<typeof setTimeout> | null = null
  private config: VoiceInputConfig = defaultVoiceConfig()
  /** Set when a session is abandoned, so anything still in flight for it is ignored rather than acted on. */
  private abandoned = new Set<string>()

  // ---------------------------------------------------------------- what anyone can ask

  getState(): VoiceState {
    return this.state
  }

  getStatus(): VoiceStatus {
    return { state: this.state, session: this.session, error: this.error, recordingMs: this.startedAt ? Date.now() - this.startedAt : 0 }
  }

  /** Whether this session belongs to the given input — the only way a transcript is allowed anywhere. */
  isFor(target: VoiceTarget, inputId?: string): boolean {
    if (!this.session || this.session.target !== target) return false
    return inputId === undefined || this.session.inputId === inputId
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Whether this machine can record at all. Checked before a microphone button is offered. */
  async isAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return false
    if (!pickFormat((type) => MediaRecorder.isTypeSupported(type))) return false
    try {
      // Before permission is given the list has entries with empty labels; that still tells us one exists.
      return (await navigator.mediaDevices.enumerateDevices()).some((device) => device.kind === 'audioinput')
    } catch {
      return false
    }
  }

  /** The microphones to choose between. Their names are only known once permission has been given once. */
  async getDevices(): Promise<{ deviceId: string; label: string }[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'audioinput')
        .map((device, i) => ({ deviceId: device.deviceId, label: device.label || `Microphone ${i + 1}` }))
    } catch {
      return []
    }
  }

  // ---------------------------------------------------------------- a session

  /**
   * Starts listening for one input.
   *
   * Nothing says "listening" until the microphone is actually open: permission is asked for first, the recorder is
   * built second, and only when it is running does the state say so.
   */
  async start(options: StartOptions): Promise<void> {
    // A session already running belongs to somebody; take it down cleanly before starting another.
    if (isBusy(this.state)) await this.cancel()

    this.config = { ...defaultVoiceConfig(), ...options.config }
    const session: VoiceSession = {
      sessionId: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      target: options.target,
      startedAt: Date.now(),
      ...(options.inputId ? { inputId: options.inputId } : {}),
      ...(options.profileId ? { profileId: options.profileId } : {})
    }
    this.session = session
    this.error = null
    this.move({ type: 'start' })

    const format = pickFormat((type) => MediaRecorder.isTypeSupported(type))
    if (!format) return this.fail('recording-error', session.sessionId)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: this.config.deviceId ? { deviceId: { exact: this.config.deviceId } } : true
      })
    } catch (err) {
      return this.fail(permissionProblem(err), session.sessionId)
    }
    // Cancelled while the permission prompt was up: let the microphone go again immediately.
    if (this.abandoned.has(session.sessionId)) {
      for (const track of stream.getTracks()) track.stop()
      return
    }

    this.stream = stream
    this.mimeType = format
    this.chunks = []
    this.move({ type: 'permitted' })

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType: format })
    } catch {
      return this.fail('recording-error', session.sessionId)
    }
    this.recorder = recorder

    recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data)
    }
    recorder.onerror = () => this.fail('recording-error', session.sessionId)
    // The microphone being unplugged mid-sentence is a real thing, and is said rather than left hanging.
    for (const track of stream.getTracks()) track.onended = () => this.fail('microphone-lost', session.sessionId)

    try {
      // A slice a second means a long recording is already in pieces, and a crash loses a second rather than all of it.
      recorder.start(1000)
    } catch {
      return this.fail('recording-error', session.sessionId)
    }

    this.startedAt = Date.now()
    this.move({ type: 'capturing' })
    this.tick = setInterval(() => this.announce(), 250)
    // A microphone somebody forgot about stops itself rather than recording all afternoon.
    this.limit = setTimeout(() => void this.stop(), this.config.maxDurationMs)
  }

  /**
   * Stops listening and returns the words.
   *
   * Returns null when there are none to return — cancelled, nothing said, or a failure, each of which has already been
   * reported through the state. The caller puts whatever comes back into its own input and nowhere else.
   */
  async stop(): Promise<string | null> {
    const session = this.session
    const recorder = this.recorder
    if (!session || !recorder || this.state !== 'listening') {
      if (this.state === 'listening') this.release()
      return null
    }

    this.clearTimers()
    this.move({ type: 'stop' })

    const audio = await new Promise<Blob | null>((resolve) => {
      const done = (): void => resolve(new Blob(this.chunks, { type: this.mimeType }))
      recorder.onstop = done
      try {
        recorder.stop()
      } catch {
        resolve(null)
      }
    })
    // The microphone goes the moment recording ends, not when the words come back.
    this.release()

    if (this.abandoned.has(session.sessionId)) return null
    if (!audio) return this.fail('recording-error', session.sessionId), null

    const bytes = audio.size
    const problem = checkAudio(bytes)
    if (problem) return this.fail(problem, session.sessionId), null

    try {
      const buffer = new Uint8Array(await audio.arrayBuffer())
      const answer = await window.api.transcribeAudio(buffer, { mimeType: this.mimeType, model: this.config.model, language: this.config.language })
      // Abandoned while the service was thinking: the words belong to nothing now.
      if (this.abandoned.has(session.sessionId)) return null
      if (!answer.ok) {
        this.fail(answer.code, session.sessionId, answer.message)
        return null
      }
      this.move({ type: 'transcribed' })
      this.finish()
      return answer.text
    } catch {
      // The channel itself failed, which is not something the service said.
      if (this.abandoned.has(session.sessionId)) return null
      this.fail('api-error', session.sessionId)
      return null
    }
  }

  /** Abandons the session: the microphone is released and anything still in flight for it is ignored. */
  async cancel(): Promise<void> {
    const session = this.session
    if (!session) return
    this.abandoned.add(session.sessionId)
    // Only the last few need remembering; older ones can never come back.
    if (this.abandoned.size > 8) this.abandoned = new Set([...this.abandoned].slice(-8))

    this.clearTimers()
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      // Already stopped; the release below is what matters.
    }
    this.release()
    this.session = null
    this.error = null
    this.state = 'idle'
    this.announce()
  }

  // ---------------------------------------------------------------- keeping the place tidy

  /** Everything to do with the microphone, let go of. Safe to call twice. */
  private release(): void {
    this.clearTimers()
    if (this.recorder) {
      this.recorder.ondataavailable = null
      this.recorder.onerror = null
      this.recorder.onstop = null
      this.recorder = null
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.onended = null
        track.stop()
      }
      this.stream = null
    }
    this.chunks = []
    this.startedAt = 0
  }

  private clearTimers(): void {
    if (this.tick) clearInterval(this.tick)
    if (this.limit) clearTimeout(this.limit)
    this.tick = null
    this.limit = null
  }

  private move(event: Parameters<typeof nextState>[1]): void {
    this.state = nextState(this.state, event)
    this.announce()
  }

  private fail(code: VoiceErrorCode, sessionId: string, detail?: string): void {
    // A failure reported for a session that has already been abandoned changes nothing.
    if (this.session?.sessionId !== sessionId || this.abandoned.has(sessionId)) return
    this.release()
    this.error = { code, message: detail && code === 'api-error' ? detail : describeError(code) }
    this.state = nextState(this.state, { type: 'failed', code })
    this.announce()
  }

  /** A session that ended well goes quiet again, without leaving "done" on screen. */
  private finish(): void {
    this.session = null
    this.state = 'idle'
    this.announce()
  }

  private announce(): void {
    const status = this.getStatus()
    for (const listener of [...this.listeners]) listener(status)
  }
}

/** The one voice input service. Every microphone in Orbis is this one. */
export const voiceInput = new VoiceInputService()

/** What getUserMedia refusing actually meant. */
function permissionProblem(err: unknown): VoiceErrorCode {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-microphone'
  if (name === 'NotReadableError') return 'recording-error'
  return 'recording-error'
}
