import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MusicRecogniser, providerOf, readVisionAnswer, sightingFrom, type MusicNow, type NowPlaying } from './recognise.ts'
import { MusicStore } from './store.ts'

const NOW = Date.parse('2026-10-04T12:00:00Z')

const playing = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  session: null,
  playbackState: 'playing',
  pageTitle: '',
  origin: 'https://www.youtube.com',
  playing: true,
  duration: 200,
  position: 10,
  muted: false,
  kind: 'video',
  ...over
})

interface World {
  recogniser: MusicRecogniser
  store: MusicStore
  pictures: number
  asked: string[]
  states: MusicNow[]
}

const world = async (options: { reading?: NowPlaying | null; vision?: string | null; picture?: string | null } = {}): Promise<World> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-recognise-'))
  const store = new MusicStore(dir)
  const w: World = { recogniser: null as never, store, pictures: 0, asked: [], states: [] }
  w.recogniser = new MusicRecogniser({
    store,
    nowPlaying: async () => options.reading ?? null,
    picture: async () => {
      w.pictures += 1
      return options.picture === undefined ? 'data:image/png;base64,AAAA' : options.picture
    },
    askVision: async (prompt) => {
      w.asked.push(prompt)
      return options.vision ?? null
    },
    sounds: async () => [sightingFrom({ id: 'tab1', url: 'https://www.youtube.com/watch?v=x', title: options.reading?.pageTitle ?? '' }, options.reading ?? null)],
    onChange: (state) => w.states.push(state),
    now: () => NOW
  })
  return w
}

// ---------------------------------------------------------------- what the page says comes first

