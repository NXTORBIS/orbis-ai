/**
 * Export and tidy.
 *
 * The left-hand list has had this entry since the frame was written and nothing behind it. It is built on the three
 * operations the music service already has and nothing else: a copy of what Orbis knows as a file, a playlist as an
 * .m3u, and the groups of songs that look like the same recording.
 *
 * Nothing on this screen deletes anything. The duplicates operation in the music service is deliberately a report --
 * its own comment says what to keep is the person's to decide -- and there is no operation for removing a song, so
 * this screen lists the groups and opens them. Offering a "remove duplicates" button here would mean writing a new
 * backend to make the button true, which is the one thing a screen must not do.
 *
 * File locations never appear. The export operation leaves them out unless they are asked for, and this screen never
 * asks: an export is a thing people send to other people, and a path says a good deal about a computer. There is no
 * control for turning them on, because a control is how one gets turned on by accident.
 */

import type { OrbisTrack, Playlist } from '../../../src/shared/music.ts'
import { clockText, countText } from '../../../src/shared/music/fulltab.ts'
import { albumKey } from '../../../src/shared/music/record.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { registerScreen, type MountedScreen, type ScreenPlace } from '../screens.ts'
import { block, press, reading, screenHead, unwrap } from './own-parts.ts'

/** What the export operations answer with. Checked field by field rather than trusted, because it is a wrapper. */
interface Saved {
  readonly ok?: boolean
  readonly why?: string
  readonly name?: string
  readonly text?: string
}

registerScreen({
  screen: 'tidy',
  title: () => 'Export and tidy',
  // Wide, and no column on the right: the duplicate groups are rows of songs and want the whole width.
  wants: { nowPlaying: 'hide', wide: true },
  mount: (place) => mountTidy(place)
})

