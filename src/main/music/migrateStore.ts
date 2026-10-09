import { join } from 'node:path'
import { dataDirFor, DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { Collection, JsonFile } from '../personal/store.ts'
import { NO_CAPABILITIES, SOURCES, newConnection, type Capabilities, type Connection, type ConnectionState } from '../../shared/music/connection.ts'
import type { Job, JobPlaylist, Provenance, Status } from '../../shared/music/migration.ts'
import type { Snapshot } from '../../shared/music/merge.ts'
import type { Wanted } from '../../shared/music/matching.ts'

/**
 * What Orbis remembers about bringing music in.
 *
 * Five files, each with its own lifetime, kept with the profile like everything else — one person's connections
 * and import history are never shown in another's.
 *
 * **Connections** are what services are set up. No tokens: a token lives in the account's own credential store
 * and never in a JSON file, so nothing here is worth stealing and nothing here can leak one.
 *
 * **Jobs** are the import history, including the ones that stopped half way, because a stopped job is the thing
 * somebody most wants to find again.
 *
 * **Provenance** is one row per imported track, which is the whole reason a second import of the same playlist
 * adds nothing.
 *
 * **Snapshots** are what a playlist looked like before a merge. They are what makes undo possible, so they
 * outlive the job that made them.
 *
 * **Unmatched** rows are the tracks nothing was found for. Kept, because the alternative is that they vanish and
 * somebody never learns their playlist is twenty tracks short.
 */

export const MAX_JOBS = 100
export const MAX_PROVENANCE = 100_000
export const MAX_SNAPSHOTS = 200
export const MAX_UNMATCHED = 20_000

export interface UnmatchedRow {
  id: string
  jobId: string
  provider: string
  sourcePlaylistId: string
  playlistName: string
  wanted: Wanted
  /** What was offered and rejected, so the screen can show the near misses. */
  candidates: readonly { trackId: string; title: string; artist: string; score: number; why: string }[]
  /** Why there was no match, in words. */
  why: string
  at: number
  /** Set when somebody has dealt with it, so it leaves the list without being deleted. */
  settled: 'matched-by-hand' | 'not-wanted' | 'added-as-reference' | null
}

const migrateFile = (userData: string, profileId: string, name: string): string =>
  join(userData, dataDirFor(profileId), 'music', name)

const text = (value: unknown, most = 400): string | null => (typeof value === 'string' && value.trim() !== '' ? value.slice(0, most) : null)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const bool = (value: unknown): boolean => value === true

const CAPABILITY_KEYS = Object.keys(NO_CAPABILITIES) as (keyof Capabilities)[]

const STATES: readonly ConnectionState[] = ['not-set-up', 'ready-to-connect', 'connecting', 'connected', 'expired', 'refused', 'broken']

export function normalizeConnection(raw: unknown): Connection | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const sourceId = text(row.sourceId, 60)
  if (!sourceId || !SOURCES.some((one) => one.id === sourceId)) return null
  const capabilities = { ...NO_CAPABILITIES }
  const held = row.capabilities && typeof row.capabilities === 'object' ? (row.capabilities as Record<string, unknown>) : {}
  for (const key of CAPABILITY_KEYS) capabilities[key] = bool(held[key])
  const state = STATES.find((one) => one === row.state)
  /*
   * A stored `connecting` is never restored as `connecting`.
   *
   * It means Orbis was mid-sign-in when it last closed, and that sign-in is long gone. Showing it again would
   * leave a card spinning for ever on something nobody is doing.
   */
  return {
    sourceId,
    state: state === 'connecting' ? 'ready-to-connect' : (state ?? 'ready-to-connect'),
    account: text(row.account, 120),
    capabilities,
    connectedAt: num(row.connectedAt),
    expiresAt: num(row.expiresAt),
    lastProblem: text(row.lastProblem, 300),
    lastUsedAt: num(row.lastUsedAt)
  }
}

const PLAYLIST_STATES: readonly JobPlaylist['state'][] = ['waiting', 'reading', 'matching', 'importing', 'done', 'skipped', 'failed']
const JOB_STATUSES: readonly Status[] = ['waiting', 'running', 'paused', 'needs-you', 'finished', 'stopped', 'failed']

