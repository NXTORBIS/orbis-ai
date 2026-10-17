/**
 * The thinking behind Your music -- the library screen of the full-tab Orbis Music page.
 *
 * The screen itself is a browser tab and cannot be tested without a screen, so everything in it that is a decision
 * rather than a drawing lives here: which of the five lists is showing, which songs a filter chip keeps, how a list
 * of albums is put in order, how many rows have been scrolled to so far, and the words for a date, a play count and
 * a group's second line. Plain values in, plain values out, checked by `libraryShelf.test.ts` with no browser and no
 * disk.
 *
 * Two rules run through all of it, both carried from the rest of Orbis Music.
 *
 * Nothing here invents a value. A length nobody knows is a dash and never 0:00; an album with no year shows no year
 * rather than a likely one; a group's total length is the sum of the lengths that are actually known, and it says so
 * by leaving out the ones that are not. Every number a person reads on the screen comes off a field the music
 * service really filled in -- addedAt, playCount, duration, availability -- and there is no field here that the
 * library does not have.
 *
 * And a track with no audio on this computer is still a song. It is listed, it is sorted with the rest, it keeps its
 * favourite heart -- it simply cannot be played, and the screen says which of the three reasons it is. Hiding it
 * would be the easy way out and would quietly lose the half of somebody's library that Orbis only knows by name.
 */

import type { Grouped, OrbisTrack, SortBy } from '../music.ts'

// ---------------------------------------------------------------- which of the five lists is showing

/**
 * The five lists Your music can be showing.
 *
 * Carried in the address, as the thing the library screen is about, so the browser's own back button steps between
 * Albums and Songs the way it would between two pages. That is also why the names are the words in the address and
 * not an index: an address somebody has bookmarked still means the same list a year later.
 */
export type LibraryView = 'songs' | 'albums' | 'artists' | 'genres' | 'playlists'

export interface LibraryViewEntry {
  readonly view: LibraryView
  readonly label: string
}

export const LIBRARY_VIEWS: readonly LibraryViewEntry[] = Object.freeze([
  { view: 'songs', label: 'Songs' },
  { view: 'albums', label: 'Albums' },
  { view: 'artists', label: 'Artists' },
  { view: 'genres', label: 'Genres' },
  { view: 'playlists', label: 'Playlists' }
])

/** Reads a list name out of an address or out of the stored preference. Anything unreadable is Songs. */
export const libraryView = (value: unknown): LibraryView =>
  LIBRARY_VIEWS.some((one) => one.view === value) ? (value as LibraryView) : 'songs'

/** True for the lists drawn as groups of songs rather than as one table of songs. */
export const isGroupView = (view: LibraryView): boolean => view !== 'songs'

// ---------------------------------------------------------------- the filter chips

/**
 * What a filter chip keeps.
 *
 * Three of these are about whether Orbis has the audio, which is the distinction the whole of Orbis Music is built
 * around: a song with a file here, a song Orbis knows only by name, and a song whose file has moved. They are
 * separate chips rather than one "playable" switch because the three want different things done about them -- the
 * second wants a copy importing and the third wants pointing at again -- and a single switch would hide that.
 */
export type LibraryKeep = 'all' | 'favourites' | 'here' | 'reference' | 'missing'

export interface LibraryKeepEntry {
  readonly keep: LibraryKeep
  readonly label: string
  /** The longer words, for the chip's own tooltip. */
  readonly detail: string
}

export const LIBRARY_KEEPS: readonly LibraryKeepEntry[] = Object.freeze([
  { keep: 'all', label: 'Everything', detail: 'Every song in your library.' },
  { keep: 'favourites', label: 'Favourites', detail: 'The songs you have marked with a heart.' },
  { keep: 'here', label: 'On this computer', detail: 'Songs Orbis has the audio for and can play.' },
  { keep: 'reference', label: 'Only a reference', detail: 'Songs Orbis knows by name with no audio on this computer.' },
  { keep: 'missing', label: 'File missing', detail: 'Songs whose file is not where it was.' }
])

