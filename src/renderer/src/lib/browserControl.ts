import { useEffect, useRef } from 'react'
import type { CapabilityDescriptor, ConfirmationPolicy, ControlDomain, ControlErrorCode, ControlRequirement, ControlSource, ControlTarget, ParamSpec, WindowBrowserState, WindowRunResult } from '../../../shared/browserControl'

/**
 * The Orbis window's side of the Browser Control Layer. Parts of the window that own browser state (the browser panel,
 * the address bar, the app shell) register what they can do with the same functions their own buttons call, and report
 * their state when it changes. Nothing here runs on a timer: handlers only run when a command arrives, and state is
 * sent (briefly batched) only after something changed.
 */

export interface WindowCapability {
  id: string
  domain: ControlDomain
  name: string
  description: string
  params: Record<string, ParamSpec>
  mutates: boolean
  confirmation?: ConfirmationPolicy
  requires?: ControlRequirement[]
  run(params: Record<string, unknown>, context: { target: ControlTarget | null; source: ControlSource }): Promise<WindowRunResult> | WindowRunResult
}

const handlers = new Map<string, { run: WindowCapability['run']; mutates: boolean }>()
let listening = false

function listen(): void {
  if (listening) return
  listening = true
  window.api.onControlWindowRun(({ callId, capability, params, target, source }) => {
    const handler = handlers.get(capability)
    if (!handler) return window.api.answerControlWindowRun(callId, failure('unavailable', 'That part of Orbis is not open right now.', true))
    const sentBefore = reportsSent
    Promise.resolve()
      .then(() => handler.run(params ?? {}, { target, source }))
      .then(
        async (result) => {
          // The state a command changed reaches the main process before its result, so whoever reads the browser
          // state next sees the change.
          if (handler.mutates) await stateSettled(sentBefore)
          window.api.answerControlWindowRun(callId, result)
        },
        (err: unknown) => window.api.answerControlWindowRun(callId, failure('failed', err instanceof Error ? err.message : String(err), true))
      )
  })
}

/** The next task: a message-channel tick, which (unlike timers) isn't throttled while the window is in the background. */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })

/**
 * Waits (briefly) until the command's change has been reported: React commits it and its effects queue a state
 * report, which is then sent straight away. Ends as soon as a report is pending or has gone out.
 */
async function stateSettled(sentBefore: number): Promise<void> {
  const started = performance.now()
  while (!timer && reportsSent === sentBefore && performance.now() - started < 150) await nextTask()
  flushControlState()
}

/** Sends a waiting state report now. */
export function flushControlState(): void {
  if (!timer) return
  window.clearTimeout(timer)
  timer = 0
  reportsSent++
  window.api.reportControlState({ ...state, updatedAt: Date.now() })
}

/** Registers a part of the window's capabilities while it is mounted; handlers always see its latest state. */
export function useControlScope(scope: string, capabilities: WindowCapability[]): void {
  const latest = useRef(capabilities)
  latest.current = capabilities
  const key = capabilities.map((c) => c.id).join(',')
  useEffect(() => {
    listen()
    const ids = latest.current.map((c) => c.id)
    for (const capability of latest.current) handlers.set(capability.id, { mutates: capability.mutates, run: (params, context) => latest.current.find((c) => c.id === capability.id)!.run(params, context) })
    const descriptors: CapabilityDescriptor[] = latest.current.map(({ run: _run, ...d }) => ({ ...d, confirmation: d.confirmation ?? 'none', requires: d.requires ?? [], provider: 'window', available: true }))
    window.api.setControlScope(scope, descriptors)
    return () => {
      for (const id of ids) handlers.delete(id)
      window.api.setControlScope(scope, [])
    }
  }, [scope, key])
}

const state: WindowBrowserState = {
  open: false,
  hidden: false,
  mode: null,
  tabs: [],
  groups: [],
  activeTabId: null,
  previousTabId: null,
  closedTabs: [],
  split: null,
  find: { open: false, text: '', activeMatch: 0, matches: 0 },
  addressBar: { value: '', editing: false, focused: false, suggestions: [] },
  panel: null,
  permissionRequests: [],
  updatedAt: 0
}
let timer = 0
/** How many state reports have gone to the main process. */
let reportsSent = 0

/** Merges one part of the window's browser state and sends the whole state shortly after (changes are batched). */
export function reportControlState(part: Partial<WindowBrowserState>): void {
  Object.assign(state, part)
  if (timer) return
  timer = window.setTimeout(() => {
    timer = 0
    reportsSent++
    window.api.reportControlState({ ...state, updatedAt: Date.now() })
  }, 50)
}

export const verified = (detail: string, data?: unknown): WindowRunResult => ({ ok: true, data, verification: { verified: true, detail } })
export const unverified = (detail: string, data?: unknown): WindowRunResult => ({ ok: true, data, verification: { verified: false, detail } })
export const readResult = (data: unknown): WindowRunResult => ({ ok: true, data })
export const failure = (code: ControlErrorCode, message: string, recoverable = false): WindowRunResult => ({ ok: false, error: { code, message, recoverable } })

const renderWaiters = new Set<() => void>()

/** Called after the window commits a render: commands waiting for a change check again straight away. */
export function controlRendered(): void {
  for (const wake of [...renderWaiters]) wake()
}

/** Lets a component tell waiting commands each time it renders. */
export function useControlRendered(): void {
  useEffect(() => controlRendered())
}

/**
 * Resolves true once a condition on the window's state holds, or false when time runs out. It re-checks whenever the
 * window renders (so it answers as soon as the change lands, even with the window in the background), with a slow
 * re-check for changes that don't render. Only used while a command is running.
 */
export function waitUntil(check: () => boolean, ms = 2000): Promise<boolean> {
  if (check()) return Promise.resolve(true)
  return new Promise((resolve) => {
    let done = false
    const finish = (value: boolean): void => {
      if (done) return
      done = true
      renderWaiters.delete(wake)
      window.clearTimeout(timeout)
      window.clearInterval(poll)
      resolve(value)
    }
    const wake = (): void => {
      if (check()) finish(true)
    }
    renderWaiters.add(wake)
    const poll = window.setInterval(wake, 100)
    const timeout = window.setTimeout(() => finish(check()), ms)
  })
}

export const str = (description: string, required = false, extra: Partial<ParamSpec> = {}): ParamSpec => ({ type: 'string', description, required, ...extra })
export const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })
export const int = (description: string, required = false): ParamSpec => ({ type: 'integer', description, required })
export const num = (description: string, required = false): ParamSpec => ({ type: 'number', description, required })
