/**
 * What somebody just did, written down once, in one shape.
 *
 * ## Why this exists when there is already an event bus
 *
 * `orbisEvents.ts` is a bus: it carries things as they happen and forgets them. Ambient Intelligence needs to
 * remember — "what was I doing yesterday" cannot be answered by a bus. So this is the narrow, typed, **recorded**
 * form of activity: fewer kinds than the bus has events, each one chosen because something downstream actually
 * reasons about it, each carrying who it belongs to and how long it may be kept.
 *
 * Nothing here subscribes to anything. The service does that; this decides what an activity *is*.
 *
 * ## Privacy is a property of the row, not a rule someone remembers
 *
 * Every activity carries a `sensitivity`, and `recordable()` refuses the ones that must never be written down —
 * a sign-in page, a payment page, anything on a private tab. That decision happens here, before a row exists,
 * rather than in the store, because a check at the door is one place to get right and a check at the shelf is
 * every place.
 *
 * ## Nothing in here is content
 *
 * An activity holds a title, an address and ids. It never holds the text of a page, the body of a note, or
 * anything typed into a field. The things that do hold content — Recall, notes, files — already exist and already
 * have their own rules; this records *that* something happened and points at it.
 */

/** The kinds of thing worth remembering. Deliberately short: a kind nothing reasons about is a row nobody reads. */
export type ActivityKind =
  | 'page-opened'
  | 'page-active'
  | 'search'
  | 'selection'
  | 'file-opened'
  | 'file-downloaded'
  | 'note-opened'
  | 'note-edited'
  | 'orion-asked'
  | 'orion-answered'
  | 'music-played'
  | 'focus-started'
  | 'focus-ended'
  | 'task-created'
  | 'task-completed'
  | 'bookmark-saved'
  | 'tab-group'
  | 'content-saved'
  | 'session-started'
  | 'session-ended'

/** Where an activity came from. Used for weighting: a deliberate act counts for more than a passing one. */
export type ActivitySource = 'browser' | 'orion' | 'files' | 'notes' | 'tasks' | 'music' | 'focus' | 'search' | 'student' | 'app'

/**
 * How careful to be with this row.
 *
 * `private` never reaches the store at all. `low` may be summarised and shown. The middle exists because some
 * things are fine to remember and not fine to put in a sentence on screen.
 */
export type Sensitivity = 'low' | 'personal' | 'private'

export interface Activity {
  id: string
  profileId: string
  kind: ActivityKind
  source: ActivitySource
  at: number
  /** What it was called. A page title, a file name, a note title. Never content. */
  title: string
  /** Where it was, when that means anything. Stripped of query strings that carry identifiers. */
  url?: string | null
  /** The thing's own id in whatever owns it, so the activity can point back at it. */
  refId?: string | null
  /** How long it held attention, in seconds. Dwell is the difference between read and glanced at. */
  seconds?: number
  sensitivity: Sensitivity
}

/** Addresses that must never be written down, whatever else is true about them. */
const NEVER = [
  /^about:/i,
  /^chrome:/i,
  /^devtools:/i,
  /^file:\/\/\/[a-z]:\/windows\//i,
  /^data:/i,
  /^blob:/i,
  /^javascript:/i
]

/**
 * Pages that are somebody signing in, paying, or banking.
 *
 * Matched on the address rather than the content, because by the time there is content to look at the page has
 * already been read. Deliberately broad: a false positive here costs one forgotten row, and a false negative
 * writes somebody's bank into a database.
 */
const SENSITIVE = [
  /\b(login|log-in|signin|sign-in|signup|sign-up|register|auth|oauth|sso|password|passwd|reset-password|forgot)\b/i,
  /\b(checkout|payment|billing|card|invoice|purchase|cart\/pay)\b/i,
  /\b(bank|banking|netbanking|account\/transfer|wallet|upi)\b/i,
  /\b(2fa|otp|verify|verification|mfa)\b/i,
  /\b(medical|health-record|patient|diagnosis|prescription)\b/i
]

export function hostOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * How sensitive an address is.
 *
 * Checked against the whole address, host and path, because `example.com/account/login` and `login.example.com`
 * are the same thing wearing different hats.
 */
export function sensitivityOf(url: string | null | undefined, title = ''): Sensitivity {
  if (!url) return 'low'
  for (const one of NEVER) if (one.test(url)) return 'private'
  const against = `${url} ${title}`
  for (const one of SENSITIVE) if (one.test(against)) return 'private'
  // A host nobody shares is not secret, but it is nobody else's business either.
  if (/^(localhost|127\.0\.0\.1|\[::1\])/.test(hostOf(url))) return 'personal'
  return 'low'
}

