import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMusicHandlers } from './music.ts'
import type { MusicPort } from './music.ts'
import type { Handler } from './server.ts'

/**
 * The browser's way into Orbis Music.
 *
 * Two things are being checked. With nothing lent -- the Orbis window closed -- every channel says so rather than
 * answering with an empty library, because an empty answer reads as "you have no music". And every argument is
 * checked here, so a panel cannot pass a number where a track id goes and have it reach the library.
 */

const call = async (handlers: Record<string, Handler>, name: string, args: unknown[] = []): Promise<unknown> => {
  const handler = handlers[name]
  assert.ok(handler, `${name} is not a channel`)
  return handler(args, { emit: () => undefined, signal: new AbortController().signal } as never)
}

const port = (): { port: MusicPort; did: string[] } => {
  const did: string[] = []
  const note =
    (what: string) =>
    (...args: unknown[]): unknown => {
      did.push(`${what}:${args.map((one) => JSON.stringify(one)).join(',')}`)
      return true
    }
  const one = {
    snapshot: async () => ({ playback: { playing: false }, track: null, queue: [], settings: {}, summary: {} }),
    heard: () => ({ sighting: null, recognition: null, working: false, inLibraryId: null }),
    look: async () => ({ sighting: null, recognition: null, working: false, inLibraryId: null }),
    search: async (query: unknown) => {
      did.push(`search:${JSON.stringify(query)}`)
      return []
    },
    albums: async () => [],
    artists: async () => [],
    genres: async () => [],
    playlists: async () => [],
    playlistTracks: async (id: string) => {
      did.push(`playlist-tracks:${id}`)
      return []
    },
    recentlyPlayed: async () => [],
    recognised: async () => [],
    play: async (id: string) => {
      did.push(`play:${id}`)
      return { ok: true }
    },
    playAll: async (ids: string[], at?: number) => {
      did.push(`play-all:${ids.join(',')}:${at}`)
      return { ok: true }
    },
    playPlaylist: async (id: string) => {
      did.push(`play-playlist:${id}`)
      return { ok: true }
    },
    pause: note('pause'),
    resume: note('resume'),
    toggle: note('toggle'),
    next: async () => void did.push('next'),
    previous: async () => void did.push('previous'),
    seek: note('seek'),
    volume: async (value: number) => void did.push(`volume:${value}`),
    mute: note('mute'),
    shuffle: async (on: boolean) => void did.push(`shuffle:${on}`),
    repeat: async (mode: string) => void did.push(`repeat:${mode}`),
    queueNext: note('queue-next'),
    queueEnd: note('queue-end'),
    queueRemove: note('queue-remove'),
    queueReorder: note('queue-reorder'),
    queueClear: note('queue-clear'),
    favourite: async (id: string, on: boolean) => {
      did.push(`favourite:${id}:${on}`)
      return null
    },
    createPlaylist: async (name: string) => {
      did.push(`create:${name}`)
      return { id: 'p1', name, tracks: [], createdAt: 0, updatedAt: 0 }
    },
    addToPlaylist: async (id: string, ids: string[]) => void did.push(`add:${id}:${ids.join(',')}`),
    removeFromPlaylist: async (id: string, trackId: string) => void did.push(`remove:${id}:${trackId}`),
    addHeard: async (names: unknown, duration: unknown, source: unknown) => {
      did.push(`keep:${JSON.stringify(names)}:${duration}:${JSON.stringify(source)}`)
      return { kind: 'reference' }
    },
    importFiles: async () => {
      did.push('import')
      return { done: 2, total: 2, added: 2, already: 0, failed: 0 }
    },
    scanFolder: async () => {
      did.push('scan')
      return { done: 3, total: 3, added: 3, already: 0, failed: 0 }
    },
    settings: async () => ({}),
    saveSettings: async (patch: unknown) => {
      did.push(`settings:${JSON.stringify(patch)}`)
      return {}
    }
  }
  return { port: one as unknown as MusicPort, did }
}

// ---------------------------------------------------------------- with nothing lent

test('with the Orbis window closed, every channel says so rather than answering empty', async () => {
  const handlers = createMusicHandlers(() => null)
  for (const name of ['music:state', 'music:search', 'music:playlists', 'music:play', 'music:pause', 'music:recent']) {
    await assert.rejects(() => call(handlers, name, ['x']), /not available/, name)
  }
})

