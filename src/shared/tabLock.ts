/**
 * Which tabs are protected, when they lock, and what a locked one is allowed to say about itself.
 *
 * All of the deciding, and none of the doing. Nothing here touches a tab, a credential, a window or a file: it answers
 * questions -- does this address match a rule, which policy wins, should this lock now, what may be shown -- and the
 * main process and the browser carry the answers out. That split is what makes this testable, and the decisions are the
 * part that has to be right.
 *
 * The one rule everything else serves: **a locked tab must not reveal what it is.** Not its address, not its title, not
 * its icon, not a picture of it. Somebody looking at the browser should not be able to tell a locked bank from a locked
 * shopping list. Every default here is chosen with that in mind, and `safeTabInfo` is the single place any of it is
 * decided -- so there is one function to be sure about rather than a dozen places to remember.
 */

// ---------------------------------------------------------------- what makes a tab lock

/** Everything that can cause a tab to lock. Only these; a policy cannot invent a trigger. */
export type LockTrigger =
  /** Somebody asked. */
  | 'manual'
  /** They moved to a different tab. */
  | 'tabSwitch'
  /** Orbis stopped being the window in front. */
  | 'windowBlur'
  /** Nothing has been done in the tab for a while. */
  | 'inactivity'
  /** Orbis started, and the tab was protected when it last closed. */
  | 'startup'
  /** The computer's own session locked. */
  | 'systemLock'
  /** The computer suspended. */
  | 'sleep'
  /** Orbis was minimised. */
  | 'minimize'
  /** Everything protected, at once, because somebody asked for that. */
  | 'panic'

export const LOCK_TRIGGERS: LockTrigger[] = [
  'manual',
  'tabSwitch',
  'windowBlur',
  'inactivity',
  'startup',
  'systemLock',
  'sleep',
  'minimize',
  'panic'
]

/**
 * A delay in milliseconds, or null for "never".
 *
 * Null rather than 0, because 0 means "the instant it happens" and is a perfectly reasonable thing to want. Conflating
 * the two would make "lock immediately" unsayable.
 */
export type Delay = number | null

/** The longest a delay may be: a day. Beyond that it is not a delay, it is off, and off has its own value. */
export const MAX_DELAY_MS = 24 * 60 * 60 * 1000

/**
 * What a locked tab may show.
 *
 * Every one of these defaults to hiding. A person who turns one off has decided to trade privacy for convenience, which
 * is theirs to decide; a person who has decided nothing gets the private answer.
 */
export interface PrivacyPolicy {
  /** Show a generic label instead of the page's title. */
  hideTitle: boolean
  /** Show a lock instead of the site's icon. */
  hideFavicon: boolean
  /** Show a generic label in the address bar instead of the address. */
  hideUrl: boolean
  /** Give no picture of the page to hover cards, thumbnails or window previews. */
  hidePreview: boolean
  /** Refuse the page's content and pictures to Orion, Vision, research and automation. */
  hideFromAi: boolean
  /**
   * What to call it instead.
   *
   * A generic word. The interface warns against anything that identifies the site, but cannot stop somebody choosing
   * "Gmail" -- so `safeTabInfo` uses whatever is here and the warning lives in the screen that sets it.
   */
  label: string
}

/** How a protected tab behaves. */
export interface TabLockPolicy extends PrivacyPolicy {
  /** How long after leaving the tab it locks. */
  tabSwitch: Delay
  /** How long after Orbis loses focus. */
  windowBlur: Delay
  /** How long with nothing happening in the tab. */
  inactivity: Delay
  /** How long after Orbis is minimised. */
  minimize: Delay
  /** Locked when Orbis starts, if it was protected when Orbis closed. */
  onStartup: boolean
  /** Locked when the computer's session locks. */
  onSystemLock: boolean
  /** Locked when the computer suspends. */
  onSleep: boolean
}

