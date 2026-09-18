import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWhisperModelId, recommendedModel, WHISPER_MODEL_INFO, WHISPER_MODELS } from '../shared/whisperModels.ts'

test('every model has a real file name, a real mirror URL and a size that is not invented', () => {
  for (const id of WHISPER_MODELS) {
    const info = WHISPER_MODEL_INFO[id]
    assert.equal(info.file, `ggml-${id}.bin`)
    assert.match(info.url, /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\/ggml-.+\.bin$/)
    assert.ok(info.sizeBytes > 1_000_000, `${id} should be a real multi-megabyte model, not a placeholder`)
    assert.ok(info.ramMb > 0)
  }
})

test('isWhisperModelId only accepts a real model, never a Groq-style name or junk', () => {
  assert.equal(isWhisperModelId('base'), true)
  assert.equal(isWhisperModelId('large-v3-turbo'), true)
  assert.equal(isWhisperModelId('whisper-large-v3-turbo'), false, 'the old Groq model name is not a local one')
  assert.equal(isWhisperModelId('tiny.en'), false)
  assert.equal(isWhisperModelId(''), false)
  assert.equal(isWhisperModelId(null), false)
  assert.equal(isWhisperModelId(42), false)
})

test('a low-memory machine is given a model it can actually run', () => {
  assert.equal(recommendedModel(500, false), 'tiny')
  assert.equal(recommendedModel(1_000, false), 'base')
  assert.equal(recommendedModel(4_000, false), 'small')
})

test('a machine with enough headroom for turbo gets it, because it is fast as well as accurate', () => {
  // Turbo needs about 2 GB resident; 6 GB of system RAM comfortably covers that with room for the rest of Orbis.
  assert.equal(recommendedModel(6_000, false), 'large-v3-turbo')
})

test('the plain most-accurate model is never preferred over turbo when both would fit', () => {
  assert.equal(recommendedModel(16_000, false), 'large-v3-turbo', 'large-v3 is not picked just because there is room for it too')
})

test('a GPU gives more headroom, but is never required to reach a usable recommendation', () => {
  const withGpu = recommendedModel(6_000, true)
  const withoutGpu = recommendedModel(6_000, false)
  // The GPU case is never worse than the CPU-only case for the same RAM.
  const order = WHISPER_MODELS.slice().reverse()
  assert.ok(order.indexOf(withGpu) >= order.indexOf(withoutGpu))
})

test('nothing is recommended below tiny, however little memory is reported', () => {
  assert.equal(recommendedModel(0, false), 'tiny')
  assert.equal(recommendedModel(-1, false), 'tiny')
})
