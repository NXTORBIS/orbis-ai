/**
 * Playing now, filling the whole screen.
 *
 * Its own address, `#/playing`, and its own entry down the left. The column on the right shows the same cover and the
 * same list, so this screen asks for the column to close while it is up rather than showing the queue twice. The one
 * screen name this needed was added to `MusicScreenName`, the screen list and the left-hand list in
 * src/shared/music/fulltab.ts, which is the way that file says a screen is added.
 *
 * Three things here are worth knowing before changing any of it.
 *
 * **The colours behind the cover are measured, not chosen.** The cover arrives as the picture itself written into
 * text, 160 pixels on its longest side, which is the only size a browser page can be given. It is drawn into a small
 * canvas and its pixels are counted (`dominantColours`, in src/shared/music/nowplaying.ts, which is tested), and the
 * two strongest colours are written onto the header as custom properties. When there is no cover, or the picture
 * could not be read, nothing is written and the stylesheet's own fallback paints the band in the Orbis accent. There
 * is no palette of nice colours anywhere in this file: a guessed colour would look exactly like a measured one, and
 * then nothing on the screen could be trusted.
 *
 * **There are no lyrics, and there is no lyrics pane.** Nothing in Orbis Music holds lyrics -- no operation returns
 * them, and there is no timed-lyrics data in src/shared/music -- so a lyrics pane could only be empty or made up.
 * Leaving it out is the honest answer and the gap is written up in the report rather than papered over on screen.
 *
 * **Every fact about the track is a field the music service really filled in.** The facts list is built by
 * `trackFacts`, which leaves out any line it has no value for. No "Unknown", no zero play count, no invented date.
 */

import { clockText } from '../../../src/shared/music/fulltab.ts'
import { backdropColours, dominantColours, trackFacts, type Swatch } from '../../../src/shared/music/nowplaying.ts'
import { playableOffline, whyNotPlayable } from '../../../src/shared/music.ts'
import type { OrbisTrack } from '../../../src/shared/music.ts'
import { coverFor, tile, wash, want } from '../art.ts'
import * as music from '../client.ts'
import { button, el, fill, says } from '../dom.ts'
import { icon } from '../icons.ts'
import { current as playerNow, type PlayerState } from '../player.ts'
import { registerScreen, type ScreenPlace } from '../screens.ts'
import { doAndSay, trackRow } from '../shell.ts'

// ---------------------------------------------------------------- this screen's own stylesheet

/**
 * The rules for this screen live in their own plain file beside the page's own, and the link is added once here.
 *
 * A separate file rather than more rules in music.css: several screens are being written at the same time, and one
 * stylesheet being edited by all of them is how a rule goes missing. Nothing lists stylesheets anywhere, so a new one
 * needs no build change -- it only has to be in the extension's folder.
 */
function addStyles(): void {
  const href = chrome.runtime.getURL('music-nowplaying.css')
  if (document.head.querySelector(`link[href="${href}"]`)) return
  document.head.append(el('link', { attrs: { rel: 'stylesheet', href } }))
}

// ---------------------------------------------------------------- colours out of the cover's own pixels

/** What was measured for a track, kept so the same cover is not counted again every second. */
const measured = new Map<string, Swatch[]>()
/** Covers already read, including the ones that could not be read, so a failure is not retried forever. */
const read = new Set<string>()

/**
 * Counts the colours in a cover.
 *
 * The picture is drawn small on purpose: twenty-four pixels square is plenty to say what colours a record sleeve is
 * made of, and it keeps the counting to a few hundred pixels rather than twenty-five thousand. Everything is wrapped
 * because reading pixels back out of a canvas can be refused, and a refusal here must mean "no colours" and not a
 * broken screen.
 */
async function measure(trackId: string, picture: string): Promise<Swatch[]> {
  const held = measured.get(trackId)
  if (held) return held
  if (read.has(trackId)) return []
  read.add(trackId)
  const found = await new Promise<Swatch[]>((settle) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 24
        canvas.height = 24
        const paper = canvas.getContext('2d', { willReadFrequently: false })
        if (!paper) {
          settle([])
          return
        }
        paper.drawImage(image, 0, 0, 24, 24)
        settle(dominantColours(paper.getImageData(0, 0, 24, 24).data, 2))
      } catch {
        // A canvas that will not give its pixels back. There are then no colours, which the header already handles.
        settle([])
      }
    }
    image.onerror = () => settle([])
    image.src = picture
  })
  if (found.length > 0) measured.set(trackId, found)
  return found
}

