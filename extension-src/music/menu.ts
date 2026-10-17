/**
 * The right-click menu, and the two small boxes that ask a question.
 *
 * One menu, one listener, one place. The listener is on the whole page and finds the nearest marked element above
 * whatever was right-clicked (see `marked.ts`), so a song gets a song's menu whether it is in the library, in a
 * playlist, in what is coming next or in a list of search results -- and a screen that marks its rows gets the menu
 * for nothing. That is the point of keeping it here: six screens with six menus would be six places for "add to a
 * playlist" to mean six slightly different things.
 *
 * What a menu may offer is decided in src/shared/music/actions.ts, which is tested and has no screen near it. This
 * file only draws the answer and does what was pressed. Everything it does goes through `client.ts` and is read back
 * from the player afterwards, exactly as a press on the player bar is, so a refused action says so in the music
 * service's own words rather than looking as though it worked.
 *
 * The three things that are not offered, and why: there is no "share" because there is nowhere to share to; there is
 * no "download" because nothing is ever downloaded; and there is no "go to the artist" for a file that names no
 * artist, because that screen would be about nothing.
 */

import { playableOffline } from '../../src/shared/music.ts'
import type { OrbisTrack, Playlist } from '../../src/shared/music.ts'
import { groupMenu, playlistMenu, trackMenu, type ActionId, type ActionItem } from '../../src/shared/music/actions.ts'
import * as music from './client.ts'
import { button, el } from './dom.ts'
import { icon } from './icons.ts'
import { markedAt, playlistsChanged, type Marked } from './marked.ts'
import { go } from './router.ts'
import { doAndSay, note } from './shell.ts'

// ---------------------------------------------------------------- the one popup on screen

interface Open {
  readonly root: HTMLElement
  /** What had the focus before the menu opened, so Escape can give it back. */
  readonly cameFrom: Element | null
}

let open: Open | null = null

export function closeMenu(): void {
  if (!open) return
  const back = open.cameFrom
  open.root.remove()
  open = null
  if (back instanceof HTMLElement && document.contains(back)) back.focus()
}

/** Puts the menu where the pointer is, then pulls it back onto the screen if it would hang off an edge. */
function place(root: HTMLElement, at: { readonly x: number; readonly y: number }): void {
  root.style.left = '0px'
  root.style.top = '0px'
  const size = root.getBoundingClientRect()
  const x = Math.max(8, Math.min(at.x, innerWidth - size.width - 8))
  const y = Math.max(8, Math.min(at.y, innerHeight - size.height - 8))
  root.style.left = `${Math.round(x)}px`
  root.style.top = `${Math.round(y)}px`
}

interface Entry {
  readonly label: string
  readonly why?: string
  readonly off?: boolean
  readonly line?: boolean
  readonly onPick: () => void
}

/**
 * Shows a menu of entries at a point.
 *
 * Keyboard first: the first entry that can be pressed takes the focus, the arrow keys walk the list, Escape closes and
 * gives the focus back to whatever had it. An entry that is switched off is still read out, with its reason as its
 * title, because knowing why a song cannot be played is the useful part.
 */
export function showMenu(at: { readonly x: number; readonly y: number }, title: string, entries: readonly Entry[]): void {
  closeMenu()
  const cameFrom = document.activeElement
  const root = el('div', { cls: 'om-menu', attrs: { role: 'menu', 'aria-label': title } })
  for (const entry of entries) {
    if (entry.line) root.append(el('div', { cls: 'om-menu-line', attrs: { role: 'separator' } }))
    const item = button(
      {
        cls: `om-menu-item${entry.off ? ' om-menu-off' : ''}`,
        text: entry.label,
        title: entry.why,
        attrs: { role: 'menuitem', 'aria-disabled': entry.off ? 'true' : null, tabindex: '-1' },
        onClick: () => {
          if (entry.off) {
            // The reason is said rather than the press being ignored: a button that does nothing at all reads as a
            // fault in the page, where the real answer is that this song has no audio on this computer.
            note(entry.why ?? 'That cannot be done here.')
            return
          }
          closeMenu()
          entry.onPick()
        }
      },
      []
    )
    root.append(item)
  }
  root.addEventListener('keydown', (event) => {
    const press = event as KeyboardEvent
    const items = [...root.querySelectorAll('.om-menu-item')].filter((one): one is HTMLElement => one instanceof HTMLElement)
    const here = items.indexOf(document.activeElement as HTMLElement)
    if (press.key === 'Escape') {
      press.preventDefault()
      closeMenu()
      return
    }
    if (press.key === 'ArrowDown' || press.key === 'ArrowUp') {
      press.preventDefault()
      const step = press.key === 'ArrowDown' ? 1 : -1
      const next = items[(here + step + items.length) % items.length]
      next?.focus()
    }
  })
  document.body.append(root)
  open = { root, cameFrom }
  place(root, at)
  const first = root.querySelector('.om-menu-item:not(.om-menu-off)')
  if (first instanceof HTMLElement) first.focus()
}