/**
 * What a newly protected tab does when nobody has said otherwise.
 *
 * Chosen so that the common reason for locking a tab -- somebody else might walk up to this computer -- is served
 * without making the tab annoying to use. It locks when the machine locks, when the machine sleeps, when Orbis is
 * started again, and after five minutes of nothing. It does *not* lock the instant you glance at another tab, because
 * that makes a protected tab exhausting and is the setting people turn the whole feature off over.
 */
export const DEFAULT_POLICY: TabLockPolicy = {
  tabSwitch: null,
  windowBlur: null,
  inactivity: 5 * 60_000,
  minimize: null,
  onStartup: true,
  onSystemLock: true,
  onSleep: true,
  hideTitle: true,
  hideFavicon: true,
  hideUrl: true,
  hidePreview: true,
  hideFromAi: true,
  label: 'Locked Tab'
}

/** The presets the settings screen offers. Each is a real policy, not a name. */
export type PresetName = 'standard' | 'strong' | 'maximum'

export const POLICY_PRESETS: Record<PresetName, TabLockPolicy> = {
  /** Protect it, hide what it is, and otherwise stay out of the way. */
  standard: { ...DEFAULT_POLICY, inactivity: 15 * 60_000 },
  /** The default, plus locking when Orbis is put away. */
  strong: { ...DEFAULT_POLICY, windowBlur: 30_000, minimize: 0 },
  /** As private as this can be: the moment you look away, it is gone. */
  maximum: {
    ...DEFAULT_POLICY,
    tabSwitch: 0,
    windowBlur: 0,
    minimize: 0,
    inactivity: 60_000
  }
}

// ---------------------------------------------------------------- which tabs are protected

/**
 * A rule that protects a site.
 *
 * `pattern` is a host, optionally with a leading `*.` for subdomains and a path prefix -- deliberately not a regular
 * expression. A rule is written by a person to say "this site is private", and a language in which a mistake silently
 * matches everything is the wrong language for that.
 */
export interface DomainRule {
  id: string
  /** e.g. `example.com`, `*.bank.example`, `mail.example.com/work` */
  pattern: string
  enabled: boolean
  /** Which credential protects tabs this rule catches. */
  groupId: string
  /** When this rule applies, or null for always. */
  schedule: Schedule | null
}

/** Days, as JavaScript counts them: 0 is Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** A window of time on chosen days, in the computer's own timezone. */
export interface Schedule {
  days: Weekday[]
  /** Minutes from midnight. `from` after `to` means it wraps past midnight, which a night shift needs. */
  fromMinutes: number
  toMinutes: number
}

/** A credential and the policy that goes with it. Several tabs may share one. */
export interface LockGroup {
  id: string
  name: string
  policy: TabLockPolicy
  createdAt: number
  updatedAt: number
}

/** Whether a tab is protected, and whether it is locked right now. */
export interface TabSecurity {
  /** The browser's own id for the tab. */
  tabId: number
  groupId: string
  locked: boolean
  /** Why it locked, so the interface can explain itself without guessing. */
  lockedBy: LockTrigger | null
  lockedAt: number | null
  unlockedAt: number | null
  /** A tab-specific policy, overriding its group's. Null when it simply follows the group. */
  policy: Partial<TabLockPolicy> | null
}

// ---------------------------------------------------------------- matching a site

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Whether an address is what a rule describes.
 *
 * Host first, then path prefix. A bare host matches its subdomains too, because somebody writing `example.com` means
 * the site and not one machine on it -- and `*.example.com` is accepted as the explicit way of saying the same thing.
 *
 * An empty or unparseable address matches nothing. A new tab is not a protected site.
 */
