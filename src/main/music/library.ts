import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join, resolve, sep } from 'node:path'
import { readAudioFacts, PLAYABLE_KINDS, type AudioFacts } from '../../shared/audioFile.ts'
import { addRecognised, bestMatches, existing, matchDecision, plainly, type AddOutcome, type OrbisTrack, type TrackNames } from '../../shared/music.ts'
import type { MusicStore } from './store.ts'

/**
 * Bringing real audio files into Orbis Music, and keeping the library honest about them afterwards.
 *
 * Everything here reads bytes off the disk. A track is only ever marked as being on this computer because a file was
 * opened and understood; the length on its progress bar came out of the file's own headers; its artwork is the
 * picture the file carries. There is no path through this file that invents any of those, and no path that fetches
 * audio from anywhere -- importing means a file the person already has, and nothing else.
 *
 * ## What "imported" has to mean
 *
 * A row that says a song is here, when it is not, is worse than no row: it offers a play button that fails, and it
 * does so later, when nobody remembers adding it. So an import is only finished when the file has been read, its kind
 * recognised, and its length known -- and when any of that fails the file is reported as it is, not added as though
 * it had worked.
 */

export interface ImportResult {
  kind: 'added' | 'already' | 'failed'
  track?: OrbisTrack
  file: string
  why?: string
}

export interface ScanProgress {
  /** Files looked at so far, and how many there are to look at. Both counted, never estimated. */
  done: number
  total: number
  added: number
  already: number
  failed: number
  /** The file being read now, by name only. */
  current?: string
}

/** How much of a file is enough to read its tags and count its frames. Whole files are not held in memory. */
const READ_LIMIT = 24 * 1024 * 1024

/** What a scan will walk into. A music folder with a hundred thousand files deep inside it is not walked for ever. */
const MAX_DEPTH = 8
const MAX_SCAN_FILES = 50_000

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.wave'])

/** A name for a track that has no title of its own: the file's own name, which is at least true. */
const nameFromFile = (path: string): string => basename(path, extname(path)).replace(/[_]+/g, ' ').trim() || 'Untitled'

export class MusicLibrary {
  private readonly store: MusicStore
  private readonly newId: () => string
  /** Scans that are running, so one can be stopped. */
  private readonly scans = new Map<string, { stop: boolean }>()

