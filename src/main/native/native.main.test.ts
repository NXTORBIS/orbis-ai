import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NativeStore } from './store.ts'
import { Native } from './service.ts'
import type { Readiness } from '../../shared/native/registry.ts'
import { CATALOGUE } from '../../shared/native/catalogue.ts'
import { PHASE2_CATALOGUE } from '../../shared/native/phase2.ts'
import { PHASE3_CATALOGUE } from '../../shared/native/phase3.ts'
import { PHASE4_CATALOGUE } from '../../shared/native/phase4.ts'
import { PHASE5_CATALOGUE } from '../../shared/native/phase5.ts'
import { PHASE6_CATALOGUE } from '../../shared/native/phase6.ts'
import { PHASE7_CATALOGUE } from '../../shared/native/phase7.ts'
import { PHASE8_CATALOGUE } from '../../shared/native/phase8.ts'
import { PHASE9_CATALOGUE } from '../../shared/native/phase9.ts'

/**
 * The Native App runtime against real files.
 *
 * The pure tests in `shared/native/native.test.ts` cover every decision. These cover the three things only a real
 * directory can show, and each of them is a way somebody loses work:
 *
 *   - **profile isolation.** One profile's open laboratory must not appear in another's, and a save queued a moment
 *     before a profile switch must land in the profile it was made in.
 *   - **restart.** What was open comes back as a reference, with its values, and never running.
 *   - **unreadable is not missing.** A damaged file is left alone instead of being replaced by an empty one on the
 *     next save, which is the failure that silently destroys data.
 *
 * Everything runs in a temporary directory. Nothing here touches the user's own profiles.
 */

const readiness = (): Readiness => ({ available: ['compute', 'worker', 'file.read', 'file.write'], engines: ['compute'] })

let counter = 0
const newId = (prefix: string): string => `${prefix}${(counter += 1)}`

/**
 * A directory of its own per test.
 *
 * Sharing one made two of these tests see the other's files, which is an interference that hides a real failure as
 * easily as it invents one. A temporary directory costs nothing.
 */
const roots: string[] = []
const freshRoot = async (): Promise<string> => {
  const made = await mkdtemp(join(tmpdir(), 'orbis-native-'))
  roots.push(made)
  return made
}

const build = (root: string): { store: NativeStore; native: Native } => {
  const store = new NativeStore(root)
  const native = new Native({ store, now: () => 1_700_000_000_000, newId, readiness })
  return { store, native }
}

after(async () => {
  for (const one of roots) await rm(one, { recursive: true, force: true }).catch(() => undefined)
})

