/**
 * A generated Page's history: drafts, publishing, forks, and what happens to somebody's numbers when it changes.
 *
 * A generated Page is regenerated far more often than a written one is edited -- "make the chart logarithmic", "add
 * humidity", "do it in pounds" -- and every one of those is a new Page built from scratch by a model. So the thing
 * that has to be guaranteed here is not that regeneration works. It is that regeneration **cannot lose the version
 * that already worked**.
 *
 * ## Nothing is ever replaced
 *
 * `regenerate` adds a node. It does not overwrite one. The previous version keeps its own id, its own document and
 * its own saved values, and stays openable. Publishing the new one marks the old one `superseded`, which is a label
 * rather than a deletion -- a superseded version still opens, still runs, and can still be published again.
 *
 * That matters because the regeneration that goes wrong is not the one that fails. A failed regeneration is obvious.
 * The dangerous one is the plausible one: it compiles, it opens, and the number it shows is subtly different, and
 * nobody notices until the old version is needed and is gone.
 *
 * ## Migration carries values, and says what it could not
 *
 * When a Page is regenerated, the numbers somebody typed into the old one are carried into the new one where the
 * field still exists and still means the same thing. Where it does not, the value is **dropped and reported** rather
 * than coerced. A number in kilograms is not a number in pounds; a choice that is no longer an option is not a
 * choice; a value outside the new bounds is not a value the new Page would let anybody type. Carrying any of those
 * across would put a Page into a state its own rules forbid, and it would be invisible.
 */

import { compareVersions, versionToText, type PageVersion } from './identity.ts'
import type { PageManifest } from './manifest.ts'
import type { PageDocument } from './builder.ts'
import type { PageSpec, SpecInput } from './spec.ts'

export const VERSION_LIMITS = Object.freeze({
  /** How many versions of one Page are kept. Past this the oldest superseded ones are dropped, never the published one. */
  versions: 50,
  /** How deep a lineage walk goes before it decides the graph is broken. */
  depth: 100,
  reasonLength: 300
})

export type VersionState =
  /** Built, not published. Only openable from the Page's own history. */
  | 'draft'
  /** The version that opens when somebody opens the Page. Exactly one at a time, or none. */
  | 'published'
  /** Was published, and something newer is. Still opens; still runs; can be published again. */
  | 'superseded'
  /** Taken out of use deliberately. Still here, so what it was can be read. */
  | 'withdrawn'

export interface PageVersionNode {
  /** This version's own id. Permanent, never reused, and not derived from the version number. */
  versionId: string
  /** The version this was built from. Null only for the first. */
  parentVersionId: string | null
  version: PageVersion
  state: VersionState
  /** What was asked for, in the words that produced it. Null for the first version, which had the original request. */
  reason: string | null
  createdAt: number
  spec: PageSpec
  manifest: PageManifest
  document: PageDocument
}

export interface VersionGraph {
  pageId: string
  nodes: readonly PageVersionNode[]
  /** The version that opens. Null when everything is a draft or withdrawn. */
  publishedVersionId: string | null
  /** The version this Page was forked from, as `pageId/versionId`. Null when it was not. */
  forkedFrom: string | null
}

export interface VersionError {
  error: 'unknown-version' | 'nothing-published' | 'already-published' | 'too-deep' | 'bad-reason'
  message: string
}

export const isVersionError = (value: unknown): value is VersionError =>
  typeof value === 'object' && value !== null && 'error' in value

export const nodeById = (graph: VersionGraph, versionId: string): PageVersionNode | null =>
  graph.nodes.find((one) => one.versionId === versionId) ?? null

export const publishedNode = (graph: VersionGraph): PageVersionNode | null =>
  graph.publishedVersionId === null ? null : nodeById(graph, graph.publishedVersionId)

/** The version that should open: the published one, or the newest draft when nothing has been published yet. */
export function openableNode(graph: VersionGraph): PageVersionNode | null {
  const published = publishedNode(graph)
  if (published !== null) return published
  const drafts = graph.nodes.filter((one) => one.state === 'draft')
  if (drafts.length === 0) return null
  return drafts.reduce((newest, one) => (one.createdAt > newest.createdAt ? one : newest))
}

