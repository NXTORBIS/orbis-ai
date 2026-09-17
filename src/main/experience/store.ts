import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import type { ConfigChange, ExperienceConfig, ExperienceExport, ExperienceHealth, ImportCheck, Snapshot } from '../../shared/experience.ts'
import { DEFAULT_PROFILE_ID, dataDirFor } from '../../shared/profiles.ts'
import { addSnapshot, checkImport, defaultConfig, describeConfig, diffConfig, exportConfig, isDefaultConfig, migrateConfig, normalizeConfig } from '../../shared/experience.ts'

/**
 * Where the personalisation lives: one configuration file and a short history of snapshots beside it. A configuration
 * that cannot be read never stops Orbis — the last good snapshot is used, and failing that, Orbis's own defaults, with
 * the user told what happened.
 */
export type { ExperienceHealth }

export class ExperienceStore {
  private readonly userData: string
  /** Whose personalisation is loaded. Each profile keeps its own, in its own directory. */
  private profileId: string
  private dir: string
  private configFile: string
  private snapshotsFile: string
  private config: ExperienceConfig | null = null
  private snapshots: Snapshot[] = []
  private listeners = new Set<(config: ExperienceConfig) => void>()
  private writing: Promise<void> = Promise.resolve()
  private health: ExperienceHealth = { ok: true, problems: [], repairs: [], schemaVersion: 0, snapshots: 0 }

  constructor(userData: string, profileId: string = DEFAULT_PROFILE_ID) {
    this.userData = userData
    this.profileId = profileId
    this.dir = ''
    this.configFile = ''
    this.snapshotsFile = ''
    this.point(profileId)
  }

  /** Points at one profile's personalisation. The default profile keeps the place it has always kept. */
  private point(profileId: string): void {
    this.profileId = profileId
    this.dir = join(this.userData, dataDirFor(profileId), 'experience')
    this.configFile = join(this.dir, 'experience.json')
    this.snapshotsFile = join(this.dir, 'snapshots.json')
  }

  get profile(): string {
    return this.profileId
  }

  /**
   * Switches to another profile's personalisation.
   *
   * Everything personal is per profile — the widgets on the new tab, what each one is set to, the wallpaper, the
   * theme — because a profile that showed another profile's tasks widget would be showing another person's day.
   *
   * Anything still being written for the profile being left is finished first, against the paths it was written for,
   * so a switch part way through a save cannot put one profile's layout in another's file.
   */
  async useProfile(profileId: string): Promise<ExperienceConfig> {
    if (profileId === this.profileId) return this.config ?? this.load()
    await this.flush()
    this.point(profileId)
    this.config = null
    this.snapshots = []
    const loaded = await this.load()
    this.announce()
    return loaded
  }