function normalizeJobPlaylist(raw: unknown): JobPlaylist | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const sourceId = text(row.sourceId, 200)
  if (!sourceId) return null
  const state = PLAYLIST_STATES.find((one) => one === row.state) ?? 'waiting'
  return {
    sourceId,
    name: text(row.name, 300) ?? sourceId,
    trackCount: num(row.trackCount),
    // A playlist caught mid-work is restored as waiting, so resuming reads it again rather than assuming.
    state: state === 'reading' || state === 'matching' || state === 'importing' ? 'waiting' : state,
    matched: num(row.matched) ?? 0,
    ambiguous: num(row.ambiguous) ?? 0,
    unmatched: num(row.unmatched) ?? 0,
    added: num(row.added) ?? 0,
    why: text(row.why, 300)
  }
}

export function normalizeJob(raw: unknown): Job | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = text(row.id, 60)
  const provider = text(row.provider, 60)
  if (!id || !provider) return null
  const status = JOB_STATUSES.find((one) => one === row.status) ?? 'stopped'
  const playlists = Array.isArray(row.playlists)
    ? row.playlists.map(normalizeJobPlaylist).filter((one): one is JobPlaylist => one !== null)
    : []
  return {
    id,
    provider,
    startedAt: num(row.startedAt) ?? 0,
    endedAt: num(row.endedAt),
    /*
     * A job stored as running was interrupted, not running.
     *
     * Nothing is going when Orbis starts, so restoring `running` would show a job moving that is not, and its
     * progress bar would sit still for ever. It becomes paused, which is both true and resumable.
     */
    status: status === 'running' || status === 'waiting' ? 'paused' : status,
    phase:
      row.phase === 'connect' ||
      row.phase === 'discover' ||
      row.phase === 'fetch' ||
      row.phase === 'match' ||
      row.phase === 'plan' ||
      row.phase === 'import' ||
      row.phase === 'verify' ||
      row.phase === 'done'
        ? row.phase
        : 'connect',
    playlists,
    needs: text(row.needs, 300),
    failed: text(row.failed, 300),
    unmatchedTotal: num(row.unmatchedTotal) ?? 0,
    resumedAt: num(row.resumedAt)
  }
}

export function normalizeProvenance(raw: unknown): (Provenance & { id: string }) | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = text(row.id, 200)
  const provider = text(row.provider, 60)
  const sourcePlaylistId = text(row.sourcePlaylistId, 200)
  if (!id || !provider || !sourcePlaylistId) return null
  return {
    id,
    provider,
    sourceTrackId: text(row.sourceTrackId, 200),
    sourcePlaylistId,
    importedAt: num(row.importedAt) ?? 0,
    jobId: text(row.jobId, 60) ?? ''
  }
}

export function normalizeSnapshot(raw: unknown): (Snapshot & { id: string }) | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = text(row.id, 60)
  const playlistId = text(row.playlistId, 60)
  if (!id || !playlistId) return null
  return {
    id,
    playlistId,
    takenAt: num(row.takenAt) ?? 0,
    name: text(row.name, 300) ?? '',
    tracks: Array.isArray(row.tracks) ? row.tracks.filter((one): one is string => typeof one === 'string').slice(0, 10_000) : [],
    because: text(row.because, 300) ?? ''
  }
}

export function normalizeUnmatched(raw: unknown): UnmatchedRow | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = text(row.id, 80)
  const wanted = row.wanted && typeof row.wanted === 'object' ? (row.wanted as Record<string, unknown>) : null
  const title = wanted ? text(wanted.title, 300) : null
  if (!id || !title) return null
  return {
    id,
    jobId: text(row.jobId, 60) ?? '',
    provider: text(row.provider, 60) ?? 'unknown',
    sourcePlaylistId: text(row.sourcePlaylistId, 200) ?? '',
    playlistName: text(row.playlistName, 300) ?? '',
    wanted: {
      title,
      artist: wanted ? text(wanted.artist, 300) : null,
      album: wanted ? text(wanted.album, 300) : null,
      duration: wanted ? num(wanted.duration) : null,
      isrc: wanted ? text(wanted.isrc, 20) : null,
      providerId: wanted ? text(wanted.providerId, 200) : null,
      provider: wanted ? text(wanted.provider, 60) : null
    },
    candidates: Array.isArray(row.candidates)
      ? row.candidates
          .map((one) => {
            if (!one || typeof one !== 'object') return null
            const two = one as Record<string, unknown>
            const trackId = text(two.trackId, 80)
            if (!trackId) return null
            return {
              trackId,
              title: text(two.title, 300) ?? '',
              artist: text(two.artist, 300) ?? '',
              score: num(two.score) ?? 0,
              why: text(two.why, 300) ?? ''
            }
          })
          .filter((one): one is { trackId: string; title: string; artist: string; score: number; why: string } => one !== null)
          .slice(0, 6)
      : [],
    why: text(row.why, 300) ?? '',
    at: num(row.at) ?? 0,
    settled:
      row.settled === 'matched-by-hand' || row.settled === 'not-wanted' || row.settled === 'added-as-reference' ? row.settled : null
  }
}

