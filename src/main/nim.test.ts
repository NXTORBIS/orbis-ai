import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ORION_BASE_URL, streamChat, testApiKey } from './nim.ts'
import type { ChatOptions, FetchFn } from './nim.ts'
import type { ChatMessage, StreamEvent } from '../shared/types'

const KIMI = 'moonshotai/kimi-k3'
const DEEPSEEK = 'deepseek-ai/deepseek-v4-pro-0813'
const ORION = 'orion-local'

interface Call {
  model: string
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
  const fetchFn: FetchFn = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    const call = { model: String(body.model), body }
    calls.push(call)
    return respond(call, calls.length - 1, init.signal ?? undefined)
  }
  const run = (overrides: Partial<ChatOptions> = {}): Promise<void> =>
    streamChat({
      apiKey: 'test',
      model: KIMI,
      messages: [user('Hi')],
      systemPrompt: 'sys',
      reasoningEffort: 'high',
      autoFallback: true,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      fetchFn,
      ...overrides
    })
  return { calls, events, run, fetchFn }
}

const text = (events: StreamEvent[], key: 'content' | 'reasoning'): string =>
  events.map((e) => (e.type === 'delta' ? (e[key] ?? '') : '')).join('')

test('falls back to the next model when the first is rate-limited', async () => {
  const h = harness((call) =>
    call.model === KIMI
      ? json(429, { error: { message: 'Too many requests' } })
      : sse([chunk({ reasoning_content: 'Let me think' }), chunk({ content: 'Hello' }), chunk({ content: '!' }, 'stop')])
  )
  await h.run()
  assert.deepEqual(
    h.calls.map((c) => c.model),
    [KIMI, DEEPSEEK]
  )
  assert.equal(h.events[0].type, 'status')
  assert.deepEqual(h.events[1], { type: 'start', model: DEEPSEEK })
  assert.equal(text(h.events, 'reasoning'), 'Let me think')
  assert.equal(text(h.events, 'content'), 'Hello!')
  assert.deepEqual(h.events.at(-1), { type: 'done', model: DEEPSEEK, truncated: false })
})

test('splits inline <think> tags and reports length truncation', async () => {
  const h = harness(() => sse([chunk({ content: '<think>pl' }), chunk({ content: 'an</think>Ans' }), chunk({ content: 'wer' }, 'length')]))
  await h.run({ autoFallback: false })
  assert.equal(text(h.events, 'reasoning'), 'plan')
  assert.equal(text(h.events, 'content'), 'Answer')
  assert.deepEqual(h.events.at(-1), { type: 'done', model: KIMI, truncated: true })
})

test('retries once without optional params after a 400', async () => {
  const h = harness((_call, index) => (index === 0 ? json(400, { detail: 'unsupported parameter' }) : sse([chunk({ content: 'ok' }, 'stop')])))
  await h.run()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].body.reasoning_effort, 'high')
  assert.equal(h.calls[0].body.max_tokens, 32768)
  assert.equal('reasoning_effort' in h.calls[1].body, false)
  assert.equal('max_tokens' in h.calls[1].body, false)
  assert.equal(h.calls[1].model, KIMI)
  assert.equal(h.events.at(-1)?.type, 'done')
})

test('stops on an invalid API key without trying other models', async () => {
  const h = harness(() => json(401, { error: { message: 'Unauthorized' } }))
  await h.run()
  assert.equal(h.calls.length, 1)
  const last = h.events.at(-1)
  assert.equal(last?.type, 'error')
  assert.match(last?.type === 'error' ? last.message : '', /rejected your API key/)
})

test('waits for the rate-limit window, retries once, then reports the error', async () => {
  const h = harness(() => json(429, {}, { 'retry-after': '1' }))
  const started = Date.now()
  await h.run({ autoFallback: false })
  assert.equal(h.calls.length, 2)
  assert.ok(Date.now() - started >= 900, 'should wait about a second')
  assert.ok(h.events.some((e) => e.type === 'status' && /Retrying in/.test(e.message)))
  assert.equal(h.events.at(-1)?.type, 'error')
})

test('echoes reasoning_content only to the model that produced it', async () => {
  const history: ChatMessage[] = [
    user('Q1'),
    { id: 'a1', role: 'assistant', content: 'A1', reasoning: 'R1', model: KIMI, createdAt: 0 },
    user('Q2')
  ]
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ messages: history, autoFallback: false })
  await h.run({ messages: history, autoFallback: false, model: DEEPSEEK })

  const kimiMessages = h.calls[0].body.messages as Record<string, unknown>[]
  const deepseekMessages = h.calls[1].body.messages as Record<string, unknown>[]
  assert.equal(kimiMessages[0].role, 'system')
  assert.equal(kimiMessages[2].reasoning_content, 'R1')
  assert.equal('reasoning_content' in deepseekMessages[2], false)
  assert.equal('reasoning_effort' in h.calls[0].body, true)
})

test('merges consecutive user messages left by a failed reply', async () => {
  const history: ChatMessage[] = [
    user('first'),
    { id: 'a1', role: 'assistant', content: '', error: 'boom', createdAt: 0 },
    user('second')
  ]
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

test('testApiKey returns ORION ready message', async () => {
  assert.deepEqual(await testApiKey(), { ok: true, message: 'ORION is ready. No API key needed.' })
})

test('ORION (local) goes to the local server with no key and returns one reply', async () => {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
  const events: StreamEvent[] = []
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> })
    return json(200, { choices: [{ message: { role: 'assistant', content: '<think>check</think>Hello from ORION' }, finish_reason: 'stop' }] })
  }
  await streamChat({
    apiKey: '',
    model: ORION,
    conversationId: 'chat-1',
    messages: [user('Hi')],
    systemPrompt: 'sys',
    reasoningEffort: 'high',
    autoFallback: true,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    fetchFn
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${ORION_BASE_URL}/chat/completions`)
  assert.equal('Authorization' in calls[0].headers, false)
  assert.equal(calls[0].body.session, 'chat-1')
  assert.equal((calls[0].body.messages as Record<string, unknown>[]).at(-1)?.content, 'Hi')
  assert.deepEqual(events, [
    { type: 'start', model: ORION },
    { type: 'delta', content: 'Hello from ORION', reasoning: 'check' },
    { type: 'done', model: ORION, truncated: false }
  ])
})

test('an unreachable ORION server is reported, not replaced by an NVIDIA model', async () => {
  const h = harness(() => {
    throw new TypeError('fetch failed')
  })
  await h.run({ model: ORION, apiKey: '' })
  assert.deepEqual(
    h.calls.map((c) => c.model),
    [ORION]
  )
  const last = h.events.at(-1)
  assert.equal(last?.type, 'error')
  assert.match(last?.type === 'error' ? last.message : '', /Couldn't reach ORION/)
})

test('ORION errors show the server message', async () => {
  const h = harness(() => json(500, { error: 'orchestrator failed' }))
  await h.run({ model: ORION, apiKey: '' })
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.events.at(-1), { type: 'error', message: 'ORION returned 500: orchestrator failed' })
})

test('testApiKey always returns ORION ready', async () => {
  const result = await testApiKey()
  assert.deepEqual(result, { ok: true, message: 'ORION is ready. No API key needed.' })
})