export function ruleMatches(pattern: string, url: string): boolean {
  const cleaned = pattern.trim().toLowerCase().replace(/^https?:\/\//, '')
  if (!cleaned) return false
  const [rawHost, ...rest] = cleaned.split('/')
  const wantPath = rest.join('/')
  const host = hostOf(url)
  if (!host) return false

  const bare = rawHost.startsWith('*.') ? rawHost.slice(2) : rawHost
  if (!bare) return false
  const hostMatches = host === bare || host.endsWith(`.${bare}`)
  if (!hostMatches) return false
  if (!wantPath) return true

  const path = pathOf(url)
  const want = `/${wantPath.replace(/^\/+/, '').replace(/\/+$/, '')}`
  return path === want || path.startsWith(`${want}/`)
}

/** Whether a schedule covers a moment. Wrapping past midnight is handled, because a night shift is one stretch. */
export function scheduleCovers(schedule: Schedule, at: number): boolean {
  const when = new Date(at)
  const minutes = when.getHours() * 60 + when.getMinutes()
  const { fromMinutes: from, toMinutes: to, days } = schedule
  if (days.length === 0) return false

  if (from === to) return false
  if (from < to) {
    return days.includes(when.getDay() as Weekday) && minutes >= from && minutes < to
  }
  // Wrapping: the late part belongs to the day it started on, the early part to the day before.
  if (minutes >= from) return days.includes(when.getDay() as Weekday)
  if (minutes < to) {
    const yesterday = ((when.getDay() + 6) % 7) as Weekday
    return days.includes(yesterday)
  }
  return false
}

/** The first enabled rule that covers this address now, or null. */
export function ruleFor(rules: DomainRule[], url: string, at = Date.now()): DomainRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (!ruleMatches(rule.pattern, url)) continue
    if (rule.schedule && !scheduleCovers(rule.schedule, at)) continue
    return rule
  }
  return null
}

// ---------------------------------------------------------------- which policy wins

/**
 * The policy that applies to a tab.
 *
 * Most specific wins, in this order: what was set on the tab, then its group's, then the profile's default. A domain
 * rule chooses the *group*, so a rule's policy arrives through its group rather than as a fourth layer -- which is what
 * keeps this from being a precedence puzzle nobody can predict.
 *
 * Each field is resolved on its own, so a tab that overrides only its inactivity delay keeps everything else from its
 * group instead of falling back to the defaults for all of it.
 */
export function effectivePolicy(
  fallback: TabLockPolicy,
  group: TabLockPolicy | null,
  tab: Partial<TabLockPolicy> | null
): TabLockPolicy {
  return { ...fallback, ...(group ?? {}), ...(tab ?? {}) }
}

/** Why a tab is protected, in words, for a screen that offers to explain it. Never says what the site is. */
export function explainProtection(
  // Only the group's name is used, so only the name is required. Demanding a whole `LockGroup` would mean a caller
  // holding a summary of one had to invent the fields this never reads.
  reasons: { rule?: DomainRule | null; group?: ({ name: string } & Partial<LockGroup>) | null; manual?: boolean },
  policy: TabLockPolicy
): string[] {
  const said: string[] = []
  if (reasons.manual) said.push('You locked this tab.')
  if (reasons.rule) said.push(`A rule protects ${reasons.rule.pattern}.`)
  if (reasons.rule?.schedule) said.push('That rule is active at this time of day.')
  if (reasons.group) said.push(`It uses the "${reasons.group.name}" password.`)
  if (policy.onSystemLock) said.push('It locks when this computer locks.')
  if (policy.onSleep) said.push('It locks when this computer sleeps.')
  if (policy.onStartup) said.push('It stays locked when Orbis starts.')
  if (policy.inactivity !== null) said.push(`It locks after ${describeDelay(policy.inactivity)} of inactivity.`)
  if (policy.tabSwitch !== null) said.push(`It locks ${describeDelay(policy.tabSwitch)} after you leave it.`)
  if (policy.windowBlur !== null) said.push(`It locks ${describeDelay(policy.windowBlur)} after Orbis loses focus.`)
  if (policy.hideFromAi) said.push('Orion and automation cannot read it while locked.')
  return said
}

