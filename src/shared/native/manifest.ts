/**
 * What a Native App declares about itself.
 *
 * A Native App is an interactive environment that can be opened *inside a conversation* — a plotter, a laboratory, a
 * visualiser, eventually a compiler. The manifest is everything Orbis knows about one before any of it runs: what it
 * is called, what it can do, what it needs, how big it wants to be, and which actions Orion may ask of it.
 *
 * ## This is not a second Pages registry
 *
 * Orbis already has `shared/pages/*`, which owns Page identity, permissions, sandboxing and versioning, and `shared/
 * commandCenter.ts`, which owns the browser's capability rows. Neither is replaced. A Native App manifest is the
 * record of **a surface that can be mounted in the chat**, and for the thirty-seven Pages Orbis ships, that record is
 * *derived* from the Page they already have (`catalogue.ts`). Where the two could disagree about a Page — its id, its
 * permissions, whether it may run — the Pages registry is right and this layer is stale.
 *
 * What this layer adds, and nothing else has: an instance model, a lifecycle, a chat host, one discovery index that
 * both Orion and Search Labs read, and a typed action contract.
 *
 * ## Three ideas kept apart
 *
 * ```
 * manifest    what an app is, fixed at build time
 * instance    one opened copy of it, with its own state        (instances.ts)
 * experiment  a deliberately saved computational state         (shared/pages/experiments.ts)
 * ```
 *
 * Collapsing the first two is how two open simulations end up sharing a gravity value. Collapsing the last two is how
 * closing a window deletes somebody's work.
 *
 * ## Validation, not repair
 *
 * A manifest that does not validate does not register. There is no path here that patches one and continues: a
 * repaired manifest describes an app whose author did not write what runs. Phase 1 manifests are all written in this
 * repository, so a failure is a programming error and `problems()` says exactly which field — but the checks stay,
 * because Phase 2 adds apps and later phases may load them from elsewhere.
 *
 * Pure. No clock, no storage, no React.
 */

// ---------------------------------------------------------------- identity

/** Where an app sits in the catalogue. Discovery metadata, never a menu the user has to walk. */
export type AppDomain =
  | 'computing'
  | 'mathematics'
  | 'physics'
  | 'chemistry'
  | 'biology'
  | 'engineering'
  | 'ai'
  | 'data'
  | 'systems'
  | 'creative'
  | 'study'

export const APP_DOMAINS: readonly AppDomain[] = Object.freeze([
  'computing',
  'mathematics',
  'physics',
  'chemistry',
  'biology',
  'engineering',
  'ai',
  'data',
  'systems',
  'creative',
  'study'
])

const DOMAIN_SET = new Set<string>(APP_DOMAINS)

export const isAppDomain = (value: unknown): value is AppDomain => typeof value === 'string' && DOMAIN_SET.has(value)

/**
 * How much room an app asks for.
 *
 * `compact` sits in the conversation at message width. `expanded` takes the width of the chat column and a tall
 * viewport. `workspace` fills the window. An app states the largest it supports and the one it opens at, and the host
 * never offers a size the app did not claim — an expand button that produces a broken layout is worse than no expand
 * button.
 */
export type AppSize = 'compact' | 'expanded' | 'workspace'

export const APP_SIZES: readonly AppSize[] = Object.freeze(['compact', 'expanded', 'workspace'])

const SIZE_ORDER: Record<AppSize, number> = { compact: 0, expanded: 1, workspace: 2 }

export const sizeAtMost = (want: AppSize, most: AppSize): AppSize => (SIZE_ORDER[want] <= SIZE_ORDER[most] ? want : most)

export const sizeRank = (size: AppSize): number => SIZE_ORDER[size]

/**
 * What happens to an app that is no longer on screen.
 *
 * The runtime cannot guess this. A plotter costs nothing to leave running and a particle simulation costs a core, so
 * an app says which it is and `instances.ts` acts on it. Defaulting everything to `pause` would freeze a long
 * computation somebody scrolled past; defaulting to `continue` would leave ten simulations running in one
 * conversation.
 */
export type WhenHidden = 'pause' | 'throttle' | 'continue'

export const WHEN_HIDDEN: readonly WhenHidden[] = Object.freeze(['pause', 'throttle', 'continue'])

