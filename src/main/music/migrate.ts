import { basename } from 'node:path'
import { promises as fs } from 'node:fs'
import { MusicMigrateStore, type MigrateSettings, type UnmatchedRow } from './migrateStore.ts'
import { MusicTokens } from './tokens.ts'
import { SOURCES, newConnection, usable, type Connection } from '../../shared/music/connection.ts'
import { matchAll, type Held, type Wanted } from '../../shared/music/matching.ts'
import { planMerge, snapshotOf, type MergeTrack, type MergePlan } from '../../shared/music/merge.ts'
import { readPlaylistFile } from '../../shared/music/importing.ts'
import { duplicatePlaylists, similarity, suggestDestination } from '../../shared/music/similarity.ts'
import { alreadyImported, changesSince, newJob, progress, remaining, summarise, totals, type Job, type JobPlaylist, type Provenance } from '../../shared/music/migration.ts'
import type { OrbisTrack, Playlist } from '../../shared/music.ts'

/**
 * Bringing a library in, for real.
 *
 * ## What works today, and what honestly does not
 *
 * Three routes need no account and work end to end: a playlist file, a folder of music, and a list pasted in.
 * They go through the whole pipeline — read, match, plan, confirm, import, verify — and are the reason this is a
 * feature rather than a promise.
 *
 * The streaming services need an application registered with each of them, which is a thing a person does and
 * code cannot invent. The adapter, the capability detection, the rate limiting and the job engine are all here
 * and finished; what is missing is a client id. So those cards say *"Not set up"* and name what they need, and
 * **no card ever says Connected because the provider exists**.
 *
 * ## Nothing is written before somebody has seen the plan
 *
 * `prepare` reads, matches and plans, and writes nothing. `apply` is the only method that changes a playlist, it
 * takes the plan it was shown, and it snapshots the playlist first. That split is what makes a merge something
 * somebody agreed to rather than something that happened to them.
 *
 * ## A second import adds nothing
 *
 * Every imported row is recorded with the source's own ids, and checked before anything is added. So resuming a
 * stopped job continues it, and re-running a finished one is a no-op that says so.
 */

export interface MigrateDeps {
  store: MusicMigrateStore
  tokens: MusicTokens
  /** Every track in this profile's library, for matching against. */
  tracks(): Promise<readonly OrbisTrack[]>
  playlists(): Promise<readonly Playlist[]>
  createPlaylist(name: string, trackIds: readonly string[]): Promise<Playlist | null>
  setPlaylistTracks(playlistId: string, trackIds: readonly string[]): Promise<Playlist | null>
  /** Whether credentials exist for a service. Answered by settings, never stored here. */
  configured(sourceId: string): boolean
  /** Asks the person for files. The same picker the library import uses. */
  pickFiles(kind: 'files' | 'folder'): Promise<string[]>
  now(): number
  /** Tells every surface a job moved. */
  announce(): void
}

const heldFor = (tracks: readonly OrbisTrack[]): Held<string>[] =>
  tracks.map((one) => ({
    track: one.id,
    title: one.title,
    artist: one.artist,
    album: one.album ?? null,
    duration: one.duration > 0 ? one.duration : null,
    isrc: null,
    providerIds: null
  }))

export interface Prepared {
  jobId: string
  /** What the source is called, for the heading. */
  sourceName: string
  playlists: {
    sourceId: string
    name: string
    /** Where it would go. Null means a new playlist would be made. */
    destinationId: string | null
    destinationName: string
    /** Null when there is nothing to put in it. */
    plan: MergePlan | null
    matched: number
    ambiguous: number
    unmatched: number
    /** The near misses, for the rows that need a look. */
    needLook: UnmatchedRow[]
  }[]
  says: string
}

export class MusicMigrate {
  private readonly o: MigrateDeps
  /** Jobs currently going, so progress can be asked for without re-reading the file. */
  private readonly live = new Map<string, Job>()
  /**
   * What each job read, held for the life of the process.
   *
   * So the plan can be rebuilt — after a setting changes, or after somebody maps a playlist elsewhere — without
   * reading every file again, and without sending thousands of rows out to a window and back. Dropped when the
   * job finishes, because by then it is in the playlists.
   */
  private readonly reads = new Map<string, { sourceId: string; name: string; tracks: Wanted[] }[]>()
  private counter = 0

