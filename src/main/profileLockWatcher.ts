import {
  DEFAULT_PROFILE_LOCK,
  nextProfileLockAt,
  shouldLockProfile,
  stayLockedAfterSystemUnlock,
  type ProfileLockPolicy,
  type ProfileLockTrigger
} from '../shared/profileLock.ts'

/**
 * When the profile locks itself.
 *
 * The decisions are in `shared/profileLock.ts`; this is what watches for the moments that lead to them. It holds one
 * timer, not one per trigger, and it asks the operating system how long the computer has been idle rather than guessing
 * from what Orbis happens to have seen -- somebody working in another window is not idle, and a profile that locked while
 * they were plainly using the computer is a profile they would switch off.
 *
 * Nothing here holds a password or decides whether one is right. Locking means telling the account layer to forget its
 * key; unlocking is that layer's business and needs the password.
 */

export interface ProfileLockWatcherOptions {
  /** The policy in force, read when needed rather than cached, so a change in Settings takes effect at once. */
  policy(): ProfileLockPolicy
  /** Whether the profile is locked now. Asked of the account layer, which is the one authority on it. */
  isLocked(): boolean
  /**
   * Locks it. Expected to forget the account key and tell the window to put the unlock screen up.
   *
   * Returns nothing and is allowed to be called when already locked -- `shouldLockProfile` refuses that case, but a
   * second caller arriving in the same tick must not produce two lock screens.
   */
  lock(trigger: ProfileLockTrigger): void
  /**
   * How long the computer has been idle, in milliseconds, by the operating system's own reckoning.
   *
   * Electron's `powerMonitor.getSystemIdleTime()` in seconds, multiplied. Null when it cannot be asked, in which case
   * inactivity locking does not happen at all rather than happening on a guess.
   */
  idleMs(): number | null
  now?(): number
  /** Sets the one timer. Replaceable so tests need no real clock. */
  schedule?(atMs: number, run: () => void): () => void
}

/**
 * How often idleness is looked at while a delay is pending.
 *
 * The operating system will not tell us when the computer becomes idle, so this is the one thing here that is checked
 * rather than waited for. It is only armed while an inactivity delay is set and the profile is unlocked, and the interval
 * is a quarter of the delay -- four looks per delay period, which bounds how late a lock can be to a quarter of what was
 * asked for. A fifteen-minute policy looks every three and three-quarter minutes; never more often than every fifteen
 * seconds and never less often than every five minutes, whatever the delay.
 */
const MIN_IDLE_CHECK_MS = 15_000
const MAX_IDLE_CHECK_MS = 5 * 60_000

export const idleCheckInterval = (delay: number): number =>
  Math.min(MAX_IDLE_CHECK_MS, Math.max(MIN_IDLE_CHECK_MS, Math.round(delay / 4)))

export class ProfileLockWatcher {
  private readonly o: ProfileLockWatcherOptions
  private readonly now: () => number
  private blurredAt: number | null = null
  private cancelTimer: (() => void) | null = null
  private stopped = false

  constructor(options: ProfileLockWatcherOptions) {
    this.o = options
    this.now = options.now ?? Date.now
  }

  // ---------------------------------------------------------------- the moments

  /** Orbis has started. */
  started(): boolean {
    return this.consider('start', 0)
  }

  /** The computer's own session locked. */
  systemLocked(): boolean {
    return this.consider('systemLock', 0)
  }

  /**
   * The computer's own session unlocked.
   *
   * Two separate things happen here. If the policy says to require the password whenever the computer is unlocked, this
   * locks. And whatever the policy, the blur clock starts again from now -- because Orbis has not "been out of focus"
   * for the whole time the computer was locked in any sense a person would mean.
   */
  systemUnlocked(): boolean {
    this.blurredAt = null
    const locked = this.consider('systemUnlock', 0)
    this.rearm()
    return locked
  }

