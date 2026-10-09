import { promises as fs } from 'node:fs'
import { readStored } from './storedFile.ts'
import { dirname, join } from 'node:path'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { newVaultKey, unwrapKey, wipe, wrapKey } from './vault/crypto.ts'
import type { Wrapped } from './vault/crypto'
import { dataDirFor } from '../shared/profiles.ts'
import { judgePassword } from '../shared/passwordStrength.ts'
import {
  cleanPolicy,
  cleanRules,
  DEFAULT_POLICY,
  MAX_GROUPS,
  MAX_RULES,
  type DomainRule,
  type TabLockPolicy
} from '../shared/tabLock.ts'
import { AccountFailure, type AccountSecurity } from './accountSecurity.ts'

/**
 * The passwords on locked tabs, and the rules about which tabs are locked.
 *
 * Again no cryptography of its own: `vault/crypto.ts` does the work, as it does for the vault and for the account. What
 * is new here is one arrangement, and it is the reason the specification asks for two separate passwords at all:
 *
 *       tab password --scrypt--> a key that wraps ----\
 *                                                      >--- one random group key
 *   account key (from accountSecurity) ----wraps ----/
 *
 * The group key is random. The tab password unwraps it, so knowing the password is what opens the tabs. The *account*
 * key also unwraps it, so forgetting the tab password costs a reset rather than the tabs -- and a reset replaces the
 * password without ever revealing the old one, because the old one was never stored.
 *
 * Which is exactly the distinction the specification insists on: the account password is the recovery root, not the tab
 * password. Typing the account password at a locked tab does not open it. It authorises choosing a new tab password.
 *
 * One profile, one file. A profile's groups cannot be opened by another's account.
 */

/** What is written to disk. Every credential here is a wrapped key; none of it can be turned back into a password. */
interface TabLockFile {
  version: 1
  groups: StoredGroup[]
  rules: DomainRule[]
  /** The profile's own default, which a group with no policy of its own inherits. */
  policy: TabLockPolicy
  /**
   * Tabs that were locked when Orbis last closed, so `onStartup` has something to act on.
   *
   * A mark, not an address. See `markFor`.
   */
  lockedOnClose: { groupId: string; mark: string }[]
  /**
   * The key those marks are made with: random, per profile, made once.
   *
   * It is in this file, so it is not a secret from somebody who can read the file. What it does is stop the file *being*
   * a list of the private pages that were open -- which is what an address would make it. Somebody with the file can
   * test whether a site they already suspect is in the list; they cannot read the list. That is the whole difference,
   * and it is the right one to have: the alternative is either an address in the clear or locked tabs quietly coming
   * back unlocked.
   */
  recognition: string
  createdAt: number
  updatedAt: number
}

interface StoredGroup {
  id: string
  name: string
  policy: TabLockPolicy
  /** The group key, wrapped by the tab password. */
  password: Wrapped
  /** The same group key, wrapped by the account key, so the account password can authorise a reset. */
  recovery: Wrapped | null
  createdAt: number
  updatedAt: number
  failures: number
  lastFailureAt: number
}

export type TabLockError =
  | 'no-group'
  | 'already-exists'
  | 'wrong-password'
  | 'weak-password'
  | 'cooling-down'
  | 'no-recovery'
  | 'account-locked'
  | 'too-many'
  | 'bad-input'
  | 'io'

export class TabLockFailure extends Error {
  readonly code: TabLockError
  readonly waitMs: number
  constructor(code: TabLockError, message?: string, waitMs = 0) {
    super(message ?? code)
    this.name = 'TabLockFailure'
    this.code = code
    this.waitMs = waitMs
  }
}

/** What a window may know about a group. Never the credential, never how many tabs it could open. */
export interface GroupSummary {
  id: string
  name: string
  policy: TabLockPolicy
  /** Whether the account password can reset this group's password. */
  recoverable: boolean
  /** Whether it has been opened this session. */
  open: boolean
  cooldownMs: number
  createdAt: number
}

/** The same progressive, bounded delay the account uses. A forgotten password must never become lost tabs. */
const COOLDOWNS_MS = [0, 0, 0, 0, 1_000, 3_000, 10_000, 30_000, 60_000, 120_000]
const MAX_COOLDOWN_MS = 300_000
export const cooldownFor = (failures: number): number =>
  failures < COOLDOWNS_MS.length ? COOLDOWNS_MS[failures] : MAX_COOLDOWN_MS

/**
 * A tab's address, as something that can be recognised but not read.
 *
 * HMAC-SHA-256 rather than a bare hash, because a bare hash of an address is a lookup away from the address: there are
 * not that many URLs worth guessing. The key makes a precomputed table useless.
 */
