/**
 * Concept graphs: ideas, the relationships between them, and what can honestly be said about the result.
 *
 * A concept model is a typed graph. What makes it worth more than a drawing is that the relationships are first-class
 * -- `contains` and `causes` and `contradicts` are different edges, not three arrows that happen to be labelled -- so
 * a path through the graph means something and can be checked.
 *
 * ## Status is not truth
 *
 * A concept marked `confirmed` is one somebody confirmed. Nothing here treats that as a fact about the world, and
 * `provenance` records whether a node came from a person, a source or a model. A graph that lost that distinction
 * would be a graph in which a model's guess and a cited paper look identical.
 *
 * ## Cycles are not errors
 *
 * `contains` may not cycle -- a thing cannot contain itself -- but `influences` very much may, and a feedback loop is
 * usually the most interesting thing in a model. So cycles are checked per relationship type against what that type
 * allows, rather than globally.
 */

export interface ConceptError {
  error: string
  message: string
}

export const isConceptError = (value: unknown): value is ConceptError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): ConceptError => ({ error, message })

export const CONCEPT_LIMITS: Readonly<Record<'nodes' | 'edges' | 'depth' | 'paths' | 'textLength', number>> = Object.freeze({
  nodes: 20_000,
  edges: 100_000,
  depth: 64,
  paths: 500,
  textLength: 200_000
})

// ---------------------------------------------------------------- concepts

export type ConceptKind =
  | 'concept'
  | 'entity'
  | 'process'
  | 'event'
  | 'claim'
  | 'evidence'
  | 'variable'
  | 'rule'
  | 'question'
  | 'hypothesis'
  | 'note'
  | 'group'

export type ConceptStatus = 'draft' | 'confirmed' | 'question' | 'hypothesis' | 'verified' | 'rejected' | 'deprecated'

/** Where something came from. A model's suggestion and somebody's assertion are never the same state. */
export type Provenance = 'authored' | 'imported' | 'from-source' | 'model-suggested' | 'model-accepted' | 'derived'

export interface Concept {
  id: string
  kind: ConceptKind
  title: string
  description: string
  properties: Record<string, string>
  tags: string[]
  status: ConceptStatus
  provenance: Provenance
  /** Ids of evidence concepts supporting this one. Never inferred from the text. */
  evidence: string[]
  /** Layout, stored separately from meaning so a rearrangement is not a change to the model. */
  position: { x: number; y: number }
  parent: string | null
  collapsed: boolean
}

export const concept = (id: string, title: string, options: Partial<Concept> = {}): Concept => ({
  id,
  kind: options.kind ?? 'concept',
  title,
  description: options.description ?? '',
  properties: options.properties ?? {},
  tags: options.tags ?? [],
  status: options.status ?? 'draft',
  provenance: options.provenance ?? 'authored',
  evidence: options.evidence ?? [],
  position: options.position ?? { x: 0, y: 0 },
  parent: options.parent ?? null,
  collapsed: options.collapsed ?? false
})

// ---------------------------------------------------------------- relationships

export type RelationKind =
  | 'contains'
  | 'part-of'
  | 'depends-on'
  | 'causes'
  | 'influences'
  | 'instance-of'
  | 'contradicts'
  | 'supports'
  | 'precedes'
  | 'requires'
  | 'produces'
  | 'transforms-into'
  | 'similar-to'
  | 'associated-with'
  | 'references'

export interface RelationRules {
  /** Whether `a R b` implies `b R a`. Symmetric relations are stored once and read both ways. */
  symmetric: boolean
  /** Whether a chain of this relation may return to where it started. */
  allowsCycles: boolean
  /** Whether `a R b` and `b R c` implies `a R c`, which is what makes a path meaningful. */
  transitive: boolean
  describe: string
}

/**
 * What each relationship type means, structurally.
 *
 * The table exists so that "can this cycle" has one answer rather than one per place that asks. `contains` cycling
 * would mean a thing containing itself; `influences` cycling is a feedback loop and is often the point.
 */
