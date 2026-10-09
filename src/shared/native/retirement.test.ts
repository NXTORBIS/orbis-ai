import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY,
  allApps,
  appById,
  everyApp,
  isRegistryError,
  providersOf,
  registerAll,
  resolve,
  supersederOf,
  FULL_READINESS,
  discover,
  type Registry
} from './registry.ts'
import type { NativeAppManifest } from './manifest.ts'

/**
 * Retiring an app, which is how a duplicate is removed without taking it away from somebody mid-session.
 *
 * Orbis grew its own laboratories before the user's own studios were ported. Now both exist and do the same job,
 * so the older one names the newer and steps aside. The behaviour that matters is the pair of opposites: it must
 * stop being offered, and it must keep working for anybody who already has it open.
 */

const app = (over: Partial<NativeAppManifest> & { id: string }): NativeAppManifest => ({
  version: 1,
  name: over.id,
  summary: 'A test app that exists only to be registered.',
  domain: 'mathematics',
  icon: 'flask',
  aliases: [],
  tags: [over.id],
  capabilities: [{ id: over.id + 'Thing', summary: 'do the one thing this app does' }],
  // Its own surface: the registry refuses two apps that mount the same one, and rightly so.
  surface: { kind: 'native', ref: 'Surface' + over.id.replace(/[^a-zA-Z]/g, '') },
  opensAt: 'compact',
  largest: 'workspace',
  whenHidden: 'pause',
  parameters: [],
  actions: [],
  accepts: [],
  produces: [],
  permissions: ['compute'],
  persists: false,
  engine: null,
  limitations: ['It does nothing, because it is here to be registered.'],
  ...over
})

const built = (list: readonly NativeAppManifest[]): Registry => {
  const made = registerAll(EMPTY, list, 1)
  assert.ok(!isRegistryError(made), isRegistryError(made) ? made.message : '')
  return made
}

describe('a retired app', () => {
  const older = app({
    id: 'older-lab',
    name: 'Older Laboratory',
    capabilities: [{ id: 'theJob', summary: 'the job both of these do' }],
    supersededBy: 'newer-studio'
  })
  const newer = app({ id: 'newer-studio', name: 'Newer Studio', capabilities: [{ id: 'theJob', summary: 'the job both of these do' }] })
  const registry = built([older, newer])

  it('is not offered any more', () => {
    const offered = allApps(registry).map((one) => one.id)
    assert.ok(!offered.includes('older-lab'), 'a retired app must leave the catalogue')
    assert.ok(offered.includes('newer-studio'))
  })

  it('is still registered, so an instance already on screen keeps working', () => {
    // This is the whole reason retirement is a field rather than a deletion.
    assert.ok(appById(registry, 'older-lab'), 'a retired app must still be findable by id')
    assert.ok(everyApp(registry).some((one) => one.id === 'older-lab'))
  })

  it('hands its capability to the app that replaced it', () => {
    const providers = providersOf(registry, 'theJob').map((one) => one.id)
    assert.deepEqual(providers, ['newer-studio'], `theJob resolved to ${providers.join(', ')}`)
  })

  it('is not what a request for that capability opens', () => {
    const got = resolve(registry, 'theJob', FULL_READINESS)
    assert.equal(got?.id, 'newer-studio')
  })

  it('is not found by search', () => {
    const hits = discover(registry, 'older', FULL_READINESS).map((one) => one.manifest.id)
    assert.ok(!hits.includes('older-lab'), `search offered the retired app: ${hits.join(', ')}`)
  })

  it('names its replacement, which can be looked up', () => {
    assert.equal(supersederOf(registry, 'older-lab')?.id, 'newer-studio')
    assert.equal(supersederOf(registry, 'newer-studio'), null, 'a current app has no superseder')
  })
})

describe('a capability only a retired app had', () => {
  it('still resolves, to the replacement, even though it never declared it', () => {
    /*
     * The retired app declared `onlyMine` and the replacement does not. Taking over the job means taking over
     * everything that asked for it, or a request that used to work would silently stop working.
     */
    const registry = built([
      app({ id: 'gone', capabilities: [{ id: 'onlyMine', summary: 'something only the old one declared' }], supersededBy: 'kept' }),
      app({ id: 'kept', capabilities: [{ id: 'somethingElse', summary: 'what the new one declares' }] })
    ])
    const providers = providersOf(registry, 'onlyMine').map((one) => one.id)
    assert.deepEqual(providers, ['kept'])
    assert.equal(resolve(registry, 'onlyMine', FULL_READINESS)?.id, 'kept')
  })
})

describe('a chain of retirements', () => {
  it('follows through to the one still standing', () => {
    const registry = built([
      app({ id: 'first', capabilities: [{ id: 'job', summary: 'the job' }], supersededBy: 'second' }),
      app({ id: 'second', capabilities: [{ id: 'job', summary: 'the job' }], supersededBy: 'third' }),
      app({ id: 'third', capabilities: [{ id: 'job', summary: 'the job' }] })
    ])
    assert.equal(supersederOf(registry, 'first')?.id, 'third')
    assert.deepEqual(providersOf(registry, 'job').map((one) => one.id), ['third'])
    assert.deepEqual(allApps(registry).map((one) => one.id), ['third'])
  })

  it('does not hang when two apps supersede each other', () => {
    // Nobody should write this, so the test is that a mistake is survivable rather than fatal.
    const registry = built([
      app({ id: 'left', supersededBy: 'right' }),
      app({ id: 'right', supersededBy: 'left' })
    ])
    assert.equal(supersederOf(registry, 'left'), null)
    assert.equal(supersederOf(registry, 'right'), null)
    // And nothing is offered, which is the honest outcome of a cycle.
    assert.deepEqual(allApps(registry).map((one) => one.id), [])
  })

  it('reports nothing when the replacement does not exist', () => {
    const registry = built([app({ id: 'alone', supersededBy: 'never-registered' })])
    assert.equal(supersederOf(registry, 'alone'), null)
    assert.deepEqual(providersOf(registry, 'aloneThing').map((one) => one.id), [])
  })
})

describe('an app cannot be retired in favour of itself', () => {
  it('is refused at registration', () => {
    const made = registerAll(EMPTY, [app({ id: 'loop', supersededBy: 'loop' })], 1)
    assert.ok(isRegistryError(made), 'self-supersession should be refused')
    assert.match(made.message, /supersede itself/i)
  })

  it('and an empty replacement is refused too', () => {
    const made = registerAll(EMPTY, [app({ id: 'blank', supersededBy: '  ' })], 1)
    assert.ok(isRegistryError(made))
  })
})

describe('the chemistry laboratories Orbis retired', () => {
  it('are the seven the studio contains, and no more', async () => {
    const { PHASE6_CATALOGUE } = await import('./phase6.ts')
    const retired = PHASE6_CATALOGUE.filter((one) => one.supersededBy !== undefined).map((one) => one.id).sort()
    assert.deepEqual(retired, [
      'combination-engine',
      'electro-lab',
      'molecular-studio',
      'organic-lab',
      'periodic-table',
      'reaction-lab',
      'titration-lab'
    ])
    // The calculator is deliberately kept: the studio's is a formula tool, Orbis's solves the gas laws.
    assert.ok(PHASE6_CATALOGUE.some((one) => one.id === 'chem-calculator' && one.supersededBy === undefined))
    for (const one of retired) {
      const manifest = PHASE6_CATALOGUE.find((two) => two.id === one)
      assert.equal(manifest?.supersededBy, 'chemistry-studio')
    }
  })
})
