import type { ActionStep, CommandResult, Condition, ControlError, ControlSource, Plan, PlanStep, RunControl, RunState, StepRecord } from '../../shared/browserControl.ts'
import { interpolate, readPath, redact } from '../../shared/browserControl.ts'
import { applyTransforms } from '../../shared/workflows.ts'
import type { BrowserControl, ConfirmRequest } from './registry.ts'

/** A question for Orion during a run, with the real context it may use. */
export interface AskRequest {
  prompt: string
  expects: 'decision' | 'value' | 'boolean' | 'json'
  choices?: string[]
  context: Record<string, unknown>
}

/** Orion's structured answer; never free text that could trigger actions by itself. */
export interface AskResult {
  decision?: string
  value?: unknown
  confidence: number
  reasoning?: string
}

export interface PlanRunOptions {
  control: BrowserControl
  source: ControlSource
  confirm(request: ConfirmRequest): Promise<boolean>
  /** Every change to the run's state (status, step, iteration, variables). */
  emit(state: RunState): void
  id?: string
  /** Asks Orion (for "ask" steps). */
  ask?(request: AskRequest, signal: AbortSignal): Promise<AskResult>
  /** The plan of another workflow (for "call" steps), or null when it doesn't exist. */
  resolveCall?(workflowId: string): Promise<Plan | null>
  /** Each finished step, for execution history. */
  onStep?(record: StepRecord): void
  /** After each top-level step: where to resume, and the variables that are safe to keep. */
  checkpoint?(checkpoint: { runId: string; nextTopIndex: number; variables: Record<string, unknown> }): void
  /** Start at this top-level step (resuming from a checkpoint). */
  resumeFrom?: number
  /** Pause before every action (step through with "step", run on with "resume"). */
  debug?: boolean
}

class Stop extends Error {}
class StepFailure extends Error {
  readonly error: ControlError
  constructor(error: ControlError) {
    super(error.message)
    this.error = error
  }
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })

const isAction = (step: PlanStep): step is ActionStep => 'do' in step
const SECRET_NAME = /pass(word)?|secret|token|otp|api.?key|cookie|auth|card|cvv/i
const MAX_CALL_DEPTH = 8

/**
 * Carries out a plan through the Browser Control Layer: action steps with variables passed between them, conditions
 * answered from the real browser, repetition (N times, until, while, for each, forever), waiting, data transforms,
 * Orion decisions, calls to other workflows, pauses for the user, confirmations, and structured failure handling.
 * It can be paused, resumed, stopped, stepped through, told to skip or restart the current step, or to stop after the
 * current iteration, at any time. Every step leaves a record; every top-level step leaves a checkpoint.
 */
export class PlanRun {
  readonly state: RunState
  private readonly plan: Plan
  private readonly o: PlanRunOptions
  private readonly variables: Record<string, unknown>
  private readonly sensitive: Set<string>
  private readonly runAbort = new AbortController()
  private stepAbort: AbortController | null = null
  private paused = false
  private resumeWaiters: (() => void)[] = []
  private stopAfterIteration = false
  /** In debug mode, how many actions may run before pausing again (null: run freely). */
  private stepBudget: number | null
  private callDepth = 0
  private iteration: number | undefined

  constructor(plan: Plan, options: PlanRunOptions) {
    this.plan = plan
    this.o = options
    this.variables = { ...(plan.variables ?? {}) }
    this.sensitive = new Set(plan.sensitiveVariables ?? [])
    for (const output of plan.outputs ?? []) if (output.sensitive) this.sensitive.add(output.from.split('.')[0])
    this.stepBudget = options.debug ? 0 : null
    this.state = { id: options.id ?? crypto.randomUUID(), name: plan.name, source: options.source, status: 'running', variables: {}, startedAt: Date.now(), stepsRun: 0, stepIndex: options.resumeFrom ?? 0, stepCount: plan.steps.length }
  }

  private publish(patch: Partial<RunState> = {}): void {
    Object.assign(this.state, patch, { variables: redact(this.variables, this.sensitive) as Record<string, unknown> })
    this.o.emit({ ...this.state })
  }

  private record(record: Omit<StepRecord, 'runId'>): void {
    this.o.onStep?.({ runId: this.state.id, ...(this.iteration !== undefined ? { iteration: this.iteration } : {}), ...record })
  }

