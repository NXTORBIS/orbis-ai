/**
 * Whether a workflow still fits the Orbis it is about to run on.
 *
 * A workflow is written against a browser at a moment: these capabilities, with these parameters. Orbis then changes
 * under it. A capability is renamed, a parameter becomes required, a domain moves, a Skill the workflow calls is
 * deleted. The workflow keeps sitting in the library looking exactly as it did, and the next time it runs it fails
 * halfway through -- having already done the first four steps to somebody's real browser.
 *
 * So this answers three questions before anything runs:
 *
 *   - **What does it need?** Every capability, Skill and workflow it calls, gathered from the steps themselves.
 *   - **Is any of that missing?** Checked against what this Orbis actually has, now.
 *   - **Can it be repaired?** Only where the repair is certain. A capability that was plainly renamed can be renamed
 *     in the workflow; one that is simply gone cannot be guessed at, and saying so is the honest answer.
 *
 * Nothing here is applied on its own. A migration returns what it *would* change, and a person decides -- because a
 * workflow silently rewritten is one nobody can predict, and the steps it rewrites are steps that act on a real
 * browser.
 */

import type { CapabilityDescriptor } from './browserControl.ts'
import type { Workflow, WorkflowStep } from './workflows.ts'

export interface Dependency {
  kind: 'capability' | 'workflow' | 'skill'
  id: string
  /** Where it is used, so a missing one can be pointed at rather than merely counted. */
  steps: string[]
}

export interface Missing extends Dependency {
  /** Why it cannot be used: gone entirely, or present but unusable right now. */
  reason: 'absent' | 'unavailable'
  detail: string
}

/** Everything a workflow reaches outside itself, gathered from its own steps. */
export function dependencies(workflow: Workflow): Dependency[] {
  const found = new Map<string, Dependency>()
  const note = (kind: Dependency['kind'], id: string, step: string): void => {
    if (!id) return
    const key = `${kind}:${id}`
    const held = found.get(key)
    if (held) held.steps.push(step)
    else found.set(key, { kind, id, steps: [step] })
  }

  const walk = (steps: WorkflowStep[]): void => {
    for (const step of steps) {
      if (step.enabled === false) continue
      if (step.type === 'action') note('capability', step.capability, step.name)
      if (step.type === 'call') {
        // A called workflow is a dependency exactly as a capability is: missing, and this one cannot run either.
        const called = (step as { workflowId?: string }).workflowId
        if (typeof called === 'string') note('workflow', called, step.name)
      }
      if (step.type === 'if') {
        walk(step.then)
        walk(step.else ?? [])
        for (const branch of step.elseIf ?? []) walk(branch.steps)
      }
      if (step.type === 'repeat') walk(step.steps)
    }
  }
  walk(workflow.steps)
  return [...found.values()]
}

/**
 * What this workflow needs and this Orbis does not have.
 *
 * "Absent" and "unavailable" are kept apart because they mean different things to a person. A capability that no
 * longer exists needs the workflow changed. One that exists but cannot be used now -- no page in front, no browser
 * open -- needs nothing changed at all; it needs the right moment, and telling somebody to rewrite their workflow
 * would be wrong.
 */
export function missing(workflow: Workflow, capabilities: CapabilityDescriptor[], others: Workflow[] = []): Missing[] {
  const byId = new Map(capabilities.map((c) => [c.id, c]))
  const known = new Set(others.map((w) => w.id))
  const out: Missing[] = []

  for (const dependency of dependencies(workflow)) {
    if (dependency.kind === 'capability') {
      const capability = byId.get(dependency.id)
      if (!capability) {
        out.push({ ...dependency, reason: 'absent', detail: `This Orbis has no "${dependency.id}".` })
        continue
      }
      if (!capability.available) {
        out.push({ ...dependency, reason: 'unavailable', detail: capability.unavailableReason ?? `${capability.name} cannot be used right now.` })
      }
      continue
    }
    if (dependency.kind === 'workflow' && !known.has(dependency.id)) {
      out.push({ ...dependency, reason: 'absent', detail: 'The workflow this calls no longer exists.' })
    }
  }
  return out
}

/** Whether it can run at all right now, and what to say if not. */
export function runnable(workflow: Workflow, capabilities: CapabilityDescriptor[], others: Workflow[] = []): { ok: boolean; why: string } {
  const problems = missing(workflow, capabilities, others)
  const absent = problems.filter((p) => p.reason === 'absent')
  if (absent.length) {
    return { ok: false, why: `${absent.length === 1 ? 'A step uses' : `${absent.length} steps use`} something this Orbis no longer has: ${absent[0].detail}` }
  }
  const unavailable = problems.filter((p) => p.reason === 'unavailable')
  if (unavailable.length) return { ok: false, why: unavailable[0].detail }
  return { ok: true, why: '' }
}

