import { app, net } from 'electron'
import type { BrowserWindow } from 'electron'
import { plainHandle } from '../ipc/handle.ts'
import type { SocketLike } from './live/signalr.ts'
import { join } from 'node:path'
import { dataDirFor } from '../../shared/profiles.ts'
import { sanitizePrefs } from '../../shared/f1/extras.ts'
import { F1Monitor, PrefsStore } from './monitor.ts'
import { StreamService, type StreamEvent } from './live/stream.ts'
import { F1Service, type FetchLike } from './service.ts'

/**
 * Orbis Arena -> F1: the window's way to ask for F1 data. All the rules live in service.ts and live/stream.ts; this
 * only checks what the window sent and answers with what they said.
 */

export interface F1IpcOptions {
  getWindow(): BrowserWindow | null
  userData: string
  profileId(): string
  /** Orbis's one notification place. */
  publish(e: { type: string; fields: Record<string, string> }): void
}

const LIVE_BASE = 'https://livetiming.formula1.com/signalrcore'
const ARCHIVE_BASE = 'https://livetiming.formula1.com/static/'
const invalid = { ok: false, reason: 'invalid-request', message: 'That request was not understood.' } as const

/** A season is a year, or the word the providers use for "this one". Anything else from the window is refused. */
const season = (v: unknown): number | 'current' | null => (v === 'current' ? 'current' : typeof v === 'number' && Number.isInteger(v) ? v : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)

