/**
 * The one way the music page reaches Orbis Music.
 *
 * Every screen calls this and nothing else. There is no second route, no fetch anywhere else in the page, and no
 * screen that holds its own idea of what is playing -- because two ideas of state in one app is how a play button
 * comes to say Pause while the music plays on.
 *
 * Three rules it keeps, all of them borrowed from the browser panel that came before it:
 *
 * **A failed call is never an empty list.** Every answer is wrapped in `Answer`, which is either a value or a reason.
 * A screen that got a reason keeps whatever it last drew and says what went wrong. An empty grid reads as "you have
 * no music" and somebody will believe it.
 *
 * **The Orbis window being shut is its own state.** The music channels all answer with one particular sentence for
 * it, so `shut` is set and the page says so, rather than treating it as a fault.
 *
 * **Nothing is sent that has not been checked.** The music service is loose by design: an unrecognised repeat mode
 * quietly becomes "off", a queue position it cannot use is ignored with nothing said, a number that is not a number
 * falls back silently. So a mistake in a screen would show up as a control that does nothing, with no error anywhere.
 * Everything below checks its arguments first (the checkers live in src/shared/music/fulltab.ts and are tested) and
 * refuses with a sentence instead of making a call that will be quietly ignored.
 *
 * The operation names used here all exist in src/main/music/service.ts. Nothing here invents one: an unknown name
 * comes back as a plain refusal, which would look exactly like a broken feature.
 */

import type { Grouped, LibraryQuery, OrbisTrack, PlaybackState, Playlist, RepeatMode, TrackNames } from '../../src/shared/music.ts'
import { okIndex, okName, okRepeat, okSeconds, okTrackId, okTrackIds, okVolume } from '../../src/shared/music/fulltab.ts'
import { OrbisNotRunning, call, problemWords } from './helper.ts'

// ---------------------------------------------------------------- what an answer looks like

/**
 * A value, or the reason there is no value.
 *
 * Note the field is `got` and not `ok`. Several music operations answer with an `{ ok, why }` of their own, and one
 * wrapper with an `ok` around a value with an `ok` is how a caller comes to read the wrong one and report success for
 * something that was refused.
 */
export type Answer<T> = { readonly got: true; readonly value: T } | { readonly got: false; readonly why: string; readonly shut: boolean }

const value = <T>(one: T): Answer<T> => ({ got: true, value: one })
const refused = (why: string, shut = false): Answer<never> => ({ got: false, why, shut })

/** A refusal the page wrote itself, for something it will not even try to send. */
const wontSend = (why: string): Answer<never> => refused(why, false)

/** True when this answer means the Orbis window is shut rather than something going wrong. */
export const isShut = <T>(answer: Answer<T>): boolean => !answer.got && answer.shut

// ---------------------------------------------------------------- shapes the page is given

/**
 * Everything a player needs in one answer, as `music:state` gives it.
 *
 * Mirrors `MusicSnapshot` in src/main/music/service.ts. It is written out again here rather than imported because
 * that file is the app's own and reaches the file system, which has no place in a browser bundle. If the two ever
 * drift the page will read a field that is not there and show nothing for it, so a change there wants a look here.
 */
export interface MusicNow {
  readonly playback: PlaybackState & { readonly problem: string | null }
  readonly track: OrbisTrack | null
  readonly queue: readonly OrbisTrack[]
  readonly settings: MusicSettings
  readonly summary: {
    readonly tracks: number
    readonly offline: number
    readonly missing: number
    readonly reference: number
    readonly playlists: number
    readonly favourites: number
  }
}

/** Mirrors `MusicSettings` in src/main/music/store.ts, for the same reason `MusicNow` is written out here. */
export interface MusicSettings {
  recognition: 'automatic' | 'manual' | 'off'
  useVision: boolean
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  resume: boolean
  folders: readonly string[]
  showButton: boolean
  miniPlayer: 'compact' | 'full'
  view: 'songs' | 'albums' | 'artists' | 'genres' | 'playlists' | 'favourites'
  sort: LibraryQuery['sort']
  playOnStart: boolean
}

/** A song Orbis noticed playing on a web page. Noticing is not owning: this is not the library. */
export interface NoticedSong {
  readonly id: string
  readonly title: string
  readonly artist: string
  readonly album?: string
  readonly provider: string
  readonly url?: string
  readonly at: number
  /** Set only when the person already has a copy, in which case it can be played. */
  readonly trackId?: string
}

