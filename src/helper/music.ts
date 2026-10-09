import { HelperError } from './server.ts'
import type { Handler } from './server.ts'
import type { MusicPortShape } from '../shared/musicPort.ts'

/**
 * The browser's way into Orbis Music.
 *
 * The browser's panel, its new-tab page and its mini-player all read through these channels. The port behind them is
 * the app's own music service, lent at call time -- so with Orbis's window closed every channel says "not available"
 * rather than answering with an empty library, which would read as "you have no music".
 *
 * Deliberately smaller than what the window can do. The panel can look through the library, work the player, keep a
 * song it heard and manage playlists. It cannot delete a file, name a path, reach another profile, or import -- the
 * last of those needs a person at their own file picker, which is the window's business.
 *
 * Nothing here is reachable by a web page. These are the helper's channels, which a page cannot call: only Orbis's own
 * browser surfaces can, with the token the browser was started with.
 */

/** What the app lends: the one shape both halves agree on, declared in shared so neither owns it. */
export type MusicPort = MusicPortShape

const bad = (message: string): never => {
  throw new HelperError('bad-request', message)
}

const id = (value: unknown, what = 'That'): string => (typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : bad(`${what} is not valid.`))
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.length > 0 && one.length <= 64).slice(0, 500) : bad('That is not a list of tracks.')
const whole = (value: unknown, what: string, max = 100_000): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : bad(`${what} is not valid.`)
const words = (value: unknown, max = 200): string => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : bad('That text is not valid.'))

export function createMusicHandlers(get: () => MusicPort | null | undefined): Record<string, Handler> {
  const port = (): MusicPort => {
    const one = get()
    if (!one) throw new HelperError('unavailable', 'Orbis Music is not available. Open the Orbis window and it connects by itself.')
    return one
  }

  return {
    // ---------------------------------------------------------------- looking
    'music:state': () => port().snapshot(),
    'music:heard': () => port().heard(),
    'music:listen': ([tabId]) => port().look({ force: true, tabId: typeof tabId === 'string' ? tabId : undefined }),
    'music:search': ([query]) => port().search(query && typeof query === 'object' ? (query as never) : {}),
    'music:albums': () => port().albums(),
    'music:artists': () => port().artists(),
    'music:genres': () => port().genres(),
    'music:playlists': () => port().playlists(),
    'music:playlist-tracks': ([listId]) => port().playlistTracks(id(listId, 'That playlist')),
    'music:recent': () => port().recentlyPlayed(),
    'music:recognised': () => port().recognised(),
    'music:settings': () => port().settings(),
    /*
     * Everything else, by name.
     *
     * The same runner the Orbis window reaches, so "surprise me" in the browser's panel and "surprise me" in the
     * window are one piece of code. With the window closed this throws "not available" like every other channel
     * here, rather than answering with nothing.
     */
    'music:do': ([op, a, b, c]) => port().ask(typeof op === 'string' ? op.slice(0, 60) : '', a, b, c),

    // ---------------------------------------------------------------- playing
    'music:play': ([trackId]) => port().play(id(trackId, 'That track')),
    'music:play-all': ([trackIds, startAt]) => port().playAll(ids(trackIds), typeof startAt === 'number' ? whole(startAt, 'The position', 5000) : 0),
    'music:play-playlist': ([listId]) => port().playPlaylist(id(listId, 'That playlist')),
    'music:pause': () => {
      port().pause()
      return true
    },
    'music:resume': () => {
      port().resume()
      return true
    },
    'music:toggle': () => {
      port().toggle()
      return true
    },
    'music:next': async () => {
      await port().next()
      return true
    },
    'music:previous': async () => {
      await port().previous()
      return true
    },
    'music:seek': ([seconds]) => {
      port().seek(whole(seconds, 'That position', 86_400))
      return true
    },
    'music:volume': async ([level]) => {
      const value = typeof level === 'number' && level >= 0 && level <= 1 ? level : bad('The volume must be between 0 and 1.')
      await port().volume(value)
      return true
    },
    'music:mute': ([on]) => {
      port().mute(on === true)
      return true
    },
    'music:shuffle': async ([on]) => {
      await port().shuffle(on === true)
      return true
    },
    'music:repeat': async ([mode]) => {
      await port().repeat(mode === 'all' || mode === 'one' ? mode : 'off')
      return true
    },

    // ---------------------------------------------------------------- the queue
    'music:queue-next': ([trackIds]) => {
      port().queueNext(ids(trackIds))
      return true
    },
    'music:queue-end': ([trackIds]) => {
      port().queueEnd(ids(trackIds))
      return true
    },
    'music:queue-remove': ([index]) => {
      port().queueRemove(whole(index, 'That position', 5000))
      return true
    },
    'music:queue-reorder': ([from, to]) => {
      port().queueReorder(whole(from, 'That position', 5000), whole(to, 'That position', 5000))
      return true
    },
    'music:queue-clear': () => {
      port().queueClear()
      return true
    },

    // ---------------------------------------------------------------- the library
    'music:favourite': ([trackId, on]) => port().favourite(id(trackId, 'That track'), on !== false),
    'music:create-playlist': ([name]) => port().createPlaylist(words(name)),
    'music:add-to-playlist': ([listId, trackIds]) => port().addToPlaylist(id(listId, 'That playlist'), ids(trackIds)),
    'music:remove-from-playlist': ([listId, trackId]) => port().removeFromPlaylist(id(listId, 'That playlist'), id(trackId, 'That track')),

    /**
     * Keeps the song playing on the page.
     *
     * The most this can do is link a song to a file the person already has, or keep its name with a note that there
     * is no audio. It fetches nothing: there is no path from this channel to a downloaded file, whatever is passed in.
     */
    'music:keep-heard': ([names, duration, source]) => {
      const one = (names && typeof names === 'object' ? names : bad('There is no song to keep.')) as Record<string, unknown>
      const from = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>
      return port().addHeard(
        { title: words(one.title, 300), artist: typeof one.artist === 'string' ? one.artist.slice(0, 300) : '', album: typeof one.album === 'string' ? one.album.slice(0, 300) : '' },
        typeof duration === 'number' && duration > 0 ? Math.min(duration, 86_400) : 0,
        { provider: typeof from.provider === 'string' ? from.provider.slice(0, 80) : 'unknown', url: typeof from.url === 'string' ? from.url.slice(0, 2048) : undefined }
      )
    },

    /**
     * Adding your own music, through the Orbis window’s own picker.
     *
     * No path is passed in and none comes back: the dialog belongs to the window, and this answers with how many
     * files were read. That is what keeps "the panel cannot name a file" true while still letting somebody add
     * music from the browser.
     */
    'music:import': () => port().importFiles(),
    'music:scan-folder': () => port().scanFolder(),

    'music:save-settings': ([patch]) => port().saveSettings(patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {})
  }
}