const markFor = (recognitionKey: string, url: string): string =>
  createHmac('sha256', Buffer.from(recognitionKey, 'base64')).update(url).digest('base64')

/** Compared in constant time, out of habit rather than need: it costs nothing and the habit is what keeps it right. */
const sameMark = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'base64')
  const right = Buffer.from(b, 'base64')
  return left.length === right.length && timingSafeEqual(left, right)
}

export class TabLockStore {
  private readonly userData: string
  private readonly accounts: AccountSecurity
  /**
   * The group keys that have been opened, by group id.
   *
   * Held only in this process and only while open. Emptied when the profile changes and when Orbis quits, so a group is
   * never open for a profile that is not in front.
   */
  private open = new Map<string, Buffer>()
  private openFor: string | null = null

  constructor(userData: string, accounts: AccountSecurity) {
    this.userData = userData
    this.accounts = accounts
  }

  private path(profileId: string): string {
    return join(this.userData, dataDirFor(profileId), 'tab-locks.json')
  }

  private async read(profileId: string): Promise<TabLockFile> {
    const empty = (): TabLockFile => ({
      version: 1,
      groups: [],
      rules: [],
      policy: DEFAULT_POLICY,
      lockedOnClose: [],
      recognition: randomBytes(32).toString('base64'),
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    const stored = await readStored(this.path(profileId))
    if (stored.kind === 'unreadable') {
      // An empty set of rules would mean nothing is locked, and the next save would make that true.
      this.unreadable.add(profileId)
      return empty()
    }
    this.unreadable.delete(profileId)
    try {
      const raw = (stored.kind === 'read' ? JSON.parse(stored.text) : null) as TabLockFile
      if (!raw || raw.version !== 1) return empty()
      // Read defensively: this file is configuration, and configuration arrives from imports and from older versions.
      return {
        version: 1,
        groups: Array.isArray(raw.groups) ? raw.groups.filter((g) => g && typeof g.id === 'string' && g.password) : [],
        rules: cleanRules(raw.rules),
        policy: cleanPolicy(raw.policy),
        lockedOnClose: Array.isArray(raw.lockedOnClose)
          ? raw.lockedOnClose
              .filter((t) => t && typeof t.groupId === 'string' && typeof t.mark === 'string')
              .slice(0, 200)
          : [],
        // A file written before this existed has no key, and a file whose key was lost cannot recognise its old marks --
        // in both cases a new key is made and the marks are dropped, which costs a tab coming back unprotected once and
        // never costs an address on disk.
        recognition: typeof raw.recognition === 'string' && raw.recognition.length >= 40 ? raw.recognition : randomBytes(32).toString('base64'),
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
        updatedAt: Date.now()
      }
    } catch {
      return empty()
    }
  }

  /** Profiles whose locked-tab file is there and could not be read. Nothing is written over those. */
  private readonly unreadable = new Set<string>()

  private async write(profileId: string, file: TabLockFile): Promise<void> {
    if (this.unreadable.has(profileId)) {
      this.unreadable.delete(profileId)
      return
    }
    const path = this.path(profileId)
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(`${path}.tmp`, JSON.stringify({ ...file, updatedAt: Date.now() }), { mode: 0o600 })
    await fs.rename(`${path}.tmp`, path)
  }

  /** Everything a profile switch must forget: no group stays open across profiles. */
  closeAll(): void {
    for (const key of this.open.values()) wipe(key)
    this.open.clear()
    this.openFor = null
  }

  private hold(profileId: string, groupId: string, key: Buffer): void {
    if (this.openFor !== profileId) {
      this.closeAll()
      this.openFor = profileId
    }
    const had = this.open.get(groupId)
    if (had) wipe(had)
    this.open.set(groupId, key)
  }

  isOpen(profileId: string, groupId: string): boolean {
    return this.openFor === profileId && this.open.has(groupId)
  }

  /** Closes one group, so its tabs lock again. */
  close(groupId: string): void {
    const key = this.open.get(groupId)
    if (key) wipe(key)
    this.open.delete(groupId)
  }

  // ---------------------------------------------------------------- what may be read without a password

  async groups(profileId: string, at = Date.now()): Promise<GroupSummary[]> {
    const file = await this.read(profileId)
    return file.groups.map((g) => ({
      id: g.id,
      name: g.name,
      policy: g.policy,
      recoverable: g.recovery !== null,
      open: this.isOpen(profileId, g.id),
      cooldownMs: Math.max(0, cooldownFor(g.failures) - (at - g.lastFailureAt)),
      createdAt: g.createdAt
    }))
  }

  async rules(profileId: string): Promise<DomainRule[]> {
    return (await this.read(profileId)).rules
  }

  async defaultPolicy(profileId: string): Promise<TabLockPolicy> {
    return (await this.read(profileId)).policy
  }

  async setDefaultPolicy(profileId: string, policy: unknown): Promise<TabLockPolicy> {
    const file = await this.read(profileId)
    const next = cleanPolicy(policy, file.policy)
    await this.write(profileId, { ...file, policy: next })
    return next
  }

  // ---------------------------------------------------------------- making a group

  /**
   * Creates a credential for locking tabs with.
   *
   * The group key is also wrapped by the account key when the account is open, which is what makes "forgot tab
   * password" possible later. When the account is *not* open the group is still created -- refusing would mean a person
   * with no account password could not lock a tab at all -- but it is created without recovery, and `recoverable` says
   * so honestly rather than the interface offering a reset that could not work.
   */
  async createGroup(
    profileId: string,
    name: string,
    password: string,
    policy?: unknown
  ): Promise<GroupSummary> {
    const file = await this.read(profileId)
    if (file.groups.length >= MAX_GROUPS) {
      throw new TabLockFailure('too-many', `Orbis keeps ${MAX_GROUPS} tab passwords. Remove one first.`)
    }
    const cleanName = name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!cleanName) throw new TabLockFailure('bad-input', 'Give it a name.')
    if (file.groups.some((g) => g.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new TabLockFailure('already-exists', `There is already a "${cleanName}".`)
    }
    const verdict = judgePassword(password)
    if (!verdict.ok) throw new TabLockFailure('weak-password', verdict.problem || 'That password is not strong enough.')

    const groupKey = newVaultKey()
    try {
      const wrapped = await wrapKey(password, groupKey)
      const recovery = await this.wrapForRecovery(profileId, groupKey)
      const now = Date.now()
      const group: StoredGroup = {
        id: randomUUID(),
        name: cleanName,
        policy: cleanPolicy(policy, file.policy),
        password: wrapped,
        recovery,
        createdAt: now,
        updatedAt: now,
        failures: 0,
        lastFailureAt: 0
      }
      await this.write(profileId, { ...file, groups: [...file.groups, group] })
      // Open immediately: they just chose it and typed it twice.
      this.hold(profileId, group.id, groupKey)
      return {
        id: group.id,
        name: group.name,
        policy: group.policy,
        recoverable: recovery !== null,
        open: true,
        cooldownMs: 0,
        createdAt: now
      }
    } catch (err) {
      wipe(groupKey)
      if (err instanceof TabLockFailure) throw err
      throw new TabLockFailure('io', 'That tab password could not be saved.')
    }
  }

  /** The group key wrapped by the account key, or null when there is no open account to wrap it with. */
  private async wrapForRecovery(profileId: string, groupKey: Buffer): Promise<Wrapped | null> {
    try {
      if (!(await this.accounts.hasPassword(profileId))) return null
      return await this.accounts.wrapWithAccount(profileId, groupKey)
    } catch (err) {
      // The account exists but is not open. The group is made without recovery rather than not made at all.
      if (err instanceof AccountFailure) return null
      throw err
    }
  }

  // ---------------------------------------------------------------- opening one

  async unlockGroup(profileId: string, groupId: string, password: string, at = Date.now()): Promise<void> {
    const file = await this.read(profileId)
    const group = file.groups.find((g) => g.id === groupId)
    if (!group) throw new TabLockFailure('no-group')

    const owed = cooldownFor(group.failures) - (at - group.lastFailureAt)
    if (owed > 0) throw new TabLockFailure('cooling-down', 'Too many attempts. Wait a moment.', owed)

    const key = await unwrapKey(password, group.password)
    if (!key) {
      await this.noteFailure(profileId, file, groupId, at)
      throw new TabLockFailure('wrong-password', 'That password is not right.')
    }
    if (group.failures !== 0) await this.clearFailures(profileId, file, groupId)
    this.hold(profileId, groupId, key)
  }

  private async noteFailure(profileId: string, file: TabLockFile, groupId: string, at: number): Promise<void> {
    await this.write(profileId, {
      ...file,
      groups: file.groups.map((g) => (g.id === groupId ? { ...g, failures: g.failures + 1, lastFailureAt: at } : g))
    })
  }

  private async clearFailures(profileId: string, file: TabLockFile, groupId: string): Promise<void> {
    await this.write(profileId, {
      ...file,
      groups: file.groups.map((g) => (g.id === groupId ? { ...g, failures: 0, lastFailureAt: 0 } : g))
    })
  }

  // ---------------------------------------------------------------- changing and resetting

  /** Changes a tab password, knowing the old one. The group key is kept, so no tab is affected. */
  async changeGroupPassword(profileId: string, groupId: string, current: string, next: string): Promise<void> {
    const file = await this.read(profileId)
    const group = file.groups.find((g) => g.id === groupId)
    if (!group) throw new TabLockFailure('no-group')

    const verdict = judgePassword(next)
    if (!verdict.ok) throw new TabLockFailure('weak-password', verdict.problem || 'That password is not strong enough.')

    const at = Date.now()
    const owed = cooldownFor(group.failures) - (at - group.lastFailureAt)
    if (owed > 0) throw new TabLockFailure('cooling-down', 'Too many attempts. Wait a moment.', owed)

    const groupKey = await unwrapKey(current, group.password)
    if (!groupKey) {
      await this.noteFailure(profileId, file, groupId, at)
      throw new TabLockFailure('wrong-password', 'That is not the current password for these tabs.')
    }
    await this.rewrap(profileId, file, group, groupKey, next)
  }

  /**
   * Replaces a forgotten tab password, authorised by the account password.
   *
   * The account password is checked, then used to unwrap the group key, then a new tab password is wrapped around that
   * same key. Nothing reveals the old tab password, because the old tab password was never stored -- only a key wrapped
   * by it, and a wrapped key cannot be read backwards.
   *
   * Both halves are required: knowing the account password without it being able to unwrap this group is not enough, and
   * a group made while the account was closed genuinely cannot be recovered. It says so rather than pretending.
   */
  async resetGroupPassword(
    profileId: string,
    groupId: string,
    accountPassword: string,
    next: string
  ): Promise<void> {
    const file = await this.read(profileId)
    const group = file.groups.find((g) => g.id === groupId)
    if (!group) throw new TabLockFailure('no-group')
    if (!group.recovery) {
      throw new TabLockFailure(
        'no-recovery',
        'These tabs were protected without account recovery, so their password cannot be reset.'
      )
    }

    const verdict = judgePassword(next)
    if (!verdict.ok) throw new TabLockFailure('weak-password', verdict.problem || 'That password is not strong enough.')

    // The account's own cooldown and failure counting apply, because this is a guess at the account password.
    let opened = false
    try {
      opened = await this.accounts.verify(profileId, accountPassword)
    } catch (err) {
      if (err instanceof AccountFailure) {
        if (err.code === 'cooling-down') throw new TabLockFailure('cooling-down', err.message, err.waitMs)
        if (err.code === 'no-account') throw new TabLockFailure('no-recovery', 'This profile has no account password.')
      }
      throw new TabLockFailure('io')
    }
    if (!opened) throw new TabLockFailure('wrong-password', 'That is not your Orbis account password.')

    // Verifying does not open the account, and unwrapping needs the account key -- so it is opened here, with the
    // password that has just been checked.
    try {
      await this.accounts.unlock(profileId, accountPassword)
    } catch {
      throw new TabLockFailure('account-locked', 'The account could not be opened.')
    }

    const groupKey = await this.accounts.unwrapWithAccount(profileId, group.recovery)
    if (!groupKey) throw new TabLockFailure('no-recovery', 'The recovery for these tabs could not be opened.')
    await this.rewrap(profileId, file, group, groupKey, next)
  }

  /** Wraps a group key with a new password, keeping the key and the account recovery intact. */
  private async rewrap(
    profileId: string,
    file: TabLockFile,
    group: StoredGroup,
    groupKey: Buffer,
    next: string
  ): Promise<void> {
    try {
      const wrapped = await wrapKey(next, groupKey)
      // Recovery is refreshed when the account can do it, so a group made without an open account gains recovery the
      // first time its password is changed with one open.
      const recovery = group.recovery ?? (await this.wrapForRecovery(profileId, groupKey))
      await this.write(profileId, {
        ...file,
        groups: file.groups.map((g) =>
          g.id === group.id
            ? { ...g, password: wrapped, recovery, updatedAt: Date.now(), failures: 0, lastFailureAt: 0 }
            : g
        )
      })
      this.hold(profileId, group.id, groupKey)
    } catch (err) {
      wipe(groupKey)
      if (err instanceof TabLockFailure) throw err
      throw new TabLockFailure('io', 'The new password could not be saved.')
    }
  }

  // ---------------------------------------------------------------- removing

  /**
   * Removes a credential, and the rules that pointed at it.
   *
   * Requires the password, because removing a credential unprotects every tab it covered -- which is a way of unlocking
   * them, and must cost the same as unlocking them.
   */
  async removeGroup(profileId: string, groupId: string, password: string): Promise<void> {
    await this.unlockGroup(profileId, groupId, password)
    const file = await this.read(profileId)
    this.close(groupId)
    await this.write(profileId, {
      ...file,
      groups: file.groups.filter((g) => g.id !== groupId),
      rules: file.rules.filter((r) => r.groupId !== groupId),
      lockedOnClose: file.lockedOnClose.filter((t) => t.groupId !== groupId)
    })
  }

  async setGroupPolicy(profileId: string, groupId: string, policy: unknown): Promise<TabLockPolicy> {
    const file = await this.read(profileId)
    const group = file.groups.find((g) => g.id === groupId)
    if (!group) throw new TabLockFailure('no-group')
    const next = cleanPolicy(policy, group.policy)
    await this.write(profileId, {
      ...file,
      groups: file.groups.map((g) => (g.id === groupId ? { ...g, policy: next, updatedAt: Date.now() } : g))
    })
    return next
  }

  // ---------------------------------------------------------------- rules

  async addRule(profileId: string, rule: unknown): Promise<DomainRule[]> {
    const file = await this.read(profileId)
    if (file.rules.length >= MAX_RULES) throw new TabLockFailure('too-many', `Orbis keeps ${MAX_RULES} rules.`)
    const o = (rule ?? {}) as Record<string, unknown>
    const read = cleanRules([{ ...o, id: typeof o.id === 'string' && o.id ? o.id : randomUUID() }])
    if (read.length === 0) throw new TabLockFailure('bad-input', 'That is not a site Orbis can match.')
    const one = read[0]
    if (!file.groups.some((g) => g.id === one.groupId)) throw new TabLockFailure('no-group')
    const rules = [...file.rules.filter((r) => r.id !== one.id), one]
    await this.write(profileId, { ...file, rules })
    return rules
  }

  async removeRule(profileId: string, ruleId: string): Promise<DomainRule[]> {
    const file = await this.read(profileId)
    const rules = file.rules.filter((r) => r.id !== ruleId)
    await this.write(profileId, { ...file, rules })
    return rules
  }

  async setRules(profileId: string, raw: unknown): Promise<DomainRule[]> {
    const file = await this.read(profileId)
    const rules = cleanRules(raw).filter((r) => file.groups.some((g) => g.id === r.groupId))
    await this.write(profileId, { ...file, rules })
    return rules
  }

  // ---------------------------------------------------------------- surviving a restart

  /**
   * Records which protected tabs were locked when Orbis closed, so they come back locked.
   *
   * What is written down is a mark, never the address. A locked tab must not reveal what it is, and a file listing the
   * private pages somebody had open would reveal all of them at once, days later, to anybody who opened it -- including
   * a backup, a sync folder or a support bundle. So the address is turned into a keyed mark on the way in, and matched
   * by making the same mark out of an address Orbis already has on the way out.
   */
  async rememberLockedOnClose(profileId: string, tabs: { groupId: string; url: string }[]): Promise<void> {
    const file = await this.read(profileId)
    const kept = tabs
      .filter((t) => typeof t.url === 'string' && t.url.length > 0 && t.url.length < 2048)
      .filter((t) => file.groups.some((g) => g.id === t.groupId))
      .slice(0, 200)
      .map((t) => ({ groupId: t.groupId, mark: markFor(file.recognition, t.url) }))
    await this.write(profileId, { ...file, lockedOnClose: kept })
  }

  /** The marks, for anything that wants to know whether there is something to restore. Never an address. */
  async lockedOnClose(profileId: string): Promise<{ groupId: string; mark: string }[]> {
    return (await this.read(profileId)).lockedOnClose
  }

  /**
   * Which of these addresses were locked when Orbis closed, and under which tab password.
   *
   * The matching happens in here because the key does. Nothing outside this class ever needs it, and a key that only one
   * file uses is a key that cannot be misused by a second one.
   */
  async recogniseLocked(profileId: string, urls: string[]): Promise<Map<string, string>> {
    const file = await this.read(profileId)
    const found = new Map<string, string>()
    if (file.lockedOnClose.length === 0) return found
    for (const url of urls) {
      if (typeof url !== 'string' || !url) continue
      const mark = markFor(file.recognition, url)
      const hit = file.lockedOnClose.find((t) => sameMark(t.mark, mark))
      if (hit) found.set(url, hit.groupId)
    }
    return found
  }

  async forgetLockedOnClose(profileId: string): Promise<void> {
    const file = await this.read(profileId)
    await this.write(profileId, { ...file, lockedOnClose: [] })
  }
}
