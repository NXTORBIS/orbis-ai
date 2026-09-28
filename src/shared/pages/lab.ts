/**
 * The computational laboratory: a graph of nodes, and what it takes to run one honestly.
 *
 * A laboratory project is a dependency graph whose nodes are calls into the engines that already exist. This file owns
 * the graph, not the computation: validation, ordering, staleness, caching, checkpoints and the vocabulary of states.
 * The engines stay where they are, and the runtime never approximates one of them.
 *
 * ## Staleness is the reason this exists
 *
 * A node's result belongs to the inputs it was computed from. Change one and everything downstream is no longer an
 * answer to anything -- and the failure mode is silent, because a stale chart looks exactly like a current one. So
 * every result carries a fingerprint of what produced it, and `markStale` walks the graph rather than guessing.
 *
 * ## Ordering is computed, not drawn
 *
 * The order nodes run in comes from the edges, never from where they sit on a canvas. Two nodes that do not depend on
 * each other may run in either order or together, and `planExecution` says which groups those are.
 *
 * ## A cycle is refused before anything starts
 *
 * Not detected partway through. A graph with a cycle has no valid order, and discovering that after three expensive
 * nodes have run is strictly worse than discovering it before the first one.
 */

export interface LabError {
  error: string
  message: string
  /** What the person can do about it. Never "try again"; always something specific to this failure. */
  recovery: string
}

export const isLabError = (value: unknown): value is LabError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value && 'recovery' in value

const fail = (error: string, message: string, recovery: string): LabError => ({ error, message, recovery })

export const LAB_LIMITS: Readonly<
  Record<'nodes' | 'edges' | 'depth' | 'outputBytes' | 'checkpoints' | 'runs' | 'retries' | 'concurrent', number>
> = Object.freeze({
  nodes: 500,
  edges: 2_000,
  depth: 64,
  outputBytes: 64 * 1024 * 1024,
  checkpoints: 50,
  runs: 200,
  retries: 5,
  concurrent: 8
})

// ---------------------------------------------------------------- values and types

export type ValueKind =
  | 'number'
  | 'integer'
  | 'text'
  | 'boolean'
  | 'quantity'
  | 'vector'
  | 'matrix'
  | 'table'
  | 'document'
  | 'distribution'
  | 'series'
  | 'plot'
  | 'result'

/** A typed slot on a node. Units are part of the type for a quantity, which is what makes a connection checkable. */
export interface Port {
  id: string
  name: string
  kind: ValueKind
  /** For a quantity: the unit it expects. Empty means any unit of any dimension, which is rarely right. */
  unit: string
  required: boolean
  describe: string
}

/**
 * Which value kinds may flow into which, and what the conversion is called.
 *
 * Deliberately sparse. An integer is a number, a number is a one-element vector only if somebody says so explicitly,
 * and text is never silently a number -- a table of text that becomes numbers because a connection allowed it is a
 * dataset that has been changed by being plugged in.
 */
const CONVERSIONS: Readonly<Record<string, string>> = Object.freeze({
  'integer->number': 'An integer is a number.',
  'number->quantity': 'A plain number becomes a quantity in the unit the input expects. Say so explicitly if that is what you mean.',
  'quantity->number': 'A quantity becomes a plain number, losing its unit.',
  'vector->matrix': 'A vector becomes a matrix with one column.',
  'series->plot': 'A series becomes something a plot can draw.',
  'table->series': 'A column of a table becomes a series.'
})

export interface ConnectionCheck {
  ok: boolean
  /** The named conversion, when one is needed. `null` when the kinds match exactly. */
  conversion: string | null
  /** True when the conversion loses something. A lossy conversion is allowed, and says what it costs. */
  lossy: boolean
  message: string
}

/**
 * Whether one port's output can reach another's input.
 *
 * A mismatch is refused rather than coerced. "Text into a matrix" has no meaning that the runtime could choose on
 * somebody's behalf, and choosing one would produce a graph that runs and computes the wrong thing.
 */
export function checkConnection(from: Port, to: Port): ConnectionCheck {
  if (from.kind === to.kind) {
    if (from.kind === 'quantity' && from.unit !== '' && to.unit !== '' && from.unit !== to.unit) {
      return {
        ok: true,
        conversion: `${from.unit}->${to.unit}`,
        lossy: false,
        message: `The value will be converted from ${from.unit} to ${to.unit}. If those are not the same kind of thing, the conversion will fail when it runs.`
      }
    }
    return { ok: true, conversion: null, lossy: false, message: `Both sides are ${from.kind}.` }
  }

  const key = `${from.kind}->${to.kind}`
  if (Object.prototype.hasOwnProperty.call(CONVERSIONS, key)) {
    const lossy = key === 'quantity->number' || key === 'table->series'
    return { ok: true, conversion: key, lossy, message: CONVERSIONS[key] }
  }

  return {
    ok: false,
    conversion: null,
    lossy: false,
    message: `A ${from.kind} cannot be connected to a ${to.kind}. There is no conversion between them that Orbis could choose for you, and guessing one would mean the graph runs and computes something you did not ask for.`
  }
}

// ---------------------------------------------------------------- nodes

export type NodeKind =
  | 'input'
  | 'expression'
  | 'equation'
  | 'dataset'
  | 'transform'
  | 'statistics'
  | 'simulation'
  | 'optimise'
  | 'uncertainty'
  | 'study'
  | 'document'
  | 'plot'
  | 'export'

export type NodeStatus =
  | 'idle'
  | 'ready'
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale'
  /** An input failed, so this node cannot run. Distinct from failing itself, which it never got the chance to do. */
  | 'blocked'

