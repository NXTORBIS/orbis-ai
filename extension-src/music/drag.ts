/**
 * Dragging songs about.
 *
 * Two things can be dropped on, and both are set up here rather than by the screens: a playlist down the left, and
 * what is coming next in the column on the right. A screen that marks its rows (see `marked.ts`) can drag them
 * without writing a line of this.
 *
 * **Only track ids travel.** The thing being dragged is carried as a list of ids under this page's own name, plus the
 * titles as plain text so dropping a song into a text box somewhere writes its name. No file path ever goes into a
 * drag: a path is the one thing about a song that the browser side is never told.
 *
 * **Where a drop can go is what the service can really do.** The music service can put songs next, or at the end, or
 * move one entry in the queue from one place to another. It cannot insert at an arbitrary spot. So a drop onto the
 * top of what is coming next means "play these next", a drop anywhere else in it means "put them at the end", and the
 * note along the bottom says which of the two happened -- rather than drawing an insertion line at a place the queue
 * cannot actually hold.
 *
 * **A refusal is in words.** A song with no audio on this computer cannot be lined up to play, and a playlist worked
 * out from the library cannot be added to by hand. Both say so when the hand lets go, because a drop that silently
 * does nothing reads as a broken page.
 */

import { canDropOnPlaylist, canDropOnQueue, moveTarget } from '../../src/shared/music/actions.ts'
import { playableOffline } from '../../src/shared/music.ts'
import type { OrbisTrack, Playlist } from '../../src/shared/music.ts'
import * as music from './client.ts'
import { markedAt, playlistsChanged } from './marked.ts'
import * as player from './player.ts'
import { doAndSay, note } from './shell.ts'

/** This page's own name for what is being dragged. A drag from anywhere else does not carry it, and is ignored. */
const SONGS = 'application/x-orbis-music-songs'

interface Carried {
  readonly tracks: readonly OrbisTrack[]
  /** Where it was picked up from in the queue, counted from the start of the queue, when that is where it came from. */
  readonly fromQueueAt?: number
}

/**
 * What is in the hand right now.
 *
 * Kept here as well as in the drag itself because a browser will not let a page read what is being dragged until it
 * is dropped -- only the names of the kinds of thing it holds. Deciding whether a drop is allowed has to happen while
 * it is still moving, so the answer comes from here and the drag's own copy is what makes dropping into a text box
 * elsewhere work.
 */
let carried: Carried | null = null

const titles = (tracks: readonly OrbisTrack[]): string => tracks.map((one) => [one.artist, one.title].filter((word) => word).join(' - ')).join('\n')

// ---------------------------------------------------------------- picking something up

function pickUp(event: DragEvent): void {
  const found = markedAt(event.target)
  if (!found || found.what.kind !== 'track') return
  const track = found.what.track
  carried = { tracks: [track], fromQueueAt: found.what.where.queueAt }
  const moving = event.dataTransfer
  if (!moving) return
  moving.effectAllowed = 'copyMove'
  moving.setData(SONGS, JSON.stringify([track.id]))
  moving.setData('text/plain', titles([track]))
  found.node.classList.add('om-dragging')
}

function putDown(): void {
  carried = null
  for (const node of document.querySelectorAll('.om-dragging')) node.classList.remove('om-dragging')
  for (const node of document.querySelectorAll('.om-drop-on, .om-drop-no, .om-drop-above, .om-drop-below')) {
    node.classList.remove('om-drop-on', 'om-drop-no', 'om-drop-above', 'om-drop-below')
  }
}

/** The direct child of a list that holds whatever the pointer is over. `closest` cannot ask that question. */
function rowIn(list: HTMLElement, target: EventTarget | null): HTMLElement | null {
  let node = target instanceof Element ? target : null
  while (node && node.parentElement !== list) node = node.parentElement
  return node instanceof HTMLElement ? node : null
}

const ours = (event: DragEvent): boolean => carried !== null && event.dataTransfer?.types.includes(SONGS) === true

// ---------------------------------------------------------------- a playlist down the left

