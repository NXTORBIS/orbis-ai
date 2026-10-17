import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkAudio,
  DEFAULT_MODEL,
  defaultVoiceConfig,
  describeError,
  isBusy,
  isCapturing,
  isVoiceModel,
  joinTranscripts,
  MAX_AUDIO_BYTES,
  MIN_AUDIO_BYTES,
  nextState,
  normalizeVoiceConfig,
  pickFormat,
  tidyTranscript,
  VOICE_TARGETS
} from '../shared/voiceInput.ts'
import type { VoiceErrorCode, VoiceState } from '../shared/voiceInput.ts'

test('every input Orbis actually has a microphone in is a known target, and only those', () => {
  // 'chess' is the blindfold trainer, where somebody holding a position in their head has no reason to be looking
  // at a keyboard either. It is its own target so a square spoken into it can never land in the search box.
  assert.deepEqual(VOICE_TARGETS, ['chat', 'browser-orion', 'search', 'url-bar', 'chess'])
})

test('the default model is a real, locally installable Pulsar size — not a Groq model name', () => {
  assert.equal(isVoiceModel(DEFAULT_MODEL), true)
  assert.notEqual(DEFAULT_MODEL, 'Pulsar-large-v3-turbo', 'that was the Groq model name; there is no cloud model any more')
})

// ---------------------------------------------------------------- the state machine

test('the session walks through requesting permission, listening and processing to being done', () => {
  let state: VoiceState = 'idle'
  state = nextState(state, { type: 'start' })
  assert.equal(state, 'requesting-permission')
  state = nextState(state, { type: 'permitted' })
  assert.equal(state, 'initializing')
  state = nextState(state, { type: 'capturing' })
  assert.equal(state, 'listening')
  assert.equal(isCapturing(state), true)
  state = nextState(state, { type: 'stop' })
  assert.equal(state, 'processing')
  assert.equal(isCapturing(state), false)
  state = nextState(state, { type: 'transcribed' })
  assert.equal(state, 'completed')
})

test('a failure from idle stays idle, so a stray error before recording starts is not shown as a crash', () => {
  assert.equal(nextState('idle', { type: 'failed', code: 'model-missing' }), 'idle')
})

test('a failure once something has actually started goes to error, whatever it was doing', () => {
  for (const state of ['requesting-permission', 'initializing', 'listening', 'processing'] as VoiceState[]) {
    assert.equal(nextState(state, { type: 'failed', code: 'runtime-error' }), 'error')
  }
})

test('an event that makes no sense where the session is leaves it exactly where it was', () => {
  assert.equal(nextState('idle', { type: 'stop' }), 'idle')
  assert.equal(nextState('listening', { type: 'permitted' }), 'listening')
  assert.equal(nextState('completed', { type: 'stop' }), 'completed')
})

test('reset always goes back to idle, from anywhere', () => {
  for (const state of ['requesting-permission', 'listening', 'processing', 'completed', 'error'] as VoiceState[]) {
    assert.equal(nextState(state, { type: 'reset' }), 'idle')
  }
})

test('isBusy is true for everything except idle and the two resting states', () => {
  assert.equal(isBusy('idle'), false)
  assert.equal(isBusy('completed'), false)
  assert.equal(isBusy('error'), false)
  for (const state of ['requesting-permission', 'initializing', 'listening', 'processing'] as VoiceState[]) assert.equal(isBusy(state), true)
})

// ---------------------------------------------------------------- errors, all real and all have something to do about them

test('every error code says something a person can act on, and never blames a cloud API that no longer exists', () => {
  const codes: VoiceErrorCode[] = [
    'permission-denied', 'no-microphone', 'microphone-lost', 'recording-error', 'no-speech', 'too-long', 'bad-audio',
    'model-missing', 'model-corrupted', 'unsupported-hardware', 'insufficient-memory', 'runtime-error', 'timeout', 'cancelled'
  ]
  for (const code of codes) {
    const message = describeError(code)
    assert.ok(message.length > 10, code)
    assert.doesNotMatch(message, /api key|groq|cloud/i, `${code} should not mention a cloud provider that no longer exists`)
  }
})

