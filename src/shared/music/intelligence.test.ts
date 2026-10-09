import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { OrbisTrack } from '../music.ts'
import { featuresOf, similarity, themesOf, transitionScore, type AudioFeatures, type TrackFeatures } from './features.ts'
import { affinity, attribute, emptyTaste, forget, learn, learnDiscoveryAppetite, learnFromSkip, listenEvent, musicDna, newSession, opinionOn, state, weightOf, type MusicEvent } from './taste.ts'
import { inferIntent, parseRequest, resolveIntent, NO_INTENT } from './intent.ts'
import { buildGraph, generate, knownFrom, explorationMap, type Library } from './candidates.ts'
import { emptyModels, learnOutcome, modelFeatures, noveltyOf, predict, rank, refuse, weightsFor, type Candidate, type Known, type Recent } from './ranking.ts'
import { curveFor, energyPlan, planRun, reflow, scoreRun, type QueueEntry } from './sequence.ts'
import { adapt, chooseStrategy, contextKey, creditStrategy, emptyStrategyMemory, newMusicSession, quality, record, rewardOf, sessionEnergy, signalsFrom, startingTuning } from './session.ts'
import { DEFAULT_TUNING } from './config.ts'

const NOW = Date.parse('2026-10-04T20:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const audio = (over: Partial<AudioFeatures> = {}): AudioFeatures => ({
  energy: 0.5,
  tempo: 120,
  danceability: 0.5,
  brightness: 0.5,
  dynamics: 0.4,
  sparseness: 0.3,
  vocalness: 0.6,
  roughness: 0.3,
  measuredAt: NOW,
  version: 1,
  ...over
})

const track = (over: Partial<OrbisTrack> = {}): OrbisTrack => ({
  id: 't1',
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  album: 'After Hours',
  genre: 'Synthwave',
  year: 2020,
  duration: 200,
  availability: 'local',
  provenance: 'user-file',
  confidence: 'high',
  method: 'file-tags',
  file: 'C:/Music/1.mp3',
  addedAt: NOW,
  ...over
})

const featured = (over: Partial<OrbisTrack> = {}, sound: Partial<AudioFeatures> | null = {}): TrackFeatures => featuresOf(track(over), sound === null ? null : audio(sound))

// ---------------------------------------------------------------- what is known, and what is not

test('a track that has not been measured has no measured features, rather than middling ones', () => {
  const unmeasured = featured({}, null)
  assert.equal(unmeasured.audio, null)
  assert.equal(unmeasured.known.has('energy'), false)
  assert.equal(unmeasured.known.has('duration'), true, 'the length is always known')
  assert.equal(unmeasured.known.has('genre'), true)
})

test('similarity is worked out over what two tracks share, and says how much that covered', () => {
  const a = featured({ id: 'a' }, { energy: 0.8 })
  const b = featured({ id: 'b', title: 'Save Your Tears' }, { energy: 0.78 })
  const sound = similarity(a, b, 'sound')
  assert.ok(sound.score > 0.9, String(sound.score))
  assert.ok(sound.confidence > 0.8, 'nearly everything asked for was known')

  const unmeasured = featured({ id: 'c', title: 'Starboy' }, null)
  const partial = similarity(a, unmeasured, 'sound')
  assert.equal(partial.confidence, 0, 'with nothing measured there is nothing to compare')
  assert.equal(partial.score, 0)
})

test('two songs can be alike in one way and not another', () => {
  const quiet2020 = featured({ id: 'a', genre: 'Ambient', year: 2020 }, { energy: 0.2, tempo: 70, danceability: 0.1, brightness: 0.25, roughness: 0.05, sparseness: 0.8 })
  const loud2020 = featured({ id: 'b', title: 'Loud', genre: 'Metal', year: 2020, artist: 'Someone' }, { energy: 0.95, tempo: 170, danceability: 0.85, brightness: 0.9, roughness: 0.9, sparseness: 0.05 })
  const sameEra = similarity(quiet2020, loud2020, 'era')
  const sameSound = similarity(quiet2020, loud2020, 'sound')
  assert.ok(sameEra.score > sameSound.score + 0.3, `the same decade, nothing like the same sound (${sameEra.score} vs ${sameSound.score})`)
  assert.ok(sameSound.score < 0.4, 'and nothing like the same sound')
})

test('a tempo and double that tempo count as the same groove', () => {
  const slow = featured({ id: 'a' }, { tempo: 70 })
  const double = featured({ id: 'b', title: 'Other' }, { tempo: 140 })
  assert.ok(similarity(slow, double, 'sound').score > 0.6)
})

test('what a song is about comes from its title, minus the words that mean nothing', () => {
  assert.deepEqual(themesOf({ title: 'The Lonely Night (Official Video)', genre: 'Pop' }), ['lonely', 'night', 'pop'])
  assert.deepEqual(themesOf({ title: 'A', genre: '' }), [])
})

// ---------------------------------------------------------------- the joins

test('a smooth join scores well and a jarring one does not', () => {
  const calm = featured({ id: 'a' }, { energy: 0.3, tempo: 90, brightness: 0.4 })
  const near = featured({ id: 'b', title: 'Next', artist: 'Another' }, { energy: 0.36, tempo: 92, brightness: 0.45 })
  const jolt = featured({ id: 'c', title: 'Bang', artist: 'Another' }, { energy: 0.95, tempo: 175, brightness: 0.95 })
  const smooth = transitionScore(calm, near)
  const rough = transitionScore(calm, jolt)
  assert.ok(smooth.score > 0.85, String(smooth.score))
  assert.ok(rough.score < 0.5, String(rough.score))
  assert.ok(rough.why.some((one) => /jump up in energy/.test(one)))
})

