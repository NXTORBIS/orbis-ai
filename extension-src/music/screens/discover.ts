/**
 * The DJ, the stations, and what Orbis has worked out about you.
 *
 * Everything on this screen is the engine's own answer, asked for and shown as it came. Nothing is written here: the
 * reasons under "Why this one" are the parts that really contributed to the track's score, the readings are what the
 * taste model measured, and the genres and eras it says you have not listened to are counted off your own library.
 * An explanation nobody can check is decoration, so there is none.
 *
 * Three things it is careful about.
 *
 * Orbis does not keep a record of which adventurousness you last chose -- the engine turns a level into numbers and
 * keeps the numbers -- so none of the five is shown as the one in use. Marking one would be stating something nobody
 * stored. The same goes for the DJ: there is no operation that answers whether it is on, so there is a Start and a
 * Stop rather than one switch that might be lying.
 *
 * A thin profile shows almost nothing here, and that is the intended answer. A reading with no evidence behind it is
 * left out rather than drawn as a bar near zero, because a bar at zero looks like a measurement.
 *
 * And nothing on this screen plays anything that cannot be played: the engine only ever draws from tracks with audio
 * on this computer, so a station never offers a song Orbis has only the name of.
 */

import { DISCOVERY_LEVELS, FORGET_SCOPES, howSure, measuringWords, tasteBars, type DiscoveryLevel, type ForgetScope } from '../../../src/shared/music/listening.ts'
import * as music from '../client.ts'
import { el, fill } from '../dom.ts'
import { registerScreen } from '../screens.ts'
import { doAndSay } from '../shell.ts'
import { block, card, carefulPress, choices, figure, figures, nothingYet, press, reading, readingBar, screenHead, unwrap } from './own-parts.ts'

/**
 * What one sitting has in it, as the engine keeps it.
 *
 * Only the counted parts are named: every one of these is a thing that really happened and was written down, so a
 * figure drawn from them is a figure and not an estimate.
 */
interface Sitting {
  readonly tracks?: readonly unknown[]
  readonly skips?: number
  readonly completions?: number
  readonly favourites?: number
  readonly discoveryOffered?: number
  readonly discoveryAccepted?: number
}

/** What the engine counts off the library: how much of a genre, a language or an era has actually been played. */
interface Corner {
  readonly name: string | number
  readonly played: number
  readonly total: number
}

function corners(what: string, items: readonly Corner[]): HTMLElement {
  // Only the corners there is something left to hear in. A row reading "played 12 of 12" is not a place to explore.
  const left = items.filter((one) => one.total > one.played).sort((a, b) => b.total - b.played - (a.total - a.played))
  if (left.length === 0) return el('p', { cls: 'om-side-says', text: `You have played something from every ${what} in your music.` })
  return el(
    'ul',
    { cls: 'om-own-tallies' },
    left.slice(0, 8).map((one) =>
      el('li', { cls: 'om-own-tally' }, [
        el('span', { cls: 'om-own-tally-name', text: String(one.name) }),
        el('span', { cls: 'om-own-tally-rail', attrs: { 'aria-hidden': 'true' } }, [
          el('span', { cls: 'om-own-tally-fill', style: { '--om-own-fill': `${one.total > 0 ? Math.round((one.played / one.total) * 100) : 0}%` } })
        ]),
        el('span', { cls: 'om-own-tally-count', text: `${one.played} of ${one.total} played` })
      ])
    )
  )
}

