import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  FORMAT_VERSION,
  MANIFEST_ASSUMPTIONS,
  PACKAGE_SIGNATURE,
  buildManifest,
  canImport,
  checkCompatibility,
  checkManifest,
  completeness,
  excludedRecord,
  readManifest,
  summarise,
  type CategoryRecord,
  type Manifest
} from './manifest.ts'
import { categoryById } from './registry.ts'

const NOW = 1_764_000_000_000

const record = (id: string, over: Partial<CategoryRecord> = {}): CategoryRecord => ({
  id,
  disposition: 'included',
  count: 10,
  bytes: 4096,
  schemaVersion: categoryById(id)?.schemaVersion ?? 1,
  note: '',
  paths: [`${id.replace(/\./g, '/')}/data.json`],
  ...over
})

const manifest = (over: Partial<Manifest> = {}): Manifest =>
  buildManifest({
    packageId: 'pkg-0123456789abcdef',
    purpose: 'transfer',
    createdByVersion: '1.4.2',
    createdAt: NOW,
    profileId: 'profile-abc',
    profileName: 'Nishanth',
    categories: [record('notes'), record('tasks'), record('orion.conversations', { count: 428, bytes: 9_000_000 })],
    assets: { count: 120, bytes: 40_000_000, deduplicated: 8 },
    integrity: { algorithm: 'sha-256', entries: [{ path: 'manifest.json', bytes: 400, hash: 'a'.repeat(64) }], digest: 'b'.repeat(64) },
    encryption: { encrypted: false, cipher: null, kdf: null, kdfParams: null, sealed: [] },
    platform: 'win32',
    ...over
  }) as Manifest

// ------------------------------------------------------------ validation

