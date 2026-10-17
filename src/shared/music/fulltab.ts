/**
 * The thinking behind the full-tab Orbis Music page.
 *
 * The page itself is a browser tab in the Orbis browser, so nothing in it can be tested without a screen. Everything
 * that is a decision rather than a drawing lives here instead: which screen an address means, what time to show on a
 * seek bar between two answers from the player, which covers are still worth asking for, and whether anything the
 * player said has actually changed. All of it is plain values in and plain values out, so it is checked by
 * `fulltab.test.ts` with no browser and no disk.
 *
 * The one rule running through the whole file: nothing here invents a value. A length that is not known comes back as
 * a dash, not as 0:00. A number the page was given that cannot be used comes back as null, and the caller is expected
 * to not make the call rather than to hope the music service refuses it -- the service is loose on purpose and will
 * quietly accept nonsense.
 */

import type { PlaybackState, RepeatMode } from '../music.ts'

// ---------------------------------------------------------------- which screen the address means

/**
 * The screens the page can be showing.
 *
 * The address bar's hash is the only thing that decides this, which is what makes the browser's own back and forward
 * buttons work on a page that never reloads. A screen with something behind it carries its id: an album key, an
 * artist name, a playlist id, the words somebody searched for.
 */
export type MusicScreenName =
  | 'home'
  | 'search'
  | 'library'
  | 'playing'
  | 'album'
  | 'artist'
  | 'genre'
  | 'playlist'
  | 'playlists'
  | 'queue'
  | 'recent'
  | 'liked'
  | 'discover'
  | 'noticed'
  | 'bring-in'
  | 'tidy'
  | 'settings'

export interface MusicRoute {
  readonly screen: MusicScreenName
  /** What the screen is about: an album key, an artist's name, a playlist's id. Empty when the screen needs nothing. */
  readonly of: string
  /** The words typed into the search box, carried in the address so a search survives a reload and a back press. */
  readonly said: string
}

/**
 * Every screen, as a list.
 *
 * Exported so a test can walk it. A screen that is in the type and has no file behind it, or has a file nobody
 * imports, lands on the "nobody has written this yet" sentence -- which is how a finished screen quietly goes
 * missing, so `fulltab.test.ts` checks this list against the files on disk.
 */
export const SCREENS: readonly MusicScreenName[] = [
  'home',
  'search',
  'library',
  'playing',
  'album',
  'artist',
  'genre',
  'playlist',
  'playlists',
  'queue',
  'recent',
  'liked',
  'discover',
  'noticed',
  'bring-in',
  'tidy',
  'settings'
]

export const MUSIC_HOME: MusicRoute = Object.freeze({ screen: 'home', of: '', said: '' })

/** True when this name is a screen the page knows. Exported so a screen file can check its own registration. */
export const isMusicScreen = (name: unknown): name is MusicScreenName => typeof name === 'string' && (SCREENS as readonly string[]).includes(name)

/**
 * Reads an address into a screen.
 *
 * The shape is `#/<screen>/<what it is about>?q=<words>`. Anything it cannot read is Home rather than an error page:
 * a person who has hand-typed an address, or followed a link from an older version of the page, should land
 * somewhere real. `of` is decoded, because an album called "Rock & Roll" has to survive being put in an address.
 */
export function parseRoute(hash: string): MusicRoute {
  const text = hash.startsWith('#') ? hash.slice(1) : hash
  const [path, query = ''] = text.split('?')
  const parts = path.split('/').filter((piece) => piece !== '')
  const name = parts[0] ?? ''
  if (!isMusicScreen(name)) return MUSIC_HOME
  let of = ''
  if (parts.length > 1) {
    try {
      of = decodeURIComponent(parts.slice(1).join('/'))
    } catch {
      // A half-written escape in a hand-typed address. The screen is still real, so show it with nothing behind it.
      of = ''
    }
  }
  let said = ''
  for (const pair of query.split('&')) {
    if (!pair.startsWith('q=')) continue
    try {
      said = decodeURIComponent(pair.slice(2).replace(/\+/g, ' '))
    } catch {
      said = ''
    }
  }
  return { screen: name, of: of.slice(0, 400), said: said.slice(0, 300) }
}

