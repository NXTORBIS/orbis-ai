import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWithContinuation } from './longGeneration.ts'
import type { RunSegment } from './longGeneration.ts'
import type { ChatMessage, StreamEvent } from '../shared/types'

const user = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content, createdAt: 0 })

/** A fake `runSegment`: each call gets the next scripted response in turn, and records the messages it was sent. */
function scripted(responses: { content: string; truncated: boolean; model?: string }[]): { runSegment: RunSegment; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = []
  let i = 0
  const runSegment: RunSegment = async (messages, emit) => {
    calls.push(messages)
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    const model = r.model ?? 'openai/gpt-oss-20b'
    emit({ type: 'start', model })
    // Split into a few chunks, the way a real stream would arrive, so the dedupe/forwarding logic is genuinely exercised.
    for (const piece of r.content.match(/.{1,17}/gs) ?? []) emit({ type: 'delta', content: piece })
    emit({ type: 'done', model, truncated: r.truncated })
  }
  return { runSegment, calls }
}

function collect(events: StreamEvent[] = []): { events: StreamEvent[]; emit: (e: StreamEvent) => void; text(): string } {
  return {
    events,
    emit: (e) => events.push(e),
    text: () => events.filter((e): e is Extract<StreamEvent, { type: 'delta' }> => e.type === 'delta').map((e) => e.content ?? '').join('')
  }
}

test('an ordinary short answer that finishes normally makes exactly one call, and is not touched', async () => {
  const { runSegment, calls } = scripted([{ content: 'Photosynthesis turns light into sugar.', truncated: false }])
  const out = collect()
  await generateWithContinuation({ messages: [user('Explain photosynthesis.')], emit: out.emit, signal: new AbortController().signal, runSegment })
  assert.equal(calls.length, 1)
  assert.equal(out.text(), 'Photosynthesis turns light into sugar.')
  assert.deepEqual(out.events.filter((e) => e.type === 'done'), [{ type: 'done', model: 'openai/gpt-oss-20b', truncated: false }])
  // Exactly one 'start' reaches the caller, for exactly one logical answer.
  assert.equal(out.events.filter((e) => e.type === 'start').length, 1)
})

test('a request for a word count that is truncated continues automatically, with no request from the caller to do so', async () => {
  const { runSegment, calls } = scripted([
    { content: 'word '.repeat(3), truncated: true },
    { content: 'word '.repeat(3), truncated: false }
  ])
  const out = collect()
  await generateWithContinuation({ messages: [user('Write 100,000 words about numbers.')], emit: out.emit, signal: new AbortController().signal, runSegment })
  assert.equal(calls.length, 2, 'continued on its own, without the caller asking for a second call')
  assert.deepEqual(out.events.filter((e) => e.type === 'done'), [{ type: 'done', model: 'openai/gpt-oss-20b', truncated: false }], 'only ever one done, for one logical answer')
})

test('the second call is given the already-generated content and an instruction that never restarts the sentence', async () => {
  const { runSegment, calls } = scripted([
    { content: 'The rapid rise of AI has changed how students', truncated: true },
    { content: ' learn and think.', truncated: false }
  ])
  await generateWithContinuation({ messages: [user('Write a 10,000-word essay about AI in education.')], emit: () => undefined, signal: new AbortController().signal, runSegment })
  assert.equal(calls.length, 2)
  const secondCall = calls[1]
  assert.equal(secondCall.at(-2)?.role, 'assistant')
  assert.match(secondCall.at(-2)?.content ?? '', /has changed how students$/)
  assert.equal(secondCall.at(-1)?.role, 'user')
  assert.match(secondCall.at(-1)?.content ?? '', /[Dd]o not restart/)
  assert.match(secondCall.at(-1)?.content ?? '', /Write a 10,000-word essay about AI in education\./)
})

test('the person sees one continuous answer: the seam between two segments is not shown twice', async () => {
  const { runSegment } = scripted([
    { content: 'this transformation affects education systems by changing', truncated: true },
    // The model restates the tail of the sentence before continuing, as sometimes happens; it must not be doubled.
    { content: 'education systems by changing how students learn.', truncated: false }
  ])
  const out = collect()
  await generateWithContinuation({ messages: [user('Write a 10,000-word essay.')], emit: out.emit, signal: new AbortController().signal, runSegment })
  assert.equal(out.text(), 'this transformation affects education systems by changing how students learn.')
})

test('a normal finish is never continued, even for a request that asked for a lot of words', async () => {
  const { runSegment, calls } = scripted([{ content: 'A short but complete answer.', truncated: false }])
  await generateWithContinuation({ messages: [user('Write 10,000 words if you need to, but be complete.')], emit: () => undefined, signal: new AbortController().signal, runSegment })
  assert.equal(calls.length, 1, 'truncated was false, so nothing was continued regardless of the request')
})

test('an error during any segment stops the whole chain and is not continued around', async () => {
  const runSegment: RunSegment = async (_messages, emit) => {
    emit({ type: 'start', model: 'openai/gpt-oss-20b' })
    emit({ type: 'delta', content: 'Partial answer' })
    emit({ type: 'error', message: 'The model stopped with an error.' })
  }
  const out = collect()
  await generateWithContinuation({ messages: [user('Write 10,000 words.')], emit: out.emit, signal: new AbortController().signal, runSegment })
  assert.deepEqual(out.events.at(-1), { type: 'error', message: 'The model stopped with an error.' })
  assert.equal(out.events.filter((e) => e.type === 'done').length, 0, 'no fake completion after a real error')
})

test('cancelling stops the whole chain, not just the segment in flight', async () => {
  const controller = new AbortController()
  const runSegment: RunSegment = async (_messages, emit) => {
    emit({ type: 'start', model: 'openai/gpt-oss-20b' })
    emit({ type: 'delta', content: 'word '.repeat(3) })
    controller.abort()
    emit({ type: 'done', model: 'openai/gpt-oss-20b', truncated: true })
  }
  const out = collect()
  await generateWithContinuation({ messages: [user('Write 100,000 words.')], emit: out.emit, signal: controller.signal, runSegment })
  assert.deepEqual(out.events.at(-1), { type: 'aborted' })
})

test('never runs more than the safety ceiling of segments, even for an unbounded soft request', async () => {
  const { runSegment, calls } = scripted([{ content: 'word '.repeat(50), truncated: true }])
  await generateWithContinuation({ messages: [user('Write an extremely comprehensive, exhaustive guide.')], emit: () => undefined, signal: new AbortController().signal, runSegment })
  assert.ok(calls.length <= 12, `expected the segment ceiling to stop it, got ${calls.length} calls`)
})

test('status, research and other event types pass straight through, unaltered, from every segment', async () => {
  const runSegment: RunSegment = async (_messages, emit) => {
    emit({ type: 'start', model: 'openai/gpt-oss-20b' })
    emit({ type: 'status', message: 'Switching to ORION Core…' })
    emit({ type: 'delta', content: 'word '.repeat(3) })
    emit({ type: 'done', model: 'openai/gpt-oss-20b', truncated: false })
  }
  const out = collect()
  await generateWithContinuation({ messages: [user('Explain this.')], emit: out.emit, signal: new AbortController().signal, runSegment })
  assert.ok(out.events.some((e) => e.type === 'status' && e.message === 'Switching to ORION Core…'))
})