// ---------------------------------------------------------------- what an app can do

/**
 * A capability is a thing the platform can do, declared by the apps that provide it.
 *
 * Capabilities are how Orion gets from "the user wants to see a function drawn" to an app, without a chain of
 * `if text.includes('plot')`. They are matched structurally: an app provides a capability or it does not, and no
 * amount of keyword overlap substitutes.
 *
 * The vocabulary is open on purpose — `registry.ts` learns capability ids from the apps that register them, so Phase 2
 * adding `executeCode` touches no file here.
 */
export interface CapabilityRef {
  /** Lower camel, e.g. `plotFunction`. The id Orion reasons with. */
  id: string
  /** One line, for the discovery index and for explaining a match. */
  summary: string
}

/** A declaration of something an app needs from outside itself. Requested, never granted here. */
export type AppPermission =
  | 'compute'
  | 'file.read'
  | 'file.write'
  | 'clipboard.read'
  | 'clipboard.write'
  | 'network'
  | 'gpu'
  | 'worker'
  | 'process'
  | 'browser.read'
  | 'camera'
  | 'microphone'

export const APP_PERMISSIONS: readonly AppPermission[] = Object.freeze([
  'compute',
  'file.read',
  'file.write',
  'clipboard.read',
  'clipboard.write',
  'network',
  'gpu',
  'worker',
  'process',
  'browser.read',
  'camera',
  'microphone'
])

const PERMISSION_SET = new Set<string>(APP_PERMISSIONS)

export const isAppPermission = (value: unknown): value is AppPermission => typeof value === 'string' && PERMISSION_SET.has(value)

/**
 * How risky a permission is, decided here and never by the app that wants it.
 *
 * A manifest cannot describe `process` as harmless. This table is the only opinion that counts, which is the same rule
 * `shared/pages/capabilities.ts` applies to Pages and for the same reason.
 */
export const PERMISSION_RISK: Readonly<Record<AppPermission, 'low' | 'medium' | 'high' | 'critical'>> = Object.freeze({
  compute: 'low',
  worker: 'low',
  'clipboard.write': 'low',
  'clipboard.read': 'medium',
  'file.read': 'medium',
  gpu: 'medium',
  'browser.read': 'medium',
  'file.write': 'high',
  network: 'high',
  camera: 'high',
  microphone: 'high',
  process: 'critical'
})

// ---------------------------------------------------------------- actions

/**
 * Something Orion or the UI may ask an app to do.
 *
 * Declared, so `actions.ts` can refuse an action an app never offered rather than dispatching it and hoping. An
 * action's arguments are parameters (see `parameters.ts`), validated before the app ever sees them.
 */
export interface ActionDeclaration {
  id: string
  /** What it does, in the words a person would use. Shown in developer mode and used to explain a refusal. */
  summary: string
  /** Parameter ids this action takes. Each must exist in the app's parameter list. */
  takes: readonly string[]
  /** True when running it twice is the same as running it once. Save, reset and load should be. */
  idempotent: boolean
  /** True when it changes state somebody could lose. The host confirms these; the others it just runs. */
  destructive: boolean
}

// ---------------------------------------------------------------- data in and out

/**
 * A kind of data an app accepts or produces.
 *
 * Deliberately coarse. Phase 1 needs to answer "could this app's output feed that app's input" without inventing a
 * type system, and a coarse answer that is right beats a precise one that is guessed. `dataFlows` in `registry.ts` is
 * the only thing that reads these.
 */
export type DataKind = 'table' | 'series' | 'numbers' | 'text' | 'expression' | 'image' | 'document' | 'experiment' | 'code'

export const DATA_KINDS: readonly DataKind[] = Object.freeze([
  'table',
  'series',
  'numbers',
  'text',
  'expression',
  'image',
  'document',
  'experiment',
  'code'
])

const DATA_SET = new Set<string>(DATA_KINDS)

export const isDataKind = (value: unknown): value is DataKind => typeof value === 'string' && DATA_SET.has(value)

// ---------------------------------------------------------------- the manifest