export interface LabNode {
  id: string
  kind: NodeKind
  name: string
  /** The engine operation this node calls, as a dotted name. The runtime never computes anything itself. */
  operation: string
  /** Arguments that are not wired from another node. */
  configuration: Record<string, unknown>
  inputs: Port[]
  outputs: Port[]
  status: NodeStatus
  /** Whether the same configuration always gives the same answer. Recorded, never inferred from the operation name. */
  deterministic: boolean
  /** For a node that is not deterministic. `null` where none was set, which makes the run unrepeatable and says so. */
  seed: number | null
  /** An estimate the caller supplies, used to plan and to warn. Not a measurement. */
  cost: { calls: number; memoryBytes: number }
  retryPolicy: { attempts: number; onlyWhen: 'never' | 'transient' | 'always' }
  optional: boolean
}

export interface Edge {
  id: string
  from: { nodeId: string; portId: string }
  to: { nodeId: string; portId: string }
}

export interface LabProject {
  id: string
  name: string
  pageId: string
  profileId: string
  workspaceId: string
  nodes: LabNode[]
  edges: Edge[]
  /** Values shared across nodes, typed. */
  variables: Record<string, { kind: ValueKind; unit: string; value: unknown }>
  /** Bumped whenever the graph changes shape, so results from an earlier shape are recognisable as such. */
  version: number
  engineVersions: Record<string, string>
}

export const emptyProject = (id: string, name: string, pageId: string, profileId: string, workspaceId = ''): LabProject => ({
  id,
  name,
  pageId,
  profileId,
  workspaceId,
  nodes: [],
  edges: [],
  variables: {},
  version: 1,
  engineVersions: {}
})

// ---------------------------------------------------------------- graph validation

export interface GraphProblem {
  kind: 'cycle' | 'missing-node' | 'missing-port' | 'type-mismatch' | 'unconnected-required' | 'duplicate' | 'too-large' | 'too-deep'
  nodeIds: string[]
  describe: string
  /** A blocker stops the graph running at all; a warning does not. */
  blocking: boolean
}

export interface GraphCheck {
  ok: boolean
  problems: GraphProblem[]
  /** The conversions the graph relies on, so a lossy one is visible before anything runs. */
  conversions: { edgeId: string; conversion: string; lossy: boolean; describe: string }[]
  notes: string[]
}

/**
 * Whether a graph can be run at all.
 *
 * Every check is here rather than spread through execution, because the whole point is to find out before the first
 * expensive node rather than after the third one. A cycle in particular has to be found here: there is no order that
 * satisfies it, so there is no partial run that makes sense.
 */
export function checkGraph(project: LabProject): GraphCheck {
  const problems: GraphProblem[] = []
  const conversions: GraphCheck['conversions'] = []
  const notes: string[] = []

  if (project.nodes.length > LAB_LIMITS.nodes) {
    problems.push({
      kind: 'too-large',
      nodeIds: [],
      describe: `This project has ${project.nodes.length} nodes, past the ${LAB_LIMITS.nodes} a laboratory holds.`,
      blocking: true
    })
  }
  if (project.edges.length > LAB_LIMITS.edges) {
    problems.push({ kind: 'too-large', nodeIds: [], describe: `This project has ${project.edges.length} connections, past the ${LAB_LIMITS.edges} allowed.`, blocking: true })
  }

  const byId = new Map<string, LabNode>()
  for (const node of project.nodes) {
    if (byId.has(node.id)) {
      problems.push({ kind: 'duplicate', nodeIds: [node.id], describe: `There are two nodes with the id "${node.id}".`, blocking: true })
    }
    byId.set(node.id, node)
  }

  const filled = new Map<string, Set<string>>()
  for (const edge of project.edges) {
    const from = byId.get(edge.from.nodeId)
    const to = byId.get(edge.to.nodeId)
    if (!from || !to) {
      problems.push({
        kind: 'missing-node',
        nodeIds: [edge.from.nodeId, edge.to.nodeId].filter((one) => !byId.has(one)),
        describe: `A connection refers to a node that is not in the project.`,
        blocking: true
      })
      continue
    }
    const fromPort = from.outputs.find((one) => one.id === edge.from.portId)
    const toPort = to.inputs.find((one) => one.id === edge.to.portId)
    if (!fromPort || !toPort) {
      problems.push({
        kind: 'missing-port',
        nodeIds: [from.id, to.id],
        describe: `A connection between "${from.name}" and "${to.name}" refers to a port that does not exist.`,
        blocking: true
      })
      continue
    }

    const check = checkConnection(fromPort, toPort)
    if (!check.ok) {
      problems.push({ kind: 'type-mismatch', nodeIds: [from.id, to.id], describe: `"${from.name}" to "${to.name}": ${check.message}`, blocking: true })
      continue
    }
    if (check.conversion) {
      conversions.push({ edgeId: edge.id, conversion: check.conversion, lossy: check.lossy, describe: check.message })
    }

    const set = filled.get(to.id) ?? new Set<string>()
    set.add(toPort.id)
    filled.set(to.id, set)
  }

  for (const node of project.nodes) {
    for (const port of node.inputs) {
      if (!port.required) continue
      const wired = filled.get(node.id)?.has(port.id) ?? false
      // A required input may be wired or supplied in the configuration; either is fine, neither is not.
      const configured = Object.prototype.hasOwnProperty.call(node.configuration, port.id)
      if (!wired && !configured) {
        problems.push({
          kind: 'unconnected-required',
          nodeIds: [node.id],
          describe: `"${node.name}" needs ${port.name}, and nothing supplies it.`,
          blocking: true
        })
      }
    }
  }

  const ordered = topologicalOrder(project)
  if (isLabError(ordered)) {
    problems.push({ kind: 'cycle', nodeIds: [], describe: ordered.message, blocking: true })
  } else {
    const depth = depthOf(project, ordered)
    if (depth > LAB_LIMITS.depth) {
      problems.push({ kind: 'too-deep', nodeIds: [], describe: `The longest chain is ${depth} nodes, past the ${LAB_LIMITS.depth} allowed.`, blocking: true })
    }
  }

  const lossy = conversions.filter((one) => one.lossy)
  if (lossy.length > 0) {
    notes.push(`${lossy.length} connection${lossy.length === 1 ? '' : 's'} loses something on the way through: ${lossy.map((one) => one.describe).join(' ')}`)
  }
  const unseeded = project.nodes.filter((one) => !one.deterministic && one.seed === null)
  if (unseeded.length > 0) {
    notes.push(
      `${unseeded.map((one) => one.name).join(', ')} ${unseeded.length === 1 ? 'is' : 'are'} not deterministic and ${unseeded.length === 1 ? 'has' : 'have'} no seed. Running the project again will give a different answer, and it cannot be reproduced.`
    )
  }

  return { ok: !problems.some((one) => one.blocking), problems, conversions, notes }
}

