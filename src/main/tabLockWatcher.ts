import {
  DEFAULT_POLICY,
  effectivePolicy,
  nextLockAt,
  ruleFor,
  safeTabInfo,
  shouldLock,
  type DomainRule,
  type LockTrigger,
  type SafeTabInfo,
  type TabLockPolicy,
  type TabSecurity
} from '../shared/tabLock.ts'

/**
 * Which tabs are locked, right now.
 *
 * The decisions are all in `shared/tabLock.ts`; this is what remembers what has happened and asks them. It keeps, per
 * tab, whether it is protected and by which credential, whether it is locked, and the moments the timed triggers are
 * measured from -- and it runs **one** timer for all of them rather than a timer per tab, because a browser with fifty
 * protected tabs should not have fifty timers.
 *
 * Nothing here reads a page, and nothing here holds a password. It is bookkeeping with a clock.
 */

export interface TabInfo {
  tabId: number
  title: string
  url: string
  favicon?: string | null
}

export interface TabLockWatcherOptions {
  /** The credentials and their policies, and the profile's default. Read on demand, never cached here. */
  config(): { groups: Map<string, TabLockPolicy>; rules: DomainRule[]; fallback: TabLockPolicy }
  /** Whether a credential has been opened this session. A closed one means its tabs are locked whatever this thinks. */
  isGroupOpen(groupId: string): boolean
  /** Told whenever a tab's locked state changes, so the browser can put the lock surface up or take it down. */
  onChanged(tabId: number, locked: boolean, reason: LockTrigger | null): void
  /** Sets the one timer. Replaceable so tests need no real clock. */
  schedule?(atMs: number, run: () => void): () => void
  now?(): number
}

export class TabLockWatcher {
  private readonly o: TabLockWatcherOptions
  private readonly now: () => number
  private readonly tabs = new Map<number, TabSecurity>()
  /** The moments the timed triggers are measured from, per tab. */
  private readonly moments = new Map<
    number,
    { leftTabAt: number | null; lastActivityAt: number | null }
  >()
  private blurredAt: number | null = null
  private minimizedAt: number | null = null
  private cancelTimer: (() => void) | null = null
  /**
   * The tab in front.
   *
   * Kept here so that asking "is the tab this command would act on locked" can be answered without a round trip to the
   * browser. A command with no tab named acts on the active one, and that question has to be answerable synchronously --
   * the gate in the control layer runs before anything is observed, and making it asynchronous would mean a window in
   * which a locked tab was being read while the answer was still in flight.
   */
  private activeTabId: number | null = null

  constructor(options: TabLockWatcherOptions) {
    this.o = options
    this.now = options.now ?? Date.now
  }

  // ---------------------------------------------------------------- what is protected

  /**
   * The policy in force for a tab.
   *
   * Its own overrides, then its credential's, then the profile's. A domain rule chooses the credential, so a rule's
   * policy arrives through that rather than as a separate layer.
   */
  policyFor(tabId: number): TabLockPolicy {
    const security = this.tabs.get(tabId)
    const { groups, fallback } = this.o.config()
    const group = security ? (groups.get(security.groupId) ?? null) : null
    return effectivePolicy(fallback, group, security?.policy ?? null)
  }

  isProtected(tabId: number): boolean {
    return this.tabs.has(tabId)
  }

  isLocked(tabId: number): boolean {
    const security = this.tabs.get(tabId)
    if (!security) return false
    // A credential that is not open means its tabs are locked, whatever this last recorded. That is what makes closing a
    // credential -- or switching profile -- lock everything it covered, without having to walk every tab.
    if (!this.o.isGroupOpen(security.groupId)) return true
    return security.locked
  }

  groupOf(tabId: number): string | null {
    return this.tabs.get(tabId)?.groupId ?? null
  }

  /** Every protected tab, for the settings screen and for remembering what was locked when Orbis closes. */
  all(): TabSecurity[] {
    return [...this.tabs.values()].map((t) => ({ ...t, locked: this.isLocked(t.tabId) }))
  }

  // ---------------------------------------------------------------- protecting and unprotecting

  /** Starts protecting a tab. Locked straight away unless told otherwise, because that is what "lock this tab" means. */
  protect(tabId: number, groupId: string, locked = true, by: LockTrigger = 'manual'): void {
    const at = this.now()
    this.tabs.set(tabId, {
      tabId,
      groupId,
      locked,
      lockedBy: locked ? by : null,
      lockedAt: locked ? at : null,
      unlockedAt: locked ? null : at,
      policy: null
    })
    this.moments.set(tabId, { leftTabAt: null, lastActivityAt: at })
    this.o.onChanged(tabId, locked, locked ? by : null)
    this.rearm()
  }

  /**
   * Stops protecting a tab.
   *
   * Only ever from a deliberate choice: nothing automatic unprotects a tab, because the automatic direction is towards
   * privacy and away from it is a decision.
   */
  unprotect(tabId: number): void {
    if (!this.tabs.delete(tabId)) return
    this.moments.delete(tabId)
    this.o.onChanged(tabId, false, null)
    this.rearm()
  }

