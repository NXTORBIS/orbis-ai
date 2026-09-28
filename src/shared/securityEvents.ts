/**
 * What Orbis records about its own security, and what it refuses to record.
 *
 * The point of a log like this is for somebody to notice something they did not do -- a lock they did not ask for, an
 * attempt they did not make. That only works if it is complete enough to be worth reading and empty enough to be safe to
 * keep, and those pull in opposite directions.
 *
 * So the shape is fixed here, in a file that has no way of writing anything: an event is a kind, a time, and at most a
 * tab id and the name of a tab password. There is no field for an address, a title, a page, a password, a key, an
 * attempt, or anything typed. A log that cannot hold those cannot leak them, which is a stronger guarantee than one that
 * carefully avoids writing them.
 */

export type SecurityEventKind =
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_PASSWORD_CHANGED'
  | 'ACCOUNT_UNLOCKED'
  | 'ACCOUNT_LOCKED'
  | 'PROFILE_LOCKED'
  | 'PROFILE_UNLOCKED'
  | 'TAB_PROTECTED'
  | 'TAB_UNPROTECTED'
  | 'TAB_LOCKED'
  | 'TAB_UNLOCKED'
  | 'TAB_AUTO_LOCKED'
  | 'TAB_PASSWORD_CREATED'
  | 'TAB_PASSWORD_CHANGED'
  | 'TAB_PASSWORD_RESET'
  | 'TAB_PASSWORD_REMOVED'
  | 'FAILED_TAB_UNLOCK'
  | 'FAILED_ACCOUNT_UNLOCK'
  | 'WINDOW_LOCK_DETECTED'
  | 'SYSTEM_SLEEP_DETECTED'
  | 'PANIC_LOCK'
  | 'RULE_ADDED'
  | 'RULE_REMOVED'
  | 'POLICY_CHANGED'

export const SECURITY_EVENT_KINDS: SecurityEventKind[] = [
  'ACCOUNT_CREATED',
  'ACCOUNT_PASSWORD_CHANGED',
  'ACCOUNT_UNLOCKED',
  'ACCOUNT_LOCKED',
  'PROFILE_LOCKED',
  'PROFILE_UNLOCKED',
  'TAB_PROTECTED',
  'TAB_UNPROTECTED',
  'TAB_LOCKED',
  'TAB_UNLOCKED',
  'TAB_AUTO_LOCKED',
  'TAB_PASSWORD_CREATED',
  'TAB_PASSWORD_CHANGED',
  'TAB_PASSWORD_RESET',
  'TAB_PASSWORD_REMOVED',
  'FAILED_TAB_UNLOCK',
  'FAILED_ACCOUNT_UNLOCK',
  'WINDOW_LOCK_DETECTED',
  'SYSTEM_SLEEP_DETECTED',
  'PANIC_LOCK',
  'RULE_ADDED',
  'RULE_REMOVED',
  'POLICY_CHANGED'
]

/**
 * One thing that happened.
 *
 * Every field is optional except the two that have to be there. Note what there is no field for: this is the whole shape,
 * and adding an address or a page to it would be a change somebody had to make deliberately and could be argued with.
 */
export interface SecurityEvent {
  kind: SecurityEventKind
  at: number
  /** Which tab, when the event is about one. A number, never an address. */
  tabId?: number
  /**
   * The name of the tab password involved -- the person's own word for it, like "Banking".
   *
   * A name is not a credential and not a site. It is included because "the Banking password was reset" is the sentence
   * somebody needs in order to notice that it was not them.
   */
  password?: string
  /** What caused it, for the automatic ones: a lock trigger, or a profile-lock trigger. */
  by?: string
  /** How many, for the events that are about several things at once. */
  count?: number
}

/** The most that is kept. Old enough to be no use for noticing anything, and long enough to notice something in. */
export const MAX_SECURITY_EVENTS = 500

