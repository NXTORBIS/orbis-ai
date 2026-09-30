/**
 * Reading a Lab project that arrived from a Page.
 *
 * A project is a graph of nodes, each naming an engine operation, with edges carrying values between them. All of it
 * arrives as untrusted data, and the runtime that executes it deliberately knows nothing about operation names — so
 * everything that decides what may run has to be settled here and in `service.runLab`, before a node is evaluated.
 *
 * This file only reads. It does not decide whether an operation may run; that is a capability question and it is
 * answered against the Page's own grants. What it does is make sure the thing being authorised is the thing that
 * will be executed: bounded, typed, and with no field that could carry behaviour.
 */

import { BadInput, Reader } from './engines.ts'
import type { Edge, LabNode, LabProject, NodeKind, NodeStatus, Port, ValueKind } from '../../shared/pages/lab.ts'

/** What may cross this boundary. The engines will happily hold more; a graph a person drew will not. */
export const LAB_LIMITS = Object.freeze({
  nodes: 400,
  edges: 1200,
  ports: 40,
  variables: 200,
  results: 400,
  configurationKeys: 64,
  textLength: 2000
})

const NODE_KINDS: readonly NodeKind[] = [
  'input',
  'expression',
  'equation',
  'dataset',
  'transform',
  'statistics',
  'simulation',
  'optimise',
  'uncertainty',
  'study',
  'document',
  'plot',
  'export'
]

const NODE_STATUSES: readonly NodeStatus[] = [
  'idle',
  'ready',
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'stale',
  'blocked'
]

const VALUE_KINDS: readonly ValueKind[] = [
  'number',
  'integer',
  'text',
  'boolean',
  'quantity',
  'vector',
  'matrix',
  'table',
  'document',
  'distribution',
  'series',
  'plot',
  'result'
]

