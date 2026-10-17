/**
 * One genre.
 *
 * Orbis keeps no genre record any more than it keeps an album record: a genre is whatever word the files themselves
 * carry in that field, so this screen asks the music service for the genres it works out from the library and finds
 * the one the address names. Every figure on it is counted from those files.
 *
 * It exists because four other screens were already sending people here -- the group cards in Your music, the genre
 * cards in Search, the corners of your own music in Discover and the tallies in Your listening -- and until now every
 * one of those presses landed on a sentence saying nobody had written this screen. A link that goes nowhere is worse
 * than no link, so the screen is the fix rather than removing four sets of cards.
 *
 * The header is deliberately plainer than an album's. A genre is not a record somebody made: it has no artist, no
 * year of its own and no running order, so it gets the artists and albums it is made of instead, and the cover behind
 * the title is openly one of its tracks' covers rather than anything belonging to the genre.
 */

import type { Grouped } from '../../../src/shared/music.ts'
import { countText, emptyWords, spanText } from '../../../src/shared/music/fulltab.ts'
import { albumsOf, factsOf, faceOf } from '../../../src/shared/music/record.ts'
import { tile, wash } from '../art.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import type { PlayerState } from '../player.ts'
import { registerScreen, type MountedScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay, trackRow } from '../shell.ts'

registerScreen({
  screen: 'genre',
  title: (route) => route.of || 'Genre',
  mount: (place) => mountGenre(place)
})

