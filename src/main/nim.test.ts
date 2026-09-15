import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GROQ_BASE_URL, streamChat, testApiKey } from './nim.ts'
import type { ChatOptions, FetchFn } from './nim.ts'
import { currentModelId, modelLabel } from '../shared/models.ts'
import type { ChatMessage, StreamEvent } from '../shared/types'

const ORION_NANO = 'meta-llama/llama-prompt-guard-2-22m'
const ORION_CORE = 'openai/gpt-oss-20b'
const ORION_MAX = 'openai/gpt-oss-120b'
const ORION_ULTRA = 'qwen/qwen3.8-27b'
const ORION_APEX = 'groq/compound'
const ORION_PRO = 'orion/pro'

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
      model: ORION_NANO,
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
    { type: 'start', model: ORION_NANO },
    { type: 'delta', content: 'Hel', reasoning: undefined },
    { type: 'delta', content: 'lo', reasoning: undefined },
    { type: 'done', model: ORION_NANO, truncated: false }
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
  assert.equal(h.events.some((e) => e.type === 'status'), false)
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
  assert.equal(h.events.some((e) => e.type === 'status'), false)
  assert.equal(h.events.at(-1)?.type, 'done')
})

test('falls back to the next model when the first is rate-limited', async () => {
  const h = harness((call) =>
    call.model === ORION_NANO
      ? json(429, { error: { message: 'Too many requests' } })
      : sse([chunk({ reasoning: 'Let me think' }), chunk({ content: 'Hello' }), chunk({ content: '!' }, 'stop')])
  )
  await h.run()
  assert.deepEqual(
    h.calls.map((c) => c.model),
    [ORION_NANO, ORION_CORE]
  )
  assert.equal(h.events[0].type, 'status')
  assert.deepEqual(h.events[1], { type: 'start', model: ORION_CORE })
  assert.equal(text(h.events, 'reasoning'), 'Let me think')
  assert.equal(text(h.events, 'content'), 'Hello!')
  assert.deepEqual(h.events.at(-1), { type: 'done', model: ORION_CORE, truncated: false })
})

test('splits inline <think> tags and reports length truncation', async () => {
  const h = harness(() => sse([chunk({ content: '<think>pl' }), chunk({ content: 'an</think>Ans' }), chunk({ content: 'wer' }, 'length')]))
  await h.run({ autoFallback: false })
  assert.equal(text(h.events, 'reasoning'), 'plan')
  assert.equal(text(h.events, 'content'), 'Answer')
  assert.deepEqual(h.events.at(-1), { type: 'done', model: ORION_NANO, truncated: true })
})

test('sends reasoning_effort only to reasoning models, mapping max to high', async () => {
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ model: ORION_MAX, reasoningEffort: 'max', autoFallback: false })
  await h.run({ model: ORION_NANO, autoFallback: false })
  assert.equal(h.calls[0].body.reasoning_effort, 'high')
  assert.equal('reasoning_effort' in h.calls[1].body, false)
})

test('gives reasoning models an explicit output budget', async () => {
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ model: ORION_MAX, autoFallback: false })
  await h.run({ model: ORION_NANO, autoFallback: false })
  assert.equal(h.calls[0].body.max_completion_tokens, 8192)
  assert.equal('max_completion_tokens' in h.calls[1].body, false)
})

test('retries at low effort into the same reply when reasoning leaves no answer', async () => {
  const h = harness((_call, index) =>
    index === 0 ? sse([chunk({ reasoning: 'Planning day one' }, 'length')]) : sse([chunk({ reasoning: 'Short' }), chunk({ content: 'Day 1' }, 'stop')])
  )
  await h.run({ model: ORION_MAX, autoFallback: false })
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].body.reasoning_effort, 'low')
  assert.equal(h.calls[1].body.max_completion_tokens, 4096)
  assert.equal(h.events.filter((e) => e.type === 'start').length, 1)
  assert.equal(h.events.some((e) => e.type === 'error' || e.type === 'status'), false)
  assert.equal(text(h.events, 'content'), 'Day 1')
  assert.deepEqual(h.events.at(-1), { type: 'done', model: ORION_MAX, truncated: false })
})

