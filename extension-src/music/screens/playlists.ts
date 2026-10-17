/**
 * All your playlists, and the one place a new one is made.
 *
 * Two things were already sending people here before the screen existed: the New playlist button at the top of the
 * left-hand list, and the playlist screen itself after a playlist is deleted. Both landed on a sentence saying nobody
 * had written this screen, which is how a delete left somebody staring at nothing.
 *
 * A playlist's song count is read from the playlist itself for a list made by hand, and left off entirely for one
 * worked out from the library. That is not tidiness: a smart playlist holds a question rather than songs, the answer
 * is worked out afresh every time it is opened, and printing a number beside it would be stating a count that changes
 * behind the words. The rest of Orbis Music already refuses to do that and this screen must not undo it.
 *
 * Nothing here reads a playlist's songs. Fifty playlists would be fifty calls to draw a grid nobody has pressed yet,
 * and the covers would arrive one list at a time; the tile carries the playlist's own name instead, which is honest
 * about being a name rather than artwork.
 */

import type { Playlist } from '../../../src/shared/music.ts'
import { countText, emptyWords } from '../../../src/shared/music/fulltab.ts'
import { tile } from '../art.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import { markPlaylist } from '../marked.ts'
import { registerScreen, type MountedScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay } from '../shell.ts'

registerScreen({
  screen: 'playlists',
  title: () => 'Playlists',
  // There is no cover and no running order on this screen, so the column on the right is the better use of the width.
  wants: { nowPlaying: 'as-chosen' },
  mount: (place) => mountPlaylists(place)
})

function mountPlaylists(place: ScreenPlace): MountedScreen {
  const head = el('div', { cls: 'om-lists-head' })
  const grid = el('div', { cls: 'om-lists-grid' })
  const body = el('div', { cls: 'om-lists' }, [head, grid])

  let lists: readonly Playlist[] | null = null
  /** The new-playlist field, while it is open. Kept so a redraw does not take the focus out of it mid-word. */
  let naming = false

  function drawHead(): void {
    const byHand = lists ? lists.filter((one) => !one.rule).length : 0
    const worked = lists ? lists.length - byHand : 0
    const lines: string[] = []
    if (byHand > 0) lines.push(countText(byHand, 'playlist', 'playlists'))
    if (worked > 0) lines.push(`${countText(worked, 'playlist', 'playlists')} worked out from your library`)
    fill(
      head,
      el('div', {}, [
        el('h1', { cls: 'om-lists-title', text: 'Playlists' }),
        lines.length > 0 ? el('p', { cls: 'om-lists-line', text: lines.join(' · ') }) : null
      ]),
      naming ? namingField() : button({ cls: 'om-btn om-btn-primary', onClick: () => openNaming() }, [icon('plus', 16), el('span', { text: 'New playlist' })])
    )
  }

  function openNaming(): void {
    naming = true
    drawHead()
    const field = head.querySelector<HTMLInputElement>('.om-lists-name')
    field?.focus()
  }

  function closeNaming(): void {
    naming = false
    drawHead()
  }

  /** The name box. Saved on Enter, abandoned on Escape, and a blank name is refused rather than made. */
  function namingField(): HTMLElement {
    const field = el('input', {
      cls: 'om-lists-name',
      attrs: { type: 'text', placeholder: 'Name for the playlist', maxlength: 80, 'aria-label': 'Name for the new playlist' }
    })
    const save = async (): Promise<void> => {
      const name = field.value.trim()
      if (name === '') {
        place.note('Give the playlist a name first.')
        field.focus()
        return
      }
      naming = false
      // Made empty, on purpose: songs are put into it from the songs, which is where somebody is when they want to.
      await doAndSay(music.createPlaylist(name))
      await load()
    }
    field.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key
      if (key === 'Enter') {
        event.preventDefault()
        void save()
      } else if (key === 'Escape') {
        event.preventDefault()
        closeNaming()
      }
    })
    return el('div', { cls: 'om-lists-naming' }, [
      field,
      button({ cls: 'om-btn om-btn-primary', onClick: () => void save() }, [el('span', { text: 'Make it' })]),
      button({ cls: 'om-btn om-btn-quiet', onClick: () => closeNaming() }, [el('span', { text: 'Cancel' })])
    ])
  }

  function listCard(list: Playlist): HTMLElement {
    const worked = Boolean(list.rule)
    // A count only for a list that really holds songs. A worked-out one says what it is instead.
    const sub = worked ? 'Worked out from your library' : countText(list.tracks.length, 'song', 'songs')
    const open = button(
      {
        cls: `om-card${worked ? ' om-card-worked' : ''}`,
        title: `${list.name} — ${sub}`,
        onClick: () => place.go('playlist', list.id)
      },
      [
        el('div', { cls: 'om-card-cover' }, [tile({ title: list.name }, { size: 'lg' })]),
        el('span', { cls: 'om-card-words' }, [el('span', { cls: 'om-card-name', text: list.name }), el('span', { cls: 'om-card-under', text: sub })])
      ]
    )
    // The play button is beside the card rather than inside it: a button inside a button is not a thing a browser
    // can make sense of, and the whole card is already one press that opens the playlist.
    const play = button(
      {
        cls: 'om-icon om-lists-play',
        title: `Play ${list.name}`,
        onClick: () => void doAndSay(music.playPlaylist(list.id))
      },
      [icon('play', 16)]
    )
    // Marked through the shared marker, so the one right-click menu on the page and dropping a song onto a playlist
    // both work on this screen without either of them knowing this screen exists.
    return markPlaylist(el('div', { cls: 'om-lists-cell' }, [open, play]), list)
  }

  function draw(): void {
    drawHead()
    if (!lists) return
    fill(grid, ...lists.map((one) => listCard(one)))
  }

  async function load(): Promise<void> {
    if (!lists) fill(place.into, says(emptyWords('loading', 'playlists').title))
    const answer = await music.playlists()
    if (!answer.got) {
      // Already-drawn cards stay where they are and the reason goes along the bottom, rather than the screen
      // emptying itself over a call that failed.
      if (lists) {
        place.note(answer.why)
        return
      }
      const words = emptyWords(answer.shut ? 'unreachable' : 'failed', 'playlists', answer.why)
      fill(place.into, says(words.title, words.detail, { label: 'Try again', onClick: () => void load() }))
      return
    }
    lists = answer.value
    if (answer.value.length === 0) {
      fill(
        place.into,
        says('No playlists yet', 'Make one and it turns up here, down the left, and in the right-click menu on any song.', {
          label: 'New playlist',
          onClick: () => {
            lists = []
            naming = true
            fill(place.into, body)
            draw()
            head.querySelector<HTMLInputElement>('.om-lists-name')?.focus()
          }
        })
      )
      return
    }
    fill(place.into, body)
    draw()
  }

  void load()

  return {}
}
