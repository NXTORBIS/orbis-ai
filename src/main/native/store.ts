import { join } from 'node:path'
import { dataDirFor, DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { Collection, JsonFile } from '../personal/store.ts'
import { FORMAT, type SavedInstance } from '../../shared/native/state.ts'

/**
 * What Orbis keeps about Native Apps.
 *
 * ## All of it belongs to a profile
 *
 * Unlike courses — which are content and shared — everything here is somebody's: which apps they have used, what their
 * open laboratories hold, which saved states exist. So every file sits under the profile's own directory and
 * `useProfile` moves them together. Nothing in this store is shared between profiles, and a saved simulation from one
 * profile is not merely hidden in another: it is in a different file that is never opened.
 *
 * ## Unreadable is never treated as missing
 *
 * `JsonFile` already refuses to write over a file it could not read, which is the behaviour this store needs and the
 * reason it is used rather than a fresh writer. A saved laboratory that cannot be parsed stays on disk until it can be,
 * instead of being replaced by an empty one on the next autosave.
 *
 * ## Two files, because they are read at different times
 *
 * ```
 * instances.json   the open laboratories — read at startup, written whenever one changes
 * recent.json      which apps were used and when — tiny, read by Search Labs on every keystroke
 * ```
 *
 * Keeping recency in the same file as the state would mean reading every open laboratory's parameters to render a
 * dropdown.
 */

/** Enough for a great many conversations; beyond this the oldest closed ones are swept by the service. */
export const MOST_SAVED = 400
/** How many apps the "recently used" list remembers. A dropdown, not a history. */
export const MOST_RECENT = 24

const nativeDir = (userData: string, profileId: string): string => join(userData, dataDirFor(profileId), 'native')

const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const text = (value: unknown, most = 200): string => (typeof value === 'string' ? value.slice(0, most) : '')

// ---------------------------------------------------------------- what is stored

/** A saved instance with an id, so it can live in a `Collection`. */
export interface StoredInstance extends SavedInstance {
  id: string
}

/**
 * A saved record read off disk.
 *
 * Deliberately permissive about *shape* and strict about *identity*: a record with no app or no instance id is dropped
 * because nothing could ever be done with it, and everything else is left for `state.read` to judge against the app's
 * current manifest. That split matters — this layer cannot know whether `appVersion: 3` is from the future, and
 * guessing here would mean deciding a record was damaged without the manifest in front of it.
 */
export function normalizeInstance(raw: unknown): StoredInstance | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const appId = text(one.appId, 64)
  const instanceId = text(one.instanceId, 64)
  if (!appId || !instanceId) return null

  const parameters = one.parameters && typeof one.parameters === 'object' && !Array.isArray(one.parameters) ? (one.parameters as Record<string, never>) : {}
  const domain = one.domain && typeof one.domain === 'object' && !Array.isArray(one.domain) ? (one.domain as Record<string, unknown>) : {}

  return {
    id: instanceId,
    format: num(one.format, FORMAT),
    appId,
    appVersion: num(one.appVersion, 1),
    instanceId,
    conversationId: typeof one.conversationId === 'string' ? one.conversationId.slice(0, 64) : null,
    messageId: typeof one.messageId === 'string' ? one.messageId.slice(0, 64) : null,
    parameters,
    domain,
    size: text(one.size, 20) || 'expanded',
    phase: one.phase === 'closed' ? 'closed' : 'ready',
    experimentId: typeof one.experimentId === 'string' ? one.experimentId.slice(0, 64) : null,
    openedAt: num(one.openedAt),
    savedAt: num(one.savedAt),
    engine: typeof one.engine === 'string' ? one.engine.slice(0, 40) : null
  }
}

export interface Recent {
  /** The app id. Also the record's id, since an app appears once. */
  id: string
  at: number
  /** How many times it has been opened in this profile. Ranks a habitual tool above one opened once. */
  opened: number
}

function normalizeRecent(raw: unknown): Recent | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const id = text(one.id, 64)
  if (!id) return null
  return { id, at: num(one.at), opened: Math.max(1, Math.round(num(one.opened, 1))) }
}

// ---------------------------------------------------------------- the store

export class NativeStore {
  private readonly userData: string
  private profileId = DEFAULT_PROFILE_ID

