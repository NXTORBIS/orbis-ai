/**
 * The builder framework: one object model behind every editor Orbis offers.
 *
 * A flowchart, a mind map, a timeline, a form and a decision tree differ in what their objects mean, not in what
 * editing them requires. Selection, alignment, grouping, layers, connectors and undo are the same problem each time,
 * so they live here once and each builder contributes only its own rules.
 *
 * ## Validation belongs to the builder
 *
 * A mind map with two roots is broken; a flowchart with two entry points is fine. The framework cannot know which,
 * so each builder registers `validate` and the framework refuses to guess. A builder with no validation is registered
 * as having none rather than treated as always valid -- the difference shows up in the report.
 *
 * ## Actions are data
 *
 * An artifact's interactive behaviour is a list of typed actions -- set a field, go to an object, run a named
 * computation. Never code. An editor that lets a document carry executable behaviour means opening a shared document
 * runs somebody else's program, and no amount of sandboxing makes that a good default.
 */

export interface BuilderError {
  error: string
  message: string
}

export const isBuilderError = (value: unknown): value is BuilderError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): BuilderError => ({ error, message })

export const BUILDER_LIMITS: Readonly<Record<'objects' | 'connectors' | 'layers' | 'groupDepth' | 'actions' | 'history', number>> =
  Object.freeze({
    objects: 20_000,
    connectors: 40_000,
    layers: 200,
    groupDepth: 12,
    actions: 50,
    history: 500
  })

// ---------------------------------------------------------------- the object model

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export type FieldValue = number | string | boolean | null

export interface ArtifactObject {
  id: string
  /** What the builder calls this: 'step', 'branch', 'node', 'field', 'row', 'event'. Builders define their own. */
  type: string
  box: Box
  text: string
  /** Builder-specific properties. Never code, never functions. */
  fields: Record<string, FieldValue>
  layerId: string
  /** The group this belongs to, or null. Groups nest. */
  groupId: string | null
  locked: boolean
  hidden: boolean
}

export interface Connector {
  id: string
  from: string
  to: string
  /** What the builder calls this relation: 'next', 'yes', 'no', 'depends-on'. */
  type: string
  text: string
  layerId: string
  /** Waypoints the user placed, in order. Empty means routed automatically. */
  waypoints: { x: number; y: number }[]
}

export interface Layer {
  id: string
  name: string
  order: number
  visible: boolean
  locked: boolean
}

export interface Group {
  id: string
  name: string
  parentId: string | null
}

export interface Artifact {
  id: string
  builderId: string
  /** The schema version this was saved under, which is what makes migration possible rather than guessed. */
  version: number
  title: string
  objects: ArtifactObject[]
  connectors: Connector[]
  layers: Layer[]
  groups: Group[]
}

export const emptyArtifact = (id: string, builderId: string, title: string, version: number): Artifact => ({
  id,
  builderId,
  version,
  title,
  objects: [],
  connectors: [],
  layers: [{ id: 'base', name: 'Base', order: 0, visible: true, locked: false }],
  groups: []
})

// ---------------------------------------------------------------- the registry

export interface ValidationIssue {
  kind: string
  objectIds: string[]
  describe: string
  blocking: boolean
}

export interface Builder {
  id: string
  name: string
  /** Object types this builder allows. An object of any other type is refused at validation. */
  objectTypes: string[]
  connectorTypes: string[]
  version: number
  /** The builder's own rules. Omitted means this builder has no rules, which is reported rather than assumed valid. */
  validate?: (artifact: Artifact) => ValidationIssue[]
  /** Upgrade an artifact one version at a time. Keyed by the version being upgraded *from*. */
  migrations?: Record<number, (artifact: Artifact) => Artifact>
}

export class BuilderRegistry {
  #builders = new Map<string, Builder>()

