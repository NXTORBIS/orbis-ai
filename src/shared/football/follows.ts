/** What a person follows in Football: kept per Orbis profile, read by the screen and by the background monitor. */
export interface FbFollowedTeam {
  id: string
  name: string
}
export interface FbPin {
  key: string
  title: string
}
export interface FbReminder {
  key: string
  title: string
  /** UTC ISO kick-off at the time the reminder was set. */
  kickoff: string
  /** Minutes before kick-off. */
  minutes: number
}
export interface FbSavedView {
  id: string
  name: string
  tab: 'fixtures' | 'table' | 'teams' | 'analytics'
  league: string
  season: string
}
/** How the person likes the screen: kept with the follows so it is theirs on every profile that sets it. */
export interface FbUi {
  sort: 'live' | 'kickoff' | 'competition'
  status: 'all' | 'live' | 'upcoming' | 'finished'
  compact: boolean
  /** Turns off score highlights and the opening animation (the system's own reduced-motion setting also does). */
  reduceMotion: boolean
  /** An IANA zone, or null for this computer's own. */
  timeZone: string | null
  /** Show the short opening scene when Football opens. */
  intro: boolean
  /** Where the person was, so Football opens there. */
  tab: 'now' | 'fixtures' | 'table' | 'teams' | 'analytics' | 'sources'
  league: string | null
  season: string | null
  recent: { key: string; title: string }[]
}
export interface FbFollows {
  teams: FbFollowedTeam[]
  pins: FbPin[]
  reminders: FbReminder[]
  alerts: { goals: boolean; kickoff: boolean; fulltime: boolean }
  views: FbSavedView[]
  ui: FbUi
}

export const defaultUi = (): FbUi => ({ sort: 'live', status: 'all', compact: false, reduceMotion: false, timeZone: null, intro: true, tab: 'now', league: null, season: null, recent: [] })

export const emptyFollows = (): FbFollows => ({ teams: [], pins: [], reminders: [], alerts: { goals: true, kickoff: true, fulltime: true }, views: [], ui: defaultUi() })

const KEY = /^(openligadb|thesportsdb):\d{1,12}$/
const LEAGUE = /^(openligadb|thesportsdb):[A-Za-z0-9]{1,12}$/
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null)
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])
export const REMINDER_MINUTES = [5, 15, 30, 60] as const

/** Anything read from disk or sent by the window is cleaned here: unknown shapes become empty, never an error. */
export function sanitizeFollows(raw: unknown): FbFollows {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const seen = new Set<string>()
  const once = (k: string): boolean => (seen.has(k) ? false : (seen.add(k), true))
  const teams: FbFollowedTeam[] = []
  for (const t of list(r.teams, 100)) {
    const o = t as Record<string, unknown> | null
    const id = o && typeof o.id === 'string' && KEY.test(o.id) ? o.id : null
    const name = o ? str(o.name, 80) : null
    if (id && name && once(`t:${id}`)) teams.push({ id, name })
  }
  const pins: FbPin[] = []
  for (const p of list(r.pins, 100)) {
    const o = p as Record<string, unknown> | null
    const key = o && typeof o.key === 'string' && KEY.test(o.key) ? o.key : null
    const title = o ? str(o.title, 120) : null
    if (key && title && once(`p:${key}`)) pins.push({ key, title })
  }
  const reminders: FbReminder[] = []
  for (const x of list(r.reminders, 50)) {
    const o = x as Record<string, unknown> | null
    const key = o && typeof o.key === 'string' && KEY.test(o.key) ? o.key : null
    const title = o ? str(o.title, 120) : null
    const kickoff = o && typeof o.kickoff === 'string' && !Number.isNaN(Date.parse(o.kickoff)) ? new Date(o.kickoff).toISOString() : null
    const minutes = o && typeof o.minutes === 'number' && (REMINDER_MINUTES as readonly number[]).includes(o.minutes) ? o.minutes : null
    if (key && title && kickoff && minutes !== null && once(`r:${key}:${minutes}`)) reminders.push({ key, title, kickoff, minutes })
  }
  const a = (r.alerts && typeof r.alerts === 'object' ? r.alerts : {}) as Record<string, unknown>
  const flag = (v: unknown): boolean => (typeof v === 'boolean' ? v : true)
  const views: FbSavedView[] = []
  for (const v of list(r.views, 30)) {
    const o = v as Record<string, unknown> | null
    const id = o ? str(o.id, 40) : null
    const name = o ? str(o.name, 60) : null
    const tab = o && ['fixtures', 'table', 'teams', 'analytics'].includes(String(o.tab)) ? (o.tab as FbSavedView['tab']) : null
    const league = o && typeof o.league === 'string' && LEAGUE.test(o.league) ? o.league : null
    const season = o && typeof o.season === 'string' && /^\d{4}$/.test(o.season) ? o.season : null
    if (id && name && tab && league && season && once(`v:${id}`)) views.push({ id, name, tab, league, season })
  }
  const u = (r.ui && typeof r.ui === 'object' ? r.ui : {}) as Record<string, unknown>
  const d = defaultUi()
  const pick = <T extends string>(v: unknown, ok: readonly T[], dflt: T): T => (typeof v === 'string' && (ok as readonly string[]).includes(v) ? (v as T) : dflt)
  let tz: string | null = null
  if (typeof u.timeZone === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(u.timeZone)) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: u.timeZone })
      tz = u.timeZone
    } catch {
      tz = null
    }
  }
  const recent: { key: string; title: string }[] = []
  for (const x of list(u.recent, 12)) {
    const o = x as Record<string, unknown> | null
    const key = o && typeof o.key === 'string' && KEY.test(o.key) ? o.key : null
    const title = o ? str(o.title, 120) : null
    if (key && title && !recent.some((q) => q.key === key)) recent.push({ key, title })
  }
  const ui: FbUi = {
    sort: pick(u.sort, ['live', 'kickoff', 'competition'] as const, d.sort),
    status: pick(u.status, ['all', 'live', 'upcoming', 'finished'] as const, d.status),
    compact: u.compact === true,
    reduceMotion: u.reduceMotion === true,
    timeZone: tz,
    intro: typeof u.intro === 'boolean' ? u.intro : true,
    tab: pick(u.tab, ['now', 'fixtures', 'table', 'teams', 'analytics', 'sources'] as const, d.tab),
    league: typeof u.league === 'string' && LEAGUE.test(u.league) ? u.league : null,
    season: typeof u.season === 'string' && /^\d{4}$/.test(u.season) ? u.season : null,
    recent
  }
  return { teams, pins, reminders, alerts: { goals: flag(a.goals), kickoff: flag(a.kickoff), fulltime: flag(a.fulltime) }, views, ui }
}