test('with nothing measured a join is neither praised nor condemned', () => {
  const measured = featured({ id: 'a' })
  const unmeasured = featured({ id: 'b', title: 'Other' }, null)
  const join = transitionScore(measured, unmeasured)
  assert.equal(join.score, 0.5)
  assert.match(join.why[0], /nothing measured/)
})

// ---------------------------------------------------------------- learning what somebody likes

const playedThrough = (trackId: string, at: number): MusicEvent => ({ kind: 'completed', trackId, at })

test('one play is a hint; many are a preference, and the confidence says which', () => {
  let taste = emptyTaste()
  const features = featured()
  taste = learn(taste, playedThrough('t1', NOW), features)
  const once = opinionOn(taste, 'artist', 'the weeknd', NOW)
  assert.ok(once.value > 0, 'it leans positive')
  assert.ok(once.confidence < 0.2, `one play is barely evidence (${once.confidence})`)

  for (let i = 0; i < 20; i += 1) taste = learn(taste, playedThrough('t1', NOW + i * 1000), features)
  const settled = opinionOn(taste, 'artist', 'the weeknd', NOW)
  assert.ok(settled.confidence > 0.85, `twenty plays is a pattern (${settled.confidence})`)
})

test('what somebody says beats what Orbis measured, however much it measured', () => {
  let taste = emptyTaste()
  const features = featured()
  for (let i = 0; i < 40; i += 1) taste = learn(taste, playedThrough('t1', NOW + i * 1000), features)
  assert.ok(opinionOn(taste, 'artist', 'the weeknd', NOW).value > 0.5)

  taste = state(taste, 'artist', 'the weeknd', -1, NOW)
  const after = opinionOn(taste, 'artist', 'the weeknd', NOW)
  assert.equal(after.from, 'explicit')
  assert.equal(after.value, -1, 'the decision wins outright')
})

test('evidence loses its weight over time, and a decision barely does', () => {
  let taste = emptyTaste()
  const features = featured()
  for (let i = 0; i < 10; i += 1) taste = learn(taste, playedThrough('t1', NOW - 200 * DAY + i * 1000), features)
  const old = opinionOn(taste, 'artist', 'the weeknd', NOW)

  let fresh = emptyTaste()
  for (let i = 0; i < 10; i += 1) fresh = learn(fresh, playedThrough('t1', NOW + i * 1000), features)
  const recent = opinionOn(fresh, 'artist', 'the weeknd', NOW)
  assert.ok(recent.confidence >= old.confidence, 'recent evidence counts for at least as much')

  const stated = state(emptyTaste(), 'genre', 'metal', -1, NOW - 300 * DAY)
  assert.equal(opinionOn(stated, 'genre', 'metal', NOW).value, -1, 'a decision from a year ago still stands')
})

test('a sitting can lean one way without changing what somebody likes', () => {
  let taste = emptyTaste()
  const calm = featured({ id: 'c', genre: 'Ambient', artist: 'Someone' }, { energy: 0.2 })
  for (let i = 0; i < 6; i += 1) taste = learn(taste, playedThrough('c', NOW + i * 1000), calm)
  const during = opinionOn(taste, 'genre', 'ambient', NOW)
  assert.ok(during.value > 0)

  const after = newSession(taste)
  const later = opinionOn(after, 'genre', 'ambient', NOW)
  assert.ok(later.confidence <= during.confidence, 'the session layer is gone and only the slower layers remain')
  assert.equal(after.session.by.genre.ambient, undefined)
})

test('how much of a track was heard decides what the event is', () => {
  assert.equal(listenEvent(3, 200, 'skipped'), 'skipped-early')
  assert.equal(listenEvent(35, 200, 'skipped'), 'played-30s')
  assert.equal(listenEvent(120, 200, 'skipped'), 'played-half')
  assert.equal(listenEvent(199, 200, 'ended'), 'completed')
  // Under twenty seconds is a skip however it is counted: ten seconds of a four-minute track is not a listen.
  assert.equal(listenEvent(12, 200, 'skipped'), 'skipped-early')
  assert.equal(listenEvent(12, 20, 'skipped'), 'played-half', 'but twelve seconds of a twenty-second track is most of it')
})

test('a suggestion refused counts for more than a choice of their own dropped', () => {
  const theirs: MusicEvent = { kind: 'skipped-early', trackId: 't', at: NOW, chosenBy: 'person' }
  const ours: MusicEvent = { kind: 'skipped-early', trackId: 't', at: NOW, chosenBy: 'orbis' }
  assert.ok(Math.abs(weightOf(ours)) > Math.abs(weightOf(theirs)))
})

// ---------------------------------------------------------------- what a skip meant

test('a skip blames what stands out, not the whole genre', () => {
  let taste = emptyTaste()
  const liked = [featured({ id: 'a', genre: 'Synthwave', artist: 'The Weeknd' }, { energy: 0.6 }), featured({ id: 'b', title: 'Two', genre: 'Synthwave', artist: 'Kavinsky' }, { energy: 0.62 })]
  for (const one of liked) for (let i = 0; i < 8; i += 1) taste = learn(taste, playedThrough(one.trackId, NOW + i * 1000), one)

  // Same genre they clearly like, but a very different artist and a very different energy.
  const skipped = featured({ id: 'z', title: 'Screaming', genre: 'Synthwave', artist: 'Nobody At All' }, { energy: 0.98 })
  const blame = attribute(taste, skipped, liked, NOW)
  const blamed = blame.map((one) => `${one.dimension}:${one.name}`)
  assert.ok(blame.length > 0, 'something was blamed')
  assert.equal(blamed.includes('genre:synthwave'), false, 'not the genre they demonstrably like')
  assert.ok(blamed.some((one) => one.startsWith('artist:')) || blamed.some((one) => one.startsWith('energy:')), blamed.join(','))
})