export const RELATIONS: Readonly<Record<RelationKind, RelationRules>> = Object.freeze({
  contains: { symmetric: false, allowsCycles: false, transitive: true, describe: 'The first holds the second as a part. A thing cannot contain itself, directly or through a chain.' },
  'part-of': { symmetric: false, allowsCycles: false, transitive: true, describe: 'The first is a part of the second. The inverse of containing.' },
  'depends-on': { symmetric: false, allowsCycles: false, transitive: true, describe: 'The first needs the second. A circular dependency is a real problem rather than a shape.' },
  causes: { symmetric: false, allowsCycles: true, transitive: false, describe: 'The first brings about the second. Causes can form loops, and a causal loop is usually the interesting part of a model.' },
  influences: { symmetric: false, allowsCycles: true, transitive: false, describe: 'The first affects the second without necessarily determining it. Loops are expected.' },
  'instance-of': { symmetric: false, allowsCycles: false, transitive: true, describe: 'The first is an example of the second.' },
  contradicts: { symmetric: true, allowsCycles: true, transitive: false, describe: 'The two cannot both hold. Symmetric: if one contradicts the other, the reverse is true too.' },
  supports: { symmetric: false, allowsCycles: true, transitive: false, describe: 'The first is evidence or argument for the second. Support is not transitive: evidence for a claim is not evidence for whatever that claim supports.' },
  precedes: { symmetric: false, allowsCycles: false, transitive: true, describe: 'The first comes before the second in time or order. Time does not loop.' },
  requires: { symmetric: false, allowsCycles: false, transitive: true, describe: 'The second is necessary for the first.' },
  produces: { symmetric: false, allowsCycles: true, transitive: false, describe: 'The first results in the second.' },
  'transforms-into': { symmetric: false, allowsCycles: true, transitive: false, describe: 'The first becomes the second. Cycles are allowed, because a cycle is a real process.' },
  'similar-to': { symmetric: true, allowsCycles: true, transitive: false, describe: 'The two resemble each other. Symmetric, and deliberately not transitive: similarity chains together into nonsense.' },
  'associated-with': { symmetric: true, allowsCycles: true, transitive: false, describe: 'The two are connected in some unstated way. The weakest relation, and the one to avoid when a stronger one applies.' },
  references: { symmetric: false, allowsCycles: true, transitive: false, describe: 'The first mentions the second.' }
})

export interface Relation {
  id: string
  from: string
  to: string
  kind: RelationKind
  label: string
  /** Somebody's judgement of how strong it is. Never computed from anything. */
  strength: number | null
  conditions: string
  provenance: Provenance
  status: 'proposed' | 'tested' | 'supported' | 'rejected'
  evidence: string[]
}

export interface ConceptGraph {
  id: string
  title: string
  concepts: Concept[]
  relations: Relation[]
}

export const emptyGraph = (id: string, title: string): ConceptGraph => ({ id, title, concepts: [], relations: [] })

// ---------------------------------------------------------------- validation

export interface Problem {
  kind: 'missing-node' | 'duplicate' | 'self-reference' | 'cycle' | 'duplicate-relation' | 'orphan' | 'too-large' | 'bad-parent'
  ids: string[]
  describe: string
  /** Whether this stops the graph being usable, or is only worth noticing. */
  blocking: boolean
}

export interface Check {
  ok: boolean
  problems: Problem[]
  /** Concepts nothing connects to. Reported and never removed: an unconnected idea is usually unfinished, not wrong. */
  orphans: string[]
  notes: string[]
}

/**
 * Whether a graph holds together.
 *
 * Cycles are checked per relationship type against what that type allows. A model with a causal loop and a
 * containment tree is perfectly well formed, and a global cycle check would refuse it.
 */
