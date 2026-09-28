/**
 * The structuring engines a Page can reach: workspaces, scenarios, plans, comparisons, decisions, research and the
 * rest of what holds a piece of work together.
 *
 * These differ from the computation engines in what they do with what they are given. A statistics engine is handed
 * numbers and returns a number. These are handed a *structure* -- a graph of assumptions, a plan of tasks, a set of
 * options against criteria -- and return what is wrong with it, what rests on what, and what has gone out of date.
 *
 * ## The structures arrive as plain records
 *
 * Every one of these takes lists of records with declared fields. They are read field by field, with every
 * user-supplied key read through `hasOwnProperty` and written through `defineProperty`: a node called `__proto__` is
 * something a person can type, and it has to stay a node rather than becoming a prototype.
 *
 * ## Nothing here is asynchronous
 *
 * The queue runner in `scenarios.ts` and the run planner in `lab.ts` take callbacks that do the work. A Page cannot
 * send one, and this file does not offer those operations -- a Page drives its own loop and asks these engines what
 * the results mean. The alternative would be the main process holding a Page's computation open, which is the thing
 * the whole capability model exists to avoid.
 */

import {
  assessStaleness as assessWorkspaceStaleness,
  assumptionRegister,
  buildReport,
  checkStructure,
  compareApproaches,
  ifAssumptionChanged,
  isWorkspaceError,
  topologicalOrder as workspaceOrder,
  type Approach,
  type Link,
  type LinkKind,
  type NodeKind,
  type NodeState,
  type WorkNode,
  type Workspace
} from '../../shared/pages/workspace.ts'
import {
  buildMatrix,
  captureBaseline,
  checkScenario,
  differenceMap,
  findConflicts,
  isScenarioError,
  mergeScenarios,
  playTimeline,
  resolve as resolveScenario,
  type Axis,
  type Change,
  type Event as ScenarioEvent,
  type Scenario,
  type Value as ScenarioValue
} from '../../shared/pages/scenarios.ts'
import {
  analyse as analyseExplanation,
  checkTopic,
  hintFor,
  isLearningError,
  learningOrder,
  masteryOf,
  reviewQueue,
  socraticQuestion,
  type Attempt,
  type Concept,
  type Session,
  type Topic
} from '../../shared/pages/learning.ts'
import {
  align,
  bindingCycle,
  BuilderRegistry,
  builtInBuilders,
  checkBehaviour,
  distribute,
  isBuilderError,
  resolveSelection,
  routeConnector,
  validate as validateArtifact,
  type Artifact,
  type ArtifactObject,
  type Behaviour,
  type Connector,
  type FieldValue
} from '../../shared/pages/builders.ts'
import {
  assessArtifacts,
  checkProject,
  diffProjects,
  importBundle,
  isProjectError,
  lineageOf,
  requirementsOf,
  resolveVariable,
  runOrder,
  shadowedVariables,
  type Artifact as ProjectArtifact,
  type Connection,
  type Conversion,
  type DataType,
  type PageInstance,
  type Port,
  type Project,
  type Variable
} from '../../shared/pages/projectGraph.ts'
import { BadInput, Reader } from './engines.ts'

export const REASONING_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  'workspace.check': 'computation.reasoning',
  'workspace.order': 'computation.reasoning',
  'workspace.assumptions': 'computation.reasoning',
  'workspace.impact': 'computation.reasoning',
  'workspace.staleness': 'computation.reasoning',
  'workspace.approaches': 'computation.reasoning',
  'workspace.report': 'computation.reasoning',

  'scenario.check': 'computation.reasoning',
  'scenario.resolve': 'computation.reasoning',
  'scenario.matrix': 'computation.reasoning',
  'scenario.difference': 'computation.reasoning',
  'scenario.conflicts': 'computation.reasoning',
  'scenario.merge': 'computation.reasoning',
  'scenario.timeline': 'computation.reasoning',

  'learning.topic': 'computation.reasoning',
  'learning.analyse': 'computation.reasoning',
  'learning.hint': 'computation.reasoning',
  'learning.mastery': 'computation.reasoning',
  'learning.review': 'computation.reasoning',

  'builder.validate': 'computation.reasoning',
  'builder.select': 'computation.reasoning',
  'builder.arrange': 'computation.reasoning',
  'builder.route': 'computation.reasoning',
  'builder.behaviour': 'computation.reasoning',

  'project.check': 'computation.reasoning',
  'project.order': 'computation.reasoning',
  'project.variables': 'computation.reasoning',
  'project.lineage': 'computation.reasoning',
  'project.staleness': 'computation.reasoning',
  'project.diff': 'computation.reasoning',
  'project.import': 'computation.reasoning'
})

