/**
 * Your music -- the library screen.
 *
 * Five lists of one library: the songs themselves as a table, and then albums, artists, genres and playlists, each
 * of which Orbis works out from the songs rather than storing anywhere. Whichever list is showing is in the address,
 * so the browser's own back button steps between Albums and Songs; the words typed into the search box are in the
 * address too, so a search survives a reload.
 *
 * What is drawn here and what is decided elsewhere. Every decision -- which songs a chip keeps, how albums go in
 * order, how many rows have been scrolled into existence, the words for a date -- is in
 * `src/shared/music/libraryShelf.ts` and is checked without a screen. This file asks the music service for the real
 * rows, hands them to those functions, and builds nodes. Nothing is fetched except through `client.ts`, and nothing
 * about what is playing is held here: the one answer comes from `player.ts` through the frame.
 *
 * Three things this screen is careful about, all carried from the panel it replaces.
 *
 * A failed call never empties the list. Every answer from the client is either rows or a reason, and a reason leaves
 * whatever was last drawn exactly where it was and says what happened instead -- because an empty library on screen
 * reads as "your music is gone", and somebody would believe it. The Orbis window being shut is its own sentence,
 * separate from a library that really is empty.
 *
 * A song Orbis has no audio for is still a song. It appears in the table, in the counts, in the order, and it keeps
 * its heart. Its play button is off and carries the real reason in the music service's own words. There is no chip
 * that hides it by default, because for a great many people half the library is songs Orbis only knows by name.
 *
 * And a long library is drawn a block at a time. Fifty thousand rows is the real limit of the store, and fifty
 * thousand covers is more memory than a tab should hold, so the table adds another block when somebody reaches the
 * bottom of the one it has drawn.
 */

import { clockText, countText, emptyWords, spanText } from '../../../src/shared/music/fulltab.ts'
import {
  LIBRARY_KEEPS,
  LIBRARY_SORTS,
  LIBRARY_VIEWS,
  availabilityPill,
  countForKeep,
  dateAddedText,
  findGroups,
  fromStored,
  groupSeconds,
  groupSub,
  keepGroups,
  keepTracks,
  libraryCounts,
  librarySort,
  libraryView,
  nearEnd,
  playableIds,
  playsText,
  shownRows,
  sortGroups,
  sortStartsDown,
  storedFor,
  type LibraryKeep,
  type LibraryView
} from '../../../src/shared/music/libraryShelf.ts'
import type { Grouped, OrbisTrack, Playlist, SortBy } from '../../../src/shared/music.ts'
import { playableOffline, whyNotPlayable } from '../../../src/shared/music.ts'
import { tile } from '../art.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import type { PlayerState } from '../player.ts'
import { registerScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay, note } from '../shell.ts'

/**
 * How the lists are drawn: as rows, or as squares of artwork.
 *
 * Held for as long as the tab is open rather than written down, because the music service has nowhere to put it --
 * its settings hold which list and which order, and no third field. Which list and which order are written down and
 * come back next time; this one does not, and that is the honest state of it rather than a preference quietly lost.
 */
type Layout = 'list' | 'grid'

let layout: Layout = 'grid'
let sort: SortBy = 'added'
let descending = true
let keep: LibraryKeep = 'all'
/** True once the stored list and order have been read, so they are not read over every time the screen is opened. */
let readStored = false

// ---------------------------------------------------------------- covers

/**
 * Where a cover goes, so an arriving picture can be dropped in without the list being rebuilt.
 *
 * Rebuilding would be simpler and would also throw away the scroll position and whatever row somebody had tabbed to,
 * every time a batch of sixty covers landed. So each square is a holder with one tile inside it, and a new cover
 * replaces that one tile.
 */
interface Holder {
  readonly node: HTMLElement
  readonly of: { readonly id?: string; readonly title: string; readonly artist?: string; readonly album?: string }
  readonly size: 'sm' | 'md' | 'lg' | 'xl'
  /** Round for an artist, square for everything else. Kept here so an arriving cover is drawn the same shape. */
  readonly round: boolean
}

