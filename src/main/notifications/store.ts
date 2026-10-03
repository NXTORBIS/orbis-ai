import { JsonFile } from '../personal/store.ts'
import { prune, type OrbisNotification, type NotificationPriority, type NotificationStatus } from '../../shared/notifications.ts'
import { HISTORY_LIMIT, type NotificationStore } from './manager.ts'

/**
 * Where the notification history is kept: one file per profile, beside that profile's other things.
 *
 * It uses the same writer everything else in Orbis uses -- debounced, written to a temporary file and renamed into
 * place, and with the path taken at the moment of writing so a save queued just before a profile switch lands in the
 * profile it came from rather than the one that is now in front.
 *
 * Everything read back is checked, field by field. A notification is a record of something that happened, and a
 * damaged record is worth nothing, so one that does not read is dropped rather than repaired into something that
 * might say the wrong thing. A file that will not parse at all costs the history and nothing else; Orbis starts.
 */

export const NOTIFICATIONS_SCHEMA_VERSION = 1

interface Saved {
  v: number
  items: OrbisNotification[]
}

const PRIORITIES = new Set<NotificationPriority>(['critical', 'high', 'normal', 'low'])
const STATUSES = new Set<NotificationStatus>(['queued', 'held', 'delivered', 'actioned', 'dismissed', 'expired', 'failed', 'suppressed'])

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

/** One notification, or null if it is not one. Nothing here guesses at a missing field. */
function readOne(raw: unknown): OrbisNotification | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = str(o.id, 60)
  const event = str(o.event, 80)
  const profileId = str(o.profileId, 80)
  const title = str(o.title, 200)
  if (id === '' || event === '' || profileId === '' || title === '') return null
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null

  const actions = Array.isArray(o.actions)
    ? o.actions
        .slice(0, 2)
        .map((a) => (a && typeof a === 'object' ? { id: str((a as Record<string, unknown>).id, 40), label: str((a as Record<string, unknown>).label, 40) } : { id: '', label: '' }))
        .filter((a) => a.id !== '' && a.label !== '')
    : []

  const subject = o.subject && typeof o.subject === 'object' ? Object.fromEntries(Object.entries(o.subject as Record<string, unknown>).slice(0, 12).map(([k, v]) => [str(k, 40), str(v, 300)])) : {}

  return Object.freeze({
    id,
    event,
    profileId,
    source: str(o.source, 40) as OrbisNotification['source'],
    category: str(o.category, 40) as OrbisNotification['category'],
    priority: PRIORITIES.has(o.priority as NotificationPriority) ? (o.priority as NotificationPriority) : 'normal',
    at: o.at,
    title,
    body: str(o.body, 400),
    subject: Object.freeze(subject),
    actions: Object.freeze(actions),
    dedupe: str(o.dedupe, 300),
    group: str(o.group, 120),
    expiresAt: typeof o.expiresAt === 'number' && Number.isFinite(o.expiresAt) ? o.expiresAt : null,
    sensitive: o.sensitive === true,
    status: STATUSES.has(o.status as NotificationStatus) ? (o.status as NotificationStatus) : 'delivered',
    read: o.read === true
  })
}

function readAll(raw: unknown): Saved {
  if (!raw || typeof raw !== 'object') return { v: NOTIFICATIONS_SCHEMA_VERSION, items: [] }
  const o = raw as Record<string, unknown>
  const items = Array.isArray(o.items) ? o.items : []
  return {
    v: NOTIFICATIONS_SCHEMA_VERSION,
    // A damaged entry is dropped and the rest are kept: one bad record must not cost the whole history.
    items: items.slice(0, HISTORY_LIMIT * 2).map(readOne).filter((one): one is OrbisNotification => one !== null)
  }
}

/** The history on disk, one file per profile. `pathFor` says where a given profile's lives. */
export class FileNotificationStore implements NotificationStore {
  private readonly files = new Map<string, JsonFile<Saved>>()
  private readonly pathFor: (profileId: string) => string

  constructor(pathFor: (profileId: string) => string) {
    this.pathFor = pathFor
  }

  private file(profileId: string): JsonFile<Saved> {
    let found = this.files.get(profileId)
    if (!found) {
      found = new JsonFile<Saved>(this.pathFor(profileId), () => ({ v: NOTIFICATIONS_SCHEMA_VERSION, items: [] }), readAll)
      this.files.set(profileId, found)
    }
    return found
  }

  async read(profileId: string): Promise<OrbisNotification[]> {
    const saved = await this.file(profileId).read()
    return prune(saved.items, HISTORY_LIMIT) as OrbisNotification[]
  }

  async write(profileId: string, history: readonly OrbisNotification[]): Promise<void> {
    await this.file(profileId).write({ v: NOTIFICATIONS_SCHEMA_VERSION, items: [...history] })
  }

  /** Writes everything still pending. Called before quitting, so the last thing that happened is not lost. */
  async flush(): Promise<void> {
    await Promise.all([...this.files.values()].map((file) => file.flush()))
  }
}