function playlistUnder(event: DragEvent): { readonly node: HTMLElement; readonly list: Playlist } | null {
  const found = markedAt(event.target)
  if (!found || found.what.kind !== 'playlist') return null
  return { node: found.node, list: found.what.list }
}

async function dropOnPlaylist(list: Playlist, tracks: readonly OrbisTrack[]): Promise<void> {
  const ids = tracks.map((one) => one.id)
  const allowed = canDropOnPlaylist({ trackIds: ids }, list)
  if (!allowed.ok) {
    note(allowed.why)
    return
  }
  const answer = await music.addToPlaylist(list.id, ids)
  playlistsChanged()
  if (!answer.got) {
    note(answer.shut ? 'Orbis Music is not open, so nothing was added.' : answer.why)
    return
  }
  if (answer.value === null) {
    note(`Orbis Music did not add anything to ${list.name}.`)
    return
  }
  note(ids.length === 1 ? `Added to ${list.name}.` : `${ids.length} songs added to ${list.name}.`)
}

// ---------------------------------------------------------------- what is coming next, down the right

/**
 * Which entry of the queue a row in the column on the right is.
 *
 * The column shows the twenty after the one playing, so the first row is not entry nought. The offset comes from the
 * player's own answer rather than being counted here, because the queue can move underneath the column between a
 * drag starting and it ending.
 */
function queueIndexOf(row: Element): number | null {
  const list = row.parentElement
  if (!list) return null
  const rows = [...list.children]
  const at = rows.indexOf(row)
  if (at < 0) return null
  const playing = player.current().music?.playback.at
  if (playing === undefined) return null
  return playing + 1 + at
}

async function dropOnQueue(event: DragEvent, hand: Carried): Promise<void> {
  const row = (event.target instanceof Element ? event.target : null)?.closest('.om-col-queue-row') ?? null
  const toTheTop = row !== null && isTopHalf(event, row)

  // Moving one entry of the queue to another place in it, which is the one thing the service can do by position.
  if (hand.fromQueueAt !== undefined && row) {
    const over = queueIndexOf(row)
    if (over === null) {
      note('Orbis could not work out where that was being moved to.')
      return
    }
    const landing = moveTarget(hand.fromQueueAt, toTheTop ? over : over + 1)
    if (landing === null) return
    await doAndSay(music.queueReorder(hand.fromQueueAt, landing))
    return
  }

  const allowed = canDropOnQueue(hand.tracks)
  if (!allowed.ok) {
    note(allowed.why)
    return
  }
  const ids = hand.tracks.filter((one) => playableOffline(one)).map((one) => one.id)
  // Next, or at the end: those are the two places the queue can take something, so those are the two a drop means.
  if (toTheTop) {
    await doAndSay(music.queueNext(ids))
    note(ids.length === 1 ? 'Playing next.' : `${ids.length} songs playing next.`)
    return
  }
  await doAndSay(music.queueEnd(ids))
  note(ids.length === 1 ? 'Added to the end of what is coming next.' : `${ids.length} songs added to the end of what is coming next.`)
}

/** Which half of a row the pointer is in. The top half means above it, which is the usual meaning everywhere. */
function isTopHalf(event: DragEvent, row: Element): boolean {
  const box = row.getBoundingClientRect()
  return event.clientY < box.top + box.height / 2
}

// ---------------------------------------------------------------- the listeners

/**
 * Starts listening for drags.
 *
 * All of it is on the page rather than on the rows, so a row built after this ran is dragged exactly like one built
 * before it. `dragover` has to say the drop is allowed by stopping the event, which is the one piece of this that
 * reads oddly and is how dropping works in every browser.
 */
