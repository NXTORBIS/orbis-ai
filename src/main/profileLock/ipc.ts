import { ipcMain, powerMonitor } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { ProfileLockWatcher } from '../profileLockWatcher.ts'
import { AccountFailure, type AccountSecurity } from '../accountSecurity.ts'
import {
  DEFAULT_PROFILE_LOCK,
  PROFILE_LOCK_PRESETS,
  describeProfileLock,
  type ProfileLockPolicy,
  type ProfileLockTrigger
} from '../../shared/profileLock.ts'

/**
 * Profile Lock, joined up.
 *
 * The decisions are in `shared/profileLock.ts`, the watching in `profileLockWatcher.ts`, and the credential in
 * `accountSecurity.ts`. This is the wiring: the operating system's own events, the window's own events, and the window's
 * way in.
 *
 * Every signal here is a real Electron event or a real reading. `lock-screen`, `unlock-screen`, `suspend` and `resume`
 * come from Windows' own session notifications; `getSystemIdleTime` is the operating system's idea of how long nobody has
 * touched the machine. Nothing polls to find out whether Windows locked, and nothing guesses whether somebody is there.
 *
 * Locking means telling the account layer to forget its key and telling the window to put up the unlock screen it already
 * has -- the same screen Orbis shows at startup. There is no second lock screen, and no second authentication.
 */

export interface ProfileLockIpcOptions {
  accounts: AccountSecurity
  getWindow(): BrowserWindow | null
  send(channel: string, ...args: unknown[]): void
  /** The active profile, from the profile store -- never from a window. */
  profileId(): Promise<string>
  /** Told when the profile locks, so Tab Lock can shut everything it covers at the same moment. */
  onLocked?(trigger: ProfileLockTrigger): void
  /** Records something in the security log. Never awaited; the shape is fixed in `shared/securityEvents.ts`. */
  log?(event: unknown): void
}

export interface ProfileLockRuntime {
  /** Hooks the focus signals onto the Orbis window. Called again whenever the window is made. */
  attachWindow(): void
  /** Re-reads the policy for the profile now in use, and starts the clock. */
  profileChanged(): void
  /** Locks it now, from anywhere in the application. */
  lockNow(): void
  /** Called when the account has just been unlocked, so the clocks start again. */
  unlocked(): void
  stop(): void
}

