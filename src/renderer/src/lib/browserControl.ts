import { useEffect, useRef } from 'react'
import type { CapabilityDescriptor, ConfirmationPolicy, ControlDomain, ControlErrorCode, ControlRequirement, ControlSource, ControlTarget, ParamSpec, WindowRunResult } from '../../../shared/browserControl'

/**
 * The Orbis window's side of the Browser Control Layer. Parts of the window that own something (the address bar) register
 * what they can do with the same functions their own buttons call. The browser itself is Chromium, whose tabs and pages the main
 * process reads from the browser directly. Nothing here runs on a timer: handlers only run when a command arrives.
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
    Promise.resolve()
      .then(() => handler.run(params ?? {}, { target, source }))
      .then(
        async (result) => {
          // Let React commit what the command changed, so whoever reads the window next sees it.
          if (handler.mutates) await nextTask()
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
