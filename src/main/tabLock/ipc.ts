import { ipcMain, powerMonitor } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { BrowserControl } from '../browserControl/registry.ts'
import { TabLockFailure, TabLockStore, type GroupSummary } from '../tabLockStore.ts'
import { TabLockWatcher, type TabInfo } from '../tabLockWatcher.ts'
import {
  POLICY_PRESETS,
  cleanPolicy,
  describeDelay,
  explainProtection,
  labelRevealsSite,
  type DomainRule,
  type LockTrigger,
  type SafeTabInfo,
  type TabLockPolicy
} from '../../shared/tabLock.ts'
import { judgePassword } from '../../shared/passwordStrength.ts'
import type { Hiding } from '../chromium/tabLockBridge.ts'
import { SWEEPING_CAPABILITIES, reconcile, tabIdFor, type BrowserTabRow } from './reconcile.ts'

/**
 * Tab Lock, joined up.
 *
 * Three pieces already exist and each knows only its own job: `shared/tabLock.ts` decides, `tabLockStore.ts` keeps the
 * credentials, `tabLockWatcher.ts` remembers what is locked. This is the wiring -- the window's way in, the control
 * layer's gate, and the operating system's own signals.
 *
 * Every signal here is a real Electron event. Nothing polls to find out whether Windows locked, and nothing guesses.
 */

export interface TabLockIpcOptions {
  store: TabLockStore
  control: BrowserControl
  /** The Orbis window, for the focus and minimise signals and for knowing who may call. */
  getWindow(): BrowserWindow | null
  send(channel: string, ...args: unknown[]): void
  /** The active profile, taken from the profile store -- never from a window. */
  profileId(): Promise<string>
  /** The tab in front and the tabs that exist, when the store needs them. Returns nothing if the browser is not up. */
  tabs?(): Promise<TabInfo[]>
  /**
   * Tells the browser a tab's lock state, so the browser can stop it showing its title, favicon, address and thumbnail.
   *
   * Optional, because everything else about Tab Lock works without it: the gate, Orion, automation, the settings screen
   * and the credentials are all on this side. What the browser adds is the hiding, and only the browser can add it. When
   * this is absent -- no browser running yet -- a tab is still locked in every sense that this process can enforce.
   */
  tellBrowser?(tab: { tabId: number; locked: boolean; label: string; hiding: Hiding }): void
  /**
   * Puts Orbis away.
   *
   * Profile Lock's, not Tab Lock's -- this only passes the request on. It is here because the Command Centre offers all
   * three locking commands together, and they reach Orbis through one helper.
   */
  lockProfile?(): void
  /**
   * Records something in the security log.
   *
   * Optional, and never awaited. The shape of what may be recorded is fixed in `shared/securityEvents.ts`, so this cannot
   * be handed an address or a page whatever a caller passes.
   */
  log?(event: unknown): void
}

export interface TabLockRuntime {
  watcher: TabLockWatcher
  /** What the browser's lock surface asks, over the helper. Passed straight to `createHandlers`. */
  forHelper: {
    surface(tabId: number): Promise<{ label: string; recoverable: boolean; locked: boolean }>
    unlock(tabId: number, password: string): Promise<void>
    recover(tabId: number, accountPassword: string, next: string): Promise<void>
    lockActiveTab(): Promise<{ locked: boolean; reason?: string }>
    lockAll(): Promise<{ locked: number }>
    lockProfile(): Promise<void>
  }
  /** Redacts a list of tabs before anything outside the security layer sees it. */
  redact(tabs: TabInfo[]): SafeTabInfo[]
  /**
   * Tabs the browser has just restored. Any that were protected when Orbis last closed come back protected and locked.
   *
   * Called once, after the browser reports its tabs. Matching is by address, because a tab id is not the same id after a
   * restart -- and because the address is the thing the person chose to protect.
   */
  restore(tabs: TabInfo[]): Promise<number>
  /**
   * A tab listing, with each locked tab reduced to what it is allowed to say.
   *
   * Takes the browser's own rows so the browser layer never has to know the security layer's types -- it hands over what
   * it has and gets the same shape back, with the locked ones emptied and marked.
   */
  redactRows<T extends { id: string; url: string; title: string }>(rows: T[]): (T & { locked: boolean })[]
  /**
   * The browser's tabs, as they are now.
   *
   * Called on the browser's own change events -- switched, opened, closed, navigated -- which arrive as one "something
   * changed" signal, so this works out which of those happened by comparing with what it saw last. Nothing is polled.
   */
  sync(rows: BrowserTabRow[]): void
  /** The tab in front changed. */
  activated(tabId: number): void
  /** Something happened in a tab, which restarts its inactivity clock. */
  interacted(tabId: number): void
  /** A tab navigated: the rules get a look at where it went. */
  navigated(tab: TabInfo): void
  /** A tab has gone. */
  closed(tabId: number): void
  /**
   * Hooks the focus and minimise signals onto the Orbis window.
   *
   * Separate from setting up, and called again whenever the window is made, because the window does not exist yet when
   * Tab Lock is set up -- and a window that appears later with nothing listening to it means "lock when Orbis loses
   * focus" silently never happens. Safe to call more than once; a window already hooked up is left alone.
   */
  attachWindow(): void
  /** Called when the profile changes: a different profile's locks are not this one's. */
  profileChanged(): void
  /** Called before quitting: remembers what was locked, then stops the clock. */
  shutdown(): Promise<void>
  stop(): void
}