test('learning from a skip moves what was blamed and leaves the rest alone', () => {
  let taste = emptyTaste()
  const liked = [featured({ id: 'a', genre: 'Pop', artist: 'Liked Artist' })]
  for (let i = 0; i < 10; i += 1) taste = learn(taste, playedThrough('a', NOW + i * 1000), liked[0])
  const before = opinionOn(taste, 'genre', 'pop', NOW).value

  const skipped = featured({ id: 'z', title: 'Nope', genre: 'Pop', artist: 'Unknown Person' })
  taste = learnFromSkip(taste, { kind: 'skipped-early', trackId: 'z', at: NOW + 20_000, chosenBy: 'orbis' }, skipped, liked)

  const after = opinionOn(taste, 'genre', 'pop', NOW + 20_000).value
  assert.ok(after > before - 0.15, `the liked genre was barely touched (${before} -> ${after})`)
  assert.ok(opinionOn(taste, 'artist', 'unknown person', NOW + 20_000).value < 0, 'and the unknown artist took the blame')
})

test('one skip with nothing to compare against moves almost nothing', () => {
  const taste = learnFromSkip(emptyTaste(), { kind: 'skipped-early', trackId: 'z', at: NOW, chosenBy: 'orbis' }, featured({ id: 'z' }), [])
  const opinion = opinionOn(taste, 'genre', 'synthwave', NOW)
  // What matters is how much it counts, not which way it leans: one skip must not become a verdict.
  assert.ok(Math.abs(opinion.value * opinion.confidence) < 0.3, `a fresh profile is not condemned by one skip (${opinion.value} at ${opinion.confidence})`)
  assert.ok(opinion.confidence < 0.25, 'and Orbis knows it hardly knows anything')
})

test('forgetting something removes it from every layer', () => {
  let taste = state(emptyTaste(), 'artist', 'the weeknd', 1, NOW)
  taste = learn(taste, playedThrough('t1', NOW), featured())
  taste = forget(taste, 'artist', 'the weeknd')
  assert.equal(opinionOn(taste, 'artist', 'the weeknd', NOW).from, 'none')
})

// ---------------------------------------------------------------- how much somebody wants a track

test('affinity is near nothing when nothing is known, and says so', () => {
  const answer = affinity(emptyTaste(), featured(), NOW)
  assert.equal(answer.score, 0)
  assert.equal(answer.confidence, 0)
  assert.deepEqual(answer.because, [])
})

test('affinity rises with evidence and explains itself', () => {
  let taste = emptyTaste()
  const features = featured()
  for (let i = 0; i < 15; i += 1) taste = learn(taste, playedThrough('t1', NOW + i * 1000), features)
  const answer = affinity(taste, features, NOW)
  assert.ok(answer.score > 0.4, String(answer.score))
  assert.ok(answer.confidence > 0.3)
  assert.ok(answer.because.length > 0)
  assert.ok(answer.because.some((one) => one.dimension === 'artist'))
})

// ---------------------------------------------------------------- reading a request

test('a request becomes constraints, and what it could not read is reported', () => {
  const { intent, notUnderstood } = parseRequest('Give me 45 minutes of calm Tamil songs I haven\'t heard', NOW)
  assert.equal(intent.source, 'stated')
  assert.equal(intent.constraints.duration, 2700)
  assert.equal(intent.constraints.heard, 'only-new')
  assert.deepEqual(intent.constraints.only?.[0], { dimension: 'language', values: ['tamil'] })
  assert.equal(intent.intent, 'calm')
  assert.deepEqual(notUnderstood, [])
})

test('a request nobody can read says so rather than guessing', () => {
  const { intent, notUnderstood } = parseRequest('ptgjfkd something qqq', NOW)
  assert.equal(intent.confidence, 0)
  assert.equal(notUnderstood.length, 1)
})

test('"no rap tonight" is a refusal with an end to it, not a change of taste', () => {
  const { intent } = parseRequest('No rap tonight', NOW)
  assert.deepEqual(intent.constraints.exclude?.[0], { dimension: 'genre', values: ['rap'] })
  assert.ok(intent.until && intent.until > NOW, 'it stops applying later')
})

test('directions, decades, counts and shares are all read', () => {
  assert.equal(parseRequest('make it calmer', NOW).intent.constraints.energy?.direction, 'down')
  assert.equal(parseRequest('more energetic please', NOW).intent.constraints.energy?.direction, 'up')
  assert.equal(parseRequest('something darker', NOW).intent.constraints.brightness?.direction, 'down')
  assert.deepEqual(parseRequest('give me 2010s songs', NOW).intent.constraints.prefer?.[0], { dimension: 'era', values: ['2010'] })
  assert.equal(parseRequest('keep the next five songs familiar', NOW).intent.constraints.count, 5)
  assert.equal(parseRequest('70% familiar songs', NOW).intent.constraints.familiarShare, 0.7)
  assert.equal(parseRequest('mostly new', NOW).intent.constraints.familiarShare, 0.25)
})

