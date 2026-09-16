import { app, ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { BrowserCommand, CapabilityDescriptor, ControlSource, Plan, RunControl, WindowBrowserState } from '../../shared/browserControl.ts'
import { BrowserControl } from './registry.ts'
import { WindowControl } from './window.ts'
import type { WindowRunResult } from './window.ts'
import { registerPageCapabilities } from './pageCapabilities.ts'
import { registerMainCapabilities } from './mainCapabilities.ts'
import type { MainCapabilityDeps, NavigationRecord } from './mainCapabilities.ts'
import { registerUiCapabilities } from './uiCapabilities.ts'

export type BrowserControlDeps = Omit<MainCapabilityDeps, 'control' | 'windowControl' | 'navigation'>

const LOG_LIMIT = 5 * 1024 * 1024

/**
 * Creates the Orbis Browser Control Layer and connects it: the capability registry, the window's side (its own
 * capabilities, state reports, approvals, plan runs), webpage, main-process and Orbis-interface capabilities, a batched
 * log file, and IPC for the window. Only the Orbis window itself may use these channels.
 */
export function setupBrowserControl(deps: BrowserControlDeps): { control: BrowserControl; windowControl: WindowControl; trackGuest(contents: WebContents): void } {
  const logFile = join(app.getPath('userData'), 'logs', 'browser-control.jsonl')
  const control = new BrowserControl({
    sink: async (lines) => {
      await fs.mkdir(join(logFile, '..'), { recursive: true })
      const size = (await fs.stat(logFile).catch(() => null))?.size ?? 0
      if (size > LOG_LIMIT) await fs.rename(logFile, `${logFile}.1`).catch(() => undefined)
      await fs.appendFile(logFile, `${lines.join('\n')}\n`)
    }
  })
  const windowControl = new WindowControl({ control, getWindow: deps.getWindow, capabilityCache: join(app.getPath('userData'), 'control-capabilities.json') })

  // Navigation outcomes per tab, recorded from the page's own events (a handful per navigation, nothing in between).
  const navigations = new Map<number, NavigationRecord>()
  const trackGuest = (contents: WebContents): void => {
    const id = contents.id
    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      navigations.set(id, { url: details.url, redirects: [], loading: true, startedAt: Date.now() })
    })
    contents.on('did-redirect-navigation', (details) => {
      if (!details.isMainFrame) return
      const record = navigations.get(id)
      if (record && record.redirects.length < 20) record.redirects.push(details.url)
    })
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      const record = navigations.get(id) ?? { url, redirects: [], loading: false, startedAt: Date.now() }
      navigations.set(id, { ...record, loading: false, failed: { code, description, url }, finishedAt: Date.now() })
    })
    contents.on('did-finish-load', () => {
      const record = navigations.get(id)
      if (record) Object.assign(record, { loading: false, finishedAt: Date.now(), url: contents.getURL() })
    })
    contents.once('destroyed', () => navigations.delete(id))
  }

  registerPageCapabilities(control, windowControl, () => deps.getWindow()?.webContents ?? null)
  registerMainCapabilities({ ...deps, control, windowControl, navigation: (wcId) => navigations.get(wcId) })
  registerUiCapabilities(control, deps.getWindow)

  const fromWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const win: BrowserWindow | null = deps.getWindow()
    return Boolean(win && !win.isDestroyed() && event.sender === win.webContents)
  }
  const sourceOf = (value: unknown): ControlSource => (value === 'automation' ? 'automation' : 'user')

  ipcMain.on('control:window-state', (event, state: unknown) => {
    if (fromWindow(event) && state && typeof state === 'object' && Array.isArray((state as WindowBrowserState).tabs)) windowControl.setState(state as WindowBrowserState)
  })
  ipcMain.on('control:window-scope', (event, scope: unknown, descriptors: unknown) => {
    if (!fromWindow(event) || typeof scope !== 'string' || !Array.isArray(descriptors)) return
    const valid = descriptors.filter((d): d is CapabilityDescriptor => Boolean(d) && typeof d.id === 'string' && /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z0-9-]*$/.test(d.id) && typeof d.name === 'string' && typeof d.params === 'object')
    windowControl.setScope(scope, valid.map((d) => ({ ...d, requires: Array.isArray(d.requires) ? d.requires : [], confirmation: d.confirmation ?? 'none', provider: 'window' })))
  })
  ipcMain.on('control:window-result', (event, callId: unknown, result: unknown) => {
    if (fromWindow(event) && typeof callId === 'string' && result && typeof result === 'object') windowControl.answerCall(callId, result as WindowRunResult)
  })
  ipcMain.on('control:confirm-answer', (event, id: unknown, approved: unknown) => {
    if (fromWindow(event) && typeof id === 'string') windowControl.answerConfirmation(id, approved === true)
  })
  ipcMain.handle('control:capabilities', (event, filter: unknown) => (fromWindow(event) ? control.list((filter ?? {}) as { domain?: string; query?: string; availableOnly?: boolean }) : []))
  ipcMain.handle('control:state', (event, parts: unknown) => (fromWindow(event) ? control.snapshot(Array.isArray(parts) ? parts.map(String) : undefined) : {}))
  ipcMain.handle('control:execute', async (event, command: unknown) => {
    if (!fromWindow(event) || !command || typeof command !== 'object' || typeof (command as BrowserCommand).capability !== 'string') return { ok: false, capability: '', attempts: 0, durationMs: 0, error: { code: 'invalid-params', message: 'Invalid command.', recoverable: false } }
    const c = command as BrowserCommand
    return control.execute({ ...c, source: sourceOf(c.source) }, { confirm: (request) => windowControl.confirm(request) })
  })
  ipcMain.handle('control:run-plan', (event, plan: unknown, source: unknown) => {
    if (!fromWindow(event) || !plan || typeof plan !== 'object' || !Array.isArray((plan as Plan).steps)) throw new Error('Invalid plan.')
    return windowControl.startRun(plan as Plan, sourceOf(source))
  })
  ipcMain.handle('control:run-control', (event, id: unknown, action: unknown) =>
    fromWindow(event) && typeof id === 'string' && ['pause', 'resume', 'stop', 'skip', 'restart-step', 'stop-after-iteration'].includes(String(action)) ? windowControl.controlRun(id, action as RunControl) : false
  )
  ipcMain.handle('control:runs', (event) => (fromWindow(event) ? windowControl.listRuns() : []))
  ipcMain.handle('control:log', (event, limit: unknown) => (fromWindow(event) ? control.recentLog(typeof limit === 'number' ? limit : 100) : []))

  app.on('before-quit', () => {
    windowControl.stopAll()
    void control.flush()
  })

  return { control, windowControl, trackGuest }
}
