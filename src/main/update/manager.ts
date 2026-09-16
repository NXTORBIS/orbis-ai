import { EventEmitter } from 'node:events'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canMoveTo, decideUpdate, DEFAULT_CHANNEL, idleStatus, isChannel, platformKey, readManifest } from '../../shared/updates'
import type { Channel, OrbisPlatform, ReleaseManifest, UpdateState, UpdateStatus } from '../../shared/updates'
import { Downloader } from './download'
import { Installer, validateInstall } from './installer'
import type { InstallPlan } from './installer'
import { recoveryFor, UpdateJournal } from './journal'

/**
 * The one place that knows about updating Orbis.
 *
 * Everything else — settings, the startup check, Orion — asks this rather than doing any of it itself, so there is
 * only ever one account of what is happening. It owns the state an update is in, the package on disk, the record of
 * what an interrupted update got as far as, and the decision to hand over to the installer.
 *
 * It updates the application. It has no idea what a profile is, and nothing it does reaches one.
 */

export interface UpdateSettings {
  channel: Channel
  checkAutomatically: boolean
  downloadAutomatically: boolean
  /** Restarting to install is the user's decision unless they say otherwise. */
  installAutomatically: boolean
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  channel: DEFAULT_CHANNEL,
  checkAutomatically: true,
  downloadAutomatically: true,
  installAutomatically: false
}

/** How often to look, once Orbis has been running a while. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
/** How long after starting to look the first time, so nothing competes with getting the window up. */
export const FIRST_CHECK_AFTER_MS = 45_000

export interface UpdateHistoryEntry {
  version: string
  at: number
  outcome: 'installed' | 'rolled-back' | 'failed'
  note?: string
}

export interface ManagerOptions {
  /** Where the updater keeps its things: packages, the copy of the previous version, its record and its log. */
  directory: string
  currentVersion: string
  installDirectory: string
  executablePath: string
  platform: OrbisPlatform
  arch: string
  /** Where to ask what the latest release is. Set by the build, so a production Orbis never asks a test server. */
  endpoint: string
  pid: number
  /** Quits Orbis so the installer can take over. */
  quit(): void
  spawnDetached(command: string, args: string[]): Promise<void>
  /** Whether the user's profiles can still be read, used to decide an update really worked. */
  profilesReadable(): Promise<boolean>
  fetchFn?: typeof fetch
  freeSpace?(path: string): Promise<number>
}

export class UpdateManager extends EventEmitter {
  private readonly o: ManagerOptions
  private readonly journal: UpdateJournal
  private readonly downloader: Downloader
  private readonly installer: Installer
  private status: UpdateStatus
  private settings: UpdateSettings = { ...DEFAULT_UPDATE_SETTINGS }
  private manifest: ReleaseManifest | null = null
  private packagePath: string | null = null
  private downloadAbort: AbortController | null = null
  private timer: NodeJS.Timeout | null = null
  private history: UpdateHistoryEntry[] = []

  constructor(options: ManagerOptions) {
    super()
    this.o = options
    this.journal = new UpdateJournal(options.directory)
    this.downloader = new Downloader({ ...(options.fetchFn ? { fetchFn: options.fetchFn as never } : {}), ...(options.freeSpace ? { freeSpace: options.freeSpace } : {}) })
    this.installer = new Installer({
      pid: options.pid,
      platform: options.platform,
      spawnDetached: options.spawnDetached,
      freeSpace: options.freeSpace ?? (async () => Number.POSITIVE_INFINITY)
    })
    this.status = idleStatus(options.currentVersion)
  }

  // ---------------------------------------------------------------- state

  getState(): UpdateState {
    return this.status.state
  }
  getStatus(): UpdateStatus {
    return { ...this.status }
  }
  getSettings(): UpdateSettings {
    return { ...this.settings }
  }
  getCurrentVersion(): string {
    return this.o.currentVersion
  }
  getAvailableVersion(): string | null {
    return this.status.availableVersion
  }
  getReleaseNotes(): string {
    return this.status.releaseNotes
  }
  getUpdateHistory(): UpdateHistoryEntry[] {
    return [...this.history]
  }