export const libraryKeep = (value: unknown): LibraryKeep =>
  LIBRARY_KEEPS.some((one) => one.keep === value) ? (value as LibraryKeep) : 'all'

/**
 * Whether one track survives a chip.
 *
 * 'here' asks for a file as well as the label, which is the same test the rest of Orbis uses: a row claiming to be on
 * this computer with no file behind it is not playable, whatever it says about itself.
 */
export function keepsTrack(track: OrbisTrack, keep: LibraryKeep): boolean {
  switch (keep) {
    case 'favourites':
      return track.favourite === true
    case 'here':
      return track.availability === 'local' && typeof track.file === 'string' && track.file.length > 0
    case 'reference':
      return track.availability === 'reference'
    case 'missing':
      return track.availability === 'missing'
    default:
      return true
  }
}

export const keepTracks = (tracks: readonly OrbisTrack[], keep: LibraryKeep): OrbisTrack[] =>
  keep === 'all' ? [...tracks] : tracks.filter((one) => keepsTrack(one, keep))

export interface LibraryCounts {
  readonly all: number
  readonly here: number
  readonly reference: number
  readonly missing: number
  readonly favourites: number
}

/**
 * How many songs each chip would keep, counted from the library itself.
 *
 * Counted here rather than read off the player's summary because the summary counts the whole library and a chip has
 * to be honest about the list it is sitting above -- with a search typed in, "Favourites 3" has to mean three of
 * these results and not three in the whole library.
 */
export function libraryCounts(tracks: readonly OrbisTrack[]): LibraryCounts {
  let here = 0
  let reference = 0
  let missing = 0
  let favourites = 0
  for (const track of tracks) {
    if (keepsTrack(track, 'here')) here += 1
    if (track.availability === 'reference') reference += 1
    if (track.availability === 'missing') missing += 1
    if (track.favourite === true) favourites += 1
  }
  return { all: tracks.length, here, reference, missing, favourites }
}

/** How many a chip would keep, so the number beside it is the number that would appear. */
export function countForKeep(counts: LibraryCounts, keep: LibraryKeep): number {
  switch (keep) {
    case 'favourites':
      return counts.favourites
    case 'here':
      return counts.here
    case 'reference':
      return counts.reference
    case 'missing':
      return counts.missing
    default:
      return counts.all
  }
}

// ---------------------------------------------------------------- putting a list in order

export interface LibrarySortEntry {
  readonly sort: SortBy
  readonly label: string
  /** True when this order should start largest-first, which is what a person means by "most played". */
  readonly downFirst: boolean
}

/**
 * The orders offered, and the one real field behind each.
 *
 * Six of the eight orders the library understands. The two left out are deliberate: `year` is missing from most
 * files, so an order built on it would look broken rather than empty, and `played` repeats what Played lately
 * already is. Nothing here is a made-up ranking -- there is no popularity figure anywhere in Orbis Music and this
 * screen does not pretend there is one.
 */
export const LIBRARY_SORTS: readonly LibrarySortEntry[] = Object.freeze([
  { sort: 'added', label: 'Recently added', downFirst: true },
  { sort: 'title', label: 'Title', downFirst: false },
  { sort: 'artist', label: 'Artist', downFirst: false },
  { sort: 'album', label: 'Album', downFirst: false },
  { sort: 'duration', label: 'Length', downFirst: false },
  { sort: 'plays', label: 'Play count', downFirst: true }
])

export const librarySort = (value: unknown): SortBy => (LIBRARY_SORTS.some((one) => one.sort === value) ? (value as SortBy) : 'added')

/** Which way round an order starts, so Recently added gives the newest and Title gives A first. */
export const sortStartsDown = (sort: SortBy): boolean => LIBRARY_SORTS.find((one) => one.sort === sort)?.downFirst === true

/** The newest moment in a group, or 0 when every track in it is missing the field. */
function latest(group: Grouped, field: 'addedAt' | 'lastPlayedAt'): number {
  let best = 0
  for (const track of group.tracks) {
    const at = field === 'addedAt' ? track.addedAt : (track.lastPlayedAt ?? 0)
    if (typeof at === 'number' && Number.isFinite(at) && at > best) best = at
  }
  return best
}

