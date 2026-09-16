/**
 * Profiles: separate browsing identities inside Orbis. Each has its own cookies, logins, site storage, history,
 * bookmarks, downloads and open pages. Pure — no browser, no storage.
 */

export interface Profile {
  id: string
  name: string
  color: string
  /** The letter shown on the profile's mark, when no picture is set. */
  initial: string
  createdAt: number
  lastUsedAt: number
  order: number
}

export const PROFILE_COLORS = ['#3fd8ff', '#3ee58a', '#ffbe4d', '#ff4d6d', '#a78bfa', '#f472b6', '#60a5fa']
export const DEFAULT_PROFILE_ID = 'default'
export const MAX_PROFILES = 20

/** Where a profile's browsing data lives. The first profile keeps Orbis's original session, so nothing is lost. */
export const partitionFor = (id: string): string => (id === DEFAULT_PROFILE_ID ? 'persist:browser' : `persist:profile-${id}`)

/** The folder a profile's history, bookmarks and downloads live in, under the user's data folder. */
export const dataDirFor = (id: string): string => (id === DEFAULT_PROFILE_ID ? '.' : `profiles/${id}`)

const now = (): number => Date.now()

const initialOf = (name: string): string => (name.trim()[0] ?? 'O').toUpperCase()

export function newProfile(patch: Partial<Profile> = {}): Profile {
  const name = (patch.name ?? 'New profile').replace(/\s+/g, ' ').trim().slice(0, 40) || 'New profile'
  return {
    id: patch.id ?? crypto.randomUUID(),
    color: PROFILE_COLORS[0],
    createdAt: now(),
    lastUsedAt: now(),
    order: 0,
    ...patch,
    // The tidied name and its mark always win over whatever was passed in.
    name,
    initial: (patch.initial?.trim()?.[0] ?? initialOf(name)).toUpperCase()
  }
}

export const defaultProfile = (): Profile => newProfile({ id: DEFAULT_PROFILE_ID, name: 'Personal', color: PROFILE_COLORS[0], order: -1 })

export function normalizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Profile>
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(r.id)) return null
  const name = (typeof r.name === 'string' ? r.name : '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Profile'
  return {
    id: r.id,
    name,
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : PROFILE_COLORS[0],
    initial: (typeof r.initial === 'string' && r.initial.trim() ? r.initial.trim()[0] : initialOf(name)).toUpperCase(),
    createdAt: Number(r.createdAt) || now(),
    lastUsedAt: Number(r.lastUsedAt) || Number(r.createdAt) || now(),
    order: Number(r.order) || 0
  }
}

/** The profiles in the order they are shown: the first profile always comes first. */
export const sortProfiles = (profiles: Profile[]): Profile[] => [...profiles].sort((a, b) => (a.id === DEFAULT_PROFILE_ID ? -1 : b.id === DEFAULT_PROFILE_ID ? 1 : a.order - b.order || a.createdAt - b.createdAt))

/** What deleting a profile would take with it, so the user is told before anything goes. */
export interface ProfileRemoval {
  allowed: boolean
  reason?: string
}

export function canRemove(profile: Profile, isActive: boolean, total: number): ProfileRemoval {
  if (profile.id === DEFAULT_PROFILE_ID) return { allowed: false, reason: 'The first profile cannot be deleted.' }
  if (isActive) return { allowed: false, reason: 'Switch to another profile before deleting this one.' }
  if (total <= 1) return { allowed: false, reason: 'There would be no profile left.' }
  return { allowed: true }
}
