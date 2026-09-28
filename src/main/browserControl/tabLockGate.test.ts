import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrowserControl } from './registry.ts'
import { classifyFailure, decideRecovery } from '../../shared/orbTask.ts'

/**
 * The gate that keeps a locked tab away from everything.
 *
 * One check in `execute`, which is the only way any capability runs -- so these tests are about the funnel, not about
 * any particular capability. If the funnel holds, a capability registered tomorrow is protected tomorrow.
 */

/** A capability that reads a page, recording whether it was ever allowed to. */
const reader = (): { def: Parameters<BrowserControl['register']>[0]; touched: () => number } => {
  let observed = 0
  let ran = 0
  return {
    def: {
      id: 'page.readText',
      domain: 'page',
      name: 'Read the page',
      description: 'The text of the page',
      params: {},
      mutates: false,
      confirmation: 'none',
      observe: () => {
        observed++
        return { text: 'Account balance: £41,203.55' }
      },
      run: () => {
        ran++
        return { text: 'Account balance: £41,203.55' }
      }
    },
    touched: () => observed + ran
  }
}

const control = (): { layer: BrowserControl; touched: () => number } => {
  const layer = new BrowserControl()
  const page = reader()
  layer.register(page.def)
  return { layer, touched: page.touched }
}

const ask = (layer: BrowserControl, source: 'user' | 'orion' = 'orion') =>
  layer.execute(
    { capability: 'page.readText', params: {}, target: { tabId: 'tab-7' } },
    { source, confirm: async () => true }
  )

test('with nothing wired in, the layer behaves exactly as it did before tab locking existed', async () => {
  const { layer, touched } = control()
  const result = await ask(layer)
  assert.equal(result.ok, true)
  assert.ok(touched() > 0)
})

test('a locked tab is refused, and the page is never even looked at', async () => {
  const { layer, touched } = control()
  layer.useLockedTabCheck(() => ({ locked: true, groupId: 'personal' }))

  const result = await ask(layer)
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'tab-locked')
  // The decisive one. Refusing after reading the page would have already leaked it.
  assert.equal(touched(), 0, 'the capability was not observed and not run')
})

test('the refusal says nothing about the page', async () => {
  const { layer } = control()
  layer.useLockedTabCheck(() => ({ locked: true, groupId: 'personal' }))
  const result = await ask(layer)
  const said = JSON.stringify(result).toLowerCase()
  for (const giveaway of ['balance', '41,203', 'account balance']) {
    assert.ok(!said.includes(giveaway), `"${giveaway}" leaked through the refusal`)
  }
})

test('the refusal is marked recoverable, because a password fixes it', async () => {
  const { layer } = control()
  layer.useLockedTabCheck(() => ({ locked: true }))
  const result = await ask(layer)
  assert.equal(result.error?.recoverable, true)
})

test('an unlocked tab passes through', async () => {
  const { layer, touched } = control()
  layer.useLockedTabCheck(() => ({ locked: false }))
  const result = await ask(layer)
  assert.equal(result.ok, true)
  assert.ok(touched() > 0)
})

test('the person acting in Orbis themselves is refused too', async () => {
  // A lock that only stopped Orion would be a lock on Orion, not on the tab. Somebody who walked up to the computer is
  // exactly who this protects against.
  const { layer, touched } = control()
  layer.useLockedTabCheck(() => ({ locked: true }))
  const result = await ask(layer, 'user')
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'tab-locked')
  assert.equal(touched(), 0)
})

test('the check is given what it needs to identify the tab', async () => {
  const { layer } = control()
  const seen: { capability: string; target: unknown }[] = []
  layer.useLockedTabCheck((capability, params, target) => {
    seen.push({ capability, target })
    void params
    return { locked: false }
  })
  await ask(layer)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].capability, 'page.readText')
  assert.deepEqual(seen[0].target, { tabId: 'tab-7' })
})

test('unwiring the check restores the earlier behaviour rather than refusing everything', async () => {
  const { layer, touched } = control()
  layer.useLockedTabCheck(() => ({ locked: true }))
  assert.equal((await ask(layer)).ok, false)
  layer.useLockedTabCheck(null)
  assert.equal((await ask(layer)).ok, true)
  assert.ok(touched() > 0)
})

test('a check that throws is a shut lock, not an open one', async () => {
  const { layer, touched } = control()
  layer.useLockedTabCheck(() => {
    throw new Error('the security layer is not up')
  })
  // A fault in the security layer must not become a way past every lock in it. It refuses, cleanly, with the code a
  // caller already knows how to handle -- rather than throwing out of `execute` into a workflow that was not expecting it.
  const result = await ask(layer)
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'tab-locked')
  assert.equal(touched(), 0, 'and the page was never read')
})

// ---------------------------------------------------------------- what the Orb does about it

test('the Orb asks the person rather than retrying or finding a way round', () => {
  const kind = classifyFailure({ code: 'tab-locked', message: 'locked', recoverable: true })
  assert.equal(kind, 'tab-locked')
  for (const tries of [0, 1, 2, 5]) {
    assert.equal(decideRecovery(kind, tries, true), 'ask-user', `at ${tries} tries it did something else`)
  }
})

test('a locked tab is not confused with a blocked action', () => {
  assert.notEqual(classifyFailure({ code: 'tab-locked', message: '', recoverable: true }), 'blocked')
  assert.equal(classifyFailure({ code: 'blocked', message: '', recoverable: false }), 'blocked')
})