function choice<T extends string>(read: Reader, key: string, allowed: readonly T[], fallback?: T): T {
  if (!read.has(key) || read.raw(key) === null) {
    if (fallback !== undefined) return fallback
    throw new BadInput(`"${key}" has to be one of: ${allowed.join(', ')}.`)
  }
  const value = read.text(key, 64)
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadInput(`"${value}" is not one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

/**
 * Whether a value is plain data.
 *
 * A node's configuration becomes the arguments of an engine call, so anything that could carry behaviour across that
 * boundary is a way for a graph to run code inside an engine. Functions, class instances and anything with an
 * unexpected prototype are refused rather than stripped, because silently removing part of a configuration would
 * change what the node computes without saying so.
 */
function isPlainData(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (value === null) return true
  const kind = typeof value
  if (kind === 'string') return (value as string).length <= LAB_LIMITS.textLength
  if (kind === 'boolean') return true
  if (kind === 'number') return Number.isFinite(value as number)
  if (Array.isArray(value)) return value.length <= 20_000 && value.every((one) => isPlainData(one, depth + 1))
  if (kind === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > LAB_LIMITS.configurationKeys) return false
    return entries.every(([key, one]) => key !== '__proto__' && isPlainData(one, depth + 1))
  }
  return false
}

function portFrom(row: Record<string, unknown>): Port {
  const read = new Reader(row)
  return {
    id: read.text('id', 80),
    name: read.text('name', 120),
    kind: choice<ValueKind>(read, 'kind', VALUE_KINDS, 'result'),
    unit: read.has('unit') && read.raw('unit') !== null ? read.text('unit', 40) : '',
    required: read.has('required') && read.raw('required') !== null ? read.boolean('required') : false,
    describe: read.has('describe') && read.raw('describe') !== null ? read.text('describe', 600) : ''
  }
}

function nodeFrom(row: Record<string, unknown>): LabNode {
  const read = new Reader(row)
  const configuration = read.has('configuration') ? read.raw('configuration') : {}
  if (configuration !== null && !isPlainData(configuration)) {
    throw new BadInput(
      'A node\'s configuration has to be plain data. It becomes the arguments of an engine call, and anything that could carry behaviour across that boundary is a way to run code inside an engine.'
    )
  }
  if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) {
    throw new BadInput('A node\'s configuration has to be an object.')
  }
  return {
    id: read.text('id', 80),
    kind: choice<NodeKind>(read, 'kind', NODE_KINDS, 'transform'),
    name: read.text('name', 200),
    // The operation is read as text and checked against the capability map by the caller. Nothing here decides
    // whether it may run.
    operation: read.text('operation', 120),
    configuration: { ...(configuration as Record<string, unknown>) },
    inputs: read.has('inputs') ? read.list('inputs', LAB_LIMITS.ports).map(portFrom) : [],
    outputs: read.has('outputs') ? read.list('outputs', LAB_LIMITS.ports).map(portFrom) : [],
    status: choice<NodeStatus>(read, 'status', NODE_STATUSES, 'idle'),
    // Recorded, never inferred from the operation name: whether a node repeats is a fact about the node.
    deterministic: read.has('deterministic') && read.raw('deterministic') !== null ? read.boolean('deterministic') : true,
    // Null rather than zero. No seed and seed zero are different, and only one of them can be repeated.
    seed: read.has('seed') && read.raw('seed') !== null ? read.number('seed') : null,
    // An estimate the caller supplies, and the planner uses it to warn before a heavy run. One call and no stated
    // memory is the honest default for a node nobody has measured -- it is not a claim that the node is cheap.
    cost: costFrom(read),
    retryPolicy: retryFrom(read),
    optional: read.has('optional') && read.raw('optional') !== null ? read.boolean('optional') : false
  }
}

/** What a node is expected to cost. An estimate, never a measurement, and the planner says so when it warns. */
function costFrom(read: Reader): { calls: number; memoryBytes: number } {
  if (!read.has('cost') || read.raw('cost') === null) return { calls: 1, memoryBytes: 0 }
  const raw = read.raw('cost')
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput('A node cost has to be an object with calls and memoryBytes.')
  }
  const one = new Reader(raw as Record<string, unknown>)
  return {
    calls: one.has('calls') && one.raw('calls') !== null ? one.number('calls') : 1,
    memoryBytes: one.has('memoryBytes') && one.raw('memoryBytes') !== null ? one.number('memoryBytes') : 0
  }
}

/**
 * When a failed node may be tried again.
 *
 * `never` is the default on purpose. Retrying something that changes the world is how one action becomes two, and
 * the runtime cannot tell which operations those are -- so a node is retried only when its own project says it is
 * safe to.
 */
function retryFrom(read: Reader): { attempts: number; onlyWhen: 'never' | 'transient' | 'always' } {
  if (!read.has('retryPolicy') || read.raw('retryPolicy') === null) return { attempts: 0, onlyWhen: 'never' }
  const raw = read.raw('retryPolicy')
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput('A node retryPolicy has to be an object.')
  }
  const one = new Reader(raw as Record<string, unknown>)
  return {
    attempts: one.has('attempts') && one.raw('attempts') !== null ? one.number('attempts') : 0,
    onlyWhen: choice(one, 'onlyWhen', ['never', 'transient', 'always'] as const, 'never')
  }
}

function edgeFrom(row: Record<string, unknown>): Edge {
  const read = new Reader(row)
  const end = (key: string): { nodeId: string; portId: string } => {
    const raw = read.raw(key)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new BadInput(`An edge's "${key}" has to be an object with a nodeId and a portId.`)
    }
    const one = new Reader(raw as Record<string, unknown>)
    return { nodeId: one.text('nodeId', 80), portId: one.text('portId', 80) }
  }
  return { id: read.text('id', 80), from: end('from'), to: end('to') }
}