export function checkGraph(graph: ConceptGraph): Check {
  const problems: Problem[] = []
  const byId = new Map<string, Concept>()

  for (const one of graph.concepts) {
    if (byId.has(one.id)) {
      problems.push({ kind: 'duplicate', ids: [one.id], describe: `There are two concepts with the id "${one.id}".`, blocking: true })
    }
    byId.set(one.id, one)
  }

  if (graph.concepts.length > CONCEPT_LIMITS.nodes) {
    problems.push({ kind: 'too-large', ids: [], describe: `This graph has ${graph.concepts.length.toLocaleString('en')} concepts, past the ${CONCEPT_LIMITS.nodes.toLocaleString('en')} allowed.`, blocking: true })
  }
  if (graph.relations.length > CONCEPT_LIMITS.edges) {
    problems.push({ kind: 'too-large', ids: [], describe: `This graph has ${graph.relations.length.toLocaleString('en')} relationships, past the ${CONCEPT_LIMITS.edges.toLocaleString('en')} allowed.`, blocking: true })
  }

  for (const one of graph.concepts) {
    if (one.parent === null) continue
    if (!byId.has(one.parent)) {
      problems.push({ kind: 'bad-parent', ids: [one.id], describe: `"${one.title}" is grouped under "${one.parent}", which is not in the graph.`, blocking: true })
    }
  }

  const seenPairs = new Set<string>()
  const connected = new Set<string>()

  for (const relation of graph.relations) {
    const from = byId.get(relation.from)
    const to = byId.get(relation.to)
    if (!from || !to) {
      problems.push({
        kind: 'missing-node',
        ids: [relation.from, relation.to].filter((one) => !byId.has(one)),
        describe: 'A relationship refers to a concept that is not in the graph.',
        blocking: true
      })
      continue
    }
    connected.add(relation.from)
    connected.add(relation.to)

    if (relation.from === relation.to && !RELATIONS[relation.kind].allowsCycles) {
      problems.push({
        kind: 'self-reference',
        ids: [relation.from],
        describe: `"${from.title}" ${relation.kind} itself, which that relationship does not allow. ${RELATIONS[relation.kind].describe}`,
        blocking: true
      })
    }

    // A symmetric relation stored both ways is the same relation twice, which double-counts everywhere it is used.
    const key = RELATIONS[relation.kind].symmetric
      ? `${relation.kind}:${[relation.from, relation.to].sort().join('|')}`
      : `${relation.kind}:${relation.from}|${relation.to}`
    if (seenPairs.has(key)) {
      problems.push({
        kind: 'duplicate-relation',
        ids: [relation.from, relation.to],
        describe: RELATIONS[relation.kind].symmetric
          ? `"${from.title}" and "${to.title}" are joined by ${relation.kind} twice. That relationship is symmetric, so storing it both ways is storing it twice.`
          : `"${from.title}" ${relation.kind} "${to.title}" appears more than once.`,
        blocking: false
      })
    }
    seenPairs.add(key)
  }

  // Cycles, per relationship type, and only for the types that forbid them.
  for (const kind of Object.keys(RELATIONS) as RelationKind[]) {
    if (RELATIONS[kind].allowsCycles) continue
    const cycle = findCycle(graph, kind)
    if (cycle) {
      problems.push({
        kind: 'cycle',
        ids: cycle,
        describe: `${cycle.map((id) => byId.get(id)?.title ?? id).join(' -> ')} forms a loop through "${kind}", which does not allow one. ${RELATIONS[kind].describe}`,
        blocking: true
      })
    }
  }

  const orphans = graph.concepts.filter((one) => !connected.has(one.id) && one.kind !== 'note').map((one) => one.id)
  const notes: string[] = []
  if (orphans.length > 0) {
    notes.push(
      `${orphans.length} concept${orphans.length === 1 ? ' is' : 's are'} not connected to anything. They are kept: an unconnected idea is usually one that has not been placed yet rather than one that is wrong.`
    )
  }

  return { ok: !problems.some((one) => one.blocking), problems, orphans, notes }
}

