import { looksSecret } from './clipboardHistory.ts'
import { mayNotify, inQuietHours } from './rules.ts'
import type { NotificationsConfig } from './experience.ts'

/**
 * What Orbis tells you about when you are not looking at it.
 *
 * Orbis does real work while nobody is watching: a schedule runs at nine in the morning, a workflow waits half an hour
 * for a page, a report takes ten minutes to write, a download finishes. Until now five different places each reached
 * for the operating system's notifications on their own, which meant five different ideas about what was worth
 * interrupting somebody for, and no way to see afterwards what had happened while you were away.
 *
 * This is the one place that decides. Everything that happens in Orbis publishes an **event** -- a fact, with an id
 * and the things it refers to. Nothing publishes a sentence. This file turns an event into the words, decides whether
 * it is worth saying at all, at what urgency, whether it should wait until the morning, and what pressing it should
 * do. All of that is arithmetic and tables, so all of it is tested without an operating system anywhere near it.
 *
 * Three rules run through it:
 *
 * **An event is not a notification.** Most of what Orbis does is not worth interrupting anybody for, and the default
 * for anything not listed here is silence. A subsystem cannot talk its way past this by shouting louder: it does not
 * get to choose its own priority, only to report what happened.
 *
 * **Nothing is said that did not happen.** A notification carries the id of the thing it is about and nothing else of
 * it. The task's own state stays the authority; if the two ever disagree, the task is right and the notification is
 * wrong. There is no way to produce a notification here except from an event.
 *
 * **Nothing secret is ever in one.** Titles and bodies are built from templates, then checked again on the way out --
 * anything that looks like a key, a token or a card number is replaced before it can reach a screen that may be
 * sitting locked on a desk in an open-plan office.
 */

// ---------------------------------------------------------------- the shape of one

/** Which part of Orbis it came from. Shown to nobody; used for filtering, history and finding bugs. */
export type NotificationSource =
  | 'scheduler'
  | 'workflow'
  | 'browser'
  | 'download'
  | 'orion'
  | 'research'
  | 'page'
  | 'artifact'
  | 'captcha'
  | 'security'
  | 'update'
  | 'rules'
  | 'system'

/** What the person can switch on and off. Deliberately coarser than the source. */
export type NotificationCategory = 'workflows' | 'schedules' | 'downloads' | 'orion' | 'research' | 'pages' | 'artifacts' | 'security' | 'updates' | 'attention' | 'system'

/**
 * How much it matters.
 *
 * `critical` is for things that are wrong and will stay wrong until somebody looks. `attention` is not a priority --
 * it is a category -- because "Orbis is waiting for you" is urgent in a different way from "something broke".
 */
export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low'

const PRIORITY_ORDER: Readonly<Record<NotificationPriority, number>> = Object.freeze({ critical: 3, high: 2, normal: 1, low: 0 })

/** Where one is in its life. Every step is recorded; none is skipped or guessed. */
export type NotificationStatus = 'queued' | 'held' | 'delivered' | 'actioned' | 'dismissed' | 'expired' | 'failed' | 'suppressed'

/** What pressing a button does. Only ids from here; never a path, a command or anything a payload could carry. */
export interface NotificationAction {
  readonly id: string
  readonly label: string
}

export interface OrbisNotification {
  readonly id: string
  /** Which kind of thing happened: `workflow.completed`, `download.failed`, and so on. */
  readonly event: string
  readonly profileId: string
  readonly source: NotificationSource
  readonly category: NotificationCategory
  readonly priority: NotificationPriority
  readonly at: number
  readonly title: string
  readonly body: string
  /** What it is about, by id only -- never the thing itself. */
  readonly subject: Readonly<Record<string, string>>
  readonly actions: readonly NotificationAction[]
  /** The same event happening twice gives the same key, and the second one is dropped. */
  readonly dedupe: string
  /** Notifications sharing this may be folded into one line when several arrive together. */
  readonly group: string
  /** When it stops being worth showing. Null for things that stay true. */
  readonly expiresAt: number | null
  /** True when the body must not be shown on a locked screen or in a preview. */
  readonly sensitive: boolean
  readonly status: NotificationStatus
  /** Whether it has been looked at inside Orbis. Nothing to do with whether the system showed it. */
  readonly read: boolean
}