  register(builder: Builder): BuilderError | null {
    if (this.#builders.has(builder.id)) return fail('duplicate', `A builder with the id "${builder.id}" is already registered.`)
    if (builder.objectTypes.length === 0) return fail('no-types', `"${builder.name}" allows no object types, so nothing can be put in it.`)
    this.#builders.set(builder.id, builder)
    return null
  }

  get(id: string): Builder | undefined {
    return this.#builders.get(id)
  }

  list(): Builder[] {
    return [...this.#builders.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
}

export interface ValidationReport {
  builderId: string
  issues: ValidationIssue[]
  ok: boolean
  /** True when the builder registered no rules of its own, so only the framework's checks ran. */
  builderHasNoRules: boolean
  describe: string
}

/**
 * Check an artifact: the framework's structural rules, then the builder's own.
 *
 * The framework checks what is true of every artifact -- connectors pointing at objects that exist, objects on layers
 * that exist, groups that do not contain themselves. What a valid flowchart is, only the flowchart builder knows.
 */
export function validate(registry: BuilderRegistry, artifact: Artifact): ValidationReport | BuilderError {
  const builder = registry.get(artifact.builderId)
  if (!builder) return fail('no-such-builder', `There is no builder registered as "${artifact.builderId}".`)

  const issues: ValidationIssue[] = []
  const objectIds = new Set<string>()
  const layerIds = new Set(artifact.layers.map((one) => one.id))
  const groupIds = new Set(artifact.groups.map((one) => one.id))

  if (artifact.objects.length > BUILDER_LIMITS.objects) {
    issues.push({ kind: 'too-large', objectIds: [], describe: `${artifact.objects.length.toLocaleString('en')} objects, past the ${BUILDER_LIMITS.objects.toLocaleString('en')} allowed.`, blocking: true })
  }

  for (const object of artifact.objects) {
    if (objectIds.has(object.id)) {
      issues.push({ kind: 'duplicate-id', objectIds: [object.id], describe: `Two objects share the id "${object.id}".`, blocking: true })
    }
    objectIds.add(object.id)
    if (!builder.objectTypes.includes(object.type)) {
      issues.push({
        kind: 'unknown-type',
        objectIds: [object.id],
        describe: `"${object.type}" is not an object type ${builder.name} knows. It allows ${builder.objectTypes.join(', ')}.`,
        blocking: true
      })
    }
    if (!layerIds.has(object.layerId)) {
      issues.push({ kind: 'missing-layer', objectIds: [object.id], describe: `"${object.text || object.id}" is on layer "${object.layerId}", which does not exist.`, blocking: true })
    }
    if (object.groupId !== null && !groupIds.has(object.groupId)) {
      issues.push({ kind: 'missing-group', objectIds: [object.id], describe: `"${object.text || object.id}" is in group "${object.groupId}", which does not exist.`, blocking: true })
    }
    if (!Number.isFinite(object.box.width) || !Number.isFinite(object.box.height) || object.box.width < 0 || object.box.height < 0) {
      issues.push({ kind: 'bad-size', objectIds: [object.id], describe: `"${object.text || object.id}" has a size that cannot be drawn.`, blocking: true })
    }
  }

  for (const connector of artifact.connectors) {
    const missing = [connector.from, connector.to].filter((one) => !objectIds.has(one))
    if (missing.length > 0) {
      issues.push({
        kind: 'dangling-connector',
        objectIds: missing,
        describe: `A ${connector.type} connector points at ${missing.join(' and ')}, which ${missing.length === 1 ? 'is' : 'are'} not in this artifact.`,
        blocking: true
      })
    }
    if (!builder.connectorTypes.includes(connector.type)) {
      issues.push({
        kind: 'unknown-connector-type',
        objectIds: [connector.id],
        describe: `"${connector.type}" is not a connector type ${builder.name} knows.`,
        blocking: true
      })
    }
  }

  const groupCycle = findGroupCycle(artifact)
  if (groupCycle) {
    issues.push({ kind: 'group-cycle', objectIds: groupCycle, describe: `Groups ${groupCycle.join(' -> ')} contain each other.`, blocking: true })
  }

  const ownIssues = builder.validate ? builder.validate(artifact) : []
  issues.push(...ownIssues)

  const blocking = issues.filter((one) => one.blocking).length
  return {
    builderId: builder.id,
    issues,
    ok: blocking === 0,
    builderHasNoRules: builder.validate === undefined,
    describe:
      builder.validate === undefined
        ? `${blocking === 0 ? 'The structure holds' : `${blocking} structural problem${blocking === 1 ? '' : 's'}`}. ${builder.name} registers no rules of its own, so nothing here checks whether this is a sensible ${builder.name.toLowerCase()}.`
        : blocking === 0
          ? `No blocking problems${issues.length > 0 ? `, ${issues.length} thing${issues.length === 1 ? '' : 's'} worth looking at` : ''}.`
          : `${blocking} problem${blocking === 1 ? '' : 's'} that would stop this working.`
  }
}

function findGroupCycle(artifact: Artifact): string[] | null {
  const parent = new Map(artifact.groups.map((one) => [one.id, one.parentId]))
  for (const group of artifact.groups) {
    const seen: string[] = [group.id]
    let cursor = parent.get(group.id) ?? null
    let depth = 0
    while (cursor !== null && depth < BUILDER_LIMITS.groupDepth + 1) {
      if (seen.includes(cursor)) return [...seen.slice(seen.indexOf(cursor)), cursor]
      seen.push(cursor)
      cursor = parent.get(cursor) ?? null
      depth += 1
    }
  }
  return null
}

// ---------------------------------------------------------------- selection

export interface Selection {
  objectIds: string[]
  /** Objects excluded because they or their layer are locked, kept so the reason is visible. */
  excluded: { id: string; why: string }[]
}

/**
 * Work out what a selection actually covers.
 *
 * Selecting one member of a group selects the group, which is what grouping is for. Locked objects are excluded and
 * the exclusion is reported: a drag that silently moves four of five selected objects looks like a bug in the drag.
 */
export function resolveSelection(artifact: Artifact, ids: readonly string[]): Selection {
  const byId = new Map(artifact.objects.map((one) => [one.id, one]))
  const layers = new Map(artifact.layers.map((one) => [one.id, one]))
  const wanted = new Set<string>()

  for (const id of ids) {
    const object = byId.get(id)
    if (!object) continue
    if (object.groupId === null) {
      wanted.add(id)
      continue
    }
    const top = topGroupOf(artifact, object.groupId)
    for (const member of artifact.objects) {
      if (member.groupId !== null && topGroupOf(artifact, member.groupId) === top) wanted.add(member.id)
    }
  }

  const objectIds: string[] = []
  const excluded: Selection['excluded'] = []
  for (const id of [...wanted].sort()) {
    const object = byId.get(id) as ArtifactObject
    const layer = layers.get(object.layerId)
    if (object.locked) {
      excluded.push({ id, why: `"${object.text || id}" is locked.` })
    } else if (layer?.locked === true) {
      excluded.push({ id, why: `"${object.text || id}" is on the locked layer "${layer.name}".` })
    } else if (layer?.visible === false) {
      excluded.push({ id, why: `"${object.text || id}" is on the hidden layer "${layer.name}".` })
    } else {
      objectIds.push(id)
    }
  }

  return { objectIds, excluded }
}

function topGroupOf(artifact: Artifact, groupId: string): string {
  const parent = new Map(artifact.groups.map((one) => [one.id, one.parentId]))
  let cursor = groupId
  const seen = new Set<string>()
  for (let depth = 0; depth < BUILDER_LIMITS.groupDepth; depth += 1) {
    if (seen.has(cursor)) return cursor
    seen.add(cursor)
    const next = parent.get(cursor) ?? null
    if (next === null) return cursor
    cursor = next
  }
  return cursor
}

// ---------------------------------------------------------------- geometry

export type Alignment = 'left' | 'right' | 'top' | 'bottom' | 'centre-x' | 'centre-y'

/** Where each object would move to, computed against the selection's own extent. */
export function align(objects: readonly ArtifactObject[], how: Alignment): Map<string, Box> | BuilderError {
  if (objects.length < 2) return fail('too-few', 'Aligning needs at least two objects; one object is already aligned with itself.')

  const lefts = objects.map((one) => one.box.x)
  const rights = objects.map((one) => one.box.x + one.box.width)
  const tops = objects.map((one) => one.box.y)
  const bottoms = objects.map((one) => one.box.y + one.box.height)

  const out = new Map<string, Box>()
  for (const object of objects) {
    const box = { ...object.box }
    switch (how) {
      case 'left':
        box.x = Math.min(...lefts)
        break
      case 'right':
        box.x = Math.max(...rights) - box.width
        break
      case 'top':
        box.y = Math.min(...tops)
        break
      case 'bottom':
        box.y = Math.max(...bottoms) - box.height
        break
      case 'centre-x':
        box.x = (Math.min(...lefts) + Math.max(...rights)) / 2 - box.width / 2
        break
      case 'centre-y':
        box.y = (Math.min(...tops) + Math.max(...bottoms)) / 2 - box.height / 2
        break
    }
    out.set(object.id, box)
  }
  return out
}

/**
 * Space objects evenly.
 *
 * The gaps are made equal, not the centres: equal centres on differently-sized objects look wrong, which is the
 * thing the user was trying to fix. The first and last stay put, so the overall extent does not change.
 */
export function distribute(objects: readonly ArtifactObject[], axis: 'x' | 'y'): Map<string, Box> | BuilderError {
  if (objects.length < 3) return fail('too-few', 'Distributing needs at least three objects; with two there is only one gap.')

  const size = (one: ArtifactObject): number => (axis === 'x' ? one.box.width : one.box.height)
  const start = (one: ArtifactObject): number => (axis === 'x' ? one.box.x : one.box.y)
  const sorted = [...objects].sort((a, b) => start(a) - start(b))

  const first = sorted[0] as ArtifactObject
  const last = sorted[sorted.length - 1] as ArtifactObject
  const span = start(last) + size(last) - start(first)
  const used = sorted.reduce((running, one) => running + size(one), 0)
  const gap = (span - used) / (sorted.length - 1)

  if (!Number.isFinite(gap)) return fail('not-distributable', 'These objects have no finite extent to distribute across.')

  const out = new Map<string, Box>()
  let cursor = start(first)
  for (const object of sorted) {
    const box = { ...object.box }
    if (axis === 'x') box.x = cursor
    else box.y = cursor
    out.set(object.id, box)
    cursor += size(object) + gap
  }
  return out
}

/** Snap a value to a grid. Kept separate so the grid size is the caller's, not a constant buried in a drag handler. */
export const snap = (value: number, grid: number): number => (grid <= 0 ? value : Math.round(value / grid) * grid)

// ---------------------------------------------------------------- routing

export interface Route {
  connectorId: string
  points: { x: number; y: number }[]
  /** True when the user placed the waypoints, so nothing here moved them. */
  manual: boolean
  /** Objects the route passes through, which is a fact about the layout rather than a fix. */
  crosses: string[]
}

/**
 * Where a connector's line goes.
 *
 * Orthogonal routing between the nearest edges. User waypoints are used exactly as placed and never adjusted -- a
 * router that improves a hand-placed route is a router that undoes work without being asked.
 */
export function routeConnector(artifact: Artifact, connector: Connector): Route | BuilderError {
  const from = artifact.objects.find((one) => one.id === connector.from)
  const to = artifact.objects.find((one) => one.id === connector.to)
  if (!from || !to) return fail('dangling', 'This connector points at an object that is not in the artifact.')

  if (connector.waypoints.length > 0) {
    const points = [centreOf(from.box), ...connector.waypoints, centreOf(to.box)]
    return { connectorId: connector.id, points, manual: true, crosses: crossedBy(artifact, points, [from.id, to.id]) }
  }

  const a = centreOf(from.box)
  const b = centreOf(to.box)
  const horizontalFirst = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
  const exit = horizontalFirst
    ? { x: b.x > a.x ? from.box.x + from.box.width : from.box.x, y: a.y }
    : { x: a.x, y: b.y > a.y ? from.box.y + from.box.height : from.box.y }
  const enter = horizontalFirst
    ? { x: b.x > a.x ? to.box.x : to.box.x + to.box.width, y: b.y }
    : { x: b.x, y: b.y > a.y ? to.box.y : to.box.y + to.box.height }
  const bend = horizontalFirst ? { x: (exit.x + enter.x) / 2, y: exit.y } : { x: exit.x, y: (exit.y + enter.y) / 2 }
  const bend2 = horizontalFirst ? { x: bend.x, y: enter.y } : { x: enter.x, y: bend.y }

  const points = [exit, bend, bend2, enter]
  return { connectorId: connector.id, points, manual: false, crosses: crossedBy(artifact, points, [from.id, to.id]) }
}

const centreOf = (box: Box): { x: number; y: number } => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

function crossedBy(artifact: Artifact, points: readonly { x: number; y: number }[], ignore: readonly string[]): string[] {
  const crosses: string[] = []
  for (const object of artifact.objects) {
    if (ignore.includes(object.id) || object.hidden) continue
    for (let i = 1; i < points.length; i += 1) {
      if (segmentHitsBox(points[i - 1] as { x: number; y: number }, points[i] as { x: number; y: number }, object.box)) {
        crosses.push(object.id)
        break
      }
    }
  }
  return crosses
}

function segmentHitsBox(a: { x: number; y: number }, b: { x: number; y: number }, box: Box): boolean {
  // Only axis-aligned segments are produced, so a bounding overlap is exact rather than an approximation.
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return maxX > box.x && minX < box.x + box.width && maxY > box.y && minY < box.y + box.height
}

// ---------------------------------------------------------------- actions

export type Action =
  | { do: 'set-field'; objectId: string; field: string; to: FieldValue }
  | { do: 'show'; objectId: string }
  | { do: 'hide'; objectId: string }
  | { do: 'go-to'; objectId: string }
  | { do: 'compute'; expression: string; into: string }
  | { do: 'open'; address: string }

export interface Behaviour {
  objectId: string
  on: 'click' | 'change' | 'enter' | 'leave'
  actions: Action[]
}

/**
 * Whether a behaviour is one this framework will run.
 *
 * The allowed actions are a closed list, and `compute` carries an expression that the shared expression evaluator
 * parses -- not code. An artifact that could carry code would mean opening a document somebody sent you runs their
 * program, and every editor that allowed it came to regret it.
 */
export function checkBehaviour(artifact: Artifact, behaviour: Behaviour): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ids = new Set(artifact.objects.map((one) => one.id))

  if (!ids.has(behaviour.objectId)) {
    issues.push({ kind: 'missing-object', objectIds: [behaviour.objectId], describe: 'This behaviour is attached to an object that is not in the artifact.', blocking: true })
  }
  if (behaviour.actions.length === 0) {
    issues.push({ kind: 'no-actions', objectIds: [behaviour.objectId], describe: 'This behaviour does nothing.', blocking: false })
  }
  if (behaviour.actions.length > BUILDER_LIMITS.actions) {
    issues.push({ kind: 'too-many-actions', objectIds: [behaviour.objectId], describe: `${behaviour.actions.length} actions, past the ${BUILDER_LIMITS.actions} allowed.`, blocking: true })
  }

  for (const action of behaviour.actions) {
    switch (action.do) {
      case 'set-field':
      case 'show':
      case 'hide':
      case 'go-to': {
        const target = 'objectId' in action ? action.objectId : ''
        if (!ids.has(target)) {
          issues.push({ kind: 'missing-target', objectIds: [target], describe: `A ${action.do} action points at "${target}", which is not in this artifact.`, blocking: true })
        }
        break
      }
      case 'compute':
        if (action.expression.trim() === '') {
          issues.push({ kind: 'empty-expression', objectIds: [behaviour.objectId], describe: 'A compute action has no expression.', blocking: true })
        }
        if (!ids.has(action.into)) {
          issues.push({ kind: 'missing-target', objectIds: [action.into], describe: `A compute action writes into "${action.into}", which is not in this artifact.`, blocking: true })
        }
        break
      case 'open':
        if (!/^orbis:\/\//.test(action.address)) {
          issues.push({
            kind: 'external-address',
            objectIds: [behaviour.objectId],
            describe: `An open action points at "${action.address}", which is outside Orbis. Opening it is the user's decision each time, not the artifact's.`,
            blocking: true
          })
        }
        break
    }
  }

  return issues
}

/** Where each object's field values come from: the fields another object's compute action writes. */
export function bindingGraph(behaviours: readonly Behaviour[]): { from: string; to: string; expression: string }[] {
  const edges: { from: string; to: string; expression: string }[] = []
  for (const behaviour of behaviours) {
    for (const action of behaviour.actions) {
      if (action.do === 'compute') edges.push({ from: behaviour.objectId, to: action.into, expression: action.expression })
    }
  }
  return edges
}

/** Circular bindings, found before anything runs rather than by running out of stack. */
export function bindingCycle(behaviours: readonly Behaviour[]): string[] | null {
  const edges = new Map<string, string[]>()
  for (const edge of bindingGraph(behaviours)) {
    const list = edges.get(edge.from) ?? []
    list.push(edge.to)
    edges.set(edge.from, list)
  }

  const colour = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  let found: string[] | null = null

  const visit = (id: string): boolean => {
    colour.set(id, 1)
    stack.push(id)
    for (const next of edges.get(id) ?? []) {
      if (colour.get(next) === 1) {
        found = [...stack.slice(stack.indexOf(next)), next]
        return true
      }
      if ((colour.get(next) ?? 0) === 0 && visit(next)) return true
    }
    colour.set(id, 2)
    stack.pop()
    return false
  }

  for (const id of edges.keys()) {
    if ((colour.get(id) ?? 0) === 0 && visit(id)) break
  }
  return found
}

// ---------------------------------------------------------------- migration

export interface Migration {
  artifact: Artifact
  /** Each version step that ran, so an unexpected result can be traced to the step that produced it. */
  steps: { from: number; to: number }[]
  describe: string
}

/**
 * Bring an artifact up to the builder's current version, one step at a time.
 *
 * Each step is a separate function from one version to the next, so a v2 artifact and a v4 artifact reach v5 through
 * the same code paths. A single "upgrade from anything" function is where migration bugs live, because the old cases
 * stop being exercised the moment nobody has a v2 file any more.
 */
export function migrate(registry: BuilderRegistry, artifact: Artifact): Migration | BuilderError {
  const builder = registry.get(artifact.builderId)
  if (!builder) return fail('no-such-builder', `There is no builder registered as "${artifact.builderId}".`)

  if (artifact.version > builder.version) {
    return fail(
      'from-the-future',
      `This was saved by version ${artifact.version} of ${builder.name} and this copy is version ${builder.version}. Opening it could quietly drop whatever the newer version added, so it is refused.`
    )
  }
  if (artifact.version === builder.version) {
    return { artifact, steps: [], describe: 'Already at the current version.' }
  }

  let current = artifact
  const steps: Migration['steps'] = []
  while (current.version < builder.version) {
    const step = builder.migrations?.[current.version]
    if (!step) {
      return fail(
        'no-migration',
        `${builder.name} has no migration from version ${current.version} to ${current.version + 1}, so this artifact cannot be opened without guessing at what changed.`
      )
    }
    const next = step(current)
    if (next.version !== current.version + 1) {
      return fail('bad-migration', `The migration from version ${current.version} produced version ${next.version} rather than ${current.version + 1}.`)
    }
    steps.push({ from: current.version, to: next.version })
    current = next
  }

  return {
    artifact: current,
    steps,
    describe: `Upgraded from version ${artifact.version} to ${current.version} in ${steps.length} step${steps.length === 1 ? '' : 's'}.`
  }
}

// ---------------------------------------------------------------- built-in builders

const oneEntry = (artifact: Artifact, entryTypes: readonly string[], what: string): ValidationIssue[] => {
  const targets = new Set(artifact.connectors.map((one) => one.to))
  const entries = artifact.objects.filter((one) => entryTypes.includes(one.type) && !targets.has(one.id))
  if (entries.length === 0 && artifact.objects.length > 0) {
    return [{ kind: 'no-entry', objectIds: [], describe: `Every object has something pointing at it, so there is no place this ${what} starts.`, blocking: true }]
  }
  return []
}

const unreachable = (artifact: Artifact, what: string): ValidationIssue[] => {
  if (artifact.objects.length === 0) return []
  const targets = new Set(artifact.connectors.map((one) => one.to))
  const roots = artifact.objects.filter((one) => !targets.has(one.id)).map((one) => one.id)
  if (roots.length === 0) return []

  const reached = new Set(roots)
  const stack = [...roots]
  while (stack.length > 0) {
    const id = stack.pop() as string
    for (const connector of artifact.connectors) {
      if (connector.from === id && !reached.has(connector.to)) {
        reached.add(connector.to)
        stack.push(connector.to)
      }
    }
  }

  const stranded = artifact.objects.filter((one) => !reached.has(one.id)).map((one) => one.id)
  return stranded.length === 0
    ? []
    : [{ kind: 'unreachable', objectIds: stranded, describe: `${stranded.length} object${stranded.length === 1 ? '' : 's'} cannot be reached from where the ${what} starts.`, blocking: false }]
}

/** The builders Orbis ships. Each contributes only its own rules; everything else comes from the framework. */
export function builtInBuilders(): Builder[] {
  return [
    {
      id: 'flowchart',
      name: 'Flowchart',
      objectTypes: ['start', 'end', 'step', 'decision', 'input-output'],
      connectorTypes: ['next', 'yes', 'no'],
      version: 1,
      validate: (artifact) => {
        const issues: ValidationIssue[] = [...oneEntry(artifact, ['start', 'step', 'decision', 'input-output'], 'flowchart'), ...unreachable(artifact, 'flowchart')]
        for (const decision of artifact.objects.filter((one) => one.type === 'decision')) {
          const out = artifact.connectors.filter((one) => one.from === decision.id)
          const labelled = new Set(out.map((one) => one.type))
          if (out.length < 2) {
            issues.push({ kind: 'decision-one-way', objectIds: [decision.id], describe: `"${decision.text || decision.id}" is a decision with ${out.length} way out. A decision that always goes the same way is a step.`, blocking: true })
          } else if (!labelled.has('yes') || !labelled.has('no')) {
            issues.push({ kind: 'decision-unlabelled', objectIds: [decision.id], describe: `The branches out of "${decision.text || decision.id}" are not labelled yes and no, so which is which is guesswork.`, blocking: false })
          }
        }
        if (artifact.objects.length > 0 && !artifact.objects.some((one) => one.type === 'end')) {
          issues.push({ kind: 'no-end', objectIds: [], describe: 'This flowchart has no end, so it does not say when it is finished.', blocking: false })
        }
        return issues
      }
    },
    {
      id: 'mind-map',
      name: 'Mind map',
      objectTypes: ['root', 'branch'],
      connectorTypes: ['child'],
      version: 1,
      validate: (artifact) => {
        const issues: ValidationIssue[] = []
        const roots = artifact.objects.filter((one) => one.type === 'root')
        if (artifact.objects.length > 0 && roots.length !== 1) {
          issues.push({
            kind: 'root-count',
            objectIds: roots.map((one) => one.id),
            describe: roots.length === 0 ? 'A mind map needs a root.' : `A mind map has one root; this has ${roots.length}. Two roots is two mind maps.`,
            blocking: true
          })
        }
        const parents = new Map<string, number>()
        for (const connector of artifact.connectors) parents.set(connector.to, (parents.get(connector.to) ?? 0) + 1)
        for (const [id, count] of parents) {
          if (count > 1) {
            issues.push({ kind: 'two-parents', objectIds: [id], describe: 'A branch has more than one parent, which makes this a graph rather than a mind map.', blocking: true })
          }
        }
        issues.push(...unreachable(artifact, 'mind map'))
        return issues
      }
    },
    {
      id: 'timeline',
      name: 'Timeline',
      objectTypes: ['event', 'period', 'marker'],
      connectorTypes: ['leads-to'],
      version: 1,
      validate: (artifact) => {
        const issues: ValidationIssue[] = []
        for (const object of artifact.objects) {
          const at = object.fields.at
          if (typeof at !== 'number' || !Number.isFinite(at)) {
            issues.push({ kind: 'no-time', objectIds: [object.id], describe: `"${object.text || object.id}" has no time on it, so it cannot be placed.`, blocking: true })
            continue
          }
          const until = object.fields.until
          if (object.type === 'period') {
            if (typeof until !== 'number') {
              issues.push({ kind: 'no-end-time', objectIds: [object.id], describe: `"${object.text || object.id}" is a period with no end.`, blocking: true })
            } else if (until < at) {
              issues.push({ kind: 'backwards', objectIds: [object.id], describe: `"${object.text || object.id}" ends before it starts.`, blocking: true })
            }
          }
        }
        return issues
      }
    },
    {
      id: 'form',
      name: 'Form',
      objectTypes: ['text-field', 'number-field', 'choice', 'checkbox', 'section'],
      connectorTypes: ['shows-when'],
      version: 1,
      validate: (artifact) => {
        const issues: ValidationIssue[] = []
        const names = new Map<string, string[]>()
        for (const object of artifact.objects) {
          if (object.type === 'section') continue
          const name = typeof object.fields.name === 'string' ? object.fields.name : ''
          if (name === '') {
            issues.push({ kind: 'unnamed-field', objectIds: [object.id], describe: `"${object.text || object.id}" has no name, so nothing can read what is entered into it.`, blocking: true })
            continue
          }
          const list = names.get(name) ?? []
          list.push(object.id)
          names.set(name, list)
          if (object.type === 'choice' && !Array.isArray(object.fields.options as unknown) && typeof object.fields.options !== 'string') {
            issues.push({ kind: 'no-options', objectIds: [object.id], describe: `"${object.text || object.id}" is a choice with no options.`, blocking: true })
          }
        }
        for (const [name, ids] of names) {
          if (ids.length > 1) {
            issues.push({ kind: 'duplicate-name', objectIds: ids, describe: `${ids.length} fields are named "${name}". Only one of them would be read.`, blocking: true })
          }
        }
        return issues
      }
    },
    {
      id: 'checklist',
      name: 'Checklist',
      objectTypes: ['item', 'heading'],
      connectorTypes: ['blocks'],
      version: 1,
      validate: (artifact) => {
        const issues: ValidationIssue[] = []
        const done = new Set(artifact.objects.filter((one) => one.fields.done === true).map((one) => one.id))
        for (const connector of artifact.connectors) {
          if (connector.type === 'blocks' && done.has(connector.to) && !done.has(connector.from)) {
            issues.push({
              kind: 'out-of-order',
              objectIds: [connector.from, connector.to],
              describe: 'An item is ticked although something it waits on is not. That is either a mistake or a dependency that was never real.',
              blocking: false
            })
          }
        }
        return issues
      }
    },
    {
      id: 'decision-tree',
      name: 'Decision tree',
      objectTypes: ['question', 'outcome'],
      connectorTypes: ['answer'],
      version: 1,
      validate: (artifact) => {
        const issues: ValidationIssue[] = [...unreachable(artifact, 'decision tree')]
        for (const question of artifact.objects.filter((one) => one.type === 'question')) {
          const out = artifact.connectors.filter((one) => one.from === question.id)
          if (out.length < 2) {
            issues.push({ kind: 'question-one-answer', objectIds: [question.id], describe: `"${question.text || question.id}" has ${out.length} answer${out.length === 1 ? '' : 's'} leading anywhere. A question with one answer asks nothing.`, blocking: true })
          }
          if (out.some((one) => one.text.trim() === '')) {
            issues.push({ kind: 'unlabelled-answer', objectIds: [question.id], describe: `An answer out of "${question.text || question.id}" has no label, so the user cannot tell which way to go.`, blocking: true })
          }
        }
        for (const outcome of artifact.objects.filter((one) => one.type === 'outcome')) {
          if (artifact.connectors.some((one) => one.from === outcome.id)) {
            issues.push({ kind: 'outcome-continues', objectIds: [outcome.id], describe: `"${outcome.text || outcome.id}" is an outcome with something after it. An outcome is where the tree stops.`, blocking: true })
          }
        }
        return issues
      }
    },
    {
      id: 'table',
      name: 'Table',
      objectTypes: ['column', 'row'],
      connectorTypes: [],
      version: 1,
      validate: (artifact) => {
        const issues: ValidationIssue[] = []
        const columns = artifact.objects.filter((one) => one.type === 'column')
        const names = columns.map((one) => (typeof one.fields.name === 'string' ? one.fields.name : ''))
        const seen = new Set<string>()
        for (let i = 0; i < names.length; i += 1) {
          const name = names[i] as string
          if (name === '') {
            issues.push({ kind: 'unnamed-column', objectIds: [columns[i]?.id ?? ''], describe: 'A column has no name.', blocking: true })
          } else if (seen.has(name)) {
            issues.push({ kind: 'duplicate-column', objectIds: [columns[i]?.id ?? ''], describe: `Two columns are named "${name}".`, blocking: true })
          }
          seen.add(name)
        }
        if (columns.length === 0 && artifact.objects.length > 0) {
          issues.push({ kind: 'no-columns', objectIds: [], describe: 'This table has rows and no columns.', blocking: true })
        }
        return issues
      }
    },
    {
      id: 'calculator',
      name: 'Calculator',
      objectTypes: ['input', 'output', 'label'],
      connectorTypes: ['feeds'],
      version: 1,
      validate: (artifact) => {
        const issues: ValidationIssue[] = []
        if (artifact.objects.length > 0 && !artifact.objects.some((one) => one.type === 'output')) {
          issues.push({ kind: 'no-output', objectIds: [], describe: 'This calculator has nothing it works out.', blocking: true })
        }
        for (const output of artifact.objects.filter((one) => one.type === 'output')) {
          const formula = output.fields.formula
          if (typeof formula !== 'string' || formula.trim() === '') {
            issues.push({ kind: 'no-formula', objectIds: [output.id], describe: `"${output.text || output.id}" is an output with no formula, so it will never show anything.`, blocking: true })
          }
        }
        return issues
      }
    }
  ]
}

/** The assumptions the framework rests on, shown rather than implied. */
export const BUILDER_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Selection, alignment, grouping, layers, connectors and validation structure are shared; what a valid artifact is belongs to each builder.',
  'A builder with no rules of its own is reported as having none, not treated as always valid.',
  'Selecting one member of a group selects the group.',
  'A locked or hidden object is excluded from a selection and the exclusion is reported, because a silent partial move looks like a bug.',
  'Distributing equalises the gaps, not the centres, and leaves the outermost objects where they are.',
  'A connector with user waypoints is drawn exactly as placed and never improved.',
  'Objects a route passes through are reported as a fact about the layout, not silently rerouted around.',
  'An artifact carries typed actions, never code, so opening a document somebody sent does not run their program.',
  'An open action can only address Orbis; anything external is the user’s decision each time.',
  'Migration runs one version at a time, so old files reach the present through the same steps as recent ones.',
  'An artifact saved by a newer version is refused rather than opened and quietly stripped.'
])
