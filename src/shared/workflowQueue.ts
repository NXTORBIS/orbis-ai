/**
 * What may run, and what must wait.
 *
 * Two workflows both driving the same browser is not twice the work done -- it is one of them navigating away from the
 * page the other was about to click on. The failure is worse than a crash because it looks like success: both runs
 * report their steps, and the wrong thing quietly happened to a real page.
 *
 * So concurrency here is decided from what each workflow will actually touch, not from a global limit. Runs that reach
 * for different things go together; runs that reach for the same thing are serialised, in a stated order, with the
 * reason recorded. Nothing is guessed: the resources come from the workflow's own steps, read against the live
 * capability registry, so a workflow that only reads pages is never held up behind one that only writes notes.
 */

import type { CapabilityDescriptor } from './browserControl.ts'
import type { Workflow, WorkflowStep } from './workflows.ts'

/** The kinds of thing a run can hold. Coarse on purpose: finer would claim a precision the browser does not give us. */
export type ResourceKind =
  /** The browser's tabs, windows and what is in front. Only one writer at a time. */
  | 'browser'
  /** A particular tab, when the workflow names one. */
  | 'tab'
  /** The page in front: its DOM, its forms, its scroll position. */
  | 'page'
  /** Downloads, which collide by filename and by the download list itself. */
  | 'downloads'
  /** The clipboard, which has exactly one value. */
  | 'clipboard'
  /** Stored things: notes, tasks, whiteboard, workspaces, bookmarks. Collides per store. */
  | 'store'
  /** Browser settings and permissions. */
  | 'settings'

export interface Resource {
  kind: ResourceKind
  /** Which one, when the workflow names it: a tab id, a store name. Empty means "the whole kind". */
  id: string
  /** A reader can share; a writer cannot. */
  write: boolean
}

export interface QueuedRun {
  runId: string
  workflowId: string
  /** Higher goes first. A run somebody is waiting on beats one on a timer. */
  priority: number
  /** When it was asked for, so equal priorities keep their order rather than shuffling. */
  queuedAt: number
  resources: Resource[]
  /** The profile it belongs to. A run never waits on, or blocks, another profile's work. */
  profileId: string
}

export interface Running {
  runId: string
  workflowId: string
  resources: Resource[]
  profileId: string
}

/** Why a run is waiting, in words, so a queued workflow is never a mystery. */
export interface Blocked {
  runId: string
  by: string
  reason: string
}

const DOMAIN_RESOURCE: Record<string, ResourceKind> = {
  tabs: 'browser',
  groups: 'browser',
  windows: 'browser',
  navigation: 'page',
  page: 'page',
  addressBar: 'browser',
  zoom: 'page',
  downloads: 'downloads',
  clipboard: 'clipboard',
  settings: 'settings',
  permissions: 'settings',
  bookmarks: 'store',
  history: 'store',
  notes: 'store',
  tasks: 'store',
  whiteboard: 'store',
  workspaces: 'store',
  media: 'page',
  state: 'browser'
}

/** Everything a step reaches for, and whether it writes. Read from the registry, never assumed from the name. */
function resourcesOfStep(step: WorkflowStep, byId: Map<string, CapabilityDescriptor>, into: Resource[]): void {
  if (step.enabled === false) return
  if (step.type === 'action') {
    const capability = byId.get(step.capability)
    // A capability this Orbis does not have reaches for nothing; validation refuses the workflow separately.
    if (!capability) return
    const kind = DOMAIN_RESOURCE[capability.domain] ?? 'browser'
    const id = kind === 'tab' || kind === 'store' ? String(step.target?.tabId ?? capability.domain) : ''
    into.push({ kind, id, write: capability.mutates })
    return
  }
  // Everything a branch or a loop contains is something the run may reach for.
  const nested: WorkflowStep[][] = []
  if (step.type === 'if') {
    nested.push(step.then, step.else ?? [])
    for (const branch of step.elseIf ?? []) nested.push(branch.steps)
  }
  if (step.type === 'repeat') nested.push(step.steps)
  for (const steps of nested) for (const inner of steps) resourcesOfStep(inner, byId, into)
}

/**
 * What a workflow will reach for if it runs.
 *
 * Collapsed so one entry per thing, keeping the strongest claim: a workflow that reads the page in one step and types
 * into it in another holds the page for writing, because that is what it does.
 */
export function resourcesOf(workflow: Workflow, capabilities: CapabilityDescriptor[]): Resource[] {
  const byId = new Map(capabilities.map((c) => [c.id, c]))
  const found: Resource[] = []
  for (const step of workflow.steps) resourcesOfStep(step, byId, found)
  const strongest = new Map<string, Resource>()
  for (const r of found) {
    const key = `${r.kind}:${r.id}`
    const held = strongest.get(key)
    if (!held || (r.write && !held.write)) strongest.set(key, r)
  }
  return [...strongest.values()]
}

/** Whether two claims on the same thing can be held at once. Two readers can; anything with a writer cannot. */
export function conflicts(a: Resource, b: Resource): boolean {
  if (a.kind !== b.kind) return false
  if (!a.write && !b.write) return false
  // An unnamed claim is a claim on the whole kind, so it collides with every named one.
  if (a.id && b.id && a.id !== b.id) return false
  return true
}

/** The first real reason this run cannot start, or null when it can. */
export function blockedBy(run: QueuedRun, running: Running[]): Blocked | null {
  for (const active of running) {
    // Profiles are separate worlds. One profile's run is never the reason another waits.
    if (active.profileId !== run.profileId) continue
    for (const mine of run.resources) {
      for (const theirs of active.resources) {
        if (!conflicts(mine, theirs)) continue
        const what = mine.id ? `${mine.kind} ${mine.id}` : mine.kind
        return {
          runId: run.runId,
          by: active.runId,
          reason: `waiting for another workflow to finish with the ${what}`
        }
      }
    }
  }
  return null
}

/**
 * What to start next, and what each waiting run is waiting for.
 *
 * Starts as many as can safely go at once: the queue is walked in order, and a run joins the batch only if it clashes
 * with nothing already running and nothing else starting in the same batch. Anything held back keeps its place --
 * a workflow that waits does not lose its turn to one queued after it.
 */
export function schedule(queue: QueuedRun[], running: Running[], limit = 4): { start: QueuedRun[]; waiting: Blocked[] } {
  const order = [...queue].sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt)
  const start: QueuedRun[] = []
  const waiting: Blocked[] = []
  const busy: Running[] = [...running]

  for (const run of order) {
    if (busy.length >= limit) {
      waiting.push({ runId: run.runId, by: '', reason: `waiting for a free slot (${limit} workflows run at once)` })
      continue
    }
    const blocked = blockedBy(run, busy)
    if (blocked) {
      waiting.push(blocked)
      continue
    }
    start.push(run)
    busy.push({ runId: run.runId, workflowId: run.workflowId, resources: run.resources, profileId: run.profileId })
  }
  return { start, waiting }
}

/**
 * Whether a workflow is already running, for the runs that must not happen twice.
 *
 * A schedule that fires while the last run is still going, or somebody pressing Run twice, would otherwise send the
 * same consequential steps at the browser again. The answer is the run that is already going, so the caller can show
 * it rather than starting a second.
 */
export const alreadyRunning = (workflowId: string, profileId: string, running: Running[]): Running | null =>
  running.find((r) => r.workflowId === workflowId && r.profileId === profileId) ?? null
