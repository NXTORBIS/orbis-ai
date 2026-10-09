import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { dataDirFor, DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { Collection, JsonFile } from '../personal/store.ts'
import {
  albums as groupAlbums,
  artists as groupArtists,
  genres as groupGenres,
  playableOffline,
  searchLibrary,
  tracksForRule,
  type LibraryQuery,
  type OrbisTrack,
  type Playlist,
  type PlaylistRule,
  type RepeatMode
} from '../../shared/music.ts'

/**
 * What Orbis Music remembers: the tracks, the playlists, what was listened to, and how it is set up.
 *
 * Kept with the profile, like notes and tasks, because one person's music is not another's. Built on the same
 * `JsonFile` everything else uses, which means it is written beside itself and renamed over, is readable by this
 * account only, and -- since the storage work earlier -- is never written over when the old file is there and could
 * not be read.
 *
 * Three things are deliberately separate:
 *
 * **Tracks** are the library. A track is a row of names and, when there is one, the file those names came from.
 *
 * **Playlists** refer to tracks and never copy them, so deleting a playlist cannot lose a song, and a track removed
 * from the library simply stops being listed by the playlists that mentioned it.
 *
 * **History** is what was actually played through Orbis Music -- not what was recognised while browsing. Those two
 * get confused constantly and mean quite different things: one is a record of listening, the other a record of
 * noticing.
 */

export const MUSIC_SCHEMA = 1
export const MAX_TRACKS = 50_000
export const MAX_PLAYLISTS = 500
export const MAX_HISTORY = 2000
export const MAX_RECOGNISED = 200

export interface Played {
  id: string
  trackId: string
  at: number
  /** Seconds listened to, as the player reported them. */
  seconds: number
}

/** A song Orbis noticed while browsing. Noticing is not owning, so this is not the library. */
export interface Recognised {
  id: string
  title: string
  artist: string
  album?: string
  provider: string
  url?: string
  at: number
  /** The library track it turned into, when somebody kept it. */
  trackId?: string
}

export interface MusicSettings {
  recognition: 'automatic' | 'manual' | 'off'
  /** Whether Orbis may look at the screen to work out what is playing. */
  useVision: boolean
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  /** Whether to offer to carry on from where a track was left. */
  resume: boolean
  /** Folders Orbis watches for music. */
  folders: string[]
  /** Whether the music control is shown in the browser. */
  showButton: boolean
  miniPlayer: 'compact' | 'full'
  /** What the library opens on. */
  view: 'songs' | 'albums' | 'artists' | 'genres' | 'playlists' | 'favourites'
  sort: LibraryQuery['sort']
  /** Whether playback starts again by itself when Orbis opens. Off unless asked for. */
  playOnStart: boolean
}

export const DEFAULT_MUSIC_SETTINGS: MusicSettings = {
  recognition: 'automatic',
  useVision: true,
  volume: 1,
  shuffle: false,
  repeat: 'off',
  resume: true,
  folders: [],
  showButton: true,
  miniPlayer: 'compact',
  view: 'songs',
  sort: 'added',
  playOnStart: false
}

// ---------------------------------------------------------------- checking what comes back off the disk

const text = (value: unknown, max = 400): string | undefined => {
  if (typeof value !== 'string') return undefined
  const out = value.trim()
  return out && out.length <= max ? out : undefined
}
const positive = (value: unknown, max = 1e9): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : undefined
const when = (value: unknown): number | undefined => positive(value, 4e12)

const AVAILABILITY = new Set(['local', 'reference', 'missing', 'unsupported'])
const PROVENANCE = new Set(['user-file', 'watched-folder', 'download', 'recognised'])
const CONFIDENCE = new Set(['low', 'medium', 'high', 'confirmed'])
const METHOD = new Set(['file-tags', 'media-session', 'vision', 'page-metadata', 'accessibility', 'person'])

/**
 * A track, as it may be trusted.
 *
 * Read strictly, because this file is also what an import or a restore puts back: a row with no title and no file is
 * not a song, and a row claiming to be playable with no file would offer a play button that cannot work. Anything
 * unrecognised is dropped rather than carried along.
 */
export function normalizeTrack(raw: unknown): OrbisTrack | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const id = text(one.id, 64)
  const title = text(one.title)
  if (!id || !title) return null
  const file = text(one.file, 4096)
  const availability = AVAILABILITY.has(String(one.availability)) ? (one.availability as OrbisTrack['availability']) : 'reference'
  return {
    id,
    title,
    artist: text(one.artist) ?? '',
    album: text(one.album) ?? '',
    albumArtist: text(one.albumArtist),
    genre: text(one.genre, 120),
    year: positive(one.year, 2200),
    trackNumber: positive(one.trackNumber, 9999),
    discNumber: positive(one.discNumber, 999),
    duration: positive(one.duration, 86_400) ?? 0,
    // A track that says it is here but names no file is not here. Saying otherwise offers a play that cannot work.
    availability: availability === 'local' && !file ? 'reference' : availability,
    provenance: PROVENANCE.has(String(one.provenance)) ? (one.provenance as OrbisTrack['provenance']) : file ? 'user-file' : 'recognised',
    confidence: CONFIDENCE.has(String(one.confidence)) ? (one.confidence as OrbisTrack['confidence']) : 'medium',
    method: METHOD.has(String(one.method)) ? (one.method as OrbisTrack['method']) : file ? 'file-tags' : 'media-session',
    file,
    fileSize: positive(one.fileSize, 1e12),
    fileModified: when(one.fileModified),
    artwork: text(one.artwork, 4096),
    edited: one.edited === true,
    artworkChosen: one.artworkChosen === true,
    source:
      one.source && typeof one.source === 'object'
        ? {
            provider: text((one.source as Record<string, unknown>).provider, 80) ?? 'unknown',
            url: text((one.source as Record<string, unknown>).url, 2048),
            recognisedAt: when((one.source as Record<string, unknown>).recognisedAt) ?? 0
          }
        : undefined,
    favourite: one.favourite === true,
    addedAt: when(one.addedAt) ?? Date.now(),
    lastPlayedAt: when(one.lastPlayedAt),
    playCount: positive(one.playCount, 1e6),
    position: positive(one.position, 86_400)
  }
}

