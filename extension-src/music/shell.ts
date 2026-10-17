/**
 * The frame every screen sits in.
 *
 * Four areas: the list down the left, the scrolling area in the middle with its own back and forward, a column on the
 * right about what is playing that can be closed, and the player along the bottom. None of them knows about any
 * particular screen -- the middle is filled by whichever screen the address names, through `screens.ts`.
 *
 * The player bar is the one piece of this page that is never redrawn from scratch. Its nodes are built once and their
 * words and widths are changed in place, because a bar rebuilt once a second loses the focus ring off whatever button
 * somebody had tabbed to, and a volume slider rebuilt mid-drag jumps out from under the hand.
 *
 * What is playing is read in exactly one place, `player.ts`. The bar, the column on the right and the screens are all
 * views of that one value, which is why a play button here can never disagree with the music.
 */

import { MUSIC_NAV, clockText, countText, fillFraction, nextRepeat, positionText, seekTarget } from '../../src/shared/music/fulltab.ts'
import { queueParts } from '../../src/shared/music/queue.ts'
import type { OrbisTrack, Playlist } from '../../src/shared/music.ts'
import { playableOffline, whyNotPlayable } from '../../src/shared/music.ts'
import * as music from './client.ts'
import { coverFor, onCovers, tile, want } from './art.ts'
import { button, el, fill, says } from './dom.ts'
import { icon } from './icons.ts'
import * as player from './player.ts'
import { back, forward, go, onRoute, replace, route } from './router.ts'
import { screenFor, type MountedScreen } from './screens.ts'

// ---------------------------------------------------------------- the parts, built once

interface Bar {
  readonly root: HTMLElement
  readonly art: HTMLElement
  readonly title: HTMLElement
  readonly artist: HTMLElement
  readonly heart: HTMLButtonElement
  readonly playPause: HTMLButtonElement
  readonly shuffle: HTMLButtonElement
  readonly repeat: HTMLButtonElement
  readonly elapsed: HTMLElement
  readonly total: HTMLElement
  readonly seek: HTMLInputElement
  readonly seekFill: HTMLElement
  readonly volume: HTMLInputElement
  readonly volumeIcon: HTMLButtonElement
  readonly problem: HTMLElement
  readonly whose: HTMLElement
  readonly previous: HTMLButtonElement
  readonly next: HTMLButtonElement
}

let bar: Bar | null = null
let noteStrip: HTMLElement | null = null
let host: HTMLElement | null = null
let sidePlaylists: HTMLElement | null = null
let navList: HTMLElement | null = null
let nowColumn: HTMLElement | null = null
let root: HTMLElement | null = null
let mounted: MountedScreen | null = null
let mountedKey = ''
let nowPlayingChosen = true
let noteTimer: ReturnType<typeof setTimeout> | null = null

/** Says something briefly along the bottom: the answer to a press, in the music service's own words. */
export function note(words: string): void {
  if (!noteStrip) return
  noteStrip.textContent = words
  noteStrip.classList.toggle('om-note-on', words !== '')
  if (noteTimer) clearTimeout(noteTimer)
  if (words) noteTimer = setTimeout(() => note(''), 5000)
}

/** Does something, then says whatever the music service said about it and reads the player back. */
async function tried<T>(doing: Promise<music.Answer<T>>): Promise<void> {
  const answer = await doing
  if (!answer.got) note(answer.why)
  else {
    const said = answer.value as { ok?: boolean; why?: string } | null
    // Several operations answer with their own `ok` and `why`. A press that was refused must say so: assuming it
    // worked is how a button comes to look like it did something it did not.
    if (said && typeof said === 'object' && said.ok === false) note(said.why ?? 'Orbis could not do that.')
  }
  player.refreshAfterPress()
}

// ---------------------------------------------------------------- the list down the left

