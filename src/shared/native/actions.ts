import type { ActionDeclaration, AppSize, NativeAppManifest } from './manifest.ts'
import { APP_SIZES } from './manifest.ts'
import { appById, launchable, resolve, type Readiness, type Registry } from './registry.ts'

/**
 * What Orion may ask of a Native App, and how an ask becomes something safe to run.
 *
 * ## The boundary this file is
 *
 * ```
 * Orion's words
 *      ↓
 * a structured action            ← parsed here, never executed
 *      ↓
 * shape checked                  ← field by field
 *      ↓
 * app exists? action declared?   ← against the registry, not a hope
 *      ↓
 * permitted? openable?
 *      ↓
 * run
 * ```
 *
 * Nothing skips a step. A model's output is text that *describes* an action, and the gap between "describes" and "is"
 * is where a model that was confidently wrong — or a page that told it what to say — would otherwise reach the engine.
 * This is the same rule the rest of Orbis applies to model output: a model may propose, never dispatch.
 *
 * ## An action an app did not declare does not exist
 *
 * `plan` checks the app's own `actions` list. An app that never declared `run` cannot be run, however reasonable the
 * request sounds, because the alternative is dispatching a verb the app has no handler for and reporting whatever
 * happens as the user's answer.
 *
 * ## Refusals carry a reason
 *
 * Every refusal says what was wrong in words a person could read, because Orion has to tell them. `'invalid'` with no
 * explanation turns into a model guessing at why, which is worse than the original failure.
 *
 * Pure. No model, no network, no dispatch — `plan` returns a description of what to do and the main process does it.
 */

// ---------------------------------------------------------------- the vocabulary

/**
 * The actions the runtime itself understands.
 *
 * Deliberately small. Everything domain-specific is an app's own declared action, reached through `invoke`, so adding
 * Phase 3's `addBody` or `stepSolver` does not touch this list.
 */
export type ActionKind =
  | 'open'
  | 'configure'
  | 'invoke'
  | 'run'
  | 'pause'
  | 'reset'
  | 'resize'
  | 'close'
  | 'state'
  | 'save'
  | 'load'
  | 'export'
  | 'find'

export const ACTION_KINDS: readonly ActionKind[] = Object.freeze([
  'open',
  'configure',
  'invoke',
  'run',
  'pause',
  'reset',
  'resize',
  'close',
  'state',
  'save',
  'load',
  'export',
  'find'
])

const KIND_SET = new Set<string>(ACTION_KINDS)

/** How much of an instance's state Orion is asking for. */
export type Detail = 'summary' | 'full'

export type Action =
  /** Open an app. By id, or by the capability needed — Orion usually knows the second, not the first. */
  | { kind: 'open'; appId?: string; capability?: string; configure?: Record<string, unknown>; size?: AppSize; conversationId?: string }
  | { kind: 'configure'; instanceId: string; values: Record<string, unknown> }
  /** One of the app's own declared actions. */
  | { kind: 'invoke'; instanceId: string; action: string; values?: Record<string, unknown> }
  | { kind: 'run'; instanceId: string }
  | { kind: 'pause'; instanceId: string }
  | { kind: 'reset'; instanceId: string }
  | { kind: 'resize'; instanceId: string; size: AppSize }
  | { kind: 'close'; instanceId: string }
  | { kind: 'state'; instanceId: string; detail: Detail }
  | { kind: 'save'; instanceId: string; name?: string }
  | { kind: 'load'; instanceId: string; experimentId: string }
  | { kind: 'export'; instanceId: string; format: string }
  /** Discovery. Answers with apps, opens nothing. */
  | { kind: 'find'; query: string }

export interface ActionRefusal {
  /** Which check it failed. The caller uses this; the user reads `says`. */
  error: 'shape' | 'unknown-app' | 'unknown-action' | 'unknown-instance' | 'not-openable' | 'no-such-capability' | 'not-allowed'
  /** Plain words, suitable for Orion to repeat verbatim. */
  says: string
}

export const isRefusal = (value: unknown): value is ActionRefusal =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value

const no = (error: ActionRefusal['error'], says: string): ActionRefusal => ({ error, says })

