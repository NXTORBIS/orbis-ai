import { check, isParameterProblem, type ParameterSet, type ParameterValue } from './parameters.ts'
import type { Instance, Phase } from './instances.ts'
import type { NativeAppManifest } from './manifest.ts'

/**
 * Saving an instance, reading one back, and what happens when the two were written by different versions of Orbis.
 *
 * ## Unreadable is not missing
 *
 * The rule that runs through all of this, and the one the rest of Orbis learned the hard way: a saved state that
 * cannot be read still *exists*. Returning a fresh empty one and carrying on means the next save writes over
 * somebody's work, and nothing ever says so. So `read` has three outcomes and not two:
 *
 * ```
 * ok         understood, possibly after migration
 * absent     there was nothing saved        → start fresh, which is normal
 * damaged    something is there and cannot be read   → stop, keep the file, say so
 * ```
 *
 * Nothing here converts the third into the second.
 *
 * ## Two versions, and they are not the same number
 *
 * ```
 * FORMAT     the shape of the saved record, bumped when this file's structure changes
 * appVersion the app's own version, bumped by whoever changes the app
 * ```
 *
 * Confusing them means a state saved by a future Orbis half-loads in this one. Both are written and both are checked.
 *
 * ## A migration may refuse
 *
 * An app that cannot sensibly convert an old state says so and the state is kept untouched. Scientifically that is the
 * only honest option: silently reinterpreting numbers from an older engine produces results that look current and are
 * not attributable to anything.
 *
 * Pure. `now` is passed in.
 */

/** The shape of the saved record. Bumped when this file changes, never when an app changes. */
export const FORMAT = 1

export interface SavedInstance {
  /** The record format, not the app's version. */
  format: number
  appId: string
  appVersion: number
  instanceId: string
  conversationId: string | null
  messageId: string | null
  /** Values only. The parameter definitions come from the app, which is the thing that owns them. */
  parameters: Readonly<Record<string, ParameterValue>>
  domain: Readonly<Record<string, unknown>>
  size: string
  /** The phase it was in, narrowed on read: nothing is ever restored as running. */
  phase: Phase
  experimentId: string | null
  openedAt: number
  savedAt: number
  /** The engine that produced this state, for reproducibility. Null when the app has none. */
  engine: string | null
}

export type ReadResult =
  | { state: 'ok'; saved: SavedInstance; migrated: boolean; note?: string }
  | { state: 'absent' }
  | { state: 'damaged'; says: string; recovery: string; keep: true }

const damaged = (says: string, recovery: string): ReadResult => ({ state: 'damaged', says, recovery, keep: true })

// ---------------------------------------------------------------- writing

/**
 * An instance as a saved record.
 *
 * Only the parameter *values* are written. Writing the definitions too would mean a saved state could contradict the
 * app about what its own parameters are — including their ranges — and the app would then be validating against rules
 * from a previous version of itself.
 */
export function write(instance: Instance, manifest: NativeAppManifest, now: number): SavedInstance {
  const parameters: Record<string, ParameterValue> = {}
  for (const [id, one] of Object.entries(instance.parameters)) parameters[id] = one.value

  return {
    format: FORMAT,
    appId: instance.appId,
    appVersion: instance.appVersion,
    instanceId: instance.id,
    conversationId: instance.conversationId,
    messageId: instance.messageId,
    parameters,
    domain: instance.domain,
    size: instance.size,
    // A closed instance is recorded closed; everything else is recorded ready, because nothing is restored mid-run.
    phase: instance.phase === 'closed' ? 'closed' : 'ready',
    experimentId: instance.experimentId,
    openedAt: instance.openedAt,
    savedAt: now,
    engine: manifest.engine
  }
}

// ---------------------------------------------------------------- reading

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * How an app converts its own older state. Declared by the app, never guessed at here.
 *
 * Returning null is a legitimate answer and means "this cannot be carried forward honestly". The state is then kept
 * and reported, not replaced.
 */
export type Migration = (saved: SavedInstance, from: number) => SavedInstance | null

/**
 * A saved record read back.
 *
 * Every field is checked rather than trusted — a saved file can be edited by hand, copied between profiles, or written
 * by a different build — and anything that does not add up is `damaged` rather than repaired.
 */
