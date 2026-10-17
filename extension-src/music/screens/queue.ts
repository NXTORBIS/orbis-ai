/**
 * What is coming next, as a screen you can rearrange.
 *
 * The one list on this page that is not read-only. You can play from any point in it, take one entry out, empty the
 * whole thing, and drag an entry to a different place in the running order.
 *
 * **Where the order comes from.** Not from here. The player's queue is one flat array of track ids, `at` is where the
 * playing track sits in it, and every press on this screen is a queue operation sent to the player followed by
 * reading the player back. Nothing on screen is ever the result of what was last clicked -- the panel in the browser
 * sidebar, the Orb and Orion can all change the queue, and a screen that trusted its own last press would quietly
 * disagree with the music. The one exception lasts as long as a finger is down: while an entry is being dragged the
 * list holds still and the insertion line is drawn here, because a list that rebuilt itself under the pointer once a
 * second could not be dragged at all. The moment the hand lets go, the move is sent and the player is read back.
 *
 * **Why the ids are counted and not the tracks.** The player's answer carries both the raw id array and a list of
 * track rows, but the rows are those ids looked up in the library *with the misses dropped*. So the two are different
 * lengths the moment the queue holds a song that has since been taken out of the library, and the row at position
 * three of one is not the row at position three of the other. Every queue operation takes a position in the id array,
 * so this screen counts in the id array and looks each row up by id. An id with no row is still drawn, saying plainly
 * that the song is no longer in the library -- rather than silently shortening the queue on screen and then sending a
 * press about the wrong track.
 *
 * The maths of dragging -- which gap the pointer is nearest, and the number that gap means to a player that takes the
 * entry out before putting it back -- is in src/shared/music/queue.ts with a test beside it, because being one out
 * there is invisible by eye.
 */

import { clockText, countText, spanText } from '../../../src/shared/music/fulltab.ts'
import { canMove, gapNearest, queueLength, queueMoveTo, queueParts, type QueueSlot } from '../../../src/shared/music/queue.ts'
import type { OrbisTrack } from '../../../src/shared/music.ts'
import { playableOffline, whyNotPlayable } from '../../../src/shared/music.ts'
import { tile, want } from '../art.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import * as player from '../player.ts'
import { registerScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay } from '../shell.ts'

/** How many of the entries already played are kept on screen above the playing track. */
const GONE_SHOWN = 20

/** How many covers are asked for at once. The art store batches sixty per request; a screenful is plenty. */
const COVERS_WANTED = 40

/** How many ids the service will take in one "play all". Anything longer has its tail quietly dropped. */
const PLAY_ALL_LIMIT = 2000

interface Dragging {
  /** Where in the player's queue the entry being dragged sits. */
  readonly from: number
  /** The middle of every draggable row, in the list's own coordinates, measured once when the drag started. */
  readonly middles: readonly number[]
  /** Where each gap sits, in the same coordinates, so the line can be drawn without moving anything. */
  readonly edges: readonly number[]
  /** The queue position each measured row sits at, so a gap between rows can be turned back into a position. */
  readonly positions: readonly number[]
  readonly row: HTMLElement
  gap: number
}