function artHolder(holders: Holder[], of: Holder['of'], size: Holder['size'], round = false): HTMLElement {
  const node = el('span', { cls: 'oml-art' }, [tile(of, { size, round })])
  holders.push({ node, of, size, round })
  return node
}

// ---------------------------------------------------------------- the one table of songs

/**
 * One song, as a row of the table.
 *
 * A table rather than the frame's shared row because this screen is the one place a person comes to see the library
 * as a whole: the number, when it came in, how many times it has been played and which album it is from are all
 * worth a column of their own here, where on a playlist they would be noise. The availability wording is the shared
 * wording, and the reason a row cannot be played is the music service's own sentence, so the two never drift.
 */
function songRow(
  track: OrbisTrack,
  at: number,
  all: readonly string[],
  playing: boolean,
  holders: Holder[],
  place: ScreenPlace
): HTMLElement {
  const playable = playableOffline(track)
  const why = whyNotPlayable(track)
  const pill = availabilityPill(track)
  const row = el('li', {
    cls: `oml-tr${playing ? ' oml-tr-now' : ''}${playable ? '' : ' oml-tr-off'}`,
    attrs: { role: 'row' }
  })

  const number = button(
    {
      cls: 'oml-num',
      title: playable ? `Play ${track.title}` : (why ?? 'This cannot be played'),
      onClick: () => {
        if (!playable) {
          note(why ?? 'Orbis has no audio for this track.')
          return
        }
        // Pressing a song in a list starts the whole list at that song, which is what a person means by it. Only
        // the songs with audio go into the run -- the ones Orbis knows by name have nothing to play, and a queue
        // full of things that will be skipped is a queue that lies about what is coming.
        const startAt = all.indexOf(track.id)
        void doAndSay(music.playAll(all, startAt < 0 ? 0 : startAt))
      }
    },
    [el('span', { cls: 'oml-num-n', text: String(at + 1) }), el('span', { cls: 'oml-num-play' }, [icon('play', 14)])]
  )

  row.append(
    el('span', { cls: 'oml-numcell', attrs: { role: 'cell' } }, [number]),
    el('span', { cls: 'oml-cell oml-cell-title', attrs: { role: 'cell' } }, [
      artHolder(holders, { id: track.id, title: track.title, artist: track.artist, album: track.album }, 'md'),
      el('span', { cls: 'oml-words' }, [
        el('span', { cls: 'oml-title', text: track.title || 'No title', title: track.title || 'No title' }),
        el('span', { cls: 'oml-under' }, [
          pill ? el('span', { cls: 'om-pill om-pill-warn', text: pill, title: why ?? '' }) : null,
          el('span', { cls: 'oml-plays', text: playsText(track.playCount) })
        ])
      ])
    ]),
    // The artist and the album are both buttons: this is the screen somebody browses from, and reading an artist's
    // name without being able to press it is the thing that makes a library feel like a spreadsheet.
    el('span', { cls: 'oml-cell oml-cell-artist', attrs: { role: 'cell' } }, [
      track.artist
        ? button({ cls: 'oml-link', text: track.artist, title: `Everything by ${track.artist}`, onClick: () => place.go('artist', track.artist) })
        : el('span', { cls: 'oml-faint', text: 'No artist named' })
    ]),
    el('span', { cls: 'oml-cell oml-cell-album', attrs: { role: 'cell' } }, [
      track.album
        ? button({ cls: 'oml-link', text: track.album, title: `The record ${track.album}`, onClick: () => place.go('album', track.album) })
        : el('span', { cls: 'oml-faint', text: 'No album named' })
    ]),
    el('span', { cls: 'oml-cell oml-cell-added', text: dateAddedText(track.addedAt), attrs: { role: 'cell' } }),
    el('span', { cls: 'oml-cell oml-cell-length', text: clockText(track.duration), attrs: { role: 'cell' } }),
    el('span', { cls: 'oml-cell oml-cell-do', attrs: { role: 'cell' } }, [
      button(
        {
          cls: `om-icon om-icon-sm${track.favourite ? ' om-on' : ''}`,
          title: track.favourite ? `Take ${track.title} out of favourites` : `Add ${track.title} to favourites`,
          attrs: { 'aria-pressed': track.favourite === true ? 'true' : 'false' },
          onClick: () => void doAndSay(music.setFavourite(track.id, track.favourite !== true))
        },
        [icon('heart', 15)]
      ),
      button(
        {
          cls: 'om-icon om-icon-sm',
          title: playable ? `Play ${track.title} next` : (why ?? 'This cannot be played'),
          onClick: () => {
            if (!playable) {
              note(why ?? 'Orbis has no audio for this track.')
              return
            }
            void doAndSay(music.queueNext([track.id]))
          }
        },
        [icon('plus', 15)]
      )
    ])
  )
  return row
}

