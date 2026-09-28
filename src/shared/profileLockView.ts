import type { ProfileLockPolicy, ProfileLockPreset, ProfileLockTrigger } from './profileLock.ts'

/**
 * What a window is told about Profile Lock.
 *
 * Kept apart from `profileLock.ts` because that file is the decisions and this is the shape they travel in.
 */

export interface ProfileLockState {
  policy: ProfileLockPolicy
  presets: Record<ProfileLockPreset, ProfileLockPolicy>
  /** What this policy actually does, in sentences, so the screen states it rather than leaving it to be worked out. */
  explains: string[]
  /** Whether this profile has an account password. Without one there is nothing to unlock Orbis with. */
  hasPassword: boolean
  locked: boolean
  /**
   * Whether the operating system can say how idle the computer is.
   *
   * False means the inactivity setting would never fire, so the screen does not offer it. A control that quietly does
   * nothing is worse than no control.
   */
  idleAvailable: boolean
}

export interface ProfileLockDone {
  ok: true
  state: ProfileLockState
}

export interface ProfileLockRefusal {
  error: string
  message?: string
  waitMs?: number
}

export const isProfileLockRefusal = (value: unknown): value is ProfileLockRefusal =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

/** Why Orbis locked itself, as the window is told. */
export interface ProfileLockedEvent {
  reason: ProfileLockTrigger
}