test('a missing model points at Settings, not at a network problem', () => {
  assert.match(describeError('model-missing'), /Settings/)
})

// ---------------------------------------------------------------- what may be sent

test('silence and clicks are refused before anything is run against them', () => {
  assert.equal(checkAudio(0), 'no-speech')
  assert.equal(checkAudio(MIN_AUDIO_BYTES - 1), 'no-speech')
  assert.equal(checkAudio(MIN_AUDIO_BYTES), null)
  assert.equal(checkAudio(MAX_AUDIO_BYTES), null)
  assert.equal(checkAudio(MAX_AUDIO_BYTES + 1), 'too-long')
})

test('the recording formats offered are tried in a sensible order, and none is chosen if the browser can record none', () => {
  assert.equal(pickFormat(() => true), 'audio/webm;codecs=opus')
  assert.equal(pickFormat((type) => type === 'audio/mp4'), 'audio/mp4')
  assert.equal(pickFormat(() => false), null)
})

// ---------------------------------------------------------------- the words that come back

test('a transcript is tidied of stray whitespace, and Pulsar\'s own padding for silence becomes nothing', () => {
  assert.equal(tidyTranscript('  hello   there  '), 'hello there')
  // Words somebody could have said are kept, even the ones the model also produces from silence. Deleting a real
  // "thank you" looks like a broken microphone and leaves nothing to notice.
  assert.equal(tidyTranscript('you'), 'you')
  assert.equal(tidyTranscript('thank you'), 'thank you')
  assert.equal(tidyTranscript('thanks for watching'), 'thanks for watching')
  // Punctuation on its own is not a word.
  assert.equal(tidyTranscript('.'), '')
  assert.equal(tidyTranscript(' , '), '')
  assert.equal(tidyTranscript('...'), '')
  assert.equal(tidyTranscript('-'), '')
  assert.equal(tidyTranscript(''), '')
  assert.equal(tidyTranscript(undefined), '')
  assert.equal(tidyTranscript('Create a TypeScript function that sorts an array'), 'Create a TypeScript function that sorts an array')
})

test('long-recording segments are joined without repeating the words at their seams', () => {
  assert.equal(joinTranscripts(['I want to know how', 'know how quantum entanglement works']), 'I want to know how quantum entanglement works')
  assert.equal(joinTranscripts(['hello', 'world']), 'hello world')
  // An empty piece and a punctuation-only piece are dropped; a real word is not, even one the model also produces
  // from silence.
  assert.equal(joinTranscripts(['', '.', 'real words here']), 'real words here')
  assert.equal(joinTranscripts(['', 'you', 'real words here']), 'you real words here')
  assert.equal(joinTranscripts([]), '')
})

// ---------------------------------------------------------------- settings, made safe

test('a fresh configuration is a real installable model with no device forced and Pulsar left to detect the language', () => {
  const config = defaultVoiceConfig()
  assert.equal(isVoiceModel(config.model), true)
  assert.equal(config.language, null)
  assert.equal(config.deviceId, null)
})

test('a bad or missing stored configuration falls back to the default rather than breaking voice input', () => {
  assert.deepEqual(normalizeVoiceConfig(null), defaultVoiceConfig())
  assert.deepEqual(normalizeVoiceConfig({ model: 'Pulsar-large-v3-turbo' }).model, defaultVoiceConfig().model, 'an old Groq model name is not carried forward')
  assert.equal(normalizeVoiceConfig({ language: 'not-a-language-code' }).language, null)
  assert.equal(normalizeVoiceConfig({ language: 'TA' }).language, 'ta')
})

test('a real model id, language and device id from settings are kept exactly', () => {
  const config = normalizeVoiceConfig({ model: 'small', language: 'hi', deviceId: 'abc123' })
  assert.equal(config.model, 'small')
  assert.equal(config.language, 'hi')
  assert.equal(config.deviceId, 'abc123')
})