/**
 * The order nodes can run in, or the cycle that stops there being one.
 *
 * Kahn's algorithm. The nodes left over when it stops are exactly the ones in a cycle, which is what the message names
 * -- "there is a cycle somewhere" is not something anybody can act on.
 */
export function topologicalOrder(project: LabProject): string[] | LabError {
  const byId = new Map(project.nodes.map((one) => [one.id, one]))
  const incoming = new Map<string, Set<string>>()
  for (const node of project.nodes) incoming.set(node.id, new Set())
  for (const edge of project.edges) {
    if (!byId.has(edge.from.nodeId) || !byId.has(edge.to.nodeId)) continue
    // A self-edge is its own cycle, and has to be counted as one rather than skipped.
    incoming.get(edge.to.nodeId)?.add(edge.from.nodeId)
  }

  const order: string[] = []
  const ready = project.nodes.filter((one) => (incoming.get(one.id)?.size ?? 0) === 0).map((one) => one.id)
  // Sorted, so the order is stable between runs and two runs of the same project are comparable.
  ready.sort()

  const done = new Set<string>()
  while (ready.length > 0) {
    const id = ready.shift() as string
    if (done.has(id)) continue
    done.add(id)
    order.push(id)
    const next: string[] = []
    for (const edge of project.edges) {
      if (edge.from.nodeId !== id) continue
      const set = incoming.get(edge.to.nodeId)
      if (!set) continue
      set.delete(id)
      if (set.size === 0 && !done.has(edge.to.nodeId)) next.push(edge.to.nodeId)
    }
    next.sort()
    ready.push(...next)
  }

  if (order.length !== project.nodes.length) {
    const stuck = project.nodes.filter((one) => !done.has(one.id))
    return fail(
      'cycle',
      `These nodes depend on each other in a circle, so there is no order they could run in: ${stuck.map((one) => one.name).join(', ')}.`,
      'Remove one of the connections between them. A laboratory graph runs in one direction; a loop needs a node that iterates internally instead.'
    )
  }
  return order
}

const depthOf = (project: LabProject, order: readonly string[]): number => {
  const depth = new Map<string, number>()
  for (const id of order) {
    let longest = 1
    for (const edge of project.edges) {
      if (edge.to.nodeId !== id) continue
      longest = Math.max(longest, (depth.get(edge.from.nodeId) ?? 0) + 1)
    }
    depth.set(id, longest)
  }
  return Math.max(0, ...depth.values())
}

// ---------------------------------------------------------------- planning

export interface ExecutionPlan {
  /** Nodes that may run at the same time, in the order the groups have to be run. */
  groups: string[][]
  order: string[]
  /** Nodes with a usable cached result, which the plan skips. */
  skipped: string[]
  estimated: { calls: number; memoryBytes: number; nodes: number }
  /** True when the estimate is past what one run should cost, so it can be confirmed rather than started. */
  heavy: boolean
  notes: string[]
}

export interface PlanOptions {
  /** Only these nodes and what they need. Empty means the whole graph. */
  only?: string[]
  /** Node ids whose cached results are still valid. */
  cached?: string[]
  /** Run everything, ignoring the cache. */
  force?: boolean
  concurrency?: number
}

/**
 * What would run, in what order, and what it would cost -- before anything runs.
 *
 * Grouping is by graph level rather than by a scheduler's whim: everything in a group has all its inputs from earlier
 * groups, so the group can run in any order or all at once. That makes the plan the same whether or not workers are
 * available, which is what makes a deterministic project reproducible across machines.
 */