describe('validating a manifest', () => {
  test('a well-formed manifest has nothing blocking', () => {
    assert.equal(canImport(checkManifest(manifest())), true)
  })

  test('a renamed ZIP is refused with a sentence rather than half-imported', () => {
    const problems = checkManifest({ ...manifest(), signature: 'PK' })
    assert.equal(canImport(problems), false)
    assert.match(problems.find((one) => one.field === 'signature')?.describe ?? '', /renamed to \.orbis is not an Orbis profile/)
  })

  test('nothing at all is refused, and says why', () => {
    for (const nothing of [null, undefined, 'a string', 42, []]) {
      const problems = checkManifest(nothing)
      assert.equal(canImport(problems), false, JSON.stringify(nothing))
    }
    assert.match(checkManifest(null)[0]?.describe ?? '', /no readable manifest/)
  })

  test('a package from a newer Orbis is refused rather than quietly stripped', () => {
    const problems = checkManifest({ ...manifest(), formatVersion: 9, minimumReadableBy: 9 })
    assert.equal(canImport(problems), false)
    assert.match(problems.find((one) => one.field === 'formatVersion')?.describe ?? '', /silently dropping whatever the newer version added/)
  })

  test('a package from an older Orbis is a note, not a refusal', () => {
    const problems = checkManifest({ ...manifest(), formatVersion: 1, minimumReadableBy: 1 }, { formatVersion: 3 })
    assert.equal(canImport(problems), true)
    assert.match(problems.find((one) => one.field === 'formatVersion')?.describe ?? '', /will be migrated/)
  })

  test('a package with no identifier is refused, because two could not be told apart', () => {
    assert.equal(canImport(checkManifest({ ...manifest(), packageId: '' })), false)
  })

  test('a package listing nothing is refused', () => {
    assert.equal(canImport(checkManifest({ ...manifest(), categories: [] })), false)
  })

  test('a category listed twice is refused', () => {
    const problems = checkManifest({ ...manifest(), categories: [record('notes'), record('notes')] })
    assert.equal(canImport(problems), false)
    assert.match(problems.find((one) => one.blocking)?.describe ?? '', /twice/)
  })

  test('a category this Orbis has never heard of is a note and not a refusal', () => {
    const problems = checkManifest({ ...manifest(), categories: [record('notes'), record('future.feature')] })
    assert.equal(canImport(problems), true)
    assert.match(problems.find((one) => /future\.feature/.test(one.describe))?.describe ?? '', /left alone rather than guessed at/)
  })

  test('a negative or missing count is refused, because it is used to size things', () => {
    assert.equal(canImport(checkManifest({ ...manifest(), categories: [record('notes', { count: -1 })] })), false)
    assert.equal(canImport(checkManifest({ ...manifest(), categories: [record('notes', { count: undefined as unknown as number })] })), false)
  })

  test('a package with no integrity information is refused', () => {
    assert.equal(canImport(checkManifest({ ...manifest(), integrity: undefined })), false)
    const problems = checkManifest({ ...manifest(), integrity: { algorithm: 'sha-256', entries: [], digest: 'b'.repeat(64) } })
    assert.equal(canImport(problems), false)
    assert.match(problems.find((one) => one.field === 'integrity.entries')?.describe ?? '', /changed file could not be found/)
  })

  test('an unhashed hash list is refused, because entries could be removed from it', () => {
    const problems = checkManifest({ ...manifest(), integrity: { algorithm: 'sha-256', entries: [{ path: 'a', bytes: 1, hash: 'x'.repeat(64) }], digest: '' } })
    assert.equal(canImport(problems), false)
    assert.match(problems.find((one) => one.field === 'integrity.digest')?.describe ?? '', /removed from it unnoticed/)
  })

  test('an unknown integrity algorithm is refused rather than assumed', () => {
    assert.equal(canImport(checkManifest({ ...manifest(), integrity: { algorithm: 'md5', entries: [{ path: 'a', bytes: 1, hash: 'x' }], digest: 'y'.repeat(64) } })), false)
  })

  test('a package claiming to be protected must say how', () => {
    const half = { ...manifest(), encryption: { encrypted: true, cipher: null, kdf: null, kdfParams: null, sealed: [] } }
    const problems = checkManifest(half)
    assert.equal(canImport(problems), false)
    for (const field of ['encryption.cipher', 'encryption.kdf', 'encryption.kdfParams', 'encryption.sealed']) {
      assert.ok(problems.some((one) => one.field === field), `${field} should have been reported`)
    }
  })

  test('a package claiming to be protected and naming nothing as protected is refused', () => {
    const problems = checkManifest({
      ...manifest(),
      encryption: { encrypted: true, cipher: 'aes-256-gcm', kdf: 'scrypt', kdfParams: { N: 16384, r: 8, p: 1 }, sealed: [] }
    })
    assert.match(problems.find((one) => one.field === 'encryption.sealed')?.describe ?? '', /names nothing as protected/)
  })
})

// ------------------------------------------------------------ reading

describe('reading a manifest back', () => {
  test('a valid manifest round-trips', () => {
    const read = readManifest(manifest())
    assert.ok(read !== null)
    assert.equal(read?.profileName, 'Nishanth')
    assert.equal(read?.categories.length, 3)
    assert.equal(read?.assets.count, 120)
  })

  test('an invalid one comes back as nothing rather than as something partial', () => {
    assert.equal(readManifest({ ...manifest(), signature: 'nope' }), null)
    assert.equal(readManifest(null), null)
  })

  test('categories come back in a stable order', () => {
    const read = readManifest(manifest())
    assert.deepEqual(read?.categories.map((one) => one.id), ['notes', 'orion.conversations', 'tasks'])
  })

  test('a missing creation time is tolerated, because its absence is only a note', () => {
    const read = readManifest({ ...manifest(), createdAt: undefined })
    assert.ok(read !== null)
    assert.equal(read?.createdAt, 0)
  })

  test('an unrecognised purpose falls back to transfer rather than to nothing', () => {
    assert.equal(readManifest({ ...manifest(), purpose: 'nonsense' })?.purpose, 'transfer')
  })

  test('an unrecognised platform is unknown rather than guessed', () => {
    assert.equal(readManifest({ ...manifest(), platform: 'solaris' })?.platform, 'unknown')
  })
})

