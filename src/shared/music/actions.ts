/**
 * What a right-click may offer, what a key press means, and what a drop means.
 *
 * All three are lists of facts with no screen anywhere near them, which is why they are here rather than in the page.
 * Three rules shaped the file:
 *
 *   - **A menu only offers what really exists.** Every entry maps onto an operation Orbis Music genuinely answers.
 *     There is no "share", no "add to your library" for something already in it, no "go to artist" when the file
 *     names no artist. An entry that cannot be done right now is still shown, switched off, with the reason in the
 *     music service's own words -- because a row that quietly loses a menu entry is harder to understand than one
 *     that says why.
 *   - **A shortcut cannot exist without appearing on the shortcuts sheet.** The sheet is worked out from the same
 *     table the key presses are matched against, so the two can never drift. There is no second list to update.
 *   - **A drop is refused in words.** Dragging a song onto a list that is worked out from the library cannot work;
 *     saying so is better than taking the drop and dropping it on the floor.
 */

import type { OrbisTrack, Playlist } from '../music.ts'
import { playableOffline, whyNotPlayable } from '../music.ts'

// ---------------------------------------------------------------- menus

/**
 * Every action a menu can offer. Each one is an operation the music service really has, so a new name here means a
 * new operation there and not the other way round.
 */
export type ActionId =
  | 'play'
  | 'play-next'
  | 'queue-end'
  | 'add-to-playlist'
  | 'favourite'
  | 'unfavourite'
  | 'go-album'
  | 'go-artist'
  | 'queue-remove'
  | 'playlist-remove'
  | 'play-album'
  | 'queue-album'
  | 'play-artist'
  | 'queue-artist'
  | 'play-playlist'
  | 'queue-playlist'
  | 'rename-playlist'
  | 'remove-playlist'

export interface ActionItem {
  readonly id: ActionId
  /** What the entry says. Plain words, and the same words wherever the entry appears. */
  readonly label: string
  /** Why it cannot be done, in the music service's own words. Set only when `off` is true. */
  readonly why?: string
  /** Shown, but cannot be pressed. */
  readonly off?: boolean
  /** A line above this entry, so the parts of the menu read as groups. */
  readonly line?: boolean
}

/** Where a track is being right-clicked, which decides whether taking it out of something is on offer. */
export interface TrackWhere {
  /** The playlist whose screen this row is on, when it is on one. */
  readonly playlistId?: string
  /** True when that playlist is worked out from the library, so songs cannot be taken out of it by hand. */
  readonly playlistWorkedOut?: boolean
  /** Where this row sits in what is coming next, counted from the start of the queue. */
  readonly queueAt?: number
}

/**
 * The menu for one song.
 *
 * A song with no audio on this computer still gets its menu: it is a song, and favouriting it, putting it in a
 * playlist and going to its album all work perfectly well. Only the three entries that need sound are switched off,
 * and they carry the sentence that says what is wrong with the file.
 */
export function trackMenu(track: OrbisTrack, where: TrackWhere = {}): readonly ActionItem[] {
  const playable = playableOffline(track)
  const why = whyNotPlayable(track) ?? 'Orbis has no audio for this track.'
  const items: ActionItem[] = [
    { id: 'play', label: 'Play', ...(playable ? {} : { off: true, why }) },
    { id: 'play-next', label: 'Play next', ...(playable ? {} : { off: true, why }) },
    { id: 'queue-end', label: 'Add to what is coming next', ...(playable ? {} : { off: true, why }) }
  ]
  if (where.queueAt !== undefined) items.push({ id: 'queue-remove', label: 'Take out of what is coming next' })
  items.push({ id: 'add-to-playlist', label: 'Add to a playlist', line: true })
  items.push(
    track.favourite === true ? { id: 'unfavourite', label: 'Take out of favourites' } : { id: 'favourite', label: 'Add to favourites' }
  )
  if (where.playlistId !== undefined) {
    items.push(
      where.playlistWorkedOut === true
        ? {
            id: 'playlist-remove',
            label: 'Take out of this playlist',
            off: true,
            why: 'This playlist is worked out from your music, so songs cannot be taken out of it by hand.'
          }
        : { id: 'playlist-remove', label: 'Take out of this playlist' }
    )
  }
  // Only offered when the file names one. An album page for "Unknown album" would be a screen about nothing.
  if (track.album) items.push({ id: 'go-album', label: 'Go to the album', line: true })
  if (track.artist) items.push({ id: 'go-artist', label: 'Go to the artist', ...(track.album ? {} : { line: true }) })
  return items
}

/** The menu for an album or an artist: a group of songs worked out from the library, so the same two actions. */
export function groupMenu(kind: 'album' | 'artist', has: { readonly playable: number }): readonly ActionItem[] {
  const none = has.playable === 0
  const why = 'None of these songs has audio on this computer.'
  const play: ActionId = kind === 'album' ? 'play-album' : 'play-artist'
  const queue: ActionId = kind === 'album' ? 'queue-album' : 'queue-artist'
  return [
    { id: play, label: 'Play', ...(none ? { off: true, why } : {}) },
    { id: queue, label: 'Add to what is coming next', ...(none ? { off: true, why } : {}) },
    { id: 'add-to-playlist', label: 'Add to a playlist', line: true }
  ]
}

