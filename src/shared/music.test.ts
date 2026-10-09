import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  addLabel,
  addRecognised,
  activeSighting,
  addToQueue,
  albums,
  artists,
  bestMatches,
  buttonLabel,
  countsAsPlayed,
  existing,
  fromSighting,
  genres,
  matchDecision,
  matchScore,
  nextInQueue,
  NOTHING_PLAYING,
  plainly,
  playNext,
  playableOffline,
  previousInQueue,
  recognitionKey,
  removeFromQueue,
  reorderQueue,
  sameTrack,
  searchLibrary,
  shuffled,
  splitPageTitle,
  tracksForRule,
  whyNotPlayable,
  worthRecognising,
  worthResuming,
  type MediaSighting,
  type OrbisTrack,
  type PlaybackState
} from './music.ts'

const NOW = Date.parse('2026-10-04T12:00:00Z')

const track = (over: Partial<OrbisTrack> = {}): OrbisTrack => ({
  id: over.id ?? 't1',
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  album: 'After Hours',
  duration: 200,
  availability: 'local',
  provenance: 'user-file',
  confidence: 'high',
  method: 'file-tags',
  file: 'C:/Music/blinding.mp3',
  addedAt: NOW,
  ...over
})

// ---------------------------------------------------------------- what may be claimed

test('only a track with a file Orbis has read can be played with no network', () => {
  assert.equal(playableOffline(track()), true)
  assert.equal(playableOffline(track({ availability: 'reference', file: undefined })), false)
  assert.equal(playableOffline(track({ availability: 'missing' })), false)
  assert.equal(playableOffline(track({ availability: 'local', file: undefined })), false, 'local with no file is not playable')
})

test('every reason a track cannot be played says so in words somebody can act on', () => {
  assert.equal(whyNotPlayable(track()), null)
  assert.match(whyNotPlayable(track({ availability: 'reference' })) ?? '', /no audio for it. Import your own copy/)
  assert.match(whyNotPlayable(track({ availability: 'missing' })) ?? '', /not where it was/)
  assert.match(whyNotPlayable(track({ availability: 'unsupported' })) ?? '', /cannot play this kind/)
})

// ---------------------------------------------------------------- telling one recording from another

test('the same song written three ways is the same song', () => {
  assert.equal(plainly('Blinding Lights (Official Video)'), 'blinding lights')
  assert.equal(plainly('Blinding  Lights [Remastered 2020]'), 'blinding lights')
  assert.equal(plainly('Señorita (feat. Someone)'), 'senorita')
  assert.equal(plainly('BLINDING LIGHTS'), plainly('blinding lights'))
})

test('a match adds up several weak signals and says how sure it is', () => {
  const sure = matchScore({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 201 }, track())
  assert.equal(sure.confidence, 'high')
  assert.ok(sure.why.includes('it is the same length'))

  const titleOnly = matchScore({ title: 'Blinding Lights', artist: 'Somebody Else', album: '', duration: 0 }, track())
  assert.equal(titleOnly.confidence, 'low', 'a shared title alone proves nothing')
})

test('a different length counts against a match, because a live version is not the studio one', () => {
  const live = matchScore({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 320 }, track())
  const studio = matchScore({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200 }, track())
  assert.ok(live.score < studio.score)
  assert.ok(live.why.includes('it is a different length'))
})

test('one clear winner is used; two that both might be it means asking', () => {
  const heard = { title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200 }
  const one = matchDecision(bestMatches(heard, [track()]))
  assert.equal(one.kind, 'use')

  const two = matchDecision(bestMatches(heard, [track({ id: 'a' }), track({ id: 'b', album: 'Single' })]))
  assert.equal(two.kind, 'ask', 'silently picking between two is how the wrong recording gets linked')
  assert.equal(two.kind === 'ask' && two.choices.length, 2)

  assert.equal(matchDecision(bestMatches(heard, [])).kind, 'none')
})

test('the same recording is recognised by file, by size and length, or by name and length', () => {
  assert.equal(sameTrack(track({ id: 'a' }), track({ id: 'b' })), true, 'the same file is the same track')
  assert.equal(sameTrack(track({ id: 'a', file: 'C:/one.mp3' }), track({ id: 'b', file: 'C:/two.mp3' })), true, 'same names and length')
  assert.equal(sameTrack(track({ id: 'a' }), track({ id: 'b', file: 'C:/x.mp3', title: 'Save Your Tears' })), false)
  assert.ok(existing(track({ id: 'new', file: 'C:/elsewhere.mp3' }), [track({ id: 'held' })]))
})

// ---------------------------------------------------------------- the queue