// ---------------------------------------------------------------- reading one

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const record = (value: unknown): Record<string, unknown> | null =>
  value === undefined ? {} : value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const MOST_VALUES = 200
const MOST_QUERY = 200

/**
 * An action read out of whatever the model produced, or a refusal.
 *
 * Field by field. Nothing is inferred: an `open` with neither an app nor a capability is refused rather than being
 * turned into a guess about which app was meant, and an unknown `kind` is refused rather than being treated as the
 * nearest one.
 */
export function readAction(raw: unknown): Action | ActionRefusal {
  if (!raw || typeof raw !== 'object') return no('shape', 'That was not an action.')
  const one = raw as Record<string, unknown>

  const kind = text(one.kind)
  if (!KIND_SET.has(kind)) return no('shape', `"${kind}" is not something an app can be asked to do.`)

  const needsInstance = (): string | ActionRefusal => {
    const id = text(one.instanceId)
    return id ? id : no('shape', `A ${kind} has to say which open app it means.`)
  }

  const readValues = (value: unknown, field: string): Record<string, unknown> | ActionRefusal => {
    const found = record(value)
    if (found === null) return no('shape', `${field} has to be a set of named values.`)
    if (Object.keys(found).length > MOST_VALUES) return no('shape', `No more than ${MOST_VALUES} values at once.`)
    return found
  }

  switch (kind as ActionKind) {
    case 'open': {
      const appId = text(one.appId)
      const capability = text(one.capability)
      if (!appId && !capability) return no('shape', 'Opening an app needs either its name or what it has to be able to do.')
      const configure = readValues(one.configure, 'The configuration')
      if (isRefusal(configure)) return configure
      const size = one.size === undefined ? undefined : text(one.size)
      if (size !== undefined && !APP_SIZES.includes(size as AppSize)) {
        return no('shape', `"${String(one.size)}" is not a size. One of: ${APP_SIZES.join(', ')}.`)
      }
      const conversationId = text(one.conversationId)
      return {
        kind: 'open',
        ...(appId ? { appId } : {}),
        ...(capability ? { capability } : {}),
        ...(Object.keys(configure).length > 0 ? { configure } : {}),
        ...(size ? { size: size as AppSize } : {}),
        ...(conversationId ? { conversationId } : {})
      }
    }
    case 'configure': {
      const instanceId = needsInstance()
      if (isRefusal(instanceId)) return instanceId
      const values = readValues(one.values, 'The values')
      if (isRefusal(values)) return values
      if (Object.keys(values).length === 0) return no('shape', 'Configuring an app needs at least one value to set.')
      return { kind: 'configure', instanceId, values }
    }
    case 'invoke': {
      const instanceId = needsInstance()
      if (isRefusal(instanceId)) return instanceId
      const action = text(one.action)
      if (!action) return no('shape', 'An invoke has to name the action.')
      const values = readValues(one.values, 'The values')
      if (isRefusal(values)) return values
      return { kind: 'invoke', instanceId, action, ...(Object.keys(values).length > 0 ? { values } : {}) }
    }
    case 'run':
    case 'pause':
    case 'reset':
    case 'close': {
      const instanceId = needsInstance()
      if (isRefusal(instanceId)) return instanceId
      return { kind: kind as 'run' | 'pause' | 'reset' | 'close', instanceId }
    }
    case 'resize': {
      const instanceId = needsInstance()
      if (isRefusal(instanceId)) return instanceId
      const size = text(one.size)
      if (!APP_SIZES.includes(size as AppSize)) return no('shape', `"${size}" is not a size. One of: ${APP_SIZES.join(', ')}.`)
      return { kind: 'resize', instanceId, size: size as AppSize }
    }
    case 'state': {
      const instanceId = needsInstance()
      if (isRefusal(instanceId)) return instanceId
      const detail = text(one.detail) || 'summary'
      if (detail !== 'summary' && detail !== 'full') return no('shape', 'Detail is either summary or full.')
      return { kind: 'state', instanceId, detail }
    }
    case 'save': {
      const instanceId = needsInstance()
      if (isRefusal(instanceId)) return instanceId
      const name = text(one.name)
      return { kind: 'save', instanceId, ...(name ? { name: name.slice(0, 120) } : {}) }
    }
    case 'load': {
      const instanceId = needsInstance()
      if (isRefusal(instanceId)) return instanceId
      const experimentId = text(one.experimentId)
      if (!experimentId) return no('shape', 'Loading needs to say which saved state.')
      return { kind: 'load', instanceId, experimentId }
    }
    case 'export': {
      const instanceId = needsInstance()
      if (isRefusal(instanceId)) return instanceId
      const format = text(one.format)
      if (!format) return no('shape', 'An export has to say which format.')
      return { kind: 'export', instanceId, format: format.toLowerCase().slice(0, 20) }
    }
    case 'find': {
      const query = text(one.query)
      if (!query) return no('shape', 'A search needs something to search for.')
      return { kind: 'find', query: query.slice(0, MOST_QUERY) }
    }
    default:
      return no('shape', `"${kind}" is not something an app can be asked to do.`)
  }
}

