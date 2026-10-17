/**
 * Search.
 *
 * One box, and results that change as the words do. Two different searches arrive here and both are answered:
 *
 *   - **a name.** "blinding lights", "nirvana", "after hours". The music service looks it up and says which row is
 *     clearly the one meant, if any is.
 *   - **a description.** "calm songs I haven't heard". The service reads it as a request and chooses from the music
 *     on this computer. When that is what happened, the screen says so, because somebody who meant to look up a
 *     title needs to know their words were read as a mood.
 *
 * **Nothing here decides what a good match is.** `music:do ['find', …]` already ranks the rows and already decides
 * whether one of them stands clearly ahead of the rest -- that is `topOf` in `src/shared/music/search.ts`, and it
 * answers "nothing stands out" on purpose. A second opinion written on this screen would be a second idea of what a
 * good answer is, and the two would disagree. The only sorting this file owns is over the person's own albums,
 * artists and genres, which the service does not rank at all; that lives in `src/shared/music/searchScreen.ts` with
 * its own tests.
 *
 * **Nothing here invents a result.** Every row, every artist, every album and every genre on this screen came out of
 * the person's own library. With an empty box the screen browses the genres they really have; with nothing matching
 * it says one plain sentence. There is no suggested artist, no editorial shelf and no filler grid, because Orbis has
 * no catalogue to fill one from and a grid of things that do not exist is a convincing lie.
 */

import type { Grouped, OrbisTrack, Playlist } from '../../../src/shared/music.ts'
import {
  biggestGroups,
  describedWords,
  matchesName,
  matchingGroups,
  movePick,
  nothingFoundWords,
  notUnderstoodWords,
  placesWords,
  readRecentSearches,
  rememberSearch,
  searchable,
  versionWords
} from '../../../src/shared/music/searchScreen.ts'
import { countText, clockText } from '../../../src/shared/music/fulltab.ts'
import * as music from '../client.ts'
import { coverFor, tile } from '../art.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import * as player from '../player.ts'
import { onRoute } from '../router.ts'
import { registerScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay, trackRow } from '../shell.ts'

/**
 * This screen's own stylesheet, brought in by the screen itself.
 *
 * `extension/music.css` belongs to the frame and to every other screen at once, so a screen that wrote into it would
 * be editing a file several other screens are also growing. A separate file asked for here keeps this screen's rules
 * to this screen, and the extension stages whole folders, so nothing has to list it.
 */
function bringInStyles(): void {
  const href = 'music-search.css'
  if (document.querySelector(`link[data-om-sheet="search"]`)) return
  const link = el('link', { attrs: { rel: 'stylesheet', href, 'data-om-sheet': 'search' } })
  document.head.append(link)
}

// ---------------------------------------------------------------- the recent list, kept on this computer

const RECENT_KEY = 'orbis.music.recent-searches'

/**
 * The recent searches, kept in this browser alone.
 *
 * Not in the music service: a search is a thing somebody did on this screen, not a fact about their library, and
 * sending every typed phrase into the engine's own store would make the library file grow for no reason. Every read
 * and every write is wrapped, because storage can be switched off and a page that threw on start-up would be a
 * broken screen over a working library.
 */
function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    return readRecentSearches(raw === null ? null : (JSON.parse(raw) as unknown))
  } catch {
    return []
  }
}

function writeRecent(list: readonly string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // Storage is off or full. The list is a convenience; losing it is not worth saying anything about.
  }
}

// ---------------------------------------------------------------- what one search came back with

interface Found {
  readonly top: FoundRow | null
  readonly tracks: readonly FoundRow[]
  readonly empty: { readonly title: string; readonly detail: string; readonly retry: boolean } | null
  readonly asked: unknown
  readonly parsed: { readonly described?: number; readonly notUnderstood?: readonly string[] } | null
}

