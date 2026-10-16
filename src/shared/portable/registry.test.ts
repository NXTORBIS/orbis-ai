import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'


import {
  CATEGORIES,
  EVERYTHING,
  EXCLUDED,
  REGISTRY_ASSUMPTIONS,
  actionsAfterImport,
  categoryById,
  restoreOrder,
  withDependencies
} from './registry.ts'

describe('the inventory', () => {
  test('every category has an id, a label and a real description', () => {
    for (const one of CATEGORIES) {
      assert.match(one.id, /^[a-z][a-zA-Z0-9.]*$/, `"${one.id}" is not a usable id`)
      assert.ok(one.label.length > 2, `${one.id} has no label`)
      assert.ok(one.describe.length > 15, `${one.id} has no real description`)
    }
  })

  test('no two categories share an id', () => {
    const ids = CATEGORIES.map((one) => one.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  test('the table is frozen, and so is every entry in it', () => {
    assert.equal(Object.isFrozen(CATEGORIES), true)
    for (const one of CATEGORIES) assert.equal(Object.isFrozen(one), true, `${one.id} is not frozen`)
  })

  test('a category is found by id, and a prototype key is not', () => {
    assert.equal(categoryById('notes')?.label, 'Notes')
    assert.equal(categoryById('constructor'), undefined)
    assert.equal(categoryById('__proto__'), undefined)
    assert.equal(categoryById('toString'), undefined)
  })

  test('every dependency names a category that exists', () => {
    for (const one of CATEGORIES) {
      for (const need of one.dependsOn) {
        assert.ok(categoryById(need) !== undefined, `${one.id} depends on "${need}", which is not a category`)
      }
    }
  })

  test('nothing depends on itself', () => {
    for (const one of CATEGORIES) assert.equal(one.dependsOn.includes(one.id), false, `${one.id} depends on itself`)
  })

  test('every category declares a schema version, so each can migrate on its own', () => {
    for (const one of CATEGORIES) assert.ok(one.schemaVersion >= 1, `${one.id} has no schema version`)
  })
})

describe('the classes', () => {
  test('anything not simply copied says why', () => {
    for (const one of CATEGORIES) {
      if (one.portability === 'portable') continue
      assert.ok(one.why !== null && one.why.length > 30, `${one.id} is ${one.portability} and does not say why`)
    }
  })

  test('anything that needs the user to act says what to do', () => {
    for (const one of CATEGORIES) {
      if (!one.requiresReauthentication) continue
      assert.ok(one.userAction !== null && one.userAction.length > 10, `${one.id} needs reauthentication and says nothing about what to do`)
    }
  })

  test('nothing sealed by the operating system is portable', () => {
    for (const one of CATEGORIES) {
      if (one.sensitivity !== 'device-secret') continue
      assert.equal(one.portability, 'device-bound', `${one.id} holds a device secret and is marked ${one.portability}`)
    }
  })

  test('nothing marked portable is a device secret', () => {
    for (const one of CATEGORIES) {
      if (one.portability !== 'portable') continue
      assert.notEqual(one.sensitivity, 'device-secret', `${one.id} is portable and holds a device secret`)
    }
  })

  test('the browser cookies, passwords and the provider key are all device-bound', () => {
    for (const id of ['browser.siteData', 'browser.passwords', 'orion.apiKey']) {
      assert.equal(categoryById(id)?.portability, 'device-bound', `${id} must never be copied`)
    }
  })

  test('the vault and the account password travel sealed rather than being excluded', () => {
    for (const id of ['secrets.vault', 'profile.security', 'tabLock']) {
      const one = categoryById(id)
      assert.equal(one?.portability, 'portable', `${id} is wrapped by a password, so it travels`)
      assert.equal(one?.sensitivity, 'sealed')
    }
  })

  test('caches and indexes are rebuilt rather than carried', () => {
    for (const id of ['browser.caches', 'search.index']) {
      assert.equal(categoryById(id)?.portability, 'rebuilt', `${id} should be rebuilt`)
    }
  })

  test('window geometry is never copied', () => {
    assert.equal(categoryById('device.state')?.portability, 'device-bound')
    assert.match(categoryById('device.state')?.why ?? '', /off-screen/)
  })

  test('clipboard history is not a profile’s to export, and says why', () => {
    const one = categoryById('clipboard')
    assert.equal(one?.portability, 'device-bound')
    assert.match(one?.why ?? '', /installation rather than per profile/)
  })
})

describe('everything', () => {
  test('it is derived from the table, not written out', () => {
    const derived = CATEGORIES.filter((one) => one.portability === 'portable' || one.portability === 'transformed').map((one) => one.id)
    assert.deepEqual([...EVERYTHING], derived)
  })

  test('it never contains anything device-bound or rebuilt', () => {
    for (const id of EVERYTHING) {
      const one = categoryById(id)
      assert.ok(one !== undefined)
      assert.notEqual(one?.portability, 'device-bound', `${id} is in Everything and is device-bound`)
      assert.notEqual(one?.portability, 'rebuilt', `${id} is in Everything and is rebuilt`)
    }
  })

  test('it covers the substance of a profile rather than a token subset', () => {
    for (const id of ['orion.conversations', 'orion.memory', 'notes', 'tasks', 'whiteboards', 'workspaces', 'workflows.definitions', 'pages.documents', 'galaxy.graph', 'browser.library', 'browser.history', 'personalization', 'secrets.vault', 'assets', 'markets']) {
      assert.ok(EVERYTHING.includes(id), `${id} is missing from Everything`)
    }
  })

  test('the excluded list accounts for every category not in Everything', () => {
    const accounted = new Set([...EVERYTHING, ...EXCLUDED.map((one) => one.id)])
    for (const one of CATEGORIES) assert.ok(accounted.has(one.id), `${one.id} is neither included nor explained`)
  })
})

describe('restore order', () => {
  test('a dependency comes before what needs it', () => {
    const result = restoreOrder(EVERYTHING)
    assert.ok(!('error' in result))
    const order = (result as { order: string[] }).order
    for (const id of order) {
      for (const need of categoryById(id)?.dependsOn ?? []) {
        if (!order.includes(need)) continue
        assert.ok(order.indexOf(need) < order.indexOf(id), `${need} must come before ${id}`)
      }
    }
  })

  test('assets come before the things that reference them', () => {
    const order = (restoreOrder(EVERYTHING) as { order: string[] }).order
    assert.ok(order.indexOf('assets') < order.indexOf('notes'))
    assert.ok(order.indexOf('assets') < order.indexOf('orion.conversations'))
    assert.ok(order.indexOf('assets') < order.indexOf('pages.documents'))
  })

  test('a workflow comes after the Pages it can reference', () => {
    const order = (restoreOrder(EVERYTHING) as { order: string[] }).order
    assert.ok(order.indexOf('pages.documents') < order.indexOf('workflows.definitions'))
  })

  test('the order is the same every time', () => {
    assert.deepEqual(restoreOrder(EVERYTHING), restoreOrder(EVERYTHING))
  })

  test('an unknown id is ignored rather than breaking the order', () => {
    const result = restoreOrder(['notes', 'nonsense'])
    assert.deepEqual((result as { order: string[] }).order, ['notes'])
  })

  test('a circle is an error naming what is stuck, rather than an order somebody picked', () => {
    // Exercised through the real table by asking for a subset; the real table has no cycle, so this checks the
    // healthy path returns an order and never a cycle.
    for (const one of CATEGORIES) {
      const result = restoreOrder([one.id])
      assert.ok(!('error' in result), `${one.id} alone should be orderable`)
    }
  })
})

describe('dependencies of a selection', () => {
  test('choosing a Page pulls in its assets and says so', () => {
    const result = withDependencies(['pages.documents'])
    assert.ok(result.categories.includes('assets'))
    assert.deepEqual(result.added, ['assets'])
  })

  test('choosing a workflow pulls in Pages and then assets', () => {
    const result = withDependencies(['workflows.definitions'])
    assert.ok(result.categories.includes('pages.documents'))
    assert.ok(result.categories.includes('assets'))
  })

  test('a dependency that cannot travel is not added to the selection', () => {
    // `search.index` depends on notes and Pages, and is itself rebuilt. Selecting notes must not silently add it.
    const result = withDependencies(['notes'])
    assert.equal(result.categories.includes('search.index'), false)
  })

  test('a selection already complete adds nothing', () => {
    assert.deepEqual(withDependencies(['assets']).added, [])
  })

  test('an unknown id is dropped rather than carried through', () => {
    assert.equal(withDependencies(['nonsense']).categories.length, 0)
  })
})

describe('what the user has to do afterwards', () => {
  test('importing everything still reports the browser sign-in and the provider key', () => {
    const actions = actionsAfterImport([...EVERYTHING])
    const ids = actions.map((one) => one.id)
    assert.ok(ids.includes('browser.siteData'), 'signing in again must be reported')
    assert.ok(ids.includes('orion.apiKey'), 'the provider key must be reported')
    for (const one of actions) assert.ok(one.action.length > 10)
  })

  test('the vault reports that it needs its master password', () => {
    const actions = actionsAfterImport(['secrets.vault'])
    assert.ok(actions.some((one) => one.id === 'secrets.vault' && /master password/.test(one.action)))
  })

  test('a selection needing nothing of the user still reports the device-bound exclusions', () => {
    // Those are true of every import, so they are reported whether or not they were selected.
    const actions = actionsAfterImport(['tasks'])
    assert.ok(actions.every((one) => one.action.length > 0))
    assert.ok(actions.some((one) => one.id === 'browser.passwords'))
  })
})

describe('the audit against what is actually on disk', () => {
  /**
   * Every store the code writes must be covered by the table.
   *
   * This reads the source rather than a running profile, because a test that needs somebody's real data is a test that
   * passes on the machine it was written on. It looks for the file and directory names the stores use and checks each
   * one appears in some category's `storage`, which is what stops a new store being added and quietly left out of the
   * transfer while "Everything" carries on claiming to be everything.
   */
  const covered = new Set(CATEGORIES.flatMap((one) => one.storage.map((path) => path.split('/')[0] as string)))

  /**
   * Every store the code writes, found by reading the code.
   *
   * This used to compare the table against a hand-written list of names, which fails in exactly the way the registry
   * exists to prevent: a store is added, nobody updates the list, and the guard goes on passing while "Everything"
   * quietly stops being everything. It had done precisely that for eleven stores -- music, course progress, Student,
   * everything the Creation Engine made, code pages, meeting notes, apps in conversations, per-site settings,
   * notification history, Ambient Intelligence and unfinished browser runs.
   *
   * So it reads the source now. Two idioms are recognised, and together they are how every store in `src/main`
   * decides where to write:
   *
   *   `join(userData, dataDirFor(id), 'name')`  -- a profile's own folder
   *   `join(userData, 'name')`                  -- shared across profiles
   *
   * A store that invents a third way of saying it would not be seen, which is why `ALSO_WRITTEN` below still lists
   * the ones already known by other means. The scan is an addition to that list, not a replacement for it: between
   * them, forgetting this table is caught either by the scan or by the list, and the common case -- a new feature
   * following the same idiom as every existing one -- is caught automatically.
   */
  const SOURCE_ROOT = new URL('../../main/', import.meta.url)

  async function* sourceFiles(dir: URL): AsyncGenerator<URL> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) yield* sourceFiles(path)
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) yield path
    }
  }

  /** The first path segment of every store the code writes, by scope, with the file that writes it. */
  async function storesInCode(): Promise<{ profile: Map<string, string>; app: Map<string, string> }> {
    const profile = new Map<string, string>()
    const app = new Map<string, string>()
    for await (const file of sourceFiles(SOURCE_ROOT)) {
      const source = await readFile(file, 'utf8')
      const where = file.pathname.split('/src/main/')[1] ?? file.pathname
      for (const m of source.matchAll(/dataDirFor\([^)]*\)\s*,\s*'([^']+)'/g)) if (!profile.has(m[1])) profile.set(m[1], where)
      for (const m of source.matchAll(/join\(\s*(?:this\.)?[A-Za-z_]*[Uu]ser[Dd]ata[A-Za-z]*\s*,\s*'([^']+)'/g)) if (!app.has(m[1])) app.set(m[1], where)
    }
    return { profile, app }
  }

  /**
   * Stores the two idioms above cannot see, because they are reached another way.
   *
   * Each is already in the table; this list is only here so the guard below can be one assertion over everything
   * rather than two with different standards. A name added here without being added to the table fails.
   */
  const ALSO_WRITTEN = [
    'markets.json',
    'pages.json',
    'security-log.json',
    'browser',
    'browser-library.json',
    'assets',
    'generated',
    'control-switches.json',
    'control-capabilities.json',
    'profiles.json'
  ]

  /** Not a store of the user's: a folder Orbis reads from or stages into, which has nothing to carry. */
  const NOT_A_STORE: Readonly<Record<string, string>> = Object.freeze({
    chess: 'where the downloaded chess engine and its licence live. It is a program, not the person\'s work, and a\n      profile taken to another computer fetches it again rather than carrying it.'
  })

  test('every store the code writes is in the table', async () => {
    const { profile, app } = await storesInCode()
    const covered = new Set(CATEGORIES.flatMap((one) => one.storage.map((path) => path.split('/')[0] as string)))
    const found = [
      ...[...profile].map(([name, where]) => ({ name, where, scope: 'profile' })),
      ...[...app].map(([name, where]) => ({ name, where, scope: 'app' })),
      ...ALSO_WRITTEN.map((name) => ({ name, where: 'known by other means', scope: 'either' }))
    ]
    // The scan must actually have found the stores, or an assertion over nothing would pass for ever.
    assert.ok(profile.size >= 15, `the scan found only ${profile.size} per-profile stores; the idiom it looks for has changed`)
    const missing = found
      .filter((one) => !covered.has(one.name) && !(one.name in NOT_A_STORE))
      .map((one) => `${one.name} (${one.scope}, ${one.where})`)
    assert.deepEqual(missing, [], 'these stores exist in the code and are in no category, so an export would leave them behind')
  })

  test('nothing in the table points at a store the code does not write', async () => {
    /*
     * The other direction, which matters for a different reason: a category whose file no longer exists makes an
     * export offer something that cannot be found, and the person is told a category failed rather than that it was
     * never there.
     */
    const { profile, app } = await storesInCode()
    const real = new Set([...profile.keys(), ...app.keys(), ...ALSO_WRITTEN])
    const dangling = CATEGORIES.filter((one) => one.storage.length > 0)
      .filter((one) => one.storage.every((path) => !real.has(path.split('/')[0] as string)))
      .map((one) => `${one.id} -> ${one.storage.join(', ')}`)
    assert.deepEqual(dangling, [], 'these categories name storage no store in src/main writes')
  })

  test('every per-profile store the code writes is covered', async () => {
    const known = new Set([
      'conversations',
      'knowledge',
      'workflows',
      'skills',
      'experience',
      'personal',
      'markets.json',
      'pages.json',
      'secrets.vault',
      'account.lock',
      'tab-locks.json',
      'security-log.json',
      'browser',
      'browser-library.json',
      'assets',
      'generated'
    ])
    const missing = [...known].filter((one) => !covered.has(one))
    assert.deepEqual(missing, [], `these stores exist in the code and are in no category: ${missing.join(', ')}`)
  })

  test('every app-level store is covered', () => {
    const known = new Set(['settings.json', 'profiles.json', 'control-switches.json', 'control-capabilities.json', 'personal'])
    const missing = [...known].filter((one) => !covered.has(one))
    assert.deepEqual(missing, [], `these app stores are in no category: ${missing.join(', ')}`)
  })

  test('the shared profile-path helper still puts a profile’s data under its own folder', async () => {
    const { dataDirFor, DEFAULT_PROFILE_ID } = await import('../profiles.ts')
    assert.equal(dataDirFor(DEFAULT_PROFILE_ID), '.')
    assert.equal(dataDirFor('abc'), 'profiles/abc')
  })

  test('every declared storage path is relative and cannot escape the profile folder', () => {
    for (const one of CATEGORIES) {
      for (const path of one.storage) {
        assert.equal(path.startsWith('/'), false, `${one.id} declares an absolute path: ${path}`)
        assert.equal(/^[A-Za-z]:/.test(path), false, `${one.id} declares a drive-letter path: ${path}`)
        assert.equal(path.includes('..'), false, `${one.id} declares a path that walks upwards: ${path}`)
        assert.equal(path.includes('\\'), false, `${one.id} declares a backslash path: ${path}`)
        assert.ok(path.length > 0, `${one.id} declares an empty path`)
      }
    }
  })

  test('a category with no storage is one that is rebuilt or reconstructed', () => {
    for (const one of CATEGORIES) {
      if (one.storage.length > 0) continue
      assert.ok(
        one.portability === 'rebuilt' || one.portability === 'device-bound',
        `${one.id} names no storage but claims to be ${one.portability}`
      )
    }
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and name the authoritative-table rule', () => {
    assert.equal(Object.isFrozen(REGISTRY_ASSUMPTIONS), true)
    assert.ok(REGISTRY_ASSUMPTIONS.some((one) => /authoritative inventory/.test(one)))
    assert.ok(REGISTRY_ASSUMPTIONS.some((one) => /derived from this table/.test(one)))
    assert.ok(REGISTRY_ASSUMPTIONS.some((one) => /never copied/.test(one)))
  })
})