export const REASONING_LIMITS: Readonly<Record<'nodes' | 'links' | 'changes' | 'objects' | 'concepts' | 'pages' | 'text', number>> =
  Object.freeze({
    nodes: 20_000,
    links: 100_000,
    changes: 500,
    objects: 20_000,
    concepts: 500,
    pages: 500,
    text: 100_000
  })

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

/** A record with a user-chosen key, built so a key called `__proto__` stays a key. */
function namedRecord<T>(entries: readonly (readonly [string, T])[]): Record<string, T> {
  const out: Record<string, T> = Object.create(null)
  for (const [name, value] of entries) {
    Object.defineProperty(out, name, { value, enumerable: true, writable: true, configurable: true })
  }
  return { ...out }
}

// ---------------------------------------------------------------- workspaces

const NODE_KINDS = [
  'goal',
  'question',
  'subproblem',
  'assumption',
  'constraint',
  'input',
  'calculation',
  'experiment',
  'evidence',
  'hypothesis',
  'decision',
  'result',
  'conclusion',
  'note'
] as const

const NODE_STATES = ['open', 'in-progress', 'answered', 'blocked', 'stale', 'abandoned'] as const
const LINK_KINDS = ['feeds', 'depends-on', 'supports', 'contradicts', 'answers', 'produces', 'compares-with', 'part-of'] as const

function workspaceOf(read: Reader, key = 'workspace'): Workspace {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput(`"${key}" has to be a workspace.`)
  const entry = new Reader(raw as Record<string, unknown>)

  const nodes: WorkNode[] = (entry.has('nodes') ? entry.list('nodes', REASONING_LIMITS.nodes) : []).map((one) => {
    const it = new Reader(one)
    const value = it.raw('value')
    if (value !== undefined && value !== null && typeof value !== 'number' && typeof value !== 'string') {
      throw new BadInput('A node’s value is a number, text, or nothing.')
    }
    return {
      id: it.text('id', 200),
      kind: it.choice('kind', NODE_KINDS, 'note') as NodeKind,
      title: it.optionalText('title', '', 400),
      detail: it.optionalText('detail', '', 4000),
      state: it.choice('state', NODE_STATES, 'open') as NodeState,
      approachId: it.has('approachId') ? it.text('approachId', 200) : null,
      value: (value ?? null) as number | string | null,
      unit: it.optionalText('unit', '', 200),
      computedFrom: it.optionalText('computedFrom', '', 400),
      owner: it.optionalText('owner', '', 200)
    }
  })

  const links: Link[] = (entry.has('links') ? entry.list('links', REASONING_LIMITS.links) : []).map((one) => {
    const it = new Reader(one)
    return {
      id: it.text('id', 200),
      from: it.text('from', 200),
      to: it.text('to', 200),
      kind: it.choice('kind', LINK_KINDS, 'feeds') as LinkKind
    }
  })

  return { id: entry.optionalText('id', 'workspace', 200), title: entry.optionalText('title', '', 400), nodes, links }
}

function approachesOf(read: Reader): Approach[] {
  return read.list('approaches', 200).map((one) => {
    const it = new Reader(one)
    return {
      id: it.text('id', 200),
      subproblemId: it.text('subproblemId', 200),
      name: it.optionalText('name', '', 400),
      describe: it.optionalText('describe', '', 2000),
      resultId: it.has('resultId') ? it.text('resultId', 200) : null
    }
  })
}

