/**
 * One playlist: its songs, and everything that changes them.
 *
 * Play it, play it shuffled, rename it, delete it, search the library to add a song, take a song out, and put the
 * songs in a different order -- by dragging, with a line showing where the song will land, or with Move up and Move
 * down for anybody who would rather not drag. Every one of those goes straight to the music service's own playlist
 * operations and the answer is read back; nothing here keeps its own idea of the order.
 *
 * **Three things this screen cannot show, because the data is not there.** A playlist in Orbis is a name, a list of
 * track ids and two times. There is no description field, so there is no description to write or show. There is no
 * owner field either -- a playlist is simply in your own library on this computer, and there is no sharing anywhere
 * in Orbis Music -- so what the header says instead is the day it was made, which is real. And there is no cover: the
 * square at the top is built out of the covers of the first few songs, which is the playlist's own artwork in the
 * only sense Orbis has one. None of the three is invented.
 *
 * **A worked-out playlist is read-only here.** One with a rule is a question asked of the library every time it is
 * opened, not a list, so its order is the rule's order and there is nothing to drag, add or take out. The screen says
 * so in a sentence rather than offering controls that would do nothing.
 *
 * **Why the row numbers on screen are not the numbers sent to the service.** The playlist holds ids; the service
 * hands back only the ids it still has a song for. So the fourth row can be the fifth id, and the arithmetic that
 * maps one onto the other lives in `src/shared/music/playlistOrder.ts` with its own tests.
 */

import type { OrbisTrack, Playlist } from '../../../src/shared/music.ts'
import { playableOffline } from '../../../src/shared/music.ts'
import { countText, emptyWords, spanText } from '../../../src/shared/music/fulltab.ts'
import {
  dropBefore,
  landingMove,
  notAlready,
  playlistSums,
  realMove,
  renameTo,
  stepMove,
  sumsWords,
  type Move
} from '../../../src/shared/music/playlistOrder.ts'
import { tile, wash } from '../art.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import type { PlayerState } from '../player.ts'
import { registerScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay, trackRow } from '../shell.ts'

/** How long to wait after the last letter before searching the library, so typing is not one request per key. */
const TYPING_SETTLES = 200

interface Held {
  list: Playlist | null
  tracks: OrbisTrack[]
  /** Why there is nothing to show, in the words of whatever refused. Never turned into an empty list. */
  problem: string | null
  shut: boolean
  reading: boolean
  renaming: boolean
  /** The delete button asks once before it does it; this is whether it has asked. */
  askedToDelete: boolean
  adding: boolean
  said: string
  found: OrbisTrack[]
  findProblem: string | null
  playingId: string | null
}

registerScreen({
  screen: 'playlist',
  title: (route) => route.of,
  wants: { nowPlaying: 'as-chosen' },
  mount: (place) => mountPlaylist(place)
})

