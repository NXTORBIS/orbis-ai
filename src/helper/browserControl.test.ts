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
  await assert.rejects(Promise.resolve(setup(false).handlers['browser:tabs']([], ctx)), /nope/)
  const none = createBrowserControlHandlers(() => null)
  await assert.rejects(Promise.resolve(none['browser:tabs']([], ctx)), /not ready/)
})

test('open, stop, zoom reading, navigation info and group colours map to capabilities; bad addresses and colours never reach the browser', async () => {
  const { handlers, calls } = setup()
  await handlers['browser:do'](['open', { url: 'example.com/a' }], ctx)
  await handlers['browser:do'](['stop'], ctx)
  await handlers['browser:do'](['zoom-get'], ctx)
  await handlers['browser:do'](['nav-info'], ctx)
  await handlers['browser:do'](['group-rename', { groupId: '3', name: 'Work', color: '#34d399' }], ctx)
  await handlers['browser:do'](['group-create', { tabIds: ['1'], name: 'Play', color: 'blue' }], ctx)
  assert.deepEqual(calls.map((c) => c.capability), ['tabs.create', 'navigation.stop', 'zoom.get', 'navigation.info', 'groups.rename', 'groups.create'])
  assert.deepEqual(calls[0].params, { url: 'https://example.com/a', active: true })
  assert.deepEqual(calls[4].params, { groupId: '3', name: 'Work', color: '#34d399' })
  const before = calls.length
  for (const bad of [['open', { url: 'javascript:alert(1)' }], ['open', { url: 'file:///C:/x' }], ['open', { url: '' }], ['open', { url: 'a'.repeat(3000) }], ['group-rename', { groupId: '3', name: 'x', color: 'url(x)' }], ['group-create', { tabIds: [], name: 'x', color: 5 }]]) {
    await assert.rejects(Promise.resolve().then(() => handlers['browser:do'](bad, ctx)), /not valid|Only web/)
  }
  assert.equal(calls.length, before)
})

test('the Orb asks for the real page, and the amount it may read is bounded', async () => {
  const { handlers, calls } = setup()
  await handlers['browser:do'](['page-read', {}], ctx)
  await handlers['browser:do'](['page-read', { maxChars: 500 }], ctx)
  // Nonsense and absurd limits fall back to the default rather than reaching the browser as given.
  await handlers['browser:do'](['page-read', { maxChars: -1 }], ctx)
  await handlers['browser:do'](['page-read', { maxChars: 10_000_000 }], ctx)
  assert.deepEqual(calls.map((c) => c.capability), ['page.read', 'page.read', 'page.read', 'page.read'])
  assert.deepEqual(calls.map((c) => (c.params as { maxChars: number }).maxChars), [12_000, 500, 12_000, 12_000])

})

test('putting a tab to sleep maps to its capability with a checked tab id', async () => {
  const { handlers, calls } = setup()
  await handlers['browser:do'](['sleep', { tabId: '7' }], ctx)
  assert.deepEqual(calls[0], { capability: 'tabs.sleep', params: { tabId: '7' } })
  await assert.rejects(Promise.resolve().then(() => handlers['browser:do'](['sleep', {}], ctx)), /not valid/)
})

test('listening reads only web pages, and a page with no text says so', async () => {
  const make = (data: unknown) => createBrowserControlHandlers(() => ({ execute: async () => ({ ok: true, data }) }))
  const good = await make({ url: 'https://a.test/x', title: 'T', text: 'Hello there.' })['page:listen-text']([], ctx)
  assert.deepEqual(good, { url: 'https://a.test/x', title: 'T', text: 'Hello there.' })
  await assert.rejects(Promise.resolve(make({ url: 'chrome://newtab/', text: 'x' })['page:listen-text']([], ctx)), /not a web page/)
  await assert.rejects(Promise.resolve(make({ url: 'https://a.test/', text: '   ' })['page:listen-text']([], ctx)), /no readable text/)
})

test('download search refuses a one-letter query before touching the browser', async () => {
  const { handlers, calls } = setup()
  await assert.rejects(Promise.resolve(handlers['downloads:search'](['a'], ctx)), /at least two/)
  assert.equal(calls.length, 0)
})