// ---------------------------------------------------------------- scenarios

function scenarioValueOf(raw: unknown, where: string): ScenarioValue {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new BadInput(`${where} has to be a finite number.`)
    return raw
  }
  if (typeof raw === 'string') {
    if (raw.length > 4000) throw new BadInput(`${where} is too long.`)
    return raw
  }
  if (typeof raw === 'boolean') return raw
  throw new BadInput(`${where} has to be a number, text or true/false.`)
}

function baselineOf(read: Reader) {
  const raw = read.raw('baseline')
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput('"baseline" has to be a baseline.')
  const entry = new Reader(raw as Record<string, unknown>)
  const values = entry.raw('values')
  if (typeof values !== 'object' || values === null || Array.isArray(values)) throw new BadInput('A baseline needs a set of named values.')
  const pairs: [string, ScenarioValue][] = []
  for (const [name, held] of Object.entries(values as Record<string, unknown>)) {
    if (pairs.length >= REASONING_LIMITS.changes) throw new BadInput(`A baseline holds at most ${REASONING_LIMITS.changes} values.`)
    pairs.push([name, scenarioValueOf(held, `The baseline value "${name}"`)])
  }
  return captureBaseline(
    entry.optionalText('id', 'baseline', 200),
    entry.optionalText('label', '', 400),
    namedRecord(pairs),
    entry.optionalText('capturedAt', '', 64)
  )
}

function changesOf(read: Reader, key = 'changes'): Change[] {
  return read.list(key, REASONING_LIMITS.changes).map((one) => {
    const it = new Reader(one)
    return {
      key: it.text('key', 400),
      how: it.choice('how', ['set', 'add', 'multiply'] as const, 'set'),
      to: scenarioValueOf(it.raw('to'), 'A change value'),
      because: it.optionalText('because', '', 2000)
    }
  })
}

function scenarioOf(raw: unknown, where: string): Scenario {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput(`${where} has to be a scenario.`)
  const entry = new Reader(raw as Record<string, unknown>)
  return {
    id: entry.text('id', 200),
    label: entry.optionalText('label', '', 400),
    parentId: entry.has('parentId') ? entry.text('parentId', 200) : null,
    changes: changesOf(entry),
    describe: entry.optionalText('describe', '', 2000)
  }
}

function scenariosOf(read: Reader, key = 'scenarios'): Scenario[] {
  const raw = read.raw(key)
  if (!Array.isArray(raw)) throw new BadInput(`"${key}" has to be a list of scenarios.`)
  if (raw.length > 2000) throw new BadInput(`"${key}" has more scenarios than are allowed in one request.`)
  return raw.map((one, i) => scenarioOf(one, `"${key}" at position ${i + 1}`))
}

function numberRecordOf(read: Reader, key: string): Record<string, number> {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput(`"${key}" has to be a set of named numbers.`)
  const pairs: [string, number][] = []
  for (const [name, held] of Object.entries(raw as Record<string, unknown>)) {
    if (pairs.length >= REASONING_LIMITS.changes) throw new BadInput(`"${key}" holds more than the ${REASONING_LIMITS.changes} values allowed.`)
    if (typeof held !== 'number' || !Number.isFinite(held)) throw new BadInput(`"${name}" has to be a finite number.`)
    pairs.push([name, held])
  }
  return namedRecord(pairs)
}

// ---------------------------------------------------------------- learning

function topicOf(read: Reader, key = 'topic'): Topic {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput(`"${key}" has to be a topic.`)
  const entry = new Reader(raw as Record<string, unknown>)
  const concepts: Concept[] = (entry.has('concepts') ? entry.list('concepts', REASONING_LIMITS.concepts) : []).map((one) => {
    const it = new Reader(one)
    return {
      id: it.text('id', 200),
      name: it.optionalText('name', '', 400),
      aliases: it.has('aliases') ? it.strings('aliases', 200) : [],
      requires: it.has('requires') ? it.strings('requires', 200) : [],
      essential: it.boolean('essential', false),
      confusedWith: it.has('confusedWith')
        ? it.list('confusedWith', 200).map((two) => {
            const that = new Reader(two)
            return {
              belief: that.text('belief', 1000),
              signal: that.strings('signal', 100),
              because: that.optionalText('because', '', 2000)
            }
          })
        : []
    }
  })
  return { id: entry.optionalText('id', 'topic', 200), name: entry.optionalText('name', '', 400), concepts }
}

