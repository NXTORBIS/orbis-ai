import { plainHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'

/**
 * Speech into text, for every microphone in Orbis.
 *
 * The window records; this sends the clip to Pulsar and sends the words back. A failure comes back as a reason the
 * window can act on rather than as a string it has to guess at, and neither the audio nor the words are kept or
 * logged anywhere along the way.
 *
 * ## One transcription at a time
 *
 * A single window never asks for two at once, and a second call cancels the first's process the same way the
 * window cancelling a session would -- so nothing is left running for words nobody is waiting for. The controller
 * lives here rather than in the service because cancelling is about this conversation with this window.
 *
 * ## Nothing here reaches the network
 *
 * Pulsar runs a local child process against a model file already on disk. Downloading a model does reach the
 * network, and that is the one thing here that does; it reports its progress to the window as it goes.
 */

import type { VoiceErrorCode } from '../../shared/voiceInput.ts'

/**
 * What came back, as the window reads it.
 *
 * Two shapes rather than one with optional fields: a success has words and no reason, a failure has a reason and
 * no words, and a single shape with everything optional lets a caller read a failure's text without noticing.
 */
export type VoiceAnswer = { ok: true; text: string } | { ok: false; code: string; message: string }

export interface VoiceModels {
  installed: unknown[]
  downloading: unknown[]
}

/** What this needs of Pulsar, named so nothing here has to know how speech is actually done. */
export interface SpeechService {
  hardware(): unknown
  status(): Promise<VoiceModels>
  transcribe(audio: Buffer, model: string, language: string | null, signal: AbortSignal): Promise<string>
  download(id: string, onProgress: (progress: unknown) => void): Promise<void>
  cancelDownload(id: string): void
  delete(id: string): Promise<void>
  verify(id: string): Promise<boolean>
}

export interface WhisperIpcOptions {
  getWindow(): BrowserWindow | null
  /** Null until the local speech engine is ready, and sometimes for ever: a build may not ship one. */
  speech(): SpeechService | null
  /** Whether a model id is one Orbis knows. */
  isModel(id: unknown): id is string
  /** What is wrong with a clip, before anything is run on it. Null when nothing is. */
  checkAudio(bytes: number): VoiceErrorCode | null
  /** What to tell somebody about a failure, in their words. */
  describeError(code: VoiceErrorCode): string
  /** The recommended model for this machine, used when the window names none. Null when there is no engine. */
  recommended(): string | null
}

/** Everything the rest of Orbis needs of this: one transcription, and the ability to stop it. */
export interface VoiceHandle {
  transcribe(audio: Buffer, options: { model?: unknown; language?: unknown }): Promise<VoiceAnswer>
  cancel(): void
  hardware(): unknown
  models(): Promise<VoiceModels>
}

export function registerWhisperIpc(o: WhisperIpcOptions): VoiceHandle {
  const handle = plainHandle(o)

  /*
   * One in flight at a time. A second call aborts the first rather than queueing it: somebody who starts talking
   * again has stopped caring about what they said before, and two child processes competing for the microphone's
   * words is worse than either.
   */
  let running: AbortController | null = null

  const transcribe = async (audio: Buffer, options: { model?: unknown; language?: unknown }): Promise<VoiceAnswer> => {
    const speech = o.speech()
    if (!speech) return { ok: false, code: 'runtime-error', message: 'Speech input is not ready yet.' }

    const wrong = o.checkAudio(audio.length)
    if (wrong) return { ok: false, code: wrong, message: o.describeError(wrong) }

    running?.abort()
    const controller = new AbortController()
    running = controller

    try {
      const asked = o.isModel(options.model) ? options.model : o.recommended()
      if (asked === null) return { ok: false, code: 'runtime-error', message: 'Speech input is not ready yet.' }
      const model = asked
      const language = typeof options.language === 'string' && /^[a-z]{2}$/i.test(options.language) ? options.language.toLowerCase() : null
      // Nothing here reaches the network: a local child process, against a model file already on disk.
      const text = await speech.transcribe(audio, model, language, controller.signal)
      return { ok: true, text }
    } catch (err) {
      const code = (typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : 'runtime-error') as VoiceErrorCode
      // The reason travels; the audio and the words never do, and neither is written down anywhere.
      return { ok: false, code, message: o.describeError(code) }
    } finally {
      if (running === controller) running = null
    }
  }

  const cancel = (): void => running?.abort()
  const hardware = (): unknown => o.speech()?.hardware() ?? null
  const models = async (): Promise<VoiceModels> => {
    const speech = o.speech()
    return speech ? speech.status() : { installed: [], downloading: [] }
  }

  handle('voice:transcribe', (_event, audio: unknown, options: unknown) =>
    transcribe(
      audio instanceof Uint8Array ? Buffer.from(audio) : Buffer.alloc(0),
      (options ?? {}) as { model?: unknown; language?: unknown }
    )
  )

  handle('voice:cancel', () => {
    cancel()
  })

  handle('voice:hardware', () => hardware())

  handle('voice:models-status', () => models())

  handle('voice:models-download', async (_event, id: unknown) => {
    const speech = o.speech()
    if (!speech || !o.isModel(id)) return { ok: false, message: 'Not a recognised model.' }
    try {
      await speech.download(id, (progress) => {
        const window = o.getWindow()
        if (window && !window.isDestroyed()) window.webContents.send('voice:models-progress', progress)
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  handle('voice:models-cancel-download', (_event, id: unknown) => {
    const speech = o.speech()
    if (speech && o.isModel(id)) speech.cancelDownload(id)
  })

  handle('voice:models-delete', async (_event, id: unknown) => {
    const speech = o.speech()
    if (speech && o.isModel(id)) await speech.delete(id)
  })

  handle('voice:models-verify', async (_event, id: unknown) => {
    const speech = o.speech()
    return speech && o.isModel(id) ? speech.verify(id) : false
  })

  return { transcribe, cancel, hardware, models }
}