export function planExecution(project: LabProject, options: PlanOptions = {}): ExecutionPlan | LabError {
  const order = topologicalOrder(project)
  if (isLabError(order)) return order

  const byId = new Map(project.nodes.map((one) => [one.id, one]))
  const cached = new Set(options.force ? [] : options.cached ?? [])

  let wanted = new Set(order)
  if (options.only && options.only.length > 0) {
    for (const id of options.only) {
      if (!byId.has(id)) return fail('not-found', `There is no node called "${id}".`, 'Check the node id.')
    }
    // Everything the requested nodes need, found by walking backwards.
    wanted = new Set<string>()
    const stack = [...options.only]
    while (stack.length > 0) {
      const id = stack.pop() as string
      if (wanted.has(id)) continue
      wanted.add(id)
      for (const edge of project.edges) {
        if (edge.to.nodeId === id) stack.push(edge.from.nodeId)
      }
    }
  }

  const running = order.filter((one) => wanted.has(one) && !cached.has(one))
  const skipped = order.filter((one) => wanted.has(one) && cached.has(one))

  // Levels: a node's level is one past the highest of anything it depends on that is also running.
  const level = new Map<string, number>()
  for (const id of order) {
    if (!running.includes(id)) continue
    let highest = 0
    for (const edge of project.edges) {
      if (edge.to.nodeId !== id) continue
      const from = level.get(edge.from.nodeId)
      if (from !== undefined) highest = Math.max(highest, from + 1)
    }
    level.set(id, highest)
  }

  const groups: string[][] = []
  for (const [id, at] of level) {
    while (groups.length <= at) groups.push([])
    groups[at].push(id)
  }
  for (const group of groups) group.sort()

  let calls = 0
  let memoryBytes = 0
  for (const id of running) {
    const node = byId.get(id)
    if (!node) continue
    calls += node.cost.calls
    memoryBytes = Math.max(memoryBytes, node.cost.memoryBytes)
  }
  // Peak memory is the largest group's total, not the whole graph's: nodes in different groups do not overlap.
  let peak = 0
  for (const group of groups) {
    let total = 0
    for (const id of group) total += byId.get(id)?.cost.memoryBytes ?? 0
    peak = Math.max(peak, total)
  }

  const concurrency = Math.max(1, Math.min(LAB_LIMITS.concurrent, Math.round(options.concurrency ?? LAB_LIMITS.concurrent)))
  const notes: string[] = []
  if (skipped.length > 0) {
    notes.push(`${skipped.length} node${skipped.length === 1 ? '' : 's'} already ${skipped.length === 1 ? 'has' : 'have'} a result that is still valid and will not be run again.`)
  }
  const widest = Math.max(0, ...groups.map((one) => one.length))
  if (widest > concurrency) {
    notes.push(`The widest group has ${widest} nodes and at most ${concurrency} run at once, so that group runs in more than one pass. The results are the same either way.`)
  }
  if (peak > LAB_LIMITS.outputBytes) {
    notes.push(`The largest group is estimated to need ${Math.round(peak / (1024 * 1024))} MB at once, past what a laboratory holds. Run fewer nodes at a time.`)
  }

  const heavy = calls > 1_000_000 || peak > LAB_LIMITS.outputBytes / 2
  if (heavy) notes.push('This is a long run. It is worth confirming before it starts.')

  return {
    groups: groups.filter((one) => one.length > 0),
    order: running,
    skipped,
    estimated: { calls, memoryBytes: peak, nodes: running.length },
    heavy,
    notes
  }
}

// ---------------------------------------------------------------- results and staleness

export interface NodeResult {
  nodeId: string
  /** What the node produced, by port id. */
  outputs: Record<string, unknown>
  status: NodeStatus
  error: string
  /** What this result was computed from. The whole staleness mechanism is this string. */
  fingerprint: string
  /** Deterministic: engine calls made, not milliseconds. Two runs of the same project report the same work. */
  calls: number
  seed: number | null
  engineVersion: string
  attempts: number
}

/**
 * What a node's result depends on.
 *
 * The configuration, the engine version, the seed, and the fingerprints of everything upstream. Including the upstream
 * fingerprints rather than the upstream ids is what makes a change propagate: edit an input three nodes back and every
 * fingerprint downstream changes, without anything having to walk the graph to say so.
 */
export function fingerprintNode(node: LabNode, upstream: readonly string[], engineVersion: string): string {
  const parts = [
    `op:${node.operation}`,
    `cfg:${stableJson(node.configuration)}`,
    `engine:${engineVersion}`,
    `seed:${node.seed === null ? 'none' : node.seed}`,
    ...[...upstream].sort()
  ]
  let hash = 0x811c9dc5
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    hash ^= 0x1f
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** JSON with object keys sorted, so two configurations that differ only in key order fingerprint the same. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}

/** Every node's current fingerprint, in dependency order. */
export function fingerprintAll(project: LabProject): Map<string, string> | LabError {
  const order = topologicalOrder(project)
  if (isLabError(order)) return order
  const byId = new Map(project.nodes.map((one) => [one.id, one]))
  const fingerprints = new Map<string, string>()
  for (const id of order) {
    const node = byId.get(id)
    if (!node) continue
    const upstream: string[] = []
    for (const edge of project.edges) {
      if (edge.to.nodeId !== id) continue
      const from = fingerprints.get(edge.from.nodeId)
      if (from !== undefined) upstream.push(`${edge.to.portId}<-${from}`)
    }
    fingerprints.set(id, fingerprintNode(node, upstream, project.engineVersions[node.kind] ?? '0'))
  }
  return fingerprints
}

export interface StalenessReport {
  current: string[]
  stale: string[]
  /** A node whose upstream failed, so it never had a result to make stale. */
  blocked: string[]
  missing: string[]
  /** Why each stale node is stale, traced back to the change that caused it. */
  reasons: { nodeId: string; because: string }[]
}

/**
 * Which results still correspond to the graph as it stands.
 *
 * Nothing here guesses. A result is current when its fingerprint matches what the node would produce now, and stale
 * otherwise, and because fingerprints include upstream fingerprints, a change anywhere upstream makes everything below
 * it stale without this having to reason about the graph a second time.
 */
export function assessStaleness(project: LabProject, results: readonly NodeResult[]): StalenessReport | LabError {
  const fingerprints = fingerprintAll(project)
  if (isLabError(fingerprints)) return fingerprints

  const byNode = new Map(results.map((one) => [one.nodeId, one]))
  const byId = new Map(project.nodes.map((one) => [one.id, one]))
  const order = topologicalOrder(project)
  if (isLabError(order)) return order

  const current: string[] = []
  const stale: string[] = []
  const blocked: string[] = []
  const missing: string[] = []
  const reasons: StalenessReport['reasons'] = []
  const failedUpstream = new Set<string>()

  for (const id of order) {
    const node = byId.get(id)
    if (!node) continue

    const upstreamFailed = project.edges
      .filter((edge) => edge.to.nodeId === id)
      .some((edge) => failedUpstream.has(edge.from.nodeId))
    if (upstreamFailed) {
      blocked.push(id)
      failedUpstream.add(id)
      reasons.push({ nodeId: id, because: `Something "${node.name}" depends on failed, so it never ran.` })
      continue
    }

    const result = byNode.get(id)
    if (!result) {
      missing.push(id)
      continue
    }
    if (result.status === 'failed') {
      failedUpstream.add(id)
      continue
    }

    const want = fingerprints.get(id)
    if (result.fingerprint === want) {
      current.push(id)
      continue
    }
    stale.push(id)

    // Why: either this node changed, or something upstream did. Saying which is the difference between a useful
    // message and "something changed".
    const upstreamStale = project.edges
      .filter((edge) => edge.to.nodeId === id)
      .map((edge) => edge.from.nodeId)
      .filter((one) => stale.includes(one) || missing.includes(one))
    reasons.push({
      nodeId: id,
      because:
        upstreamStale.length > 0
          ? `${upstreamStale.map((one) => byId.get(one)?.name ?? one).join(', ')} changed, so "${node.name}" no longer corresponds to anything.`
          : `"${node.name}" itself changed since it was last run.`
    })
  }

  return { current, stale, blocked, missing, reasons }
}