/**
 * An address with the identifying parts taken out.
 *
 * Query strings carry session tokens, email addresses and one-time codes far more often than they carry anything
 * worth remembering, so only a short list of parameters that genuinely describe *what* a page is survive. The
 * fragment goes entirely.
 */
const KEEP_PARAMS = new Set(['q', 'query', 'search', 'v', 'id', 'p', 'page', 'topic', 'lang', 'tab'])

export function tidyUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const kept = new URLSearchParams()
    for (const [key, value] of parsed.searchParams) {
      // A value long enough to be a token is dropped even when its name looks harmless.
      if (KEEP_PARAMS.has(key.toLowerCase()) && value.length <= 120) kept.append(key, value)
    }
    parsed.search = kept.toString() ? `?${kept.toString()}` : ''
    // Credentials in an address are never kept, under any name.
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return null
  }
}

/** Whether this is worth writing down at all. The one gate everything goes through. */
export function recordable(one: { url?: string | null; title?: string; sensitivity?: Sensitivity; privateTab?: boolean }): boolean {
  if (one.privateTab) return false
  const how = one.sensitivity ?? sensitivityOf(one.url, one.title)
  return how !== 'private'
}

export interface RawActivity {
  kind: ActivityKind
  source: ActivitySource
  title?: string
  url?: string | null
  refId?: string | null
  seconds?: number
  at?: number
  privateTab?: boolean
}

/**
 * A raw report turned into a row, or refused.
 *
 * Returns null rather than throwing, because the callers are event handlers: a page that should not be recorded
 * is an ordinary outcome, not an error, and an exception on every sign-in page would be its own kind of bug.
 */
export function toActivity(raw: RawActivity, profileId: string, now: number, id: string): Activity | null {
  if (!raw.kind || !raw.source) return null
  const url = tidyUrl(raw.url)
  const title = (raw.title ?? '').trim().slice(0, 300)
  const sensitivity = sensitivityOf(url ?? raw.url, title)
  if (!recordable({ url: url ?? raw.url, title, sensitivity, privateTab: raw.privateTab })) return null
  // A row that names nothing and points nowhere cannot be reasoned about or shown.
  if (!title && !url && !raw.refId) return null
  return {
    id,
    profileId,
    kind: raw.kind,
    source: raw.source,
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : now,
    title,
    url,
    refId: raw.refId ? String(raw.refId).slice(0, 200) : null,
    seconds: typeof raw.seconds === 'number' && raw.seconds > 0 ? Math.min(86_400, Math.round(raw.seconds)) : undefined,
    sensitivity
  }
}

/**
 * How much an activity says about what somebody is doing.
 *
 * A search is somebody stating their intent in words — nothing else comes close. A page merely opened might be a
 * mis-click. Dwell time is folded in because thirty seconds on a page says something a tab that was closed in two
 * does not.
 */
export function weightOf(one: Activity): number {
  const base: Record<ActivityKind, number> = {
    search: 1,
    selection: 0.95,
    'orion-asked': 0.95,
    'focus-started': 0.9,
    'note-edited': 0.85,
    'file-opened': 0.8,
    'content-saved': 0.8,
    'bookmark-saved': 0.75,
    'file-downloaded': 0.75,
    'page-active': 0.7,
    'note-opened': 0.6,
    'task-created': 0.6,
    'orion-answered': 0.55,
    'tab-group': 0.5,
    'task-completed': 0.5,
    'page-opened': 0.4,
    'focus-ended': 0.3,
    'music-played': 0.2,
    'session-started': 0.1,
    'session-ended': 0.1
  }
  const dwell = one.seconds ? Math.min(0.3, one.seconds / 600) : 0
  return Math.min(1, (base[one.kind] ?? 0.3) + dwell)
}

/**
 * How much a row still counts, given how long ago it was.
 *
 * Halves roughly every forty minutes, which matches how quickly somebody's attention actually moves between
 * subjects. Never reaches zero: something from this morning should still be findable this evening, it simply
 * should not outvote what is on screen now.
 */
export function freshness(at: number, now: number, halfLifeMinutes = 40): number {
  const minutes = Math.max(0, (now - at) / 60_000)
  return Math.max(0.02, Math.pow(0.5, minutes / halfLifeMinutes))
}

/** How long each kind is kept before it is cleared out. Raw rows are short-lived; what was made of them is not. */
export const RETENTION_DAYS: Readonly<Record<Sensitivity, number>> = {
  low: 30,
  personal: 7,
  private: 0
}

export function expired(one: Activity, now: number, days = RETENTION_DAYS): boolean {
  const limit = days[one.sensitivity] ?? 7
  if (limit <= 0) return true
  return now - one.at > limit * 86_400_000
}