// ---------------------------------------------------------------- the events, and what each becomes

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

interface Template {
  readonly source: NotificationSource
  readonly category: NotificationCategory
  readonly priority: NotificationPriority
  /** How long it stays worth showing. Null for "until something else changes". */
  readonly ttl: number | null
  readonly actions: readonly NotificationAction[]
  readonly sensitive?: boolean
  /** The words. Given only the event's own fields, so a template can never reach for anything it was not told. */
  title(f: Readonly<Record<string, string>>): string
  body(f: Readonly<Record<string, string>>): string
  /** What makes two of these the same event. Defaults to the event name and every subject id. */
  dedupe?(f: Readonly<Record<string, string>>): string
  group?(f: Readonly<Record<string, string>>): string
}

const named = (f: Readonly<Record<string, string>>, key: string, fallback: string): string => {
  const value = f[key]
  return value === undefined || value.trim() === '' ? fallback : value.trim()
}

const OPEN: readonly NotificationAction[] = Object.freeze([{ id: 'open', label: 'Open' }])
const NONE: readonly NotificationAction[] = Object.freeze([])

/**
 * Every event Orbis will interrupt somebody for.
 *
 * Short on purpose. An event that is not here produces nothing -- which is the answer for nearly everything Orbis
 * does. Tabs opening, pages loading, steps of a workflow finishing: all real events, none of them worth a noise.
 */