  /** A tab that has gone. No lock surface to take down; just stop tracking it. */
  forget(tabId: number): void {
    this.tabs.delete(tabId)
    this.moments.delete(tabId)
    this.rearm()
  }

  setTabPolicy(tabId: number, policy: Partial<TabLockPolicy> | null): void {
    const security = this.tabs.get(tabId)
    if (!security) return
    this.tabs.set(tabId, { ...security, policy })
    this.rearm()
  }

  /**
   * Protects a tab because a rule says its address should be.
   *
   * Called when a tab navigates. A tab already protected is left alone -- a rule should not quietly move a tab from one
   * credential to another underneath somebody -- and a tab that navigates *away* from a protected site keeps its
   * protection, because taking it away automatically would mean one redirect could unprotect a tab.
   */
  applyRules(tab: TabInfo): void {
    if (this.tabs.has(tab.tabId)) return
    const { rules } = this.o.config()
    const rule = ruleFor(rules, tab.url, this.now())
    if (!rule) return
    this.protect(tab.tabId, rule.groupId, true, 'manual')
  }

  // ---------------------------------------------------------------- locking and unlocking

  /** Locks one tab. Returns whether anything changed, so callers do not report a lock that was already in place. */
  lock(tabId: number, by: LockTrigger): boolean {
    const security = this.tabs.get(tabId)
    if (!security || this.isLocked(tabId)) return false
    this.tabs.set(tabId, { ...security, locked: true, lockedBy: by, lockedAt: this.now() })
    this.o.onChanged(tabId, true, by)
    this.rearm()
    return true
  }

  /**
   * Marks a tab unlocked.
   *
   * The password was checked elsewhere -- by the store, which holds the credential. This is only the bookkeeping, which
   * is why it takes no password: a function here that took one would be a second place that decided whether a password
   * was right.
   */
  markUnlocked(tabId: number): boolean {
    const security = this.tabs.get(tabId)
    if (!security) return false
    const at = this.now()
    this.tabs.set(tabId, { ...security, locked: false, lockedBy: null, unlockedAt: at })
    this.moments.set(tabId, { leftTabAt: null, lastActivityAt: at })
    this.o.onChanged(tabId, false, null)
    this.rearm()
    return true
  }

  /** Every tab that a credential covers, locked. Used when a credential is closed. */
  lockGroup(groupId: string, by: LockTrigger = 'manual'): number {
    let locked = 0
    for (const security of [...this.tabs.values()]) {
      if (security.groupId === groupId && this.lock(security.tabId, by)) locked++
    }
    return locked
  }

  /** Everything protected, locked, at once. */
  panic(): number {
    let locked = 0
    for (const security of [...this.tabs.values()]) {
      if (this.lock(security.tabId, 'panic')) locked++
    }
    return locked
  }

  // ---------------------------------------------------------------- the things that cause locking

  /** The person moved to another tab. The one they left may lock; the one they arrived at never does. */
  activated(tabId: number): void {
    const at = this.now()
    this.activeTabId = tabId
    for (const [id, moment] of this.moments) {
      if (id === tabId) {
        this.moments.set(id, { leftTabAt: null, lastActivityAt: at })
      } else if (moment.leftTabAt === null) {
        this.moments.set(id, { ...moment, leftTabAt: at })
      }
    }
    this.consider('tabSwitch', tabId)
    this.rearm()
  }

  /** Something happened in a tab, so its inactivity clock starts again. */
  interacted(tabId: number): void {
    const moment = this.moments.get(tabId)
    if (!moment) return
    this.moments.set(tabId, { ...moment, lastActivityAt: this.now() })
    this.rearm()
  }

  focusChanged(focused: boolean): void {
    this.blurredAt = focused ? null : this.now()
    if (!focused) this.consider('windowBlur', null)
    this.rearm()
  }

  minimizeChanged(minimized: boolean): void {
    this.minimizedAt = minimized ? this.now() : null
    if (minimized) this.consider('minimize', null)
    this.rearm()
  }

  /** The computer's own session locked. A switch, not a delay: it happens or it does not. */
  systemLocked(): number {
    return this.fire('systemLock')
  }

  systemSuspended(): number {
    return this.fire('sleep')
  }

  /** Orbis has started. Tabs that were protected when it closed are locked before anything is drawn. */
  started(): number {
    return this.fire('startup')
  }

  private fire(trigger: LockTrigger): number {
    let locked = 0
    for (const security of [...this.tabs.values()]) {
      const policy = this.policyFor(security.tabId)
      if (shouldLock(policy, { trigger, sinceMs: 0, active: false }, this.isLocked(security.tabId))) {
        if (this.lock(security.tabId, trigger)) locked++
      }
    }
    return locked
  }