export function normalizePlaylist(raw: unknown): Playlist | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const id = text(one.id, 64)
  const name = text(one.name, 200)
  if (!id || !name) return null
  const rule = one.rule && typeof one.rule === 'object' ? (one.rule as PlaylistRule) : undefined
  return {
    id,
    name,
    tracks: Array.isArray(one.tracks) ? one.tracks.filter((t): t is string => typeof t === 'string').slice(0, MAX_TRACKS) : [],
    createdAt: when(one.createdAt) ?? Date.now(),
    updatedAt: when(one.updatedAt) ?? Date.now(),
    rule
  }
}

function normalizePlayed(raw: unknown): Played | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const id = text(one.id, 64)
  const trackId = text(one.trackId, 64)
  if (!id || !trackId) return null
  return { id, trackId, at: when(one.at) ?? Date.now(), seconds: positive(one.seconds, 86_400) ?? 0 }
}

function normalizeRecognised(raw: unknown): Recognised | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const id = text(one.id, 64)
  const title = text(one.title)
  if (!id || !title) return null
  return {
    id,
    title,
    artist: text(one.artist) ?? '',
    album: text(one.album),
    provider: text(one.provider, 80) ?? 'unknown',
    url: text(one.url, 2048),
    at: when(one.at) ?? Date.now(),
    trackId: text(one.trackId, 64)
  }
}

export function normalizeSettings(raw: unknown): MusicSettings {
  const one = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
  return {
    recognition: pick(one.recognition, ['automatic', 'manual', 'off'] as const, DEFAULT_MUSIC_SETTINGS.recognition),
    useVision: one.useVision !== false,
    volume: typeof one.volume === 'number' && one.volume >= 0 && one.volume <= 1 ? one.volume : 1,
    shuffle: one.shuffle === true,
    repeat: pick(one.repeat, ['off', 'all', 'one'] as const, 'off'),
    resume: one.resume !== false,
    folders: Array.isArray(one.folders) ? one.folders.filter((f): f is string => typeof f === 'string' && f.length < 4096).slice(0, 20) : [],
    showButton: one.showButton !== false,
    miniPlayer: pick(one.miniPlayer, ['compact', 'full'] as const, 'compact'),
    view: pick(one.view, ['songs', 'albums', 'artists', 'genres', 'playlists', 'favourites'] as const, 'songs'),
    sort: pick(one.sort as string, ['title', 'artist', 'album', 'added', 'played', 'plays', 'duration', 'year'] as const, 'added'),
    playOnStart: one.playOnStart === true
  }
}

// ---------------------------------------------------------------- the store