export const NOTIFICATION_TEMPLATES: Readonly<Record<string, Template>> = Object.freeze({
  // ---------------------------------------------------------------- workflows
  'workflow.completed': {
    source: 'workflow',
    category: 'workflows',
    priority: 'normal',
    ttl: 3 * DAY,
    actions: OPEN,
    title: (f) => `${named(f, 'name', 'A workflow')} finished`,
    body: (f) => (f.summary ? f.summary : 'It ran to the end with nothing left to do.'),
    group: () => 'workflows'
  },
  'workflow.failed': {
    source: 'workflow',
    category: 'workflows',
    priority: 'high',
    ttl: 7 * DAY,
    actions: Object.freeze([
      { id: 'open', label: 'Open' },
      { id: 'retry', label: 'Try again' }
    ]),
    title: (f) => `${named(f, 'name', 'A workflow')} could not finish`,
    body: (f) => named(f, 'reason', 'It stopped part-way through.')
  },
  'workflow.waiting': {
    source: 'workflow',
    category: 'attention',
    priority: 'high',
    ttl: null,
    actions: OPEN,
    title: (f) => `${named(f, 'name', 'A workflow')} is waiting for you`,
    body: (f) => named(f, 'reason', 'It cannot go on until you look at it.')
  },

  // ---------------------------------------------------------------- schedules
  'schedule.completed': {
    source: 'scheduler',
    category: 'schedules',
    priority: 'normal',
    ttl: 2 * DAY,
    actions: OPEN,
    title: (f) => `${named(f, 'name', 'A scheduled job')} ran`,
    body: (f) => (f.summary ? f.summary : 'It did what it was set to do.'),
    // The run, not the schedule: a daily job is a different event each day.
    dedupe: (f) => `schedule.completed:${named(f, 'runId', named(f, 'scheduleId', 'one'))}`,
    group: () => 'schedules'
  },
  'schedule.failed': {
    source: 'scheduler',
    category: 'schedules',
    priority: 'high',
    ttl: 7 * DAY,
    actions: Object.freeze([
      { id: 'open', label: 'Open' },
      { id: 'retry', label: 'Run now' }
    ]),
    title: (f) => `${named(f, 'name', 'A scheduled job')} could not run`,
    body: (f) => named(f, 'reason', 'Something stopped it.'),
    dedupe: (f) => `schedule.failed:${named(f, 'runId', named(f, 'scheduleId', 'one'))}`
  },
  'schedule.missed': {
    source: 'scheduler',
    category: 'schedules',
    priority: 'normal',
    ttl: DAY,
    actions: Object.freeze([
      { id: 'run-now', label: 'Run now' },
      { id: 'dismiss', label: 'Leave it' }
    ]),
    title: (f) => `${named(f, 'name', 'A scheduled job')} was missed`,
    body: () => 'The computer was off or asleep when it was due.',
    dedupe: (f) => `schedule.missed:${named(f, 'runId', named(f, 'scheduleId', 'one'))}`
  },

  // ---------------------------------------------------------------- downloads
  'download.completed': {
    source: 'download',
    category: 'downloads',
    priority: 'normal',
    ttl: 2 * DAY,
    actions: Object.freeze([
      { id: 'open-file', label: 'Open' },
      { id: 'show-in-folder', label: 'Show in folder' }
    ]),
    title: () => 'Download finished',
    body: (f) => named(f, 'filename', 'A file'),
    group: () => 'downloads'
  },
  'download.failed': {
    source: 'download',
    category: 'downloads',
    priority: 'normal',
    ttl: DAY,
    actions: OPEN,
    title: () => 'Download failed',
    body: (f) => `${named(f, 'filename', 'A file')} did not finish.`,
    group: () => 'downloads'
  },

  // ---------------------------------------------------------------- what Orion made
  'research.completed': {
    source: 'research',
    category: 'research',
    priority: 'normal',
    ttl: 3 * DAY,
    actions: Object.freeze([{ id: 'open', label: 'View research' }]),
    title: () => 'Research finished',
    body: (f) => named(f, 'topic', 'The research you asked for is ready.'),
    group: () => 'research'
  },
  'research.failed': {
    source: 'research',
    category: 'research',
    priority: 'normal',
    ttl: DAY,
    actions: OPEN,
    title: () => 'Research could not be finished',
    body: (f) => named(f, 'reason', 'The sources could not be reached.')
  },
  'orion.completed': {
    source: 'orion',
    category: 'orion',
    priority: 'normal',
    ttl: DAY,
    actions: OPEN,
    title: () => 'Orion has finished',
    body: (f) => named(f, 'summary', 'The answer you asked for is ready.')
  },
  'orion.waiting': {
    source: 'orion',
    category: 'attention',
    priority: 'high',
    ttl: null,
    actions: OPEN,
    title: () => 'Orion is waiting for you',
    body: (f) => named(f, 'reason', 'It needs an answer before it can go on.')
  },
  'artifact.created': {
    source: 'artifact',
    category: 'artifacts',
    priority: 'normal',
    ttl: 3 * DAY,
    actions: Object.freeze([
      { id: 'open-file', label: 'Open' },
      { id: 'show-in-folder', label: 'Show in folder' }
    ]),
    title: (f) => `${named(f, 'kind', 'File')} ready`,
    body: (f) => named(f, 'filename', 'The file you asked for is ready.'),
    group: () => 'artifacts'
  },
  'artifact.failed': {
    source: 'artifact',
    category: 'artifacts',
    priority: 'normal',
    ttl: DAY,
    actions: Object.freeze([
      { id: 'open', label: 'Details' },
      { id: 'retry', label: 'Try again' }
    ]),
    title: () => 'The file could not be made',
    body: (f) => named(f, 'reason', 'Something went wrong while writing it.')
  },
  'page.ready': {
    source: 'page',
    category: 'pages',
    priority: 'normal',
    ttl: 3 * DAY,
    actions: Object.freeze([{ id: 'open', label: 'Open Page' }]),
    title: () => 'Your Page is ready',
    body: (f) => named(f, 'title', 'The Page you asked for has been built.'),
    group: () => 'pages'
  },

  // ---------------------------------------------------------------- things only you can do
  'captcha.required': {
    source: 'captcha',
    category: 'attention',
    priority: 'high',
    // No expiry: a challenge waiting for a person is waiting until the person comes, whenever that is.
    ttl: null,
    actions: Object.freeze([
      { id: 'open-challenge', label: 'Open it' },
      { id: 'stop', label: 'Stop' }
    ]),
    title: () => 'Orbis needs you to prove you are a person',
    body: (f) => `${named(f, 'site', 'A site')} is asking, and Orbis cannot do it for you.`
  },
  'browser.attention': {
    source: 'browser',
    category: 'attention',
    priority: 'high',
    ttl: null,
    actions: OPEN,
    title: () => 'Orbis needs your attention',
    body: (f) => named(f, 'reason', 'Something in the browser is waiting for you.')
  },

  // ---------------------------------------------------------------- safety and upkeep
  'security.blocked': {
    source: 'security',
    category: 'security',
    priority: 'critical',
    ttl: 7 * DAY,
    actions: Object.freeze([{ id: 'open', label: 'Details' }]),
    title: () => 'Orbis stopped something',
    body: (f) => named(f, 'reason', 'Something was blocked for your safety.'),
    sensitive: true
  },
  'update.ready': {
    source: 'update',
    category: 'updates',
    priority: 'normal',
    // Until it is installed: an update that is ready stays ready.
    ttl: null,
    actions: Object.freeze([
      { id: 'open', label: 'Details' },
      { id: 'restart', label: 'Restart now' }
    ]),
    title: () => 'An Orbis update is ready',
    body: (f) => (f.version ? `Version ${f.version} will be installed when you restart.` : 'It will be installed when you restart Orbis.'),
    dedupe: (f) => `update.ready:${named(f, 'version', 'next')}`
  },
  'rule.fired': {
    source: 'rules',
    category: 'system',
    priority: 'low',
    ttl: DAY,
    actions: NONE,
    title: (f) => named(f, 'name', 'Something you asked to be told about'),
    body: (f) => named(f, 'detail', 'It became true.')
  },
  'system.problem': {
    source: 'system',
    category: 'system',
    priority: 'high',
    ttl: DAY,
    actions: NONE,
    title: (f) => named(f, 'title', 'Orbis hit a problem'),
    body: (f) => named(f, 'reason', 'Something could not be done.')
  }
})