/** The table's own heading row, which is also where the order is chosen. */
function tableHead(redraw: () => void): HTMLElement {
  const column = (label: string, cls: string, by?: SortBy): HTMLElement => {
    if (!by) return el('span', { cls: `oml-th ${cls}`, text: label, attrs: { role: 'columnheader' } })
    const on = sort === by
    return button(
      {
        cls: `oml-th oml-th-do ${cls}${on ? ' om-on' : ''}`,
        title: on ? `${wayWords(by, descending)} — press to turn it round` : `Order by ${label.toLowerCase()}`,
        // `aria-sort` belongs on the heading itself rather than on the button inside it, so the heading is the
        // button: that is what lets a screen reader say which column the list is ordered by and which way round.
        attrs: { role: 'columnheader', 'aria-sort': on ? (descending ? 'descending' : 'ascending') : 'none' },
        onClick: () => {
          if (on) descending = !descending
          else {
            sort = by
            descending = sortStartsDown(by)
          }
          void keepPreference()
          redraw()
        }
      },
      [el('span', { text: label }), on ? el('span', { cls: 'oml-th-way', text: descending ? '↓' : '↑' }) : null]
    )
  }
  return el('li', { cls: 'oml-tr oml-tr-head', attrs: { role: 'row' } }, [
    el('span', { cls: 'oml-th oml-numh', text: '#', attrs: { role: 'columnheader' } }),
    column('Title', 'oml-cell-title', 'title'),
    column('Artist', 'oml-cell-artist', 'artist'),
    column('Album', 'oml-cell-album', 'album'),
    column('Added', 'oml-cell-added', 'added'),
    column('Length', 'oml-cell-length', 'duration'),
    el('span', { cls: 'oml-th oml-cell-do', text: '', attrs: { role: 'columnheader', 'aria-label': 'What you can do with it' } })
  ])
}

// ---------------------------------------------------------------- a card for an album, artist, genre or playlist

interface CardOf {
  readonly name: string
  readonly sub: string
  readonly cover: Holder['of']
  readonly round?: boolean
  readonly title: string
  readonly open: () => void
  readonly play?: () => void
}

function card(of: CardOf, holders: Holder[]): HTMLElement {
  const node = el('div', { cls: `oml-card${of.round ? ' oml-card-round' : ''}` })
  node.append(
    button({ cls: 'oml-card-open', title: of.title, onClick: of.open }, [
      el('span', { cls: 'oml-card-art' }, [artHolder(holders, of.cover, 'xl', of.round === true)]),
      el('span', { cls: 'oml-card-name', text: of.name, title: of.name }),
      el('span', { cls: 'oml-card-sub', text: of.sub })
    ])
  )
  // The play button only exists when there is something to play. A group of songs Orbis has no audio for has none,
  // and a button that would always refuse is worse than no button.
  if (of.play) node.append(button({ cls: 'oml-card-play', title: `Play ${of.name}`, onClick: of.play }, [icon('play', 18)]))
  return node
}

