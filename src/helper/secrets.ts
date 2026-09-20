import { SecretsVault, VaultFailure } from '../main/vault/store.ts'
import { AUTO_LOCK_CHOICES, SECRET_KINDS, checkMasterPassword, matchesSearch } from '../shared/vault.ts'
import type { SecretKind, SecretSummary, VaultStatus } from '../shared/vault'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * The secrets vault for the panel: the same vault Electron Orbis uses, in the same process.
 *
 * The panel is told what a secret says about itself (name, kind, provider, site, username, tags) and can set a NEW value.
 * A value is sent only by `secrets:reveal`, for the one secret the person asked to see, as the Orbis window's own reveal does:
 * the panel shows it for a short while and forgets it. Nothing here logs an argument or a value, and the master password is used
 * for one call and not kept. The vault key never leaves the vault object.
 */

/** What the helper needs from the vault: plain functions, so the helper never holds the vault or a profile itself. */
export interface SecretsDeps {
  status(): Promise<VaultStatus>
  unlock(masterPassword: string): Promise<VaultStatus>
  lock(): Promise<VaultStatus>
  list(): Promise<SecretSummary[]>
  add(input: Record<string, unknown>): Promise<SecretSummary>
  /** `changes` never contains a value unless the person typed a new one; what is kept of the old secret is the vault's business. */
  update(id: string, changes: Record<string, unknown>): Promise<SecretSummary>
  remove(id: string): Promise<void>
  /** One secret's value, for the one the person asked to see. */
  reveal(id: string): Promise<string>
  create(masterPassword: string, recovery?: { question: string; answer: string }): Promise<VaultStatus>
  recoveryQuestion(): Promise<string | null>
  recover(answer: string, newPassword: string): Promise<VaultStatus>
  changePassword(current: string, next: string): Promise<VaultStatus>
  setRecovery(masterPassword: string, recovery: { question: string; answer: string } | null): Promise<VaultStatus>
  setAutoLock(masterPassword: string, ms: number): Promise<VaultStatus>
  destroy(masterPassword: string): Promise<VaultStatus>
}

/** Wraps the real vault, for the profile in use now. Updates keep the old value and fields unless a new value is given. */
export function secretsFromVault(vault: SecretsVault, profileId: () => Promise<string>): SecretsDeps {
  return {
    status: async () => vault.status(await profileId()),
    unlock: async (password) => {
      const id = await profileId()
      await vault.unlock(id, password)
      return vault.status(id)
    },
    lock: async () => {
      vault.lock()
      return vault.status(await profileId())
    },
    list: async () => vault.list(await profileId()),
    add: async (input) => vault.add(await profileId(), input),
    update: async (id, changes) => {
      const profile = await profileId()
      const old = vault.reveal(profile, id) // stays in this function
      const next = { ...old, ...changes, value: typeof changes.value === 'string' && changes.value !== '' ? changes.value : old.value, fields: old.fields }
      return vault.update(profile, id, next)
    },
    remove: async (id) => vault.remove(await profileId(), id),
    reveal: async (id) => vault.reveal(await profileId(), id).value,
    create: async (password, recovery) => {
      const p = await profileId()
      await vault.create(p, password, recovery)
      return vault.status(p)
    },
    recoveryQuestion: async () => vault.recoveryQuestion(await profileId()),
    recover: async (answer, password) => {
      const p = await profileId()
      await vault.recover(p, answer, password)
      return vault.status(p)
    },
    changePassword: async (current, next) => {
      const p = await profileId()
      await vault.changeMasterPassword(p, current, next)
      return vault.status(p)
    },
    setRecovery: async (password, recovery) => {
      const p = await profileId()
      await vault.setRecovery(p, password, recovery)
      return vault.status(p)
    },
    setAutoLock: async (password, ms) => {
      const p = await profileId()
      await vault.setAutoLock(p, password, ms)
      return vault.status(p)
    },
    destroy: async (password) => {
      const p = await profileId()
      await vault.destroy(p, password)
      return vault.status(p)
    }
  }
}

const bad = (message: string): HelperError => new HelperError('bad-request', message)
function str(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw bad(`${field} must be text of at most ${max} characters.`)
  return value
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 80) throw bad('Expected an id.')
  return value
}

/** The description of a secret from the panel: known fields only. `value` is write-only. */
export function secretChanges(raw: unknown, { create }: { create: boolean }): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('The secret must be an object.')
  const r = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (r.kind !== undefined) {
    if (!SECRET_KINDS.includes(r.kind as SecretKind)) throw bad('Unknown kind.')
    out.kind = r.kind
  }
  if (r.name !== undefined) out.name = str(r.name, 'name', 120)
  for (const f of ['provider', 'username', 'category'] as const) if (r[f] !== undefined) out[f] = str(r[f], f, 120)
  if (r.website !== undefined) out.website = str(r.website, 'website', 500)
  if (r.notes !== undefined) out.notes = str(r.notes, 'notes', 20_000)
  if (r.value !== undefined) out.value = str(r.value, 'value', 20_000)
  if (r.favorite !== undefined) {
    if (typeof r.favorite !== 'boolean') throw bad('favorite must be true or false.')
    out.favorite = r.favorite
  }
  if (r.tags !== undefined) {
    if (!Array.isArray(r.tags) || r.tags.length > 20) throw bad('tags must be a list of at most 20.')
    out.tags = r.tags.map((t) => str(t, 'tag', 40))
  }
  if (create && !out.name) throw bad('A secret needs a name.')
  return out
}

