/**
 * Projects: several Pages wired together, and an answer to where any number came from.
 *
 * `lab.ts` connects computations inside one Page. This connects Pages: a dataset feeds an analyzer, the analyzer
 * feeds a decision room, the decision room feeds a report. The problem that makes it worth its own module is that
 * the pieces do not share a schema -- a Markets page emits prices, a Solution page wants a number, and something has
 * to say whether that is a connection or a category error.
 *
 * ## Conversions are named, never implicit
 *
 * A connection whose types do not match needs a stated conversion. Silently coercing would make every project run,
 * including the ones that are wrong: a currency read as a plain number computes perfectly and means nothing.
 *
 * ## Lineage is the point
 *
 * Every artifact records which Pages produced it and which inputs it saw. Without that, a project is a set of numbers
 * whose provenance lives in whoever built it -- and it is exactly the projects worth building that outlive them.
 */

export interface ProjectError {
  error: string
  message: string
}

export const isProjectError = (value: unknown): value is ProjectError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): ProjectError => ({ error, message })

export const PROJECT_LIMITS: Readonly<Record<'pages' | 'connections' | 'variables' | 'depth' | 'checkpoints', number>> =
  Object.freeze({
    pages: 500,
    connections: 5_000,
    variables: 2_000,
    depth: 64,
    checkpoints: 200
  })

// ---------------------------------------------------------------- types

export type DataType = 'number' | 'text' | 'boolean' | 'table' | 'series' | 'document' | 'quantity' | 'distribution' | 'set'

export interface Port {
  name: string
  type: DataType
  /** The unit, where one applies. Two quantities in different units need a conversion, not a wire. */
  unit: string
  required: boolean
  describe: string
}

export interface PageInstance {
  id: string
  /** Which built-in Page this is: 'markets', 'analyzer', 'solution'. */
  pageType: string
  title: string
  inputs: Port[]
  outputs: Port[]
  /** Settings the Page was configured with. Part of its fingerprint. */
  settings: Record<string, string | number | boolean>
}

export interface Conversion {
  /** A named conversion the caller supplies, e.g. 'usd-to-eur' or 'series-to-table'. */
  name: string
  from: DataType
  to: DataType
  fromUnit: string
  toUnit: string
  /** Whether the conversion loses information, which is reported at every use. */
  lossy: boolean
  describe: string
}

export interface Connection {
  id: string
  fromPage: string
  fromPort: string
  toPage: string
  toPort: string
  /** The conversion applied, or null when the types and units already match. */
  conversionName: string | null
}

export interface Project {
  id: string
  title: string
  pages: PageInstance[]
  connections: Connection[]
  conversions: Conversion[]
}

// ---------------------------------------------------------------- compatibility

export interface Compatibility {
  ok: boolean
  reason: 'exact' | 'converted' | 'type-mismatch' | 'unit-mismatch' | 'no-such-conversion' | 'wrong-conversion' | 'missing-port'
  lossy: boolean
  describe: string
}

/**
 * Whether one port can feed another.
 *
 * A type match with a unit mismatch is refused specifically: metres into feet is the failure that produces a
 * plausible wrong answer rather than an error, which makes it the one worth being strict about.
 */