describe('the runtime against real files', () => {
  it('registers the whole catalogue and reports it healthy', async () => {
    const { native } = build(await freshRoot())
    const health = await native.health()
    assert.match(health.registry, /^OK/)
    // Counted from the catalogues rather than written down, so adding an app does not make this test a liar.
    assert.equal(
      (await native.catalogue()).length,
      CATALOGUE.length +
        PHASE2_CATALOGUE.length +
        PHASE3_CATALOGUE.length +
        PHASE4_CATALOGUE.length +
        PHASE5_CATALOGUE.length +
        PHASE6_CATALOGUE.length +
        PHASE7_CATALOGUE.length +
        PHASE8_CATALOGUE.length +
        PHASE9_CATALOGUE.length
    )
  })

  it('opens an app, writes its state, and restores it after a restart', async () => {
    const root = await freshRoot()
    const first = build(root)
    const opened = await first.native.openApp({ appId: 'scenario-lab', conversationId: 'c1', configure: {} })
    assert.ok('instance' in opened, 'scenario-lab should open')
    const instanceId = opened.instance.id

    await first.native.storeState(instanceId, { scenarios: ['a', 'b'] })
    await first.native.flush()

    // A second runtime over the same directory is what a restart is.
    const second = build(root)
    const restored = await second.native.restoreAll()
    assert.equal(restored.restored, 1)
    assert.deepEqual(restored.damaged, [])

    const held = second.native.instance(instanceId)
    assert.ok(held)
    assert.deepEqual(held.domain, { scenarios: ['a', 'b'] })
    // Never running, and never on screen: resuming a computation nobody asked to resume costs somebody a core.
    assert.equal(held.phase, 'loading')
    assert.equal(second.native.conversation('c1').length, 1)
  })

  it('keeps one profile’s apps out of another’s', async () => {
    const { store, native } = build(await freshRoot())

    const mine = await native.openApp({ appId: 'scenario-lab', conversationId: 'mine' })
    assert.ok('instance' in mine)
    await native.flush()

    await native.useProfile('profile-b')
    // Nothing is carried across: the instance belonged to the profile that was active.
    assert.equal(native.instance(mine.instance.id), null)
    assert.equal(native.conversation('mine').length, 0)
    assert.equal((await store.all()).length, 0)

    const theirs = await native.openApp({ appId: 'problem-workspace', conversationId: 'theirs' })
    assert.ok('instance' in theirs)
    await native.flush()
    assert.equal((await store.all()).length, 1)

    // Back again: the first profile's work is there and the second's is not.
    await native.useProfile('default')
    const back = await store.all()
    assert.ok(back.some((one) => one.instanceId === mine.instance.id))
    assert.ok(!back.some((one) => one.instanceId === theirs.instance.id))
  })

  it('writes a save queued before a profile switch into the profile it came from', async () => {
    const { store, native } = build(await freshRoot())
    const opened = await native.openApp({ appId: 'scenario-lab', conversationId: 'timing' })
    assert.ok('instance' in opened)

    // Not flushed: the write is still pending when the profile changes.
    await native.storeState(opened.instance.id, { note: 'belongs to default' })
    await native.useProfile('profile-c')
    await native.flush()

    await native.useProfile('default')
    const back = await store.all()
    const found = back.find((one) => one.instanceId === opened.instance.id)
    assert.ok(found, 'the pending save should have landed in the profile it was made in')
    assert.deepEqual(found.domain, { note: 'belongs to default' })
  })

  it('remembers which apps were used, per profile, and nowhere else', async () => {
    const { store, native } = build(await freshRoot())
    await native.openApp({ appId: 'unit-converter', conversationId: 'r1' })
    await native.openApp({ appId: 'matrix-lab', conversationId: 'r1' })
    await native.flush()

    const recent = (await native.recent()).map((one) => one.id)
    assert.deepEqual([...recent].sort(), ['matrix-lab', 'unit-converter'])

    await native.useProfile('profile-d')
    assert.equal((await store.recentApps()).length, 0)
    await native.useProfile('default')
    assert.ok((await store.recentApps()).length >= 2)
  })

  it('leaves a damaged file alone instead of writing over it', async () => {
    const root = await freshRoot()
    const { native } = build(root)
    await native.openApp({ appId: 'scenario-lab', conversationId: 'damage' })
    await native.flush()

    const where = await findInstancesFile(root)
    assert.ok(where, `expected an instances file somewhere under ${root}`)

    const before = await readFile(where, 'utf8')
    assert.ok(before.length > 2, 'the state should have been written before it is damaged')

    // Something else wrote nonsense into it -- a half-finished copy, a crashed write, a hand edit.
    await writeFile(where, '{ this is not json', 'utf8')

    // A fresh runtime reads it, finds it unreadable, and must not replace it.
    const second = build(root)
    const restored = await second.native.restoreAll()
    assert.equal(restored.restored, 0)
    const opened = await second.native.openApp({ appId: 'matrix-lab', conversationId: 'after-damage' })
    assert.ok('instance' in opened)
    await second.native.flush()

    /*
     * The damaged bytes still exist somewhere.
     *
     * Orbis's shared store quarantines a file it cannot parse — it is renamed to `<name>.unreadable-<timestamp>` and a
     * fresh one is started — rather than overwriting it. That is the contract worth testing: the data is never
     * destroyed, and the runtime did not carry on as though it had never existed.
     */
    const kept = await findCorruptFile(root)
    assert.ok(kept, 'the unreadable bytes should have been kept under another name, not deleted')
    assert.equal(await readFile(kept, 'utf8'), '{ this is not json')
  })

  it('refuses an app that cannot run here, with the reason', async () => {
    const store = new NativeStore(await freshRoot())
    const native = new Native({
      store,
      now: () => 1,
      newId,
      // No engines at all: every app that computes becomes unavailable, and has to say why.
      readiness: () => ({ available: ['compute'], engines: [] })
    })
    const made = await native.openApp({ appId: 'projectile-lab' })
    assert.ok(!('instance' in made))
    assert.match(made.says, /engine/i)

    const catalogue = await native.catalogue()
    assert.ok(catalogue.every((one) => one.id === 'flowchart' || one.blocked !== null))
  })

  it('an app is off only when every one of its capabilities is', async () => {
    const { store, native } = build(await freshRoot())

    // One of two turned off leaves the app working, because the other capability still does something.
    await store.setCapabilityEnabled('convertUnits', false)
    const partly = (await native.find('convert')).find((one) => one.id === 'unit-converter')
    assert.ok(partly, 'it should still be findable')
    assert.equal(partly.blocked, null, 'one capability off is not the whole app off')

    await store.setCapabilityEnabled('checkDimensions', false)
    const off = (await native.find('convert')).find((one) => one.id === 'unit-converter')
    // Found, and said to be off: an app that vanishes looks like one that never existed.
    assert.ok(off, 'it should still be findable when it is off')
    assert.ok(off.blocked, 'with every capability off it should say so')
    assert.match(off.blocked, /turned off/)

    await store.setCapabilityEnabled('convertUnits', true)
    assert.equal((await native.find('convert')).find((one) => one.id === 'unit-converter')?.blocked, null)
  })
})

/** The quarantined copy of a file Orbis could not parse. */
async function findCorruptFile(where: string): Promise<string | null> {
  return findFile(where, (name) => name.startsWith('instances.json.unreadable-'))
}

/** The instances file, wherever the profile layout puts it. */
async function findInstancesFile(where: string): Promise<string | null> {
  return findFile(where, (name) => name === 'instances.json')
}

async function findFile(where: string, matches: (name: string) => boolean): Promise<string | null> {
  const { readdir, stat } = await import('node:fs/promises')
  const walk = async (dir: string, depth: number): Promise<string | null> => {
    if (depth > 4) return null
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return null
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      const info = await stat(full).catch(() => null)
      if (!info) continue
      if (info.isDirectory()) {
        const found = await walk(full, depth + 1)
        if (found) return found
      } else if (matches(entry)) return full
    }
    return null
  }
  await mkdir(where, { recursive: true }).catch(() => undefined)
  return walk(where, 0)
}
