/**
 * Home: rows of cards, made of real things only.
 *
 * Every row on this screen comes from an answer the music service actually gave. What was played lately, the ways of
 * exploring the engine works out, the songs somebody marked as favourites, the songs Orbis noticed on web pages, and
 * the albums and artists worked out from the files that are really here. There is no catalogue behind Orbis Music --
 * no charts, no new releases, nothing editorial -- so the rows a streaming service fills from the internet are simply
 * not on this screen. A thin library gets fewer rows, and that is the honest shape of it.
 *
 * A row with nothing in it is not drawn at all. The decision about which rows survive, what each card says and which
 * covers are worth asking for first is all in `src/shared/music/home.ts`, where it is checked without a browser;
 * this file does nothing but turn those values into nodes and read the player back after a press.
 *
 * The one thing said in words is a library that is genuinely empty, and only when the player's own summary says the
 * count is nought. Six calls that failed is not an empty library, and would be a sentence somebody would believe.
 */

import {
  coverWants,
  greetingFor,
  haveWords,
  homeShelves,
  libraryIsEmpty,
  type HomeCard,
  type HomeShelf,
  type HomeParts
} from '../../../src/shared/music/home.ts'
import { emptyWords } from '../../../src/shared/music/fulltab.ts'
import { coverFor, tile } from '../art.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import * as player from '../player.ts'
import { registerScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay } from '../shell.ts'

registerScreen({
  screen: 'home',
  wants: { nowPlaying: 'as-chosen' },
  mount: (place) => start(place)
})

/** Everything Home holds while it is on screen. Nothing here is a copy of the player's state; that is read live. */
interface Held {
  /** Which card is drawn where, so a new cover or a new track playing redraws a card rather than the screen. */
  readonly cards: Map<string, { readonly cover: HTMLElement; readonly node: HTMLElement; readonly card: HomeCard }>
  shelves: readonly HomeShelf[]
  /** The track the cards were last marked against, so onPlayer only touches two cards instead of all of them. */
  marked: string | null
  gone: boolean
}

