import type { Delay } from './tabLock.ts'
import { MAX_DELAY_MS, describeDelay } from './tabLock.ts'

/**
 * When the whole Orbis profile locks, and what that means.
 *
 * A different thing from Tab Lock, and deliberately kept a different thing. Tab Lock hides one tab from somebody looking
 * at the browser; Profile Lock puts Orbis itself away and asks for the account password. One protects a page from a
 * passer-by, the other protects the whole profile from whoever sits down at the computer next.
 *
 * All of the deciding, and none of the doing -- the same split as `tabLock.ts`, for the same reason. Nothing here touches
 * a window, a timer or a file.
 *
 * **Only triggers Orbis can really observe.** Every one of these corresponds to a real Electron event or a real reading:
 * `powerMonitor`'s `lock-screen`, `resume` and `suspend`; a window's `blur`; `window-all-closed`; the application
 * starting; and `powerMonitor.getSystemIdleTime`, which is the operating system's own idea of how long nobody has
 * touched the machine. A screen-saver trigger is not offered, because Electron cannot tell us about one and a setting
 * that quietly never fires is worse than no setting.
 */

export interface ProfileLockPolicy {
  /** Whether Profile Lock is on at all. Off means every other field here is inert. */
  enabled: boolean
  /**
   * How long the computer must be idle, by the operating system's own reckoning, before Orbis locks.
   *
   * The system's idle time rather than ours, because somebody working in another window is not idle -- and a profile that
   * locked while they were plainly using the computer is a profile they would turn this off over.
   */
  inactivity: Delay
  /** Locked when Orbis starts. */
  onStart: boolean
  /** Locked when the computer wakes from sleep. */
  onResume: boolean
  /** Locked when the computer's own session locks. */
  onSystemLock: boolean
  /** How long after Orbis stops being the window in front. */
  onBlur: Delay
  /** Locked when the last Orbis window is closed. */
  onAllWindowsClosed: boolean
  /**
   * What happens when the computer's session unlocks again.
   *
   * `stay-locked` leaves Orbis locked whatever locked it. `require-password` locks it now if it was not already, so that
   * coming back to the computer always means typing the account password. `restore` leaves things exactly as they were
   * before the computer locked -- which, if Orbis was open, means it is open again.
   */
  afterSystemUnlock: 'stay-locked' | 'require-password' | 'restore'
}

/**
 * Off.
 *
 * A profile lock nobody asked for is a password prompt nobody expected, and the first thing it would teach somebody is
 * how to turn the whole feature off. It is offered, explained, and left alone until it is switched on -- and when it is,
 * the values below are what it starts as.
 */
export const DEFAULT_PROFILE_LOCK: ProfileLockPolicy = {
  enabled: false,
  inactivity: 15 * 60_000,
  onStart: true,
  onResume: true,
  onSystemLock: true,
  onBlur: null,
  onAllWindowsClosed: false,
  afterSystemUnlock: 'stay-locked'
}

export type ProfileLockPreset = 'standard' | 'strong' | 'shared-computer'

export const PROFILE_LOCK_PRESETS: Record<ProfileLockPreset, ProfileLockPolicy> = {
  /** Locked when the computer is, when it wakes, and after a quarter of an hour of nobody touching it. */
  standard: { ...DEFAULT_PROFILE_LOCK, enabled: true },
  /** The same, sooner, and when Orbis is put away for a minute. */
  strong: { ...DEFAULT_PROFILE_LOCK, enabled: true, inactivity: 5 * 60_000, onBlur: 60_000 },
  /** A computer other people use: away from the keyboard means locked. */
  'shared-computer': {
    ...DEFAULT_PROFILE_LOCK,
    enabled: true,
    inactivity: 60_000,
    onBlur: 0,
    onAllWindowsClosed: true,
    afterSystemUnlock: 'require-password'
  }
}

export type ProfileLockTrigger =
  | 'manual'
  | 'inactivity'
  | 'start'
  | 'resume'
  | 'systemLock'
  | 'systemUnlock'
  | 'blur'
  | 'allWindowsClosed'

export const PROFILE_LOCK_TRIGGERS: ProfileLockTrigger[] = [
  'manual',
  'inactivity',
  'start',
  'resume',
  'systemLock',
  'systemUnlock',
  'blur',
  'allWindowsClosed'
]

export interface ProfileLockMoment {
  trigger: ProfileLockTrigger
  /** How long ago it happened, for the two triggers that wait. */
  sinceMs: number
}

const due = (delay: Delay, sinceMs: number): boolean => delay !== null && sinceMs >= delay

/**
 * Whether the profile should lock, given what just happened.
 *
 * `manual` always locks, even when Profile Lock is switched off -- somebody asked, and refusing on the grounds that a
 * setting is off would be refusing to do the safe thing. Everything else needs the feature on, and a profile that is
 * already locked is never locked again.
 */
