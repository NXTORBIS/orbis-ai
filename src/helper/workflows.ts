import type { ActiveWorkflowRun, Workflow, WorkflowIssue, WorkflowRunSummary, WorkflowStats, RecordingState } from '../shared/workflows'
import type { PlanLine } from '../shared/workflowCompile'
import type { RunControl } from '../shared/browserControl'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Workflows for the panel: the same engine, store and run history Electron Orbis uses (the engine runs in this process).
 *
 * The panel lists workflows, shows their steps in words, runs and stops them, follows a run, and switches a schedule on or
 * off. It never receives a run's variables or a step's parameters (either can hold something private): only names,
 * plain-language steps, statuses and progress. Recording is another part of the app; when it is connected the panel's
 * Record button uses it.
 */

/** The parts of the engine the panel uses. The real WorkflowEngine satisfies this as it is. */
export interface WorkflowEngineLike {
  list(): Promise<Workflow[]>
  get(id: string): Promise<Workflow | null>
  save(workflow: Workflow, note?: string): Promise<Workflow>
  run(id: string, options: { inputs?: Record<string, unknown>; trigger?: WorkflowRunSummary['trigger']; debug?: boolean }): Promise<ActiveWorkflowRun>
  control(runId: string, action: RunControl): boolean
  activeRuns(): ActiveWorkflowRun[]
  history(id?: string): Promise<WorkflowRunSummary[]>
  stats(id: string): Promise<WorkflowStats>
  nextRun(id: string): number | null
  plan(id: string): Promise<{ lines: PlanLine[]; issues: WorkflowIssue[] }>
}

/** Optional: recording is done by another part of the app. The real WorkflowRecorder satisfies this. */
export interface WorkflowRecorderLike {
  start(): RecordingState
  stop(): RecordingState
  current(): RecordingState
}

export interface WorkflowsDeps {
  engine: WorkflowEngineLike
  recorder?: WorkflowRecorderLike
}

const bad = (message: string): HelperError => new HelperError('bad-request', message)
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw bad('Expected an id.')
  return value
}

const card = (w: Workflow, stats: WorkflowStats, nextRun: number | null) => ({
  id: w.id,
  name: w.name,
  description: w.description,
  status: w.status,
  steps: w.steps.length,
  inputs: w.inputs.map((i) => ({
    name: i.name,
    label: i.label,
    type: i.type,
    required: i.required === true,
    ...(typeof i.default === 'string' || typeof i.default === 'number' || typeof i.default === 'boolean' ? { default: i.default } : {})
  })),
  schedule: w.schedule ? { enabled: w.schedule.enabled, kind: w.schedule.kind, at: w.schedule.at } : null,
  nextRun,
  runs: stats.runs,
  lastRun: stats.lastRun ?? null
})

/** A run's progress: where it is, not what it holds. */
const progress = (r: ActiveWorkflowRun) => ({
  runId: r.runId,
  workflowId: r.workflowId,
  workflow: r.workflowName,
  status: r.state.status,
  step: r.state.currentStep ?? null,
  action: r.state.currentAction ?? null,
  stepIndex: r.state.stepIndex ?? null,
  stepCount: r.state.stepCount ?? null,
  iteration: r.state.iteration ?? null,
  startedAt: r.state.startedAt,
  waitingFor: r.state.waitingFor ? { kind: r.state.waitingFor.kind, message: r.state.waitingFor.message } : null,
  error: r.state.error?.message ?? null
})

const finished = (r: WorkflowRunSummary) => ({
  runId: r.runId,
  workflowId: r.workflowId,
  status: r.status,
  trigger: r.trigger,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  durationMs: r.durationMs,
  stepsRun: r.stepsRun,
  error: r.error?.message ?? null
})

function inputValues(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw bad('inputs must be an object.')
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === '__proto__' || k.length > 100) continue
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw bad(`Input ${k} must be text, a number or true/false.`)
    out[k] = v
  }
  return out
}

const recordingView = (s: RecordingState) => ({ available: true, active: s.active, paused: s.paused, steps: s.steps.length, startedAt: s.startedAt })