// ---------------------------------------------------------------- making one

/** What a subsystem publishes. A fact, never a sentence. */
export interface OrbisEvent {
  readonly type: string
  readonly profileId: string
  /** Ids and short names the template may use. Never content, never anything secret. */
  readonly fields?: Readonly<Record<string, string>>
  readonly at?: number
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
const MAX_TITLE = 90
const MAX_BODY = 220

/**
 * Makes a line safe to put on a screen.
 *
 * Notification text can come from a file's name, a site's title or a failure's message, and none of those is under
 * Orbis's control. Control characters and direction marks can make a short line pretend to be a different line
 * entirely, so they go; and anything longer than a notification can show is cut rather than left to the operating
 * system to cut somewhere arbitrary.
 */
export function cleanLine(raw: string, max: number): string {
  const flattened = raw.replace(CONTROL_CHARS, '').replace(/[‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim()
  return flattened.length <= max ? flattened : `${flattened.slice(0, max - 1).trimEnd()}…`
}

/**
 * The last check before anything is shown.
 *
 * Templates are written not to put secrets in notifications, and this does not trust them. A filename, a page title or
 * a failure's message can carry a token somebody pasted somewhere, and the one screen a notification is guaranteed to
 * reach is the one sitting unlocked on a desk.
 */
export function redactSecrets(line: string): string {
  return line
    .split(' ')
    .map((word) => (word.length >= 12 && looksSecret(word) ? '[hidden]' : word))
    .join(' ')
}

/**
 * Turns an event into a notification, or into nothing.
 *
 * Nothing is the common answer and not a failure: an event with no template is an event Orbis does not interrupt
 * anybody for. `id` is given rather than made here so that the same event, replayed after a restart, is the same
 * notification and not a second one.
 */
export function notificationFor(event: OrbisEvent, id: string): OrbisNotification | null {
  const template = Object.prototype.hasOwnProperty.call(NOTIFICATION_TEMPLATES, event.type) ? NOTIFICATION_TEMPLATES[event.type] : undefined
  if (!template) return null
  if (typeof event.profileId !== 'string' || event.profileId === '') return null

  const fields = Object.freeze({ ...(event.fields ?? {}) })
  const at = typeof event.at === 'number' && Number.isFinite(event.at) ? event.at : Date.now()

  let title: string
  let body: string
  try {
    title = redactSecrets(cleanLine(template.title(fields), MAX_TITLE))
    body = redactSecrets(cleanLine(template.body(fields), MAX_BODY))
  } catch {
    // A template that throws on a field it expected is a bug, and a bug here must not take the event with it.
    return null
  }
  if (title === '') return null

  const subject = Object.freeze(Object.fromEntries(Object.entries(fields).filter(([key]) => key.endsWith('Id') || key === 'path')))

  return Object.freeze({
    id,
    event: event.type,
    profileId: event.profileId,
    source: template.source,
    category: template.category,
    priority: template.priority,
    at,
    title,
    body,
    subject,
    actions: template.actions,
    /*
     * What makes two of these the same event.
     *
     * The ids it is about, when it has any. When it has none -- a download knows its filename and not much else --
     * the words themselves stand in, because the alternative was far worse: with nothing to tell them apart, three
     * different downloads finishing all produced the same key and the second and third were silently dropped as
     * repeats of the first.
     */
    dedupe: template.dedupe ? template.dedupe(fields) : Object.keys(subject).length > 0 ? `${event.type}:${Object.values(subject).join(':')}` : `${event.type}:${title}:${body}`,
    group: template.group ? template.group(fields) : `${event.type}:${event.profileId}`,
    expiresAt: template.ttl === null ? null : at + template.ttl,
    sensitive: template.sensitive === true,
    status: 'queued' as const,
    read: false
  })
}

// ---------------------------------------------------------------- whether to say it now

/** What Orbis knows about the person's attention when it is deciding. */
export interface AttentionContext {
  /** True when an Orbis window is in front of everything else. */
  readonly focused: boolean
  /**
   * What the person is already looking at, if Orbis knows -- `downloads`, `workflow:123`, `research`.
   *
   * A notification whose group matches this is a notification about something already on the screen.
   */
  readonly watching?: string | null
  /** True when the operating system is suppressing notifications and Orbis must not try to get round it. */
  readonly doNotDisturb?: boolean
}

export type Verdict =
  | { readonly show: true }
  /** Not now, but keep it: it is said when quiet hours end. */
  | { readonly show: false; readonly hold: true; readonly why: string }
  /** Not at all. It stays in the history; it never reaches the screen. */
  | { readonly show: false; readonly hold: false; readonly why: string }

/**
 * Whether this one should reach the screen now.
 *
 * The only place that decides. A subsystem cannot get past it by asking twice or by claiming urgency, because a
 * subsystem never gets to say how urgent its event is -- the template does, and the templates are above.
 */
export function shouldShow(notification: OrbisNotification, settings: NotificationsConfig, context: AttentionContext, now = Date.now()): Verdict {
  if (notification.expiresAt !== null && notification.expiresAt <= now) return { show: false, hold: false, why: 'it is no longer true' }

  /*
   * Critical goes first, and before anything that could stop it.
   *
   * These are the ones that are wrong and stay wrong: something blocked, something unsafe. A person who turned
   * downloads off did not ask not to be told that Orbis stopped something dangerous. Quiet hours and the category
   * switches are about noise, and this is not noise.
   */
  if (notification.priority === 'critical') {
    if (context.doNotDisturb === true) return { show: false, hold: true, why: 'the computer is set not to disturb you' }
    return { show: true }
  }

  if (context.doNotDisturb === true) return { show: false, hold: true, why: 'the computer is set not to disturb you' }
  if (!mayNotify(settings, notification.category, now)) {
    return inQuietHours(settings, now) ? { show: false, hold: true, why: 'it is quiet hours' } : { show: false, hold: false, why: 'that kind is switched off' }
  }

  /*
   * Already being watched.
   *
   * Telling somebody that the download finished, on top of the downloads list they are looking at while it finishes,
   * is noise with extra steps. Anything the person has to act on is exempt: being asked for attention while looking
   * at something else in Orbis is exactly when the ask is needed.
   */
  if (notification.category !== 'attention' && context.focused && context.watching && context.watching === notification.group) {
    return { show: false, hold: false, why: 'you are already looking at it' }
  }

  return { show: true }
}

/** Those held back during quiet hours, newest first, for the one line said when quiet hours end. */
export function heldSummary(held: readonly OrbisNotification[]): { title: string; body: string } | null {
  if (held.length === 0) return null
  if (held.length === 1) return { title: held[0]!.title, body: held[0]!.body }
  const kinds = new Set(held.map((one) => one.category))
  const what = kinds.size === 1 ? [...kinds][0]! : 'things'
  return { title: `${held.length} ${what === 'things' ? 'notifications' : what} while you were away`, body: held.slice(0, 3).map((one) => one.title).join(' · ') }
}

// ---------------------------------------------------------------- several at once

/**
 * Folds a burst into one line.
 *
 * Ten downloads finishing in a minute is one thing that happened, not ten. Only notifications of the same group and
 * the same priority are folded, and anything the person has to act on is never folded into anything -- two different
 * things waiting for you are two different things to go and do.
 */
export function coalesce(group: readonly OrbisNotification[]): { title: string; body: string; of: readonly OrbisNotification[] } | null {
  if (group.length < 2) return null
  const first = group[0]!
  if (first.category === 'attention' || first.priority === 'critical') return null
  if (!group.every((one) => one.group === first.group && one.priority === first.priority)) return null
  return {
    title: `${group.length} ${WORD_FOR[first.group] ?? 'things'} finished`,
    body: group
      .slice(0, 3)
      .map((one) => one.body)
      .join(' · '),
    of: group
  }
}

const WORD_FOR: Readonly<Record<string, string>> = Object.freeze({
  downloads: 'downloads',
  artifacts: 'files',
  research: 'pieces of research',
  workflows: 'workflows',
  schedules: 'scheduled jobs',
  pages: 'Pages'
})

/**
 * The order to deliver a queue in.
 *
 * By urgency first, and only then by when it happened. A hundred finished downloads must not keep a security warning
 * waiting behind them, which is the whole reason this is not simply a list in arrival order.
 */
export function deliveryOrder(queue: readonly OrbisNotification[]): readonly OrbisNotification[] {
  return [...queue].sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority] || a.at - b.at)
}

/** Whether this one has already been seen, by the key that says two events are the same event. */
export function isDuplicate(one: OrbisNotification, seen: readonly OrbisNotification[]): boolean {
  return seen.some((other) => other.dedupe === one.dedupe)
}

/** Those worth keeping. Expired ones go; the rest are kept newest first, up to the limit. */
export function prune(history: readonly OrbisNotification[], limit: number, now = Date.now()): readonly OrbisNotification[] {
  return [...history]
    .filter((one) => one.expiresAt === null || one.expiresAt > now || one.status === 'actioned')
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}

/** How many have not been looked at. */
export function unreadCount(history: readonly OrbisNotification[]): number {
  return history.filter((one) => !one.read && one.status !== 'suppressed').length
}

/** For a badge: a real count, or "99+" rather than a number nothing can draw. */
export function badge(count: number): string {
  return count <= 0 ? '' : count > 99 ? '99+' : String(count)
}