/**
 * The menu for a playlist.
 *
 * A playlist that is worked out from the library can be played and renamed and removed like any other -- the rule is
 * answered afresh every time it is asked for -- so nothing here is switched off for it. An empty one cannot be
 * played, and says so.
 */
export function playlistMenu(list: Pick<Playlist, 'id' | 'rule'> & { readonly count?: number }): readonly ActionItem[] {
  const empty = list.rule === undefined && list.count === 0
  const why = 'There are no songs in this playlist yet.'
  return [
    { id: 'play-playlist', label: 'Play', ...(empty ? { off: true, why } : {}) },
    { id: 'queue-playlist', label: 'Add to what is coming next', ...(empty ? { off: true, why } : {}) },
    { id: 'rename-playlist', label: 'Rename', line: true },
    { id: 'remove-playlist', label: 'Remove this playlist' }
  ]
}

// ---------------------------------------------------------------- keyboard shortcuts

export type ShortcutId =
  | 'play-pause'
  | 'back-a-bit'
  | 'on-a-bit'
  | 'back-a-lot'
  | 'on-a-lot'
  | 'louder'
  | 'quieter'
  | 'next'
  | 'previous'
  | 'mute'
  | 'shuffle'
  | 'repeat'
  | 'favourite'
  | 'search'
  | 'sheet'

/** How much one press moves things. Here rather than in the page so the sheet can say the real numbers. */
export const SEEK_STEP = 5
export const SEEK_JUMP = 30
export const VOLUME_STEP = 0.05

/** One press, as it is matched against a real key press. */
export interface Press {
  readonly key: string
  readonly shiftKey?: boolean
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly metaKey?: boolean
}

export interface Shortcut {
  readonly id: ShortcutId
  /** What is pressed, written the way it is written on the sheet. More than one when either will do. */
  readonly keys: readonly string[]
  /** What it does, in plain words. This is exactly what the sheet shows. */
  readonly does: string
  readonly group: 'Playing' | 'The sound' | 'This page'
  /** What a real press is compared against. Anything not named here must not be held down. */
  readonly match: readonly Press[]
}

/**
 * Every shortcut there is.
 *
 * This table is the only list. The sheet is worked out from it and the matching reads it, so a shortcut that works
 * and is not written down, or is written down and does nothing, cannot happen.
 *
 * Nothing here uses Ctrl or Alt on its own letters: those belong to the browser, and a music page quietly taking
 * Ctrl+F or Alt+Left away from somebody is worse than having no shortcut. The media keys are included because a
 * keyboard that has them means them.
 */
export const SHORTCUTS: readonly Shortcut[] = Object.freeze([
  {
    id: 'play-pause',
    keys: ['Space'],
    does: 'Play, or pause',
    group: 'Playing',
    match: [{ key: ' ' }]
  },
  {
    id: 'back-a-bit',
    keys: ['Left arrow'],
    does: `Back ${SEEK_STEP} seconds`,
    group: 'Playing',
    match: [{ key: 'ArrowLeft' }]
  },
  {
    id: 'on-a-bit',
    keys: ['Right arrow'],
    does: `On ${SEEK_STEP} seconds`,
    group: 'Playing',
    match: [{ key: 'ArrowRight' }]
  },
  {
    id: 'back-a-lot',
    keys: ['Shift + left arrow'],
    does: `Back ${SEEK_JUMP} seconds`,
    group: 'Playing',
    match: [{ key: 'ArrowLeft', shiftKey: true }]
  },
  {
    id: 'on-a-lot',
    keys: ['Shift + right arrow'],
    does: `On ${SEEK_JUMP} seconds`,
    group: 'Playing',
    match: [{ key: 'ArrowRight', shiftKey: true }]
  },
  {
    id: 'next',
    keys: ['N', 'Next track key'],
    does: 'The next song',
    group: 'Playing',
    match: [{ key: 'n' }, { key: 'MediaTrackNext' }]
  },
  {
    id: 'previous',
    keys: ['P', 'Previous track key'],
    does: 'The song before',
    group: 'Playing',
    match: [{ key: 'p' }, { key: 'MediaTrackPrevious' }]
  },
  {
    id: 'shuffle',
    keys: ['S'],
    does: 'Shuffle on or off',
    group: 'Playing',
    match: [{ key: 's' }]
  },
  {
    id: 'repeat',
    keys: ['R'],
    does: 'Repeat: off, then everything, then this one',
    group: 'Playing',
    match: [{ key: 'r' }]
  },
  {
    id: 'favourite',
    keys: ['F'],
    does: 'Favourite what is playing, or take it out again',
    group: 'Playing',
    match: [{ key: 'f' }]
  },
  {
    id: 'louder',
    keys: ['Up arrow'],
    does: 'Louder',
    group: 'The sound',
    match: [{ key: 'ArrowUp' }]
  },
  {
    id: 'quieter',
    keys: ['Down arrow'],
    does: 'Quieter',
    group: 'The sound',
    match: [{ key: 'ArrowDown' }]
  },
  {
    id: 'mute',
    keys: ['M'],
    does: 'Mute, or turn the sound back on',
    group: 'The sound',
    match: [{ key: 'm' }]
  },
  {
    id: 'search',
    keys: ['/'],
    does: 'Search your music',
    group: 'This page',
    match: [{ key: '/' }]
  },
  {
    id: 'sheet',
    keys: ['?'],
    does: 'Show this list',
    group: 'This page',
    match: [{ key: '?' }, { key: '/', shiftKey: true }]
  }
])