export class MusicMigrateStore {
  private readonly connections: Collection<Connection & { id: string }>
  private readonly jobs: Collection<Job & { id: string }>
  private readonly provenance: Collection<Provenance & { id: string }>
  private readonly snapshots: Collection<Snapshot & { id: string }>
  private readonly unmatched: Collection<UnmatchedRow>
  private readonly settingsFile: JsonFile<MigrateSettings>
  private readonly userData: string
  private profileId = DEFAULT_PROFILE_ID
  private readonly listeners = new Set<() => void>()

  constructor(userData: string) {
    this.userData = userData
    const path = (name: string): string => migrateFile(userData, DEFAULT_PROFILE_ID, name)
    this.connections = new Collection(path('connections.json'), (raw) => {
      const one = normalizeConnection(raw)
      return one ? { ...one, id: one.sourceId } : null
    }, SOURCES.length)
    this.jobs = new Collection(path('migrations.json'), (raw) => normalizeJob(raw) as (Job & { id: string }) | null, MAX_JOBS)
    this.provenance = new Collection(path('imported.json'), normalizeProvenance, MAX_PROVENANCE)
    this.snapshots = new Collection(path('snapshots.json'), normalizeSnapshot, MAX_SNAPSHOTS)
    this.unmatched = new Collection(path('unmatched.json'), normalizeUnmatched, MAX_UNMATCHED)
    this.settingsFile = new JsonFile<MigrateSettings>(path('migrate-settings.json'), () => ({ ...DEFAULT_MIGRATE_SETTINGS }), normalizeMigrateSettings)
    for (const one of [this.connections, this.jobs, this.provenance, this.snapshots, this.unmatched]) one.onChange(() => this.changed())
  }

  async useProfile(profileId: string): Promise<void> {
    if (profileId === this.profileId) return
    this.profileId = profileId
    const path = (name: string): string => migrateFile(this.userData, profileId, name)
    await Promise.all([
      this.connections.usePath(path('connections.json')),
      this.jobs.usePath(path('migrations.json')),
      this.provenance.usePath(path('imported.json')),
      this.snapshots.usePath(path('snapshots.json')),
      this.unmatched.usePath(path('unmatched.json')),
      this.settingsFile.usePath(path('migrate-settings.json'))
    ])
    this.changed()
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }

  // ---------------------------------------------------------------- connections

  /**
   * Every source, with whatever is remembered about it.
   *
   * Always the full list, so the Migration Center shows the ones that need setting up as well as the ones that
   * work. `configured` says whether credentials exist for that source, and it is the caller's answer, not this
   * file's — the credentials are not stored here.
   */
  async connectionList(configured: (sourceId: string) => boolean): Promise<Connection[]> {
    const held = await this.connections.all()
    return SOURCES.map((source) => {
      const one = held.find((two) => two.sourceId === source.id)
      if (!one) return newConnection(source.id, configured(source.id))
      /*
       * Credentials removed from under a connected card must put it back to "not set up".
       *
       * Otherwise deleting the client id leaves a card that says Connected and a connection that cannot make a
       * single request.
       */
      if (source.needs !== '' && !configured(source.id)) {
        return { ...one, state: 'not-set-up' as const, capabilities: { ...NO_CAPABILITIES } }
      }
      return one
    })
  }

  async saveConnection(one: Connection): Promise<Connection> {
    await this.connections.put({ ...one, id: one.sourceId })
    return one
  }

  async forgetConnection(sourceId: string): Promise<boolean> {
    return this.connections.remove(sourceId)
  }

  // ---------------------------------------------------------------- jobs

  async jobList(): Promise<Job[]> {
    const all = await this.jobs.all()
    return all.sort((a, b) => b.startedAt - a.startedAt)
  }

  async job(id: string): Promise<Job | null> {
    const all = await this.jobs.all()
    return all.find((one) => one.id === id) ?? null
  }

  async saveJob(job: Job): Promise<Job> {
    await this.jobs.put({ ...job, id: job.id })
    return job
  }

  async removeJob(id: string): Promise<boolean> {
    return this.jobs.remove(id)
  }

  // ---------------------------------------------------------------- provenance

  async provenanceFor(provider: string): Promise<(Provenance & { id: string })[]> {
    const all = await this.provenance.all()
    return all.filter((one) => one.provider === provider)
  }