test('shuffle is a real shuffle and keeps the track that is playing where it is', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']
  // A fixed sequence stands in for randomness, so the order is something a test can state.
  const steps = [0.99, 0.5, 0.1, 0.9]
  let n = 0
  const order = shuffled(ids, 'c', () => steps[n++ % steps.length])
  assert.equal(order[0], 'c', 'what is playing does not jump')
  assert.deepEqual([...order].sort(), [...ids].sort(), 'and nothing is lost or repeated')
})

test('shuffle moves things: a thousand goes do not all come back in the same order', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const seen = new Set<string>()
  for (let i = 0; i < 200; i += 1) seen.add(shuffled(ids, null).join(''))
  assert.ok(seen.size > 20, `only ${seen.size} different orders; that is not a shuffle`)
})

test('what comes next follows the queue and the repeat setting', () => {
  const state: PlaybackState = { ...NOTHING_PLAYING, queue: ['a', 'b', 'c'], at: 1, trackId: 'b' }
  assert.equal(nextInQueue(state), 'c')
  assert.equal(nextInQueue({ ...state, at: 2, trackId: 'c' }), null, 'the end is the end')
  assert.equal(nextInQueue({ ...state, at: 2, trackId: 'c', repeat: 'all' }), 'a')
  assert.equal(nextInQueue({ ...state, repeat: 'one' }, true), 'b', 'repeating one plays it again when it finishes')
  assert.equal(nextInQueue({ ...state, repeat: 'one' }, false), 'c', 'but pressing next still moves on')
  assert.equal(previousInQueue(state), 'a')
  assert.equal(previousInQueue({ ...state, at: 0, trackId: 'a' }), 'a', 'the first track stays put')
  assert.equal(previousInQueue({ ...state, at: 0, trackId: 'a', repeat: 'all' }), 'c')
})

test('"play next" means next, and the queue never repeats a track', () => {
  const state: PlaybackState = { ...NOTHING_PLAYING, queue: ['a', 'b', 'c'], at: 0, trackId: 'a' }
  assert.deepEqual(playNext(state, ['c']), { queue: ['a', 'c', 'b'], at: 0 }, 'already queued means moved, not repeated')
  assert.deepEqual(addToQueue(state, ['d']).queue, ['a', 'b', 'c', 'd'])
  assert.deepEqual(addToQueue(state, ['a']).queue, ['b', 'c', 'a'], 'adding what is queued moves it')
})

test('taking one out and moving one keep the track that is playing', () => {
  const state: PlaybackState = { ...NOTHING_PLAYING, queue: ['a', 'b', 'c', 'd'], at: 2, trackId: 'c' }
  assert.deepEqual(removeFromQueue(state, 0), { queue: ['b', 'c', 'd'], at: 1 }, 'the position follows the track')
  assert.deepEqual(removeFromQueue(state, 3).at, 2)
  assert.deepEqual(reorderQueue(state, 0, 3), { queue: ['b', 'c', 'd', 'a'], at: 1 })
  assert.deepEqual(removeFromQueue(state, 9).queue, ['a', 'b', 'c', 'd'], 'a position that is not there changes nothing')
})

// ---------------------------------------------------------------- playing counts, and resuming

test('a second of a preview is not a play; half of it is', () => {
  assert.equal(countsAsPlayed(1, 200), false)
  assert.equal(countsAsPlayed(20, 200), true, 'twenty seconds in is listening')
  assert.equal(countsAsPlayed(3, 10), false)
  assert.equal(countsAsPlayed(5, 10), true, 'half of a short one counts')
  assert.equal(countsAsPlayed(25, 0), true, 'with no known length, twenty seconds is the rule')
})

test('where somebody got to is remembered in the middle, not at either end', () => {
  assert.equal(worthResuming(5, 200), false, 'the first few seconds are not worth a prompt')
  assert.equal(worthResuming(100, 200), true)
  assert.equal(worthResuming(195, 200), false, 'the end is not a place to resume from')
  assert.equal(worthResuming(100, 0), false, 'with no length there is nothing to be in the middle of')
})

// ---------------------------------------------------------------- playlists, including the worked-out kind

