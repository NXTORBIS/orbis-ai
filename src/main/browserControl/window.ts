import type { BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import type { CapabilityDescriptor, CommandResult, ControlRequirement, ControlSource, Plan, RunControl, RunState, WindowBrowserState, WindowRunResult } from '../../shared/browserControl.ts'
import { BrowserControl, ControlFailure } from './registry.ts'
import type { CapabilityDefinition, ConfirmRequest, ControlContext } from './registry.ts'
import { PlanRun } from './runner.ts'
import { join } from 'node:path'

export type { WindowRunResult }

export interface WindowControlOptions {
  control: BrowserControl
  getWindow(): BrowserWindow | null
  /**
   * Where the window's capability descriptions are remembered, so they stay discoverable (as unavailable, with the
   * reason) while the part of the window that provides them is closed, including after a restart.
   */
  capabilityCache?: string
}

/** Why a window part's capabilities can't run while that part isn't open. */
const CLOSED_REASON: Record<string, string> = {
  'address-bar': 'The address bar is not ready yet.'
}

/**
 * The Orbis window's side of the control layer. The address bar lives in the window, so its capabilities are carried out
 * there by the same functions its typing and clicks use: the window registers what it can do, and answers when asked. The
 * browser itself is Chromium; its tab list is fed into `state` from the browser (see `browserState.ts`). This class also asks the
 * user to approve consequential actions, and runs multi-step plans.
 */
export class WindowControl {
  private readonly o: WindowControlOptions
  private readonly scopes = new Map<string, string[]>()
  private readonly calls = new Map<string, (result: WindowRunResult) => void>()
  private readonly confirmations = new Map<string, (approved: boolean) => void>()
  private readonly runs = new Map<string, PlanRun>()
  private readonly finished: RunState[] = []
  /** The browser's latest tab report: the one source of truth, as the browser itself gives it. */
  state: WindowBrowserState | null = null
  private stateWaiters: (() => void)[] = []
  private readonly verifications = new WeakMap<ControlContext, WindowRunResult['verification']>()

  /** The descriptors each window part provided when it was last open. */
  private readonly known = new Map<string, CapabilityDescriptor[]>()

  constructor(options: WindowControlOptions) {
    this.o = options
    void this.loadCache()
  }

  private async loadCache(): Promise<void> {
    if (!this.o.capabilityCache) return
    try {
      const saved = JSON.parse(await fs.readFile(this.o.capabilityCache, 'utf8')) as Record<string, CapabilityDescriptor[]>
      for (const [scope, list] of Object.entries(saved)) {
        // Only parts of the window that still exist: an earlier Orbis also remembered its in-app browser's capabilities here, which are Chromium's now.
        if (!(scope in CLOSED_REASON) || this.scopes.has(scope) || !Array.isArray(list)) continue
        this.known.set(scope, list)
        for (const d of list) if (!this.o.control.has(d.id)) this.registerClosed(scope, d)
      }
    } catch {
      // Nothing remembered yet: the window registers its capabilities as its parts open.
    }
  }

  private saveCache(): void {
    if (!this.o.capabilityCache) return
    const file = this.o.capabilityCache
    const data = JSON.stringify(Object.fromEntries(this.known))
    void fs
      .mkdir(join(file, '..'), { recursive: true })
      .then(() => fs.writeFile(`${file}.tmp`, data))
      .then(() => fs.rename(`${file}.tmp`, file))
      .catch(() => undefined)
  }

  /** A capability whose window part is closed: listed, with why it can't run. */
  private registerClosed(scope: string, d: CapabilityDescriptor): void {
    const reason = CLOSED_REASON[scope] ?? 'That part of Orbis is not open.'
    this.o.control.register({
      id: d.id,
      domain: d.domain,
      name: d.name,
      description: d.description,
      params: d.params,
      mutates: d.mutates,
      confirmation: d.confirmation,
      requires: d.requires,
      provider: 'window',
      unavailable: () => reason,
      run: () => {
        throw new ControlFailure('unavailable', reason, true)
      }
    } as CapabilityDefinition & { provider: 'window' })
  }

  private send(channel: string, ...args: unknown[]): boolean {
    const win = this.o.getWindow()
    if (!win || win.isDestroyed()) return false
    win.webContents.send(channel, ...args)
    return true
  }

  // ---------------------------------------------------------------- state

  private readonly stateListeners = new Set<(state: WindowBrowserState) => void>()

  setState(state: WindowBrowserState): void {
    this.state = state
    for (const wake of this.stateWaiters.splice(0)) wake()
    for (const listener of this.stateListeners) listener(state)
  }

  /** Hears every state report (for the recorder and workflow triggers); returns the function that stops listening. */
  onState(listener: (state: WindowBrowserState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  /** Resolves with the next state report (or the current one after `ms`), so a capability can check the window's result. */
  nextState(ms = 1500): Promise<WindowBrowserState | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.state), ms)
      this.stateWaiters.push(() => {
        clearTimeout(timer)
        resolve(this.state)
      })
    })
  }

  /** Why a window capability can't run now, from its requirements and the reported state. */
  private unavailableFor(requires: ControlRequirement[]): string | null {
    if (!this.o.getWindow()) return 'The Orbis window is not open.'
    if (requires.includes('browser-open') && !this.state?.open) return 'The browser is closed. Open it first (browser.open).'
    if (requires.includes('web-page')) {
      const active = this.state?.tabs.find((t) => t.active)
      if (!this.state?.open || !active || !/^https?:\/\//i.test(active.url)) return 'The active tab has no web page open.'
    }
    return null
  }

  // ---------------------------------------------------------------- capabilities from the window

  /** The window (or one part of it, such as the browser panel) says which capabilities it provides now. */
  setScope(scope: string, descriptors: CapabilityDescriptor[]): void {
    const previous = this.scopes.get(scope) ?? []
    const ids = descriptors.map((d) => d.id)
    for (const id of previous) {
      if (ids.includes(id)) continue
      const remembered = this.known.get(scope)?.find((d) => d.id === id)
      if (remembered && !descriptors.length) this.registerClosed(scope, remembered)
      else this.o.control.unregister(id)
    }
    if (descriptors.length) {
      this.known.set(scope, descriptors)
      this.saveCache()
    }
    for (const d of descriptors) {
      const definition: CapabilityDefinition & { provider: 'window' } = {
        id: d.id,
        domain: d.domain,
        name: d.name,
        description: d.description,
        params: d.params,
        mutates: d.mutates,
        confirmation: d.confirmation,
        requires: d.requires,
        provider: 'window',
        unavailable: () => this.unavailableFor(d.requires ?? []),
        run: async (params, ctx) => {
          const result = await this.invoke(d.id, params, ctx)
          if (!result.ok) throw new ControlFailure(result.error?.code ?? 'failed', result.error?.message ?? `${d.name} failed.`, result.error?.recoverable ?? false)
          if (result.verification) this.verifications.set(ctx, result.verification)
          return result.data
        },
        verify: d.mutates ? (_data, _params, ctx) => this.verifications.get(ctx) ?? { verified: false, detail: 'The window did not report whether it worked.' } : undefined
      }
      this.o.control.register(definition)
    }
    this.scopes.set(scope, ids)
  }

  /**
   * Asks the window something that is not a capability of its own.
   *
   * The screens bridge: the capabilities that reach inside the window's own screens are registered in the main
   * process (`surfaceCapabilities.ts`) and carried out in the window, which is the same shape as everything below --
   * so it goes down the same channel, with the same call bookkeeping, the same deadline and the same answer to being
   * stopped. A second route to the window would be a second thing to get right.
   */
  ask(call: string, params: Record<string, unknown>, ctx: Pick<ControlContext, 'source' | 'target' | 'signal'>): Promise<WindowRunResult> {
    return this.invoke(call, params, ctx)
  }

  private invoke(capability: string, params: Record<string, unknown>, ctx: Pick<ControlContext, 'source' | 'target' | 'signal'>): Promise<WindowRunResult> {
    return new Promise((resolve) => {
      const callId = crypto.randomUUID()
      const finish = (result: WindowRunResult): void => {
        clearTimeout(timer)
        ctx.signal?.removeEventListener('abort', onAbort)
        this.calls.delete(callId)
        resolve(result)
      }
      const onAbort = (): void => finish({ ok: false, error: { code: 'aborted', message: 'Stopped.', recoverable: false } })
      const timer = setTimeout(() => finish({ ok: false, error: { code: 'timeout', message: `The Orbis window didn't finish ${capability} in time.`, recoverable: true } }), 30_000)
      ctx.signal?.addEventListener('abort', onAbort, { once: true })
      this.calls.set(callId, finish)
      if (!this.send('control:window-run', { callId, capability, params, target: ctx.target ?? null, source: ctx.source })) finish({ ok: false, error: { code: 'unavailable', message: 'The Orbis window is not open.', recoverable: true } })
    })
  }

  answerCall(callId: string, result: WindowRunResult): void {
    this.calls.get(callId)?.(result)
  }

  // ---------------------------------------------------------------- approvals

  /** Shows an approval prompt in the Orbis window; resolves true only when the user approves. */
  confirm(request: ConfirmRequest): Promise<boolean> {
    return new Promise((resolve) => {
      const id = crypto.randomUUID()
      const finish = (approved: boolean): void => {
        clearTimeout(timer)
        this.confirmations.delete(id)
        resolve(approved)
      }
      const timer = setTimeout(() => finish(false), 5 * 60_000)
      this.confirmations.set(id, finish)
      if (!this.send('control:confirm', { id, ...request })) finish(false)
    })
  }

  answerConfirmation(id: string, approved: boolean): void {
    this.confirmations.get(id)?.(approved)
  }

  // ---------------------------------------------------------------- plan runs

  startRun(plan: Plan, source: ControlSource): RunState {
    const run = new PlanRun(plan, {
      control: this.o.control,
      source,
      confirm: (request) => this.confirm(request),
      emit: (state) => {
        this.send('control:run-update', state)
        if (['completed', 'stopped', 'failed'].includes(state.status) && this.runs.has(state.id)) {
          this.runs.delete(state.id)
          this.finished.push(state)
          if (this.finished.length > 20) this.finished.shift()
        }
      }
    })
    this.runs.set(run.state.id, run)
    void run.start()
    return { ...run.state }
  }

  controlRun(id: string, action: RunControl): boolean {
    const run = this.runs.get(id)
    if (!run) return false
    run.control(action)
    return true
  }

  listRuns(): RunState[] {
    return [...[...this.runs.values()].map((r) => ({ ...r.state })), ...this.finished]
  }

  /** Stops every run (the window is closing). */
  stopAll(): void {
    for (const run of this.runs.values()) run.control('stop')
  }
}

export type { CommandResult }