// ---------------------------------------------------------------- asking a question

/**
 * A box that asks for some words, or for a yes.
 *
 * The page's own rather than the browser's `prompt` and `confirm`: those freeze everything, cannot be styled, and in
 * the panel before this page they were the one place Orbis looked like somebody else's software.
 */
function askBox(options: {
  readonly title: string
  readonly detail?: string
  readonly placeholder?: string
  readonly startWith?: string
  readonly yes: string
  readonly danger?: boolean
  readonly onYes: (words: string) => void
}): void {
  const cameFrom = document.activeElement
  const input = options.placeholder !== undefined || options.startWith !== undefined
    ? el('input', {
        cls: 'om-ask-input',
        attrs: { type: 'text', maxlength: '200', placeholder: options.placeholder ?? '', value: options.startWith ?? '', 'aria-label': options.title }
      })
    : null
  const shut = (): void => {
    cover.remove()
    if (cameFrom instanceof HTMLElement && document.contains(cameFrom)) cameFrom.focus()
  }
  const say = (): void => {
    const words = input ? input.value.trim() : ''
    if (input && words === '') {
      input.focus()
      return
    }
    shut()
    options.onYes(words)
  }
  const box = el('div', { cls: 'om-ask', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title } }, [
    el('h2', { cls: 'om-ask-title', text: options.title }),
    options.detail ? el('p', { cls: 'om-ask-detail', text: options.detail }) : null,
    input,
    el('div', { cls: 'om-ask-row' }, [
      button({ cls: 'om-btn om-btn-quiet', text: 'Cancel', onClick: shut }),
      button({ cls: `om-btn ${options.danger ? 'om-btn-danger' : 'om-btn-primary'}`, text: options.yes, onClick: say })
    ])
  ])
  const cover = el('div', { cls: 'om-cover' }, [box])
  cover.addEventListener('click', (event) => {
    if (event.target === cover) shut()
  })
  cover.addEventListener('keydown', (event) => {
    const press = event as KeyboardEvent
    if (press.key === 'Escape') {
      press.preventDefault()
      shut()
    }
    if (press.key === 'Enter' && input && press.target === input) {
      press.preventDefault()
      say()
    }
  })
  document.body.append(cover)
  if (input) {
    input.focus()
    input.select()
  } else {
    const yes = cover.querySelector('.om-btn-primary, .om-btn-danger')
    if (yes instanceof HTMLElement) yes.focus()
  }
}

// ---------------------------------------------------------------- putting songs into a playlist

/** The playlists songs can be put into by hand. One worked out from the library is left out: see `canDropOnPlaylist`. */
async function listsToChooseFrom(): Promise<readonly Playlist[] | null> {
  const answer = await music.playlists()
  if (!answer.got) {
    note(answer.shut ? 'Open the Orbis window to see your playlists.' : answer.why)
    return null
  }
  return answer.value.filter((one) => one.rule === undefined)
}

/**
 * Shows the playlists one or more songs can go into, and the way to make a new one holding them.
 *
 * Offered as a second menu rather than a screen, because choosing a list is one press and leaving the screen to make
 * it would lose whatever was being looked at.
 */
