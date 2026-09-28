/**
 * The problem-solving workspace: a goal broken into parts, the assumptions it rests on, and what changes when one of
 * them changes.
 *
 * `lab.ts` owns a graph of computations. This owns a graph of *reasoning*: goals, subproblems, assumptions,
 * hypotheses, decisions and the results that depend on them. The difference that matters is the assumption register --
 * a first-class list of the things being taken for granted, each linked to what rests on it, so "what if this is
 * wrong" has an answer rather than requiring somebody to remember.
 *
 * ## An assumption nobody wrote down
 *
 * The failure this is built against is the assumption that never became a record: a rate somebody guessed in week one
 * and everything since has been built on. `dependents` walks the graph from an assumption, so changing one shows what
 * it reaches before anything is recomputed.
 *
 * ## Approaches are kept, not replaced
 *
 * Two ways of solving the same subproblem both stay, with their results side by side. Replacing the first with the
 * second loses the comparison, which is usually the most informative thing in the workspace.
 */

export interface WorkspaceError {
  error: string
  message: string
}

export const isWorkspaceError = (value: unknown): value is WorkspaceError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): WorkspaceError => ({ error, message })

export const WORKSPACE_LIMITS: Readonly<Record<'nodes' | 'links' | 'depth' | 'approaches', number>> = Object.freeze({
  nodes: 20_000,
  links: 100_000,
  depth: 32,
  approaches: 20
})

// ---------------------------------------------------------------- nodes

export type NodeKind =
  | 'goal'
  | 'question'
  | 'subproblem'
  | 'assumption'
  | 'constraint'
  | 'input'
  | 'calculation'
  | 'experiment'
  | 'evidence'
  | 'hypothesis'
  | 'decision'
  | 'result'
  | 'conclusion'
  | 'note'

export type NodeState = 'open' | 'in-progress' | 'answered' | 'blocked' | 'stale' | 'abandoned'

export interface WorkNode {
  id: string
  kind: NodeKind
  title: string
  detail: string
  state: NodeState
  /** Which approach this belongs to, where a subproblem has more than one. `null` for the only way. */
  approachId: string | null
  /** A value this node produced, where it produced one. */
  value: number | string | null
  unit: string
  /** A fingerprint of what this was computed from, which is what makes staleness detectable. */
  computedFrom: string
  owner: string
}

export type LinkKind = 'feeds' | 'depends-on' | 'supports' | 'contradicts' | 'answers' | 'produces' | 'compares-with' | 'part-of'

export interface Link {
  id: string
  from: string
  to: string
  kind: LinkKind
}

export interface Workspace {
  id: string
  title: string
  nodes: WorkNode[]
  links: Link[]
}

export const emptyWorkspace = (id: string, title: string): Workspace => ({ id, title, nodes: [], links: [] })

// ---------------------------------------------------------------- structure

export interface StructureProblem {
  kind: 'missing-node' | 'cycle' | 'duplicate' | 'orphan-subproblem' | 'unanswered-goal' | 'too-large'
  ids: string[]
  describe: string
  blocking: boolean
}

export interface Structure {
  ok: boolean
  problems: StructureProblem[]
  /** Subproblems that nothing depends on and that answer nothing. Work that may have stopped mattering. */
  detached: string[]
  notes: string[]
}