  /** Every change to an update goes through here, so a state cannot be reached from somewhere it should not be. */
  private moveTo(state: UpdateState, patch: Partial<UpdateStatus> = {}): boolean {
    if (state !== this.status.state && !canMoveTo(this.status.state, state)) {
      this.log(`refused to go from ${this.status.state} to ${state}`)
      return false
    }
    this.status = { ...this.status, ...patch, state }
    this.emit('changed', this.getStatus())
    this.emit(state)
    return true
  }

  private async log(line: string): Promise<void> {
    // A local, technical record of what the updater did. Nothing about the user goes in it.
    try {
      await mkdir(this.o.directory, { recursive: true })
      await writeFile(join(this.o.directory, 'update.log'), `[${new Date().toISOString()}] ${line}\n`, { flag: 'a' })
    } catch {
      // A log that cannot be written is not a reason to stop updating.
    }
  }

  // ---------------------------------------------------------------- settings and history, kept with the application

  private get settingsFile(): string {
    return join(this.o.directory, 'update-settings.json')
  }
  private get historyFile(): string {
    return join(this.o.directory, 'update-history.json')
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.settingsFile, 'utf8')) as Partial<UpdateSettings>
      this.settings = {
        channel: isChannel(raw.channel) ? raw.channel : DEFAULT_CHANNEL,
        checkAutomatically: raw.checkAutomatically !== false,
        downloadAutomatically: raw.downloadAutomatically !== false,
        installAutomatically: raw.installAutomatically === true
      }
    } catch {
      this.settings = { ...DEFAULT_UPDATE_SETTINGS }
    }
    try {
      const raw = JSON.parse(await readFile(this.historyFile, 'utf8')) as UpdateHistoryEntry[]
      this.history = Array.isArray(raw) ? raw.slice(-50) : []
    } catch {
      this.history = []
    }
  }

  async setSettings(patch: Partial<UpdateSettings>): Promise<UpdateSettings> {
    this.settings = {
      channel: isChannel(patch.channel) ? patch.channel : this.settings.channel,
      checkAutomatically: patch.checkAutomatically ?? this.settings.checkAutomatically,
      downloadAutomatically: patch.downloadAutomatically ?? this.settings.downloadAutomatically,
      installAutomatically: patch.installAutomatically ?? this.settings.installAutomatically
    }
    await mkdir(this.o.directory, { recursive: true })
    await writeFile(this.settingsFile, JSON.stringify(this.settings, null, 2))
    this.emit('changed', this.getStatus())
    return this.getSettings()
  }

  private async remember(entry: UpdateHistoryEntry): Promise<void> {
    this.history = [...this.history, entry].slice(-50)
    try {
      await mkdir(this.o.directory, { recursive: true })
      await writeFile(this.historyFile, JSON.stringify(this.history, null, 2))
    } catch {
      // History is a convenience; failing to write it changes nothing about the update itself.
    }
  }

  // ---------------------------------------------------------------- starting up

  /**
   * Called once Orbis is up. Finishes whatever an earlier run left unfinished, then looks for an update in the
   * background — never before the window, and never in its way.
   */
  async start(): Promise<void> {
    await this.load()
    await this.recover()
    if (!this.settings.checkAutomatically) return
    setTimeout(() => void this.checkForUpdates().catch(() => undefined), FIRST_CHECK_AFTER_MS).unref?.()
    this.timer = setInterval(() => void this.checkForUpdates().catch(() => undefined), CHECK_EVERY_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.downloadAbort?.abort()
  }

  /** What an interrupted update left behind, and what to do about it. */
  private async recover(): Promise<void> {
    const transaction = await this.journal.read()
    const recovery = recoveryFor(transaction)
    if (recovery.action === 'none') return

    if (recovery.action === 'validate') {
      await this.journal.record('validation-started')
      const check = validateInstall({
        runningVersion: this.o.currentVersion,
        expectedVersion: recovery.transaction.toVersion,
        profilesReadable: await this.o.profilesReadable()
      })
      if (check.ok) {
        await this.journal.record('completed')
        await this.remember({ version: recovery.transaction.toVersion, at: Date.now(), outcome: 'installed' })
        await this.log(`update to ${recovery.transaction.toVersion} confirmed`)
        await this.cleanUpAfter(recovery.transaction.packagePath)
        await this.journal.clear()
        this.status = { ...idleStatus(this.o.currentVersion), state: 'completed' }
        this.emit('changed', this.getStatus())
        return
      }
      await this.rollBack(recovery.transaction.toVersion, check.reason, recovery.transaction.packagePath)
      return
    }

    if (recovery.action === 'roll-back') {
      await this.rollBack(recovery.transaction.toVersion, recovery.reason, recovery.transaction.packagePath)
      return
    }

    if (recovery.action === 'give-up') {
      await this.log(`giving up on ${recovery.transaction.toVersion}: ${recovery.reason}`)
      await this.remember({ version: recovery.transaction.toVersion, at: Date.now(), outcome: 'failed', note: recovery.reason })
      await this.cleanUpAfter(recovery.transaction.packagePath)
      await this.journal.clear()
      this.status = { ...idleStatus(this.o.currentVersion), state: 'failed', problem: recovery.reason }
      this.emit('changed', this.getStatus())
      return
    }

    // retry-install: the package is still good and nothing was replaced, so it can simply be offered again.
    await this.log(`an update to ${recovery.transaction.toVersion} was interrupted before anything was replaced`)
    this.packagePath = recovery.transaction.packagePath
    this.status = { ...this.status, state: 'ready-to-install', availableVersion: recovery.transaction.toVersion }
    this.emit('changed', this.getStatus())
  }

  private async rollBack(version: string, reason: string, packagePath: string): Promise<void> {
    this.status = { ...this.status, state: 'rolling-back', problem: reason }
    this.emit('changed', this.getStatus())
    await this.log(`rolling back ${version}: ${reason}`)
    const plan = this.planFor(packagePath, version)
    const restored = await this.installer.restore(plan)
    await this.journal.record('rolled-back', reason)
    await this.remember({ version, at: Date.now(), outcome: 'rolled-back', note: reason })
    await this.cleanUpAfter(packagePath)
    await this.journal.clear()
    this.status = { ...idleStatus(this.o.currentVersion), state: 'failed', problem: restored.ok ? reason : `${reason}. ${restored.reason}` }
    this.emit('changed', this.getStatus())
  }

  private planFor(packagePath: string, toVersion: string): InstallPlan {
    return {
      packagePath,
      installDirectory: this.o.installDirectory,
      executablePath: this.o.executablePath,
      backupDirectory: join(this.o.directory, 'rollback'),
      fromVersion: this.o.currentVersion,
      toVersion
    }
  }

  private async cleanUpAfter(packagePath: string): Promise<void> {
    await this.installer.cleanUp(this.planFor(packagePath, this.o.currentVersion))
  }

  // ---------------------------------------------------------------- checking

  async checkForUpdates(): Promise<UpdateStatus> {
    if (this.status.state === 'downloading' || this.status.state === 'verifying') return this.getStatus()
    if (!this.moveTo('checking')) return this.getStatus()
    await this.log(`checking ${this.o.endpoint} on the ${this.settings.channel} channel`)

    let raw: unknown
    try {
      const fetchFn = this.o.fetchFn ?? fetch
      // Only what is needed to answer the question, and nothing about the user.
      const url = `${this.o.endpoint}?channel=${encodeURIComponent(this.settings.channel)}&version=${encodeURIComponent(this.o.currentVersion)}&platform=${encodeURIComponent(platformKey(this.o.platform, this.o.arch))}`
      const response = await fetchFn(url, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`the server answered ${response.status}`)
      raw = await response.json()
    } catch (err) {
      const problem = `Orbis could not check for updates (${err instanceof Error ? err.message : String(err)})`
      this.moveTo('failed', { problem, lastCheckedAt: Date.now() })
      await this.log(problem)
      return this.getStatus()
    }

    const read = readManifest(raw)
    if (!read.ok) {
      this.moveTo('failed', { problem: `the update information could not be trusted: ${read.problem}`, lastCheckedAt: Date.now() })
      await this.log(`manifest refused: ${read.problem}`)
      return this.getStatus()
    }

    const decision = decideUpdate({
      currentVersion: this.o.currentVersion,
      manifest: read.manifest,
      channel: this.settings.channel,
      platform: this.o.platform,
      arch: this.o.arch
    })
    this.manifest = read.manifest

    if (decision.action === 'none' || decision.action === 'refuse') {
      const reason = decision.reason
      this.moveTo(decision.action === 'none' ? 'no-update' : 'failed', { problem: decision.action === 'refuse' ? reason : null, lastCheckedAt: Date.now() })
      await this.log(decision.action === 'none' ? `no update: ${reason}` : `refused: ${reason}`)
      return this.getStatus()
    }

    const mandatory = decision.action === 'unsupported' || decision.mandatory
    this.moveTo('update-available', {
      availableVersion: decision.version,
      mandatory,
      releaseNotes: read.manifest.releaseNotes,
      problem: null,
      lastCheckedAt: Date.now()
    })
    await this.log(`${decision.version} is available${mandatory ? ' (required)' : ''}`)
    if (this.settings.downloadAutomatically) void this.downloadUpdate().catch(() => undefined)
    return this.getStatus()
  }

  // ---------------------------------------------------------------- downloading

  async downloadUpdate(): Promise<UpdateStatus> {
    const manifest = this.manifest
    const version = this.status.availableVersion
    if (!manifest || !version) return this.getStatus()
    const pkg = manifest.platforms[platformKey(this.o.platform, this.o.arch)]
    if (!pkg) return this.getStatus()
    if (!this.moveTo('downloading', { progress: 0 })) return this.getStatus()

    const into = join(this.o.directory, `Orbis-Setup-${version}.exe`)
    this.downloadAbort = new AbortController()
    await this.journal.begin({
      id: `${version}-${Date.now().toString(36)}`,
      fromVersion: this.o.currentVersion,
      toVersion: version,
      packagePath: into,
      rollbackPackagePath: null
    })

    const result = await this.downloader.fetchPackage({
      url: pkg.url,
      sha256: pkg.sha256,
      size: pkg.size,
      into,
      signal: this.downloadAbort.signal,
      onProgress: (p) => {
        this.status = { ...this.status, progress: p.fraction }
        this.emit('download-progress', { ...p })
      }
    })
    this.downloadAbort = null

    if (!result.ok) {
      const stopped = /stopped/.test(result.reason)
      this.moveTo(stopped ? 'cancelled' : 'failed', { problem: stopped ? null : result.reason })
      await this.log(`download failed: ${result.reason}`)
      if (!result.resumable) await rm(into, { force: true }).catch(() => undefined)
      return this.getStatus()
    }

    // The checksum was already the condition of the download finishing at all; this records that it was checked.
    this.moveTo('verifying')
    await this.journal.record('package-verified')
    this.packagePath = result.path
    this.moveTo('ready-to-install', { progress: 1 })
    await this.log(`${version} downloaded and verified`)
    if (this.settings.installAutomatically) void this.restartAndUpdate().catch(() => undefined)
    return this.getStatus()
  }

  cancelDownload(): void {
    this.downloadAbort?.abort()
  }

  // ---------------------------------------------------------------- installing

  /** Hands over to the installer and quits. Everything after this happens outside Orbis. */
  async restartAndUpdate(): Promise<UpdateStatus> {
    const version = this.status.availableVersion
    const packagePath = this.packagePath
    if (!version || !packagePath) return this.getStatus()
    if (!this.moveTo('preparing')) return this.getStatus()

    const plan = this.planFor(packagePath, version)
    const copied = await this.installer.backup(plan)
    if (!copied.ok) {
      this.moveTo('failed', { problem: copied.reason })
      await this.log(`could not prepare: ${copied.reason}`)
      return this.getStatus()
    }
    await this.journal.record('staged')

    if (!this.moveTo('installing')) return this.getStatus()
    await this.journal.record('install-started')
    const handed = await this.installer.handOver(plan)
    if (!handed.ok) {
      await this.journal.record('staged', handed.reason)
      this.moveTo('failed', { problem: handed.reason })
      await this.log(`could not hand over: ${handed.reason}`)
      return this.getStatus()
    }

    await this.log(`handing over to the installer for ${version}`)
    this.moveTo('restarting')
    // The installer waits for this process to go before it touches anything.
    this.o.quit()
    return this.getStatus()
  }
}