function sessionOf(read: Reader, topic: Topic): Session {
  const raw = read.raw('session')
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput('"session" has to be a learning session.')
  const entry = new Reader(raw as Record<string, unknown>)
  const attempts: Attempt[] = (entry.has('attempts') ? entry.list('attempts', 200) : []).map((one, i) => {
    const it = new Reader(one)
    const text = it.text('text', REASONING_LIMITS.text)
    // Analysed here rather than trusted from the Page: an attempt carrying an analysis somebody else wrote would let a
    // Page report any coverage it liked.
    const analysis = analyseExplanation(topic, text)
    if (isLearningError(analysis)) throw new BadInput(analysis.message)
    return {
      id: it.optionalText('id', `attempt-${i + 1}`, 200),
      version: i + 1,
      text,
      analysis,
      statedConfidence: it.has('statedConfidence') ? it.number('statedConfidence') : null,
      hintsUsed: Math.max(0, Math.round(it.optionalNumber('hintsUsed', 0)))
    }
  })
  return { id: entry.optionalText('id', 'session', 200), topicId: topic.id, attempts }
}

// ---------------------------------------------------------------- builders

const registry = (() => {
  const one = new BuilderRegistry()
  for (const builder of builtInBuilders()) one.register(builder)
  return one
})()

function fieldValueOf(raw: unknown, where: string): FieldValue {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new BadInput(`${where} has to be a finite number.`)
    return raw
  }
  if (typeof raw === 'string') {
    if (raw.length > 8000) throw new BadInput(`${where} is too long.`)
    return raw
  }
  if (typeof raw === 'boolean') return raw
  throw new BadInput(`${where} has to be a number, text, true/false or nothing.`)
}

function artifactOf(read: Reader, key = 'artifact'): Artifact {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput(`"${key}" has to be an artifact.`)
  const entry = new Reader(raw as Record<string, unknown>)

  const objects: ArtifactObject[] = (entry.has('objects') ? entry.list('objects', REASONING_LIMITS.objects) : []).map((one) => {
    const it = new Reader(one)
    const box = new Reader((it.raw('box') ?? {}) as Record<string, unknown>)
    const fields = it.raw('fields')
    if (fields !== undefined && (typeof fields !== 'object' || fields === null || Array.isArray(fields))) {
      throw new BadInput('An object’s fields are a set of named values.')
    }
    const pairs: [string, FieldValue][] = []
    for (const [name, held] of Object.entries((fields ?? {}) as Record<string, unknown>)) {
      if (pairs.length >= 200) throw new BadInput('An object holds at most 200 fields.')
      pairs.push([name, fieldValueOf(held, `The field "${name}"`)])
    }
    return {
      id: it.text('id', 200),
      type: it.text('type', 200),
      box: {
        x: box.optionalNumber('x', 0),
        y: box.optionalNumber('y', 0),
        width: box.optionalNumber('width', 0),
        height: box.optionalNumber('height', 0)
      },
      text: it.optionalText('text', '', 4000),
      fields: namedRecord(pairs),
      layerId: it.optionalText('layerId', 'base', 200),
      groupId: it.has('groupId') ? it.text('groupId', 200) : null,
      locked: it.boolean('locked', false),
      hidden: it.boolean('hidden', false)
    }
  })

  const connectors: Connector[] = (entry.has('connectors') ? entry.list('connectors', REASONING_LIMITS.links) : []).map((one) => {
    const it = new Reader(one)
    return {
      id: it.text('id', 200),
      from: it.text('from', 200),
      to: it.text('to', 200),
      type: it.text('type', 200),
      text: it.optionalText('text', '', 2000),
      layerId: it.optionalText('layerId', 'base', 200),
      waypoints: it.has('waypoints')
        ? it.list('waypoints', 1000).map((two) => {
            const that = new Reader(two)
            return { x: that.number('x'), y: that.number('y') }
          })
        : []
    }
  })

  const layers = entry.has('layers')
    ? entry.list('layers', 200).map((one) => {
        const it = new Reader(one)
        return {
          id: it.text('id', 200),
          name: it.optionalText('name', '', 400),
          order: Math.round(it.optionalNumber('order', 0)),
          visible: it.boolean('visible', true),
          locked: it.boolean('locked', false)
        }
      })
    : [{ id: 'base', name: 'Base', order: 0, visible: true, locked: false }]

  const groups = entry.has('groups')
    ? entry.list('groups', 2000).map((one) => {
        const it = new Reader(one)
        return { id: it.text('id', 200), name: it.optionalText('name', '', 400), parentId: it.has('parentId') ? it.text('parentId', 200) : null }
      })
    : []

  return {
    id: entry.optionalText('id', 'artifact', 200),
    builderId: entry.text('builderId', 200),
    version: Math.round(entry.optionalNumber('version', 1)),
    title: entry.optionalText('title', '', 400),
    objects,
    connectors,
    layers,
    groups
  }
}