function navEntry(entry: (typeof MUSIC_NAV)[number], current: string): HTMLElement {
  const built = screenFor(entry.screen) !== undefined
  return button(
    {
      cls: `om-nav-item${entry.screen === current ? ' om-on' : ''}${built ? '' : ' om-nav-unbuilt'}`,
      attrs: { 'aria-current': entry.screen === current ? 'page' : null },
      title: built ? undefined : 'This screen is not built yet.',
      onClick: () => go(entry.screen)
    },
    [icon(entry.icon, 18), el('span', { cls: 'om-nav-label', text: entry.label })]
  )
}

function drawNav(): void {
  if (!navList) return
  const current = route().screen
  const main = MUSIC_NAV.filter((one) => !one.secondary)
  const rest = MUSIC_NAV.filter((one) => one.secondary)
  fill(
    navList,
    ...main.map((one) => navEntry(one, current)),
    el('div', { cls: 'om-nav-line', attrs: { role: 'separator' } }),
    ...rest.map((one) => navEntry(one, current))
  )
}

/**
 * The person's real playlists, down the left.
 *
 * Real ones only. There is no made-up list here and no filler row: with no playlists the list says so in a sentence,
 * and with the Orbis window shut it says that instead, because an empty list would read as "you have no playlists".
 */
async function drawPlaylists(): Promise<void> {
  if (!sidePlaylists) return
  const answer = await music.playlists()
  if (!sidePlaylists) return
  if (!answer.got) {
    fill(sidePlaylists, el('p', { cls: 'om-side-says', text: answer.shut ? 'Open the Orbis window to see your playlists.' : answer.why }))
    return
  }
  const lists: Playlist[] = answer.value
  if (lists.length === 0) {
    fill(sidePlaylists, el('p', { cls: 'om-side-says', text: 'No playlists yet.' }))
    return
  }
  const here = route()
  fill(
    sidePlaylists,
    ...lists.map((list) =>
      button(
        {
          cls: `om-side-row${here.screen === 'playlist' && here.of === list.id ? ' om-on' : ''}`,
          onClick: () => go('playlist', list.id)
        },
        [
          tile({ title: list.name }, { size: 'sm' }),
          el('span', { cls: 'om-side-words' }, [
            el('span', { cls: 'om-side-name', text: list.name }),
            el('span', { cls: 'om-side-sub', text: list.rule ? 'Worked out from your music' : countText(list.tracks.length, 'song', 'songs') })
          ])
        ]
      )
    )
  )
}

// ---------------------------------------------------------------- what is playing, down the right

/**
 * The column on the right: the cover large, what is playing, and what is coming next.
 *
 * Redrawn only when the player says something a person could see has changed, which is why dragging a queue entry
 * does not have the list pulled out from under the pointer once a second.
 */