/** What a person is shown for each kind. Written here so the log reads as sentences rather than as constants. */
const SAYS: Record<SecurityEventKind, string> = {
  ACCOUNT_CREATED: 'Account password set',
  ACCOUNT_PASSWORD_CHANGED: 'Account password changed',
  ACCOUNT_UNLOCKED: 'Orbis unlocked',
  ACCOUNT_LOCKED: 'Orbis locked',
  PROFILE_LOCKED: 'Orbis locked itself',
  PROFILE_UNLOCKED: 'Orbis unlocked',
  TAB_PROTECTED: 'A tab was given a tab password',
  TAB_UNPROTECTED: 'A tab stopped being protected',
  TAB_LOCKED: 'A tab was locked',
  TAB_UNLOCKED: 'A tab was unlocked',
  TAB_AUTO_LOCKED: 'A tab locked itself',
  TAB_PASSWORD_CREATED: 'A tab password was made',
  TAB_PASSWORD_CHANGED: 'A tab password was changed',
  TAB_PASSWORD_RESET: 'A tab password was reset with the account password',
  TAB_PASSWORD_REMOVED: 'A tab password was removed',
  FAILED_TAB_UNLOCK: 'Wrong tab password',
  FAILED_ACCOUNT_UNLOCK: 'Wrong account password',
  WINDOW_LOCK_DETECTED: 'This computer locked',
  SYSTEM_SLEEP_DETECTED: 'This computer slept',
  PANIC_LOCK: 'Everything protected was locked at once',
  RULE_ADDED: 'A site was set to protect itself',
  RULE_REMOVED: 'A site stopped protecting itself',
  POLICY_CHANGED: 'Security settings changed'
}

/** Which of these are worth noticing rather than merely worth recording. The interface marks them. */
const NOTABLE = new Set<SecurityEventKind>([
  'FAILED_TAB_UNLOCK',
  'FAILED_ACCOUNT_UNLOCK',
  'TAB_PASSWORD_RESET',
  'TAB_PASSWORD_REMOVED',
  'TAB_UNPROTECTED',
  'PANIC_LOCK'
])

export const isNotable = (kind: SecurityEventKind): boolean => NOTABLE.has(kind)

/** One event, as a sentence. The trigger and the password's name are added where they make it clearer. */
export function describeSecurityEvent(event: SecurityEvent): string {
  const base = SAYS[event.kind] ?? 'Something happened'
  const parts: string[] = [base]
  if (event.password) parts.push(`(${event.password})`)
  if (event.count !== undefined && event.count > 1) parts.push(`— ${event.count} tabs`)
  if (event.by) {
    const because: Record<string, string> = {
      tabSwitch: 'after leaving it',
      windowBlur: 'after Orbis lost focus',
      inactivity: 'after inactivity',
      minimize: 'after Orbis was minimised',
      startup: 'when Orbis started',
      systemLock: 'when this computer locked',
      sleep: 'when this computer slept',
      panic: 'because everything was locked at once',
      manual: '',
      blur: 'after Orbis lost focus',
      start: 'when Orbis started',
      resume: 'when this computer woke',
      systemUnlock: 'when this computer was unlocked',
      allWindowsClosed: 'when the last window closed'
    }
    const said = because[event.by]
    if (said) parts.push(said)
  }
  return parts.join(' ')
}

/**
 * An event, made safe.
 *
 * Anything that is not one of the fields above is dropped -- not sanitised, dropped. A caller that tried to record an
 * address would find it simply was not there afterwards, which is the behaviour to want: the mistake fails visibly in a
 * test rather than quietly in a log file.
 */
export function cleanSecurityEvent(raw: unknown, at = Date.now()): SecurityEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = o.kind
  if (typeof kind !== 'string' || !SECURITY_EVENT_KINDS.includes(kind as SecurityEventKind)) return null

  const event: SecurityEvent = {
    kind: kind as SecurityEventKind,
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : at
  }
  if (typeof o.tabId === 'number' && Number.isInteger(o.tabId)) event.tabId = o.tabId
  if (typeof o.password === 'string' && o.password.trim()) event.password = o.password.trim().slice(0, 60)
  if (typeof o.by === 'string' && o.by.trim()) event.by = o.by.trim().slice(0, 40)
  if (typeof o.count === 'number' && Number.isInteger(o.count) && o.count > 0) event.count = o.count
  return event
}

/** A list of events, newest first, trimmed to what is kept. */
export function cleanSecurityEvents(raw: unknown): SecurityEvent[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((one) => cleanSecurityEvent(one))
    .filter((one): one is SecurityEvent => one !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_SECURITY_EVENTS)
}
