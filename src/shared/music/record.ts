/**
 * The facts about an album and about an artist, worked out from the tracks themselves.
 *
 * There is no album record and no artist record anywhere in Orbis Music. An album is whatever a set of files agree
 * they belong to, and an artist is whatever those files say made them, so every number on an album or artist screen
 * has to be counted here from the rows. That is also why this file refuses so much: a year nobody wrote into a file
 * is missing rather than guessed, a total length is only stated when every track on the record has one, and a "most
 * played" list only exists once something has really been played.
 *
 * It is here, beside the rest of the music logic, because none of it needs a screen or a disk and all of it is worth
 * testing without either.
 */

import type { Grouped, OrbisTrack } from '../music.ts'
import { plainly } from '../music.ts'

/**
 * The separator inside an address that names one album.
 *
 * An album is only an album because of its name *and* who made it -- two different bands can both have a record
 * called "Home" -- so the address has to carry both. A unit separator is used rather than a slash or a bar because
 * those turn up in real album names, and a name that splits itself would send somebody to the wrong record.
 */
const BETWEEN = '\u001f'

/** The address piece that names one album: its own name, then whose it is. */
export const albumKey = (name: string, by: string): string => `${name}${BETWEEN}${by}`

/** Reads that address piece back. An address with no separator in it is taken as an album name on its own. */
export function readAlbumKey(key: string): { readonly name: string; readonly by: string } {
  const at = key.indexOf(BETWEEN)
  if (at < 0) return { name: key.trim(), by: '' }
  return { name: key.slice(0, at).trim(), by: key.slice(at + BETWEEN.length).trim() }
}

/**
 * True when this grouped album is the one an address is asking for.
 *
 * Compared the forgiving way names are compared everywhere else in Orbis Music, because the address may have been
 * typed by hand or copied out of an older version of the page. An address naming only the album matches on the name
 * alone, which is what makes a link from a search result work before anybody knows whose record it is.
 */
export function isAlbum(group: Pick<Grouped, 'name' | 'by'>, key: string): boolean {
  const wanted = readAlbumKey(key)
  if (plainly(group.name) !== plainly(wanted.name)) return false
  if (wanted.by === '') return true
  return plainly(group.by ?? '') === plainly(wanted.by)
}

/** True when this artist is the one an address is asking for. */
export const isArtist = (name: string, key: string): boolean => plainly(name) === plainly(key.trim())

export interface RecordFacts {
  /** How many tracks are on it. */
  readonly tracks: number
  /** The total length in seconds, or null when any track on it has no known length. */
  readonly seconds: number | null
  /** The year, when the files agree on one. Null when none of them says, and null when they disagree. */
  readonly year: number | null
  /** How many of these tracks have audio on this computer. */
  readonly playable: number
  /** The ids of the tracks that can be played, in the order they are listed. */
  readonly playableIds: readonly string[]
}

const hasFile = (track: OrbisTrack): boolean => track.availability === 'local' && typeof track.file === 'string' && track.file !== ''

/**
 * Counts up a set of tracks.
 *
 * The total length is null the moment one track has no length, rather than being the sum of the ones that do. A
 * record whose last track is a song Orbis only knows by name would otherwise read as shorter than it is, and a
 * number that is quietly wrong is worse than no number.
 */
export function factsOf(tracks: readonly OrbisTrack[]): RecordFacts {
  let seconds = 0
  let anyUnknown = false
  const years = new Set<number>()
  const playableIds: string[] = []
  for (const track of tracks) {
    if (Number.isFinite(track.duration) && track.duration > 0) seconds += track.duration
    else anyUnknown = true
    if (typeof track.year === 'number' && Number.isFinite(track.year)) years.add(track.year)
    if (hasFile(track)) playableIds.push(track.id)
  }
  return {
    tracks: tracks.length,
    seconds: anyUnknown || tracks.length === 0 ? null : seconds,
    year: years.size === 1 ? [...years][0] : null,
    playable: playableIds.length,
    playableIds
  }
}

/**
 * The tracks of one artist that have really been played, most played first.
 *
 * Only tracks with a play count above nothing. Orbis counts a play when enough of a track has actually gone by, so a
 * count is a measurement; filling this list up with never-played tracks to make it look like a top ten would turn
 * that measurement into decoration. A tie is settled by which was played most recently, then by title, so the order
 * is the same every time the screen is drawn.
 */
export function mostPlayed(tracks: readonly OrbisTrack[], limit = 5): readonly OrbisTrack[] {
  const played = tracks.filter((track) => typeof track.playCount === 'number' && track.playCount > 0)
  const sorted = [...played].sort(
    (a, b) => (b.playCount ?? 0) - (a.playCount ?? 0) || (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || a.title.localeCompare(b.title)
  )
  return sorted.slice(0, Math.max(0, limit))
}

/**
 * The albums an artist's tracks belong to, newest first and then by name.
 *
 * Grouped on the album name alone, not on the album artist as the library's own grouping does: these tracks are
 * already known to be this artist's, and splitting them again by credit would show one record twice because a guest
 * is named on two of its tracks.
 */
export function albumsOf(tracks: readonly OrbisTrack[]): readonly Grouped[] {
  const byKey = new Map<string, { name: string; by: string; tracks: OrbisTrack[]; year?: number }>()
  for (const track of tracks) {
    const name = track.album.trim() || 'Unknown album'
    const key = plainly(name)
    const held = byKey.get(key)
    if (held) {
      held.tracks.push(track)
      held.year ??= track.year
    } else byKey.set(key, { name, by: (track.albumArtist ?? track.artist).trim(), tracks: [track], year: track.year })
  }
  const groups = [...byKey.values()]
  for (const group of groups) {
    group.tracks.sort((a, b) => (a.discNumber ?? 0) - (b.discNumber ?? 0) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0) || a.title.localeCompare(b.title))
  }
  return groups.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name))
}

/** The genres these tracks name, most common first. Only what the files say; nothing is decided about the music. */
export function genresOf(tracks: readonly OrbisTrack[], limit = 4): readonly string[] {
  const counts = new Map<string, { name: string; count: number }>()
  for (const track of tracks) {
    const name = (track.genre ?? '').trim()
    if (name === '') continue
    const key = plainly(name)
    const held = counts.get(key)
    if (held) held.count += 1
    else counts.set(key, { name, count: 1 })
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit))
    .map((one) => one.name)
}

/**
 * The years an artist's music spans, as words, or an empty string when the files do not say.
 *
 * One year when everything is from one year, two with a dash between when it spans several. Nothing at all when no
 * file carries a year, because "Unknown" in the place a date goes reads as part of the record's name.
 */
export function yearsText(tracks: readonly OrbisTrack[]): string {
  const years = tracks.map((track) => track.year).filter((year): year is number => typeof year === 'number' && Number.isFinite(year))
  if (years.length === 0) return ''
  const low = Math.min(...years)
  const high = Math.max(...years)
  return low === high ? String(low) : `${low}–${high}`
}

/** The track whose cover should stand for a whole record: the first one that has one, else the first track. */
export function faceOf(tracks: readonly OrbisTrack[]): OrbisTrack | null {
  if (tracks.length === 0) return null
  return tracks.find((track) => typeof track.artwork === 'string' && track.artwork !== '') ?? tracks[0]
}