/** `getDeps` is read on every call, so the engine may come into being after the helper does. */
export function createWorkflowHandlers(getDeps: () => WorkflowsDeps | null | undefined): Record<string, Handler> {
  const deps = (): WorkflowsDeps => {
    const d = getDeps()
    if (!d) throw new HelperError('unavailable', 'Workflows are not ready yet. Try again in a moment.')
    return d
  }
  const recorder = (): WorkflowRecorderLike => {
    const r = deps().recorder
    if (!r) throw new HelperError('unavailable', 'Recording is not connected in this build.')
    return r
  }
  return {
    'workflows:list': async () => {
      const { engine } = deps()
      const all = (await engine.list()).filter((w) => w.status !== 'archived' && !w.template)
      const cards = await Promise.all(all.map(async (w) => card(w, await engine.stats(w.id), engine.nextRun(w.id))))
      return { workflows: cards, active: engine.activeRuns().map(progress) }
    },
    'workflows:get': async (a) => {
      const { engine } = deps()
      const w = await engine.get(id(a[0]))
      if (!w) throw new HelperError('not-found', 'That workflow no longer exists.')
      const plan = await engine.plan(w.id)
      const history = (await engine.history(w.id)).slice(0, 10).map(finished)
      return {
        ...card(w, await engine.stats(w.id), engine.nextRun(w.id)),
        lines: plan.lines.map((l) => ({ path: l.path, depth: l.depth, text: l.text, changes: l.changes, approval: l.approval, disabled: l.disabled })),
        issues: plan.issues.map((i) => ({ level: i.level, message: i.message })),
        history
      }
    },
    'workflows:run': async (a) => {
      const { engine } = deps()
      const o = a[1] === undefined ? {} : (a[1] as Record<string, unknown>)
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad('Options must be an object.')
      const workflowId = id(a[0])
      const inputs = inputValues(o.inputs)
      try {
        return { ok: true, run: progress(await engine.run(workflowId, { inputs, trigger: 'manual' })) }
      } catch (err) {
        // A workflow that cannot start says why, step by step; that is an answer, not a failure of the helper.
        const issues = (err as { issues?: WorkflowIssue[] }).issues
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'It could not start.',
          issues: Array.isArray(issues) ? issues.map((i) => ({ level: i.level, path: i.path ?? '', message: i.message })) : []
        }
      }
    },
    'workflows:stop': (a) => {
      const runId = id(a[0])
      return { stopped: deps().engine.control(runId, 'stop') }
    },
    'workflows:status': async (a) => {
      const { engine } = deps()
      const runs = engine.activeRuns()
      if (a[0] === undefined) return { active: runs.map(progress) }
      const runId = id(a[0])
      const live = runs.find((r) => r.runId === runId)
      if (live) return { active: true, run: progress(live) }
      const done = (await engine.history()).find((r) => r.runId === runId)
      if (!done) throw new HelperError('not-found', 'There is no such run.')
      return { active: false, run: finished(done) }
    },
    'workflows:set-enabled': async (a) => {
      const { engine } = deps()
      if (typeof a[1] !== 'boolean') throw bad('enabled must be true or false.')
      const w = await engine.get(id(a[0]))
      if (!w) throw new HelperError('not-found', 'That workflow no longer exists.')
      if (!w.schedule) throw new HelperError('no-schedule', 'That workflow has no schedule to switch. Set one in Orbis.')
      const saved = await engine.save({ ...w, schedule: { ...w.schedule, enabled: a[1] } }, a[1] ? 'Schedule on' : 'Schedule off')
      return card(saved, await engine.stats(saved.id), engine.nextRun(saved.id))
    },
    'workflows:record-state': () => {
      const r = getDeps()?.recorder
      return r ? recordingView(r.current()) : { available: false, active: false, paused: false, steps: 0, startedAt: 0 }
    },
    'workflows:record-start': () => recordingView(recorder().start()),
    'workflows:record-stop': () => recordingView(recorder().stop())
  }
}
