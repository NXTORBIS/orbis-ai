import { join } from 'node:path'
import { dataDirFor, DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { Collection, JsonFile } from '../personal/store.ts'
import { expired, type Activity, type ActivityKind, type ActivitySource, type Sensitivity } from '../../shared/ambient/activity.ts'
import { newHistory, type SuggestionHistory } from '../../shared/ambient/suggest.ts'

/**
 * What Ambient Intelligence remembers, and for how long.
 *
 * ## Kept with the profile, like everything else
 *
 * One person's activity is never another's. Switching profile swaps every file here, and nothing is carried over
 * in memory — the caches are dropped rather than reused, because a cache that survives a profile switch is a leak
 * with a performance justification.
 *
 * ## Three files with three different lifetimes
 *
 * **Activity** is the raw record and the shortest-lived: thirty days for ordinary pages, seven for anything
 * personal, and it is swept on every start. **Sessions** are what was made of it — a title, a subject, some
 * counts — and they outlive the rows they came from, which is how "what did I do last month" survives a sweep.
 * **Preferences** hold what somebody has turned off and how suggestions have gone, and are kept until cleared.
 *
 * ## Nothing in here is content
 *
 * Titles, addresses and counts. No page text, no note bodies, no field values. The things that hold content have
 * their own stores and their own rules; this points at them.
 */

export const MAX_ACTIVITY = 20_000
export const MAX_SESSIONS = 2_000

/** What a stretch of work looked like, kept after the activity behind it has been swept away. */
export interface SessionMemory {
  id: string
  profileId: string
  title: string
  subject: string | null
  concept: string | null
  intent: string
  startedAt: number
  endedAt: number
  seconds: number
  /** How many things were involved. Counts only. */
  things: number
  /** Where to pick it up: the addresses, in the order they were opened. */
  places: string[]
  /** Set when somebody said this was wrong, so nothing offers it again. */
  rejected: boolean
}

export interface AmbientSettings {
  /** The whole feature. Off means nothing is recorded and nothing is inferred. */
  enabled: boolean
  /** Temporarily stopped, without forgetting anything. */
  paused: boolean
  suggestions: boolean
  /** Whether the chip appears at all. */
  showContext: boolean
  continueWhereLeftOff: boolean
  smartTabs: boolean
  relatedFiles: boolean
  /** Whether what Orbis worked out is offered to Orion with a request. */
  contextForOrion: boolean
  sessionMemory: boolean
  contextAwareMusic: boolean
  /** How many days of raw activity to keep. Sessions outlive it. */
  keepDays: number
}

export const DEFAULT_AMBIENT_SETTINGS: AmbientSettings = {
  /*
   * On, but quiet.
   *
   * The parts that only make Orbis better at answering — context for Orion, continuing where you left off — are
   * on. The parts that put something on screen unasked start off, because a feature that begins by interrupting
   * somebody is one they switch off before it has shown what it is for.
   */
  enabled: true,
  paused: false,
  suggestions: false,
  showContext: true,
  continueWhereLeftOff: true,
  smartTabs: false,
  relatedFiles: true,
  contextForOrion: true,
  sessionMemory: true,
  contextAwareMusic: false,
  keepDays: 30
}

const ambientFile = (userData: string, profileId: string, name: string): string =>
  join(userData, dataDirFor(profileId), 'ambient', name)

const text = (value: unknown, most = 300): string => (typeof value === 'string' ? value.slice(0, most) : '')
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

const KINDS: readonly ActivityKind[] = [
  'page-opened', 'page-active', 'search', 'selection', 'file-opened', 'file-downloaded', 'note-opened', 'note-edited',
  'orion-asked', 'orion-answered', 'music-played', 'focus-started', 'focus-ended', 'task-created', 'task-completed',
  'bookmark-saved', 'tab-group', 'content-saved', 'session-started', 'session-ended'
]
const SOURCES: readonly ActivitySource[] = ['browser', 'orion', 'files', 'notes', 'tasks', 'music', 'focus', 'search', 'student', 'app']
const SENSITIVITIES: readonly Sensitivity[] = ['low', 'personal', 'private']

export function normalizeActivity(raw: unknown): Activity | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = text(row.id, 80)
  const kind = KINDS.find((one) => one === row.kind)
  const source = SOURCES.find((one) => one === row.source)
  if (!id || !kind || !source) return null
  const sensitivity = SENSITIVITIES.find((one) => one === row.sensitivity) ?? 'low'
  /*
   * A row stored as private is dropped on read, not merely hidden.
   *
   * It should never have reached the file. If one ever does — an older build, a hand-edited file — reading it back
   * would quietly resurrect exactly the thing the rules exist to prevent.
   */
  if (sensitivity === 'private') return null
  return {
    id,
    profileId: text(row.profileId, 60) || DEFAULT_PROFILE_ID,
    kind,
    source,
    at: num(row.at),
    title: text(row.title, 300),
    url: typeof row.url === 'string' ? row.url.slice(0, 2048) : null,
    refId: typeof row.refId === 'string' ? row.refId.slice(0, 200) : null,
    seconds: typeof row.seconds === 'number' && row.seconds > 0 ? Math.min(86_400, Math.round(row.seconds)) : undefined,
    sensitivity
  }
}

