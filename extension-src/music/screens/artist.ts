/**
 * One artist.
 *
 * This screen is deliberately not a thinner copy of a streaming service's artist page, because the things those pages
 * are built around do not exist here. Orbis Music has no catalogue: there is no artist photograph, no biography, no
 * follower count and no editorial writing anywhere in it, and there is no operation that works out which artists
 * sound like which. So the page is made of the only two honest sources it has -- what the files themselves say, and
 * what Orbis measured while somebody was listening.
 *
 * That gives three things. A header counted from the files: how many albums, how many tracks, the years they span and
 * the genres the files name. A most-played list, which is a real measurement -- a play is only counted once enough of
 * a track has gone by -- and which is left out entirely when nothing has been played, rather than padded with
 * never-played tracks to make it look like a chart. And their albums, grouped from those same files.
 *
 * What is missing and why is in the report that came with this screen: there is no similarity operation to build a
 * related-artists shelf from, so there is no related-artists shelf. An empty one would be worse than none.
 */

import type { Grouped, OrbisTrack } from '../../../src/shared/music.ts'
import { countText, emptyWords } from '../../../src/shared/music/fulltab.ts'
import { albumKey, albumsOf, faceOf, factsOf, genresOf, isArtist, mostPlayed, yearsText } from '../../../src/shared/music/record.ts'
import { tile, wash } from '../art.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import type { PlayerState } from '../player.ts'
import { registerScreen, type MountedScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay, trackRow } from '../shell.ts'

registerScreen({
  screen: 'artist',
  title: (route) => route.of || 'Artist',
  mount: (place) => mountArtist(place)
})

/** How many of an artist's tracks the most-played list shows. Five is a shelf; twenty is the tracklist again. */
const TOP = 5

