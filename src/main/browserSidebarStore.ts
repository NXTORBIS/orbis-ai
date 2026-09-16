import { join } from 'node:path'
import { JsonFile } from './personal/store.ts'
import { dataDirFor } from '../shared/profiles.ts'
import { defaultLayout, normalizeLayout } from '../shared/browserSidebar.ts'
import type { SidebarLayout } from '../shared/browserSidebar'

/**
 * How each profile has arranged the browser sidebar.
 *
 * One arrangement per profile, kept beside that profile's other browsing data, because a work profile and a personal
 * one are separate lives and there is no reason the panels either keeps to hand should follow the other around.
 *
 * Nothing here decides what an arrangement may contain: that is the shared module's job, and everything read from disk
 * goes through it, so a file written by an older Orbis — or by hand — still opens a working sidebar.
 */
export class BrowserSidebarStore {
  private readonly files = new Map<string, JsonFile<SidebarLayout>>()
  private readonly listeners = new Set<(profileId: string, layout: SidebarLayout) => void>()
  private readonly userData: string

  constructor(userData: string) {
    this.userData = userData
  }

  onChange(listener: (profileId: string, layout: SidebarLayout) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private fileFor(profileId: string): JsonFile<SidebarLayout> {
    const existing = this.files.get(profileId)
    if (existing) return existing
    const file = new JsonFile<SidebarLayout>(join(this.userData, dataDirFor(profileId), 'browser-sidebar.json'), defaultLayout, normalizeLayout)
    this.files.set(profileId, file)
    return file
  }

  async read(profileId: string): Promise<SidebarLayout> {
    return this.fileFor(profileId).read()
  }

  /** Saves an arrangement. What comes in is checked first, so a bad one can never be written. */
  async write(profileId: string, layout: unknown): Promise<SidebarLayout> {
    const safe = normalizeLayout(layout)
    await this.fileFor(profileId).write(safe)
    for (const listener of [...this.listeners]) listener(profileId, safe)
    return safe
  }

  async reset(profileId: string): Promise<SidebarLayout> {
    return this.write(profileId, defaultLayout())
  }

  /** Written to disk now — before quitting, and in tests. */
  async flush(): Promise<void> {
    await Promise.all([...this.files.values()].map((file) => file.flush()))
  }

  /** Forgets a profile's arrangement, when the profile itself is deleted. */
  forget(profileId: string): void {
    this.files.delete(profileId)
  }
}