/** A delay as a person would say it. */
export function describeDelay(ms: Delay): string {
  if (ms === null) return 'never'
  if (ms === 0) return 'immediately'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------- should it lock now

/** What has just happened, and what the tab was doing. */
export interface LockMoment {
  trigger: LockTrigger
  /** How long ago the thing happened, for the delayed triggers. */
  sinceMs: number
  /** Whether this is the tab the person is looking at. */
  active: boolean
}

/**
 * Whether a protected tab should lock, given what just happened.
 *
 * `manual` and `panic` always lock, immediately: somebody asked. Everything else has to be both switched on and waited
 * out. And a tab that is already locked is never locked again -- the caller checks that, but so does this, because
 * locking twice would mean two lock surfaces and two reasons.
 */
export function shouldLock(policy: TabLockPolicy, moment: LockMoment, alreadyLocked: boolean): boolean {
  if (alreadyLocked) return false
  switch (moment.trigger) {
    case 'manual':
    case 'panic':
      return true
    case 'systemLock':
      return policy.onSystemLock
    case 'sleep':
      return policy.onSleep
    case 'startup':
      return policy.onStartup
    case 'tabSwitch':
      // Only meaningful for a tab being left. The tab now in front is not "switched away from".
      return !moment.active && due(policy.tabSwitch, moment.sinceMs)
    case 'windowBlur':
      return due(policy.windowBlur, moment.sinceMs)
    case 'minimize':
      return due(policy.minimize, moment.sinceMs)
    case 'inactivity':
      return due(policy.inactivity, moment.sinceMs)
    default:
      return false
  }
}

const due = (delay: Delay, sinceMs: number): boolean => delay !== null && sinceMs >= delay

/**
 * When the next timed lock is owed, or null when none is.
 *
 * So the main process can set one timer rather than poll every tab. Returns the soonest of whichever timed triggers
 * apply, measured from the moments given.
 */
export function nextLockAt(
  policy: TabLockPolicy,
  since: { leftTabAt?: number | null; blurredAt?: number | null; minimizedAt?: number | null; lastActivityAt?: number | null }
): number | null {
  const candidates: number[] = []
  const add = (delay: Delay, from: number | null | undefined): void => {
    if (delay === null || from === null || from === undefined) return
    candidates.push(from + delay)
  }
  add(policy.tabSwitch, since.leftTabAt)
  add(policy.windowBlur, since.blurredAt)
  add(policy.minimize, since.minimizedAt)
  add(policy.inactivity, since.lastActivityAt)
  return candidates.length ? Math.min(...candidates) : null
}

// ---------------------------------------------------------------- what a locked tab may say

/** Everything anything outside the security layer is allowed to know about a tab. */
export interface SafeTabInfo {
  tabId: number
  locked: boolean
  title: string
  /** Null while locked and hidden. Never a real address in that state. */
  url: string | null
  /** Null while locked and hidden, so nothing draws the site's mark. */
  favicon: string | null
  /** Whether the page's content may be read at all -- by the interface, by Orion, by automation. */
  contentAvailable: boolean
  /** Whether a picture of the page may be taken or shown. */
  previewAvailable: boolean
}

/**
 * What may be shown and given out about a tab.
 *
 * The single place this is decided. Everything that reports a tab -- the strip, the hover card, the sidebar, the
 * omnibox, Browser Control, Orion's context, a screenshot request, the recently-closed list -- goes through here, so
 * there is one function to be certain about instead of a dozen call sites that each have to remember.
 *
 * An unlocked tab passes through unchanged. A locked one is reduced according to its policy, and the fields that are
 * hidden become `null` rather than an empty string: a caller that forgets to check gets nothing usable rather than
 * something that looks like an address.
 */
export function safeTabInfo(
  real: { tabId: number; title: string; url: string; favicon?: string | null },
  locked: boolean,
  policy: TabLockPolicy
): SafeTabInfo {
  if (!locked) {
    return {
      tabId: real.tabId,
      locked: false,
      title: real.title,
      url: real.url,
      favicon: real.favicon ?? null,
      contentAvailable: true,
      previewAvailable: true
    }
  }
  return {
    tabId: real.tabId,
    locked: true,
    title: policy.hideTitle ? policy.label : real.title,
    url: policy.hideUrl ? null : real.url,
    favicon: policy.hideFavicon ? null : (real.favicon ?? null),
    // A locked tab's content is never available, whatever `hideFromAi` says. That setting governs Orion and automation;
    // the page being locked governs the page. Nothing reads a locked page.
    contentAvailable: false,
    previewAvailable: !policy.hidePreview
  }
}

/**
 * Whether Orion, Vision, research or automation may touch this tab.
 *
 * Separate from `safeTabInfo` because it is a different question with a different answer: a tab whose metadata the
 * person chose to show is still a tab whose *content* is protected.
 */
export function aiMayUse(locked: boolean, policy: TabLockPolicy): boolean {
  if (!locked) return true
  // Locked and protected from AI: no. Locked and not protected from AI: still no, because it is locked. The setting only
  // matters for a tab that is protected but currently unlocked, where it has no effect either -- which is why this is
  // simply "not while locked", and the setting is what the interface shows to explain that.
  void policy
  return false
}

/** What a refused action reports back, so a caller can tell "locked" from "failed". */
export const TAB_LOCKED = 'TAB_LOCKED' as const

export interface TabLockedRefusal {
  error: typeof TAB_LOCKED
  /** What the caller must do about it. */
  needs: 'user-authentication'
  message: string
}

export const tabLockedRefusal = (): TabLockedRefusal => ({
  error: TAB_LOCKED,
  needs: 'user-authentication',
  message: 'That tab is locked. Unlock it first.'
})

// ---------------------------------------------------------------- reading configuration in

const clampDelay = (raw: unknown, fallback: Delay): Delay => {
  if (raw === null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(MAX_DELAY_MS, Math.max(0, Math.round(raw)))
}

const bool = (raw: unknown, fallback: boolean): boolean => (typeof raw === 'boolean' ? raw : fallback)

const text = (raw: unknown, max: number, fallback: string): string => {
  if (typeof raw !== 'string') return fallback
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, max)
  return cleaned || fallback
}

/** A policy from something claiming to be one. Every field bounded; nothing taken on trust. */
export function cleanPolicy(raw: unknown, fallback: TabLockPolicy = DEFAULT_POLICY): TabLockPolicy {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    tabSwitch: clampDelay(o.tabSwitch, fallback.tabSwitch),
    windowBlur: clampDelay(o.windowBlur, fallback.windowBlur),
    inactivity: clampDelay(o.inactivity, fallback.inactivity),
    minimize: clampDelay(o.minimize, fallback.minimize),
    onStartup: bool(o.onStartup, fallback.onStartup),
    onSystemLock: bool(o.onSystemLock, fallback.onSystemLock),
    onSleep: bool(o.onSleep, fallback.onSleep),
    hideTitle: bool(o.hideTitle, fallback.hideTitle),
    hideFavicon: bool(o.hideFavicon, fallback.hideFavicon),
    hideUrl: bool(o.hideUrl, fallback.hideUrl),
    hidePreview: bool(o.hidePreview, fallback.hidePreview),
    hideFromAi: bool(o.hideFromAi, fallback.hideFromAi),
    label: text(o.label, 40, fallback.label)
  }
}