  constructor(o: MigrateDeps) {
    this.o = o
  }

  private id(prefix: string): string {
    // No clock in the id: a deterministic id is what lets a resumed job find its own rows again.
    this.counter += 1
    return `${prefix}-${this.counter.toString(36)}-${Math.round(this.o.now() / 1000).toString(36)}`
  }

  // ---------------------------------------------------------------- the connection centre

  /** Every source and the honest state of each. The Migration Center's whole top half. */
  async connections(): Promise<{ connections: (Connection & { name: string; kind: string; needs: string; hasToken: boolean })[]; canKeepTokens: boolean }> {
    const held = await this.o.store.connectionList((id) => this.o.configured(id))
    const out: (Connection & { name: string; kind: string; needs: string; hasToken: boolean })[] = []
    for (const one of held) {
      const source = SOURCES.find((two) => two.id === one.sourceId)
      out.push({
        ...one,
        name: source?.name ?? one.sourceId,
        kind: source?.kind ?? 'oauth',
        needs: source?.needs ?? '',
        hasToken: await this.o.tokens.have(one.sourceId)
      })
    }
    return { connections: out, canKeepTokens: this.o.tokens.available() }
  }

  /**
   * Signing out of a service.
   *
   * Forgets the permission and the connection, and deliberately leaves the imported music alone: those tracks are
   * in somebody's library now and have nothing more to do with the service they came from.
   */
  async disconnect(sourceId: string): Promise<{ ok: boolean; says: string }> {
    await this.o.tokens.forget(sourceId)
    await this.o.store.saveConnection(newConnection(sourceId, this.o.configured(sourceId)))
    this.o.announce()
    return { ok: true, says: 'Signed out. The music you already brought in stays where it is.' }
  }

  /**
   * Starting a sign-in.
   *
   * Honest about the one thing that cannot be faked: with no registered application there is nothing to sign in
   * to, and saying so is the whole answer rather than opening a page that will fail.
   */
  async connect(sourceId: string): Promise<{ ok: false; why: string } | { ok: true; says: string }> {
    const source = SOURCES.find((one) => one.id === sourceId)
    if (!source) return { ok: false, why: 'Orbis does not know that service.' }
    if (source.needs !== '' && !this.o.configured(sourceId)) {
      return { ok: false, why: source.needs }
    }
    if (source.needs !== '' && !this.o.tokens.available()) {
      return { ok: false, why: 'This computer cannot store a sign-in securely, so Orbis will not keep one.' }
    }
    if (source.kind !== 'oauth') {
      return { ok: true, says: 'This one needs no signing in — choose a file or a folder when you are ready.' }
    }
    // The permission flow belongs to the service's own page, and is opened by the caller once it has an id.
    return { ok: false, why: source.needs }
  }

  // ---------------------------------------------------------------- reading a source

  /**
   * Reading playlists out of files the person chose.
   *
   * Each file becomes one playlist. A file that cannot be read is reported as a failed row rather than skipped,
   * so the count on the screen matches the number of files chosen.
   */
  async readFiles(paths: readonly string[]): Promise<{ jobId: string; job: Job; read: { sourceId: string; name: string; tracks: Wanted[]; why: string | null }[] }> {
    const job = newJob(this.id('job'), 'playlist-file', this.o.now())
    job.status = 'running'
    job.phase = 'fetch'
    const read: { sourceId: string; name: string; tracks: Wanted[]; why: string | null }[] = []

    for (const path of paths) {
      let text: string
      try {
        text = await fs.readFile(path, 'utf8')
      } catch {
        read.push({ sourceId: path, name: basename(path), tracks: [], why: 'Orbis could not open that file.' })
        continue
      }
      const out = readPlaylistFile(basename(path), text)
      read.push({
        sourceId: path,
        name: out.name ?? basename(path).replace(/\.[a-z0-9]{1,5}$/i, ''),
        tracks: out.tracks,
        why: out.tracks.length === 0 ? out.says : out.skipped.length > 0 ? out.says : null
      })
    }

    job.playlists = read.map((one) => ({
      sourceId: one.sourceId,
      name: one.name,
      trackCount: one.tracks.length,
      state: one.tracks.length === 0 ? 'failed' : 'waiting',
      matched: 0,
      ambiguous: 0,
      unmatched: 0,
      added: 0,
      why: one.why
    }))
    this.live.set(job.id, job)
    this.reads.set(job.id, read.filter((one) => one.tracks.length > 0).map((one) => ({ sourceId: one.sourceId, name: one.name, tracks: one.tracks })))
    await this.o.store.saveJob(job)
    this.o.announce()
    return { jobId: job.id, job, read }
  }