/**
 * Where an app's interactive surface comes from.
 *
 * `page` means it is one of the Pages Orbis ships — the component already exists and the Pages registry owns its
 * identity. `native` means a component registered by this layer directly, which is what Phase 2's compiler and
 * visualiser will be. `artifact` means the Creation Engine already renders it, and the native layer only arranges for
 * it to be reachable by capability.
 *
 * The distinction exists so nothing here has to be rebuilt to be registered. It is the whole reason the thirty-seven
 * existing Pages and the Flowchart cost no new UI.
 */
export type SurfaceKind = 'page' | 'native' | 'artifact'

export interface NativeAppManifest {
  // identity
  /** Stable, kebab-case, unique across the registry. Never a display name, never an array position. */
  id: string
  name: string
  /** One sentence, in plain words. What the discovery index searches and what Search Labs shows. */
  summary: string
  /** The author's version of this app. Bumped when its behaviour changes; stored with saved instances. */
  version: number
  domain: AppDomain
  /** A lucide icon name, so the host needs no icon file. */
  icon: string

  // discovery
  /** Other words somebody might search. "code runner" finding a compiler is an alias, not a capability. */
  aliases: readonly string[]
  /** Finer-grained tags than the domain: `gravity`, `collision`, `regression`. */
  tags: readonly string[]
  capabilities: readonly CapabilityRef[]

  // the surface
  surface: { kind: SurfaceKind; ref: string }
  /** The size it opens at. */
  opensAt: AppSize
  /** The largest size it supports. The host offers nothing beyond this. */
  largest: AppSize
  whenHidden: WhenHidden

  // contract
  /** Parameter definitions, by id. Built with `parameters.ts`. */
  parameters: readonly string[]
  actions: readonly ActionDeclaration[]
  accepts: readonly DataKind[]
  produces: readonly DataKind[]
  permissions: readonly AppPermission[]

  // behaviour
  /** True when an instance's state is worth keeping across restarts. */
  persists: boolean
  /** The engine this app computes through, when it has one. Recorded with saved state for reproducibility. */
  engine: string | null
  /** What it deliberately does not do. Shown rather than discovered, and never empty for a real app. */
  limitations: readonly string[]
  /**
   * The id of an app that now does this job better, when one exists.
   *
   * Set where Orbis built something and the user's own studio was later ported with the same thing in it. A
   * superseded app leaves the catalogue and stops providing its capabilities -- they go to the app named here --
   * but stays registered, so an instance already on screen is not taken away from somebody mid-session.
   */
  supersededBy?: string
}

// ---------------------------------------------------------------- validation

export interface ManifestProblem {
  field: string
  says: string
}

const ID_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const CAPABILITY_SHAPE = /^[a-z][A-Za-z0-9]*$/

export const LIMITS = Object.freeze({
  id: 64,
  name: 80,
  summary: 240,
  aliases: 20,
  /*
   * Raised from 30 for one honest reason: the Algorithm Laboratory derives a tag from every algorithm's own name,
   * so registering an algorithm makes it findable by name in the same commit rather than the tag list falling
   * behind. Thirty-nine algorithms plus the general words is about ninety, and a hundred and twenty leaves room
   * for the rest without being a licence to pad a manifest — a manifest whose tags are not derived from something
   * real should still be a short list, and the review for that is reading it.
   */
  tags: 120,
  capabilities: 24,
  actions: 40,
  parameters: 200,
  limitations: 12,
  text: 400
})

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Everything wrong with a manifest, said at once.
 *
 * All of it, not the first failure: a manifest with four mistakes should take one fix, not four runs.
 */