// ------------------------------------------------------------ the preview

describe('what to show before importing', () => {
  test('the preview lists what is in the package, largest first', () => {
    const summary = summarise(manifest())
    assert.equal(summary.contents[0]?.id, 'orion.conversations')
    assert.equal(summary.contents[0]?.count, 428)
    assert.equal(summary.profileName, 'Nishanth')
  })

  test('every count comes from the manifest rather than being worked out', () => {
    const summary = summarise(manifest({ categories: [record('notes', { count: 82, bytes: 500 })] }))
    assert.equal(summary.contents[0]?.count, 82)
    assert.equal(summary.totalBytes, 500)
  })

  test('a category the package says it could not write is named as a failure', () => {
    const summary = summarise(manifest({ categories: [record('notes'), record('workflows.definitions', { disposition: 'failed', note: 'the store would not open' })] }))
    assert.equal(summary.failed.length, 1)
    assert.equal(summary.failed[0]?.label, 'Workflows')
    assert.match(summary.describe, /not complete/)
  })

  test('a category this Orbis does not recognise is named rather than hidden', () => {
    const summary = summarise(manifest({ categories: [record('notes'), record('future.thing')] }))
    assert.deepEqual(summary.unknown, ['future.thing'])
    assert.match(summary.describe, /does not recognise/)
  })

  test('an excluded category is not shown as content', () => {
    const summary = summarise(manifest({ categories: [record('notes'), excludedRecord('browser.siteData') as CategoryRecord] }))
    assert.equal(summary.contents.some((one) => one.id === 'browser.siteData'), false)
  })

  test('an empty category is left out of the list rather than shown as zero', () => {
    const summary = summarise(manifest({ categories: [record('notes'), record('tasks', { count: 0, bytes: 0 })] }))
    assert.deepEqual(summary.contents.map((one) => one.id), ['notes'])
  })
})

// ------------------------------------------------------------ compatibility

describe('compatibility', () => {
  test('a package this Orbis understands is importable, and says what it will restore', () => {
    const result = checkCompatibility(manifest())
    assert.equal(result.importable, true)
    assert.deepEqual(result.willRestore, ['notes', 'orion.conversations', 'tasks'])
  })

  test('a category at an older schema is migrated rather than refused', () => {
    const older = manifest({ categories: [record('notes', { schemaVersion: 0 })] })
    // Schema 0 is below the current 1, so it migrates.
    const result = checkCompatibility(older)
    assert.deepEqual(result.willMigrate, [{ id: 'notes', from: 0, to: 1 }])
    assert.equal(result.importable, true)
  })

  test('a category at a newer schema is refused for that category alone, not for the package', () => {
    const mixed = manifest({ categories: [record('notes'), record('tasks', { schemaVersion: 99 })] })
    const result = checkCompatibility(mixed)
    assert.equal(result.importable, true, 'the rest of the profile must still import')
    assert.deepEqual(result.willRestore, ['notes'])
    assert.equal(result.cannotUse[0]?.id, 'tasks')
    assert.match(result.cannotUse[0]?.why ?? '', /dropping whatever the newer version added/)
  })

  test('a package with nothing usable is not importable and says so', () => {
    const result = checkCompatibility(manifest({ categories: [record('notes', { schemaVersion: 99 })] }))
    assert.equal(result.importable, false)
    assert.match(result.describe, /Nothing in this package can be restored/)
  })

  test('the browser sign-in and the provider key are reported as needing the user, on every import', () => {
    const result = checkCompatibility(manifest())
    const ids = result.userActions.map((one) => one.id)
    assert.ok(ids.includes('browser.siteData'))
    assert.ok(ids.includes('orion.apiKey'))
  })

  test('importing the vault reports that it needs its master password', () => {
    const result = checkCompatibility(manifest({ categories: [record('secrets.vault')] }))
    assert.ok(result.userActions.some((one) => one.id === 'secrets.vault' && /master password/.test(one.action)))
  })

  test('a manifest that cannot be imported at all says why in the description', () => {
    const broken = { ...manifest(), signature: 'nope' } as unknown as Manifest
    const result = checkCompatibility(broken)
    assert.equal(result.importable, false)
    assert.match(result.describe, /cannot be imported/)
  })
})

