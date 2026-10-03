import assert from 'node:assert/strict'
import test from 'node:test'
import { createWidgetHandlers, type WidgetsDeps } from './widgets.ts'
import type { WidgetBoardState, WidgetEvent, WidgetRequest, WidgetSource } from '../shared/widgetFeed.ts'
import { emptyBoard } from '../shared/widgetBoard.ts'

/**
 * What the browser's start page may ask Orbis about its widgets.
 *
 * The point of these is the shape of the surface, not the answers. The start page is a page, and a page can be
 * anything -- an older version of itself, something with a script in it, whatever is typed into a console. So what
 * matters is that the list of things it can ask is short, that everything it sends is checked before anything reads
 * or writes, and that nothing is left listening when the page goes away.
 */

const state = (): WidgetBoardState => ({ revision: 4, profileId: 'default', board: emptyBoard(), canUndo: false, canRedo: false, layouts: [] })

const parts = (over: Partial<WidgetsDeps> = {}): { deps: WidgetsDeps; asked: unknown[]; tellState: (event: WidgetEvent) => void; tellFeed: (source: WidgetSource) => void; listening: () => number } => {
  const asked: unknown[] = []
  let stateListeners: ((event: WidgetEvent) => void)[] = []
  let feedListeners: ((source: WidgetSource) => void)[] = []
  const deps: WidgetsDeps = {
    runtime: {
      state: async () => state(),
      act: async (request: WidgetRequest, by) => (asked.push({ act: request, by }), { ok: true, state: state(), said: 'Done.' }),
      onEvent: (listener) => {
        stateListeners = [...stateListeners, listener]
        return () => {
          stateListeners = stateListeners.filter((one) => one !== listener)
        }
      },
      rendered: () => null,
      report: (rendered) => asked.push({ rendered }),
      waitForRender: async () => true
    },
    data: {
      feed: async (request) => (asked.push({ feed: request }), { source: request.source, status: 'live', value: null, at: 1 }),
      run: async (command) => (asked.push({ run: command }), { ok: true }),
      onChange: (listener) => {
        feedListeners = [...feedListeners, listener]
        return () => {
          feedListeners = feedListeners.filter((one) => one !== listener)
        }
      }
    },
    ...over
  }
  return {
    deps,
    asked,
    tellState: (event) => stateListeners.forEach((one) => one(event)),
    tellFeed: (source) => feedListeners.forEach((one) => one(source)),
    listening: () => stateListeners.length + feedListeners.length
  }
}

const context = (signal = new AbortController().signal, emit: (event: unknown) => void = () => undefined) => ({ emit, signal })

test('the six channels and nothing else', () => {
  const handlers = createWidgetHandlers(() => parts().deps)
  assert.deepEqual(Object.keys(handlers).sort(), ['widgets:act', 'widgets:data', 'widgets:do', 'widgets:get', 'widgets:rendered', 'widgets:watch'])
})

test('with Orbis not ready yet, every channel says so in words rather than failing silently', async () => {
  const handlers = createWidgetHandlers(() => null)
  for (const name of Object.keys(handlers)) {
    await assert.rejects(async () => handlers[name]([{ type: 'clear' }], context()), /still starting/, name)
  }
})

test('how things stand is handed over as it is', async () => {
  const handlers = createWidgetHandlers(() => parts().deps)
  assert.deepEqual(await handlers['widgets:get']([], context()), state())
})

test('a change the page asks for is marked as coming from the page', async () => {
  const made = parts()
  const handlers = createWidgetHandlers(() => made.deps)
  const answer = await handlers['widgets:act']([{ type: 'add', widget: 'clock' }], context())
  assert.equal((answer as { ok: boolean }).ok, true)
  assert.deepEqual(made.asked[0], { act: { type: 'add', widget: 'clock' }, by: 'page' })
})

test('anything that is not a change Orbis has is refused at the door', async () => {
  const made = parts()
  const handlers = createWidgetHandlers(() => made.deps)
  for (const junk of [undefined, null, 'add', 42, [], {}, { type: 'drop-the-database' }, { type: 7 }]) {
    await assert.rejects(async () => handlers['widgets:act']([junk], context()), /widgets/, JSON.stringify(junk) ?? 'undefined')
  }
  assert.equal(made.asked.length, 0, 'nothing reached the board')
})

test('a source that is not a source is refused, so a page cannot name its own', async () => {
  const made = parts()
  const handlers = createWidgetHandlers(() => made.deps)
  for (const junk of [undefined, {}, { source: 'passwords' }, { source: 'vault' }, { source: 3 }]) {
    await assert.rejects(async () => handlers['widgets:data']([junk], context()), /cannot be shown/)
  }
  assert.equal(made.asked.length, 0)
  const feed = await handlers['widgets:data']([{ source: 'tasks', limit: 4 }], context())
  assert.equal((feed as { source: string }).source, 'tasks')
})

test('a command that is not on the list is refused', async () => {
  const made = parts()
  const handlers = createWidgetHandlers(() => made.deps)
  for (const junk of [undefined, {}, { do: 'shell' }, { do: 'vault.read' }]) {
    await assert.rejects(async () => handlers['widgets:do']([junk], context()), /cannot ask for/)
  }
  await handlers['widgets:do']([{ do: 'task.complete', id: 't1' }], context())
  assert.deepEqual(made.asked[0], { run: { do: 'task.complete', id: 't1' } })
})

test('what the page says it has drawn is passed on, and junk is not', async () => {
  const made = parts()
  const handlers = createWidgetHandlers(() => made.deps)
  assert.equal(await handlers['widgets:rendered']([{ revision: 9, shown: ['a'], failed: [], columns: 4, gallery: false, arranging: false }], context()), true)
  assert.ok(made.asked.some((one) => (one as { rendered?: { revision: number } }).rendered?.revision === 9))
  await assert.rejects(async () => handlers['widgets:rendered']([null], context()), /what the page has drawn/)
})

test('watching sends how things stand, then every change, and stops listening when the page goes', async () => {
  const made = parts()
  const handlers = createWidgetHandlers(() => made.deps)
  const sent: unknown[] = []
  const stopper = new AbortController()
  const watching = handlers['widgets:watch']([], context(stopper.signal, (event) => sent.push(event)))
  const ended = assert.rejects(async () => watching, /stopped watching/)
  await Promise.resolve()
  assert.equal((sent[0] as { type: string }).type, 'state')
  assert.equal(made.listening(), 2)

  made.tellState({ type: 'state', state: state() })
  made.tellFeed('notes')
  assert.equal(sent.length, 3)
  assert.deepEqual(sent[2], { type: 'feed', source: 'notes' })

  stopper.abort()
  await ended
  assert.equal(made.listening(), 0, 'nothing is left listening for a page that has gone')
})

test('a page that has already gone is not listened to at all', async () => {
  const made = parts()
  const handlers = createWidgetHandlers(() => made.deps)
  const stopper = new AbortController()
  stopper.abort()
  await assert.rejects(async () => handlers['widgets:watch']([], context(stopper.signal)), /stopped watching/)
  assert.equal(made.listening(), 0)
})

test('nothing here can read a password, a cookie or another profile', () => {
  const handlers = createWidgetHandlers(() => parts().deps)
  const names = Object.keys(handlers).join(' ')
  for (const word of ['secret', 'vault', 'password', 'cookie', 'token', 'profile']) assert.equal(names.includes(word), false, word)
})