/** Whether the workspace holds together. A cycle in the computation links has no order and is refused. */
export function checkStructure(workspace: Workspace): Structure {
  const problems: StructureProblem[] = []
  const byId = new Map<string, WorkNode>()

  if (workspace.nodes.length > WORKSPACE_LIMITS.nodes) {
    problems.push({ kind: 'too-large', ids: [], describe: `This workspace has ${workspace.nodes.length.toLocaleString('en')} nodes, past the ${WORKSPACE_LIMITS.nodes.toLocaleString('en')} allowed.`, blocking: true })
  }

  for (const node of workspace.nodes) {
    if (byId.has(node.id)) {
      problems.push({ kind: 'duplicate', ids: [node.id], describe: `There are two nodes with the id "${node.id}".`, blocking: true })
    }
    byId.set(node.id, node)
  }

  for (const link of workspace.links) {
    if (!byId.has(link.from) || !byId.has(link.to)) {
      problems.push({
        kind: 'missing-node',
        ids: [link.from, link.to].filter((one) => !byId.has(one)),
        describe: 'A link refers to a node that is not in the workspace.',
        blocking: true
      })
    }
  }

  // Only the flow links can cycle meaningfully; a supporting or contradicting loop is a shape reasoning really has.
  const cycle = findCycle(workspace, ['feeds', 'depends-on', 'produces'])
  if (cycle) {
    problems.push({
      kind: 'cycle',
      ids: cycle,
      describe: `${cycle.map((id) => byId.get(id)?.title ?? id).join(' -> ')} depend on each other in a circle, so none of them can be worked out first.`,
      blocking: true
    })
  }

  const usedBy = new Set(workspace.links.map((one) => one.from))
  const answering = new Set(workspace.links.filter((one) => one.kind === 'answers' || one.kind === 'part-of').map((one) => one.from))
  const detached = workspace.nodes
    .filter((one) => one.kind === 'subproblem' && one.state !== 'abandoned' && !usedBy.has(one.id) && !answering.has(one.id))
    .map((one) => one.id)

  const goals = workspace.nodes.filter((one) => one.kind === 'goal')
  const answered = new Set(workspace.links.filter((one) => one.kind === 'answers').map((one) => one.to))
  for (const goal of goals) {
    if (!answered.has(goal.id)) {
      problems.push({
        kind: 'unanswered-goal',
        ids: [goal.id],
        describe: `"${goal.title}" has nothing answering it yet.`,
        blocking: false
      })
    }
  }

  const notes: string[] = []
  if (detached.length > 0) {
    notes.push(
      `${detached.length} subproblem${detached.length === 1 ? '' : 's'} feed nothing and answer nothing. That is often work that mattered when it was started and no longer does, which is worth noticing before more goes into it.`
    )
  }

  return { ok: !problems.some((one) => one.blocking), problems, detached, notes }
}

function findCycle(workspace: Workspace, kinds: readonly LinkKind[]): string[] | null {
  const edges = new Map<string, string[]>()
  for (const link of workspace.links) {
    if (!kinds.includes(link.kind)) continue
    const list = edges.get(link.from) ?? []
    list.push(link.to)
    edges.set(link.from, list)
  }

  const colour = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  let found: string[] | null = null

  const visit = (id: string, depth: number): boolean => {
    if (depth > WORKSPACE_LIMITS.depth) return false
    colour.set(id, 1)
    stack.push(id)
    for (const next of edges.get(id) ?? []) {
      if (colour.get(next) === 1) {
        found = [...stack.slice(stack.indexOf(next)), next]
        return true
      }
      if ((colour.get(next) ?? 0) === 0 && visit(next, depth + 1)) return true
    }
    colour.set(id, 2)
    stack.pop()
    return false
  }

  for (const node of workspace.nodes) {
    if ((colour.get(node.id) ?? 0) === 0 && visit(node.id, 0)) break
  }
  return found
}

// ---------------------------------------------------------------- assumptions

export interface AssumptionEntry {
  id: string
  title: string
  detail: string
  /** Everything that rests on it, directly or through a chain. */
  dependents: string[]
  /** How many results rest on it, which is what makes one assumption more load-bearing than another. */
  resultsAffected: number
  /** Whether somebody has looked at it since it was written. */
  reviewed: boolean
  describe: string
}

/**
 * The assumption register: every assumption, and everything that rests on it.
 *
 * Walking forward from the assumption rather than backward from the result, because the question people ask is
 * "what breaks if this is wrong", and the answer has to be complete. A partial answer here is worse than none: it
 * suggests the blast radius has been checked.
 */
