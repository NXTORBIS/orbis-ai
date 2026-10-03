import type { BrowserControl } from './registry.ts'
import { fail } from './registry.ts'
import type { ParamSpec } from '../../shared/browserControl.ts'
import type { LockTrigger, SafeTabInfo, TabLockPolicy } from '../../shared/tabLock.ts'
import type { ProfileLockPolicy } from '../../shared/profileLock.ts'

/**
 * What Orion and automations may do about security.
 *
 * Every capability here moves towards privacy or reports safely. Not one of them can open anything:
 *
 *   tab.lock              locks a tab                    -- towards privacy
 *   tab.lockState         is this tab locked              -- a label, never a page
 *   tab.safeMetadata      what may be said about a tab    -- `safeTabInfo`, the same function the interface uses
 *   security.lockAll      everything protected, at once    -- towards privacy
 *   security.status       what is protected                -- counts and labels
 *   security.policy       the rules in force               -- no credentials
 *   profile.lock          puts Orbis away                  -- towards privacy
 *
 * There is deliberately no `tab.unlock` and no `profile.unlock`. Unlocking needs a password, a password belongs to the
 * person, and a capability that took one would be a capability that could be given one -- by a workflow, by a page that
 * talked Orion into it, or by anything that could read a credential from somewhere it should not have been. The most this
 * layer can do about a locked tab is `security.requestUnlock`, which asks the person: it brings the tab forward so the
 * lock surface is in front of them and returns. They type the password, or they do not.
 */

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })

export interface SecurityCapabilityDeps {
  control: BrowserControl
  /** Every protected tab, as the security layer knows them. */
  protectedTabs(): { tabId: number; groupId: string; locked: boolean; lockedBy: LockTrigger | null; label: string }[]
  /** The tab passwords that exist, by name. Never a credential, and never how to use one. */
  groups(): Promise<{ id: string; name: string; open: boolean; recoverable: boolean }[]>
  /** The policy in force for a tab. */
  policyFor(tabId: number): TabLockPolicy
  /** The profile's default tab policy and its profile-lock policy. */
  policies(): Promise<{ tab: TabLockPolicy; profile: ProfileLockPolicy }>
  /** What may be said about one tab -- `safeTabInfo`, so there is one answer to that question in the whole application. */
  describe(tabId: number): Promise<SafeTabInfo | null>
  /** Locks a tab. Returns whether anything changed. */
  lockTab(tabId: number): boolean
  /** Everything protected, locked, and every tab password closed. Returns how many changed. */
  lockAll(): number
  /** Puts Orbis away. */
  lockProfile(): void
  /** Brings a tab forward so its lock surface is in front of the person. Returns whether it could. */
  bringForward(tabId: number): Promise<boolean>
}

const tabIdFrom = (raw: unknown): number => {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return fail('invalid-params', 'Which tab? Give its id, as tabs.list reports it.')
  }
  // `Number('')` and `Number(' ')` are both 0, and tab 0 can be a real tab. A command that named nothing must not be
  // treated as naming it.
  if (typeof raw === 'string' && raw.trim() === '') {
    return fail('invalid-params', 'Which tab? Give its id, as tabs.list reports it.')
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return fail('invalid-params', 'That is not a tab id.')
  }
  return n
}