// ------------------------------------------------------------ honesty about completeness

describe('completeness', () => {
  test('a package holding everything that was asked for is complete', () => {
    const result = completeness(manifest(), ['notes', 'tasks', 'orion.conversations'])
    assert.equal(result.complete, true)
    assert.match(result.describe, /Everything that was asked for/)
  })

  test('a package missing something that was asked for is not complete, and names it', () => {
    const result = completeness(manifest(), ['notes', 'tasks', 'orion.conversations', 'whiteboards'])
    assert.equal(result.complete, false)
    assert.deepEqual(result.missing, ['whiteboards'])
    assert.match(result.describe, /Whiteboards/)
    assert.match(result.describe, /must not be described as one/)
  })

  test('a package that failed to write a category is not complete, whatever else went in', () => {
    const withFailure = manifest({
      categories: [record('notes'), record('tasks'), record('orion.conversations'), record('workflows.definitions', { disposition: 'failed', note: 'the store would not open' })]
    })
    const result = completeness(withFailure, ['notes', 'tasks', 'orion.conversations', 'workflows.definitions'])
    assert.equal(result.complete, false)
    assert.deepEqual(result.failed, ['workflows.definitions'])
    assert.match(result.describe, /could not be written/)
  })

  test('a transformed category counts as written', () => {
    const result = completeness(manifest({ categories: [record('workspaces', { disposition: 'transformed' })] }), ['workspaces'])
    assert.equal(result.complete, true)
  })

  test('an excluded category was never asked for, so it does not make the package incomplete', () => {
    const withExclusion = manifest({ categories: [record('notes'), excludedRecord('browser.caches') as CategoryRecord] })
    assert.equal(completeness(withExclusion, ['notes']).complete, true)
  })
})

describe('recording what was left out', () => {
  test('an excluded category carries the reason it was excluded', () => {
    const one = excludedRecord('orion.apiKey')
    assert.equal(one?.disposition, 'excluded')
    assert.equal(one?.count, 0)
    assert.match(one?.note ?? '', /cannot be decrypted anywhere else/)
  })

  test('a rebuilt category says it is rebuilt on the destination', () => {
    assert.match(excludedRecord('search.index')?.note ?? '', /Built from data that is in the package|rebuilt/i)
  })

  test('an id that is not a category gives nothing rather than an empty record', () => {
    assert.equal(excludedRecord('nonsense'), null)
  })
})

describe('building one', () => {
  test('the format version and the marker are set by Orbis, not by the caller', () => {
    const built = manifest()
    assert.equal(built.signature, PACKAGE_SIGNATURE)
    assert.equal(built.formatVersion, FORMAT_VERSION)
  })

  test('the logical profile identity travels and nothing about the device does', () => {
    const built = manifest()
    const text = JSON.stringify(built)
    assert.match(text, /profile-abc/)
    // The platform family is there for migrating settings; the machine is not.
    assert.equal(built.platform, 'win32')
    for (const leak of ['ksran', 'hostname', 'macAddress', 'serial', 'C:\\\\Users']) {
      assert.equal(text.includes(leak), false, `the manifest must not carry ${leak}`)
    }
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and rule out private data in the manifest', () => {
    assert.equal(Object.isFrozen(MANIFEST_ASSUMPTIONS), true)
    assert.ok(MANIFEST_ASSUMPTIONS.some((one) => /never the export password/.test(one)))
    assert.ok(MANIFEST_ASSUMPTIONS.some((one) => /prevents an accident and not an attack/.test(one)))
    assert.ok(MANIFEST_ASSUMPTIONS.some((one) => /may say everything was exported/.test(one)))
  })
})