export function registerProfileLockIpc(o: ProfileLockIpcOptions): ProfileLockRuntime {
  /**
   * The policy in force.
   *
   * Held as a plain value because the watcher asks for it synchronously, many times, on a timer. It is refreshed whenever
   * the profile changes and whenever it is saved, and it starts as off -- so the worst a stale value can do is fail to
   * lock a profile that has only just asked to be locked, never lock one that did not.
   */
  let policy: ProfileLockPolicy = DEFAULT_PROFILE_LOCK
  let profile = ''

  const watcher = new ProfileLockWatcher({
    policy: () => policy,
    isLocked: () => profile !== '' && !o.accounts.isUnlocked(profile),
    lock: (trigger) => {
      o.accounts.lock()
      // The window already has an unlock screen -- the one it shows at startup. It is told to show it, with why, so it can
      // say "Orbis locked because this computer locked" rather than appearing for no reason.
      o.send('account:locked', { reason: trigger })
      o.log?.({ kind: 'PROFILE_LOCKED', by: trigger })
      o.onLocked?.(trigger)
    },
    idleMs: () => {
      try {
        // Seconds from Electron, milliseconds here. Null rather than a guess if it cannot be read: a guess would be a
        // profile locking while somebody was using the computer.
        return powerMonitor.getSystemIdleTime() * 1000
      } catch {
        return null
      }
    }
  })

  const refresh = async (): Promise<void> => {
    profile = await o.profileId()
    policy = await o.accounts.profileLock(profile)
    watcher.policyChanged()
  }

  // ---------------------------------------------------------------- the computer's own events

  const onSystemLock = (): void => {
    // Recorded whether or not it led to a lock: "this computer locked and Orbis did not" is a thing worth being able to see.
    o.log?.({ kind: 'WINDOW_LOCK_DETECTED' })
    void watcher.systemLocked()
  }
  const onSystemUnlock = (): void => void watcher.systemUnlocked()
  const onSuspend = (): void => {
    o.log?.({ kind: 'SYSTEM_SLEEP_DETECTED' })
    void watcher.systemLocked()
  }
  const onResume = (): void => void watcher.resumed()

  powerMonitor.on('lock-screen', onSystemLock)
  powerMonitor.on('unlock-screen', onSystemUnlock)
  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('resume', onResume)

  // ---------------------------------------------------------------- the window's own events

  let attachedTo: BrowserWindow | null = null
  const attachWindow = (): void => {
    const win = o.getWindow()
    if (!win || win === attachedTo || win.isDestroyed()) return
    attachedTo = win
    win.on('blur', () => void watcher.focusChanged(false))
    win.on('focus', () => void watcher.focusChanged(true))
    win.on('closed', () => {
      attachedTo = null
      // The last window has gone. A policy that says so locks here; otherwise nothing happens, and Orbis is still running.
      void watcher.allWindowsClosed()
    })
  }
  attachWindow()

  // ---------------------------------------------------------------- what the window may ask for

  const handle = (channel: string, run: (profileId: string, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== o.getWindow()?.webContents) throw new Error('Not allowed.')
      try {
        return await run(await o.profileId(), ...args)
      } catch (err) {
        if (err instanceof AccountFailure) return { error: err.code, message: err.message, waitMs: err.waitMs }
        return { error: 'io' }
      }
    })
  }

  const state = async (profileId: string): Promise<{
    policy: ProfileLockPolicy
    presets: typeof PROFILE_LOCK_PRESETS
    explains: string[]
    hasPassword: boolean
    locked: boolean
    /** Whether the operating system can say how idle the computer is, so the interface only offers what will work. */
    idleAvailable: boolean
  }> => {
    profile = profileId
    policy = await o.accounts.profileLock(profileId)
    watcher.policyChanged()
    let idleAvailable = false
    try {
      idleAvailable = typeof powerMonitor.getSystemIdleTime() === 'number'
    } catch {
      idleAvailable = false
    }
    return {
      policy,
      presets: PROFILE_LOCK_PRESETS,
      explains: describeProfileLock(policy),
      hasPassword: await o.accounts.hasPassword(profileId),
      locked: !o.accounts.isUnlocked(profileId),
      idleAvailable
    }
  }

  handle('profileLock:state', (id) => state(id))

  handle('profileLock:save', async (id, raw) => {
    // The store refuses a policy on a profile with no password, because there would be nothing to unlock it with.
    await o.accounts.setProfileLock(id, raw)
    o.log?.({ kind: 'POLICY_CHANGED' })
    return { ok: true, state: await state(id) }
  })

  handle('profileLock:lock', async (id) => {
    watcher.lockNow()
    return { ok: true, state: await state(id) }
  })

  void refresh().then(() => {
    watcher.start()
    // Orbis has started. A policy that says to lock on startup does so now, before the window is shown -- which is the
    // same moment the account's own startup check happens, so there is one unlock screen rather than two.
    watcher.started()
  })

  return {
    attachWindow,
    profileChanged: () => {
      // A different profile's rules are not this one's, and an account unlocked for one profile is not unlocked for
      // another -- which the account layer has already seen to.
      policy = DEFAULT_PROFILE_LOCK
      void refresh()
    },
    lockNow: () => void watcher.lockNow(),
    unlocked: () => watcher.unlocked(),
    stop: () => {
      powerMonitor.off('lock-screen', onSystemLock)
      powerMonitor.off('unlock-screen', onSystemUnlock)
      powerMonitor.off('suspend', onSuspend)
      powerMonitor.off('resume', onResume)
      watcher.stop()
    }
  }
}
