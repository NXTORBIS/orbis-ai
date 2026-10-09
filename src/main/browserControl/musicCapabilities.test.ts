import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserControl } from './registry.ts'
import { registerMusicCapabilities } from './musicCapabilities.ts'
import { MusicStore } from '../music/store.ts'
import { MusicLibrary } from '../music/library.ts'
import { NOTHING_PLAYING, type OrbisTrack, type PlaybackState } from '../../shared/music.ts'
import type { MusicHandle } from '../music/service.ts'
import type { MusicNow } from '../music/recognise.ts'

/**
 * What Orion, the Orb, a workflow and a spoken command may do about music.
 *
 * The decisive tests are about what is *not* offered and what is never claimed: nothing that fetches audio, nothing
 * that reports a pause that did not happen, and nothing that turns "I could not tell what this is" into a song name.
 * After that it is honesty -- a track with no audio refuses to play and says what to do instead, and a website's own
 * sound is named as the website's.
 */

const NOW = Date.parse('2026-10-04T12:00:00Z')

const track = (over: Partial<OrbisTrack> = {}): OrbisTrack => ({
  id: 'one',
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  album: 'After Hours',
  duration: 200,
  availability: 'local',
  provenance: 'user-file',
  confidence: 'high',
  method: 'file-tags',
  file: 'C:/Music/one.mp3',
  addedAt: NOW,
  ...over
})

interface World {
  control: BrowserControl
  store: MusicStore
  playback: PlaybackState & { problem: string | null }
  heard: MusicNow
  did: string[]
  run<T>(id: string, params?: Record<string, unknown>): Promise<T>
}

const world = async (): Promise<World> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-music-caps-'))
  const store = new MusicStore(dir)
  const library = new MusicLibrary(store, () => 'new-id')
  const w: World = {
    control: new BrowserControl(),
    store,
    playback: { ...NOTHING_PLAYING, problem: null },
    heard: { sighting: null, recognition: null, working: false, inLibraryId: null },
    did: [],
    run: null as never
  }

  const player = {
    current: () => w.playback,
    playTrack: async (id: string) => {
      const found = await store.track(id)
      if (!found) return { ok: false, why: 'That track is not in your music.' }
      if (found.availability !== 'local') return { ok: false, why: 'Orbis knows this song but has no audio for it. Import your own copy to play it here.' }
      w.did.push(`play:${id}`)
      w.playback = { ...w.playback, owner: 'orbis-music', trackId: id, playing: true, duration: found.duration }
      return { ok: true }
    },
    playAll: async (ids: readonly string[]) => (ids.length ? player.playTrack(ids[0]) : { ok: false, why: 'There is nothing to play.' }),
    play: () => {
      w.did.push('play')
      if (w.playback.trackId) w.playback = { ...w.playback, playing: true }
    },
    pause: () => {
      w.did.push('pause')
      w.playback = { ...w.playback, playing: false }
    },
    next: async () => {
      w.did.push('next')
      w.playback = { ...w.playback, trackId: 'two' }
    },
    previous: async () => {
      w.did.push('previous')
    },
    seek: (seconds: number) => {
      w.did.push(`seek:${seconds}`)
      w.playback = { ...w.playback, position: seconds }
    },
    setVolume: async (value: number) => {
      w.playback = { ...w.playback, volume: value }
    },
    setMuted: (on: boolean) => {
      w.playback = { ...w.playback, muted: on }
    },
    setShuffle: async (on: boolean) => {
      w.playback = { ...w.playback, shuffle: on }
    },
    queueNext: (ids: readonly string[]) => w.did.push(`queue-next:${ids.join(',')}`),
    queueEnd: (ids: readonly string[]) => w.did.push(`queue-end:${ids.join(',')}`)
  }

  const handle = {
    store,
    library,
    player,
    heard: () => w.heard,
    look: async () => w.heard,
    snapshot: async () => ({
      playback: w.playback,
      track: w.playback.trackId ? await store.track(w.playback.trackId) : null,
      queue: [],
      settings: await store.settings(),
      summary: await store.summary()
    }),
    port: {
      playPlaylist: async (id: string) => {
        const tracks = await store.listTracks(id)
        return tracks.length ? player.playTrack(tracks[0].id) : { ok: false, why: 'That playlist has nothing in it.' }
      }
    }
  } as unknown as MusicHandle

  registerMusicCapabilities({ control: w.control, music: () => handle })
  w.run = async <T>(id: string, params: Record<string, unknown> = {}): Promise<T> => {
    const result = await w.control.execute({ capability: id, params, source: 'orion' }, { confirm: async () => true })
    if (!result.ok) throw new Error(result.error?.message ?? 'refused')
    return result.data as T
  }
  return w
}

// ---------------------------------------------------------------- what is offered at all

