import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { MusicLibrary, type ImportResult, type ScanProgress } from './library.ts'
import { MusicPlayer, playerPaths, type PlayerReport } from './player.ts'
import { MusicStore, type MusicSettings } from './store.ts'
import { MusicRecogniser, sightingFrom, type MusicNow, type NowPlaying } from './recognise.ts'
import type { MusicPortShape } from '../../shared/musicPort.ts'
import { MusicEngine } from './engine.ts'
import { MusicPlatform } from './platform.ts'
import { MusicMigrate } from './migrate.ts'
import { MusicMigrateStore, type MigrateSettings } from './migrateStore.ts'
import { MusicTokens } from './tokens.ts'
import { electronPlatform } from '../platformElectron.ts'
import type { DiscoveryLevel } from '../../shared/music/config.ts'
import type { ListeningIntent } from '../../shared/music/intent.ts'
import type { TasteDimension } from '../../shared/music/taste.ts'
import type { QueueEntry } from '../../shared/music/sequence.ts'
import { playableOffline, type LibraryQuery, type OrbisTrack, type PlaybackState, type TrackNames } from '../../shared/music.ts'

/**
 * Orbis Music, as one thing the rest of Orbis can hold.
 *
 * The library, the player and the places music can be asked about all read the same state from here. There is one
 * store, one player and one queue; the browser's panel, the new-tab page, Orion and the window are all views of this
 * and none of them keeps playback state of its own. That is the whole reason this file exists: four surfaces each
 * holding their own idea of what is playing is how two of them end up disagreeing.
 *
 * ## One channel
 *
 * Everything the window can ask goes through `music:do`, the way notifications and Pages already work: one place the
 * sender is checked, one place an operation is refused, one line in the mapping. Nothing here can be asked to play a
 * file by path -- only a track the library already holds, by id.
 */

export interface MusicHandle {
  store: MusicStore
  library: MusicLibrary
  player: MusicPlayer
  /** What Orbis currently thinks is playing in the browser, and what it is. Null until the browser exists. */
  recogniser: MusicRecogniser | null
  /** The music intelligence: what somebody likes, what should come next, and what it learned. */
  engine: MusicEngine
  /**
   * Searching, and knowing whether something is already here.
   *
   * Kept apart from the engine because they answer different questions: the engine decides what to play next, this
   * decides what exists and whether Orbis has it.
   */
  platform: MusicPlatform
  /**
   * Bringing a library in from somewhere else.
   *
   * Kept apart from the library because importing is a different act from scanning a folder: it reads somebody
   * else's playlists, matches them against what is here, and changes nothing until the plan has been seen.
   */
  migrate: MusicMigrate
  /**
   * The few things the operations need that live with playing rather than with the engine.
   *
   * Kept behind a handle rather than exported as loose state, so there is one owner of whether the DJ is on.
   */
  intel: {
    /** What was played lately, newest first: what the engine must not offer again straight away. */
    recent(): readonly string[]
    /** Whether Orbis keeps choosing once the queue runs out. */
    dj(): boolean
    setDj(on: boolean): void
    /** Tells every surface the player changed. */
    announce(): void
  }
  /** Lends the recogniser the browser, once there is one. Called when the browser starts. */
  watchBrowser(browser: BrowserWatch): void
  /** Looks at what is playing now. `force` is somebody pressing "work out what this is". */
  look(options?: { force?: boolean; tabId?: string }): Promise<MusicNow>
  heard(): MusicNow
  /** Everything a surface needs to draw the player, in one answer. */
  snapshot(): Promise<MusicSnapshot>
  /** What the browser's panel and the new-tab page are lent. */
  port: MusicPort
  useProfile(profileId: string): Promise<void>
  flush(): Promise<void>
  shutdown(): Promise<void>
  /**
   * Lends the one set of operations to whoever else may ask.
   *
   * Two things ask Orbis Music to do something: the Orbis window, over IPC, and the browser's own panel, over the
   * helper. Both must mean exactly the same thing by "play this" or "surprise me", so there is one runner and two
   * doors to it rather than two switches that drift apart.
   *
   * Handed in after construction because the runner needs the window's picker, which does not exist yet when the
   * service is built.
   */
  useOperations(run: (op: string, a?: unknown, b?: unknown, c?: unknown) => Promise<unknown>): void
  /** Asks for an operation. Throws until the runner has been lent, which is during start-up only. */
  ask(op: string, a?: unknown, b?: unknown, c?: unknown): Promise<unknown>
}

export interface MusicSnapshot {
  playback: PlaybackState & { problem: string | null }
  /** The track playing now, as the library holds it. Null when nothing of Orbis's is playing. */
  track: OrbisTrack | null
  queue: OrbisTrack[]
  settings: MusicSettings
  summary: Awaited<ReturnType<MusicStore['summary']>>
}

/** What the browser side may do with music: the shape declared in shared, so the two halves cannot drift. */
export type MusicPort = MusicPortShape