export function normalizeSession(raw: unknown): SessionMemory | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = text(row.id, 80)
  if (!id) return null
  return {
    id,
    profileId: text(row.profileId, 60) || DEFAULT_PROFILE_ID,
    title: text(row.title, 120) || 'Something',
    subject: typeof row.subject === 'string' ? row.subject.slice(0, 80) : null,
    concept: typeof row.concept === 'string' ? row.concept.slice(0, 120) : null,
    intent: text(row.intent, 40) || 'browsing',
    startedAt: num(row.startedAt),
    endedAt: num(row.endedAt),
    seconds: num(row.seconds),
    things: num(row.things),
    places: Array.isArray(row.places) ? row.places.filter((one): one is string => typeof one === 'string').slice(0, 20) : [],
    rejected: flag(row.rejected, false)
  }
}

export function normalizeAmbientSettings(raw: unknown): AmbientSettings {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    enabled: flag(row.enabled, DEFAULT_AMBIENT_SETTINGS.enabled),
    paused: flag(row.paused, DEFAULT_AMBIENT_SETTINGS.paused),
    suggestions: flag(row.suggestions, DEFAULT_AMBIENT_SETTINGS.suggestions),
    showContext: flag(row.showContext, DEFAULT_AMBIENT_SETTINGS.showContext),
    continueWhereLeftOff: flag(row.continueWhereLeftOff, DEFAULT_AMBIENT_SETTINGS.continueWhereLeftOff),
    smartTabs: flag(row.smartTabs, DEFAULT_AMBIENT_SETTINGS.smartTabs),
    relatedFiles: flag(row.relatedFiles, DEFAULT_AMBIENT_SETTINGS.relatedFiles),
    contextForOrion: flag(row.contextForOrion, DEFAULT_AMBIENT_SETTINGS.contextForOrion),
    sessionMemory: flag(row.sessionMemory, DEFAULT_AMBIENT_SETTINGS.sessionMemory),
    contextAwareMusic: flag(row.contextAwareMusic, DEFAULT_AMBIENT_SETTINGS.contextAwareMusic),
    keepDays: Math.max(1, Math.min(365, Math.round(num(row.keepDays, DEFAULT_AMBIENT_SETTINGS.keepDays))))
  }
}

function normalizeHistory(raw: unknown): SuggestionHistory {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const counts = (value: unknown): Record<string, number> => {
    const out: Record<string, number> = {}
    if (value && typeof value === 'object') {
      for (const [key, held] of Object.entries(value as Record<string, unknown>)) {
        if (typeof held === 'number' && Number.isFinite(held)) out[key.slice(0, 40)] = Math.max(0, Math.round(held))
      }
    }
    return out
  }
  return {
    dismissed: counts(row.dismissed),
    accepted: counts(row.accepted),
    lastShown: counts(row.lastShown),
    lastAnything: num(row.lastAnything)
  }
}

export class AmbientStore {
  private readonly activity: Collection<Activity>
  private readonly sessions: Collection<SessionMemory>
  private readonly settingsFile: JsonFile<AmbientSettings>
  private readonly historyFile: JsonFile<SuggestionHistory>
  private readonly userData: string
  private profileId = DEFAULT_PROFILE_ID