function drawNowColumn(state: player.PlayerState): void {
  if (!nowColumn) return
  const music_ = state.music
  if (!music_) {
    fill(nowColumn, says(state.starting ? 'Reading what is playing…' : state.shut ? 'Orbis Music is not open' : 'Nothing is playing'))
    return
  }
  if (music_.playback.owner === 'website') {
    fill(
      nowColumn,
      el('div', { cls: 'om-col-head' }, [el('h2', { cls: 'om-col-title', text: 'Playing on a web page' })]),
      says('That player belongs to the page', 'Orbis leaves it alone. It can tell you what the song is, and keep the name if you want it.')
    )
    return
  }
  const track = music_.track
  /*
   * Counted in the player's own id array, never in the list of track rows.
   *
   * `music:state` answers with both: `playback.queue` is the ids, in order, and `queue` is those ids looked up in
   * the library with the misses dropped. The moment the queue holds a song that has since left the library the two
   * are different lengths, and `playback.at` is a position in the id array. This column used to slice the row list
   * by that position and then hand the row's own offset to take-one-out, which showed the wrong rows and took out
   * the wrong song. So the slots come from the ids and the rows are looked up by id.
   */
  const byId = new Map(music_.queue.map((one) => [one.id, one]))
  const coming = queueParts(music_.playback.queue, music_.playback.at).next.slice(0, 20)
  fill(
    nowColumn,
    el('div', { cls: 'om-col-head' }, [
      el('h2', { cls: 'om-col-title', text: 'Playing now' }),
      button({ cls: 'om-icon', title: 'Close this column', onClick: () => showNowPlaying(false) }, [icon('close', 18)])
    ]),
    track
      ? el('div', { cls: 'om-col-now' }, [
          tile({ id: track.id, title: track.title, artist: track.artist, album: track.album, artwork: track.artwork }, { size: 'xl' }),
          el('p', { cls: 'om-col-track', text: track.title }),
          el('p', { cls: 'om-col-artist', text: [track.artist, track.album].filter((one) => one).join(' — ') || 'No artist named' }),
          whyNotPlayable(track) ? el('p', { cls: 'om-col-warn', text: whyNotPlayable(track) as string }) : null
        ])
      : says('Nothing is playing'),
    el('h3', { cls: 'om-col-sub', text: 'Up next' }),
    coming.length === 0
      ? el('p', { cls: 'om-side-says', text: 'Nothing is lined up.' })
      : el(
          'ol',
          { cls: 'om-col-queue' },
          coming.map((slot) => {
            const one = byId.get(slot.trackId)
            return el('li', { cls: 'om-col-queue-row' }, [
              one
                ? button({ cls: 'om-col-queue-play', title: `Play ${one.title}`, onClick: () => void tried(music.play(one.id)) }, [
                    tile({ id: one.id, title: one.title, artist: one.artist, album: one.album }, { size: 'sm' }),
                    el('span', { cls: 'om-side-words' }, [
                      el('span', { cls: 'om-side-name', text: one.title }),
                      el('span', { cls: 'om-side-sub', text: one.artist || 'No artist named' })
                    ])
                  ])
                : // An id the library no longer has a song for. Drawn as itself rather than skipped: dropping it
                  // would shorten the list and put every take-out button below it on the wrong track.
                  el('span', { cls: 'om-side-words' }, [
                    el('span', { cls: 'om-side-name', text: 'A song that is no longer in your music' }),
                    el('span', { cls: 'om-side-sub', text: 'It is still in what is coming next. Take it out to be rid of it.' })
                  ]),
              button(
                {
                  cls: 'om-icon om-icon-sm',
                  title: 'Take out of what is coming next',
                  onClick: () => void tried(music.queueRemove(slot.index))
                },
                [icon('close', 15)]
              )
            ])
          })
        )
  )
  if (track) void want([track.id, ...coming.map((slot) => slot.trackId)])
}

export function showNowPlaying(on: boolean): void {
  nowPlayingChosen = on
  applyNowPlaying()
}

/** Whether the column is on screen: what the screen asks for first, what the person chose otherwise. */
function applyNowPlaying(): void {
  if (!root) return
  const wants = screenFor(route().screen)?.wants?.nowPlaying ?? 'as-chosen'
  const on = wants === 'show' ? true : wants === 'hide' ? false : nowPlayingChosen
  root.classList.toggle('om-no-column', !on)
  if (on) drawNowColumn(player.current())
}

// ---------------------------------------------------------------- the player along the bottom