/**
 * How long a group is, adding up only the lengths that are known.
 *
 * A group of twelve songs where two have no length is however long the other ten run to, and the count of unknowns
 * comes back alongside so the screen can say so. The alternative -- treating an unknown length as zero and calling
 * the total the group's length -- would state a figure that is wrong by however much those two songs run to.
 */
export function groupSeconds(group: Grouped): { readonly seconds: number; readonly unknown: number } {
  let seconds = 0
  let unknown = 0
  for (const track of group.tracks) {
    if (Number.isFinite(track.duration) && track.duration > 0) seconds += track.duration
    else unknown += 1
  }
  return { seconds, unknown }
}

export const groupPlays = (group: Grouped): number => group.tracks.reduce((total, one) => total + (one.playCount ?? 0), 0)

/**
 * Albums, artists and genres in order, by the same names the songs table offers.
 *
 * The music service puts songs in order itself, but it has no idea of an album as a thing -- albums are worked out
 * from the tracks every time they are asked for -- so a list of groups has to be ordered here. Each order reads a
 * field the group really has: its name, its artist, the sum of the lengths in it, the sum of the play counts, the
 * newest thing added to it.
 */
export function sortGroups(groups: readonly Grouped[], sort: SortBy, descending: boolean): Grouped[] {
  const words = (one: Grouped): string => one.name.toLowerCase()
  const by = (one: Grouped): string => (one.by ?? one.name).toLowerCase()
  const sorted = [...groups].sort((a, b) => {
    switch (sort) {
      case 'artist':
        return by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : words(a) < words(b) ? -1 : words(a) > words(b) ? 1 : 0
      case 'duration':
        return groupSeconds(a).seconds - groupSeconds(b).seconds
      case 'plays':
        return groupPlays(a) - groupPlays(b)
      case 'added':
        return latest(a, 'addedAt') - latest(b, 'addedAt')
      case 'played':
        return latest(a, 'lastPlayedAt') - latest(b, 'lastPlayedAt')
      case 'year':
        return (a.year ?? 0) - (b.year ?? 0)
      default:
        return words(a) < words(b) ? -1 : words(a) > words(b) ? 1 : 0
    }
  })
  return descending ? sorted.reverse() : sorted
}

/** A group with none of its songs left after a chip is a group that is not on this list any more. */
export function keepGroups(groups: readonly Grouped[], keep: LibraryKeep): Grouped[] {
  if (keep === 'all') return [...groups]
  const left: Grouped[] = []
  for (const group of groups) {
    const tracks = group.tracks.filter((one) => keepsTrack(one, keep))
    if (tracks.length > 0) left.push({ ...group, tracks })
  }
  return left
}

/**
 * Groups whose name or artist matches what was typed.
 *
 * The music service searches songs, not albums, so a search with the Albums list showing has to be answered here.
 * Every word has to match somewhere, which is the same rule the library's own search uses, so typing two words
 * narrows rather than widens.
 */
export function findGroups(groups: readonly Grouped[], said: string): Grouped[] {
  const words = said
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((one) => one)
  if (words.length === 0) return [...groups]
  return groups.filter((group) => {
    const flat = `${group.name} ${group.by ?? ''}`.toLowerCase()
    return words.every((word) => flat.includes(word))
  })
}

// ---------------------------------------------------------------- words a person reads

const MONTHS: readonly string[] = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])

/**
 * When a song was added, as a short date.
 *
 * A dash when there is no moment, for the same reason a length of nothing is a dash: a song that came in before Orbis
 * started writing the date down has no date, and 1 Jan 1970 is not a date anybody added anything on. The month is a
 * word so 3/4 is never read as the wrong one of two days.
 */
export function dateAddedText(at: unknown): string {
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return '—'
  const when = new Date(at)
  const month = MONTHS[when.getMonth()]
  if (!month) return '—'
  return `${when.getDate()} ${month} ${when.getFullYear()}`
}