  constructor(userData: string) {
    this.userData = userData
    const path = (name: string): string => ambientFile(userData, DEFAULT_PROFILE_ID, name)
    this.activity = new Collection<Activity>(path('activity.json'), normalizeActivity, MAX_ACTIVITY)
    this.sessions = new Collection<SessionMemory>(path('sessions.json'), normalizeSession, MAX_SESSIONS)
    this.settingsFile = new JsonFile<AmbientSettings>(path('settings.json'), () => ({ ...DEFAULT_AMBIENT_SETTINGS }), normalizeAmbientSettings)
    this.historyFile = new JsonFile<SuggestionHistory>(path('suggestions.json'), () => newHistory(), normalizeHistory)
  }

  /** Another profile is another person. Every file swaps, and nothing is carried across. */
  async useProfile(profileId: string): Promise<void> {
    if (profileId === this.profileId) return
    this.profileId = profileId
    const path = (name: string): string => ambientFile(this.userData, profileId, name)
    await Promise.all([
      this.activity.usePath(path('activity.json')),
      this.sessions.usePath(path('sessions.json')),
      this.settingsFile.usePath(path('settings.json')),
      this.historyFile.usePath(path('suggestions.json'))
    ])
  }

  get profile(): string {
    return this.profileId
  }

  async add(one: Activity): Promise<void> {
    await this.activity.put(one)
  }

  /** Everything recorded since a moment, newest first. The one read the engine does on every pass. */
  async since(at: number, most = 400): Promise<Activity[]> {
    const all = await this.activity.all()
    return all
      .filter((one) => one.at >= at && one.profileId === this.profileId)
      .sort((a, b) => b.at - a.at)
      .slice(0, most)
  }

  async allActivity(): Promise<Activity[]> {
    return (await this.activity.all()).filter((one) => one.profileId === this.profileId)
  }

  /**
   * Rows past their keeping time, removed.
   *
   * Run on start and after each day's first write rather than on a timer: a sweep that needs the app to stay open
   * is a sweep that never runs on the machines that most need it.
   */
  async sweep(now: number): Promise<number> {
    const settings = await this.settings()
    const days = { low: settings.keepDays, personal: Math.min(settings.keepDays, 7), private: 0 }
    const all = await this.activity.all()
    let gone = 0
    for (const one of all) {
      if (expired(one, now, days)) gone += (await this.activity.remove(one.id)) ? 1 : 0
    }
    return gone
  }

  async sessionList(): Promise<SessionMemory[]> {
    const all = await this.sessions.all()
    return all.filter((one) => one.profileId === this.profileId).sort((a, b) => b.endedAt - a.endedAt)
  }

  async keepSession(one: SessionMemory): Promise<SessionMemory> {
    await this.sessions.put(one)
    return one
  }

  async rejectSession(id: string): Promise<boolean> {
    const all = await this.sessions.all()
    const one = all.find((two) => two.id === id)
    if (!one) return false
    await this.sessions.put({ ...one, rejected: true })
    return true
  }

  settings(): Promise<AmbientSettings> {
    return this.settingsFile.read()
  }

  async saveSettings(patch: Partial<AmbientSettings>): Promise<AmbientSettings> {
    const held = await this.settingsFile.read()
    const next = normalizeAmbientSettings({ ...held, ...patch })
    await this.settingsFile.write(next)
    return next
  }

  history(): Promise<SuggestionHistory> {
    return this.historyFile.read()
  }

  async saveHistory(one: SuggestionHistory): Promise<void> {
    await this.historyFile.write(one)
  }

  /**
   * Everything Ambient Intelligence has ever learned, gone.
   *
   * Settings are deliberately kept: somebody clearing their activity has not asked to have the feature turned
   * back on, and quietly re-enabling what they switched off would be the worst possible reading of the request.
   */
  async clearEverything(): Promise<{ activity: number; sessions: number }> {
    const rows = await this.activity.all()
    const sessions = await this.sessions.all()
    for (const one of rows) await this.activity.remove(one.id)
    for (const one of sessions) await this.sessions.remove(one.id)
    await this.historyFile.write(newHistory())
    return { activity: rows.length, sessions: sessions.length }
  }

  async flush(): Promise<void> {
    await Promise.all([this.activity.flush(), this.sessions.flush(), this.settingsFile.flush(), this.historyFile.flush()])
  }
}