function behavioursOf(read: Reader): Behaviour[] {
  return read.list('behaviours', 2000).map((one) => {
    const it = new Reader(one)
    return {
      objectId: it.text('objectId', 200),
      on: it.choice('on', ['click', 'change', 'enter', 'leave'] as const, 'click'),
      actions: it.list('actions', 100).map((two) => {
        const that = new Reader(two)
        const kind = that.choice('do', ['set-field', 'show', 'hide', 'go-to', 'compute', 'open'] as const, 'show')
        switch (kind) {
          case 'set-field':
            return { do: kind, objectId: that.text('objectId', 200), field: that.text('field', 200), to: fieldValueOf(that.raw('to'), 'An action value') }
          case 'show':
          case 'hide':
          case 'go-to':
            return { do: kind, objectId: that.text('objectId', 200) }
          case 'compute':
            return { do: kind, expression: that.text('expression', 4000), into: that.text('into', 200) }
          case 'open':
            return { do: kind, address: that.text('address', 4000) }
        }
      }) as Behaviour['actions']
    }
  })
}

// ---------------------------------------------------------------- projects

const DATA_TYPES = ['number', 'text', 'boolean', 'table', 'series', 'document', 'quantity', 'distribution', 'set'] as const

function portsOf(entry: Reader, key: string): Port[] {
  if (!entry.has(key)) return []
  return entry.list(key, 500).map((one) => {
    const it = new Reader(one)
    return {
      name: it.text('name', 200),
      type: it.choice('type', DATA_TYPES, 'number') as DataType,
      unit: it.optionalText('unit', '', 200),
      required: it.boolean('required', true),
      describe: it.optionalText('describe', '', 2000)
    }
  })
}

