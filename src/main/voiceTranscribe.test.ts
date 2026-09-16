import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcribeAudio, VoiceError } from './voice.ts'

const audio = Buffer.alloc(4096, 7)
const ok = (text: string): Response => new Response(JSON.stringify({ text }), { status: 200, headers: { 'content-type': 'application/json' } })
const nowait = async (): Promise<void> => undefined

test('the words come back, and the request says which model and what the audio is', async () => {
  let sent: { model?: string; language?: string; fileName?: string; fileType?: string; auth?: string } = {}
  const text = await transcribeAudio({
    audio,
    mimeType: 'audio/webm;codecs=opus',
    apiKeys: ['key-one'],
    wait: nowait,
    fetchFn: async (_url, init) => {
      const form = init?.body as FormData
      const file = form.get('file') as File
      sent = {
        model: String(form.get('model')),
        language: (form.get('language') as string) ?? undefined,
        fileName: file.name,
        fileType: file.type,
        auth: (init?.headers as Record<string, string>).Authorization
      }
      return ok('  Summarize this page.  ')
    }
  })

  assert.equal(text, 'Summarize this page.')
  assert.equal(sent.model, 'whisper-large-v3-turbo', 'the fast model by default')
  assert.equal(sent.fileName, 'speech.webm', 'the name is how the service is told the format')
  assert.equal(sent.fileType, 'audio/webm;codecs=opus')
  assert.equal(sent.auth, 'Bearer key-one')
  assert.equal(sent.language, undefined, 'no language means the model works it out')
})

test('the accurate model and a language are used when they are asked for', async () => {
  let model = ''
  let language = ''
  await transcribeAudio({
    audio,
    mimeType: 'audio/mp4',
    model: 'whisper-large-v3',
    language: 'ta',
    apiKeys: ['k'],
    wait: nowait,
    fetchFn: async (_url, init) => {
      const form = init?.body as FormData
      model = String(form.get('model'))
      language = String(form.get('language'))
      return ok('காலை வணக்கம்')
    }
  })
  assert.equal(model, 'whisper-large-v3')
  assert.equal(language, 'ta')
})

test('a recording with nothing in it is said to be that, not answered with empty words', async () => {
  await assert.rejects(
    () => transcribeAudio({ audio, mimeType: 'audio/webm', apiKeys: ['k'], wait: nowait, fetchFn: async () => ok('Thanks for watching') }),
    (err: VoiceError) => err.code === 'no-speech',
    'what Whisper returns for silence is silence'
  )
  await assert.rejects(
    () => transcribeAudio({ audio: Buffer.alloc(0), mimeType: 'audio/webm', apiKeys: ['k'], fetchFn: async () => ok('x') }),
    (err: VoiceError) => err.code === 'no-speech'
  )
})

test('with no key at all it says so rather than calling anything', async () => {
  let called = false
  await assert.rejects(
    () => transcribeAudio({ audio, mimeType: 'audio/webm', apiKeys: [], fetchFn: async () => { called = true; return ok('x') } }),
    (err: VoiceError) => err.code === 'auth-failed'
  )
  assert.equal(called, false)
})

test('a failure the service refused on its merits is not retried against every key in turn', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      transcribeAudio({
        audio,
        mimeType: 'audio/webm',
        apiKeys: ['a', 'b', 'c'],
        wait: nowait,
        fetchFn: async () => {
          calls++
          return new Response('that audio is unreadable', { status: 400 })
        }
      }),
    (err: VoiceError) => err.code === 'bad-audio'
  )
  assert.equal(calls, 1, 'the same refusal three times over helps nobody')
})

test('a rejected key gives way to the next one', async () => {
  const used: string[] = []
  const text = await transcribeAudio({
    audio,
    mimeType: 'audio/webm',
    apiKeys: ['stale', 'good'],
    wait: nowait,
    fetchFn: async (_url, init) => {
      const auth = (init?.headers as Record<string, string>).Authorization
      used.push(auth)
      return auth === 'Bearer stale' ? new Response('invalid api key', { status: 401 }) : ok('It worked')
    }
  })
  assert.equal(text, 'It worked')
  assert.deepEqual(used, ['Bearer stale', 'Bearer good'])
})

test('being asked to slow down is waited out, once, for as long as the service asked', async () => {
  const waits: number[] = []
  let calls = 0
  const text = await transcribeAudio({
    audio,
    mimeType: 'audio/webm',
    apiKeys: ['only'],
    wait: async (ms) => void waits.push(ms),
    fetchFn: async () => {
      calls++
      return calls === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }) : ok('Second time lucky')
    }
  })
  assert.equal(text, 'Second time lucky')
  assert.deepEqual(waits, [2000], 'as long as it asked for, not a guess')
})

test('it gives up rather than retrying for ever', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      transcribeAudio({
        audio,
        mimeType: 'audio/webm',
        apiKeys: ['only'],
        wait: nowait,
        fetchFn: async () => {
          calls++
          return new Response('busy', { status: 503 })
        }
      }),
    (err: VoiceError) => err.code === 'api-error'
  )
  assert.equal(calls, 3, 'three attempts, then it stops')
})

test('a connection that is not there is said to be that', async () => {
  await assert.rejects(
    () =>
      transcribeAudio({
        audio,
        mimeType: 'audio/webm',
        apiKeys: ['k'],
        wait: nowait,
        fetchFn: async () => {
          throw new TypeError('fetch failed')
        }
      }),
    (err: VoiceError) => err.code === 'network-error'
  )
})

test('cancelling stops it, and nothing is sent afterwards', async () => {
  const controller = new AbortController()
  controller.abort()
  let called = false
  await assert.rejects(
    () =>
      transcribeAudio({
        audio,
        mimeType: 'audio/webm',
        apiKeys: ['k'],
        signal: controller.signal,
        fetchFn: async () => {
          called = true
          return ok('x')
        }
      }),
    (err: VoiceError) => err.code === 'cancelled'
  )
  assert.equal(called, false)
})

test('an answer that is not the shape it should be is a failure, not a transcript', async () => {
  await assert.rejects(
    () => transcribeAudio({ audio, mimeType: 'audio/webm', apiKeys: ['k'], wait: nowait, fetchFn: async () => new Response('not json at all', { status: 200 }) }),
    (err: VoiceError) => err.code === 'api-error'
  )
})
