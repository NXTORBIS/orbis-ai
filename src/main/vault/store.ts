import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { newVaultKey, open, seal, unwrapKey, wipe, wrapKey } from './crypto.ts'
import type { Sealed, Wrapped } from './crypto'
import { normalizeAutoLock, readSecretInput, summarize } from '../../shared/vault.ts'
import type { AutoLockMs, SecretDetail, SecretInput, SecretSummary, VaultStatus } from '../../shared/vault'
import { dataDirFor } from '../../shared/profiles.ts'

/**
 * Where a profile's secrets live.
 *
 * One file per profile, holding a wrapped key and one sealed blob of everything in the vault. Nothing in it is
 * readable without the master password: not the values, not the names, not how many there are.
 *
 * The vault key exists only in this process and only while the vault is unlocked. The window never receives it, never
 * receives the master password back, and receives a secret's value only when it asks for that one secret by id.
 *
 * Profiles do not share a file and do not share a key, so one profile's vault cannot open another's.
 */

/** What is actually written to disk. Every field here is either public or sealed. */
interface VaultFile {
  version: 1
  /** The vault key, wrapped by the master password. */
  master: Wrapped
  /** The same vault key, wrapped by the recovery answer, when one was set up. */
  recovery?: { question: string; wrapped: Wrapped }
  /** Everything in the vault, sealed with the vault key. */
  secrets: Sealed
  autoLockMs: number
  createdAt: number
  updatedAt: number
}

interface VaultContents {
  secrets: SecretDetail[]
}

export type VaultError = 'no-vault' | 'already-exists' | 'locked' | 'wrong-password' | 'wrong-answer' | 'no-recovery' | 'not-found' | 'bad-input' | 'io'

export class VaultFailure extends Error {
  readonly code: VaultError
  constructor(code: VaultError, message?: string) {
    super(message ?? code)
    this.name = 'VaultFailure'
    this.code = code
  }
}

export class SecretsVault {
  private readonly userData: string
  /** The vault key, while unlocked. Null the rest of the time, which is most of the time. */
  private key: Buffer | null = null
  private unlockedFor: string | null = null
  private cache: VaultContents | null = null
  private lockTimer: ReturnType<typeof setTimeout> | null = null
  private locksAt = 0
  private onLocked: (() => void) | null = null

  constructor(userData: string) {
    this.userData = userData
  }

  /** Told whenever the vault locks itself, so the window can clear what it was showing. */
  whenLocked(listener: () => void): void {
    this.onLocked = listener
  }

  private path(profileId: string): string {
    return join(this.userData, dataDirFor(profileId), 'secrets.vault')
  }