test('a named way of listening becomes real numbers', () => {
  const sleep = parseRequest('play something for sleep', NOW).intent
  assert.equal(sleep.intent, 'sleep')
  assert.ok((sleep.constraints.energy?.target ?? 1) < 0.2, 'sleep is quiet by numbers, not by label')
  const workout = parseRequest('gym playlist', NOW).intent
  assert.ok((workout.constraints.energy?.target ?? 0) > 0.7)
  assert.equal(workout.constraints.energy?.direction, 'up')
})

test('what is happening is read as a guess, and never as a decision', () => {
  const guess = inferIntent({ played: 8, skips: 6, completions: 1, replays: 0, energy: 0.8, artists: 5, minutes: 12, hour: 20, manualChoices: 0 }, NOW)
  assert.equal(guess.source, 'inferred')
  assert.ok(guess.confidence < 0.5, 'a guess is never confident')
  assert.ok((guess.constraints.discovery ?? 1) < 0.2, 'lots of skipping means stop experimenting')
})

test('what was said wins, and what was guessed fills the gaps', () => {
  const said = parseRequest('no rap tonight', NOW).intent
  const mode = parseRequest('focus', NOW).intent
  const guess = inferIntent({ played: 5, skips: 0, completions: 4, replays: 0, energy: 0.7, artists: 3, minutes: 20, hour: 20, manualChoices: 0 }, NOW)
  const resolved = resolveIntent(said, mode, guess, NOW)
  assert.ok(resolved.constraints.exclude?.some((one) => one.values.includes('rap')), 'the refusal stands')
  assert.ok(resolved.constraints.energy, 'and the mode filled in what the refusal did not say')
})

test('a request that has expired no longer applies', () => {
  const said = parseRequest('no rap tonight', NOW).intent
  const later = resolveIntent(said, null, NO_INTENT, NOW + 20 * 60 * 60 * 1000)
  assert.equal(later.constraints.exclude, undefined)
})

// ---------------------------------------------------------------- finding things to consider

const libraryOf = (tracks: { features: TrackFeatures; playCount?: number; lastPlayedAt?: number | null; favourite?: boolean; everCompleted?: boolean }[]): Library => ({
  features: tracks.map((one) => one.features),
  stats: new Map(tracks.map((one) => [one.features.trackId, { playCount: one.playCount ?? 0, lastPlayedAt: one.lastPlayedAt ?? null, favourite: one.favourite ?? false, everCompleted: one.everCompleted ?? false }]))
})

const sampleLibrary = (): Library =>
  libraryOf([
    { features: featured({ id: '1', title: 'Known One', artist: 'Liked', genre: 'Pop' }, { energy: 0.6 }), playCount: 10, lastPlayedAt: NOW - 2 * DAY, favourite: true, everCompleted: true },
    { features: featured({ id: '2', title: 'Known Two', artist: 'Liked', genre: 'Pop' }, { energy: 0.62 }), playCount: 4, lastPlayedAt: NOW - 5 * DAY, everCompleted: true },
    { features: featured({ id: '3', title: 'Old Love', artist: 'Forgotten', genre: 'Pop' }, { energy: 0.55 }), playCount: 6, lastPlayedAt: NOW - 120 * DAY, favourite: true },
    { features: featured({ id: '4', title: 'Never Heard', artist: 'Stranger', genre: 'Pop' }, { energy: 0.58 }) },
    { features: featured({ id: '5', title: 'Other Thing', artist: 'Elsewhere', genre: 'Metal' }, { energy: 0.95, tempo: 178, danceability: 0.4, brightness: 0.9, roughness: 0.95, sparseness: 0.05 }) },
    { features: featured({ id: '6', title: 'Quiet Thing', artist: 'Hush', genre: 'Ambient' }, { energy: 0.15, tempo: 62, danceability: 0.08, brightness: 0.2, roughness: 0.05, sparseness: 0.85 }) }
  ])

test('candidates come from several directions, and each says where it came from', () => {
  const library = sampleLibrary()
  const graph = buildGraph(library)
  const pool = generate({ library, graph, taste: emptyTaste(), intent: NO_INTENT, seed: library.features[0], exclude: new Set(), strategy: 'safe', now: NOW })
  const sources = new Set(pool.candidates.flatMap((one) => one.sources))
  assert.ok(sources.size >= 3, `only ${[...sources].join(',')}`)
  assert.ok(sources.has('favourite'))
  assert.ok(pool.candidates.some((one) => one.sources.includes('unheard')), 'something never heard was offered')
  assert.equal(pool.candidates.some((one) => one.trackId === '1'), false, 'the seed is not offered back')
})

test('what is playing is never proposed again, and nor is anything excluded', () => {
  const library = sampleLibrary()
  const graph = buildGraph(library)
  const pool = generate({ library, graph, taste: emptyTaste(), intent: NO_INTENT, seed: library.features[0], exclude: new Set(['2', '3']), strategy: 'safe', now: NOW })
  assert.equal(pool.candidates.some((one) => ['2', '3'].includes(one.trackId)), false)
})

test('asking for discovery brings more unheard things forward', () => {
  const library = sampleLibrary()
  const graph = buildGraph(library)
  const safe = generate({ library, graph, taste: emptyTaste(), intent: NO_INTENT, seed: library.features[0], exclude: new Set(), strategy: 'safe', now: NOW })
  const exploring = generate({ library, graph, taste: emptyTaste(), intent: { ...NO_INTENT, constraints: { discovery: 0.8 } }, seed: library.features[0], exclude: new Set(), strategy: 'discovery', now: NOW })
  const unheardIn = (pool: typeof safe): number => pool.candidates.filter((one) => one.sources.includes('unheard')).length
  assert.ok(unheardIn(exploring) >= unheardIn(safe))
})

