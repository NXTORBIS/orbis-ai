import { missedRun } from '../../shared/schedulePhrase.ts'
import type { RunControl, RunState, StepRecord, WindowBrowserState } from '../../shared/browserControl'
import type { ActiveWorkflowRun, Workflow, WorkflowIssue, WorkflowRunSummary, WorkflowStats } from '../../shared/workflows'
import { exportWorkflow, importWorkflow, newWorkflow, nextScheduledRun, validateWorkflow, workflowStats } from '../../shared/workflows'
import { compileWorkflow, describeWorkflow } from '../../shared/workflowCompile'
import type { PlanLine } from '../../shared/workflowCompile'
import { PlanRun } from '../browserControl/runner'
import type { AskRequest, AskResult } from '../browserControl/runner'
import type { BrowserControl } from '../browserControl/registry'
import type { WindowControl } from '../browserControl/window'
import type { BrowserLibrary } from '../browserLibrary'
import type { WorkflowCheckpoint, WorkflowStore, WorkflowVersion } from './store'

export type RunTrigger = WorkflowRunSummary['trigger']
export type { ActiveWorkflowRun }

export class WorkflowValidationError extends Error {
  readonly issues: WorkflowIssue[]
  constructor(issues: WorkflowIssue[]) {
    super(issues.map((i) => (i.path ? `Step ${i.path}: ${i.message}` : i.message)).join('\n'))
    this.issues = issues
  }
}

export interface WorkflowEngineOptions {
  control: BrowserControl
  windowControl: WindowControl
  store: WorkflowStore
  library: BrowserLibrary
  ask(request: AskRequest, signal: AbortSignal): Promise<AskResult>
  /** Sends an update to the Orbis window. */
  send(channel: string, ...args: unknown[]): void
  /** Tells the person, outside the window, that something they scheduled or set to run has finished. */
  notify?(title: string, body: string): void
}

const MAX_TIMER = 2 ** 31 - 1
const SECRET_NAME = /pass(word)?|secret|token|otp|api.?key|cookie|auth|card|cvv/i

/**
 * The Orbis Workflow Engine: stores and versions workflows, validates them before they run, carries them out through
 * the Browser Control Layer (never around it), records every run, keeps checkpoints so an interrupted run can be
 * resumed on request, runs schedules while Orbis is open, and starts workflows from browser events. Nothing runs in the
 * background unless a workflow is running, scheduled or waiting for an event it asked for.
 */
export class WorkflowEngine {
  private readonly o: WorkflowEngineOptions
  private readonly active = new Map<string, { run: PlanRun; info: ActiveWorkflowRun; records: StepRecord[]; timer: NodeJS.Timeout | null; timedOut: boolean }>()
  private scheduleTimer: NodeJS.Timeout | null = null
  private readonly nextRuns = new Map<string, number>()
  private stops: (() => void)[] = []
  private lastState: WindowBrowserState | null = null
  private completedDownloads = new Set<string>()
  private triggers = { state: false, downloads: false }

  constructor(options: WorkflowEngineOptions) {
    this.o = options
  }

  async start(): Promise<void> {
    await this.refresh()
    await this.catchUp()
    this.stops.push(this.o.windowControl.onState((state) => void this.onBrowserState(state)))
    this.completedDownloads = new Set(this.o.library.snapshot().downloads.filter((d) => d.state === 'completed').map((d) => d.id))
    this.stops.push(this.o.library.addListener(() => void this.onLibrary()))
    for (const workflow of await this.o.store.list()) {
      if (workflow.trigger.type === 'appStart' && workflow.status !== 'archived') void this.run(workflow.id, { trigger: 'event' }).catch((err: unknown) => this.notice(workflow, err))
    }
  }

  /**
   * Moves to another profile's workflows.
   *
   * Runs in progress belong to the profile they were started in, so they are stopped rather than left driving the
   * browser on behalf of somebody who is no longer using it; then schedules and triggers are worked out again from the
   * new profile's library.
   */
  async useProfile(profileId: string): Promise<void> {
    if (this.o.store.profile === profileId) return
    for (const { run } of this.active.values()) run.control('stop')
    this.o.store.useProfile(profileId)
    await this.refresh()
  }