export function startGraph(parts: {
  pageId: string
  versionId: string
  spec: PageSpec
  manifest: PageManifest
  document: PageDocument
  now: number
  forkedFrom?: string | null
}): VersionGraph {
  return {
    pageId: parts.pageId,
    forkedFrom: parts.forkedFrom ?? null,
    publishedVersionId: null,
    nodes: [
      {
        versionId: parts.versionId,
        parentVersionId: null,
        version: parts.manifest.version,
        state: 'draft',
        reason: null,
        createdAt: parts.now,
        spec: parts.spec,
        manifest: parts.manifest,
        document: parts.document
      }
    ]
  }
}

// ---------------------------------------------------------------- what changed

export type ChangeKind = 'added' | 'removed' | 'retyped' | 'renamed-label' | 'rebounded' | 'reworded'

export interface Change {
  kind: ChangeKind
  /** `input`, `step`, `output` or `page`. */
  what: 'input' | 'step' | 'output' | 'page'
  name: string
  /** A sentence somebody reads before deciding whether to publish this. */
  message: string
}

export interface Difference {
  changes: readonly Change[]
  /** What the version number should become, from the changes rather than from anybody's judgement. */
  nextVersion: PageVersion
  /**
   * True when the new version asks for something the old one did not.
   *
   * The registry already refuses to update a Page whose capabilities grew without somebody approving it. This says
   * the same thing early, so a screen can warn before the wait rather than after.
   */
  wantsMore: boolean
  /** Capabilities the new version asks for that the old one did not. */
  newCapabilities: readonly string[]
}

const sameBounds = (a: SpecInput, b: SpecInput): boolean => a.minimum === b.minimum && a.maximum === b.maximum && a.unit === b.unit

/**
 * How two versions of a Page differ, and what that makes the new version number.
 *
 * The rule is mechanical, which is the point: a version number decided by a model is a version number that means
 * whatever the model felt. Losing or retyping something is a major change because a Page somebody bookmarked,
 * referred to from a note, or filled in will not behave the same way. Adding is minor. Words are a patch.
 */
export function difference(
  before: PageSpec,
  after: PageSpec,
  beforeCapabilities: readonly string[],
  afterCapabilities: readonly string[],
  previousVersion: PageVersion
): Difference {
  const changes: Change[] = []

  const beforeInputs = new Map(before.inputs.map((one) => [one.name, one]))
  const afterInputs = new Map(after.inputs.map((one) => [one.name, one]))
  for (const [name, input] of beforeInputs) {
    const now = afterInputs.get(name)
    if (now === undefined) {
      changes.push({ kind: 'removed', what: 'input', name, message: `"${input.label}" is gone. Anything typed into it will not be carried over.` })
      continue
    }
    if (now.kind !== input.kind) {
      changes.push({
        kind: 'retyped',
        what: 'input',
        name,
        message: `"${input.label}" was a ${input.kind} and is now a ${now.kind}. Anything typed into it will not be carried over.`
      })
      continue
    }
    if (!sameBounds(input, now)) {
      changes.push({
        kind: 'rebounded',
        what: 'input',
        name,
        message: `"${input.label}" allows a different range or unit than it did. A value outside the new one will not be carried over.`
      })
    }
    if (now.label !== input.label) {
      changes.push({ kind: 'renamed-label', what: 'input', name, message: `"${input.label}" is now called "${now.label}".` })
    }
  }
  for (const [name, input] of afterInputs) {
    if (!beforeInputs.has(name)) changes.push({ kind: 'added', what: 'input', name, message: `"${input.label}" is new.` })
  }

  const beforeSteps = new Map(before.steps.map((one) => [one.name, one]))
  const afterSteps = new Map(after.steps.map((one) => [one.name, one]))
  for (const [name, step] of beforeSteps) {
    const now = afterSteps.get(name)
    if (now === undefined) {
      changes.push({ kind: 'removed', what: 'step', name, message: `The calculation "${name}" is gone.` })
    } else if (now.operation !== step.operation) {
      changes.push({
        kind: 'retyped',
        what: 'step',
        name,
        message: `"${name}" used ${step.operation} and now uses ${now.operation}. It is working the answer out a different way.`
      })
    }
  }
  for (const [name, step] of afterSteps) {
    if (!beforeSteps.has(name)) changes.push({ kind: 'added', what: 'step', name, message: `A new calculation, ${step.operation}.` })
  }

  const beforeOutputs = new Map(before.outputs.map((one) => [one.name, one]))
  const afterOutputs = new Map(after.outputs.map((one) => [one.name, one]))
  for (const [name, output] of beforeOutputs) {
    const now = afterOutputs.get(name)
    if (now === undefined) changes.push({ kind: 'removed', what: 'output', name, message: `"${output.label}" is no longer shown.` })
    else if (now.display !== output.display || now.pick !== output.pick) {
      changes.push({ kind: 'retyped', what: 'output', name, message: `"${output.label}" shows something different, or shows it differently.` })
    }
  }
  for (const [name, output] of afterOutputs) {
    if (!beforeOutputs.has(name)) changes.push({ kind: 'added', what: 'output', name, message: `"${output.label}" is new.` })
  }

  if (before.title !== after.title) changes.push({ kind: 'reworded', what: 'page', name: 'title', message: `Called "${after.title}" now.` })
  if (before.purpose !== after.purpose) changes.push({ kind: 'reworded', what: 'page', name: 'purpose', message: 'The description is different.' })

  const had = new Set(beforeCapabilities)
  const newCapabilities = afterCapabilities.filter((one) => !had.has(one))

  return {
    changes: Object.freeze(changes),
    nextVersion: nextVersionFor(previousVersion, { changes, newCapabilities }),
    wantsMore: newCapabilities.length > 0,
    newCapabilities: Object.freeze(newCapabilities)
  }
}