// ---------------------------------------------------------------- repairing what can be repaired

export interface Change {
  step: string
  was: string
  now: string
  why: string
}

export interface Migration {
  /** What would change, exactly. Nothing is applied until somebody applies it. */
  changes: Change[]
  /** What could not be repaired, and why guessing would be worse than saying so. */
  unrepairable: Missing[]
  /** The workflow as it would be. Only useful when `changes` is non-empty. */
  migrated: Workflow
}

/** How sure a rename has to look before it is offered at all. */
const SURE = 0.82

/** How alike two capability ids are, for spotting one that was plainly renamed. */
function alike(a: string, b: string): number {
  const [aDomain = '', aAction = ''] = a.split('.')
  const [bDomain = '', bAction = ''] = b.split('.')
  const same = (x: string, y: string): number => {
    if (x === y) return 1
    const shorter = x.length < y.length ? x : y
    const longer = x.length < y.length ? y : x
    if (!shorter) return 0
    if (longer.includes(shorter)) return shorter.length / longer.length
    let shared = 0
    for (let i = 0; i < shorter.length && shorter[i] === longer[i]; i += 1) shared += 1
    return shared / longer.length
  }
  // The domain matters more: tabs.close becoming tabs.dismiss is plausible, tabs.close becoming page.close is not.
  return same(aDomain, bDomain) * 0.6 + same(aAction, bAction) * 0.4
}

/**
 * What would have to change for this workflow to run here, and what cannot be fixed.
 *
 * A rename is only proposed when one capability is clearly the successor -- the same domain, an obviously related
 * action, and no other candidate nearly as close. Where two are equally plausible, neither is offered: a workflow
 * pointed at the wrong one of two similar capabilities is worse than a workflow that refuses to run, because it runs.
 */
export function migrate(workflow: Workflow, capabilities: CapabilityDescriptor[], others: Workflow[] = []): Migration {
  const problems = missing(workflow, capabilities, others).filter((p) => p.reason === 'absent')
  const changes: Change[] = []
  const unrepairable: Missing[] = []
  const renames = new Map<string, string>()

  for (const problem of problems) {
    if (problem.kind !== 'capability') {
      unrepairable.push(problem)
      continue
    }
    const scored = capabilities
      .map((c) => ({ id: c.id, score: alike(problem.id, c.id) }))
      .sort((a, b) => b.score - a.score)
    const best = scored[0]
    const runnerUp = scored[1]
    // Confident, and confidently better than the next idea. Two plausible successors means no safe answer.
    if (best && best.score >= SURE && (!runnerUp || best.score - runnerUp.score >= 0.1)) {
      renames.set(problem.id, best.id)
      for (const step of problem.steps) {
        changes.push({ step, was: problem.id, now: best.id, why: `"${problem.id}" appears to have been renamed to "${best.id}".` })
      }
    } else {
      unrepairable.push(problem)
    }
  }

  const rewrite = (steps: WorkflowStep[]): WorkflowStep[] =>
    steps.map((step) => {
      if (step.type === 'action' && renames.has(step.capability)) {
        return { ...step, capability: renames.get(step.capability)! }
      }
      if (step.type === 'if') {
        return { ...step, then: rewrite(step.then), else: step.else ? rewrite(step.else) : step.else, elseIf: step.elseIf?.map((b) => ({ ...b, steps: rewrite(b.steps) })) }
      }
      if (step.type === 'repeat') return { ...step, steps: rewrite(step.steps) }
      return step
    })

  return {
    changes,
    unrepairable,
    migrated: changes.length ? { ...workflow, steps: rewrite(workflow.steps), updatedAt: Date.now() } : workflow
  }
}

/**
 * Which of a library's workflows an Orbis change has affected.
 *
 * Run after an update, so somebody learns that four of their workflows stopped working from Orbis rather than from
 * the first one failing at seven in the morning.
 */
export function affected(workflows: Workflow[], capabilities: CapabilityDescriptor[]): { workflow: Workflow; problems: Missing[] }[] {
  return workflows
    .map((workflow) => ({ workflow, problems: missing(workflow, capabilities, workflows).filter((p) => p.reason === 'absent') }))
    .filter((r) => r.problems.length > 0)
}