  onChange(listener: (config: ExperienceConfig) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private announce(): void {
    for (const listener of [...this.listeners]) listener(this.config ?? defaultConfig())
  }

  /** Reads what is stored. Called once at startup; everything after that works from memory. */
  async load(): Promise<ExperienceConfig> {
    if (this.config) return this.config
    const problems: string[] = []
    const repairs: string[] = []
    this.snapshots = await this.readJson<Snapshot[]>(this.snapshotsFile, [])
      .then((list) => (Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string').map((s) => ({ ...s, config: normalizeConfig(s.config) })) : []))
      .catch(() => [])

    const raw = await this.readJson<unknown>(this.configFile, null).catch(() => 'unreadable')
    if (raw === 'unreadable') {
      problems.push('The personalisation file could not be read.')
      const lastGood = this.snapshots[0]
      if (lastGood) {
        this.config = lastGood.config
        repairs.push(`Went back to the snapshot from ${new Date(lastGood.takenAt).toLocaleString()}.`)
      } else {
        this.config = defaultConfig()
        repairs.push('Started again from the Orbis experience.')
      }
      await this.write()
    } else {
      const migrated = migrateConfig(raw)
      this.config = migrated.config
      if (migrated.recovered && raw !== null) {
        problems.push('The personalisation file did not make sense.')
        repairs.push('Started again from the Orbis experience.')
        await this.write()
      } else if (migrated.from !== undefined) {
        repairs.push(`Brought forward from an earlier Orbis (version ${migrated.from}).`)
        this.health.migratedFrom = migrated.from
        await this.write()
      }
    }
    this.health = { ...this.health, ok: problems.length === 0, problems, repairs, schemaVersion: this.config.schemaVersion, snapshots: this.snapshots.length }
    return this.config
  }

  current(): ExperienceConfig {
    return this.config ?? defaultConfig()
  }

  /** How the personalisation is doing: read at startup, and again whenever the user asks. */
  checkHealth(): ExperienceHealth {
    const problems = [...this.health.problems]
    const config = this.current()
    if (config.newTab.wallpaperId && !config.wallpapers.some((w) => w.id === config.newTab.wallpaperId)) problems.push('The chosen wallpaper is missing.')
    if (config.themeId && !config.themes.some((t) => t.id === config.themeId)) problems.push('The chosen theme is missing.')
    return { ...this.health, ok: problems.length === 0, problems, schemaVersion: config.schemaVersion, snapshots: this.snapshots.length }
  }

  /**
   * Saves a configuration. A snapshot of what it was is kept first, so every change can be undone, and the reason is
   * recorded so the list of snapshots reads like a history.
   */
  async save(next: ExperienceConfig, reason = 'Change'): Promise<{ config: ExperienceConfig; changes: ConfigChange[] }> {
    const before = this.current()
    const clean = { ...normalizeConfig(next), updatedAt: Date.now() }
    const changes = diffConfig(before, clean)
    if (!changes.length) return { config: before, changes: [] }
    this.snapshots = addSnapshot(this.snapshots, { id: crypto.randomUUID(), reason, takenAt: Date.now(), config: before })
    this.config = clean
    await this.write()
    this.announce()
    return { config: clean, changes }
  }

  listSnapshots(): { id: string; reason: string; takenAt: number; summary: string[] }[] {
    return this.snapshots.map((s) => ({ id: s.id, reason: s.reason, takenAt: s.takenAt, summary: describeConfig(s.config) }))
  }

  /** Goes back to a snapshot. Where things stand now becomes a snapshot too, so this can itself be undone. */
  async restoreSnapshot(id: string): Promise<ExperienceConfig> {
    const snapshot = this.snapshots.find((s) => s.id === id)
    if (!snapshot) throw new Error('That snapshot is no longer there.')
    const { config } = await this.save(snapshot.config, `Went back to “${snapshot.reason}”`)
    return config
  }

  async removeSnapshot(id: string): Promise<boolean> {
    const before = this.snapshots.length
    this.snapshots = this.snapshots.filter((s) => s.id !== id)
    if (this.snapshots.length === before) return false
    await this.write()
    return true
  }

  /** Puts one part back to how Orbis has it, leaving everything else alone. */
  async resetSection(section: keyof ExperienceConfig): Promise<ExperienceConfig> {
    const fresh = defaultConfig()
    if (!(section in fresh)) throw new Error('There is no such part to reset.')
    const { config } = await this.save({ ...this.current(), [section]: fresh[section] } as ExperienceConfig, `Reset ${String(section)}`)
    return config
  }

  /** Puts the whole customisation layer back, leaving tabs, bookmarks, notes, tasks and everything else untouched. */
  async restoreOriginal(): Promise<{ config: ExperienceConfig; wasDefault: boolean }> {
    const wasDefault = isDefaultConfig(this.current())
    const { config } = await this.save(defaultConfig(), 'Restored the original Orbis experience')
    return { config, wasDefault }
  }

  export(): ExperienceExport {
    return exportConfig(this.current())
  }

  /** Checks a file offered for import and says what is in it. Nothing is applied until the user says so. */
  check(raw: unknown): ImportCheck & { changes?: ConfigChange[] } {
    const result = checkImport(raw)
    return result.ok && result.config ? { ...result, changes: diffConfig(this.current(), result.config) } : result
  }

  /** Applies an import, either replacing what is there or keeping the parts the user already set. */
  async import(raw: unknown, how: 'replace' | 'merge' = 'replace'): Promise<{ config: ExperienceConfig; changes: ConfigChange[] }> {
    const checked = this.check(raw)
    if (!checked.ok || !checked.config) throw new Error(checked.problems[0] ?? 'That file could not be used.')
    const current = this.current()
    const merged: ExperienceConfig =
      how === 'merge'
        ? {
            ...checked.config,
            // Keeping what is here means the user's own things stay and the file only fills in what is untouched.
            wallpapers: [...current.wallpapers, ...checked.config.wallpapers.filter((w) => !current.wallpapers.some((mine) => mine.id === w.id))],
            themes: [...current.themes, ...checked.config.themes.filter((t) => !current.themes.some((mine) => mine.id === t.id))],
            themeId: current.themeId ?? checked.config.themeId,
            appearance: { ...checked.config.appearance, ...(current.appearance.accent ? { accent: current.appearance.accent } : {}) }
          }
        : checked.config
    return this.save(merged, how === 'merge' ? 'Imported and merged personalisation' : 'Imported personalisation')
  }

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(path, 'utf8')) as T
    } catch (err) {
      // A file that is not there is simply nothing yet; a file that is there but broken is a problem worth reporting.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
      throw err
    }
  }

  private write(): Promise<void> {
    const config = JSON.stringify(this.config)
    const snapshots = JSON.stringify(this.snapshots)
    // The paths are taken now, with the content. Reading them inside the queued write would let a profile switch
    // that happens while this is waiting put one profile's personalisation into another profile's file.
    const { dir, configFile, snapshotsFile } = this
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(`${configFile}.tmp`, config)
      await fs.rename(`${configFile}.tmp`, configFile)
      await fs.writeFile(`${snapshotsFile}.tmp`, snapshots)
      await fs.rename(`${snapshotsFile}.tmp`, snapshotsFile)
    })
    return this.writing.catch(() => undefined)
  }

  flush(): Promise<void> {
    return this.writing.catch(() => undefined)
  }
}