/**
 * Paints the band behind the cover with the colours the cover is made of.
 *
 * Writes nothing at all when there were none: the two custom properties are left undeclared so the stylesheet's
 * fallback -- the Orbis accent -- is what shows, which is a colour that is plainly Orbis's own and not a claim about
 * the record.
 */
async function paint(band: HTMLElement, track: OrbisTrack): Promise<void> {
  const picture = coverFor(track.id)
  if (!picture) return
  const colours = backdropColours(await measure(track.id, picture))
  if (!colours) return
  // The band may have been taken off screen while the picture was being read.
  if (!band.isConnected) return
  band.style.setProperty('--om-np-near', colours.near)
  band.style.setProperty('--om-np-far', colours.far)
  band.classList.add('om-np-measured')
}

// ---------------------------------------------------------------- the screen

/** How many of what is coming next to show. The same twenty the column on the right shows. */
const UP_NEXT = 20

function factList(track: OrbisTrack): HTMLElement {
  const facts = trackFacts(track, Date.now(), clockText(track.duration))
  return el(
    'dl',
    { cls: 'om-np-facts' },
    facts.flatMap((fact) => [el('dt', { cls: 'om-np-fact-label', text: fact.label }), el('dd', { cls: 'om-np-fact-value', text: fact.value })])
  )
}

/**
 * Why Orbis chose this one.
 *
 * Asked of the engine rather than written here. The reasons that come back are the parts that really contributed to
 * the track's score, so an explanation on screen is one a person could check. Nothing is shown when the engine has no
 * reasons -- a track somebody picked themselves was not chosen by anything.
 */
async function drawWhy(into: HTMLElement, trackId: string): Promise<void> {
  const answer = await music.whyThis(trackId)
  if (!into.isConnected) return
  if (!answer.got || !answer.value || answer.value.because.length === 0) {
    into.remove()
    return
  }
  fill(
    into,
    el('h2', { cls: 'om-np-sub', text: 'Why Orbis chose this one' }),
    el(
      'ul',
      { cls: 'om-np-why' },
      answer.value.because.slice(0, 6).map((one) => el('li', { cls: 'om-np-why-row', text: one.name ? `${one.dimension}: ${one.name}` : one.dimension }))
    )
  )
}

function header(track: OrbisTrack, place: ScreenPlace): HTMLElement {
  const why = whyNotPlayable(track)
  const band = el('header', { cls: 'om-np-head' }, [
    wash(track.id),
    el('div', { cls: 'om-np-art' }, [tile({ id: track.id, title: track.title, artist: track.artist, album: track.album }, { size: 'xl' })]),
    el('div', { cls: 'om-np-words' }, [
      el('p', { cls: 'om-np-kicker', text: 'Playing now' }),
      el('h1', { cls: 'om-np-title', text: track.title || 'No title' }),
      el('p', { cls: 'om-np-by' }, [
        track.artist
          ? button({ cls: 'om-np-link', text: track.artist, title: `Everything by ${track.artist}`, onClick: () => place.go('artist', track.artist) })
          : el('span', { cls: 'om-np-faint', text: 'No artist named' }),
        track.album ? el('span', { cls: 'om-np-faint', text: ` — ${track.album}` }) : null
      ]),
      why ? el('p', { cls: 'om-np-warn', text: why }) : null,
      el('div', { cls: 'om-np-does' }, [
        button(
          {
            cls: `om-btn${track.favourite ? ' om-btn-primary' : ''}`,
            onClick: () => void doAndSay(music.setFavourite(track.id, track.favourite !== true))
          },
          [icon('heart', 16), el('span', { text: track.favourite ? 'In your favourites' : 'Add to favourites' })]
        ),
        playableOffline(track)
          ? button({ cls: 'om-btn om-btn-quiet', onClick: () => void doAndSay(music.station(track.id)) }, [
              icon('dj', 16),
              el('span', { text: 'Station from this song' })
            ])
          : null,
        button({ cls: 'om-btn om-btn-quiet', onClick: () => place.go('library') }, [icon('library', 16), el('span', { text: 'Your music' })])
      ])
    ])
  ])
  void paint(band, track)
  return band
}

