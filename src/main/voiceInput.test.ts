import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCURATE_MODEL,
  checkAudio,
  classifyStatus,
  DEFAULT_MODEL,
  describeError,
  fileNameFor,
  isBusy,
  isCapturing,
  isTransient,
  joinTranscripts,
  MAX_AUDIO_BYTES,
  MAX_DURATION_MS,
  nextState,
  normalizeVoiceConfig,
  pickFormat,
  tidyTranscript,
  VOICE_TARGETS
} from '../shared/voiceInput.ts'
import type { VoiceErrorCode, VoiceState } from '../shared/voiceInput'

test('a voice session goes through the states it is supposed to, in order', () => {
  let state: VoiceState = 'idle'
  state = nextState(state, { type: 'start' })
  assert.equal(state, 'requesting-permission')
  state = nextState(state, { type: 'permitted' })
  assert.equal(state, 'initializing')
  state = nextState(state, { type: 'capturing' })
  assert.equal(state, 'listening')
  state = nextState(state, { type: 'stop' })
  assert.equal(state, 'processing')
  state = nextState(state, { type: 'transcribed' })
  assert.equal(state, 'completed')
  assert.equal(nextState(state, { type: 'reset' }), 'idle')
})

test('"listening" is only ever shown while the microphone is actually open', () => {
  assert.equal(isCapturing('listening'), true)
  for (const state of ['idle', 'requesting-permission', 'initializing', 'processing', 'completed', 'error'] as VoiceState[]) {
    assert.equal(isCapturing(state), false, `${state} is not listening`)
  }
  // Asking for permission and setting up are busy, so a second session cannot start on top of them.
  assert.equal(isBusy('requesting-permission'), true)
  assert.equal(isBusy('initializing'), true)
  assert.equal(isBusy('completed'), false)
})

test('an event that makes no sense where the session is changes nothing', () => {
  // The usual way this goes wrong: something arrives after a cancel and puts "listening" back on screen.
  assert.equal(nextState('idle', { type: 'capturing' }), 'idle')
  assert.equal(nextState('idle', { type: 'transcribed' }), 'idle')
  assert.equal(nextState('processing', { type: 'capturing' }), 'processing')
  assert.equal(nextState('listening', { type: 'transcribed' }), 'listening')
  // And a failure reported for a session that already ended does not resurrect it as an error.
  assert.equal(nextState('idle', { type: 'failed', code: 'api-error' }), 'idle')
  assert.equal(nextState('listening', { type: 'failed', code: 'microphone-lost' }), 'error')
})

test('a finished or failed session can start another one', () => {
  assert.equal(nextState('completed', { type: 'start' }), 'requesting-permission')
  assert.equal(nextState('error', { type: 'start' }), 'requesting-permission')
})