function groupRow(of: CardOf, holders: Holder[]): HTMLElement {
  return el('li', { cls: 'oml-grow' }, [
    button({ cls: 'oml-grow-open', title: of.title, onClick: of.open }, [
      artHolder(holders, of.cover, 'md', of.round === true),
      el('span', { cls: 'oml-words' }, [el('span', { cls: 'oml-title', text: of.name }), el('span', { cls: 'oml-sub', text: of.sub })])
    ]),
    of.play ? button({ cls: 'om-icon om-icon-sm', title: `Play ${of.name}`, onClick: of.play }, [icon('play', 15)]) : el('span')
  ])
}

// ---------------------------------------------------------------- remembering the list and the order

/**
 * Writes the chosen list and order back into the music service's own settings.
 *
 * `view` and `sort` have been in the stored settings for a long time with nothing ever writing them, so which list
 * somebody was last looking at has been thrown away every time. This screen is the first thing to drive them. The
 * answer is not waited on and a failure is not said: it is a preference, and interrupting somebody who has just
 * pressed Albums to tell them the preference did not save would be worse than the preference not saving.
 */
async function keepPreference(view?: LibraryView): Promise<void> {
  const stored = storedFor(view ?? currentView, keep)
  await music.saveSettings({ view: stored, sort })
}

/**
 * What the direction button says, which depends on what is being ordered.
 *
 * "Largest first" is meaningless for a list of titles and wrong for a list of dates, so each order names its own two
 * ends. One sentence, said the way somebody would say it out loud.
 */
function wayWords(sort: SortBy, down: boolean): string {
  switch (sort) {
    case 'added':
      return down ? 'Newest first' : 'Oldest first'
    case 'duration':
      return down ? 'Longest first' : 'Shortest first'
    case 'plays':
      return down ? 'Most played first' : 'Least played first'
    default:
      return down ? 'Z to A' : 'A to Z'
  }
}

let currentView: LibraryView = 'songs'

// ---------------------------------------------------------------- the screen

