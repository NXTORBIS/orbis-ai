/**
 * What a window may know about the password on an account.
 *
 * Deliberately almost nothing. Whether there is one, whether it has been given this session, and whether guessing is
 * currently being refused -- which is everything a screen needs to decide what to draw, and nothing an attacker could
 * use. The credential itself never crosses into a window in any form.
 */

export interface AccountStatus {
  /** Whether this profile has a password. An account made before passwords existed has none. */
  hasPassword: boolean
  /** Whether the password has been given in this session. */
  unlocked: boolean
  /** How much longer guessing is refused for, in milliseconds, or 0. */
  cooldownMs: number
  /** Failed attempts since the last success. */
  failures: number
}

/** Why something was refused. A code, so the window decides the wording for anything it wants to word itself. */
export type AccountErrorCode =
  | 'no-account'
  | 'already-exists'
  | 'wrong-password'
  | 'weak-password'
  | 'cooling-down'
  | 'io'

/** What comes back when it did not work. `message` is already a sentence fit to show. */
export interface AccountRefusal {
  error: AccountErrorCode
  message?: string
  /** For 'cooling-down', how much longer to wait. */
  waitMs?: number
}

export const isRefusal = (result: unknown): result is AccountRefusal =>
  typeof result === 'object' && result !== null && typeof (result as AccountRefusal).error === 'string'