/**
 * What the recogniser needs of the browser.
 *
 * Lent rather than imported, because the browser may not be running: with nothing lent, recognition answers "nothing
 * is playing" instead of pretending. Each of these is an existing capability of the control layer -- reading what a
 * page published, taking a picture of a tab, listing the tabs with sound -- so recognition adds no new way of
 * reaching a page.
 */
export interface BrowserWatch {
  tabs(): { id: string; url?: string; title?: string; audible?: boolean; active?: boolean }[]
  nowPlaying(tabId?: string): Promise<NowPlaying | null>
  picture(tabId?: string): Promise<string | null>
  askVision(prompt: string, picture: string): Promise<string | null>
}

export interface MusicServiceOptions {
  userData: string
  /**
   * Opens the Orbis window's own file picker. Returns what was chosen, or nothing when it was cancelled.
   *
   * Handed in rather than called from here so this file knows nothing about windows or dialogs -- and so the one
   * place a path can enter Orbis Music is a picker a person stood in front of.
   */
  pickFiles?(kind: 'files' | 'folder'): Promise<string[]>
  /** Told how an import is going, so a surface can show real progress. */
  onProgress?(progress: ScanProgress): void
  dirname: string
  devUrl?: string
  getWindow(): BrowserWindow | null
  /** Sends an event to the Orbis window. */
  send(channel: string, ...args: unknown[]): void
  /** Lets the browser side know something changed, so a panel can redraw without asking. */
  onChanged?(snapshot: MusicSnapshot): void
  /** Told when what Orbis thinks is playing in the browser changes, so the panel can redraw. */
  onHeard?(state: MusicNow): void
}

/** Checks an argument is a string that could be an id. Nothing here trusts what it is handed. */
const id = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null)
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.length <= 64).slice(0, 2000) : [])
/** File paths, which are far longer than ids: checking them with the id rule silently refused every real path. */
const paths = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.length > 0 && one.length <= 4096).slice(0, 2000) : []

const number = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

const names = (value: unknown): TrackNames | null => {
  if (!value || typeof value !== 'object') return null
  const one = value as Record<string, unknown>
  const title = typeof one.title === 'string' ? one.title.trim().slice(0, 200) : ''
  if (!title) return null
  return {
    title,
    artist: typeof one.artist === 'string' ? one.artist.trim().slice(0, 200) : '',
    album: typeof one.album === 'string' ? one.album.trim().slice(0, 200) : ''
  }
}