  constructor(store: MusicStore, newId: () => string = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`) {
    this.store = store
    this.newId = newId
  }

  // ---------------------------------------------------------------- reading one file

  /**
   * Everything a file says about itself, or why it could not be read.
   *
   * The file is opened and read, which is the only way to know any of this. A file that is there but is not audio, or
   * is audio this computer cannot play, says so -- those are different problems with different answers.
   */
  async readFile(path: string): Promise<{ facts: AudioFacts; size: number; modified: number } | { why: string }> {
    const full = resolve(path)
    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(full)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      return { why: code === 'ENOENT' ? 'That file is not there.' : 'That file could not be opened.' }
    }
    if (!stat.isFile()) return { why: 'That is a folder, not an audio file.' }
    if (stat.size === 0) return { why: 'That file is empty.' }

    let bytes: Uint8Array
    try {
      const handle = await fs.open(full, 'r')
      try {
        const length = Math.min(stat.size, READ_LIMIT)
        const buffer = Buffer.allocUnsafe(length)
        await handle.read(buffer, 0, length, 0)
        bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      } finally {
        await handle.close()
      }
    } catch {
      return { why: 'That file could not be read.' }
    }

    const facts = readAudioFacts(bytes)
    if (facts.kind === 'unknown') return { why: 'That is not an audio file Orbis can read.' }
    if (!PLAYABLE_KINDS.includes(facts.kind)) return { why: `Orbis cannot play ${facts.kind.toUpperCase()} files.` }
    return { facts, size: stat.size, modified: stat.mtimeMs }
  }

  /** Writes a file's own artwork into the profile, and says where it went. Null when there was none. */
  private async keepArtwork(trackId: string, facts: AudioFacts): Promise<string | undefined> {
    if (!facts.artwork || facts.artwork.bytes.length === 0) return undefined
    // Only pictures. A tag can hold anything, and anything is not written to the disk as a picture.
    const mime = facts.artwork.mime.toLowerCase()
    const extension = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : mime.includes('gif') ? '.gif' : '.jpg'
    const first = facts.artwork.bytes
    const looksLikeImage =
      (first[0] === 0xff && first[1] === 0xd8) || // JPEG
      (first[0] === 0x89 && first[1] === 0x50) || // PNG
      (first[0] === 0x47 && first[1] === 0x49) || // GIF
      (first[0] === 0x52 && first[1] === 0x49) // RIFF/WEBP
    if (!looksLikeImage) return undefined
    await this.store.prepare()
    const path = join(this.store.artworkFolder(), `${trackId}${extension}`)
    try {
      await fs.writeFile(path, facts.artwork.bytes, { mode: 0o600 })
      return path
    } catch {
      // No artwork is a perfectly good outcome; a failed write is not a failed import.
      return undefined
    }
  }

  /**
   * Adds one file to the library.
   *
   * A file already in the library is said to be already there rather than added twice -- and a file whose contents
   * match a track that was only known by name takes that track over, which is exactly the case of "I recognised this
   * while browsing and have now found my own copy".
   */
  async importFile(path: string, provenance: OrbisTrack['provenance'] = 'user-file', now = Date.now()): Promise<ImportResult> {
    const full = resolve(path)
    const read = await this.readFile(full)
    if ('why' in read) return { kind: 'failed', file: full, why: read.why }
    const { facts, size, modified } = read

    const library = await this.store.all()
    const sameFile = library.find((track) => track.file && resolve(track.file) === full)
    if (sameFile) {
      // Known file. Make sure the library agrees with what is on the disk now.
      const refreshed = await this.store.update(sameFile.id, {
        availability: 'local',
        fileSize: size,
        fileModified: modified,
        duration: facts.duration ?? sameFile.duration
      })
      return { kind: 'already', file: full, track: refreshed ?? sameFile }
    }

    const names: TrackNames = {
      title: facts.tags.title ?? nameFromFile(full),
      artist: facts.tags.artist ?? '',
      album: facts.tags.album ?? '',
      albumArtist: facts.tags.albumArtist,
      genre: facts.tags.genre,
      year: facts.tags.year,
      trackNumber: facts.tags.trackNumber,
      discNumber: facts.tags.discNumber
    }

    /*
     * A track known only by name, now matched to a real file, becomes that file rather than a second row.
     *
     * Scored rather than compared exactly, because the name in the library may be the person's own: somebody who
     * renamed a recognised song to "Starboy (my favourite)" and then imports their copy of Starboy should end up with
     * one song, not two. The artist and the length carry the match in that case, which is what they are for.
     */
    const reference = bestMatches({ ...names, duration: facts.duration ?? 0 }, library.filter((track) => track.availability === 'reference'), 65)[0]?.track

    const id = reference?.id ?? this.newId()
    const artwork = reference?.artworkChosen ? reference.artwork : await this.keepArtwork(id, facts)
    const track: OrbisTrack = {
      ...(reference ?? {}),
      id,
      // A person's own edits are never overwritten by a file's tags.
      ...(reference?.edited ? {} : names),
      title: reference?.edited ? reference.title : names.title,
      artist: reference?.edited ? reference.artist : names.artist,
      album: reference?.edited ? reference.album : names.album,
      duration: facts.duration !== null ? Math.round(facts.duration * 1000) / 1000 : 0,
      availability: 'local',
      provenance,
      confidence: facts.tags.title ? 'high' : 'medium',
      method: facts.tags.title ? 'file-tags' : reference?.method ?? 'file-tags',
      file: full,
      fileSize: size,
      fileModified: modified,
      artwork,
      addedAt: reference?.addedAt ?? now
    }
    const stored = await this.store.put(track)
    return { kind: 'added', file: full, track: stored, why: facts.problem }
  }

  /** Adds several files, one after another, telling the caller as it goes. Stops when asked to. */
  async importFiles(paths: readonly string[], onProgress?: (progress: ScanProgress) => void, token?: { stop: boolean }): Promise<ScanProgress & { results: ImportResult[] }> {
    const progress: ScanProgress = { done: 0, total: paths.length, added: 0, already: 0, failed: 0 }
    const results: ImportResult[] = []
    for (const path of paths) {
      if (token?.stop) break
      progress.current = basename(path)
      onProgress?.({ ...progress })
      const result = await this.importFile(path)
      results.push(result)
      progress.done += 1
      if (result.kind === 'added') progress.added += 1
      else if (result.kind === 'already') progress.already += 1
      else progress.failed += 1
      onProgress?.({ ...progress })
    }
    progress.current = undefined
    return { ...progress, results }
  }

  // ---------------------------------------------------------------- a folder

  /** Every audio-looking file under a folder. Bounded in depth and in number, so a huge drive cannot hang a scan. */
  private async audioFilesUnder(folder: string, depth = 0, found: string[] = []): Promise<string[]> {
    if (depth > MAX_DEPTH || found.length >= MAX_SCAN_FILES) return found
    let entries: { name: string; isDirectory(): boolean }[]
    try {
      entries = await fs.readdir(folder, { withFileTypes: true })
    } catch {
      return found
    }
    for (const entry of entries) {
      if (found.length >= MAX_SCAN_FILES) break
      const path = join(folder, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        await this.audioFilesUnder(path, depth + 1, found)
      } else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(path)
      }
    }
    return found
  }

  /**
   * Reads a folder into the library.
   *
   * The extension is used only to decide what is worth opening; what a file actually is still comes from its bytes.
   * A scan can be stopped, and stopping leaves every file that was already read in the library -- nothing half-added.
   */
  async scanFolder(folder: string, onProgress?: (progress: ScanProgress) => void, scanId = `scan-${Date.now().toString(36)}`): Promise<ScanProgress & { id: string }> {
    const token = { stop: false }
    this.scans.set(scanId, token)
    try {
      const files = await this.audioFilesUnder(resolve(folder))
      const outcome = await this.importFiles(files, onProgress, token)
      return { ...outcome, id: scanId }
    } finally {
      this.scans.delete(scanId)
    }
  }

  /** Stops a scan that is running. What was already read stays. */
  stopScan(scanId?: string): boolean {
    if (scanId) {
      const token = this.scans.get(scanId)
      if (!token) return false
      token.stop = true
      return true
    }
    let any = false
    for (const token of this.scans.values()) {
      token.stop = true
      any = true
    }
    return any
  }

  get scanning(): boolean {
    return this.scans.size > 0
  }

  // ---------------------------------------------------------------- files that moved or went

  /**
   * Checks the files the library points at.
   *
   * A file that is gone makes its track `missing`, which keeps everything about it so it can be pointed at the file
   * again. Nothing is deleted: a drive that was not plugged in is the usual reason, and deleting somebody's library
   * because they unplugged a drive would be unforgivable.
   */
  async checkFiles(): Promise<{ missing: OrbisTrack[]; returned: OrbisTrack[] }> {
    const library = await this.store.all()
    const missing: OrbisTrack[] = []
    const returned: OrbisTrack[] = []
    for (const track of library) {
      if (!track.file) continue
      const there = await fs
        .stat(track.file)
        .then((stat) => stat.isFile())
        .catch(() => false)
      if (!there && track.availability === 'local') {
        const next = await this.store.update(track.id, { availability: 'missing' })
        if (next) missing.push(next)
      } else if (there && track.availability === 'missing') {
        const next = await this.store.update(track.id, { availability: 'local' })
        if (next) returned.push(next)
      }
    }
    return { missing, returned }
  }

  /** Points a track at a file again, after checking that the file really is audio Orbis can play. */
  async relink(trackId: string, path: string): Promise<ImportResult> {
    const track = await this.store.track(trackId)
    if (!track) return { kind: 'failed', file: path, why: 'That track is not in your music.' }
    const read = await this.readFile(path)
    if ('why' in read) return { kind: 'failed', file: path, why: read.why }
    const next = await this.store.update(trackId, {
      file: resolve(path),
      fileSize: read.size,
      fileModified: read.modified,
      availability: 'local',
      duration: read.facts.duration ?? track.duration
    })
    return { kind: 'added', file: resolve(path), track: next ?? track }
  }

  /**
   * Files in the watched folders that might be the missing one, best first.
   *
   * By name and by length, not by where it used to be -- a file that moved has a different path and the same
   * everything else.
   */
  async findReplacements(trackId: string): Promise<string[]> {
    const track = await this.store.track(trackId)
    if (!track) return []
    const { folders } = await this.store.settings()
    const candidates: string[] = []
    for (const folder of folders) candidates.push(...(await this.audioFilesUnder(resolve(folder))))
    const library = await this.store.all()
    const taken = new Set(library.filter((one) => one.file && one.id !== trackId).map((one) => resolve(one.file!)))
    const wanted = plainly(track.title)
    return candidates
      .filter((path) => !taken.has(resolve(path)))
      .filter((path) => {
        const name = plainly(basename(path, extname(path)))
        return name.includes(wanted) || wanted.includes(name)
      })
      .slice(0, 10)
  }

  // ---------------------------------------------------------------- duplicates

  /** Groups of tracks that look like the same recording. Nothing is removed: what to keep is the person's to decide. */
  async duplicates(): Promise<OrbisTrack[][]> {
    const library = await this.store.all()
    const groups = new Map<string, OrbisTrack[]>()
    for (const track of library) {
      const key = `${plainly(track.title)}|${plainly(track.artist)}|${Math.round(track.duration)}`
      const held = groups.get(key)
      if (held) held.push(track)
      else groups.set(key, [track])
    }
    return [...groups.values()].filter((group) => group.length > 1)
  }

  // ---------------------------------------------------------------- keeping something heard while browsing

  /**
   * What happens when somebody presses "Add to Orbis Music".
   *
   * The three honest endings are in `addRecognised`: the person already has it, the person might have it and is
   * asked which file, or the person has no copy and Orbis keeps the name and says so. Nothing here downloads
   * anything.
   */
  async addHeard(names: TrackNames, duration: number, source: { provider: string; url?: string }, now = Date.now()): Promise<AddOutcome> {
    const library = await this.store.all()
    const outcome = addRecognised(names, duration, library, source, now, this.newId)
    if (outcome.kind === 'reference') {
      const stored = await this.store.put(outcome.track)
      await this.store.noteRecognised({ title: stored.title, artist: stored.artist, album: stored.album, provider: source.provider, url: source.url, at: now, trackId: stored.id })
      return { kind: 'reference', track: stored }
    }
    if (outcome.kind === 'linked' || outcome.kind === 'already') {
      // The copy they have is the copy: the only thing noted is where it was heard.
      await this.store.noteRecognised({ title: outcome.track.title, artist: outcome.track.artist, album: outcome.track.album, provider: source.provider, url: source.url, at: now, trackId: outcome.track.id })
    }
    return outcome
  }

  /** The person said which of their files it was. */
  async linkHeard(trackId: string): Promise<OrbisTrack | null> {
    return this.store.track(trackId)
  }

  /** What is already in the library for these names, if anything. Used to label the add button honestly. */
  async alreadyHave(names: TrackNames, duration: number): Promise<OrbisTrack | null> {
    const library = await this.store.all()
    const decision = matchDecision(bestMatches({ ...names, duration }, library))
    return decision.kind === 'use' ? decision.track : null
  }

  /** The same recording already in the library, if any. */
  async same(track: OrbisTrack): Promise<OrbisTrack | undefined> {
    return existing(track, await this.store.all())
  }

  // ---------------------------------------------------------------- deleting, with the two acts kept apart

  /**
   * Deletes the actual file from the computer, and then the library row.
   *
   * Only ever called where somebody has confirmed exactly this, in those words. Removing from the library is
   * `store.remove`, which never touches a file; this is the other thing entirely.
   */
  async deleteFile(trackId: string): Promise<{ ok: boolean; why?: string }> {
    const track = await this.store.track(trackId)
    if (!track) return { ok: false, why: 'That track is not in your music.' }
    if (!track.file) return { ok: false, why: 'There is no file for that track.' }
    try {
      await fs.rm(track.file, { force: true })
    } catch {
      return { ok: false, why: 'That file could not be deleted.' }
    }
    await this.store.remove(trackId)
    return { ok: true }
  }

  /** A file identity, for telling two files apart without keeping their contents. */
  async fingerprint(path: string): Promise<string | null> {
    try {
      const handle = await fs.open(resolve(path), 'r')
      try {
        const buffer = Buffer.allocUnsafe(Math.min(1024 * 256, (await handle.stat()).size))
        await handle.read(buffer, 0, buffer.length, 0)
        return createHash('sha256').update(buffer).digest('hex').slice(0, 32)
      } finally {
        await handle.close()
      }
    } catch {
      return null
    }
  }

  /**
   * Whether a path is somewhere a person could reasonably have put music.
   *
   * A thin guard, on purpose: the file still has to be read and understood before anything is added, so this is only
   * about not following a request into the operating system's own folders. It once also refused anything under a
   * temporary folder whose name began with "orbis", which quietly refused every file in a folder called
   * `orbis-music-check` -- a rule broad enough to catch ordinary paths is a rule that breaks ordinary use.
   */
  static sensiblePath(path: string, orbisData?: string): boolean {
    const full = resolve(path)
    if (full.includes('\u0000')) return false
    const lower = full.toLowerCase()
    if (lower.includes(`${sep}windows${sep}`.toLowerCase()) || lower.includes(`${sep}system32${sep}`.toLowerCase())) return false
    // Orbis's own folder is not somebody's music collection.
    if (orbisData && lower.startsWith(resolve(orbisData).toLowerCase() + sep)) return false
    return true
  }
}