export async function chooseAPlaylist(at: { readonly x: number; readonly y: number }, trackIds: readonly string[]): Promise<void> {
  if (trackIds.length === 0) return
  const lists = await listsToChooseFrom()
  if (!lists) return
  const entries: Entry[] = lists.map((list) => ({
    label: list.name,
    onPick: () => void addTo(list, trackIds)
  }))
  entries.push({
    label: 'New playlist…',
    line: entries.length > 0,
    onPick: () =>
      askBox({
        title: trackIds.length === 1 ? 'Name the new playlist' : `A new playlist of ${trackIds.length} songs`,
        placeholder: 'What it is called',
        yes: 'Make it',
        onYes: (name) => {
          playlistsChanged()
          void doAndSay(music.createPlaylist(name, trackIds))
        }
      })
  })
  if (lists.length === 0) {
    entries.unshift({ label: 'You have no playlists you can add to yet', off: true, why: 'A playlist worked out from your music cannot be added to by hand.', onPick: () => {} })
  }
  showMenu(at, 'Add to a playlist', entries)
}

async function addTo(list: Playlist, trackIds: readonly string[]): Promise<void> {
  const answer = await music.addToPlaylist(list.id, trackIds)
  playlistsChanged()
  if (!answer.got) {
    note(answer.shut ? 'Orbis Music is not open, so nothing was added.' : answer.why)
    return
  }
  if (answer.value === null) {
    note(`Orbis Music did not add anything to ${list.name}.`)
    return
  }
  note(trackIds.length === 1 ? `Added to ${list.name}.` : `${trackIds.length} songs added to ${list.name}.`)
}

// ---------------------------------------------------------------- doing what was pressed

const playableIds = (tracks: readonly OrbisTrack[]): string[] => tracks.filter((one) => playableOffline(one)).map((one) => one.id)

async function queueThePlaylist(list: Playlist): Promise<void> {
  // Always asked for rather than read off the playlist: a playlist worked out from the library has a rule, not a
  // list, and `list.tracks` on one of those is not what it holds.
  const answer = await music.playlistTracks(list.id)
  if (!answer.got) {
    note(answer.shut ? 'Orbis Music is not open.' : answer.why)
    return
  }
  const ids = playableIds(answer.value)
  if (ids.length === 0) {
    note(`There is nothing in ${list.name} with audio on this computer.`)
    return
  }
  await doAndSay(music.queueEnd(ids))
}

function doAction(id: ActionId, what: Marked, at: { readonly x: number; readonly y: number }): void {
  if (what.kind === 'track') {
    const track = what.track
    const where = what.where
    switch (id) {
      case 'play':
        void doAndSay(music.play(track.id))
        return
      case 'play-next':
        void doAndSay(music.queueNext([track.id]))
        return
      case 'queue-end':
        void doAndSay(music.queueEnd([track.id]))
        return
      case 'queue-remove':
        if (where.queueAt === undefined) return
        void doAndSay(music.queueRemove(where.queueAt))
        return
      case 'favourite':
      case 'unfavourite':
        void doAndSay(music.setFavourite(track.id, id === 'favourite'))
        return
      case 'add-to-playlist':
        void chooseAPlaylist(at, [track.id])
        return
      case 'playlist-remove':
        if (where.playlistId === undefined) return
        playlistsChanged()
        void doAndSay(music.removeFromPlaylist(where.playlistId, track.id))
        return
      case 'go-album':
        go('album', track.album)
        return
      case 'go-artist':
        go('artist', track.artist)
        return
      default:
        return
    }
  }
  if (what.kind === 'album' || what.kind === 'artist') {
    const ids = playableIds(what.tracks)
    switch (id) {
      case 'play-album':
      case 'play-artist':
        void doAndSay(music.playAll(ids))
        return
      case 'queue-album':
      case 'queue-artist':
        void doAndSay(music.queueEnd(ids))
        return
      case 'add-to-playlist':
        // Every song, not only the ones that can be played: a playlist is a list of songs, and a song Orbis only
        // knows the name of belongs in one just as much as a file does.
        void chooseAPlaylist(at, what.tracks.map((one) => one.id))
        return
      default:
        return
    }
  }
  const list = what.list
  switch (id) {
    case 'play-playlist':
      void doAndSay(music.playPlaylist(list.id))
      return
    case 'queue-playlist':
      void queueThePlaylist(list)
      return
    case 'rename-playlist':
      askBox({
        title: 'Rename this playlist',
        startWith: list.name,
        yes: 'Rename it',
        onYes: (name) => {
          playlistsChanged()
          void doAndSay(music.renamePlaylist(list.id, name))
        }
      })
      return
    case 'remove-playlist':
      askBox({
        title: `Remove ${list.name}?`,
        detail: 'The songs stay in your music. Only the playlist goes.',
        yes: 'Remove it',
        danger: true,
        onYes: () => {
          playlistsChanged()
          void doAndSay(music.removePlaylist(list.id))
        }
      })
      return
    default:
      return
  }
}