  /**
   * Runs anything that was due while Orbis was closed — once, and only if it was due within the last day. Occurrences
   * before the workflow was last changed are not counted, so a schedule never fires for a time from before it existed.
   */
  private async catchUp(now = Date.now()): Promise<void> {
    const runs = await this.o.store.runs()
    for (const workflow of await this.o.store.list()) {
      if (!workflow.schedule?.enabled || workflow.status === 'archived') continue
      const lastScheduled = runs.find((r) => r.workflowId === workflow.id && r.trigger === 'schedule')?.startedAt
      const due = missedRun(workflow.schedule, Math.max(lastScheduled ?? 0, workflow.updatedAt), now)
      if (due === null) continue
      this.o.send('workflows:notice', { workflowId: workflow.id, message: `“${workflow.name}” was due while Orbis was closed, so it is running now.` })
      await this.run(workflow.id, { trigger: 'schedule' }).catch((err: unknown) => this.notice(workflow, err))
      if (workflow.schedule.kind === 'once') await this.o.store.save({ ...workflow, schedule: { ...workflow.schedule, enabled: false } })
    }
    await this.reschedule()
  }

  stop(): void {
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer)
    for (const stop of this.stops.splice(0)) stop()
    for (const { run } of this.active.values()) run.control('stop')
  }

  private notice(workflow: Workflow, err: unknown): void {
    this.o.send('workflows:notice', { workflowId: workflow.id, message: `“${workflow.name}” couldn't start: ${err instanceof Error ? err.message : String(err)}` })
  }

  /** After any change to the library: reschedule, re-read triggers, tell the window. */
  private async refresh(): Promise<void> {
    const all = await this.o.store.list()
    this.triggers = {
      state: all.some((w) => w.status !== 'archived' && (w.trigger.type === 'tabOpened' || w.trigger.type === 'navigationCompleted')),
      downloads: all.some((w) => w.status !== 'archived' && w.trigger.type === 'downloadCompleted')
    }
    await this.reschedule(all)
    this.o.send('workflows:changed')
  }

  // ---------------------------------------------------------------- library

  list(): Promise<Workflow[]> {
    return this.o.store.list()
  }

  get(id: string): Promise<Workflow | null> {
    return this.o.store.get(id)
  }

  /** Told whenever a workflow is stored, so it can be named without the engine knowing anything about naming. */
  onStored?: (workflow: Workflow) => void

  async create(name: string, template?: Workflow): Promise<Workflow> {
    const base = template ? { ...template, id: crypto.randomUUID(), name, template: false, favorite: false, pinned: false, version: 1, createdAt: Date.now(), updatedAt: Date.now(), createdBy: 'user' as const } : newWorkflow(name, crypto.randomUUID())
    const saved = await this.o.store.save(base)
    await this.refresh()
    this.onStored?.(saved)
    return saved
  }

  async save(workflow: Workflow, note?: string): Promise<Workflow> {
    const saved = await this.o.store.save(workflow, note)
    await this.refresh()
    this.onStored?.(saved)
    return saved
  }

  async duplicate(id: string): Promise<Workflow> {
    const original = (await this.o.store.get(id)) ?? this.missing()
    const copy = importWorkflow(exportWorkflow(original), () => crypto.randomUUID())
    const saved = await this.o.store.save({ ...copy, name: `${original.name} (copy)`, createdBy: 'user', settings: original.settings, trigger: { type: 'manual' } })
    await this.refresh()
    return saved
  }

  async remove(id: string): Promise<void> {
    for (const entry of this.active.values()) if (entry.info.workflowId === id) entry.run.control('stop')
    await this.o.store.remove(id)
    await this.refresh()
  }

  async exportJson(id: string): Promise<string> {
    return JSON.stringify(exportWorkflow((await this.o.store.get(id)) ?? this.missing()), null, 2)
  }

  async importJson(json: string): Promise<{ workflow: Workflow; issues: WorkflowIssue[] }> {
    const imported = importWorkflow(json, () => crypto.randomUUID())
    const issues = await this.validate(imported)
    const saved = await this.o.store.save(imported)
    await this.refresh()
    return { workflow: saved, issues }
  }

  versions(id: string): Promise<WorkflowVersion[]> {
    return this.o.store.versions(id)
  }

  async restoreVersion(id: string, version: number): Promise<Workflow> {
    const restored = await this.o.store.restoreVersion(id, version)
    await this.refresh()
    return restored
  }

  async history(id?: string): Promise<WorkflowRunSummary[]> {
    return this.o.store.runs(id)
  }

  async stats(id: string): Promise<WorkflowStats> {
    return workflowStats(await this.o.store.runs(id))
  }

  nextRun(id: string): number | null {
    return this.nextRuns.get(id) ?? null
  }

  private missing(): never {
    throw new Error('That workflow no longer exists.')
  }

  // ---------------------------------------------------------------- validation and plan mode

  async validate(workflow: Workflow, inputs?: Record<string, unknown>): Promise<WorkflowIssue[]> {
    return validateWorkflow(workflow, { capabilities: this.o.control.list(), workflows: await this.o.store.list(), inputs })
  }

  /** What a run would do, without doing it. */
  async plan(id: string): Promise<{ lines: PlanLine[]; issues: WorkflowIssue[] }> {
    const workflow = (await this.o.store.get(id)) ?? this.missing()
    return { lines: describeWorkflow(workflow, this.o.control.list()), issues: await this.validate(workflow) }
  }

  // ---------------------------------------------------------------- runs

  activeRuns(): ActiveWorkflowRun[] {
    return [...this.active.values()].map((a) => ({ ...a.info }))
  }

  control(runId: string, action: RunControl): boolean {
    const entry = this.active.get(runId)
    if (!entry) return false
    entry.run.control(action)
    return true
  }

  /** Runs that were in progress when Orbis closed, which the user may resume. */
  checkpoints(): Promise<WorkflowCheckpoint[]> {
    return this.o.store.checkpoints()
  }

  async discardCheckpoint(runId: string): Promise<void> {
    await this.o.store.clearCheckpoint(runId)
  }

  /** Continues an interrupted run from its last completed top-level step; nothing before it is done again. */
  async resume(runId: string, inputs: Record<string, unknown> = {}): Promise<ActiveWorkflowRun> {
    const checkpoint = (await this.o.store.checkpoints()).find((c) => c.runId === runId)
    if (!checkpoint) throw new Error('That run can no longer be resumed.')
    const workflow = (await this.o.store.get(checkpoint.workflowId)) ?? this.missing()
    if (workflow.version !== checkpoint.version) throw new Error(`“${workflow.name}” changed since that run (version ${checkpoint.version} → ${workflow.version}), so it can't safely continue. Run it again instead.`)
    const started = await this.run(workflow.id, { inputs: { ...checkpoint.inputs, ...inputs }, trigger: 'manual', resume: checkpoint })
    await this.o.store.clearCheckpoint(runId)
    return started
  }

  private async resolveInputs(workflow: Workflow, provided: Record<string, unknown>): Promise<Record<string, unknown>> {
    const values: Record<string, unknown> = {}
    const missing: WorkflowIssue[] = []
    for (const input of workflow.inputs) {
      let value = provided[input.name]
      if ((value === undefined || value === '') && input.type === 'secret') value = (await this.o.store.secret(workflow.id, input.name)) ?? undefined
      if (value === undefined || value === '') value = input.default
      if (value === undefined || value === '') {
        if (input.required) missing.push({ level: 'error', message: `The input “${input.label || input.name}” is required.` })
        continue
      }
      if (input.type === 'number') {
        const n = Number(value)
        if (!Number.isFinite(n)) missing.push({ level: 'error', message: `The input “${input.label || input.name}” must be a number.` })
        value = n
      } else if (input.type === 'boolean') value = value === true || value === 'true'
      values[input.name] = value
    }
    if (missing.length) throw new WorkflowValidationError(missing)
    return values
  }

  async run(id: string, options: { inputs?: Record<string, unknown>; trigger?: RunTrigger; debug?: boolean; resume?: WorkflowCheckpoint } = {}): Promise<ActiveWorkflowRun> {
    const workflow = (await this.o.store.get(id)) ?? this.missing()
    if (workflow.status === 'archived') throw new Error(`“${workflow.name}” is archived. Restore it to run it.`)
    const trigger = options.trigger ?? 'manual'
    if (trigger !== 'manual' && [...this.active.values()].some((a) => a.info.workflowId === id)) throw new Error('It is already running.')
    const inputs = await this.resolveInputs(workflow, options.inputs ?? {})
    const errors = (await this.validate(workflow, inputs)).filter((i) => i.level === 'error')
    if (errors.length) throw new WorkflowValidationError(errors)

    const plan = compileWorkflow(workflow, { ...inputs, ...(options.resume?.variables ?? {}) })
    const runId = crypto.randomUUID()
    const records: StepRecord[] = []
    const secretInputs = new Set(workflow.inputs.filter((i) => i.type === 'secret').map((i) => i.name))
    const safeInputs = Object.fromEntries(Object.entries(inputs).filter(([k]) => !secretInputs.has(k) && !SECRET_NAME.test(k)))
    const info: ActiveWorkflowRun = {
      runId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      version: workflow.version,
      trigger,
      debug: options.debug === true,
      state: { id: runId, name: workflow.name, source: 'automation', status: 'running', variables: {}, startedAt: Date.now(), stepsRun: 0 }
    }
    const run = new PlanRun(plan, {
      id: runId,
      control: this.o.control,
      // Workflows act as automations: consequential steps always ask the user, however the run was started.
      source: 'automation',
      confirm: (request) => this.o.windowControl.confirm(request),
      emit: (state) => {
        info.state = state
        this.o.send('workflows:run-update', { ...info })
      },
      ask: this.o.ask,
      resolveCall: async (workflowId) => {
        const called = await this.o.store.get(workflowId)
        return called ? compileWorkflow(called) : null
      },
      onStep: (record) => {
        records.push(record)
        if (records.length > 400) records.shift()
        this.o.send('workflows:step', { runId, workflowId: workflow.id, record })
      },
      checkpoint: (cp) => void this.o.store.saveCheckpoint({ runId, workflowId: workflow.id, version: workflow.version, nextTopIndex: cp.nextTopIndex, variables: cp.variables, inputs: safeInputs, savedAt: Date.now() }),
      resumeFrom: options.resume?.nextTopIndex,
      debug: options.debug
    })
    const entry = { run, info, records, timer: null as NodeJS.Timeout | null, timedOut: false }
    if (workflow.settings.timeoutMs) {
      entry.timer = setTimeout(() => {
        entry.timedOut = true
        run.control('stop')
      }, Math.min(workflow.settings.timeoutMs, MAX_TIMER))
    }
    this.active.set(runId, entry)
    void run.start().then((final) => this.finish(runId, final))
    return { ...info }
  }

  private async finish(runId: string, final: RunState): Promise<void> {
    const entry = this.active.get(runId)
    if (!entry) return
    this.active.delete(runId)
    if (entry.timer) clearTimeout(entry.timer)
    const failedStep = [...entry.records].reverse().find((r) => r.status === 'failed')
    const summary: WorkflowRunSummary = {
      runId,
      workflowId: entry.info.workflowId,
      workflowName: entry.info.workflowName,
      version: entry.info.version,
      source: 'automation',
      trigger: entry.info.trigger,
      status: final.status === 'completed' ? 'completed' : final.status === 'failed' ? 'failed' : 'stopped',
      startedAt: final.startedAt,
      finishedAt: final.finishedAt ?? Date.now(),
      durationMs: (final.finishedAt ?? Date.now()) - final.startedAt,
      stepsRun: final.stepsRun,
      ...(final.iteration ? { iterations: final.iteration } : {}),
      ...(final.error
        ? { error: { ...final.error, stepPath: failedStep?.path ?? final.currentStep, stepLabel: failedStep?.label ?? final.currentAction } }
        : entry.timedOut
          ? { error: { code: 'timeout' as const, message: 'The run reached its time limit and was stopped.', recoverable: true } }
          : {}),
      ...(final.outputs ? { outputs: final.outputs } : {}),
      steps: entry.records
    }
    await this.o.store.recordRun(summary)
    await this.o.store.clearCheckpoint(runId)
    this.o.send('workflows:run-finished', summary)
    // Someone who scheduled a workflow, or set one to start on its own, is usually not watching when it finishes.
    if (summary.trigger === 'schedule' || summary.trigger === 'event') {
      this.o.notify?.(
        summary.status === 'completed' ? `“${summary.workflowName}” finished` : summary.status === 'failed' ? `“${summary.workflowName}” could not finish` : `“${summary.workflowName}” was stopped`,
        summary.status === 'failed' ? (summary.error?.message ?? 'Open Workflows to see what happened.') : `${summary.stepsRun} ${summary.stepsRun === 1 ? 'step' : 'steps'} run.`
      )
    }
  }

  // ---------------------------------------------------------------- schedules (while Orbis is open)

  private async reschedule(all?: Workflow[]): Promise<void> {
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer)
    this.scheduleTimer = null
    this.nextRuns.clear()
    const now = Date.now()
    for (const workflow of all ?? (await this.o.store.list())) {
      if (!workflow.schedule?.enabled || workflow.status === 'archived') continue
      const at = nextScheduledRun(workflow.schedule, now)
      if (at !== null) this.nextRuns.set(workflow.id, at)
    }
    const soonest = Math.min(...this.nextRuns.values())
    if (!Number.isFinite(soonest)) return
    this.scheduleTimer = setTimeout(() => void this.fireSchedules(), Math.min(MAX_TIMER, Math.max(0, soonest - now)))
  }

  private async fireSchedules(): Promise<void> {
    const due = [...this.nextRuns.entries()].filter(([, at]) => at <= Date.now() + 1000).map(([id]) => id)
    for (const id of due) {
      const workflow = await this.o.store.get(id)
      if (!workflow) continue
      await this.run(id, { trigger: 'schedule' }).catch((err: unknown) => this.notice(workflow, err))
      if (workflow.schedule?.kind === 'once') await this.o.store.save({ ...workflow, schedule: { ...workflow.schedule, enabled: false } })
    }
    await this.reschedule()
    this.o.send('workflows:changed')
  }

  // ---------------------------------------------------------------- event triggers

  private matches(pattern: string | undefined, text: string): boolean {
    if (!pattern) return true
    try {
      return new RegExp(pattern, 'i').test(text)
    } catch {
      return text.toLowerCase().includes(pattern.toLowerCase())
    }
  }

  private async onBrowserState(next: WindowBrowserState): Promise<void> {
    const before = this.lastState
    this.lastState = next
    if (!before || !this.triggers.state) return
    const opened = next.tabs.filter((t) => !before.tabs.some((b) => b.id === t.id))
    const finished = next.tabs.filter((t) => {
      const was = before.tabs.find((b) => b.id === t.id)
      // A quick load can start and finish between two state reports, so a new address that is no longer loading counts.
      return was && (was.loading || was.url !== t.url) && !t.loading && !t.error && /^https?:/i.test(t.url)
    })
    if (!opened.length && !finished.length) return
    for (const workflow of await this.o.store.list()) {
      if (workflow.status === 'archived' || [...this.active.values()].some((a) => a.info.workflowId === workflow.id)) continue
      const t = workflow.trigger
      const fire = t.type === 'tabOpened' ? opened.some((tab) => this.matches(t.urlMatches, tab.url)) : t.type === 'navigationCompleted' ? finished.some((tab) => this.matches(t.urlMatches, tab.url)) : false
      if (fire) void this.run(workflow.id, { trigger: 'event' }).catch((err: unknown) => this.notice(workflow, err))
    }
  }

  private async onLibrary(): Promise<void> {
    const completed = this.o.library.snapshot().downloads.filter((d) => d.state === 'completed' && !this.completedDownloads.has(d.id))
    if (!completed.length) return
    for (const d of completed) this.completedDownloads.add(d.id)
    if (!this.triggers.downloads) return
    for (const workflow of await this.o.store.list()) {
      const t = workflow.trigger
      if (workflow.status === 'archived' || t.type !== 'downloadCompleted' || [...this.active.values()].some((a) => a.info.workflowId === workflow.id)) continue
      if (completed.some((d) => this.matches(t.nameMatches, d.filename))) void this.run(workflow.id, { trigger: 'event', inputs: {} }).catch((err: unknown) => this.notice(workflow, err))
    }
  }
}