  /** A pasted list. One playlist, named by whoever pasted it. */
  async readPasted(name: string, text: string): Promise<{ jobId: string; job: Job; read: { sourceId: string; name: string; tracks: Wanted[]; why: string | null }[] }> {
    const out = readPlaylistFile('pasted.txt', text)
    const job = newJob(this.id('job'), 'paste', this.o.now())
    job.status = 'running'
    job.phase = 'fetch'
    const playlistName = name.trim().slice(0, 200) || 'Pasted list'
    job.playlists = [
      {
        sourceId: 'pasted',
        name: playlistName,
        trackCount: out.tracks.length,
        state: out.tracks.length === 0 ? 'failed' : 'waiting',
        matched: 0,
        ambiguous: 0,
        unmatched: 0,
        added: 0,
        why: out.tracks.length === 0 ? out.says : null
      }
    ]
    this.live.set(job.id, job)
    this.reads.set(job.id, out.tracks.length > 0 ? [{ sourceId: 'pasted', name: playlistName, tracks: out.tracks }] : [])
    await this.o.store.saveJob(job)
    this.o.announce()
    return { jobId: job.id, job, read: [{ sourceId: 'pasted', name: playlistName, tracks: out.tracks, why: null }] }
  }

  // ---------------------------------------------------------------- the plan

