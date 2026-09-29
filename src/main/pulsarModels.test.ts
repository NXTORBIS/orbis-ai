import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPulsarModelId, recommendedModel, PULSAR_MODEL_INFO, PULSAR_MODELS, saidSize } from '../shared/pulsarModels.ts'

test('every model has a real file name, a real mirror URL and a size that is not invented', () => {
  for (const id of PULSAR_MODELS) {
    const info = PULSAR_MODEL_INFO[id]
    assert.equal(info.file, `ggml-${id}.bin`)
    assert.match(info.url, /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\/ggml-.+\.bin$/)
    assert.ok(info.sizeBytes > 1_000_000, `${id} should be a real multi-megabyte model, not a placeholder`)
    assert.ok(info.ramMb > 0)
  }
})

test('isPulsarModelId only accepts a real model, never a Groq-style name or junk', () => {
  assert.equal(isPulsarModelId('base'), true)
  assert.equal(isPulsarModelId('large-v3-turbo'), true)
  assert.equal(isPulsarModelId('Pulsar-large-v3-turbo'), false, 'the old Groq model name is not a local one')
  assert.equal(isPulsarModelId('tiny.en'), false)
  assert.equal(isPulsarModelId(''), false)
  assert.equal(isPulsarModelId(null), false)
  assert.equal(isPulsarModelId(42), false)
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
  const order = PULSAR_MODELS.slice().reverse()
  assert.ok(order.indexOf(withGpu) >= order.indexOf(withoutGpu))
})

test('nothing is recommended below tiny, however little memory is reported', () => {
  assert.equal(recommendedModel(0, false), 'tiny')
  assert.equal(recommendedModel(-1, false), 'tiny')
})

test('every model says what it is for, what it costs and what it needs', () => {
  // This is what the first-run chooser puts in front of somebody. A model with no description, or a size of zero,
  // is a row they cannot choose between.
  for (const id of PULSAR_MODELS) {
    const model = PULSAR_MODEL_INFO[id]
    assert.ok(model.label.startsWith('Pulsar'), `${id} is not named for Orbis: ${model.label}`)
    assert.ok(model.description.length > 40, `${id} has nothing useful to say`)
    assert.ok(model.sizeBytes > 10_000_000, `${id} has no download size`)
    assert.ok(model.ramMb > 0, `${id} does not say what memory it needs`)
  }
})

test('a download size is readable at a glance', () => {
  assert.equal(saidSize(77_691_713), '78 MB')
  assert.equal(saidSize(1_533_763_059), '1.5 GB')
  assert.equal(saidSize(3_095_033_483), '3.1 GB')
})

test('the recommendation is always a model that fits the machine it is for', () => {
  // The chooser leads with this, so it must never lead with something that cannot run.
  for (const ram of [2_000, 4_000, 8_000, 16_000, 32_000, 64_000]) {
    for (const gpu of [false, true]) {
      const id = recommendedModel(ram, gpu)
      assert.ok(PULSAR_MODELS.includes(id), `${ram}MB gave ${id}`)
      assert.ok(PULSAR_MODEL_INFO[id].ramMb * 2.2 <= ram + (gpu ? 2_048 : 0) || id === 'tiny',
        `${ram}MB recommended ${id}, which needs ${PULSAR_MODEL_INFO[id].ramMb}MB`)
    }
  }
})