/** A cycle through one relationship type, or `null`. Depth-first with a colouring, so it names the cycle it found. */
export function findCycle(graph: ConceptGraph, kind: RelationKind): string[] | null {
  const edges = new Map<string, string[]>()
  for (const relation of graph.relations) {
    if (relation.kind !== kind) continue
    const list = edges.get(relation.from) ?? []
    list.push(relation.to)
    edges.set(relation.from, list)
  }

  const colour = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  let found: string[] | null = null

  const visit = (id: string): boolean => {
    colour.set(id, 1)
    stack.push(id)
    for (const next of edges.get(id) ?? []) {
      // Grey means it is on the current path, so this edge closes a loop.
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

  for (const one of graph.concepts) {
    if ((colour.get(one.id) ?? 0) === 0 && visit(one.id)) break
  }
  return found
}

// ---------------------------------------------------------------- navigation

export interface Path {
  nodes: string[]
  relations: RelationKind[]
  length: number
  /** Whether every step is the same transitive relation, which is what makes the path itself mean something. */
  meaningful: boolean
  describe: string
}

/**
 * Paths between two concepts.
 *
 * `meaningful` is the part that matters. A path of three `contains` edges genuinely means the first contains the last,
 * because containment is transitive. A path of `similar-to` edges means almost nothing -- similarity chains into
 * nonsense within two steps -- and a graph tool that presented both the same way would be inviting a wrong conclusion.
 */
export function pathsBetween(graph: ConceptGraph, from: string, to: string, maxLength = 6): Path[] | ConceptError {
  const byId = new Map(graph.concepts.map((one) => [one.id, one]))
  if (!byId.has(from)) return fail('not-found', `There is no concept with the id "${from}".`)
  if (!byId.has(to)) return fail('not-found', `There is no concept with the id "${to}".`)
  if (maxLength > CONCEPT_LIMITS.depth) return fail('too-deep', `Paths are searched to at most ${CONCEPT_LIMITS.depth} steps.`)

  const out: { to: string; kind: RelationKind }[] = []
  const edges = new Map<string, { to: string; kind: RelationKind }[]>()
  for (const relation of graph.relations) {
    const list = edges.get(relation.from) ?? []
    list.push({ to: relation.to, kind: relation.kind })
    edges.set(relation.from, list)
    // A symmetric relation is traversable both ways, which is what symmetric means.
    if (RELATIONS[relation.kind].symmetric) {
      const back = edges.get(relation.to) ?? []
      back.push({ to: relation.from, kind: relation.kind })
      edges.set(relation.to, back)
    }
  }
  void out

  const found: Path[] = []
  const nodes: string[] = [from]
  const kinds: RelationKind[] = []
  const onPath = new Set<string>([from])

  const walk = (at: string): void => {
    if (found.length >= CONCEPT_LIMITS.paths) return
    if (at === to && nodes.length > 1) {
      const sameKind = kinds.every((one) => one === kinds[0])
      found.push({
        nodes: [...nodes],
        relations: [...kinds],
        length: kinds.length,
        meaningful: sameKind && RELATIONS[kinds[0]].transitive,
        describe:
          sameKind && RELATIONS[kinds[0]].transitive
            ? `${kinds.length} steps of "${kinds[0]}", which is transitive -- so the relationship really does hold from end to end.`
            : sameKind
              ? `${kinds.length} steps of "${kinds[0]}", which is not transitive. Each step holds; that does not make the end-to-end relationship hold.`
              : `A path through ${[...new Set(kinds)].join(', ')}. Mixed relationships do not compose into a single relationship, so this shows a connection and not a claim.`
      })
      return
    }
    if (nodes.length > maxLength) return

    for (const edge of edges.get(at) ?? []) {
      if (onPath.has(edge.to)) continue
      onPath.add(edge.to)
      nodes.push(edge.to)
      kinds.push(edge.kind)
      walk(edge.to)
      kinds.pop()
      nodes.pop()
      onPath.delete(edge.to)
    }
  }

  walk(from)
  found.sort((a, b) => a.length - b.length)
  return found
}

export interface Neighbourhood {
  centre: string
  /** Concepts by how many steps away, so "everything within two steps" is answerable. */
  byDistance: { distance: number; ids: string[] }[]
  total: number
}

/** Everything within a given number of steps, by breadth-first search over every relationship. */
export function neighbourhood(graph: ConceptGraph, centre: string, steps = 2): Neighbourhood | ConceptError {
  if (!graph.concepts.some((one) => one.id === centre)) return fail('not-found', `There is no concept with the id "${centre}".`)
  if (steps < 1 || steps > CONCEPT_LIMITS.depth) return fail('invalid-argument', 'The number of steps has to be at least one and within the depth limit.')

  const edges = new Map<string, Set<string>>()
  for (const relation of graph.relations) {
    for (const [a, b] of [[relation.from, relation.to], [relation.to, relation.from]] as [string, string][]) {
      const set = edges.get(a) ?? new Set<string>()
      set.add(b)
      edges.set(a, set)
    }
  }

  const seen = new Set<string>([centre])
  const byDistance: Neighbourhood['byDistance'] = []
  let frontier = [centre]

  for (let distance = 1; distance <= steps; distance++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbour of edges.get(id) ?? []) {
        if (seen.has(neighbour)) continue
        seen.add(neighbour)
        next.push(neighbour)
      }
    }
    if (next.length === 0) break
    byDistance.push({ distance, ids: next.sort() })
    frontier = next
  }

  return { centre, byDistance, total: seen.size - 1 }
}