/** What Orbis thinks is playing in the browser right now, as `music:heard` gives it. */
export interface HeardNow {
  readonly sighting: { readonly sourceId: string; readonly [more: string]: unknown } | null
  readonly recognition: { readonly names?: TrackNames; readonly confidence?: string; readonly why?: string; readonly [more: string]: unknown } | null
  /** True while Orbis is still working it out, which is what lets a button honestly say it is listening. */
  readonly working: boolean
  readonly inLibraryId: string | null
}

/** One of the named ways of exploring, from the `explorations` operation. There are six and they are fixed. */
export interface Exploration {
  readonly id: string
  readonly label: string
  readonly blurb: string
}

/** What Orbis has worked out about somebody's taste, from the `dna` operation. A thin profile shows almost nothing. */
export interface TasteReadout {
  readonly readings: readonly { readonly name: string; readonly value: number; readonly confidence: number; readonly evidence: number }[]
  readonly topArtists: readonly string[]
  readonly topGenres: readonly string[]
  readonly confidence: { readonly events: number; readonly measured: number; readonly trackCount: number; readonly ready: boolean }
  readonly measurement: { readonly measured: number; readonly total: number; readonly unmeasurable: number; readonly working: boolean }
}

/** What the player said about a press: it answers in words when it refused, and the page must show them. */
export interface Tried {
  readonly ok: boolean
  readonly why?: string
}

// ---------------------------------------------------------------- the one call

/** Which channel a call went to, so a refusal can be reported against something real. */
async function ask<T>(channel: string, args: readonly unknown[] = []): Promise<Answer<T>> {
  try {
    return value((await call(channel, args)) as T)
  } catch (err) {
    const why = problemWords(err)
    const shut = err instanceof OrbisNotRunning || /not available/i.test(why)
    return refused(why, shut)
  }
}

/**
 * Anything Orbis Music can do, by name.
 *
 * One door rather than a hundred. The names are the ones in src/main/music/service.ts; a name that is not one of them
 * comes back as `Orbis Music does not know how to "<name>".`, which is a sentence a screen can show but is always a
 * mistake in the page rather than something a person did.
 */
export const run = <T>(op: string, a?: unknown, b?: unknown, c?: unknown): Promise<Answer<T>> => ask<T>('music:do', [op, a, b, c])

// ---------------------------------------------------------------- looking

/** Everything the player bar needs, in one answer. */
export const now = (): Promise<Answer<MusicNow>> => ask<MusicNow>('music:state')

/** What Orbis thinks is playing on a web page. Cheap: it does not go looking. */
export const heard = (): Promise<Answer<HeardNow>> => ask<HeardNow>('music:heard')

/** Goes and looks again at what is playing on a page. This is the one that costs something. */
export const lookAgain = (tabId?: string): Promise<Answer<HeardNow>> => ask<HeardNow>('music:listen', tabId === undefined ? [] : [tabId])

/** The library, filtered and sorted. An empty query is everything, newest first. */
export const library = (query: LibraryQuery = {}): Promise<Answer<OrbisTrack[]>> => ask<OrbisTrack[]>('music:search', [query])

export const albums = (): Promise<Answer<Grouped[]>> => ask<Grouped[]>('music:albums')
export const artists = (): Promise<Answer<Grouped[]>> => ask<Grouped[]>('music:artists')
export const genres = (): Promise<Answer<Grouped[]>> => ask<Grouped[]>('music:genres')
export const playlists = (): Promise<Answer<Playlist[]>> => ask<Playlist[]>('music:playlists')

/**
 * The tracks in a playlist.
 *
 * Always this, never `playlist.tracks`: a smart playlist is worked out from the library afresh every time and its
 * stored list of ids is empty.
 */
export function playlistTracks(id: string): Promise<Answer<OrbisTrack[]>> {
  const one = okTrackId(id)
  return one ? ask<OrbisTrack[]>('music:playlist-tracks', [one]) : Promise.resolve(wontSend('That playlist could not be opened.'))
}

export const playedLately = (): Promise<Answer<OrbisTrack[]>> => ask<OrbisTrack[]>('music:recent')