export function registerSecurityCapabilities(d: SecurityCapabilityDeps): void {
  const { control } = d

  control.registerState('security', async () => {
    const tabs = d.protectedTabs()
    const groups = await d.groups()
    return {
      protectedTabs: tabs.length,
      lockedTabs: tabs.filter((t) => t.locked).length,
      // Names of tab passwords, because a person chose those names and they are how the person refers to them. Never a
      // credential, and never which sites a password covers.
      passwords: groups.map((g) => ({ name: g.name, open: g.open, recoverable: g.recoverable }))
    }
  })

  // ---------------------------------------------------------------- reporting

  control.register({
    id: 'security.status',
    domain: 'security',
    name: 'Security status',
    description:
      'What is protected right now: how many tabs are protected, how many are locked, and which tab passwords exist by name. Never a password, never which site a locked tab is.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const tabs = d.protectedTabs()
      const groups = await d.groups()
      const { profile } = await d.policies()
      return {
        protected: tabs.length,
        locked: tabs.filter((t) => t.locked).length,
        tabs: tabs.map((t) => ({ tabId: t.tabId, locked: t.locked, lockedBy: t.lockedBy, label: t.label })),
        passwords: groups.map((g) => ({ name: g.name, open: g.open })),
        profileLock: { on: profile.enabled, locksWhenComputerLocks: profile.onSystemLock }
      }
    }
  })

  control.register({
    id: 'security.policy',
    effects: ['authenticate'],
    domain: 'security',
    name: 'Security rules in force',
    description:
      'The rules about when tabs and the profile lock themselves: the delays, the triggers, and what a locked tab is allowed to show.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => d.policies()
  })

  control.register({
    id: 'tab.lockState',
    domain: 'tabs',
    name: 'Is this tab locked',
    description:
      'Whether a tab is protected and whether it is locked now, with the generic label it shows. Never the site, the address or the title.',
    params: { tabId: str('The tab, as tabs.list reports it.', true) },
    mutates: false,
    confirmation: 'none',
    run: (p) => {
      const tabId = tabIdFrom(p.tabId)
      const found = d.protectedTabs().find((t) => t.tabId === tabId)
      if (!found) return { tabId, protected: false, locked: false }
      const policy = d.policyFor(tabId)
      return {
        tabId,
        protected: true,
        locked: found.locked,
        lockedBy: found.lockedBy,
        label: found.label,
        // What it would hide, so a caller can tell "there is nothing to read" from "there is nothing there".
        hides: {
          title: policy.hideTitle,
          favicon: policy.hideFavicon,
          url: policy.hideUrl,
          preview: policy.hidePreview
        }
      }
    }
  })

  control.register({
    id: 'tab.safeMetadata',
    domain: 'tabs',
    name: 'What may be said about a tab',
    description:
      'A tab as anything is allowed to know it. For an ordinary tab that is its real title and address; for a locked one it is a generic label, no address, no icon and no preview.',
    params: { tabId: str('The tab, as tabs.list reports it.', true) },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const tabId = tabIdFrom(p.tabId)
      const safe = await d.describe(tabId)
      if (!safe) return fail('not-found', `No tab ${tabId}. See tabs.list.`, true)
      return safe
    }
  })

  // ---------------------------------------------------------------- locking

  control.register({
    id: 'tab.lock',
    effects: ['authenticate'],
    domain: 'tabs',
    name: 'Lock a tab',
    description:
      'Locks a tab that is already protected, hiding it at once. Does not protect a tab that is not: choosing which tabs have a password is the person’s decision, not one to be made on their behalf.',
    params: { tabId: str('The tab, as tabs.list reports it.', true) },
    mutates: true,
    // Towards privacy, and reversible by the person who has the password. Nothing is lost by doing it.
    confirmation: 'none',
    run: (p) => {
      const tabId = tabIdFrom(p.tabId)
      const found = d.protectedTabs().find((t) => t.tabId === tabId)
      if (!found) {
        return fail(
          'not-found',
          'That tab has no tab password, so there is nothing to lock it with. Protect it in Settings → Tab Lock first.',
          false
        )
      }
      const changed = d.lockTab(tabId)
      return { tabId, locked: true, changed }
    }
  })

  control.register({
    id: 'security.lockAll',
    effects: ['authenticate'],
    domain: 'security',
    name: 'Lock everything protected',
    description:
      'Locks every protected tab at once and closes every tab password, so nothing reopens without one being typed. Nothing is closed and nothing is lost.',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: () => ({ locked: d.lockAll() })
  })

  control.register({
    id: 'profile.lock',
    effects: ['authenticate'],
    domain: 'security',
    name: 'Lock Orbis',
    description:
      'Puts Orbis away and asks for the account password. Every protected tab locks too. Tabs, history, bookmarks and everything else are kept exactly as they are.',
    params: {},
    mutates: true,
    // Asked for out loud, because it interrupts whatever the person was doing -- even though what it does is safe.
    confirmation: 'when-consequential',
    run: () => {
      d.lockProfile()
      return { locked: true }
    }
  })

  // ---------------------------------------------------------------- asking the person

  control.register({
    id: 'security.requestUnlock',
    effects: ['authenticate'],
    domain: 'tabs',
    name: 'Ask the person to unlock a tab',
    description:
      'Brings a locked tab forward so its lock screen is in front of the person. It does not unlock it: only they can, by typing the password. Use this when a task cannot go on without a locked tab.',
    params: { tabId: str('The tab, as tabs.list reports it.', true) },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const tabId = tabIdFrom(p.tabId)
      const found = d.protectedTabs().find((t) => t.tabId === tabId)
      if (!found?.locked) return { tabId, locked: false, asked: false, detail: 'That tab is not locked.' }
      const shown = await d.bringForward(tabId)
      return {
        tabId,
        locked: true,
        asked: shown,
        detail: shown
          ? 'The lock screen is in front of them now. Wait for them, then check tab.lockState again.'
          : 'That tab could not be brought forward.'
      }
    }
  })
}
