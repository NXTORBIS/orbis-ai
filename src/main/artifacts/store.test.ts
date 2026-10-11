import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactStore, RECORD_FILE, SOURCE_FILE } from './store.ts'
import { makeArtifactId, makeVersionId, type ArtifactRecord } from '../../shared/artifacts/model.ts'

const record = (id: string, title = 'T', versionId = makeVersionId('a'.repeat(32)), version = 1): ArtifactRecord => ({
  artifactId: id,
  versionId,
  version,
  versions: [],
  reason: '',
  derivedFrom: null,
  kind: 'table',
  title,
  createdAt: 1,
  updatedAt: 1,
  format: 'json',
  file: 'content.json',
  bytes: 2,
  hash: 'h',
  loss: { lossy: false, losses: [], carries: { units: true, types: true, metadata: true, formatting: false, provenance: true, hierarchy: true } },
  verified: { ok: true, checks: [], reimported: null, differences: [] },
  source: 'test',
  shape: { rows: 0, columns: 0 },
  tags: [],
  notes: []
})

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const withStore = async (run: (store: ArtifactStore, dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifacts-'))
  try {
    await run(new ArtifactStore({ userData: dir }), dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

test('an artifact is written as one folder, read back, listed, and removed', () =>
  withStore(async (store, dir) => {
    const id = makeArtifactId('1'.repeat(32))
    const current = await store.write('default', record(id), [
      { name: SOURCE_FILE, bytes: bytes('{}') },
      { name: 'content.json', bytes: bytes('{}') }
    ])
    assert.equal(current, join(dir, 'artifacts', id, 'current'))
    assert.equal((await store.readRecord('default', id))?.title, 'T')
    assert.equal(new TextDecoder().decode((await store.readFile('default', id, 'content.json')) ?? new Uint8Array()), '{}')
    assert.deepEqual((await store.list('default')).map((one) => one.artifactId), [id])
    assert.equal(await exists(join(dir, 'artifacts', id, 'current.staging')), false)
    assert.equal(await store.remove('default', id), true)
    assert.equal(await store.readRecord('default', id), null)
  }))

test('a second profile keeps its own folder', () =>
  withStore(async (store, dir) => {
    const id = makeArtifactId('2'.repeat(32))
    const current = await store.write('p2', record(id), [{ name: 'content.json', bytes: bytes('{}') }])
    assert.equal(current, join(dir, 'profiles', 'p2', 'artifacts', id, 'current'))
    assert.deepEqual(await store.list('default'), [])
  }))

test('an id that is not an id never reaches a path', () =>
  withStore(async (store) => {
    await assert.rejects(store.write('default', record('../escape' as string), []), /not an artifact id/)
    await assert.rejects(store.write('default', { ...record(makeArtifactId('9'.repeat(32))), versionId: '../v' }, []), /not a version id/)
    assert.equal(await store.readRecord('default', '../escape'), null)
    assert.equal(await store.readFile('default', '../escape', RECORD_FILE), null)
    assert.equal(await store.readVersionFile('default', makeArtifactId('9'.repeat(32)), '../x', RECORD_FILE), null)
    assert.equal(await store.remove('default', '../escape'), false)
  }))

test('only the fixed file names may be written or read', () =>
  withStore(async (store) => {
    const id = makeArtifactId('3'.repeat(32))
    await assert.rejects(store.write('default', record(id), [{ name: '../evil.txt', bytes: bytes('x') }]), /may not have a file/)
    await assert.rejects(store.write('default', record(id), [{ name: 'other.json', bytes: bytes('x') }]), /may not have a file/)
    await store.write('default', record(id), [{ name: 'content.csv', bytes: bytes('a') }])
    assert.equal(await store.readFile('default', id, '../artifact.json'), null)
  }))

test('a second write keeps the first version, files and all, under its own version id', () =>
  withStore(async (store, dir) => {
    const id = makeArtifactId('4'.repeat(32))
    const v1 = makeVersionId('b'.repeat(32))
    const v2 = makeVersionId('c'.repeat(32))
    await store.write('default', record(id, 'first', v1, 1), [{ name: 'content.csv', bytes: bytes('one') }, { name: SOURCE_FILE, bytes: bytes('{"v":1}') }])
    await store.write('default', record(id, 'second', v2, 2), [{ name: 'content.json', bytes: bytes('two') }, { name: SOURCE_FILE, bytes: bytes('{"v":2}') }])
    assert.equal((await store.readRecord('default', id))?.title, 'second')
    assert.equal(await store.readFile('default', id, 'content.csv'), null)
    // The first version is where it was moved, untouched.
    assert.equal(new TextDecoder().decode((await store.readVersionFile('default', id, v1, 'content.csv')) ?? new Uint8Array()), 'one')
    assert.equal(new TextDecoder().decode((await store.readVersionFile('default', id, v1, SOURCE_FILE)) ?? new Uint8Array()), '{"v":1}')
    assert.equal(await exists(join(dir, 'artifacts', id, 'versions', v1, RECORD_FILE)), true)
    assert.equal(await exists(join(dir, 'artifacts', id, 'current.staging')), false)
    // Removing takes every version with it.
    await store.remove('default', id)
    assert.equal(await exists(join(dir, 'artifacts', id)), false)
  }))

test('an artifact written before versions existed is still read, and the first write moves it into the new shape', () =>
  withStore(async (store, dir) => {
    const id = makeArtifactId('5'.repeat(32))
    const root = join(dir, 'artifacts', id)
    await mkdir(root, { recursive: true })
    const old = record(id, 'old') as unknown as Record<string, unknown>
    delete old.versionId
    delete old.version
    delete old.versions
    delete old.reason
    delete old.derivedFrom
    await writeFile(join(root, RECORD_FILE), JSON.stringify(old))
    await writeFile(join(root, 'content.json'), '{"old":true}')
    const read = await store.readRecord('default', id)
    assert.equal(read?.title, 'old')
    assert.equal(read?.version, 1)
    assert.ok(read?.versionId.startsWith('v'))
    assert.deepEqual((await store.list('default')).map((one) => one.title), ['old'])

    await store.write('default', record(id, 'new', makeVersionId('d'.repeat(32)), 2), [{ name: 'content.json', bytes: bytes('{"new":true}') }])
    assert.equal((await store.readRecord('default', id))?.title, 'new')
    assert.equal(await exists(join(root, RECORD_FILE)), false, 'the old-shape record was moved, not left behind')
    assert.equal(new TextDecoder().decode((await store.readVersionFile('default', id, read!.versionId, 'content.json')) ?? new Uint8Array()), '{"old":true}')
  }))

test('a damaged record is skipped rather than trusted', () =>
  withStore(async (store, dir) => {
    const id = makeArtifactId('6'.repeat(32))
    await store.write('default', record(id), [{ name: 'content.json', bytes: bytes('{}') }])
    const path = join(dir, 'artifacts', id, 'current', RECORD_FILE)
    await writeFile(path, (await readFile(path, 'utf8')).replace('"kind":"table"', '"kind":7'))
    assert.equal(await store.readRecord('default', id), null)
    assert.deepEqual(await store.list('default'), [])
  }))

test('writeRecord replaces the record and leaves the files', () =>
  withStore(async (store) => {
    const id = makeArtifactId('7'.repeat(32))
    await store.write('default', record(id, 'before'), [{ name: 'content.json', bytes: bytes('{}') }])
    await store.writeRecord('default', record(id, 'after'))
    assert.equal((await store.readRecord('default', id))?.title, 'after')
    assert.notEqual(await store.readFile('default', id, 'content.json'), null)
  }))

const busy = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

test('a folder that is busy for a moment is waited for, and the version is written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifacts-'))
  try {
    let refusals = 3
    const waited: number[] = []
    const store = new ArtifactStore({
      userData: dir,
      // Something else has the new files open: the first three tries at any rename are refused.
      rename: async (from, to) => {
        if (refusals > 0) {
          refusals -= 1
          throw busy(refusals % 2 === 0 ? 'EPERM' : 'EBUSY')
        }
        await rename(from, to)
      },
      wait: async (ms) => {
        waited.push(ms)
      }
    })
    const id = makeArtifactId('1'.repeat(32))
    await store.write('default', record(id, 'First'), [{ name: SOURCE_FILE, bytes: bytes('{}') }, { name: 'content.json', bytes: bytes('[]') }])
    assert.deepEqual(waited, [15, 30, 60], 'it waited a little longer each time, and stopped as soon as the rename went through')
    assert.equal((await store.readRecord('default', id))?.title, 'First')

    // And the second version, where the old folder is moved away first: the same patience, the same result.
    refusals = 2
    await store.write('default', record(id, 'Second', makeVersionId('b'.repeat(32)), 2), [{ name: SOURCE_FILE, bytes: bytes('{}') }, { name: 'content.json', bytes: bytes('[1]') }])
    assert.equal((await store.readRecord('default', id))?.title, 'Second')
    assert.equal(new TextDecoder().decode((await store.readVersionFile('default', id, makeVersionId('a'.repeat(32)), 'content.json'))!), '[]', 'the version before is kept')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('a folder that stays busy is reported, and what was there before is still there', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifacts-'))
  try {
    let refuse = false
    let tries = 0
    const store = new ArtifactStore({
      userData: dir,
      rename: async (from, to) => {
        // Only the new folder arriving is refused; putting the old one back is allowed.
        if (refuse && from.endsWith('current.staging')) {
          tries += 1
          throw busy('EPERM')
        }
        await rename(from, to)
      },
      wait: async () => undefined
    })
    const id = makeArtifactId('2'.repeat(32))
    await store.write('default', record(id, 'First'), [{ name: SOURCE_FILE, bytes: bytes('{}') }, { name: 'content.json', bytes: bytes('[]') }])
    refuse = true
    await assert.rejects(store.write('default', record(id, 'Second', makeVersionId('b'.repeat(32)), 2), [{ name: SOURCE_FILE, bytes: bytes('{}') }, { name: 'content.json', bytes: bytes('[1]') }]), /EPERM/)
    assert.equal(tries, 8, 'the first try and seven more')
    assert.equal((await store.readRecord('default', id))?.title, 'First', 'the old version is current again')
    assert.equal(new TextDecoder().decode((await store.readFile('default', id, 'content.json'))!), '[]')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('a refusal that is not "busy" is not waited for', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifacts-'))
  try {
    let waits = 0
    const store = new ArtifactStore({
      userData: dir,
      rename: async () => {
        throw busy('ENOSPC')
      },
      wait: async () => {
        waits += 1
      }
    })
    await assert.rejects(store.write('default', record(makeArtifactId('3'.repeat(32))), [{ name: SOURCE_FILE, bytes: bytes('{}') }]), /ENOSPC/)
    assert.equal(waits, 0)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('a read asked for in the middle of a write sees the old version or the new one, never nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifacts-'))
  try {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let hold = false
    const store = new ArtifactStore({
      userData: dir,
      rename: async (from, to) => {
        await rename(from, to)
        // Stop in the gap: the old current has moved away and the new one has not arrived.
        if (hold && to.includes('versions')) await held
      }
    })
    const id = makeArtifactId('4'.repeat(32))
    await store.write('default', record(id, 'First'), [{ name: SOURCE_FILE, bytes: bytes('{}') }, { name: 'content.json', bytes: bytes('[]') }])
    hold = true
    const writing = store.write('default', record(id, 'Second', makeVersionId('b'.repeat(32)), 2), [{ name: SOURCE_FILE, bytes: bytes('{}') }, { name: 'content.json', bytes: bytes('[1]') }])
    // Asked while the write is stopped in the gap.
    const reading = Promise.all([store.readRecord('default', id), store.readFile('default', id, 'content.json')])
    await new Promise((resolve) => setTimeout(resolve, 40))
    release()
    await writing
    const [seen, content] = await reading
    assert.equal(seen?.title, 'Second', 'the read waited for the write and saw what it wrote')
    assert.equal(new TextDecoder().decode(content!), '[1]')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('the queue keeps nothing once the work is done: not what a read handed back, and not an entry for an id that was only asked about', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifacts-'))
  try {
    const store = new ArtifactStore({ userData: dir })
    const id = makeArtifactId('5'.repeat(32))
    await store.write('default', record(id), [{ name: SOURCE_FILE, bytes: bytes('{}') }, { name: 'content.json', bytes: bytes('x'.repeat(50_000)) }])
    await store.readFile('default', id, 'content.json')
    for (let i = 0; i < 200; i++) await store.readRecord('default', makeArtifactId(i.toString(16).padStart(32, '0')))
    await new Promise((resolve) => setTimeout(resolve, 5))
    const queues = (store as unknown as { queues: Map<string, Promise<unknown>> }).queues
    assert.equal(queues.size, 0)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