/** Songs Orbis named while browsing. A separate collection from the library, and drawn as one. */
export const noticed = (): Promise<Answer<NoticedSong[]>> => ask<NoticedSong[]>('music:recognised')

export const settings = (): Promise<Answer<MusicSettings>> => ask<MusicSettings>('music:settings')

/**
 * Searching, by a name or by a description of what somebody feels like.
 *
 * The answer can be a reason rather than a list: a search with nowhere to look says why, because an empty list would
 * read as "that song does not exist". Only the person's own files are searchable today -- there is no catalogue.
 */
export const find = (said: string, limit = 60): Promise<Answer<unknown>> => {
  const words = okName(said, 300)
  return words ? run('find', words, limit) : Promise.resolve(wontSend('Type something to search for.'))
}

/** Which places Orbis could search, and why each one it could not ask cannot be asked. */
export const searchPlaces = (): Promise<Answer<{ id: string; name: string; kind: string; ready: boolean; why?: string }[]>> => run('sources')

// ---------------------------------------------------------------- playing

export function play(trackId: string): Promise<Answer<Tried>> {
  const one = okTrackId(trackId)
  return one ? ask<Tried>('music:play', [one]) : Promise.resolve(wontSend('That song could not be played.'))
}

/** Plays a whole list, starting at a position in it. */
export function playAll(trackIds: readonly string[], startAt = 0): Promise<Answer<Tried>> {
  const list = okTrackIds(trackIds)
  if (list.length === 0) return Promise.resolve(wontSend('There is nothing here to play.'))
  const from = okIndex(startAt) ?? 0
  return ask<Tried>('music:play-all', [list, Math.min(from, list.length - 1)])
}

export function playPlaylist(id: string): Promise<Answer<Tried>> {
  const one = okTrackId(id)
  return one ? ask<Tried>('music:play-playlist', [one]) : Promise.resolve(wontSend('That playlist could not be played.'))
}

export const pause = (): Promise<Answer<unknown>> => ask('music:pause')
export const resume = (): Promise<Answer<unknown>> => ask('music:resume')
export const playOrPause = (): Promise<Answer<unknown>> => ask('music:toggle')
export const next = (): Promise<Answer<unknown>> => ask('music:next')
export const previous = (): Promise<Answer<unknown>> => ask('music:previous')
export const stop = (): Promise<Answer<unknown>> => run('stop')

export function seek(seconds: number): Promise<Answer<unknown>> {
  const to = okSeconds(seconds)
  return to === null ? Promise.resolve(wontSend('That is not a place in the track.')) : ask('music:seek', [to])
}

export function setVolume(level: number): Promise<Answer<unknown>> {
  const to = okVolume(level)
  return to === null ? Promise.resolve(wontSend('That is not a volume.')) : ask('music:volume', [to])
}

export const setMuted = (on: boolean): Promise<Answer<unknown>> => ask('music:mute', [on === true])
export const setShuffle = (on: boolean): Promise<Answer<unknown>> => ask('music:shuffle', [on === true])

export function setRepeat(mode: RepeatMode): Promise<Answer<unknown>> {
  const one = okRepeat(mode)
  // Checked here because the service turns anything it does not recognise into "off" without saying so, which would
  // look like a repeat button that silently refuses to work.
  return one ? ask('music:repeat', [one]) : Promise.resolve(wontSend('That is not a way to repeat.'))
}

// ---------------------------------------------------------------- what is coming next

export function queueNext(trackIds: readonly string[]): Promise<Answer<unknown>> {
  const list = okTrackIds(trackIds)
  return list.length ? ask('music:queue-next', [list]) : Promise.resolve(wontSend('There is nothing to put next.'))
}

export function queueEnd(trackIds: readonly string[]): Promise<Answer<unknown>> {
  const list = okTrackIds(trackIds)
  return list.length ? ask('music:queue-end', [list]) : Promise.resolve(wontSend('There is nothing to add.'))
}

export function queueRemove(index: number): Promise<Answer<unknown>> {
  const at = okIndex(index)
  return at === null ? Promise.resolve(wontSend('That is not a place in the queue.')) : ask('music:queue-remove', [at])
}

