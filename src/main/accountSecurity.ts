import { promises as fs } from 'node:fs'
import { readStored } from './storedFile.ts'
import { cleanProfileLockPolicy, DEFAULT_PROFILE_LOCK, type ProfileLockPolicy } from '../shared/profileLock.ts'
import { dirname, join } from 'node:path'
import { newVaultKey, unwrapKey, wipe, wrapKey } from './vault/crypto.ts'
import type { Wrapped } from './vault/crypto'
import { dataDirFor } from '../shared/profiles.ts'
import { judgePassword } from '../shared/passwordStrength.ts'

/**
 * The password on an Orbis account.
 *
 * None of the cryptography is here. `vault/crypto.ts` already does exactly what this needs -- scrypt to turn a password
 * into a key, AES-256-GCM to seal things with it, and a wrapped random key so that changing the password rewraps one
 * small thing instead of re-encrypting anything. Reusing it means there is one set of cryptographic decisions in Orbis
 * rather than two, and the second one is always the one that is wrong.
 *
 * The arrangement:
 *
 *   account password --scrypt--> a key that wraps ---> one random account key
 *
 * The account key is random, lives only in this process, and is never shown to a window. The password does not encrypt
 * anything directly; it only unwraps that key. Which gives three things the specification asks for:
 *
 *  - Verifying a password is unwrapping the key. If it opens, the password was right. Nothing is compared, so there is
 *    nothing to compare in variable time.
 *  - Changing the password rewraps the same key, so no data is touched and nothing can be lost by changing it.
 *  - The account key can wrap *other* credentials later -- a tab lock's, say -- which makes the account password a
 *    recovery root without making it the tab password. That distinction is the whole point of having two.
 *
 * What is stored is a salt and a wrapped key. Neither can be turned back into the password.
 *
 * One profile, one file, one key. A profile cannot open another's.
 */

/** What is written to disk. Every field is either public or wrapped. */
interface AccountFile {
  version: 1
  /** The account key, wrapped by the password. */
  password: Wrapped
  createdAt: number
  updatedAt: number
  /** Failed attempts since the last success, so a cooldown survives a restart. */
  failures: number
  /** When the last failure was, so the cooldown can be worked out. */
  lastFailureAt: number
  /**
   * When the whole profile locks itself.
   *
   * Kept in this file rather than a new one, because it is account security and this is where account security lives.
   * A second file would be a second place to keep in step, and the thing it protects is already here: the password that
   * unlocks the profile is the password in this file.
   *
   * Absent on a file written before Profile Lock existed, which reads as off.
   */
  lock?: ProfileLockPolicy
}

export type AccountError =
  | 'no-account'
  | 'already-exists'
  | 'wrong-password'
  | 'weak-password'
  | 'cooling-down'
  | 'io'

export class AccountFailure extends Error {
  readonly code: AccountError
  /** For 'cooling-down', how much longer to wait. */
  readonly waitMs: number
  constructor(code: AccountError, message?: string, waitMs = 0) {
    super(message ?? code)
    this.name = 'AccountFailure'
    this.code = code
    this.waitMs = waitMs
  }
}

/** What a window may know without having authenticated. */
export interface AccountStatus {
  /** Whether this profile has a password at all. An account made before passwords existed has none. */
  hasPassword: boolean
  /** Whether the password has been given in this session. */
  unlocked: boolean
  /** How much longer guessing is refused for, or 0. */
  cooldownMs: number
  failures: number
}

/**
 * How long guessing is refused for after repeated failures.
 *
 * Nothing for the first few, because people mistype. Then a delay that grows, which costs an attacker everything and a
 * person almost nothing. Deliberately bounded: a lock-out that never ends would turn a forgotten password into lost
 * data, and there is no recovery here that could undo it.
 */
const COOLDOWNS_MS = [0, 0, 0, 0, 1_000, 3_000, 10_000, 30_000, 60_000, 120_000]
const MAX_COOLDOWN_MS = 300_000

export function cooldownFor(failures: number): number {
  if (failures < COOLDOWNS_MS.length) return COOLDOWNS_MS[failures]
  return MAX_COOLDOWN_MS
}

export class AccountSecurity {
  private readonly userData: string
  /** The account key, while the account is unlocked. Null the rest of the time. */
  private key: Buffer | null = null
  private unlockedFor: string | null = null

  constructor(userData: string) {
    this.userData = userData
  }

  private path(profileId: string): string {
    return join(this.userData, dataDirFor(profileId), 'account.lock')
  }

  /**
   * Profiles whose account file is there and could not be read.
   *
   * This mattered more here than anywhere: null means "no password is set", so a file something else had open
   * for a moment meant the account looked open -- and setting a password then wrote a new file over the old one,
   * which is the password nobody can get back.
   */
  private readonly unreadable = new Set<string>()

