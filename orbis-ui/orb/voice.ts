// @ts-expect-error the helper client is plain JavaScript shared with the side panel
import { call } from './helper.js'
import { createVoiceSession, type VoiceSessionHandle, type VoiceUpdate } from '../panel/voice-session.ts'

/**
 * Speaking into the browser's address bar.
 *
 * The microphone on the browser's toolbar has nowhere to record: the browser draws the toolbar but owns no page, and
 * a page is the only thing that may open a microphone. So the button asks this -- the Orb's page, which is already in
 * every window, already allowed to reach the helper, and already the way the browser asks the person's own software
 * for anything.
 *
 * The recording itself is not done here. `createVoiceSession` is the one voice pipeline Orbis has, the same one the
 * chat, the search page and the panel's address bar use; this only asks it for a session aimed at the address bar and
 * hands the words it produces back to the browser. There is no second recorder, no second transcriber, and no state
 * shown that the pipeline did not report.
 */

declare const chrome: { send(message: string, args?: unknown[]): void }

let session: VoiceSessionHandle | null = null
/** The Orb's own prompt has its own session: two microphones in one page must never share one recorder. */
let promptSession: VoiceSessionHandle | null = null

/** Tells the browser what was said, so it can put it in the address bar and start finding things. */
const deliver = (text: string): void => {
  const words = text.trim()
  if (!words) return
  chrome.send('orbis.omnibox.setText', [words])
}

/**
 * What is really happening, put where it can be seen.
 *
 * The state is written onto the Orb's own page rather than sent to the browser, because the Orb is already drawn over
 * every window and is the thing the person is looking at. Nothing is shown ahead of the pipeline: "listening" appears
 * when the microphone is actually open, not when it was asked for.
 */
const show = (state: string, message = ''): void => {
  document.documentElement.dataset.orbisVoice = state
  if (message) document.documentElement.dataset.orbisVoiceError = message
  else delete document.documentElement.dataset.orbisVoiceError
}

const onUpdate = (update: VoiceUpdate): void => {
  show(update.state, update.error?.message ?? '')
  if (update.state === 'done' && update.text) deliver(update.text)
}

const ensure = (): VoiceSessionHandle => {
  if (!session) {
    session = createVoiceSession({
      target: 'url-bar',
      call: (channel: string, args?: unknown[]) => call(channel, args),
      onUpdate
    })
  }
  return session
}

/** Pressed once to start, again to stop -- one button, because one button is what a person is given. */
const toggle = async (): Promise<void> => {
  const voice = ensure()
  if (!voice.available()) {
    show('error', 'This window cannot use the microphone.')
    return
  }
  try {
    if (voice.state() === 'listening') await voice.stop()
    else await voice.start()
  } catch (err) {
    // The pipeline reports its own failures through `onUpdate`; this catches only the throw, so nothing is left
    // looking as though it is still recording.
    show('error', err instanceof Error ? err.message : 'Voice input could not start.')
  }
}

/**
 * Speaking into the Orb's own prompt.
 *
 * The same pipeline, aimed at the Orb rather than the address bar, and handed back to whoever asked rather than sent
 * to the browser. The Orb's panel is plain JavaScript and cannot import a module built from TypeScript, so what it
 * needs is put on the window: one function to start or stop, one to give up, and one that says whether a microphone
 * can be used at all -- which is what decides whether the button is drawn.
 */
const promptVoice = (onUpdate: (update: VoiceUpdate) => void): VoiceSessionHandle => {
  if (!promptSession) {
    promptSession = createVoiceSession({
      target: 'browser-orion',
      call: (channel: string, args?: unknown[]) => call(channel, args),
      onUpdate: (update: VoiceUpdate) => promptListener?.(update)
    })
  }
  promptListener = onUpdate
  return promptSession
}
let promptListener: ((update: VoiceUpdate) => void) | null = null

declare global {
  interface Window {
    orbisToggleVoice?: () => void
    orbisCancelVoice?: () => void
    orbisPromptVoice?: {
      available(): boolean
      state(): string
      toggle(onUpdate: (update: VoiceUpdate) => void): Promise<void>
      cancel(): void
    }
  }
}

window.orbisToggleVoice = () => void toggle()
window.orbisCancelVoice = () => {
  session?.cancel()
  show('idle')
}

window.orbisPromptVoice = {
  available: () => promptVoice(() => undefined).available(),
  state: () => promptSession?.state() ?? 'idle',
  toggle: async (onUpdate) => {
    const voice = promptVoice(onUpdate)
    if (!voice.available()) {
      onUpdate({ state: 'error', target: 'browser-orion', error: { code: 'no-microphone', message: 'This window cannot use the microphone.' } })
      return
    }
    if (voice.state() === 'listening') await voice.stop()
    else await voice.start()
  },
  cancel: () => promptSession?.cancel()
}
