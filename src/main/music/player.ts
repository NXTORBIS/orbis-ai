import { BrowserWindow, protocol } from 'electron'
import type { WebContents } from 'electron'
import { promises as fs, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import {
  addToQueue,
  countsAsPlayed,
  NOTHING_PLAYING,
  nextInQueue,
  playNext,
  playableOffline,
  previousInQueue,
  removeFromQueue,
  reorderQueue,
  shuffled,
  whyNotPlayable,
  worthResuming,
  type PlaybackOwner,
  type PlaybackState,
  type RepeatMode
} from '../../shared/music.ts'
import type { MusicStore } from './store.ts'

/**
 * Orbis Music's own playback: one authoritative state, and one place that makes sound.
 *
 * The sound comes out of a window nobody sees, held by Orbis itself rather than by a tab, which is what lets music
 * carry on while somebody moves from a video to a search to another site entirely. A website's own player is
 * untouched by all of this; `owner` says which of the two is playing, and it is the only answer anybody reads.
 *
 * ## Nothing here is a picture of playback
 *
 * `playing`, `position` and `duration` are whatever the audio element last reported. Nothing is worked out from a
 * clock, nothing is assumed from a play having been asked for, and a `play()` that the element refuses leaves
 * `playing` false with the reason attached. A progress bar that keeps moving while the sound has stopped is the
 * clearest way there is to tell somebody a lie, so it cannot happen here.
 *
 * ## The page never learns a path
 *
 * Audio reaches the player as `orbis-audio://track/<id>`, which is answered here, from the library, only for a track
 * whose file Orbis has already read. A request for anything else gets nothing. So the window that plays music cannot
 * be used to read a file -- it does not know where any file is.
 */

export const AUDIO_SCHEME = 'orbis-audio'

/** How often the position is written down, so carrying on from where a track was left survives a crash. */
const REMEMBER_EVERY_MS = 10_000

export interface PlayerReport {
  trackId: string | null
  playing: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  buffering: boolean
  ended: boolean
  problem: string | null
}

export interface MusicPlayerOptions {
  store: MusicStore
  /**
   * Told what really happened to a track: how much of it was heard, and whether it ended or was skipped.
   *
   * This is the only place the intelligence learns from playing. It is reported from the player rather than
   * from a button, because what matters is what the audio element did -- a track that was "played" and stalled
   * after two seconds taught nothing, and a button press would have claimed otherwise.
   */
  onListened?(trackId: string, seconds: number, duration: number, stopped: 'ended' | 'skipped', chosenBy: 'person' | 'orbis'): void
  /** Asked for the next track when the queue runs out, so AI DJ can keep going. */
  onNeedsNext?(): Promise<string | null>
  /** Where the built player page is, and the preload beside it. */
  pagePath: string
  preloadPath: string
  /** The dev server's address, when there is one. */
  devUrl?: string
  onState(state: PlaybackState & { problem: string | null }): void
}

export class MusicPlayer {
  private readonly o: MusicPlayerOptions
  private window: BrowserWindow | null = null
  private ready = false
  /** Commands asked for before the window was listening. Sent in order once it is. */
  private waiting: unknown[] = []

  private state: PlaybackState = { ...NOTHING_PLAYING }
  private problem: string | null = null
  /** Who chose what is playing. A suggestion refused means more than an own choice dropped. */
  private chosenBy: 'person' | 'orbis' = 'person'
  /** How far the current track got, so a skip can report what was actually heard. */
  private heard = 0
  /** What has been listened to of this track, so a play is counted once and only when it is deserved. */
  private counted = false
  private lastRemembered = 0
  /** The order before shuffle was turned on, so turning it off puts things back. */
  private plainOrder: string[] | null = null

  constructor(options: MusicPlayerOptions) {
    this.o = options
  }

  /**
   * Answers `orbis-audio://` from the library.
   *
   * Registered once for the whole application. Only a track the library holds, with a file Orbis has read, is served;
   * anything else gets a plain 404. There is no way to name a file here, only a track.
   */
  /**
   * Tells Chromium what kind of scheme `orbis-audio://` is. Must run before the application is ready.
   *
   * Without this a request for a track answers perfectly well and the audio element still refuses it: media needs a
   * scheme that can be streamed and ranged, and a scheme nobody declared is treated as unable to do either. The
   * symptom is "this computer cannot play this kind of audio file" for a file the computer plays fine.
   */
  static declareScheme(): void {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: AUDIO_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: false, bypassCSP: false }
      }
    ])
  }

  static serveAudio(store: MusicStore): void {
    protocol.handle(AUDIO_SCHEME, async (request) => {
      try {
        const url = new URL(request.url)
        // orbis-audio://track/<id>
        const id = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || decodeURIComponent(url.hostname)
        const track = await store.track(id)
        if (!track || !track.file || !playableOffline(track)) return new Response('', { status: 404 })
        const stat = await fs.stat(track.file).catch(() => null)
        if (!stat || !stat.isFile()) return new Response('', { status: 404 })

        /*
         * Answered here, with a length and with ranges, rather than handed straight to a file fetch.
         *
         * A response with no length leaves the audio element thinking the sound never ends: `duration` comes back
         * as Infinity, the progress bar has nothing to fill, and every seek is refused -- the track plays from the
         * start for ever and nothing says why. Saying how many bytes there are, and answering a Range request with
         * exactly those bytes, is what makes seeking work and the length honest.
         */
        const kinds: Record<string, string> = {
          mp3: 'audio/mpeg',
          m4a: 'audio/mp4',
          mp4: 'audio/mp4',
          aac: 'audio/aac',
          flac: 'audio/flac',
          ogg: 'audio/ogg',
          oga: 'audio/ogg',
          opus: 'audio/ogg',
          wav: 'audio/wav',
          wave: 'audio/wav'
        }
        const ending = track.file.split('.').pop()?.toLowerCase() ?? ''
        const type = kinds[ending] ?? 'application/octet-stream'

        const asked = request.headers.get('Range')
        const range = asked ? /^bytes=(\d*)-(\d*)$/.exec(asked.trim()) : null
        let from = 0
        let to = stat.size - 1
        if (range) {
          if (range[1]) from = Number(range[1])
          if (range[2]) to = Number(range[2])
          // "the last N bytes", which is how some players ask for a trailing tag.
          if (!range[1] && range[2]) {
            from = Math.max(0, stat.size - Number(range[2]))
            to = stat.size - 1
          }
          if (from >= stat.size || from > to) {
            return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
          }
          to = Math.min(to, stat.size - 1)
        }

        const stream = createReadStream(track.file, { start: from, end: to })
        const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
        const headers = new Headers({
          'Content-Type': type,
          'Content-Length': String(to - from + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        })
        if (range) headers.set('Content-Range', `bytes ${from}-${to}/${stat.size}`)
        return new Response(body, { status: range ? 206 : 200, headers })
      } catch {
        return new Response('', { status: 404 })
      }
    })
  }

  // ---------------------------------------------------------------- the hidden window

  private async open(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) return
    const window = new BrowserWindow({
      show: false,
      // Never shown, and never able to be: this is a speaker, not a page.
      width: 320,
      height: 120,
      webPreferences: {
        preload: this.o.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Playing needs no gesture here: the only thing that can ask is Orbis itself, acting on something somebody
        // pressed in Orbis's own interface.
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false
      }
    })
    this.window = window
    window.on('closed', () => {
      this.window = null
      this.ready = false
    })
    window.webContents.on('ipc-message', () => undefined)
    if (this.o.devUrl) await window.loadURL(`${this.o.devUrl}/player.html`)
    else await window.loadFile(this.o.pagePath)
  }

  /** Told by the main process when the player page says it is listening. */
  playerReady(): void {
    this.ready = true
    const queued = this.waiting
    this.waiting = []
    for (const command of queued) this.send(command)
    this.send({ kind: 'volume', value: this.state.volume })
    this.send({ kind: 'muted', on: this.state.muted })
  }

  /**
   * Whether a message really came from the player's own window.
   *
   * The four `music:player-*` messages are the player talking back, and until now anything in the application
   * could send them: a resume position, a finished play, a measurement the recommender is built on. The check has
   * to be against THIS window rather than the Orbis window, because this is the window that sends them.
   */
  isPlayer(contents: WebContents): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.webContents === contents
  }

  private send(command: unknown): void {
    if (!this.ready || !this.window || this.window.isDestroyed()) {
      this.waiting.push(command)
      void this.open()
      return
    }
    this.window.webContents.send('music:player-command', command)
  }

  // ---------------------------------------------------------------- what the player says

  /** Everything the audio element reports. This is the only thing that moves the state. */
  async onReport(report: PlayerReport): Promise<void> {
    const before = this.state
    this.problem = report.problem
    this.state = {
      ...before,
      owner: report.trackId ? 'orbis-music' : before.owner === 'orbis-music' ? 'none' : before.owner,
      trackId: report.trackId,
      playing: report.playing,
      position: report.position,
      // The element's own length wins once it knows it: a tag can be wrong, the audio cannot.
      duration: report.duration > 0 ? report.duration : before.duration,
      volume: report.volume,
      muted: report.muted
    }

    if (report.trackId) {
      this.heard = Math.max(this.heard, report.position)
      if (!this.counted && countsAsPlayed(report.position, this.state.duration)) {
        this.counted = true
        await this.o.store.recordPlay(report.trackId, report.position).catch(() => undefined)
      }
      const now = Date.now()
      if (now - this.lastRemembered > REMEMBER_EVERY_MS) {
        this.lastRemembered = now
        const keep = worthResuming(report.position, this.state.duration) ? report.position : 0
        await this.o.store.rememberPosition(report.trackId, keep).catch(() => undefined)
      }
    }
    this.announce()
  }

  /** A track reached its end. What happens next is decided here, from the queue. */
  async onFinished(trackId: string | null): Promise<void> {
    if (trackId) {
      // Finished means finished: nothing to carry on from next time.
      await this.o.store.rememberPosition(trackId, 0).catch(() => undefined)
      this.o.onListened?.(trackId, this.heard || this.state.duration, this.state.duration, 'ended', this.chosenBy)
    }
    let next = nextInQueue(this.state, true)
    // Nothing left in the queue: whoever is driving may have something to add -- that is what AI DJ is.
    if (!next && this.o.onNeedsNext) next = await this.o.onNeedsNext().catch(() => null)
    if (!next) {
      this.state = { ...this.state, playing: false, owner: 'none', position: 0 }
      this.announce()
      return
    }
    if (next === this.state.trackId) {
      // Repeating one: the same track again, from the start.
      this.send({ kind: 'seek', seconds: 0 })
      this.send({ kind: 'play' })
      this.counted = false
      return
    }
    await this.playTrack(next)
  }

  private announce(): void {
    this.o.onState({ ...this.state, problem: this.problem })
  }

  // ---------------------------------------------------------------- what can be asked of it

  current(): PlaybackState & { problem: string | null } {
    return { ...this.state, problem: this.problem }
  }

  /**
   * Plays one track, from the queue it is in.
   *
   * Refuses, with a reason, anything Orbis has no file for. The reason is the one a person is shown, so "no audio for
   * this one -- import your own copy" reaches the screen instead of a play button that silently does nothing.
   */
  async playTrack(trackId: string, options: { queue?: readonly string[]; from?: number; chosenBy?: 'person' | 'orbis' } = {}): Promise<{ ok: boolean; why?: string }> {
    const track = await this.o.store.track(trackId)
    if (!track) return { ok: false, why: 'That track is not in your music.' }
    const why = whyNotPlayable(track)
    if (why) {
      this.problem = why
      this.announce()
      return { ok: false, why }
    }

    const queue = options.queue ? [...options.queue] : this.state.queue.includes(trackId) ? [...this.state.queue] : [trackId]
    const ordered = this.state.shuffle && options.queue ? shuffled(queue, trackId) : queue
    if (options.queue) this.plainOrder = [...queue]
    const settings = await this.o.store.settings()
    const at = options.from ?? (settings.resume ? (track.position ?? 0) : 0)

    // Whatever was playing has been cut short: that is a skip, and what was heard of it is what it taught.
    if (this.state.trackId && this.state.trackId !== trackId && this.state.position > 0) {
      this.o.onListened?.(this.state.trackId, this.heard, this.state.duration, 'skipped', this.chosenBy)
    }
    this.counted = false
    this.heard = 0
    this.chosenBy = options.chosenBy ?? 'person'
    this.state = {
      ...this.state,
      owner: 'orbis-music',
      trackId,
      queue: ordered,
      at: ordered.indexOf(trackId),
      // What the file said, until the element says otherwise.
      duration: track.duration,
      position: at,
      playing: false
    }
    this.problem = null
    await this.open()
    this.send({ kind: 'load', trackId, at: worthResuming(at, track.duration) ? at : 0 })
    this.announce()
    return { ok: true }
  }

  /** Plays a list of tracks in order, starting with the first that can actually be played. */
  async playAll(trackIds: readonly string[], startAt = 0, chosenBy: 'person' | 'orbis' = 'person'): Promise<{ ok: boolean; why?: string }> {
    const playable: string[] = []
    for (const id of trackIds) {
      const track = await this.o.store.track(id)
      if (track && playableOffline(track)) playable.push(id)
    }
    if (playable.length === 0) {
      const why = trackIds.length ? 'None of those tracks has audio on this computer yet.' : 'There is nothing to play.'
      this.problem = why
      this.announce()
      return { ok: false, why }
    }
    const first = playable[Math.min(Math.max(startAt, 0), playable.length - 1)]
    return this.playTrack(first, { queue: playable, chosenBy })
  }

  play(): void {
    if (!this.state.trackId) return
    this.send({ kind: 'play' })
  }

  pause(): void {
    this.send({ kind: 'pause' })
  }

  toggle(): void {
    if (this.state.playing) this.pause()
    else this.play()
  }

  async next(): Promise<void> {
    const id = nextInQueue(this.state, false)
    if (id && id !== this.state.trackId) await this.playTrack(id)
    else {
      this.pause()
      this.send({ kind: 'seek', seconds: 0 })
    }
  }

  async previous(): Promise<void> {
    // The usual expectation: near the start of a track, go back; well into it, start this one again.
    if (this.state.position > 5) {
      this.send({ kind: 'seek', seconds: 0 })
      return
    }
    const id = previousInQueue(this.state)
    if (id && id !== this.state.trackId) await this.playTrack(id)
    else this.send({ kind: 'seek', seconds: 0 })
  }

  seek(seconds: number): void {
    this.send({ kind: 'seek', seconds })
  }

  async setVolume(value: number): Promise<void> {
    const volume = Math.max(0, Math.min(1, value))
    this.state = { ...this.state, volume }
    this.send({ kind: 'volume', value: volume })
    await this.o.store.saveSettings({ volume }).catch(() => undefined)
    this.announce()
  }

  setMuted(on: boolean): void {
    this.state = { ...this.state, muted: on }
    this.send({ kind: 'muted', on })
    this.announce()
  }

  /** Turning shuffle on reorders what is left; turning it off puts the original order back. */
  async setShuffle(on: boolean): Promise<void> {
    if (on === this.state.shuffle) return
    if (on) {
      this.plainOrder = [...this.state.queue]
      const order = shuffled(this.state.queue, this.state.trackId)
      this.state = { ...this.state, shuffle: true, queue: order, at: this.state.trackId ? order.indexOf(this.state.trackId) : -1 }
    } else {
      const order = this.plainOrder && this.plainOrder.length === this.state.queue.length ? this.plainOrder : [...this.state.queue]
      this.state = { ...this.state, shuffle: false, queue: order, at: this.state.trackId ? order.indexOf(this.state.trackId) : -1 }
    }
    await this.o.store.saveSettings({ shuffle: on }).catch(() => undefined)
    this.announce()
  }

  async setRepeat(mode: RepeatMode): Promise<void> {
    this.state = { ...this.state, repeat: mode }
    await this.o.store.saveSettings({ repeat: mode }).catch(() => undefined)
    this.announce()
  }

  queueNext(trackIds: readonly string[]): void {
    const { queue, at } = playNext(this.state, trackIds)
    this.state = { ...this.state, queue, at }
    this.announce()
  }

  queueEnd(trackIds: readonly string[]): void {
    const { queue, at } = addToQueue(this.state, trackIds)
    this.state = { ...this.state, queue, at }
    this.announce()
  }

  queueRemove(index: number): void {
    const { queue, at } = removeFromQueue(this.state, index)
    this.state = { ...this.state, queue, at }
    this.announce()
  }

  queueReorder(from: number, to: number): void {
    const { queue, at } = reorderQueue(this.state, from, to)
    this.state = { ...this.state, queue, at }
    this.announce()
  }

  queueClear(): void {
    this.state = { ...this.state, queue: this.state.trackId ? [this.state.trackId] : [], at: this.state.trackId ? 0 : -1 }
    this.announce()
  }

  /** The tracks in the queue, in order, as the library holds them. */
  async queueTracks(): Promise<Awaited<ReturnType<MusicStore['all']>>> {
    const library = await this.o.store.all()
    const byId = new Map(library.map((track) => [track.id, track]))
    return this.state.queue.map((id) => byId.get(id)).filter((track): track is NonNullable<typeof track> => Boolean(track))
  }

  /**
   * Asks the player window to listen to a track and say what it is like.
   *
   * Nothing to do with playing it: the window decodes the file separately and the answer arrives through the
   * `music:player-measured` message. Asked for one track at a time, when nothing else is going on, because decoding
   * a file is the most expensive thing Orbis Music does.
   */
  measure(trackId: string): void {
    this.send({ kind: 'measure', trackId })
  }

  /** Stops, lets go of the audio, and says the sound is nobody's. */
  stop(): void {
    this.send({ kind: 'stop' })
    this.state = { ...NOTHING_PLAYING, volume: this.state.volume, muted: this.state.muted, shuffle: this.state.shuffle, repeat: this.state.repeat }
    this.problem = null
    this.announce()
  }

  /** Says a website's player has the sound now, without touching that player. */
  websiteHasSound(yes: boolean): void {
    const owner: PlaybackOwner = yes ? 'website' : this.state.trackId ? 'orbis-music' : 'none'
    if (owner === this.state.owner) return
    this.state = { ...this.state, owner }
    this.announce()
  }

  /** Puts back the volume, shuffle and repeat somebody chose last time. Does not start playing. */
  async restoreSettings(): Promise<void> {
    const settings = await this.o.store.settings()
    this.state = { ...this.state, volume: settings.volume, shuffle: settings.shuffle, repeat: settings.repeat }
    this.send({ kind: 'volume', value: settings.volume })
    this.announce()
  }

  /** Writes down where the current track got to, and closes the hidden window. */
  async shutdown(): Promise<void> {
    if (this.state.trackId) {
      const keep = worthResuming(this.state.position, this.state.duration) ? this.state.position : 0
      await this.o.store.rememberPosition(this.state.trackId, keep).catch(() => undefined)
    }
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
    this.ready = false
  }
}

/** Where the built player page and its bridge are, in a packaged app and in development. */
export const playerPaths = (dirname: string): { pagePath: string; preloadPath: string } => ({
  pagePath: join(dirname, '../renderer/player.html'),
  preloadPath: join(dirname, '../preload/player.js')
})