// ---------------------------------------------------------------- what to show for a thing

function entriesFor(what: Marked, at: { readonly x: number; readonly y: number }): readonly Entry[] {
  const items: readonly ActionItem[] =
    what.kind === 'track'
      ? trackMenu(what.track, what.where)
      : what.kind === 'album' || what.kind === 'artist'
        ? groupMenu(what.kind, { playable: playableIds(what.tracks).length })
        : playlistMenu({ id: what.list.id, rule: what.list.rule, count: what.list.tracks.length })
  return items.map((item) => ({
    label: item.label,
    why: item.why,
    off: item.off,
    line: item.line,
    onPick: () => doAction(item.id, what, at)
  }))
}

const nameOf = (what: Marked): string =>
  what.kind === 'track' ? what.track.title || 'This song' : what.kind === 'playlist' ? what.list.name : what.name

// ---------------------------------------------------------------- the one listener

/**
 * Starts listening for a right-click anywhere on the page.
 *
 * The browser's own menu is left alone everywhere a marked row is not involved, so right-clicking a web address or a
 * selection still does what it does in every other tab. Only a marked row takes the press.
 *
 * The same menu opens on the keyboard's own menu key and on Shift+F10, which the browser sends as a `contextmenu`
 * event with no pointer position; the row's own corner is used in that case so the menu appears next to the row.
 */
export function startMenus(): void {
  addEventListener(
    'contextmenu',
    (event) => {
      const found = markedAt(event.target)
      if (!found) return
      event.preventDefault()
      const pointer = event as MouseEvent
      const fromKeyboard = pointer.button === 0 && pointer.clientX === 0 && pointer.clientY === 0
      const box = found.node.getBoundingClientRect()
      const at = fromKeyboard ? { x: box.left + 24, y: box.top + box.height - 4 } : { x: pointer.clientX, y: pointer.clientY }
      showMenu(at, nameOf(found.what), entriesFor(found.what, at))
    },
    true
  )

  // A menu left open over a page that has moved on underneath it is worse than no menu, so anything that moves the
  // page shuts it: a press elsewhere, a scroll, the window changing size, or the address changing.
  addEventListener('pointerdown', (event) => {
    if (!open) return
    if (event.target instanceof Node && open.root.contains(event.target)) return
    closeMenu()
  })
  addEventListener('scroll', () => closeMenu(), true)
  addEventListener('resize', () => closeMenu())
  addEventListener('hashchange', () => closeMenu())
}

/** Offered to a screen that has a "more" button on a row: the same menu, opened without a right-click. */
export function openMenuFor(node: HTMLElement, at: { readonly x: number; readonly y: number }): void {
  const found = markedAt(node)
  if (!found) return
  showMenu(at, nameOf(found.what), entriesFor(found.what, at))
}

/** Offered to a screen: the box that asks for some words or for a yes, so there is one of those on the page and not six. */
export const ask = askBox

/** Offered to a screen that has made a list by itself, so the sidebar's marks are read again rather than kept. */
export { playlistsChanged }

/** Offered to a screen so a "more" button on a row can carry the same icon everywhere. */
export const moreIcon = (): SVGSVGElement => icon('more', 18)