/** One row as the music service arranges it. Written out here because `find` answers `unknown` through the client. */
interface FoundRow {
  readonly canonical: {
    readonly key: string
    readonly title: string
    readonly name: string
    readonly artist: string
    readonly album: string | null
    readonly version: unknown
    readonly duration: number | null
    readonly year: number | null
  }
  readonly playable: boolean
  readonly inLibrary: boolean
  readonly libraryId: string | null
  readonly favourite: boolean
  readonly plays: number
}

/** The service's answer, read defensively: a field that is not there shows as nothing rather than crashing a screen. */
function readFound(value: unknown): Found {
  const one = (value ?? {}) as Record<string, unknown>
  const rows = Array.isArray(one.tracks) ? (one.tracks as FoundRow[]).filter((row) => row && row.canonical) : []
  const top = one.top && (one.top as FoundRow).canonical ? (one.top as FoundRow) : null
  const empty = one.empty && typeof one.empty === 'object' ? (one.empty as Found['empty']) : null
  return { top, tracks: rows, empty, asked: one.asked, parsed: (one.parsed as Found['parsed']) ?? null }
}

// ---------------------------------------------------------------- the screen

/** Everything one mounted Search screen is holding. */
interface Held {
  said: string
  recent: string[]
  /** The person's own lists. Read once per mount, because they change when the library does, not as words are typed. */
  albums: Grouped[] | null
  artists: Grouped[] | null
  genres: Grouped[] | null
  playlists: Playlist[] | null
  /** Why one of those lists is missing, in the music service's own words. */
  problem: string | null
  shut: boolean
  found: Found | null
  mine: OrbisTrack[] | null
  asking: boolean
  /** Which answer is the current one. An answer that arrives after a newer search was asked for is dropped. */
  token: number
}

registerScreen({
  screen: 'search',
  title: (route) => (searchable(route.said) ? `Search: ${searchable(route.said)}` : 'Search'),
  wants: { nowPlaying: 'as-chosen' },
  mount: (place) => mountSearch(place)
})