export function read(raw: unknown, manifest: NativeAppManifest, migrate?: Migration): ReadResult {
  if (raw === null || raw === undefined) return { state: 'absent' }
  if (!isObject(raw)) return damaged('The saved state is not in a shape Orbis recognises.', 'The file has been kept. Nothing has been changed.')

  const format = raw.format
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    return damaged('The saved state does not say which format it is in.', 'The file has been kept. Nothing has been changed.')
  }
  if (format > FORMAT) {
    return damaged(
      `That state was saved by a newer version of Orbis (format ${format}; this one reads ${FORMAT}).`,
      'Update Orbis to open it. The file has been kept exactly as it is.'
    )
  }

  if (raw.appId !== manifest.id) {
    return damaged(
      `That state belongs to a different app (${String(raw.appId)}), not ${manifest.name}.`,
      'Nothing has been changed. Open it from the app it belongs to.'
    )
  }

  const appVersion = typeof raw.appVersion === 'number' ? raw.appVersion : null
  if (appVersion === null) return damaged('The saved state does not say which version of the app wrote it.', 'The file has been kept.')
  if (appVersion > manifest.version) {
    return damaged(
      `That state was saved by a newer ${manifest.name} (version ${appVersion}; this one is ${manifest.version}).`,
      'Update Orbis to open it. The file has been kept exactly as it is.'
    )
  }

  const parameters = isObject(raw.parameters) ? raw.parameters : null
  if (parameters === null) return damaged('The saved state has no parameters in it.', 'The file has been kept.')

  let saved: SavedInstance = {
    format,
    appId: manifest.id,
    appVersion,
    instanceId: typeof raw.instanceId === 'string' ? raw.instanceId : '',
    conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : null,
    messageId: typeof raw.messageId === 'string' ? raw.messageId : null,
    parameters: parameters as Readonly<Record<string, ParameterValue>>,
    domain: isObject(raw.domain) ? raw.domain : {},
    size: typeof raw.size === 'string' ? raw.size : manifest.opensAt,
    phase: raw.phase === 'closed' ? 'closed' : 'ready',
    experimentId: typeof raw.experimentId === 'string' ? raw.experimentId : null,
    openedAt: typeof raw.openedAt === 'number' ? raw.openedAt : 0,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
    engine: typeof raw.engine === 'string' ? raw.engine : null
  }

  if (!saved.instanceId) return damaged('The saved state has no instance id.', 'The file has been kept.')

  let migrated = false
  let note: string | undefined

  if (appVersion < manifest.version) {
    if (!migrate) {
      return damaged(
        `That state was saved by ${manifest.name} version ${appVersion}, and version ${manifest.version} has no way to convert it.`,
        'The file has been kept. Its numbers were produced by a different version of the app and cannot be carried forward.'
      )
    }
    const moved = migrate(saved, appVersion)
    if (moved === null) {
      return damaged(
        `${manifest.name} cannot convert a state saved by version ${appVersion} without changing what it means.`,
        'The file has been kept exactly as it is. Nothing has been reinterpreted.'
      )
    }
    saved = { ...moved, appVersion: manifest.version }
    migrated = true
    note = `Carried forward from version ${appVersion}.`
  }

  // The engine that produced the state is recorded against the one that would read it. A mismatch is not fatal, but it
  // is said: a result attributed to the wrong engine is not reproducible, which is the point of recording it.
  if (saved.engine !== null && manifest.engine !== null && saved.engine !== manifest.engine) {
    note = `${note ? `${note} ` : ''}It was computed by the ${saved.engine} engine; this build uses ${manifest.engine}.`
  }

  return { state: 'ok', saved, migrated, ...(note ? { note } : {}) }
}

// ---------------------------------------------------------------- restoring

export interface Restored {
  instance: Instance
  /** Parameters in the file that this version of the app no longer has. Reported, never silently dropped. */
  unknown: readonly string[]
  /** Parameters whose saved value the app now refuses, with why. The starting value is used instead. */
  rejected: readonly { id: string; says: string }[]
}

/**
 * A saved record turned back into an instance against the app's current parameter definitions.
 *
 * Two kinds of mismatch are possible and both are reported rather than hidden:
 *
 * - a saved parameter the app no longer has — kept out, and named, because its absence changes what the state means;
 * - a saved value the app would now refuse, e.g. a range that has since tightened — the starting value is used and the
 *   refusal is named.
 *
 * Reporting matters more than it sounds. A restored simulation quietly running one starting value instead of the saved
 * one is a simulation whose results nobody can attribute.
 */
export function restore(saved: SavedInstance, manifest: NativeAppManifest, parameters: ParameterSet, now: number): Restored {
  const unknown: string[] = []
  const rejected: { id: string; says: string }[] = []
  const out: Record<string, (typeof parameters)[string]> = {}

  for (const [id, declared] of Object.entries(parameters)) {
    const held = saved.parameters[id]
    if (held === undefined) {
      out[id] = { ...declared, value: declared.initial }
      continue
    }
    const bad = check(declared, held)
    if (bad !== null) {
      rejected.push({ id, says: `${bad.says} ${bad.fix}` })
      out[id] = { ...declared, value: declared.initial }
      continue
    }
    out[id] = { ...declared, value: held }
  }

  for (const id of Object.keys(saved.parameters)) if (!parameters[id]) unknown.push(id)

  const instance: Instance = {
    id: saved.instanceId,
    appId: manifest.id,
    appVersion: manifest.version,
    conversationId: saved.conversationId,
    messageId: saved.messageId,
    // Restored as loading, never as running: resuming an expensive computation nobody asked to resume is the one
    // restore behaviour that costs somebody a core on startup.
    phase: 'loading',
    generation: 1,
    parameters: Object.freeze(out),
    domain: Object.freeze({ ...saved.domain }),
    size: saved.size === 'compact' || saved.size === 'expanded' || saved.size === 'workspace' ? saved.size : manifest.opensAt,
    onScreen: false,
    failure: null,
    openedAt: saved.openedAt || now,
    touchedAt: now,
    closedAt: null,
    experimentId: saved.experimentId
  }

  return { instance, unknown, rejected }
}

/** Said in one sentence, so the host can report a restore honestly rather than silently. */
export function describeRestore(restored: Restored): string | null {
  const parts: string[] = []
  if (restored.rejected.length > 0) {
    parts.push(
      restored.rejected.length === 1
                ? `${restored.rejected[0].id} could not be restored (${restored.rejected[0].says}) and is back at its starting value`
        : `${restored.rejected.length} values could not be restored and are back at their starting values`
    )
  }
  if (restored.unknown.length > 0) {
    parts.push(`${restored.unknown.length === 1 ? 'one setting' : `${restored.unknown.length} settings`} in the saved state no longer exists`)
  }
  if (parts.length === 0) return null
  return `${parts.join('; ')}.`
}

export { isParameterProblem }