export function createMusic(options: MusicServiceOptions): MusicHandle {
  const store = new MusicStore(options.userData)
  const library = new MusicLibrary(store)
  const { pagePath, preloadPath } = playerPaths(options.dirname)

  const snapshot = async (): Promise<MusicSnapshot> => {
    const playback = player.current()
    const [track, queue, settings, summary] = await Promise.all([
      playback.trackId ? store.track(playback.trackId) : Promise.resolve(null),
      player.queueTracks(),
      store.settings(),
      store.summary()
    ])
    return { playback, track, queue, settings, summary }
  }

  const announce = (): void => {
    void snapshot()
      .then((state) => {
        options.send('music:changed', state)
        options.onChanged?.(state)
      })
      .catch(() => undefined)
  }

  /*
   * The intelligence, and the loop that closes it.
   *
   * The player reports what the audio element actually did; that is the only thing the models learn from. When
   * the queue runs out and AI DJ is on, the engine is asked for the next track -- which is what makes it a DJ
   * rather than a playlist.
   */
  let dj = false
  const recentlyPlayed: string[] = []
  let operations: ((op: string, a?: unknown, b?: unknown, c?: unknown) => Promise<unknown>) | null = null
  const engine = new MusicEngine({
    store,
    measure: (trackId) => player.measure(trackId)
  })
  const platform = new MusicPlatform({ tracks: () => store.search({}) })

  const migrateStore = new MusicMigrateStore(options.userData)
  const tokens = new MusicTokens(options.userData, electronPlatform().secrets)
  const migrate = new MusicMigrate({
    store: migrateStore,
    tokens,
    tracks: () => store.search({}),
    playlists: () => store.lists(),
    createPlaylist: (name, trackIds) => store.createList(name, [...trackIds]),
    setPlaylistTracks: (playlistId, trackIds) => store.setListTracks(playlistId, trackIds),
    // Whether a service is set up is a settings question, and the answer is honest: today none of them is.
    configured: () => false,
    pickFiles: async (kind) => (options.pickFiles ? options.pickFiles(kind) : []),
    now: () => Date.now(),
    announce: () => announce()
  })

  const player = new MusicPlayer({
    store,
    pagePath,
    preloadPath,
    devUrl: options.devUrl,
    onState: () => announce(),
    onListened: (trackId, seconds, duration, stopped, chosenBy) => {
      engine.observeListen(trackId, seconds, duration, stopped, chosenBy)
      recentlyPlayed.unshift(trackId)
      recentlyPlayed.length = Math.min(recentlyPlayed.length, 60)
      // Measuring is done when nothing else is happening, and a track just ending is exactly that moment.
      engine.measureSomething()
      announce()
    },
    onNeedsNext: async () => {
      if (!dj) return null
      const planned = engine.plan({ currentTrackId: player.current().trackId, recentTrackIds: recentlyPlayed, length: 1 })
      return planned.tracks[0]?.track.id ?? null
    }
  })

  // The audio scheme, answered from the library. Registered once, for the whole application.
  MusicPlayer.serveAudio(store)

  store.onChange(() => {
    announce()
    // The engine works from features, so a library that has changed is a library it has to look at again.
    void engine.refreshLibrary()
  })

  /*
   * What the hidden player says.
   *
   * The comment here used to read "These are the only three messages it can send, and only it can send them." There
   * are four, and nothing made the second half true: none of them checked the sender, so anything in the
   * application could have sent all four. `player-report` carries the position a track resumes from,
   * `player-finished` is what counts a play, and `player-measured` hands over what the recommender is built on --
   * where a null measurement puts a track in an `unmeasurable` set it never leaves for the life of the process.
   *
   * The check is against the player's own window, not the Orbis window, because the player is what sends them.
   */
  const fromPlayer = (event: { sender: WebContents }): boolean => player.isPlayer(event.sender)
  ipcMain.on('music:player-ready', (event) => {
    if (fromPlayer(event)) player.playerReady()
  })
  ipcMain.on('music:player-report', (event, report: unknown) => {
    if (!fromPlayer(event)) return
    if (report && typeof report === 'object') void player.onReport(report as PlayerReport)
  })
  ipcMain.on('music:player-finished', (event, trackId: unknown) => {
    if (!fromPlayer(event)) return
    void player.onFinished(typeof trackId === 'string' ? trackId : null)
  })
  ipcMain.on('music:player-measured', (event, trackId: unknown, features: unknown, problem: unknown) => {
    if (!fromPlayer(event)) return
    if (typeof trackId !== 'string') return
    // Measured from the audio or not measured at all: there is no third answer, and no defaults are filled in.
    const measured = features && typeof features === 'object' ? { ...(features as Record<string, number>), measuredAt: Date.now(), version: 1 } : null
    engine.onMeasured(trackId, measured as never, typeof problem === 'string' ? problem : null)
  })

  /*
   * Recognising what is playing in the browser.
   *
   * The browser is lent in later, because it may not be running at all. Until it is, this answers "nothing is
   * playing", which is the truth rather than a blank waiting to be filled in.
   */
  let watch: BrowserWatch | null = null
  let heardNow: MusicNow = { sighting: null, recognition: null, working: false, inLibraryId: null }
  const recogniser = new MusicRecogniser({
    store,
    nowPlaying: async (tabId) => (watch ? watch.nowPlaying(tabId) : null),
    picture: async (tabId) => (watch ? watch.picture(tabId) : null),
    askVision: async (prompt, picture) => (watch ? watch.askVision(prompt, picture) : null),
    sounds: async () => {
      if (!watch) return []
      const tabs = watch.tabs()
      // Only the tabs that are actually making a sound, and at most a few: reading a page costs a round trip.
      const sounding = tabs.filter((tab) => tab.audible).slice(0, 4)
      const looked = sounding.length > 0 ? sounding : tabs.filter((tab) => tab.active).slice(0, 1)
      const out = []
      for (const tab of looked) {
        const reading = await watch.nowPlaying(tab.id).catch(() => null)
        out.push(sightingFrom(tab, reading))
      }
      return out
    },
    onChange: (state) => {
      heardNow = state
      options.send('music:heard', state)
      options.onHeard?.(state)
    }
  })

  const port: MusicPort = {
    snapshot,
    // What Orbis thinks is playing in the browser, and looking again when somebody asks.
    heard: () => heardNow,
    look: (lookOptions) => recogniser.look(lookOptions),
    search: (query) => store.search(query),
    // The same runner the window reaches. Lent during start-up, so this throws until then rather than lying.
    ask: async (op, b, c, d) => {
      if (!operations) throw new Error("Orbis Music is still starting up.")
      return operations(op, b, c, d)
    },
    albums: () => store.albums(),
    artists: () => store.artists(),
    genres: () => store.genres(),
    playlists: () => store.lists(),
    playlistTracks: (listId) => store.listTracks(listId),
    recentlyPlayed: () => store.recentlyPlayed(),
    recognised: () => store.recognisedList(),
    play: (trackId) => player.playTrack(trackId),
    playAll: (trackIds, startAt) => player.playAll(trackIds, startAt),
    playPlaylist: async (listId) => {
      const tracks = await store.listTracks(listId)
      if (tracks.length === 0) return { ok: false, why: 'That playlist has nothing in it.' }
      return player.playAll(tracks.map((track) => track.id))
    },
    pause: () => player.pause(),
    resume: () => player.play(),
    toggle: () => player.toggle(),
    next: () => player.next(),
    previous: () => player.previous(),
    seek: (seconds) => player.seek(seconds),
    volume: (value) => player.setVolume(value),
    mute: (on) => player.setMuted(on),
    shuffle: (on) => player.setShuffle(on),
    repeat: (mode) => player.setRepeat(mode),
    queueNext: (trackIds) => player.queueNext(trackIds),
    queueEnd: (trackIds) => player.queueEnd(trackIds),
    queueRemove: (index) => player.queueRemove(index),
    queueReorder: (from, to) => player.queueReorder(from, to),
    queueClear: () => player.queueClear(),
    favourite: (trackId, on) => store.setFavourite(trackId, on),
    createPlaylist: (name) => store.createList(name),
    addToPlaylist: (listId, trackIds) => store.addToList(listId, trackIds),
    removeFromPlaylist: (listId, trackId) => store.removeFromList(listId, trackId),
    addHeard: (heard, duration, source) => library.addHeard(heard, duration, source),
    /*
     * Bringing files in, through the window's own picker.
     *
     * The browser can ask for this and never learns a path: the dialog belongs to the Orbis window, and what comes
     * back is how many files were read. Every one of them is opened and understood before anything is added.
     */
    importFiles: async () => {
      if (!options.pickFiles) return { done: 0, total: 0, added: 0, already: 0, failed: 0, why: 'There is no way to choose files from here.' }
      const chosen = await options.pickFiles('files')
      if (chosen.length === 0) return { done: 0, total: 0, added: 0, already: 0, failed: 0 }
      return library.importFiles(chosen, options.onProgress)
    },
    scanFolder: async () => {
      if (!options.pickFiles) return { done: 0, total: 0, added: 0, already: 0, failed: 0, why: 'There is no way to choose a folder from here.' }
      const chosen = await options.pickFiles('folder')
      if (chosen.length === 0) return { done: 0, total: 0, added: 0, already: 0, failed: 0 }
      const settings = await store.settings()
      if (!settings.folders.includes(chosen[0])) await store.saveSettings({ folders: [...settings.folders, chosen[0]].slice(0, 20) })
      return library.scanFolder(chosen[0], options.onProgress)
    },
    settings: () => store.settings(),
    saveSettings: (patch) => store.saveSettings(patch)
  }

  return {
    store,
    library,
    player,
    snapshot,
    port,
    recogniser,
    engine,
    platform,
    migrate,
    useOperations: (run) => {
      operations = run
    },
    ask: async (op, a, b, c) => {
      if (!operations) throw new Error('Orbis Music is still starting up.')
      return operations(op, a, b, c)
    },
    intel: {
      recent: () => recentlyPlayed,
      dj: () => dj,
      setDj: (on) => {
        dj = on
      },
      announce
    },
    watchBrowser: (browser) => {
      watch = browser
    },
    look: (lookOptions) => recogniser.look(lookOptions),
    heard: () => heardNow,
    useProfile: async (profileId) => {
      // Another profile is another library, so whatever was playing is nobody's business here.
      player.stop()
      // Another profile is another library, and another person: nothing of either carries over.
      recogniser.forget()
      recentlyPlayed.length = 0
      dj = false
      await store.useProfile(profileId)
      // Another profile is another person's connections and another person's import history.
      await migrateStore.useProfile(profileId)
      await tokens.useProfile(profileId)
      await engine.useProfile()
      await player.restoreSettings()
      announce()
    },
    flush: async () => {
      await engine.save()
      await store.flush()
      await migrateStore.flush()
    },
    shutdown: async () => {
      await player.shutdown()
      await engine.save()
      await store.flush()
      await migrateStore.flush()
    }
  }
}