function projectOf(read: Reader, key = 'project'): Project {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput(`"${key}" has to be a project.`)
  const entry = new Reader(raw as Record<string, unknown>)

  const pages: PageInstance[] = (entry.has('pages') ? entry.list('pages', REASONING_LIMITS.pages) : []).map((one) => {
    const it = new Reader(one)
    const settings = it.raw('settings')
    if (settings !== undefined && (typeof settings !== 'object' || settings === null || Array.isArray(settings))) {
      throw new BadInput('A page’s settings are a set of named values.')
    }
    const pairs: [string, string | number | boolean][] = []
    for (const [name, held] of Object.entries((settings ?? {}) as Record<string, unknown>)) {
      if (pairs.length >= 200) throw new BadInput('A page holds at most 200 settings.')
      if (typeof held !== 'string' && typeof held !== 'number' && typeof held !== 'boolean') {
        throw new BadInput(`The setting "${name}" has to be text, a number or true/false.`)
      }
      pairs.push([name, held])
    }
    return {
      id: it.text('id', 200),
      pageType: it.text('pageType', 200),
      title: it.optionalText('title', '', 400),
      inputs: portsOf(it, 'inputs'),
      outputs: portsOf(it, 'outputs'),
      settings: namedRecord(pairs)
    }
  })

  const connections: Connection[] = (entry.has('connections') ? entry.list('connections', 5000) : []).map((one) => {
    const it = new Reader(one)
    return {
      id: it.text('id', 200),
      fromPage: it.text('fromPage', 200),
      fromPort: it.text('fromPort', 200),
      toPage: it.text('toPage', 200),
      toPort: it.text('toPort', 200),
      conversionName: it.has('conversionName') ? it.text('conversionName', 200) : null
    }
  })

  const conversions: Conversion[] = entry.has('conversions')
    ? entry.list('conversions', 2000).map((one) => {
        const it = new Reader(one)
        return {
          name: it.text('name', 200),
          from: it.choice('from', DATA_TYPES, 'number') as DataType,
          to: it.choice('to', DATA_TYPES, 'number') as DataType,
          fromUnit: it.optionalText('fromUnit', '', 200),
          toUnit: it.optionalText('toUnit', '', 200),
          lossy: it.boolean('lossy', false),
          describe: it.optionalText('describe', '', 2000)
        }
      })
    : []

  return { id: entry.optionalText('id', 'project', 200), title: entry.optionalText('title', '', 400), pages, connections, conversions }
}

function variablesOf(read: Reader, key = 'variables'): Variable[] {
  if (!read.has(key)) return []
  return read.list(key, 2000).map((one) => {
    const it = new Reader(one)
    const value = it.raw('value')
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new BadInput('A variable holds text, a number or true/false.')
    }
    return {
      name: it.text('name', 200),
      scope: it.choice('scope', ['project', 'page'] as const, 'project'),
      ownerId: it.has('ownerId') ? it.text('ownerId', 200) : null,
      type: it.choice('type', DATA_TYPES, 'number') as DataType,
      unit: it.optionalText('unit', '', 200),
      value
    }
  })
}

function projectArtifactsOf(read: Reader, key = 'artifacts'): ProjectArtifact[] {
  return read.list(key, 50_000).map((one) => {
    const it = new Reader(one)
    return {
      id: it.text('id', 200),
      producedBy: it.text('producedBy', 200),
      port: it.optionalText('port', '', 200),
      fingerprint: it.optionalText('fingerprint', '', 400),
      fromArtifacts: it.has('fromArtifacts') ? it.strings('fromArtifacts', 2000) : []
    }
  })
}

/**
 * The fingerprint a workspace node or project artifact would have now.
 *
 * Built here rather than taken from the Page: an artifact that reported its own current fingerprint could never be
 * stale, and a staleness check that can only say "current" is worse than no staleness check.
 */
const workspacePrint = (node: WorkNode, upstream: readonly string[]): string =>
  [node.kind, String(node.value ?? ''), node.unit, node.state, ...upstream].join('\u0000')

const artifactPrint = (artifact: ProjectArtifact, upstream: readonly string[]): string =>
  [artifact.producedBy, artifact.port, ...upstream].join('\u0000')

// ---------------------------------------------------------------- dispatch

