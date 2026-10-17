import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FeatureVisibilityStore } from './store.ts'
import { isVisible, newChoice, OPTIONAL_IDS } from '../../shared/featureVisibility.ts'

/**
 * The choice survives a restart, differs per profile, and is never silently reset.
 *
 * `featureVisibility.test.ts` beside the shared module tests the rules themselves. This tests the three things only a
 * real file can answer: that a restart finds it, that two profiles do not share one, and that a file Orbis cannot read
 * is reported and left exactly where it is.
 */

const scratch = async (): Promise<string> => mkdtemp(join(tmpdir(), 'orbis-features-'))

const store = (userData: string, profile = 'default', settled = true, now = () => 1000): FeatureVisibilityStore =>
  new FeatureVisibilityStore(userData, profile, { settled: async () => settled, now })

const fileFor = (userData: string, profile: string): string =>
  profile === 'default' ? join(userData, 'personal', 'features.json') : join(userData, 'profiles', profile, 'personal', 'features.json')

describe('the choice is kept with the profile', () => {
  test('a switch survives a restart', async () => {
    const dir = await scratch()
    try {
      // A first run, where Chess World starts off -- so switching it on is a real change with something to write.
      const first = store(dir, 'default', false)
      const saved = await first.set('chess', true)
      assert.equal(saved.refused, null, saved.refused ?? '')
      assert.equal(isVisible('chess', saved.choice), true)
      await first.flush()

      // A second store over the same folder is what the next start of Orbis is.
      const again = await store(dir, 'default', false).read()
      assert.equal(again.refused, null)
      assert.equal(isVisible('chess', again.choice), true)
      assert.equal(again.choice.chosen, true)
      assert.equal(again.choice.chosenAt, 1000)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('two profiles do not share one menu, and a switch restores the right one', async () => {
    const dir = await scratch()
    try {
      const one = store(dir)
      await one.choose(['chess'])
      await one.flush()

      await one.useProfile('work')
      const atWork = await one.read()
      // Nothing saved for the new profile: an installation already set up keeps everything, which is the
      // existing-person rule applying to a profile that has never been asked.
      assert.equal(isVisible('cosmos', atWork.choice), true)
      await one.choose(['markets'])
      await one.flush()

      await one.useProfile('default')
      const back = await one.read()
      assert.equal(isVisible('chess', back.choice), true, 'the first profile’s choice did not come back')
      assert.equal(isVisible('markets', back.choice), false, 'the other profile’s choice leaked in')

      // And each is really its own file.
      assert.ok(JSON.parse(await readFile(fileFor(dir, 'default'), 'utf8')))
      assert.ok(JSON.parse(await readFile(fileFor(dir, 'work'), 'utf8')))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a write queued before a profile switch lands in the profile it came from', async () => {
    const dir = await scratch()
    try {
      const one = store(dir)
      await one.choose(['chess'])
      // No flush: the write is still pending when the profile changes.
      await one.useProfile('work')
      await one.flush()
      const kept = JSON.parse(await readFile(fileFor(dir, 'default'), 'utf8')) as { shown: string[] }
      assert.deepEqual(kept.shown, ['chess'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('somebody who already uses Orbis, and somebody who does not', () => {
  test('no file on an installation already set up means the whole menu', async () => {
    const dir = await scratch()
    try {
      const answer = await store(dir, 'default', true).read()
      assert.deepEqual(answer.notes, [], 'an existing user was told something went wrong')
      assert.deepEqual([...answer.choice.shown], [...OPTIONAL_IDS])
      assert.equal(answer.choice.chosen, false, 'they must not be recorded as having chosen a set they never saw')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('no file on a first run means the short starting menu', async () => {
    const dir = await scratch()
    try {
      const answer = await store(dir, 'default', false).read()
      assert.deepEqual([...answer.choice.shown], [...newChoice().shown])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('nothing is written just by reading, so a guess is never frozen as somebody’s answer', async () => {
    const dir = await scratch()
    try {
      const one = store(dir, 'default', true)
      await one.read()
      await one.flush()
      await assert.rejects(readFile(fileFor(dir, 'default'), 'utf8'), 'reading wrote a file')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('a file that cannot be read', () => {
  test('is reported, refused, and left exactly as it is', async () => {
    const dir = await scratch()
    const path = fileFor(dir, 'default')
    try {
      await mkdir(join(dir, 'personal'), { recursive: true })
      // A directory where the file should be is unreadable in the way `openStored` cares about on every platform:
      // it is there, and reading it as text fails. Standing in for the Windows case -- antivirus holding the file --
      // which is the one this refusal exists for and which cannot be staged portably.
      await mkdir(path, { recursive: true })

      const one = store(dir, 'default', true)
      const answer = await one.read()
      assert.ok(answer.refused, 'an unreadable file reported no problem at all')
      assert.ok(answer.notes.length > 0, 'nothing was said to the person')

      const save = await one.set('chess', true)
      assert.ok(save.refused, 'a save onto an unreadable file reported success')
      await one.flush()

      // Still a directory: nothing was written over it.
      await assert.rejects(readFile(path, 'utf8'))
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  test('a damaged file is moved aside rather than silently replaced, and saving still works', async () => {
    const dir = await scratch()
    try {
      await mkdir(join(dir, 'personal'), { recursive: true })
      await writeFile(fileFor(dir, 'default'), 'this is not JSON', 'utf8')

      const one = store(dir, 'default', true)
      const answer = await one.read()
      assert.equal(answer.refused, null, 'a damaged file was treated as unreadable, which blocks saving for ever')
      assert.ok(answer.notes.length > 0, 'a damaged file said nothing to the person')

      const save = await one.set('chess', true)
      assert.equal(save.refused, null, save.refused ?? '')
      await one.flush()
      const kept = JSON.parse(await readFile(fileFor(dir, 'default'), 'utf8')) as { shown: string[] }
      assert.ok(kept.shown.includes('chess'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a file from a newer Orbis is read and not written over', async () => {
    const dir = await scratch()
    try {
      await mkdir(join(dir, 'personal'), { recursive: true })
      await writeFile(fileFor(dir, 'default'), JSON.stringify({ version: 99, shown: ['chess', 'somethingNew'], chosen: true, chosenAt: 7 }), 'utf8')

      const one = store(dir, 'default', true)
      const answer = await one.read()
      assert.equal(isVisible('chess', answer.choice), true, 'what this version understands must still work')
      assert.ok(answer.notes.some((note) => /newer version of Orbis/.test(note)))

      const save = await one.set('markets', true)
      assert.ok(save.refused, 'this version wrote over a newer version’s choices')
      await one.flush()
      const still = JSON.parse(await readFile(fileFor(dir, 'default'), 'utf8')) as { version: number; shown: string[] }
      assert.equal(still.version, 99)
      assert.deepEqual(still.shown, ['chess', 'somethingNew'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('switching an essential off is refused against the real store too', async () => {
    const dir = await scratch()
    try {
      const one = store(dir)
      const result = await one.set('settings', false)
      assert.ok(result.refused)
      assert.match(result.refused, /cannot be switched off/)
      assert.equal(isVisible('settings', result.choice), true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