/** Moves one entry in the queue. The service ignores a position it cannot use, so both are checked first. */
export function queueReorder(from: number, to: number): Promise<Answer<unknown>> {
  const a = okIndex(from)
  const b = okIndex(to)
  if (a === null || b === null) return Promise.resolve(wontSend('That is not a place in the queue.'))
  if (a === b) return Promise.resolve(value(true))
  return ask('music:queue-reorder', [a, b])
}

export const queueClear = (): Promise<Answer<unknown>> => ask('music:queue-clear')

// ---------------------------------------------------------------- keeping things

export function setFavourite(trackId: string, on: boolean): Promise<Answer<OrbisTrack | null>> {
  const one = okTrackId(trackId)
  return one ? ask<OrbisTrack | null>('music:favourite', [one, on === true]) : Promise.resolve(wontSend('That song could not be changed.'))
}

export function createPlaylist(name: string, trackIds: readonly string[] = []): Promise<Answer<Playlist | null>> {
  const words = okName(name)
  if (!words) return Promise.resolve(wontSend('Give the playlist a name.'))
  const list = okTrackIds(trackIds)
  // Through the operation runner rather than the named channel, because the channel takes a name only and a new
  // playlist made out of a selection is the common case on a page this size.
  return run<Playlist | null>('create-playlist', words, list)
}

export function renamePlaylist(id: string, name: string): Promise<Answer<Playlist | null>> {
  const one = okTrackId(id)
  const words = okName(name)
  if (!one || !words) return Promise.resolve(wontSend('Give the playlist a name.'))
  return run<Playlist | null>('rename-playlist', one, words)
}

export function removePlaylist(id: string): Promise<Answer<boolean>> {
  const one = okTrackId(id)
  return one ? run<boolean>('remove-playlist', one) : Promise.resolve(wontSend('That playlist could not be removed.'))
}

export function addToPlaylist(id: string, trackIds: readonly string[]): Promise<Answer<Playlist | null>> {
  const one = okTrackId(id)
  const list = okTrackIds(trackIds)
  if (!one || list.length === 0) return Promise.resolve(wontSend('There is nothing to add.'))
  return ask<Playlist | null>('music:add-to-playlist', [one, list])
}

export function removeFromPlaylist(id: string, trackId: string): Promise<Answer<Playlist | null>> {
  const one = okTrackId(id)
  const track = okTrackId(trackId)
  if (!one || !track) return Promise.resolve(wontSend('That song could not be taken out.'))
  return ask<Playlist | null>('music:remove-from-playlist', [one, track])
}

export function reorderPlaylist(id: string, from: number, to: number): Promise<Answer<Playlist | null>> {
  const one = okTrackId(id)
  const a = okIndex(from)
  const b = okIndex(to)
  if (!one || a === null || b === null) return Promise.resolve(wontSend('That song could not be moved.'))
  if (a === b) return Promise.resolve(value(null))
  return run<Playlist | null>('reorder-playlist', one, a, b)
}

/**
 * Keeps a song Orbis noticed on a web page.
 *
 * The most this can do is link to a copy the person already has, or keep the name with no audio. Nothing is
 * downloaded and nothing is converted, and the answer says which of the four things happened -- so a button must not
 * read "Added" until the library has said so.
 */
export function keepNoticed(names: TrackNames, duration: number, source: { provider: string; url?: string }): Promise<Answer<unknown>> {
  if (!okName(names?.title) || !names?.artist) return Promise.resolve(wontSend('Orbis does not have a name for this one yet.'))
  return ask('music:keep-heard', [names, okSeconds(duration) ?? 0, source])
}

// ---------------------------------------------------------------- bringing music in

/**
 * Opens the Orbis window's own file picker.
 *
 * The dialog belongs to the window, not to this page, and this page only ever learns how many files were added. That
 * is on purpose: a browser page naming a path on this computer is exactly what must not happen.
 */
export const importFiles = (): Promise<Answer<unknown>> => ask('music:import')

/** Opens the picker for a folder, reads it, and watches it from then on. */
export const watchFolder = (): Promise<Answer<unknown>> => ask('music:scan-folder')

/**
 * Sends one dropped audio file in, in pieces.
 *
 * In pieces, and without a path, because a page is never told where a file it was handed lives. `key` ties the pieces
 * of one file together and `last` says when there are no more.
 */
