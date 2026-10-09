/**
 * Orbis Music: what a track is, what may be done with one, and what Orbis is allowed to claim about it.
 *
 * Everything here is plain functions over plain data, so the rules can be tested without a browser, a file or a
 * sound card. The parts that touch the disk, the network or the speakers live elsewhere and ask these questions.
 *
 * ## The distinction the whole feature rests on
 *
 * Hearing a song is not owning it, and knowing where a song is playing is not having a copy of it. So a track is in
 * one of a few honest states, and the one that matters is `reference`: Orbis knows the name of the song and nothing
 * more. A reference track is never offered for offline play, never shows a progress bar that fills up on its own, and
 * never says "downloaded". Protected streams are not turned into files -- not by this code, not by anything that
 * calls it.
 *
 * ## Two playbacks that must never be confused
 *
 * A website's player is the website's. Orbis can see that something is playing there and can ask it to pause, because
 * the browser exposes that much, but it does not own it and does not pretend to. Orbis Music owns only the files the
 * person actually has. `PlaybackOwner` is the single answer to "whose sound is this?", and every surface reads it
 * rather than guessing.
 *
 * ## Nothing is invented
 *
 * A guessed artist is worse than no artist: it ends up in a library, gets saved, and is believed later. So every piece
 * of metadata carries where it came from and how sure Orbis is, `recognition` can answer "I do not know", and there is
 * no code path that fills a blank field with something plausible.
 */

// ---------------------------------------------------------------- a track

/** Where the audio for a track is, as far as Orbis can actually tell. */
export type Availability =
  /** A real file on this computer that Orbis has read. The only state in which offline play is offered. */
  | 'local'
  /** Known song, no file. Orbis has its name and where it was heard, and says so plainly. */
  | 'reference'
  /** There was a file and it is not where it was. The track is kept so it can be pointed at the file again. */
  | 'missing'
  /** A file that is there and that this computer cannot play. */
  | 'unsupported'

/** How the audio came to be on this computer. Kept so "why can I not play this?" always has an answer. */
export type Provenance =
  /** A file the person chose from their own computer. */
  | 'user-file'
  /** A folder the person asked Orbis to watch. */
  | 'watched-folder'
  /** A file the person downloaded themselves, from somewhere that offers downloads. */
  | 'download'
  /** No audio: recognised while browsing and kept by name. */
  | 'recognised'

/** How sure Orbis is about the name of a song. `confirmed` means a person said so. */
export type Confidence = 'low' | 'medium' | 'high' | 'confirmed'

export const CONFIDENCE_ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2, confirmed: 3 }

/** Where a name came from. Ordered best first in `METHOD_CONFIDENCE`. */
export type RecognitionMethod =
  /** The file's own tags. Nothing is more reliable than this. */
  | 'file-tags'
  /** What the page told the browser it was playing. */
  | 'media-session'
  /** Read off the screen by Orbis Vision. */
  | 'vision'
  /** The page's own description of itself: OpenGraph, JSON-LD, the title. */
  | 'page-metadata'
  /** The player's accessible labels. */
  | 'accessibility'
  /** A person typed it. */
  | 'person'

/** How much each way of finding out is worth on its own. Vision and page text can be wrong; a file's tags cannot. */
export const METHOD_CONFIDENCE: Record<RecognitionMethod, Confidence> = {
  'file-tags': 'high',
  person: 'confirmed',
  'media-session': 'high',
  vision: 'medium',
  'page-metadata': 'low',
  accessibility: 'medium'
}

export interface TrackNames {
  title: string
  artist: string
  album: string
  albumArtist?: string
  genre?: string
  year?: number
  trackNumber?: number
  discNumber?: number
}

export interface OrbisTrack extends TrackNames {
  id: string
  /** Seconds. Zero when it is not known -- never a guessed length. */
  duration: number
  availability: Availability
  provenance: Provenance
  confidence: Confidence
  /** How the names were arrived at. */
  method: RecognitionMethod
  /** The file, when there is one. Absolute, and only ever handled by the music service. */
  file?: string
  /** Size and modified time, so a file that changed underneath can be noticed. */
  fileSize?: number
  fileModified?: number
  /** Where the artwork is kept, inside the profile's own folder. Never a web address. */
  artwork?: string
  /** True when a person typed any of the names, so recognising it again must not overwrite them. */
  edited?: boolean
  /** True when a person chose the artwork. */
  artworkChosen?: boolean
  /** Where it was heard, when it was recognised while browsing. */
  source?: { provider: string; url?: string; recognisedAt: number }
  favourite?: boolean
  addedAt: number
  lastPlayedAt?: number
  playCount?: number
  /** Where playing it got to last time, in seconds. Only kept past a little way in. */
  position?: number
}