export function assumptionRegister(workspace: Workspace): AssumptionEntry[] {
  const byId = new Map(workspace.nodes.map((one) => [one.id, one]))
  const forward = new Map<string, string[]>()
  for (const link of workspace.links) {
    if (link.kind === 'contradicts' || link.kind === 'compares-with') continue
    const list = forward.get(link.from) ?? []
    list.push(link.to)
    forward.set(link.from, list)
  }

  return workspace.nodes
    .filter((one) => one.kind === 'assumption')
    .map((assumption) => {
      const seen = new Set<string>()
      const stack = [...(forward.get(assumption.id) ?? [])]
      let guard = 0
      while (stack.length > 0 && guard < WORKSPACE_LIMITS.nodes) {
        guard += 1
        const id = stack.pop() as string
        if (seen.has(id)) continue
        seen.add(id)
        stack.push(...(forward.get(id) ?? []))
      }

      const dependents = [...seen].sort()
      const resultsAffected = dependents.filter((id) => {
        const kind = byId.get(id)?.kind
        return kind === 'result' || kind === 'conclusion' || kind === 'decision'
      }).length

      return {
        id: assumption.id,
        title: assumption.title,
        detail: assumption.detail,
        dependents,
        resultsAffected,
        reviewed: assumption.state === 'answered',
        describe:
          dependents.length === 0
            ? `Nothing rests on "${assumption.title}" yet.`
            : `${dependents.length} node${dependents.length === 1 ? '' : 's'} rest on "${assumption.title}", including ${resultsAffected} result${resultsAffected === 1 ? '' : 's'}. If it is wrong, all of them are.`
      }
    })
    .sort((a, b) => b.resultsAffected - a.resultsAffected || a.title.localeCompare(b.title))
}

export interface Sensitivity {
  assumptionId: string
  assumptionTitle: string
  /** What would have to be rechecked, in the order it would have to happen. */
  wouldRecheck: string[]
  resultsAffected: number
  /** Whether anything at all rests on it. An assumption nothing rests on is one to remove or use. */
  loadBearing: boolean
  describe: string
}

/** What changing one assumption would reach, computed before anything is recomputed. */
export function ifAssumptionChanged(workspace: Workspace, assumptionId: string): Sensitivity | WorkspaceError {
  const assumption = workspace.nodes.find((one) => one.id === assumptionId)
  if (!assumption) return fail('not-found', `There is no node with the id "${assumptionId}".`)
  if (assumption.kind !== 'assumption') {
    return fail('wrong-kind', `"${assumption.title}" is a ${assumption.kind}, not an assumption.`)
  }

  const entry = assumptionRegister(workspace).find((one) => one.id === assumptionId)
  if (!entry) return fail('not-found', 'That assumption is not in the register.')

  const ordered = topologicalOrder(workspace)
  const position = new Map((isWorkspaceError(ordered) ? [] : ordered).map((id, i) => [id, i]))
  const wouldRecheck = [...entry.dependents].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0))

  return {
    assumptionId,
    assumptionTitle: assumption.title,
    wouldRecheck,
    resultsAffected: entry.resultsAffected,
    loadBearing: entry.dependents.length > 0,
    describe:
      entry.dependents.length === 0
        ? `Nothing rests on "${assumption.title}". Either it is not being used, or something that should depend on it is not linked to it -- and the second is more likely than it sounds.`
        : `Changing "${assumption.title}" would mean rechecking ${wouldRecheck.length} node${wouldRecheck.length === 1 ? '' : 's'}, of which ${entry.resultsAffected} ${entry.resultsAffected === 1 ? 'is a result' : 'are results'}. They are listed in the order they would have to be redone.`
  }
}

