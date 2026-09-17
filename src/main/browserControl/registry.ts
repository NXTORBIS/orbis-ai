import type {
  BrowserCommand,
  CapabilityDescriptor,
  CommandResult,
  ConfirmationPolicy,
  ControlDomain,
  ControlError,
  ControlErrorCode,
  ControlRequirement,
  ControlSource,
  ControlTarget,
  ParamSpec
} from '../../shared/browserControl.ts'
import { redact, validateParams } from '../../shared/browserControl.ts'

/** A failure a capability reports on purpose, with a code callers can act on (retry, ask the user, stop). */
export class ControlFailure extends Error {
  readonly code: ControlErrorCode
  readonly recoverable: boolean
  constructor(code: ControlErrorCode, message: string, recoverable = false) {
    super(message)
    this.code = code
    this.recoverable = recoverable
  }
}

export const fail = (code: ControlErrorCode, message: string, recoverable = false): never => {
  throw new ControlFailure(code, message, recoverable)
}

export interface ConfirmRequest {
  capability: string
  /** What is about to happen, e.g. "Remove the extension “Dark Reader”". */
  action: string
  reason: string
  source: ControlSource
}

export interface ControlContext {
  source: ControlSource
  target?: ControlTarget
  signal?: AbortSignal
  reason?: string
  /** The caller already flagged this exact action as consequential (Orion's needs_approval). */
  flagged?: boolean
  /** Asks the user to approve; resolves true when they do. */
  confirm(request: ConfirmRequest): Promise<boolean>
  /** The layer itself, for capabilities that use others. */
  control: BrowserControl
}

export interface Assessment {
  decision: 'run' | 'confirm' | 'block'
  reason: string
}

export interface CapabilityDefinition<S = unknown> {
  id: string
  domain: ControlDomain
  name: string
  description: string
  params: Record<string, ParamSpec>
  mutates: boolean
  confirmation: ConfirmationPolicy
  requires?: ControlRequirement[]
  /** Why it can't run right now, or null when it can. Must be cheap: it is asked when listing capabilities. */
  unavailable?(ctx: Pick<ControlContext, 'source' | 'target'>): string | null
  /** What this call will do, in words, for approval prompts and the log. */
  describe?(params: Record<string, unknown>): string
  /** For "when-consequential" (and extra checks on any capability): decides whether this call runs, needs approval, or is refused. */
  assess?(params: Record<string, unknown>, ctx: ControlContext): Promise<Assessment> | Assessment
  /** Reads the relevant real state before acting, for verification. */
  observe?(params: Record<string, unknown>, ctx: ControlContext): Promise<S> | S
  run(params: Record<string, unknown>, ctx: ControlContext, before: S): Promise<unknown> | unknown
  /** Checks real state after acting. Without it, a mutating capability's run must verify on its own. */
  verify?(data: unknown, params: Record<string, unknown>, ctx: ControlContext, before: S): Promise<{ verified: boolean; detail: string }> | { verified: boolean; detail: string }
}

export type LogPhase = 'observation' | 'decision' | 'command' | 'execution' | 'result' | 'verification' | 'error' | 'recovery'

export interface ControlLogEntry {
  at: number
  phase: LogPhase
  capability: string
  source: ControlSource
  runId?: string
  detail: unknown
}

/**
 * The shape of a value without its content: what a read returned (text lengths, list sizes, field names), for the log.
 * Page text, extracted data and accessibility trees can hold anything a page shows, so reads never log content.
 */
function shape(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return `[text, ${value.length} chars]`
  if (Array.isArray(value)) return `[list of ${value.length}]`
  if (typeof value !== 'object') return typeof value
  if (depth > 1) return '[object]'
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([k, v]) => [k, shape(v, depth + 1)]))
}

/** Replaces every occurrence of the given private values (and their URL-encoded forms) in something about to be logged. */
function scrub(value: unknown, secrets: string[]): unknown {
  if (!secrets.length) return value
  if (typeof value === 'string') return secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), value)
  if (Array.isArray(value)) return value.map((v) => scrub(v, secrets))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, secrets)]))
  return value
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })

export interface BrowserControlOptions {
  /** Writes batched log lines somewhere durable (a file); called at most every couple of seconds, only when there is something new. */
  sink?(lines: string[]): Promise<void>
  now?(): number
}

/**
 * The Orbis Browser Control Layer: one registry of everything the browser can do, used alike by the Orbis window,
 * Orion's browser agent and automations. Each command is validated, checked for availability, approved when it is
 * consequential, carried out, verified against real browser state, retried when that can help, and logged.
 *
 * Nothing here polls or keeps scanning: state is read on demand, window state arrives when it changes, and the log is
 * written in batches only while there is something to write.
 */
