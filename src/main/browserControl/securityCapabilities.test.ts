import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrowserControl } from './registry.ts'
import { registerSecurityCapabilities, type SecurityCapabilityDeps } from './securityCapabilities.ts'
import { DEFAULT_POLICY, safeTabInfo } from '../../shared/tabLock.ts'
import { DEFAULT_PROFILE_LOCK } from '../../shared/profileLock.ts'

/**
 * What Orion may do about security.
 *
 * The decisive test in this file is the one that counts the capabilities and finds no way to unlock anything. Everything
 * else here checks that what *is* offered reports safely -- a locked tab must not become readable by asking a different
 * question.
 */

const build = (
  over: Partial<SecurityCapabilityDeps> = {}
): { layer: BrowserControl; lockedTabs: number[]; profileLocked: () => boolean; broughtForward: number[] } => {
  const layer = new BrowserControl()
  const lockedTabs: number[] = []
  const broughtForward: number[] = []
  let profileLocked = false

  const protectedTabs = [
    { tabId: 2, groupId: 'personal', locked: true, lockedBy: 'manual' as const, label: 'Locked Tab' },
    { tabId: 3, groupId: 'personal', locked: false, lockedBy: null, label: 'Locked Tab' }
  ]

  registerSecurityCapabilities({
    control: layer,
    protectedTabs: () => protectedTabs,
    groups: async () => [{ id: 'personal', name: 'Banking', open: false, recoverable: true }],
    policyFor: () => DEFAULT_POLICY,
    policies: async () => ({ tab: DEFAULT_POLICY, profile: DEFAULT_PROFILE_LOCK }),
    describe: async (tabId) => {
      const real = { tabId, url: 'https://bank.example/statement', title: 'Current account — £41,203.55' }
      const found = protectedTabs.find((t) => t.tabId === tabId)
      if (tabId !== 1 && !found) return null
      return safeTabInfo(real, found?.locked === true, DEFAULT_POLICY)
    },
    lockTab: (tabId) => {
      lockedTabs.push(tabId)
      return true
    },
    lockAll: () => 2,
    lockProfile: () => {
      profileLocked = true
    },
    bringForward: async (tabId) => {
      broughtForward.push(tabId)
      return true
    },
    ...over
  })

  return { layer, lockedTabs, profileLocked: () => profileLocked, broughtForward }
}

const run = (layer: BrowserControl, capability: string, params: Record<string, unknown> = {}) =>
  layer.execute({ capability, params, target: {} }, { source: 'orion', confirm: async () => true })

// ---------------------------------------------------------------- the decisive one

test('nothing registered here can unlock anything', () => {
  // The whole design in one assertion. A capability that took a password would be a capability that could be given one.
  const { layer } = build()
  const ids = layer.list({}).map((c) => c.id)
  for (const id of ids) {
    assert.ok(
      !/unlock/i.test(id) || id === 'security.requestUnlock',
      `${id} sounds like it unlocks something`
    )
  }
  assert.ok(!ids.includes('tab.unlock'))
  assert.ok(!ids.includes('profile.unlock'))
})

test('no capability here takes a password', () => {
  const { layer } = build()
  for (const capability of layer.list({})) {
    for (const [name, spec] of Object.entries(capability.params ?? {})) {
      assert.ok(
        !/password|passphrase|secret|credential/i.test(name),
        `${capability.id} takes "${name}"`
      )
      void spec
    }
  }
})

test('asking to unlock asks the person and unlocks nothing', () => {
  const { layer } = build()
  const asked = layer.list({}).find((c) => c.id === 'security.requestUnlock')
  assert.ok(asked)
  assert.equal(asked.mutates, false, 'it changes nothing -- it only puts a screen in front of somebody')
})

// ---------------------------------------------------------------- reporting

test('the status says what is protected without saying what any of it is', async () => {
  const { layer } = build()
  const said = await run(layer, 'security.status')
  assert.equal(said.ok, true)
  const text = JSON.stringify(said)
  for (const giveaway of ['bank.example', '41,203', 'Current account', 'statement']) {
    assert.ok(!text.includes(giveaway), `"${giveaway}" leaked through security.status`)
  }
  const data = said.data as { protected: number; locked: number; passwords: { name: string }[] }
  assert.equal(data.protected, 2)
  assert.equal(data.locked, 1)
  // The name of a tab password is the person's own word for it, and is not a secret.
  assert.deepEqual(data.passwords.map((p) => p.name), ['Banking'])
})

