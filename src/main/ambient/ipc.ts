import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { Ambient, FROM_EVENT } from './service.ts'
import type { AmbientSettings } from './store.ts'
import type { OrbisBus } from '../../shared/orbisEvents.ts'
import type { SuggestionKind } from '../../shared/ambient/suggest.ts'

/**
 * What the window may ask Ambient Intelligence, and what the bus tells it.
 *
 * One channel, `ambient:do`, with an operation name — the same shape Student and Music use, for the same reason:
 * a dozen channels for one feature is a dozen lines in the channel map that nobody reads.
 *
 * ## Nothing here reaches into anything
 *
 * The handlers check the sender, coerce what arrived, and hand it on. Every decision is in the service, and every
 * rule about what may be recorded is in `activity.ts`, before a row exists.
 */

export interface AmbientIpcOptions {
  ambient: Ambient
  bus: OrbisBus
  getWindow(): BrowserWindow | null
}

const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.trim().slice(0, limit) : '')
const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

const KINDS: readonly SuggestionKind[] = [
  'nothing', 'show-context', 'continue', 'ask-orion', 'related-content', 'group-tabs', 'save-project', 'related-file'
]

export function registerAmbientIpc(options: AmbientIpcOptions): void {
  const { ambient, bus, getWindow } = options

  const mine = (event: IpcMainInvokeEvent): boolean => {
    const window = getWindow()
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents)
  }

  /*
   * Everything that happens in Orbis already says so on the bus.
   *
   * Subscribing is the whole of the integration: no other part of Orbis has to know Ambient Intelligence exists,
   * and a new event becomes a line in `FROM_EVENT` rather than an edit to five files.
   */
  bus.subscribe({ names: Object.keys(FROM_EVENT) as never }, (event) => {
    const mapped = FROM_EVENT[event.name]
    if (!mapped) return
    const payload = object(event.detail)
    void ambient
      .record({
        kind: mapped.kind,
        source: mapped.source,
        title: text(payload.title ?? payload.query ?? payload.name ?? payload.subject ?? '', 300),
        url: typeof payload.url === 'string' ? payload.url : null,
        refId: typeof payload.id === 'string' ? payload.id : null,
        // A private tab is never recorded, and the browser is the only thing that knows which one it was.
        privateTab: payload.private === true || payload.incognito === true
      })
      .catch(() => undefined)
  })

  const run = async (op: unknown, a?: unknown, b?: unknown): Promise<unknown> => {
    switch (op) {
      // ---------------------------------------------------------------- what is going on
      case 'current': {
        const one = ambient.currentContext()
        return one ? { ...one, evidence: one.evidence } : null
      }
      case 'detail':
        return ambient.detail()
      case 'all':
        return ambient.all()
      case 'think':
        return ambient.think()

      // ---------------------------------------------------------------- putting it right
      case 'correct': {
        const change = object(a)
        return ambient.correctCurrent({
          subject: typeof change.subject === 'string' ? change.subject.trim().slice(0, 80) || null : undefined,
          concept: typeof change.concept === 'string' ? change.concept.trim().slice(0, 120) || null : undefined,
          wrong: change.wrong === true
        })
      }

      // ---------------------------------------------------------------- picking things back up
      case 'unfinished':
        return ambient.unfinished()
      case 'sessions':
        return ambient.inspect().contexts.length >= 0 ? (await ambient.detail())?.related ?? [] : []
      case 'resolve':
        return typeof a === 'string' ? ambient.resolve(a.slice(0, 300)) : null

      // ---------------------------------------------------------------- saying something, rarely
      case 'suggestion':
        return ambient.suggestion({ busy: a === true })
      case 'answered': {
        const kind = KINDS.find((one) => one === a)
        const how = b === 'accepted' ? 'accepted' : b === 'never' ? 'never' : 'dismissed'
        if (!kind) return { ok: false }
        await ambient.answerSuggestion(kind, how)
        return { ok: true }
      }

      // ---------------------------------------------------------------- the controls
      case 'settings':
        return ambient.settings()
      case 'save-settings':
        return a && typeof a === 'object' ? ambient.saveSettings(a as Partial<AmbientSettings>) : ambient.settings()
      case 'pause':
        return ambient.saveSettings({ paused: a !== false })
      case 'clear':
        return ambient.clear()

      // ---------------------------------------------------------------- developer only
      case 'inspect':
        return ambient.inspect()

      default:
        return { ok: false, why: `Ambient Intelligence does not know how to "${String(op).slice(0, 40)}".` }
    }
  }

  ipcMain.handle('ambient:do', async (event, op: unknown, a?: unknown, b?: unknown) => {
    if (!mine(event)) throw new Error('Not allowed.')
    return run(op, a, b)
  })
}
