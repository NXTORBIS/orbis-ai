/**
 * Favourites.
 *
 * The left-hand list has had a Favourites entry since the frame was written, and until now pressing it landed on a
 * sentence saying nobody had built the screen. This is that screen.
 *
 * It is one question asked of the music service -- the library, favourites only -- rather than the whole library read
 * and then filtered here, because the service sorts in the same pass and a second sort written here is a second place
 * for the order to drift from the order Your music shows.
 *
 * Favourites are the one list in Orbis Music that empties itself while you are looking at it: taking the heart off a
 * song is exactly what this screen lists. So the heart is watched, and the list is read again when one changes,
 * rather than leaving a song on screen that is no longer a favourite.
 */

import type { OrbisTrack } from '../../../src/shared/music.ts'
import { countText, emptyWords, spanText } from '../../../src/shared/music/fulltab.ts'
import { factsOf } from '../../../src/shared/music/record.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import type { PlayerState } from '../player.ts'
import { registerScreen, type MountedScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay, trackRow } from '../shell.ts'

registerScreen({
  screen: 'liked',
  title: () => 'Favourites',
  mount: (place) => mountLiked(place)
})

function mountLiked(place: ScreenPlace): MountedScreen {
  // The record header classes, not a set of its own: this is the same band the album, artist and genre screens use,
  // and a second nearly-identical set of rules is how the four of them come to drift apart. The one difference is
  // that there is no cover to put beside it, which `om-rec-head-alone` says in one rule.
  const head = el('div', { cls: 'om-rec-head om-rec-head-alone' })
  const list = el('ul', { cls: 'om-rows', attrs: { 'aria-label': 'Your favourite songs' } })
  const body = el('div', { cls: 'om-rec' }, [head, list])

  let tracks: readonly OrbisTrack[] | null = null
  let playingId: string | null = null
  /** How many favourites the player's own summary says there are, so a heart pressed elsewhere is noticed here. */
  let knownCount: number | null = null
  let reading = false

  function drawHead(): void {
    if (!tracks) return
    const facts = factsOf(tracks)
    const lines: string[] = [countText(facts.tracks, 'song', 'songs')]
    // Left out when any favourite has no known length: a sum that skips songs reads as a shorter list than it is.
    if (facts.seconds !== null) lines.push(spanText(facts.seconds))
    fill(
      head,
      el('div', { cls: 'om-rec-words' }, [
        el('p', { cls: 'om-rec-kicker', text: 'Your music' }),
        el('h1', { cls: 'om-rec-title', text: 'Favourites' }),
        el('p', { cls: 'om-rec-line', text: lines.join(' · ') }),
        facts.playable === 0
          ? el('p', { cls: 'om-rec-note', text: 'None of your favourites has audio on this computer. Bring your own copies in to play them here.' })
          : facts.playable < facts.tracks
            ? el('p', { cls: 'om-rec-note', text: `${countText(facts.playable, 'favourite', 'favourites')} can be played; the rest Orbis only knows by name.` })
            : null,
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
          ),
          // A favourites list is the obvious thing to keep as a playlist, and every piece of that already exists:
          // the ids are in hand and the service makes a playlist from a list of ids.
          button(
            {
              cls: 'om-btn om-btn-quiet',
              attrs: { disabled: facts.tracks === 0 },
              onClick: () => void doAndSay(music.createPlaylist('Favourites', tracks ? tracks.map((one) => one.id) : []))
            },
            [icon('list', 16), el('span', { text: 'Keep as a playlist' })]
          )
        ])
      ])
    )
  }

  function drawRows(): void {
    if (!tracks) return
    const facts = factsOf(tracks)
    fill(
      list,
      ...tracks.map((track) => {
        const row = trackRow(track, {
          playing: track.id === playingId,
          onPlay: () => {
            const at = facts.playableIds.indexOf(track.id)
            if (at < 0) {
              place.note('Orbis has no audio for this song.')
              return
            }
            void doAndSay(music.playAll(facts.playableIds, at))
          }
        })
        row.setAttribute('data-om-track', track.id)
        return row
      })
    )
    place.wantCovers(tracks.map((one) => one.id))
  }

  async function load(): Promise<void> {
    if (reading) return
    reading = true
    if (!tracks) fill(place.into, says(emptyWords('loading', 'favourites').title))
    const answer = await music.library({ favourite: true })
    reading = false
    if (!answer.got) {
      // A failed call never empties a list that is already drawn: the rows stay and the reason goes along the bottom.
      if (tracks) {
        place.note(answer.why)
        return
      }
      const words = emptyWords(answer.shut ? 'unreachable' : 'failed', 'favourites', answer.why)
      fill(place.into, says(words.title, words.detail, { label: 'Try again', onClick: () => void load() }))
      return
    }
    tracks = answer.value
    knownCount = answer.value.length
    if (answer.value.length === 0) {
      // Really empty, which is a different thing from the call having failed, and says what to do about it.
      fill(
        place.into,
        says('No favourites yet', 'Press the heart on any song and it turns up here. Nothing else puts a song in this list.', {
          label: 'Your music',
          onClick: () => place.go('library')
        })
      )
      return
    }
    fill(place.into, body)
    drawHead()
    drawRows()
  }

  void load()

  return {
    onPlayer: (state: PlayerState) => {
      // The player's summary counts favourites, so a heart pressed on another screen, in the panel or by the Orb
      // shows up here as a different number and the list is read again. Without this the screen would keep listing a
      // song whose heart had just been taken off, which on this screen of all screens would be plainly wrong.
      const count = state.music?.summary.favourites ?? null
      if (count !== null && knownCount !== null && count !== knownCount) {
        knownCount = count
        void load()
      }
      const id = state.music?.playback.trackId ?? null
      if (id === playingId) return
      playingId = id
      for (const row of list.querySelectorAll('.om-row')) row.classList.toggle('om-row-now', row.getAttribute('data-om-track') === id)
    },
    onCovers: () => {
      // The shared track row builds its cover once, when the row is made, so an arriving cover means the rows are
      // drawn again. The album screen does the same for the same reason: there is no hook on the shared row for
      // dropping a picture into a row that already exists.
      if (tracks) drawRows()
    }
  }
}