/** The nodes that have to be rerun for a given node's result to be trustworthy, in order. */
export function whatToRerun(project: LabProject, results: readonly NodeResult[], nodeId: string): string[] | LabError {
  const staleness = assessStaleness(project, results)
  if (isLabError(staleness)) return staleness
  const order = topologicalOrder(project)
  if (isLabError(order)) return order

  const needed = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (needed.has(id)) continue
    needed.add(id)
    for (const edge of project.edges) {
      if (edge.to.nodeId === id) stack.push(edge.from.nodeId)
    }
  }

  const notCurrent = new Set([...staleness.stale, ...staleness.missing, ...staleness.blocked])
  return order.filter((one) => needed.has(one) && notCurrent.has(one))
}

// ---------------------------------------------------------------- execution

export type LabEvent =
  | { kind: 'EXECUTION_STARTED'; executionId: string; nodes: number }
  | { kind: 'NODE_QUEUED'; executionId: string; nodeId: string }
  | { kind: 'NODE_STARTED'; executionId: string; nodeId: string }
  | { kind: 'NODE_PROGRESS'; executionId: string; nodeId: string; done: number; total: number }
  | { kind: 'NODE_COMPLETED'; executionId: string; nodeId: string; calls: number }
  | { kind: 'NODE_FAILED'; executionId: string; nodeId: string; error: string }
  | { kind: 'NODE_BLOCKED'; executionId: string; nodeId: string; because: string }
  | { kind: 'EXECUTION_CANCELLED'; executionId: string; completed: number; remaining: number }
  | { kind: 'EXECUTION_COMPLETED'; executionId: string; completed: number; failed: number; blocked: number }

export interface Execution {
  id: string
  projectId: string
  projectVersion: number
  /** A name from what the run actually is, not a counter. */
  name: string
  results: NodeResult[]
  events: LabEvent[]
  completed: number
  failed: number
  blocked: number
  cancelled: boolean
  /** Total engine calls. Deterministic, so two runs of the same project report the same figure. */
  calls: number
  /** Everything needed to run this again and get the same answer. */
  reproducibility: {
    projectVersion: number
    engineVersions: Record<string, string>
    seeds: Record<string, number | null>
    deterministic: boolean
    why: string
  }
  notes: string[]
}

export interface RunOptions {
  executionId: string
  cached?: Map<string, NodeResult>
  cancelled?: () => boolean
  onEvent?: (event: LabEvent) => void
  only?: string[]
  force?: boolean
}

/**
 * The graph, run.
 *
 * The runtime calls `evaluate` for each node and does nothing computational itself. What it owns is everything around
 * that: the order, the blocking, the retries, the events and the record of what produced what.
 *
 * Failure propagates as `blocked` rather than as a second failure. A node that never ran because its input failed has
 * not failed -- reporting it as failed would put a mark against a node that is very likely fine.
 */