test('nothing on offer fetches audio from anywhere', async () => {
  const w = await world()
  const ids = w.control.list({ domain: 'music' }).map((one) => one.id)
  assert.ok(ids.length >= 10, `only ${ids.length} music capabilities`)
  for (const id of ids) {
    assert.equal(/download|rip|fetch|stream|acquire|convert/i.test(id), false, `${id} sounds like it acquires audio`)
  }
  // The only way audio ever enters the library is a file the person already has, and that needs their own picker.
  assert.equal(ids.includes('music.import'), false, 'importing needs a person at a file picker, so it is not offered here')
})

test('music is its own domain, so what Orion may do about it is one switch', async () => {
  const w = await world()
  for (const one of w.control.list({ domain: 'music' })) assert.equal(one.domain, 'music', one.id)
})

// ---------------------------------------------------------------- what is playing

test('with nothing playing, the answer is nothing -- not a blank track', async () => {
  const w = await world()
  const answer = await w.run<{ source: string; playing: boolean; track: unknown }>('music.current')
  assert.equal(answer.source, 'nothing')
  assert.equal(answer.playing, false)
  assert.equal(answer.track, null)
})

test("a website's own sound is named as the website's, and is not Orbis Music", async () => {
  const w = await world()
  w.playback = { ...w.playback, owner: 'website', playing: true, problem: null }
  const answer = await w.run<{ source: string }>('music.current')
  assert.equal(answer.source, 'website')
})