function start(place: ScreenPlace) {
  const held: Held = { cards: new Map(), shelves: [], marked: null, gone: false }

  const greeting = el('h1', { cls: 'om-home-greeting', text: greetingFor(new Date().getHours()) })
  const have = el('p', { cls: 'om-home-have' })
  const rows = el('div', { cls: 'om-home-rows' })
  fill(
    place.into,
    el('div', { cls: 'om-home' }, [
      el('header', { cls: 'om-home-head' }, [
        el('div', { cls: 'om-home-words' }, [greeting, have]),
        button({ cls: 'om-icon', title: 'Read your music again', onClick: () => void load() }, [icon('refresh', 18)])
      ]),
      rows
    ])
  )

  /** Reads everything the rows are made of, all at once, and draws whatever came back. */
  async function load(): Promise<void> {
    if (held.gone) return
    // Nothing is drawn over while this is in flight: what is already on screen stays until there is something to put
    // in its place, which is the difference between a screen that is loading and a screen that lost its music.
    if (held.shelves.length === 0) fill(rows, says('Reading your music…'))

    const [played, stations, favourites, noticed, albums, artists] = await Promise.all([
      music.playedLately(),
      music.explorations(),
      music.library({ favourite: true, sort: 'added', descending: true }),
      music.noticed(),
      music.albums(),
      music.artists()
    ])
    if (held.gone) return

    // A call that failed contributes no row. It must not contribute an empty one either: the row would carry a
    // heading over nothing, which reads as something broken rather than as a thing that was not readable.
    const parts: HomeParts = {
      played: played.got ? played.value : [],
      stations: stations.got ? stations.value : [],
      favourites: favourites.got ? favourites.value : [],
      noticed: noticed.got ? noticed.value : [],
      albums: albums.got ? albums.value : [],
      artists: artists.got ? artists.value : []
    }
    const answers = [played, stations, favourites, noticed, albums, artists]
    const shut = answers.some((one) => !one.got && one.shut)
    const firstProblem = answers.find((one) => !one.got && !one.shut)

    held.shelves = homeShelves(parts)
    draw(shut, firstProblem && !firstProblem.got ? firstProblem.why : null)
    place.wantCovers(coverWants(held.shelves))
  }

  function draw(shut: boolean, problem: string | null): void {
    held.cards.clear()
    held.marked = null
    const summary = player.current().music?.summary ?? null
    have.textContent = haveWords(summary) ?? ''
    have.classList.toggle('om-on', have.textContent !== '')

    if (held.shelves.length > 0) {
      fill(rows, ...held.shelves.map(shelfNode))
      markPlaying(player.current())
      return
    }

    // Nothing to draw. Which sentence depends on why, and the three reasons are genuinely different things.
    if (libraryIsEmpty(summary)) {
      fill(rows, firstTime())
      return
    }
    const words = emptyWords(shut ? 'unreachable' : problem ? 'failed' : 'loading', 'music', problem)
    fill(rows, says(words.title, words.detail, words.retry ? { label: 'Try again', onClick: () => void load() } : undefined))
  }

  /**
   * The screen somebody sees before they have any music.
   *
   * Real controls, not a tour: both buttons open the Orbis window's own file picker, which is the only way a browser
   * page can be given a file at all -- it never learns where anything lives on the computer.
   */
  function firstTime(): HTMLElement {
    return el('div', { cls: 'om-home-first' }, [
      el('h2', { cls: 'om-home-first-title', text: 'There is no music here yet' }),
      el('p', {
        cls: 'om-home-first-detail',
        text: 'Add some files, or point Orbis at a folder and it keeps watching that folder for anything new.'
      }),
      el('div', { cls: 'om-home-first-do' }, [
        button({ cls: 'om-btn om-btn-primary', onClick: () => void doAndSay(music.importFiles()) }, [icon('file', 16), el('span', { text: 'Add songs' })]),
        button({ cls: 'om-btn', onClick: () => void doAndSay(music.watchFolder()) }, [icon('folder', 16), el('span', { text: 'Add a folder' })]),
        button({ cls: 'om-btn om-btn-quiet', text: 'More ways to bring music in', onClick: () => place.go('bring-in') })
      ])
    ])
  }

  function shelfNode(shelf: HomeShelf): HTMLElement {
    const more = shelf.more
    return el('section', { cls: `om-shelf om-shelf-${shelf.kind}` }, [
      el('div', { cls: 'om-shelf-head' }, [
        el('div', { cls: 'om-shelf-words' }, [
          el('h2', { cls: 'om-shelf-title', text: shelf.title }),
          shelf.detail ? el('p', { cls: 'om-shelf-detail', text: shelf.detail }) : null
        ]),
        more ? button({ cls: 'om-btn om-btn-quiet', text: 'See all', onClick: () => place.go(more) }) : null
      ]),
      // One row that scrolls sideways rather than a grid that wraps: a row says "there is more of this that way",
      // where a wrapped grid of four says "this is all of it".
      el('div', { cls: 'om-shelf-row', attrs: { role: 'list' } }, shelf.cards.map((card) => cardNode(card, shelf)))
    ])
  }

  function cardNode(card: HomeCard, shelf: HomeShelf): HTMLElement {
    const cover = el('div', { cls: 'om-card-cover' })
    fill(cover, coverTile(card), el('span', { cls: 'om-card-play', attrs: { 'aria-hidden': 'true' } }, [icon('play', 18)]))

    // The whole card is the one control, so there is nothing to tab past to reach it and nothing nested inside a
    // button. The circle on the cover is drawn, not clickable: it shows what pressing the card will do.
    const node = button(
      {
        cls: `om-card${card.round ? ' om-card-round' : ''}${card.trackIds.length === 0 && !card.stationId ? ' om-card-off' : ''}`,
        title: cardTitle(card),
        attrs: { role: 'listitem' },
        onClick: () => void press(card)
      },
      [
        cover,
        el('span', { cls: 'om-card-words' }, [
          el('span', { cls: 'om-card-name', text: card.name }),
          el('span', { cls: 'om-card-under', text: card.under })
        ]),
        // A card with nothing to play says why on the card itself. Hiding it behind a press is how somebody comes to
        // think their music is broken when in fact Orbis only ever had the name of that song.
        card.why ? el('span', { cls: 'om-pill om-pill-warn', text: shelf.kind === 'noticed' ? 'Name only' : 'No audio here' }) : null
      ]
    )
    held.cards.set(card.key, { cover, node, card })
    return node
  }

  const coverTile = (card: HomeCard): HTMLElement =>
    tile({ id: card.coverTrackId, title: card.name, artist: card.under }, { size: 'lg', round: card.round })

  const cardTitle = (card: HomeCard): string => {
    if (card.stationId) return `Start ${card.name}`
    if (card.trackIds.length === 0) return card.why ?? 'There is nothing to play here'
    return `Play ${card.name}`
  }

  /** What a press does, which is one of three things and never a guess at which. */
  async function press(card: HomeCard): Promise<void> {
    if (card.stationId) {
      const answer = await music.explore(card.stationId)
      if (!answer.got) place.note(answer.why)
      else if (answer.value.ok === false) place.note(answer.value.why ?? 'Orbis could not start that.')
      else {
        // The engine says what it chose and why. Its words, not this file's: an explanation nobody can check is
        // decoration, and the engine is the only thing that knows which reasons actually counted.
        const because = (answer.value.because ?? []).slice(0, 2).join(' · ')
        place.note([answer.value.label ?? card.name, because].filter((one) => one).join(' — '))
      }
      place.refresh()
      return
    }
    if (card.trackIds.length === 0) {
      place.note(card.why ?? 'There is no audio for this on this computer.')
      return
    }
    await doAndSay(music.playAll(card.trackIds))
  }

  /** Marks the card whose song is playing. Two cards are touched, not the whole screen. */
  function markPlaying(state: player.PlayerState): void {
    const now = state.music?.playback.owner === 'orbis-music' ? state.music.playback.trackId : null
    if (now === held.marked) return
    for (const [, one] of held.cards) {
      const on = now !== null && one.card.trackIds.length === 1 && one.card.trackIds[0] === now
      one.node.classList.toggle('om-card-now', on)
    }
    held.marked = now
  }

  void load()

  return {
    onPlayer: (state: player.PlayerState) => markPlaying(state),
    onCovers: () => {
      // Drawn, not rebuilt: a card rebuilt when a cover lands would lose the focus ring off whatever somebody had
      // tabbed to, and a row of forty cards would flicker every time a batch of sixty pictures arrived.
      for (const [, one] of held.cards) {
        if (!one.card.coverTrackId || !coverFor(one.card.coverTrackId)) continue
        const play = one.cover.querySelector('.om-card-play')
        fill(one.cover, coverTile(one.card), play ?? el('span', { cls: 'om-card-play', attrs: { 'aria-hidden': 'true' } }, [icon('play', 18)]))
      }
      const summary = player.current().music?.summary ?? null
      have.textContent = haveWords(summary) ?? ''
    },
    leave: () => {
      held.gone = true
      held.cards.clear()
    }
  }
}
