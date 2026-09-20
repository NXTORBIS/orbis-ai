import type { ControlDomain } from '../../shared/browserControl'
import { app, ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { BrowserCommand, CapabilityDescriptor, ControlSource, Plan, RunControl } from '../../shared/browserControl.ts'
import { BrowserControl, fail } from './registry.ts'
import type { ControlContext } from './registry.ts'
import type { PageHandle } from '../pageHandle'
import { WindowControl } from './window.ts'
import type { WindowRunResult } from './window.ts'
import { registerPageCapabilities } from './pageCapabilities.ts'
import { registerAppCapabilities } from './appCapabilities.ts'
import type { AppCapabilityDeps } from './appCapabilities.ts'
import { registerUiCapabilities } from './uiCapabilities.ts'
import { registerCaptchaCapabilities } from './captchaCapabilities.ts'

export type BrowserControlDeps = Omit<AppCapabilityDeps, 'control' | 'windowControl'>

const LOG_LIMIT = 5 * 1024 * 1024

/**
 * Creates the Orbis Browser Control Layer and connects it: the capability registry, the app's own capabilities (settings, the
 * clipboard, state and conditions, the Orbis interface), approvals and plan runs, a batched log file, and IPC for the window.
 * The browser capabilities (tabs, navigation, pages, downloads, extensions...) are Chromium's: `src/main/chromium` registers
 * them on this same registry when the browser starts. Only the Orbis window itself may use these channels.
 */
export function setupBrowserControl(deps: BrowserControlDeps): { control: BrowserControl; windowControl: WindowControl } {
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
  const switchesFile = join(app.getPath('userData'), 'control-switches.json')
  void fs
    .readFile(switchesFile, 'utf8')
    .then((raw) => control.setSwitchedOff((JSON.parse(raw) as { off?: ControlDomain[] }).off ?? []))
    .catch(() => undefined)

  // Until the browser has started these are listed (so plans and Orion can see them) but say what is missing; Chromium's own
  // page and CAPTCHA capabilities replace them the moment the browser is up.
  const noBrowser = (_ctx: Pick<ControlContext, 'target'>): PageHandle => fail('unavailable', 'The Orbis browser is not open yet. Open it first (browser.open).', true)
  registerPageCapabilities(control, noBrowser)
  registerCaptchaCapabilities(control, noBrowser)
  registerAppCapabilities({ ...deps, control, windowControl })
  registerUiCapabilities(control, deps.getWindow)

  const fromWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const win: BrowserWindow | null = deps.getWindow()
    return Boolean(win && !win.isDestroyed() && event.sender === win.webContents)
  }
  const sourceOf = (value: unknown): ControlSource => (value === 'automation' ? 'automation' : 'user')

  // The parts of the Orbis window that own something (the address bar) say what they can do, and answer when asked to do it.
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
  ipcMain.handle('control:switches', (event) => (fromWindow(event) ? control.switchedOff() : []))
  ipcMain.handle('control:set-switch', async (event, domain: unknown, on: unknown) => {
    if (!fromWindow(event)) return control.switchedOff()
    const wanted = String(domain) as ControlDomain
    const next = new Set(control.switchedOff())
    if (on === true) next.delete(wanted)
    else next.add(wanted)
    control.setSwitchedOff([...next])
    await fs.mkdir(join(switchesFile, '..'), { recursive: true }).catch(() => undefined)
    await fs.writeFile(switchesFile, JSON.stringify({ off: control.switchedOff() })).catch(() => undefined)
    return control.switchedOff()
  })
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

  return { control, windowControl }
}
