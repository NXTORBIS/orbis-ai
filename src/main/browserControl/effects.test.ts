import assert from 'node:assert/strict'
import test from 'node:test'
import { backoffFor, BrowserControl, DEFAULT_CAPABILITY_TIMEOUT_MS, effectsOf, MAX_RETRY_WAIT_MS } from './registry.ts'
import { DEFAULT_EFFECT_POLICY, readEffectPolicy } from '../../shared/effectPolicy.ts'

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

test('a kind of action set to never is refused, whatever area it is in', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.setEffectPolicy(readEffectPolicy({ ...DEFAULT_EFFECT_POLICY, delete: 'never' }))
  let ran = false
  control.register({ ...base, id: 'history.clear', domain: 'history', mutates: true, effects: ['delete'], run: async () => ((ran = true), {}) })

  const result = (await control.execute({ capability: 'history.clear', params: {}, source: 'orion' }, { confirm: async () => true })) as { ok: boolean; error?: { message: string } }
  assert.equal(result.ok, false)
  assert.equal(ran, false, 'and it really did not run')
  assert.match(result.error!.message, /remove things/i)
})

test('a kind of action set to ask is asked about, even when the capability itself would not have', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.setEffectPolicy(readEffectPolicy({ ...DEFAULT_EFFECT_POLICY, write: 'ask' }))
  control.register({ ...base, id: 'tabs.create', mutates: true, confirmation: 'none', run: async () => ({}) })

  let asked = false
  const result = (await control.execute({ capability: 'tabs.create', params: {}, source: 'orion' }, { confirm: async () => ((asked = true), true) })) as { ok: boolean }
  assert.equal(asked, true)
  assert.equal(result.ok, true)
})

test('the person acting in Orbis themselves is never stopped by this', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.setEffectPolicy(readEffectPolicy({ ...DEFAULT_EFFECT_POLICY, delete: 'never' }))
  control.register({ ...base, id: 'history.clear', domain: 'history', mutates: true, effects: ['delete'], run: async () => ({ done: true }) })

  const result = (await control.execute({ capability: 'history.clear', params: {}, source: 'user' }, { confirm: async () => true })) as { ok: boolean }
  assert.equal(result.ok, true, 'it decides what Orbis may do on your behalf, not what you may do')
})

test('reading is left alone by a policy that only tightens changes', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.setEffectPolicy(readEffectPolicy({ ...DEFAULT_EFFECT_POLICY, write: 'never', delete: 'never' }))
  control.register({ ...base, id: 'tabs.count', mutates: false, run: async () => ({ n: 3 }) })
  const result = (await control.execute({ capability: 'tabs.count', params: {}, source: 'orion' }, { confirm: async () => false })) as { ok: boolean }
  assert.equal(result.ok, true)
})

test('a capability that gives back what it promises passes it on', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.register({ ...base, id: 'tabs.count', mutates: false, returns: { count: { type: 'integer', description: 'How many.', required: true } }, run: async () => ({ count: 3 }) })
  const result = (await control.execute({ capability: 'tabs.count', params: {}, source: 'user' }, { confirm: async () => true })) as { ok: boolean; data?: { count: number } }
  assert.equal(result.ok, true)
  assert.equal(result.data?.count, 3)
})

test('a capability that gives back the wrong shape fails rather than passing half a result on', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.register({ ...base, id: 'tabs.count', mutates: false, returns: { count: { type: 'integer', description: 'How many.', required: true } }, run: async () => ({ count: 'three' }) })
  const result = (await control.execute({ capability: 'tabs.count', params: {}, source: 'user' }, { confirm: async () => true })) as { ok: boolean; error?: { message: string } }
  assert.equal(result.ok, false)
  assert.match(result.error!.message, /did not give back what it promises/)
})

test('a promise that was not kept at all is caught, not treated as an empty answer', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.register({ ...base, id: 'tabs.count', mutates: false, returns: { count: { type: 'integer', description: 'How many.', required: true } }, run: async () => ({}) })
  const result = (await control.execute({ capability: 'tabs.count', params: {}, source: 'user' }, { confirm: async () => true })) as { ok: boolean; error?: { message: string } }
  assert.equal(result.ok, false)
  assert.match(result.error!.message, /did not come back/)
})

test('a capability that promises nothing is not held to anything', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.register({ ...base, id: 'tabs.odd', mutates: false, run: async () => 'just a string' })
  const result = (await control.execute({ capability: 'tabs.odd', params: {}, source: 'user' }, { confirm: async () => true })) as { ok: boolean }
  assert.equal(result.ok, true)
})

test('extra fields are fine: a promise says what will be there, not what will not', async () => {
  const control = new BrowserControl({ sink: async () => undefined })
  control.register({ ...base, id: 'tabs.count', mutates: false, returns: { count: { type: 'integer', description: 'How many.', required: true } }, run: async () => ({ count: 1, extra: 'ok' }) })
  const result = (await control.execute({ capability: 'tabs.count', params: {}, source: 'user' }, { confirm: async () => true })) as { ok: boolean }
  assert.equal(result.ok, true)
})

test('the wait between attempts doubles, and stops growing', () => {
  assert.equal(backoffFor(2, 400), 400)
  assert.equal(backoffFor(3, 400), 800)
  assert.equal(backoffFor(4, 400), 1600)
  assert.equal(backoffFor(20, 400), MAX_RETRY_WAIT_MS, 'past the ceiling, waiting is worse than failing and saying so')
  assert.equal(backoffFor(1, 400), 400, 'the first attempt does not wait at all; this is only asked from the second')
})
