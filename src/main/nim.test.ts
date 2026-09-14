import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GROQ_BASE_URL, streamChat, testApiKey } from './nim.ts'
import type { ChatOptions, FetchFn } from './nim.ts'
import type { ChatMessage, StreamEvent } from '../shared/types'

const LLAMA = 'llama-3.3-70b-versatile'
const INSTANT = 'llama-3.1-8b-instant'
const GPT_OSS = 'openai/gpt-oss-120b'

interface Call {
  url: string
  model: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

const user = (content: string): ChatMessage => ({ id: crypto.randomUUID(), role: 'user', content, createdAt: 0 })

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers })

const chunk = (delta: Record<string, unknown>, finish: string | null = null): unknown => ({
  choices: [{ delta, finish_reason: finish }]
})

function sse(chunks: unknown[], signal?: AbortSignal, keepOpen = false): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
      for (const c of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`))
      if (keepOpen) return
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function harness(respond: (call: Call, index: number, signal?: AbortSignal) => Response) {
  const calls: Call[] = []
  const events: StreamEvent[] = []
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    const call = { url, model: String(body.model), headers: init.headers as Record<string, string>, body }
    calls.push(call)
    return respond(call, calls.length - 1, init.signal ?? undefined)
  }
  const run = (overrides: Partial<ChatOptions> = {}): Promise<void> =>
    streamChat({
      apiKeys: ['test-key'],
      model: LLAMA,
      messages: [user('Hi')],
      systemPrompt: 'sys',
      reasoningEffort: 'high',
      autoFallback: true,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      fetchFn,
      ...overrides
    })
  return { calls, events, run }
}

const text = (events: StreamEvent[], key: 'content' | 'reasoning'): string =>
  events.map((e) => (e.type === 'delta' ? (e[key] ?? '') : '')).join('')

const errorMessage = (events: StreamEvent[]): string => {
  const last = events.at(-1)
  return last?.type === 'error' ? last.message : ''
}

test('streams from Groq with the API key as a bearer token', async () => {
  const h = harness(() => sse([chunk({ content: 'Hel' }), chunk({ content: 'lo' }, 'stop')]))
  await h.run({ autoFallback: false })
  assert.equal(h.calls[0].url, `${GROQ_BASE_URL}/chat/completions`)
  assert.equal(h.calls[0].headers.Authorization, 'Bearer test-key')
  assert.equal(h.calls[0].body.stream, true)
  assert.deepEqual(h.events, [
    { type: 'start', model: LLAMA },
    { type: 'delta', content: 'Hel', reasoning: undefined },
    { type: 'delta', content: 'lo', reasoning: undefined },
    { type: 'done', model: LLAMA, truncated: false }
  ])
})

test('without an API key it reports the problem and sends nothing', async () => {
  const h = harness(() => sse([]))
  await h.run({ apiKeys: [] })
  assert.equal(h.calls.length, 0)
  assert.match(errorMessage(h.events), /no Groq API key/)
})

test('moves to the next API key when Groq rejects one', async () => {
  const h = harness((call) =>
    call.headers.Authorization === 'Bearer revoked' ? json(401, { error: { message: 'Invalid API Key' } }) : sse([chunk({ content: 'ok' }, 'stop')])
  )
  await h.run({ apiKeys: ['revoked', 'valid'], autoFallback: false })
  assert.deepEqual(
    h.calls.map((c) => c.headers.Authorization),
    ['Bearer revoked', 'Bearer valid']
  )
  assert.ok(h.events.some((e) => e.type === 'status' && /rejected API key 1 of 2/.test(e.message)))
  assert.equal(h.events.at(-1)?.type, 'done')
})

test('switches to the next API key when rate-limited', async () => {
  const h = harness((call) =>
    call.headers.Authorization === 'Bearer first' ? json(429, { error: { message: 'Too many requests' } }) : sse([chunk({ content: 'ok' }, 'stop')])
  )
  await h.run({ apiKeys: ['first', 'second'], autoFallback: false })
  assert.deepEqual(
    h.calls.map((c) => c.headers.Authorization),
    ['Bearer first', 'Bearer second']
  )
  assert.ok(h.events.some((e) => e.type === 'status' && /rate-limited/.test(e.message)))
  assert.equal(h.events.at(-1)?.type, 'done')
})

test('falls back to the next model when the first is rate-limited', async () => {
  const h = harness((call) =>
    call.model === LLAMA
      ? json(429, { error: { message: 'Too many requests' } })
      : sse([chunk({ reasoning: 'Let me think' }), chunk({ content: 'Hello' }), chunk({ content: '!' }, 'stop')])
  )
  await h.run()
  assert.deepEqual(
    h.calls.map((c) => c.model),
    [LLAMA, INSTANT]
  )
  assert.equal(h.events[0].type, 'status')
  assert.deepEqual(h.events[1], { type: 'start', model: INSTANT })
  assert.equal(text(h.events, 'reasoning'), 'Let me think')
  assert.equal(text(h.events, 'content'), 'Hello!')
  assert.deepEqual(h.events.at(-1), { type: 'done', model: INSTANT, truncated: false })
})

test('splits inline <think> tags and reports length truncation', async () => {
  const h = harness(() => sse([chunk({ content: '<think>pl' }), chunk({ content: 'an</think>Ans' }), chunk({ content: 'wer' }, 'length')]))
  await h.run({ autoFallback: false })
  assert.equal(text(h.events, 'reasoning'), 'plan')
  assert.equal(text(h.events, 'content'), 'Answer')
  assert.deepEqual(h.events.at(-1), { type: 'done', model: LLAMA, truncated: true })
})

test('sends reasoning_effort only to reasoning models, mapping max to high', async () => {
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ model: GPT_OSS, reasoningEffort: 'max', autoFallback: false })
  await h.run({ model: LLAMA, autoFallback: false })
  assert.equal(h.calls[0].body.reasoning_effort, 'high')
  assert.equal('reasoning_effort' in h.calls[1].body, false)
})

test('retries once without optional params after a 400', async () => {
  const h = harness((_call, index) => (index === 0 ? json(400, { error: { message: 'unsupported parameter' } }) : sse([chunk({ content: 'ok' }, 'stop')])))
  await h.run({ model: GPT_OSS })
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].body.reasoning_effort, 'high')
  assert.equal('reasoning_effort' in h.calls[1].body, false)
  assert.equal(h.calls[1].model, GPT_OSS)
  assert.equal(h.events.at(-1)?.type, 'done')
})

test('stops when Groq rejects the only API key, without trying other models', async () => {
  const h = harness(() => json(401, { error: { message: 'Invalid API Key' } }))
  await h.run()
  assert.equal(h.calls.length, 1)
  assert.match(errorMessage(h.events), /Groq rejected the API key/)
})

test('reports error when all keys are rate-limited', async () => {
  const h = harness(() => json(429, {}, { 'retry-after': '1' }))
  await h.run({ apiKeys: ['first', 'second'], autoFallback: false })
  assert.equal(h.calls.length, 2)
  assert.ok(h.events.some((e) => e.type === 'status' && /rate-limited/.test(e.message)))
  assert.equal(h.events.at(-1)?.type, 'error')
})

test('sends the system prompt first and never echoes reasoning back', async () => {
  const history: ChatMessage[] = [
    user('Q1'),
    { id: 'a1', role: 'assistant', content: 'A1', reasoning: 'R1', model: GPT_OSS, createdAt: 0 },
    user('Q2')
  ]
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ messages: history, model: GPT_OSS, autoFallback: false })
  const messages = h.calls[0].body.messages as Record<string, unknown>[]
  assert.equal(messages[0].role, 'system')
  assert.equal('reasoning_content' in messages[2], false)
})

test('merges consecutive user messages left by a failed reply', async () => {
  const history: ChatMessage[] = [user('first'), { id: 'a1', role: 'assistant', content: '', error: 'boom', createdAt: 0 }, user('second')]
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ messages: history, autoFallback: false })
  const messages = h.calls[0].body.messages as Record<string, unknown>[]
  assert.equal(messages.length, 2)
  assert.equal(messages[1].content, 'first\n\nsecond')
})

test('sends attached file contents ahead of the user text', async () => {
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  const message: ChatMessage = { ...user('Summarize this'), attachments: [{ name: 'notes.txt', content: 'alpha beta' }] }
  await h.run({ messages: [message], autoFallback: false })
  const messages = h.calls[0].body.messages as Record<string, unknown>[]
  assert.equal(messages[1].content, '<file name="notes.txt">\nalpha beta\n</file>\n\nSummarize this')
})

test('omits the system message when the prompt is empty', async () => {
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ systemPrompt: '', autoFallback: false })
  const messages = h.calls[0].body.messages as Record<string, unknown>[]
  assert.equal(messages[0].role, 'user')
})

test('aborting mid-stream emits aborted and keeps partial output', async () => {
  const controller = new AbortController()
  const h = harness((_call, _index, signal) => sse([chunk({ content: 'partial' })], signal, true))
  const running = h.run({ signal: controller.signal })
  await new Promise((resolve) => setTimeout(resolve, 50))
  controller.abort()
  await running
  assert.equal(text(h.events, 'content'), 'partial')
  assert.deepEqual(h.events.at(-1), { type: 'aborted' })
})

test('testApiKey checks every key against the models endpoint', async () => {
  const urls: string[] = []
  const fetchFn: FetchFn = async (url, init) => {
    urls.push(url)
    const auth = (init.headers as Record<string, string>).Authorization
    return auth === 'Bearer good' ? json(200, { data: [] }) : json(401, { error: { message: 'Invalid API Key' } })
  }
  assert.deepEqual(await testApiKey(['good', 'bad'], fetchFn), { ok: true, message: 'Groq accepted 1 of 2 API keys.' })
  assert.equal(urls[0], `${GROQ_BASE_URL}/models`)
  assert.deepEqual(await testApiKey(['bad'], fetchFn), { ok: false, message: 'Groq accepted 0 of 1 API key.' })
  assert.equal((await testApiKey([], fetchFn)).ok, false)
})