test('a rule is asked of the library every time, and answers with real tracks', () => {
  const library = [
    track({ id: '1', favourite: true, playCount: 9, addedAt: NOW - 1000 }),
    track({ id: '2', favourite: false, playCount: 40, title: 'Save Your Tears', file: 'C:/2.mp3', addedAt: NOW - 2000 }),
    track({ id: '3', favourite: true, availability: 'reference', file: undefined, title: 'Starboy', addedAt: NOW })
  ]
  assert.deepEqual(tracksForRule({ favourite: true }, library, NOW).map((t) => t.id), ['3', '1'])
  assert.deepEqual(tracksForRule({ favourite: true, availableOffline: true }, library, NOW).map((t) => t.id), ['1'], 'a rule about offline means a real file')
  assert.deepEqual(tracksForRule({ order: 'plays', limit: 1 }, library, NOW).map((t) => t.id), ['2'])
  assert.deepEqual(tracksForRule({ artist: 'the weeknd', order: 'title' }, library, NOW).length, 3, 'the artist is matched how a person would write it')
})

// ---------------------------------------------------------------- looking through the library

test('search looks at the names a person would search by, and every word has to be there', () => {
  const library = [track({ id: '1' }), track({ id: '2', title: 'Save Your Tears', file: 'C:/2.mp3' }), track({ id: '3', title: 'Starboy', artist: 'Daft Punk', file: 'C:/3.mp3' })]
  assert.deepEqual(searchLibrary(library, { search: 'weeknd blinding' }).map((t) => t.id), ['1'])
  assert.deepEqual(searchLibrary(library, { search: 'daft' }).map((t) => t.id), ['3'])
  assert.deepEqual(searchLibrary(library, { search: 'nothing here' }), [])
  assert.deepEqual(searchLibrary(library, { sort: 'title' }).map((t) => t.title), ['Blinding Lights', 'Save Your Tears', 'Starboy'])
})

test('albums, artists and genres are worked out from the tracks, and what is unknown says so', () => {
  const library = [
    track({ id: '1', trackNumber: 2 }),
    track({ id: '2', title: 'Hardest To Love', trackNumber: 1, file: 'C:/2.mp3' }),
    track({ id: '3', title: 'Elsewhere', album: '', genre: '', artist: '', file: 'C:/3.mp3' })
  ]
  const byAlbum = albums(library)
  assert.equal(byAlbum.length, 2)
  const hours = byAlbum.find((a) => a.name === 'After Hours')!
  assert.deepEqual(hours.tracks.map((t) => t.title), ['Hardest To Love', 'Blinding Lights'], 'in track order')
  assert.ok(byAlbum.some((a) => a.name === 'Unknown album'))
  assert.ok(artists(library).some((a) => a.name === 'Unknown artist'))
  assert.ok(genres(library).some((g) => g.name === 'Unknown'), 'Orbis does not decide what music is')
})

// ---------------------------------------------------------------- what Orbis heard

const sighting = (over: Partial<MediaSighting> = {}): MediaSighting => ({
  sourceId: 's1',
  provider: 'youtube',
  playing: true,
  duration: 200,
  position: 10,
  ...over
})

test('what the page itself says is believed; what it does not say is not invented', () => {
  const said = fromSighting(sighting({ session: { title: 'Blinding Lights', artist: 'The Weeknd' } }), NOW)
  assert.equal(said.method, 'media-session')
  assert.equal(said.confidence, 'high')
  assert.equal(said.names?.title, 'Blinding Lights')

  const silent = fromSighting(sighting({ pageTitle: 'Some Channel' }), NOW)
  assert.equal(silent.names, null)
  assert.match(silent.why ?? '', /does not say what it is playing/)
})

test('a player that says "Untitled" has not told us anything', () => {
  for (const title of ['Untitled', 'unknown', 'Advertisement', 'Loading', 'Now Playing']) {
    assert.equal(fromSighting(sighting({ session: { title, artist: 'x' } }), NOW).names, null, title)
  }
})

test('a page title is split only when it really looks like one, never out of prose', () => {
  assert.deepEqual(splitPageTitle('The Weeknd - Blinding Lights (Official Video) - YouTube'), { title: 'Blinding Lights', artist: 'The Weeknd', album: '' })
  assert.equal(splitPageTitle('How to cook rice. A guide - My Blog'), null, 'a sentence is not a song')
  assert.equal(splitPageTitle('Home'), null)
  assert.equal(splitPageTitle('A - B - C'), null, 'two separators is not a song title')
  assert.equal(fromSighting(sighting({ pageTitle: 'The Weeknd - Blinding Lights' }), NOW).confidence, 'low', 'and it is only ever a hint')
})

test('the same sound asked about twice is the same question', () => {
  const one = sighting({ session: { title: 'Blinding Lights', artist: 'The Weeknd' } })
  assert.equal(recognitionKey(one), recognitionKey({ ...one, position: 180 }), 'where it has got to does not change what it is')
  assert.notEqual(recognitionKey(one), recognitionKey({ ...one, session: { title: 'Starboy', artist: 'The Weeknd' } }))
})