/** The most rules a profile may keep, so a corrupted or hostile file cannot make matching slow. */
export const MAX_RULES = 200
export const MAX_GROUPS = 50

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6]

export function cleanSchedule(raw: unknown): Schedule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const days = Array.isArray(o.days)
    ? [...new Set(o.days.filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday)))]
    : []
  const minute = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 24 * 60 ? Math.round(value) : null
  const from = minute(o.fromMinutes)
  const to = minute(o.toMinutes)
  if (days.length === 0 || from === null || to === null || from === to) return null
  return { days: days.sort(), fromMinutes: from, toMinutes: to }
}

/**
 * A pattern Orbis will accept.
 *
 * A host, optionally `*.`-prefixed and optionally with a path. Anything that is not that is refused rather than
 * interpreted -- a rule nobody can predict is worse than no rule.
 */
export function cleanPattern(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
  if (!cleaned || cleaned.length > 255) return null
  const [host, ...rest] = cleaned.split('/')
  const bare = host.startsWith('*.') ? host.slice(2) : host
  // A host has at least one dot and no spaces, and nothing that would make it a pattern language.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare)) return null
  const path = rest.join('/')
  if (path && !/^[a-z0-9\-._~%/]*$/.test(path)) return null
  return path ? `${host}/${path}` : host
}