// ---------------------------------------------------------------- import

export interface ImportResult {
  graph: ConceptGraph
  /** Lines that could not be read. Reported rather than dropped, because a lost line is a lost idea. */
  unread: { line: number; text: string; why: string }[]
  notes: string[]
}

/**
 * An indented outline into a containment tree.
 *
 * Indentation is the relationship: two spaces deeper means contained by the line above. Tabs and spaces are both
 * accepted and normalised, because a file that mixes them is a file somebody will have.
 */
export function fromOutline(source: string, idPrefix = 'c'): ImportResult | ConceptError {
  if (source.length > CONCEPT_LIMITS.textLength) return fail('too-large', 'That outline is longer than Orbis reads at once.')

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const concepts: Concept[] = []
  const relations: Relation[] = []
  const unread: ImportResult['unread'] = []
  const stack: { depth: number; id: string }[] = []
  let counter = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    // A tab counts as two spaces, so a mixed file indents consistently rather than erratically.
    const indent = (/^[\t ]*/.exec(line)?.[0] ?? '').replace(/\t/g, '  ').length
    const depth = Math.floor(indent / 2)
    const title = line.trim().replace(/^[-*+]\s*/, '')
    if (title === '') {
      unread.push({ line: i + 1, text: line, why: 'The line has indentation but no text.' })
      continue
    }
    if (depth > CONCEPT_LIMITS.depth) {
      unread.push({ line: i + 1, text: line, why: `It is nested more than ${CONCEPT_LIMITS.depth} levels deep.` })
      continue
    }

    const id = `${idPrefix}${++counter}`
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack[stack.length - 1]?.id ?? null

    concepts.push(concept(id, title, { parent, provenance: 'imported' }))
    if (parent !== null) {
      relations.push({
        id: `r${relations.length + 1}`,
        from: parent,
        to: id,
        kind: 'contains',
        label: '',
        strength: null,
        conditions: '',
        provenance: 'imported',
        status: 'proposed',
        evidence: []
      })
    }
    stack.push({ depth, id })
  }

  return {
    graph: { id: 'imported', title: '', concepts, relations },
    unread,
    notes: [
      `${concepts.length} concepts from ${lines.filter((one) => one.trim() !== '').length} lines. Indentation was read as containment; every relationship is marked as proposed, because an outline states a hierarchy and not that it was checked.`
    ]
  }
}

/**
 * Statements of the form `A contains B` into relationships.
 *
 * A deterministic parser, not a model. "A contains B" has exactly one reading and a model is not needed for it; using
 * one would make a reliable operation unreliable and slower.
 */
export function fromStatements(source: string, idPrefix = 's'): ImportResult | ConceptError {
  if (source.length > CONCEPT_LIMITS.textLength) return fail('too-large', 'That text is longer than Orbis reads at once.')

  const verbs: [RegExp, RelationKind][] = [
    [/\bcontains\b/i, 'contains'],
    [/\bis part of\b/i, 'part-of'],
    [/\bdepends on\b/i, 'depends-on'],
    [/\bcauses\b/i, 'causes'],
    [/\binfluences\b/i, 'influences'],
    [/\bis an? instance of\b/i, 'instance-of'],
    [/\bcontradicts\b/i, 'contradicts'],
    [/\bsupports\b/i, 'supports'],
    [/\bprecedes\b/i, 'precedes'],
    [/\brequires\b/i, 'requires'],
    [/\bproduces\b/i, 'produces'],
    [/\btransforms into\b/i, 'transforms-into'],
    [/\bis similar to\b/i, 'similar-to'],
    [/\breferences\b/i, 'references']
  ]

  const byTitle = new Map<string, string>()
  const concepts: Concept[] = []
  const relations: Relation[] = []
  const unread: ImportResult['unread'] = []
  let counter = 0

  const ensure = (title: string): string => {
    const key = title.trim().toLowerCase()
    const existing = byTitle.get(key)
    if (existing !== undefined) return existing
    const id = `${idPrefix}${++counter}`
    byTitle.set(key, id)
    concepts.push(concept(id, title.trim(), { provenance: 'imported' }))
    return id
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue

    let matched = false
    for (const [pattern, kind] of verbs) {
      const found = pattern.exec(line)
      if (!found) continue
      const left = line.slice(0, found.index).trim()
      const right = line.slice(found.index + found[0].length).trim().replace(/[.;]$/, '')
      if (left === '' || right === '') break
      relations.push({
        id: `r${relations.length + 1}`,
        from: ensure(left),
        to: ensure(right),
        kind,
        label: '',
        strength: null,
        conditions: '',
        provenance: 'imported',
        status: 'proposed',
        evidence: []
      })
      matched = true
      break
    }

    if (!matched) {
      unread.push({ line: i + 1, text: line, why: 'No relationship word was recognised in that line. A statement needs one of the known verbs between two concepts.' })
    }
  }

  return {
    graph: { id: 'imported', title: '', concepts, relations },
    unread,
    notes: [
      `${relations.length} relationships between ${concepts.length} concepts.`,
      unread.length > 0
        ? `${unread.length} line${unread.length === 1 ? '' : 's'} could not be read and ${unread.length === 1 ? 'is' : 'are'} listed rather than dropped.`
        : 'Every line was read.'
    ]
  }
}