  private async read(profileId: string): Promise<AccountFile | null> {
    const stored = await readStored(this.path(profileId))
    if (stored.kind === 'unreadable') {
      this.unreadable.add(profileId)
      return null
    }
    this.unreadable.delete(profileId)
    if (stored.kind === 'missing') return null
    try {
      const raw = JSON.parse(stored.text) as AccountFile
      return raw && raw.version === 1 && raw.password ? raw : null
    } catch {
      return null
    }
  }

  /** True when this profile has an account file Orbis could not read, so nothing may be written over it. */
  unreadableFor(profileId: string): boolean {
    return this.unreadable.has(profileId)
  }

  private async write(profileId: string, file: AccountFile): Promise<void> {
    if (this.unreadable.has(profileId)) {
      // Refusing is recoverable; writing a new password file over one that cannot be read is not.
      this.unreadable.delete(profileId)
      throw new AccountFailure('io', 'Orbis could not read this profile\u2019s password file. Nothing has been changed; try again in a moment.')
    }
    const path = this.path(profileId)
    await fs.mkdir(dirname(path), { recursive: true })
    // Written beside and renamed over, so the file is never half-written -- which for this file would mean an account
    // nobody could open.
    await fs.writeFile(`${path}.tmp`, JSON.stringify(file), { mode: 0o600 })
    await fs.rename(`${path}.tmp`, path)
  }

  // ---------------------------------------------------------------- what may be asked without a password

  async status(profileId: string, at = Date.now()): Promise<AccountStatus> {
    const file = await this.read(profileId)
    if (!file) return { hasPassword: false, unlocked: true, cooldownMs: 0, failures: 0 }
    const waited = at - file.lastFailureAt
    const owed = cooldownFor(file.failures) - waited
    return {
      hasPassword: true,
      unlocked: this.isUnlocked(profileId),
      cooldownMs: Math.max(0, owed),
      failures: file.failures
    }
  }

  isUnlocked(profileId: string): boolean {
    return this.key !== null && this.unlockedFor === profileId
  }

  /** Whether this profile has a password. Used to decide whether to ask for one, so it must not need one. */
  async hasPassword(profileId: string): Promise<boolean> {
    return (await this.read(profileId)) !== null
  }

  /**
   * When this profile locks itself.
   *
   * Readable without a password, because the answer decides whether to ask for one -- and a setting that could only be
   * read by somebody who had already got in would be no use to the thing that keeps them out.
   *
   * A profile with no password gets the default, which is off. There would be nothing to unlock it with.
   */
  async profileLock(profileId: string): Promise<ProfileLockPolicy> {
    const file = await this.read(profileId)
    if (!file) return DEFAULT_PROFILE_LOCK
    return cleanProfileLockPolicy(file.lock, DEFAULT_PROFILE_LOCK)
  }

  /**
   * Changes when this profile locks itself.
   *
   * Requires an account to exist, and refuses otherwise rather than quietly keeping a policy that can never take effect:
   * locking a profile that has no password would leave somebody at a prompt no password opens.
   *
   * It does not require the account to be *unlocked*. Somebody who has already given the password this session has
   * proved who they are, and somebody who has not cannot reach the settings screen at all -- adding a second prompt here
   * would be asking for the same secret twice, which protects nothing.
   */
  async setProfileLock(profileId: string, raw: unknown): Promise<ProfileLockPolicy> {
    const file = await this.read(profileId)
    if (!file) {
      throw new AccountFailure(
        'no-account',
        'Set an account password first. Without one there would be nothing to unlock Orbis with.'
      )
    }
    const policy = cleanProfileLockPolicy(raw, cleanProfileLockPolicy(file.lock, DEFAULT_PROFILE_LOCK))
    await this.write(profileId, { ...file, lock: policy, updatedAt: Date.now() })
    return policy
  }

  // ---------------------------------------------------------------- making one

  /**
   * Gives a profile a password.
   *
   * Refuses if it already has one: replacing it is `change`, which needs the old password. Without that rule, anything
   * that could reach this could take an account over.
   */
  async create(profileId: string, password: string, name = ''): Promise<void> {
    if (await this.read(profileId)) throw new AccountFailure('already-exists')
    const verdict = judgePassword(password, name)
    if (!verdict.ok) throw new AccountFailure('weak-password', verdict.problem || 'That password is not strong enough.')

    const accountKey = newVaultKey()
    try {
      const wrapped = await wrapKey(password, accountKey)
      const now = Date.now()
      await this.write(profileId, {
        version: 1,
        password: wrapped,
        createdAt: now,
        updatedAt: now,
        failures: 0,
        lastFailureAt: 0
      })
      // Made and immediately unlocked: the person just proved they know it by typing it twice.
      this.hold(profileId, accountKey)
    } catch (err) {
      wipe(accountKey)
      if (err instanceof AccountFailure) throw err
      throw new AccountFailure('io', 'The account password could not be saved.')
    }
  }

  // ---------------------------------------------------------------- opening it