export function shouldLockProfile(
  policy: ProfileLockPolicy,
  moment: ProfileLockMoment,
  alreadyLocked: boolean
): boolean {
  if (alreadyLocked) return false
  if (moment.trigger === 'manual') return true
  if (!policy.enabled) return false
  switch (moment.trigger) {
    case 'inactivity':
      return due(policy.inactivity, moment.sinceMs)
    case 'blur':
      return due(policy.onBlur, moment.sinceMs)
    case 'start':
      return policy.onStart
    case 'resume':
      return policy.onResume
    case 'systemLock':
      return policy.onSystemLock
    case 'allWindowsClosed':
      return policy.onAllWindowsClosed
    case 'systemUnlock':
      // Only `require-password` locks here; the other two either leave it locked already or deliberately do not.
      return policy.afterSystemUnlock === 'require-password'
    default:
      return false
  }
}

/**
 * Whether the computer unlocking should leave Orbis locked.
 *
 * Separate from `shouldLockProfile`, because this is about *staying* locked rather than becoming locked, and the two
 * questions have different answers under `restore`: it does not lock, and it does not insist on staying locked either.
 */
export function stayLockedAfterSystemUnlock(policy: ProfileLockPolicy): boolean {
  return policy.afterSystemUnlock !== 'restore'
}

/** When the next timed lock is owed, or null. One timer for the profile, as with tabs. */
export function nextProfileLockAt(
  policy: ProfileLockPolicy,
  since: { idleSinceMs?: number | null; blurredAt?: number | null },
  now: number
): number | null {
  if (!policy.enabled) return null
  const candidates: number[] = []
  if (policy.inactivity !== null && typeof since.idleSinceMs === 'number') {
    // The operating system says how long it has been idle, so the moment it became idle is now minus that.
    candidates.push(now - since.idleSinceMs + policy.inactivity)
  }
  if (policy.onBlur !== null && typeof since.blurredAt === 'number') {
    candidates.push(since.blurredAt + policy.onBlur)
  }
  return candidates.length ? Math.min(...candidates) : null
}

const clampDelay = (raw: unknown, fallback: Delay): Delay => {
  if (raw === null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(Math.max(Math.round(raw), 0), MAX_DELAY_MS)
}

const bool = (raw: unknown, fallback: boolean): boolean => (typeof raw === 'boolean' ? raw : fallback)

/** A policy read from a file or an import, made safe. Anything unrecognised keeps the value it already had. */
export function cleanProfileLockPolicy(
  raw: unknown,
  fallback: ProfileLockPolicy = DEFAULT_PROFILE_LOCK
): ProfileLockPolicy {
  const o = (raw ?? {}) as Record<string, unknown>
  const after = o.afterSystemUnlock
  return {
    enabled: bool(o.enabled, fallback.enabled),
    inactivity: clampDelay(o.inactivity, fallback.inactivity),
    onStart: bool(o.onStart, fallback.onStart),
    onResume: bool(o.onResume, fallback.onResume),
    onSystemLock: bool(o.onSystemLock, fallback.onSystemLock),
    onBlur: clampDelay(o.onBlur, fallback.onBlur),
    onAllWindowsClosed: bool(o.onAllWindowsClosed, fallback.onAllWindowsClosed),
    afterSystemUnlock:
      after === 'stay-locked' || after === 'require-password' || after === 'restore'
        ? after
        : fallback.afterSystemUnlock
  }
}

/**
 * What this policy actually does, in sentences.
 *
 * So the settings screen can say what is in force rather than leaving somebody to read seven switches and work it out --
 * and so that a policy which does nothing says so, which is the case people most often do not notice.
 */
export function describeProfileLock(policy: ProfileLockPolicy): string[] {
  if (!policy.enabled) return ['Orbis does not lock itself.']
  const said: string[] = []
  if (policy.onSystemLock) said.push('Locks when this computer locks.')
  if (policy.onResume) said.push('Locks when this computer wakes.')
  if (policy.onStart) said.push('Locks when Orbis starts.')
  if (policy.inactivity !== null) {
    said.push(`Locks after ${describeDelay(policy.inactivity)} of nobody touching this computer.`)
  }
  if (policy.onBlur !== null) {
    said.push(`Locks ${describeDelay(policy.onBlur)} after Orbis stops being the window in front.`)
  }
  if (policy.onAllWindowsClosed) said.push('Locks when the last Orbis window closes.')
  if (policy.afterSystemUnlock === 'require-password') {
    said.push('Asks for your account password whenever this computer is unlocked.')
  } else if (policy.afterSystemUnlock === 'restore') {
    said.push('Unlocking this computer leaves Orbis as it was.')
  }
  if (said.length === 0) {
    // On, with nothing switched on inside it. Worth saying out loud: it looks protected and is not.
    said.push('Profile Lock is on, but nothing is set to trigger it. Only locking Orbis yourself will lock it.')
  }
  return said
}