export const sendFilePiece = (piece: { name: string; key: string; data: string; last: boolean }): Promise<Answer<{ ok: boolean; finished: boolean }>> =>
  run<{ ok: boolean; finished: boolean }>('drop-chunk', piece)

// ---------------------------------------------------------------- the intelligence

/** Turns the DJ on or off. It refuses, in words, when there is not enough music to choose from. */
export const setDj = (on: boolean): Promise<Answer<{ ok: boolean; dj?: boolean; why?: string }>> => run('dj', on === true)

/** A station that keeps going: from one song, or from everything Orbis knows about somebody. */
export function station(seedTrackId?: string): Promise<Answer<Tried>> {
  const seed = seedTrackId === undefined ? undefined : okTrackId(seedTrackId)
  if (seedTrackId !== undefined && !seed) return Promise.resolve(wontSend('A station could not be started from that song.'))
  return run<Tried>('radio', seed)
}

/** The six named ways of exploring. A fixed list, not a guess. */
export const explorations = (): Promise<Answer<Exploration[]>> => run<Exploration[]>('explorations')

/** Starts one of them, and answers with the engine's own sentence about why it chose what it chose. */
export function explore(id: string): Promise<Answer<{ ok: boolean; why?: string; label?: string; because?: readonly string[] }>> {
  const one = okTrackId(id)
  return one ? run('explore', one) : Promise.resolve(wontSend('That is not something to explore.'))
}

/** What Orbis has worked out about somebody's taste. A thin profile shows almost nothing, and that is correct. */
export const taste = (): Promise<Answer<TasteReadout>> => run<TasteReadout>('dna')

/** Why this track was chosen, as the parts that actually scored. Null when there is no answer. */
export function whyThis(trackId: string): Promise<Answer<{ score: number; confidence: number; because: { dimension: string; name: string; value: number }[] } | null>> {
  const one = okTrackId(trackId)
  return one ? run('why', one) : Promise.resolve(wontSend('There is nothing to explain.'))
}

/** What somebody has and has not listened to, by genre, language and era. */
export const unexplored = (): Promise<Answer<unknown>> => run('exploration')

/** Sets how adventurous the choosing is. Checked here because the ranker takes anything it is handed. */
export function setDiscovery(level: 'familiar' | 'balanced' | 'explore' | 'adventurous' | 'experimental'): Promise<Answer<unknown>> {
  const allowed = ['familiar', 'balanced', 'explore', 'adventurous', 'experimental']
  return allowed.includes(level) ? run('discovery-level', level) : Promise.resolve(wontSend('That is not a level.'))
}

/** Tells the engine what somebody feels like, in their own words. It says what it could not read. */
export function askFor(said: string): Promise<Answer<unknown>> {
  const words = okName(said, 300)
  return words ? run('request', words) : Promise.resolve(wontSend('Say what you feel like.'))
}

/** Forgets what Orbis has learned: this sitting, lately, the recommendations, or everything. */
export function forgetLearning(scope: 'session' | 'recent' | 'recommendations' | 'everything'): Promise<Answer<unknown>> {
  const allowed = ['session', 'recent', 'recommendations', 'everything']
  return allowed.includes(scope) ? run('reset-learning', scope) : Promise.resolve(wontSend('That is not something to forget.'))
}

// ---------------------------------------------------------------- preferences

/** Changes a preference and answers with the whole lot read back, so the page never guesses what it became. */
export const saveSettings = (patch: Partial<MusicSettings>): Promise<Answer<MusicSettings>> => ask<MusicSettings>('music:save-settings', [patch])

// ---------------------------------------------------------------- covers

/**
 * The covers for up to sixty tracks, each one the picture itself written into text.
 *
 * There is no full-size cover and no address for one: the only route scales the longest side to 160 pixels. A track
 * with no cover is simply missing from the answer, which is what lets the page remember never to ask about it again.
 * A big sharp hero image is not something Orbis can give a browser page today, so the page does not pretend: it
 * stretches the small one behind a blur and draws the real letter tile over it.
 */
export function covers(trackIds: readonly string[]): Promise<Answer<Record<string, string>>> {
  const list = okTrackIds(trackIds).slice(0, 60)
  return list.length ? run<Record<string, string>>('artwork', list) : Promise.resolve(value({}))
}
