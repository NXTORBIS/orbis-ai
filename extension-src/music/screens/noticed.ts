/**
 * Songs Orbis noticed while you were browsing.
 *
 * This screen is the one no streaming app has, and the whole of it rests on one distinction: **noticing is not
 * owning.** Orbis can see that a web page is playing something and can work out what it is, and that is where its
 * powers end. It never touches the page's own player, never wraps it, never downloads anything and never converts
 * anything. So there are exactly two things that can be done with a song named here: play the copy you already have,
 * or keep the name. A song kept by name has no audio and will say so, every time, until you bring a copy in yourself.
 *
 * Nothing here is ever guessed either. Orbis asks the page what it is playing, and if the page does not say, it reads
 * the player on screen, and if that fails it says it could not work it out. There is no fourth step where something
 * plausible is filled in, and this screen must never add one: a made-up song name in somebody's library is worse than
 * an empty list, because they will believe it.
 *
 * The four sentences at the bottom of this file are the music service's own answers to keeping a song, carried over
 * word for word from the browser panel. Nothing says "Added" before the library has said so.
 */

import { byDay, noticedOffer, whenWords } from '../../../src/shared/music/listening.ts'
import type { TrackNames } from '../../../src/shared/music.ts'
import * as music from '../client.ts'
import { button, el, fill } from '../dom.ts'
import { icon } from '../icons.ts'
import { registerScreen } from '../screens.ts'
import { doAndSay } from '../shell.ts'
import { block, card, nothingYet, press, reading, screenHead, unwrap } from './own-parts.ts'

/** What happened when a song was kept, in the words of the outcome rather than a cheerful guess. */
function keptWords(outcome: { kind?: string; why?: string } | null): string {
  switch (outcome?.kind) {
    case 'already':
      return 'That song is already in your music.'
    case 'linked':
      return 'Added, using the copy you already have.'
    case 'reference':
      return 'Saved by name. There is no audio for it on this computer; import your own copy to play it here.'
    case 'ask':
      return 'Several of your files might be it. Open your library and pick the right one.'
    default:
      return outcome?.why || 'That could not be added.'
  }
}

/** Where a song was heard, said as a place rather than as an address: a web address is long and is not a name. */
const fromWords = (provider: string): string => (provider.trim() === '' ? 'A web page' : provider.trim())