test('every failure says what happened and what to do about it', () => {
  const codes: VoiceErrorCode[] = [
    'permission-denied',
    'no-microphone',
    'microphone-lost',
    'recording-error',
    'no-speech',
    'too-long',
    'bad-audio',
    'auth-failed',
    'rate-limited',
    'api-error',
    'network-error',
    'timeout',
    'cancelled'
  ]
  for (const code of codes) {
    const said = describeError(code)
    assert.ok(said.length > 15, `${code} says something`)
    assert.ok(!/undefined|null|\[object/.test(said), `${code} reads like English`)
  }
  assert.match(describeError('permission-denied'), /Windows privacy settings/)
  assert.match(describeError('auth-failed'), /API key/)
})

test('only the failures worth retrying are treated as worth retrying', () => {
  for (const code of ['rate-limited', 'api-error', 'network-error', 'timeout'] as VoiceErrorCode[]) assert.equal(isTransient(code), true, code)
  // Retrying these would only fail again, more times.
  for (const code of ['permission-denied', 'no-microphone', 'auth-failed', 'bad-audio', 'no-speech', 'cancelled'] as VoiceErrorCode[]) {
    assert.equal(isTransient(code), false, code)
  }
})

test('what the service answers with is read as what it means', () => {
  assert.equal(classifyStatus(401), 'auth-failed')
  assert.equal(classifyStatus(403), 'auth-failed')
  assert.equal(classifyStatus(429), 'rate-limited')
  assert.equal(classifyStatus(413), 'too-long')
  assert.equal(classifyStatus(400), 'bad-audio')
  assert.equal(classifyStatus(415), 'bad-audio')
  assert.equal(classifyStatus(500), 'api-error')
  assert.equal(classifyStatus(503), 'api-error')
})

test('a recording is checked before it is sent anywhere', () => {
  assert.equal(checkAudio(0), 'no-speech', 'a click on and straight back off')
  assert.equal(checkAudio(50), 'no-speech')
  assert.equal(checkAudio(MAX_AUDIO_BYTES + 1), 'too-long', 'said before uploading, not after being refused')
  assert.equal(checkAudio(64_000), null)
})

test('the format is one this machine can actually record, and the file says which', () => {
  assert.equal(pickFormat((t) => t === 'audio/webm;codecs=opus'), 'audio/webm;codecs=opus', 'the best one when it is there')
  assert.equal(pickFormat((t) => t === 'audio/mp4'), 'audio/mp4', 'and something else when it is not')
  assert.equal(pickFormat(() => false), null, 'and nothing at all rather than a recorder that throws')

  assert.equal(fileNameFor('audio/webm;codecs=opus'), 'speech.webm')
  assert.equal(fileNameFor('audio/ogg;codecs=opus'), 'speech.ogg')
  assert.equal(fileNameFor('audio/mp4'), 'speech.m4a')
  assert.equal(fileNameFor('audio/mpeg'), 'speech.mp3')
})

test('a transcript is what was said, not a rewriting of it', () => {
  assert.equal(tidyTranscript('  Summarize   this page.  '), 'Summarize this page.')
  // Technical words, addresses and names survive exactly as they came.
  for (const said of ['Open github.com/searxng/searxng', 'Use whisper-large-v3-turbo', 'Explain TCP versus UDP', 'காலை வணக்கம்', 'नमस्ते दुनिया']) {
    assert.equal(tidyTranscript(said), said)
  }
  // What Whisper returns when it heard nothing is nothing, rather than a word nobody said.
  for (const silence of ['', '   ', 'you', 'Thank you', 'Thanks for watching', '.']) assert.equal(tidyTranscript(silence), '')
  assert.equal(tidyTranscript(null), '')
  assert.equal(tidyTranscript(42), '')
})

test('a long recording comes back as one thing, with nothing said twice and nothing dropped', () => {
  // The pieces overlap, because the segments they came from overlap.
  const joined = joinTranscripts([
    'The first thing I want to say is that the weather',
    'the weather today is unusually warm for the time of year',
    'for the time of year and I think it will rain later'
  ])
  assert.equal(joined, 'The first thing I want to say is that the weather today is unusually warm for the time of year and I think it will rain later')

  // Pieces that do not overlap are simply joined, not run together.
  assert.equal(joinTranscripts(['One two three', 'four five six']), 'One two three four five six')
  // And nothing earlier is thrown away because a later piece came back empty.
  assert.equal(joinTranscripts(['Something real', '', '   ']), 'Something real')
  assert.equal(joinTranscripts([]), '')
})

test('the default is the fast model, and the accurate one is available without anything else changing', () => {
  assert.equal(defaultModel(), 'whisper-large-v3-turbo')
  assert.equal(ACCURATE_MODEL, 'whisper-large-v3')
  assert.equal(normalizeVoiceConfig({ model: ACCURATE_MODEL }).model, ACCURATE_MODEL)
  assert.equal(normalizeVoiceConfig({ model: 'some-other-model' }).model, DEFAULT_MODEL, 'a model that does not exist falls back rather than failing')
})

function defaultModel(): string {
  return normalizeVoiceConfig({}).model
}

test('a language is passed through when it is one, and left to the model when it is not', () => {
  assert.equal(normalizeVoiceConfig({ language: 'ta' }).language, 'ta')
  assert.equal(normalizeVoiceConfig({ language: 'HI' }).language, 'hi')
  // Nothing here knows anything about any particular language; an unusable value means "work it out".
  assert.equal(normalizeVoiceConfig({ language: 'tamil' }).language, null)
  assert.equal(normalizeVoiceConfig({}).language, null)
})

test('settings that would make voice input unusable are brought back into range', () => {
  assert.equal(normalizeVoiceConfig({ maxDurationMs: 999_999_999 }).maxDurationMs, MAX_DURATION_MS)
  assert.equal(normalizeVoiceConfig({ maxDurationMs: 1 }).maxDurationMs, 5_000)
  assert.equal(normalizeVoiceConfig({ timeoutMs: 'soon' }).timeoutMs, normalizeVoiceConfig({}).timeoutMs)
  assert.deepEqual(normalizeVoiceConfig(null), normalizeVoiceConfig({}))
  assert.deepEqual(normalizeVoiceConfig('nonsense'), normalizeVoiceConfig({}))
})

test('every input that can start a voice session is one of the known ones', () => {
  assert.deepEqual(VOICE_TARGETS, ['chat', 'browser-orion', 'search', 'url-bar'])
})