// ---------------------------------------------------------------- arguments are checked here

test('a track id has to look like one', async () => {
  const { port: one } = port()
  const handlers = createMusicHandlers(() => one)
  await assert.rejects(() => call(handlers, 'music:play', [42]), /not valid/)
  await assert.rejects(() => call(handlers, 'music:play', ['']), /not valid/)
  await assert.rejects(() => call(handlers, 'music:play', ['x'.repeat(200)]), /not valid/)
})

test('a volume outside nought to one is refused', async () => {
  const { port: one, did } = port()
  const handlers = createMusicHandlers(() => one)
  await assert.rejects(() => call(handlers, 'music:volume', [4]), /between 0 and 1/)
  await assert.rejects(() => call(handlers, 'music:volume', ['loud']), /between 0 and 1/)
  await call(handlers, 'music:volume', [0.5])
  assert.ok(did.includes('volume:0.5'))
})

test('a list of tracks has to be a list of tracks, and is kept to a sensible size', async () => {
  const { port: one, did } = port()
  const handlers = createMusicHandlers(() => one)
  await assert.rejects(() => call(handlers, 'music:play-all', ['not a list']), /not a list of tracks/)
  await call(handlers, 'music:play-all', [['a', 7, 'b', null], 1])
  assert.ok(did.some((entry) => entry.startsWith('play-all:a,b:1')), did.join(' | '))
})

test('a repeat mode that is not one of the three becomes off', async () => {
  const { port: one, did } = port()
  const handlers = createMusicHandlers(() => one)
  await call(handlers, 'music:repeat', ['sideways'])
  assert.ok(did.includes('repeat:off'))
  await call(handlers, 'music:repeat', ['one'])
  assert.ok(did.includes('repeat:one'))
})

test('keeping a song needs a title, and carries only the names and where it was heard', async () => {
  const { port: one, did } = port()
  const handlers = createMusicHandlers(() => one)
  await assert.rejects(() => call(handlers, 'music:keep-heard', [{}]), /not valid/)
  await assert.rejects(() => call(handlers, 'music:keep-heard', [null]), /no song to keep/)
  await call(handlers, 'music:keep-heard', [{ title: 'Starboy', artist: 'The Weeknd', file: 'C:/secret.mp3' }, 230, { provider: 'youtube', url: 'https://example.test/x' }])
  const kept = did.find((entry) => entry.startsWith('keep:'))
  assert.ok(kept)
  assert.equal(kept!.includes('secret.mp3'), false, 'nothing but the names and the source goes through')
  assert.ok(kept!.includes('Starboy'))
})

// ---------------------------------------------------------------- what is not offered

test('nothing on offer fetches audio, converts it, or deletes a file', () => {
  const { port: one } = port()
  const names = Object.keys(createMusicHandlers(() => one))
  assert.ok(names.length > 20, `only ${names.length} channels`)
  for (const name of names) {
    assert.equal(/download|rip|convert|stream|delete/i.test(name), false, name)
  }
})

test('adding music takes no path and gives none back: the picker belongs to the window', async () => {
  const { port: one, did } = port()
  const handlers = createMusicHandlers(() => one)
  // Whatever a caller passes is ignored: there is no argument that can name a file.
  const answer = await call(handlers, 'music:import', ['C:/somewhere/secret.mp3'])
  assert.deepEqual(did.filter((entry) => entry.includes('secret')), [], 'nothing it passed reached the app')
  assert.equal(JSON.stringify(answer).includes(':/'), false, `a path came back: ${JSON.stringify(answer)}`)
  const folder = await call(handlers, 'music:scan-folder', ['C:/Music'])
  assert.equal(JSON.stringify(folder).includes(':/'), false)
})
test('the channels the panel needs are all there', () => {
  const { port: one } = port()
  const names = new Set(Object.keys(createMusicHandlers(() => one)))
  for (const needed of [
    'music:state',
    'music:heard',
    'music:listen',
    'music:search',
    'music:albums',
    'music:artists',
    'music:playlists',
    'music:recent',
    'music:recognised',
    'music:play',
    'music:pause',
    'music:next',
    'music:previous',
    'music:seek',
    'music:volume',
    'music:shuffle',
    'music:repeat',
    'music:queue-end',
    'music:favourite',
    'music:keep-heard',
    'music:settings'
  ]) {
    assert.ok(names.has(needed), `${needed} is missing`)
  }
})
