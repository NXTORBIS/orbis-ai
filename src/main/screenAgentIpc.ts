import type { BrowserWindow } from 'electron'

import { plainHandle } from './ipc/handle.ts'
import type { BrowserControl, ConfirmRequest } from './browserControl/registry.ts'
import type { AskJson, ScreenAnswer, ScreenContext } from './screenAgent.ts'
import { carryOutScreenRequest } from './screenAgent.ts'

/**
 * The one door from the Orbis window to "do this on my screens".
 *
 * One channel, because there is one question: a sentence in, and what really happened out. The `screen.*`
 * capabilities themselves are reached over `control:window-run`, the channel the control layer has always used, and
 * nothing here widens what any of them may do -- the request goes through `control.execute` as `orion`, so the area
 * switches, the effect policy, the approval prompts, the tab lock, the retries, the undo journal and the log all
 * apply exactly as they do to a plan somebody wrote by hand.
 *
 * What arrives is treated as text from a person and nothing else. The recent conversation a window passes is capped
 * and trimmed here rather than trusted: it goes into a request to a model, so its size is this side's business.
 */

export interface ScreenAgentIpcOptions {
  getWindow(): BrowserWindow | null
  /**
   * The control layer, read at the moment of the call.
   *
   * A function rather than the layer itself: it is built partway through starting up, and a handler registered with
   * whatever existed at registration time would answer "Orbis cannot reach its own screens" for ever if it happened
   * to be registered first.
   */
  control(): BrowserControl | null
  /** How the person is asked about something consequential. The window's own approval card. */
  confirm(request: ConfirmRequest): Promise<boolean>
  ask: AskJson
}

/** How much of a request, and of the conversation around it, is used. Past this it is a paste rather than a sentence. */
const REQUEST_LIMIT = 2000
const TURNS = 6
const TURN_LIMIT = 400

/** Whatever the window sent, as a context this code will use. Nothing here trusts a shape; it rebuilds one. */
function readContext(raw: unknown): ScreenContext {
  if (!raw || typeof raw !== 'object') return {}
  const given = raw as Record<string, unknown>
  const recent = Array.isArray(given.recent) ? given.recent : []
  return {
    recent: recent
      .slice(-TURNS)
      .map((one) => {
        const turn = (one ?? {}) as Record<string, unknown>
        return { role: turn.role === 'assistant' ? ('assistant' as const) : ('user' as const), text: String(turn.text ?? '').slice(0, TURN_LIMIT) }
      })
      .filter((one) => one.text.trim().length > 0),
    ...(typeof given.lastPath === 'string' && given.lastPath.trim() ? { lastPath: given.lastPath.trim().slice(0, 300) } : {})
  }
}

export function registerScreenAgentIpc(o: ScreenAgentIpcOptions): void {
  const handle = plainHandle(o)

  handle('screens:ask', async (_event, request: unknown, context: unknown): Promise<ScreenAnswer> => {
    const control = o.control()
    // Said as a sentence rather than thrown: this happens while Orbis is still starting, which is a moment later
    // rather than a fault, and the window shows whatever comes back.
    if (!control) return { kind: 'unavailable', text: 'Orbis is still starting up, so it cannot work its own screens yet. Try again in a moment.' }
    return carryOutScreenRequest(String(request ?? '').slice(0, REQUEST_LIMIT), { control, ask: o.ask, confirm: o.confirm }, readContext(context))
  })
}