/** The version number a change makes, from the previous one. Separated so the rule can be read on its own. */
export function nextVersionFor(previous: PageVersion, difference: Pick<Difference, 'changes' | 'newCapabilities'>): PageVersion {
  const breaking = difference.changes.some((one) => one.kind === 'removed' || one.kind === 'retyped')
  if (breaking || difference.newCapabilities.length > 0) return { major: previous.major + 1, minor: 0, patch: 0 }
  const added = difference.changes.some((one) => one.kind === 'added' || one.kind === 'rebounded')
  if (added) return { major: previous.major, minor: previous.minor + 1, patch: 0 }
  return { major: previous.major, minor: previous.minor, patch: previous.patch + 1 }
}

// ---------------------------------------------------------------- carrying values across

export interface Carried {
  /** The values that survived, by field name. */
  values: Readonly<Record<string, unknown>>
  /** What was dropped and why, so somebody can be told rather than discover it. */
  dropped: readonly { name: string; label: string; why: string }[]
}

/**
 * Somebody's typed values, carried from one version of a Page into the next.
 *
 * A value is carried only when the new Page would have accepted somebody typing it. Everything else is dropped and
 * named. There is deliberately no coercion, no clamping and no unit conversion: each of those turns a number
 * somebody entered into a different number, silently, and the Page would then show an answer to a question nobody
 * asked.
 */