function mountTidy(place: ScreenPlace): MountedScreen {
  const exports = el('div', { cls: 'om-own-slot' })
  const dupes = el('div', { cls: 'om-own-slot om-tidy-dupes' })
  fill(
    place.into,
    screenHead('Export and tidy', 'A copy of what Orbis knows about your music, and the songs it thinks you have twice.'),
    block('Save a copy', 'Names and playlists, as a file you keep. Where your files are on this computer is never written into it.', [exports]),
    block('Songs you may have twice', 'Grouped by title, artist and length. Nothing here is removed: which copy to keep is yours to decide.', [dupes])
  )

  /**
   * Hands the person a file.
   *
   * The text came from the music service, so it is made into a file here rather than on the Orbis side: a browser
   * page can give the browser something to save, and sending it back to be written somewhere would mean choosing a
   * folder on somebody's computer, which this page has no business doing. The address is let go of straight away so
   * the text is not left sitting in the page after the file is handed over.
   */
  function save(name: string, text: string): void {
    const file = new Blob([text], { type: name.endsWith('.m3u') ? 'audio/x-mpegurl' : 'application/json' })
    const at = URL.createObjectURL(file)
    const link = el('a', { attrs: { href: at, download: name } })
    link.click()
    URL.revokeObjectURL(at)
    place.note(`Saved as ${name}.`)
  }

  /** Runs one of the export operations and either hands over the file or says, in the service's words, why not. */
  async function exportNow(op: string, a?: unknown): Promise<void> {
    const answer = await music.run<Saved>(op, a)
    if (!answer.got) {
      place.note(answer.why)
      return
    }
    const value = answer.value
    // The wrapper said yes; the operation itself may still have said no. Both are checked, which is the whole reason
    // the client's own field is `got` rather than `ok`.
    if (!value || value.ok !== true || typeof value.name !== 'string' || typeof value.text !== 'string') {
      place.note(value?.why?.trim() || 'Orbis could not make that file.')
      return
    }
    save(value.name, value.text)
  }

  function drawExports(lists: readonly Playlist[] | null): void {
    fill(
      exports,
      el('div', { cls: 'om-own-row' }, [
        el('div', { cls: 'om-own-row-words' }, [
          el('span', { cls: 'om-own-row-label', text: 'Everything Orbis knows' }),
          el('span', { cls: 'om-own-row-detail', text: 'Every song, with its names, length, genre, year and how often it has been played.' })
        ]),
        press('Save as a file', () => void exportNow('export', 'library'), 'primary', 'file')
      ]),
      el('div', { cls: 'om-own-row' }, [
        el('div', { cls: 'om-own-row-words' }, [
          el('span', { cls: 'om-own-row-label', text: 'Your playlists' }),
          el('span', {
            cls: 'om-own-row-detail',
            text: 'Every playlist with the songs in it. A playlist worked out from your library is saved as the question it asks, not as the answer it gave today.'
          })
        ]),
        press('Save as a file', () => void exportNow('export', 'playlists'), 'normal', 'file')
      ]),
      // An .m3u is per playlist, because that is what the operation takes: it is the format other music players read.
      lists === null
        ? reading('playlists')
        : lists.length === 0
          ? el('p', { cls: 'om-own-row-detail', text: 'No playlists to save as an .m3u yet.' })
          : el('div', { cls: 'om-own-row om-own-row-stack' }, [
              el('div', { cls: 'om-own-row-words' }, [
                el('span', { cls: 'om-own-row-label', text: 'One playlist, for another music player' }),
                el('span', { cls: 'om-own-row-detail', text: 'An .m3u file, which most other music players can open. File names only, never where they are.' })
              ]),
              el(
                'div',
                { cls: 'om-own-choices' },
                lists.map((list) => press(list.name, () => void exportNow('export-m3u', list.id), 'quiet'))
              )
            ])
    )
  }

  /** One duplicate group: the songs, and a way into the album each one came from. */
  function dupeGroup(group: readonly OrbisTrack[]): HTMLElement {
    const first = group[0]
    return el('div', { cls: 'om-tidy-group' }, [
      el('p', { cls: 'om-tidy-group-head', text: `${first.title || 'No title'} — ${first.artist || 'No artist named'} · ${clockText(first.duration)}` }),
      el(
        'ul',
        { cls: 'om-rows' },
        group.map((track) =>
          el('li', { cls: 'om-row om-tidy-copy' }, [
            el('span', { cls: 'om-row-words' }, [
              el('span', { cls: 'om-row-title', text: track.album.trim() || 'No album named' }),
              // What Orbis actually has of this copy, in the same three words the rest of the page uses, so a
              // reference is never mistaken for a second file somebody could delete.
              el('span', {
                cls: 'om-row-artist',
                text:
                  track.availability === 'reference'
                    ? 'Orbis knows this one by name only — there is no file to remove'
                    : track.availability === 'missing'
                      ? 'The file is not where it was'
                      : 'A file on this computer'
              })
            ]),
            track.album.trim() !== ''
              ? // The album screen is addressed by a key made of the name and the artist together, not by the name:
                // two different records share a title often enough that sending only the name would open the wrong one.
                button(
                  { cls: 'om-btn om-btn-quiet', onClick: () => place.go('album', albumKey(track.album.trim(), track.albumArtist?.trim() || track.artist.trim())) },
                  [el('span', { text: 'Open the album' })]
                )
              : el('span', { cls: 'om-row-gap' })
          ])
        )
      )
    ])
  }

  async function load(): Promise<void> {
    fill(dupes, reading('music'))
    drawExports(null)

    const lists = await music.playlists()
    const gotLists = unwrap(lists, 'playlists')
    drawExports('value' in gotLists ? gotLists.value : [])
    if ('problem' in gotLists) exports.append(gotLists.problem)

    const found = await music.run<OrbisTrack[][]>('duplicates')
    const got = unwrap(found, 'music')
    if ('problem' in got) {
      fill(dupes, got.problem)
      return
    }
    // The operation groups by title, artist and rounded length and only returns groups of more than one, so an empty
    // answer really does mean nothing looks duplicated. Said as that rather than as a blank space.
    if (got.value.length === 0) {
      fill(dupes, says('Nothing looks duplicated', 'No two songs in your music share a title, an artist and a length.'))
      return
    }
    fill(
      dupes,
      el('p', {
        cls: 'om-own-row-detail',
        text: `${countText(got.value.length, 'group', 'groups')} of songs that look like the same recording.`
      }),
      ...got.value.map((group) => dupeGroup(group))
    )
  }

  void load()

  return {}
}