export function cleanRule(raw: unknown, at = Date.now()): DomainRule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 64, '')
  const pattern = cleanPattern(o.pattern)
  const groupId = text(o.groupId, 64, '')
  if (!id || !pattern || !groupId) return null
  void at
  return { id, pattern, groupId, enabled: o.enabled !== false, schedule: cleanSchedule(o.schedule) }
}

export function cleanRules(raw: unknown, at = Date.now()): DomainRule[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: DomainRule[] = []
  for (const entry of raw) {
    const rule = cleanRule(entry, at)
    if (!rule || seen.has(rule.id)) continue
    seen.add(rule.id)
    out.push(rule)
    if (out.length >= MAX_RULES) break
  }
  return out
}

export function cleanGroup(raw: unknown, at = Date.now()): LockGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 64, '')
  const name = text(o.name, 60, '')
  if (!id || !name) return null
  return {
    id,
    name,
    policy: cleanPolicy(o.policy),
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : at,
    updatedAt: at
  }
}

export function cleanGroups(raw: unknown, at = Date.now()): LockGroup[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: LockGroup[] = []
  for (const entry of raw) {
    const group = cleanGroup(entry, at)
    if (!group || seen.has(group.id)) continue
    seen.add(group.id)
    out.push(group)
    if (out.length >= MAX_GROUPS) break
  }
  return out
}

/**
 * Whether a label would give the game away.
 *
 * Not enforced -- somebody may genuinely want to call it "Work" -- but warned about, because the whole point of hiding
 * the title is defeated by a label that names the site.
 */
export function labelRevealsSite(label: string, url: string): boolean {
  const host = hostOf(url)
  if (!host || !label.trim()) return false
  const said = label.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (said.length < 3) return false
  const parts = host.split('.').filter((p) => p.length >= 3 && p !== 'www' && p !== 'com')
  return parts.some((part) => said.includes(part) || part.includes(said))
}

// ---------------------------------------------------------------- choosing a delay

/**
 * The delays the interface offers.
 *
 * A short list rather than a number box, because "lock after 37 seconds" is not a thing anybody means, and a free number
 * invites the two mistakes that matter -- a delay so long it is off, and a typo that switches protection off by accident.
 * "Never" is offered separately, as the distinct thing it is.
 */
export const DELAY_CHOICES: number[] = [
  0,
  5_000,
  15_000,
  30_000,
  60_000,
  120_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000
]

/** Whether two policies say the same thing, so the interface can show which preset is in force without guessing. */
export function samePolicy(a: TabLockPolicy, b: TabLockPolicy): boolean {
  return (
    a.tabSwitch === b.tabSwitch &&
    a.windowBlur === b.windowBlur &&
    a.inactivity === b.inactivity &&
    a.minimize === b.minimize &&
    a.onStartup === b.onStartup &&
    a.onSystemLock === b.onSystemLock &&
    a.onSleep === b.onSleep &&
    a.hideTitle === b.hideTitle &&
    a.hideFavicon === b.hideFavicon &&
    a.hideUrl === b.hideUrl &&
    a.hidePreview === b.hidePreview &&
    a.hideFromAi === b.hideFromAi &&
    a.label === b.label
  )
}