export function registerTabLockIpc(o: TabLockIpcOptions): TabLockRuntime {
  const { store, control } = o

  /** The policies and rules the watcher needs, kept current rather than asked for on every question. */
  let groups: GroupSummary[] = []
  let rules: DomainRule[] = []
  let fallback: TabLockPolicy = POLICY_PRESETS.standard

  const watcher = new TabLockWatcher({
    config: () => ({
      groups: new Map(groups.map((g) => [g.id, g.policy])),
      rules,
      fallback
    }),
    isGroupOpen: (groupId) => store.isOpen(currentProfile, groupId),
    onChanged: (tabId, locked, reason) => {
      const policy = watcher.policyFor(tabId)
      // The window updates its own strip; the browser hides -- or gives back -- the tab's title, favicon, address and
      // thumbnail. Neither is told anything about the page: only that a tab with this id is locked, and why.
      o.send('tab-lock:changed', { tabId, locked, reason, label: policy.label })
      o.log?.({
        kind: locked ? (reason === 'manual' || reason === null ? 'TAB_LOCKED' : 'TAB_AUTO_LOCKED') : 'TAB_UNLOCKED',
        tabId,
        by: reason ?? undefined
      })
      o.tellBrowser?.({
        tabId,
        locked,
        label: policy.label,
        hiding: {
          title: policy.hideTitle,
          favicon: policy.hideFavicon,
          url: policy.hideUrl,
          preview: policy.hidePreview
        }
      })
    }
  })

  /**
   * The profile the watcher's answers are about.
   *
   * Held as a plain value because `isGroupOpen` has to answer synchronously -- the control layer's gate cannot wait. It
   * is refreshed whenever the profile changes, and the watcher is emptied at the same moment, so a stale value can only
   * ever describe a profile with no protected tabs.
   */
  let currentProfile = ''

  const refresh = async (): Promise<void> => {
    currentProfile = await o.profileId()
    groups = await store.groups(currentProfile)
    rules = await store.rules(currentProfile)
    fallback = await store.defaultPolicy(currentProfile)
  }

  // ---------------------------------------------------------------- the gate

  control.useLockedTabCheck((capability, params, target) => {
    // A listing is not refused -- it is redacted, by `redactRows`, so a locked tab appears as a locked tab rather than
    // the list being useless. Refusing here would mean one locked tab hid every other tab from Orion.
    if (SWEEPING_CAPABILITIES.has(capability)) return { locked: false }
    return watcher.wouldTouchLocked(tabIdFor(params, target))
  })

  // ---------------------------------------------------------------- the signals the computer gives us

  /**
   * Windows' own session lock, sleep and resume.
   *
   * `lock-screen` and `unlock-screen` are Electron's, and on Windows they come from the real session notifications --
   * which is why this can be a switch rather than a guess about whether somebody walked away.
   */
  const onLock = (): void => {
    const locked = watcher.systemLocked()
    if (locked > 0) o.send('tab-lock:swept', { count: locked, reason: 'systemLock' })
  }
  const onSuspend = (): void => {
    const locked = watcher.systemSuspended()
    if (locked > 0) o.send('tab-lock:swept', { count: locked, reason: 'sleep' })
  }
  powerMonitor.on('lock-screen', onLock)
  powerMonitor.on('suspend', onSuspend)
  // `shutdown` only fires where Electron supports it; where it does, a shutdown is a session ending and everything locks.
  powerMonitor.on('shutdown', onSuspend)

  /**
   * Orbis losing the front, and being put away.
   *
   * Attached to whichever window is current, and re-attached when it is replaced. `blur` rather than a global hook,
   * because "Orbis is not the window in front" is precisely what the person means by looking away.
   */
  let attachedTo: BrowserWindow | null = null
  const attachWindow = (): void => {
    const win = o.getWindow()
    if (!win || win === attachedTo || win.isDestroyed()) return
    attachedTo = win
    win.on('blur', () => watcher.focusChanged(false))
    win.on('focus', () => watcher.focusChanged(true))
    win.on('minimize', () => watcher.minimizeChanged(true))
    win.on('restore', () => watcher.minimizeChanged(false))
    win.on('hide', () => watcher.minimizeChanged(true))
    win.on('show', () => watcher.minimizeChanged(false))
    win.on('closed', () => {
      attachedTo = null
    })
  }
  // Tried now in case a window already exists, and again from wherever the window is made. Neither on its own is enough:
  // the first covers a reload, the second covers the ordinary start, where the window comes long after this.
  attachWindow()

  // ---------------------------------------------------------------- what the window may ask for

  const handle = (channel: string, run: (profileId: string, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== o.getWindow()?.webContents) throw new Error('Not allowed.')
      try {
        const id = await o.profileId()
        const result = await run(id, ...args)
        return result
      } catch (err) {
        // A code the window can act on and a sentence it can show. Never anything of a credential, and never anything
        // about a page.
        if (err instanceof TabLockFailure) return { error: err.code, message: err.message, waitMs: err.waitMs }
        return { error: 'io' }
      }
    })
  }

  const str = (value: unknown, max = 256): string => (typeof value === 'string' ? value.slice(0, max) : '')
  const num = (value: unknown): number | null => {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  /** Everything the tab-lock screens need, in one answer, so they never draw a half-known state. */
  const state = async (profileId: string): Promise<{
    groups: GroupSummary[]
    rules: DomainRule[]
    defaultPolicy: TabLockPolicy
    presets: typeof POLICY_PRESETS
    tabs: { tabId: number; groupId: string; locked: boolean; lockedBy: LockTrigger | null; label: string }[]
  }> => {
    groups = await store.groups(profileId)
    rules = await store.rules(profileId)
    fallback = await store.defaultPolicy(profileId)
    currentProfile = profileId
    return {
      groups,
      rules,
      defaultPolicy: fallback,
      presets: POLICY_PRESETS,
      // Protected tabs, by id and credential only. Not their addresses: this is a settings screen, and a settings screen
      // listing the sites somebody chose to hide would be a strange place to reveal them.
      tabs: watcher.all().map((t) => ({
        tabId: t.tabId,
        groupId: t.groupId,
        locked: t.locked,
        lockedBy: t.lockedBy,
        label: watcher.policyFor(t.tabId).label
      }))
    }
  }

  handle('tab-lock:state', (id) => state(id))

  handle('tab-lock:judge', (_id, password, name) => judgePassword(str(password), str(name, 80)))

  handle('tab-lock:create-group', async (id, name, password, policy) => {
    const summary = await store.createGroup(id, str(name, 60), str(password), policy)
    o.log?.({ kind: 'TAB_PASSWORD_CREATED', password: summary.name })
    return { group: summary, state: await state(id) }
  })

  handle('tab-lock:remove-group', async (id, groupId, password) => {
    const removed = groups.find((g) => g.id === groupId)?.name
    await store.removeGroup(id, str(groupId, 80), str(password))
    o.log?.({ kind: 'TAB_PASSWORD_REMOVED', password: removed })
    // Tabs that used it stop being protected by it. They are not left protected by a credential that no longer exists,
    // which would be a tab nobody could ever open.
    for (const tab of watcher.all()) if (tab.groupId === groupId) watcher.unprotect(tab.tabId)
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:unlock-group', async (id, groupId, password) => {
    await store.unlockGroup(id, str(groupId, 80), str(password))
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:change-group-password', async (id, groupId, current, next) => {
    await store.changeGroupPassword(id, str(groupId, 80), str(current), str(next))
    o.log?.({ kind: 'TAB_PASSWORD_CHANGED', password: groups.find((g) => g.id === groupId)?.name })
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:reset-group-password', async (id, groupId, accountPassword, next) => {
    await store.resetGroupPassword(id, str(groupId, 80), str(accountPassword), str(next))
    o.log?.({ kind: 'TAB_PASSWORD_RESET', password: groups.find((g) => g.id === groupId)?.name })
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:set-group-policy', async (id, groupId, policy) => {
    await store.setGroupPolicy(id, str(groupId, 80), policy)
    o.log?.({ kind: 'POLICY_CHANGED', password: groups.find((g) => g.id === groupId)?.name })
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:set-default-policy', async (id, policy) => {
    await store.setDefaultPolicy(id, policy)
    o.log?.({ kind: 'POLICY_CHANGED' })
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:add-rule', async (id, rule) => {
    await store.addRule(id, rule)
    // The rule's pattern is a site, and a site is not recorded here: the log's shape has no field for one, deliberately.
    o.log?.({ kind: 'RULE_ADDED' })
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:remove-rule', async (id, ruleId) => {
    await store.removeRule(id, str(ruleId, 80))
    o.log?.({ kind: 'RULE_REMOVED' })
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:set-rules', async (id, raw) => {
    await store.setRules(id, raw)
    return { ok: true, state: await state(id) }
  })

  // ---------------------------------------------------------------- the tabs themselves

  handle('tab-lock:protect', async (id, tabId, groupId) => {
    const tab = num(tabId)
    if (tab === null) return { error: 'bad-input', message: 'Which tab?' }
    const group = str(groupId, 80)
    if (!groups.some((g) => g.id === group)) {
      groups = await store.groups(id)
      if (!groups.some((g) => g.id === group)) return { error: 'no-group', message: 'That tab password does not exist.' }
    }
    watcher.protect(tab, group, true, 'manual')
    o.log?.({ kind: 'TAB_PROTECTED', tabId: tab, password: groups.find((g) => g.id === group)?.name })
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:unprotect', async (id, tabId, password) => {
    const tab = num(tabId)
    if (tab === null) return { error: 'bad-input', message: 'Which tab?' }
    const group = watcher.groupOf(tab)
    if (group === null) return { ok: true, state: await state(id) }
    // The password again, deliberately. Taking protection off a tab is as much a decision as putting it on, and somebody
    // who found the computer unattended with a tab already open should not be able to make it permanent.
    await store.unlockGroup(id, group, str(password))
    watcher.unprotect(tab)
    o.log?.({ kind: 'TAB_UNPROTECTED', tabId: tab })
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:unlock-tab', async (id, tabId, password) => {
    const tab = num(tabId)
    if (tab === null) return { error: 'bad-input', message: 'Which tab?' }
    const group = watcher.groupOf(tab)
    if (group === null) return { error: 'no-group', message: 'That tab is not locked.' }
    await store.unlockGroup(id, group, str(password))
    // Opening the credential opens every tab it covers -- one password, asked once. Asking again per tab would be
    // security theatre: the same secret, typed twice, protects nothing more.
    for (const other of watcher.all()) if (other.groupId === group) watcher.markUnlocked(other.tabId)
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:lock-tab', async (id, tabId) => {
    const tab = num(tabId)
    if (tab === null) return { error: 'bad-input', message: 'Which tab?' }
    watcher.lock(tab, 'manual')
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:set-tab-policy', async (id, tabId, policy) => {
    const tab = num(tabId)
    if (tab === null) return { error: 'bad-input', message: 'Which tab?' }
    watcher.setTabPolicy(tab, policy === null ? null : cleanPolicy(policy, watcher.policyFor(tab)))
    return { ok: true, state: await state(id) }
  })

  handle('tab-lock:lock-all', async (id) => {
    const count = watcher.panic()
    // Closing every credential as well, so nothing reopens without a password. Locking the tabs while leaving the
    // credentials open would be a lock that the next click undid.
    store.closeAll()
    o.log?.({ kind: 'PANIC_LOCK', count })
    return { ok: true, count, state: await state(id) }
  })

  handle('tab-lock:explain', async (id, tabId) => {
    const tab = num(tabId)
    if (tab === null) return { error: 'bad-input', message: 'Which tab?' }
    const groupId = watcher.groupOf(tab)
    const group = groups.find((g) => g.id === groupId) ?? null
    const policy = watcher.policyFor(tab)
    void id
    return {
      locked: watcher.isLocked(tab),
      label: policy.label,
      recoverable: group?.recoverable ?? false,
      reasons: explainProtection(
        { manual: groupId !== null, rule: null, group: group ? { name: group.name } : null },
        policy
      ),
      inactivity: describeDelay(policy.inactivity)
    }
  })

  /** Whether a label somebody typed would give the site away. Asked as they type, so the warning arrives in time. */
  handle('tab-lock:check-label', (_id, label, url) => ({
    reveals: labelRevealsSite(str(label, 60), str(url, 2048))
  }))

  // ---------------------------------------------------------------- what the rest of Orbis is told

  /**
   * The three things the browser's lock surface may ask.
   *
   * Handed to the helper, which serves the surface. The surface is a page, so it is treated as one: it names a tab and
   * offers a password, and it is told only whether that worked. It never learns the address, the title, the group's name
   * or anything else about what it is covering.
   */
  const forHelper = {
    surface: async (tabId: number): Promise<{ label: string; recoverable: boolean; locked: boolean }> => {
      const id = currentProfile || (await o.profileId())
      const groupId = watcher.groupOf(tabId)
      groups = await store.groups(id)
      const group = groups.find((g) => g.id === groupId) ?? null
      return {
        label: watcher.policyFor(tabId).label,
        // Said honestly. A group made while the account was closed cannot be reset by it, and offering "Forgot password?"
        // to somebody it will refuse is worse than not offering it.
        recoverable: group?.recoverable ?? false,
        locked: watcher.isLocked(tabId)
      }
    },
    unlock: async (tabId: number, password: string): Promise<void> => {
      const id = currentProfile || (await o.profileId())
      const groupId = watcher.groupOf(tabId)
      if (!groupId) throw new TabLockFailure('no-group', 'That tab is not locked.')
      // The store checks the password, applies the cooldown and throws with a code. Nothing here decides.
      try {
        await store.unlockGroup(id, groupId, password)
      } catch (err) {
        // Recorded, because somebody finding attempts they did not make is the whole reason the log exists. What is
        // recorded is that one was wrong -- never what was tried.
        if ((err as { code?: string })?.code === 'wrong-password') {
          o.log?.({ kind: 'FAILED_TAB_UNLOCK', tabId })
        }
        throw err
      }
      for (const other of watcher.all()) {
        if (other.groupId === groupId) watcher.markUnlocked(other.tabId)
      }
    },
    /**
     * Locks the tab in front.
     *
     * Only one that already has a tab password. Protecting a tab that does not would mean choosing a credential on
     * somebody's behalf, and there is no credential to choose -- so it says so instead.
     */
    lockActiveTab: async (): Promise<{ locked: boolean; reason?: string }> => {
      const tabId = watcher.active()
      if (tabId === null) return { locked: false, reason: 'There is no tab in front.' }
      if (!watcher.isProtected(tabId)) {
        return { locked: false, reason: 'This tab has no tab password yet. Give it one in Settings \u2192 Tab Lock.' }
      }
      watcher.lock(tabId, 'manual')
      return { locked: true }
    },
    lockAll: async (): Promise<{ locked: number }> => {
      const locked = watcher.panic()
      // Every tab password closed too, so nothing reopens without one being typed.
      store.closeAll()
      return { locked }
    },
    lockProfile: async (): Promise<void> => {
      o.lockProfile?.()
    },
    recover: async (tabId: number, accountPassword: string, next: string): Promise<void> => {
      const id = currentProfile || (await o.profileId())
      const groupId = watcher.groupOf(tabId)
      if (!groupId) throw new TabLockFailure('no-group', 'That tab is not locked.')
      await store.resetGroupPassword(id, groupId, accountPassword, next)
      // Resetting it opens it: somebody who has just proved who they are and chosen a new password should not then be
      // asked to type the password they chose a second time.
      await store.unlockGroup(id, groupId, next)
      for (const other of watcher.all()) {
        if (other.groupId === groupId) watcher.markUnlocked(other.tabId)
      }
    }
  }

  const redact = (tabs: TabInfo[]): SafeTabInfo[] => watcher.describeAll(tabs)

  /**
   * Bringing back what was locked.
   *
   * Matched on the address rather than the tab id, because Chromium hands out new ids each run. A tab whose address was
   * protected last time is protected again and locked -- `onStartup` decides whether it stays that way, and the default
   * is that it does.
   *
   * The matching is the store's, because the store holds the key the marks are made with and nothing out here should
   * ever see an address that was written down. What comes back is a map from an address Orbis already has to the tab
   * password that covered it.
   *
   * The record is only cleared once it has been used. If Orbis is killed before the browser reports its tabs, the record
   * survives and the tabs come back locked on the following start instead of silently coming back open.
   */
  const restore = async (tabs: TabInfo[]): Promise<number> => {
    const id = currentProfile || (await o.profileId())
    const remembered = await store.lockedOnClose(id)
    if (remembered.length === 0) return 0

    const wanted = await store.recogniseLocked(
      id,
      tabs.map((t) => t.url)
    )
    let count = 0
    for (const tab of tabs) {
      const groupId = wanted.get(tab.url)
      if (!groupId || watcher.isProtected(tab.tabId)) continue
      watcher.protect(tab.tabId, groupId, true, 'startup')
      count++
    }
    // Rules get a look at the rest, so a protected site that was not open last time is still protected the moment it is.
    for (const tab of tabs) watcher.applyRules(tab)
    await store.forgetLockedOnClose(id)
    if (count > 0) o.send('tab-lock:swept', { count, reason: 'startup' })
    return count
  }

  const redactRows = <T extends { id: string; url: string; title: string }>(
    rows: T[]
  ): (T & { locked: boolean })[] =>
    rows.map((row) => {
      const tabId = Number(row.id)
      if (!Number.isFinite(tabId) || !watcher.isLocked(tabId)) return { ...row, locked: false }
      const safe = watcher.describe({ tabId, url: row.url, title: row.title })
      // The address becomes an empty string rather than null, because these rows travel where a string is expected and a
      // null would read as "unknown" to something that then went looking for the real one. Empty is unambiguous.
      return { ...row, url: '', title: safe.title, locked: true }
    })

  const navigated = (tab: TabInfo): void => {
    watcher.applyRules(tab)
    // A protected tab that has been navigated is being used, so its inactivity clock starts again. A locked one is not --
    // nothing can navigate it while it is locked.
    if (!watcher.isLocked(tab.tabId)) watcher.interacted(tab.tabId)
  }

  /** What the last sync saw, so a single "something changed" signal can be turned back into what actually changed. */
  let lastSeen = new Map<number, string>()

  const sync = (rows: BrowserTabRow[]): void => {
    const change = reconcile(lastSeen, rows)
    lastSeen = change.after
    for (const tab of change.moved) navigated(tab)
    for (const tabId of change.gone) watcher.forget(tabId)
    if (change.active !== null && change.active !== watcher.active()) watcher.activated(change.active)
  }

  const profileChanged = (): void => {
    // Everything, forgotten. The credentials are closed by the account layer's own profile hook; this makes sure no tab
    // of the old profile is still thought of as unlocked.
    watcher.reset()
    store.closeAll()
    groups = []
    rules = []
    fallback = POLICY_PRESETS.standard
    void refresh()
  }

  const shutdown = async (): Promise<void> => {
    const id = currentProfile || (await o.profileId().catch(() => ''))
    if (id) {
      try {
        // Which credentials had protected tabs, so that on the next start those tabs come back locked. The addresses
        // come from the browser's own session; what is recorded here is only which credential each belonged to.
        const live = o.tabs ? await o.tabs().catch(() => []) : []
        const byId = new Map(live.map((t) => [t.tabId, t.url]))
        await store.rememberLockedOnClose(
          id,
          watcher
            .all()
            .map((t) => ({ groupId: t.groupId, url: byId.get(t.tabId) ?? '' }))
            .filter((t) => t.url !== '')
        )
      } catch {
        // A failure to remember must not hold up quitting. The consequence is a tab that comes back unprotected, and the
        // rules will protect it again the moment it loads.
      }
    }
    watcher.stop()
    store.closeAll()
  }

  const stop = (): void => {
    powerMonitor.off('lock-screen', onLock)
    powerMonitor.off('suspend', onSuspend)
    powerMonitor.off('shutdown', onSuspend)
    watcher.stop()
  }

  void refresh().then(() => {
    // Anything that was protected when Orbis last closed comes back locked before the browser is shown. `started()` is
    // what makes "it stays locked when Orbis starts" true rather than aspirational.
    watcher.started()
  })

  return {
    watcher,
    forHelper,
    attachWindow,
    redact,
    redactRows,
    sync,
    restore,
    activated: (tabId) => watcher.activated(tabId),
    interacted: (tabId) => watcher.interacted(tabId),
    navigated,
    closed: (tabId) => watcher.forget(tabId),
    profileChanged,
    shutdown,
    stop
  }
}