test('rescue retry rotates keys and keeps the reply if every key is rate-limited', async () => {
  const h = harness((_call, index) =>
    index === 0 ? sse([chunk({ reasoning: 'Thinking' }, 'length')]) : json(429, { error: { message: 'Too many requests' } })
  )
  await h.run({ model: ORION_MAX, apiKeys: ['a', 'b'] })
  assert.deepEqual(
    h.calls.map((c) => [c.model, c.headers.Authorization]),
    [[ORION_MAX, 'Bearer a'], [ORION_MAX, 'Bearer a'], [ORION_MAX, 'Bearer b']]
  )
  assert.deepEqual(h.events.at(-1), { type: 'done', model: ORION_MAX, truncated: true })
})

test('shrinks the output budget to fit when Groq says the request is too large', async () => {
  const h = harness((_call, index) =>
    index === 0 ? json(413, { error: { message: 'Request too large on tokens per minute (TPM): Limit 8000, Requested 11000' } }) : sse([chunk({ content: '4' }, 'stop')])
  )
  await h.run({ model: ORION_MAX, autoFallback: false })
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].body.max_completion_tokens, 8192)
  // 2808 prompt tokens and a 256-token margin leave 4936 for the reply.
  assert.equal(h.calls[1].body.max_completion_tokens, 4936)
  assert.equal(h.calls[1].body.reasoning_effort, 'high')
  assert.equal(text(h.events, 'content'), '4')
  assert.equal(h.events.at(-1)?.type, 'done')
})

test('falls back to the default budget when the too-large error has no numbers', async () => {
  const h = harness((_call, index) => (index === 0 ? json(413, { error: { message: 'Too many tokens' } }) : sse([chunk({ content: '4' }, 'stop')])))
  await h.run({ model: ORION_MAX, autoFallback: false })
  assert.equal(h.calls.length, 2)
  assert.equal('max_completion_tokens' in h.calls[1].body, false)
})

test('does not retry when a reasoning model answers normally', async () => {
  const h = harness(() => sse([chunk({ reasoning: 'hmm' }), chunk({ content: 'Hi!' }, 'stop')]))
  await h.run({ model: ORION_MAX, autoFallback: false })
  assert.equal(h.calls.length, 1)
})

test('retries once without optional params after a 400', async () => {
  const h = harness((_call, index) => (index === 0 ? json(400, { error: { message: 'unsupported parameter' } }) : sse([chunk({ content: 'ok' }, 'stop')])))
  await h.run({ model: ORION_MAX })
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].body.reasoning_effort, 'high')
  assert.equal('reasoning_effort' in h.calls[1].body, false)
  assert.equal(h.calls[1].model, ORION_MAX)
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
  assert.equal(h.events.some((e) => e.type === 'status'), false)
  assert.equal(h.events.at(-1)?.type, 'error')
})

test('sends the system prompt first and never echoes reasoning back', async () => {
  const history: ChatMessage[] = [
    user('Q1'),
    { id: 'a1', role: 'assistant', content: 'A1', reasoning: 'R1', model: ORION_MAX, createdAt: 0 },
    user('Q2')
  ]
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ messages: history, model: ORION_MAX, autoFallback: false })
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