export function carryValues(before: PageSpec, after: PageSpec, values: Readonly<Record<string, unknown>>): Carried {
  const carried: Record<string, unknown> = {}
  const dropped: { name: string; label: string; why: string }[] = []
  const afterInputs = new Map(after.inputs.map((one) => [one.name, one]))

  for (const input of before.inputs) {
    if (!Object.prototype.hasOwnProperty.call(values, input.name)) continue
    const value = values[input.name]
    const label = input.label
    const now = afterInputs.get(input.name)
    if (now === undefined) {
      dropped.push({ name: input.name, label, why: 'There is no such box on the new version.' })
      continue
    }
    if (now.kind !== input.kind) {
      dropped.push({ name: input.name, label, why: `It was a ${input.kind} and is now a ${now.kind}.` })
      continue
    }
    if (now.kind === 'number' || now.kind === 'quantity') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        dropped.push({ name: input.name, label, why: 'What was saved there is not a number.' })
        continue
      }
      if (now.kind === 'quantity' && now.unit !== input.unit) {
        // Converting would be arithmetic on somebody's data that nobody asked for, and the unit table is not here.
        dropped.push({ name: input.name, label, why: `It was in ${String(input.unit)} and the new version is in ${String(now.unit)}.` })
        continue
      }
      if ((now.minimum !== undefined && value < now.minimum) || (now.maximum !== undefined && value > now.maximum)) {
        dropped.push({ name: input.name, label, why: `${value} is outside what the new version allows.` })
        continue
      }
    }
    if (now.kind === 'choice') {
      const options = (now.options ?? []).map((one) => one.value)
      if (!options.includes(String(value))) {
        dropped.push({ name: input.name, label, why: `"${String(value)}" is no longer one of the choices.` })
        continue
      }
    }
    if (now.kind === 'boolean' && typeof value !== 'boolean') {
      dropped.push({ name: input.name, label, why: 'What was saved there is not a yes or a no.' })
      continue
    }
    if (now.kind === 'text' && typeof value !== 'string') {
      dropped.push({ name: input.name, label, why: 'What was saved there is not text.' })
      continue
    }
    carried[input.name] = value
  }

  return { values: Object.freeze(carried), dropped: Object.freeze(dropped) }
}

// ---------------------------------------------------------------- changing the graph

export interface Regenerated {
  graph: VersionGraph
  node: PageVersionNode
  difference: Difference
  carried: Carried
}

/**
 * A new version, built from an existing one.
 *
 * The old node is untouched. That is the whole contract of this function, and the test for it is that the returned
 * graph contains every node the old one did, unchanged.
 */
export function regenerate(
  graph: VersionGraph,
  fromVersionId: string,
  built: { versionId: string; spec: PageSpec; manifest: PageManifest; document: PageDocument },
  reason: string,
  now: number,
  savedValues: Readonly<Record<string, unknown>> = {}
): Regenerated | VersionError {
  const parent = nodeById(graph, fromVersionId)
  if (parent === null) return { error: 'unknown-version', message: 'There is no such version of this Page.' }
  const trimmed = reason.trim()
  if (trimmed.length === 0 || trimmed.length > VERSION_LIMITS.reasonLength) {
    return {
      error: 'bad-reason',
      message: `A new version has to say what it was for, in at most ${VERSION_LIMITS.reasonLength} characters.`
    }
  }

  const changes = difference(parent.spec, built.spec, parent.manifest.capabilities, built.manifest.capabilities, parent.version)
  const version = changes.nextVersion
  const node: PageVersionNode = {
    versionId: built.versionId,
    parentVersionId: parent.versionId,
    version,
    state: 'draft',
    reason: trimmed,
    createdAt: now,
    spec: built.spec,
    manifest: { ...built.manifest, version },
    document: built.document
  }

  return {
    graph: prune({ ...graph, nodes: [...graph.nodes, node] }),
    node,
    difference: changes,
    carried: carryValues(parent.spec, built.spec, savedValues)
  }
}

/**
 * Publishing a version.
 *
 * Whatever was published becomes `superseded` rather than being removed, so going back is publishing an older node
 * rather than rebuilding it -- which is the difference between an undo that is exact and one that is another guess.
 */
export function publish(graph: VersionGraph, versionId: string): VersionGraph | VersionError {
  const node = nodeById(graph, versionId)
  if (node === null) return { error: 'unknown-version', message: 'There is no such version of this Page.' }
  if (graph.publishedVersionId === versionId) return { error: 'already-published', message: 'That version is the one already in use.' }
  return {
    ...graph,
    publishedVersionId: versionId,
    nodes: graph.nodes.map((one) =>
      one.versionId === versionId
        ? { ...one, state: 'published' as const }
        : one.state === 'published'
          ? { ...one, state: 'superseded' as const }
          : one
    )
  }
}

/** Taking a version out of use. If it was the published one, the Page has nothing published until something else is. */
export function withdraw(graph: VersionGraph, versionId: string): VersionGraph | VersionError {
  const node = nodeById(graph, versionId)
  if (node === null) return { error: 'unknown-version', message: 'There is no such version of this Page.' }
  return {
    ...graph,
    publishedVersionId: graph.publishedVersionId === versionId ? null : graph.publishedVersionId,
    nodes: graph.nodes.map((one) => (one.versionId === versionId ? { ...one, state: 'withdrawn' as const } : one))
  }
}