registerScreen({
  screen: 'noticed',
  title: () => 'Noticed while browsing',
  mount: (place) => {
    const nowPlace = el('div', { cls: 'om-own-slot' }, [reading('what is playing')])
    const listPlace = el('div', { cls: 'om-own-slot' }, [reading('noticed songs')])
    let working = false

    /** The song playing on a web page right this moment, and what can honestly be offered about it. */
    async function drawHeard(fresh = false): Promise<void> {
      if (working) return
      working = true
      if (fresh) fill(nowPlace, card('', [el('p', { cls: 'om-own-row-label', text: 'Listening…' })]))
      const answer = fresh ? await music.lookAgain() : await music.heard()
      working = false
      const got = unwrap(answer, 'what is playing')
      if ('problem' in got) {
        fill(nowPlace, got.problem)
        return
      }
      const heard = got.value
      if (!heard.sighting) {
        fill(
          nowPlace,
          card('', [
            el('p', { cls: 'om-own-row-label', text: 'Nothing is playing on a page right now' }),
            el('p', { cls: 'om-own-row-detail', text: 'Start a song on a web page and Orbis will work out what it is.' })
          ])
        )
        return
      }
      const names = heard.recognition?.names
      const sure = heard.recognition?.confidence
      fill(
        nowPlace,
        card('om-own-heard', [
          el('span', { cls: 'om-pill', text: 'Playing on a web page' }),
          heard.working
            ? el('p', { cls: 'om-own-row-label', text: 'Working out what this is…' })
            : names && names.title
              ? el('div', { cls: 'om-own-row-words' }, [
                  el('span', { cls: 'om-own-row-label', text: names.title }),
                  el('span', { cls: 'om-own-row-detail', text: names.artist || 'No artist named' }),
                  // Said out loud rather than hidden behind a tooltip: a low-confidence reading is still a guess at a
                  // name, and somebody about to keep it should know that before they do.
                  sure === 'low' ? el('span', { cls: 'om-own-warn', text: 'Orbis is not certain about this one.' }) : null
                ])
              : el('div', { cls: 'om-own-row-words' }, [
                  el('span', { cls: 'om-own-row-label', text: 'Orbis could not work out what this is' }),
                  heard.recognition?.why ? el('span', { cls: 'om-own-row-detail', text: String(heard.recognition.why) }) : null
                ]),
          el('div', { cls: 'om-own-acts' }, [
            heard.inLibraryId
              ? press('Play your copy', () => void doAndSay(music.play(heard.inLibraryId as string)), 'primary', 'play')
              : names && names.title && !heard.working
                ? press(
                    'Keep the name',
                    () => {
                      const sighting = heard.sighting as { provider?: string; url?: string; duration?: number } | null
                      void keep(names as TrackNames, sighting?.duration ?? 0, {
                        provider: String(sighting?.provider ?? 'web'),
                        url: typeof sighting?.url === 'string' ? sighting.url : undefined
                      })
                    },
                    'primary',
                    'plus'
                  )
                : null,
            press('Look again', () => void drawHeard(true), 'quiet', 'refresh')
          ]),
          heard.inLibraryId ? el('p', { cls: 'om-own-row-detail', text: 'You already have this one.' }) : null
        ])
      )
    }

    /** Keeps a song by name, then says which of the four things the library actually did. */
    async function keep(names: TrackNames, duration: number, source: { provider: string; url?: string }): Promise<void> {
      const answer = await music.keepNoticed(names, duration, source)
      if (!answer.got) {
        place.note(answer.why)
        return
      }
      place.note(keptWords(answer.value as { kind?: string; why?: string } | null))
      await drawHeard()
      await drawList()
    }

    /** Everything Orbis has named lately, under a heading for each day. Never the library: a different collection. */
    async function drawList(): Promise<void> {
      const answer = await music.noticed()
      const got = unwrap(answer, 'noticed songs')
      if ('problem' in got) {
        fill(listPlace, got.problem)
        return
      }
      const songs = got.value
      if (songs.length === 0) {
        fill(
          listPlace,
          nothingYet(
            'songs noticed yet',
            'When a web page plays something, Orbis works out what it is and lists it here. It never keeps a name you have not asked it to.'
          )
        )
        return
      }
      const now = Date.now()
      fill(
        listPlace,
        ...byDay(songs, now).map((group) =>
          el('div', { cls: 'om-own-day' }, [
            el('h3', { cls: 'om-own-sub', text: group.day }),
            el(
              'ul',
              { cls: 'om-own-noticed' },
              group.things.map((song) =>
                el('li', { cls: 'om-own-noticed-row' }, [
                  el('span', { cls: 'om-own-row-words' }, [
                    el('span', { cls: 'om-own-row-label', text: song.title }),
                    el('span', { cls: 'om-own-row-detail', text: [song.artist || 'No artist named', song.album].filter((one) => one).join(' — ') })
                  ]),
                  el('span', { cls: 'om-own-noticed-from', text: fromWords(song.provider) }),
                  el('span', { cls: 'om-own-when', text: whenWords(song.at, now) }),
                  noticedOffer(song) === 'play'
                    ? button(
                        { cls: 'om-icon om-icon-sm', title: `Play your copy of ${song.title}`, onClick: () => void doAndSay(music.play(song.trackId as string)) },
                        [icon('play', 15)]
                      )
                    : button(
                        {
                          cls: 'om-icon om-icon-sm',
                          title: 'Keep the name. There is no audio for it on this computer.',
                          onClick: () =>
                            void keep({ title: song.title, artist: song.artist, album: song.album ?? '' }, 0, { provider: song.provider, url: song.url })
                        },
                        [icon('plus', 15)]
                      ),
                  // Whether there is a copy is the whole point of this list, so it is on every row rather than implied
                  // by which button happens to be there.
                  el('span', {
                    cls: noticedOffer(song) === 'play' ? 'om-pill' : 'om-pill om-pill-warn',
                    text: noticedOffer(song) === 'play' ? 'In your music' : 'No audio here'
                  })
                ])
              )
            )
          ])
        )
      )
    }

    /** Empties the list of names. The library is untouched: a song kept by name stays kept. */
    async function forget(): Promise<void> {
      await doAndSay(music.run('clear-recognised'))
      await drawList()
    }

    fill(
      place.into,
      screenHead(
        'Noticed while browsing',
        'Orbis can tell you what a web page is playing. It never touches that player, and it never downloads anything.'
      ),
      block('Playing on a page now', 'What Orbis can see at this moment.', [nowPlace]),
      block(
        'Named lately',
        'A list of names, not a library. Keeping one links a copy you already have, or keeps the name with no audio.',
        [listPlace],
        press('Forget this list', () => void forget(), 'quiet')
      )
    )
    void drawHeard()
    void drawList()

    // What is playing on a page is not in the player state, so this screen asks on its own clock. Four seconds
    // rather than one: this answer changes when somebody navigates, not while a song plays, and the asking costs
    // something on the Orbis side.
    const timer = setInterval(() => {
      if (!document.hidden) void drawHeard()
    }, 4000)

    return { leave: () => clearInterval(timer) }
  }
})