test('the graph relates artists through what their tracks share', () => {
  const library = sampleLibrary()
  const graph = buildGraph(library)
  const related = graph.relatedArtists.get('liked') ?? []
  assert.ok(related.some((one) => one.artist === 'forgotten' || one.artist === 'stranger'), JSON.stringify(related))
  assert.equal(related.some((one) => one.artist === 'hush'), false, 'and not something with nothing in common')
})

test('what has been explored and what has not is counted from real plays', () => {
  const map = explorationMap(sampleLibrary(), emptyTaste(), NOW)
  const pop = map.genres.find((one) => one.name === 'pop')!
  assert.equal(pop.total, 4)
  assert.equal(pop.played, 3)
  const ambient = map.genres.find((one) => one.name === 'ambient')!
  assert.equal(ambient.played, 0, 'never played is never played')
})

// ---------------------------------------------------------------- ranking

const known = (library: Library): Known => knownFrom(library)
const noRecent: Recent = { trackIds: [], artistKeys: [], genres: [] }

const candidateFor = (features: TrackFeatures, over: Partial<Candidate> = {}): Candidate => ({
  trackId: features.trackId,
  features,
  sources: ['library'],
  retrieval: 0.5,
  lastPlayedDaysAgo: null,
  playCount: 0,
  favourite: false,
  everCompleted: false,
  ...over
})

test('what is not allowed is refused outright, with a reason', () => {
  const one = candidateFor(featured({ id: 'x', genre: 'Metal' }))
  assert.match(refuse(one, { exclude: [{ dimension: 'genre', values: ['metal'] }] }, noRecent, DEFAULT_TUNING, known(sampleLibrary())) ?? '', /excluded/)
  assert.match(refuse(one, { only: [{ dimension: 'genre', values: ['pop'] }] }, noRecent, DEFAULT_TUNING, known(sampleLibrary())) ?? '', /not one of the asked-for/)
  assert.equal(refuse(one, {}, noRecent, DEFAULT_TUNING, known(sampleLibrary())), null)
})

test('a track just played, or an artist just played, is held back', () => {
  const one = candidateFor(featured({ id: 'x' }))
  const recent: Recent = { trackIds: ['x'], artistKeys: ['the weeknd'], genres: [] }
  assert.match(refuse(one, {}, recent, DEFAULT_TUNING, known(sampleLibrary())) ?? '', /tracks ago/)
})

test('what somebody asked for changes the weights, not just the wording', () => {
  const discovery = weightsFor(parseRequest('surprise me', NOW).intent, DEFAULT_TUNING)
  const familiar = weightsFor(parseRequest('play my favourites', NOW).intent, DEFAULT_TUNING)
  assert.ok(discovery.novelty > familiar.novelty, 'discovery leans on novelty')
  assert.ok(familiar.personal > discovery.personal, 'familiar leans on what they like')
  const sleep = weightsFor(parseRequest('music for sleep', NOW).intent, DEFAULT_TUNING)
  assert.ok(Math.abs(sleep.skip) > Math.abs(discovery.skip), 'for sleep, not being skipped matters most')
  assert.ok(sleep.transition > discovery.transition, 'and the joins matter more')
})

test('novelty is measured in each of the ways something can be new', () => {
  const library = sampleLibrary()
  const fresh = noveltyOf(candidateFor(featured({ id: 'new', artist: 'Nobody Known', genre: 'Jazz', year: 1965 })), known(library))
  assert.ok(fresh.newArtist && fresh.newGenre && fresh.newEra && fresh.neverPlayed)
  assert.ok(fresh.score > 0.8)
  const familiar = noveltyOf(candidateFor(library.features[0], { playCount: 10 }), known(library))
  assert.ok(familiar.score < 0.2)
})

test('the four predictions are separate, and say how little they know at first', () => {
  const models = emptyModels()
  const answer = predict(models, candidateFor(featured()), emptyTaste(), NO_INTENT, NOW)
  assert.equal(answer.confidence, 0, 'a model that has seen nothing is worth nothing')
  assert.ok(answer.skip >= 0 && answer.skip <= 1)
  assert.ok(answer.replay < answer.complete, 'going back to a track is rarer than finishing it')
})

test('the models learn from what happened, within bounds', () => {
  let models = emptyModels()
  const features = modelFeatures(candidateFor(featured(), { favourite: true }), emptyTaste(), NO_INTENT, NOW)
  const before = predict(models, candidateFor(featured(), { favourite: true }), emptyTaste(), NO_INTENT, NOW)
  for (let i = 0; i < 80; i += 1) models = learnOutcome(models, 'complete', features, true)
  const after = predict(models, candidateFor(featured(), { favourite: true }), emptyTaste(), NO_INTENT, NOW)
  assert.ok(after.complete > before.complete, 'it learned that these get finished')
  // `confidence` is over all four outcomes, so training one of them moves a quarter of it. That is the honest
  // reading: Orbis knows something about finishing and still nothing about replays.
  assert.ok(after.confidence > before.confidence, 'and it is worth more than it was')
  assert.equal(models.complete.seen, 80)
  assert.equal(models.replay.seen, 0, 'and nothing was claimed about the outcomes it never saw')
  for (const weight of Object.values(models.complete.weights)) assert.ok(Math.abs(weight) <= 4, 'no weight runs away')
})