/** The order nodes can be worked out in, following the flow links. */
export function topologicalOrder(workspace: Workspace): string[] | WorkspaceError {
  const flow: LinkKind[] = ['feeds', 'depends-on', 'produces', 'part-of']
  const incoming = new Map<string, Set<string>>()
  for (const node of workspace.nodes) incoming.set(node.id, new Set())
  for (const link of workspace.links) {
    if (!flow.includes(link.kind)) continue
    if (!incoming.has(link.to) || !incoming.has(link.from)) continue
    incoming.get(link.to)?.add(link.from)
  }

  const order: string[] = []
  const done = new Set<string>()
  const ready = workspace.nodes.filter((one) => (incoming.get(one.id)?.size ?? 0) === 0).map((one) => one.id).sort()

  while (ready.length > 0) {
    const id = ready.shift() as string
    if (done.has(id)) continue
    done.add(id)
    order.push(id)
    const next: string[] = []
    for (const link of workspace.links) {
      if (!flow.includes(link.kind) || link.from !== id) continue
      const set = incoming.get(link.to)
      if (!set) continue
      set.delete(id)
      if (set.size === 0 && !done.has(link.to)) next.push(link.to)
    }
    next.sort()
    ready.push(...next)
  }

  if (order.length !== workspace.nodes.length) {
    const stuck = workspace.nodes.filter((one) => !done.has(one.id))
    return fail('cycle', `These depend on each other in a circle: ${stuck.map((one) => one.title).join(', ')}.`)
  }
  return order
}

// ---------------------------------------------------------------- staleness

export interface Staleness {
  current: string[]
  stale: string[]
  /** Why each stale node is stale, traced to the change rather than only reported. */
  reasons: { nodeId: string; because: string }[]
  /** Nodes downstream of something that failed or was abandoned. */
  blocked: string[]
}

/**
 * Which results still follow from what they were computed from.
 *
 * The fingerprint on each node is compared with what it would be now, which is the same mechanism the lab runtime
 * uses. Here it matters for a different reason: in a reasoning workspace the thing that changed is usually an
 * assumption somebody revisited, and the results resting on it look exactly as authoritative as they did before.
 */
export function assessStaleness(workspace: Workspace, fingerprintOf: (node: WorkNode, upstream: readonly string[]) => string): Staleness | WorkspaceError {
  const order = topologicalOrder(workspace)
  if (isWorkspaceError(order)) return order

  const byId = new Map(workspace.nodes.map((one) => [one.id, one]))
  const fingerprints = new Map<string, string>()
  const current: string[] = []
  const stale: string[] = []
  const blocked: string[] = []
  const reasons: Staleness['reasons'] = []
  const broken = new Set<string>()

  const flow: LinkKind[] = ['feeds', 'depends-on', 'produces', 'part-of']

  for (const id of order) {
    const node = byId.get(id)
    if (!node) continue

    const upstream = workspace.links
      .filter((one) => flow.includes(one.kind) && one.to === id)
      .map((one) => fingerprints.get(one.from) ?? '')
      .filter((one) => one !== '')
      .sort()

    const upstreamBroken = workspace.links.some((one) => flow.includes(one.kind) && one.to === id && broken.has(one.from))
    if (upstreamBroken) {
      blocked.push(id)
      broken.add(id)
      reasons.push({ nodeId: id, because: `Something "${node.title}" depends on is blocked or abandoned, so it cannot be worked out.` })
      fingerprints.set(id, fingerprintOf(node, upstream))
      continue
    }
    if (node.state === 'blocked' || node.state === 'abandoned') {
      broken.add(id)
      blocked.push(id)
      fingerprints.set(id, fingerprintOf(node, upstream))
      continue
    }

    const want = fingerprintOf(node, upstream)
    fingerprints.set(id, want)

    // A node with nothing recorded has not been computed rather than gone stale.
    if (node.computedFrom === '') continue

    if (node.computedFrom === want) {
      current.push(id)
      continue
    }
    stale.push(id)

    const changedUpstream = workspace.links
      .filter((one) => flow.includes(one.kind) && one.to === id && stale.includes(one.from))
      .map((one) => byId.get(one.from)?.title ?? one.from)

    reasons.push({
      nodeId: id,
      because:
        changedUpstream.length > 0
          ? `${changedUpstream.join(', ')} changed, so "${node.title}" no longer follows from what it was worked out from.`
          : `"${node.title}" itself changed since it was worked out.`
    })
  }

  return { current, stale, reasons, blocked }
}

// ---------------------------------------------------------------- approaches

