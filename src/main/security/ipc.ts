import type { BrowserWindow } from 'electron'

import { AccountFailure } from '../accountSecurity.ts'
import type { AccountSecurity } from '../accountSecurity.ts'
import { profileHandle } from '../ipc/handle.ts'
import type { SecurityLog } from '../securityLog.ts'

/**
 * The account password, and the log of what has been done with it.
 *
 * Eight channels, lifted out of the middle of `index.ts`. Three rules that are easier to hold on to here than they
 * were among five thousand other lines:
 *
 * **A failure carries a code, a sentence and a cooldown, and nothing else.** No part of a password, no part of an
 * attempt. The sentence is written for a person to read; the code is what the window acts on.
 *
 * **Attempts that fail are recorded; what was typed is not.** Somebody finding attempts they did not make is the
 * whole reason the log exists, so a wrong password writes a row -- `FAILED_ACCOUNT_UNLOCK` -- and the row says
 * only that one was wrong.
 *
 * **There is no channel that writes to the log.** Events are recorded by the code that does the thing, so a window
 * cannot put an event in somebody's security log that did not happen. Reading and clearing are all there is, and
 * clearing answers with what the store actually managed rather than `{ ok: true }` regardless: a log file another
 * program is holding stays where it is, and a window told the clear worked would show an empty list that fills
 * itself back in at the next launch.
 */

export interface SecurityIpcOptions {
  accounts: AccountSecurity
  securityLog: SecurityLog
  getWindow(): BrowserWindow | null
  /** The active profile, asked at the moment of the call. */
  profileId(): Promise<string>
  /** Writes a row in this profile's security log. */
  record(event: unknown): void
  /**
   * Somebody has just typed a password into this window.
   *
   * The idle and focus clocks that lock Orbis start again from now rather than from whenever they last ran --
   * otherwise unlocking could be followed immediately by locking.
   */
  unlocked(): void
}

const str = (value: unknown, max = 256): string => (typeof value === 'string' ? value.slice(0, max) : '')

export function registerSecurityIpc(o: SecurityIpcOptions): void {
  const { accounts, securityLog } = o
  const handle = profileHandle({
    ...o,
    failure: (err) => (err instanceof AccountFailure ? { error: err.code, message: err.message, waitMs: err.waitMs } : { error: 'io' })
  })

  handle('account:status', (id) => accounts.status(id))

  handle('account:create', async (id, password, name) => {
    await accounts.create(id, str(password), str(name, 80))
    o.record({ kind: 'ACCOUNT_CREATED' })
    return accounts.status(id)
  })

  handle('account:unlock', async (id, password) => {
    try {
      await accounts.unlock(id, str(password))
    } catch (err) {
      if (err instanceof AccountFailure && err.code === 'wrong-password') o.record({ kind: 'FAILED_ACCOUNT_UNLOCK' })
      throw err
    }
    o.record({ kind: 'ACCOUNT_UNLOCKED' })
    o.unlocked()
    return accounts.status(id)
  })

  handle('account:lock', async (id) => {
    accounts.lock()
    return accounts.status(id)
  })

  handle('account:verify', async (id, password) => ({ ok: await accounts.verify(id, str(password)) }))

  handle('account:change', async (id, current, next, name) => {
    await accounts.change(id, str(current), str(next), str(name, 80))
    o.record({ kind: 'ACCOUNT_PASSWORD_CHANGED' })
    return accounts.status(id)
  })

  handle('security:log', (id) => securityLog.all(id))
  handle('security:clear-log', async (id) => ({ ok: await securityLog.clear(id) }))
}