export class BrowserControl {
  private readonly capabilities = new Map<string, CapabilityDefinition>()
  private readonly stateReaders = new Map<string, () => unknown>()
  private readonly log: ControlLogEntry[] = []
  private pending: string[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly o: BrowserControlOptions
  private readonly now: () => number
  /** Resources an automation run is changing (a tab, a page, the clipboard, settings, extensions), by run. */
  private readonly locks = new Map<string, string>()
  /** Kinds of action the person has switched off for Orion and automations. */
  private off = new Set<ControlDomain>()

  constructor(options: BrowserControlOptions = {}) {
    this.o = options
    this.now = options.now ?? Date.now
  }

  // ---------------------------------------------------------------- registration

  /** Adds (or replaces) a capability. New Orbis features register here to become controllable and discoverable. */
  register<S>(definition: CapabilityDefinition<S>): void {
    if (!/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z0-9-]*$/.test(definition.id)) throw new Error(`Invalid capability id "${definition.id}"`)
    this.capabilities.set(definition.id, definition as CapabilityDefinition)
  }

  unregister(id: string): void {
    this.capabilities.delete(id)
  }

  // ---------------------------------------------------------------- what Orion is allowed to do at all

  /**
   * Kinds of action Orion, skills and workflows may not use. A switched-off kind is shown as unavailable wherever
   * capabilities are listed, so nothing is ever planned around it, and refused if something tries anyway. The person
   * acting in Orbis themselves is never blocked by this: it decides what Orbis may do on their behalf, not what they
   * may do.
   */
  setSwitchedOff(domains: ControlDomain[]): void {
    this.off = new Set(domains)
  }

  switchedOff(): ControlDomain[] {
    return [...this.off]
  }

  isSwitchedOff(domain: ControlDomain): boolean {
    return this.off.has(domain)
  }

  /** Registers a named part of the browser state (tabs, downloads, settings...), read only when asked for. */
  registerState(name: string, reader: () => unknown): void {
    this.stateReaders.set(name, reader)
  }

  // ---------------------------------------------------------------- discovery

  private descriptor(def: CapabilityDefinition, ctx: Pick<ControlContext, 'source' | 'target'>): CapabilityDescriptor {
    let reason: string | null = this.off.has(def.domain) ? `Switched off in Settings → What Orion may do (${def.domain}).` : null
    if (reason) return { id: def.id, domain: def.domain, name: def.name, description: def.description, params: def.params, mutates: def.mutates, confirmation: def.confirmation, requires: def.requires ?? [], provider: (def as CapabilityDefinition & { provider?: 'window' }).provider ?? 'main', available: false, unavailableReason: reason }
    try {
      reason = def.unavailable?.(ctx) ?? null
    } catch (err) {
      reason = err instanceof Error ? err.message : 'Unavailable.'
    }
    return {
      id: def.id,
      domain: def.domain,
      name: def.name,
      description: def.description,
      params: def.params,
      mutates: def.mutates,
      confirmation: def.confirmation,
      requires: def.requires ?? [],
      provider: (def as CapabilityDefinition & { provider?: 'window' }).provider ?? 'main',
      available: reason === null,
      ...(reason ? { unavailableReason: reason } : {})
    }
  }

