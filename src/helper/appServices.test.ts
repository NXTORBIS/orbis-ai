import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppServiceHandlers } from './appServices.ts'
import type { AppServicesDeps } from './appServices.ts'

const context = { signal: new AbortController().signal } as never

function fake(): { deps: AppServicesDeps; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    deps: {
      suggestWeb: async (q) => (calls.push(`web:${q}`), [`${q} today`]),
      suggestOrion: async (q) => (calls.push(`orion:${q}`), [`${q}?`]),
      transcribe: async (audio, options) => (calls.push(`transcribe:${audio.length}:${JSON.stringify(options)}`), audio.length > 3 ? { ok: true, text: 'hello there' } : { ok: false, code: 'no-speech', message: 'Nothing was heard.' }),
      cancelTranscription: () => void calls.push('cancel'),
      voiceHardware: () => ({ recommended: 'base' }),
      voiceModels: async () => ({ installed: ['base'], downloading: [] })
    }
  }
}

test('the search box gets the app suggestions, and speech goes to the local transcriber as bytes', async () => {
  const { deps, calls } = fake()
  const handlers = createAppServiceHandlers(() => deps)
  assert.deepEqual(await handlers['omnibox:web'](['  tides   and moon '], context), ['tides and moon today'])
  assert.deepEqual(await handlers['omnibox:predict'](['tides'], context), ['tides?'])
  assert.deepEqual(await handlers['omnibox:web']([''], context), [], 'nothing typed, nothing asked')
  assert.deepEqual(await handlers['omnibox:web']([42], context), [])
  assert.equal(calls.filter((c) => c.startsWith('web:')).length, 1)

  const clip = Buffer.from([1, 2, 3, 4, 5]).toString('base64')
  assert.deepEqual(await handlers['voice:transcribe']([clip, { model: 'base', language: 'en' }], context), { ok: true, text: 'hello there' })
  assert.ok(calls.includes('transcribe:5:{"model":"base","language":"en"}'), 'the clip arrives as the same five bytes')
  assert.deepEqual(await handlers['voice:transcribe']([Buffer.from([1]).toString('base64')], context), { ok: false, code: 'no-speech', message: 'Nothing was heard.' })
  assert.deepEqual(await handlers['voice:transcribe']([undefined], context), { ok: false, code: 'no-speech', message: 'Nothing was recorded.' })
  await handlers['voice:cancel']([], context)
  assert.ok(calls.includes('cancel'))
  assert.deepEqual(await handlers['voice:models:status']([], context), { installed: ['base'], downloading: [] })
})

test('before the app is ready the channels answer "not ready" instead of guessing', async () => {
  const handlers = createAppServiceHandlers(() => null)
  await assert.rejects(async () => handlers['omnibox:web'](['tides'], context), /not ready/)
  await assert.rejects(async () => handlers['voice:hardware']([], context), /not ready/)
})