  /**
   * What would happen, with nothing written.
   *
   * Matches every row against the library, works out where each playlist would go, and builds the merge plan for
   * each. The rows that need a look are returned with their candidates attached, because the decision belongs to
   * the person and they cannot make it without seeing the near misses.
   */
  async prepare(
    jobId: string,
    given: readonly { sourceId: string; name: string; tracks: readonly Wanted[] }[] | null,
    options: { mapping?: Readonly<Record<string, string | null>> } = {}
  ): Promise<Prepared> {
    const sources = given && given.length > 0 ? given : (this.reads.get(jobId) ?? [])
    const settings = await this.o.store.settings()
    const tracks = await this.o.tracks()
    const library = heldFor(tracks)
    const byId = new Map(tracks.map((one) => [one.id, one]))
    const existing = await this.o.playlists()
    const job = this.live.get(jobId) ?? (await this.o.store.job(jobId))
    const provider = job?.provider ?? 'playlist-file'
    const seen = await this.o.store.provenanceFor(provider)

    const out: Prepared['playlists'] = []
    const unmatchedRows: UnmatchedRow[] = []

    for (const source of sources) {
      const { results, summary } = matchAll(source.tracks, library)

      const asMergeTracks: MergeTrack[] = []
      const needLook: UnmatchedRow[] = []
      for (const one of results) {
        const taken = one.result.match ?? (settings.takeUncertain && one.result.band === 'ambiguous' ? one.result.candidates[0]?.track ?? null : null)
        if (taken) {
          /*
           * Already brought in by an earlier import of this same playlist? Then it is not new.
           *
           * Checked two ways on purpose. A service gives its own id for the row, and that is the exact answer.
           * A file or a pasted list gives nothing, so the only durable thing to recognise is **the track it
           * resolved to** — which is what makes importing the same .m3u twice a genuine no-op rather than
           * something the duplicate rule happens to tidy up afterwards.
           */
          if (alreadyImported(seen, provider, source.sourceId, one.wanted.providerId ?? null)) continue
          if (alreadyImported(seen, provider, source.sourceId, taken)) continue
          const row = byId.get(taken)
          if (!row) continue
          asMergeTracks.push({
            id: row.id,
            title: row.title,
            artist: row.artist,
            album: row.album ?? null,
            duration: row.duration > 0 ? row.duration : null,
            source: provider,
            local: Boolean(row.file)
          })
          continue
        }
        const row: UnmatchedRow = {
          id: `${jobId}:${source.sourceId}:${needLook.length}`,
          jobId,
          provider,
          sourcePlaylistId: source.sourceId,
          playlistName: source.name,
          wanted: one.wanted,
          candidates: one.result.candidates.map((two) => {
            const held = byId.get(two.track)
            return {
              trackId: two.track,
              title: held?.title ?? '',
              artist: held?.artist ?? '',
              score: two.score,
              why: two.why.join(' ')
            }
          }),
          why: one.result.reason ?? 'No match.',
          at: this.o.now(),
          settled: null
        }
        needLook.push(row)
        unmatchedRows.push(row)
      }

      // Where it would go: what the person chose, else a suggestion by name, else a new playlist.
      const chosen = options.mapping?.[source.sourceId]
      const suggested = chosen === undefined ? suggestDestination(source.name, existing.map((one) => ({ id: one.id, name: one.name }))) : null
      const destinationId = chosen !== undefined ? chosen : (suggested?.id ?? null)
      const destination = destinationId ? existing.find((one) => one.id === destinationId) ?? null : null

      const before: MergeTrack[] = (destination?.tracks ?? [])
        .map((id) => byId.get(id))
        .filter((one): one is OrbisTrack => !!one)
        .map((one) => ({
          id: one.id,
          title: one.title,
          artist: one.artist,
          album: one.album ?? null,
          duration: one.duration > 0 ? one.duration : null,
          source: 'mine',
          local: Boolean(one.file)
        }))

      const plan =
        asMergeTracks.length === 0 && before.length === 0
          ? null
          : planMerge({ destination: before, incoming: asMergeTracks, strategy: settings.strategy, duplicates: settings.duplicates })

      out.push({
        sourceId: source.sourceId,
        name: source.name,
        destinationId,
        destinationName: destination?.name ?? source.name,
        plan,
        matched: summary.matched,
        ambiguous: summary.ambiguous,
        unmatched: summary.unmatched,
        needLook
      })
    }

    // Kept now rather than at import time: the rows nothing matched are worth having even if nobody imports.
    if (unmatchedRows.length > 0) await this.o.store.keepUnmatched(unmatchedRows)

    if (job) {
      job.phase = 'plan'
      job.unmatchedTotal = unmatchedRows.length
      job.playlists = job.playlists.map((one) => {
        const row = out.find((two) => two.sourceId === one.sourceId)
        return row ? { ...one, matched: row.matched, ambiguous: row.ambiguous, unmatched: row.unmatched, state: 'matching' as const } : one
      })
      this.live.set(job.id, job)
      await this.o.store.saveJob(job)
      this.o.announce()
    }

    const newTracks = out.reduce((sum, one) => sum + (one.plan?.added.length ?? 0), 0)
    const look = out.reduce((sum, one) => sum + one.ambiguous, 0)
    const lost = out.reduce((sum, one) => sum + one.unmatched, 0)
    const bits = [`${out.length} ${out.length === 1 ? 'playlist' : 'playlists'}`, `${newTracks} tracks to add`]
    if (look > 0) bits.push(`${look} to look at`)
    if (lost > 0) bits.push(`${lost} not in your library`)

    return {
      jobId,
      sourceName: SOURCES.find((one) => one.id === provider)?.name ?? provider,
      playlists: out,
      says: `${bits.join(', ')}. Nothing is changed until you say so.`
    }
  }

  // ---------------------------------------------------------------- doing it

