import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactStore, RECORD_FILE, SOURCE_FILE } from './store.ts'
import { makeArtifactId, type ArtifactRecord } from '../../shared/artifacts/model.ts'

const record = (id: string, title = 'T'): ArtifactRecord => ({
  artifactId: id,
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
  tags: []
})

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

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
    const root = await store.write('default', record(id), [
      { name: SOURCE_FILE, bytes: bytes('{}') },
      { name: 'content.json', bytes: bytes('{}') }
    ])
    assert.equal(root, join(dir, 'artifacts', id))
    assert.equal((await store.readRecord('default', id))?.title, 'T')
    assert.equal(new TextDecoder().decode((await store.readFile('default', id, 'content.json')) ?? new Uint8Array()), '{}')
    assert.deepEqual((await store.list('default')).map((one) => one.artifactId), [id])
    // No staging folder left behind.
    await assert.rejects(stat(`${root}.staging`))
    assert.equal(await store.remove('default', id), true)
    assert.equal(await store.readRecord('default', id), null)
  }))

test('a second profile keeps its own folder', () =>
  withStore(async (store, dir) => {
    const id = makeArtifactId('2'.repeat(32))
    const root = await store.write('p2', record(id), [{ name: 'content.json', bytes: bytes('{}') }])
    assert.equal(root, join(dir, 'profiles', 'p2', 'artifacts', id))
    assert.deepEqual(await store.list('default'), [])
  }))

test('an id that is not an id never reaches a path', () =>
  withStore(async (store) => {
    await assert.rejects(store.write('default', record('../escape' as string), []), /not an artifact id/)
    assert.equal(await store.readRecord('default', '../escape'), null)
    assert.equal(await store.readFile('default', '../escape', RECORD_FILE), null)
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

test('a rewrite replaces the folder whole and keeps nothing from before', () =>
  withStore(async (store, dir) => {
    const id = makeArtifactId('4'.repeat(32))
    await store.write('default', record(id, 'first'), [{ name: 'content.csv', bytes: bytes('a') }])
    await store.write('default', record(id, 'second'), [{ name: 'content.json', bytes: bytes('b') }])
    assert.equal((await store.readRecord('default', id))?.title, 'second')
    assert.equal(await store.readFile('default', id, 'content.csv'), null)
    await assert.rejects(stat(join(dir, 'artifacts', `${id}.previous`)))
  }))

test('a damaged record is skipped rather than trusted', () =>
  withStore(async (store, dir) => {
    const id = makeArtifactId('5'.repeat(32))
    await store.write('default', record(id), [{ name: 'content.json', bytes: bytes('{}') }])
    const path = join(dir, 'artifacts', id, RECORD_FILE)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, (await readFile(path, 'utf8')).replace('"kind":"table"', '"kind":7'))
    assert.equal(await store.readRecord('default', id), null)
    assert.deepEqual(await store.list('default'), [])
  }))

test('writeRecord replaces the record and leaves the files', () =>
  withStore(async (store) => {
    const id = makeArtifactId('6'.repeat(32))
    await store.write('default', record(id, 'before'), [{ name: 'content.json', bytes: bytes('{}') }])
    await store.writeRecord('default', record(id, 'after'))
    assert.equal((await store.readRecord('default', id))?.title, 'after')
    assert.notEqual(await store.readFile('default', id, 'content.json'), null)
  }))