export function checkConnection(project: Project, connection: Connection): Compatibility {
  const from = project.pages.find((one) => one.id === connection.fromPage)
  const to = project.pages.find((one) => one.id === connection.toPage)
  const fromPort = from?.outputs.find((one) => one.name === connection.fromPort)
  const toPort = to?.inputs.find((one) => one.name === connection.toPort)

  if (!fromPort || !toPort) {
    const missing = !from
      ? `page "${connection.fromPage}"`
      : !to
        ? `page "${connection.toPage}"`
        : !fromPort
          ? `output "${connection.fromPort}" on ${from.title}`
          : `input "${connection.toPort}" on ${to?.title}`
    return { ok: false, reason: 'missing-port', lossy: false, describe: `This connection refers to ${missing}, which is not there.` }
  }

  if (connection.conversionName === null) {
    if (fromPort.type !== toPort.type) {
      return {
        ok: false,
        reason: 'type-mismatch',
        lossy: false,
        describe: `${from?.title} gives a ${fromPort.type} and ${to?.title} wants a ${toPort.type}. Name a conversion or the project would run and mean nothing.`
      }
    }
    if (fromPort.unit !== toPort.unit) {
      return {
        ok: false,
        reason: 'unit-mismatch',
        lossy: false,
        describe: `${from?.title} gives ${fromPort.unit || 'no unit'} and ${to?.title} wants ${toPort.unit || 'no unit'}. This is the mismatch that computes perfectly and gives a wrong answer, so it needs a named conversion.`
      }
    }
    return { ok: true, reason: 'exact', lossy: false, describe: `${fromPort.type}${fromPort.unit ? ` in ${fromPort.unit}` : ''}, straight through.` }
  }

  const conversion = project.conversions.find((one) => one.name === connection.conversionName)
  if (!conversion) {
    return { ok: false, reason: 'no-such-conversion', lossy: false, describe: `This connection names the conversion "${connection.conversionName}", which is not defined in this project.` }
  }
  if (conversion.from !== fromPort.type || conversion.to !== toPort.type || conversion.fromUnit !== fromPort.unit || conversion.toUnit !== toPort.unit) {
    return {
      ok: false,
      reason: 'wrong-conversion',
      lossy: false,
      describe: `"${conversion.name}" converts ${conversion.from}${conversion.fromUnit ? ` in ${conversion.fromUnit}` : ''} to ${conversion.to}${conversion.toUnit ? ` in ${conversion.toUnit}` : ''}, but this connection carries ${fromPort.type}${fromPort.unit ? ` in ${fromPort.unit}` : ''} into ${toPort.type}${toPort.unit ? ` in ${toPort.unit}` : ''}.`
    }
  }

  return {
    ok: true,
    reason: 'converted',
    lossy: conversion.lossy,
    describe: conversion.lossy
      ? `Through "${conversion.name}", which loses information: ${conversion.describe}`
      : `Through "${conversion.name}".`
  }
}

export interface ProjectCheck {
  ok: boolean
  problems: { kind: string; ids: string[]; describe: string; blocking: boolean }[]
  /** Connections that work but lose information, listed once so they are visible rather than buried per-connection. */
  lossy: string[]
  /** Required inputs nothing feeds. */
  unfed: { pageId: string; port: string }[]
  /** Outputs nothing uses, which is usually a wire somebody forgot. */
  unused: { pageId: string; port: string }[]
}

/** Whether the whole project holds together, before anything runs. */
export function checkProject(project: Project): ProjectCheck {
  const problems: ProjectCheck['problems'] = []
  const lossy: string[] = []

  if (project.pages.length > PROJECT_LIMITS.pages) {
    problems.push({ kind: 'too-many-pages', ids: [], describe: `${project.pages.length} pages, past the ${PROJECT_LIMITS.pages} allowed.`, blocking: true })
  }

  const seen = new Set<string>()
  for (const page of project.pages) {
    if (seen.has(page.id)) problems.push({ kind: 'duplicate-page', ids: [page.id], describe: `Two pages share the id "${page.id}".`, blocking: true })
    seen.add(page.id)
  }

  const fed = new Set<string>()
  const used = new Set<string>()
  for (const connection of project.connections) {
    const compatibility = checkConnection(project, connection)
    if (!compatibility.ok) {
      problems.push({ kind: compatibility.reason, ids: [connection.id], describe: compatibility.describe, blocking: true })
    } else {
      if (compatibility.lossy) lossy.push(connection.id)
      fed.add(`${connection.toPage}.${connection.toPort}`)
      used.add(`${connection.fromPage}.${connection.fromPort}`)
    }
  }

  const cycle = findCycle(project)
  if (cycle) {
    const titles = cycle.map((id) => project.pages.find((one) => one.id === id)?.title ?? id)
    problems.push({ kind: 'cycle', ids: cycle, describe: `${titles.join(' -> ')} feed each other in a circle, so none of them can run first.`, blocking: true })
  }

  const unfed: ProjectCheck['unfed'] = []
  const unused: ProjectCheck['unused'] = []
  for (const page of project.pages) {
    for (const port of page.inputs) {
      if (port.required && !fed.has(`${page.id}.${port.name}`)) unfed.push({ pageId: page.id, port: port.name })
    }
    for (const port of page.outputs) {
      if (!used.has(`${page.id}.${port.name}`)) unused.push({ pageId: page.id, port: port.name })
    }
  }
  for (const one of unfed) {
    const page = project.pages.find((p) => p.id === one.pageId)
    problems.push({ kind: 'unfed-input', ids: [one.pageId], describe: `${page?.title} needs "${one.port}" and nothing feeds it.`, blocking: true })
  }

  return { ok: !problems.some((one) => one.blocking), problems, lossy, unfed, unused }
}