test('nothing is looked at again until it is worth looking at again', () => {
  const last = { sourceId: 's1', names: { title: 'x', artist: 'y', album: '' }, confidence: 'high' as const, method: 'vision' as const, at: NOW }
  assert.equal(worthRecognising(sighting({ playing: false }), null, NOW), false, 'nothing paused is recognised')
  assert.equal(worthRecognising(sighting(), null, NOW), true)
  assert.equal(worthRecognising(sighting(), last, NOW + 1000), false, 'the answer is still good')
  assert.equal(worthRecognising(sighting({ sourceId: 's2' }), last, NOW + 1000), true, 'another sound is another question')
  assert.equal(worthRecognising(sighting(), last, NOW + 11 * 60 * 1000), true, 'and an old answer is asked again')
  const failed = { ...last, names: null }
  assert.equal(worthRecognising(sighting(), failed, NOW + 31_000), true, 'a failure is retried sooner')
})

test('the sound a person means: playing first, then the tab in front, then their own choice', () => {
  const a = sighting({ sourceId: 'a', tabId: '1', playing: false })
  const b = sighting({ sourceId: 'b', tabId: '2', playing: true })
  const c = sighting({ sourceId: 'c', tabId: '3', playing: true })
  assert.equal(activeSighting([a, b, c], null)?.sourceId, 'b', 'playing beats paused')
  assert.equal(activeSighting([a, b, c], null, '3')?.sourceId, 'c', 'the tab in front wins among those playing')
  assert.equal(activeSighting([a, b, c], 'c', '2')?.sourceId, 'c', 'a choice somebody made is kept')
  assert.equal(activeSighting([a, b, c], 'a', '2')?.sourceId, 'b', 'unless what they chose has stopped')
  assert.equal(activeSighting([], null), null)
})

// ---------------------------------------------------------------- keeping what was heard

test('a song the person already has is linked, not copied', () => {
  const outcome = addRecognised({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours' }, 200, [track()], { provider: 'youtube' }, NOW, () => 'new')
  assert.equal(outcome.kind, 'already')
  assert.equal(outcome.kind === 'already' && outcome.track.id, 't1')
})

test('a song with no copy is kept by name, and never claims to have audio', () => {
  const outcome = addRecognised({ title: 'Starboy', artist: 'The Weeknd', album: '' }, 230, [], { provider: 'youtube', url: 'https://example.test/watch' }, NOW, () => 'new')
  assert.equal(outcome.kind, 'reference')
  const kept = outcome.kind === 'reference' ? outcome.track : null
  assert.equal(kept?.availability, 'reference')
  assert.equal(playableOffline(kept!), false)
  assert.equal(kept?.file, undefined, 'there is no file, so there is no file')
  assert.equal(kept?.provenance, 'recognised')
  assert.equal(kept?.source?.provider, 'youtube')
})

test('two files that both might be it means the person is asked', () => {
  const library = [track({ id: 'a' }), track({ id: 'b', file: 'C:/live.mp3', album: 'Live' })]
  const outcome = addRecognised({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours' }, 200, library, { provider: 'youtube' }, NOW, () => 'new')
  assert.equal(outcome.kind, 'ask')
})

test('a name Orbis is not sure of is not kept at all', () => {
  const outcome = addRecognised({ title: 'Untitled', artist: '', album: '' }, 0, [], { provider: 'youtube' }, NOW, () => 'new')
  assert.equal(outcome.kind, 'refused')
  assert.match(outcome.kind === 'refused' ? outcome.why : '', /could not identify/)
})

// ---------------------------------------------------------------- what the buttons say

test('the button never says something has happened before it has', () => {
  assert.equal(addLabel(null, false), 'Add to Orbis Music')
  assert.equal(addLabel(null, true), 'In your music')
  assert.equal(addLabel({ kind: 'reference', track: track() }, false), 'Saved by name', 'not "Downloaded"')
  assert.equal(addLabel({ kind: 'linked', track: track() }, false), 'Added — your copy')
  assert.equal(addLabel({ kind: 'refused', why: 'x' }, false), 'Could not add it')
})

test('the Music button says what is true of the moment', () => {
  const names = { title: 'Blinding Lights', artist: 'The Weeknd', album: '' }
  assert.equal(buttonLabel('idle', null), 'Music')
  assert.equal(buttonLabel('detected', null), 'Music playing')
  assert.equal(buttonLabel('recognising', null), 'Listening…')
  assert.equal(buttonLabel('playing', names), 'Blinding Lights — The Weeknd')
  assert.equal(buttonLabel('recognised', null), 'Music', 'with no name it does not make one up')
})