  private async read(profileId: string): Promise<VaultFile | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.path(profileId), 'utf8')) as VaultFile
      return raw && raw.version === 1 && raw.master ? raw : null
    } catch {
      return null
    }
  }

  private async write(profileId: string, file: VaultFile): Promise<void> {
    const path = this.path(profileId)
    await fs.mkdir(dirname(path), { recursive: true })
    // Written beside and renamed over, so a vault is never half-written.
    await fs.writeFile(`${path}.tmp`, JSON.stringify(file), { mode: 0o600 })
    await fs.rename(`${path}.tmp`, path)
  }

  // ---------------------------------------------------------------- what the window may ask without unlocking

  async status(profileId: string): Promise<VaultStatus> {
    const file = await this.read(profileId)
    const unlocked = this.isUnlocked(profileId)
    return {
      exists: Boolean(file),
      unlocked,
      hasRecovery: Boolean(file?.recovery),
      autoLockMs: normalizeAutoLock(file?.autoLockMs),
      ...(unlocked ? { locksAt: this.locksAt, count: this.cache?.secrets.length ?? 0 } : {})
    }
  }

  /** The recovery question, which is the user's own words and is not a secret. */
  async recoveryQuestion(profileId: string): Promise<string | null> {
    return (await this.read(profileId))?.recovery?.question ?? null
  }

  isUnlocked(profileId: string): boolean {
    return Boolean(this.key) && this.unlockedFor === profileId
  }

  // ---------------------------------------------------------------- setting one up, and getting into it

  /**
   * Makes a vault for this profile.
   *
   * The key is random and is wrapped by the password; the password itself goes nowhere. A recovery question, if one is
   * given, wraps the same key a second time so that answering it later really does open the vault.
   */
  async create(profileId: string, masterPassword: string, recovery?: { question: string; answer: string }): Promise<void> {
    if (await this.read(profileId)) throw new VaultFailure('already-exists', 'This profile already has a vault.')

    const key = newVaultKey()
    const now = Date.now()
    const file: VaultFile = {
      version: 1,
      master: await wrapKey(masterPassword, key),
      ...(recovery?.question && recovery.answer ? { recovery: { question: recovery.question.slice(0, 300), wrapped: await wrapKey(normalizeAnswer(recovery.answer), key) } } : {}),
      secrets: seal(key, Buffer.from(JSON.stringify({ secrets: [] } satisfies VaultContents), 'utf8')),
      autoLockMs: 5 * 60_000,
      createdAt: now,
      updatedAt: now
    }
    await this.write(profileId, file)
    this.hold(profileId, key, { secrets: [] }, file.autoLockMs)
  }

  async unlock(profileId: string, masterPassword: string): Promise<void> {
    const file = await this.read(profileId)
    if (!file) throw new VaultFailure('no-vault')

    const key = await unwrapKey(masterPassword, file.master)
    // The same answer for a wrong password and for tampered-with bytes: there is nothing useful to distinguish.
    if (!key) throw new VaultFailure('wrong-password')

    const contents = this.decode(key, file.secrets)
    if (!contents) {
      wipe(key)
      throw new VaultFailure('io', 'The vault could not be read.')
    }
    this.hold(profileId, key, contents, file.autoLockMs)
  }

  lock(): void {
    if (this.lockTimer) clearTimeout(this.lockTimer)
    this.lockTimer = null
    wipe(this.key)
    this.key = null
    this.unlockedFor = null
    this.cache = null
    this.locksAt = 0
  }

  /** Holds the key and the contents while unlocked, and sets the clock that takes them away again. */
  private hold(profileId: string, key: Buffer, contents: VaultContents, autoLockMs: number): void {
    this.lock()
    this.key = key
    this.unlockedFor = profileId
    this.cache = contents
    this.arm(normalizeAutoLock(autoLockMs))
  }

  /** Anything the user does puts the clock back to the beginning. */
  touch(): void {
    if (this.key && this.locksAt) this.arm(this.locksAtMs)
  }

  private locksAtMs: AutoLockMs = 5 * 60_000

  private arm(autoLockMs: AutoLockMs): void {
    if (this.lockTimer) clearTimeout(this.lockTimer)
    this.lockTimer = null
    this.locksAtMs = autoLockMs
    if (autoLockMs < 0) {
      this.locksAt = 0
      return
    }
    // "Immediately" means the vault is open for one action at a time.
    const wait = autoLockMs === 0 ? 1_000 : autoLockMs
    this.locksAt = Date.now() + wait
    this.lockTimer = setTimeout(() => {
      this.lock()
      this.onLocked?.()
    }, wait)
    this.lockTimer.unref?.()
  }

  // ---------------------------------------------------------------- the secrets themselves

  private need(profileId: string): { key: Buffer; contents: VaultContents } {
    if (!this.key || this.unlockedFor !== profileId || !this.cache) throw new VaultFailure('locked')
    this.touch()
    return { key: this.key, contents: this.cache }
  }

  private decode(key: Buffer, sealed: Sealed): VaultContents | null {
    const plain = open(key, sealed)
    if (!plain) return null
    try {
      const parsed = JSON.parse(plain.toString('utf8')) as VaultContents
      wipe(plain)
      return Array.isArray(parsed?.secrets) ? parsed : { secrets: [] }
    } catch {
      wipe(plain)
      return null
    }
  }

  /** Writes the vault back out, sealed. The plaintext exists only as the buffer sealed here. */
  private async save(profileId: string, key: Buffer, contents: VaultContents): Promise<void> {
    const file = await this.read(profileId)
    if (!file) throw new VaultFailure('no-vault')
    const plain = Buffer.from(JSON.stringify(contents), 'utf8')
    file.secrets = seal(key, plain)
    file.updatedAt = Date.now()
    wipe(plain)
    await this.write(profileId, file)
  }

  /** What is in the vault, as descriptions. No values, ever. */
  list(profileId: string): SecretSummary[] {
    const { contents } = this.need(profileId)
    return contents.secrets.map(summarize).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name))
  }

  /** One secret in full, because somebody asked to see that one. */
  reveal(profileId: string, id: string): SecretDetail {
    const { contents } = this.need(profileId)
    const found = contents.secrets.find((s) => s.id === id)
    if (!found) throw new VaultFailure('not-found')
    return found
  }

  async add(profileId: string, raw: unknown): Promise<SecretSummary> {
    const { key, contents } = this.need(profileId)
    const input = readSecretInput(raw)
    if (!input) throw new VaultFailure('bad-input', 'There is nothing to save.')
    const now = Date.now()
    const secret: SecretDetail = { id: randomUUID(), createdAt: now, updatedAt: now, ...toDetail(input) }
    contents.secrets.push(secret)
    await this.save(profileId, key, contents)
    return summarize(secret)
  }

  async update(profileId: string, id: string, raw: unknown): Promise<SecretSummary> {
    const { key, contents } = this.need(profileId)
    const input = readSecretInput(raw)
    if (!input) throw new VaultFailure('bad-input', 'There is nothing to save.')
    const at = contents.secrets.findIndex((s) => s.id === id)
    if (at < 0) throw new VaultFailure('not-found')
    // Replaced outright, so the old value is not left beside the new one anywhere.
    const updated: SecretDetail = { id, createdAt: contents.secrets[at].createdAt, updatedAt: Date.now(), ...toDetail(input) }
    contents.secrets[at] = updated
    await this.save(profileId, key, contents)
    return summarize(updated)
  }

  async remove(profileId: string, id: string): Promise<void> {
    const { key, contents } = this.need(profileId)
    const before = contents.secrets.length
    contents.secrets = contents.secrets.filter((s) => s.id !== id)
    if (contents.secrets.length === before) throw new VaultFailure('not-found')
    await this.save(profileId, key, contents)
  }

  // ---------------------------------------------------------------- the way in, changed

  /** Changing the master password rewraps the same vault key: the secrets are not touched. */
  async changeMasterPassword(profileId: string, current: string, next: string): Promise<void> {
    const file = await this.read(profileId)
    if (!file) throw new VaultFailure('no-vault')
    const key = await unwrapKey(current, file.master)
    if (!key) throw new VaultFailure('wrong-password')

    file.master = await wrapKey(next, key)
    file.updatedAt = Date.now()
    await this.write(profileId, file)
    // Still unlocked, with the same key, under the new password.
    this.hold(profileId, key, this.cache ?? this.decode(key, file.secrets) ?? { secrets: [] }, file.autoLockMs)
  }

  /** Setting, changing or removing the way back in. Always requires the master password. */
  async setRecovery(profileId: string, masterPassword: string, recovery: { question: string; answer: string } | null): Promise<void> {
    const file = await this.read(profileId)
    if (!file) throw new VaultFailure('no-vault')
    const key = await unwrapKey(masterPassword, file.master)
    if (!key) throw new VaultFailure('wrong-password')

    if (recovery && recovery.question.trim() && recovery.answer) {
      file.recovery = { question: recovery.question.trim().slice(0, 300), wrapped: await wrapKey(normalizeAnswer(recovery.answer), key) }
    } else {
      delete file.recovery
    }
    file.updatedAt = Date.now()
    await this.write(profileId, file)
    wipe(key)
  }

  /**
   * The way back in when the master password is gone.
   *
   * The answer unwraps the very same vault key, so the secrets survive: this is a real recovery, not a reset wearing
   * its clothes. A vault with no recovery set up cannot be recovered at all, and says so rather than pretending.
   */
  async recover(profileId: string, answer: string, newPassword: string): Promise<void> {
    const file = await this.read(profileId)
    if (!file) throw new VaultFailure('no-vault')
    if (!file.recovery) throw new VaultFailure('no-recovery')

    const key = await unwrapKey(normalizeAnswer(answer), file.recovery.wrapped)
    if (!key) throw new VaultFailure('wrong-answer')

    file.master = await wrapKey(newPassword, key)
    file.updatedAt = Date.now()
    await this.write(profileId, file)

    const contents = this.decode(key, file.secrets) ?? { secrets: [] }
    this.hold(profileId, key, contents, file.autoLockMs)
  }

  async setAutoLock(profileId: string, masterPassword: string, autoLockMs: number): Promise<AutoLockMs> {
    const file = await this.read(profileId)
    if (!file) throw new VaultFailure('no-vault')
    const key = await unwrapKey(masterPassword, file.master)
    if (!key) throw new VaultFailure('wrong-password')
    wipe(key)

    const wanted = normalizeAutoLock(autoLockMs)
    file.autoLockMs = wanted
    file.updatedAt = Date.now()
    await this.write(profileId, file)
    if (this.isUnlocked(profileId)) this.arm(wanted)
    return wanted
  }

  /** Deleting the vault. Requires the master password, and takes everything with it. */
  async destroy(profileId: string, masterPassword: string): Promise<void> {
    const file = await this.read(profileId)
    if (!file) throw new VaultFailure('no-vault')
    const key = await unwrapKey(masterPassword, file.master)
    if (!key) throw new VaultFailure('wrong-password')
    wipe(key)

    this.lock()
    await fs.rm(this.path(profileId), { force: true })
  }
}

/** The answer, as it will be compared: spacing and case are not what somebody is being asked to remember. */
const normalizeAnswer = (answer: string): string => answer.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

const toDetail = (input: SecretInput): Omit<SecretDetail, 'id' | 'createdAt' | 'updatedAt'> => ({
  kind: input.kind,
  name: input.name,
  value: input.value,
  tags: input.tags ?? [],
  favorite: input.favorite ?? false,
  ...(input.provider ? { provider: input.provider } : {}),
  ...(input.website ? { website: input.website } : {}),
  ...(input.username ? { username: input.username } : {}),
  ...(input.notes ? { notes: input.notes } : {}),
  ...(input.category ? { category: input.category } : {}),
  ...(input.fields ? { fields: input.fields } : {})
})