test('skips a key whose organization Groq has restricted, and remembers it', async () => {
  const restricted = json(400, {
    error: { message: 'Organization has been restricted. Please reach out to support if you believe this was in error.', code: 'organization_restricted' }
  })
  const h = harness((call) => (call.headers.Authorization === 'Bearer restricted' ? restricted : sse([chunk({ content: 'ok' }, 'stop')])))
  await h.run({ apiKeys: ['restricted', 'healthy'], autoFallback: false })
  await h.run({ apiKeys: ['restricted', 'healthy'], autoFallback: false })
  assert.deepEqual(
    h.calls.map((c) => c.headers.Authorization),
    ['Bearer restricted', 'Bearer healthy', 'Bearer healthy']
  )
  assert.equal(h.events.filter((e) => e.type === 'done').length, 2)
  assert.equal(h.events.some((e) => e.type === 'error' || e.type === 'status'), false)
})

test('sends less history when a request is over the per-minute input limit', async () => {
  const assistant = (content: string): ChatMessage => ({ id: crypto.randomUUID(), role: 'assistant', content, createdAt: 0 })
  const history = [user('old '.repeat(3000)), assistant('old answer'), user('newest question')]
  const h = harness((_call, index) =>
    index === 0
      ? json(413, { error: { message: 'Request too large for model on input tokens per minute (ITPM): Limit 7000, Requested 12000' } })
      : sse([chunk({ content: 'ok' }, 'stop')])
  )
  await h.run({ model: ORION_ULTRA, messages: history, autoFallback: false })
  assert.equal(h.calls.length, 2)
  const first = h.calls[0].body.messages as Record<string, unknown>[]
  const retry = h.calls[1].body.messages as Record<string, unknown>[]
  assert.ok(retry.length < first.length)
  assert.equal(retry.at(-1)?.content, 'newest question')
  assert.equal(h.events.some((e) => e.type === 'status' || e.type === 'error'), false)
  assert.equal(h.events.at(-1)?.type, 'done')
})

test('trims long history to a model’s input limit before sending', async () => {
  const assistant = (content: string): ChatMessage => ({ id: crypto.randomUUID(), role: 'assistant', content, createdAt: 0 })
  const history = [user('old '.repeat(20000)), assistant('old answer'), user('newest question')]
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ model: ORION_ULTRA, messages: history, autoFallback: false })
  const sent = h.calls[0].body.messages as Record<string, unknown>[]
  assert.deepEqual(
    sent.map((m) => m.content),
    ['sys', 'old answer', 'newest question']
  )
})

test('hands a message that is too long for a model to Apex, which has the most room', async () => {
  const h = harness((call) =>
    call.model === ORION_ULTRA
      ? json(413, { error: { message: 'Request too large on input tokens per minute (ITPM): Limit 7000, Requested 9000' } })
      : sse([chunk({ content: 'ok' }, 'stop')])
  )
  await h.run({ model: ORION_ULTRA, messages: [user('long '.repeat(3000))] })
  assert.deepEqual(
    h.calls.map((c) => c.model),
    [ORION_ULTRA, ORION_APEX]
  )
  assert.equal(h.events[0].type, 'status')
  assert.match((h.events[0] as { message: string }).message, /this long\. Switching to ORION Apex/)
  assert.deepEqual(h.events.at(-1), { type: 'done', model: ORION_APEX, truncated: false })
})

test('says which model to try when a message is too long and fallback is off', async () => {
  const h = harness(() => json(413, { error: { message: 'Request too large on input tokens per minute (ITPM): Limit 7000, Requested 9000' } }))
  await h.run({ model: ORION_ULTRA, messages: [user('long '.repeat(3000))], autoFallback: false })
  assert.equal(h.calls.length, 1)
  assert.match(errorMessage(h.events), /too long for ORION Ultra.*ORION Apex/)
})

