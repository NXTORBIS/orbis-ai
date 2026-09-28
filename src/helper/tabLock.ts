import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * What the browser's lock surface may ask Orbis.
 *
 * The password lives on this side, so the checking does too. The browser draws the lock screen and hides the tab; it
 * never sees a credential and never decides whether one is right -- a browser that could would be a second place that
 * could be wrong about whether a tab may open.
 *
 * Three channels, and between them they are the whole of the conversation: what am I covering, here is the password, and
 * here is my account password instead. Nothing here returns an address, a title or anything else about the page, because
 * the surface that would receive it is drawn over a tab whose identity is the thing being hidden.
 */

export interface TabLockDeps {
  /** Whether the account password can reset this tab's credential, and what a locked tab is called. */
  surface(tabId: number): Promise<{ label: string; recoverable: boolean; locked: boolean }>
  /** The tab password. Resolves when the tab is open; throws with a code when it is not. */
  unlock(tabId: number, password: string): Promise<void>
  /** The account password, authorising a new tab password. Never reveals the old one. */
  recover(tabId: number, accountPassword: string, next: string): Promise<void>
  /**
   * The three locking commands the Command Centre offers.
   *
   * All in the safe direction, which is why they need no credential: locking something can be undone by whoever has the
   * password, and doing it by mistake costs a person one moment of typing. There is deliberately nothing here that
   * unlocks -- that needs a password, and a password belongs to the person.
   */
  lockActiveTab(): Promise<{ locked: boolean; reason?: string }>
  lockAll(): Promise<{ locked: number }>
  lockProfile(): Promise<void>
}

/** A refusal the page can act on, and a sentence it can show. Never anything of a credential or a page. */
const CODES: Record<string, [string, string]> = {
  'no-group': ['no-group', 'That tab is not locked.'],
  'wrong-password': ['wrong-password', 'That is not the password for this tab.'],
  'weak-password': ['weak-password', 'Choose a longer password.'],
  'cooling-down': ['cooling-down', 'Too many attempts. Wait a moment and try again.'],
  'no-recovery': ['no-recovery', 'Your account password cannot reset this one.'],
  'account-locked': ['account-locked', 'Open Orbis and sign in to your account first.'],
  'bad-input': ['bad-request', 'That is not something Orbis can act on.']
}

const tabId = (value: unknown): number => {
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new HelperError('bad-request', 'Which tab?')
  }
  return n
}

const password = (value: unknown): string => {
  // Length only. What makes a password acceptable is decided in one place, and it is not here -- this only refuses what
  // cannot be a password at all, so a 3 MB request never reaches the key derivation.
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new HelperError('bad-request', 'Enter a password.')
  }
  return value
}

export function createTabLockHandlers(getDeps: () => TabLockDeps | null | undefined): Record<string, Handler> {
  const need = (): TabLockDeps => {
    const d = getDeps()
    if (!d) throw new HelperError('unavailable', 'Orbis is not ready yet. Try again in a moment.')
    return d
  }

  const guarded =
    (run: (a: unknown[]) => Promise<unknown> | unknown): Handler =>
    async (a) => {
      try {
        return await run(a)
      } catch (err) {
        if (err instanceof HelperError) throw err
        const code = (err as { code?: string })?.code
        if (code && CODES[code]) throw new HelperError(...CODES[code])
        // Anything unrecognised is reported without its text. A message from further in could hold a value.
        throw new HelperError('failed', 'That did not work.')
      }
    }

  return {
    'tabLock:surface': guarded(async (a) => need().surface(tabId(a[0]))),
    'tabLock:unlock': guarded(async (a) => {
      await need().unlock(tabId(a[0]), password(a[1]))
      return { ok: true }
    }),
    'tabLock:recover': guarded(async (a) => {
      await need().recover(tabId(a[0]), password(a[1]), password(a[2]))
      return { ok: true }
    }),
    // The Command Centre's locking commands. No arguments: "this tab" and "everything" are things Orbis already knows, and
    // letting a page name a tab here would be letting a page lock one it had no business knowing about.
    'security:lockTab': guarded(async () => need().lockActiveTab()),
    'security:lockAll': guarded(async () => need().lockAll()),
    'security:lockProfile': guarded(async () => {
      await need().lockProfile()
      return { ok: true }
    })
  }
}
