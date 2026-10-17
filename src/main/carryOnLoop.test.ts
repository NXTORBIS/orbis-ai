import { test } from 'node:test'
import assert from 'node:assert/strict'
import { streamChat } from './nim.ts'
import type { ChatMessage, StreamEvent } from '../shared/types.ts'

/**
 * One long answer, carried across several keys.
 *
 * A model stops with `finish_reason: "length"` when it runs out of room, and Orbis used to stop with it -- so a
 * long answer simply ended mid-sentence. It now asks the next key to carry straight on, and keeps doing that until
 * the answer is really finished.
 *
 * Nothing here touches the network: `fetchFn` is handed in, so each leg is a scripted reply and the test can say
 * exactly what the second key was asked and what the person ended up seeing.
 */

interface Leg {
  /** What this leg writes. */
  text: string
  /** Why it stopped: 'length' means it ran out of room and another leg should follow. */
  finish: 'length' | 'stop'
}

/** An SSE body shaped the way Groq sends one. */
function streamOf(leg: Leg): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const frames = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: leg.text } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: leg.finish }] }),
    'data: [DONE]'
  ]
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f + String.fromCharCode(10, 10)))
      controller.close()
    }
  })
}

interface Asked { key: string; body: Record<string, unknown> }

/** Runs a reply against a scripted list of legs, and reports what was asked and what was shown. */
async function run(legs: Leg[], keys = ['key-one', 'key-two', 'key-three']): Promise<{ shown: string; asked: Asked[]; done: StreamEvent | null }> {
  let leg = 0
  const asked: Asked[] = []
  let shown = ''
  let done: StreamEvent | null = null
  const messages: ChatMessage[] = [{ id: 'q', role: 'user', content: 'Write me something long.', createdAt: 0 }]

  await streamChat({
    apiKeys: keys,
    model: 'orion-core',
    messages,
    systemPrompt: 'You are Orion.',
    reasoningEffort: 'low',
    autoFallback: false,
    signal: new AbortController().signal,
    emit: (event) => {
      if (event.type === 'delta' && event.content) shown += event.content
      if (event.type === 'done') done = event
    },
    fetchFn: (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      asked.push({ key: String(init.headers.Authorization).replace('Bearer ', ''), body: JSON.parse(init.body) })
      const here = legs[Math.min(leg, legs.length - 1)]
      leg += 1
      return { ok: true, status: 200, statusText: 'OK', headers: new Headers(), body: streamOf(here), text: async () => '' }
    }) as never
  })
  return { shown, asked, done }
}

test('a reply that runs out of room is carried on, and the person sees one answer', async () => {
  const { shown, asked, done } = await run([
    { text: 'The first part of the answer, which stops', finish: 'length' },
    { text: ' and then the rest of it.', finish: 'stop' }
  ])
  assert.equal(shown, 'The first part of the answer, which stops and then the rest of it.')
  assert.equal(asked.length, 2, 'two legs were fetched')
  assert.equal(done && (done as { truncated?: boolean }).truncated, false, 'the answer is not reported as cut short')
})

test('the next leg uses a different key', async () => {
  const { asked } = await run([
    { text: 'Part one', finish: 'length' },
    { text: ' part two.', finish: 'stop' }
  ])
  assert.notEqual(asked[0].key, asked[1].key, 'the second leg went to another key')
})

test('the next leg is told what to carry on from, and is not asked to think again', async () => {
  const { asked } = await run([
    { text: 'Once upon a time there was a very long answer', finish: 'length' },
    { text: ' that finally ended.', finish: 'stop' }
  ])
  const second = asked[1].body as { messages: { role: string; content: unknown }[]; reasoning_effort?: string }
  const last = second.messages[second.messages.length - 1]
  assert.equal(last.role, 'user')
  const said = String(last.content)
  assert.match(said, /carry straight on/i)
  assert.match(said, /very long answer/, 'the words it stopped at are quoted back to it')
  assert.match(said, /do not repeat/i)
  // A later leg spends its room writing rather than reasoning the same plan out again. On a model that does no
  // reasoning nothing is sent at all, which is equally fine -- what must never happen is a later leg asking for
  // high effort and spending its whole budget thinking before it writes a word.
  assert.ok(
    second.reasoning_effort === undefined || second.reasoning_effort === 'low',
    'a later leg must not re-reason at full effort, was ' + String(second.reasoning_effort)
  )
})

test('a leg that repeats the last sentence does not say it twice', async () => {
  const { shown } = await run([
    { text: 'Set the time control. Press the button to start the clock', finish: 'length' },
    { text: 'Press the button to start the clock, then play your move.', finish: 'stop' }
  ])
  assert.equal(shown.split('Press the button').length - 1, 1, 'the repeated sentence appears once')
  assert.ok(shown.endsWith('then play your move.'))
})

test('a leg that adds nothing stops the loop rather than going round again', async () => {
  // Every leg returns the same words: the first carry-on adds nothing, so there must be no third request.
  const { asked, shown } = await run([
    { text: 'The same words every time.', finish: 'length' },
    { text: 'The same words every time.', finish: 'length' }
  ])
  assert.equal(asked.length, 2, 'it stopped after the leg that added nothing')
  assert.equal(shown, 'The same words every time.')
})

test('a model that never finishes is stopped, and the answer says it was cut short', async () => {
  // Each leg adds new text and always claims it ran out of room: only the ceiling can end this.
  let n = 0
  const legs: Leg[] = Array.from({ length: 40 }, () => ({ text: '', finish: 'length' as const }))
  const grow = { get length() { return legs.length }, ...legs }
  void grow
  const { asked, done } = await (async () => {
    const made: Leg[] = []
    for (let i = 0; i < 40; i++) made.push({ text: 'Sentence number ' + i + ' goes on and on. ', finish: 'length' })
    n = made.length
    return run(made)
  })()
  assert.ok(n > 0)
  assert.ok(asked.length <= 13, 'it stopped at the ceiling rather than for ever, was ' + asked.length)
  assert.equal(done && (done as { truncated?: boolean }).truncated, true, 'and says the answer was cut short')
})