// ---------------------------------------------------------------- layout

export type LayoutKind = 'hierarchical' | 'radial' | 'grid' | 'manual'

export interface Layout {
  positions: Record<string, { x: number; y: number }>
  kind: LayoutKind
  describe: string
}

/**
 * Positions for the concepts, computed deterministically.
 *
 * Deterministic on purpose: a layout that moves every time it is opened makes a model impossible to learn the shape
 * of. Nothing here is random, and the same graph always lays out the same way.
 */
export function layout(graph: ConceptGraph, kind: LayoutKind, options: { spacing?: number } = {}): Layout | ConceptError {
  const spacing = options.spacing ?? 160
  const positions: Record<string, { x: number; y: number }> = {}

  if (kind === 'manual') {
    for (const one of graph.concepts) positions[one.id] = { ...one.position }
    return { positions, kind, describe: 'Positions left as they were. Moving a concept is a change to the drawing, not to the model.' }
  }

  if (kind === 'grid') {
    const columns = Math.max(1, Math.ceil(Math.sqrt(graph.concepts.length)))
    graph.concepts.forEach((one, i) => {
      positions[one.id] = { x: (i % columns) * spacing, y: Math.floor(i / columns) * spacing }
    })
    return { positions, kind, describe: `A ${columns}-column grid in the order the concepts are stored.` }
  }

  // Depth from the containment tree, which is what a hierarchy means here.
  const depth = new Map<string, number>()
  const childrenOf = new Map<string, string[]>()
  for (const one of graph.concepts) {
    if (one.parent === null) continue
    const list = childrenOf.get(one.parent) ?? []
    list.push(one.id)
    childrenOf.set(one.parent, list)
  }
  const roots = graph.concepts.filter((one) => one.parent === null).map((one) => one.id)

  const assign = (id: string, level: number, seen: Set<string>): void => {
    if (seen.has(id) || level > CONCEPT_LIMITS.depth) return
    seen.add(id)
    depth.set(id, level)
    for (const child of childrenOf.get(id) ?? []) assign(child, level + 1, seen)
  }
  const seen = new Set<string>()
  for (const root of roots) assign(root, 0, seen)
  for (const one of graph.concepts) if (!depth.has(one.id)) depth.set(one.id, 0)

  const byLevel = new Map<number, string[]>()
  for (const [id, level] of depth) {
    const list = byLevel.get(level) ?? []
    list.push(id)
    byLevel.set(level, list)
  }
  for (const list of byLevel.values()) list.sort()

  if (kind === 'hierarchical') {
    for (const [level, ids] of byLevel) {
      ids.forEach((id, i) => {
        positions[id] = { x: (i - (ids.length - 1) / 2) * spacing, y: level * spacing }
      })
    }
    return { positions, kind, describe: `${byLevel.size} levels, laid out from the containment tree. The same graph always lays out the same way.` }
  }

  // Radial: each level is a ring, and the concepts on it are spread evenly round it.
  for (const [level, ids] of byLevel) {
    if (level === 0) {
      ids.forEach((id, i) => {
        positions[id] = { x: (i - (ids.length - 1) / 2) * spacing, y: 0 }
      })
      continue
    }
    const radius = level * spacing
    ids.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / ids.length
      positions[id] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
    })
  }
  return { positions, kind, describe: `${byLevel.size} rings out from the roots.` }
}

