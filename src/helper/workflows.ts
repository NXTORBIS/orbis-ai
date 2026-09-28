import type { ActiveWorkflowRun, Workflow, WorkflowCheckpoint, WorkflowIssue, WorkflowRunSummary, WorkflowStats, WorkflowStep, WorkflowVersion, RecordingState } from '../shared/workflows'
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
  duplicate(id: string): Promise<Workflow>
  remove(id: string): Promise<void>
  versions(id: string): Promise<WorkflowVersion[]>
  restoreVersion(id: string, version: number): Promise<Workflow>
  checkpoints(): Promise<WorkflowCheckpoint[]>
  resume(runId: string, inputs?: Record<string, unknown>): Promise<ActiveWorkflowRun>
  discardCheckpoint(runId: string): Promise<void>
}

/** Remembered secret inputs, kept by the app's workflow store (encrypted by the operating system). Only names ever come back. */
export interface WorkflowSecretsLike {
  canRememberSecrets(): boolean
  rememberSecret(workflowId: string, name: string, value: string): Promise<void>
  forgetSecrets(workflowId: string, name?: string): Promise<void>
  rememberedSecretNames(workflowId: string): Promise<string[]>
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
  store?: WorkflowSecretsLike
  /**
   * Orion drafts a workflow from words (or changes an existing one), already checked against the browser it would run
   * on. Nothing runs; the person reviews it first -- and reviews the problems with it, which travel with the draft
   * rather than waiting to be discovered part-way through a real execution.
   */
  draft?(instruction: string, current: Workflow | null): Promise<{ workflow: Workflow; issues: WorkflowIssue[] }>
}

const CONTROLS = ['pause', 'resume', 'stop', 'skip', 'restart-step', 'stop-after-iteration', 'step'] as const
const SECRET_KEY = /pass(word)?|secret|token|otp|api.?key|cookie|auth|card|cvv/i
const shorten = (v: unknown): unknown => {
  const text = typeof v === 'string' ? v : typeof v === 'object' && v !== null ? JSON.stringify(v) : null
  return text === null ? v : text.length > 300 ? `${text.slice(0, 299)}…` : v
}
/** A step's parameters for reading: anything named like a secret is masked, and long values are cut. */
const readableParams = (params: Record<string, unknown> | undefined): Record<string, unknown> => Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, SECRET_KEY.test(k) ? '••••' : shorten(v)]))