export function problems(raw: unknown): ManifestProblem[] {
  const out: ManifestProblem[] = []
  const add = (field: string, says: string): void => {
    out.push({ field, says })
  }

  if (!raw || typeof raw !== 'object') return [{ field: '', says: 'A manifest has to be an object.' }]
  const one = raw as Record<string, unknown>

  // identity
  const id = text(one.id)
  if (!id) add('id', 'An app needs an id.')
  else if (!ID_SHAPE.test(id)) add('id', `"${id}" is not a valid id: lower case words joined by hyphens.`)
  else if (id.length > LIMITS.id) add('id', `An id cannot be longer than ${LIMITS.id} characters.`)

  if (!text(one.name)) add('name', 'An app needs a name.')
  else if (text(one.name).length > LIMITS.name) add('name', `A name cannot be longer than ${LIMITS.name} characters.`)

  if (!text(one.summary)) add('summary', 'An app needs a one-line summary; it is what Search Labs shows.')
  else if (text(one.summary).length > LIMITS.summary) add('summary', `A summary cannot be longer than ${LIMITS.summary} characters.`)

  if (typeof one.version !== 'number' || !Number.isInteger(one.version) || one.version < 1) {
    add('version', 'A version has to be a whole number of at least 1.')
  }

  if (!isAppDomain(one.domain)) add('domain', `"${String(one.domain)}" is not a domain. One of: ${APP_DOMAINS.join(', ')}.`)
  if (!text(one.icon)) add('icon', 'An app needs an icon name.')

  // discovery
  const list = (value: unknown, field: string, most: number): string[] => {
    if (value === undefined) {
      add(field, 'This list is required, even when it is empty.')
      return []
    }
    if (!Array.isArray(value)) {
      add(field, 'This has to be a list.')
      return []
    }
    if (value.length > most) add(field, `No more than ${most} entries.`)
    const strings = value.filter((two): two is string => typeof two === 'string')
    if (strings.length !== value.length) add(field, 'Every entry has to be text.')
    return strings
  }

  list(one.aliases, 'aliases', LIMITS.aliases)
  list(one.tags, 'tags', LIMITS.tags)

  const capabilities = Array.isArray(one.capabilities) ? one.capabilities : null
  if (capabilities === null) add('capabilities', 'This has to be a list.')
  else {
    if (capabilities.length === 0) {
      add('capabilities', 'An app with no capabilities cannot be found by Orion. Declare at least one.')
    }
    if (capabilities.length > LIMITS.capabilities) add('capabilities', `No more than ${LIMITS.capabilities} capabilities.`)
    const seen = new Set<string>()
    capabilities.forEach((two, at) => {
      if (!two || typeof two !== 'object') {
        add(`capabilities[${at}]`, 'Each capability is { id, summary }.')
        return
      }
      const cap = two as Record<string, unknown>
      const capId = text(cap.id)
      if (!capId) add(`capabilities[${at}].id`, 'A capability needs an id.')
      else if (!CAPABILITY_SHAPE.test(capId)) add(`capabilities[${at}].id`, `"${capId}" is not a capability id: lower camel case.`)
      else if (seen.has(capId)) add(`capabilities[${at}].id`, `"${capId}" is declared twice.`)
      else seen.add(capId)
      if (!text(cap.summary)) add(`capabilities[${at}].summary`, 'A capability needs a summary; it is how a match gets explained.')
    })
  }

  // surface
  const surface = one.surface && typeof one.surface === 'object' ? (one.surface as Record<string, unknown>) : null
  if (surface === null) add('surface', 'An app needs a surface: { kind, ref }.')
  else {
    const kind = text(surface.kind)
    if (kind !== 'page' && kind !== 'native' && kind !== 'artifact') {
      add('surface.kind', `"${kind}" is not a surface kind. One of: page, native, artifact.`)
    }
    if (!text(surface.ref)) add('surface.ref', 'A surface needs a ref: which component or Page it mounts.')
  }

  const size = (value: unknown, field: string): AppSize | null => {
    if (value === 'compact' || value === 'expanded' || value === 'workspace') return value
    add(field, `"${String(value)}" is not a size. One of: ${APP_SIZES.join(', ')}.`)
    return null
  }
  const opensAt = size(one.opensAt, 'opensAt')
  const largest = size(one.largest, 'largest')
  if (opensAt !== null && largest !== null && SIZE_ORDER[opensAt] > SIZE_ORDER[largest]) {
    add('opensAt', `It opens at ${opensAt} and says ${largest} is the largest it supports.`)
  }

  if (one.whenHidden !== 'pause' && one.whenHidden !== 'throttle' && one.whenHidden !== 'continue') {
    add('whenHidden', `"${String(one.whenHidden)}" is not a hidden behaviour. One of: ${WHEN_HIDDEN.join(', ')}.`)
  }

  // contract
  list(one.parameters, 'parameters', LIMITS.parameters)
  const parameters = new Set(Array.isArray(one.parameters) ? one.parameters.filter((two): two is string => typeof two === 'string') : [])

  const actions = Array.isArray(one.actions) ? one.actions : null
  if (actions === null) add('actions', 'This has to be a list.')
  else {
    if (actions.length > LIMITS.actions) add('actions', `No more than ${LIMITS.actions} actions.`)
    const seen = new Set<string>()
    actions.forEach((two, at) => {
      if (!two || typeof two !== 'object') {
        add(`actions[${at}]`, 'Each action is { id, summary, takes, idempotent, destructive }.')
        return
      }
      const action = two as Record<string, unknown>
      const actionId = text(action.id)
      if (!actionId) add(`actions[${at}].id`, 'An action needs an id.')
      else if (!CAPABILITY_SHAPE.test(actionId)) add(`actions[${at}].id`, `"${actionId}" is not an action id: lower camel case.`)
      else if (seen.has(actionId)) add(`actions[${at}].id`, `"${actionId}" is declared twice.`)
      else seen.add(actionId)
      if (!text(action.summary)) add(`actions[${at}].summary`, 'An action needs a summary.')
      if (typeof action.idempotent !== 'boolean') add(`actions[${at}].idempotent`, 'Say whether running it twice is the same as once.')
      if (typeof action.destructive !== 'boolean') add(`actions[${at}].destructive`, 'Say whether it can lose something.')
      const takes = Array.isArray(action.takes) ? action.takes : null
      if (takes === null) add(`actions[${at}].takes`, 'This has to be a list of parameter ids.')
      else {
        for (const want of takes) {
          if (typeof want !== 'string') add(`actions[${at}].takes`, 'Every entry has to be a parameter id.')
          // An action taking a parameter the app does not have is unrunnable, and would fail only when invoked.
          else if (!parameters.has(want)) add(`actions[${at}].takes`, `"${want}" is not one of this app's parameters.`)
        }
      }
    })
  }

  const kinds = (value: unknown, field: string): void => {
    if (!Array.isArray(value)) {
      add(field, 'This has to be a list.')
      return
    }
    for (const two of value) if (!isDataKind(two)) add(field, `"${String(two)}" is not a data kind. One of: ${DATA_KINDS.join(', ')}.`)
  }
  kinds(one.accepts, 'accepts')
  kinds(one.produces, 'produces')

  if (!Array.isArray(one.permissions)) add('permissions', 'This has to be a list.')
  else for (const two of one.permissions) if (!isAppPermission(two)) add('permissions', `"${String(two)}" is not a permission.`)

  // behaviour
  if (typeof one.persists !== 'boolean') add('persists', 'Say whether an instance is worth keeping across restarts.')
  if (one.engine !== null && typeof one.engine !== 'string') add('engine', 'An engine is a name, or null when the app has none.')
  if (one.supersededBy !== undefined) {
    if (typeof one.supersededBy !== 'string' || one.supersededBy.trim() === '') {
      add('supersededBy', 'The app that supersedes this one is named by its id.')
    } else if (one.supersededBy === one.id) {
      add('supersededBy', 'An app cannot supersede itself.')
    }
  }

  const limitations = list(one.limitations, 'limitations', LIMITS.limitations)
  if (limitations.length === 0 && Array.isArray(one.limitations)) {
    // Not fatal, but said: an app claiming no limitations has not thought about them.
    add('limitations', 'Every real app has something it does not do. Say what, so nobody discovers it by failing.')
  }

  return out
}

export const valid = (raw: unknown): raw is NativeAppManifest => problems(raw).length === 0

/**
 * A manifest, or the reasons it is not one.
 *
 * Returns the object itself rather than a copy, because Phase 1 manifests are frozen literals in this repository and
 * copying one would only hide which object the registry holds.
 */
export function readManifest(raw: unknown): { ok: true; manifest: NativeAppManifest } | { ok: false; problems: ManifestProblem[] } {
  const found = problems(raw)
  if (found.length > 0) return { ok: false, problems: found }
  return { ok: true, manifest: raw as NativeAppManifest }
}

/** The riskiest thing an app asks for. Used to decide what needs saying before it opens. */
export function highestRisk(manifest: NativeAppManifest): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  const order = ['none', 'low', 'medium', 'high', 'critical'] as const
  let at = 0
  for (const permission of manifest.permissions) {
    const risk = PERMISSION_RISK[permission]
    const found = order.indexOf(risk)
    if (found > at) at = found
  }
  return order[at]
}