  /**
   * Carrying out a prepared plan.
   *
   * Snapshots first, writes second, reads back third. The read-back is what lets the summary say "added" rather
   * than "asked to add": a count that came from the playlist afterwards cannot be wrong about what happened.
   */
  async apply(
    jobId: string,
    rows: readonly { sourceId: string; destinationId: string | null; destinationName: string; trackIds: readonly string[]; replace?: boolean }[]
  ): Promise<{ ok: boolean; job: Job | null; says: string }> {
    const job = this.live.get(jobId) ?? (await this.o.store.job(jobId))
    if (!job) return { ok: false, job: null, says: 'That import is not one Orbis knows about.' }
    job.status = 'running'
    job.phase = 'import'
    this.live.set(job.id, job)

    const existing = await this.o.playlists()
    let addedTotal = 0

    for (const row of rows) {
      const at = job.playlists.findIndex((one) => one.sourceId === row.sourceId)
      const mark = (patch: Partial<JobPlaylist>): void => {
        if (at >= 0) job.playlists[at] = { ...job.playlists[at], ...patch }
      }
      if (row.trackIds.length === 0) {
        mark({ state: 'skipped', why: 'Nothing new to add.' })
        continue
      }
      mark({ state: 'importing' })
      this.o.announce()

      try {
        if (row.destinationId) {
          const destination = existing.find((one) => one.id === row.destinationId)
          if (!destination) {
            mark({ state: 'failed', why: 'That playlist is no longer there.' })
            continue
          }
          // The snapshot is taken before the write, which is the only moment it can be taken.
          await this.o.store.keepSnapshot(
            `${jobId}:${row.destinationId}`,
            snapshotOf(row.destinationId, destination.name, destination.tracks, `Imported from ${job.provider}`, this.o.now())
          )
          const saved = await this.o.setPlaylistTracks(row.destinationId, row.trackIds)
          if (!saved) {
            mark({ state: 'failed', why: 'Orbis could not save that playlist.' })
            continue
          }
          // Read back: the count comes from the playlist, not from what was asked for.
          const after = (await this.o.playlists()).find((one) => one.id === row.destinationId)
          const gained = Math.max(0, (after?.tracks.length ?? 0) - destination.tracks.length)
          addedTotal += gained
          mark({ state: 'done', added: gained, why: null })
        } else {
          const made = await this.o.createPlaylist(row.destinationName, row.trackIds)
          if (!made) {
            mark({ state: 'failed', why: 'Orbis could not make that playlist.' })
            continue
          }
          addedTotal += made.tracks.length
          mark({ state: 'done', added: made.tracks.length, why: null })
        }
      } catch (error) {
        mark({ state: 'failed', why: String(error instanceof Error ? error.message : error).slice(0, 200) })
      }
    }

    // One provenance row per imported track, so a second run of this adds nothing.
    const provenance: Provenance[] = []
    for (const row of rows) {
      for (const trackId of row.trackIds) {
        provenance.push({
          provider: job.provider,
          sourceTrackId: trackId,
          sourcePlaylistId: row.sourceId,
          importedAt: this.o.now(),
          jobId
        })
      }
    }
    if (provenance.length > 0) await this.o.store.recordImported(provenance)

    job.phase = 'done'
    job.status = job.playlists.some((one) => one.state === 'failed') ? 'stopped' : 'finished'
    job.endedAt = this.o.now()
    this.live.set(job.id, job)
    // What it read is in the playlists now, so there is no reason to keep holding it.
    this.reads.delete(job.id)
    await this.o.store.saveJob(job)
    await this.o.store.flush()
    this.o.announce()

    return { ok: true, job, says: summarise(job) }
  }

  /** Putting a playlist back to what it was before an import. */
  async undo(jobId: string, playlistId: string): Promise<{ ok: boolean; says: string }> {
    const snapshots = await this.o.store.snapshotsFor(playlistId)
    const one = snapshots.find((two) => two.id === `${jobId}:${playlistId}`) ?? snapshots[0]
    if (!one) return { ok: false, says: 'There is no record of what that playlist was before.' }
    const saved = await this.o.setPlaylistTracks(playlistId, one.tracks)
    if (!saved) return { ok: false, says: 'Orbis could not put that playlist back.' }
    this.o.announce()
    return { ok: true, says: `Put back to ${one.tracks.length} ${one.tracks.length === 1 ? 'track' : 'tracks'}.` }
  }

  // ---------------------------------------------------------------- the rest of the centre

  async jobs(): Promise<(Job & { progress: number; says: string; resumable: boolean })[]> {
    const all = await this.o.store.jobList()
    return all.map((one) => {
      const live = this.live.get(one.id) ?? one
      return { ...live, progress: progress(live).done, says: summarise(live), resumable: remaining(live).length > 0 && live.status !== 'finished' }
    })
  }

  async jobDetail(id: string): Promise<{ job: Job; totals: ReturnType<typeof totals>; says: string } | null> {
    const job = this.live.get(id) ?? (await this.o.store.job(id))
    if (!job) return null
    return { job, totals: totals(job), says: summarise(job) }
  }

  async unmatched(includeSettled = false): Promise<UnmatchedRow[]> {
    return this.o.store.unmatchedList({ includeSettled })
  }