export interface Approach {
  id: string
  subproblemId: string
  name: string
  describe: string
  /** The node holding this approach's answer. */
  resultId: string | null
}

export interface ApproachComparison {
  subproblemId: string
  approaches: { id: string; name: string; value: number | string | null; unit: string; state: NodeState }[]
  /** Whether the numeric answers agree to a stated tolerance. */
  agree: boolean | null
  spread: number | null
  describe: string
}

/**
 * Several approaches to one subproblem, compared.
 *
 * Both are kept. Two methods agreeing is real evidence that neither has a mistake in it; two disagreeing is the most
 * informative thing in the workspace, and replacing the first approach with the second would have thrown it away.
 */
export function compareApproaches(workspace: Workspace, approaches: readonly Approach[], subproblemId: string, tolerance = 1e-6): ApproachComparison | WorkspaceError {
  const mine = approaches.filter((one) => one.subproblemId === subproblemId)
  if (mine.length === 0) return fail('not-found', `There are no approaches to "${subproblemId}".`)
  if (mine.length > WORKSPACE_LIMITS.approaches) return fail('too-many', `At most ${WORKSPACE_LIMITS.approaches} approaches to one subproblem.`)

  const byId = new Map(workspace.nodes.map((one) => [one.id, one]))
  const entries = mine.map((one) => {
    const node = one.resultId === null ? undefined : byId.get(one.resultId)
    return { id: one.id, name: one.name, value: node?.value ?? null, unit: node?.unit ?? '', state: node?.state ?? ('open' as NodeState) }
  })

  const numeric = entries.map((one) => one.value).filter((one): one is number => typeof one === 'number')
  if (numeric.length < 2) {
    return {
      subproblemId,
      approaches: entries,
      agree: null,
      spread: null,
      describe:
        numeric.length === 0
          ? `${entries.length} approach${entries.length === 1 ? '' : 'es'} to this, none of which has produced a number yet.`
          : `Only one approach has produced a number, so there is nothing to compare it against. A second method is the cheapest check there is.`
    }
  }

  const spread = Math.max(...numeric) - Math.min(...numeric)
  const scale = Math.max(1, ...numeric.map(Math.abs))
  const agree = spread <= tolerance * scale

  return {
    subproblemId,
    approaches: entries,
    agree,
    spread,
    describe: agree
      ? `${numeric.length} approaches agree to within ${Number(spread.toPrecision(3))}. Independent methods agreeing is real evidence that neither has a mistake in it, although they can still share an assumption.`
      : `${numeric.length} approaches disagree, spanning ${Number(spread.toPrecision(6))}. At least one is wrong, and both are kept: which is which is the most informative question here, and averaging them would produce a third answer that is also wrong.`
  }
}

// ---------------------------------------------------------------- reporting

export interface Report {
  title: string
  sections: { heading: string; body: string[]; nodeIds: string[] }[]
  /** Everything the report says that is not fully supported. Never left out to make it read better. */
  caveats: string[]
}

/**
 * A report built from the workspace as it stands.
 *
 * Every section is assembled from real nodes and lists the ids it came from, so a reader can get back to the working.
 * The caveats are built from the same state, which is what stops a report reading as more settled than the workspace
 * it came from.
 */