export function runReasoningOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- workspaces
    case 'workspace.check': {
      // The engine's `ok` means "the workspace holds together"; the envelope's means "the request ran". Renamed
      // rather than spread over the top, which would answer the wrong question.
      const { ok: holdsTogether, ...rest } = checkStructure(workspaceOf(read))
      return { ok: true, holdsTogether, ...rest }
    }

    case 'workspace.order': {
      const result = workspaceOrder(workspaceOf(read))
      return isWorkspaceError(result) ? { ok: false, ...result } : { ok: true, order: result }
    }

    case 'workspace.assumptions':
      return { ok: true, assumptions: assumptionRegister(workspaceOf(read)) }

    case 'workspace.impact':
      return settle(ifAssumptionChanged(workspaceOf(read), read.text('assumptionId', 200)), isWorkspaceError)

    case 'workspace.staleness':
      return settle(assessWorkspaceStaleness(workspaceOf(read), workspacePrint), isWorkspaceError)

    case 'workspace.approaches':
      return settle(
        compareApproaches(workspaceOf(read), approachesOf(read), read.text('subproblemId', 200), read.optionalNumber('tolerance', 1e-6)),
        isWorkspaceError
      )

    case 'workspace.report': {
      const workspace = workspaceOf(read)
      const staleness = assessWorkspaceStaleness(workspace, workspacePrint)
      return { ok: true, ...buildReport(workspace, isWorkspaceError(staleness) ? null : staleness) }
    }

    // ---------------------------------------------------------------- scenarios
    case 'scenario.check':
      return { ok: true, problems: checkScenario(baselineOf(read), scenarioOf(read.raw('scenario'), '"scenario"')) }

    case 'scenario.resolve':
      return settle(resolveScenario(baselineOf(read), scenariosOf(read), read.text('scenarioId', 200)), isScenarioError)

    case 'scenario.matrix': {
      const axes: Axis[] = read.list('axes', 32).map((one) => {
        const it = new Reader(one)
        const values = it.raw('values')
        if (!Array.isArray(values)) throw new BadInput('An axis needs a list of values.')
        if (values.length > 10_000) throw new BadInput('An axis has more values than are allowed.')
        return {
          key: it.text('key', 400),
          label: it.optionalText('label', '', 400),
          values: values.map((two) => scenarioValueOf(two, 'An axis value'))
        }
      })
      const result = buildMatrix(baselineOf(read), axes, read.optionalText('because', 'scenario matrix', 2000))
      return isScenarioError(result) ? { ok: false, ...result } : { ok: true, cells: result }
    }

    case 'scenario.difference':
      return {
        ok: true,
        ...differenceMap(numberRecordOf(read, 'baselineOutputs'), numberRecordOf(read, 'scenarioOutputs'), read.optionalNumber('tolerance', 0))
      }

    case 'scenario.conflicts':
      return { ok: true, conflicts: findConflicts(scenariosOf(read)) }

    case 'scenario.merge':
      return settle(mergeScenarios(scenariosOf(read), read.text('id', 200), read.optionalText('label', '', 400)), isScenarioError)

    case 'scenario.timeline': {
      const events: ScenarioEvent[] = read.list('events', 1000).map((one) => {
        const it = new Reader(one)
        return {
          at: it.number('at'),
          key: it.text('key', 400),
          how: it.choice('how', ['set', 'add', 'multiply'] as const, 'set'),
          to: scenarioValueOf(it.raw('to'), 'An event value'),
          because: it.optionalText('because', '', 2000)
        }
      })
      return settle(playTimeline(baselineOf(read), events, read.numbers('steps', 10_000)), isScenarioError)
    }

    // ---------------------------------------------------------------- learning
    case 'learning.topic': {
      const topic = topicOf(read)
      const order = learningOrder(topic)
      return { ok: true, problems: checkTopic(topic), order: isLearningError(order) ? null : order }
    }

    case 'learning.analyse': {
      const topic = topicOf(read)
      const analysis = analyseExplanation(topic, read.text('explanation', REASONING_LIMITS.text))
      if (isLearningError(analysis)) return { ok: false, ...analysis }
      return { ok: true, ...analysis, question: socraticQuestion(topic, analysis) }
    }

    case 'learning.hint': {
      const topic = topicOf(read)
      const analysis = analyseExplanation(topic, read.text('explanation', REASONING_LIMITS.text))
      if (isLearningError(analysis)) return { ok: false, ...analysis }
      return settle(hintFor(topic, analysis, Math.round(read.number('level'))), isLearningError)
    }

    case 'learning.mastery': {
      const topic = topicOf(read)
      return { ok: true, ...masteryOf(topic, sessionOf(read, topic)) }
    }

    case 'learning.review': {
      const topic = topicOf(read)
      return { ok: true, queue: reviewQueue(topic, sessionOf(read, topic)) }
    }

    // ---------------------------------------------------------------- builders
    case 'builder.validate': {
      // The report's own `ok` means "nothing here would stop it working", not "the request ran". `settle` would have
      // spread it over the envelope's, so a Page checking `ok` would have been told its request failed.
      const report = validateArtifact(registry, artifactOf(read))
      if (isBuilderError(report)) return { ok: false, ...report }
      const { ok: valid, ...rest } = report
      return { ok: true, valid, ...rest }
    }

    case 'builder.select':
      return { ok: true, ...resolveSelection(artifactOf(read), read.strings('ids', REASONING_LIMITS.objects)) }

    case 'builder.arrange': {
      const artifact = artifactOf(read)
      const selection = resolveSelection(artifact, read.strings('ids', REASONING_LIMITS.objects))
      const objects = artifact.objects.filter((one) => selection.objectIds.includes(one.id))
      const how = read.choice('how', ['left', 'right', 'top', 'bottom', 'centre-x', 'centre-y', 'distribute-x', 'distribute-y'] as const, 'left')
      const moved =
        how === 'distribute-x' ? distribute(objects, 'x') : how === 'distribute-y' ? distribute(objects, 'y') : align(objects, how)
      if (isBuilderError(moved)) return { ok: false, ...moved, excluded: selection.excluded }
      return {
        ok: true,
        moved: [...moved.entries()].map(([id, box]) => ({ id, box })),
        excluded: selection.excluded
      }
    }

    case 'builder.route': {
      const artifact = artifactOf(read)
      const id = read.text('connectorId', 200)
      const connector = artifact.connectors.find((one) => one.id === id)
      if (!connector) throw new BadInput(`There is no connector called "${id}" in this artifact.`)
      return settle(routeConnector(artifact, connector), isBuilderError)
    }

    case 'builder.behaviour': {
      const artifact = artifactOf(read)
      const behaviours = behavioursOf(read)
      return {
        ok: true,
        issues: behaviours.flatMap((one) => checkBehaviour(artifact, one)),
        cycle: bindingCycle(behaviours)
      }
    }

    // ---------------------------------------------------------------- projects
    case 'project.check': {
      const { ok: holdsTogether, ...rest } = checkProject(projectOf(read))
      return { ok: true, holdsTogether, ...rest }
    }

    case 'project.order':
      return settle(runOrder(projectOf(read)), isProjectError)

    case 'project.variables': {
      const variables = variablesOf(read)
      if (read.has('name')) {
        return settle(resolveVariable(variables, read.optionalText('pageId', '', 200), read.text('name', 200)), isProjectError)
      }
      return { ok: true, shadowed: shadowedVariables(variables) }
    }

    case 'project.lineage':
      return settle(lineageOf(projectArtifactsOf(read), read.text('artifactId', 200)), isProjectError)

    case 'project.staleness':
      return { ok: true, ...assessArtifacts(projectArtifactsOf(read), artifactPrint) }

    case 'project.diff':
      return { ok: true, ...diffProjects(projectOf(read, 'before'), projectOf(read, 'after')) }

    case 'project.import': {
      const project = projectOf(read)
      const report = importBundle(
        { project, variables: variablesOf(read), requires: read.has('requires') ? read.strings('requires', 500).map((pageType) => ({ pageType })) : requirementsOf(project) },
        read.strings('availablePageTypes', 500),
        read.has('existingIds') ? read.strings('existingIds', REASONING_LIMITS.pages) : []
      )
      // The engine's own `ok` means "the import can go ahead", which is not the envelope's "the request ran".
      const { ok: importable, ...rest } = report
      return { ok: true, importable, ...rest }
    }
  }

  // Reached only when an operation is in this file's capability map and has no case here, which is ours to fix.
  throw new BadInput(`"${operation}" has a capability but no implementation, which is a bug in Orbis rather than in your Page.`)
}