test('a tab’s lock state is a label and nothing else', async () => {
  const { layer } = build()
  const said = await run(layer, 'tab.lockState', { tabId: '2' })
  assert.equal(said.ok, true)
  const data = said.data as { locked: boolean; label: string; url?: unknown }
  assert.equal(data.locked, true)
  assert.equal(data.label, 'Locked Tab')
  assert.equal(data.url, undefined)
  assert.ok(!JSON.stringify(said).includes('bank.example'))
})

test('an unprotected tab says so plainly rather than erroring', async () => {
  const { layer } = build()
  const said = await run(layer, 'tab.lockState', { tabId: '9' })
  assert.equal(said.ok, true)
  assert.deepEqual(said.data, { tabId: 9, protected: false, locked: false })
})

test('safe metadata gives the real thing for an open tab and nothing for a locked one', async () => {
  const { layer } = build()
  const open = await run(layer, 'tab.safeMetadata', { tabId: '1' })
  assert.equal((open.data as { url: string | null }).url, 'https://bank.example/statement')

  const shut = await run(layer, 'tab.safeMetadata', { tabId: '2' })
  const safe = shut.data as { url: string | null; favicon: string | null; contentAvailable: boolean }
  assert.equal(safe.url, null)
  assert.equal(safe.favicon, null)
  assert.equal(safe.contentAvailable, false)
  assert.ok(!JSON.stringify(shut).includes('bank.example'))
})

test('a tab the browser does not have is not found, rather than answered with a blank', async () => {
  // A blank would read as "a tab with no address", which is what a locked tab looks like. They must not be confusable.
  const { layer } = build({ describe: async () => null })
  const said = await run(layer, 'tab.safeMetadata', { tabId: '5' })
  assert.equal(said.ok, false)
  assert.equal(said.error?.code, 'not-found')
})

test('the rules in force are reported, and carry no credential', async () => {
  const { layer } = build()
  const said = await run(layer, 'security.policy')
  assert.equal(said.ok, true)
  const text = JSON.stringify(said).toLowerCase()
  for (const word of ['password', 'salt', 'nonce', 'tag', 'verifier']) {
    assert.ok(!text.includes(word), `"${word}" appeared in the reported policy`)
  }
})

// ---------------------------------------------------------------- locking

test('locking a protected tab locks it', async () => {
  const w = build()
  const said = await run(w.layer, 'tab.lock', { tabId: '3' })
  assert.equal(said.ok, true)
  assert.deepEqual(w.lockedTabs, [3])
})

test('locking a tab that has no tab password is refused rather than quietly protecting it', async () => {
  // Choosing which tabs have a password is the person's decision. Doing it for them would mean Orion setting up a
  // credential they did not ask for.
  const w = build()
  const said = await run(w.layer, 'tab.lock', { tabId: '9' })
  assert.equal(said.ok, false)
  assert.equal(said.error?.code, 'not-found')
  assert.deepEqual(w.lockedTabs, [])
})

test('locking everything reports how many changed', async () => {
  const { layer } = build()
  const said = await run(layer, 'security.lockAll')
  assert.deepEqual(said.data, { locked: 2 })
})

test('locking Orbis is asked about first, because it interrupts whatever was happening', () => {
  const { layer } = build()
  const found = layer.list({}).find((c) => c.id === 'profile.lock')
  assert.ok(found)
  assert.equal(found.confirmation, 'when-consequential')
})

test('locking Orbis really locks it', async () => {
  const w = build()
  await run(w.layer, 'profile.lock')
  assert.equal(w.profileLocked(), true)
})

test('asking to unlock brings the tab forward and says to check again', async () => {
  const w = build()
  const said = await run(w.layer, 'security.requestUnlock', { tabId: '2' })
  assert.equal(said.ok, true)
  assert.deepEqual(w.broughtForward, [2])
  assert.equal((said.data as { asked: boolean }).asked, true)
})

test('asking to unlock a tab that is not locked does nothing at all', async () => {
  const w = build()
  const said = await run(w.layer, 'security.requestUnlock', { tabId: '3' })
  assert.equal(said.ok, true)
  assert.equal((said.data as { asked: boolean }).asked, false)
  assert.deepEqual(w.broughtForward, [])
})

// ---------------------------------------------------------------- the switch

test('every capability here is in the security or tabs domain, so one switch covers it', () => {
  const { layer } = build()
  for (const capability of layer.list({})) {
    assert.ok(
      capability.domain === 'security' || capability.domain === 'tabs',
      `${capability.id} is in ${capability.domain}`
    )
  }
})

test('a tab id that is not one is refused rather than read as tab zero', async () => {
  const { layer } = build()
  for (const nonsense of ['', 'abc', '1.5']) {
    const said = await run(layer, 'tab.lockState', { tabId: nonsense })
    assert.equal(said.ok, false, `"${nonsense}" was accepted`)
    assert.equal(said.error?.code, 'invalid-params')
  }
})
