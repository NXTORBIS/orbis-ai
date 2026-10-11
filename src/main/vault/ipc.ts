import type { BrowserWindow } from 'electron'

import { profileHandle } from '../ipc/handle.ts'
import { VaultFailure } from './store.ts'
import type { SecretsVault } from './store.ts'

/**
 * The Secrets Vault's door to the Orbis window.
 *
 * Fifteen channels, and they were written out in the middle of `index.ts` with everything else. What makes them
 * worth their own file is not length: it is that the rules below are easy to state and easy to lose track of in a
 * five-thousand-line function.
 *
 * **The key never leaves this process and the window never receives it.** Nothing here returns a secret except
 * `vault:reveal`, which returns one secret that was asked for by id.
 *
 * **The profile comes from the profile store, never from the window.** `profileHandle` reads it at the moment of
 * the call, so a window cannot ask for another profile's vault and a profile switch mid-call cannot answer the new
 * profile's question out of the old profile's vault.
 *
 * **A failure is a code and nothing else.** Not a sentence, unlike everywhere else in Orbis: a message from inside
 * the vault could carry a label, a name, or the shape of what is stored, and the window has nothing to do with any
 * of it. The window turns the code into words of its own.
 */

export interface VaultIpcOptions {
  vault: SecretsVault
  getWindow(): BrowserWindow | null
  /** The active profile, asked at the moment of the call. */
  profileId(): Promise<string>
}

/** Strings only, bounded. Anything else is the empty string, which every call below then refuses on its own terms. */
const str = (value: unknown, max = 4096): string => (typeof value === 'string' ? value.slice(0, max) : '')

export function registerVaultIpc(o: VaultIpcOptions): void {
  const { vault } = o
  const handle = profileHandle({
    ...o,
    // The reason travels as a code the window can act on; nothing of the vault ever does.
    failure: (err) => ({ error: err instanceof VaultFailure ? err.code : 'io' })
  })

  handle('vault:status', (id) => vault.status(id))
  handle('vault:question', (id) => vault.recoveryQuestion(id))

  handle('vault:create', async (id, password, recovery) => {
    const r = (recovery ?? {}) as { question?: unknown; answer?: unknown }
    await vault.create(id, str(password), str(r.question) && str(r.answer) ? { question: str(r.question, 300), answer: str(r.answer) } : undefined)
    return vault.status(id)
  })

  handle('vault:unlock', async (id, password) => {
    await vault.unlock(id, str(password))
    return vault.status(id)
  })

  handle('vault:lock', async (id) => {
    vault.lock()
    return vault.status(id)
  })

  handle('vault:list', (id) => vault.list(id))
  handle('vault:reveal', (id, secretId) => vault.reveal(id, str(secretId, 80)))
  handle('vault:add', (id, secret) => vault.add(id, secret))
  handle('vault:update', (id, secretId, secret) => vault.update(id, str(secretId, 80), secret))
  handle('vault:remove', (id, secretId) => vault.remove(id, str(secretId, 80)))

  handle('vault:change-password', async (id, current, next) => {
    await vault.changeMasterPassword(id, str(current), str(next))
    return vault.status(id)
  })

  handle('vault:set-recovery', async (id, password, recovery) => {
    const r = recovery as { question?: unknown; answer?: unknown } | null
    await vault.setRecovery(id, str(password), r && str(r.question) && str(r.answer) ? { question: str(r.question, 300), answer: str(r.answer) } : null)
    return vault.status(id)
  })

  handle('vault:recover', async (id, answer, password) => {
    await vault.recover(id, str(answer), str(password))
    return vault.status(id)
  })

  handle('vault:auto-lock', async (id, password, ms) => {
    await vault.setAutoLock(id, str(password), typeof ms === 'number' ? ms : 0)
    return vault.status(id)
  })

  handle('vault:destroy', async (id, password) => {
    await vault.destroy(id, str(password))
    return vault.status(id)
  })
}