  /** Variables safe to keep in a checkpoint: nothing sensitive or secret-looking. */
  private safeVariables(): Record<string, unknown> {
    return Object.fromEntries(Object.entries(this.variables).filter(([name]) => !this.sensitive.has(name) && !SECRET_NAME.test(name)))
  }

  /** The run's outputs, read from its variables (unredacted: for the engine and calling workflows). */
  outputs(): Record<string, unknown> {
    return Object.fromEntries((this.plan.outputs ?? []).map((o) => [o.name, readPath(this.variables, o.from)]))
  }

  /** Pause, resume, stop, step, skip the current step, restart it, or stop once the current iteration ends. */
  control(action: RunControl): void {
    if (['stopped', 'completed', 'failed'].includes(this.state.status)) return
    switch (action) {
      case 'pause':
        this.paused = true
        this.publish({ status: 'paused' })
        return
      case 'resume':
      case 'step':
        if (this.o.debug) this.stepBudget = action === 'step' ? 1 : null
        this.paused = false
        this.publish({ status: 'running', error: undefined, waitingFor: undefined })
        for (const wake of this.resumeWaiters.splice(0)) wake()
        return
      case 'stop':
        this.publish({ status: 'stopping' })
        this.runAbort.abort('stop')
        this.stepAbort?.abort('stop')
        for (const wake of this.resumeWaiters.splice(0)) wake()
        return
      case 'skip':
      case 'restart-step':
        this.stepAbort?.abort(action)
        return
      case 'stop-after-iteration':
        this.stopAfterIteration = true
        return
    }
  }

  /** Waits while paused; throws Stop once the run has been stopped. */
  private async gate(): Promise<void> {
    while (this.paused && !this.runAbort.signal.aborted) await new Promise<void>((resolve) => this.resumeWaiters.push(resolve))
    if (this.runAbort.signal.aborted) throw new Stop()
  }

  async start(): Promise<RunState> {
    this.publish()
    try {
      const steps = this.plan.steps
      for (let i = this.o.resumeFrom ?? 0; i < steps.length; i++) {
        await this.runSteps([steps[i]], '', i)
        this.publish({ stepIndex: i + 1 })
        this.o.checkpoint?.({ runId: this.state.id, nextTopIndex: i + 1, variables: this.safeVariables() })
      }
      this.publish({ status: this.runAbort.signal.aborted ? 'stopped' : 'completed', currentStep: undefined, currentAction: undefined, waitingFor: undefined, finishedAt: Date.now(), outputs: redact(this.outputs(), new Set((this.plan.outputs ?? []).filter((o) => o.sensitive).map((o) => o.name))) as Record<string, unknown> })
    } catch (err) {
      if (err instanceof Stop) this.publish({ status: 'stopped', waitingFor: undefined, finishedAt: Date.now() })
      else {
        const error = err instanceof StepFailure ? err.error : { code: 'failed' as const, message: err instanceof Error ? err.message : String(err), recoverable: false }
        this.publish({ status: 'failed', error, waitingFor: undefined, finishedAt: Date.now() })
      }
    } finally {
      this.o.control.releaseRun(this.state.id)
    }
    return { ...this.state }
  }