test('when Apex overflows on its own web search, ORION Core searches instead and nothing half-shown remains', async () => {
  const h = harness((call) =>
    call.model === ORION_APEX
      ? sse([chunk({ reasoning: 'raw page dump', executed_tools: [{ type: 'search' }] }), { error: { message: 'Request Entity Too Large' } }])
      : sse([chunk({ reasoning: 'Looking it up' }), chunk({ content: 'SpaceX launched' }, 'stop')])
  )
  await h.run({ model: ORION_APEX, autoFallback: false })
  assert.deepEqual(
    h.calls.map((c) => c.model),
    [ORION_APEX, ORION_CORE]
  )
  assert.deepEqual(h.calls[1].body.tools, [{ type: 'browser_search' }])
  assert.equal(text(h.events, 'reasoning'), 'Looking it up')
  assert.equal(text(h.events, 'content'), 'SpaceX launched')
  assert.ok(h.events.some((e) => e.type === 'status' && /searching instead/.test(e.message)))
  assert.deepEqual(h.events.at(-1), { type: 'done', model: ORION_CORE, truncated: false })
})

test('shows Apex reasoning once its answer starts', async () => {
  const h = harness(() => sse([chunk({ reasoning: 'Searching' }), chunk({ content: 'Answer' }, 'stop')]))
  await h.run({ model: ORION_APEX, autoFallback: false })
  assert.equal(h.calls.length, 1)
  assert.deepEqual(
    h.events.filter((e) => e.type === 'delta'),
    [{ type: 'delta', content: 'Answer', reasoning: 'Searching' }]
  )
  assert.deepEqual(h.events.at(-1), { type: 'done', model: ORION_APEX, truncated: false })
})

test('asks for less output when the request is over a model’s per-minute output limit', async () => {
  const h = harness((_call, index) =>
    index === 0
      ? json(429, {
          error: {
            message:
              "Request too large for model `qwen/qwen3.8-27b` on output tokens per minute (OTPM): Limit 1000, Requested 2048. The request's expected output tokens exceed the enforced limit"
          }
        })
      : sse([chunk({ content: 'ok' }, 'stop')])
  )
  await h.run({ apiKeys: ['only'], autoFallback: false })
  assert.equal(h.calls.length, 2)
  assert.equal('max_completion_tokens' in h.calls[0].body, false)
  assert.equal(h.calls[1].body.max_completion_tokens, 1000)
  assert.equal(h.calls[1].headers.Authorization, 'Bearer only')
  assert.equal(h.events.at(-1)?.type, 'done')
})

test('ORION Pro calls Qwen 3.8 with thinking off, and answers under its own name', async () => {
  const h = harness(() => sse([chunk({ content: 'ok' }, 'stop')]))
  await h.run({ model: ORION_PRO, autoFallback: false })
  assert.equal(h.calls[0].body.model, 'qwen/qwen3.8-27b')
  assert.equal(h.calls[0].body.reasoning_effort, 'none')
  assert.equal('max_completion_tokens' in h.calls[0].body, false, 'Qwen 3.8 needs no reduced reply budget')
  assert.deepEqual(h.events.at(-1), { type: 'done', model: ORION_PRO, truncated: false })
})

test('chats and settings on the retired Qwen 3.6 move to ORION Pro', () => {
  assert.equal(currentModelId('qwen/qwen3.6-27b'), ORION_PRO)
  assert.equal(modelLabel('qwen/qwen3.6-27b'), 'ORION Pro')
  assert.equal(currentModelId(ORION_ULTRA), ORION_ULTRA)
  assert.equal(currentModelId('some/removed-model'), ORION_CORE)
  assert.equal(currentModelId(undefined), ORION_CORE)
})

test('starts from the key that last worked instead of retrying spent keys first', async () => {
  const h = harness((call) => (call.headers.Authorization === 'Bearer spent' ? json(429, { error: { message: 'Rate limit reached' } }) : sse([chunk({ content: 'ok' }, 'stop')])))
  await h.run({ apiKeys: ['spent', 'fresh'], autoFallback: false })
  await h.run({ apiKeys: ['spent', 'fresh'], autoFallback: false })
  assert.deepEqual(
    h.calls.map((c) => c.headers.Authorization),
    ['Bearer spent', 'Bearer fresh', 'Bearer fresh']
  )
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