/** Writes a screen back out as an address. `parseRoute(routeHash(route))` gives the same route back. */
export function routeHash(route: Partial<MusicRoute> & { screen: MusicScreenName }): string {
  const of = route.of ? `/${encodeURIComponent(route.of)}` : ''
  const said = route.said ? `?q=${encodeURIComponent(route.said)}` : ''
  return `#/${route.screen}${of}${said}`
}

/** True when two addresses mean the same screen, so the page does not redraw itself over a press that changed nothing. */
export const sameRoute = (a: MusicRoute, b: MusicRoute): boolean => a.screen === b.screen && a.of === b.of && a.said === b.said

// ---------------------------------------------------------------- the left-hand list

export interface MusicNavEntry {
  readonly screen: MusicScreenName
  /** What the person reads. */
  readonly label: string
  /** Which icon to draw, by name. The page's icon table owns the drawing. */
  readonly icon: string
  /** True for the entries in the second group, under the line. */
  readonly secondary?: boolean
}

/**
 * The left-hand list, in order.
 *
 * Here rather than in the page because the Orb and the command palette will eventually want to jump straight to one
 * of these, and two lists of screens is how the two come to disagree about which screens exist.
 */
export const MUSIC_NAV: readonly MusicNavEntry[] = Object.freeze([
  { screen: 'home', label: 'Home', icon: 'home' },
  { screen: 'search', label: 'Search', icon: 'search' },
  { screen: 'library', label: 'Your music', icon: 'library' },
  // Playing now is a screen of its own, not only the column on the right: it is the one place with room for the big
  // cover, the colours measured out of it, and everything the music service really knows about the track.
  { screen: 'playing', label: 'Playing now', icon: 'note' },
  { screen: 'liked', label: 'Favourites', icon: 'heart', secondary: true },
  { screen: 'queue', label: 'Up next', icon: 'list', secondary: true },
  { screen: 'recent', label: 'Played lately', icon: 'clock', secondary: true },
  { screen: 'discover', label: 'Discover', icon: 'compass', secondary: true },
  { screen: 'noticed', label: 'Noticed while browsing', icon: 'ear', secondary: true },
  { screen: 'bring-in', label: 'Bring music in', icon: 'folder', secondary: true },
  { screen: 'tidy', label: 'Export and tidy', icon: 'file', secondary: true },
  { screen: 'settings', label: 'Settings', icon: 'settings', secondary: true }
])

// ---------------------------------------------------------------- numbers a person reads

/**
 * A length or a position, as minutes and seconds.
 *
 * A dash rather than 0:00 when there is no number, because a great many tracks genuinely have no known length -- a
 * song Orbis noticed on a web page has a name and nothing else -- and showing 0:00 for those would be stating a
 * length Orbis does not have. The panel has always done this and the page must not undo it.
 */
export function clockText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = whole % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/** A position on a seek bar, which unlike a length really is 0:00 at the start. */
export const positionText = (seconds: number): string => (Number.isFinite(seconds) && seconds > 0 ? clockText(seconds) : '0:00')

/**
 * A total listening time, in the longest unit that still says something.
 *
 * Used under a playlist's name. Zero comes back as an empty string so the caller leaves the line out rather than
 * printing "0 min" beside a list whose tracks simply have no known lengths.
 */
export function spanText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return ''
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}

/** "1 song" / "24 songs", because "1 songs" is the kind of thing that makes a page feel unfinished. */
export const countText = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

// ---------------------------------------------------------------- a colour for a cover that has none

/**
 * A hue derived from the words, so a song without a cover still looks like itself everywhere it appears.
 *
 * The panel does the same thing for the same reason: a stock image or an invented cover would be a picture of a thing
 * that does not exist, where a letter on a coloured square is plainly a stand-in. The hue has to come out identical
 * for the same track in the sidebar, in a list and in the player bar, which is why it is a function of the text and
 * not of anything the page holds.
 */
export function hueFor(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 360000
  return hash % 360
}

/** The one letter a coverless tile shows. A title of nothing but punctuation gets a music note instead. */
export function tileLetter(title: string): string {
  for (const character of title.trim()) {
    if (/[\p{L}\p{N}]/u.test(character)) return character.toUpperCase()
  }
  return '♪'
}

