import { WhisperService, LocalVoiceError } from '../main/whisper/service.ts'
import type { FetchFn } from '../main/whisper/modelManager.ts'
import { checkAudio, describeError, isVoiceModel, MAX_AUDIO_BYTES } from '../shared/voiceInput.ts'
import type { VoiceErrorCode } from '../shared/voiceInput.ts'
import type { WhisperDownloadProgress, WhisperModelId } from '../shared/whisperModels.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Speech to text for the pages in the browser, run on this machine.
 *
 * These are the same channels the Orbis window already uses over `ipcMain`, answered by the same WhisperService — the
 * models are downloaded once and shared, and a fix to transcription is a fix for both sides. Nothing here reaches the
 * network except to fetch a model file the person asked for: the transcription itself is a child process reading a
 * recording this machine made, and neither the audio nor the words are kept or written down anywhere.
 *
 * A helper started without a data folder or a resources folder has no local voice at all, and every channel says so:
 * `voice:hardware` answers null, which is the answer both sides already read as "no local speech here", and the model
 * channels refuse. Nothing invents a transcript, and nothing reports an empty model list as though voice were working.
 */

export interface VoiceDeps {
  /** This profile's folder; the models live in `whisper-models` under it, shared with the Orbis window. */
  userDataDir: string
  /** Where the bundled whisper.cpp binary is, packaged or not. */
  resourcesPath: string
  /** The model downloader's only way out to the network. */
  fetchFn: FetchFn
}

type Failure = { ok: false; code: VoiceErrorCode; message: string }
type Transcript = { ok: true; text: string } | Failure

const failed = (code: VoiceErrorCode, message?: string): Failure => ({ ok: false, code, message: message ?? describeError(code) })

/** Base64 grows by four bytes for every three, so a clip past the audio limit can be refused before it is decoded. */
const MAX_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES / 3) * 4
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function modelId(value: unknown): WhisperModelId {
  if (!isVoiceModel(value)) throw new HelperError('bad-request', 'That is not a speech model Orbis knows about.')
  return value
}

export function createVoiceHandlers(get: () => VoiceDeps | null | undefined): Record<string, Handler> {
  let held: { deps: VoiceDeps; service: WhisperService } | null = null

  /**
   * The one service, built on first use and kept.
   *
   * It has to be kept rather than made per call: the model manager holds the downloads that are running in memory, and
   * a fresh service each time would lose track of a download it is meant to be able to report on and cancel.
   */
  const service = (): WhisperService | null => {
    const deps = get()
    if (!deps || !deps.userDataDir || !deps.resourcesPath || typeof deps.fetchFn !== 'function') return null
    if (held?.deps.userDataDir !== deps.userDataDir || held?.deps.resourcesPath !== deps.resourcesPath || held?.deps.fetchFn !== deps.fetchFn) {
      held = { deps, service: new WhisperService(deps.userDataDir, deps.resourcesPath, deps.fetchFn) }
    }
    return held.service
  }

  const need = (): WhisperService => {
    const whisper = service()
    if (!whisper) throw new HelperError('unavailable', 'This helper was started without local speech recognition, so there are no speech models to manage here.')
    return whisper
  }

  // One transcription at a time is all any window asks for, and a second request means the first is no longer wanted:
  // its child process is stopped rather than left running for words nobody will read.
  let running: AbortController | null = null

  return {
    /**
     * A recording as base64 — the helper speaks JSON — plus an optional { model, language }. Answers { ok: true, text }
     * or { ok: false, code, message }, the same shape the Orbis window is given, so the page can say what went wrong
     * instead of guessing at a rejection.
     */
    'voice:transcribe': async ([audio, options], context): Promise<Transcript> => {
      if (typeof audio !== 'string' || !audio) return failed('no-speech', 'Nothing was recorded.')
      if (audio.length > MAX_BASE64_CHARS) return failed('too-long')
      if (!BASE64.test(audio)) return failed('bad-audio')

      const whisper = service()
      // Not "not ready": a helper without these folders will never have local voice, and the page is told plainly.
      if (!whisper) return failed('runtime-error', 'This helper was started without local speech recognition, so nothing can be transcribed here.')

      const wav = Buffer.from(audio, 'base64')
      const problem = checkAudio(wav.length)
      if (problem) return failed(problem)

      const o = options && typeof options === 'object' && !Array.isArray(options) ? (options as { model?: unknown; language?: unknown }) : {}
      const model = isVoiceModel(o.model) ? o.model : whisper.hardware().recommended
      // Two letters or nothing: anything else means letting Whisper work the language out, which is how Tamil, Hindi
      // and the rest are handled without the page having to name them.
      const language = typeof o.language === 'string' && /^[a-z]{2}$/i.test(o.language) ? o.language.toLowerCase() : null

      running?.abort()
      const controller = new AbortController()
      running = controller
      // A page that closes its request — the Stop button, a closed tab — stops the model with it.
      const stop = (): void => controller.abort()
      context.signal.addEventListener('abort', stop, { once: true })

      try {
        const text = await whisper.transcribe(wav, model, language, controller.signal)
        return { ok: true, text }
      } catch (err) {
        const code = err instanceof LocalVoiceError ? err.code : 'runtime-error'
        // The reason travels; the audio and the words never do.
        return failed(code)
      } finally {
        context.signal.removeEventListener('abort', stop)
        if (running === controller) running = null
      }
    },

    // Nothing running is not a failure: the page cancels on its way out whether or not it had started anything.
    'voice:cancel': () => void running?.abort(),

    /** What this machine can run Whisper on, and the model that follows from it. Null when this helper has no voice. */
    'voice:hardware': () => service()?.hardware() ?? null,

    'voice:models:status': () => need().status(),

    /**
     * Downloads one model, reporting progress as `{ type: 'progress' }` events on this call rather than on a channel of
     * its own: the helper has no way to push to a page that is not asking for something.
     */
    'voice:models:download': async ([id], context) => {
      const whisper = need()
      const model = modelId(id)
      try {
        await whisper.download(model, (progress: WhisperDownloadProgress) => context.emit({ type: 'progress', ...progress }))
        return { ok: true }
      } catch (err) {
        // The model manager says 'cancelled' for a download somebody stopped, which is not a failure to report as one.
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, message: message === 'cancelled' ? 'The download was stopped.' : message }
      }
    },

    'voice:models:cancelDownload': ([id]) => void need().cancelDownload(modelId(id)),

    'voice:models:delete': ([id]) => need().delete(modelId(id)),

    /** Whether a model's file still matches the checksum taken when it finished downloading — the corruption check. */
    'voice:models:verify': ([id]) => need().verify(modelId(id))
  }
}
