/**
 * Tying a thing on screen to the thing it is about.
 *
 * Right-click menus, keyboard presses and dragging all need the same answer to the same question: the pointer is
 * over *this* element -- what is it about? A song, and which one? An album? A playlist? Rather than each of the three
 * working that out its own way from class names and the words in a row, there is one place that answers it, and one
 * way for a screen to say so.
 *
 * A screen marks a node once, as it builds it:
 *
 * ```ts
 * import { markTrack } from '../marked.ts'
 * markTrack(trackRow(track), track, { playlistId: list.id })
 * ```
 *
 * The thing itself is kept in a `WeakMap` rather than written into the element, for two reasons. A whole track written
 * into an attribute would put a file path on screen for anything that can read the page, which this page never does.
 * And a weak map lets go of a row the moment the row is thrown away, so scrolling a library of fifty thousand songs
 * does not slowly fill memory with rows nobody can see any more.
 *
 * The attribute that *is* written is only the word for what kind of thing it is, so `closest()` can find the nearest
 * marked element in one step -- which is how one listener on the document serves every row on every screen.
 */

import type { OrbisTrack, Playlist } from '../../src/shared/music.ts'
import type { TrackWhere } from '../../src/shared/music/actions.ts'
import * as music from './client.ts'
import { trackRow, type RowOptions } from './shell.ts'

export type Marked =
  | { readonly kind: 'track'; readonly track: OrbisTrack; readonly where: TrackWhere }
  | { readonly kind: 'album'; readonly name: string; readonly by: string; readonly tracks: readonly OrbisTrack[] }
  | { readonly kind: 'artist'; readonly name: string; readonly tracks: readonly OrbisTrack[] }
  | { readonly kind: 'playlist'; readonly list: Playlist }

const held = new WeakMap<Element, Marked>()

const put = <T extends HTMLElement>(node: T, what: Marked): T => {
  held.set(node, what)
  node.setAttribute('data-om-marked', what.kind)
  return node
}

/**
 * Says a node is about one song. `where` is what makes "take out of this playlist" and "take out of the queue" real.
 *
 * A marked song is also made draggable here, rather than by the dragging file, so a screen that marks its rows gets
 * dragging and the right-click menu from one call. The alternative was watching the whole page for new rows and
 * setting the attribute afterwards, which for a library of fifty thousand songs is work for nothing.
 */
export function markTrack<T extends HTMLElement>(node: T, track: OrbisTrack, where: TrackWhere = {}): T {
  node.draggable = true
  return put(node, { kind: 'track', track, where })
}

/** Says a node is about one album. The tracks are the album's own, so playing it needs nothing asked for. */
export const markAlbum = <T extends HTMLElement>(node: T, name: string, by: string, tracks: readonly OrbisTrack[]): T =>
  put(node, { kind: 'album', name, by, tracks })

export const markArtist = <T extends HTMLElement>(node: T, name: string, tracks: readonly OrbisTrack[]): T => put(node, { kind: 'artist', name, tracks })

/**
 * The frame's own track row, marked in the same breath.
 *
 * Offered so a screen gets the right-click menu and dragging by changing one word: a list that says `songRow(track)`
 * where it said `trackRow(track)` is a list whose songs can be right-clicked and dragged, and nothing else about it
 * changes. The row itself is still the frame's, so the availability wording and the three buttons on it stay in the
 * one place they have always been.
 */
export function songRow(track: OrbisTrack, options: RowOptions & TrackWhere = {}): HTMLElement {
  const { playlistId, playlistWorkedOut, queueAt, ...rest } = options
  return markTrack(trackRow(track, { ...rest, queueAt }), track, { playlistId, playlistWorkedOut, queueAt })
}

export const markPlaylist = <T extends HTMLElement>(node: T, list: Playlist): T => put(node, { kind: 'playlist', list })

/** What the nearest marked element above this one is about, or nothing when there is none. */
export function markedAt(from: EventTarget | null): { readonly node: HTMLElement; readonly what: Marked } | null {
  if (!(from instanceof Node)) return null
  const start = from instanceof Element ? from : from.parentElement
  const node = start?.closest('[data-om-marked]')
  if (!(node instanceof HTMLElement)) return null
  const what = held.get(node)
  return what ? { node, what } : null
}

// ---------------------------------------------------------------- the playlists down the left

/**
 * Marking the sidebar's playlist rows, which this page's frame builds and does not mark itself.
 *
 * The frame owns that list and fills it with one row per playlist, in the order the music service gave them. So the
 * rows are matched up by position, and then the name on each row is checked against the name of the playlist it was
 * matched to. If the two disagree -- a different number of rows, or a name that is not the one expected -- nothing is
 * marked at all, and dragging a song onto the sidebar simply does not work rather than putting it in the wrong list.
 * Guessing wrong here would move somebody's music about without telling them.
 *
 * The list is re-read when the frame rebuilds it, which it does on every change of screen, and the answer is kept for
 * a moment so two rebuilds in a row are one request.
 */

const KEEP_FOR = 3000
let kept: { readonly lists: readonly Playlist[]; readonly at: number } | null = null
let asking: Promise<readonly Playlist[] | null> | null = null

async function theLists(): Promise<readonly Playlist[] | null> {
  if (kept && Date.now() - kept.at < KEEP_FOR) return kept.lists
  if (asking) return asking
  asking = (async () => {
    const answer = await music.playlists()
    if (!answer.got) return null
    kept = { lists: answer.value, at: Date.now() }
    return answer.value
  })().finally(() => {
    asking = null
  })
  return asking
}

/** Forgets the kept answer, so the next look is a fresh one. Called after a playlist is made, renamed or removed. */
export const playlistsChanged = (): void => {
  kept = null
}

async function markSidebar(list: HTMLElement): Promise<void> {
  const rows = [...list.querySelectorAll(':scope > .om-side-row')].filter((one): one is HTMLElement => one instanceof HTMLElement)
  if (rows.length === 0) return
  const lists = await theLists()
  if (!lists || lists.length !== rows.length) return
  rows.forEach((row, index) => {
    const playlist = lists[index]
    if (!playlist) return
    const name = row.querySelector('.om-side-name')?.textContent ?? ''
    if (name !== playlist.name) return
    markPlaylist(row, playlist)
  })
}

/**
 * Watches for the frame rebuilding its playlist list, and marks the rows again each time.
 *
 * A rebuild throws the old rows away, and with them their marks, so there is nothing to do but mark the new ones. The
 * watch is on the list element's children only, and the work is put off a moment, because the frame fills the whole
 * list in one go and there is no sense marking it halfway through.
 */
export function watchSidebarPlaylists(): void {
  const find = (): HTMLElement | null => {
    const node = document.querySelector('.om-side-list')
    return node instanceof HTMLElement ? node : null
  }
  let soon: ReturnType<typeof setTimeout> | null = null
  const again = (list: HTMLElement): void => {
    if (soon) clearTimeout(soon)
    soon = setTimeout(() => void markSidebar(list), 30)
  }
  const start = (): boolean => {
    const list = find()
    if (!list) return false
    new MutationObserver(() => again(list)).observe(list, { childList: true })
    again(list)
    return true
  }
  // The frame may not have built itself yet when this runs. Watching the page for the list to appear is one short
  // wait rather than a guess about which file runs first.
  if (start()) return
  const waiting = new MutationObserver(() => {
    if (start()) waiting.disconnect()
  })
  waiting.observe(document.body, { childList: true, subtree: true })
}