// ---------------------------------------------------------------- where the music has actually got to

/**
 * How far into the track to draw the bar, between two answers from the player.
 *
 * There is no push from the music service to the browser side: `music:changed` is sent over the app's own wiring to
 * the Orbis window's screen and nothing forwards it here, so the page asks every second or two. A seek bar that only
 * moved when an answer arrived would visibly jump, so between answers the page carries the position on with the
 * clock -- and corrects it to whatever the player says the moment an answer lands.
 *
 * This only ever runs forward while the player says it is playing, and never past the end of the track. The player's
 * own position is the truth; this is a guess about the gap, and it is capped so the guess can never be far out.
 */
export function progressAt(playback: Pick<PlaybackState, 'playing' | 'position' | 'duration'>, answeredAt: number, now: number): number {
  const from = Number.isFinite(playback.position) && playback.position > 0 ? playback.position : 0
  if (!playback.playing) return from
  const gap = now - answeredAt
  // A tab that was asleep or a computer that was shut can leave a gap of minutes. Past a few seconds the guess is
  // worthless, so it stops rather than drawing the bar somewhere the music never reached.
  const carried = from + Math.min(Math.max(gap, 0), 5000) / 1000
  const end = Number.isFinite(playback.duration) && playback.duration > 0 ? playback.duration : Infinity
  return Math.min(carried, end)
}

/** Where a press on the bar lands, as seconds. Null when the track has no known length, in which case seeking is off. */
export function seekTarget(fraction: number, duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null
  if (!Number.isFinite(fraction)) return null
  return Math.min(Math.max(fraction, 0), 1) * duration
}

/** The fraction of the bar to fill. Zero when there is no length, so a bar for a track of unknown length stays empty. */
export function fillFraction(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  if (!Number.isFinite(position) || position <= 0) return 0
  return Math.min(position / duration, 1)
}

// ---------------------------------------------------------------- telling a new answer from the same one

/**
 * What the page watches for in an answer from the player.
 *
 * The answer carries no marker saying what changed, so the page works it out by comparing. Only the parts that change
 * what is on screen are compared: the position is left out on purpose, because it changes every single time and the
 * bar is drawn from the clock anyway, so including it would mean redrawing the whole page once a second forever.
 */
export interface PlaybackMark {
  readonly owner: string
  readonly trackId: string | null
  readonly playing: boolean
  readonly duration: number
  readonly volume: number
  readonly muted: boolean
  readonly shuffle: boolean
  readonly repeat: RepeatMode
  readonly queue: string
  readonly at: number
  readonly problem: string | null
}

export function playbackMark(playback: PlaybackState & { problem?: string | null }): PlaybackMark {
  return {
    owner: playback.owner,
    trackId: playback.trackId,
    playing: playback.playing,
    duration: playback.duration,
    volume: playback.volume,
    muted: playback.muted,
    shuffle: playback.shuffle,
    repeat: playback.repeat,
    queue: playback.queue.join(','),
    at: playback.at,
    problem: playback.problem ?? null
  }
}

/** True when nothing a person could see has changed, so the page leaves what is drawn alone. */
export function sameMark(a: PlaybackMark | null, b: PlaybackMark | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.owner === b.owner &&
    a.trackId === b.trackId &&
    a.playing === b.playing &&
    a.duration === b.duration &&
    a.volume === b.volume &&
    a.muted === b.muted &&
    a.shuffle === b.shuffle &&
    a.repeat === b.repeat &&
    a.queue === b.queue &&
    a.at === b.at &&
    a.problem === b.problem
  )
}

// ---------------------------------------------------------------- asking for covers, without asking twice

/** The most track ids one request for covers may carry. The music service refuses more than this. */
export const ARTWORK_BATCH = 60

/**
 * Which covers are still worth asking for, in batches the service will accept.
 *
 * Three things are kept out: anything already held, anything already asked about and not given (a track with no cover
 * must not be asked about once a second forever), and anything past the batch size. The order of what comes in is
 * kept, so the covers nearest the top of the screen are fetched first.
 */