export function runProject(
  project: LabProject,
  evaluate: (node: LabNode, inputs: Record<string, unknown>) => { outputs: Record<string, unknown>; calls: number },
  options: RunOptions
): Execution | LabError {
  const check = checkGraph(project)
  if (!check.ok) {
    return fail(
      'invalid-graph',
      `This project cannot be run: ${check.problems.filter((one) => one.blocking).map((one) => one.describe).join(' ')}`,
      'Fix the problems listed, then run it again. Nothing was started.'
    )
  }

  const plan = planExecution(project, { only: options.only, cached: [...(options.cached?.keys() ?? [])], force: options.force })
  if (isLabError(plan)) return plan

  const fingerprints = fingerprintAll(project)
  if (isLabError(fingerprints)) return fingerprints

  const byId = new Map(project.nodes.map((one) => [one.id, one]))
  const results: NodeResult[] = []
  const events: LabEvent[] = []
  const produced = new Map<string, Record<string, unknown>>()
  const failed = new Set<string>()
  let calls = 0
  let cancelled = false

  const emit = (event: LabEvent): void => {
    events.push(event)
    options.onEvent?.(event)
  }

  emit({ kind: 'EXECUTION_STARTED', executionId: options.executionId, nodes: plan.order.length })

  // Cached results are carried into this execution so the record is complete: a run that skipped half the graph still
  // reports what every node's result is, rather than only what it recomputed.
  for (const id of plan.skipped) {
    const cached = options.cached?.get(id)
    if (cached) {
      results.push(cached)
      produced.set(id, cached.outputs)
    }
  }

  for (const id of plan.order) {
    const node = byId.get(id)
    if (!node) continue

    const upstreamFailed = project.edges
      .filter((edge) => edge.to.nodeId === id)
      .filter((edge) => failed.has(edge.from.nodeId))
      .map((edge) => byId.get(edge.from.nodeId)?.name ?? edge.from.nodeId)

    if (upstreamFailed.length > 0) {
      const because = `${upstreamFailed.join(', ')} failed, so "${node.name}" had nothing to work from.`
      failed.add(id)
      results.push({
        nodeId: id,
        outputs: {},
        status: 'blocked',
        error: because,
        fingerprint: fingerprints.get(id) ?? '',
        calls: 0,
        seed: node.seed,
        engineVersion: project.engineVersions[node.kind] ?? '0',
        attempts: 0
      })
      emit({ kind: 'NODE_BLOCKED', executionId: options.executionId, nodeId: id, because })
      continue
    }

    if (options.cancelled?.()) {
      cancelled = true
      results.push({
        nodeId: id,
        outputs: {},
        status: 'cancelled',
        error: 'Cancelled before this node ran.',
        fingerprint: fingerprints.get(id) ?? '',
        calls: 0,
        seed: node.seed,
        engineVersion: project.engineVersions[node.kind] ?? '0',
        attempts: 0
      })
      continue
    }

    emit({ kind: 'NODE_QUEUED', executionId: options.executionId, nodeId: id })

    const inputs: Record<string, unknown> = { ...node.configuration }
    for (const edge of project.edges) {
      if (edge.to.nodeId !== id) continue
      const from = produced.get(edge.from.nodeId)
      if (from && Object.prototype.hasOwnProperty.call(from, edge.from.portId)) {
        Object.defineProperty(inputs, edge.to.portId, {
          value: from[edge.from.portId],
          enumerable: true,
          writable: true,
          configurable: true
        })
      }
    }

    emit({ kind: 'NODE_STARTED', executionId: options.executionId, nodeId: id })

    const maxAttempts = node.retryPolicy.onlyWhen === 'never' ? 1 : Math.max(1, Math.min(LAB_LIMITS.retries, node.retryPolicy.attempts))
    let attempts = 0
    let outcome: { outputs: Record<string, unknown>; calls: number } | null = null
    let error = ''

    while (attempts < maxAttempts) {
      attempts += 1
      try {
        outcome = evaluate(node, inputs)
        error = ''
        break
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message.slice(0, 300) : 'The node failed.'
        // Retrying a deterministic failure is a waste: the same inputs give the same failure, every time.
        if (node.retryPolicy.onlyWhen === 'transient' && node.deterministic) break
      }
    }

    if (outcome) {
      calls += outcome.calls
      produced.set(id, outcome.outputs)
      results.push({
        nodeId: id,
        outputs: outcome.outputs,
        status: 'completed',
        error: '',
        fingerprint: fingerprints.get(id) ?? '',
        calls: outcome.calls,
        seed: node.seed,
        engineVersion: project.engineVersions[node.kind] ?? '0',
        attempts
      })
      emit({ kind: 'NODE_COMPLETED', executionId: options.executionId, nodeId: id, calls: outcome.calls })
    } else {
      if (!node.optional) failed.add(id)
      results.push({
        nodeId: id,
        outputs: {},
        status: 'failed',
        error,
        fingerprint: fingerprints.get(id) ?? '',
        calls: 0,
        seed: node.seed,
        engineVersion: project.engineVersions[node.kind] ?? '0',
        attempts
      })
      emit({ kind: 'NODE_FAILED', executionId: options.executionId, nodeId: id, error })
    }
  }

  const completed = results.filter((one) => one.status === 'completed').length
  const failedCount = results.filter((one) => one.status === 'failed').length
  const blockedCount = results.filter((one) => one.status === 'blocked').length

  if (cancelled) {
    emit({
      kind: 'EXECUTION_CANCELLED',
      executionId: options.executionId,
      completed,
      remaining: results.filter((one) => one.status === 'cancelled').length
    })
  } else {
    emit({ kind: 'EXECUTION_COMPLETED', executionId: options.executionId, completed, failed: failedCount, blocked: blockedCount })
  }

  const notes: string[] = []
  if (blockedCount > 0) {
    notes.push(
      `${blockedCount} node${blockedCount === 1 ? '' : 's'} never ran because something they depend on failed. They are marked blocked rather than failed: nothing is known about whether they would have worked.`
    )
  }
  if (cancelled) {
    notes.push(`Cancelled. ${completed} node${completed === 1 ? '' : 's'} finished and ${results.filter((one) => one.status === 'cancelled').length} never ran. This is a partial run.`)
  }
  const optionalFailures = results.filter((one) => one.status === 'failed' && byId.get(one.nodeId)?.optional)
  if (optionalFailures.length > 0) {
    notes.push(`${optionalFailures.length} optional node${optionalFailures.length === 1 ? '' : 's'} failed and the run continued past ${optionalFailures.length === 1 ? 'it' : 'them'}.`)
  }

  const seeds: Record<string, number | null> = {}
  for (const node of project.nodes) if (!node.deterministic) seeds[node.id] = node.seed
  const unseeded = project.nodes.filter((one) => !one.deterministic && one.seed === null)
  const deterministic = unseeded.length === 0

  return {
    id: options.executionId,
    projectId: project.id,
    projectVersion: project.version,
    name: nameExecution(project, plan),
    results,
    events,
    completed,
    failed: failedCount,
    blocked: blockedCount,
    cancelled,
    calls,
    reproducibility: {
      projectVersion: project.version,
      engineVersions: { ...project.engineVersions },
      seeds,
      deterministic,
      why: deterministic
        ? 'Every node is either deterministic or has a seed, so running this again with the same project gives the same answers.'
        : `${unseeded.map((one) => one.name).join(', ')} ${unseeded.length === 1 ? 'is' : 'are'} not deterministic and ${unseeded.length === 1 ? 'has' : 'have'} no seed, so this run cannot be reproduced exactly.`
    },
    notes
  }
}

/** A name from what the run is, not a counter. "Run 7" tells nobody anything three weeks later. */
export function nameExecution(project: LabProject, plan: ExecutionPlan): string {
  if (plan.order.length === 0) return 'Nothing to run'
  if (plan.order.length === project.nodes.length) return `${project.name}: everything`
  const byId = new Map(project.nodes.map((one) => [one.id, one]))
  const names = plan.order.map((one) => byId.get(one)?.name ?? one)
  if (names.length <= 2) return `${project.name}: ${names.join(' and ')}`
  return `${project.name}: ${names[0]} and ${names.length - 1} more`
}