test('a page that publishes its track is believed, and the screen is not looked at', async () => {
  const w = await world({ reading: playing({ session: { title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', artwork: null } }) })
  const state = await w.recogniser.look()
  assert.equal(state.recognition?.method, 'media-session')
  assert.equal(state.recognition?.names?.title, 'Blinding Lights')
  assert.equal(w.pictures, 0, 'nothing was sent to be looked at, because nothing needed to be')
})

test('the same page asked twice is only worked out once', async () => {
  const w = await world({ reading: playing({ session: { title: 'Starboy', artist: 'The Weeknd', album: '', artwork: null } }) })
  await w.recogniser.look()
  await w.recogniser.look()
  await w.recogniser.look()
  assert.equal(w.pictures, 0)
  assert.equal((await w.store.recognisedList()).length, 1, 'and it is noticed once, not three times')
})

// ---------------------------------------------------------------- the screen, when the page says nothing

test('a page that says nothing is looked at, and what is read off it is used', async () => {
  const w = await world({
    reading: playing({ pageTitle: 'Some Channel' }),
    vision: '{"title": "Save Your Tears", "artist": "The Weeknd", "album": "After Hours", "sure": true}'
  })
  const state = await w.recogniser.look()
  assert.equal(w.pictures, 1, 'one picture, one request')
  assert.equal(state.recognition?.method, 'vision')
  assert.equal(state.recognition?.names?.title, 'Save Your Tears')
  assert.equal(state.recognition?.confidence, 'medium', 'read off a screen is never stated as certain')
})

test('a model that says it could not read it is offered as a maybe, not a fact', async () => {
  const w = await world({ reading: playing({ pageTitle: 'x' }), vision: '{"title": "Maybe This", "artist": "Someone", "album": "", "sure": false}' })
  const state = await w.recogniser.look()
  assert.equal(state.recognition?.confidence, 'low')
})

test('a model that reads nothing leaves Orbis saying it does not know', async () => {
  const w = await world({ reading: playing({ pageTitle: 'Some Channel' }), vision: '{"title": "", "artist": "", "album": "", "sure": false}' })
  const state = await w.recogniser.look()
  assert.equal(state.recognition?.names, null)
  assert.match(state.recognition?.why ?? '', /could not work out what this track is/)
  assert.equal((await w.store.recognisedList()).length, 0, 'and nothing is noted')
})

test('a model that answers with prose, or nonsense, changes nothing', async () => {
  for (const answer of [null, '', 'I think this might be a song by someone.', '{"title":', '{"title": "Untitled", "artist": "", "sure": true}']) {
    const w = await world({ reading: playing({ pageTitle: 'x' }), vision: answer })
    const state = await w.recogniser.look()
    assert.equal(state.recognition?.names, null, JSON.stringify(answer))
  }
})

test('only the object is read out of a model answer wrapped in words', () => {
  const read = readVisionAnswer('Here is what I can see:\n```json\n{"title": "Starboy", "artist": "The Weeknd", "album": "", "sure": true}\n```')
  assert.equal(read?.names.title, 'Starboy')
})

test('a title a player writes when it has nothing is not a song', () => {
  assert.equal(readVisionAnswer('{"title": "Advertisement", "artist": "", "sure": true}'), null)
  assert.equal(readVisionAnswer('{"title": "Now Playing", "artist": "x", "sure": true}'), null)
})

// ---------------------------------------------------------------- when it does not look at all

test('nothing is looked at while the setting says not to', async () => {
  const w = await world({ reading: playing({ pageTitle: 'x' }), vision: '{"title": "Alpha", "artist": "Beta", "sure": true}' })
  await w.store.saveSettings({ recognition: 'off' })
  const state = await w.recogniser.look()
  assert.equal(w.pictures, 0)
  assert.equal(state.recognition, null)

  await w.store.saveSettings({ recognition: 'manual' })
  const manual = await w.recogniser.look()
  assert.equal(w.pictures, 0, 'and on manual it waits to be asked')
  assert.ok(manual.sighting, 'though it still knows something is playing')

  const asked = await w.recogniser.look({ force: true })
  assert.equal(w.pictures, 1, 'being asked is what makes it look')
  assert.equal(asked.recognition?.names?.title, 'Alpha')
})

test('nothing is looked at when the screen cannot be seen, and it says so', async () => {
  const w = await world({ reading: playing({ pageTitle: 'x' }), picture: null })
  const state = await w.recogniser.look()
  assert.match(state.recognition?.why ?? '', /could not see this tab/)
})

test('Vision can be turned off on its own, leaving what pages say', async () => {
  const w = await world({ reading: playing({ pageTitle: 'The Weeknd - Starboy' }), vision: '{"title": "Alpha", "artist": "Beta", "sure": true}' })
  await w.store.saveSettings({ useVision: false })
  const state = await w.recogniser.look()
  assert.equal(w.pictures, 0)
  assert.equal(state.recognition?.method, 'page-metadata', 'the page title is a hint and is marked as one')
  assert.equal(state.recognition?.confidence, 'low')
})

// ---------------------------------------------------------------- nothing playing

test('nothing playing means nothing claimed', async () => {
  const w = await world({ reading: playing({ playing: false }) })
  const state = await w.recogniser.look()
  assert.equal(state.sighting?.playing, false)
  assert.equal(state.recognition, null)
  assert.equal(w.pictures, 0)
})

// ---------------------------------------------------------------- knowing it is already yours

test('a song the person already has is reported as theirs', async () => {
  const w = await world({ reading: playing({ session: { title: 'Mine', artist: 'Someone', album: '', artwork: null } }) })
  await w.store.put({
    id: 'have',
    title: 'Mine',
    artist: 'Someone',
    album: '',
    duration: 200,
    availability: 'local',
    provenance: 'user-file',
    confidence: 'high',
    method: 'file-tags',
    file: 'C:/Music/mine.mp3',
    addedAt: NOW
  })
  const state = await w.recogniser.look()
  assert.equal(state.inLibraryId, 'have')
})

// ---------------------------------------------------------------- which service a page belongs to

test('a page is labelled by where it is, and an unknown host is its own label', () => {
  assert.equal(providerOf('https://music.youtube.com/watch?v=x'), 'youtube-music')
  assert.equal(providerOf('https://www.youtube.com/watch?v=x'), 'youtube')
  assert.equal(providerOf('https://open.spotify.com/track/x'), 'spotify')
  assert.equal(providerOf('https://soundcloud.com/x'), 'soundcloud')
  assert.equal(providerOf('https://example.test/radio'), 'example.test')
  assert.equal(providerOf('not an address'), 'unknown')
})

test('forgetting clears everything worked out, which is what a profile change needs', async () => {
  const w = await world({ reading: playing({ session: { title: 'Alpha', artist: 'Beta', album: '', artwork: null } }) })
  await w.recogniser.look()
  w.recogniser.forget()
  assert.equal(w.recogniser.current().recognition, null)
  assert.equal(w.recogniser.current().sighting, null)
})