function mountArtist(place: ScreenPlace): MountedScreen {
  const head = el('div', { cls: 'om-rec-head' })
  const sections = el('div', { cls: 'om-rec-sections' })
  const body = el('div', { cls: 'om-rec' }, [head, sections])

  let group: Grouped | null = null
  let playingId: string | null = null

  const wanted = place.route.of.trim()
  if (wanted === '') {
    fill(place.into, says('That address does not name an artist', 'Open an artist from Your music and the address will be right.'))
    return {}
  }

  /** A row in one of the lists on this screen. Pressing it plays that list from there, as a tracklist should. */
  function rowsOf(tracks: readonly OrbisTrack[], label: string, plays = false): HTMLElement {
    const ids = factsOf(tracks).playableIds
    const list = el('ul', { cls: `om-rows${plays ? ' om-rec-top' : ''}`, attrs: { 'aria-label': label } })
    for (const track of tracks) {
      const row = trackRow(track, {
        playing: track.id === playingId,
        onPlay: () => {
          const at = ids.indexOf(track.id)
          if (at < 0) {
            place.note('Orbis has no audio for this track.')
            return
          }
          void doAndSay(music.playAll(ids, at))
        }
      })
      // The play count is a measurement, so it is shown as one, next to the length rather than dressed up as a
      // chart position. It goes in before the length so the two numbers read together.
      if (plays) {
        const count = track.playCount ?? 0
        const length = row.querySelector('.om-row-length')
        const said = el('span', { cls: 'om-rec-plays', text: countText(count, 'play', 'plays') })
        if (length) row.insertBefore(said, length)
        else row.append(said)
      }
      // The id is written onto the row so the playing row can be re-marked without the list being built again: a
      // rebuild on every track change would throw away the focus ring off whatever somebody had tabbed to.
      row.setAttribute('data-om-track', track.id)
      list.append(row)
    }
    return list
  }

  function albumCard(album: Grouped): HTMLElement {
    const facts = factsOf(album.tracks)
    const face = faceOf(album.tracks)
    const lines = [facts.year === null ? 'No year in these files' : String(facts.year), countText(facts.tracks, 'track', 'tracks')]
    // The same card the rest of the page uses, so an album looks the same here as it does on Home.
    return button(
      {
        cls: `om-card${facts.playable === 0 ? ' om-card-off' : ''}`,
        onClick: () => place.go('album', albumKey(album.name, album.by ?? group?.name ?? ''))
      },
      [
        el('div', { cls: 'om-card-cover' }, [
          face ? tile({ id: face.id, title: album.name, artist: album.by, album: album.name }, { size: 'lg' }) : null,
          el('span', { cls: 'om-card-play', attrs: { 'aria-hidden': 'true' } }, [icon('play', 18)])
        ]),
        el('span', { cls: 'om-card-words' }, [
          el('span', { cls: 'om-card-name', text: album.name }),
          el('span', { cls: 'om-card-under', text: lines.join(' · ') })
        ])
      ]
    )
  }

  function section(title: string, detail: string, inner: HTMLElement | null): HTMLElement {
    return el('section', { cls: 'om-rec-section' }, [
      el('h2', { cls: 'om-rec-section-title', text: title }),
      detail ? el('p', { cls: 'om-rec-section-detail', text: detail }) : null,
      inner
    ])
  }

  function draw(): void {
    if (!group) return
    const facts = factsOf(group.tracks)
    const theirAlbums = albumsOf(group.tracks)
    const face = faceOf(group.tracks)
    const top = mostPlayed(group.tracks, TOP)
    const years = yearsText(group.tracks)
    const kinds = genresOf(group.tracks)
    const lines = [countText(theirAlbums.length, 'album', 'albums'), countText(facts.tracks, 'track', 'tracks')]
    if (years !== '') lines.push(years)
    if (kinds.length > 0) lines.push(kinds.join(', '))

    fill(
      head,
      wash(face?.id),
      el('div', { cls: 'om-rec-art' }, [face ? tile({ id: face.id, title: group.name, artist: group.name }, { size: 'xl', round: true }) : null]),
      el('div', { cls: 'om-rec-words' }, [
        el('p', { cls: 'om-rec-kicker', text: 'Artist' }),
        el('h1', { cls: 'om-rec-title', text: group.name }),
        el('p', { cls: 'om-rec-line', text: lines.join(' · ') }),
        // The cover of one of their records, not a picture of them: Orbis has no artist pictures at all, and a
        // record sleeve standing in for a face would be read as a face.
        el('p', { cls: 'om-rec-note', text: 'The picture is one of their covers. Orbis has no artist photographs.' }),
        facts.playable === 0 ? el('p', { cls: 'om-rec-note', text: 'None of these tracks has audio on this computer yet.' }) : null,
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
          button({ cls: 'om-btn om-btn-quiet', onClick: () => void doAndSay(music.queueEnd(facts.playableIds)) }, [
            icon('plus', 16),
            el('span', { text: 'Add to what is coming next' })
          ])
        ])
      ])
    )

    fill(
      sections,
      // Left out rather than shown empty: a most-played list with nothing in it says something false about how much
      // Orbis knows, where no list at all says only that nothing has been played yet.
      top.length === 0
        ? section('Most played', 'Nothing by them has been played through Orbis Music yet, so there is nothing to count.', null)
        : section('Most played', 'Counted from what really played, not from how often a button was pressed.', rowsOf(top, `The most played ${group.name} tracks`, true)),
      section(
        countText(theirAlbums.length, 'Album', 'Albums'),
        '',
        el('div', { cls: 'om-rec-grid' }, theirAlbums.map((album) => albumCard(album)))
      ),
      section('Every track', '', rowsOf(group.tracks, `Every ${group.name} track in your music`))
    )

    place.wantCovers(group.tracks.map((one) => one.id))
  }

  async function load(): Promise<void> {
    fill(place.into, says(`Reading ${wanted}…`))
    const answer = await music.artists()
    if (!answer.got) {
      const words = emptyWords(answer.shut ? 'unreachable' : 'failed', 'artists', answer.why)
      fill(place.into, says(words.title, words.detail, words.retry ? { label: 'Try again', onClick: () => void load() } : undefined))
      return
    }
    const found = answer.value.find((one) => isArtist(one.name, wanted))
    if (!found) {
      fill(
        place.into,
        says(`There is nothing by ${wanted} in your music`, 'The name may have changed, or the link may be from before those tracks were taken out.', {
          label: 'Try again',
          onClick: () => void load()
        })
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
      for (const row of sections.querySelectorAll('.om-row')) row.classList.toggle('om-row-now', row.getAttribute('data-om-track') === playingId)
    },
    onCovers: () => {
      if (group) draw()
    }
  }
}