const musicFile = (userData: string, profileId: string, name: string): string => join(userData, dataDirFor(profileId), 'music', name)

/** Where a profile's artwork is kept. Inside the profile, so it goes when the profile goes. */
export const artworkDir = (userData: string, profileId: string): string => join(userData, dataDirFor(profileId), 'music', 'artwork')

export class MusicStore {
  private readonly tracks: Collection<OrbisTrack>
  private readonly playlists: Collection<Playlist>
  private readonly history: Collection<Played>
  private readonly recognised: Collection<Recognised>
  private readonly settingsFile: JsonFile<MusicSettings>
  /**
   * What Orbis has learned about this profile: the taste layers, the small outcome models, which ways of
   * choosing have worked, the tunable numbers, and what each track turned out to sound like.
   *
   * Kept apart from the library on purpose. The library is what somebody has; this is what Orbis thinks about
   * it, and "forget what you have learned about me" has to be able to remove one without touching the other.
   */
  private readonly brainFile: JsonFile<Record<string, unknown> | null>
  private readonly listeners = new Set<() => void>()

  private readonly userData: string
  private profileId = DEFAULT_PROFILE_ID

  constructor(userData: string) {
    this.userData = userData
    const path = (name: string): string => musicFile(userData, DEFAULT_PROFILE_ID, name)
    this.tracks = new Collection<OrbisTrack>(path('tracks.json'), normalizeTrack, MAX_TRACKS)
    this.playlists = new Collection<Playlist>(path('playlists.json'), normalizePlaylist, MAX_PLAYLISTS)
    this.history = new Collection<Played>(path('history.json'), normalizePlayed, MAX_HISTORY)
    this.recognised = new Collection<Recognised>(path('recognised.json'), normalizeRecognised, MAX_RECOGNISED)
    this.settingsFile = new JsonFile<MusicSettings>(path('settings.json'), () => ({ ...DEFAULT_MUSIC_SETTINGS }), normalizeSettings)
    this.brainFile = new JsonFile<Record<string, unknown> | null>(path('intelligence.json'), () => null, (raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null))
    for (const one of [this.tracks, this.playlists, this.history, this.recognised]) one.onChange(() => this.changed())
  }

  /** Moves to another profile's music. One person's library is never shown in another's. */
  async useProfile(profileId: string): Promise<void> {
    if (profileId === this.profileId) return
    this.profileId = profileId
    const path = (name: string): string => musicFile(this.userData, profileId, name)
    await Promise.all([
      this.tracks.usePath(path('tracks.json')),
      this.playlists.usePath(path('playlists.json')),
      this.history.usePath(path('history.json')),
      this.recognised.usePath(path('recognised.json')),
      this.settingsFile.usePath(path('settings.json')),
      this.brainFile.usePath(path('intelligence.json'))
    ])
    this.changed()
  }

  get profile(): string {
    return this.profileId
  }

  artworkFolder(): string {
    return artworkDir(this.userData, this.profileId)
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }

  // ---------------------------------------------------------------- tracks

  all(): Promise<OrbisTrack[]> {
    return this.tracks.all()
  }

  track(id: string): Promise<OrbisTrack | null> {
    return this.tracks.get(id)
  }

  async search(query: LibraryQuery = {}): Promise<OrbisTrack[]> {
    return searchLibrary(await this.all(), query)
  }

  async put(track: OrbisTrack): Promise<OrbisTrack> {
    return this.tracks.put(track)
  }

  /** Changes some of a track's fields. Marks it edited when a person changed any of its names. */
  async update(id: string, patch: Partial<OrbisTrack>, byPerson = false): Promise<OrbisTrack | null> {
    const held = await this.track(id)
    if (!held) return null
    const named = ['title', 'artist', 'album', 'albumArtist', 'genre', 'year', 'trackNumber', 'discNumber'] as const
    const renamed = byPerson && named.some((key) => key in patch)
    const next: OrbisTrack = {
      ...held,
      ...patch,
      id: held.id,
      edited: held.edited || renamed,
      artworkChosen: held.artworkChosen || (byPerson && 'artwork' in patch)
    }
    return this.tracks.put(next)
  }