/**
 * Which shortcut a press is, or none.
 *
 * Ctrl, Alt and the Windows key are never part of a shortcut here, so a press holding one of them is not one of ours
 * and is left for the browser. Shift is part of a few, and must match exactly: Shift+Right is a bigger jump than
 * Right, and treating one as the other would make the jump unreliable rather than wrong.
 */
export function shortcutFor(press: Press): Shortcut | null {
  if (press.ctrlKey === true || press.altKey === true || press.metaKey === true) return null
  const shift = press.shiftKey === true
  for (const shortcut of SHORTCUTS) {
    for (const want of shortcut.match) {
      if ((want.shiftKey === true) !== shift) continue
      if (want.key.length === 1 && press.key.length === 1) {
        if (want.key.toLowerCase() === press.key.toLowerCase()) return shortcut
        continue
      }
      if (want.key === press.key) return shortcut
    }
  }
  return null
}

export interface SheetGroup {
  readonly group: Shortcut['group']
  readonly rows: readonly { readonly keys: readonly string[]; readonly does: string }[]
}

/**
 * The shortcuts sheet, worked out from the table above.
 *
 * Nothing is written out again here. A shortcut added to the table appears on the sheet with no further edit, which
 * is the whole reason this is a function and not a page of words.
 */
export function shortcutSheet(): readonly SheetGroup[] {
  const order: Shortcut['group'][] = ['Playing', 'The sound', 'This page']
  return order
    .map((group) => ({
      group,
      rows: SHORTCUTS.filter((one) => one.group === group).map((one) => ({ keys: one.keys, does: one.does }))
    }))
    .filter((one) => one.rows.length > 0)
}

// ---------------------------------------------------------------- dragging

/** What is being dragged. Only ever track ids: a dropped song is a song the library already holds. */
export interface Dragged {
  readonly trackIds: readonly string[]
  /** Where the songs were picked up from, when that was the queue, so a drop back into the queue is a move. */
  readonly fromQueueAt?: number
}

export type DropAnswer = { readonly ok: true } | { readonly ok: false; readonly why: string }

/**
 * Whether these songs can go into this playlist.
 *
 * A playlist with a rule is worked out from the library every time it is read, so putting a song into it by hand
 * would be forgotten the moment it was next looked at. Refused with a sentence rather than accepted and lost.
 */
export function canDropOnPlaylist(dragged: Dragged, list: Pick<Playlist, 'rule'>): DropAnswer {
  if (dragged.trackIds.length === 0) return { ok: false, why: 'Nothing was dragged.' }
  if (list.rule !== undefined) return { ok: false, why: 'This playlist is worked out from your music, so songs cannot be put into it by hand.' }
  return { ok: true }
}

/**
 * Whether these songs can be lined up to play.
 *
 * A song with no audio on this computer cannot be queued: the queue is what plays next, and an entry that will
 * always refuse to play is not a thing to put in it.
 */
export function canDropOnQueue(tracks: readonly OrbisTrack[]): DropAnswer {
  if (tracks.length === 0) return { ok: false, why: 'Nothing was dragged.' }
  const playable = tracks.filter((one) => playableOffline(one))
  if (playable.length === 0) {
    return { ok: false, why: tracks.length === 1 ? (whyNotPlayable(tracks[0] as OrbisTrack) ?? 'Orbis has no audio for that track.') : 'None of those songs has audio on this computer.' }
  }
  return { ok: true }
}

/**
 * Where a drop lands in a list, given the row it was let go over and which half of that row the pointer was in.
 *
 * The top half means above the row, the bottom half means below it. That is the usual meaning and the only one that
 * lets somebody drop a song at the very end of a list.
 */
export const dropIndex = (overIndex: number, inTopHalf: boolean): number => Math.max(0, overIndex + (inTopHalf ? 0 : 1))

/**
 * Where a row really ends up when it is moved within one list.
 *
 * A row taken out of the list before it is put back shifts everything after it up one, so dropping row 2 at slot 5
 * lands it at 4. Worked out here, once, because a reorder that lands one place out every time it moves downwards is
 * the classic drag-and-drop fault and it is a sum, not a screen.
 */
export function moveTarget(from: number, to: number): number | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) return null
  const landing = to > from ? to - 1 : to
  if (landing === from) return null
  return landing
}