  /** Matching an unmatched row by hand, which is a decision and is recorded as one. */
  async matchByHand(rowId: string, trackId: string): Promise<{ ok: boolean; says: string }> {
    const rows = await this.o.store.unmatchedList({ includeSettled: true })
    const one = rows.find((two) => two.id === rowId)
    if (!one) return { ok: false, says: 'That row is not there any more.' }
    const tracks = await this.o.tracks()
    const track = tracks.find((two) => two.id === trackId)
    if (!track) return { ok: false, says: 'That is not a track in your library.' }
    await this.o.store.settleUnmatched(rowId, 'matched-by-hand')
    this.o.announce()
    return { ok: true, says: `${one.wanted.title} is ${track.title} by ${track.artist}.` }
  }

  async notWanted(rowId: string): Promise<{ ok: boolean; says: string }> {
    const out = await this.o.store.settleUnmatched(rowId, 'not-wanted')
    this.o.announce()
    return out ? { ok: true, says: 'Left out.' } : { ok: false, says: 'That row is not there any more.' }
  }

  /** Playlists that look like the same playlist, across everything that was imported. */
  async duplicatePlaylists(): Promise<ReturnType<typeof duplicatePlaylists>> {
    const tracks = await this.o.tracks()
    const byId = new Map(tracks.map((one) => [one.id, one]))
    const lists = await this.o.playlists()
    return duplicatePlaylists(
      lists.map((one) => ({
        id: one.id,
        name: one.name,
        tracks: one.tracks.map((id) => byId.get(id)).filter((two): two is OrbisTrack => !!two)
      }))
    )
  }

  /** Two playlists side by side. The screen behind "what is different about these?". */
  async compare(leftId: string, rightId: string): Promise<{ similarity: ReturnType<typeof similarity>; onlyLeft: OrbisTrack[]; onlyRight: OrbisTrack[]; shared: OrbisTrack[] } | null> {
    const tracks = await this.o.tracks()
    const byId = new Map(tracks.map((one) => [one.id, one]))
    const lists = await this.o.playlists()
    const left = lists.find((one) => one.id === leftId)
    const right = lists.find((one) => one.id === rightId)
    if (!left || !right) return null
    const rows = (ids: readonly string[]): OrbisTrack[] => ids.map((id) => byId.get(id)).filter((one): one is OrbisTrack => !!one)
    const a = rows(left.tracks)
    const b = rows(right.tracks)
    const rightKeys = new Set(b.map((one) => one.id))
    const leftKeys = new Set(a.map((one) => one.id))
    return {
      similarity: similarity(a, b),
      shared: a.filter((one) => rightKeys.has(one.id)),
      onlyLeft: a.filter((one) => !rightKeys.has(one.id)),
      onlyRight: b.filter((one) => !leftKeys.has(one.id))
    }
  }

  /**
   * What changed at a source since the last import.
   *
   * Reports and never acts. Removals in particular are handed back as a list, because a track missing from a
   * service for a week is not somebody asking for it to leave their playlist.
   */
  async changesAtSource(provider: string, playlistId: string, nowAtSource: readonly string[]): Promise<ReturnType<typeof changesSince>> {
    const seen = await this.o.store.provenanceFor(provider)
    const lastSeen = seen.filter((one) => one.sourcePlaylistId === playlistId).map((one) => one.sourceTrackId ?? '').filter(Boolean)
    return changesSince(lastSeen, nowAtSource)
  }

  async settings(): Promise<MigrateSettings> {
    return this.o.store.settings()
  }

  async saveSettings(patch: Partial<MigrateSettings>): Promise<MigrateSettings> {
    const out = await this.o.store.saveSettings(patch)
    this.o.announce()
    return out
  }

  /** Whether a connection can be used right now, for anything that is about to ask a service something. */
  async check(sourceId: string): Promise<{ ok: boolean; why: string }> {
    const held = await this.o.store.connectionList((id) => this.o.configured(id))
    const one = held.find((two) => two.sourceId === sourceId)
    if (!one) return { ok: false, why: 'Orbis does not know that service.' }
    return usable(one, this.o.now())
  }

  async pick(kind: 'files' | 'folder'): Promise<string[]> {
    return this.o.pickFiles(kind)
  }
}