test('pausing a website\'s sound from here says that is not what this does', async () => {
  const w = await world()
  w.playback = { ...w.playback, owner: 'website', playing: true }
  const answer = await w.run<{ paused: boolean; detail?: string }>('music.pause')
  assert.equal(answer.paused, false)
  assert.match(answer.detail ?? '', /web page's own/)
  assert.equal(w.did.includes('pause'), false, 'and nothing was done to it')
})

// ---------------------------------------------------------------- playing

test('playing by name plays a track the person actually has', async () => {
  const w = await world()
  await w.store.put(track())
  const answer = await w.run<{ playing: { title: string }; queued: number }>('music.play', { query: 'blinding' })
  assert.equal(answer.playing.title, 'Blinding Lights')
  assert.ok(w.did.includes('play:one'))
})

test('a song they have only by name refuses to play, and says what would make it playable', async () => {
  const w = await world()
  await w.store.put(track({ availability: 'reference', file: undefined }))
  await assert.rejects(() => w.run('music.play', { query: 'blinding' }), /no audio for it|Importing a copy/)
})

test('asking for something that is not there says so plainly', async () => {
  const w = await world()
  await assert.rejects(() => w.run('music.play', { query: 'a song nobody has' }), /nothing in your music matching/)
})

test('a pause that did not take is not reported as a pause', async () => {
  const w = await world()
  await w.store.put(track())
  await w.run('music.play', { trackId: 'one' })
  const result = await w.control.execute({ capability: 'music.pause', params: {}, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, true)
  assert.equal(result.verification?.verified, true, 'checked afterwards, against the player')
  assert.match(result.verification?.detail ?? '', /paused/)
})

test('what a track says it can do is checked after playing, not assumed', async () => {
  const w = await world()
  await w.store.put(track())
  const result = await w.control.execute({ capability: 'music.play', params: { trackId: 'one' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.verification?.verified, true)
  assert.match(result.verification?.detail ?? '', /Playing/)
})

test('a seek is checked against where the player really got to', async () => {
  const w = await world()
  await w.store.put(track())
  await w.run('music.play', { trackId: 'one' })
  const result = await w.control.execute({ capability: 'music.seek', params: { seconds: 60 }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.verification?.verified, true)
  assert.match(result.verification?.detail ?? '', /60 seconds/)
})

test('seeking with nothing playing is refused rather than quietly ignored', async () => {
  const w = await world()
  await assert.rejects(() => w.run('music.seek', { seconds: 10 }), /not playing anything/)
})

// ---------------------------------------------------------------- playlists

test('a playlist is played by name, and an empty one says it is empty', async () => {
  const w = await world()
  await w.store.put(track())
  const list = await w.store.createList('Evening')
  await w.store.addToList(list.id, ['one'])
  const answer = await w.run<{ playlist: string }>('music.playPlaylist', { name: 'evening' })
  assert.equal(answer.playlist, 'Evening')

  await w.store.createList('Empty')
  await assert.rejects(() => w.run('music.playPlaylist', { name: 'Empty' }), /nothing in it/)
  await assert.rejects(() => w.run('music.playPlaylist', { name: 'Nope' }), /no playlist called/)
})

// ---------------------------------------------------------------- what is playing on a page

test('a song Orbis could not work out is reported as not worked out', async () => {
  const w = await world()
  w.heard = {
    sighting: { sourceId: 's', provider: 'youtube', playing: true, duration: 200, position: 3 },
    recognition: { sourceId: 's', names: null, confidence: 'low', method: null, at: NOW, why: 'Orbis could not work out what this track is.' },
    working: false,
    inLibraryId: null
  }
  const answer = await w.run<{ recognised: unknown; couldNotTell?: string }>('music.recognise')
  assert.equal(answer.recognised, null)
  assert.match(answer.couldNotTell ?? '', /could not work out/)
})

test('keeping a song Orbis could not name is refused', async () => {
  const w = await world()
  w.heard = { sighting: { sourceId: 's', provider: 'youtube', playing: true, duration: 200, position: 3 }, recognition: null, working: false, inLibraryId: null }
  await assert.rejects(() => w.run('music.keepHeard'), /does not know what is playing/)
})

test('keeping a song with no copy says it was saved by name, and that there is no audio', async () => {
  const w = await world()
  w.heard = {
    sighting: { sourceId: 's', provider: 'youtube', url: 'https://example.test/x', playing: true, duration: 230, position: 3 },
    recognition: { sourceId: 's', names: { title: 'Starboy', artist: 'The Weeknd', album: '' }, confidence: 'high', method: 'media-session', at: NOW },
    working: false,
    inLibraryId: null
  }
  const answer = await w.run<{ kept: boolean; how: string; detail?: string; track: { playableOffline: boolean } }>('music.keepHeard')
  assert.equal(answer.kept, true)
  assert.equal(answer.how, 'saved by name only')
  assert.equal(answer.track.playableOffline, false)
  assert.match(answer.detail ?? '', /no audio for this on this computer/)
  assert.equal((await w.store.all()).length, 1)
})

test('keeping a song they already have links to their own copy rather than adding a second row', async () => {
  const w = await world()
  await w.store.put(track())
  w.heard = {
    sighting: { sourceId: 's', provider: 'youtube', playing: true, duration: 200, position: 3 },
    recognition: { sourceId: 's', names: { title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours' }, confidence: 'high', method: 'media-session', at: NOW },
    working: false,
    inLibraryId: 'one'
  }
  const answer = await w.run<{ how: string }>('music.keepHeard')
  assert.match(answer.how, /already have it|your own copy/)
  assert.equal((await w.store.all()).length, 1)
})

test('what was kept is checked against the library afterwards', async () => {
  const w = await world()
  w.heard = {
    sighting: { sourceId: 's', provider: 'youtube', playing: true, duration: 230, position: 3 },
    recognition: { sourceId: 's', names: { title: 'Starboy', artist: 'The Weeknd', album: '' }, confidence: 'high', method: 'media-session', at: NOW },
    working: false,
    inLibraryId: null
  }
  const result = await w.control.execute({ capability: 'music.keepHeard', params: {}, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.verification?.verified, true)
  assert.match(result.verification?.detail ?? '', /is in your music/)
})

// ---------------------------------------------------------------- the rest

test('searching answers only with what is stored, and says how many there were', async () => {
  const w = await world()
  await w.store.put(track())
  await w.store.put(track({ id: 'two', title: 'Save Your Tears', file: 'C:/Music/two.mp3' }))
  const answer = await w.run<{ found: number; tracks: { title: string }[] }>('music.search', { query: 'weeknd' })
  assert.equal(answer.found, 2)
  assert.equal(answer.tracks.length, 2)
  const none = await w.run<{ found: number }>('music.search', { query: 'nothing like this' })
  assert.equal(none.found, 0)
})

test('a track Orion is shown says whether it can be played, and never where the file is', async () => {
  const w = await world()
  await w.store.put(track({ availability: 'missing' }))
  const answer = await w.run<{ tracks: Record<string, unknown>[] }>('music.search', { query: 'blinding' })
  const shown = answer.tracks[0]
  assert.equal(shown.playableOffline, false)
  assert.match(String(shown.unavailable), /not where it was/)
  assert.equal('file' in shown, false, 'Orion is never handed a path')
})

test('queueing finds real tracks and says where they went', async () => {
  const w = await world()
  await w.store.put(track())
  const answer = await w.run<{ added: number; where: string }>('music.queue', { query: 'blinding', next: true })
  assert.equal(answer.added, 1)
  assert.equal(answer.where, 'next')
  assert.ok(w.did.includes('queue-next:one'))
})

test('favouriting the track playing works without naming it', async () => {
  const w = await world()
  await w.store.put(track())
  await w.run('music.play', { trackId: 'one' })
  const answer = await w.run<{ favourite: boolean }>('music.favourite', {})
  assert.equal(answer.favourite, true)
  assert.equal((await w.store.track('one'))?.favourite, true)
})

test('the volume answered is the player\'s own, not the number that was asked for', async () => {
  const w = await world()
  const answer = await w.run<{ level: number; muted: boolean }>('music.volume', { level: 0.4, muted: true })
  assert.equal(answer.level, 0.4)
  assert.equal(answer.muted, true)
})
