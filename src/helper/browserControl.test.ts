import assert from 'node:assert/strict'
import test from 'node:test'
import { createBrowserControlHandlers } from './browserControl.ts'

const ctx = { signal: new AbortController().signal } as never
function setup(ok = true) {
  const calls: { capability: string; params: unknown }[] = []
  const handlers = createBrowserControlHandlers(() => ({
    execute: async (c) => (calls.push({ capability: c.capability, params: c.params }), ok ? { ok: true, data: [{ id: '1' }] } : { ok: false, error: { message: 'nope' } })
  }))
  return { calls, handlers }
}

test('tabs and groups are listed through the control layer', async () => {
  const { handlers, calls } = setup()
  assert.deepEqual(await handlers['browser:tabs']([], ctx), [{ id: '1' }])
  await handlers['browser:groups']([], ctx)
  assert.deepEqual(calls.map((c) => c.capability), ['tabs.list', 'groups.list'])
})

test('actions map to capabilities with checked arguments', async () => {
  const { handlers, calls } = setup()
  await handlers['browser:do'](['mute', { tabId: '12', muted: true }], ctx)
  await handlers['browser:do'](['zoom', { action: 'in' }], ctx)
  await handlers['browser:do'](['group-create', { tabIds: ['1', '2'], name: 'Work' }], ctx)
  await handlers['browser:do'](['reload'], ctx)
  assert.deepEqual(calls.map((c) => c.capability), ['tabs.mute', 'zoom.set', 'groups.create', 'navigation.reload'])
  assert.deepEqual(calls[0].params, { tabId: '12', muted: true })
})

test('invalid arguments never reach the browser', async () => {
  const { handlers, calls } = setup()
  for (const bad of [['nuke', {}], ['close', {}], ['close', { tabId: '../x y' }], ['move', { tabId: '1', index: -1 }], ['zoom', { factor: 99 }], ['group-create', { tabIds: [1], name: 'a' }], ['group-rename', { groupId: 'g', name: '' }], [42, {}], ['__proto__', {}]]) {
    await assert.rejects(Promise.resolve().then(() => handlers['browser:do'](bad, ctx)), /not valid|Not a browser/)
  }
  assert.equal(calls.length, 0)
})

test('a failing capability and a missing browser are reported', async () => {
  await assert.rejects(setup(false).handlers['browser:tabs']([], ctx), /nope/)
  const none = createBrowserControlHandlers(() => null)
  await assert.rejects(none['browser:tabs']([], ctx), /not ready/)
})
