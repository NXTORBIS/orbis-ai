import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

import { EVERYTHING } from '../../shared/portable/registry.ts'
import {
  estimate,
  exportProfile,
  isExportError,
  needsPassword,
  type ExportDeps,
  type ExportOutcome,
  type ExportProgress,
  type SourceFile
} from './exporter.ts'
import {
  checkRecovery,
  clearRecovery,
  importPackage,
  inspect,
  isImportError,
  JOURNAL_PATH,
  storagePathOf,
  verify,
  type ImportDeps,
  type ImportOutcome
} from './importer.ts'

/**
 * Export and import, end to end, against a profile made of a Map.
 *
 * The failure paths are the point. A round trip that works is table stakes; what has to be shown is that a wrong
 * password, an altered byte, a disappearing file, a cancelled run and a write that fails part-way through each end
 * somewhere a person can recover from.
 */

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

/** A profile that lives in a Map, so every awkward case can be arranged exactly. */
class FakeDisk {
  readonly files = new Map<string, Buffer>()
  /** Paths that throw when read, for the file-vanishes-mid-export case. */
  readonly unreadable = new Set<string>()
  /** Paths that throw when written, for the rollback case. */
  readonly unwritable = new Set<string>()
  readonly written: string[] = []

  put(scope: 'profile' | 'app', path: string, value: unknown): void {
    this.files.set(`${scope}:${path}`, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8'))
  }

  get(scope: 'profile' | 'app', path: string): unknown {
    const found = this.files.get(`${scope}:${path}`)
    if (found === undefined) return undefined
    try {
      return JSON.parse(found.toString('utf8')) as unknown
    } catch {
      return found.toString('utf8')
    }
  }

  exportDeps(overrides: Partial<ExportDeps> = {}): ExportDeps {
    return {
      list: async (scope, storagePath) => {
        const out: SourceFile[] = []
        for (const key of this.files.keys()) {
          const [keyScope, ...rest] = key.split(':')
          const path = rest.join(':')
          if (keyScope !== scope) continue
          if (path === storagePath || path.startsWith(`${storagePath}/`)) {
            out.push({ path, bytes: (this.files.get(key) as Buffer).length, modified: 1_700_000_000_000 })
          }
        }
        return out
      },
      read: async (scope, path) => {
        if (this.unreadable.has(`${scope}:${path}`)) return null
        return this.files.get(`${scope}:${path}`) ?? null
      },
      write: async () => undefined,
      freeSpace: async () => 1024 * 1024 * 1024,
      deflateRawSync: (data) => deflateRawSync(data),
      inflateRawSync: (data) => inflateRawSync(data),
      sha256,
      now: () => 1_700_000_000_000,
      appVersion: '0.3.0',
      platform: 'win32',
      ...overrides
    }
  }

  importDeps(overrides: Partial<ImportDeps> = {}): ImportDeps {
    return {
      read: async (scope, path) => this.files.get(`${scope}:${path}`) ?? null,
      write: async (scope, path, bytes) => {
        const key = `${scope}:${path}`
        if (this.unwritable.has(key)) throw new Error(`cannot write ${key}`)
        this.files.set(key, bytes)
        this.written.push(key)
      },
      remove: async (scope, path) => {
        this.files.delete(`${scope}:${path}`)
      },
      exists: async (scope, path) => this.files.has(`${scope}:${path}`),
      inflateRawSync: (data) => inflateRawSync(data),
      sha256,
      now: () => 1_700_000_000_000,
      appVersion: '0.3.0',
      ...overrides
    }
  }
}

const PASSWORD = 'harbour-lantern-quiet-42'

/** A profile with something in every category this test touches. */
function makeProfile(): FakeDisk {
  const disk = new FakeDisk()
  disk.put('profile', 'personal/notes.json', [
    { id: 'n1', text: 'the first note' },
    { id: 'n2', text: 'the second note' }
  ])
  disk.put('profile', 'personal/tasks.json', [{ id: 't1', title: 'do the thing' }])
  disk.put('profile', 'personal/task-lists.json', [{ id: 'l1', name: 'Today' }])
  disk.put('profile', 'markets.json', { watchlist: ['BTC', 'ETH'] })
  disk.put('app', 'settings.json', { theme: 'dark', userName: 'N', apiKey: 'sk-live-must-not-travel' })
  disk.put('profile', 'pages.json', [{ id: 'p1', title: 'A Page' }])
  return disk
}

const CARRIED = ['notes', 'tasks', 'markets', 'orion.settings', 'pages.documents']

async function exportIt(disk: FakeDisk, options: { password?: string | null; categories?: string[] } = {}): Promise<{ outcome: ExportOutcome; archive: Uint8Array }> {
  let archive: Uint8Array | null = null
  const deps = disk.exportDeps({
    write: async (_destination, bytes) => {
      archive = bytes
    }
  })
  const outcome = await exportProfile(
    {
      profileId: 'profile-one',
      profileName: 'Mine',
      categoryIds: options.categories ?? CARRIED,
      purpose: 'transfer',
      password: options.password === undefined ? PASSWORD : options.password,
      destination: 'C:/somewhere/mine.orbis'
    },
    deps
  )
  assert.ok(!isExportError(outcome), isExportError(outcome) ? outcome.message : '')
  assert.ok(archive !== null, 'nothing was written')
  return { outcome: outcome as ExportOutcome, archive: archive as unknown as Uint8Array }
}

describe('a whole round trip', () => {
  it('carries a profile out and back into an empty one', async () => {
    const source = makeProfile()
    const { archive } = await exportIt(source)

    const destination = new FakeDisk()
    const result = await importPackage(archive, { categoryIds: CARRIED, mode: 'replace', password: PASSWORD }, destination.importDeps())
    assert.ok(!isImportError(result), isImportError(result) ? result.message : '')

    assert.deepEqual(destination.get('profile', 'personal/notes.json'), [
      { id: 'n1', text: 'the first note' },
      { id: 'n2', text: 'the second note' }
    ])
    assert.deepEqual(destination.get('profile', 'personal/tasks.json'), [{ id: 't1', title: 'do the thing' }])
    assert.deepEqual(destination.get('profile', 'markets.json'), { watchlist: ['BTC', 'ETH'] })
    assert.deepEqual(destination.get('profile', 'pages.json'), [{ id: 'p1', title: 'A Page' }])
  })

  it('leaves the device-bound key behind and says so', async () => {
    const source = makeProfile()
    const { archive } = await exportIt(source)

    // Not anywhere in the package, even compressed and sealed.
    assert.ok(!Buffer.from(archive).includes(Buffer.from('sk-live-must-not-travel', 'utf8')))

    const destination = new FakeDisk()
    const result = (await importPackage(archive, { categoryIds: CARRIED, mode: 'replace', password: PASSWORD }, destination.importDeps())) as ImportOutcome
    assert.ok(!isImportError(result))
    const settings = destination.get('app', 'settings.json') as Record<string, unknown>
    assert.equal(settings.theme, 'dark')
    assert.equal(settings.apiKey, undefined)
    const outcome = result.categories.find((one) => one.categoryId === 'orion.settings')
    assert.ok(outcome?.notes.some((one) => /asked for/.test(one)), JSON.stringify(outcome?.notes))
  })

  it('keeps the key the destination already has', async () => {
    const source = makeProfile()
    const { archive } = await exportIt(source)
    const destination = new FakeDisk()
    destination.put('app', 'settings.json', { theme: 'light', apiKey: 'sk-local-key' })
    await importPackage(archive, { categoryIds: CARRIED, mode: 'replace', password: PASSWORD }, destination.importDeps())
    const settings = destination.get('app', 'settings.json') as Record<string, unknown>
    assert.equal(settings.theme, 'dark', 'the package wins for what it carries')
    assert.equal(settings.apiKey, 'sk-local-key', 'and what it does not carry is untouched')
  })

  it('works without a password when nothing personal was chosen', async () => {
    const source = makeProfile()
    source.put('profile', 'browser-sidebar.json', { panels: ['history'] })
    const { archive, outcome } = await exportIt(source, { password: null, categories: ['browser.sidebar'] })
    assert.equal(outcome.manifest.encryption.encrypted, false)
    assert.ok(outcome.notes.some((one) => /not encrypted/.test(one)))
    const destination = new FakeDisk()
    const result = await importPackage(archive, { categoryIds: ['browser.sidebar'], mode: 'replace', password: null }, destination.importDeps())
    assert.ok(!isImportError(result))
    assert.deepEqual(destination.get('profile', 'browser-sidebar.json'), { panels: ['history'] })
  })

  it('carries a file that serves three categories exactly once', async () => {
    const disk = new FakeDisk()
    disk.put('profile', 'knowledge/knowledge.db', 'pretend this is a database')
    const { outcome } = await exportIt(disk, { categories: ['orion.memory', 'galaxy.graph', 'search.sessions'] })
    const paths = outcome.manifest.integrity.entries.map((one) => one.path)
    assert.deepEqual(paths.filter((one) => one.endsWith('knowledge.db')).length, 1)
    // And all three categories point at that one entry.
    for (const id of ['orion.memory', 'galaxy.graph', 'search.sessions']) {
      const record = outcome.manifest.categories.find((one) => one.id === id)
      assert.deepEqual(record?.paths, ['data/profile/knowledge/knowledge.db'], id)
    }
  })
})

describe('the export refuses what it should', () => {
  it('refuses to export nothing', async () => {
    const result = await exportProfile(
      { profileId: 'p', profileName: 'n', categoryIds: [], purpose: 'transfer', password: PASSWORD, destination: 'x' },
      makeProfile().exportDeps()
    )
    assert.ok(isExportError(result))
    assert.match(result.message, /not a backup of anything/)
  })

  it('refuses a selection of nothing but excluded categories', async () => {
    const result = await exportProfile(
      { profileId: 'p', profileName: 'n', categoryIds: ['clipboard', 'browser.passwords'], purpose: 'transfer', password: PASSWORD, destination: 'x' },
      makeProfile().exportDeps()
    )
    assert.ok(isExportError(result))
    assert.match(result.message, /reassuring name/)
  })

  it('refuses to write personal content without a password', async () => {
    const result = await exportProfile(
      { profileId: 'p', profileName: 'n', categoryIds: ['notes'], purpose: 'transfer', password: null, destination: 'x' },
      makeProfile().exportDeps()
    )
    assert.ok(isExportError(result))
    assert.equal(result.error, 'password')
    assert.match(result.message, /anyone who picks up the drive/)
  })

  it('says which categories forced the password', () => {
    const verdict = needsPassword(['notes', 'browser.sidebar'])
    assert.equal(verdict.required, true)
    assert.deepEqual(verdict.because, ['Notes'])
    // A sidebar layout is nobody's private content, so on its own it needs no password.
    assert.equal(needsPassword(['browser.sidebar']).required, false)
  })

  it('refuses a weak password', async () => {
    const result = await exportProfile(
      { profileId: 'p', profileName: 'n', categoryIds: ['notes'], purpose: 'transfer', password: 'abc', destination: 'x' },
      makeProfile().exportDeps()
    )
    assert.ok(isExportError(result))
    assert.equal(result.error, 'password')
  })

  it('records a file that vanished mid-export as a failure rather than dropping it', async () => {
    const source = makeProfile()
    source.unreadable.add('profile:personal/notes.json')
    let archive: Uint8Array | null = null
    const outcome = await exportProfile(
      { profileId: 'p', profileName: 'n', categoryIds: CARRIED, purpose: 'transfer', password: PASSWORD, destination: 'x' },
      source.exportDeps({ write: async (_d, bytes) => { archive = bytes } })
    )
    assert.ok(!isExportError(outcome))
    const result = outcome as ExportOutcome
    assert.ok(result.failures.some((one) => one.categoryId === 'notes'))
    const record = result.manifest.categories.find((one) => one.id === 'notes')
    assert.equal(record?.disposition, 'failed')
    // And the package does not get to call itself complete.
    assert.equal(result.complete.complete, false)
    assert.ok(archive !== null)
  })

  it('stops when cancelled, without writing', async () => {
    const source = makeProfile()
    let wrote = false
    const result = await exportProfile(
      { profileId: 'p', profileName: 'n', categoryIds: CARRIED, purpose: 'transfer', password: PASSWORD, destination: 'x' },
      source.exportDeps({ write: async () => { wrote = true } }),
      { shouldCancel: () => true }
    )
    assert.ok(isExportError(result))
    assert.equal(result.error, 'cancelled')
    assert.equal(wrote, false)
  })

  it('reports progress through its stages', async () => {
    const source = makeProfile()
    const seen: ExportProgress[] = []
    await exportProfile(
      { profileId: 'p', profileName: 'n', categoryIds: CARRIED, purpose: 'transfer', password: PASSWORD, destination: 'x' },
      source.exportDeps({ write: async () => undefined }),
      { onProgress: (one) => seen.push(one) }
    )
    const stages = [...new Set(seen.map((one) => one.stage))]
    for (const stage of ['planning', 'reading', 'writing', 'verifying', 'done']) {
      assert.ok(stages.includes(stage as ExportProgress['stage']), `${stage} was never reported`)
    }
  })

  it('will not write a package it cannot read back', async () => {
    const source = makeProfile()
    let wrote = false
    // Hashes match while the package is built and stop matching once it is read back, which is what a package
    // damaged between writing and reading looks like from here. Driven off the progress stage rather than a call
    // count, so it does not depend on how many times anything happens to be hashed.
    //
    // Note the corruption cannot go through `inflateRawSync`: a sealed entry is stored rather than deflated, since
    // compressing ciphertext saves nothing, so on an encrypted package inflate is never called.
    let verifying = false
    const result = await exportProfile(
      { profileId: 'p', profileName: 'n', categoryIds: CARRIED, purpose: 'transfer', password: PASSWORD, destination: 'x' },
      source.exportDeps({
        write: async () => { wrote = true },
        sha256: (data) => (verifying ? `changed-${sha256(data)}` : sha256(data))
      }),
      {
        onProgress: (progress) => {
          if (progress.stage === 'verifying') verifying = true
        }
      }
    )
    assert.ok(isExportError(result))
    assert.equal(result.error, 'verification')
    assert.match(result.message, /reads back differently|could not be read back|does not open/)
    assert.equal(wrote, false, 'a package that does not verify never reaches the destination')
  })
})

describe('estimating before doing it', () => {
  it('counts the files and allows for the verification copy', async () => {
    const source = makeProfile()
    const result = await estimate(
      { profileId: 'p', profileName: 'n', categoryIds: CARRIED, purpose: 'transfer', password: PASSWORD, destination: 'x' },
      source.exportDeps()
    )
    assert.ok(!isExportError(result))
    assert.ok(result.files >= 5)
    assert.ok(result.contentBytes > 0)
    assert.equal(result.enoughRoom, true)
    assert.match(result.why, /twice the package/)
  })

  it('says there is not enough room when there is not', async () => {
    const source = makeProfile()
    const result = await estimate(
      { profileId: 'p', profileName: 'n', categoryIds: CARRIED, purpose: 'transfer', password: PASSWORD, destination: 'x' },
      source.exportDeps({ freeSpace: async () => 10 })
    )
    assert.ok(!isExportError(result))
    assert.equal(result.enoughRoom, false)
  })

  it('says nothing was checked when the free space is unknown', async () => {
    const source = makeProfile()
    const result = await estimate(
      { profileId: 'p', profileName: 'n', categoryIds: CARRIED, purpose: 'transfer', password: PASSWORD, destination: 'x' },
      source.exportDeps({ freeSpace: async () => null })
    )
    assert.ok(!isExportError(result))
    assert.equal(result.enoughRoom, null)
    assert.match(result.why, /nothing was checked against it/)
  })
})

describe('inspecting a package before opening it', () => {
  it('reads what is in it without a password', async () => {
    const { archive } = await exportIt(makeProfile())
    const looked = inspect(archive, new FakeDisk().importDeps())
    assert.ok(!isImportError(looked))
    assert.equal(looked.encrypted, true)
    assert.equal(looked.manifest.profileName, 'Mine')
    assert.ok(looked.summary !== null)
    assert.ok(looked.compatibility.importable)
  })

  it('shows no content and no password in the part read without one', async () => {
    const { archive } = await exportIt(makeProfile())
    const looked = inspect(archive, new FakeDisk().importDeps())
    assert.ok(!isImportError(looked))
    const readable = JSON.stringify({ manifest: looked.manifest, protection: looked.protection })
    assert.ok(!readable.includes('the first note'))
    assert.ok(!readable.includes(PASSWORD))
    assert.ok(!readable.includes('sk-live'))
  })

  it('refuses a ZIP that is not a package', async () => {
    const { ZipWriter } = await import('../../shared/portable/zip.ts')
    const zip = new ZipWriter((data) => deflateRawSync(data))
    // add() returns the entry's bytes and finish() the table of contents; both are needed for a readable archive.
    const entry = zip.add({ path: 'hello.txt', data: Buffer.from('not a package'), compress: true })
    assert.ok(entry instanceof Uint8Array)
    const looked = inspect(Buffer.concat([Buffer.from(entry), Buffer.from(zip.finish())]), new FakeDisk().importDeps())
    assert.ok(isImportError(looked))
    assert.equal(looked.error, 'not-a-package')
    assert.match(looked.message, /scatter somebody else/)
  })

  it('refuses something that is not an archive at all', () => {
    const looked = inspect(Buffer.from('this is just text'), new FakeDisk().importDeps())
    assert.ok(isImportError(looked))
  })
})

describe('the import refuses what it should', () => {
  it('refuses the wrong password, having written nothing', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    const result = await importPackage(archive, { categoryIds: CARRIED, mode: 'replace', password: 'a-different-one-99' }, destination.importDeps())
    assert.ok(isImportError(result))
    assert.equal(result.error, 'password')
    assert.equal(destination.written.length, 0)
  })

  it('refuses no password for an encrypted package', async () => {
    const { archive } = await exportIt(makeProfile())
    const result = await importPackage(archive, { categoryIds: CARRIED, mode: 'replace', password: null }, new FakeDisk().importDeps())
    assert.ok(isImportError(result))
    assert.match(result.message, /Orbis has no copy of it/)
  })

  it('refuses a package with a byte changed', async () => {
    const { archive } = await exportIt(makeProfile())
    const tampered = Buffer.from(archive)
    // Change a byte well inside the first entry's payload.
    tampered[200] = (tampered[200] ?? 0) ^ 0xff
    const destination = new FakeDisk()
    const result = await importPackage(tampered, { categoryIds: CARRIED, mode: 'replace', password: PASSWORD }, destination.importDeps())
    assert.ok(isImportError(result))
    assert.equal(destination.written.length, 0)
  })

  it('finds an entry removed from the integrity list', async () => {
    const { archive } = await exportIt(makeProfile())
    const looked = inspect(archive, new FakeDisk().importDeps())
    assert.ok(!isImportError(looked))
    const shortened = { ...looked.manifest, integrity: { ...looked.manifest.integrity, entries: looked.manifest.integrity.entries.slice(1) } }
    const result = verify(archive, shortened, new FakeDisk().importDeps())
    assert.ok(isImportError(result))
    assert.match(result.message, /has been changed since the package was made/)
  })

  it('says so when nothing asked for is in the package', async () => {
    const { archive } = await exportIt(makeProfile(), { categories: ['markets'] })
    const result = await importPackage(archive, { categoryIds: ['whiteboards'], mode: 'replace', password: PASSWORD }, new FakeDisk().importDeps())
    assert.ok(isImportError(result))
    assert.equal(result.error, 'nothing-to-do')
  })

  it('reports a category asked for and absent, while bringing in the rest', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    const result = (await importPackage(
      archive,
      { categoryIds: [...CARRIED, 'whiteboards'], mode: 'replace', password: PASSWORD },
      destination.importDeps()
    )) as ImportOutcome
    assert.ok(!isImportError(result))
    const absent = result.categories.find((one) => one.categoryId === 'whiteboards')
    assert.equal(absent?.status, 'not-in-package')
    assert.deepEqual(destination.get('profile', 'markets.json'), { watchlist: ['BTC', 'ETH'] })
  })