export function registerF1Ipc(o: F1IpcOptions): { service: F1Service; stream: StreamService } {
  const handle = plainHandle(o)
  const service = new F1Service({ fetch: ((url, init) => net.fetch(url, init)) as FetchLike })

  const prefs = new PrefsStore(async () => join(o.userData, dataDirFor(o.profileId()), 'f1-prefs.json'))
  const monitor = new F1Monitor({ service, prefs: () => prefs.read(), publish: (e) => o.publish(e) })
  let busy = false
  const timer = setInterval(() => {
    if (busy) return
    busy = true
    monitor
      .tick()
      .catch(() => undefined)
      .finally(() => (busy = false))
  }, 5 * 60_000)
  timer.unref()
  // First look a little after start, so a result that is already out is remembered as seen, not announced.
  setTimeout(() => void monitor.tick().catch(() => undefined), 20_000).unref()

  const stream = new StreamService({
    clientOptions: {
      negotiate: async () => {
        const res = await net.fetch(`${LIVE_BASE}/negotiate?negotiateVersion=1`, { method: 'POST', headers: { 'User-Agent': 'BestHTTP', 'Accept-Encoding': 'gzip,identity' } })
        // Node's own fetch exposes Set-Cookie lines; Electron's may fold them, so read both ways.
        const h = res.headers as unknown as { getSetCookie?: () => string[]; get(n: string): string | null }
        const lines = h.getSetCookie?.() ?? (h.get('set-cookie') ? [h.get('set-cookie') as string] : [])
        const cookies = lines.map((c) => c.split(';')[0]).join('; ')
        let body: { connectionToken?: string; connectionId?: string } | null = null
        try {
          body = (await res.json()) as typeof body
        } catch {
          body = null
        }
        return { ok: res.ok, status: res.status, cookies, body }
      },
      socketUrl: (token) => `${LIVE_BASE.replace('https', 'wss')}?id=${encodeURIComponent(token)}`,
      // The platform WebSocket, which takes request headers as a second argument.
      socket: (url, init) => new (WebSocket as unknown as new (u: string, o: { headers: Record<string, string> }) => SocketLike)(url, init)
    },
    fetchText: async (url) => {
      if (!url.startsWith(ARCHIVE_BASE)) throw new Error('Not an archive address.')
      const res = await net.fetch(url, { headers: { 'Accept-Encoding': 'gzip,identity' } })
      if (!res.ok) throw new Error(`${res.status}`)
      return res.text()
    },
    archiveBase: ARCHIVE_BASE,
    emit: (e: StreamEvent) => {
      const w = o.getWindow()
      if (w && !w.isDestroyed()) w.webContents.send('f1:stream', e)
    }
  })

  handle('f1:schedule', (_e, s: unknown) => {
    const y = season(s)
    return y === null ? invalid : service.schedule(y)
  })
  handle('f1:results', (_e, s: unknown, round: unknown) => {
    const y = season(s)
    const r = round === 'last' ? 'last' : int(round)
    return y === null || r === null ? invalid : service.results(y, r)
  })
  handle('f1:standings', async (_e, s: unknown, round: unknown) => {
    const y = season(s)
    if (y === null) return invalid
    const r = int(round) ?? undefined
    const [drivers, constructors] = await Promise.all([service.driverStandings(y, r), service.constructorStandings(y, r)])
    return { drivers, constructors }
  })
  handle('f1:sessions', (_e, year: unknown) => (int(year) !== null ? service.sessions(year as number) : invalid))
  handle('f1:timing', (_e, key: unknown, endsAt: unknown) => (int(key) !== null ? service.timing(key as number, typeof endsAt === 'string' ? endsAt : null) : invalid))
  handle('f1:bundle', (_e, key: unknown, endsAt: unknown) => (int(key) !== null ? service.sessionBundle(key as number, typeof endsAt === 'string' ? endsAt : null) : invalid))
  handle('f1:intervals', (_e, key: unknown, endsAt: unknown) => (int(key) !== null ? service.intervals(key as number, typeof endsAt === 'string' ? endsAt : null) : invalid))
  handle('f1:telemetry', (_e, key: unknown, driver: unknown, from: unknown, to: unknown) => {
    const k = int(key)
    const d = int(driver)
    return k === null || d === null || typeof from !== 'string' || typeof to !== 'string' ? invalid : service.telemetry(k, d, from, to)
  })
  handle('f1:season-data', (_e, s: unknown) => (int(s) !== null ? service.seasonData(s as number) : invalid))
  handle('f1:prefs', async () => ({ ok: true, data: await prefs.read() }))
  handle('f1:prefs-set', async (_e, next: unknown) => ({ ok: true, data: await prefs.update(() => sanitizePrefs(next)) }))
  handle('f1:champions', (_e, s: unknown) => (s === undefined || s === null ? service.championsAll() : int(s) !== null ? service.seasonChampions(s as number) : invalid))
  handle('f1:circuit-records', (_e, id: unknown) => (typeof id === 'string' ? service.circuitRecords(id) : invalid))
  handle('f1:qualifying', (_e, s: unknown, r: unknown) => (int(s) !== null && int(r) !== null ? service.qualifying(s as number, r as number) : invalid))
  handle('f1:constructor-season', (_e, s: unknown, id: unknown) => (int(s) !== null && typeof id === 'string' ? service.constructorSeason(s as number, id) : invalid))
  handle('f1:team-radio', (_e, key: unknown) => (int(key) !== null ? service.teamRadio(key as number) : invalid))
  handle('f1:forecast', (_e, lat: unknown, long: unknown, at: unknown) => (typeof lat === 'number' && typeof long === 'number' && typeof at === 'string' && at.length < 40 ? service.forecast(lat, long, at) : invalid))
  handle('f1:career', (_e, id: unknown) => (typeof id === 'string' ? service.career(id) : invalid))
  handle('f1:championship', (_e, key: unknown) => (int(key) !== null ? service.championship(key as number) : invalid))
  handle('f1:archive', (_e, year: unknown) => (int(year) !== null ? service.archive(year as number) : invalid))
  handle('f1:status', () => ({ providers: service.status() }))

  // ---- live and replay ---------------------------------------------------------------------------------------------------------
  handle('f1:stream-live', () => {
    stream.startLive()
    return stream.status()
  })
  handle('f1:stream-replay', (_e, path: unknown) => (typeof path === 'string' ? stream.loadReplay(path) : { ok: false, message: 'That session path is not valid.' }))
  handle('f1:stream-control', (_e, action: unknown, value: unknown) => {
    if (action === 'play' || action === 'pause' || action === 'seek' || action === 'speed') stream.replayControl(action, typeof value === 'number' ? value : undefined)
    return stream.status()
  })
  handle('f1:stream-stop', () => {
    stream.stopAll()
    return stream.status()
  })
  handle('f1:stream-state', () => stream.event())

  app.on('before-quit', () => stream.stopAll())
  return { service, stream }
}