registerScreen({
  screen: 'library',
  title: (route) => {
    const view = libraryView(route.of)
    const entry = LIBRARY_VIEWS.find((one) => one.view === view)
    return entry && view !== 'songs' ? `${entry.label} — Your music` : 'Your music'
  },
  wants: { nowPlaying: 'as-chosen' },
  mount: (place) => {
    const view = libraryView(place.route.of)
    currentView = view

    let said = place.route.said
    let holders: Holder[] = []
    let blocks = 1
    let tracks: OrbisTrack[] | null = null
    let groups: Grouped[] | null = null
    let playlists: Playlist[] | null = null
    let problem: string | null = null
    let shut = false
    let typing: ReturnType<typeof setTimeout> | null = null
    let gone = false
    let playingId: string | null = null

    const body = el('div', { cls: 'oml-body' })
    /*
     * The head is built again whenever the order changes, because the arrow and the chosen row of the select are
     * part of what it says. The search box, the chips and the count are the same nodes every time -- they are moved
     * into the new head rather than replaced, so typed words and a pressed chip survive it.
     */
    const headBox = el('div', { cls: 'oml-headbox' })
    const redrawHead = (): void => fill(headBox, head())
    const chipRow = el('div', { cls: 'oml-chips', attrs: { role: 'group', 'aria-label': 'Which songs to show' } })
    const count = el('p', { cls: 'oml-count' })
    const search = el('input', {
      cls: 'oml-search',
      attrs: { type: 'search', value: said, placeholder: view === 'songs' ? 'Search your songs' : `Search your ${view}`, 'aria-label': 'Search your music' }
    })

    // ---- asking for the rows

    /**
     * Keeps the reason a call failed, and says it out loud when there is already a list on screen.
     *
     * The list itself is left exactly as it was. Replacing it with a sentence would be worse than a list a moment
     * out of date -- somebody would read an empty screen as their music being gone -- so the rows stay and the
     * reason goes along the bottom instead, in the music service's own words.
     */
    function failed(why: string, isShut: boolean): void {
      problem = why
      shut = isShut
      if (tracks !== null || groups !== null || playlists !== null) note(why)
    }

    async function load(): Promise<void> {
      if (view === 'songs') {
        // The order is asked of the music service rather than done here: it sorts fifty thousand rows in the main
        // process in one pass, and 'artist' there falls through to the album and the track number, which is the
        // order a person actually wants and is not worth writing a second time.
        const answer = await music.library({ search: said, sort, descending })
        if (gone) return
        if (!answer.got) failed(answer.why, answer.shut)
        else {
          tracks = answer.value
          problem = null
          shut = false
        }
      } else if (view === 'playlists') {
        const answer = await music.playlists()
        if (gone) return
        if (!answer.got) failed(answer.why, answer.shut)
        else {
          playlists = answer.value
          problem = null
          shut = false
        }
      } else {
        const answer = view === 'albums' ? await music.albums() : view === 'artists' ? await music.artists() : await music.genres()
        if (gone) return
        if (!answer.got) failed(answer.why, answer.shut)
        else {
          groups = answer.value
          problem = null
          shut = false
        }
      }
      draw()
    }

    // ---- the words along the top, and the chips

    function drawChips(counts: ReturnType<typeof libraryCounts> | null): void {
      fill(
        chipRow,
        ...LIBRARY_KEEPS.map((entry) => {
          const many = counts ? countForKeep(counts, entry.keep) : null
          // A chip that would keep nothing is not offered: pressing "File missing 0" to see an empty screen tells
          // nobody anything, where the chip simply not being there says there are none.
          if (counts && entry.keep !== 'all' && many === 0) return null
          return button(
            {
              cls: `oml-chip${keep === entry.keep ? ' om-on' : ''}`,
              title: entry.detail,
              attrs: { 'aria-pressed': keep === entry.keep ? 'true' : 'false' },
              onClick: () => {
                keep = entry.keep
                blocks = 1
                void keepPreference()
                draw()
              }
            },
            [el('span', { text: entry.label }), many === null ? null : el('span', { cls: 'oml-chip-n', text: String(many) })]
          )
        }).filter((one) => one !== null)
      )
    }

    function head(): HTMLElement {
      const orders = view === 'playlists' ? LIBRARY_SORTS.filter((one) => one.sort === 'title' || one.sort === 'added') : LIBRARY_SORTS
      const select = el('select', { cls: 'oml-select', attrs: { 'aria-label': 'What order to show them in' } })
      for (const entry of orders) {
        const option = el('option', { text: entry.label, attrs: { value: entry.sort } })
        if (entry.sort === sort) option.setAttribute('selected', '')
        select.append(option)
      }
      select.addEventListener('change', () => {
        sort = librarySort(select.value)
        descending = sortStartsDown(sort)
        blocks = 1
        void keepPreference()
        redrawHead()
        if (view === 'songs') void load()
        else draw()
      })

      const tabs = el('div', { cls: 'oml-tabs', attrs: { role: 'tablist', 'aria-label': 'Your music' } })
      for (const entry of LIBRARY_VIEWS) {
        tabs.append(
          button(
            {
              cls: `oml-tab${entry.view === view ? ' om-on' : ''}`,
              text: entry.label,
              attrs: { role: 'tab', 'aria-selected': entry.view === view ? 'true' : 'false' },
              onClick: () => {
                if (entry.view === view) return
                void keepPreference(entry.view)
                // The list goes in the address, so pressing Albums leaves a history entry and the browser's back
                // button comes back to Songs. The search words are carried across, because somebody narrowing to one
                // artist and then looking at their albums means the same words.
                place.go('library', entry.view, said)
              }
            },
            []
          )
        )
      }

      return el('div', { cls: 'oml-head' }, [
        el('div', { cls: 'oml-head-top' }, [
          el('h1', { cls: 'oml-h1', text: 'Your music' }),
          el('div', { cls: 'oml-head-do' }, [
            button({ cls: 'om-btn', title: 'Add files to your music', onClick: () => void doAndSay(music.importFiles()) }, [
              icon('file', 16),
              el('span', { text: 'Add files' })
            ]),
            button({ cls: 'om-btn', title: 'Watch a folder for music', onClick: () => void doAndSay(music.watchFolder()) }, [
              icon('folder', 16),
              el('span', { text: 'Add a folder' })
            ])
          ])
        ]),
        tabs,
        el('div', { cls: 'oml-controls' }, [
          el('label', { cls: 'oml-search-wrap' }, [icon('search', 15), search]),
          select,
          button(
            {
              cls: 'om-icon',
              title: `${wayWords(sort, descending)} — press to turn it round`,
              onClick: () => {
                descending = !descending
                blocks = 1
                redrawHead()
                if (view === 'songs') void load()
                else draw()
              }
            },
            [el('span', { cls: 'oml-way', text: descending ? '↓' : '↑' })]
          ),
          el('div', { cls: 'oml-layout', attrs: { role: 'group', 'aria-label': 'How to show them' } }, [
            button(
              {
                cls: `om-icon${layout === 'list' ? ' om-on' : ''}`,
                title: 'Show them as a list',
                attrs: { 'aria-pressed': layout === 'list' ? 'true' : 'false' },
                onClick: () => {
                  layout = 'list'
                  redrawHead()
                  draw()
                }
              },
              [icon('list', 16)]
            ),
            button(
              {
                cls: `om-icon${layout === 'grid' ? ' om-on' : ''}`,
                title: 'Show them as squares of artwork',
                attrs: { 'aria-pressed': layout === 'grid' ? 'true' : 'false' },
                onClick: () => {
                  layout = 'grid'
                  redrawHead()
                  draw()
                }
              },
              [icon('panel', 16)]
            )
          ])
        ]),
        chipRow,
        count
      ])
    }

    // ---- drawing whatever came back

    /** The sentence when there is nothing, which is never the same question as whether there is nothing. */
    function nothing(what: string): HTMLElement {
      const words = emptyWords(problem ? (shut ? 'unreachable' : 'failed') : 'empty', what, problem)
      return says(words.title, words.detail, words.retry ? { label: 'Try again', onClick: () => void load() } : undefined)
    }

    function drawSongs(): void {
      if (!tracks) {
        fill(body, nothing('songs'))
        drawChips(null)
        count.textContent = ''
        return
      }
      const counts = libraryCounts(tracks)
      drawChips(counts)
      const kept = keepTracks(tracks, keep)
      const playIds = playableIds(kept)
      const seconds = kept.reduce((total, one) => total + (Number.isFinite(one.duration) && one.duration > 0 ? one.duration : 0), 0)
      count.textContent =
        kept.length === 0
          ? ''
          : `${countText(kept.length, 'song', 'songs')} · ${countText(counts.here, 'playable here', 'playable here')} · ${countText(counts.reference, 'saved by name', 'saved by name')}${seconds > 0 ? ` · ${spanText(seconds)}` : ''}`

      if (kept.length === 0) {
        fill(body, problem ? nothing('songs') : says(said ? 'Nothing matched those words' : 'No songs here', said ? 'Try fewer words.' : (LIBRARY_KEEPS.find((one) => one.keep === keep)?.detail ?? '')))
        return
      }

      const upTo = shownRows(kept.length, blocks)
      const shown = kept.slice(0, upTo)

      if (layout === 'grid') {
        const grid = el('div', { cls: 'oml-grid' })
        for (const track of shown) {
          const playable = playableOffline(track)
          grid.append(
            card(
              {
                name: track.title || 'No title',
                sub: [track.artist, availabilityPill(track)].filter((one) => one).join(' · '),
                cover: { id: track.id, title: track.title, artist: track.artist, album: track.album },
                title: track.album ? `The record ${track.album}` : track.title,
                open: () => (track.album ? place.go('album', track.album) : void doAndSay(music.play(track.id))),
                play: playable ? () => void doAndSay(music.playAll(playIds, playIds.indexOf(track.id))) : undefined
              },
              holders
            )
          )
        }
        fill(body, grid, more(kept.length, upTo))
      } else {
        const rows = el('ul', { cls: 'oml-table', attrs: { role: 'table', 'aria-label': 'Your songs' } })
        // Pressing a column heading changes the order, so the head above has to say the new one too.
        rows.append(
          tableHead(() => {
            redrawHead()
            blocks = 1
            void load()
          })
        )
        shown.forEach((track, at) => rows.append(songRow(track, at, playIds, track.id === playingId, holders, place)))
        fill(body, rows, more(kept.length, upTo))
      }
      place.wantCovers(shown.map((one) => one.id))
    }

    function drawGroups(): void {
      if (!groups) {
        fill(body, nothing(view))
        drawChips(null)
        count.textContent = ''
        return
      }
      const everyTrack = groups.flatMap((one) => one.tracks)
      drawChips(libraryCounts(everyTrack))
      const kept = sortGroups(findGroups(keepGroups(groups, keep), said), sort, descending)
      count.textContent = kept.length === 0 ? '' : countText(kept.length, view.slice(0, -1), view)

      if (kept.length === 0) {
        fill(body, problem ? nothing(view) : says(said ? 'Nothing matched those words' : `No ${view} here`, said ? 'Try fewer words.' : ''))
        return
      }

      const upTo = shownRows(kept.length, blocks, 60)
      const shown = kept.slice(0, upTo)
      const holder = layout === 'grid' ? el('div', { cls: 'oml-grid' }) : el('ul', { cls: 'oml-growlist' })
      for (const group of shown) {
        // Only the songs with audio: the rest of the album is still listed on its own screen, but nothing
        // goes into the run that would simply be skipped.
        const ids = playableIds(group.tracks)
        const playable = ids.length > 0
        const length = groupSeconds(group)
        const of: CardOf = {
          name: group.name,
          sub: groupSub(group, view),
          cover: { id: group.tracks[0]?.id, title: group.name, artist: group.by, album: view === 'albums' ? group.name : undefined },
          round: view === 'artists',
          title: `${group.name} — ${groupSub(group, view)}${length.seconds > 0 ? `, ${spanText(length.seconds)}` : ''}${length.unknown > 0 ? ` and ${length.unknown} of unknown length` : ''}`,
          open: () => place.go(view === 'albums' ? 'album' : view === 'artists' ? 'artist' : 'genre', group.name),
          play: playable ? () => void doAndSay(music.playAll(ids)) : undefined
        }
        holder.append(layout === 'grid' ? card(of, holders) : groupRow(of, holders))
      }
      fill(body, holder, more(kept.length, upTo))
      place.wantCovers(shown.map((one) => one.tracks[0]?.id).filter((one): one is string => typeof one === 'string'))
    }

    function drawPlaylists(): void {
      if (!playlists) {
        fill(body, nothing('playlists'))
        drawChips(null)
        count.textContent = ''
        return
      }
      // The chips are about whether Orbis has the audio for a song, and a playlist holds ids rather than songs -- the
      // songs are read separately, and a smart playlist is worked out afresh every time it is asked for. So there is
      // nothing here for a chip to filter and the row is left out rather than shown doing nothing.
      fill(chipRow)
      const words = said.toLowerCase().trim()
      const kept = playlists
        .filter((one) => !words || one.name.toLowerCase().includes(words))
        .sort((a, b) => (sort === 'added' ? a.createdAt - b.createdAt : a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1))
      if (descending) kept.reverse()
      count.textContent = kept.length === 0 ? '' : countText(kept.length, 'playlist', 'playlists')

      if (kept.length === 0) {
        fill(
          body,
          problem
            ? nothing('playlists')
            : says(words ? 'Nothing matched those words' : 'No playlists yet', words ? 'Try fewer words.' : 'A playlist you make shows up here and down the left.')
        )
        return
      }

      const holder = layout === 'grid' ? el('div', { cls: 'oml-grid' }) : el('ul', { cls: 'oml-growlist' })
      for (const list of kept) {
        // A smart playlist is worked out from the library every time, so it has no fixed number of songs and saying
        // one would be a number that changes behind the words. It says what it is instead.
        const sub = list.rule ? 'Worked out from your library' : countText(list.tracks.length, 'song', 'songs')
        const of: CardOf = {
          name: list.name,
          sub,
          cover: { title: list.name },
          title: `${list.name} — ${sub}`,
          open: () => place.go('playlist', list.id),
          play: () => void doAndSay(music.playPlaylist(list.id))
        }
        holder.append(layout === 'grid' ? card(of, holders) : groupRow(of, holders))
      }
      fill(body, holder)
    }

    /** The line under a list that has more to it, and the button that draws the next block. */
    function more(total: number, upTo: number): HTMLElement | null {
      if (upTo >= total) return null
      return el('div', { cls: 'oml-more' }, [
        el('span', { cls: 'oml-faint', text: `Showing ${upTo} of ${total}.` }),
        button({
          cls: 'om-btn om-btn-quiet',
          text: 'Show more',
          onClick: () => {
            blocks += 1
            draw()
          }
        })
      ])
    }

    function draw(): void {
      holders = []
      if (view === 'songs') drawSongs()
      else if (view === 'playlists') drawPlaylists()
      else drawGroups()
    }

    // ---- typing in the search box

    search.addEventListener('input', () => {
      said = search.value
      // The address is replaced rather than pushed, so a hundred letters do not become a hundred back presses. The
      // frame does not remount the screen when only the words change, which is what keeps the box's focus.
      place.replace('library', view, said)
      if (typing) clearTimeout(typing)
      typing = setTimeout(() => {
        blocks = 1
        if (view === 'songs') void load()
        else draw()
      }, 200)
    })
    search.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape' || search.value === '') return
      search.value = ''
      said = ''
      place.replace('library', view, '')
      blocks = 1
      if (view === 'songs') void load()
      else draw()
    })

    // ---- a long list, a block at a time

    const scrolled = (): void => {
      if (!nearEnd(place.into.scrollTop, place.into.clientHeight, place.into.scrollHeight)) return
      const total = view === 'songs' ? (tracks ? keepTracks(tracks, keep).length : 0) : (groups?.length ?? 0)
      const step = view === 'songs' ? undefined : 60
      if (shownRows(total, blocks, step) >= total) return
      blocks += 1
      draw()
    }
    place.into.addEventListener('scroll', scrolled, { passive: true })

    fill(place.into, headBox, body)
    redrawHead()
    fill(body, says(emptyWords('loading', view === 'songs' ? 'songs' : view).title, ''))

    /**
     * The first time this screen is opened, the list and the order come from what was stored.
     *
     * Read once per tab rather than on every mount: after somebody has pressed Albums, the stored value is the old
     * one until the write lands, and reading it again would put them back where they were.
     */
    async function start(): Promise<void> {
      if (!readStored) {
        readStored = true
        const answer = await music.settings()
        if (answer.got) {
          const was = fromStored(answer.value.view)
          sort = librarySort(answer.value.sort)
          descending = sortStartsDown(sort)
          keep = was.keep
          if (was.view !== view && place.route.of === '') {
            // Nothing in the address said which list, so the stored one wins -- replaced rather than pushed, so the
            // back button does not have to step through a list nobody chose.
            place.replace('library', was.view, said)
            return
          }
          redrawHead()
        }
      }
      await load()
    }
    void start()

    return {
      onPlayer: (state: PlayerState) => {
        const was = playingId
        playingId = state.music?.playback.trackId ?? null
        // Only the table marks which row is playing, and only a change of track moves that mark. Redrawing on every
        // answer would rebuild the list once a second and take the scroll and the focus ring with it.
        if (was !== playingId && view === 'songs' && layout === 'list') draw()
      },
      onCovers: () => {
        for (const held of holders) fill(held.node, tile(held.of, { size: held.size, round: held.round }))
      },
      leave: () => {
        gone = true
        if (typing) clearTimeout(typing)
        place.into.removeEventListener('scroll', scrolled)
      }
    }
  }
})