// ---------------------------------------------------------------- planning one

/** What the instance an action refers to looks like, as far as this file needs to know. */
export interface InstanceFacts {
  id: string
  appId: string
  phase: string
}

export interface Plan {
  action: Action
  /** The app it resolved to. Absent for `find`, which opens nothing. */
  manifest?: NativeAppManifest
  /** The app's own declaration, for an `invoke`. */
  declaration?: ActionDeclaration
  /** True when the host should ask before running it. */
  confirm: boolean
  /** What is about to happen, in words, for the confirmation and for the log. */
  describes: string
}

/**
 * An action checked against what actually exists, or a refusal that says why.
 *
 * This is the last gate before dispatch, and it is where the three failures that matter are caught: an app that is not
 * registered, an action the app never declared, and an app that cannot open on this machine. Each gets its own reason,
 * because they send somebody to three different places.
 */
export function plan(
  action: Action,
  registry: Registry,
  readiness: Readiness,
  instances: readonly InstanceFacts[],
  context: { recent?: readonly string[] } = {}
): Plan | ActionRefusal {
  if (action.kind === 'find') {
    return { action, confirm: false, describes: `Looking for apps matching "${action.query}".` }
  }

  if (action.kind === 'open') {
    let manifest: NativeAppManifest | null = null
    if (action.appId) {
      manifest = appById(registry, action.appId)
      if (!manifest) return no('unknown-app', `There is no app called "${action.appId}".`)
    } else if (action.capability) {
      manifest = resolve(registry, action.capability, readiness, { recent: context.recent })
      if (!manifest) {
        // The honest answer. Orion falls back to answering normally rather than opening something approximate.
        return no('no-such-capability', `Nothing in Orbis can ${readCapability(action.capability)} yet.`)
      }
    }
    if (!manifest) return no('shape', 'Opening an app needs either its name or what it has to be able to do.')

    const can = launchable(manifest, readiness)
    if (!can.ok) return no('not-openable', can.blocked?.says ?? `${manifest.name} cannot be opened right now.`)

    const named = Object.keys(action.configure ?? {})
    return {
      action,
      manifest,
      confirm: false,
      describes: named.length > 0 ? `Opening ${manifest.name} with ${named.join(', ')} set.` : `Opening ${manifest.name}.`
    }
  }

  // Everything else refers to something already open.
  const instance = instances.find((one) => one.id === action.instanceId)
  if (!instance) return no('unknown-instance', 'That app is not open any more.')
  if (instance.phase === 'closed') return no('unknown-instance', 'That app was closed. Open it again to carry on.')

  const manifest = appById(registry, instance.appId)
  if (!manifest) return no('unknown-app', 'That app is no longer part of this build of Orbis.')

  if (action.kind === 'invoke') {
    const declaration = manifest.actions.find((one) => one.id === action.action)
    if (!declaration) {
      const offered = manifest.actions.map((one) => one.id)
      return no(
        'unknown-action',
        offered.length > 0
          ? `${manifest.name} cannot "${action.action}". It can: ${offered.join(', ')}.`
          : `${manifest.name} has no actions that can be asked for.`
      )
    }
    const unknown = Object.keys(action.values ?? {}).filter((one) => !declaration.takes.includes(one))
    if (unknown.length > 0) {
      return no('shape', `${declaration.id} does not take ${unknown.join(', ')}. It takes: ${declaration.takes.join(', ') || 'nothing'}.`)
    }
    return {
      action,
      manifest,
      declaration,
      confirm: declaration.destructive,
      describes: `${declaration.summary} (${manifest.name})`
    }
  }

  switch (action.kind) {
    case 'configure':
      return { action, manifest, confirm: false, describes: `Setting ${Object.keys(action.values).join(', ')} in ${manifest.name}.` }
    case 'run':
      return { action, manifest, confirm: false, describes: `Running ${manifest.name}.` }
    case 'pause':
      return { action, manifest, confirm: false, describes: `Pausing ${manifest.name}.` }
    case 'reset':
      // Confirmed: a reset throws away whatever the person had set, and asking costs one click.
      return { action, manifest, confirm: true, describes: `Putting ${manifest.name} back to its starting values.` }
    case 'resize':
      return { action, manifest, confirm: false, describes: `Showing ${manifest.name} ${action.size === 'workspace' ? 'full screen' : action.size}.` }
    case 'close':
      return { action, manifest, confirm: false, describes: `Closing ${manifest.name}. Its saved states are kept.` }
    case 'state':
      return { action, manifest, confirm: false, describes: `Reading what ${manifest.name} currently holds.` }
    case 'save':
      if (!manifest.persists) return no('not-allowed', `${manifest.name} has nothing worth saving between runs.`)
      return { action, manifest, confirm: false, describes: `Saving the state of ${manifest.name}.` }
    case 'load':
      if (!manifest.persists) return no('not-allowed', `${manifest.name} does not keep saved states.`)
      // Confirmed: loading replaces what is on screen, which is a thing somebody can lose.
      return { action, manifest, confirm: true, describes: `Loading a saved state into ${manifest.name}.` }
    case 'export': {
      if (!manifest.permissions.includes('file.write')) {
        return no('not-allowed', `${manifest.name} is not allowed to write files, so it cannot export.`)
      }
      return { action, manifest, confirm: false, describes: `Exporting from ${manifest.name} as ${action.format}.` }
    }
    default:
      return no('shape', 'That is not something an app can be asked to do.')
  }
}