// ---------------------------------------------------------------- health

export type Health = 'healthy' | 'needs-attention' | 'blocked' | 'failed' | 'resource-pressure' | 'unknown'

export interface HealthReport {
  health: Health
  describe: string
  /** Specific things to look at, each naming the node it concerns. */
  attention: { nodeId: string; describe: string }[]
}

/**
 * The project's state, from what the results actually say.
 *
 * `unknown` is a real answer and is used. A project with no results is not healthy -- nothing has been checked -- and
 * calling it healthy would be the most misleading thing this function could do.
 */
export function assessHealth(project: LabProject, results: readonly NodeResult[]): HealthReport {
  const check = checkGraph(project)
  const byId = new Map(project.nodes.map((one) => [one.id, one]))
  const attention: HealthReport['attention'] = []

  if (!check.ok) {
    for (const problem of check.problems.filter((one) => one.blocking)) {
      attention.push({ nodeId: problem.nodeIds[0] ?? '', describe: problem.describe })
    }
    return { health: 'failed', describe: 'The graph cannot be run as it stands.', attention }
  }

  if (project.nodes.length === 0) {
    return { health: 'unknown', describe: 'This project has no nodes, so there is nothing to report.', attention }
  }
  if (results.length === 0) {
    return { health: 'unknown', describe: 'Nothing has been run yet, so nothing is known about whether it works.', attention }
  }

  const staleness = assessStaleness(project, results)
  if (isLabError(staleness)) {
    return { health: 'failed', describe: staleness.message, attention }
  }

  for (const result of results) {
    if (result.status === 'failed') {
      attention.push({ nodeId: result.nodeId, describe: `"${byId.get(result.nodeId)?.name ?? result.nodeId}" failed: ${result.error}` })
    }
  }
  for (const reason of staleness.reasons) {
    attention.push({ nodeId: reason.nodeId, describe: reason.because })
  }

  const anyFailed = results.some((one) => one.status === 'failed')
  if (anyFailed) {
    return {
      health: 'failed',
      describe: `${results.filter((one) => one.status === 'failed').length} node failed. Anything downstream is blocked rather than wrong.`,
      attention
    }
  }
  if (staleness.blocked.length > 0) {
    return { health: 'blocked', describe: `${staleness.blocked.length} nodes could not run because something they depend on failed.`, attention }
  }
  if (staleness.stale.length > 0 || staleness.missing.length > 0) {
    return {
      health: 'needs-attention',
      describe: `${staleness.stale.length} result${staleness.stale.length === 1 ? '' : 's'} no longer correspond${staleness.stale.length === 1 ? 's' : ''} to the project, and ${staleness.missing.length} node${staleness.missing.length === 1 ? ' has' : 's have'} never been run.`,
      attention
    }
  }

  return { health: 'healthy', describe: 'Every node has a result that matches the project as it stands.', attention }
}

// ---------------------------------------------------------------- checkpoints

export interface Checkpoint {
  id: string
  projectVersion: number
  /** Node ids to their results. Only completed ones; a checkpoint of a failure is not a place to resume from. */
  results: NodeResult[]
  engineVersions: Record<string, string>
  describe: string
}

export interface RestoreResult {
  usable: NodeResult[]
  /** Results the checkpoint holds that no longer correspond to the project. Discarded, with the reason. */
  discarded: { nodeId: string; why: string }[]
  notes: string[]
}

/** A checkpoint from an execution. Only completed results, because a failure is not a state to resume from. */
export function checkpointFrom(id: string, project: LabProject, execution: Execution, describe = ''): Checkpoint {
  return {
    id,
    projectVersion: project.version,
    results: execution.results.filter((one) => one.status === 'completed'),
    engineVersions: { ...project.engineVersions },
    describe: describe === '' ? `${execution.completed} completed node${execution.completed === 1 ? '' : 's'} from ${execution.name}.` : describe
  }
}

/**
 * A checkpoint applied to a project, keeping only what still corresponds to it.
 *
 * Every result is checked against the current fingerprint rather than trusted because it came from a checkpoint. A
 * checkpoint taken before an edit holds results for a graph that no longer exists, and restoring those wholesale would
 * put a stale answer back on the screen with a fresh timestamp -- which is worse than having no answer at all.
 */
export function restoreCheckpoint(project: LabProject, checkpoint: Checkpoint): RestoreResult | LabError {
  const fingerprints = fingerprintAll(project)
  if (isLabError(fingerprints)) return fingerprints

  const byId = new Map(project.nodes.map((one) => [one.id, one]))
  const usable: NodeResult[] = []
  const discarded: RestoreResult['discarded'] = []

  for (const result of checkpoint.results) {
    const node = byId.get(result.nodeId)
    if (!node) {
      discarded.push({ nodeId: result.nodeId, why: 'That node is no longer in the project.' })
      continue
    }
    const want = fingerprints.get(result.nodeId)
    if (want !== result.fingerprint) {
      // The engine version is part of the fingerprint, so a version change lands here rather than in a check of its
      // own. Naming it specifically matters: "the engine was upgraded" and "you edited the node" are different things
      // to be told, and a single message covering both would leave somebody looking for an edit they did not make.
      const engine = project.engineVersions[node.kind] ?? '0'
      discarded.push({
        nodeId: result.nodeId,
        why:
          result.engineVersion !== engine
            ? `"${node.name}" was computed with engine version ${result.engineVersion} and the current one is ${engine}. A result is not reproduced under a different version.`
            : `"${node.name}" or something it depends on has changed since the checkpoint, so its result no longer corresponds to anything.`
      })
      continue
    }
    usable.push(result)
  }

  const notes: string[] = [
    `${usable.length} of ${checkpoint.results.length} results from the checkpoint still correspond to this project and were kept.`
  ]
  if (checkpoint.projectVersion !== project.version) {
    notes.push(
      `The checkpoint was taken at project version ${checkpoint.projectVersion} and this is version ${project.version}. Results were checked one at a time rather than being taken or dropped as a whole.`
    )
  }
  if (discarded.length > 0) {
    notes.push(`${discarded.length} were discarded, each for a reason listed.`)
  }

  return { usable, discarded, notes }
}