  it('stops when cancelled, having written nothing', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    const result = await importPackage(
      archive,
      { categoryIds: CARRIED, mode: 'replace', password: PASSWORD },
      destination.importDeps(),
      { shouldCancel: () => true }
    )
    assert.ok(isImportError(result))
    assert.equal(result.error, 'cancelled')
    assert.equal(destination.written.length, 0)
  })

  it('never runs anything out of a package, and says so', async () => {
    const { archive } = await exportIt(makeProfile())
    const result = (await importPackage(archive, { categoryIds: CARRIED, mode: 'replace', password: PASSWORD }, new FakeDisk().importDeps())) as ImportOutcome
    assert.ok(!isImportError(result))
    assert.ok(result.notes.some((one) => /data on disk until you open them/.test(one)))
  })
})

describe('merging into a profile that already has things', () => {
  it('keeps what is here and adds what is new', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    destination.put('profile', 'personal/notes.json', [{ id: 'n1', text: 'MINE, not theirs' }, { id: 'n9', text: 'only here' }])

    const result = (await importPackage(archive, { categoryIds: ['notes'], mode: 'merge', password: PASSWORD }, destination.importDeps())) as ImportOutcome
    assert.ok(!isImportError(result))
    const notes = destination.get('profile', 'personal/notes.json') as { id: string; text: string }[]
    assert.equal(notes.length, 3)
    assert.equal(notes.find((one) => one.id === 'n1')?.text, 'MINE, not theirs')
    assert.ok(notes.some((one) => one.id === 'n2'))
    assert.ok(notes.some((one) => one.id === 'n9'))
  })

  it('reports how many it kept rather than overwrote', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    destination.put('profile', 'personal/notes.json', [{ id: 'n1', text: 'mine' }])
    const result = (await importPackage(archive, { categoryIds: ['notes'], mode: 'merge', password: PASSWORD }, destination.importDeps())) as ImportOutcome
    assert.ok(!isImportError(result))
    assert.ok(result.notes.some((one) => /Merging never overwrites/.test(one)))
  })

  it('replaces outright when asked to replace', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    destination.put('profile', 'personal/notes.json', [{ id: 'n9', text: 'only here' }])
    await importPackage(archive, { categoryIds: ['notes'], mode: 'replace', password: PASSWORD }, destination.importDeps())
    const notes = destination.get('profile', 'personal/notes.json') as { id: string }[]
    assert.equal(notes.length, 2)
    assert.ok(!notes.some((one) => one.id === 'n9'))
  })

  it('leaves a whole-file category alone on a merge', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    destination.put('profile', 'markets.json', { watchlist: ['MINE'] })
    const result = (await importPackage(archive, { categoryIds: ['markets'], mode: 'merge', password: PASSWORD }, destination.importDeps())) as ImportOutcome
    assert.ok(!isImportError(result))
    assert.deepEqual(destination.get('profile', 'markets.json'), { watchlist: ['MINE'] })
    const outcome = result.categories.find((one) => one.categoryId === 'markets')
    assert.ok(outcome?.notes.some((one) => /carried as a whole file/.test(one)))
  })
})