export function artworkBatches(wanted: readonly string[], held: ReadonlySet<string>, tried: ReadonlySet<string>, batches = 1): string[][] {
  const seen = new Set<string>()
  const needed: string[] = []
  for (const id of wanted) {
    if (typeof id !== 'string' || id === '' || id.length > 64) continue
    if (held.has(id) || tried.has(id) || seen.has(id)) continue
    seen.add(id)
    needed.push(id)
    if (needed.length >= ARTWORK_BATCH * Math.max(batches, 1)) break
  }
  const out: string[][] = []
  for (let i = 0; i < needed.length; i += ARTWORK_BATCH) out.push(needed.slice(i, i + ARTWORK_BATCH))
  return out
}

/**
 * How many covers to keep in memory before dropping the oldest.
 *
 * Each cover arrives as the picture itself written into text, which is heavier than a web address would be, and a
 * library here may hold fifty thousand tracks. Holding every cover a long scroll went past would grow without end.
 */
export const ARTWORK_KEPT = 600

// ---------------------------------------------------------------- checking what the page is about to send

/**
 * These exist because the music service does not check what it is given.
 *
 * An unrecognised repeat mode quietly becomes "off"; a queue position it cannot use is ignored with nothing said; a
 * number that is not a number falls back silently. So a mistake in the page would show up as a control that does
 * nothing, with no error anywhere. Each of these answers null for something that cannot be sent, and the page is
 * expected to not make the call -- and to say so -- rather than send it and hope.
 */

export const okTrackId = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null)

/** A list of track ids, with anything unusable dropped. Capped at what the browser's own channels accept. */
export function okTrackIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const one of value) {
    const id = okTrackId(one)
    if (id) out.push(id)
    if (out.length >= 500) break
  }
  return out
}

/** A playlist or track name. Trimmed, and refused when there is nothing left of it. */
export const okName = (value: unknown, max = 200): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null
}

export const okSeconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400 ? Math.round(value * 1000) / 1000 : null

export const okVolume = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null)

export const okIndex = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5000 ? value : null

export const okRepeat = (value: unknown): RepeatMode | null => (value === 'off' || value === 'all' || value === 'one' ? value : null)

/** What repeat turns into on the next press: off, then everything, then this one, then off again. */
export const nextRepeat = (mode: RepeatMode): RepeatMode => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off')

// ---------------------------------------------------------------- what to say when there is nothing to show

/**
 * Why a screen is empty, which is never the same question as whether it is empty.
 *
 * The panel's single most important rule, carried over: a failed call must never leave an empty list on screen,
 * because an empty list reads as "you have no music" and somebody will believe it. These four are different states
 * and the page draws them differently -- `loading` and `unreachable` and `failed` all keep whatever was last drawn,
 * where `empty` really does mean there is nothing.
 */
export type EmptyReason = 'loading' | 'empty' | 'unreachable' | 'failed'

export interface EmptyWords {
  readonly title: string
  readonly detail: string
  /** True when a Try again button makes sense. Nothing retries "you have no music". */
  readonly retry: boolean
}

/** The sentence for a screen with nothing on it. `what` names the thing, e.g. "playlists". */
export function emptyWords(reason: EmptyReason, what: string, problem?: string | null): EmptyWords {
  switch (reason) {
    case 'loading':
      return { title: `Reading your ${what}…`, detail: '', retry: false }
    case 'unreachable':
      return {
        title: 'Orbis Music is not open',
        detail: 'Open the Orbis window and your music connects by itself. Nothing here means your music is gone.',
        retry: true
      }
    case 'failed':
      return { title: `Orbis could not read your ${what}`, detail: problem?.trim() || 'Nothing was changed. Try again in a moment.', retry: true }
    default:
      return { title: `No ${what} yet`, detail: '', retry: false }
  }
}

/**
 * True when the words from a failed call mean the Orbis window is shut rather than something going wrong.
 *
 * The music channels all say the same sentence for it, on purpose, so the browser never shows an empty library that
 * reads as "you have no music". The page tells the two apart by that sentence and shows a different screen for each.
 */
export const meansWindowShut = (message: string): boolean => /not available|not running|unavailable/i.test(message)