// ---------------------------------------------------------------- comparing runs

export interface RunComparison {
  sameProjectVersion: boolean
  sameEngines: boolean
  /** Nodes whose outputs differ, with a note when the difference should not have been possible. */
  differing: { nodeId: string; describe: string; expected: boolean }[]
  onlyIn: { first: string[]; second: string[] }
  notes: string[]
}

/**
 * Two runs compared.
 *
 * The interesting case is a difference that should not be there. Two runs of the same deterministic project at the
 * same version with the same engines must agree; when they do not, something outside the recorded configuration is
 * affecting the result, and that is a finding rather than a curiosity.
 */
export function compareRuns(project: LabProject, first: Execution, second: Execution): RunComparison {
  const firstById = new Map(first.results.map((one) => [one.nodeId, one]))
  const secondById = new Map(second.results.map((one) => [one.nodeId, one]))
  const byId = new Map(project.nodes.map((one) => [one.id, one]))

  const sameProjectVersion = first.projectVersion === second.projectVersion
  const sameEngines = stableJson(first.reproducibility.engineVersions) === stableJson(second.reproducibility.engineVersions)

  const differing: RunComparison['differing'] = []
  for (const [id, a] of firstById) {
    const b = secondById.get(id)
    if (!b) continue
    const node = byId.get(id)
    const changed = stableJson(a.outputs) !== stableJson(b.outputs) || a.status !== b.status
    if (!changed) continue
    const shouldMatch = sameProjectVersion && sameEngines && (node?.deterministic ?? false)
    differing.push({
      nodeId: id,
      expected: !shouldMatch,
      describe: shouldMatch
        ? `"${node?.name ?? id}" gave a different answer although the project, the engines and the node are all the same and the node is recorded as deterministic. Something outside the recorded configuration is affecting it.`
        : `"${node?.name ?? id}" gave a different answer. ${!sameProjectVersion ? 'The project version differs. ' : ''}${!sameEngines ? 'The engine versions differ. ' : ''}${!(node?.deterministic ?? true) ? 'The node is not deterministic. ' : ''}`.trim()
    })
  }

  const notes: string[] = []
  const unexpected = differing.filter((one) => !one.expected)
  if (unexpected.length > 0) {
    notes.push(
      `${unexpected.length} node${unexpected.length === 1 ? '' : 's'} differed when ${unexpected.length === 1 ? 'it' : 'they'} should not have. That is worth investigating before either run is relied on.`
    )
  }
  if (differing.length === 0) {
    notes.push('Every node the two runs share gave the same answer.')
  }

  return {
    sameProjectVersion,
    sameEngines,
    differing,
    onlyIn: {
      first: [...firstById.keys()].filter((one) => !secondById.has(one)),
      second: [...secondById.keys()].filter((one) => !firstById.has(one))
    },
    notes
  }
}

// ---------------------------------------------------------------- compatibility

export interface CompatibilityReport {
  canOpen: boolean
  problems: { what: string; describe: string; fixable: boolean }[]
  notes: string[]
}

/**
 * Whether an imported project can be opened here.
 *
 * Checked before anything runs, and never by running it. An imported project naming an engine that is not present is a
 * project that would fail partway through with a confusing message; saying so first is the whole point.
 */
export function checkCompatibility(
  project: LabProject,
  available: { engines: Record<string, string>; capabilities: readonly string[] },
  required: readonly string[] = []
): CompatibilityReport {
  const problems: CompatibilityReport['problems'] = []
  const notes: string[] = []

  const kinds = new Set(project.nodes.map((one) => one.kind))
  for (const kind of kinds) {
    if (!Object.prototype.hasOwnProperty.call(available.engines, kind)) {
      problems.push({
        what: `engine "${kind}"`,
        describe: `This project has ${kind} nodes and that engine is not available here. Orbis will not substitute a different one.`,
        fixable: false
      })
      continue
    }
    const want = project.engineVersions[kind]
    const have = available.engines[kind]
    if (want !== undefined && want !== have) {
      notes.push(
        `The ${kind} nodes were computed with version ${want} and this Orbis has ${have}. The project will open; its saved results are marked as not reproduced under a different version.`
      )
    }
  }

  for (const capability of required) {
    if (!available.capabilities.includes(capability)) {
      problems.push({
        what: `capability "${capability}"`,
        describe: `This project needs ${capability}, which has not been granted.`,
        fixable: true
      })
    }
  }

  return {
    canOpen: !problems.some((one) => !one.fixable),
    problems,
    notes
  }
}

/** The assumptions the runtime rests on, for a Page that wants to show them rather than have them inferred. */
export const LAB_ASSUMPTIONS: readonly string[] = Object.freeze([
  'The runtime owns the graph and never computes anything. Every node calls an engine, and no engine is approximated here.',
  'The order nodes run in comes from the connections, never from where they sit on a canvas.',
  'A cycle is refused before anything runs, because there is no order that satisfies it.',
  'A result belongs to what produced it. Change an input and everything downstream is marked stale rather than shown as current.',
  'A node that never ran because its input failed is blocked, not failed. Nothing is known about whether it would have worked.',
  'A project with no results is unknown, not healthy.',
  'A checkpoint is checked result by result against the project as it stands, never restored wholesale.',
  'A run that cannot be reproduced says so, and names the nodes that make it so.'
])