function upNext(state: PlayerState, place: ScreenPlace): HTMLElement {
  const music_ = state.music
  const at = music_?.playback.at ?? -1
  const coming = (music_?.queue ?? []).slice(at + 1, at + 1 + UP_NEXT)
  const all = music_?.queue.length ?? 0
  const left = Math.max(all - (at + 1) - coming.length, 0)
  return el('section', { cls: 'om-np-next' }, [
    el('div', { cls: 'om-np-next-head' }, [
      el('h2', { cls: 'om-np-sub', text: 'Up next' }),
      coming.length > 0
        ? button({ cls: 'om-btn om-btn-quiet', text: 'Clear what is coming next', onClick: () => void doAndSay(music.queueClear()) })
        : null
    ]),
    coming.length === 0
      ? says('Nothing is lined up', 'Play an album or a playlist, or turn the DJ on, and what is coming next shows here.', {
          label: 'Go to your music',
          onClick: () => place.go('library')
        })
      : el(
          'ol',
          { cls: 'om-rows' },
          coming.map((one, index) => trackRow(one, { queueAt: at + 1 + index }))
        ),
    left > 0 ? el('p', { cls: 'om-np-faint', text: `And ${left} more after these.` }) : null
  ])
}

registerScreen({
  screen: 'playing',
  title: () => 'Playing now',
  // The column on the right shows the same cover and the same queue, so having both would be the one list twice.
  wants: { nowPlaying: 'hide', wide: true },
  mount: (place) => {
    addStyles()
    let drawn = ''

    const draw = (state: PlayerState): void => {
      const music_ = state.music
      if (!music_) {
        drawn = 'none'
        fill(
          place.into,
          says(
            state.starting ? 'Reading what is playing…' : state.shut ? 'Orbis Music is not open' : 'Nothing is playing',
            state.shut
              ? 'Open the Orbis window and your music connects by itself. Nothing here means your music is gone.'
              : state.problem
                ? state.problem
                : ''
          )
        )
        return
      }
      if (music_.playback.owner === 'website') {
        drawn = 'website'
        fill(
          place.into,
          el('header', { cls: 'om-np-head om-np-head-plain' }, [
            el('p', { cls: 'om-np-kicker', text: 'Playing on a web page' }),
            el('h1', { cls: 'om-np-title', text: 'That player belongs to the page' })
          ]),
          says(
            'Orbis leaves it alone',
            'It can work out what the song is and keep the name if you want it, but it never takes over a page’s own player.',
            { label: 'See what Orbis noticed', onClick: () => place.go('noticed') }
          )
        )
        return
      }
      const track = music_.track
      if (!track) {
        drawn = 'empty'
        fill(place.into, says('Nothing is playing'), upNext(state, place))
        return
      }
      drawn = `${track.id}|${track.favourite === true}|${music_.playback.queue.join(',')}|${music_.playback.at}`
      const whyBlock = el('section', { cls: 'om-np-whybox' })
      fill(
        place.into,
        el('div', { cls: 'om-np' }, [header(track, place), el('div', { cls: 'om-np-body' }, [factList(track), whyBlock]), upNext(state, place)])
      )
      void drawWhy(whyBlock, track.id)
      void want([track.id, ...music_.queue.slice(music_.playback.at + 1, music_.playback.at + 1 + UP_NEXT).map((one) => one.id)])
    }

    draw(playerNow())

    return {
      onPlayer: (state) => {
        // The shell only calls this when something a person could see has changed, but a position-only change can
        // still get here, so the screen keeps its own note of what it drew and leaves the page alone otherwise.
        const music_ = state.music
        const key = music_?.track
          ? `${music_.track.id}|${music_.track.favourite === true}|${music_.playback.queue.join(',')}|${music_.playback.at}`
          : music_
            ? music_.playback.owner === 'website'
              ? 'website'
              : 'empty'
            : 'none'
        if (key === drawn) return
        draw(state)
      },
      onCovers: () => {
        // A cover arriving is both a picture to draw and colours to count, and both want the header built again.
        const state = playerNow()
        if (state.music?.track) draw(state)
      }
    }
  }
})
