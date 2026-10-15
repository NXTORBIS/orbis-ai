import { net } from 'electron'
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { dataDirFor } from '../../shared/profiles.ts'
import { sanitizeFollows } from '../../shared/football/follows.ts'
import { plainHandle } from '../ipc/handle.ts'
import { FollowsStore } from './follows.ts'
import { FootballMonitor } from './monitor.ts'
import { FootballService, type FetchLike } from './service.ts'

/**
 * Orbis Arena -> Football: the window's way to ask for football data. The rules are in service.ts; this only checks what
 * the window sent and answers with what the service said. It also keeps what a person follows (one file per profile)
 * and runs the monitor that turns changes in those matches into Orbis notifications.
 */
export interface FootballIpcOptions {
  getWindow(): BrowserWindow | null
  userData: string
  profileId(): string
  /** Orbis's one notification place. */
  publish(e: { type: string; fields: Record<string, string> }): void
}

const invalid = { ok: false, reason: 'invalid-request', message: 'That request was not understood.' } as const
const text = (v: unknown, max = 64): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)
const POLL_MS = 60_000

export function registerFootballIpc(o: FootballIpcOptions): FootballService {
  const handle = plainHandle(o)
  const service = new FootballService({ fetch: ((url, init) => net.fetch(url, init)) as FetchLike })
  const follows = new FollowsStore(async () => join(o.userData, dataDirFor(o.profileId()), 'football-follows.json'))
  const monitor = new FootballMonitor({
    service,
    follows: () => follows.read(),
    publish: (e) => o.publish(e),
    reminderDone: async (key, minutes) => {
      await follows.update((f) => ({ ...f, reminders: f.reminders.filter((r) => !(r.key === key && r.minutes === minutes)) }))
    }
  })
  let busy = false
  const timer = setInterval(() => {
    if (busy) return
    busy = true
    monitor
      .tick()
      .catch(() => undefined)
      .finally(() => (busy = false))
  }, POLL_MS)
  timer.unref()

  handle('football:leagues', () => ({ ok: true, data: service.leagues() }))
  handle('football:live', () => service.live())
  handle('football:season', (_e, league: unknown, season: unknown) => {
    const l = text(league)
    const s = text(season, 4)
    return l && s ? service.season(l, s) : invalid
  })
  handle('football:table', (_e, league: unknown, season: unknown) => {
    const l = text(league)
    const s = text(season, 4)
    return l && s ? service.table(l, s) : invalid
  })
  handle('football:match', (_e, key: unknown) => {
    const k = text(key, 40)
    return k ? service.match(k) : invalid
  })
  handle('football:extras', (_e, key: unknown) => {
    const k = text(key, 40)
    return k ? service.extras(k) : invalid
  })
  handle('football:team', (_e, key: unknown) => {
    const k = text(key, 40)
    return k ? service.team(k) : invalid
  })
  handle('football:status', () => ({ ok: true, data: service.status() }))
  handle('football:follows', async () => ({ ok: true, data: await follows.read() }))
  handle('football:follows-set', async (_e, next: unknown) => ({ ok: true, data: await follows.update(() => sanitizeFollows(next)) }))
  return service
}