/** `simulateProjectile` → "simulate projectile", so a refusal reads as a sentence. */
export function readCapability(capability: string): string {
  return capability
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase()
}

// ---------------------------------------------------------------- results

/**
 * What an action produced, as Orion is told it.
 *
 * Structured on purpose. Orion reasoning about "the simulation says the range is 40.8 m" needs the number and the
 * unit, and handing it a rendered sentence means it has to parse its own output back. Equally important: there is no
 * field here for "probably". An app returns what it computed or it returns a failure.
 */
export interface ActionResult {
  ok: boolean
  /** One sentence, which Orion may repeat. */
  says: string
  /** The instance it concerns, when there is one. */
  instanceId?: string
  /** Named measurements with their units. Never prose. */
  measurements?: readonly { id: string; label: string; value: number | string; unit?: string }[]
  /** Pointers to data this produced, never the data itself. */
  data?: readonly { id: string; kind: string; label: string; rows?: number }[]
  /** Set when state was saved. */
  experimentId?: string
  warnings?: readonly string[]
  /** Present when ok is false. */
  failure?: { error: string; says: string; recovery?: string }
}

export const failure = (error: string, says: string, recovery?: string): ActionResult => ({
  ok: false,
  says,
  failure: { error, says, ...(recovery ? { recovery } : {}) }
})

/**
 * What Orion is told about the apps it may use.
 *
 * Capability ids and one-line summaries, and nothing else. Not the parameters, not the state, not the manifests — a
 * model given five thousand tokens of catalogue spends its attention there instead of on the question. The brief is
 * explicit about this: context is handed over in the amount necessary.
 */
export function offer(registry: Registry, readiness: Readiness, most = 60): readonly { id: string; name: string; can: readonly string[]; summary: string }[] {
  const out: { id: string; name: string; can: readonly string[]; summary: string }[] = []
  for (const held of Object.values(registry.apps)) {
    const manifest = held.manifest
    if (!launchable(manifest, readiness).ok) continue
    out.push({
      id: manifest.id,
      name: manifest.name,
      can: manifest.capabilities.map((one) => one.id),
      summary: manifest.summary
    })
    if (out.length >= most) break
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