describe('when a write fails part-way through', () => {
  it('puts the profile back as it was', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    destination.put('profile', 'personal/notes.json', [{ id: 'original' }])
    destination.put('profile', 'markets.json', { watchlist: ['original'] })
    destination.put('profile', 'pages.json', [{ id: 'original-page' }])
    destination.unwritable.add('profile:pages.json')

    const result = await importPackage(archive, { categoryIds: CARRIED, mode: 'replace', password: PASSWORD }, destination.importDeps())
    assert.ok(isImportError(result))
    assert.equal(result.error, 'commit')
    assert.equal(result.rolledBack, true)
    assert.match(result.message, /put back as it was/)

    // Everything is as it was before the import began.
    assert.deepEqual(destination.get('profile', 'personal/notes.json'), [{ id: 'original' }])
    assert.deepEqual(destination.get('profile', 'markets.json'), { watchlist: ['original'] })
    assert.deepEqual(destination.get('profile', 'pages.json'), [{ id: 'original-page' }])
  })

  it('removes a file that was not there before, rather than leaving it half-imported', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    destination.unwritable.add('profile:pages.json')
    const result = await importPackage(archive, { categoryIds: CARRIED, mode: 'replace', password: PASSWORD }, destination.importDeps())
    assert.ok(isImportError(result))
    assert.equal(destination.files.has('profile:personal/notes.json'), false, 'a file created by the failed import was taken away again')
  })
})