/**
 * The window's one way in.
 *
 * `op` names what to do and the arguments are checked here, not trusted. Nothing in this list can name a file: the
 * two that deal with files -- importing and deleting -- take the paths the operating system's own picker returned, or
 * a track id, and are the only ones that touch a disk.
 */
export function registerMusicIpc(o: {
  music: MusicHandle
  /** Orbis’s own data folder, so a drop cannot point the library at it. */
  userData: string
  getWindow(): BrowserWindow | null
  /** Asks the operating system for files, through the picker Orbis already uses. */
  pickFiles(kind: 'files' | 'folder'): Promise<string[]>
  onProgress(progress: ScanProgress): void
}): void {
  const { music } = o
  const mine = (event: IpcMainInvokeEvent): boolean => event.sender === o.getWindow()?.webContents

  /**
   * The one place an operation is decided.
   *
   * The IPC handler checks the sender and then calls this; the browser's panel reaches the same function through
   * the music port. Nothing about what an operation *means* lives in either door.
   */
  const run = async (op: unknown, a?: unknown, b?: unknown, c?: unknown): Promise<unknown> => {
    const { port, store, library, player } = music
    switch (op) {
      // ---------------------------------------------------------------- looking
      case 'state':
        return music.snapshot()
      // ---------------------------------------------------------------- finding music
      case 'find':
        /*
         * A search, read the way it was asked.
         *
         * A name is looked up and a description becomes constraints. What comes back says which providers answered
         * and which could not, so a search with nowhere to look says so rather than looking like an empty library.
         */
        return music.platform.search(typeof a === 'string' ? a.slice(0, 300) : '', { limit: typeof b === 'number' ? Math.min(200, Math.max(1, b)) : 60 })
      case 'sources':
        return music.platform.sources()
      case 'check': {
        // Before adding: is this already here, and in what sense?
        const heard = names(a)
        if (!heard) return { verdict: 'new-track', why: 'Orbis does not know what that track is.', offer: [] }
        return music.platform.check({ ...heard, duration: typeof b === 'number' ? b : null })
      }
      case 'versions':
        return id(a) ? music.platform.versionsOf(a as string) : []
      case 'canonical':
        return id(a) ? music.platform.canonical(a as string) : null
      case 'explorations': {
        const { EXPLORATIONS } = await import('../../shared/music/search.ts')
        return EXPLORATIONS
      }
      case 'explore': {
        /*
         * One of the named ways of exploring.
         *
         * Each is a real set of constraints handed to the engine, not a label on a shuffle -- "surprise me" means
         * high novelty with the taste model still enforced, which is a different thing from random.
         */
        const { explorationById } = await import('../../shared/music/search.ts')
        const chosen = explorationById(typeof a === 'string' ? a : '')
        if (!chosen) return { ok: false, why: 'Orbis does not know that one.' }
        music.engine.setConstraints(chosen.intent, chosen.constraints as never, 'session')
        const planned = music.engine.plan({ currentTrackId: player.current().trackId, recentTrackIds: music.intel.recent(), length: 8 })
        const ids = planned.tracks.map((one) => one.track.id)
        if (ids.length === 0) return { ok: false, why: 'There is not enough in your music for that yet.', label: chosen.label }
        const outcome = await player.playAll(ids, 0, 'orbis')
        music.intel.announce()
        return { ...outcome, label: chosen.label, because: chosen.blurb }
      }
      case 'search':
        return port.search((a && typeof a === 'object' ? a : {}) as LibraryQuery)
      case 'albums':
        return port.albums()
      case 'artists':
        return port.artists()
      case 'genres':
        return port.genres()
      case 'playlists':
        return port.playlists()
      case 'playlist-tracks':
        return id(a) ? port.playlistTracks(id(a)!) : []
      case 'recently-played':
        return port.recentlyPlayed()
      case 'recognised':
        return port.recognised()
      case 'heard':
        // What Orbis currently thinks is playing in the browser. Never a guess: see `recognise.ts`.
        return music.heard()
      case 'listen':
        // Somebody pressed "work out what this is".
        return music.look({ force: true, tabId: typeof a === 'string' ? a : undefined })
      case 'duplicates':
        return library.duplicates()
      case 'settings':
        return port.settings()

      // ---------------------------------------------------------------- playing
      case 'play':
        return id(a) ? port.play(id(a)!) : { ok: false, why: 'That is not a track.' }
      case 'play-all':
        return port.playAll(ids(a), number(b, 0))
      case 'play-playlist':
        return id(a) ? port.playPlaylist(id(a)!) : { ok: false, why: 'That is not a playlist.' }
      case 'pause':
        port.pause()
        return true
      case 'resume':
        port.resume()
        return true
      case 'toggle':
        port.toggle()
        return true
      case 'next':
        await port.next()
        return true
      case 'previous':
        await port.previous()
        return true
      case 'seek':
        port.seek(number(a))
        return true
      case 'volume':
        await port.volume(number(a, 1))
        return true
      case 'mute':
        port.mute(a === true)
        return true
      case 'shuffle':
        await port.shuffle(a === true)
        return true
      case 'repeat':
        await port.repeat(a === 'all' || a === 'one' ? a : 'off')
        return true
      case 'stop':
        player.stop()
        return true

      // ---------------------------------------------------------------- the queue
      case 'queue-next':
        port.queueNext(ids(a))
        return true
      case 'queue-end':
        port.queueEnd(ids(a))
        return true
      case 'queue-remove':
        port.queueRemove(number(a, -1))
        return true
      case 'queue-reorder':
        port.queueReorder(number(a, -1), number(b, -1))
        return true
      case 'queue-clear':
        port.queueClear()
        return true

      // ---------------------------------------------------------------- the library
      case 'favourite':
        return id(a) ? port.favourite(id(a)!, b === true) : null
      case 'edit':
        return id(a) && b && typeof b === 'object' ? store.update(id(a)!, b as Partial<OrbisTrack>, true) : null
      case 'remove':
        // Out of the library. The file is left exactly where it is.
        return id(a) ? store.remove(id(a)!) : false
      case 'delete-file':
        // A different act entirely, and only ever reached from a confirmation that says so in those words.
        return id(a) ? library.deleteFile(id(a)!) : { ok: false, why: 'That is not a track.' }
      case 'relink': {
        const trackId = id(a)
        if (!trackId) return { kind: 'failed', file: '', why: 'That is not a track.' }
        const chosen = await o.pickFiles('files')
        if (chosen.length === 0) return { kind: 'failed', file: '', why: 'No file was chosen.' }
        return library.relink(trackId, chosen[0])
      }
      case 'replacements':
        return id(a) ? library.findReplacements(id(a)!) : []
      case 'check-files':
        return library.checkFiles()

      // ---------------------------------------------------------------- playlists
      case 'create-playlist':
        return typeof a === 'string' && a.trim() ? store.createList(a.trim().slice(0, 200), ids(b)) : null
      case 'rename-playlist':
        return id(a) && typeof b === 'string' ? store.renameList(id(a)!, b.trim().slice(0, 200)) : null
      case 'remove-playlist':
        return id(a) ? store.removeList(id(a)!) : false
      case 'add-to-playlist':
        return id(a) ? store.addToList(id(a)!, ids(b)) : null
      case 'remove-from-playlist':
        return id(a) && id(b) ? store.removeFromList(id(a)!, id(b)!) : null
      case 'reorder-playlist':
        return id(a) ? store.reorderList(id(a)!, number(b, -1), number(c, -1)) : null

      // ---------------------------------------------------------------- bringing music in
      case 'import': {
        const chosen = await o.pickFiles('files')
        if (chosen.length === 0) return { done: 0, total: 0, added: 0, already: 0, failed: 0, results: [] as ImportResult[] }
        return library.importFiles(chosen, o.onProgress)
      }
      case 'import-paths':
        // Dragged in: the paths are the ones the drop gave, and each is read before anything is added.
        return library.importFiles(paths(a).filter((path) => MusicLibrary.sensiblePath(path, o.userData)), o.onProgress)
      case 'scan': {
        const chosen = typeof a === 'string' && a ? [a] : await o.pickFiles('folder')
        if (chosen.length === 0) return null
        const settings = await store.settings()
        if (!settings.folders.includes(chosen[0])) await store.saveSettings({ folders: [...settings.folders, chosen[0]].slice(0, 20) })
        return library.scanFolder(chosen[0], o.onProgress)
      }
      case 'stop-scan':
        return library.stopScan()
      case 'add-heard': {
        const heard = names(a)
        if (!heard) return { kind: 'refused', why: 'Orbis does not know what that track is.' }
        const source = b && typeof b === 'object' ? (b as { provider?: string; url?: string }) : {}
        return port.addHeard(heard, number(c, 0), { provider: String(source.provider ?? 'unknown').slice(0, 80), url: typeof source.url === 'string' ? source.url.slice(0, 2048) : undefined })
      }

      // ---------------------------------------------------------------- settings and clearing out
      // ---------------------------------------------------------------- the intelligence
      case 'plan': {
        /*
         * What should come next, and why.
         *
         * `said` is whatever somebody typed or spoke, read for constraints. Anything in it Orbis could not read
         * comes back as `notUnderstood` so the interface can say so rather than quietly doing something else.
         */
        const planned = music.engine.plan({
          currentTrackId: player.current().trackId,
          recentTrackIds: music.intel.recent(),
          length: typeof a === 'number' ? Math.min(12, Math.max(1, a)) : 1,
          said: typeof b === 'string' ? b.slice(0, 300) : undefined
        })
        // The ids are turned back into rows here: the engine deals in features, the interface in tracks.
        const rows = await Promise.all(planned.tracks.map((one) => store.track(one.track.id)))
        return {
          ...planned,
          tracks: planned.tracks.map((one, index) => ({ ...one, track: rows[index] })).filter((one) => one.track)
        }
      }
      case 'play-next-suggestion': {
        const planned = music.engine.plan({ currentTrackId: player.current().trackId, recentTrackIds: music.intel.recent(), length: 1 })
        const next = planned.tracks[0]
        if (!next) return { ok: false, why: 'Orbis has nothing to suggest from your music yet.' }
        return player.playTrack(next.track.id, { chosenBy: 'orbis' })
      }
      case 'dj': {
        music.intel.setDj(a === true)
        if (music.intel.dj()) {
          // Starting the DJ fills the queue from here on, and starts playing if nothing is.
          const planned = music.engine.plan({ currentTrackId: player.current().trackId, recentTrackIds: music.intel.recent(), length: 5 })
          const ids = planned.tracks.map((one) => one.track.id)
          if (ids.length === 0) {
            music.intel.setDj(false)
            return { ok: false, why: 'There is not enough in your music for Orbis to choose from yet.' }
          }
          if (!player.current().trackId) await player.playAll(ids, 0, 'orbis')
          else player.queueEnd(ids.slice(0, 4))
        }
        music.intel.announce()
        return { ok: true, dj: music.intel.dj() }
      }
      case 'radio': {
        /*
         * A station that keeps going, built around whatever it was started from.
         *
         * The same machinery as everything else: a seed, a strategy, and a planned run. It differs from a playlist
         * only in that it is never finished -- the DJ keeps it going.
         */
        const seed = id(a)
        if (seed) {
          const planned = music.engine.plan({ currentTrackId: seed, recentTrackIds: music.intel.recent(), length: 6 })
          const outcome = await player.playAll([seed, ...planned.tracks.map((one) => one.track.id)], 0, 'person')
          music.intel.setDj(outcome.ok)
          music.intel.announce()
          return outcome
        }
        const planned = music.engine.plan({ currentTrackId: null, recentTrackIds: music.intel.recent(), length: 8 })
        const ids = planned.tracks.map((one) => one.track.id)
        if (ids.length === 0) return { ok: false, why: 'There is nothing in your music to build a station from yet.' }
        const outcome = await player.playAll(ids, 0, 'orbis')
        music.intel.setDj(outcome.ok)
        music.intel.announce()
        return outcome
      }
      case 'make-playlist': {
        /*
         * A playlist from a description, with the constraints actually enforced.
         *
         * If there are not enough tracks to satisfy what was asked, that is said plainly with the numbers rather
         * than quietly handed over short.
         */
        const said = typeof a === 'string' ? a.slice(0, 300) : ''
        if (!said.trim()) return { ok: false, why: 'Say what the playlist should be.' }
        const request = music.engine.request(said)
        const wanted = request.intent.constraints.count ?? (request.intent.constraints.duration ? Math.ceil(request.intent.constraints.duration / 240) : 20)
        const enough = music.engine.enoughFor(request.intent.constraints)
        const planned = music.engine.plan({ currentTrackId: null, recentTrackIds: [], length: Math.min(12, wanted) })
        // Longer than one planned run: the run is extended, each time from where the last one ended.
        const ids: string[] = planned.tracks.map((one) => one.track.id)
        while (ids.length < wanted && ids.length > 0) {
          const more = music.engine.plan({ currentTrackId: ids[ids.length - 1], recentTrackIds: ids, length: Math.min(12, wanted - ids.length), exclude: ids })
          const added = more.tracks.map((one) => one.track.id).filter((one) => !ids.includes(one))
          if (added.length === 0) break
          ids.push(...added)
        }
        if (ids.length === 0) {
          return { ok: false, why: 'Nothing in your music matches that yet.', notUnderstood: request.notUnderstood, found: enough.found }
        }
        const list = await store.createList(said.slice(0, 80), ids)
        return {
          ok: true,
          playlist: list,
          asked: wanted,
          made: ids.length,
          // Said plainly when it could not be filled, with the real numbers.
          short: ids.length < wanted ? `Only ${ids.length} of the ${wanted} you asked for fit what you described.` : undefined,
          notUnderstood: request.notUnderstood,
          intent: request.intent
        }
      }
      case 'request': {
        if (typeof a !== 'string' || !a.trim()) return { ok: false, why: 'Say what you would like.' }
        const request = music.engine.request(a.slice(0, 300))
        music.intel.announce()
        return { ok: request.intent.confidence > 0, intent: request.intent, notUnderstood: request.notUnderstood }
      }
      case 'constrain':
        // What Orion hands over once it has interpreted something: structured constraints, never free text.
        return a && typeof a === 'object'
          ? music.engine.setConstraints((typeof b === 'string' ? b : 'unspecified') as ListeningIntent, a as never, typeof c === 'string' ? c : undefined)
          : null
      case 'mode':
        music.engine.setMode(typeof a === 'string' ? (a as ListeningIntent) : null)
        music.intel.announce()
        return true
      case 'discovery-level':
        if (typeof a === 'string') music.engine.setDiscovery(a as DiscoveryLevel)
        return music.engine.tuningNow()
      case 'clear-request':
        music.engine.clearRequest()
        return true
      case 'say': {
        // "Never this artist", "more of this genre": a decision, kept where nothing measured can argue with it.
        const dimension = id(a)
        const name = id(b)
        if (!dimension || !name) return { ok: false, why: 'Say what about what.' }
        music.engine.say(dimension as TasteDimension, name.toLowerCase(), typeof c === 'number' ? Math.max(-1, Math.min(1, c)) : -1)
        return { ok: true }
      }
      case 'forget-about': {
        const dimension = id(a)
        const name = id(b)
        if (!dimension || !name) return { ok: false, why: 'Say what to forget.' }
        music.engine.forgetAbout(dimension as TasteDimension, name.toLowerCase())
        return { ok: true }
      }
      case 'dna':
        return { ...music.engine.dna(), confidence: music.engine.confidence(), measurement: music.engine.measurement }
      case 'exploration':
        return music.engine.exploration()
      case 'why': {
        const trackId = id(a)
        return trackId ? music.engine.affinityFor(trackId) : null
      }
      case 'inspect':
        // The developer inspector. Never shown in the ordinary interface.
        return music.engine.inspect({ currentTrackId: player.current().trackId, recentTrackIds: music.intel.recent() })
      case 'session':
        return { session: music.engine.sessionNow(), tuning: music.engine.tuningNow(), intent: music.engine.intentNow() }
      case 'reset-learning':
        music.engine.reset(a === 'session' || a === 'recent' || a === 'recommendations' ? a : 'everything')
        await music.engine.save()
        music.intel.announce()
        return { ok: true }
      case 'requeue': {
        // Reworks only what Orbis chose; anything added or pinned by hand is left exactly where it is.
        const held: QueueEntry[] = player.current().queue.map((trackId, index) => ({
          trackId,
          origin: index <= player.current().at ? 'locked' : 'orbis'
        }))
        const next = music.engine.requeue(held, { currentTrackId: player.current().trackId, recentTrackIds: music.intel.recent() })
        player.queueClear()
        player.queueEnd(next.map((one) => one.trackId))
        music.intel.announce()
        return { ok: true, queue: next }
      }

      case 'save-settings':
        return a && typeof a === 'object' ? port.saveSettings(a as Partial<MusicSettings>) : port.settings()
      case 'clear-history':
        await store.clearHistory()
        return true
      case 'clear-recognised':
        await store.clearRecognised()
        return true
      // ---------------------------------------------------------------- bringing a library in
      /*
       * One operation per question, and every one of them honest about what it did.
       *
       * Reading and planning change nothing: `migration-prepare` returns what *would* happen and the window shows
       * it. `migration-apply` is the only one here that writes, and it takes the ids the window was shown.
       */
      case 'migration-sources':
        return music.migrate.connections()
      case 'migration-connect':
        return id(a) ? music.migrate.connect(id(a)!) : { ok: false, why: 'Say which service.' }
      case 'migration-disconnect':
        return id(a) ? music.migrate.disconnect(id(a)!) : { ok: false, says: 'Say which service.' }
      case 'migration-check':
        return id(a) ? music.migrate.check(id(a)!) : { ok: false, why: 'Say which service.' }
      case 'migration-read-files': {
        // The paths come from the operating system's own picker, never from the window.
        const chosen = await music.migrate.pick('files')
        if (chosen.length === 0) return { jobId: null, read: [], says: 'No file was chosen.' }
        return music.migrate.readFiles(chosen)
      }
      case 'migration-read-paste': {
        const pasted = typeof b === 'string' ? b.slice(0, 500_000) : ''
        if (pasted.trim() === '') return { jobId: null, read: [], says: 'Nothing was pasted in.' }
        return music.migrate.readPasted(typeof a === 'string' ? a : '', pasted)
      }
      case 'migration-prepare': {
        const jobId = id(a)
        if (!jobId) return { jobId: '', sourceName: '', playlists: [], says: 'Say which import.' }
        const mapping =
          b && typeof b === 'object' && !Array.isArray(b)
            ? Object.fromEntries(
                Object.entries(b as Record<string, unknown>)
                  .filter(([key]) => key.length <= 4096)
                  .map(([key, value]) => [key, typeof value === 'string' && value ? value.slice(0, 64) : null])
              )
            : undefined
        return music.migrate.prepare(jobId, null, { mapping })
      }
      case 'migration-apply': {
        const jobId = id(a)
        if (!jobId) return { ok: false, job: null, says: 'Say which import.' }
        const rows = Array.isArray(b)
          ? b
              .map((one) => {
                if (!one || typeof one !== 'object') return null
                const row = one as Record<string, unknown>
                const sourceId = typeof row.sourceId === 'string' && row.sourceId.length <= 4096 ? row.sourceId : null
                if (!sourceId) return null
                return {
                  sourceId,
                  destinationId: id(row.destinationId),
                  destinationName: typeof row.destinationName === 'string' ? row.destinationName.trim().slice(0, 200) || 'Imported' : 'Imported',
                  trackIds: ids(row.trackIds)
                }
              })
              .filter((one): one is { sourceId: string; destinationId: string | null; destinationName: string; trackIds: string[] } => one !== null)
              .slice(0, 500)
          : []
        if (rows.length === 0) return { ok: false, job: null, says: 'Nothing was chosen to import.' }
        return music.migrate.apply(jobId, rows)
      }
      case 'migration-undo':
        return id(a) && id(b) ? music.migrate.undo(id(a)!, id(b)!) : { ok: false, says: 'Say which import and which playlist.' }
      case 'migration-jobs':
        return music.migrate.jobs()
      case 'migration-job':
        return id(a) ? music.migrate.jobDetail(id(a)!) : null
      case 'migration-unmatched':
        return music.migrate.unmatched(a === true)
      case 'migration-match-by-hand':
        return typeof a === 'string' && id(b) ? music.migrate.matchByHand(a.slice(0, 5000), id(b)!) : { ok: false, says: 'Say which row and which track.' }
      case 'migration-not-wanted':
        return typeof a === 'string' ? music.migrate.notWanted(a.slice(0, 5000)) : { ok: false, says: 'Say which row.' }
      case 'migration-duplicate-playlists':
        return music.migrate.duplicatePlaylists()
      case 'migration-compare':
        return id(a) && id(b) ? music.migrate.compare(id(a)!, id(b)!) : null
      case 'migration-settings':
        return music.migrate.settings()
      case 'migration-save-settings':
        return a && typeof a === 'object' ? music.migrate.saveSettings(a as Partial<MigrateSettings>) : music.migrate.settings()

      default:
        return { ok: false, why: `Orbis Music does not know how to "${String(op).slice(0, 40)}".` }
    }
  }

  ipcMain.handle('music:do', async (event, op: unknown, a?: unknown, b?: unknown, c?: unknown) => {
    if (!mine(event)) throw new Error('Not allowed.')
    return run(op, a, b, c)
  })

  // And the same runner is lent to the port, so the browser's panel asks the identical thing.
  music.useOperations((op, a, b, c) => run(op, a, b, c))
}

/** Whether a track can be played at all, for anywhere that needs to decide what to offer. */
export const canPlay = playableOffline
