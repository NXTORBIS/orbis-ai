import type { DomainRule, LockTrigger, PresetName, TabLockPolicy } from './tabLock.ts'

/**
 * What a window is told about Tab Lock.
 *
 * Kept apart from `tabLock.ts` because that file is the decisions and this is the shape they travel in. Nothing here
 * carries a credential, a page's address or a page's title -- a locked tab is a tab id, a label and a reason, and that
 * is deliberately all the interface can draw.
 */

/** A tab password, as a window may know it. */
export interface TabLockGroup {
  id: string
  name: string
  policy: TabLockPolicy
  /** Whether the account password can reset this one. False is said plainly rather than quietly assumed. */
  recoverable: boolean
  /** Whether it has been opened this session. */
  open: boolean
  /** How long before another attempt is accepted, after wrong ones. */
  cooldownMs: number
  createdAt: number
}

/** A protected tab. No address, no title: a settings screen is a strange place to reveal what somebody chose to hide. */
export interface TabLockTab {
  tabId: number
  groupId: string
  locked: boolean
  lockedBy: LockTrigger | null
  label: string
}

export interface TabLockState {
  groups: TabLockGroup[]
  rules: DomainRule[]
  /** What a newly protected tab does when nothing more specific says otherwise. */
  defaultPolicy: TabLockPolicy
  presets: Record<PresetName, TabLockPolicy>
  tabs: TabLockTab[]
}

/** Every change answers with the whole state, so no screen ever draws half of it. */
export interface TabLockDone {
  ok: true
  state: TabLockState
}

export type TabLockErrorCode =
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

/** A refusal: a code to act on, a sentence to show, and how long to wait. Never anything of the credential. */
export interface TabLockRefusal {
  error: TabLockErrorCode
  message?: string
  waitMs?: number
}

export const isTabLockRefusal = (value: unknown): value is TabLockRefusal =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

/** Why a tab is protected, in sentences, so the lock screen explains itself rather than asserting. */
export interface TabLockExplanation {
  locked: boolean
  label: string
  recoverable: boolean
  reasons: string[]
  inactivity: string
}
