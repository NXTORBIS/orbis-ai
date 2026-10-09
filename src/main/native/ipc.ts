import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { Native } from './service.ts'
import type { AppSize } from '../../shared/native/manifest.ts'

/**
 * What the window may ask the Native App runtime.
 *
 * One channel, `native:do`, with an operation name — the shape Student, Music, Courses and Ambient Intelligence all
 * use. This is the only file in the native layer that imports Electron, which is what keeps the rest of it on the
 * no-Electron list and portable to the browser's own process later.
 *
 * ## It coerces and delegates, and decides nothing
 *
 * Every argument is narrowed here and every decision is made in the service. In particular an Orion action arrives as
 * an opaque object and goes straight to `native.act`, which validates it properly — there is deliberately no
 * half-check here that would have to agree with the real one.
 *
 * ## Nothing here runs anything, with one named exception
 *
 * No file path is taken and no code is executed. An app's own work happens in the renderer where the app is, or in the
 * engines the Pages layer already guards.
 *
 * The exception is the Database Laboratory's `sql-*` operations. SQL has to run where the database engine is, which is
 * this process, so the typed query crosses here. It is checked before it reaches the engine and it runs against a
 * database held only in memory, so the worst a query can do is be refused. That reasoning is written out in `sql.ts`,
 * which is the file that has to be right.
 */

export interface NativeIpcOptions {
  native: Native
  getWindow(): BrowserWindow | null
}

const id = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 && value.length <= 80 ? value : null)
const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.slice(0, limit) : '')
const flag = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback)
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const list = (value: unknown, most: number): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string').slice(0, most) : []

const size = (value: unknown): AppSize | undefined =>
  value === 'compact' || value === 'expanded' || value === 'workspace' ? value : undefined

export function registerNativeIpc(options: NativeIpcOptions): void {
  const { native, getWindow } = options

  /*
   * Tell the window when an instance has changed underneath it.
   *
   * A card reads its instance once, when it mounts. That was fine while the only thing that changed an app was
   * the card itself — but Orion configures apps too, straight through this service, and then the screen went on
   * showing the old settings while the conversation said they had changed. Nothing on screen disagreed with a
   * reply that was wrong.
   *
   * The id only: the card re-reads for itself, so nothing here has to know what a card wants.
   */
  const announce = (instanceId: unknown): void => {
    if (typeof instanceId !== 'string' || instanceId === '') return
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('native:changed', instanceId)
  }

  /** The operations that change an instance, as opposed to asking it something. */
  const CHANGES = new Set(['configure', 'run', 'pause', 'reset', 'resize', 'close', 'result', 'failed', 'ready'])

  const mine = (event: IpcMainInvokeEvent): boolean => {
    const window = getWindow()
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents)
  }

  const run = async (op: unknown, a?: unknown, b?: unknown, c?: unknown): Promise<unknown> => {
    switch (op) {
      // ---------------------------------------------------------------- discovery
      case 'catalogue':
        return native.catalogue()
      case 'capabilities':
        return native.capabilities()
      case 'find':
        // The one function Search Labs and Orion share. Context is a nudge and is capped here.
        return native.find(text(a, 200), {
          about: list(object(b).about, 12),
          domains: list(object(b).domains, 8) as never
        })
      case 'recent':
        return native.recent()
      case 'clear-recent':
        await native.clearRecent()
        return true
      case 'flows-from':
        return id(a) ? native.flowsFrom(id(a)!) : []

      // ---------------------------------------------------------------- opening
      case 'open':
        return native.openApp({
          appId: id(object(a).appId) ?? undefined,
          capability: id(object(a).capability) ?? undefined,
          conversationId: id(object(a).conversationId),
          messageId: id(object(a).messageId),
          configure: object(object(a).configure),
          size: size(object(a).size)
        })
      case 'ready':
        return id(a) ? native.markReady(id(a)!) : null

      // ---------------------------------------------------------------- lifecycle
      case 'run':
        return id(a) ? native.run(id(a)!) : null
      case 'pause':
        return id(a) ? native.pause(id(a)!) : null
      case 'reset':
        return id(a) ? native.reset(id(a)!) : null
      case 'close':
        return id(a) ? native.close(id(a)!) : null
      case 'resize': {
        const wanted = size(b)
        return id(a) && wanted ? native.resize(id(a)!, wanted) : null
      }
      case 'on-screen':
        return id(a) ? native.setOnScreen(id(a)!, flag(b, true)) : null
      case 'failed':
        return id(a)
          ? native.fail(id(a)!, {
              says: text(object(b).says, 300) || 'The app stopped working.',
              recovery:
                object(b).recovery === 'restore' || object(b).recovery === 'restart' || object(b).recovery === 'close' || object(b).recovery === 'wait'
                  ? (object(b).recovery as 'restore' | 'restart' | 'close' | 'wait')
                  : 'restart',
              detail: text(object(b).detail, 2_000) || undefined
            })
          : null

      // ---------------------------------------------------------------- parameters and state
      case 'configure':
        return id(a) ? native.configure(id(a)!, object(b)) : null
      case 'store':
        return id(a) ? native.storeState(id(a)!, object(b)) : null
      case 'result':
        // The generation is what makes a late result safe to ignore, so it is required rather than defaulted to now.
        return id(a) ? native.applyResult(id(a)!, Math.max(0, Math.round(num(b, -1))), object(c)) : { applied: false, why: 'No app was named.' }
      case 'restore':
        return id(a) ? native.restoreSaved(id(a)!) : null

      // ---------------------------------------------------------------- reading
      case 'instance':
        return id(a) ? native.instance(id(a)!) : null
      case 'conversation':
        return id(a) ? native.conversation(id(a)!) : []
      case 'should-mount':
        return id(a) ? native.shouldMount(id(a)!) : []
      case 'card':
        return native.card({
          appId: text(object(a).appId, 64),
          instanceId: text(object(a).instanceId, 64),
          appVersion: Math.max(1, Math.round(num(object(a).appVersion, 1)))
        })

      // ---------------------------------------------------------------- Orion
      case 'offer':
        return native.offerToOrion()
      case 'act':
        // Straight through. The service validates shape, existence, declaration and permission; a second partial check
        // here would be one more thing that has to agree with it.
        return native.act(a)
      case 'preview':
        return native.preview(a)

      // ---------------------------------------------------------------- settings and diagnostics
      case 'capability-enabled':
        return id(a) ? native.setCapabilityEnabled(id(a)!, flag(b, true)) : []
      // ---------------------------------------------------------------- the Database Laboratory
      case 'sql-datasets':
        return native.sqlDatasets()
      case 'sql-load':
        return id(a) ? native.sqlLoad(id(a)!, text(b, 40)) : null
      case 'sql-run':
        // The query is capped here and checked properly in the engine; a cap is not a check.
        return id(a) ? native.sqlRun(id(a)!, text(b, 20_000)) : null
      case 'sql-schema':
        return id(a) ? native.sqlSchema(id(a)!) : null

      case 'health':
        return native.health()
      case 'diagnostics':
        return id(a) ? native.diagnostics(id(a)!) : null

      default:
        return { ok: false, says: `The Native App runtime does not know how to "${String(op).slice(0, 40)}".` }
    }
  }

  ipcMain.handle('native:do', async (event, op: unknown, a?: unknown, b?: unknown, c?: unknown) => {
    if (!mine(event)) throw new Error('Not allowed.')
    const answer = await run(op, a, b, c)
    // After it has happened, not before: a card that reloaded first would read the state it already had.
    if (typeof op === 'string' && CHANGES.has(op)) announce(a)
    return answer
  })
}