/**
 * A fork: a new Page that starts as a copy of one version of another.
 *
 * A separate Page with its own id, not a branch inside this graph. Branching inside one Page would mean two versions
 * both claiming to be what the Page is, and there is only one address.
 */
export function fork(
  graph: VersionGraph,
  fromVersionId: string,
  into: { pageId: string; versionId: string; manifest: PageManifest; now: number }
): VersionGraph | VersionError {
  const node = nodeById(graph, fromVersionId)
  if (node === null) return { error: 'unknown-version', message: 'There is no such version of this Page.' }
  return startGraph({
    pageId: into.pageId,
    versionId: into.versionId,
    spec: node.spec,
    manifest: { ...into.manifest, version: { major: 1, minor: 0, patch: 0 } },
    document: node.document,
    now: into.now,
    forkedFrom: `${graph.pageId}/${fromVersionId}`
  })
}

/**
 * The line of descent from one version back to the root.
 *
 * Walks with a seen-set rather than trusting the graph, because a cycle here would hang the screen that draws the
 * history, and a stored graph is a file that could have been edited.
 */
export function lineage(graph: VersionGraph, versionId: string): PageVersionNode[] | VersionError {
  const out: PageVersionNode[] = []
  const seen = new Set<string>()
  let current = nodeById(graph, versionId)
  if (current === null) return { error: 'unknown-version', message: 'There is no such version of this Page.' }
  while (current !== null) {
    if (seen.has(current.versionId) || out.length > VERSION_LIMITS.depth) {
      return { error: 'too-deep', message: 'This Page’s history refers to itself, so it cannot be read.' }
    }
    seen.add(current.versionId)
    out.push(current)
    current = current.parentVersionId === null ? null : nodeById(graph, current.parentVersionId)
  }
  return out
}

/**
 * Dropping the oldest history when there is too much of it.
 *
 * Never the published one, never a draft, and never anything another node descends from -- a node whose parent is
 * missing would break the lineage walk and leave a history that cannot be drawn.
 */
export function prune(graph: VersionGraph): VersionGraph {
  if (graph.nodes.length <= VERSION_LIMITS.versions) return graph
  const isParent = new Set(graph.nodes.map((one) => one.parentVersionId).filter((one): one is string => one !== null))
  const droppable = graph.nodes
    .filter((one) => one.state === 'superseded' || one.state === 'withdrawn')
    .filter((one) => !isParent.has(one.versionId))
    .sort((a, b) => a.createdAt - b.createdAt)
  const toDrop = new Set(droppable.slice(0, graph.nodes.length - VERSION_LIMITS.versions).map((one) => one.versionId))
  if (toDrop.size === 0) return graph
  return { ...graph, nodes: graph.nodes.filter((one) => !toDrop.has(one.versionId)) }
}

/** A one-line description of a version, for a history list. */
export const describeVersion = (node: PageVersionNode): string =>
  `${versionToText(node.version)} — ${node.reason ?? 'the first version'}`

/** Newest first, by version number and then by when it was made. */
export const byNewest = (a: PageVersionNode, b: PageVersionNode): number =>
  compareVersions(b.version, a.version) || b.createdAt - a.createdAt

export const VERSIONING_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Regenerating adds a version. It never replaces one, so the version that already worked stays openable.',
  'Publishing a newer version marks the older one superseded, which is a label rather than a deletion. Going back is publishing it again, not rebuilding it.',
  'A value is carried into a new version only when the new version would have let somebody type it. Everything else is dropped and named.',
  'Nothing is converted, clamped or coerced when carrying values across. Each of those turns somebody’s number into a different number without saying so.',
  'The version number follows from what changed, not from anybody’s judgement. Losing or retyping something is major; adding is minor; words are a patch.',
  'A fork is a new Page with its own address, not a branch inside one. Two versions both claiming to be the Page would leave one address with two answers.'
])