  /**
   * Whether any tab is now due to lock because of a delayed trigger.
   *
   * `activeTabId` is excluded from `tabSwitch` only -- the tab in front was not left. Every other trigger applies to it
   * like any other, because Orbis losing focus while a protected tab is in front is exactly when it matters.
   */
  private consider(trigger: LockTrigger, activeTabId: number | null): number {
    const at = this.now()
    let locked = 0
    for (const security of [...this.tabs.values()]) {
      const moment = this.moments.get(security.tabId)
      if (!moment) continue
      const from =
        trigger === 'tabSwitch'
          ? moment.leftTabAt
          : trigger === 'windowBlur'
            ? this.blurredAt
            : trigger === 'minimize'
              ? this.minimizedAt
              : moment.lastActivityAt
      if (from === null) continue
      const policy = this.policyFor(security.tabId)
      const should = shouldLock(
        policy,
        { trigger, sinceMs: at - from, active: security.tabId === activeTabId },
        this.isLocked(security.tabId)
      )
      if (should && this.lock(security.tabId, trigger)) locked++
    }
    return locked
  }

  /**
   * Sets the one timer, for the soonest moment any tab is due to lock.
   *
   * Replacing it every time something changes is what keeps this to a single timer. Without it, every protected tab
   * would need its own for each of four delays -- and a browser that wakes up two hundred times a minute to check
   * whether anything should have locked is a browser with a flat battery.
   */
  private rearm(): void {
    this.cancelTimer?.()
    this.cancelTimer = null

    let soonest: number | null = null
    for (const security of this.tabs.values()) {
      if (this.isLocked(security.tabId)) continue
      const moment = this.moments.get(security.tabId)
      if (!moment) continue
      const due = nextLockAt(this.policyFor(security.tabId), {
        leftTabAt: moment.leftTabAt,
        blurredAt: this.blurredAt,
        minimizedAt: this.minimizedAt,
        lastActivityAt: moment.lastActivityAt
      })
      if (due !== null && (soonest === null || due < soonest)) soonest = due
    }
    if (soonest === null) return

    const schedule =
      this.o.schedule ??
      ((atMs: number, run: () => void): (() => void) => {
        const timer = setTimeout(run, Math.max(0, atMs - this.now()))
        timer.unref?.()
        return () => clearTimeout(timer)
      })
    this.cancelTimer = schedule(soonest, () => {
      this.cancelTimer = null
      // Every delayed trigger is asked, because the timer was set for whichever was soonest and more than one may now
      // be due.
      this.consider('tabSwitch', null)
      this.consider('windowBlur', null)
      this.consider('minimize', null)
      this.consider('inactivity', null)
      this.rearm()
    })
  }

  /** Stops the clock. Called when Orbis quits and when the profile changes. */
  stop(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  /** Everything forgotten: a different profile's tabs are not this profile's tabs. */
  reset(): void {
    this.stop()
    this.tabs.clear()
    this.moments.clear()
    this.blurredAt = null
    this.minimizedAt = null
    this.activeTabId = null
  }

  // ---------------------------------------------------------------- what may be said about a tab

  /**
   * What anything outside the security layer may know about a tab.
   *
   * The single way a tab is described to the strip, the sidebar, a hover card, the address bar, Orion's context,
   * Browser Control, a screenshot request or the recently-closed list. It is `safeTabInfo` with this watcher's answer
   * for "is it locked" and "under what policy" filled in.
   */
  describe(tab: TabInfo): SafeTabInfo {
    return safeTabInfo(tab, this.isLocked(tab.tabId), this.policyFor(tab.tabId))
  }

  /** The same, for a list. */
  describeAll(tabs: TabInfo[]): SafeTabInfo[] {
    return tabs.map((tab) => this.describe(tab))
  }

  /** Whether Orion, Vision, research or automation may use this tab at all. */
  mayRead(tabId: number): boolean {
    return !this.isLocked(tabId)
  }

  /** The tab in front, as last reported. Null before anything has been activated. */
  active(): number | null {
    return this.activeTabId
  }

  /**
   * Whether a command aimed at this tab -- or, when none is named, at whichever tab is in front -- must be refused.
   *
   * This is what the control layer's gate calls. A command with no tab named and no tab in front is allowed through,
   * because there is nothing protected for it to touch; that is the state Orbis is in before any tab exists.
   */
  wouldTouchLocked(tabId: number | null): { locked: boolean; groupId?: string } {
    const id = tabId ?? this.activeTabId
    if (id === null) return { locked: false }
    if (!this.isLocked(id)) return { locked: false }
    return { locked: true, groupId: this.groupOf(id) ?? undefined }
  }
}

/** A watcher with nothing configured, for the period before any credential exists. */
export const emptyConfig = (): { groups: Map<string, TabLockPolicy>; rules: DomainRule[]; fallback: TabLockPolicy } => ({
  groups: new Map(),
  rules: [],
  fallback: DEFAULT_POLICY
})