function mountPlaylist(place: ScreenPlace) {
  const id = place.route.of
  const held: Held = {
    list: null,
    tracks: [],
    problem: null,
    shut: false,
    reading: true,
    renaming: false,
    askedToDelete: false,
    adding: false,
    said: '',
    found: [],
    findProblem: null,
    playingId: null
  }

  const head = el('div', { cls: 'om-pl-head' })
  const body = el('div', { cls: 'om-pl-body' })
  fill(place.into, head, body)

  let typingTimer: ReturnType<typeof setTimeout> | null = null
  let gone = false
  let rowsList: HTMLElement | null = null
  let dropLine: HTMLElement | null = null

  if (!id) {
    fill(body, says('No playlist was named', 'The address has to say which playlist to open.'))
    return {
      leave: () => {
        gone = true
      }
    }
  }

  // ---------------------------------------------------------------- reading

  async function read(): Promise<void> {
    const [lists, tracks] = await Promise.all([music.playlists(), music.playlistTracks(id)])
    if (gone) return
    held.reading = false
    if (!lists.got) {
      held.problem = lists.why
      held.shut = lists.shut
    } else {
      held.list = lists.value.find((one) => one.id === id) ?? null
      held.problem = held.list ? null : 'That playlist is not in your music any more.'
      held.shut = false
    }
    if (tracks.got) held.tracks = tracks.value
    else if (held.problem === null) {
      held.problem = tracks.why
      held.shut = tracks.shut
    }
    draw()
    place.wantCovers(held.tracks.map((one) => one.id))
  }

  /** Does something to the playlist, says what the service said, then reads it back rather than guessing. */
  async function change<T>(doing: Promise<music.Answer<T>>): Promise<void> {
    await doAndSay(doing)
    await read()
  }

  // ---------------------------------------------------------------- the header

  function drawHead(): void {
    const list = held.list
    if (!list) {
      fill(head)
      return
    }
    const sums = playlistSums(held.tracks)
    const first = held.tracks.slice(0, 4)
    const cover = el(
      'div',
      { cls: `om-pl-cover om-pl-cover-${Math.max(1, first.length)}`, attrs: { 'aria-hidden': 'true' } },
      first.length === 0
        ? [el('span', { cls: 'om-pl-cover-letter', text: (list.name.trim()[0] ?? '?').toUpperCase() })]
        : first.map((one) => tile({ id: one.id, title: one.title, artist: one.artist, album: one.album }, { size: 'md' }))
    )

    const made = new Date(list.createdAt)
    const madeWords = Number.isFinite(made.getTime()) ? `Made ${made.toLocaleDateString()}` : ''

    const words = el('div', { cls: 'om-pl-words' }, [
      el('p', { cls: 'om-pl-kind', text: list.rule ? 'Worked out from your music' : 'Playlist' }),
      held.renaming ? renameField(list) : el('h1', { cls: 'om-pl-name', text: list.name || 'Untitled playlist' }),
      el('p', { cls: 'om-pl-sums', text: [sumsWords(sums, spanText), madeWords].filter((one) => one !== '').join(' · ') }),
      list.rule
        ? el('p', {
            cls: 'om-pl-note',
            text: 'This one is a question asked of your library, so its songs and their order are worked out afresh every time it is opened.'
          })
        : null
    ])

    const playable = held.tracks.some((one) => playableOffline(one))
    const actions = el('div', { cls: 'om-pl-actions' }, [
      button(
        {
          cls: 'om-btn om-btn-primary om-pl-play',
          title: playable ? `Play ${list.name}` : 'Nothing in here can be played on this computer',
          onClick: () => {
            if (!playable) {
              place.note('Nothing in this playlist has audio on this computer.')
              return
            }
            void change(music.playPlaylist(list.id))
          }
        },
        [icon('play', 20), el('span', { text: 'Play' })]
      ),
      button(
        {
          cls: 'om-btn',
          title: 'Play this playlist with the songs mixed up',
          onClick: () => {
            if (!playable) {
              place.note('Nothing in this playlist has audio on this computer.')
              return
            }
            void shufflePlay(list.id)
          }
        },
        [icon('shuffle', 18), el('span', { text: 'Shuffle' })]
      ),
      list.rule
        ? null
        : button(
            {
              cls: `om-btn om-btn-quiet${held.adding ? ' om-on' : ''}`,
              title: 'Find songs in your library to add',
              onClick: () => {
                held.adding = !held.adding
                draw()
              }
            },
            [icon('plus', 18), el('span', { text: 'Add songs' })]
          ),
      button(
        {
          cls: 'om-icon',
          title: 'Rename this playlist',
          onClick: () => {
            held.renaming = !held.renaming
            draw()
          }
        },
        [icon('edit', 18)]
      ),
      held.askedToDelete
        ? el('span', { cls: 'om-pl-confirm' }, [
            el('span', { cls: 'om-pl-confirm-words', text: 'Delete it? The songs stay in your library.' }),
            button({ cls: 'om-btn om-pl-danger', text: 'Delete', onClick: () => void deleteIt(list.id) }),
            button({
              cls: 'om-btn om-btn-quiet',
              text: 'Keep it',
              onClick: () => {
                held.askedToDelete = false
                draw()
              }
            })
          ])
        : button(
            {
              cls: 'om-icon',
              title: 'Delete this playlist',
              onClick: () => {
                held.askedToDelete = true
                draw()
              }
            },
            [icon('close', 18)]
          )
    ])

    fill(head, wash(held.tracks[0]?.id), el('div', { cls: 'om-pl-top' }, [cover, words]), actions)
  }

  function renameField(list: Playlist): HTMLElement {
    const input = el('input', {
      cls: 'om-pl-rename-input',
      attrs: { type: 'text', value: list.name, maxlength: 200, 'aria-label': 'The name of this playlist', spellcheck: 'false' }
    })
    const save = (): void => {
      const name = renameTo(input.value, list.name)
      held.renaming = false
      if (name === null) {
        draw()
        return
      }
      void change(music.renamePlaylist(list.id, name))
    }
    input.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key
      if (key === 'Enter') save()
      if (key === 'Escape') {
        held.renaming = false
        draw()
      }
    })
    // Focused once it is on screen, so somebody who pressed Rename can simply start typing.
    setTimeout(() => input.focus(), 0)
    return el('div', { cls: 'om-pl-rename' }, [
      input,
      button({ cls: 'om-btn om-btn-primary', text: 'Save', onClick: save }),
      button({
        cls: 'om-btn om-btn-quiet',
        text: 'Cancel',
        onClick: () => {
          held.renaming = false
          draw()
        }
      })
    ])
  }

  /**
   * Play it mixed up.
   *
   * There is no one operation for "play this shuffled", so this is the two the service does have: turn shuffle on,
   * then play the playlist. Shuffle stays on afterwards, because that is what the player's own setting means, and
   * quietly turning it back off would leave the shuffle button in the bar disagreeing with what is playing.
   */
  async function shufflePlay(listId: string): Promise<void> {
    const on = await music.setShuffle(true)
    if (!on.got) {
      place.note(on.why)
      return
    }
    await change(music.playPlaylist(listId))
  }

  async function deleteIt(listId: string): Promise<void> {
    const answer = await music.removePlaylist(listId)
    if (!answer.got) {
      place.note(answer.why)
      return
    }
    if (answer.value !== true) {
      place.note('Orbis did not delete that playlist.')
      await read()
      return
    }
    place.note('Playlist deleted. The songs are still in your library.')
    place.go('playlists')
  }

  // ---------------------------------------------------------------- the songs

  function drawRows(): HTMLElement {
    const list = held.list
    const rows = el('ol', { cls: 'om-rows om-pl-rows' })
    rowsList = rows
    held.tracks.forEach((track, at) => {
      const row = trackRow(track, {
        playing: held.playingId !== null && track.id === held.playingId,
        onPlay: () =>
          void doAndSay(
            music.playAll(
              held.tracks.map((one) => one.id),
              at
            )
          )
      })
      row.classList.add('om-pl-row')
      row.dataset.at = String(at)
      row.prepend(el('span', { cls: 'om-pl-number', text: String(at + 1) }))
      if (list && !list.rule) {
        row.append(
          el('span', { cls: 'om-pl-moves' }, [
            button({ cls: 'om-icon om-icon-sm om-pl-up', title: `Move ${track.title} up`, onClick: () => void step(at, -1) }, [icon('back', 15)]),
            button({ cls: 'om-icon om-icon-sm om-pl-down', title: `Move ${track.title} down`, onClick: () => void step(at, 1) }, [icon('forward', 15)]),
            handle(at, track)
          ]),
          button(
            {
              cls: 'om-icon om-icon-sm om-pl-out',
              title: `Take ${track.title} out of this playlist`,
              onClick: () => void change(music.removeFromPlaylist(list.id, track.id))
            },
            [icon('close', 15)]
          )
        )
      }
      rows.append(row)
    })
    dropLine = el('div', { cls: 'om-pl-drop', attrs: { 'aria-hidden': 'true' } })
    rows.append(dropLine)
    return rows
  }

  function drawBody(): void {
    if (held.reading && held.tracks.length === 0 && held.problem === null) {
      const found = emptyWords('loading', 'playlist')
      fill(body, says(found.title, found.detail))
      return
    }
    if (held.problem !== null && held.list === null) {
      const found = emptyWords(held.shut ? 'unreachable' : 'failed', 'playlist', held.problem)
      fill(body, says(found.title, found.detail, found.retry ? { label: 'Try again', onClick: () => void read() } : undefined))
      return
    }
    const parts: (Node | null)[] = []
    if (held.adding && held.list && !held.list.rule) parts.push(addPanel())
    if (held.tracks.length === 0) {
      parts.push(
        held.list?.rule
          ? says('Nothing matches this one right now', 'It asks your library a question, and today nothing in your music answers it.')
          : says('This playlist has no songs yet', 'Use Add songs to search your library and put something in it.')
      )
    } else {
      parts.push(drawRows())
    }
    fill(body, ...parts)
  }

  // ---------------------------------------------------------------- putting them in order

  async function step(at: number, direction: -1 | 1): Promise<void> {
    const list = held.list
    if (!list || list.rule) return
    const shownMove = stepMove(at, direction, held.tracks.length)
    if (!shownMove) return
    await send(list, shownMove)
    // The buttons walk a song along the list, so the focus is put back on the same button of the row the song landed
    // in: a second press then carries on moving the same song rather than whatever has taken its old place.
    const which = direction === -1 ? 'om-pl-up' : 'om-pl-down'
    rowsList?.querySelector<HTMLElement>(`[data-at="${shownMove.to}"] .${which}`)?.focus()
  }

  async function send(list: Playlist, shownMove: Move): Promise<void> {
    const real = realMove(
      list.tracks,
      held.tracks.map((one) => one.id),
      shownMove
    )
    if (!real) {
      // Either nothing would change, or the page and the playlist have gone out of step because it was edited in the
      // Orbis window while this was open. Reading it again is the honest answer to the second and harmless for the first.
      await read()
      return
    }
    await change(music.reorderPlaylist(list.id, real.from, real.to))
  }

  /**
   * The grip that drags a row.
   *
   * Pointer events, and the row itself is never moved or taken out of the page: a line is drawn in the gap the song
   * would land in instead. Taking an element out of the flow mid-drag drops the pointer capture with it, which ends
   * the drag the moment the list reflows, and that capture is what makes the rest of the page ignore the pointer.
   */
  function handle(at: number, track: OrbisTrack): HTMLButtonElement {
    const grip = button({ cls: 'om-pl-grip', title: `Drag ${track.title} to another place in this playlist` }, [icon('more', 16)])
    grip.addEventListener('pointerdown', (event) => {
      const pointer = event as PointerEvent
      if (pointer.button !== 0) return
      const list = held.list
      if (!list || list.rule || !rowsList || !dropLine) return
      pointer.preventDefault()
      grip.setPointerCapture(pointer.pointerId)

      const line = dropLine
      const rows = [...rowsList.querySelectorAll<HTMLElement>('.om-pl-row')]
      const boxes = rows.map((row) => row.getBoundingClientRect())
      const middles = boxes.map((box) => box.top + box.height / 2)
      const bottom = boxes.length > 0 ? (boxes[boxes.length - 1] as DOMRect).bottom : 0
      const listTop = rowsList.getBoundingClientRect().top
      const lifted = rows[at]
      let before = at

      const showLine = (y: number): void => {
        before = dropBefore(middles, y)
        const edge = before < boxes.length ? (boxes[before] as DOMRect).top : bottom
        line.style.setProperty('transform', `translateY(${Math.round(edge - listTop)}px)`)
        line.classList.add('om-pl-drop-on')
      }

      const letGo = (): void => {
        grip.removeEventListener('pointermove', move)
        grip.removeEventListener('pointerup', drop)
        grip.removeEventListener('pointercancel', letGo)
        lifted?.classList.remove('om-pl-row-lifted')
        line.classList.remove('om-pl-drop-on')
      }
      const move = (next: Event): void => showLine((next as PointerEvent).clientY)
      const drop = (): void => {
        letGo()
        const shownMove = landingMove({ from: at, before }, held.tracks.length)
        if (shownMove) void send(list, shownMove)
      }

      lifted?.classList.add('om-pl-row-lifted')
      showLine(pointer.clientY)
      grip.addEventListener('pointermove', move)
      grip.addEventListener('pointerup', drop)
      grip.addEventListener('pointercancel', letGo)
    })
    return grip
  }

  // ---------------------------------------------------------------- adding songs

  function addPanel(): HTMLElement {
    const list = held.list
    const box = el('input', {
      cls: 'om-pl-find-input',
      attrs: {
        type: 'search',
        value: held.said,
        placeholder: 'A song, an artist or an album in your library',
        'aria-label': 'Search your library for songs to add'
      }
    })
    box.addEventListener('input', () => {
      held.said = box.value
      if (typingTimer) clearTimeout(typingTimer)
      typingTimer = setTimeout(() => void look(), TYPING_SETTLES)
    })
    setTimeout(() => box.focus(), 0)

    const results = el('div', { cls: 'om-pl-found' })
    if (held.findProblem !== null) {
      results.append(el('p', { cls: 'om-side-says', text: held.findProblem }))
    } else if (held.said.trim() === '') {
      results.append(el('p', { cls: 'om-side-says', text: 'Type a few letters and Orbis looks through the songs you have.' }))
    } else {
      const spare = list ? notAlready(held.found, list.tracks) : held.found
      if (spare.length === 0) {
        results.append(
          el('p', {
            cls: 'om-side-says',
            text: held.found.length > 0 ? 'Everything that matches is in this playlist already.' : 'Nothing in your library matches those words.'
          })
        )
      } else {
        const rows = el('ul', { cls: 'om-rows om-pl-found-rows' })
        for (const track of spare) {
          rows.append(
            el('li', { cls: 'om-row om-pl-found-row' }, [
              tile({ id: track.id, title: track.title, artist: track.artist, album: track.album }, { size: 'sm' }),
              el('span', { cls: 'om-row-words' }, [
                el('span', { cls: 'om-row-title', text: track.title || 'No title' }),
                el('span', { cls: 'om-row-artist', text: [track.artist, track.album].filter((one) => one !== '').join(' — ') || 'No artist named' })
              ]),
              button({
                cls: 'om-btn om-btn-quiet',
                title: `Add ${track.title} to this playlist`,
                text: 'Add',
                onClick: () => {
                  if (list) void change(music.addToPlaylist(list.id, [track.id]))
                }
              })
            ])
          )
        }
        results.append(rows, el('p', { cls: 'om-side-says', text: countText(spare.length, 'song you could add', 'songs you could add') }))
      }
    }

    return el('div', { cls: 'om-pl-find' }, [
      el('div', { cls: 'om-pl-find-top' }, [
        box,
        button(
          {
            cls: 'om-icon',
            title: 'Stop adding songs',
            onClick: () => {
              held.adding = false
              draw()
            }
          },
          [icon('close', 18)]
        )
      ]),
      results
    ])
  }

  async function look(): Promise<void> {
    const said = held.said.trim()
    if (said === '') {
      held.found = []
      held.findProblem = null
      draw()
      return
    }
    const answer = await music.library({ search: said })
    if (gone) return
    if (!answer.got) {
      held.findProblem = answer.shut ? 'Open the Orbis window and your music connects by itself.' : answer.why
      draw()
      return
    }
    held.findProblem = null
    held.found = answer.value.slice(0, 40)
    draw()
    place.wantCovers(held.found.map((one) => one.id))
  }

  // ---------------------------------------------------------------- drawing

  function draw(): void {
    if (gone) return
    drawHead()
    drawBody()
  }

  draw()
  void read()

  return {
    onPlayer: (state: PlayerState) => {
      const playing = state.music?.playback.trackId ?? null
      if (playing === held.playingId) return
      held.playingId = playing
      drawBody()
    },
    onCovers: () => draw(),
    leave: () => {
      gone = true
      if (typingTimer) clearTimeout(typingTimer)
    }
  }
}