/** A play count, as words. Nothing rather than "0 plays", because never played is the ordinary case. */
export const playsText = (count: unknown): string =>
  typeof count === 'number' && Number.isFinite(count) && count > 0 ? `${count} ${count === 1 ? 'play' : 'plays'}` : ''

/**
 * The pill on a row that cannot be played, in the words the panel has always used.
 *
 * Null for a song with audio here, which is the usual case and wants no pill at all. The three others each name the
 * real state rather than all saying "unavailable", because what to do about them differs.
 */
export function availabilityPill(track: OrbisTrack): string | null {
  if (keepsTrack(track, 'here')) return null
  switch (track.availability) {
    case 'reference':
      return 'No audio here'
    case 'missing':
      return 'File missing'
    case 'unsupported':
      return 'Cannot be played'
    default:
      return 'No audio here'
  }
}

/**
 * The second line under an album, artist or genre card.
 *
 * Built from what the group actually holds. An album names its artist and its year only when it has them; an artist
 * names how many songs and how many albums, both counted; a genre names how many songs. No line ever states
 * something that was not counted.
 */
export function groupSub(group: Grouped, view: LibraryView): string {
  const songs = `${group.tracks.length} ${group.tracks.length === 1 ? 'song' : 'songs'}`
  if (view === 'albums') {
    return [group.by, group.year ? String(group.year) : '', songs].filter((one) => one).join(' · ')
  }
  if (view === 'artists') {
    const albums = new Set(group.tracks.map((one) => one.album.trim().toLowerCase()).filter((one) => one))
    return albums.size > 0 ? `${songs} · ${albums.size} ${albums.size === 1 ? 'album' : 'albums'}` : songs
  }
  return songs
}

/** The ids of the songs in a group, in the order they are listed, for playing the whole thing. */
export const groupTrackIds = (group: Grouped): string[] => group.tracks.map((one) => one.id)

/** The ids of the songs in a group that can actually be played, which is what a play button may ask for. */
export const playableIds = (tracks: readonly OrbisTrack[]): string[] => tracks.filter((one) => keepsTrack(one, 'here')).map((one) => one.id)

// ---------------------------------------------------------------- how much of a long list is drawn

/**
 * How many rows have been scrolled into existence.
 *
 * A library may hold fifty thousand songs, and fifty thousand rows is a page that takes seconds to draw and holds
 * fifty thousand covers in memory. So the table draws a block at a time and adds another when somebody reaches the
 * bottom. This is only the arithmetic of that: how many rows there should be after so many blocks, never more than
 * there are songs.
 */
export const ROW_BLOCK = 120

export const shownRows = (total: number, blocks: number, block = ROW_BLOCK): number =>
  Math.max(0, Math.min(Math.floor(Math.max(0, total)), Math.max(1, Math.floor(blocks)) * block))

/** True when the list is scrolled near enough to its end that the next block is worth drawing. */
export const nearEnd = (scrollTop: number, viewport: number, height: number, margin = 400): boolean =>
  scrollTop + viewport + margin >= height

// ---------------------------------------------------------------- the stored preference

/**
 * The library list and the filter chip, as the one value the music service stores.
 *
 * `MusicSettings.view` has held a value for a long time and nothing has ever written it, so which list somebody was
 * last looking at has been thrown away every time. This screen drives it. The stored value runs the five lists and
 * Favourites together, which is how it was written, so the two are folded into one on the way out and unfolded on
 * the way back in -- Favourites means the songs table with the Favourites chip on.
 */
export type StoredView = 'songs' | 'albums' | 'artists' | 'genres' | 'playlists' | 'favourites'

export const storedFor = (view: LibraryView, keep: LibraryKeep): StoredView =>
  view === 'songs' && keep === 'favourites' ? 'favourites' : view

export function fromStored(stored: unknown): { readonly view: LibraryView; readonly keep: LibraryKeep } {
  if (stored === 'favourites') return { view: 'songs', keep: 'favourites' }
  return { view: libraryView(stored), keep: 'all' }
}
