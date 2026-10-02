import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
    await rm(dir, { recursive: true, force: true })
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