registerScreen({
  screen: 'discover',
  title: () => 'Discover',
  mount: (place) => {
    const djPlace = el('div', { cls: 'om-own-slot' })
    const waysPlace = el('div', { cls: 'om-own-slot' }, [reading('ways to explore')])
    const askPlace = el('div', { cls: 'om-own-slot' })
    const whyPlace = el('div', { cls: 'om-own-slot' })
    const tastePlace = el('div', { cls: 'om-own-slot' }, [reading('taste')])
    const cornersPlace = el('div', { cls: 'om-own-slot' }, [reading('music')])
    const sittingPlace = el('div', { cls: 'om-own-slot' }, [reading('sitting')])
    let playingId: string | null = null
    let said = ''

    // ---- the DJ and the stations ----

    function drawDj(): void {
      fill(
        djPlace,
        card('om-own-dj', [
          el('div', { cls: 'om-own-row-words' }, [
            el('span', { cls: 'om-own-row-label', text: 'The DJ keeps the music going' }),
            el('span', {
              cls: 'om-own-row-detail',
              text: 'It plans a few songs ahead and refills as they play, from your own music. Orbis does not keep whether it is on, so neither button is shown as the one in use.'
            })
          ]),
          el('div', { cls: 'om-own-acts' }, [
            press('Start the DJ', () => void doAndSay(music.setDj(true)), 'primary', 'dj'),
            press('Stop the DJ', () => void doAndSay(music.setDj(false)), 'quiet'),
            press(
              playingId ? 'Station from this song' : 'Station from your taste',
              () => void doAndSay(music.station(playingId ?? undefined)),
              'normal',
              'compass'
            )
          ])
        ])
      )
    }

    async function drawWays(): Promise<void> {
      const answer = await music.explorations()
      const got = unwrap(answer, 'ways to explore')
      if ('problem' in got) {
        fill(waysPlace, got.problem)
        return
      }
      const ways = got.value
      if (ways.length === 0) {
        fill(waysPlace, nothingYet('ways to explore'))
        return
      }
      fill(
        waysPlace,
        el(
          'div',
          { cls: 'om-own-tiles' },
          ways.map((way) =>
            el('button', { cls: 'om-own-tile', attrs: { type: 'button' }, on: { click: () => void start(way.id) } }, [
              el('span', { cls: 'om-own-tile-label', text: way.label }),
              el('span', { cls: 'om-own-tile-blurb', text: way.blurb })
            ])
          )
        )
      )
    }

    /** Starts one of the named ways of exploring, and shows the engine's own sentence about what it chose. */
    async function start(id: string): Promise<void> {
      const answer = await music.explore(id)
      if (!answer.got) {
        place.note(answer.why)
        return
      }
      const said_ = answer.value
      if (said_.ok === false) {
        place.note(said_.why ?? 'Orbis could not do that.')
        return
      }
      const because = (said_.because ?? []).filter((one) => typeof one === 'string')
      place.note(because.length > 0 ? `${said_.label ?? 'Playing'}: ${because.join(', ')}` : (said_.label ?? 'Playing.'))
      place.refresh()
    }

    // ---- saying what you feel like ----

    function drawAsk(): void {
      const box = el('input', {
        cls: 'om-own-input',
        attrs: { type: 'search', placeholder: 'Something calm I have not heard', 'aria-label': 'What do you feel like?', value: said, maxlength: '300' }
      })
      box.addEventListener('input', () => {
        said = box.value
      })
      const send = async (): Promise<void> => {
        const answer = await music.askFor(box.value)
        if (!answer.got) {
          place.note(answer.why)
          return
        }
        const read = answer.value as { intent?: { intent?: string }; notUnderstood?: readonly string[] } | null
        const missed = (read?.notUnderstood ?? []).filter((one) => typeof one === 'string')
        // What it could not read is said plainly. A request half understood and silently narrowed is how somebody
        // comes to think Orbis ignored them.
        place.note(
          missed.length > 0
            ? `Orbis could not read: ${missed.join(', ')}`
            : read?.intent?.intent
              ? `Read as ${String(read.intent.intent).replace(/-/g, ' ')}. It will choose that way from now on.`
              : 'Orbis has taken that into account.'
        )
      }
      box.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') void send()
      })
      fill(
        askPlace,
        card('', [
          el('div', { cls: 'om-own-asker' }, [box, press('Tell Orbis', () => void send(), 'primary')]),
          el('div', { cls: 'om-own-acts' }, [press('Forget what I asked for', () => void doAndSay(music.run('clear-request')), 'quiet')]),
          choices<DiscoveryLevel>({
            label: 'How adventurous',
            detail: 'Orbis keeps this as numbers rather than as a name, so none of these is shown as the one in use.',
            items: DISCOVERY_LEVELS.map((one) => ({ id: one.id, label: one.label, blurb: one.blurb })),
            chosen: null,
            onPick: (id) => void doAndSay(music.setDiscovery(id))
          })
        ])
      )
    }

    // ---- why this one ----

    async function drawWhy(): Promise<void> {
      if (!playingId) {
        fill(whyPlace, el('p', { cls: 'om-side-says', text: 'Play something and Orbis will say why it chose it.' }))
        return
      }
      const answer = await music.whyThis(playingId)
      const got = unwrap(answer, 'reasons')
      if ('problem' in got) {
        fill(whyPlace, got.problem)
        return
      }
      const why = got.value
      const because = (why?.because ?? []).slice(0, 6)
      if (because.length === 0) {
        fill(whyPlace, el('p', { cls: 'om-side-says', text: 'Orbis has no reasons for this one: you chose it yourself, or it has not measured enough yet.' }))
        return
      }
      fill(
        whyPlace,
        el(
          'ul',
          { cls: 'om-own-whys' },
          because.map((one) =>
            el('li', { cls: 'om-own-why' }, [
              el('span', { cls: 'om-own-why-name', text: one.name ? `${one.dimension}: ${one.name}` : one.dimension }),
              el('span', { cls: 'om-own-why-value', text: one.value > 0 ? 'you like this' : 'you avoid this' })
            ])
          )
        )
      )
    }

    // ---- what Orbis has worked out ----

    async function drawTaste(): Promise<void> {
      const answer = await music.taste()
      const got = unwrap(answer, 'taste')
      if ('problem' in got) {
        fill(tastePlace, got.problem)
        return
      }
      const dna = got.value
      const bars = tasteBars(dna.readings ?? [])
      const measuring = measuringWords(dna.measurement)
      fill(
        tastePlace,
        el('p', { cls: 'om-own-block-detail', text: howSure(dna.confidence) }),
        bars.length === 0
          ? nothingYet('readings yet', 'Play a few things and Orbis will have something to show here. It measures rather than asks.')
          : el('div', { cls: 'om-own-readings' }, bars.map((one) => readingBar(one.name, one.value, one.firm))),
        (dna.topArtists ?? []).length > 0
          ? el('p', { cls: 'om-own-row-detail', text: `Most of your listening: ${dna.topArtists.slice(0, 5).join(', ')}` })
          : null,
        (dna.topGenres ?? []).length > 0 ? el('p', { cls: 'om-own-row-detail', text: `Mostly ${dna.topGenres.slice(0, 4).join(', ')}` }) : null,
        measuring ? el('p', { cls: 'om-own-warn', text: measuring }) : null,
        el(
          'div',
          { cls: 'om-own-acts' },
          // Asked first, in the words of what each one actually throws away, because none of this can be got back.
          FORGET_SCOPES.map((scope) =>
            carefulPress(`Forget: ${scope.label.toLowerCase()}`, `${scope.blurb} Press again.`, () => {
              void doAndSay(music.forgetLearning(scope.id as ForgetScope))
            })
          )
        )
      )
    }

    async function drawCorners(): Promise<void> {
      const answer = await music.unexplored()
      const got = unwrap(answer, 'music')
      if ('problem' in got) {
        fill(cornersPlace, got.problem)
        return
      }
      const map = (got.value ?? {}) as { genres?: Corner[]; languages?: Corner[]; eras?: Corner[] }
      const genres = map.genres ?? []
      const eras = map.eras ?? []
      const languages = map.languages ?? []
      if (genres.length === 0 && eras.length === 0 && languages.length === 0) {
        fill(cornersPlace, nothingYet('music to count', 'This is counted off your own library, so it fills in as you bring music in.'))
        return
      }
      fill(
        cornersPlace,
        el('div', { cls: 'om-own-three' }, [
          el('div', {}, [el('h3', { cls: 'om-own-sub', text: 'Genres' }), corners('genre', genres)]),
          el('div', {}, [el('h3', { cls: 'om-own-sub', text: 'Years' }), corners('year', eras)]),
          el('div', {}, [el('h3', { cls: 'om-own-sub', text: 'Languages' }), corners('language', languages)])
        ])
      )
    }

    // ---- this sitting ----

    async function drawSitting(): Promise<void> {
      const answer = await music.run<{ session?: Sitting | null } | null>('session')
      const got = unwrap(answer, 'sitting')
      if ('problem' in got) {
        fill(sittingPlace, got.problem)
        return
      }
      const sitting = got.value?.session ?? null
      const count = (name: keyof Sitting): number => {
        const held = sitting?.[name]
        return typeof held === 'number' ? held : 0
      }
      const played = Array.isArray(sitting?.tracks) ? sitting.tracks.length : 0
      if (!sitting || played === 0) {
        fill(sittingPlace, nothingYet('listening in this sitting', 'A sitting starts when you play something and ends after three quarters of an hour of quiet.'))
        return
      }
      const offered = count('discoveryOffered')
      fill(
        sittingPlace,
        figures([
          figure(String(played), played === 1 ? 'song this sitting' : 'songs this sitting'),
          figure(String(count('completions')), 'played through'),
          figure(String(count('skips')), 'skipped'),
          figure(String(count('favourites')), 'made favourites'),
          // Only when something was actually offered: nought out of nought is not a score.
          offered > 0 ? figure(`${count('discoveryAccepted')} of ${offered}`, 'new songs kept on') : null
        ])
      )
    }

    async function loadAll(): Promise<void> {
      await Promise.all([drawWays(), drawTaste(), drawCorners(), drawSitting(), drawWhy()])
    }

    fill(
      place.into,
      screenHead('Discover', 'Orbis chooses from the music you have, and tells you why. It never plays something it has only the name of.'),
      block('Keep the music going', 'A DJ that plans ahead, or a station from one song.', [djPlace]),
      block('Named ways to explore', 'Six, fixed. Each one sets what the engine looks for and starts playing.', [waysPlace]),
      block('Say what you feel like', 'In your own words. Orbis says which parts it could not read.', [askPlace]),
      block('Why this one', 'The parts that really counted towards the score of what is playing.', [whyPlace]),
      block('What Orbis has worked out', 'Measured from what you played, not from anything you were asked.', [tastePlace]),
      block('Corners of your music', 'Counted off your own library: what you have and have not got round to.', [cornersPlace]),
      block('This sitting', 'What has happened since you started listening.', [sittingPlace], press('Read again', () => void loadAll(), 'quiet', 'refresh'))
    )
    drawDj()
    drawAsk()
    void loadAll()

    return {
      onPlayer: (state) => {
        const now = state.music?.track?.id ?? null
        if (now === playingId) return
        playingId = now
        drawDj()
        void drawWhy()
        void drawSitting()
      }
    }
  }
})