  private readonly instances: Collection<StoredInstance>
  private readonly recent: Collection<Recent>
  /** Which capabilities the user has switched off, if any. Separate because it is settings, not state. */
  private readonly disabled: JsonFile<string[]>

  constructor(userData: string) {
    this.userData = userData
    const where = nativeDir(userData, this.profileId)
    this.instances = new Collection<StoredInstance>(join(where, 'instances.json'), normalizeInstance, MOST_SAVED)
    this.recent = new Collection<Recent>(join(where, 'recent.json'), normalizeRecent, MOST_RECENT)
    this.disabled = new JsonFile<string[]>(
      join(where, 'disabled.json'),
      () => [],
      (raw) => (Array.isArray(raw) ? raw.filter((one): one is string => typeof one === 'string').slice(0, 200) : [])
    )
  }

  /**
   * Moves every file to another profile's directory.
   *
   * All three move together and `usePath` flushes what is pending to the file it came from first, so a parameter change
   * queued a moment before a profile switch lands in the profile it was made in.
   */
  async useProfile(profileId: string): Promise<void> {
    if (profileId === this.profileId) return
    this.profileId = profileId
    const where = nativeDir(this.userData, profileId)
    await Promise.all([
      this.instances.usePath(join(where, 'instances.json')),
      this.recent.usePath(join(where, 'recent.json')),
      this.disabled.usePath(join(where, 'disabled.json'))
    ])
  }

  get profile(): string {
    return this.profileId
  }

  // ---------------------------------------------------------------- instances

  all(): Promise<StoredInstance[]> {
    return this.instances.all()
  }

  async saved(instanceId: string): Promise<StoredInstance | null> {
    return this.instances.get(instanceId)
  }

  async forConversation(conversationId: string): Promise<StoredInstance[]> {
    return (await this.all()).filter((one) => one.conversationId === conversationId)
  }

  async save(record: SavedInstance): Promise<StoredInstance> {
    return this.instances.put({ ...record, id: record.instanceId })
  }

  async forget(instanceId: string): Promise<boolean> {
    return this.instances.remove(instanceId)
  }

  /**
   * Old closed records dropped, oldest first.
   *
   * Anything saved as an experiment is kept whatever its age: the experiment is the user's, and the record is how a
   * conversation finds it again. Sweeping it would turn a card in an old conversation into "this is gone".
   */
  async sweep(keep = 120): Promise<number> {
    const before = (await this.all()).length
    const after = await this.instances.update((items) => {
      const closed = items.filter((one) => one.phase === 'closed' && one.experimentId === null).sort((a, b) => b.savedAt - a.savedAt)
      if (closed.length <= keep) return items
      const drop = new Set(closed.slice(keep).map((one) => one.id))
      return items.filter((one) => !drop.has(one.id))
    })
    return before - after.length
  }

  // ---------------------------------------------------------------- recency

  async recentApps(): Promise<Recent[]> {
    return (await this.recent.all()).sort((a, b) => b.at - a.at)
  }

  /** An app noted as used. Profile-local, and never sent anywhere. */
  async noteUse(appId: string, now: number): Promise<void> {
    await this.recent.update((items) => {
      const held = items.find((one) => one.id === appId)
      const next = held ? items.map((one) => (one.id === appId ? { ...one, at: now, opened: one.opened + 1 } : one)) : [...items, { id: appId, at: now, opened: 1 }]
      return next.sort((a, b) => b.at - a.at).slice(0, MOST_RECENT)
    })
  }

  async clearRecent(): Promise<void> {
    await this.recent.update(() => [])
  }

  // ---------------------------------------------------------------- settings

  async disabledCapabilities(): Promise<string[]> {
    return this.disabled.read()
  }

  async setCapabilityEnabled(capability: string, enabled: boolean): Promise<string[]> {
    const held = await this.disabled.read()
    const next = enabled ? held.filter((one) => one !== capability) : held.includes(capability) ? held : [...held, capability]
    await this.disabled.write(next)
    return next
  }

  // ---------------------------------------------------------------- shutdown

  async flush(): Promise<void> {
    await Promise.all([this.instances.flush(), this.recent.flush(), this.disabled.flush()])
  }
}