test('ranking narrows, orders, and says why each one was dropped', () => {
  const library = sampleLibrary()
  let taste = emptyTaste()
  for (let i = 0; i < 12; i += 1) taste = learn(taste, playedThrough('1', NOW + i * 1000), library.features[0])
  const candidates = library.features.map((one) => candidateFor(one))
  const result = rank(candidates, {
    taste,
    models: emptyModels(),
    intent: NO_INTENT,
    context: { previous: library.features[0], sessionEnergy: 0.6, hour: 20, offlineOnly: false },
    known: known(library),
    recent: { trackIds: ['1'], artistKeys: ['liked'], genres: [] },
    tuning: DEFAULT_TUNING,
    now: NOW
  })
  assert.ok(result.chosen.length > 0)
  assert.ok(result.rejected.some((one) => /tracks ago/.test(one.why)), 'the just-played track was refused with a reason')
  assert.ok(result.chosen[0].because.length > 0, 'and the winner can explain itself')
  assert.ok(result.chosen.every((one) => one.trackId !== '1'))
})

test('every part of a score is recorded, so a choice can be taken apart', () => {
  const library = sampleLibrary()
  const result = rank(library.features.map((one) => candidateFor(one)), {
    taste: emptyTaste(),
    models: emptyModels(),
    intent: NO_INTENT,
    context: { previous: null, sessionEnergy: null, hour: 20, offlineOnly: false },
    known: known(library),
    recent: noRecent,
    tuning: DEFAULT_TUNING,
    now: NOW
  })
  const top = result.chosen[0]
  assert.ok(Object.keys(top.parts).length > 5, JSON.stringify(top.parts))
  assert.ok('skip' in top.parts && 'novelty' in top.parts && 'transition' in top.parts)
})

// ---------------------------------------------------------------- arranging a run

test('the shape a request asks for becomes an actual plan', () => {
  const workout = curveFor(parseRequest('workout playlist', NOW).intent, DEFAULT_TUNING, 0.4)
  assert.ok((workout.energyTo ?? 0) > (workout.energyFrom ?? 1), 'a workout climbs')
  const sleep = curveFor(parseRequest('sleep music', NOW).intent, DEFAULT_TUNING, 0.5)
  assert.ok((sleep.energyTo ?? 1) < (sleep.energyFrom ?? 0), 'sleep descends')
  assert.ok(sleep.maxStep < workout.maxStep, 'and it descends gently')
  const plan = energyPlan(sleep, 4)
  assert.equal(plan.length, 4)
  assert.ok((plan[3] ?? 1) < (plan[0] ?? 0))
})

test('a run is judged on how it moves, not only on its tracks', () => {
  const previous = featured({ id: 'p' }, { energy: 0.3 })
  const smooth = [0.35, 0.42, 0.5, 0.58].map((energy, index) => ({ ...candidateFor(featured({ id: `s${index}`, title: `S${index}`, artist: `A${index}` }, { energy })), score: 1, confidence: 0.5, parts: {}, predictions: { skip: 0.2, complete: 0.8, replay: 0.1, favourite: 0.1, confidence: 0.5 }, novelty: noveltyOf(candidateFor(featured()), known(sampleLibrary())), because: [] }))
  const jumpy = [0.9, 0.2, 0.95, 0.15].map((energy, index) => ({ ...smooth[index], features: featured({ id: `j${index}`, title: `J${index}`, artist: `B${index}` }, { energy }) }))
  const curve = curveFor(parseRequest('build the energy', NOW).intent, DEFAULT_TUNING, 0.3)
  const good = scoreRun(smooth, previous, curve, new Set())
  const bad = scoreRun(jumpy, previous, curve, new Set())
  assert.ok(good.score > bad.score, `${good.score} should beat ${bad.score}`)
  assert.ok(bad.notes.some((one) => /jumps about/.test(one)))
})

test('a run does not put the same artist back to back', () => {
  const same = ['x', 'y', 'z'].map((id) => ({ ...candidateFor(featured({ id, title: id, artist: 'One Artist' })), score: 1, confidence: 0.5, parts: {}, predictions: { skip: 0.2, complete: 0.8, replay: 0.1, favourite: 0.1, confidence: 0.5 }, novelty: noveltyOf(candidateFor(featured()), known(sampleLibrary())), because: [] }))
  const curve = curveFor(NO_INTENT, DEFAULT_TUNING, 0.5)
  const scored = scoreRun(same, null, curve, new Set())
  assert.ok(scored.notes.some((one) => /artist comes round again/.test(one)))
})

test('planning picks a run, and the run is at most as long as asked for', () => {
  const library = sampleLibrary()
  const ranked = rank(library.features.map((one) => candidateFor(one)), {
    taste: emptyTaste(),
    models: emptyModels(),
    intent: NO_INTENT,
    context: { previous: null, sessionEnergy: null, hour: 20, offlineOnly: false },
    known: known(library),
    recent: noRecent,
    tuning: DEFAULT_TUNING,
    now: NOW
  })
  const planned = planRun(ranked.chosen, { previous: null, curve: curveFor(NO_INTENT, DEFAULT_TUNING, null), known: new Set(['1', '2']), length: 4 })
  assert.ok(planned.run.length > 0 && planned.run.length <= 4)
  assert.equal(new Set(planned.run.map((one) => one.trackId)).size, planned.run.length, 'and nothing twice')
})

// ---------------------------------------------------------------- the queue

test('what somebody pinned or added by hand is never moved', () => {
  const queue: QueueEntry[] = [
    { trackId: 'a', origin: 'manual' },
    { trackId: 'b', origin: 'orbis' },
    { trackId: 'c', origin: 'locked' },
    { trackId: 'd', origin: 'orbis' }
  ]
  const after = reflow(queue, [{ trackId: 'x', origin: 'orbis' }, { trackId: 'y', origin: 'orbis' }])
  assert.deepEqual(after.map((one) => one.trackId), ['a', 'x', 'c', 'y'])
})