interface StepInfo {
  path: string
  depth: number
  type: string
  name: string
  description?: string
  enabled: boolean
  capability?: string
  params?: Record<string, unknown>
  saveAs?: string
  optional?: boolean
  timeoutMs?: number
  retries?: number
  waitMs?: number
}
function stepInfos(steps: WorkflowStep[], path = '', depth = 0, out: StepInfo[] = []): StepInfo[] {
  steps.forEach((step, i) => {
    const here = path ? `${path}.${i + 1}` : String(i + 1)
    const a = step as unknown as Record<string, any>
    out.push({
      path: here,
      depth,
      type: step.type,
      name: step.name,
      ...(step.description ? { description: step.description } : {}),
      enabled: step.enabled !== false,
      ...(step.type === 'action' ? { capability: a.capability, params: readableParams(a.params), ...(a.saveAs ? { saveAs: a.saveAs } : {}), ...(a.optional ? { optional: true } : {}), ...(a.timeoutMs ? { timeoutMs: a.timeoutMs } : {}), ...(a.retry?.attempts ? { retries: a.retry.attempts } : {}) } : {}),
      ...(step.type === 'wait' && typeof a.ms === 'number' ? { waitMs: a.ms } : {})
    })
    if (step.type === 'if') {
      stepInfos(a.then ?? [], here, depth + 1, out)
      for (const branch of a.elseIf ?? []) stepInfos(branch.steps ?? [], here, depth + 1, out)
      stepInfos(a.else ?? [], here, depth + 1, out)
    } else if (step.type === 'repeat') stepInfos(a.steps ?? [], here, depth + 1, out)
  })
  return out
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
  color: w.color,
  archived: w.status === 'archived',
  favorite: w.favorite,
  tags: w.tags,
  updatedAt: w.updatedAt,
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

const recordView = (s: WorkflowRunSummary['steps'][number]) => ({
  path: s.path,
  label: s.label ?? s.kind,
  status: s.status,
  durationMs: s.durationMs,
  attempts: s.attempts ?? 1,
  error: s.error?.message ?? null,
  verified: s.verification ? s.verification.detail : null
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
    'workflows:list': async (a) => {
      const { engine, store, draft } = deps()
      const withArchived = typeof a[0] === 'object' && a[0] !== null && (a[0] as { archived?: unknown }).archived === true
      const all = (await engine.list()).filter((w) => (withArchived || w.status !== 'archived') && !w.template)
      const cards = await Promise.all(all.map(async (w) => card(w, await engine.stats(w.id), engine.nextRun(w.id))))
      const names = new Map(all.map((w) => [w.id, w.name]))
      const checkpoints = (await engine.checkpoints()).filter((c) => names.has(c.workflowId)).map((c) => ({ runId: c.runId, workflowId: c.workflowId, workflow: names.get(c.workflowId), nextStep: c.nextTopIndex + 1, savedAt: c.savedAt }))
      return { workflows: cards, active: engine.activeRuns().map(progress), checkpoints, canRememberSecrets: store?.canRememberSecrets() ?? false, canDraft: Boolean(draft) }
    },
    'workflows:get': async (a) => {
      const { engine } = deps()
      const w = await engine.get(id(a[0]))
      if (!w) throw new HelperError('not-found', 'That workflow no longer exists.')
      const plan = await engine.plan(w.id)
      const history = (await engine.history(w.id)).slice(0, 10).map((r) => ({ ...finished(r), steps: r.steps.slice(0, 40).map(recordView) }))
      return {
        ...card(w, await engine.stats(w.id), engine.nextRun(w.id)),
        steps: stepInfos(w.steps),
        lines: plan.lines.map((l) => ({ path: l.path, depth: l.depth, text: l.text, changes: l.changes, approval: l.approval, disabled: l.disabled })),
        issues: plan.issues.map((i) => ({ level: i.level, message: i.message })),
        history,
        remembered: (await deps().store?.rememberedSecretNames(w.id)) ?? []
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
    'workflows:control': (a) => {
      const runId = id(a[0])
      if (!CONTROLS.includes(a[1] as never)) throw bad('Unknown control.')
      return { done: deps().engine.control(runId, a[1] as RunControl) }
    },
    'workflows:history': async (a) => {
      const { engine } = deps()
      return (await engine.history(a[0] === undefined ? undefined : id(a[0]))).slice(0, 50).map((r) => ({ ...finished(r), steps: r.steps.slice(0, 40).map(recordView) }))
    },
    'workflows:rename': async (a) => {
      const { engine } = deps()
      const w = await engine.get(id(a[0]))
      if (!w) throw new HelperError('not-found', 'That workflow no longer exists.')
      if (typeof a[1] !== 'string') throw bad('A workflow needs a name.')
      const name = a[1].replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!name) throw bad('A workflow needs a name.')
      // A name somebody chose is theirs: Orbis stops naming this one until they ask it to again.
      const saved = await engine.save({ ...w, name, titleSource: 'user' }, 'Renamed')
      return card(saved, await engine.stats(saved.id), engine.nextRun(saved.id))
    },
    'workflows:duplicate': async (a) => {
      const { engine } = deps()
      const copy = await engine.duplicate(id(a[0]))
      return card(copy, await engine.stats(copy.id), engine.nextRun(copy.id))
    },
    'workflows:archive': async (a) => {
      const { engine } = deps()
      if (typeof a[1] !== 'boolean') throw bad('archived must be true or false.')
      const w = await engine.get(id(a[0]))
      if (!w) throw new HelperError('not-found', 'That workflow no longer exists.')
      const saved = await engine.save({ ...w, status: a[1] ? 'archived' : 'draft' })
      return card(saved, await engine.stats(saved.id), engine.nextRun(saved.id))
    },
    'workflows:remove': async (a) => {
      await deps().engine.remove(id(a[0]))
      return { removed: true }
    },
    'workflows:versions': async (a) => (await deps().engine.versions(id(a[0]))).map((v) => ({ version: v.version, savedAt: v.savedAt, note: v.note ?? '', steps: v.workflow.steps.length })),
    'workflows:restore-version': async (a) => {
      const { engine } = deps()
      if (typeof a[1] !== 'number' || !Number.isInteger(a[1]) || a[1] < 1) throw bad('Expected a version number.')
      const w = await engine.restoreVersion(id(a[0]), a[1])
      return card(w, await engine.stats(w.id), engine.nextRun(w.id))
    },
    'workflows:resume': async (a) => {
      try {
        return { ok: true, run: progress(await deps().engine.resume(id(a[0]), inputValues(a[1]))) }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'It could not continue.' }
      }
    },
    'workflows:discard-checkpoint': async (a) => {
      await deps().engine.discardCheckpoint(id(a[0]))
      return { discarded: true }
    },
    /** Orion drafts a workflow from words and it is saved as a draft to review; nothing is run. */
    'workflows:draft': async (a) => {
      const d = deps()
      if (!d.draft) throw new HelperError('unavailable', 'Orion cannot draft workflows in this build.')
      if (typeof a[0] !== 'string' || !a[0].trim()) throw bad('Describe the workflow first.')
      const current = a[1] === undefined ? null : await d.engine.get(id(a[1]))
      const { workflow, issues } = await d.draft(a[0].trim().slice(0, 4000), current)
      const saved = await d.engine.save({ ...workflow, status: 'draft' }, 'Drafted by Orion')
      // Saved as a draft, with whatever is wrong with it. A draft naming a capability this Orbis does not have is
      // still worth keeping -- it is most of a workflow, and the editor can fix it -- but it must not look finished.
      return { ...card(saved, await d.engine.stats(saved.id), d.engine.nextRun(saved.id)), issues }
    },
    'workflows:remembered-secrets': async (a) => (await deps().store?.rememberedSecretNames(id(a[0]))) ?? [],
    /** Write only: the value goes to the app's encrypted store and is never sent back. */
    'workflows:remember-secret': async (a) => {
      const store = deps().store
      if (!store?.canRememberSecrets()) throw new HelperError('unavailable', 'This computer cannot keep a secret for you.')
      if (typeof a[1] !== 'string' || !a[1] || a[1].length > 100 || typeof a[2] !== 'string' || a[2].length > 20_000) throw bad('Expected a name and a value.')
      await store.rememberSecret(id(a[0]), a[1], a[2])
      return { remembered: true }
    },
    'workflows:forget-secret': async (a) => {
      await deps().store?.forgetSecrets(id(a[0]), typeof a[1] === 'string' ? a[1] : undefined)
      return { forgotten: true }
    },
    'workflows:record-state': () => {
      const r = getDeps()?.recorder
      return r ? recordingView(r.current()) : { available: false, active: false, paused: false, steps: 0, startedAt: 0 }
    },
    'workflows:record-start': () => recordingView(recorder().start()),
    'workflows:record-stop': () => recordingView(recorder().stop())
  }
}
