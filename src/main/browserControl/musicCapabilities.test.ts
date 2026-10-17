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
import { DEFAULT_MUSIC_SETTINGS } from '../music/store.ts'
import { MODE_SHAPE } from '../../shared/music/intent.ts'
import { DISCOVERY_LEVELS } from '../../shared/music/config.ts'

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
  /** The queue, as the player really holds it: ids, in order. */
  queue: string[]
  mode: string | null
  dj: boolean
  /** What the engine would say about a track, or null where it has measured nothing yet. */
  affinity: unknown
  /** The one case the DJ and a station really refuse: too little music to choose from. */
  tooLittleMusic: boolean
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
    queue: [],
    mode: null,
    dj: false,
    affinity: null,
    tooLittleMusic: false,
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
      // The real queue, as rows -- so a capability that counts it before and after has something real to count.
      queue: (await Promise.all(w.queue.map((id) => store.track(id)))).filter((one): one is OrbisTrack => Boolean(one)),
      settings: await store.settings(),
      summary: await store.summary()
    }),
    port: {
      playPlaylist: async (id: string) => {
        const tracks = await store.listTracks(id)
        return tracks.length ? player.playTrack(tracks[0].id) : { ok: false, why: 'That playlist has nothing in it.' }
      }
    },
    /**
     * The one operation runner, behaving as the real one in `src/main/music/service.ts` does.
     *
     * Everything that changes music goes through here rather than through the player, because this is the door the
     * browser's own panel uses as well. Two of its real habits are copied on purpose, because what the capabilities
     * do about them is the thing worth testing:
     *
     * - anything it does not recognise as a repeat mode quietly becomes `off`, and anything it does not recognise as
     *   a listening mode is handed to the ranker all the same -- which is why the capabilities refuse an unknown one
     *   before it ever gets this far;
     * - a queue position it cannot use is ignored, so nothing happens and nothing says so.
     */
    ask: async (op: string, a?: unknown, b?: unknown) => {
      w.did.push(`${op}:${String(a)}`)
      if (op === 'shuffle') w.playback = { ...w.playback, shuffle: a === true }
      if (op === 'repeat') w.playback = { ...w.playback, repeat: a === 'all' || a === 'one' ? a : 'off' }
      if (op === 'stop') w.playback = { ...w.playback, playing: false, trackId: null, owner: 'none' }
      if (op === 'mode') w.mode = typeof a === 'string' ? a : null
      // The real one hands back the ranker's tuning, in which a discovery level is the number it stands for.
      if (op === 'discovery-level') return { discovery: DISCOVERY_LEVELS[a as keyof typeof DISCOVERY_LEVELS] }
      if (op === 'queue-clear') w.queue = []
      if (op === 'queue-remove') {
        const at = Number(a)
        if (Number.isInteger(at) && at >= 0 && at < w.queue.length) w.queue.splice(at, 1)
      }
      if (op === 'queue-reorder') {
        const [from, to] = [Number(a), Number(b)]
        if (Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from < w.queue.length && to >= 0 && to < w.queue.length) {
          w.queue.splice(to, 0, ...w.queue.splice(from, 1))
        }
      }
      if (op === 'save-settings') return store.saveSettings((a ?? {}) as never)
      if (op === 'create-playlist') return typeof a === 'string' && a.trim() ? store.createList(a.trim(), []) : null
      if (op === 'rename-playlist') return typeof a === 'string' && typeof b === 'string' ? store.renameList(a, b) : null
      if (op === 'remove-playlist') return typeof a === 'string' ? store.removeList(a) : false
      if (op === 'add-to-playlist') return typeof a === 'string' ? store.addToList(a, (b as string[]) ?? []) : null
      if (op === 'remove-from-playlist') return typeof a === 'string' && typeof b === 'string' ? store.removeFromList(a, b) : null
      if (op === 'dj') {
        if (w.tooLittleMusic) return { ok: false, why: 'There is not enough in your music for Orbis to choose from yet.' }
        w.dj = a === true
        return { ok: true, dj: w.dj }
      }
      if (op === 'radio') {
        if (w.tooLittleMusic) return { ok: false, why: 'There is nothing in your music to build a station from yet.' }
        const seed = typeof a === 'string' ? a : (await store.search({ offlineOnly: true }))[0]?.id
        return seed ? player.playTrack(seed) : { ok: false, why: 'There is nothing in your music to build a station from yet.' }
      }
      // Nothing measured yet, which the real engine also answers with null rather than with a made-up reason.
      if (op === 'why') return w.affinity
      return true
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

/*
 * Shuffle and repeat were readable and unsettable.
 *
 * `music.current` has answered with both since the beginning and nothing could change either, so a spoken "shuffle my
 * music" had no way through at all. They go through the one operation runner the browser's own panel also uses.
 */
test('shuffling is turned on through the one operation runner, and checked afterwards', async () => {
  const w = await world()
  await w.run('music.shuffle', { on: true })
  assert.equal(w.playback.shuffle, true)
  assert.ok(w.did.includes('shuffle:true'), 'it went through the operation runner, not round it')

  await w.run('music.shuffle', { on: false })
  assert.equal(w.playback.shuffle, false)
  assert.equal(((await w.run<{ shuffle: boolean }>('music.current')) as { shuffle: boolean }).shuffle, false)
})

test('a repeat mode nobody offers is refused with the three that exist, rather than quietly becoming off', async () => {
  const w = await world()
  await assert.rejects(() => w.run('music.repeat', { mode: 'twice' }), /must be one of: off, all, one/)
  assert.deepEqual(w.did, [], 'nothing was asked of the runner')

  await w.run('music.repeat', { mode: 'ALL' })
  assert.equal(w.playback.repeat, 'all', 'the word is read however it was written')
  await w.run('music.repeat', { mode: 'one' })
  assert.equal(w.playback.repeat, 'one')
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
// ---------------------------------------------------------------- stopping, and the queue

test('stopping what is not playing is not reported as having stopped something', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.stop', params: {}, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, true)
  assert.match(result.verification?.detail ?? '', /not playing anything/)
  // Nothing was asked of the player, which is the point: "already done" is not "done".
  assert.equal(w.did.includes('stop:undefined'), false)
})

test('stopping is confirmed by asking the player, not by having asked it to stop', async () => {
  const w = await world()
  await w.store.put(track())
  await w.run('music.play', { trackId: 'one' })
  const result = await w.control.execute({ capability: 'music.stop', params: {}, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, true)
  assert.equal(result.verification?.verified, true)
  assert.match(result.verification?.detail ?? '', /has stopped/)
  assert.equal(w.playback.trackId, null)
})

test('a queue position that is not there is refused with the real length, not quietly ignored', async () => {
  const w = await world()
  await w.store.put(track())
  await w.store.put(track({ id: 'two', title: 'Save Your Tears', file: 'C:/Music/two.mp3' }))
  w.queue = ['one', 'two']
  const result = await w.control.execute({ capability: 'music.queueChange', params: { what: 'remove', position: 9 }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.match(result.error?.message ?? '', /has 2 in it, so there is no number 9/)
  assert.deepEqual(w.queue, ['one', 'two'], 'and the queue was left alone')
})

test('taking one out of the queue is checked against the length read before it', async () => {
  const w = await world()
  await w.store.put(track())
  await w.store.put(track({ id: 'two', title: 'Save Your Tears', file: 'C:/Music/two.mp3' }))
  w.queue = ['one', 'two']
  const result = await w.control.execute({ capability: 'music.queueChange', params: { what: 'remove', position: 1 }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, true)
  assert.equal(result.verification?.verified, true)
  assert.match(result.verification?.detail ?? '', /1 left in the queue/)
  assert.deepEqual(w.queue, ['two'])
})

test('emptying a queue that is already empty does nothing and says so with a number', async () => {
  const w = await world()
  const answer = await w.run<{ emptied: number }>('music.queueChange', { what: 'clear' })
  assert.equal(answer.emptied, 0)
  assert.equal(w.did.includes('queue-clear:undefined'), false)
})

// ---------------------------------------------------------------- playlists

test('a playlist is made, and confirmed by reading it back out of the store', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.playlist', params: { what: 'create', name: 'Late shift' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, true)
  assert.equal(result.verification?.verified, true)
  assert.match(result.verification?.detail ?? '', /"Late shift" is in your playlists/)
  assert.equal((await w.store.lists()).length, 1)
})

test('a playlist nobody has is refused with the ones they do have', async () => {
  const w = await world()
  await w.store.createList('Late shift', [])
  const result = await w.control.execute({ capability: 'music.playlist', params: { what: 'rename', playlist: 'Morning', name: 'Dawn' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.match(result.error?.message ?? '', /no playlist called "Morning"\. You have: Late shift\./)
})

test('two playlists that answer the same name are never chosen between', async () => {
  const w = await world()
  await w.store.createList('Late shift', [])
  await w.store.createList('Late night', [])
  const result = await w.control.execute({ capability: 'music.playlist', params: { what: 'rename', playlist: 'late', name: 'Dawn' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.match(result.error?.message ?? '', /matches 2 of your playlists/)
  // Both are named, so the next attempt is a correction rather than another guess.
  for (const name of ['Late shift', 'Late night']) assert.match(result.error?.message ?? '', new RegExp(name))
  assert.match(result.error?.message ?? '', /Say which\./)
  assert.equal((await w.store.lists()).some((one) => one.name === 'Dawn'), false)
})

test('putting tracks in a playlist counts what really went in, not what matched', async () => {
  const w = await world()
  await w.store.put(track())
  await w.store.put(track({ id: 'two', title: 'Save Your Tears', file: 'C:/Music/two.mp3' }))
  const list = await w.store.createList('Late shift', ['one'])
  const result = await w.control.execute(
    { capability: 'music.playlist', params: { what: 'add', playlist: list.name, query: 'weeknd' }, source: 'orion' },
    { confirm: async () => true }
  )
  assert.equal(result.ok, true)
  const answer = result.data as { matched: number; added: number; tracks: number }
  assert.equal(answer.matched, 2, 'both matched')
  assert.equal(answer.added, 1, 'but one of them was already in it')
  assert.equal(answer.tracks, 2)
  assert.equal(result.verification?.verified, true)
})

test('deleting a playlist asks the person first, and says the songs are staying', async () => {
  const w = await world()
  await w.store.put(track())
  const list = await w.store.createList('Late shift', ['one'])
  const asked: string[] = []
  const refused = await w.control.execute(
    { capability: 'music.playlist', params: { what: 'delete', playlist: list.name }, source: 'orion' },
    {
      confirm: async (ask) => {
        asked.push(`${ask.action} ${ask.reason}`)
        return false
      }
    }
  )
  assert.equal(refused.ok, false)
  assert.match(asked.join(' '), /songs in it stay in your music/)
  assert.ok(await w.store.list(list.id), 'and it is still there')

  const done = await w.control.execute({ capability: 'music.playlist', params: { what: 'delete', playlist: list.name }, source: 'orion' }, { confirm: async () => true })
  assert.equal(done.ok, true)
  assert.equal(done.verification?.verified, true)
  assert.match(done.verification?.detail ?? '', /songs in it are still in your music/)
  assert.equal(await w.store.list(list.id), null)
  assert.ok(await w.store.track('one'), 'and the song itself is untouched')
})

// ---------------------------------------------------------------- the preferences

test('the preferences offered are the ones the music store really has, with its own types', async () => {
  const w = await world()
  const answer = await w.run<{ preferences: { name: string; type: string; values?: string[]; settable: boolean; whyNot?: string }[] }>('music.settings')
  const by = new Map(answer.preferences.map((one) => [one.name, one]))
  // Every field the store declares, described once -- here from the store's own default and value lists.
  for (const name of Object.keys(DEFAULT_MUSIC_SETTINGS)) assert.ok(by.has(name), `${name} is not offered`)
  assert.deepEqual(by.get('recognition')?.values, ['automatic', 'manual', 'off'])
  assert.equal(by.get('resume')?.type, 'boolean')
  assert.equal(by.get('volume')?.type, 'number')
  // The one that cannot be set says what would have to happen instead, rather than just refusing.
  assert.equal(by.get('folders')?.settable, false)
  assert.match(by.get('folders')?.whyNot ?? '', /file picker in the Orbis window/)
})

test('a preference is set through the store\'s own saver, and read back out of it', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.setPreference', params: { name: 'view', value: 'albums' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, true)
  assert.equal(result.verification?.verified, true)
  assert.match(result.verification?.detail ?? '', /"view" is albums/)
  assert.equal((await w.store.settings()).view, 'albums')
})

test('a switch set to a word that is not a switch is refused with the two words it takes', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.setPreference', params: { name: 'resume', value: 'maybe' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'invalid-params')
  assert.match(result.error?.message ?? '', /takes true or false/)
  assert.equal((await w.store.settings()).resume, true, 'and it is untouched')
})

test('a volume outside the range is refused with the range, never clamped into it', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.setPreference', params: { name: 'volume', value: '4' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.match(result.error?.message ?? '', /goes from 0 to 1\. 4 is outside that/)
  assert.equal((await w.store.settings()).volume, 1, 'and 4 did not quietly become 1')
})

test('a preference that does not exist is refused with the ones that do', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.setPreference', params: { name: 'brightness', value: 'on' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.match(result.error?.message ?? '', /no music preference called "brightness"\. There is: recognition/)
})

test('the folders cannot be set from here, and the refusal says where they are set', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.setPreference', params: { name: 'folders', value: 'C:/Music' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.match(result.error?.message ?? '', /file picker in the Orbis window/)
})

test('a preference already holding that value is not set again, and says so', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.setPreference', params: { name: 'resume', value: 'true' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, true)
  assert.match(result.verification?.detail ?? '', /already true/)
  assert.equal(w.did.some((one) => one.startsWith('save-settings')), false, 'nothing was written')
})

test('a preference change can be put back through the same door', async () => {
  const w = await world()
  await w.control.execute({ capability: 'music.setPreference', params: { name: 'view', value: 'artists' }, source: 'orion' }, { confirm: async () => true })
  const entry = w.control.undoHistory()[0]
  assert.ok(entry, 'the change is in the undo journal')
  assert.deepEqual(entry.inverse, { capability: 'music.setPreference', params: { name: 'view', value: 'songs' } })
  const back = await w.control.execute(entry.inverse as never, { confirm: async () => true })
  assert.equal(back.ok, true)
  assert.equal((await w.store.settings()).view, 'songs')
})

// ---------------------------------------------------------------- how Orbis chooses

test('a listening mode Orbis does not know is refused with the ones it knows', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.listening', params: { mode: 'vibing' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'invalid-params')
  /*
   * Refused by the declared parameter, with the whole list -- which is why the capability holds no check of its own.
   *
   * It matters that something refuses it here: the music service's own operation runner does not. It hands an
   * unknown mode straight to the ranker, which then chooses by a shape nobody asked for and reports success.
   */
  assert.match(result.error?.message ?? '', /must be one of: focus, study, workout/)
  assert.equal(w.mode, null, 'and the ranker was never handed it')
})

test('a mode and a discovery level come from the music engine\'s own models', async () => {
  const w = await world()
  const offered = w.control.list({ domain: 'music' }).find((one) => one.id === 'music.listening')
  // Not a list written here: the modes are the ranker's own shapes and the levels its own numbers.
  assert.deepEqual(offered?.params.mode?.enum, [...Object.keys(MODE_SHAPE), 'none'])
  assert.deepEqual(offered?.params.discovery?.enum, Object.keys(DISCOVERY_LEVELS))

  const answer = await w.run<{ mode: string; discovery: string }>('music.listening', { mode: 'focus', discovery: 'adventurous' })
  assert.equal(answer.mode, 'focus')
  assert.equal(answer.discovery, 'adventurous')
  assert.equal(w.mode, 'focus')
})

test('the half of the listening that nothing reads back is said to be the half that was only asked for', async () => {
  const w = await world()
  const mode = await w.control.execute({ capability: 'music.listening', params: { mode: 'sleep' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(mode.ok, true, 'it really was set, so it does not fail')
  // And it does not claim a reading nobody took.
  assert.match(mode.verification?.detail ?? '', /nothing reads a mode back, so that part is what was asked for/)
  assert.equal(w.mode, 'sleep')

  // The discovery level is a real reading: the number the level stands for, against the number the ranker holds.
  const level = await w.control.execute({ capability: 'music.listening', params: { discovery: 'familiar' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(level.ok, true)
  assert.match(level.verification?.detail ?? '', /choosing at familiar \(0\.05\)/)
})

test('with too little music, the DJ refuses with the reason rather than reporting itself on', async () => {
  const w = await world()
  w.tooLittleMusic = true
  const result = await w.control.execute({ capability: 'music.dj', params: { on: true }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.match(result.error?.message ?? '', /not enough in your music/)
  assert.equal(w.dj, false)
})

test('a station is started from a track the person really has, and checked by what is playing', async () => {
  const w = await world()
  await w.store.put(track())
  const result = await w.control.execute({ capability: 'music.radio', params: { query: 'blinding' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, true)
  assert.equal(result.verification?.verified, true)
  assert.match(result.verification?.detail ?? '', /station is playing "Blinding Lights"/)
})

test('a station asked for around nothing in the library is refused by name', async () => {
  const w = await world()
  const result = await w.control.execute({ capability: 'music.radio', params: { query: 'opera' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(result.ok, false)
  assert.match(result.error?.message ?? '', /nothing playable in your music matching "opera"/)
})

test('why a track was chosen says "not yet" rather than inventing a reason', async () => {
  const w = await world()
  await w.store.put(track())
  await w.run('music.play', { trackId: 'one' })
  const quiet = await w.run<{ known: boolean; detail?: string }>('music.why', {})
  assert.equal(quiet.known, false)
  assert.match(quiet.detail ?? '', /not listened with you long enough/)

  w.affinity = { score: 0.7, because: ['you play this artist often'] }
  const known = await w.run<{ known: boolean; affinity: unknown }>('music.why', {})
  assert.equal(known.known, true)
  assert.deepEqual(known.affinity, { score: 0.7, because: ['you play this artist often'] })
})

test('nothing new acquires audio either, and the delete that exists is declared as one', async () => {
  const w = await world()
  const all = w.control.list({ domain: 'music' })
  assert.ok(all.length >= 25, `only ${all.length} music capabilities`)
  for (const one of all) assert.equal(/download|rip|fetch|stream|acquire|convert/i.test(one.id), false, one.id)
  const playlist = all.find((one) => one.id === 'music.playlist')
  assert.ok(playlist?.effects?.includes('delete'), 'a capability that can delete says so')
})
