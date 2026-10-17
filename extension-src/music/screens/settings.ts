/**
 * Orbis Music's settings.
 *
 * Every control here is one preference Orbis really keeps, and every change is read back: the music service answers a
 * change with the whole lot as it now stands, and the screen redraws from that answer rather than from what it asked
 * for. So a switch on this screen can never be showing something the service did not do.
 *
 * Four of these preferences had no control anywhere before: whether the music button shows in the browser, whether
 * the small player is compact or full, which part of your music opens first, and how it is sorted. They were stored,
 * written by nothing and read by nothing, which is a worse state than not existing -- a value kept and ignored looks
 * like a setting that does not work. They are here now.
 *
 * The watched folders are shown as a count and never as paths. A browser page is never told where somebody's files
 * live, and that holds on the settings screen as much as anywhere else.
 */

import { countText } from '../../../src/shared/music/fulltab.ts'
import type { LibraryQuery } from '../../../src/shared/music.ts'
import * as music from '../client.ts'
import { el, fill } from '../dom.ts'
import { registerScreen } from '../screens.ts'
import { block, card, carefulPress, choices, press, reading, screenHead, toggleRow, unwrap } from './own-parts.ts'

type Recognition = 'automatic' | 'manual' | 'off'
type Sort = NonNullable<LibraryQuery['sort']>
type View = 'songs' | 'albums' | 'artists' | 'genres' | 'playlists' | 'favourites'

/** Exactly the values the store accepts for each of these, in plain words. Nothing else may be offered. */
const RECOGNITION: readonly { id: Recognition; label: string; blurb: string }[] = [
  { id: 'automatic', label: 'While I browse', blurb: 'Orbis works out what a page is playing as it happens.' },
  { id: 'manual', label: 'Only when I ask', blurb: 'Nothing is worked out until you press Look again.' },
  { id: 'off', label: 'Never', blurb: 'Orbis does not try to name what a page is playing.' }
]

const VIEWS: readonly { id: View; label: string }[] = [
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'genres', label: 'Genres' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'favourites', label: 'Favourites' }
]

const SORTS: readonly { id: Sort; label: string }[] = [
  { id: 'added', label: 'When added' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
  { id: 'played', label: 'Last played' },
  { id: 'plays', label: 'Most played' },
  { id: 'duration', label: 'Length' },
  { id: 'year', label: 'Year' }
]

registerScreen({
  screen: 'settings',
  title: () => 'Settings',
  mount: (place) => {
    const into = el('div', { cls: 'om-own-slot' }, [reading('settings')])
    const clearing = el('div', { cls: 'om-own-slot' })

    /** Changes one preference and redraws from what the service says it became, not from what was asked. */
    async function change(patch: Partial<music.MusicSettings>): Promise<void> {
      const answer = await music.saveSettings(patch)
      if (!answer.got) {
        place.note(answer.why)
        return
      }
      draw(answer.value)
      place.refresh()
    }

    function draw(held: music.MusicSettings): void {
      fill(
        into,
        card('', [
          choices<Recognition>({
            label: 'Work out what a page is playing',
            detail: 'Orbis asks the page what it is playing. It never touches the page or its player.',
            items: RECOGNITION,
            chosen: held.recognition,
            onPick: (id) => void change({ recognition: id })
          }),
          toggleRow({
            label: 'Read the player on screen when a page does not say',
            detail: 'Orbis looks at the tab it is playing in, asks once, and keeps nothing. With this off it only ever uses what the page itself announces.',
            on: held.useVision === true,
            onChange: (on) => void change({ useVision: on })
          }),
          toggleRow({
            label: 'Carry on from where a song was left',
            detail: 'Where you stopped is written down as you listen, so it survives the computer being shut.',
            on: held.resume === true,
            onChange: (on) => void change({ resume: on })
          }),
          toggleRow({
            label: 'Start playing when Orbis opens',
            detail: 'Off unless you ask for it.',
            on: held.playOnStart === true,
            onChange: (on) => void change({ playOnStart: on })
          }),
          toggleRow({
            label: 'Show the music button in the browser',
            detail: 'The button that opens your music from the browser itself.',
            on: held.showButton === true,
            onChange: (on) => void change({ showButton: on })
          }),
          choices<'compact' | 'full'>({
            label: 'The small player',
            detail: 'How much the player shows when it is not the whole screen.',
            items: [
              { id: 'compact', label: 'Compact', blurb: 'The song and the three buttons.' },
              { id: 'full', label: 'Full', blurb: 'The cover, the bar and everything else.' }
            ],
            chosen: held.miniPlayer,
            onPick: (id) => void change({ miniPlayer: id })
          }),
          choices<View>({
            label: 'Open your music at',
            detail: 'Which part of your music is showing when you open it.',
            items: VIEWS,
            chosen: held.view,
            onPick: (id) => void change({ view: id })
          }),
          choices<Sort>({
            label: 'Sort your songs by',
            detail: 'Kept, so your music opens the way you left it.',
            items: SORTS,
            chosen: (held.sort ?? 'added') as Sort,
            onPick: (id) => void change({ sort: id })
          }),
          el('div', { cls: 'om-own-row' }, [
            el('div', { cls: 'om-own-row-words' }, [
              el('span', {
                cls: 'om-own-row-label',
                text: (held.folders ?? []).length === 0 ? 'No folders are being watched' : `${countText(held.folders.length, 'folder', 'folders')} watched`
              }),
              el('span', { cls: 'om-own-row-detail', text: 'Which folders they are is not shown here: a browser page is never told where your files live.' })
            ]),
            press('Watch another', () => void music.watchFolder().then((answer) => place.note(answer.got ? 'The Orbis window is asking you to choose.' : answer.why)), 'quiet', 'folder')
          ])
        ])
      )
    }

    function drawClearing(): void {
      fill(
        clearing,
        card('', [
          el('div', { cls: 'om-own-row' }, [
            el('div', { cls: 'om-own-row-words' }, [
              el('span', { cls: 'om-own-row-label', text: 'What you have played' }),
              el('span', {
                cls: 'om-own-row-detail',
                text: 'The list of plays behind "your listening". Your songs and playlists stay, and so do their play counts.'
              })
            ]),
            carefulPress('Forget what I have played', 'Press again to forget it.', () => void done(music.run('clear-history')))
          ]),
          el('div', { cls: 'om-own-row' }, [
            el('div', { cls: 'om-own-row-words' }, [
              el('span', { cls: 'om-own-row-label', text: 'Songs noticed while browsing' }),
              el('span', { cls: 'om-own-row-detail', text: 'Only the list of names. Anything you chose to keep stays in your music.' })
            ]),
            carefulPress('Forget that list', 'Press again to forget it.', () => void done(music.run('clear-recognised')))
          ])
        ])
      )
    }

    async function done(doing: Promise<music.Answer<unknown>>): Promise<void> {
      const answer = await doing
      place.note(answer.got ? 'Done.' : answer.why)
    }

    async function load(): Promise<void> {
      const answer = await music.settings()
      const got = unwrap(answer, 'settings')
      if ('problem' in got) fill(into, got.problem)
      else draw(got.value)
    }

    fill(
      place.into,
      screenHead('Settings', 'Every change here is read back from Orbis, so nothing on this screen can be showing something that did not happen.'),
      block('How Orbis listens', 'What it may work out, and how.', [into]),
      block('Clearing things', 'Each of these says exactly what it throws away. Neither can be undone.', [clearing])
    )
    drawClearing()
    void load()

    return {}
  },
  wants: { nowPlaying: 'as-chosen' }
})
