import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserControl, DEFAULT_CAPABILITY_TIMEOUT_MS, effectsOf } from './registry.ts'

/**
 * Two things every action now carries: what kind of effect it has, and how long it may take.
 *
 * Both were missing in the same way. `mutates` put "scroll the page" and "delete the history" in one box, so any rule
 * about consequences had to be a list of capability names somebody kept up to date by hand. And nothing had a
 * deadline of its own, so a capability that never returned hung whoever called it -- and if that caller had no
 * deadline either, hung for good.
 */

const base = {
  domain: 'tabs' as const,
  name: 'A thing',
  description: 'Does a thing.',
  params: {},
  confirmation: 'none' as const
}

test('something that changes nothing reads, and something that changes something writes', () => {
  assert.deepEqual(effectsOf({ mutates: false }), ['read'])
  assert.deepEqual(effectsOf({ mutates: true }), ['write'])
})

test('a capability that declares a stronger effect keeps it', () => {
  assert.deepEqual(effectsOf({ mutates: true, effects: ['delete'] }), ['delete'])
  assert.deepEqual(effectsOf({ mutates: true, effects: ['write', 'communicate'] }), ['write', 'communicate'])
})

test('what a capability does is declared, never read out of its name', () => {
  // The point of the rule, stated as a test: a name containing "delete" proves nothing.
  assert.deepEqual(effectsOf({ mutates: true }), ['write'], 'nothing here looks at an id at all')
})

test('every capability says what it does, and that travels with it', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.register({ ...base, id: 'tabs.peek', mutates: false, run: async () => ({}) })
  control.register({ ...base, id: 'history.clear', mutates: true, effects: ['delete'], run: async () => ({}) })

  const listed = await control.list({}, 'orion')
  const byId = new Map(listed.map((one) => [one.id, one]))
  assert.deepEqual(byId.get('tabs.peek')?.effects, ['read'])
  assert.deepEqual(byId.get('history.clear')?.effects, ['delete'])
})

test('a capability that never finishes is given up on rather than hanging for ever', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.register({
    ...base,
    id: 'tabs.hang',
    mutates: false,
    timeoutMs: 1000,
    run: () => new Promise(() => undefined)
  })

  const started = Date.now()
  const result = (await control.execute({ capability: 'tabs.hang', params: {}, source: 'user' }, { confirm: async () => true })) as { ok: boolean; error?: { code: string; message: string } }
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'timeout')
  assert.match(result.error!.message, /still be going/i, 'it says Orbis stopped waiting, not that it stopped the work')
  assert.ok(Date.now() - started < 10_000, 'and it gave up near its own deadline')
})

test('a capability that finishes in time is untouched by the deadline', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.register({ ...base, id: 'tabs.quick', mutates: false, timeoutMs: 5000, run: async () => ({ fine: true }) })
  const result = (await control.execute({ capability: 'tabs.quick', params: {}, source: 'user' }, { confirm: async () => true })) as { ok: boolean; data?: { fine: boolean } }
  assert.equal(result.ok, true)
  assert.equal(result.data?.fine, true)
})

test('the default deadline is long enough for real work and short enough to be a deadline', () => {
  assert.ok(DEFAULT_CAPABILITY_TIMEOUT_MS >= 30_000)
  assert.ok(DEFAULT_CAPABILITY_TIMEOUT_MS <= 300_000)
})