/** Only a track with a file Orbis has read may be played with no network. */
export const playableOffline = (track: OrbisTrack): boolean => track.availability === 'local' && Boolean(track.file)

/** What to tell somebody about why they cannot play this, in plain words. Null when they can. */
export function whyNotPlayable(track: OrbisTrack): string | null {
  switch (track.availability) {
    case 'local':
      return track.file ? null : 'Orbis has no file for this track.'
    case 'reference':
      return 'Orbis knows this song but has no audio for it. Import your own copy to play it here.'
    case 'missing':
      return 'The file for this track is not where it was. Point Orbis at it again to play it.'
    case 'unsupported':
      return 'This computer cannot play this kind of audio file.'
  }
}

// ---------------------------------------------------------------- telling one track from another

/** Letters, numbers and spaces only, lower case: for comparing names people have typed differently. */
export function plainly(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // The bracketed afterthoughts that make the same song look like three: (Remastered), [Official Video], (feat. X).
    .replace(/[([][^)\]]*(remaster|remastered|official|video|audio|lyrics|hd|hq|explicit|clean|mono|stereo)[^)\]]*[)\]]/g, ' ')
    .replace(/\b(feat|ft|featuring|with)\b\.?[^-]*$/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** How close two lengths are, allowing for a tag that rounds and a file that does not. */
export const sameLength = (a: number, b: number, slack = 3): boolean => a > 0 && b > 0 && Math.abs(a - b) <= slack

export interface MatchScore {
  score: number
  confidence: Confidence
  why: string[]
}

/**
 * How well a track Orbis has just heard matches a file already in the library.
 *
 * Title alone is never enough -- half the songs ever written share a title with another -- so this adds up several
 * weak signals and says how sure it is. A `low` answer is not acted on by itself: the person is asked which file they
 * meant, which is the only honest thing to do when two files both might be it.
 */
export function matchScore(heard: TrackNames & { duration?: number }, have: OrbisTrack): MatchScore {
  const why: string[] = []
  let score = 0
  const title = plainly(heard.title)
  const haveTitle = plainly(have.title)
  if (title && title === haveTitle) {
    score += 50
    why.push('the title is the same')
  } else if (title && haveTitle && (title.includes(haveTitle) || haveTitle.includes(title))) {
    score += 25
    why.push('the title is nearly the same')
  }
  const artist = plainly(heard.artist)
  const haveArtist = plainly(have.artist)
  if (artist && artist === haveArtist) {
    score += 30
    why.push('the artist is the same')
  } else if (artist && haveArtist && (artist.includes(haveArtist) || haveArtist.includes(artist))) {
    score += 15
    why.push('the artist is nearly the same')
  }
  if (plainly(heard.album ?? '') && plainly(heard.album ?? '') === plainly(have.album)) {
    score += 10
    why.push('the album is the same')
  }
  if (heard.duration && sameLength(heard.duration, have.duration)) {
    score += 20
    why.push('it is the same length')
  } else if (heard.duration && have.duration && !sameLength(heard.duration, have.duration, 10)) {
    score -= 25
    why.push('it is a different length')
  }
  const confidence: Confidence = score >= 90 ? 'high' : score >= 65 ? 'medium' : 'low'
  return { score, confidence, why }
}

/** Matches worth offering, best first. Nothing below `floor` is offered at all. */
export function bestMatches(heard: TrackNames & { duration?: number }, library: readonly OrbisTrack[], floor = 55): { track: OrbisTrack; match: MatchScore }[] {
  return library
    .map((track) => ({ track, match: matchScore(heard, track) }))
    .filter((one) => one.match.score >= floor)
    .sort((a, b) => b.match.score - a.match.score)
}

/**
 * Whether a match may be used without asking.
 *
 * One clear winner and nothing else close: use it. Two files that both look right: ask. Silently choosing between two
 * is how somebody's live recording gets linked to the studio version and they never find out why it sounds wrong.
 */
export function matchDecision(matches: readonly { track: OrbisTrack; match: MatchScore }[]): { kind: 'use'; track: OrbisTrack } | { kind: 'ask'; choices: OrbisTrack[] } | { kind: 'none' } {
  if (matches.length === 0) return { kind: 'none' }
  const [best, next] = matches
  if (best.match.score >= 90 && (!next || best.match.score - next.match.score >= 20)) return { kind: 'use', track: best.track }
  return { kind: 'ask', choices: matches.slice(0, 5).map((one) => one.track) }
}

/** Whether two library entries are the same recording: the same file, or the same names and length. */
export function sameTrack(a: OrbisTrack, b: OrbisTrack): boolean {
  if (a.id === b.id) return true
  if (a.file && b.file && a.file === b.file) return true
  if (a.fileSize && b.fileSize && a.fileSize === b.fileSize && sameLength(a.duration, b.duration, 1) && plainly(a.title) === plainly(b.title)) return true
  return plainly(a.title) === plainly(b.title) && plainly(a.artist) === plainly(b.artist) && sameLength(a.duration, b.duration)
}

/** The one already in the library that is the same recording as this, if any. */
export const existing = (track: OrbisTrack, library: readonly OrbisTrack[]): OrbisTrack | undefined => library.find((one) => sameTrack(one, track))

// ---------------------------------------------------------------- what is playing, and whose it is

/** Whose sound is coming out of the speakers. */
export type PlaybackOwner = 'website' | 'orbis-music' | 'none'

export type RepeatMode = 'off' | 'all' | 'one'

export interface PlaybackState {
  owner: PlaybackOwner
  /** The Orbis Music track playing now. Null when the website owns the sound, or nothing does. */
  trackId: string | null
  playing: boolean
  /** Seconds into the track, as the player last reported. Never worked out from a clock. */
  position: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  /** The order being played, as track ids. Shuffle reorders this, so what is next is always simply the next one. */
  queue: readonly string[]
  /** Where in `queue` the current track is. -1 when nothing is playing. */
  at: number
}

export const NOTHING_PLAYING: PlaybackState = Object.freeze({
  owner: 'none',
  trackId: null,
  playing: false,
  position: 0,
  duration: 0,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'off',
  queue: Object.freeze([]) as readonly string[],
  at: -1
})

/**
 * A real shuffle: every order equally likely, and the track playing now stays where it is.
 *
 * `sort(() => Math.random() - 0.5)` is the usual mistake and is not a shuffle at all -- it is biased, and with some
 * sort implementations it barely moves anything. This is Fisher-Yates, with the randomness handed in so a test can
 * pin it down.
 */
export function shuffled(ids: readonly string[], keepFirst: string | null, random: () => number = Math.random): string[] {
  const rest = ids.filter((id) => id !== keepFirst)
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return keepFirst === null ? rest : [keepFirst, ...rest]
}

/** The track after this one, by the queue and the repeat setting. Null when there is nothing after it. */
export function nextInQueue(state: PlaybackState, finished = false): string | null {
  if (state.queue.length === 0) return null
  if (state.repeat === 'one' && finished) return state.trackId
  const at = state.at
  if (at + 1 < state.queue.length) return state.queue[at + 1]
  return state.repeat === 'all' ? state.queue[0] : null
}

/** The track before this one. Repeating all wraps round to the end; otherwise the first track stays put. */
export function previousInQueue(state: PlaybackState): string | null {
  if (state.queue.length === 0) return null
  if (state.at > 0) return state.queue[state.at - 1]
  return state.repeat === 'all' ? state.queue[state.queue.length - 1] : state.queue[0] ?? null
}

/** How far in before playing it counts as having been played. Stops a second of a preview adding to a play count. */
export const COUNTS_AS_PLAYED = 0.5
export const COUNTS_AS_PLAYED_SECONDS = 20

/** Whether listening this far counts as a play. Half of it, or twenty seconds, whichever comes first. */
export function countsAsPlayed(position: number, duration: number): boolean {
  if (duration <= 0) return position >= COUNTS_AS_PLAYED_SECONDS
  return position >= Math.min(duration * COUNTS_AS_PLAYED, COUNTS_AS_PLAYED_SECONDS)
}

/** Whether where somebody got to is worth remembering. Not the first seconds, and not the end. */
export function worthResuming(position: number, duration: number): boolean {
  if (duration <= 0 || position <= 15) return false
  return position < duration - 20
}

// ---------------------------------------------------------------- the queue

export interface QueueChange {
  queue: string[]
  at: number
}

/** Puts tracks straight after the one playing, so "play this next" means next and not last. */
export function playNext(state: PlaybackState, ids: readonly string[]): QueueChange {
  const without = state.queue.filter((id) => !ids.includes(id))
  const at = state.trackId ? without.indexOf(state.trackId) : -1
  const queue = [...without.slice(0, at + 1), ...ids, ...without.slice(at + 1)]
  return { queue, at: state.trackId ? queue.indexOf(state.trackId) : state.at }
}

/** Puts tracks at the end. Anything already in the queue is moved rather than repeated. */
export function addToQueue(state: PlaybackState, ids: readonly string[]): QueueChange {
  const without = state.queue.filter((id) => !ids.includes(id))
  const queue = [...without, ...ids]
  return { queue, at: state.trackId ? queue.indexOf(state.trackId) : state.at }
}

/** Takes one out. Taking out the one playing leaves the position on whatever moved into its place. */
export function removeFromQueue(state: PlaybackState, index: number): QueueChange {
  if (index < 0 || index >= state.queue.length) return { queue: [...state.queue], at: state.at }
  const queue = [...state.queue.slice(0, index), ...state.queue.slice(index + 1)]
  const at = index < state.at ? state.at - 1 : Math.min(state.at, queue.length - 1)
  return { queue, at }
}

/** Moves one. The track playing stays the track playing, wherever it ends up. */
export function reorderQueue(state: PlaybackState, from: number, to: number): QueueChange {
  if (from < 0 || from >= state.queue.length || to < 0 || to >= state.queue.length) return { queue: [...state.queue], at: state.at }
  const queue = [...state.queue]
  const [moved] = queue.splice(from, 1)
  queue.splice(to, 0, moved)
  return { queue, at: state.trackId ? queue.indexOf(state.trackId) : state.at }
}

// ---------------------------------------------------------------- playlists

export interface Playlist {
  id: string
  name: string
  /** Track ids, in the order chosen. Tracks are referred to, never copied: deleting a playlist keeps the songs. */
  tracks: string[]
  createdAt: number
  updatedAt: number
  /** A playlist worked out from the library rather than listed by hand. */
  rule?: PlaylistRule
}

/** A playlist that answers a question about the library, re-asked every time it is opened. */
export interface PlaylistRule {
  favourite?: boolean
  artist?: string
  album?: string
  genre?: string
  yearFrom?: number
  yearTo?: number
  addedWithinDays?: number
  playedWithinDays?: number
  availableOffline?: boolean
  /** Most played, most recent, or the order they were added. */
  order?: 'plays' | 'recent' | 'added' | 'title'
  limit?: number
}

/** The tracks a rule describes, now. Nothing is stored: a rule is a question, not a list. */
export function tracksForRule(rule: PlaylistRule, library: readonly OrbisTrack[], now: number): OrbisTrack[] {
  const day = 24 * 60 * 60 * 1000
  let out = library.filter((track) => {
    if (rule.favourite && !track.favourite) return false
    if (rule.availableOffline && !playableOffline(track)) return false
    if (rule.artist && plainly(track.artist) !== plainly(rule.artist)) return false
    if (rule.album && plainly(track.album) !== plainly(rule.album)) return false
    if (rule.genre && plainly(track.genre ?? '') !== plainly(rule.genre)) return false
    if (rule.yearFrom !== undefined && (track.year ?? 0) < rule.yearFrom) return false
    if (rule.yearTo !== undefined && (track.year ?? 0) > rule.yearTo) return false
    if (rule.addedWithinDays !== undefined && track.addedAt < now - rule.addedWithinDays * day) return false
    if (rule.playedWithinDays !== undefined && (track.lastPlayedAt ?? 0) < now - rule.playedWithinDays * day) return false
    return true
  })
  const order = rule.order ?? 'added'
  out = [...out].sort((a, b) => {
    if (order === 'plays') return (b.playCount ?? 0) - (a.playCount ?? 0)
    if (order === 'recent') return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
    if (order === 'title') return a.title.localeCompare(b.title)
    return b.addedAt - a.addedAt
  })
  return rule.limit ? out.slice(0, rule.limit) : out
}

// ---------------------------------------------------------------- looking through a library

export type SortBy = 'title' | 'artist' | 'album' | 'added' | 'played' | 'plays' | 'duration' | 'year'

export interface LibraryQuery {
  search?: string
  favourite?: boolean
  offlineOnly?: boolean
  missingOnly?: boolean
  artist?: string
  album?: string
  genre?: string
  sort?: SortBy
  descending?: boolean
}

/** Searches the words a person would search by. Nothing here reads a file; it is all the stored names. */
export function searchLibrary(library: readonly OrbisTrack[], query: LibraryQuery): OrbisTrack[] {
  const words = plainly(query.search ?? '')
    .split(' ')
    .filter(Boolean)
  const found = library.filter((track) => {
    if (query.favourite && !track.favourite) return false
    if (query.offlineOnly && !playableOffline(track)) return false
    if (query.missingOnly && track.availability !== 'missing') return false
    if (query.artist && plainly(track.artist) !== plainly(query.artist)) return false
    if (query.album && plainly(track.album) !== plainly(query.album)) return false
    if (query.genre && plainly(track.genre ?? '') !== plainly(query.genre)) return false
    if (words.length === 0) return true
    const haystack = plainly([track.title, track.artist, track.album, track.albumArtist, track.genre].filter(Boolean).join(' '))
    return words.every((word) => haystack.includes(word))
  })
  const sort = query.sort ?? 'added'
  const sorted = [...found].sort((a, b) => {
    switch (sort) {
      case 'title':
        return a.title.localeCompare(b.title)
      case 'artist':
        return a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
      case 'album':
        return a.album.localeCompare(b.album) || (a.discNumber ?? 0) - (b.discNumber ?? 0) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
      case 'played':
        return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
      case 'plays':
        return (b.playCount ?? 0) - (a.playCount ?? 0)
      case 'duration':
        return a.duration - b.duration
      case 'year':
        return (a.year ?? 0) - (b.year ?? 0)
      default:
        return b.addedAt - a.addedAt
    }
  })
  return query.descending ? sorted.reverse() : sorted
}

export interface Grouped {
  name: string
  /** The artist of an album, or the album count for an artist. Only ever worked out from the tracks themselves. */
  by?: string
  tracks: OrbisTrack[]
  artwork?: string
  year?: number
}

/** Albums, from the tracks. An album with no name is "Unknown album" -- not a guess at what it might be. */
export function albums(library: readonly OrbisTrack[]): Grouped[] {
  const byKey = new Map<string, Grouped>()
  for (const track of library) {
    const name = track.album.trim() || 'Unknown album'
    const by = (track.albumArtist ?? track.artist).trim() || 'Unknown artist'
    const key = `${plainly(name)}|${plainly(by)}`
    const held = byKey.get(key)
    if (held) {
      held.tracks.push(track)
      held.artwork ??= track.artwork
      held.year ??= track.year
    } else {
      byKey.set(key, { name, by, tracks: [track], artwork: track.artwork, year: track.year })
    }
  }
  for (const group of byKey.values()) {
    group.tracks.sort((a, b) => (a.discNumber ?? 0) - (b.discNumber ?? 0) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0) || a.title.localeCompare(b.title))
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Artists, from the tracks. */
export function artists(library: readonly OrbisTrack[]): Grouped[] {
  const byKey = new Map<string, Grouped>()
  for (const track of library) {
    const name = track.artist.trim() || 'Unknown artist'
    const key = plainly(name)
    const held = byKey.get(key)
    if (held) {
      held.tracks.push(track)
      held.artwork ??= track.artwork
    } else byKey.set(key, { name, tracks: [track], artwork: track.artwork })
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Genres, from the tracks. A track with no genre is in "Unknown", because Orbis does not decide what music is. */
export function genres(library: readonly OrbisTrack[]): Grouped[] {
  const byKey = new Map<string, Grouped>()
  for (const track of library) {
    const name = (track.genre ?? '').trim() || 'Unknown'
    const key = plainly(name)
    const held = byKey.get(key)
    if (held) held.tracks.push(track)
    else byKey.set(key, { name, tracks: [track] })
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------- what Orbis heard while browsing

/** A piece of sound the browser can see, before anybody has worked out what it is. */
export interface MediaSighting {
  sourceId: string
  tabId?: string
  provider: string
  url?: string
  playing: boolean
  duration: number
  position: number
  /** What the page itself said it was playing, when it said anything. */
  session?: Partial<TrackNames> & { artwork?: string }
  /** The page's title, as a last resort for working out what is playing. */
  pageTitle?: string
}

export interface Recognition {
  sourceId: string
  names: TrackNames | null
  confidence: Confidence
  method: RecognitionMethod | null
  at: number
  /** What Orbis could not do, when it could not. Shown as it is; never dressed up as an answer. */
  why?: string
}

/** Names worth believing: a title and an artist, neither of them something a player writes when it has nothing. */
export function namesUsable(names: Partial<TrackNames> | null | undefined): names is TrackNames {
  if (!names) return false
  const title = (names.title ?? '').trim()
  const artist = (names.artist ?? '').trim()
  if (title.length < 2 || title.length > 200) return false
  // The placeholders players actually use. Taking these as a song name is how a library fills up with "Untitled".
  if (/^(untitled|unknown|audio|video|track|advertisement|ad|loading|now playing|live)$/i.test(title)) return false
  if (artist.length > 200) return false
  return true
}

/**
 * What a sighting is, from what the page has already said -- no screen, no network.
 *
 * Only the page's own Media Session is trusted here. A page title is a sentence somebody wrote, so "Song - Artist"
 * split out of one is offered at low confidence and nothing more; it is a hint for Vision to confirm, not an answer.
 */
export function fromSighting(sighting: MediaSighting, now: number): Recognition {
  const session = sighting.session
  if (namesUsable(session)) {
    return {
      sourceId: sighting.sourceId,
      names: { title: session.title.trim(), artist: (session.artist ?? '').trim(), album: (session.album ?? '').trim() },
      confidence: (session.artist ?? '').trim() ? 'high' : 'medium',
      method: 'media-session',
      at: now
    }
  }
  const split = splitPageTitle(sighting.pageTitle ?? '')
  if (split) {
    return { sourceId: sighting.sourceId, names: split, confidence: 'low', method: 'page-metadata', at: now }
  }
  return { sourceId: sighting.sourceId, names: null, confidence: 'low', method: null, at: now, why: 'This page does not say what it is playing.' }
}

/**
 * "Artist - Song" out of a page title, when it really looks like one.
 *
 * Kept deliberately strict. A title is prose, and reading a song out of prose produces exactly the invented metadata
 * this feature is not allowed to produce -- so anything with no separator, or too long, or that reads like a sentence,
 * gets nothing rather than a guess.
 */
export function splitPageTitle(title: string): TrackNames | null {
  const cleaned = title
    .replace(/\s*[-|–—]\s*(youtube|spotify|soundcloud|apple music|amazon music|bandcamp)\s*$/i, '')
    .replace(/\s*\([^)]*(official|video|audio|lyrics|remaster)[^)]*\)\s*/gi, ' ')
    .trim()
  if (cleaned.length < 5 || cleaned.length > 160) return null
  const parts = cleaned.split(/\s+[-–—]\s+/)
  if (parts.length !== 2) return null
  const [left, right] = parts.map((part) => part.trim())
  if (!left || !right || left.length > 90 || right.length > 90) return null
  // A sentence is not a song title. Several words with a full stop in them is prose.
  if (/[.!?]\s/.test(cleaned)) return null
  return { title: right, artist: left, album: '' }
}

/** Whether what is on screen has changed enough to be worth looking at again. */
export function worthRecognising(sighting: MediaSighting, last: Recognition | null, now: number, staleAfterMs = 10 * 60 * 1000): boolean {
  if (!sighting.playing) return false
  if (!last) return true
  if (last.sourceId !== sighting.sourceId) return true
  if (last.names === null) return now - last.at > 30_000
  return now - last.at > staleAfterMs
}

/** The identity of a sighting for the recognition cache: the same sound, named the same way, is the same question. */
export function recognitionKey(sighting: MediaSighting): string {
  const session = sighting.session
  const named = namesUsable(session) ? `${plainly(session.title)}|${plainly(session.artist ?? '')}` : ''
  return [sighting.provider, named || plainly(sighting.pageTitle ?? ''), Math.round(sighting.duration)].join('::')
}

/**
 * Which of several sounds is the one a person means.
 *
 * Playing beats paused, then the tab in front, then the one that started most recently. A person who has explicitly
 * picked one keeps it until it stops: overruling somebody's own choice because another tab started an advert is the
 * sort of thing that makes a feature feel broken.
 */
export function activeSighting(sightings: readonly MediaSighting[], chosen: string | null, activeTabId?: string): MediaSighting | null {
  if (sightings.length === 0) return null
  const picked = chosen ? sightings.find((one) => one.sourceId === chosen) : undefined
  if (picked && picked.playing) return picked
  const playing = sightings.filter((one) => one.playing)
  const pool = playing.length > 0 ? playing : sightings
  const inFront = activeTabId ? pool.find((one) => one.tabId === activeTabId) : undefined
  return inFront ?? pool[0]
}

// ---------------------------------------------------------------- adding what was heard

/** What happened when somebody asked Orbis to keep a song. Each outcome says exactly what Orbis did. */
export type AddOutcome =
  | { kind: 'already'; track: OrbisTrack }
  | { kind: 'linked'; track: OrbisTrack }
  | { kind: 'ask'; choices: OrbisTrack[] }
  | { kind: 'reference'; track: OrbisTrack }
  | { kind: 'refused'; why: string }

/**
 * Keeping a recognised song, without ever claiming more than is true.
 *
 * There are only three honest endings. The person already has the file, so it is linked. The person has something that
 * might be the file, so they are asked which. Or the person has no copy at all, and Orbis keeps the name and says
 * plainly that there is no audio -- it does not fetch a protected stream, and it does not show a progress bar for a
 * download that is not happening.
 */
export function addRecognised(
  names: TrackNames,
  heardDuration: number,
  library: readonly OrbisTrack[],
  source: { provider: string; url?: string },
  now: number,
  newId: () => string
): AddOutcome {
  if (!namesUsable(names)) return { kind: 'refused', why: 'Orbis could not identify this track well enough to keep it.' }
  const matches = bestMatches({ ...names, duration: heardDuration }, library)
  const already = matches.find((one) => one.match.score >= 90 && one.track.availability !== 'reference')
  const decision = matchDecision(matches)
  if (decision.kind === 'use') {
    return { kind: already ? 'already' : 'linked', track: decision.track }
  }
  if (decision.kind === 'ask') return { kind: 'ask', choices: decision.choices }
  return {
    kind: 'reference',
    track: {
      id: newId(),
      title: names.title.trim(),
      artist: names.artist.trim(),
      album: (names.album ?? '').trim(),
      duration: heardDuration > 0 ? Math.round(heardDuration) : 0,
      availability: 'reference',
      provenance: 'recognised',
      confidence: 'medium',
      method: 'media-session',
      source: { provider: source.provider, url: source.url, recognisedAt: now },
      addedAt: now
    }
  }
}

// ---------------------------------------------------------------- what the buttons may say

/** The states the one Music button in the browser can honestly be in. */
export type ButtonState = 'idle' | 'detected' | 'recognising' | 'recognised' | 'in-library' | 'playing' | 'paused' | 'importing' | 'failed'

export function buttonLabel(state: ButtonState, names: TrackNames | null): string {
  switch (state) {
    case 'playing':
    case 'paused':
      return names ? `${names.title} — ${names.artist}`.trim() : 'Music'
    case 'detected':
      return 'Music playing'
    case 'recognising':
      return 'Listening…'
    case 'recognised':
      return names ? `${names.title} — ${names.artist}`.trim() : 'Music'
    case 'in-library':
      return names ? `In your music: ${names.title}` : 'In your music'
    case 'importing':
      return 'Adding…'
    case 'failed':
      return 'Music'
    default:
      return 'Music'
  }
}

/** What the add button says, from what the library actually holds. Never "Added" before the library says so. */
export function addLabel(outcome: AddOutcome | null, inLibrary: boolean): string {
  if (inLibrary) return 'In your music'
  if (!outcome) return 'Add to Orbis Music'
  switch (outcome.kind) {
    case 'already':
      return 'In your music'
    case 'linked':
      return 'Added — your copy'
    case 'reference':
      return 'Saved by name'
    case 'ask':
      return 'Which file is it?'
    case 'refused':
      return 'Could not add it'
  }
}