test('a queue of nothing but the person\'s own choices is left exactly as it is', () => {
  const queue: QueueEntry[] = [
    { trackId: 'a', origin: 'manual' },
    { trackId: 'b', origin: 'locked' }
  ]
  assert.deepEqual(reflow(queue, [{ trackId: 'x', origin: 'orbis' }]).map((one) => one.trackId), ['a', 'b', 'x'], 'the suggestion goes on the end rather than over anything')
})

// ---------------------------------------------------------------- the sitting

test('a sitting is judged over the whole thing, not on one skip', () => {
  let session = newMusicSession('s1', NOW)
  const play = (id: string, outcome: 'completed' | 'skipped-early'): void => {
    session = record(session, { kind: 'play-started', trackId: id, at: NOW, chosenBy: 'orbis' }, 0.5)
    session = record(session, { kind: outcome, trackId: id, at: NOW + 1000, seconds: outcome === 'completed' ? 200 : 4 }, 0.5)
  }
  play('a', 'completed')
  play('b', 'completed')
  play('c', 'skipped-early')
  play('d', 'completed')
  assert.ok((session.quality ?? 0) > 0.5, `one skip in four is going well (${session.quality})`)

  let bad = newMusicSession('s2', NOW)
  for (const id of ['a', 'b', 'c', 'd']) {
    bad = record(bad, { kind: 'play-started', trackId: id, at: NOW, chosenBy: 'orbis' }, 0.5)
    bad = record(bad, { kind: 'skipped-early', trackId: id, at: NOW + 1000, seconds: 3 }, 0.5)
  }
  assert.ok((bad.quality ?? 1) < 0.35, `four skips in four is not (${bad.quality})`)
})

test('nothing is claimed about a sitting that has barely started', () => {
  let session = newMusicSession('s', NOW)
  session = record(session, { kind: 'play-started', trackId: 'a', at: NOW, chosenBy: 'person' }, 0.5)
  assert.equal(session.quality, null)
  assert.equal(quality(session), null)
})

test('the energy of a sitting leans on what just happened', () => {
  let session = newMusicSession('s', NOW)
  for (const [id, energy] of [['a', 0.2], ['b', 0.25], ['c', 0.9], ['d', 0.95]] as const) {
    session = record(session, { kind: 'play-started', trackId: id, at: NOW, chosenBy: 'person' }, energy)
  }
  const energy = sessionEnergy(session, new Map())
  assert.ok(energy !== null && energy > 0.6, `${energy} should lean towards the recent loud ones`)
})

test('what a sitting looks like is what intent is guessed from', () => {
  let session = newMusicSession('s', NOW)
  for (const id of ['a', 'b', 'c']) {
    session = record(session, { kind: 'play-started', trackId: id, at: NOW, chosenBy: 'person' }, 0.3)
    session = record(session, { kind: 'completed', trackId: id, at: NOW + 1000, seconds: 200 }, 0.3)
  }
  const signals = signalsFrom(session, NOW + 30 * 60 * 1000)
  assert.equal(signals.played, 3)
  assert.equal(signals.completions, 3)
  assert.equal(signals.manualChoices, 3)
  assert.ok(signals.minutes > 29)
})

// ---------------------------------------------------------------- which way of choosing

test('a way of choosing that has worked here is used again', () => {
  let memory = emptyStrategyMemory()
  const context = contextKey('focus', 20, 0.7)
  for (let i = 0; i < 8; i += 1) memory = creditStrategy(memory, context, 'context', 0.9, NOW)
  for (let i = 0; i < 8; i += 1) memory = creditStrategy(memory, context, 'discovery', 0.1, NOW)
  const chosen = chooseStrategy(memory, context, undefined, 0, () => 0.99)
  assert.equal(chosen.strategy, 'context')
  assert.match(chosen.why, /worked here before/)
})

test('something untried is tried, because unknown is not the same as bad', () => {
  let memory = emptyStrategyMemory()
  const context = contextKey('unspecified', 14, null)
  for (let i = 0; i < 20; i += 1) memory = creditStrategy(memory, context, 'safe', 0.55, NOW)
  // With exploration allowed, something other than the known-middling option comes up.
  const seen = new Set<string>()
  let roll = 0
  for (let i = 0; i < 40; i += 1) {
    roll += 0.025
    seen.add(chooseStrategy(memory, context, undefined, 0.4, () => roll % 1).strategy)
  }
  assert.ok(seen.size > 1, `only ever chose ${[...seen].join(',')}`)
})

test('what was asked for is respected unless it has actually been going badly', () => {
  let memory = emptyStrategyMemory()
  const context = contextKey('discovery', 20, 0.2)
  assert.equal(chooseStrategy(memory, context, 'discovery', 0, () => 0.99).strategy, 'discovery')
  for (let i = 0; i < 10; i += 1) memory = creditStrategy(memory, context, 'discovery', 0.05, NOW)
  assert.notEqual(chooseStrategy(memory, context, 'discovery', 0, () => 0.99).strategy, 'discovery', 'ten bad runs is enough to try something else')
})

test('what a track did is what the strategy is credited with', () => {
  assert.equal(rewardOf('completed', {}), 0.75)
  assert.equal(rewardOf('skipped-early', {}), 0.05)
  assert.equal(rewardOf('completed', { favourited: true }), 1)
  assert.ok(rewardOf('skipped-early', { replayed: true }) > 0.8, 'a replay outweighs how it ended')
})