function queueScreen(place: ScreenPlace): { onPlayer: (state: player.PlayerState) => void; onCovers: () => void; leave: () => void } {
  const head = el('div', { cls: 'om-q-head' })
  const list = el('div', { cls: 'om-q-list' })
  const line = el('div', { cls: 'om-q-line', attrs: { 'aria-hidden': 'true' } })
  fill(place.into, el('div', { cls: 'om-q' }, [head, list]))

  let dragging: Dragging | null = null
  /** What was last drawn, so an answer that changed nothing visible does not rebuild a list somebody is reading. */
  let drawn = ''

  // ---------------------------------------------------------------- dragging

  /**
   * The pointer's place in the list's own coordinates.
   *
   * Worked out afresh on every move rather than held from the start, because the list can scroll under the hand and a
   * number measured once would then point at the wrong gap. Reading the pointer's own page position would be worse:
   * memory records that those numbers lie whenever what is under them moves.
   */
  const inList = (clientY: number): number => clientY - list.getBoundingClientRect().top

  /**
   * Draws the line showing where the entry would land.
   *
   * Laid over the list rather than inserted between the rows, and the row being dragged stays exactly where it is.
   * Two reasons. Taking the row out of the flow would drop pointer capture, and the drag would then end the moment
   * the pointer left where the row had been. And a line pushed into the flow would move every row below it by its
   * own height, which puts them a little way off the middles measured when the drag started -- enough, right at a
   * boundary, for the line to flicker between two gaps while the hand holds still.
   */
  function showLine(): void {
    if (!dragging) return
    const at = dragging.edges[dragging.gap]
    if (at === undefined) return
    line.classList.add('om-on')
    line.style.setProperty('top', `${at}px`)
    if (line.parentElement !== list) list.append(line)
  }

  const movableRows = (): HTMLElement[] => [...list.querySelectorAll('.om-q-row-move')].filter((one): one is HTMLElement => one instanceof HTMLElement)

  function startDrag(event: PointerEvent, from: number, row: HTMLElement): void {
    // One pointer, the main button. A right-click or a second finger is not a reorder.
    if (!event.isPrimary || event.button !== 0) return
    const rows = movableRows()
    const top = list.getBoundingClientRect().top
    const boxes = rows.map((one) => one.getBoundingClientRect())
    const middles = boxes.map((box) => box.top - top + box.height / 2)
    // One edge per gap: the top of each row, and then the bottom of the last one for the gap below everything.
    const edges = boxes.map((box) => box.top - top)
    const last = boxes[boxes.length - 1]
    if (last) edges.push(last.bottom - top)
    const positions = rows.map((one) => Number(one.dataset.at))
    const gap = positions.indexOf(from)
    if (gap < 0) return
    dragging = { from, middles, edges, positions, row, gap }
    row.classList.add('om-q-dragging')
    row.setPointerCapture(event.pointerId)
    showLine()
    event.preventDefault()
  }

  function moveDrag(event: Event): void {
    if (!dragging || !(event instanceof PointerEvent)) return
    const gap = gapNearest(dragging.middles, inList(event.clientY))
    if (gap === dragging.gap) return
    dragging.gap = gap
    showLine()
  }

  function endDrag(): void {
    const held = dragging
    dragging = null
    line.classList.remove('om-on')
    line.remove()
    if (!held) return
    held.row.classList.remove('om-q-dragging')
    const ids = player.current().music?.playback.queue ?? []
    // The gaps are counted among the rows that may be moved; the player counts in the whole queue. The position the
    // first movable row sits at is the difference between the two.
    const first = held.positions[0] ?? 0
    const to = queueMoveTo(held.from, first + held.gap, ids.length)
    if (to === null) {
      // Let go where it started, so nothing is sent. The list is redrawn from the player anyway, which puts the
      // dragged row's look back without claiming anything happened.
      drawn = ''
      render(player.current())
      return
    }
    void doAndSay(music.queueReorder(held.from, to)).then(() => place.refresh())
  }

  list.addEventListener('pointermove', moveDrag)
  list.addEventListener('pointerup', endDrag)
  list.addEventListener('pointercancel', endDrag)

  // ---------------------------------------------------------------- one entry

  const takeOut = (at: number): HTMLElement =>
    button(
      {
        cls: 'om-icon om-icon-sm',
        title: 'Take out of what is coming next',
        onClick: () => void doAndSay(music.queueRemove(at)).then(() => place.refresh())
      },
      [icon('close', 15)]
    )

  /**
   * Moving an entry without a mouse.
   *
   * The same two operations the drag sends, on the keyboard, because a running order nobody can rearrange without a
   * pointer is a running order some people cannot rearrange at all.
   */
  const nudge = (at: number, by: -1 | 1): HTMLElement =>
    button(
      {
        cls: 'om-icon om-icon-sm om-q-nudge',
        title: by === -1 ? 'Move this earlier' : 'Move this later',
        onClick: () => {
          const ids = player.current().music?.playback.queue ?? []
          const to = at + by
          if (to < 0 || to >= ids.length) {
            place.note(by === -1 ? 'That is already next.' : 'That is already last.')
            return
          }
          void doAndSay(music.queueReorder(at, to)).then(() => place.refresh())
        }
      },
      [icon(by === -1 ? 'back' : 'forward', 15)]
    )

  function entry(slot: QueueSlot, track: OrbisTrack | undefined, kind: 'gone' | 'playing' | 'next', at: number): HTMLElement {
    const movable = kind === 'next' && canMove(slot.index, at)
    const node = el('li', {
      cls: `om-q-row om-q-row-${kind}${movable ? ' om-q-row-move' : ''}`,
      attrs: { 'data-at': String(slot.index) }
    })

    // An id the library no longer has. Said as itself rather than left out: the entry really is in the running
    // order, and hiding it would make every position below it one out.
    if (!track) {
      node.append(
        el('span', { cls: 'om-q-grip om-q-grip-off', attrs: { 'aria-hidden': 'true' } }),
        el('span', { cls: 'om-q-lost' }, [
          el('span', { cls: 'om-row-title', text: 'A song that is no longer in your music' }),
          el('span', { cls: 'om-row-artist', text: 'It is still in the running order. Take it out to be rid of it.' })
        ]),
        el('span', { cls: 'om-row-length', text: '—' }),
        takeOut(slot.index)
      )
      return node
    }

    const playable = playableOffline(track)
    const why = whyNotPlayable(track)
    const grip = el('span', {
      cls: `om-q-grip${movable ? '' : ' om-q-grip-off'}`,
      title: movable ? 'Drag to move this up or down' : undefined,
      attrs: { 'aria-hidden': 'true' }
    })
    if (movable) {
      grip.append(icon('more', 16))
      grip.addEventListener('pointerdown', (event) => {
        if (event instanceof PointerEvent) startDrag(event, slot.index, node)
      })
    }

    node.append(
      grip,
      button(
        {
          cls: 'om-q-play',
          title: playable ? `Play ${track.title}` : (why ?? 'This cannot be played'),
          onClick: () => {
            if (!playable) {
              place.note(why ?? 'Orbis has no audio for this track.')
              return
            }
            // Playing from a point in the running order, not playing one song on its own: the whole queue is sent
            // again with this entry as the starting place, so everything below it stays below it.
            const ids = player.current().music?.playback.queue ?? []
            // A queue longer than the service will accept in one go would have its tail dropped, and then the
            // starting place would point at the wrong song. Rather than send a list that means something else, this
            // plays the one track and says what was given up.
            if (ids.length === 0 || ids.length > PLAY_ALL_LIMIT) {
              if (ids.length > PLAY_ALL_LIMIT) place.note('This running order is too long to restart from here, so only this song is playing.')
              void doAndSay(music.play(track.id)).then(() => place.refresh())
              return
            }
            void doAndSay(music.playAll(ids, slot.index)).then(() => place.refresh())
          }
        },
        [
          tile({ id: track.id, title: track.title, artist: track.artist, album: track.album }, { size: 'md' }),
          el('span', { cls: 'om-row-words' }, [
            el('span', { cls: 'om-row-title', text: track.title || 'No title' }),
            el('span', { cls: 'om-row-artist', text: [track.artist, track.album].filter((one) => one).join(' — ') || 'No artist named' })
          ])
        ]
      ),
      why
        ? el('span', {
            cls: 'om-pill om-pill-warn om-q-why',
            text: track.availability === 'reference' ? 'No audio here' : track.availability === 'missing' ? 'File missing' : 'Cannot be played'
          })
        : el('span', { cls: 'om-row-gap om-q-why' }),
      el('span', { cls: 'om-row-length', text: clockText(track.duration) }),
      button(
        {
          cls: `om-icon om-icon-sm om-q-heart${track.favourite ? ' om-on' : ''}`,
          title: track.favourite ? 'Take out of favourites' : 'Add to favourites',
          onClick: () => void doAndSay(music.setFavourite(track.id, track.favourite !== true)).then(() => place.refresh())
        },
        [icon('heart', 15)]
      ),
      movable ? nudge(slot.index, -1) : el('span', { cls: 'om-row-gap om-q-nudge' }),
      movable ? nudge(slot.index, 1) : el('span', { cls: 'om-row-gap om-q-nudge' }),
      kind === 'playing' ? el('span', { cls: 'om-q-now', text: 'Playing' }) : takeOut(slot.index)
    )
    return node
  }

  // ---------------------------------------------------------------- the whole screen

  function howMuchIsLeft(count: number, left: { seconds: number; unknown: number }): string {
    if (count === 0) return 'Nothing is lined up after this.'
    const songs = `${countText(count, 'song', 'songs')} to come`
    if (left.seconds <= 0) return `${songs}. None of them has a known length.`
    // spanText answers with nothing under a minute rather than "0 min", so the time is left off entirely there
    // instead of trailing a comma with nothing after it.
    const how = spanText(left.seconds)
    if (!how) return songs
    // "At least" rather than a total, because a song Orbis noticed on a web page has a name and no length, and
    // counting it as nothing would state a total that is short by however long that song runs.
    return `${songs}, ${left.unknown > 0 ? 'at least ' : ''}${how}`
  }

  function draw(state: player.PlayerState): void {
    const now = state.music
    if (!now) {
      fill(head, el('h1', { cls: 'om-q-title', text: 'Up next' }))
      fill(
        list,
        says(
          state.starting ? 'Reading what is playing…' : state.shut ? 'Orbis Music is not open' : 'Nothing is playing',
          state.shut ? 'Open the Orbis window and it connects by itself.' : (state.problem ?? '')
        )
      )
      return
    }
    if (now.playback.owner === 'website') {
      fill(head, el('h1', { cls: 'om-q-title', text: 'Up next' }))
      fill(
        list,
        says(
          'A web page is playing, and it keeps its own running order',
          'Orbis can see what that player is doing and leaves it alone. Play something of your own and what comes next shows up here.'
        )
      )
      return
    }

    const ids = now.playback.queue
    const byId = new Map(now.queue.map((one) => [one.id, one]))
    const parts = queueParts(ids, now.playback.at)
    const left = queueLength(parts.next.map((one) => byId.get(one.trackId)?.duration ?? 0))

    fill(
      head,
      el('div', { cls: 'om-q-words' }, [
        el('h1', { cls: 'om-q-title', text: 'Up next' }),
        el('p', { cls: 'om-q-sub', text: howMuchIsLeft(parts.next.length, left) })
      ]),
      el('div', { cls: 'om-q-does' }, [
        button({
          cls: 'om-btn om-btn-quiet',
          text: 'Empty what is coming next',
          attrs: { disabled: parts.next.length === 0 ? true : null },
          onClick: () => void doAndSay(music.queueClear()).then(() => place.refresh())
        })
      ])
    )

    const rows: HTMLElement[] = []
    const gone = parts.gone.slice(-GONE_SHOWN)
    if (gone.length > 0) {
      rows.push(el('li', { cls: 'om-q-group', text: gone.length === parts.gone.length ? 'Already played' : `Already played (the last ${gone.length})` }))
      for (const slot of gone) rows.push(entry(slot, byId.get(slot.trackId), 'gone', now.playback.at))
    }
    if (parts.playing) {
      rows.push(el('li', { cls: 'om-q-group', text: 'Playing now' }))
      rows.push(entry(parts.playing, byId.get(parts.playing.trackId), 'playing', now.playback.at))
    }
    rows.push(el('li', { cls: 'om-q-group', text: 'Coming next' }))
    if (parts.next.length === 0) {
      rows.push(
        el('li', { cls: 'om-q-none' }, [
          says('Nothing is lined up', 'Add songs with the plus on any row in your music, or start the DJ from Discover and it keeps the queue full.', {
            label: 'Go to your music',
            onClick: () => place.go('library')
          })
        ])
      )
    } else {
      for (const slot of parts.next) rows.push(entry(slot, byId.get(slot.trackId), 'next', now.playback.at))
    }

    fill(list, el('ol', { cls: 'om-q-rows' }, rows))
    void want([...(parts.playing ? [parts.playing.trackId] : []), ...parts.next.slice(0, COVERS_WANTED).map((one) => one.trackId)])
  }

  /**
   * What the drawn list depends on.
   *
   * The position is deliberately not in it, so a track simply playing on redraws nothing. The favourite of every
   * queued track is, because the heart on a row has to follow a press made anywhere else.
   */
  function shape(state: player.PlayerState): string {
    const now = state.music
    if (!now) return ['none', state.starting, state.shut, state.problem ?? ''].join('|')
    return [
      now.playback.owner,
      now.playback.at,
      now.playback.queue.join(','),
      now.queue.map((one) => `${one.id}:${one.favourite === true}:${one.availability}`).join(',')
    ].join('|')
  }

  function render(state: player.PlayerState): void {
    // Held still while a hand is down: a list rebuilt under the pointer cannot be dragged.
    if (dragging) return
    const fresh = shape(state)
    if (fresh === drawn) return
    drawn = fresh
    draw(state)
  }

  render(player.current())

  return {
    onPlayer: render,
    onCovers: () => {
      if (dragging) return
      drawn = ''
      render(player.current())
    },
    leave: () => endDrag()
  }
}

registerScreen({
  screen: 'queue',
  title: () => 'Up next',
  // The column on the right lists the same thing, so showing both would put one queue on screen twice.
  wants: { nowPlaying: 'hide' },
  mount: queueScreen
})