  async recordImported(rows: readonly Provenance[]): Promise<number> {
    let kept = 0
    for (const one of rows) {
      // The id is the source's own coordinates, so writing the same row twice replaces it rather than doubling it.
      const id = `${one.provider}:${one.sourcePlaylistId}:${one.sourceTrackId ?? 'none'}`
      await this.provenance.put({ ...one, id })
      kept += 1
    }
    return kept
  }

  // ---------------------------------------------------------------- snapshots

  async snapshotsFor(playlistId: string): Promise<(Snapshot & { id: string })[]> {
    const all = await this.snapshots.all()
    return all.filter((one) => one.playlistId === playlistId).sort((a, b) => b.takenAt - a.takenAt)
  }

  async keepSnapshot(id: string, one: Snapshot): Promise<Snapshot> {
    await this.snapshots.put({ ...one, id })
    return one
  }

  async dropSnapshot(id: string): Promise<boolean> {
    return this.snapshots.remove(id)
  }

  // ---------------------------------------------------------------- unmatched

  async unmatchedList(options: { includeSettled?: boolean } = {}): Promise<UnmatchedRow[]> {
    const all = await this.unmatched.all()
    const rows = options.includeSettled ? all : all.filter((one) => one.settled === null)
    return rows.sort((a, b) => b.at - a.at)
  }

  async keepUnmatched(rows: readonly UnmatchedRow[]): Promise<number> {
    for (const one of rows) await this.unmatched.put(one)
    return rows.length
  }

  async settleUnmatched(id: string, how: UnmatchedRow['settled']): Promise<UnmatchedRow | null> {
    const all = await this.unmatched.all()
    const one = all.find((two) => two.id === id)
    if (!one) return null
    const next = { ...one, settled: how }
    await this.unmatched.put(next)
    return next
  }

  async clearSettled(): Promise<number> {
    const all = await this.unmatched.all()
    let gone = 0
    for (const one of all) if (one.settled !== null) gone += (await this.unmatched.remove(one.id)) ? 1 : 0
    return gone
  }

  // ---------------------------------------------------------------- settings

  settings(): Promise<MigrateSettings> {
    return this.settingsFile.read()
  }

  async saveSettings(patch: Partial<MigrateSettings>): Promise<MigrateSettings> {
    const held = await this.settingsFile.read()
    const next = normalizeMigrateSettings({ ...held, ...patch })
    await this.settingsFile.write(next)
    this.changed()
    return next
  }

  async flush(): Promise<void> {
    await Promise.all([
      this.connections.flush(),
      this.jobs.flush(),
      this.provenance.flush(),
      this.snapshots.flush(),
      this.unmatched.flush(),
      this.settingsFile.flush()
    ])
  }
}

// ---------------------------------------------------------------- how merging behaves by default

export interface MigrateSettings {
  /** The strategy pre-selected in the merge preview. Still shown, still changeable. */
  strategy: 'append' | 'imported-order' | 'keep-order' | 'smart' | 'replace'
  duplicates: 'keep-all' | 'drop-exact' | 'drop-canonical' | 'prefer-original' | 'prefer-remaster' | 'prefer-local' | 'drop-consecutive'
  /** What happens when a track disappears from the source. Leaving it alone is the default. */
  onSourceRemoval: 'keep' | 'mark' | 'remove'
  /** Whether a match that only needs a look is taken anyway. Off, and it stays off unless somebody turns it on. */
  takeUncertain: boolean
  /** Whether Orbis checks the source again for changes. Off: nothing contacts a service unasked. */
  refresh: boolean
}

export const DEFAULT_MIGRATE_SETTINGS: MigrateSettings = {
  strategy: 'append',
  duplicates: 'drop-exact',
  onSourceRemoval: 'keep',
  takeUncertain: false,
  refresh: false
}

export function normalizeMigrateSettings(raw: unknown): MigrateSettings {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const one = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.find((two) => two === value) ?? fallback
  return {
    strategy: one(row.strategy, ['append', 'imported-order', 'keep-order', 'smart', 'replace'] as const, 'append'),
    duplicates: one(
      row.duplicates,
      ['keep-all', 'drop-exact', 'drop-canonical', 'prefer-original', 'prefer-remaster', 'prefer-local', 'drop-consecutive'] as const,
      'drop-exact'
    ),
    onSourceRemoval: one(row.onSourceRemoval, ['keep', 'mark', 'remove'] as const, 'keep'),
    takeUncertain: row.takeUncertain === true,
    refresh: row.refresh === true
  }
}
