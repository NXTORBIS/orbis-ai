import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import type { Profile } from '../../shared/profiles'
import { canRemove, dataDirFor, DEFAULT_PROFILE_ID, defaultProfile, MAX_PROFILES, newProfile, normalizeProfile, sortProfiles } from '../../shared/profiles'
import { Collection, JsonFile } from './store'

/**
 * Profiles as they are kept: the list, and which one is in use. The first profile is Orbis's original browsing data, so
 * upgrading changes nothing for someone who never makes a second profile.
 */
export class ProfilesStore {
  private readonly profiles: Collection<Profile>
  private readonly activeFile: JsonFile<{ id: string }>

  constructor(private readonly userData: string) {
    this.profiles = new Collection<Profile>(join(userData, 'personal', 'profiles.json'), normalizeProfile, MAX_PROFILES)
    this.activeFile = new JsonFile<{ id: string }>(
      join(userData, 'personal', 'active-profile.json'),
      () => ({ id: DEFAULT_PROFILE_ID }),
      (raw) => ({ id: typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : DEFAULT_PROFILE_ID })
    )
  }

  onChange(listener: () => void): () => void {
    return this.profiles.onChange(listener)
  }

  /** Every profile, the first one always first. There is always at least one. */
  async list(): Promise<Profile[]> {
    const stored = await this.profiles.all()
    const withDefault = stored.some((p) => p.id === DEFAULT_PROFILE_ID) ? stored : [defaultProfile(), ...stored]
    return sortProfiles(withDefault)
  }

  async activeId(): Promise<string> {
    const { id } = await this.activeFile.read()
    const all = await this.list()
    return all.some((p) => p.id === id) ? id : DEFAULT_PROFILE_ID
  }

  async active(): Promise<Profile> {
    const id = await this.activeId()
    return (await this.list()).find((p) => p.id === id) ?? defaultProfile()
  }

  get(id: string): Promise<Profile | null> {
    return this.profiles.get(id)
  }

  async create(patch: Partial<Profile> = {}): Promise<Profile> {
    const all = await this.list()
    if (all.length >= MAX_PROFILES) throw new Error('There is no room for another profile.')
    // The first profile is only written down once a second one exists, so its data keeps its original place.
    if (!all.some((p) => p.id === DEFAULT_PROFILE_ID) || !(await this.profiles.get(DEFAULT_PROFILE_ID))) await this.profiles.put(defaultProfile())
    return this.profiles.put(newProfile({ order: all.length, ...patch }))
  }

  async save(profile: Profile): Promise<Profile> {
    return this.profiles.put(profile)
  }

  async rename(id: string, name: string): Promise<Profile> {
    const profile = (await this.list()).find((p) => p.id === id)
    if (!profile) throw new Error('That profile no longer exists.')
    return this.profiles.put(newProfile({ ...profile, name }))
  }

  /** Marks which profile is in use. The caller does the switching itself. */
  async setActive(id: string): Promise<Profile> {
    const profile = (await this.list()).find((p) => p.id === id)
    if (!profile) throw new Error('There is no such profile.')
    await this.activeFile.write({ id })
    await this.activeFile.flush()
    if (profile.id !== DEFAULT_PROFILE_ID || (await this.profiles.get(DEFAULT_PROFILE_ID))) await this.profiles.put({ ...profile, lastUsedAt: Date.now() })
    return profile
  }

  /** Deletes a profile and everything it kept: its history, bookmarks and downloads list. */
  async remove(id: string): Promise<{ removed: boolean; reason?: string }> {
    const all = await this.list()
    const profile = all.find((p) => p.id === id)
    if (!profile) return { removed: false, reason: 'There is no such profile.' }
    const allowed = canRemove(profile, id === (await this.activeId()), all.length)
    if (!allowed.allowed) return { removed: false, reason: allowed.reason }
    await this.profiles.remove(id)
    await fs.rm(this.dataDir(id), { recursive: true, force: true }).catch(() => undefined)
    return { removed: true }
  }

  /** Where this profile's history, bookmarks and downloads live. */
  dataDir(id: string): string {
    const relative = dataDirFor(id)
    return relative === '.' ? this.userData : join(this.userData, relative)
  }

  flush(): Promise<void> {
    return Promise.all([this.profiles.flush(), this.activeFile.flush()]).then(() => undefined)
  }
}