function findCycle(project: Project): string[] | null {
  const edges = new Map<string, string[]>()
  for (const connection of project.connections) {
    const list = edges.get(connection.fromPage) ?? []
    if (!list.includes(connection.toPage)) list.push(connection.toPage)
    edges.set(connection.fromPage, list)
  }

  const colour = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  let found: string[] | null = null

  const visit = (id: string, depth: number): boolean => {
    if (depth > PROJECT_LIMITS.depth) return false
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

  for (const page of project.pages) {
    if ((colour.get(page.id) ?? 0) === 0 && visit(page.id, 0)) break
  }
  return found
}

/** The order the Pages can run in, and which of them can run at the same time. */
export function runOrder(project: Project): { order: string[]; levels: string[][] } | ProjectError {
  if (findCycle(project)) return fail('cycle', 'These Pages feed each other in a circle, so there is no order to run them in.')

  const waiting = new Map<string, Set<string>>()
  for (const page of project.pages) waiting.set(page.id, new Set())
  for (const connection of project.connections) {
    if (!waiting.has(connection.toPage) || !waiting.has(connection.fromPage)) continue
    waiting.get(connection.toPage)?.add(connection.fromPage)
  }

  const order: string[] = []
  const levels: string[][] = []
  const done = new Set<string>()

  while (done.size < project.pages.length) {
    const ready = project.pages
      .filter((one) => !done.has(one.id) && [...(waiting.get(one.id) ?? [])].every((dep) => done.has(dep)))
      .map((one) => one.id)
      .sort()
    if (ready.length === 0) break
    levels.push(ready)
    for (const id of ready) {
      done.add(id)
      order.push(id)
    }
  }

  return { order, levels }
}

// ---------------------------------------------------------------- shared variables

export type Scope = 'project' | 'page'

export interface Variable {
  name: string
  scope: Scope
  /** For a page-scoped variable, which page owns it. */
  ownerId: string | null
  type: DataType
  unit: string
  value: number | string | boolean
}

export interface Resolution {
  value: number | string | boolean
  from: 'page' | 'project'
  /** A project variable the page shadows, kept so the shadowing is visible rather than surprising. */
  shadows: { name: string; value: number | string | boolean } | null
}

/**
 * Look up a variable as a given Page sees it.
 *
 * A page variable shadows a project one, and the shadowing is reported. A project where a page quietly overrides a
 * shared assumption is a project where two Pages disagree and both look right.
 */
export function resolveVariable(variables: readonly Variable[], pageId: string, name: string): Resolution | ProjectError {
  const own = variables.find((one) => one.scope === 'page' && one.ownerId === pageId && one.name === name)
  const shared = variables.find((one) => one.scope === 'project' && one.name === name)

  if (own) {
    return { value: own.value, from: 'page', shadows: shared ? { name: shared.name, value: shared.value } : null }
  }
  if (shared) return { value: shared.value, from: 'project', shadows: null }
  return fail('no-such-variable', `Nothing in this project defines "${name}"${pageId ? `, and the page does not define it either` : ''}.`)
}

/** Every place a page-scoped variable overrides a project one. */
export function shadowedVariables(variables: readonly Variable[]): { name: string; pageId: string; projectValue: unknown; pageValue: unknown }[] {
  const shared = new Map(variables.filter((one) => one.scope === 'project').map((one) => [one.name, one]))
  return variables
    .filter((one) => one.scope === 'page' && shared.has(one.name))
    .map((one) => ({
      name: one.name,
      pageId: one.ownerId ?? '',
      projectValue: shared.get(one.name)?.value,
      pageValue: one.value
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.pageId.localeCompare(b.pageId))
}

// ---------------------------------------------------------------- lineage

export interface Artifact {
  id: string
  producedBy: string
  port: string
  /** The fingerprint of everything this was produced from. */
  fingerprint: string
  /** The artifacts that fed the Page that produced this. */
  fromArtifacts: string[]
}

export interface Lineage {
  artifactId: string
  /** Every artifact upstream, nearest first. */
  upstream: string[]
  /** The Pages involved, in the order they ran. */
  pages: string[]
  depth: number
  describe: string
}

/** Where an artifact came from, all the way back. */
export function lineageOf(artifacts: readonly Artifact[], artifactId: string): Lineage | ProjectError {
  const byId = new Map(artifacts.map((one) => [one.id, one]))
  const start = byId.get(artifactId)
  if (!start) return fail('not-found', `There is no artifact "${artifactId}".`)

  const upstream: string[] = []
  const pages: string[] = []
  const seen = new Set<string>([artifactId])
  let frontier = [...start.fromArtifacts]
  let depth = 0

  while (frontier.length > 0 && depth < PROJECT_LIMITS.depth) {
    depth += 1
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      upstream.push(id)
      const one = byId.get(id)
      if (!one) continue
      if (!pages.includes(one.producedBy)) pages.unshift(one.producedBy)
      next.push(...one.fromArtifacts)
    }
    frontier = next
  }

  pages.push(start.producedBy)
  return {
    artifactId,
    upstream,
    pages,
    depth,
    describe:
      upstream.length === 0
        ? `"${artifactId}" was produced by ${start.producedBy} from nothing else in this project, so it is an input rather than a result.`
        : `"${artifactId}" came through ${pages.length} page${pages.length === 1 ? '' : 's'} (${pages.join(' -> ')}) and rests on ${upstream.length} earlier artifact${upstream.length === 1 ? '' : 's'}.`
  }
}

export interface StalenessReport {
  current: string[]
  stale: string[]
  /** Which change made each stale artifact stale, rather than only that it is. */
  because: { artifactId: string; reason: string }[]
  /** Artifacts that cannot be judged, because something upstream is missing. */
  unknown: string[]
}

/**
 * Which artifacts still follow from what produced them.
 *
 * An artifact whose upstream is missing is `unknown`, not current and not stale. Calling it current would be a claim
 * that could not have been checked, which is the specific failure this module exists to prevent.
 */
export function assessArtifacts(
  artifacts: readonly Artifact[],
  fingerprintNow: (artifact: Artifact, upstream: readonly string[]) => string
): StalenessReport {
  const byId = new Map(artifacts.map((one) => [one.id, one]))
  const current: string[] = []
  const stale: string[] = []
  const unknown: string[] = []
  const because: StalenessReport['because'] = []
  const computed = new Map<string, string>()
  const staleSet = new Set<string>()

  // Depth-first so an artifact is judged only after everything it rests on.
  const order: string[] = []
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (id: string, depth: number): void => {
    if (depth > PROJECT_LIMITS.depth || state.get(id) === 2 || state.get(id) === 1) return
    state.set(id, 1)
    for (const up of byId.get(id)?.fromArtifacts ?? []) visit(up, depth + 1)
    state.set(id, 2)
    order.push(id)
  }
  for (const one of artifacts) visit(one.id, 0)

  for (const id of order) {
    const artifact = byId.get(id)
    if (!artifact) continue

    const missing = artifact.fromArtifacts.filter((one) => !byId.has(one))
    if (missing.length > 0) {
      unknown.push(id)
      because.push({ artifactId: id, reason: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer in the project, so whether "${id}" is still right cannot be checked.` })
      continue
    }
    if (artifact.fromArtifacts.some((one) => unknown.includes(one))) {
      unknown.push(id)
      because.push({ artifactId: id, reason: `Something "${id}" rests on cannot be checked, so neither can this.` })
      continue
    }

    const upstream = artifact.fromArtifacts.map((one) => computed.get(one) ?? (byId.get(one)?.fingerprint as string)).sort()
    const want = fingerprintNow(artifact, upstream)
    computed.set(id, want)

    if (want === artifact.fingerprint) {
      current.push(id)
      continue
    }
    stale.push(id)
    staleSet.add(id)
    const changedUpstream = artifact.fromArtifacts.filter((one) => staleSet.has(one))
    because.push({
      artifactId: id,
      reason:
        changedUpstream.length > 0
          ? `${changedUpstream.join(', ')} changed, so "${id}" no longer follows from what produced it.`
          : `The page that produced "${id}", or its settings, changed.`
    })
  }

  return { current, stale, because, unknown }
}

// ---------------------------------------------------------------- checkpoints

export interface Checkpoint {
  id: string
  label: string
  /** The caller's own stamp. Nothing here reads a clock. */
  takenAt: string
  project: Project
  variables: Variable[]
  artifacts: Artifact[]
}

export interface Restoration {
  checkpoint: Checkpoint
  /** What changed between the checkpoint and now, so restoring is a decision rather than a surprise. */
  wouldLose: string[]
  wouldRestore: string[]
  describe: string
}

/** What restoring a checkpoint would do, worked out before it does it. */
export function planRestore(current: Project, checkpoint: Checkpoint): Restoration {
  const nowPages = new Map(current.pages.map((one) => [one.id, one]))
  const thenPages = new Map(checkpoint.project.pages.map((one) => [one.id, one]))

  const wouldLose: string[] = []
  const wouldRestore: string[] = []

  for (const [id, page] of nowPages) {
    if (!thenPages.has(id)) wouldLose.push(`the page "${page.title}", which did not exist at this checkpoint`)
  }
  for (const [id, page] of thenPages) {
    if (!nowPages.has(id)) wouldRestore.push(`the page "${page.title}", which has since been removed`)
  }
  for (const [id, page] of nowPages) {
    const then = thenPages.get(id)
    if (!then) continue
    const changed = Object.keys(page.settings).filter((key) => page.settings[key] !== then.settings[key])
    const removed = Object.keys(then.settings).filter((key) => !Object.prototype.hasOwnProperty.call(page.settings, key))
    if (changed.length > 0 || removed.length > 0) {
      wouldLose.push(`settings on "${page.title}": ${[...changed, ...removed].join(', ')}`)
    }
  }

  const nowConnections = new Set(current.connections.map((one) => `${one.fromPage}.${one.fromPort}->${one.toPage}.${one.toPort}`))
  const thenConnections = new Set(checkpoint.project.connections.map((one) => `${one.fromPage}.${one.fromPort}->${one.toPage}.${one.toPort}`))
  const addedSince = [...nowConnections].filter((one) => !thenConnections.has(one))
  const goneSince = [...thenConnections].filter((one) => !nowConnections.has(one))
  if (addedSince.length > 0) wouldLose.push(`${addedSince.length} connection${addedSince.length === 1 ? '' : 's'} made since`)
  if (goneSince.length > 0) wouldRestore.push(`${goneSince.length} connection${goneSince.length === 1 ? '' : 's'} removed since`)

  return {
    checkpoint,
    wouldLose,
    wouldRestore,
    describe:
      wouldLose.length === 0 && wouldRestore.length === 0
        ? `Nothing has changed since "${checkpoint.label}", so restoring it would do nothing.`
        : `Restoring "${checkpoint.label}" would lose ${wouldLose.length === 0 ? 'nothing' : wouldLose.join('; ')}, and bring back ${wouldRestore.length === 0 ? 'nothing' : wouldRestore.join('; ')}.`
  }
}

// ---------------------------------------------------------------- diff

export interface ProjectDiff {
  pagesAdded: string[]
  pagesRemoved: string[]
  pagesChanged: { pageId: string; settings: string[] }[]
  connectionsAdded: string[]
  connectionsRemoved: string[]
  describe: string
}

/** What is different between two versions of a project. */
export function diffProjects(before: Project, after: Project): ProjectDiff {
  const beforePages = new Map(before.pages.map((one) => [one.id, one]))
  const afterPages = new Map(after.pages.map((one) => [one.id, one]))

  const pagesAdded = [...afterPages.keys()].filter((id) => !beforePages.has(id)).sort()
  const pagesRemoved = [...beforePages.keys()].filter((id) => !afterPages.has(id)).sort()
  const pagesChanged: ProjectDiff['pagesChanged'] = []

  for (const [id, page] of afterPages) {
    const was = beforePages.get(id)
    if (!was) continue
    const keys = new Set([...Object.keys(page.settings), ...Object.keys(was.settings)])
    const settings = [...keys].filter((key) => page.settings[key] !== was.settings[key]).sort()
    if (settings.length > 0) pagesChanged.push({ pageId: id, settings })
  }

  const key = (one: Connection): string => `${one.fromPage}.${one.fromPort}->${one.toPage}.${one.toPort}`
  const beforeConnections = new Set(before.connections.map(key))
  const afterConnections = new Set(after.connections.map(key))
  const connectionsAdded = [...afterConnections].filter((one) => !beforeConnections.has(one)).sort()
  const connectionsRemoved = [...beforeConnections].filter((one) => !afterConnections.has(one)).sort()

  const parts: string[] = []
  if (pagesAdded.length > 0) parts.push(`${pagesAdded.length} page${pagesAdded.length === 1 ? '' : 's'} added`)
  if (pagesRemoved.length > 0) parts.push(`${pagesRemoved.length} removed`)
  if (pagesChanged.length > 0) parts.push(`${pagesChanged.length} reconfigured`)
  if (connectionsAdded.length > 0) parts.push(`${connectionsAdded.length} connection${connectionsAdded.length === 1 ? '' : 's'} made`)
  if (connectionsRemoved.length > 0) parts.push(`${connectionsRemoved.length} removed`)

  return {
    pagesAdded,
    pagesRemoved,
    pagesChanged,
    connectionsAdded,
    connectionsRemoved,
    describe: parts.length === 0 ? 'These two are the same project.' : `${parts.join(', ')}.`
  }
}

// ---------------------------------------------------------------- import and export

export interface Bundle {
  project: Project
  variables: Variable[]
  /** Page types this project needs. Import refuses rather than dropping the Pages it cannot build. */
  requires: { pageType: string }[]
}

export interface ImportReport {
  ok: boolean
  bundle: Bundle | null
  missing: string[]
  /** Renames applied because the id was already taken, so nothing is silently overwritten. */
  renamed: { from: string; to: string }[]
  describe: string
}

/**
 * Bring a project in beside what is already there.
 *
 * Colliding ids are renamed rather than overwritten, and the renames are listed. Importing a project that silently
 * replaced pages of the same id would destroy work that the person importing did not know existed.
 */
export function importBundle(bundle: Bundle, availablePageTypes: readonly string[], existingIds: readonly string[]): ImportReport {
  const missing = [...new Set(bundle.requires.map((one) => one.pageType))].filter((one) => !availablePageTypes.includes(one)).sort()
  if (missing.length > 0) {
    return {
      ok: false,
      bundle: null,
      missing,
      renamed: [],
      describe: `This project needs ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not available here. Importing it without ${missing.length === 1 ? 'that page' : 'those pages'} would give a project with holes in it that look like empty inputs.`
    }
  }

  const taken = new Set(existingIds)
  const renamed: ImportReport['renamed'] = []
  const map = new Map<string, string>()

  for (const page of bundle.project.pages) {
    let id = page.id
    let n = 2
    while (taken.has(id)) {
      id = `${page.id}-${n}`
      n += 1
    }
    taken.add(id)
    map.set(page.id, id)
    if (id !== page.id) renamed.push({ from: page.id, to: id })
  }

  const project: Project = {
    ...bundle.project,
    pages: bundle.project.pages.map((one) => ({ ...one, id: map.get(one.id) ?? one.id })),
    connections: bundle.project.connections.map((one) => ({
      ...one,
      fromPage: map.get(one.fromPage) ?? one.fromPage,
      toPage: map.get(one.toPage) ?? one.toPage
    }))
  }
  const variables = bundle.variables.map((one) => (one.ownerId === null ? one : { ...one, ownerId: map.get(one.ownerId) ?? one.ownerId }))

  return {
    ok: true,
    bundle: { project, variables, requires: bundle.requires },
    missing: [],
    renamed,
    describe:
      renamed.length === 0
        ? `${project.pages.length} page${project.pages.length === 1 ? '' : 's'} imported.`
        : `${project.pages.length} pages imported. ${renamed.length} had ${renamed.length === 1 ? 'an id' : 'ids'} already in use and ${renamed.length === 1 ? 'was' : 'were'} renamed rather than overwriting what is there: ${renamed.map((one) => `${one.from} -> ${one.to}`).join(', ')}.`
  }
}

/** What a bundle needs, worked out from the project rather than declared by hand. */
export function requirementsOf(project: Project): { pageType: string }[] {
  return [...new Set(project.pages.map((one) => one.pageType))].sort().map((pageType) => ({ pageType }))
}

/** The assumptions the project system rests on, shown rather than implied. */
export const PROJECT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A connection whose types differ needs a named conversion; nothing is coerced silently.',
  'A connection whose units differ is refused even when the types match, because that is the mismatch that computes perfectly and gives a wrong answer.',
  'A conversion that loses information says so at every use.',
  'A required input that nothing feeds stops the project from running.',
  'An output nothing uses is reported, because it is usually a wire somebody forgot.',
  'A page-scoped variable shadowing a project one is reported, so two pages cannot quietly disagree.',
  'Every artifact records the pages and inputs it came through, so a number can be traced back after everyone involved has gone.',
  'An artifact whose upstream is missing is unknown, not current: calling it current would be a claim that could not be checked.',
  'Restoring a checkpoint says what it would lose before it does it.',
  'An import renames colliding ids rather than overwriting, and lists every rename.',
  'An import that needs a page type this copy does not have is refused rather than left with holes.'
])