// ---------------------------------------------------------------- analysis

export interface GraphAnalysis {
  concepts: number
  relations: number
  byKind: Record<string, number>
  byRelation: Record<string, number>
  byStatus: Record<string, number>
  byProvenance: Record<string, number>
  /** The most connected concepts, which is usually where the model's weight sits. */
  central: { id: string; title: string; degree: number }[]
  orphans: string[]
  /** Claims with nothing supporting them. Reported, because an unsupported claim is a gap rather than a mistake. */
  unsupportedClaims: string[]
  /** Pairs marked as contradicting. Never resolved; both stay. */
  contradictions: { a: string; b: string }[]
  notes: string[]
}

/** What a graph contains, counted. Nothing here judges the model; it says what is in it. */
export function analyse(graph: ConceptGraph): GraphAnalysis {
  const byKind: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const byProvenance: Record<string, number> = {}
  const byRelation: Record<string, number> = {}
  const degree = new Map<string, number>()

  for (const one of graph.concepts) {
    byKind[one.kind] = (byKind[one.kind] ?? 0) + 1
    byStatus[one.status] = (byStatus[one.status] ?? 0) + 1
    byProvenance[one.provenance] = (byProvenance[one.provenance] ?? 0) + 1
    degree.set(one.id, 0)
  }
  for (const relation of graph.relations) {
    byRelation[relation.kind] = (byRelation[relation.kind] ?? 0) + 1
    degree.set(relation.from, (degree.get(relation.from) ?? 0) + 1)
    degree.set(relation.to, (degree.get(relation.to) ?? 0) + 1)
  }

  const byId = new Map(graph.concepts.map((one) => [one.id, one]))
  const central = [...degree.entries()]
    .map(([id, count]) => ({ id, title: byId.get(id)?.title ?? id, degree: count }))
    .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
    .slice(0, 10)

  const supported = new Set(graph.relations.filter((one) => one.kind === 'supports').map((one) => one.to))
  const unsupportedClaims = graph.concepts
    .filter((one) => one.kind === 'claim' && !supported.has(one.id) && one.evidence.length === 0)
    .map((one) => one.id)

  const contradictions = graph.relations
    .filter((one) => one.kind === 'contradicts')
    .map((one) => ({ a: one.from, b: one.to }))

  const notes: string[] = []
  const suggested = byProvenance['model-suggested'] ?? 0
  if (suggested > 0) {
    notes.push(
      `${suggested} of ${graph.concepts.length} concepts came from a model and have not been accepted. They are marked as suggestions rather than shown the same way as concepts somebody wrote or took from a source.`
    )
  }
  if (unsupportedClaims.length > 0) {
    notes.push(`${unsupportedClaims.length} claim${unsupportedClaims.length === 1 ? ' has' : 's have'} nothing supporting ${unsupportedClaims.length === 1 ? 'it' : 'them'}. That is a gap in the model, not an error in it.`)
  }
  if (contradictions.length > 0) {
    notes.push(`${contradictions.length} pair${contradictions.length === 1 ? '' : 's'} are marked as contradicting. Both sides are kept; nothing here decides between them.`)
  }
  const weak = byRelation['associated-with'] ?? 0
  if (weak > graph.relations.length / 2 && graph.relations.length > 4) {
    notes.push(
      `More than half the relationships are "associated with", which says two things are connected without saying how. Where a stronger relationship applies, using it makes the paths through the model mean something.`
    )
  }

  return {
    concepts: graph.concepts.length,
    relations: graph.relations.length,
    byKind,
    byRelation,
    byStatus,
    byProvenance,
    central,
    orphans: checkGraph(graph).orphans,
    unsupportedClaims,
    contradictions,
    notes
  }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const CONCEPT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Relationships are typed. Containing, causing and contradicting are different edges, not three labelled arrows.',
  'Cycles are checked per relationship type. A causal loop is allowed; a thing containing itself is not.',
  'A path only means something end to end when every step is the same transitive relationship, and paths say which they are.',
  'A concept from a model is marked as a suggestion until somebody accepts it.',
  'A status is a record of what somebody said, never a claim about the world.',
  'An unconnected concept is kept. It is usually unplaced rather than wrong.',
  'Contradictions are recorded and never resolved by the tool.',
  'Layout is deterministic and is stored separately from meaning, so rearranging is not editing.'
])