/** A whole project, read from one object. The Page owns it; this borrows it for the length of one call. */
export function projectFrom(read: Reader, key = 'project'): LabProject {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be a project object.`)
  }
  const entry = new Reader(raw as Record<string, unknown>)

  const variables: LabProject['variables'] = {}
  if (entry.has('variables') && entry.raw('variables') !== null) {
    const rawVars = entry.raw('variables')
    if (typeof rawVars !== 'object' || rawVars === null || Array.isArray(rawVars)) {
      throw new BadInput('"variables" has to be an object.')
    }
    const pairs = Object.entries(rawVars as Record<string, unknown>)
    if (pairs.length > LAB_LIMITS.variables) {
      throw new BadInput(`There are more than the ${LAB_LIMITS.variables} variables allowed.`)
    }
    for (const [name, value] of pairs) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new BadInput(`The variable "${name}" has to be an object with a kind, a unit and a value.`)
      }
      const one = new Reader(value as Record<string, unknown>)
      const held = one.has('value') ? one.raw('value') : null
      if (!isPlainData(held)) throw new BadInput(`The variable "${name}" holds something that is not plain data.`)
      variables[name] = {
        kind: choice<ValueKind>(one, 'kind', VALUE_KINDS, 'result'),
        unit: one.has('unit') && one.raw('unit') !== null ? one.text('unit', 40) : '',
        value: held
      }
    }
  }

  const engineVersions: Record<string, string> = {}
  if (entry.has('engineVersions') && entry.raw('engineVersions') !== null) {
    const rawVersions = entry.raw('engineVersions')
    if (typeof rawVersions !== 'object' || rawVersions === null || Array.isArray(rawVersions)) {
      throw new BadInput('"engineVersions" has to be an object of text values.')
    }
    for (const [name, value] of Object.entries(rawVersions as Record<string, unknown>)) {
      if (typeof value !== 'string' || value.length > 40) throw new BadInput(`"engineVersions.${name}" has to be short text.`)
      engineVersions[name] = value
    }
  }

  return {
    id: entry.text('id', 80),
    name: entry.text('name', 200),
    pageId: entry.text('pageId', 80),
    profileId: entry.has('profileId') && entry.raw('profileId') !== null ? entry.text('profileId', 80) : '',
    workspaceId: entry.has('workspaceId') && entry.raw('workspaceId') !== null ? entry.text('workspaceId', 80) : '',
    nodes: entry.has('nodes') ? entry.list('nodes', LAB_LIMITS.nodes).map(nodeFrom) : [],
    edges: entry.has('edges') ? entry.list('edges', LAB_LIMITS.edges).map(edgeFrom) : [],
    variables,
    version: entry.has('version') && entry.raw('version') !== null ? entry.number('version') : 1,
    engineVersions
  }
}

/** Results sent back in so staleness and health can be worked out against the graph that produced them. */
export function resultsFrom(read: Reader, key = 'results'): Parameters<typeof import('../../shared/pages/lab.ts').assessHealth>[1] {
  if (!read.has(key)) return []
  return read.list(key, LAB_LIMITS.results).map((row) => {
    const one = new Reader(row)
    const outputs = one.has('outputs') ? one.raw('outputs') : {}
    if (typeof outputs !== 'object' || outputs === null || Array.isArray(outputs)) {
      throw new BadInput('A result\'s outputs have to be an object.')
    }
    if (!isPlainData(outputs)) throw new BadInput('A result holds something that is not plain data.')
    return {
      nodeId: one.text('nodeId', 80),
      outputs: { ...(outputs as Record<string, unknown>) },
      status: choice<NodeStatus>(one, 'status', NODE_STATUSES, 'completed'),
      error: one.has('error') && one.raw('error') !== null ? one.text('error', 2000) : '',
      startedAt: one.has('startedAt') && one.raw('startedAt') !== null ? one.number('startedAt') : 0,
      finishedAt: one.has('finishedAt') && one.raw('finishedAt') !== null ? one.number('finishedAt') : 0,
      fingerprint: one.has('fingerprint') && one.raw('fingerprint') !== null ? one.text('fingerprint', 200) : '',
      calls: one.has('calls') && one.raw('calls') !== null ? one.number('calls') : 0,
      seed: one.has('seed') && one.raw('seed') !== null ? one.number('seed') : null
    }
  }) as never
}
