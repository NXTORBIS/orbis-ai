/**
 * One album.
 *
 * There is no album record in Orbis Music. An album is a set of files that agree they belong together, so this screen
 * asks the music service for the albums it works out from the library and finds the one the address names. Everything
 * on it is counted from those files: the number of tracks, the total length, the year. Nothing is looked up on the
 * web, because nothing here can look anything up on the web, and nothing is filled in to make the header look
 * finished -- a record whose files carry no year says so where the year would go.
 *
 * The cover behind the title is the same small picture the music service hands any page, blurred well past any
 * detail. It is there to carry the record's colours into the band rather than to be looked at; a browser page cannot
 * be given a large cover, and stretching a 160-pixel picture across a header and calling it artwork would be a lie.
 */

import type { Grouped } from '../../../src/shared/music.ts'
import { countText, emptyWords, spanText } from '../../../src/shared/music/fulltab.ts'
import { faceOf, factsOf, isAlbum, readAlbumKey } from '../../../src/shared/music/record.ts'
import { tile, wash } from '../art.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import type { PlayerState } from '../player.ts'
import { registerScreen, type MountedScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay, trackRow } from '../shell.ts'

registerScreen({
  screen: 'album',
  title: (route) => readAlbumKey(route.of).name || 'Album',
  mount: (place) => mountAlbum(place)
})

function mountAlbum(place: ScreenPlace): MountedScreen {
  const head = el('div', { cls: 'om-rec-head' })
  const list = el('ul', { cls: 'om-rows', attrs: { 'aria-label': 'The tracks on this album' } })
  const body = el('div', { cls: 'om-rec' }, [head, list])
  fill(place.into, body)

  let group: Grouped | null = null
  let playingId: string | null = null

  const wanted = readAlbumKey(place.route.of)
  if (wanted.name === '') {
    fill(place.into, says('That address does not name an album', 'Open an album from Your music and the address will be right.'))
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
          // Pressing a track plays the album from there, which is what a tracklist is for. Only the tracks with
          // audio on this computer go into the run: the service would skip the others, and a queue that silently
          // drops half of what you asked for is worse than one that was honest about what it could play.
          onPlay: () => {
            const at = facts.playableIds.indexOf(track.id)
            if (at < 0) {
              place.note('Orbis has no audio for this track.')
              return
            }
            void doAndSay(music.playAll(facts.playableIds, at))
          }
        })
        // The id is written onto the row so the playing row can be re-marked without the list being built again: a
        // rebuild on every track change would throw away the focus ring off whatever somebody had tabbed to.
        row.setAttribute('data-om-track', track.id)
        return row
      })
    )
  }

  function drawHead(): void {
    if (!group) return
    const facts = factsOf(group.tracks)
    const face = faceOf(group.tracks)
    const lines: string[] = [group.by ?? '']
    lines.push(facts.year === null ? 'No year in these files' : String(facts.year))
    lines.push(countText(facts.tracks, 'track', 'tracks'))
    if (facts.seconds !== null) lines.push(spanText(facts.seconds))
    fill(
      head,
      wash(face?.id),
      el('div', { cls: 'om-rec-art' }, [face ? tile({ id: face.id, title: group.name, artist: group.by, album: group.name }, { size: 'xl' }) : null]),
      el('div', { cls: 'om-rec-words' }, [
        el('p', { cls: 'om-rec-kicker', text: 'Album' }),
        el('h1', { cls: 'om-rec-title', text: group.name }),
        el('p', { cls: 'om-rec-line', text: lines.filter((one) => one !== '').join(' · ') }),
        // Said plainly rather than left to the rows: a record you can open but cannot play is a thing somebody needs
        // to be told about once, at the top, not worked out by reading every row's pill.
        facts.playable === 0
          ? el('p', { cls: 'om-rec-note', text: 'None of these tracks has audio on this computer. Import your own copies to play them here.' })
          : facts.playable < facts.tracks
            ? el('p', { cls: 'om-rec-note', text: `${countText(facts.playable, 'track', 'tracks')} here can be played; the rest Orbis only knows by name.` })
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
              // Shuffle is a setting on the player, not a way of starting something, so this turns it on and then
              // starts the album. Read back afterwards like every other press, so the bar and this button agree.
              onClick: async () => {
                await doAndSay(music.setShuffle(true))
                await doAndSay(music.playAll(facts.playableIds, 0))
              }
            },
            [icon('shuffle', 16), el('span', { text: 'Shuffle' })]
          ),
          button({ cls: 'om-btn om-btn-quiet', onClick: () => void doAndSay(music.queueEnd(facts.playableIds)) }, [
            icon('plus', 16),
            el('span', { text: 'Add to what is coming next' })
          ]),
          group.by
            ? button({ cls: 'om-btn om-btn-quiet', onClick: () => place.go('artist', group?.by ?? '') }, [el('span', { text: `Go to ${group.by}` })])
            : null
        ])
      ])
    )
  }

  function draw(): void {
    drawHead()
    drawRows()
    if (group) place.wantCovers(group.tracks.map((one) => one.id))
  }

  async function load(): Promise<void> {
    fill(place.into, says(`Reading ${wanted.name}…`))
    const answer = await music.albums()
    if (!answer.got) {
      const words = emptyWords(answer.shut ? 'unreachable' : 'failed', 'albums', answer.why)
      fill(place.into, says(words.title, words.detail, words.retry ? { label: 'Try again', onClick: () => void load() } : undefined))
      return
    }
    const found = answer.value.find((one) => isAlbum(one, place.route.of))
    if (!found) {
      fill(
        place.into,
        says(
          `There is no album called ${wanted.name} in your music`,
          'It may have been renamed, or the link may be from before it was taken out.',
          { label: 'Try again', onClick: () => void load() }
        )
      )
      return
    }
    group = found
    fill(place.into, body)
    draw()
  }

  void load()

  return {
    onPlayer: (state: PlayerState) => {
      const id = state.music?.playback.trackId ?? null
      if (id === playingId) return
      playingId = id
      for (const row of list.querySelectorAll('.om-row')) row.classList.toggle('om-row-now', row.getAttribute('data-om-track') === playingId)
    },
    onCovers: () => {
      if (group) draw()
    }
  }
}