function mountGenre(place: ScreenPlace): MountedScreen {
  const head = el('div', { cls: 'om-rec-head' })
  const list = el('ul', { cls: 'om-rows', attrs: { 'aria-label': 'The songs in this genre' } })
  const body = el('div', { cls: 'om-rec' }, [head, list])
  fill(place.into, body)

  let group: Grouped | null = null
  let playingId: string | null = null

  const wanted = place.route.of.trim()
  if (wanted === '') {
    fill(place.into, says('That address does not name a genre', 'Open a genre from Your music and the address will be right.'))
    return {}
  }

  function drawRows(): void {
    if (!group) return
    const facts = factsOf(group.tracks)
    fill(
      list,
      ...group.tracks.map((track) => {
        const row = trackRow(track, {
          playing: track.id === playingId,
          // Only the songs with audio go into the run. The service would quietly skip the rest, and a queue that
          // drops half of what was asked for without saying so is worse than one that was honest about its length.
          onPlay: () => {
            const at = facts.playableIds.indexOf(track.id)
            if (at < 0) {
              place.note('Orbis has no audio for this song.')
              return
            }
            void doAndSay(music.playAll(facts.playableIds, at))
          }
        })
        // The id goes on the row so the playing row can be re-marked without the list being built again. Rebuilding
        // once a second would throw away the focus ring off whatever somebody had tabbed to.
        row.setAttribute('data-om-track', track.id)
        return row
      })
    )
  }

  function drawHead(): void {
    if (!group) return
    const facts = factsOf(group.tracks)
    const face = faceOf(group.tracks)
    // Counted rather than claimed: how many different artists and albums these files actually name.
    const artists = new Set(group.tracks.map((one) => one.artist.trim()).filter((one) => one !== '')).size
    const albums = albumsOf(group.tracks).length
    const lines: string[] = []
    if (artists > 0) lines.push(countText(artists, 'artist', 'artists'))
    if (albums > 0) lines.push(countText(albums, 'album', 'albums'))
    lines.push(countText(facts.tracks, 'song', 'songs'))
    // Left out entirely when any song has no known length, because a sum that quietly skips songs reads short.
    if (facts.seconds !== null) lines.push(spanText(facts.seconds))
    fill(
      head,
      wash(face?.id),
      el('div', { cls: 'om-rec-art' }, [face ? tile({ id: face.id, title: group.name, artist: face.artist }, { size: 'xl' }) : null]),
      el('div', { cls: 'om-rec-words' }, [
        el('p', { cls: 'om-rec-kicker', text: 'Genre' }),
        el('h1', { cls: 'om-rec-title', text: group.name }),
        el('p', { cls: 'om-rec-line', text: lines.join(' · ') }),
        // Said once at the top rather than left to be worked out by reading every row's pill.
        facts.playable === 0
          ? el('p', { cls: 'om-rec-note', text: 'None of these songs has audio on this computer. Bring your own copies in to play them here.' })
          : facts.playable < facts.tracks
            ? el('p', { cls: 'om-rec-note', text: `${countText(facts.playable, 'song', 'songs')} here can be played; the rest Orbis only knows by name.` })
            : null,
        // There is no cover behind this that belongs to the genre, so the screen says whose cover it is instead of
        // letting it read as artwork somebody made for the genre.
        face ? el('p', { cls: 'om-rec-note', text: `The picture is the cover of ${face.album.trim() || face.title}. Orbis has no artwork for a genre.` }) : null,
        el('div', { cls: 'om-rec-buttons' }, [
          button(
            {
              cls: 'om-btn om-btn-primary',
              attrs: { disabled: facts.playable === 0 },
              title: facts.playable === 0 ? 'There is no audio here to play' : undefined,
              onClick: () => void doAndSay(music.playAll(facts.playableIds, 0))
            },
            [icon('play', 16), el('span', { text: 'Play' })]
          ),
          button(
            {
              cls: 'om-btn',
              attrs: { disabled: facts.playable < 2 },
              // Shuffle is a setting on the player rather than a way of starting something, so this turns it on and
              // then starts the genre. Read back afterwards like every other press, so the bar and this agree.
              onClick: async () => {
                await doAndSay(music.setShuffle(true))
                await doAndSay(music.playAll(facts.playableIds, 0))
              }
            },
            [icon('shuffle', 16), el('span', { text: 'Shuffle' })]
          ),
          button(
            {
              cls: 'om-btn',
              attrs: { disabled: facts.playable === 0 },
              onClick: () => void doAndSay(music.queueEnd(facts.playableIds))
            },
            [icon('plus', 16), el('span', { text: 'Add to what is coming next' })]
          )
        ])
      ])
    )
    place.wantCovers(group.tracks.map((one) => one.id))
  }

  async function load(): Promise<void> {
    fill(place.into, says(emptyWords('loading', 'genres').title))
    const answer = await music.genres()
    if (!answer.got) {
      const words = emptyWords(answer.shut ? 'unreachable' : 'failed', 'genres', answer.why)
      fill(place.into, says(words.title, words.detail, { label: 'Try again', onClick: () => void load() }))
      return
    }
    // Matched on the plain word rather than the exact string, the same way the album and artist screens match, so an
    // address typed with a different capitalisation still finds the genre.
    const flat = (value: string): string => value.trim().toLowerCase()
    const found = answer.value.find((one) => flat(one.name) === flat(wanted))
    if (!found) {
      fill(
        place.into,
        says(`No genre called “${wanted}” in your music`, 'Nothing in your library carries that genre. Open a genre from Your music to see the ones that are there.', {
          label: 'Your music',
          onClick: () => place.go('library')
        })
      )
      return
    }
    group = found
    fill(place.into, body)
    drawHead()
    drawRows()
  }

  void load()

  return {
    onPlayer: (state: PlayerState) => {
      const id = state.music?.playback.trackId ?? null
      if (id === playingId) return
      playingId = id
      // Re-marked in place. Rebuilding the list here would throw away the focus ring and the scroll position.
      for (const row of list.querySelectorAll('[data-om-track]')) {
        row.classList.toggle('om-row-now', row.getAttribute('data-om-track') === id)
      }
    },
    onCovers: () => {
      // Both the band's big cover and the shared track rows build their picture once, when they are made, so an
      // arriving cover means drawing both again rather than patching one node.
      if (group) {
        drawHead()
        drawRows()
      }
    }
  }
}