  /**
   * Unlocks the account, or says why not.
   *
   * There is no comparison anywhere in here. The password is right exactly when it unwraps the key, and scrypt already
   * takes the same quarter of a second whether it was right or wrong.
   */
  async unlock(profileId: string, password: string, at = Date.now()): Promise<void> {
    const file = await this.read(profileId)
    if (!file) throw new AccountFailure('no-account')

    const owed = cooldownFor(file.failures) - (at - file.lastFailureAt)
    if (owed > 0) throw new AccountFailure('cooling-down', 'Too many attempts. Wait a moment.', owed)

    const key = await unwrapKey(password, file.password)
    if (!key) {
      await this.write(profileId, { ...file, failures: file.failures + 1, lastFailureAt: at })
      throw new AccountFailure('wrong-password', 'That password is not right.')
    }
    if (file.failures !== 0) await this.write(profileId, { ...file, failures: 0, lastFailureAt: 0 })
    this.hold(profileId, key)
  }

  /**
   * Checks a password without unlocking.
   *
   * For authorising something while already unlocked -- resetting another credential, changing a security setting --
   * where the question is "is this the person" rather than "let them in". Counted against the same cooldown, because it
   * is the same guess.
   */
  async verify(profileId: string, password: string, at = Date.now()): Promise<boolean> {
    const file = await this.read(profileId)
    if (!file) throw new AccountFailure('no-account')
    const owed = cooldownFor(file.failures) - (at - file.lastFailureAt)
    if (owed > 0) throw new AccountFailure('cooling-down', 'Too many attempts. Wait a moment.', owed)

    const key = await unwrapKey(password, file.password)
    if (!key) {
      await this.write(profileId, { ...file, failures: file.failures + 1, lastFailureAt: at })
      return false
    }
    wipe(key)
    if (file.failures !== 0) await this.write(profileId, { ...file, failures: 0, lastFailureAt: 0 })
    return true
  }

  /** Forgets the key. Not a security boundary by itself -- the process still has whatever it loaded -- but the key is gone. */
  lock(): void {
    wipe(this.key)
    this.key = null
    this.unlockedFor = null
  }

  private hold(profileId: string, key: Buffer): void {
    wipe(this.key)
    this.key = key
    this.unlockedFor = profileId
  }

  // ---------------------------------------------------------------- changing it

  /**
   * Changes the password, keeping the same account key.
   *
   * Which is why this cannot lose anything: the key that protects whatever the account key protects does not change, so
   * tabs, history, bookmarks, personalisation, workflows and any credential wrapped by it are all untouched. Only the
   * wrapping around the key is replaced.
   */
  async change(profileId: string, current: string, next: string, name = ''): Promise<void> {
    const file = await this.read(profileId)
    if (!file) throw new AccountFailure('no-account')

    const verdict = judgePassword(next, name)
    if (!verdict.ok) throw new AccountFailure('weak-password', verdict.problem || 'That password is not strong enough.')

    const at = Date.now()
    const owed = cooldownFor(file.failures) - (at - file.lastFailureAt)
    if (owed > 0) throw new AccountFailure('cooling-down', 'Too many attempts. Wait a moment.', owed)

    const accountKey = await unwrapKey(current, file.password)
    if (!accountKey) {
      await this.write(profileId, { ...file, failures: file.failures + 1, lastFailureAt: at })
      throw new AccountFailure('wrong-password', 'That is not your current password.')
    }

    try {
      const wrapped = await wrapKey(next, accountKey)
      await this.write(profileId, {
        ...file,
        password: wrapped,
        updatedAt: at,
        failures: 0,
        lastFailureAt: 0
      })
      this.hold(profileId, accountKey)
    } catch {
      wipe(accountKey)
      throw new AccountFailure('io', 'The new password could not be saved.')
    }
  }

  // ---------------------------------------------------------------- being a recovery root

  /**
   * Wraps something with the account key.
   *
   * This is how the account password becomes the recovery root for other credentials without becoming them. A tab
   * lock's own key can be wrapped twice -- once by the tab password, once by this -- so forgetting the tab password
   * costs a reset, not the tab.
   *
   * Requires the account to be unlocked, because it needs the key, and the key only exists once the password has been
   * given. Nothing can wrap against an account nobody has opened.
   */
  wrapWithAccount(profileId: string, secret: Buffer): Promise<Wrapped> {
    if (!this.isUnlocked(profileId) || !this.key) throw new AccountFailure('wrong-password', 'The account is locked.')
    // Wrapped with the account key as the "password": the same scrypt-and-seal path, given random bytes instead of a
    // chosen phrase. Hex rather than raw bytes because `wrapKey` takes a string.
    return wrapKey(this.key.toString('hex'), secret)
  }

  /** Opens something wrapped by the account key, or null. The account must be unlocked. */
  async unwrapWithAccount(profileId: string, wrapped: Wrapped): Promise<Buffer | null> {
    if (!this.isUnlocked(profileId) || !this.key) throw new AccountFailure('wrong-password', 'The account is locked.')
    return unwrapKey(this.key.toString('hex'), wrapped)
  }
}