  /** What Orbis can do right now: every registered capability with its parameters, requirements and availability. */
  list(filter: { domain?: string; query?: string; availableOnly?: boolean } = {}, source: ControlSource = 'user'): CapabilityDescriptor[] {
    const words = (filter.query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)
    const scored = [...this.capabilities.values()]
      .filter((def) => !filter.domain || def.domain === filter.domain)
      .map((def) => {
        const haystack = `${def.id} ${def.name} ${def.description} ${def.domain}`.toLowerCase()
        const score = words.length ? words.filter((w) => haystack.includes(w)).length : 1
        return { def, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.def.id.localeCompare(b.def.id))
    const out = scored.map((x) => this.descriptor(x.def, { source }))
    return filter.availableOnly ? out.filter((d) => d.available) : out
  }

  describe(id: string, source: ControlSource = 'user'): CapabilityDescriptor | null {
    const def = this.capabilities.get(id)
    return def ? this.descriptor(def, { source }) : null
  }

  has(id: string): boolean {
    return this.capabilities.has(id)
  }

  // ---------------------------------------------------------------- state

  /** The real browser state, read now: all parts, or only those asked for. Each part is read with a time limit. */
  async snapshot(parts?: string[]): Promise<Record<string, unknown>> {
    const names = parts?.length ? parts.filter((p) => this.stateReaders.has(p)) : [...this.stateReaders.keys()]
    const entries = await Promise.all(
      names.map(async (name) => {
        try {
          const value = await Promise.race([
            Promise.resolve(this.stateReaders.get(name)!()),
            sleep(3000).then(() => ({ unavailable: 'timed out reading this part of the state' }))
          ])
          return [name, value] as const
        } catch (err) {
          return [name, { unavailable: err instanceof Error ? err.message : String(err) }] as const
        }
      })
    )
    return Object.fromEntries(entries)
  }

  stateParts(): string[] {
    return [...this.stateReaders.keys()]
  }

  // ---------------------------------------------------------------- execution

  /**
   * Observe → decide → act → verify. Never reports success for an action that was only sent: a mutating capability
   * either verifies against real state or its run confirmed the change itself.
   */
  async execute(command: BrowserCommand, context: Omit<ControlContext, 'control' | 'source'> & { source?: ControlSource; runId?: string }): Promise<CommandResult> {
    const started = this.now()
    const source = command.source ?? context.source ?? 'user'
    const ctx: ControlContext = { ...context, source, target: command.target ?? context.target, reason: command.reason ?? context.reason, control: this }
    const runId = context.runId
    const params = { ...(command.params ?? {}) }
    /** Values of this call's sensitive parameters, kept out of everything logged about it. */
    let secrets: string[] = []
    /** Reads log only the shape of what they returned. */
    let readOnly = true
    const finish = (partial: Omit<CommandResult, 'capability' | 'durationMs'>): CommandResult => {
      const result: CommandResult = { capability: command.capability, durationMs: this.now() - started, ...partial }
      const logged = result.ok ? { ok: true, verification: result.verification, data: readOnly ? shape(result.data) : this.summarize(result.data) } : { error: result.error, attempts: result.attempts }
      this.record(result.ok ? 'result' : 'error', command.capability, source, runId, scrub(logged, secrets))
      return result
    }
    const error = (code: ControlErrorCode, message: string, recoverable = false, attempts = 0): CommandResult => finish({ ok: false, error: { code, message, recoverable }, attempts })

    const def = this.capabilities.get(command.capability)
    if (!def) {
      const similar = this.list({ query: command.capability.replace(/[._-]/g, ' ') }).slice(0, 5).map((d) => d.id)
      return error('unknown-capability', `Orbis has no capability "${command.capability}".${similar.length ? ` Similar: ${similar.join(', ')}.` : ''}`)
    }
    if (source !== 'user' && this.off.has(def.domain)) {
      this.record('decision', def.id, source, runId, { decision: 'block', reason: 'switched off' })
      return error('blocked', `“${def.domain}” is switched off in Settings → What Orion may do, so Orbis will not do this on your behalf.`)
    }
    readOnly = !def.mutates
    const sensitive = new Set(Object.entries(def.params).filter(([, p]) => p.sensitive).map(([k]) => k))
    secrets = [...sensitive]
      .map((k) => params[k])
      .filter((v): v is string => typeof v === 'string' && v.length >= 3)
      .flatMap((v) => [v, encodeURIComponent(v), encodeURIComponent(v).replace(/%20/g, '+')])
    this.record('command', def.id, source, runId, { params: redact(params, sensitive), target: ctx.target, reason: ctx.reason })

    const invalid = validateParams(def.params, params)
    if (invalid) return error('invalid-params', invalid)
    const unavailable = def.unavailable?.(ctx) ?? null
    if (unavailable) return error('unavailable', unavailable, true)

    // Decide: the capability's own assessment, then its confirmation policy. The user acting in Orbis isn't asked again.
    let decision: Assessment = { decision: 'run', reason: '' }
    try {
      if (def.assess) decision = await def.assess(params, ctx)
    } catch (err) {
      return error('failed', err instanceof Error ? err.message : String(err))
    }
    if (decision.decision === 'block') {
      this.record('decision', def.id, source, runId, { decision: 'block', reason: decision.reason })
      return error('blocked', decision.reason)
    }
    const needsApproval = source !== 'user' && (def.confirmation === 'always' || decision.decision === 'confirm' || (ctx.flagged === true && def.mutates))
    this.record('decision', def.id, source, runId, { decision: needsApproval ? 'confirm' : 'run', reason: decision.reason || (def.confirmation === 'always' ? 'Always asks first.' : undefined) })
    if (needsApproval) {
      const action = def.describe?.(params) ?? def.name
      const approved = await ctx.confirm({ capability: def.id, action, reason: decision.reason || `${def.name} is a consequential action, so Orbis asks first.`, source }).catch(() => false)
      if (ctx.signal?.aborted) return error('aborted', 'Stopped.')
      if (!approved) return error('declined', `The user declined: ${action}.`)
    }

    // Two automation runs never change the same tab, page or shared resource at once.
    const lockKey = runId && def.mutates ? (['clipboard', 'settings', 'extensions'].includes(def.domain) ? def.domain : ctx.target?.tabId ? `tab ${ctx.target.tabId}` : ctx.target?.webContentsId !== undefined ? `page ${ctx.target.webContentsId}` : null) : null
    if (lockKey) {
      const holder = this.locks.get(lockKey)
      if (holder && holder !== runId) {
        this.record('decision', def.id, source, runId, { decision: 'block', reason: `${lockKey} is in use by run ${holder}` })
        return error('blocked', `Another automation (run ${holder.slice(0, 8)}) is controlling this ${lockKey.split(' ')[0]}. Wait for it to finish, use another tab, or stop it.`, true)
      }
      this.locks.set(lockKey, runId!)
    }

    const retry = command.retry ?? {}
    const attempts = Math.min(5, Math.max(1, Math.round(retry.attempts ?? 1)))
    const alternatives = retry.alternatives ?? []
    let last: ControlError = { code: 'failed', message: 'Did not run.', recoverable: false }
    for (let attempt = 1; attempt <= attempts + alternatives.length; attempt++) {
      if (ctx.signal?.aborted) return error('aborted', 'Stopped.', false, attempt - 1)
      const altIndex = attempt - attempts - 1
      const attemptParams = altIndex >= 0 ? { ...params, ...alternatives[altIndex] } : params
      if (attempt > 1) {
        this.record('recovery', def.id, source, runId, { attempt, after: last, using: altIndex >= 0 ? redact(alternatives[altIndex], sensitive) : 'same parameters, fresh state' })
        await sleep(retry.delayMs ?? 400, ctx.signal)
      }
      try {
        const before = def.observe ? await def.observe(attemptParams, ctx) : undefined
        if (def.observe) this.record('observation', def.id, source, runId, scrub(shape(before), secrets))
        const data = await def.run(attemptParams, ctx, before)
        this.record('execution', def.id, source, runId, { attempt })
        if (def.verify && !command.skipVerify) {
          const verification = await def.verify(data, attemptParams, ctx, before)
          this.record('verification', def.id, source, runId, scrub(verification, secrets))
          if (!verification.verified) {
            last = { code: 'verification-failed', message: verification.detail, recoverable: true }
            continue
          }
          return finish({ ok: true, data, verification, attempts: attempt })
        }
        return finish({ ok: true, data, verification: def.mutates ? { verified: true, detail: 'Confirmed by the action itself.' } : undefined, attempts: attempt })
      } catch (err) {
        if (ctx.signal?.aborted) return error('aborted', 'Stopped.', false, attempt)
        last =
          err instanceof ControlFailure
            ? { code: err.code, message: err.message, recoverable: err.recoverable }
            : { code: /timed out/i.test(String((err as Error)?.message)) ? 'timeout' : 'failed', message: err instanceof Error ? err.message : String(err), recoverable: true }
        if (!last.recoverable && altIndex < 0 && alternatives.length === 0) break
      }
    }
    return finish({ ok: false, error: last, attempts: attempts + alternatives.length })
  }

  /** Releases everything a run held (it ended, however it ended). */
  releaseRun(runId: string): void {
    for (const [key, holder] of this.locks) if (holder === runId) this.locks.delete(key)
  }

  /** Resources held right now, and by which run. */
  heldLocks(): Record<string, string> {
    return Object.fromEntries(this.locks)
  }

  // ---------------------------------------------------------------- log

  private summarize(value: unknown): unknown {
    return redact(value)
  }

  private record(phase: LogPhase, capability: string, source: ControlSource, runId: string | undefined, detail: unknown): void {
    const entry: ControlLogEntry = { at: this.now(), phase, capability, source, ...(runId ? { runId } : {}), detail }
    this.log.push(entry)
    if (this.log.length > 600) this.log.splice(0, this.log.length - 500)
    if (!this.o.sink) return
    this.pending.push(JSON.stringify(entry))
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), 2000)
  }

  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    if (!this.pending.length || !this.o.sink) return
    const lines = this.pending
    this.pending = []
    await this.o.sink(lines).catch(() => undefined)
  }

  /** Recent structured log entries (already redacted), newest last. */
  recentLog(limit = 100, filter: { capability?: string; runId?: string } = {}): ControlLogEntry[] {
    return this.log.filter((e) => (!filter.capability || e.capability === filter.capability) && (!filter.runId || e.runId === filter.runId)).slice(-limit)
  }
}