// ---------------------------------------------------------------- the knobs

test('the knobs move towards what is working, and can never reach an extreme', () => {
  let tuning = startingTuning()
  let session = newMusicSession('s', NOW)
  for (let i = 0; i < 6; i += 1) session = { ...session, discoveryOffered: session.discoveryOffered + 1, discoveryAccepted: session.discoveryAccepted + 1 }
  for (let i = 0; i < 50; i += 1) tuning = adapt(tuning, session)
  assert.ok(tuning.discovery.value <= tuning.discovery.max, 'bounded above')
  assert.ok(tuning.discovery.value > startingTuning().discovery.value, 'and it did move')

  let refusing = newMusicSession('s2', NOW)
  for (let i = 0; i < 8; i += 1) refusing = { ...refusing, discoveryOffered: refusing.discoveryOffered + 1 }
  let down = startingTuning()
  for (let i = 0; i < 50; i += 1) down = adapt(down, refusing)
  assert.ok(down.discovery.value >= down.discovery.min, 'bounded below')
  assert.ok(down.discovery.value < startingTuning().discovery.value)
})

test('lots of skipping makes Orbis care more about the joins and repeat artists less', () => {
  let session = newMusicSession('s', NOW)
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
    session = record(session, { kind: 'play-started', trackId: id, at: NOW, chosenBy: 'orbis' }, 0.5)
    session = record(session, { kind: 'skipped-early', trackId: id, at: NOW + 1000, seconds: 3 }, 0.5)
  }
  const after = adapt(startingTuning(), session)
  assert.ok(after.transitionCare.value > startingTuning().transitionCare.value)
  assert.ok(after.artistGap.value > startingTuning().artistGap.value)
})

// ---------------------------------------------------------------- how much new music to offer

test('how much new music to offer is learned from what happened to the last lot', () => {
  let taste = emptyTaste()
  for (let i = 0; i < 10; i += 1) taste = learnDiscoveryAppetite(taste, true, NOW + i * 1000)
  const keen = taste.discoveryAppetite.value
  let other = emptyTaste()
  for (let i = 0; i < 10; i += 1) other = learnDiscoveryAppetite(other, false, NOW + i * 1000)
  assert.ok(keen > other.discoveryAppetite.value)
  assert.ok(keen <= 1 && other.discoveryAppetite.value >= 0)
})

// ---------------------------------------------------------------- the summary

test('the summary shows nothing it does not know', () => {
  const empty = musicDna(emptyTaste())
  assert.deepEqual(empty.readings, [])
  assert.deepEqual(empty.topArtists, [])
  assert.equal(empty.events, 0)
})

test('the summary fills in as evidence arrives, with how much is behind each reading', () => {
  let taste = emptyTaste()
  const loud = featured({ id: 'l', artist: 'Loud Act', genre: 'Rock' }, { energy: 0.9, danceability: 0.8, tempo: 150 })
  for (let i = 0; i < 12; i += 1) taste = learn(taste, playedThrough('l', NOW + i * 1000), loud)
  const dna = musicDna(taste)
  const energy = dna.readings.find((one) => one.name === 'Energy')
  assert.ok(energy, JSON.stringify(dna.readings))
  assert.ok(energy!.value > 60, `${energy!.value} should read as energetic`)
  assert.ok(energy!.evidence >= 12)
  assert.ok(dna.topArtists.some((one) => one.name === 'loud act'))
  assert.ok(dna.topGenres.some((one) => one.name === 'rock'))
})

// ---------------------------------------------------------------- the whole loop

test('the loop runs: play, learn, choose again, and the choice changes', () => {
  const library = sampleLibrary()
  const graph = buildGraph(library)
  let taste = emptyTaste()
  let models = emptyModels()
  let session = newMusicSession('s', NOW)

  const pick = (): string => {
    const pool = generate({ library, graph, taste, intent: NO_INTENT, seed: library.features[0], exclude: new Set(['1']), strategy: 'safe', now: NOW })
    const ranked = rank(pool.candidates, {
      taste,
      models,
      intent: NO_INTENT,
      context: { previous: library.features[0], sessionEnergy: 0.6, hour: 20, offlineOnly: false },
      known: known(library),
      recent: { trackIds: ['1'], artistKeys: [], genres: [] },
      tuning: DEFAULT_TUNING,
      now: NOW
    })
    return ranked.chosen[0]?.trackId ?? ''
  }

  const first = pick()
  assert.ok(first, 'something was chosen')

  // Skipping it, over and over, teaches the models and the taste that it is wrong.
  const skipped = library.features.find((one) => one.trackId === first)!
  for (let i = 0; i < 10; i += 1) {
    const event: MusicEvent = { kind: 'skipped-early', trackId: first, at: NOW + i * 60_000, seconds: 3, chosenBy: 'orbis' }
    taste = learnFromSkip(taste, event, skipped, [library.features[0]])
    models = learnOutcome(models, 'skip', modelFeatures(candidateFor(skipped), taste, NO_INTENT, NOW), true)
    // Started, then skipped: a skip with no start is not a track that was played, and the sitting should not count it.
    session = record(session, { kind: 'play-started', trackId: first, at: NOW + i * 60_000, chosenBy: 'orbis' }, skipped.audio?.energy ?? null, 'safe')
    session = record(session, event, skipped.audio?.energy ?? null, 'safe')
  }
  const second = pick()
  assert.notEqual(second, first, 'ten skips later it offers something else')
  assert.ok((session.quality ?? 1) < 0.4, 'and it knows the sitting is going badly')
})
