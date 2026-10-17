/**
 * What you have been listening to.
 *
 * Every number on this screen was counted. Orbis writes a play down only once enough of a track has really gone by --
 * half of it, or twenty seconds -- and it keeps the count and the time of the last one on the track itself. That is
 * the whole of what there is, and this screen shows exactly that and no more.
 *
 * What it therefore does not show, on purpose: listening time. Plays multiplied by length is a number nobody
 * measured, and "you listened for fourteen hours this month" worked out that way would be a figure Orbis invented.
 * There is also no month, no week and no year view, because a browser page can read only the latest play of each song
 * and not the list of every play behind it. A screen that offered those would be offering a shape it cannot fill.
 */

import { countText } from '../../../src/shared/music/fulltab.ts'
import { listeningSummary, topAlbums, topArtists, topGenres, topSongs, whenWords, type Tally } from '../../../src/shared/music/listening.ts'
import type { OrbisTrack } from '../../../src/shared/music.ts'
import * as music from '../client.ts'
import { el, fill } from '../dom.ts'
import { registerScreen } from '../screens.ts'
import { doAndSay, trackRow } from '../shell.ts'
import { block, figure, figures, nothingYet, press, reading, screenHead, unwrap } from './own-parts.ts'

/** One name and the plays behind it: the artist, and how many songs those plays were spread over. */
function tallyRow(one: Tally, most: number): HTMLElement {
  return el('li', { cls: 'om-own-tally' }, [
    el('span', { cls: 'om-own-tally-name', text: one.name }),
    el('span', { cls: 'om-own-tally-rail', attrs: { 'aria-hidden': 'true' } }, [
      el('span', { cls: 'om-own-tally-fill', style: { '--om-own-fill': `${most > 0 ? Math.round((one.plays / most) * 100) : 0}%` } })
    ]),
    el('span', {
      cls: 'om-own-tally-count',
      text: countText(one.plays, 'play', 'plays'),
      title: `${countText(one.plays, 'play', 'plays')} across ${countText(one.songs, 'song', 'songs')}`
    })
  ])
}

/**
 * One track row with a measured figure on the end of it.
 *
 * The figure goes inside the row rather than beside it: the row is a grid of fixed columns, and a wrapper around it
 * would put a list item inside something that is not a list.
 */
function dated(row: HTMLElement, words: string): HTMLElement {
  row.classList.add('om-own-dated')
  row.append(el('span', { cls: 'om-own-when', text: words }))
  return row
}

function tallyList(what: string, items: readonly Tally[]): HTMLElement {
  if (items.length === 0) return el('p', { cls: 'om-side-says', text: `Nothing has been played with a ${what} on it yet.` })
  const most = items[0]?.plays ?? 0
  return el('ul', { cls: 'om-own-tallies' }, items.map((one) => tallyRow(one, most)))
}

registerScreen({
  screen: 'recent',
  title: () => 'Your listening',
  mount: (place) => {
    const head = screenHead('Your listening', 'Counted, not guessed. A play goes down only when enough of the song has really gone by.')
    const figuresPlace = el('div', { cls: 'om-own-slot' }, [reading('listening')])
    const mostPlace = el('div', { cls: 'om-own-slot' }, [reading('listening')])
    const namesPlace = el('div', { cls: 'om-own-slot' }, [reading('listening')])
    const latelyPlace = el('div', { cls: 'om-own-slot' }, [reading('listening')])
    let playingId: string | null = null
    let lately: readonly OrbisTrack[] = []

    const drawLately = (): void => {
      fill(
        latelyPlace,
        lately.length === 0
          ? nothingYet('songs played yet', 'Play something through Orbis Music and it turns up here.')
          : el(
              'ul',
              { cls: 'om-rows' },
              lately.map((track) =>
                dated(trackRow(track, { playing: track.id === playingId }), typeof track.lastPlayedAt === 'number' ? whenWords(track.lastPlayedAt, Date.now()) : '')
              )
            )
      )
      place.wantCovers(lately.slice(0, 40).map((one) => one.id))
    }

    async function load(): Promise<void> {
      // The whole library, sorted by plays, because every figure on this screen is counted across all of it. There is
      // no operation that adds the plays up on the Orbis side, so the adding up happens here.
      const [all, played] = await Promise.all([music.library({ sort: 'plays', descending: true }), music.playedLately()])

      const got = unwrap(all, 'listening')
      if ('problem' in got) {
        fill(figuresPlace, got.problem)
        fill(mostPlace, el('p', { cls: 'om-side-says', text: 'The figures need your music, and Orbis could not read it just now.' }))
        fill(namesPlace)
        return
      }
      const library = got.value
      const summary = listeningSummary(library)

      fill(
        figuresPlace,
        summary.totalPlays === 0
          ? nothingYet('plays counted yet', 'Orbis counts a song once enough of it has gone by, so a quick skip does not count.')
          : figures([
              figure(String(summary.totalPlays), summary.totalPlays === 1 ? 'play counted' : 'plays counted'),
              figure(String(summary.songsPlayed), summary.songsPlayed === 1 ? 'song played' : 'different songs'),
              figure(String(summary.neverPlayed), 'never played'),
              // Only when there is one. A figure Orbis does not have is left out rather than drawn as a dash in a box.
              summary.lastAt === null ? null : figure(whenWords(summary.lastAt, Date.now()), 'last play')
            ])
      )

      const most = topSongs(library, 10)
      fill(
        mostPlace,
        most.length === 0
          ? el('p', { cls: 'om-side-says', text: 'Nothing has been played enough to count yet.' })
          : el(
              'ul',
              { cls: 'om-rows' },
              most.map((track) =>
                dated(
                  trackRow(track, {
                    playing: track.id === playingId,
                    onPlay: () =>
                      void doAndSay(
                        music.playAll(
                          most.map((one) => one.id),
                          most.indexOf(track)
                        )
                      )
                  }),
                  countText(track.playCount ?? 0, 'play', 'plays')
                )
              )
            )
      )
      place.wantCovers(most.map((one) => one.id))

      fill(
        namesPlace,
        el('div', { cls: 'om-own-three' }, [
          el('div', {}, [el('h3', { cls: 'om-own-sub', text: 'Artists' }), tallyList('artist', topArtists(library))]),
          el('div', {}, [el('h3', { cls: 'om-own-sub', text: 'Albums' }), tallyList('album', topAlbums(library))]),
          el('div', {}, [el('h3', { cls: 'om-own-sub', text: 'Genres' }), tallyList('genre', topGenres(library))])
        ])
      )

      const recent = unwrap(played, 'listening')
      if ('problem' in recent) fill(latelyPlace, recent.problem)
      else {
        lately = recent.value
        drawLately()
      }
    }

    fill(
      place.into,
      head,
      block('The count', 'What Orbis has written down.', [figuresPlace]),
      block('Played most', 'Your own play counts, highest first.', [mostPlace]),
      block('Where those plays went', 'Added up from the same counts.', [namesPlace]),
      block('Played lately', 'Newest first, one row per song.', [latelyPlace], press('Read again', () => void load(), 'quiet', 'refresh'))
    )
    void load()

    return {
      onPlayer: (state) => {
        const now = state.music?.track?.id ?? null
        if (now === playingId) return
        playingId = now
        // Only the lately list is redrawn as the music moves on: the figures behind the other blocks do not change
        // while a song plays, and redrawing them would pull the page about under somebody reading it.
        if (lately.length > 0) drawLately()
      },
      onCovers: drawLately
    }
  }
})