  /**
   * Takes a track out of the library. The file on the computer is not touched.
   *
   * Removing a row and deleting somebody's file are completely different acts, and this is only ever the first one.
   * Deleting a file is a separate, explicitly confirmed thing elsewhere.
   */
  async remove(id: string): Promise<boolean> {
    const gone = await this.tracks.remove(id)
    if (!gone) return false
    const lists = await this.playlists.all()
    for (const list of lists) {
      if (!list.tracks.includes(id)) continue
      await this.playlists.put({ ...list, tracks: list.tracks.filter((t) => t !== id), updatedAt: Date.now() })
    }
    const played = await this.history.all()
    if (played.some((one) => one.trackId === id)) await this.history.replace(played.filter((one) => one.trackId !== id))
    return true
  }

  async setFavourite(id: string, favourite: boolean): Promise<OrbisTrack | null> {
    return this.update(id, { favourite })
  }

  async albums(): Promise<ReturnType<typeof groupAlbums>> {
    return groupAlbums(await this.all())
  }

  async artists(): Promise<ReturnType<typeof groupArtists>> {
    return groupArtists(await this.all())
  }

  async genres(): Promise<ReturnType<typeof groupGenres>> {
    return groupGenres(await this.all())
  }

  // ---------------------------------------------------------------- playlists

  lists(): Promise<Playlist[]> {
    return this.playlists.all()
  }

  list(id: string): Promise<Playlist | null> {
    return this.playlists.get(id)
  }

  async createList(name: string, tracks: string[] = [], rule?: PlaylistRule): Promise<Playlist> {
    const now = Date.now()
    return this.playlists.put({ id: `pl-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name, tracks, createdAt: now, updatedAt: now, rule })
  }

  async renameList(id: string, name: string): Promise<Playlist | null> {
    const held = await this.list(id)
    if (!held) return null
    return this.playlists.put({ ...held, name, updatedAt: Date.now() })
  }

  /** Deleting a playlist never deletes the songs in it: it held references, not copies. */
  removeList(id: string): Promise<boolean> {
    return this.playlists.remove(id)
  }

  async addToList(id: string, trackIds: string[]): Promise<Playlist | null> {
    const held = await this.list(id)
    if (!held) return null
    const known = new Set((await this.all()).map((track) => track.id))
    const adding = trackIds.filter((trackId) => known.has(trackId) && !held.tracks.includes(trackId))
    if (adding.length === 0) return held
    return this.playlists.put({ ...held, tracks: [...held.tracks, ...adding], updatedAt: Date.now() })
  }

  /**
   * The whole list at once, in the order given.
   *
   * What a merge needs: `addToList` can only append, and a merge may reorder, interleave or replace. Unknown ids
   * are dropped rather than stored, so a playlist can never come to point at a track that is not there, and
   * repeats are dropped because a playlist holds references and listing one twice has no meaning here.
   */
  async setListTracks(id: string, trackIds: readonly string[]): Promise<Playlist | null> {
    const held = await this.list(id)
    if (!held) return null
    const known = new Set((await this.all()).map((track) => track.id))
    const seen = new Set<string>()
    const tracks: string[] = []
    for (const trackId of trackIds) {
      if (!known.has(trackId) || seen.has(trackId)) continue
      seen.add(trackId)
      tracks.push(trackId)
    }
    return this.playlists.put({ ...held, tracks, updatedAt: Date.now() })
  }

  async removeFromList(id: string, trackId: string): Promise<Playlist | null> {
    const held = await this.list(id)
    if (!held) return null
    return this.playlists.put({ ...held, tracks: held.tracks.filter((t) => t !== trackId), updatedAt: Date.now() })
  }

  async reorderList(id: string, from: number, to: number): Promise<Playlist | null> {
    const held = await this.list(id)
    if (!held || from < 0 || from >= held.tracks.length || to < 0 || to >= held.tracks.length) return held
    const tracks = [...held.tracks]
    const [moved] = tracks.splice(from, 1)
    tracks.splice(to, 0, moved)
    return this.playlists.put({ ...held, tracks, updatedAt: Date.now() })
  }

  /** The tracks in a playlist, in its order. A worked-out playlist asks the library instead. */
  async listTracks(id: string, now = Date.now()): Promise<OrbisTrack[]> {
    const held = await this.list(id)
    if (!held) return []
    const library = await this.all()
    if (held.rule) return tracksForRule(held.rule, library, now)
    const byId = new Map(library.map((track) => [track.id, track]))
    return held.tracks.map((trackId) => byId.get(trackId)).filter((track): track is OrbisTrack => Boolean(track))
  }

  // ---------------------------------------------------------------- what was played, and what was noticed

  /** Records a listen, and counts it. Only called once the player says enough of the track went by. */
  async recordPlay(trackId: string, seconds: number, now = Date.now()): Promise<void> {
    const held = await this.track(trackId)
    if (!held) return
    await this.history.put({ id: `h-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, trackId, at: now, seconds: Math.round(seconds) })
    await this.tracks.put({ ...held, lastPlayedAt: now, playCount: (held.playCount ?? 0) + 1 })
  }