export function buildReport(workspace: Workspace, staleness: Staleness | null = null): Report {
  const byKind = (kind: NodeKind): WorkNode[] => workspace.nodes.filter((one) => one.kind === kind && one.state !== 'abandoned')
  const sections: Report['sections'] = []
  const caveats: string[] = []

  const goals = byKind('goal')
  if (goals.length > 0) {
    sections.push({ heading: 'The problem', body: goals.map((one) => `${one.title}${one.detail ? `. ${one.detail}` : ''}`), nodeIds: goals.map((one) => one.id) })
  }

  const assumptions = byKind('assumption')
  if (assumptions.length > 0) {
    const register = assumptionRegister(workspace)
    sections.push({
      heading: 'Assumptions',
      body: register.map((one) => `${one.title}${one.detail ? ` -- ${one.detail}` : ''} (${one.resultsAffected} result${one.resultsAffected === 1 ? '' : 's'} rest on it)`),
      nodeIds: assumptions.map((one) => one.id)
    })
    const unreviewed = register.filter((one) => !one.reviewed && one.resultsAffected > 0)
    if (unreviewed.length > 0) {
      caveats.push(
        `${unreviewed.length} assumption${unreviewed.length === 1 ? '' : 's'} that results rest on ${unreviewed.length === 1 ? 'has' : 'have'} not been reviewed since ${unreviewed.length === 1 ? 'it was' : 'they were'} written: ${unreviewed.map((one) => one.title).join(', ')}.`
      )
    }
  }

  const constraints = byKind('constraint')
  if (constraints.length > 0) {
    sections.push({ heading: 'Constraints', body: constraints.map((one) => one.title), nodeIds: constraints.map((one) => one.id) })
  }

  const results = byKind('result')
  if (results.length > 0) {
    sections.push({
      heading: 'Results',
      body: results.map((one) => `${one.title}: ${one.value === null ? 'not yet worked out' : `${one.value}${one.unit ? ` ${one.unit}` : ''}`}`),
      nodeIds: results.map((one) => one.id)
    })
  }

  const hypotheses = byKind('hypothesis')
  if (hypotheses.length > 0) {
    sections.push({ heading: 'Hypotheses', body: hypotheses.map((one) => `${one.title} (${one.state})`), nodeIds: hypotheses.map((one) => one.id) })
  }

  const conclusions = byKind('conclusion')
  if (conclusions.length > 0) {
    sections.push({ heading: 'Conclusions', body: conclusions.map((one) => `${one.title}${one.detail ? `. ${one.detail}` : ''}`), nodeIds: conclusions.map((one) => one.id) })
  }

  const open = workspace.nodes.filter((one) => (one.kind === 'question' || one.kind === 'subproblem') && one.state === 'open')
  if (open.length > 0) {
    caveats.push(`${open.length} question${open.length === 1 ? ' or subproblem is' : 's or subproblems are'} still open: ${open.map((one) => one.title).join(', ')}.`)
  }

  if (staleness && staleness.stale.length > 0) {
    const byId = new Map(workspace.nodes.map((one) => [one.id, one]))
    caveats.push(
      `${staleness.stale.length} node${staleness.stale.length === 1 ? '' : 's'} no longer follow from what they were worked out from: ${staleness.stale.map((id) => byId.get(id)?.title ?? id).join(', ')}. Anything in this report that rests on ${staleness.stale.length === 1 ? 'it' : 'them'} is out of date.`
    )
  }
  if (staleness && staleness.blocked.length > 0) {
    caveats.push(`${staleness.blocked.length} node${staleness.blocked.length === 1 ? ' is' : 's are'} blocked, so anything depending on ${staleness.blocked.length === 1 ? 'it' : 'them'} is missing from this report.`)
  }

  const contradicting = workspace.links.filter((one) => one.kind === 'contradicts')
  if (contradicting.length > 0) {
    caveats.push(`${contradicting.length} pair${contradicting.length === 1 ? '' : 's'} in this workspace contradict each other, and nothing here resolves them.`)
  }

  if (conclusions.length === 0 && results.length > 0) {
    caveats.push('There are results and no conclusion drawn from them. The report says what was found, not what it means.')
  }

  return { title: workspace.title, sections, caveats }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const WORKSPACE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Assumptions are first-class records, each linked to everything that rests on it.',
  'What changing an assumption would reach is computed from the graph before anything is recomputed.',
  'An assumption nothing rests on is reported, because the usual reason is a missing link rather than an unused assumption.',
  'Two approaches to the same subproblem are both kept. Replacing one with the other loses the comparison.',
  'Two approaches disagreeing is the most informative thing in the workspace, and averaging them is refused.',
  'A result is marked stale when what it was worked out from changes; it looks exactly as authoritative either way.',
  'A node blocked by something upstream is blocked, not wrong.',
  'A report carries the caveats built from the workspace state, so it never reads as more settled than the work behind it.'
])