function mountSearch(place: ScreenPlace) {
  bringInStyles()

  const held: Held = {
    said: searchable(place.route.said),
    recent: readRecent(),
    albums: null,
    artists: null,
    genres: null,
    playlists: null,
    problem: null,
    shut: false,
    found: null,
    mine: null,
    asking: false,
    token: 0
  }

  const box = el('input', {
    cls: 'om-sr-input',
    attrs: {
      type: 'search',
      placeholder: 'A song, an artist, an album, or what you feel like',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Search your music',
      value: held.said
    }
  })
  const clearButton = button(
    {
      cls: 'om-icon om-icon-sm om-sr-clear',
      title: 'Clear the search',
      onClick: () => {
        box.value = ''
        typed('')
        box.focus()
      }
    },
    [icon('close', 15)]
  )
  const results = el('div', { cls: 'om-sr-results' })
  const notes = el('div', { cls: 'om-sr-notes' })

  const screen = el('div', { cls: 'om-sr' }, [el('div', { cls: 'om-sr-box' }, [icon('search', 18), box, clearButton]), notes, results])
  fill(place.into, screen)

  // ---- asking

  let timer: ReturnType<typeof setTimeout> | null = null

  /**
   * Waiting a moment before asking.
   *
   * Short enough that results feel like they follow the typing, long enough that a four-letter word is one search
   * and not four. Each search carries a number and a late answer to an older one is thrown away, because answers can
   * come back out of order and the rows for "nir" appearing over the rows for "nirvana" reads as a broken search.
   */
  function typed(words: string): void {
    const tidy = searchable(words)
    held.said = tidy
    place.replace('search', '', tidy)
    clearButton.classList.toggle('om-sr-clear-on', tidy !== '')
    if (timer) clearTimeout(timer)
    if (!tidy) {
      held.found = null
      held.mine = null
      draw()
      return
    }
    timer = setTimeout(() => void ask(tidy), 180)
  }

  async function ask(words: string): Promise<void> {
    const mine = ++held.token
    held.asking = true
    const [found, library] = await Promise.all([music.find(words, 60), music.library({ search: words })])
    if (mine !== held.token) return
    held.asking = false
    if (found.got) held.found = readFound(found.value)
    else {
      held.found = null
      held.problem = found.why
      held.shut = found.shut
    }
    if (library.got) held.mine = library.value
    else {
      held.mine = null
      held.problem = library.why
      held.shut = library.shut
    }
    const wanted = (held.mine ?? []).slice(0, 40).map((one) => one.id)
    if (wanted.length > 0) place.wantCovers(wanted)
    draw()
  }

  /** The person's own albums, artists, genres and playlists. Asked for once, when the screen opens. */
  async function readMine(): Promise<void> {
    const [albums, artists, genres, playlists] = await Promise.all([music.albums(), music.artists(), music.genres(), music.playlists()])
    for (const answer of [albums, artists, genres, playlists]) {
      if (!answer.got) {
        held.problem = answer.why
        held.shut = answer.shut
      }
    }
    if (albums.got) held.albums = albums.value
    if (artists.got) held.artists = artists.value
    if (genres.got) held.genres = genres.value
    if (playlists.got) held.playlists = playlists.value
    draw()
  }

  // ---- drawing

  function drawNotes(): void {
    const lines: string[] = []
    const parsed = held.found?.parsed ?? null
    const described = describedWords(parsed?.described)
    if (described) lines.push(described)
    const unread = notUnderstoodWords(parsed?.notUnderstood)
    if (unread) lines.push(unread)
    for (const one of placesWords(held.found?.asked)) lines.push(one)
    fill(notes, ...lines.map((words) => el('p', { cls: 'om-sr-note', text: words })))
  }

  function draw(): void {
    drawNotes()
    if (!held.said) {
      drawEmptyBox()
      return
    }
    drawResults()
    markPlaying(player.current())
  }

  /** With nothing typed: what was searched for lately, and the genres this library really has. */
  function drawEmptyBox(): void {
    const parts: (HTMLElement | null)[] = []

    if (held.recent.length > 0) {
      parts.push(
        el('section', { cls: 'om-sr-group' }, [
          el('div', { cls: 'om-sr-group-head' }, [
            el('h2', { cls: 'om-sr-group-title', text: 'Searched lately' }),
            button({
              cls: 'om-btn om-btn-quiet',
              text: 'Clear',
              title: 'Forget every recent search',
              onClick: () => {
                held.recent = []
                writeRecent(held.recent)
                draw()
              }
            })
          ]),
          el(
            'ul',
            { cls: 'om-sr-chips' },
            held.recent.map((words) =>
              el('li', { cls: 'om-sr-chip' }, [
                button({
                  cls: 'om-sr-chip-go',
                  text: words,
                  attrs: { 'data-om-pick': 'recent' },
                  onClick: () => {
                    box.value = words
                    typed(words)
                  }
                }),
                button(
                  {
                    cls: 'om-sr-chip-drop',
                    title: `Forget "${words}"`,
                    onClick: () => {
                      held.recent = held.recent.filter((one) => one !== words)
                      writeRecent(held.recent)
                      draw()
                    }
                  },
                  [icon('close', 12)]
                )
              ])
            )
          )
        ])
      )
    }

    const genres = held.genres
    if (genres === null) {
      parts.push(
        el('section', { cls: 'om-sr-group' }, [
          el('h2', { cls: 'om-sr-group-title', text: 'Browse your genres' }),
          says(
            held.shut ? 'Orbis Music is not open' : 'Orbis could not read your genres',
            held.shut
              ? 'Open the Orbis window and your music connects by itself. Nothing here means your music is gone.'
              : (held.problem ?? 'Nothing was changed. Try again in a moment.'),
            { label: 'Try again', onClick: () => void readMine() }
          )
        ])
      )
    } else if (genres.length === 0) {
      parts.push(
        el('section', { cls: 'om-sr-group' }, [
          el('h2', { cls: 'om-sr-group-title', text: 'Browse your genres' }),
          says('No genres yet', 'Genres come off the files themselves. Bring some music in and they appear here.')
        ])
      )
    } else {
      parts.push(
        el('section', { cls: 'om-sr-group' }, [
          el('h2', { cls: 'om-sr-group-title', text: 'Browse your genres' }),
          el('div', { cls: 'om-sr-cards' }, biggestGroups(genres, 60).map((one) => groupCard(one, 'genre')))
        ])
      )
    }

    fill(results, ...parts.filter((one): one is HTMLElement => one !== null))
  }

  /** With words typed: the groups, in the order somebody reads them. */
  function drawResults(): void {
    const found = held.found
    const mine = held.mine ?? []
    const parts: HTMLElement[] = []

    if (found?.top) parts.push(topCard(found.top))

    if (mine.length > 0) {
      const ids = mine.map((one) => one.id)
      const playingId = player.current().music?.playback.trackId ?? null
      parts.push(
        el('section', { cls: 'om-sr-group' }, [
          el('div', { cls: 'om-sr-group-head' }, [
            el('h2', { cls: 'om-sr-group-title', text: 'Songs' }),
            button({
              cls: 'om-btn om-btn-primary',
              text: `Play ${countText(mine.length, 'song', 'songs')}`,
              onClick: () => void doAndSay(music.playAll(ids, 0))
            })
          ]),
          el(
            'ul',
            { cls: 'om-rows' },
            mine.slice(0, 60).map((track, index) => {
              const row = trackRow(track, { playing: track.id === playingId, onPlay: () => void doAndSay(music.playAll(ids, index)) })
              const play = row.querySelector('.om-row-play')
              if (play) play.setAttribute('data-om-pick', 'track')
              row.setAttribute('data-om-track', track.id)
              return row
            })
          )
        ])
      )
    }

    // Rows the service found that are not in the library list above. A recording with no audio on this computer is
    // still a real answer -- Orbis knows the song -- so it is listed and plainly marked, never quietly dropped.
    const already = new Set(mine.map((one) => one.id))
    const elsewhere = (found?.tracks ?? []).filter((row) => !(row.libraryId !== null && already.has(row.libraryId)))
    if (elsewhere.length > 0) {
      parts.push(
        el('section', { cls: 'om-sr-group' }, [
          el('h2', { cls: 'om-sr-group-title', text: 'Also found' }),
          el('ul', { cls: 'om-sr-rows' }, elsewhere.slice(0, 40).map((row) => foundRow(row)))
        ])
      )
    }

    const artists = matchingGroups(held.artists ?? [], held.said)
    if (artists.length > 0) parts.push(cardGroup('Artists', artists, 'artist'))

    const albums = matchingGroups(held.albums ?? [], held.said)
    if (albums.length > 0) parts.push(cardGroup('Albums', albums, 'album'))

    const genres = matchingGroups(held.genres ?? [], held.said)
    if (genres.length > 0) parts.push(cardGroup('Genres', genres, 'genre'))

    const lists = (held.playlists ?? []).filter((one) => matchesName(one.name, held.said)).slice(0, 12)
    if (lists.length > 0) {
      parts.push(
        el('section', { cls: 'om-sr-group' }, [
          el('h2', { cls: 'om-sr-group-title', text: 'Playlists' }),
          el(
            'ul',
            { cls: 'om-sr-rows' },
            lists.map((list) =>
              el('li', { cls: 'om-sr-row' }, [
                button(
                  {
                    cls: 'om-sr-row-go',
                    attrs: { 'data-om-pick': 'playlist' },
                    onClick: () => {
                      remember()
                      place.go('playlist', list.id)
                    }
                  },
                  [
                    tile({ title: list.name }, { size: 'md' }),
                    el('span', { cls: 'om-sr-row-words' }, [
                      el('span', { cls: 'om-sr-row-title', text: list.name }),
                      el('span', {
                        cls: 'om-sr-row-sub',
                        text: list.rule ? 'Worked out from your music' : countText(list.tracks.length, 'song', 'songs')
                      })
                    ])
                  ]
                ),
                button({ cls: 'om-icon om-icon-sm', title: `Play ${list.name}`, onClick: () => void doAndSay(music.playPlaylist(list.id)) }, [icon('play', 15)])
              ])
            )
          )
        ])
      )
    }

    if (parts.length === 0) {
      // Nothing matched. Which is different from the search having failed, and different again from the Orbis window
      // being shut -- three states, three sentences, because an empty screen reads as "you have no music".
      if (held.asking) fill(results, says('Looking…'))
      else if (held.found === null && held.problem !== null)
        fill(
          results,
          says(
            held.shut ? 'Orbis Music is not open' : 'Orbis could not search',
            held.shut ? 'Open the Orbis window and your music connects by itself.' : held.problem,
            { label: 'Try again', onClick: () => void ask(held.said) }
          )
        )
      else if (found?.empty) fill(results, says(found.empty.title, found.empty.detail, found.empty.retry ? { label: 'Try again', onClick: () => void ask(held.said) } : undefined))
      else {
        const words = nothingFoundWords(held.said)
        fill(results, says(words.title, words.detail))
      }
      return
    }

    fill(results, ...parts)
  }

  /** The one row the service says is clearly what was meant. Absent whenever nothing stands out, and that is normal. */
  function topCard(row: FoundRow): HTMLElement {
    const version = versionWords(row.canonical.version)
    const canPlay = row.playable && row.libraryId !== null
    return el('section', { cls: 'om-sr-group' }, [
      el('h2', { cls: 'om-sr-group-title', text: 'Top result' }),
      el('div', { cls: 'om-sr-top' }, [
        tile(
          { id: row.libraryId ?? undefined, title: row.canonical.name || row.canonical.title, artist: row.canonical.artist, album: row.canonical.album ?? '' },
          { size: 'xl' }
        ),
        el('div', { cls: 'om-sr-top-words' }, [
          el('p', { cls: 'om-sr-top-kind', text: 'Song' }),
          el('h3', { cls: 'om-sr-top-title' }, [
            el('span', { text: row.canonical.name || row.canonical.title }),
            version ? el('span', { cls: 'om-pill om-sr-version', text: version }) : null
          ]),
          el('p', { cls: 'om-sr-top-artist', text: [row.canonical.artist, row.canonical.album].filter((one) => one).join(' — ') || 'No artist named' }),
          el('div', { cls: 'om-sr-top-pills' }, [
            row.inLibrary ? el('span', { cls: 'om-pill', text: 'In your music' }) : null,
            row.playable ? null : el('span', { cls: 'om-pill om-pill-warn', text: 'No audio here' }),
            row.plays > 0 ? el('span', { cls: 'om-pill', text: countText(row.plays, 'play', 'plays') }) : null
          ]),
          el('div', { cls: 'om-sr-top-does' }, [
            button({
              cls: 'om-btn om-btn-primary',
              text: canPlay ? 'Play' : 'Cannot be played',
              attrs: { 'data-om-pick': 'top', disabled: canPlay ? null : true },
              title: canPlay ? undefined : 'Orbis knows this song but has no audio for it on this computer.',
              onClick: () => {
                if (!canPlay || row.libraryId === null) return
                remember()
                void doAndSay(music.play(row.libraryId))
              }
            }),
            row.libraryId !== null
              ? button({
                  cls: 'om-btn',
                  text: 'Play next',
                  onClick: () => void doAndSay(music.queueNext([row.libraryId as string]))
                })
              : null
          ])
        ])
      ])
    ])
  }

  /** A row the service found, which may or may not have audio on this computer. */
  function foundRow(row: FoundRow): HTMLElement {
    const version = versionWords(row.canonical.version)
    const canPlay = row.playable && row.libraryId !== null
    const length = row.canonical.duration === null ? clockText(0) : clockText(row.canonical.duration)
    return el('li', { cls: `om-sr-row${canPlay ? '' : ' om-sr-row-off'}` }, [
      button(
        {
          cls: 'om-sr-row-go',
          attrs: { 'data-om-pick': 'found' },
          title: canPlay ? `Play ${row.canonical.title}` : 'Orbis knows this song but has no audio for it on this computer.',
          onClick: () => {
            if (!canPlay || row.libraryId === null) {
              place.note('Orbis knows this song but has no audio for it on this computer. Import your own copy to play it here.')
              return
            }
            remember()
            void doAndSay(music.play(row.libraryId))
          }
        },
        [
          tile(
            { id: row.libraryId ?? undefined, title: row.canonical.name || row.canonical.title, artist: row.canonical.artist, album: row.canonical.album ?? '' },
            { size: 'md' }
          ),
          el('span', { cls: 'om-sr-row-words' }, [
            el('span', { cls: 'om-sr-row-title' }, [
              el('span', { text: row.canonical.name || row.canonical.title }),
              version ? el('span', { cls: 'om-pill om-sr-version', text: version }) : null
            ]),
            el('span', { cls: 'om-sr-row-sub', text: [row.canonical.artist, row.canonical.album].filter((one) => one).join(' — ') || 'No artist named' })
          ])
        ]
      ),
      row.inLibrary ? el('span', { cls: 'om-pill', text: 'In your music' }) : el('span', { cls: 'om-pill om-pill-warn', text: 'No audio here' }),
      el('span', { cls: 'om-sr-row-length', text: length })
    ])
  }

  /** A shelf of the person's own albums, artists or genres. */
  function cardGroup(title: string, groups: readonly Grouped[], screen: 'album' | 'artist' | 'genre'): HTMLElement {
    return el('section', { cls: 'om-sr-group' }, [
      el('h2', { cls: 'om-sr-group-title', text: title }),
      el('div', { cls: 'om-sr-cards' }, groups.map((one) => groupCard(one, screen)))
    ])
  }

  /**
   * One card for an album, an artist or a genre.
   *
   * Two things to press: the card itself opens that screen, and the round button plays the whole group. The play
   * button is there because every one of these groups already has its real tracks in hand, so playing it needs
   * nothing the screen has not got -- and because a genre screen may not be built yet.
   */
  function groupCard(group: Grouped, screen: 'album' | 'artist' | 'genre'): HTMLElement {
    const ids = group.tracks.map((one) => one.id)
    const first = group.tracks[0]
    return el('div', { cls: 'om-sr-card' }, [
      button(
        {
          cls: 'om-sr-card-go',
          attrs: { 'data-om-pick': screen },
          title: `Open ${group.name}`,
          onClick: () => {
            remember()
            place.go(screen, group.name)
          }
        },
        [
          el('span', { cls: `om-sr-card-art${screen === 'artist' ? ' om-sr-card-round' : ''}` }, [
            tile({ id: first?.id, title: group.name, artist: group.by ?? '', album: screen === 'album' ? group.name : '' }, { size: 'lg', round: screen === 'artist' })
          ]),
          el('span', { cls: 'om-sr-card-name', text: group.name }),
          el('span', {
            cls: 'om-sr-card-sub',
            text: screen === 'album' && group.by ? group.by : countText(group.tracks.length, 'song', 'songs')
          })
        ]
      ),
      button(
        {
          cls: 'om-sr-card-play',
          title: `Play ${group.name}`,
          onClick: () => {
            remember()
            void doAndSay(music.playAll(ids, 0))
          }
        },
        [icon('play', 16)]
      )
    ])
  }

  // ---- the keyboard

  const picks = (): HTMLElement[] => [...screen.querySelectorAll<HTMLElement>('[data-om-pick]')].filter((one) => !one.hasAttribute('disabled'))

  /**
   * Up and down through everything on screen, in the order it is read.
   *
   * Asked of the page at the moment of the press rather than kept in a list, because the results change as the words
   * do and a kept list would move focus to a row that is no longer there.
   */
  function step(from: HTMLElement | null, direction: number): void {
    const all = picks()
    if (all.length === 0) return
    const at = from ? all.indexOf(from) : -1
    const next = movePick(at, all.length, direction)
    if (next >= 0) all[next]?.focus()
  }

  screen.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key
    const where = event.target as HTMLElement | null
    if (where === box) {
      if (key === 'ArrowDown') {
        event.preventDefault()
        step(null, 1)
      } else if (key === 'Enter') {
        event.preventDefault()
        remember()
        step(null, 1)
      } else if (key === 'Escape' && box.value !== '') {
        event.preventDefault()
        box.value = ''
        typed('')
      }
      return
    }
    if (!where || !where.hasAttribute('data-om-pick')) return
    if (key === 'ArrowDown') {
      event.preventDefault()
      step(where, 1)
    } else if (key === 'ArrowUp') {
      event.preventDefault()
      step(where, -1)
    } else if (key === 'Home') {
      event.preventDefault()
      picks()[0]?.focus()
    } else if (key === 'End') {
      event.preventDefault()
      const all = picks()
      all[all.length - 1]?.focus()
    } else if (key === 'Escape') {
      event.preventDefault()
      box.focus()
    }
  })

  // ---- the rest

  /** Keeps this search in the recent list. Only on a press, so every letter on the way is not a search of its own. */
  function remember(): void {
    const next = rememberSearch(held.recent, held.said)
    if (next.length === held.recent.length && next[0] === held.recent[0]) return
    held.recent = next
    writeRecent(next)
  }

  box.addEventListener('input', () => typed(box.value))

  /**
   * Back and Forward.
   *
   * The shell does not mount this screen again when only the words change -- which is right, because it is why the
   * box keeps the focus while somebody types. But a Back press is also only a change of words, so the screen listens
   * for the address itself and catches up when it was somebody else who changed it.
   */
  const stopWatchingRoute = onRoute((now) => {
    if (now.screen !== 'search') return
    const words = searchable(now.said)
    if (words === held.said) return
    box.value = words
    held.said = words
    clearButton.classList.toggle('om-sr-clear-on', words !== '')
    if (timer) clearTimeout(timer)
    if (words) void ask(words)
    else {
      held.found = null
      held.mine = null
      draw()
    }
  })
  clearButton.classList.toggle('om-sr-clear-on', held.said !== '')

  void readMine()
  if (held.said) void ask(held.said)
  else draw()
  // The box takes the focus because this screen is one box; somebody who pressed Search wants to type.
  box.focus()

  /** Which row is playing, marked without rebuilding the list, so a press does not pull the rows out from under it. */
  function markPlaying(state: player.PlayerState): void {
    const playingId = state.music?.playback.trackId ?? null
    for (const row of screen.querySelectorAll<HTMLElement>('[data-om-track]')) {
      row.classList.toggle('om-row-now', row.getAttribute('data-om-track') === playingId)
    }
  }

  return {
    onPlayer: (state: player.PlayerState) => markPlaying(state),
    onCovers: () => {
      // Covers arrived. Put the picture into the squares that have not got one, in place: redrawing the whole list
      // here would take the focus off whatever somebody had tabbed to while the covers were on their way.
      for (const square of screen.querySelectorAll<HTMLElement>('.om-tile:not(.om-tile-has)')) {
        const row = square.closest('[data-om-track]')
        const id = row?.getAttribute('data-om-track')
        const picture = coverFor(id ?? undefined)
        if (!picture) continue
        square.classList.add('om-tile-has')
        fill(square, el('img', { cls: 'om-tile-img', attrs: { src: picture, alt: '', decoding: 'async' } }))
      }
    },
    leave: () => {
      if (timer) clearTimeout(timer)
      stopWatchingRoute()
      held.token += 1
    }
  }
}
