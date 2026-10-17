import { test } from 'node:test'
import assert from 'node:assert/strict'
import { streamChat } from './nim.ts'
import type { ChatMessage, StreamEvent } from '../shared/types.ts'

/**
 * A model that would not answer, and Auto asking another one.
 *
 * Asked for a reference on the rules of chess, one model answered in full: "I'm sorry, but I can't provide that."
 * Two other models wrote thousands of words on the same request, so that was the model failing rather than the
 * request being refusable -- but it is a successful request, so it used to go straight to the screen.
 *
 * Nothing here touches the network: `fetchFn` is handed in, so the test says which model refuses and can check
 * both the thing that matters (the refusal is never shown) and the thing that must still hold (if every model
 * declines, the person is told, not left with nothing).
 */

const REFUSAL = "I'm sorry, but I can't provide that."

/** An SSE body shaped the way Groq sends one. */
function streamOf(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const frames = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]'
  ]
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f + String.fromCharCode(10, 10)))
      controller.close()
    }
  })
}

interface Ran {
  shown: string
  statuses: string[]
  errors: string[]
  done: StreamEvent | null
  models: string[]
}

/** Runs one reply. `reply` decides what each model in turn says, by the model name the request carries. */
async function run(reply: (model: string, turn: number) => string): Promise<Ran> {
  const out: Ran = { shown: '', statuses: [], errors: [], done: null, models: [] }
  let turn = 0
  const messages: ChatMessage[] = [{ id: 'q', role: 'user', content: 'Write me a reference on the rules of chess.', createdAt: 0 }]

  await streamChat({
    apiKeys: ['key-one', 'key-two'],
    model: 'orion-core',
    messages,
    systemPrompt: 'You are Orion.',
    reasoningEffort: 'low',
    autoFallback: true,
    signal: new AbortController().signal,
    emit: (event) => {
      if (event.type === 'delta' && event.content) out.shown += event.content
      if (event.type === 'status') out.statuses.push(event.message)
      if (event.type === 'error') out.errors.push(event.message)
      if (event.type === 'done') out.done = event
    },
    fetchFn: (async (_url: string, init: { body: string }) => {
      const model = String((JSON.parse(init.body) as { model?: string }).model ?? '')
      out.models.push(model)
      const said = reply(model, turn++)
      return { ok: true, status: 200, statusText: 'OK', headers: new Headers(), body: streamOf(said), text: async () => '' }
    }) as never
  })
  return out
}

test('a flat refusal is never shown, and another model answers instead', async () => {
  const answer = 'The board is eight squares by eight. White moves first.'
  const out = await run((_model, turn) => (turn === 0 ? REFUSAL : answer))

  assert.equal(out.shown, answer, 'the person sees the answer and only the answer')
  assert.ok(!out.shown.includes('sorry'), 'nothing of the refusal reached the screen')
  assert.deepEqual(out.errors, [], 'a refusal that was recovered from is not an error')
  assert.ok(out.models.length >= 2, 'a second model was asked')
  assert.notEqual(out.models[0], out.models[1], 'and it is a different model, not the same one again')
  assert.ok(
    out.statuses.some((m) => m.includes('would not answer')),
    'the person is told which model declined: ' + JSON.stringify(out.statuses)
  )
})

test('an answer that is merely short is left alone', async () => {
  const out = await run(() => 'No, that is stalemate.')
  assert.equal(out.shown, 'No, that is stalemate.')
  assert.equal(out.models.length, 1, 'nothing was retried')
  assert.deepEqual(out.statuses, [])
})

test('if every model declines, the refusal is shown rather than nothing at all', async () => {
  const out = await run(() => REFUSAL)
  assert.equal(out.shown, '', 'no model answered, so nothing was streamed')
  assert.ok(out.models.length > 1, 'every model in the chain was asked')
  assert.equal(out.errors.length, 1, 'the person is told, not left with nothing')
  assert.ok(out.errors[0].startsWith('No model would answer that.'), out.errors[0])
  assert.ok(out.errors[0].includes(REFUSAL), 'and the model is quoted rather than Orbis apologising: ' + out.errors[0])
})

test('a long answer that happens to begin with an apology is not treated as a refusal', async () => {
  const said = 'Sorry, I cannot be brief about this. ' + 'The rules of chess are long. '.repeat(40)
  const out = await run(() => said)
  assert.equal(out.shown, said, 'nothing was held back or thrown away')
  assert.equal(out.models.length, 1)
})