  private async runSteps(steps: PlanStep[], path: string, offset = 0): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      await this.gate()
      const step = steps[i]
      const here = `${path}${path ? ' › ' : ''}${step.label ?? step.id ?? offset + i + 1}`
      const started = Date.now()
      const base = { path: here, stepId: step.id, label: step.label }
      if (step.enabled === false) {
        this.record({ ...base, kind: kindOf(step), status: 'skipped', startedAt: started, durationMs: 0 })
        continue
      }
      if (isAction(step)) await this.runAction(step, here)
      else if ('if' in step) {
        const yes = await this.evaluate(step.if)
        this.record({ ...base, kind: 'if', status: 'success', startedAt: started, durationMs: Date.now() - started, summary: { branch: yes ? 'then' : 'else' } })
        await this.runSteps(yes ? step.then : (step.else ?? []), `${here} › ${yes ? 'then' : 'else'}`)
      } else if ('repeat' in step) {
        await this.runRepeat(step, here)
        this.record({ ...base, kind: 'repeat', status: 'success', startedAt: started, durationMs: Date.now() - started })
      } else if ('set' in step) {
        for (const [name, value] of Object.entries(step.set)) {
          this.variables[name] = interpolate(value, this.variables)
          if (step.sensitive) this.sensitive.add(name)
        }
        this.publish({ currentStep: here })
        this.record({ ...base, kind: 'set', status: 'success', startedAt: started, durationMs: Date.now() - started, summary: redact(Object.keys(step.set)) })
      } else if ('wait' in step) {
        await this.runWait(step.wait, here)
        this.record({ ...base, kind: 'wait', status: 'success', startedAt: started, durationMs: Date.now() - started })
      } else if ('transform' in step) await this.runTransform(step, here)
      else if ('ask' in step) await this.runAsk(step, here)
      else if ('call' in step) await this.runCall(step, here)
      else if ('userAction' in step) await this.runUserAction(step, here)
      else if ('confirm' in step) await this.runConfirm(step, here)
    }
  }

  private async runAction(step: ActionStep, here: string): Promise<void> {
    for (;;) {
      await this.gate()
      if (this.o.debug && this.stepBudget === 0) {
        this.paused = true
        this.publish({ status: 'paused', currentStep: here, currentAction: step.do, waitingFor: { kind: 'debugger', message: `Paused before “${step.label ?? step.do}”.` } })
        await this.gate()
      }
      this.stepAbort = new AbortController()
      const signal = AbortSignal.any([this.runAbort.signal, this.stepAbort.signal])
      const params = interpolate(step.params ?? {}, this.variables) as Record<string, unknown>
      const target = step.target ? (interpolate(step.target, this.variables) as ActionStep['target']) : undefined
      this.publish({ currentStep: here, currentAction: step.do })
      const started = Date.now()
      const timer = step.timeoutMs ? setTimeout(() => this.stepAbort?.abort('timeout'), step.timeoutMs) : null
      const result: CommandResult = await this.o.control.execute(
        { capability: step.do, params, target, retry: step.retry, source: this.o.source },
        {
          source: this.o.source,
          signal,
          runId: this.state.id,
          confirm: async (request) => {
            this.publish({ status: 'waiting-confirmation', waitingFor: { kind: 'confirmation', message: request.action } })
            try {
              return await this.o.confirm(request)
            } finally {
              if (this.state.status === 'waiting-confirmation') this.publish({ status: this.paused ? 'paused' : 'running', waitingFor: undefined })
            }
          }
        }
      )
      if (timer) clearTimeout(timer)
      const reason = this.stepAbort.signal.reason
      this.stepAbort = null
      if (this.runAbort.signal.aborted) {
        this.record({ path: here, stepId: step.id, label: step.label, kind: 'action', action: step.do, status: 'cancelled', startedAt: started, durationMs: Date.now() - started })
        throw new Stop()
      }
      if (reason === 'restart-step') continue
      if (reason === 'skip') {
        this.record({ path: here, stepId: step.id, label: step.label, kind: 'action', action: step.do, status: 'skipped', startedAt: started, durationMs: Date.now() - started })
        this.publish({ lastResult: { ...result, ok: false, error: { code: 'aborted', message: 'Skipped.', recoverable: true } } })
        return
      }
      if (this.o.debug && this.stepBudget !== null) this.stepBudget = Math.max(0, this.stepBudget - 1)
      this.state.stepsRun++
      let outcome = result
      if (reason === 'timeout') outcome = { ...result, ok: false, error: { code: 'timeout', message: `“${step.label ?? step.do}” took longer than ${Math.round((step.timeoutMs ?? 0) / 1000)}s.`, recoverable: true } }
      else if (result.ok && step.expect && !(await this.evaluate(step.expect))) {
        outcome = { ...result, ok: false, error: { code: 'verification-failed', message: `After ${step.do}, the expected state wasn't there.`, recoverable: true } }
      }
      this.record({
        path: here,
        stepId: step.id,
        label: step.label,
        kind: 'action',
        action: step.do,
        status: outcome.ok ? 'success' : 'failed',
        startedAt: started,
        durationMs: Date.now() - started,
        attempts: outcome.attempts,
        error: outcome.error,
        verification: outcome.verification,
        summary: outcome.ok ? redact(outcome.data, this.sensitive) : undefined
      })
      this.publish({ lastResult: { ...outcome, data: redact(outcome.data, this.sensitive) } })
      if (outcome.ok) {
        if (step.saveAs) this.variables[step.saveAs] = outcome.data
        return
      }
      if (step.optional) return
      // A critical step failed: never carry on as if it worked.
      if (this.plan.onFailure === 'pause' && outcome.error?.code !== 'declined' && outcome.error?.code !== 'blocked') {
        this.paused = true
        this.publish({ status: 'paused', error: outcome.error, waitingFor: { kind: 'user', message: `“${step.label ?? step.do}” failed: ${outcome.error?.message}. Fix it and resume to try again, skip it, or stop.` } })
        await this.gate()
        continue
      }
      throw new StepFailure(outcome.error ?? { code: 'failed', message: `${step.do} failed.`, recoverable: false })
    }
  }

  private async runRepeat(step: Extract<PlanStep, { repeat: unknown }>, here: string): Promise<void> {
    const r = step.repeat
    const as = r.as ?? 'item'
    let items: unknown[] | null = null
    if (r.forEach !== undefined) {
      const resolved = interpolate(r.forEach, this.variables)
      if (!Array.isArray(resolved)) throw new StepFailure({ code: 'invalid-params', message: `forEach needs a list; ${JSON.stringify(r.forEach)} isn't one.`, recoverable: false })
      items = resolved
    }
    const times = r.times === undefined ? null : Number(interpolate(r.times, this.variables))
    if (times !== null && (!Number.isFinite(times) || times < 0)) throw new StepFailure({ code: 'invalid-params', message: 'repeat.times must be a number.', recoverable: false })
    const limit = items ? items.length : times !== null ? Math.min(times, 100_000) : r.forever ? Number.MAX_SAFE_INTEGER : Math.min(r.max ?? 1000, 100_000)
    const total = items ? items.length : times !== null ? times : undefined
    const outer = this.iteration
    try {
      for (let index = 0; index < limit; index++) {
        await this.gate()
        if (r.while && !(await this.evaluate(r.while))) break
        this.variables.index = index
        if (items) this.variables[as] = items[index]
        this.iteration = index + 1
        this.publish({ iteration: index + 1, totalIterations: total, currentStep: `${here} › ${index + 1}` })
        await this.runSteps(step.steps, `${here} › ${index + 1}`)
        if (this.stopAfterIteration) {
          this.runAbort.abort('stop')
          throw new Stop()
        }
        if (r.until && (await this.evaluate(r.until))) break
      }
    } finally {
      this.iteration = outer
    }
  }

  private async runWait(wait: { ms?: number; until?: Condition; timeoutMs?: number; pollMs?: number }, here: string): Promise<void> {
    this.publish({ currentStep: here, currentAction: 'wait' })
    if (!wait.until) return sleep(Math.min(Math.max(0, wait.ms ?? 1000), 3_600_000), this.runAbort.signal)
    const deadline = Date.now() + Math.min(wait.timeoutMs ?? 30_000, 3_600_000)
    while (Date.now() < deadline) {
      await this.gate()
      if (await this.evaluate(wait.until)) return
      await sleep(Math.max(100, wait.pollMs ?? 500), this.runAbort.signal)
    }
    throw new StepFailure({ code: 'timeout', message: `Waited ${Math.round((wait.timeoutMs ?? 30_000) / 1000)}s and the condition never became true.`, recoverable: true })
  }

  private async runTransform(step: Extract<PlanStep, { transform: unknown }>, here: string): Promise<void> {
    const started = Date.now()
    this.publish({ currentStep: here, currentAction: 'transform' })
    try {
      this.variables[step.transform.saveAs] = applyTransforms(interpolate(step.transform.input, this.variables), interpolate(step.transform.operations, this.variables) as typeof step.transform.operations)
    } catch (err) {
      const error: ControlError = { code: 'invalid-params', message: err instanceof Error ? err.message : String(err), recoverable: false }
      this.record({ path: here, stepId: step.id, label: step.label, kind: 'transform', status: 'failed', startedAt: started, durationMs: Date.now() - started, error })
      throw new StepFailure(error)
    }
    this.record({ path: here, stepId: step.id, label: step.label, kind: 'transform', status: 'success', startedAt: started, durationMs: Date.now() - started, summary: redact({ [step.transform.saveAs]: this.variables[step.transform.saveAs] }, this.sensitive) })
  }

  private async runAsk(step: Extract<PlanStep, { ask: unknown }>, here: string): Promise<void> {
    const started = Date.now()
    const a = step.ask
    const fail = (error: ControlError): never => {
      this.record({ path: here, stepId: step.id, label: step.label, kind: 'ask', status: 'failed', startedAt: started, durationMs: Date.now() - started, error })
      throw new StepFailure(error)
    }
    if (!this.o.ask) fail({ code: 'unavailable', message: 'Orion is not available to this run.', recoverable: false })
    this.publish({ currentStep: here, currentAction: 'Asking Orion' })
    const context: Record<string, unknown> = {}
    const ctx = { source: this.o.source, signal: this.runAbort.signal, runId: this.state.id, confirm: this.o.confirm }
    if (a.include.some((i) => i === 'pageText' || i === 'url' || i === 'title')) {
      const read = await this.o.control.execute({ capability: 'page.read', params: { maxChars: 12_000 }, source: this.o.source }, ctx)
      if (read.ok) {
        const page = read.data as { url: string; title: string; text: string }
        context.page = { ...(a.include.includes('url') ? { url: page.url } : {}), ...(a.include.includes('title') ? { title: page.title } : {}), ...(a.include.includes('pageText') ? { text: page.text } : {}) }
      }
    }
    if (a.include.includes('selection') && this.o.control.has('page.selection')) {
      const selection = await this.o.control.execute({ capability: 'page.selection', params: {}, source: this.o.source }, ctx)
      if (selection.ok) context.selection = selection.data
    }
    if (a.include.includes('variables')) context.variables = redact(this.variables, this.sensitive)
    let answer: AskResult
    try {
      answer = await this.o.ask!({ prompt: String(interpolate(a.prompt, this.variables)), expects: a.expects, choices: a.choices, context }, this.runAbort.signal)
    } catch (err) {
      if (this.runAbort.signal.aborted) throw new Stop()
      return fail({ code: 'failed', message: `Orion couldn't answer: ${err instanceof Error ? err.message : String(err)}`, recoverable: true })
    }
    if (a.expects === 'decision' && (!answer.decision || !(a.choices ?? []).includes(answer.decision))) {
      fail({ code: 'failed', message: `Orion's answer (${JSON.stringify(answer.decision)}) isn't one of the choices.`, recoverable: true })
    }
    if (a.minConfidence !== undefined && answer.confidence < a.minConfidence) {
      this.paused = true
      this.publish({ status: 'waiting-user', waitingFor: { kind: 'user', message: `Orion is only ${Math.round(answer.confidence * 100)}% sure: ${JSON.stringify(answer.decision ?? answer.value)}. Resume to accept it, or stop.` } })
      await this.gate()
    }
    this.variables[a.saveAs] = answer
    this.record({ path: here, stepId: step.id, label: step.label, kind: 'ask', status: 'success', startedAt: started, durationMs: Date.now() - started, summary: redact(answer, this.sensitive) })
  }

  private async runCall(step: Extract<PlanStep, { call: unknown }>, here: string): Promise<void> {
    const started = Date.now()
    const fail = (error: ControlError): never => {
      this.record({ path: here, stepId: step.id, label: step.label, kind: 'call', status: 'failed', startedAt: started, durationMs: Date.now() - started, error })
      throw new StepFailure(error)
    }
    if (!this.o.resolveCall) fail({ code: 'unavailable', message: 'This run cannot call other workflows.', recoverable: false })
    if (this.callDepth >= MAX_CALL_DEPTH) fail({ code: 'blocked', message: 'Workflows call each other too deeply (a loop of calls?).', recoverable: false })
    const plan = await this.o.resolveCall!(step.call.workflowId)
    if (!plan) return fail({ code: 'not-found', message: `The called workflow (${step.call.workflowId}) doesn't exist.`, recoverable: false })
    const inputs = interpolate(step.call.inputs, this.variables) as Record<string, unknown>
    // The called workflow runs with its own variables, and returns only its outputs.
    const saved = { ...this.variables }
    for (const key of Object.keys(this.variables)) delete this.variables[key]
    Object.assign(this.variables, plan.variables ?? {}, inputs)
    this.callDepth++
    let outputs: Record<string, unknown> = {}
    try {
      await this.runSteps(plan.steps, `${here} › ${plan.name}`)
      outputs = Object.fromEntries((plan.outputs ?? []).map((o) => [o.name, readPath(this.variables, o.from)]))
      for (const o of plan.outputs ?? []) if (o.sensitive && step.call.saveAs) this.sensitive.add(step.call.saveAs)
    } finally {
      this.callDepth--
      for (const key of Object.keys(this.variables)) delete this.variables[key]
      Object.assign(this.variables, saved)
    }
    if (step.call.saveAs) this.variables[step.call.saveAs] = outputs
    this.record({ path: here, stepId: step.id, label: step.label, kind: 'call', status: 'success', startedAt: started, durationMs: Date.now() - started, summary: redact(outputs, this.sensitive) })
  }

  private async runUserAction(step: Extract<PlanStep, { userAction: unknown }>, here: string): Promise<void> {
    const started = Date.now()
    const message = String(interpolate(step.userAction.message, this.variables))
    for (let attempt = 0; ; attempt++) {
      this.paused = true
      this.publish({ status: 'waiting-user', currentStep: here, currentAction: 'Waiting for you', waitingFor: { kind: 'user', message: attempt ? `${message} (Orbis checked: it isn't done yet.)` : message } })
      await this.gate()
      // The user may have changed anything meanwhile: the expected state is observed again, never assumed.
      if (!step.userAction.until || (await this.evaluate(step.userAction.until))) break
    }
    this.record({ path: here, stepId: step.id, label: step.label, kind: 'userAction', status: 'success', startedAt: started, durationMs: Date.now() - started })
  }

  private async runConfirm(step: Extract<PlanStep, { confirm: unknown }>, here: string): Promise<void> {
    const started = Date.now()
    const message = String(interpolate(step.confirm.message, this.variables))
    this.publish({ status: 'waiting-confirmation', currentStep: here, waitingFor: { kind: 'confirmation', message } })
    const approved = await this.o.confirm({ capability: 'workflow.confirm', action: message, reason: 'The workflow asks you before it continues.', source: this.o.source }).catch(() => false)
    if (this.runAbort.signal.aborted) throw new Stop()
    this.publish({ status: this.paused ? 'paused' : 'running', waitingFor: undefined })
    if (!approved) {
      const error: ControlError = { code: 'declined', message: `You declined: ${message}`, recoverable: false }
      this.record({ path: here, stepId: step.id, label: step.label, kind: 'confirm', status: 'failed', startedAt: started, durationMs: Date.now() - started, error })
      throw new StepFailure(error)
    }
    this.record({ path: here, stepId: step.id, label: step.label, kind: 'confirm', status: 'success', startedAt: started, durationMs: Date.now() - started })
  }

  /** Variables are checked here; everything about the browser is asked of the control layer, from real state. */
  async evaluate(condition: Condition): Promise<boolean> {
    if ('all' in condition) {
      for (const c of (condition as { all: Condition[] }).all) if (!(await this.evaluate(c))) return false
      return true
    }
    if ('any' in condition) {
      for (const c of (condition as { any: Condition[] }).any) if (await this.evaluate(c)) return true
      return false
    }
    if ('not' in condition) return !(await this.evaluate((condition as { not: Condition }).not))
    const resolved = interpolate(condition, this.variables) as Record<string, unknown>
    if (resolved.check === 'variableExists') {
      const value = readPath(this.variables, String(condition.name ?? ''))
      return value !== undefined && value !== null && value !== ''
    }
    if (resolved.check === 'compare') return compare(resolved.left, String(resolved.op ?? '=='), resolved.right)
    const result = await this.o.control.execute({ capability: 'state.check', params: { condition: resolved }, source: this.o.source }, { source: this.o.source, signal: this.runAbort.signal, runId: this.state.id, confirm: this.o.confirm })
    if (!result.ok) throw new StepFailure(result.error ?? { code: 'failed', message: 'The condition could not be checked.', recoverable: true })
    return (result.data as { value?: boolean })?.value === true
  }
}

function kindOf(step: PlanStep): StepRecord['kind'] {
  if ('do' in step) return 'action'
  if ('if' in step) return 'if'
  if ('repeat' in step) return 'repeat'
  if ('set' in step) return 'set'
  if ('wait' in step) return 'wait'
  if ('transform' in step) return 'transform'
  if ('ask' in step) return 'ask'
  if ('call' in step) return 'call'
  if ('userAction' in step) return 'userAction'
  return 'confirm'
}

export function compare(left: unknown, op: string, right: unknown): boolean {
  const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v))
  switch (op) {
    case '==':
      return typeof left === 'object' || typeof right === 'object' ? JSON.stringify(left) === JSON.stringify(right) : String(left) === String(right)
    case '!=':
      return !compare(left, '==', right)
    case '>':
      return num(left) > num(right)
    case '>=':
      return num(left) >= num(right)
    case '<':
      return num(left) < num(right)
    case '<=':
      return num(left) <= num(right)
    case 'contains':
      return Array.isArray(left) ? left.some((x) => compare(x, '==', right)) : String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase())
    case 'matches':
      try {
        return new RegExp(String(right), 'i').test(String(left ?? ''))
      } catch {
        return false
      }
    default:
      return false
  }
}
