import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserControl } from './registry.ts'

/**
 * Saying what would happen, without anything happening.
 *
 * The thing that makes a preview worth showing somebody is that it cannot differ from the run. So every answer comes
 * from the same places the real execution reads, and these tests exist to hold that: a preview must never run the
 * action, never miss that it would ask first, and never claim an action is available when it is not.
 */

function rig(): { control: BrowserControl; ran: string[] } {
  const ran: string[] = []
  const control = new BrowserControl({ sink: async () => undefined })

  control.register({
    id: 'tabs.create',
    domain: 'tabs',
    name: 'Open a tab',
    description: 'Opens a tab at an address.',
    params: { url: { type: 'string', description: 'Where.' } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Open ${String(p.url)}`,
    run: async (p) => {
      ran.push(`tabs.create ${String(p.url)}`)
      return { url: p.url }
    },
    verify: () => ({ verified: true, detail: 'open' })
  })

  control.register({
    id: 'history.clear',
    domain: 'history',
    name: 'Clear browsing history',
    description: 'Deletes browsing history.',
    params: {},
    mutates: true,
    confirmation: 'always',
    describe: () => 'Clear all browsing history',
    run: async () => {
      ran.push('history.clear')
      return {}
    },
    verify: () => ({ verified: true, detail: 'cleared' })
  })

  control.register({
    id: 'page.read',
    domain: 'page',
    name: 'Read the page',
    description: 'Reads the page.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      ran.push('page.read')
      return { text: 'hello' }
    }
  })

  control.register({
    id: 'shop.buy',
    domain: 'page',
    name: 'Buy',
    description: 'Buys the thing.',
    params: { item: { type: 'string', description: 'What.' } },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Buy ${String(p.item)}`,
    assess: () => ({ decision: 'confirm', reason: 'It spends money.' }),
    run: async () => {
      ran.push('shop.buy')
      return {}
    },
    verify: () => ({ verified: true, detail: 'bought' })
  })

  control.register({
    id: 'page.danger',
    domain: 'page',
    name: 'Something refused',
    description: 'Always refused.',
    params: {},
    mutates: true,
    confirmation: 'none',
    assess: () => ({ decision: 'block', reason: 'Orbis will not do that.' }),
    run: async () => {
      ran.push('page.danger')
      return {}
    },
    verify: () => ({ verified: true, detail: '' })
  })

  return { control, ran }
}

test('a preview says what it would do, in the same words the run would use', async () => {
  const { control, ran } = rig()
  const seen = await control.preview({ capability: 'tabs.create', params: { url: 'https://example.org/' } })
  assert.equal(seen.what, 'Open https://example.org/')
  assert.equal(seen.available, true)
  assert.equal(seen.mutates, true)
  assert.deepEqual(ran, [], 'a preview must never run the action')
})

test('it says when the user would be asked first', async () => {
  const { control, ran } = rig()
  const clearing = await control.preview({ capability: 'history.clear' })
  assert.equal(clearing.willAsk, true)
  assert.ok(clearing.why.length > 0, 'and why')

  const buying = await control.preview({ capability: 'shop.buy', params: { item: 'a laptop' } })
  assert.equal(buying.willAsk, true)
  assert.equal(buying.why, 'It spends money.')
  assert.deepEqual(ran, [])
})

test('reading something is not asked about', async () => {
  const { control } = rig()
  const seen = await control.preview({ capability: 'page.read' })
  assert.equal(seen.willAsk, false)
  assert.equal(seen.mutates, false)
})

test('the person acting in Orbis themselves is not asked', async () => {
  const { control } = rig()
  assert.equal((await control.preview({ capability: 'history.clear', source: 'user' })).willAsk, false)
  assert.equal((await control.preview({ capability: 'history.clear', source: 'orion' })).willAsk, true)
})

test('something that would be refused is reported as refused, not as fine', async () => {
  const { control, ran } = rig()
  const seen = await control.preview({ capability: 'page.danger' })
  assert.equal(seen.available, false)
  assert.equal(seen.problem, 'Orbis will not do that.')
  assert.deepEqual(ran, [])
})

test('a capability that does not exist says so rather than inventing one', async () => {
  const { control } = rig()
  const seen = await control.preview({ capability: 'nothing.atAll' })
  assert.equal(seen.available, false)
  assert.ok(seen.problem)
})

test('a preview of everything in a plan runs none of it', async () => {
  const { control, ran } = rig()
  const plan = [
    { capability: 'tabs.create', params: { url: 'https://example.org/' } },
    { capability: 'page.read', params: {} },
    { capability: 'history.clear', params: {} }
  ]
  const previews = []
  for (const step of plan) previews.push(await control.preview(step))
  assert.deepEqual(ran, [], 'nothing in the plan ran')
  assert.deepEqual(
    previews.map((p) => `${p.what}${p.willAsk ? ' (asks first)' : ''}`),
    ['Open https://example.org/', 'Read the page', 'Clear all browsing history (asks first)']
  )
})
