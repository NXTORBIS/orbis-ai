import type { Handler } from './server.ts'

/**
 * What the Orbis app lends to the pages in the browser that are not part of the app: suggestions for a search box, and speech to text.
 * The helper runs inside Orbis, so these are the app's own services (the same code and settings the Orbis window uses), reached over the
 * helper's channels; nothing here talks to the network or to a model by itself. Each dependency is read when a call arrives.
 */
export interface AppServicesDeps {
  /** Web suggestions for what is being typed. The app answers [] unless "Web search suggestions" is on: typed text leaves the device. */
  suggestWeb(query: string): Promise<string[]>
  /** Orion's predictions for what is being typed; the same setting, the same answer of [] when it is off. */
  suggestOrion(input: string): Promise<string[]>
  /** Local speech to text (whisper.cpp on this computer). The audio is a recorded clip; nothing leaves the device. */
  transcribe(audio: Uint8Array, options: { model?: unknown; language?: unknown }): Promise<{ ok: true; text: string } | { ok: false; code: string; message: string }>
  cancelTranscription(): void
  voiceHardware(): unknown
  voiceModels(): Promise<unknown>
}

const MAX_TEXT = 200
const clip = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '')

export function createAppServiceHandlers(get: () => AppServicesDeps | null | undefined): Record<string, Handler> {
  const need = (): AppServicesDeps => {
    const services = get()
    if (!services) throw Object.assign(new Error('The Orbis app is not ready.'), { code: 'not-ready' })
    return services
  }
  return {
    'omnibox:web': ([query]) => {
      const text = clip(query)
      return text ? need().suggestWeb(text) : []
    },
    'omnibox:predict': ([input]) => {
      const text = clip(input)
      return text ? need().suggestOrion(text) : []
    },
    /** A recorded clip as base64 (the helper speaks JSON), and { model?, language? }. Answers { ok, text } or { ok: false, code, message }. */
    'voice:transcribe': async ([audio, options]) => {
      if (typeof audio !== 'string' || !audio) return { ok: false, code: 'no-speech', message: 'Nothing was recorded.' }
      const bytes = Uint8Array.from(Buffer.from(audio, 'base64'))
      return need().transcribe(bytes, options && typeof options === 'object' ? (options as { model?: unknown; language?: unknown }) : {})
    },
    'voice:cancel': () => need().cancelTranscription(),
    'voice:hardware': () => need().voiceHardware(),
    'voice:models:status': () => need().voiceModels()
  }
}