  /** The computer woke from sleep. */
  resumed(): boolean {
    // The idle clock is meaningless across a sleep, and the blur clock nearly so. Both start again.
    this.blurredAt = null
    const locked = this.consider('resume', 0)
    this.rearm()
    return locked
  }

  focusChanged(focused: boolean): boolean {
    this.blurredAt = focused ? null : this.now()
    const locked = focused ? false : this.consider('blur', 0)
    this.rearm()
    return locked
  }

  /** The last Orbis window closed. */
  allWindowsClosed(): boolean {
    return this.consider('allWindowsClosed', 0)
  }

  /** Somebody asked. Always locks, even with Profile Lock switched off. */
  lockNow(): boolean {
    return this.consider('manual', 0)
  }

  /** Whether the computer unlocking should leave Orbis locked, for the window to act on. */
  staysLockedAfterSystemUnlock(): boolean {
    return stayLockedAfterSystemUnlock(this.o.policy())
  }

  // ---------------------------------------------------------------- the clock

  /**
   * Starts watching. Idempotent.
   *
   * Called once Orbis knows which profile it is on. Before that there is no policy to act on, and acting on the default
   * would mean the wrong profile's rules for a moment.
   */
  start(): void {
    this.stopped = false
    this.rearm()
  }

  stop(): void {
    this.stopped = true
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  /** Called when the policy changes, so a new delay takes effect without waiting out the old one. */
  policyChanged(): void {
    this.rearm()
  }

  /** Called when the profile is unlocked, so the clocks start again from a person having just been there. */
  unlocked(): void {
    this.blurredAt = null
    this.rearm()
  }

  private consider(trigger: ProfileLockTrigger, sinceMs: number): boolean {
    if (this.stopped && trigger !== 'manual') return false
    const policy = this.o.policy()
    if (!shouldLockProfile(policy, { trigger, sinceMs }, this.o.isLocked())) return false
    this.o.lock(trigger)
    // Nothing more is owed once it is locked: the next thing that matters is somebody typing the password.
    this.cancelTimer?.()
    this.cancelTimer = null
    return true
  }

  /**
   * Sets the one timer, for whichever of the two waiting triggers is due first.
   *
   * Idleness is the awkward one: nothing tells us when the computer becomes idle, so the timer is set for when it *could*
   * next be due, and if it is not, another is set. That is a handful of wake-ups an hour rather than a poll.
   */
  private rearm(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
    if (this.stopped) return

    const policy = this.o.policy()
    if (!policy.enabled || this.o.isLocked()) return

    const idle = policy.inactivity === null ? null : this.o.idleMs()
    const at = this.now()
    const due = nextProfileLockAt(policy, { idleSinceMs: idle, blurredAt: this.blurredAt }, at)

    let when = due
    if (policy.inactivity !== null && idle !== null) {
      // Look again before the moment it could be due, so a computer that went idle a second after the last look is not
      // locked a whole delay late.
      const next = at + idleCheckInterval(policy.inactivity)
      when = when === null ? next : Math.min(when, next)
    }
    if (when === null) return

    const schedule =
      this.o.schedule ??
      ((atMs: number, run: () => void): (() => void) => {
        const timer = setTimeout(run, Math.max(0, atMs - this.now()))
        timer.unref?.()
        return () => clearTimeout(timer)
      })

    this.cancelTimer = schedule(when, () => {
      this.cancelTimer = null
      const nowPolicy = this.o.policy()
      const idleNow = this.o.idleMs()
      if (nowPolicy.inactivity !== null && idleNow !== null) {
        this.consider('inactivity', idleNow)
      }
      if (this.blurredAt !== null) {
        this.consider('blur', this.now() - this.blurredAt)
      }
      this.rearm()
    })
  }
}

/** A policy that does nothing, for before a profile is known. */
export const noProfileLock = (): ProfileLockPolicy => DEFAULT_PROFILE_LOCK
