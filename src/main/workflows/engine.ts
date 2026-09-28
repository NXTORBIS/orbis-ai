import { missedRun } from '../../shared/schedulePhrase.ts'
import type { RunControl, RunState, StepRecord, WindowBrowserState } from '../../shared/browserControl'
import type { ActiveWorkflowRun, Workflow, WorkflowIssue, WorkflowRunSummary, WorkflowStats } from '../../shared/workflows'
import { exportWorkflow, importWorkflow, MIN_WATCH_MINUTES, newWorkflow, nextScheduledRun, validateWorkflow, workflowStats } from '../../shared/workflows'
import { compileWorkflow, describeWorkflow } from '../../shared/workflowCompile'
import { blockedBy, resourcesOf, schedule as chooseNext } from '../../shared/workflowQueue'
import type { QueuedRun, Resource } from '../../shared/workflowQueue'
import { findings, health, repairs } from '../../shared/workflowHealth'
import type { Finding, HealthReport, Repair } from '../../shared/workflowHealth'
import { affected, migrate, missing, runnable } from '../../shared/workflowCompat'
import { anomaly, compare } from '../../shared/workflowDiff'
import { bus } from '../eventBus.ts'
import { newCorrelationId } from '../../shared/orbisEvents.ts'
import type { Migration, Missing } from '../../shared/workflowCompat'
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
  /**
   * Runs asked for that could not start yet, because something already running holds what they need.
   *
   * A queue rather than a refusal, for the runs nobody is watching: a schedule that fires while yesterday's run is
   * still going should wait its turn, not be dropped. A person pressing Run still gets an immediate answer, because
   * silently queueing something somebody is standing in front of looks like nothing happened.
   */
  private queued: (QueuedRun & { options: { inputs?: Record<string, unknown>; trigger?: RunTrigger; debug?: boolean } })[] = []

  private readonly active = new Map<string, { run: PlanRun; info: ActiveWorkflowRun; records: StepRecord[]; timer: NodeJS.Timeout | null; timedOut: boolean; resources: Resource[] }>()
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
    void this.reviewWatches()
    for (const workflow of await this.o.store.list()) {
      if (workflow.trigger.type === 'appStart' && workflow.status !== 'archived') void this.enqueue(workflow.id, { trigger: 'event' }).catch((err: unknown) => this.notice(workflow, err))
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
      await this.enqueue(workflow.id, { trigger: 'schedule' }).catch((err: unknown) => this.notice(workflow, err))
      if (workflow.schedule.kind === 'once') await this.o.store.save({ ...workflow, schedule: { ...workflow.schedule, enabled: false } })
    }
    await this.reschedule()
  }

  stop(): void {
    if (this.watchTimer) {
      clearInterval(this.watchTimer)
      this.watchTimer = null
    }
    // Nothing queued survives a stop: a run that starts itself after Orbis was told to stop is a surprise.
    this.queued = []
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

  /**
   * How a workflow is actually doing, from its own run history. Never an estimate: a workflow with two runs is told
   * it has two runs rather than given a success rate that means nothing.
   */
  async health(id: string): Promise<HealthReport> {
    return health(await this.o.store.runs(id))
  }

  /** What the runs show is worth changing, measured from real durations and attempt counts. */
  async findings(id: string): Promise<Finding[]> {
    return findings(await this.o.store.runs(id))
  }

  /** What to change about a workflow that keeps failing. Proposed for a person; never applied on its own. */
  async repairs(id: string): Promise<Repair[]> {
    return repairs(await this.o.store.runs(id))
  }

  /**
   * Whether this workflow still fits the Orbis it would run on, and what it would take to make it fit.
   *
   * `migration.changes` is a proposal. Nothing is rewritten until somebody applies it, because the steps in question
   * act on a real browser and a workflow that quietly rewrote itself is one nobody can predict.
   */
  async compatibility(id: string): Promise<{ ok: boolean; why: string; problems: Missing[]; migration: Migration }> {
    const workflow = (await this.o.store.get(id)) ?? this.missing()
    const capabilities = this.o.control.list()
    const others = await this.o.store.list()
    return {
      ...runnable(workflow, capabilities, others),
      problems: missing(workflow, capabilities, others),
      migration: migrate(workflow, capabilities, others)
    }
  }

  /** Applies a migration a person has accepted, as an ordinary save, so it lands in the version history like any edit. */
  async applyMigration(id: string): Promise<Workflow> {
    const { migration } = await this.compatibility(id)
    if (!migration.changes.length) throw new Error('There is nothing to change.')
    return this.save(migration.migrated, `Updated ${migration.changes.length} step${migration.changes.length === 1 ? '' : 's'} for this version of Orbis`)
  }

  /** Which of this profile's workflows an Orbis change has broken, found together rather than one failure at a time. */
  async affectedByUpdate(): Promise<{ workflow: Workflow; problems: Missing[] }[]> {
    return affected(await this.o.store.list(), this.o.control.list())
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

  /**
   * Asks for a run, and waits its turn if it must.
   *
   * For anything nobody is watching -- a schedule, a trigger, one workflow calling another -- being told "something
   * else is using the browser" is useless: there is nobody there to try again later. So it joins the queue and starts
   * when what it needs is free. A person pressing Run gets `run()` instead, and an immediate answer either way.
   */
  async enqueue(id: string, options: { inputs?: Record<string, unknown>; trigger?: RunTrigger; debug?: boolean; priority?: number } = {}): Promise<{ started: ActiveWorkflowRun } | { queued: true; position: number; reason: string }> {
    const workflow = (await this.o.store.get(id)) ?? this.missing()
    const resources = resourcesOf(workflow, this.o.control.list())
    const waiting = blockedBy(
      { runId: 'pending', workflowId: id, priority: options.priority ?? 0, queuedAt: Date.now(), resources, profileId: this.o.store.profile },
      this.runningNow()
    )
    // Already queued for the same thing: one entry, not one per firing of a schedule that keeps coming round.
    if (this.queued.some((q) => q.workflowId === id)) {
      return { queued: true, position: this.queued.findIndex((q) => q.workflowId === id) + 1, reason: 'It is already waiting to run.' }
    }
    if (!waiting) return { started: await this.run(id, options) }

    this.queued.push({
      runId: crypto.randomUUID(),
      workflowId: id,
      priority: options.priority ?? 0,
      queuedAt: Date.now(),
      resources,
      profileId: this.o.store.profile,
      options
    })
    this.o.send('workflows:queue', this.waiting())
    bus.publish(
      'workflow.queued',
      { workflowId: id, position: this.queued.length, reason: waiting.reason },
      { source: 'workflows', profileId: this.o.store.profile }
    )
    return { queued: true, position: this.queued.length, reason: waiting.reason }
  }

  /** What is waiting, and what for, so a queued workflow is never a mystery. */
  waiting(): { workflowId: string; queuedAt: number; reason: string }[] {
    const running = this.runningNow()
    return this.queued.map((q) => ({
      workflowId: q.workflowId,
      queuedAt: q.queuedAt,
      reason: blockedBy(q, running)?.reason ?? 'about to start'
    }))
  }

  /** Takes a queued run off the queue without running it. */
  unqueue(workflowId: string): boolean {
    const before = this.queued.length
    this.queued = this.queued.filter((q) => q.workflowId !== workflowId)
    if (this.queued.length !== before) this.o.send('workflows:queue', this.waiting())
    return this.queued.length !== before
  }

  private runningNow(): { runId: string; workflowId: string; resources: Resource[]; profileId: string }[] {
    return [...this.active.values()].map((a) => ({ runId: a.info.runId, workflowId: a.info.workflowId, resources: a.resources, profileId: this.o.store.profile }))
  }

  /**
   * Starts whatever can now go, after something finished.
   *
   * Everything still blocked keeps its place, so a workflow that has waited does not lose its turn to one queued after
   * it. A queued run whose workflow has since been deleted or archived is dropped rather than resurrected.
   */
  private async drain(): Promise<void> {
    if (!this.queued.length) return
    const { start } = chooseNext(this.queued, this.runningNow())
    for (const next of start) {
      const entry = this.queued.find((q) => q.runId === next.runId)
      if (!entry) continue
      this.queued = this.queued.filter((q) => q.runId !== entry.runId)
      const workflow = await this.o.store.get(entry.workflowId)
      if (!workflow || workflow.status === 'archived') continue
      try {
        await this.run(entry.workflowId, entry.options)
      } catch (err) {
        this.notice(workflow, err)
      }
    }
    this.o.send('workflows:queue', this.waiting())
  }

  async run(id: string, options: { inputs?: Record<string, unknown>; trigger?: RunTrigger; debug?: boolean; resume?: WorkflowCheckpoint } = {}): Promise<ActiveWorkflowRun> {
    const workflow = (await this.o.store.get(id)) ?? this.missing()
    if (workflow.status === 'archived') throw new Error(`“${workflow.name}” is archived. Restore it to run it.`)
    const trigger = options.trigger ?? 'manual'
    if (trigger !== 'manual' && [...this.active.values()].some((a) => a.info.workflowId === id)) throw new Error('It is already running.')

    // What this workflow will reach for, and whether something already running holds it. Two runs writing to the same
    // page at once do not fail loudly -- they both report their steps while the wrong thing happens to a real page.
    const resources = resourcesOf(workflow, this.o.control.list())
    const clash = blockedBy(
      { runId: 'pending', workflowId: workflow.id, priority: 0, queuedAt: Date.now(), resources, profileId: this.o.store.profile },
      [...this.active.values()].map((a) => ({ runId: a.info.runId, workflowId: a.info.workflowId, resources: a.resources, profileId: this.o.store.profile }))
    )
    if (clash) {
      const other = this.active.get(clash.by)?.info.workflowName ?? 'another workflow'
      throw new Error(`“${workflow.name}” is ${clash.reason} (“${other}”). Wait for it to finish, or stop it first.`)
    }
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
    const entry = { run, info, records, timer: null as NodeJS.Timeout | null, timedOut: false, resources }
    // One id for everything this run causes, so a tab it opens and a download it starts can be told apart from
    // another run's. Announced on the shared bus rather than to one listener that happened to need it.
    const correlationId = newCorrelationId('wf')
    bus.publish(
      'workflow.started',
      { runId, workflowId: workflow.id, name: workflow.name, trigger },
      { source: 'workflows', profileId: this.o.store.profile, correlationId }
    )
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
    // What this run was holding is free now, so anything waiting on it can go.
    void this.drain()
    const ended = final.status === 'completed' ? 'workflow.completed' : 'workflow.failed'
    bus.publish(
      ended,
      { runId, workflowId: entry.info.workflowId, name: entry.info.workflowName, status: final.status, ...(final.error ? { error: final.error.message } : {}) },
      { source: 'workflows', profileId: this.o.store.profile }
    )
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
      await this.enqueue(id, { trigger: 'schedule' }).catch((err: unknown) => this.notice(workflow, err))
      if (workflow.schedule?.kind === 'once') await this.o.store.save({ ...workflow, schedule: { ...workflow.schedule, enabled: false } })
    }
    await this.reschedule()
    this.o.send('workflows:changed')
  }

  // ---------------------------------------------------------------- watching a page

  /**
   * What each watched page said last time, and when it was last looked at.
   *
   * Kept in memory only. The text of a page somebody is watching can be anything -- an order, a medical result, a
   * private dashboard -- and writing it to disk to power a convenience would be a poor trade nobody asked for. The
   * cost of forgetting on restart is one quiet first check, which is the right way round.
   */
  private readonly watched = new Map<string, { at: number; text: string }>()

  private watchTimer: NodeJS.Timeout | null = null

  /** Starts the watcher when something is watching, and stops it when nothing is. No timer runs for no reason. */
  private async reviewWatches(): Promise<void> {
    const watching = (await this.o.store.list()).some((w) => w.trigger.type === 'pageChanged' && w.status !== 'archived')
    if (watching && !this.watchTimer) {
      // One timer for every watcher; each decides for itself whether enough time has passed.
      this.watchTimer = setInterval(() => void this.checkWatches(), 60_000)
    } else if (!watching && this.watchTimer) {
      clearInterval(this.watchTimer)
      this.watchTimer = null
    }
  }

  /**
   * Looks at each watched page, and starts the workflow when something that matters changed.
   *
   * A page that came back blocked, rate-limited, empty or entirely replaced is not a change worth acting on: it is
   * Orbis being unable to read the page, and starting a workflow on the strength of it would be acting on a fact
   * about the watcher rather than about the world. Those are recorded and the watch simply waits.
   */
  private async checkWatches(now = Date.now()): Promise<void> {
    for (const workflow of await this.o.store.list()) {
      const trigger = workflow.trigger
      if (trigger.type !== 'pageChanged' || workflow.status === 'archived') continue
      if (this.queued.some((q) => q.workflowId === workflow.id)) continue
      if ([...this.active.values()].some((a) => a.info.workflowId === workflow.id)) continue

      const everyMs = Math.max(MIN_WATCH_MINUTES, trigger.everyMinutes || MIN_WATCH_MINUTES) * 60_000
      const last = this.watched.get(workflow.id)
      if (last && now - last.at < everyMs) continue

      // Read in a background tab that is opened, read and closed again, using capabilities that already exist --
      // there is no second fetcher here, and nothing is taken from the person's foreground. Opening the page in the
      // real browser is also the only honest way to see what they would see: the same profile, the same cookies, the
      // same ad blocking.
      const text = await this.readInBackground(trigger.url)
      if (!text) {
        this.watched.set(workflow.id, { at: now, text: last?.text ?? '' })
        continue
      }

      // The first look is the baseline. Nothing has changed yet, because there was nothing to change from.
      if (!last?.text) {
        this.watched.set(workflow.id, { at: now, text })
        continue
      }

      const odd = anomaly(last.text, text)
      if (odd) {
        this.notice(workflow, new Error(`Watching ${trigger.url}: ${odd.detail}`))
        this.watched.set(workflow.id, { at: now, text: last.text })
        continue
      }

      const difference = compare(last.text, text)
      this.watched.set(workflow.id, { at: now, text })
      if (!difference.changed) continue
      void this.enqueue(workflow.id, { trigger: 'event', inputs: { change: difference.summary } }).catch((err: unknown) => this.notice(workflow, err))
    }
  }

  /**
   * Opens a page out of the way, reads it, and closes it again.
   *
   * Empty when anything went wrong, which the caller treats as "could not look" rather than as "nothing there". The
   * tab is closed in a finally, so a read that throws does not leave a tab behind on somebody's browser every five
   * minutes.
   */
  private async readInBackground(url: string): Promise<string> {
    let tabId = ''
    try {
      const opened = await this.o.control.execute({ capability: 'tabs.create', params: { url, active: false }, source: 'automation' }, { confirm: async () => false })
      if (!opened.ok) return ''
      const data = opened.data as { id?: unknown; tabId?: unknown } | null
      tabId = typeof data?.id === 'string' ? data.id : typeof data?.tabId === 'string' ? data.tabId : ''
      if (!tabId) return ''

      // Give the page a moment to put something on screen before reading it.
      await new Promise((resolve) => setTimeout(resolve, 2500))
      const read = await this.o.control.execute(
        { capability: 'page.read', params: { maxChars: 40_000 }, target: { tabId }, source: 'automation' },
        { confirm: async () => false }
      )
      const page = (read.ok ? read.data : null) as { text?: unknown } | null
      return typeof page?.text === 'string' ? page.text : ''
    } catch {
      return ''
    } finally {
      if (tabId) await this.o.control.execute({ capability: 'tabs.close', params: {}, target: { tabId }, source: 'automation' }, { confirm: async () => false }).catch(() => undefined)
    }
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
      if (fire) void this.enqueue(workflow.id, { trigger: 'event' }).catch((err: unknown) => this.notice(workflow, err))
    }
  }

  private async onLibrary(): Promise<void> {
    void this.reviewWatches()
    const completed = this.o.library.snapshot().downloads.filter((d) => d.state === 'completed' && !this.completedDownloads.has(d.id))
    if (!completed.length) return
    for (const d of completed) this.completedDownloads.add(d.id)
    if (!this.triggers.downloads) return
    for (const workflow of await this.o.store.list()) {
      const t = workflow.trigger
      if (workflow.status === 'archived' || t.type !== 'downloadCompleted' || [...this.active.values()].some((a) => a.info.workflowId === workflow.id)) continue
      if (completed.some((d) => this.matches(t.nameMatches, d.filename))) void this.enqueue(workflow.id, { trigger: 'event', inputs: {} }).catch((err: unknown) => this.notice(workflow, err))
    }
  }
}
