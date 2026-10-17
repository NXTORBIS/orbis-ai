/**
 * The figures behind "your listening", and the words for a few things the Orbis-only screens have to say.
 *
 * These screens -- what Orbis noticed while you were browsing, the DJ and its stations, what Orbis has worked out
 * about your taste, and the one that just tells you what you have been listening to -- are the parts of Orbis Music
 * that no streaming app has an equivalent of. They are also the parts most easily lost in a move to a familiar
 * layout, so the thinking behind them lives here, as plain values in and plain values out, and is checked by
 * `listening.test.ts` with no browser and no disk.
 *
 * The rule the whole file turns on: **a figure that was not measured is not shown.** Orbis counts a play only once
 * enough of a track has really gone by, and it writes the count and the time of the last one onto the track itself.
 * That is the whole of what a browser page can read. So this file adds up plays, and it refuses to turn them into
 * listening time -- plays times length would be a number nobody measured, and a page printing "14 hours this month"
 * from it would be making that up. Where a figure does not exist, the answer is that it does not exist.
 */

import type { OrbisTrack } from '../music.ts'

// ---------------------------------------------------------------- what has actually been played

/** How much listening Orbis has really counted. Every number here comes off the tracks themselves. */
export interface ListeningSummary {
  /** Songs with at least one counted play. */
  readonly songsPlayed: number
  /** Counted plays, added up. */
  readonly totalPlays: number
  /** Songs in the library that have never been played through Orbis. */
  readonly neverPlayed: number
  /** When the most recent counted play was, or null when nothing has been played. */
  readonly lastAt: number | null
}

/** The counted plays of one track, or none. Anything that is not a whole positive number is none. */
const playsOf = (track: OrbisTrack): number => (typeof track.playCount === 'number' && track.playCount > 0 ? Math.floor(track.playCount) : 0)

export function listeningSummary(library: readonly OrbisTrack[]): ListeningSummary {
  let songsPlayed = 0
  let totalPlays = 0
  let neverPlayed = 0
  let lastAt: number | null = null
  for (const track of library) {
    const plays = playsOf(track)
    if (plays > 0) {
      songsPlayed += 1
      totalPlays += plays
    } else neverPlayed += 1
    const at = track.lastPlayedAt
    if (typeof at === 'number' && Number.isFinite(at) && at > 0 && (lastAt === null || at > lastAt)) lastAt = at
  }
  return { songsPlayed, totalPlays, neverPlayed, lastAt }
}

/**
 * The songs played most, most first.
 *
 * Only songs with a counted play are in it at all: a library sorted by a play count of zero would be a list in an
 * arbitrary order presented as a ranking. Ties go to whichever was played most recently, then to the title, so the
 * list comes out the same every time it is drawn rather than shuffling about between two answers.
 */