  played(): Promise<Played[]> {
    return this.history.all()
  }

  /** The tracks listened to most recently, each once, newest first. */
  async recentlyPlayed(limit = 50): Promise<OrbisTrack[]> {
    const [played, library] = await Promise.all([this.played(), this.all()])
    const byId = new Map(library.map((track) => [track.id, track]))
    const seen = new Set<string>()
    const out: OrbisTrack[] = []
    for (const one of [...played].sort((a, b) => b.at - a.at)) {
      if (seen.has(one.trackId)) continue
      seen.add(one.trackId)
      const track = byId.get(one.trackId)
      if (track) out.push(track)
      if (out.length >= limit) break
    }
    return out
  }

  clearHistory(): Promise<Played[]> {
    return this.history.replace([])
  }

  /** Remembers where a track got to, so it can be carried on from. */
  async rememberPosition(trackId: string, position: number): Promise<void> {
    const held = await this.track(trackId)
    if (!held) return
    await this.tracks.put({ ...held, position: Math.round(position) })
  }

  async noteRecognised(one: Omit<Recognised, 'id'>): Promise<Recognised> {
    const all = await this.recognised.all()
    // The same song noticed again is not a second sighting.
    const same = all.find((other) => other.title.toLowerCase() === one.title.toLowerCase() && other.artist.toLowerCase() === one.artist.toLowerCase())
    if (same) return this.recognised.put({ ...same, at: one.at, provider: one.provider, url: one.url })
    return this.recognised.put({ ...one, id: `r-${one.at.toString(36)}-${Math.random().toString(36).slice(2, 6)}` })
  }

  recognisedList(): Promise<Recognised[]> {
    return this.recognised.all()
  }

  clearRecognised(): Promise<Recognised[]> {
    return this.recognised.replace([])
  }

  // ---------------------------------------------------------------- settings

  /**
   * What Orbis has learned, or null when it has not learned anything yet.
   *
   * The stored version is checked. Something written by a newer Orbis is ignored rather than half-read:
   * starting again from nothing is recoverable, and believing a shape that has changed is not.
   */
  async intelligence<T>(): Promise<T | null> {
    const held = await this.brainFile.read()
    if (!held || typeof held !== 'object') return null
    if (typeof held.version !== 'number' || held.version > MUSIC_SCHEMA) return null
    return held as T
  }

  async saveIntelligence(state: unknown): Promise<void> {
    await this.brainFile.write(state as Record<string, unknown>)
  }

  /** Forgets everything Orbis has learned about this profile. The library and the files are untouched. */
  async forgetIntelligence(): Promise<void> {
    await this.brainFile.write(null)
  }

  settings(): Promise<MusicSettings> {
    return this.settingsFile.read()
  }

  async saveSettings(patch: Partial<MusicSettings>): Promise<MusicSettings> {
    const next = normalizeSettings({ ...(await this.settings()), ...patch })
    await this.settingsFile.write(next)
    this.changed()
    return next
  }

  // ---------------------------------------------------------------- the shape of the library, for a panel

  async summary(): Promise<{ tracks: number; offline: number; missing: number; reference: number; playlists: number; favourites: number }> {
    const [library, lists] = await Promise.all([this.all(), this.lists()])
    return {
      tracks: library.length,
      offline: library.filter(playableOffline).length,
      missing: library.filter((track) => track.availability === 'missing').length,
      reference: library.filter((track) => track.availability === 'reference').length,
      playlists: lists.length,
      favourites: library.filter((track) => track.favourite).length
    }
  }

  /** Writes everything pending now. Called on the way out, where there is no time for a timer. */
  async flush(): Promise<void> {
    await Promise.all([this.tracks.flush(), this.playlists.flush(), this.history.flush(), this.recognised.flush(), this.settingsFile.flush(), this.brainFile.flush()])
  }

  /** Makes sure the artwork folder is there before anything writes into it. */
  async prepare(): Promise<void> {
    await fs.mkdir(this.artworkFolder(), { recursive: true }).catch(() => undefined)
  }
}