describe('the journal, for a crash no rollback could cover', () => {
  it('marks the journal finished when an import completes', async () => {
    const { archive } = await exportIt(makeProfile())
    const destination = new FakeDisk()
    await importPackage(archive, { categoryIds: CARRIED, mode: 'replace', password: PASSWORD }, destination.importDeps())
    const recovery = await checkRecovery(destination.importDeps())
    assert.equal(recovery.interrupted, false)
  })

  it('reports an import that began and never finished', async () => {
    const destination = new FakeDisk()
    destination.put('profile', JOURNAL_PATH, {
      startedAt: 1_700_000_000_000,
      packageId: 'abc',
      mode: 'replace',
      paths: [{ scope: 'profile', path: 'personal/notes.json' }],
      finished: false
    })
    const recovery = await checkRecovery(destination.importDeps())
    assert.equal(recovery.interrupted, true)
    assert.equal(recovery.packageId, 'abc')
    assert.equal(recovery.paths.length, 1)
    assert.match(recovery.why, /some of those hold the package/)
  })

  it('treats an unreadable journal as an interruption rather than as nothing', async () => {
    const destination = new FakeDisk()
    destination.put('profile', JOURNAL_PATH, 'not json at all')
    const recovery = await checkRecovery(destination.importDeps())
    assert.equal(recovery.interrupted, true)
    assert.match(recovery.why, /not recoverable from it/)
  })

  it('says nothing was under way when there is no journal', async () => {
    const recovery = await checkRecovery(new FakeDisk().importDeps())
    assert.equal(recovery.interrupted, false)
  })

  it('clears the journal once the person has been told', async () => {
    const destination = new FakeDisk()
    destination.put('profile', JOURNAL_PATH, { finished: false, paths: [] })
    await clearRecovery(destination.importDeps())
    assert.equal(destination.files.has(`profile:${JOURNAL_PATH}`), false)
  })
})