function buildBar(): Bar {
  const art = el('div', { cls: 'om-bar-art' })
  const title = el('span', { cls: 'om-bar-title', text: 'Nothing is playing' })
  const artist = el('span', { cls: 'om-bar-artist', text: '' })
  const whose = el('span', { cls: 'om-bar-whose', text: '' })
  const heart = button({ cls: 'om-icon', title: 'Favourite' }, [icon('heart', 18)])
  const shuffle = button({ cls: 'om-icon', title: 'Shuffle' }, [icon('shuffle', 18)])
  const prev = button({ cls: 'om-icon', title: 'Previous', onClick: () => void tried(music.previous()) }, [icon('prev', 18)])
  const playPause = button({ cls: 'om-play', title: 'Play' }, [icon('play', 20)])
  const nextOne = button({ cls: 'om-icon', title: 'Next', onClick: () => void tried(music.next()) }, [icon('next', 18)])
  const repeat = button({ cls: 'om-icon', title: 'Repeat' }, [icon('repeat', 18)])
  const elapsed = el('span', { cls: 'om-time', text: '0:00' })
  const total = el('span', { cls: 'om-time', text: '—' })
  const seekFill = el('div', { cls: 'om-rail-fill' })
  const seek = el('input', { cls: 'om-rail-input', attrs: { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': 'How far through the track' } })
  const volume = el('input', { cls: 'om-rail-input', attrs: { type: 'range', min: '0', max: '100', value: '100', 'aria-label': 'Volume' } })
  const volumeFill = el('div', { cls: 'om-rail-fill' })
  const volumeIcon = button({ cls: 'om-icon', title: 'Mute' }, [icon('volume', 18)])
  const problem = el('p', { cls: 'om-bar-problem' })

  // The real <input type=range> is kept underneath the drawn bar rather than replaced by a div, so arrow keys seek
  // and a screen reader is told a value. The drawn part is only the look.
  const seekRail = el('div', { cls: 'om-rail' }, [el('div', { cls: 'om-rail-track' }), seekFill, seek])
  const volumeRail = el('div', { cls: 'om-rail om-rail-short' }, [el('div', { cls: 'om-rail-track' }), volumeFill, volume])

  // Dragging writes nothing until the hand lets go. The panel before this one sent a seek on every pixel of
  // movement, which was a round trip and a redraw per pixel; here the handle is held locally and sent once.
  const seekAt = (): number | null => {
    const played = player.current().music?.playback
    return seekTarget(Number(seek.value) / 1000, played?.duration ?? 0)
  }
  seek.addEventListener('input', () => {
    const at = seekAt()
    if (at === null) return
    player.holding('seek', at)
    elapsed.textContent = positionText(at)
    seekFill.style.setProperty('--om-fill', `${Number(seek.value) / 10}%`)
  })
  const letGoOfSeek = (): void => {
    const at = seekAt()
    player.holding('seek', null)
    if (at === null) {
      note('This track has no known length, so there is nowhere to seek to.')
      return
    }
    void tried(music.seek(at))
  }
  seek.addEventListener('change', letGoOfSeek)

  volume.addEventListener('input', () => {
    const level = Number(volume.value) / 100
    player.holding('volume', level)
    volumeFill.style.setProperty('--om-fill', `${Number(volume.value)}%`)
  })
  volume.addEventListener('change', () => {
    const level = Number(volume.value) / 100
    player.holding('volume', null)
    void tried(music.setVolume(level))
  })

  playPause.addEventListener('click', () => void tried(music.playOrPause()))
  shuffle.addEventListener('click', () => {
    const on = player.current().music?.playback.shuffle === true
    void tried(music.setShuffle(!on))
  })
  repeat.addEventListener('click', () => {
    const mode = player.current().music?.playback.repeat ?? 'off'
    void tried(music.setRepeat(nextRepeat(mode)))
  })
  volumeIcon.addEventListener('click', () => {
    const on = player.current().music?.playback.muted === true
    void tried(music.setMuted(!on))
  })
  heart.addEventListener('click', () => {
    const track = player.current().music?.track
    if (!track) {
      note('Nothing is playing.')
      return
    }
    void tried(music.setFavourite(track.id, track.favourite !== true))
  })

  const whatsPlaying = button({ cls: 'om-bar-who', title: 'Show what is playing', onClick: () => showNowPlaying(true) }, [
    art,
    el('span', { cls: 'om-bar-words' }, [title, artist, whose])
  ])

  const rootNode = el('footer', { cls: 'om-bar', attrs: { 'aria-label': 'Player' } }, [
    el('div', { cls: 'om-bar-left' }, [whatsPlaying, heart]),
    el('div', { cls: 'om-bar-middle' }, [
      el('div', { cls: 'om-transport' }, [shuffle, prev, playPause, nextOne, repeat]),
      el('div', { cls: 'om-seek' }, [elapsed, seekRail, total]),
      problem
    ]),
    el('div', { cls: 'om-bar-right' }, [
      button({ cls: 'om-icon', title: 'Up next', onClick: () => go('queue') }, [icon('list', 18)]),
      button({ cls: 'om-icon', title: 'Show or hide the column on the right', onClick: () => showNowPlaying(!nowPlayingChosen) }, [icon('panel', 18)]),
      volumeIcon,
      volumeRail
    ])
  ])

  return {
    root: rootNode,
    art,
    title,
    artist,
    heart,
    playPause,
    shuffle,
    repeat,
    elapsed,
    total,
    seek,
    seekFill,
    volume,
    volumeIcon,
    problem,
    whose,
    previous: prev,
    next: nextOne
  }
}

/** Changes the words and the widths in the bar. Never rebuilds it: see the note at the top of the file. */
function drawBar(state: player.PlayerState): void {
  if (!bar) return
  const music_ = state.music
  const playback = music_?.playback
  const track = music_?.track ?? null
  const website = playback?.owner === 'website'

  fill(bar.art, tile({ id: track?.id, title: track?.title ?? '', artist: track?.artist, album: track?.album }, { size: 'md' }))
  bar.title.textContent = track ? track.title : website ? 'A web page is playing' : state.starting ? 'Reading what is playing…' : 'Nothing is playing'
  bar.artist.textContent = track ? track.artist || 'No artist named' : ''
  // Whose sound it is, said out loud. A website's player is seen and never touched, and that distinction is the
  // thing people find most surprising about Orbis Music, so it is on screen rather than implied.
  // The last answer is kept on purpose, so a busy moment does not flicker the bar. But a kept answer is not what is
  // playing any more: once a read has failed, the track and the art are history, and the bar must say so and must
  // not offer buttons that would act on it. The moment the next read succeeds, `stale` goes away with the problem.
  const stale = !website && music_ !== null && (state.shut || state.problem !== null)
  bar.whose.textContent = website ? 'Orbis leaves that player alone' : state.shut ? 'Orbis Music is not open' : stale ? 'Last read did not answer, so this may be out of date' : ''

  // While stale the bar says the last thing it knew, so it must not claim to be playing.
  const playing = playback?.playing === true && !stale
  fill(bar.playPause, icon(playing ? 'pause' : 'play', 20))
  bar.playPause.title = playing ? 'Pause' : 'Play'
  bar.playPause.setAttribute('aria-label', bar.playPause.title)
  bar.playPause.disabled = website || !music_ || stale
  bar.previous.disabled = stale
  bar.next.disabled = stale
  bar.root.classList.toggle('om-bar-stale', stale)

  bar.shuffle.classList.toggle('om-on', playback?.shuffle === true)
  bar.shuffle.setAttribute('aria-pressed', String(playback?.shuffle === true))
  const repeat = playback?.repeat ?? 'off'
  bar.repeat.classList.toggle('om-on', repeat !== 'off')
  bar.repeat.title = repeat === 'off' ? 'Repeat' : repeat === 'all' ? 'Repeating everything' : 'Repeating this one'
  bar.repeat.setAttribute('aria-label', bar.repeat.title)
  bar.repeat.setAttribute('aria-pressed', String(repeat !== 'off'))
  bar.repeat.classList.toggle('om-repeat-one', repeat === 'one')

  bar.heart.classList.toggle('om-on', track?.favourite === true)
  bar.heart.title = track?.favourite === true ? 'Take out of favourites' : 'Add to favourites'
  bar.heart.setAttribute('aria-label', bar.heart.title)
  bar.heart.disabled = !track

  fill(bar.volumeIcon, icon(playback?.muted ? 'mute' : 'volume', 18))
  bar.volumeIcon.title = playback?.muted ? 'Turn the sound back on' : 'Mute'
  bar.volumeIcon.setAttribute('aria-label', bar.volumeIcon.title)
  if (document.activeElement !== bar.volume) {
    const level = Math.round(player.volumeNow() * 100)
    bar.volume.value = String(level)
    const fillNode = bar.volume.parentElement?.querySelector('.om-rail-fill')
    if (fillNode instanceof HTMLElement) fillNode.style.setProperty('--om-fill', `${level}%`)
  }

  // A refusal from the player is shown in the player's own words. It is the one place a sentence like "this computer
  // cannot play this kind of audio file" can honestly appear, and it must not be swallowed.
  bar.problem.textContent = playback?.problem ?? (state.problem && !state.shut ? state.problem : '')
  bar.problem.classList.toggle('om-on', bar.problem.textContent !== '')

  drawSeek()
  bar.root.classList.toggle('om-bar-website', website)
}

/** The only thing that runs on the clock: the bar moving between answers. */
function drawSeek(): void {
  if (!bar) return
  const playback = player.current().music?.playback
  const duration = playback?.duration ?? 0
  const at = player.positionNow()
  bar.total.textContent = clockText(duration)
  if (document.activeElement !== bar.seek) {
    bar.elapsed.textContent = positionText(at)
    const fraction = fillFraction(at, duration)
    bar.seek.value = String(Math.round(fraction * 1000))
    bar.seekFill.style.setProperty('--om-fill', `${fraction * 100}%`)
  }
  // A track with no known length cannot be seeked in, so the handle is off rather than pretending to work.
  bar.seek.disabled = !(duration > 0)
  bar.seek.setAttribute('aria-valuetext', duration > 0 ? `${positionText(at)} of ${clockText(duration)}` : 'This track has no known length')
}

// ---------------------------------------------------------------- putting a screen in the middle

function mount(): void {
  if (!host) return
  const here = route()
  const key = `${here.screen}|${here.of}`
  const shape = screenFor(here.screen)
  document.title = shape?.title ? `${shape.title(here)} — Orbis Music` : 'Orbis Music'
  applyNowPlaying()
  drawNav()
  void drawPlaylists()

  // The same screen about the same thing is not remounted for new search words: a search box that lost its focus on
  // every letter would be unusable. The screen is told instead, through its own route reading.
  if (key === mountedKey && mounted) return
  mounted?.leave?.()
  mounted = null
  mountedKey = key
  fill(host)
  if (!shape) {
    host.append(
      says(
        'This screen is not built yet',
        'The frame around it is: the player below, the list on the left and the browser’s own back and forward all work.',
        { label: 'Go to Home', onClick: () => go('home') }
      )
    )
    return
  }
  host.classList.toggle('om-wide', shape.wants?.wide === true)
  mounted =
    shape.mount({
      into: host,
      route: here,
      go,
      replace,
      note,
      wantCovers: (ids) => void want(ids),
      refresh: () => void player.refresh(),
      showNowPlaying
    }) || null
}

// ---------------------------------------------------------------- building the whole thing

/** Builds the frame into the page and starts everything watching. Called once. */
export function startShell(into: HTMLElement): void {
  bar = buildBar()
  navList = el('nav', { cls: 'om-nav', attrs: { 'aria-label': 'Orbis Music' } })
  sidePlaylists = el('div', { cls: 'om-side-list' })
  host = el('div', { cls: 'om-screen' })
  nowColumn = el('aside', { cls: 'om-column', attrs: { 'aria-label': 'What is playing' } })
  noteStrip = el('div', { cls: 'om-note', attrs: { role: 'status', 'aria-live': 'polite' } })

  const side = el('div', { cls: 'om-side' }, [
    el('div', { cls: 'om-brand' }, [icon('note', 22), el('span', { cls: 'om-brand-name', text: 'Orbis Music' })]),
    navList,
    el('div', { cls: 'om-side-head' }, [
      // The heading opens the whole lot and the button beside it makes a new one. Both go to the same screen, which
      // is where a playlist is made: the heading is pressable because that is the first thing somebody tries.
      button({ cls: 'om-side-title om-side-title-press', title: 'All your playlists', onClick: () => go('playlists') }, [el('span', { text: 'Your playlists' })]),
      button({ cls: 'om-icon om-icon-sm', title: 'New playlist', onClick: () => go('playlists') }, [icon('plus', 16)])
    ]),
    sidePlaylists
  ])

  const main = el('main', { cls: 'om-main' }, [
    el('div', { cls: 'om-top' }, [
      button({ cls: 'om-icon', title: 'Back', onClick: back }, [icon('back', 18)]),
      button({ cls: 'om-icon', title: 'Forward', onClick: forward }, [icon('forward', 18)]),
      button({ cls: 'om-top-search', onClick: () => go('search') }, [icon('search', 16), el('span', { text: 'Search your music' })])
    ]),
    host
  ])

  root = el('div', { cls: 'om' }, [side, main, nowColumn, bar.root, noteStrip])
  fill(into, root)

  // There is no left-hand entry for 'playlists': the person's own playlists are already listed underneath, so the
  // heading and the button above are the way to the screen that holds all of them.
  onRoute(mount)
  player.watch((state) => {
    drawBar(state)
    applyNowPlaying()
    mounted?.onPlayer?.(state)
  })
  onCovers(() => {
    drawBar(player.current())
    applyNowPlaying()
    mounted?.onCovers?.()
  })
  // The bar is the one thing drawn on a clock of its own, four times a second, because the position it shows is
  // worked out here and not read from an answer. Everything else waits for something to change.
  setInterval(() => {
    if (!document.hidden) drawSeek()
  }, 250)

  player.startWatching()
  mount()
  drawBar(player.current())
}

/** Offered to a screen so it can draw a track row the same way every other screen does. */
export interface RowOptions {
  readonly playing?: boolean
  /** Where this row sits in the queue, which turns the add button into a take-out button. */
  readonly queueAt?: number
  readonly onPlay?: () => void
}

/**
 * One track, as a row.
 *
 * Here rather than in each screen because every list in a music app is the same row, and six copies of it is six
 * places for the availability wording to drift. A track with no audio on this computer is still listed and still
 * looks like a song -- because it is one -- but its play button is off and says why in the music service's own words.
 */
export function trackRow(track: OrbisTrack, options: RowOptions = {}): HTMLElement {
  const playable = playableOffline(track)
  const why = whyNotPlayable(track)
  const row = el('li', { cls: `om-row${options.playing ? ' om-row-now' : ''}${playable ? '' : ' om-row-off'}` })
  row.append(
    button(
      {
        cls: 'om-row-play',
        title: playable ? `Play ${track.title}` : (why ?? 'This cannot be played'),
        onClick: () => {
          if (!playable) {
            note(why ?? 'Orbis has no audio for this track.')
            return
          }
          if (options.onPlay) options.onPlay()
          else void tried(music.play(track.id))
        }
      },
      [
        tile({ id: track.id, title: track.title, artist: track.artist, album: track.album }, { size: 'md' }),
        el('span', { cls: 'om-row-words' }, [
          el('span', { cls: 'om-row-title', text: track.title || 'No title' }),
          el('span', { cls: 'om-row-artist', text: [track.artist, track.album].filter((one) => one).join(' — ') || 'No artist named' })
        ])
      ]
    ),
    // Always a node, even when there is nothing to say: the row is a grid of fixed columns, and leaving one out
    // would shift the length and the two buttons left on every playable track.
    why
      ? el('span', {
          cls: 'om-pill om-pill-warn',
          text: track.availability === 'reference' ? 'No audio here' : track.availability === 'missing' ? 'File missing' : 'Cannot be played'
        })
      : el('span', { cls: 'om-row-gap' }),
    el('span', { cls: 'om-row-length', text: clockText(track.duration) }),
    button(
      {
        cls: `om-icon om-icon-sm${track.favourite ? ' om-on' : ''}`,
        title: track.favourite ? 'Take out of favourites' : 'Add to favourites',
        onClick: () => void tried(music.setFavourite(track.id, track.favourite !== true))
      },
      [icon('heart', 15)]
    ),
    options.queueAt === undefined
      ? button({ cls: 'om-icon om-icon-sm', title: 'Add to what is coming next', onClick: () => void tried(music.queueEnd([track.id])) }, [icon('plus', 15)])
      : button({ cls: 'om-icon om-icon-sm', title: 'Take out of what is coming next', onClick: () => void tried(music.queueRemove(options.queueAt as number)) }, [
          icon('close', 15)
        ])
  )
  return row
}

/** Offered to a screen: does something, says what the music service said, reads the player back. */
export const doAndSay = tried

/** Offered to a screen: the cover a track already has, when it needs one for a header wash. */
export { coverFor }