function recoveryPair(raw: unknown): { question: string; answer: string } | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw bad('The recovery must be an object.')
  const r = raw as Record<string, unknown>
  const question = typeof r.question === 'string' ? r.question.trim() : ''
  const answer = typeof r.answer === 'string' ? r.answer : ''
  if (question.length > 300 || answer.length > 1000) throw bad('That recovery question or answer is too long.')
  return question && answer ? { question, answer } : undefined
}
/** A new master password: the same rule the Orbis window applies. */
function newPassword(value: unknown): string {
  const wrong = checkMasterPassword(value)
  if (wrong) throw bad(wrong)
  return value as string
}

const CODES: Record<string, [string, string]> = {
  locked: ['locked', 'The vault is locked.'],
  'wrong-password': ['wrong-password', 'That is not the master password.'],
  'no-vault': ['no-vault', 'There is no vault on this profile yet.'],
  'not-found': ['not-found', 'That secret is no longer there.'],
  'bad-input': ['bad-request', 'There is nothing to save.'],
  'wrong-answer': ['wrong-answer', 'That is not the answer.'],
  'no-recovery': ['no-recovery', 'This vault has no recovery question, so it cannot be recovered.'],
  'already-exists': ['already-exists', 'This profile already has a vault.']
}

export function createSecretsHandlers(getDeps: () => SecretsDeps | null | undefined): Record<string, Handler> {
  const need = (): SecretsDeps => {
    const d = getDeps()
    if (!d) throw new HelperError('unavailable', 'The vault is not ready yet. Try again in a moment.')
    return d
  }
  // Vault failures carry a code and no data; anything else is reported without its text, which could hold a value.
  const guarded = (run: (a: unknown[]) => Promise<unknown> | unknown): Handler => async (a) => {
    try {
      return await run(a)
    } catch (err) {
      if (err instanceof HelperError) throw err
      if (err instanceof VaultFailure) throw new HelperError(...(CODES[err.code] ?? (['failed', 'The vault could not be read or written.'] as [string, string])))
      throw new HelperError('failed', 'The vault could not be read or written.')
    }
  }
  return {
    'secrets:status': guarded(() => need().status()),
    'secrets:unlock': guarded((a) => need().unlock(str(a[0], 'The master password', 1000))),
    'secrets:lock': guarded(() => need().lock()),
    'secrets:list': guarded(async (a) => {
      const deps = need()
      const status = await deps.status()
      if (!status.exists) throw new HelperError('no-vault', 'There is no vault on this profile yet. Make one in Orbis.')
      if (!status.unlocked) throw new HelperError('locked', 'The vault is locked.')
      const query = a[0] === undefined ? '' : str(a[0], 'query', 200)
      return (await deps.list()).filter((s) => matchesSearch(s, query))
    }),
    /** One value, on request, for the one secret asked for. Never logged; the panel shows it briefly and forgets it. */
    'secrets:reveal': guarded(async (a) => ({ value: await need().reveal(id(a[0])) })),
    'secrets:create': guarded((a) => need().create(newPassword(a[0]), recoveryPair(a[1]))),
    'secrets:question': guarded(async () => ({ question: await need().recoveryQuestion() })),
    'secrets:recover': guarded((a) => need().recover(str(a[0], 'The answer', 1000), newPassword(a[1]))),
    'secrets:change-password': guarded((a) => need().changePassword(str(a[0], 'The master password', 1000), newPassword(a[1]))),
    'secrets:set-recovery': guarded((a) => need().setRecovery(str(a[0], 'The master password', 1000), recoveryPair(a[1]) ?? null)),
    'secrets:auto-lock': guarded((a) => {
      if (typeof a[1] !== 'number' || !(AUTO_LOCK_CHOICES as readonly number[]).includes(a[1])) throw bad('Unknown auto-lock time.')
      return need().setAutoLock(str(a[0], 'The master password', 1000), a[1])
    }),
    'secrets:destroy': guarded((a) => need().destroy(str(a[0], 'The master password', 1000))),
    'secrets:add': guarded((a) => need().add(secretChanges(a[0], { create: true }))),
    'secrets:update': guarded((a) => need().update(id(a[0]), secretChanges(a[1], { create: false }))),
    'secrets:delete': guarded(async (a) => {
      await need().remove(id(a[0]))
      return { removed: true }
    })
  }
}