export function startDragging(): void {
  addEventListener('dragstart', pickUp)
  addEventListener('dragend', () => putDown())

  addEventListener('dragover', (event) => {
    if (!ours(event)) return
    const hand = carried
    if (!hand) return
    const onto = placeUnder(event)
    if (!onto) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = hand.fromQueueAt !== undefined && onto.kind === 'queue' ? 'move' : 'copy'
    onto.node.classList.add(onto.allowed ? 'om-drop-on' : 'om-drop-no')
  })

  addEventListener('dragleave', (event) => {
    const onto = placeUnder(event)
    onto?.node.classList.remove('om-drop-on', 'om-drop-no')
  })

  addEventListener('drop', (event) => {
    if (!ours(event)) return
    const hand = carried
    const onto = placeUnder(event)
    if (!hand || !onto) return
    event.preventDefault()
    onto.node.classList.remove('om-drop-on', 'om-drop-no')
    if (onto.kind === 'playlist' && onto.list) void dropOnPlaylist(onto.list, hand.tracks)
    else if (onto.kind === 'queue') void dropOnQueue(event, hand)
    carried = null
  })
}

interface Place {
  readonly kind: 'playlist' | 'queue'
  /** What is lit up while the pointer is over it. */
  readonly node: HTMLElement
  readonly allowed: boolean
  readonly list?: Playlist
}

/** What is under the pointer, and whether a drop there would be taken. */
function placeUnder(event: DragEvent): Place | null {
  const hand = carried
  if (!hand) return null
  const playlist = playlistUnder(event)
  if (playlist) {
    return { kind: 'playlist', node: playlist.node, allowed: canDropOnPlaylist({ trackIds: hand.tracks.map((one) => one.id) }, playlist.list).ok, list: playlist.list }
  }
  const target = event.target instanceof Element ? event.target : null
  const column = target?.closest('.om-col-queue, .om-column')
  if (column instanceof HTMLElement) {
    const allowed = hand.fromQueueAt !== undefined || canDropOnQueue(hand.tracks).ok
    return { kind: 'queue', node: column, allowed }
  }
  return null
}

/**
 * Offered to a screen that lists a playlist's own songs and wants them reorderable.
 *
 * The queue and the sidebar are handled above because they are part of the frame and every screen has them. A
 * playlist's own list of songs belongs to whichever screen draws it, so it gets the same behaviour from one call
 * rather than from a copy of this file. `rows` must be the element holding one child per song, in order.
 *
 * Two traps are already handled here, both of which have bitten this codebase before: the row being dragged is left
 * where it is rather than taken out of the list, because taking an element out from under a pointer loses the
 * pointer; and the place it lands is worked out with `moveTarget`, which takes the row out before it puts it back, so
 * a move downwards does not land one short every single time.
 */
export function reorderable(rows: HTMLElement, list: Playlist, onDone: () => void): void {
  if (list.rule !== undefined) return
  rows.addEventListener('dragover', (event) => {
    const hand = carried
    if (!hand || hand.fromQueueAt !== undefined || !ours(event)) return
    const row = rowIn(rows, event.target)
    if (!row) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    for (const one of rows.children) one.classList.remove('om-drop-above', 'om-drop-below')
    row.classList.add(isTopHalf(event, row) ? 'om-drop-above' : 'om-drop-below')
  })
  rows.addEventListener('dragleave', () => {
    for (const one of rows.children) one.classList.remove('om-drop-above', 'om-drop-below')
  })
  rows.addEventListener('drop', (event) => {
    const hand = carried
    if (!hand || !ours(event)) return
    event.preventDefault()
    for (const one of rows.children) one.classList.remove('om-drop-above', 'om-drop-below')
    const row = rowIn(rows, event.target)
    if (!row) return
    const dragged = hand.tracks[0]
    if (!dragged) return
    const order = [...rows.children].filter((one): one is HTMLElement => one instanceof HTMLElement)
    const songIn = (node: HTMLElement): string | null => {
      const found = markedAt(node)
      return found && found.what.kind === 'track' ? found.what.track.id : null
    }
    const from = order.findIndex((one) => songIn(one) === dragged.id)
    const over = order.indexOf(row)
    if (from < 0 || over < 0) {
      // The song came from somewhere else, so this is adding it rather than moving it.
      void dropOnPlaylist(list, hand.tracks).then(onDone)
      return
    }
    const landing = moveTarget(from, isTopHalf(event, row) ? over : over + 1)
    if (landing === null) return
    void (async () => {
      await doAndSay(music.reorderPlaylist(list.id, from, landing))
      playlistsChanged()
      onDone()
    })()
  })
}
