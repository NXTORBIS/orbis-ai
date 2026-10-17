import type { ControlDomain } from '../../shared/browserControl'
import { app, ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_EFFECT_POLICY, EFFECTS, readEffectPolicy } from '../../shared/effectPolicy.ts'
import type { BrowserCommand, CapabilityDescriptor, ControlSource, Plan, RunControl } from '../../shared/browserControl.ts'
import { BrowserControl, fail } from './registry.ts'
import type { ControlContext } from './registry.ts'
import type { PageHandle } from '../pageHandle'
import { WindowControl } from './window.ts'
import type { WindowRunResult } from './window.ts'
import { registerPageCapabilities } from './pageCapabilities.ts'
import { registerMediaCapabilities } from './mediaCapabilities.ts'
import { registerAppCapabilities } from './appCapabilities.ts'
import type { AppCapabilityDeps } from './appCapabilities.ts'
import { registerUiCapabilities } from './uiCapabilities.ts'
import { registerCaptchaCapabilities } from './captchaCapabilities.ts'
import { registerFeedCapabilities } from './feedCapabilities.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

export type BrowserControlDeps = Omit<AppCapabilityDeps, 'control' | 'windowControl'> & {
  /**
   * Why a screen is not in this person's menu, in words, or null when it is.
   *
   * Handed in rather than read here, because which features somebody sees is a per-profile file that
   * `src/main/features/store.ts` owns, and a second reader of it would be a second answer to a question that
   * already has one. Optional: without it a hidden screen is reported the way it always was rather than wrongly.
   */
  featureHidden?(path: string): Promise<string | null>
}

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
    .then((raw) => {
      const saved = JSON.parse(raw) as { off?: ControlDomain[]; effects?: unknown }
      control.setSwitchedOff(saved.off ?? [])
      // Anything missing or damaged takes the default rather than the loosest value: a broken file must not widen
      // what Orbis may do on somebody's behalf.
      control.setEffectPolicy(readEffectPolicy(saved.effects))
    })
    .catch(() => undefined)

  // Until the browser has started these are listed (so plans and Orion can see them) but say what is missing; Chromium's own
  // page and CAPTCHA capabilities replace them the moment the browser is up.
  const noBrowser = (_ctx: Pick<ControlContext, 'target'>): PageHandle => fail('unavailable', 'The Orbis browser is not open yet. Open it first (browser.open).', true)
  registerPageCapabilities(control, noBrowser)
  // What is playing, and waiting for it to change. The one thing that makes "when this video ends" a real condition
  // rather than a guess at how long a video is.
  registerMediaCapabilities(control, { tab: (ctx) => noBrowser(ctx), fail })
  registerCaptchaCapabilities(control, noBrowser)
  registerFeedCapabilities(control, { tab: (ctx) => noBrowser(ctx) })
  registerAppCapabilities({ ...deps, control, windowControl })
  registerUiCapabilities(control, deps.getWindow)
  /*
   * Inside the window's own screens.
   *
   * `registerUiCapabilities` above operates the window the way a person does -- find a control by what it is called,
   * click it, read what it says. That works anywhere and knows nothing: it cannot tell a slider's range, it cannot
   * tell whether setting something worked, and it has no idea what is inside a panel that is not open. These six ask
   * the screens themselves instead, so what comes back is declared rather than guessed at. Both are registered: the
   * screens that have said what they can do are reached this way, and everything else is still reachable the blind
   * way.
   */
  registerSurfaceCapabilities(control, {
    ask: (call, params, ctx) => windowControl.ask(call, params, ctx),
    open: () => {
      const win = deps.getWindow()
      return Boolean(win && !win.isDestroyed())
    },
    // So "open Markets" with Markets switched off is answered as switched off -- with the way to turn it on --
    // rather than as a screen Orbis cannot find.
    hidden: deps.featureHidden ? (path) => deps.featureHidden!(path) : undefined
  })

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
    // `[]`, not the live list. The write is refused either way, but the refusal used to hand back the real set of
    // switched-off areas -- which is exactly what `control:switches` above withholds from a sender it does not
    // recognise. The two refusal paths disagreed, so the setter leaked what the getter was written to hide.
    if (!fromWindow(event)) return []
    const wanted = String(domain) as ControlDomain
    const next = new Set(control.switchedOff())
    if (on === true) next.delete(wanted)
    else next.add(wanted)
    control.setSwitchedOff([...next])
    await fs.mkdir(join(switchesFile, '..'), { recursive: true }).catch(() => undefined)
    await fs.writeFile(switchesFile, JSON.stringify({ off: control.switchedOff(), effects: control.effects() })).catch(() => undefined)
    return control.switchedOff()
  })
  /**
   * What Orbis may do on your behalf, by what it does rather than which part of the browser it touches.
   *
   * Beside the area switches, not instead of them. Both apply and they fail towards doing less, so switching an area
   * off still stops everything in it however this is set.
   */
  ipcMain.handle('control:effects', (event) => (fromWindow(event) ? control.effects() : DEFAULT_EFFECT_POLICY))
  ipcMain.handle('control:set-effect', async (event, effect: unknown, rule: unknown) => {
    // The same fault as `control:set-switch`: refusing used to return the live policy, while `control:effects`
    // returns the default to a sender it does not recognise.
    if (!fromWindow(event)) return DEFAULT_EFFECT_POLICY
    const which = String(effect)
    const wanted = rule === 'allow' || rule === 'ask' || rule === 'never' ? rule : null
    if (!EFFECTS.includes(which as never) || !wanted) return control.effects()
    control.setEffectPolicy(readEffectPolicy({ ...control.effects(), [which]: wanted }))
    await fs.mkdir(join(switchesFile, '..'), { recursive: true }).catch(() => undefined)
    await fs.writeFile(switchesFile, JSON.stringify({ off: control.switchedOff(), effects: control.effects() })).catch(() => undefined)
    return control.effects()
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

  // Only the stopping is done here. Saving the log is registered by the caller against the one list of things to
  // write before closing, so it is actually waited for rather than started and abandoned.
  app.on('before-quit', () => windowControl.stopAll())

  return { control, windowControl }
}