describe('package paths', () => {
  it('maps a package path back to a storage path', () => {
    assert.equal(storagePathOf('data/profile/personal/notes.json', 'profile'), 'personal/notes.json')
    assert.equal(storagePathOf('data/app/settings.json', 'app'), 'settings.json')
  })

  it('refuses a path outside its scope', () => {
    assert.equal(storagePathOf('data/app/settings.json', 'profile'), null)
    assert.equal(storagePathOf('elsewhere/notes.json', 'profile'), null)
  })

  it('refuses a path that tries to climb out', () => {
    assert.equal(storagePathOf('data/profile/../../etc/passwd', 'profile'), null)
    assert.equal(storagePathOf('data/profile//absolute', 'profile'), null)
  })
})

describe('everything', () => {
  it('exports every category that can travel without falling over', async () => {
    const disk = makeProfile()
    // Something under each remaining storage path, so nothing is skipped merely for being absent.
    disk.put('profile', 'personal/whiteboards.json', [{ id: 'w1' }])
    disk.put('profile', 'personal/workspaces.json', [{ id: 'ws1' }])
    disk.put('profile', 'personal/tray.json', [{ id: 'tr1' }])
    disk.put('profile', 'workflows/repeats.json', [{ id: 'r1' }])
    disk.put('profile', 'workflows/runs.json', [{ id: 'run1' }])
    disk.put('profile', 'knowledge/knowledge.db', 'database bytes')
    disk.put('app', 'profiles.json', [{ id: 'profile-one', name: 'Mine' }])

    const { outcome, archive } = await exportIt(disk, { categories: [...EVERYTHING] })
    assert.ok(outcome.manifest.categories.length > 20)
    // The excluded ones are recorded as excluded rather than missing.
    const excluded = outcome.manifest.categories.filter((one) => one.disposition === 'excluded')
    assert.ok(excluded.length >= 5)

    const destination = new FakeDisk()
    const result = await importPackage(archive, { categoryIds: [...EVERYTHING], mode: 'replace', password: PASSWORD }, destination.importDeps())
    assert.ok(!isImportError(result), isImportError(result) ? result.message : '')
    assert.deepEqual(destination.get('profile', 'personal/whiteboards.json'), [{ id: 'w1' }])
    assert.deepEqual(destination.get('app', 'profiles.json'), [{ id: 'profile-one', name: 'Mine' }])
  })
})