export function topSongs(library: readonly OrbisTrack[], limit = 10): readonly OrbisTrack[] {
  return library
    .filter((track) => playsOf(track) > 0)
    .sort((a, b) => playsOf(b) - playsOf(a) || (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || a.title.localeCompare(b.title))
    .slice(0, Math.max(limit, 0))
}

/** One name with the plays behind it: an artist, an album or a genre, however many of its songs were played. */
export interface Tally {
  readonly name: string
  readonly plays: number
  /** How many songs those plays were spread over, which tells one song played forty times from forty songs played once. */
  readonly songs: number
}

function tally(library: readonly OrbisTrack[], nameOf: (track: OrbisTrack) => string, limit: number): readonly Tally[] {
  const by = new Map<string, { plays: number; songs: number }>()
  for (const track of library) {
    const plays = playsOf(track)
    if (plays === 0) continue
    const name = nameOf(track).trim()
    // An untitled artist or album is left out rather than collected under a made-up heading: "Unknown artist" at the
    // top of somebody's most-played list says something about Orbis, not about them.
    if (name === '') continue
    const held = by.get(name) ?? { plays: 0, songs: 0 }
    held.plays += plays
    held.songs += 1
    by.set(name, held)
  }
  return [...by.entries()]
    .map(([name, held]) => ({ name, plays: held.plays, songs: held.songs }))
    .sort((a, b) => b.plays - a.plays || b.songs - a.songs || a.name.localeCompare(b.name))
    .slice(0, Math.max(limit, 0))
}

export const topArtists = (library: readonly OrbisTrack[], limit = 8): readonly Tally[] => tally(library, (track) => track.artist, limit)
export const topAlbums = (library: readonly OrbisTrack[], limit = 8): readonly Tally[] => tally(library, (track) => track.album, limit)
export const topGenres = (library: readonly OrbisTrack[], limit = 8): readonly Tally[] => tally(library, (track) => track.genre ?? '', limit)

// ---------------------------------------------------------------- when something happened

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/**
 * A date a person reads, written the same way whatever the computer's language is set to.
 *
 * Deliberately not `toLocaleDateString`: the same date has to come out the same in a test as it does on screen, and a
 * string that depends on the machine's language makes a test that passes here and fails there.
 */
export function dateWords(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const when = new Date(at)
  return `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}`
}

/**
 * How long ago something was, in the roundest unit that still says something.
 *
 * Past a week it becomes the date, because "47 days ago" is a number nobody can picture. "A minute ago" rather than
 * "1 minute ago", for the same reason the page says "1 song" and never "1 songs".
 */
export function whenWords(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const gap = now - at
  // A clock a little behind the one that wrote the play down, which happens, must not read as the future.
  if (gap < 45_000) return 'Just now'
  const minutes = Math.round(gap / 60_000)
  if (minutes < 60) return minutes === 1 ? 'A minute ago' : `${minutes} minutes ago`
  const hours = Math.round(gap / 3_600_000)
  if (hours < 24) return hours === 1 ? 'An hour ago' : `${hours} hours ago`
  const days = Math.floor(gap / 86_400_000)
  if (days <= 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return dateWords(at)
}

/** The heading one day's worth of things sits under. */
export function dayWords(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return 'Earlier'
  const midnight = (stamp: number): number => {
    const when = new Date(stamp)
    return new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime()
  }
  const apart = Math.round((midnight(now) - midnight(at)) / 86_400_000)
  if (apart <= 0) return 'Today'
  if (apart === 1) return 'Yesterday'
  return dateWords(at)
}

/** Things with a time on them, gathered under one heading per day, newest first. */
export function byDay<T extends { readonly at: number }>(
  things: readonly T[],
  now: number
): readonly { readonly day: string; readonly things: readonly T[] }[] {
  const out: { day: string; things: T[] }[] = []
  for (const one of [...things].sort((a, b) => b.at - a.at)) {
    const day = dayWords(one.at, now)
    const last = out[out.length - 1]
    if (last && last.day === day) last.things.push(one)
    else out.push({ day, things: [one] })
  }
  return out
}

// ---------------------------------------------------------------- what a noticed song may offer

/**
 * What can honestly be done about a song Orbis named on a web page.
 *
 * Noticing is not owning. There are exactly two answers: the person already has a copy, in which case it can be
 * played, or they do not, in which case the most Orbis can do is keep the name -- and the name alone, with no audio,
 * is what it will stay. Nothing is downloaded and nothing is converted, so there is no third answer, and a button
 * offering one would be a promise the engine cannot keep.
 */
export type NoticedOffer = 'play' | 'keep'

export const noticedOffer = (song: { readonly trackId?: string }): NoticedOffer =>
  typeof song.trackId === 'string' && song.trackId.length > 0 ? 'play' : 'keep'

// ---------------------------------------------------------------- the dials on the choosing

/** How adventurous the DJ is allowed to be. The five the engine accepts, and what each one means in plain words. */
export const DISCOVERY_LEVELS = Object.freeze([
  { id: 'familiar', label: 'Familiar', blurb: 'Things you know.' },
  { id: 'balanced', label: 'Balanced', blurb: 'Mostly things you know, with something new now and then.' },
  { id: 'explore', label: 'Explore', blurb: 'An even mix of the known and the unheard.' },
  { id: 'adventurous', label: 'Adventurous', blurb: 'Mostly things you have not played.' },
  { id: 'experimental', label: 'Experimental', blurb: 'Whatever is furthest from your usual.' }
] as const)

export type DiscoveryLevel = (typeof DISCOVERY_LEVELS)[number]['id']

export const isDiscoveryLevel = (value: unknown): value is DiscoveryLevel => typeof value === 'string' && DISCOVERY_LEVELS.some((one) => one.id === value)

/** What forgetting covers, and exactly what each one throws away. A person has to know before they press it. */
export const FORGET_SCOPES = Object.freeze([
  { id: 'session', label: 'This sitting', blurb: 'What Orbis has read into the last hour of listening.' },
  { id: 'recent', label: 'Lately', blurb: 'The recent layer of what it has learned. Your longer-term taste stays.' },
  { id: 'recommendations', label: 'What it chooses', blurb: 'The models behind what it picks next. Your taste stays.' },
  { id: 'everything', label: 'Everything it has learned', blurb: 'All of it, back to a blank. Your music and playlists are untouched.' }
] as const)

export type ForgetScope = (typeof FORGET_SCOPES)[number]['id']

// ---------------------------------------------------------------- what Orbis has worked out about somebody

/** One reading off the taste model, ready to draw as a bar. */
export interface TasteBar {
  readonly name: string
  /** 0 to 100, as the engine gives it. */
  readonly value: number
  /** How sure the engine is, 0 to 1. */
  readonly confidence: number
  /** True when there is enough behind it to state plainly rather than hedge. */
  readonly firm: boolean
}

/**
 * The readings worth drawing, surest first.
 *
 * A reading with no evidence behind it is dropped rather than drawn as a short bar: a bar at zero looks like a
 * measurement of nothing, where leaving it out correctly says Orbis has not worked that one out yet. A thin profile
 * therefore shows almost nothing, which is the intended answer and not a fault.
 */
export function tasteBars(
  readings: readonly { readonly name: string; readonly value: number; readonly confidence: number; readonly evidence: number }[],
  limit = 8
): readonly TasteBar[] {
  return readings
    .filter((one) => Number.isFinite(one.value) && one.evidence > 0)
    .sort((a, b) => b.confidence - a.confidence || b.evidence - a.evidence)
    .slice(0, Math.max(limit, 0))
    .map((one) => ({
      name: one.name,
      value: Math.min(Math.max(Math.round(one.value), 0), 100),
      confidence: one.confidence,
      firm: one.confidence >= 0.5
    }))
}

/** How much to trust what is on the taste screen, said out loud rather than left for somebody to guess at. */
export function howSure(confidence: { readonly events: number; readonly ready: boolean } | null | undefined): string {
  if (!confidence || !Number.isFinite(confidence.events) || confidence.events <= 0) {
    return 'Orbis has not counted any listening yet, so there is nothing here to show.'
  }
  if (!confidence.ready) return `From ${confidence.events} ${confidence.events === 1 ? 'play' : 'plays'}. Still early, so treat these loosely.`
  return `From ${confidence.events} plays.`
}

/** How far along listening to the library is, as a sentence. Null when there is nothing worth saying. */
export function measuringWords(
  measurement: { readonly measured: number; readonly total: number; readonly unmeasurable: number; readonly working: boolean } | null | undefined
): string | null {
  if (!measurement || !Number.isFinite(measurement.total) || measurement.total <= 0) return null
  const left = measurement.total - measurement.unmeasurable - measurement.measured
  if (left <= 0) return null
  return measurement.working
    ? `Listening to ${left} more ${left === 1 ? 'song' : 'songs'} to work out how they sound.`
    : `${left} ${left === 1 ? 'song has' : 'songs have'} not been listened to yet, so they are not in these figures.`
}
