import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { NeurovaStore } from './store.ts'

function wav(seconds: number, level: number): Buffer {
  const rate = 8000
  const n = rate * seconds
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(level * 32767 * Math.sin(i / 10)), 44 + i * 2)
  return b
}

test('import, version, analyse, export and package round-trip on real files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nv-'))
  const store = new NeurovaStore(join(root, 'ud'))
  const a = join(root, 'a.wav'); const b = join(root, 'b.wav'); const bad = join(root, 'bad.wav')
  await writeFile(a, wav(1, 0.5)); await writeFile(b, wav(2, 0.3)); await writeFile(bad, Buffer.from('not audio at all, really not audio, padding padding padding'))
  const p = await store.create('Night Drive', 'a brief')
  await assert.rejects(store.importAudio(p.id, bad))
  const one = await store.importAudio(p.id, a)
  assert.equal(one.project.versions.length, 1)
  assert.ok(Math.abs(one.info.durationSec - 1) < 0.001)
  const two = await store.importAudio(p.id, b, 'warmer', 'less bright')
  assert.equal(two.project.versions[1].parentId, two.project.versions[0].id)
  const info = await store.analyse(p.id, two.project.versions[1].artifactId)
  assert.ok(Math.abs(info.durationSec - 2) < 0.001)
  const out = join(root, 'out'); await (await import('node:fs/promises')).mkdir(out)
  const exported = await store.exportVersion(p.id, two.project.versions[0].id, out)
  assert.deepEqual(await readFile(exported), await readFile(a))
  const again = await store.exportVersion(p.id, two.project.versions[0].id, out)
  assert.notEqual(again, exported)
  const fl = await store.exportVersion(p.id, two.project.versions[0].id, out, 'flac')
  assert.ok(fl.endsWith('.flac'))
  assert.equal((await readFile(fl)).subarray(0, 4).toString(), 'fLaC')
  assert.notEqual((await store.exportVersion(p.id, two.project.versions[0].id, out, 'flac')), fl)
  const pkg = await store.exportPackage(p.id, out)
  const copy = await store.importPackage(pkg)
  assert.notEqual(copy.id, p.id)
  assert.equal(copy.versions.length, 2)
  assert.deepEqual(await store.strays(copy.id), [])
  assert.ok((await readdir(out)).length >= 3)
  await store.flush()
})

test('processing makes a new version from the old one and leaves the source file alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nvp-'))
  const store = new NeurovaStore(join(root, 'ud'))
  const a = join(root, 'a.wav')
  await writeFile(a, wav(3, 0.5))
  const p = await store.create('Fade test')
  const first = await store.importAudio(p.id, a)
  const srcArtifact = first.project.artifacts[0]
  const r = await store.process(p.id, first.project.versions[0].id, { kind: 'fade-out', seconds: 1 })
  assert.equal(r.project.versions.length, 2)
  assert.equal(r.project.artifacts.length, 2)
  const derived = r.project.artifacts.find((x) => x.source === 'processed')!
  assert.equal(derived.derivedFrom?.artifactId, srcArtifact.id)
  const info = await store.analyse(p.id, srcArtifact.id)
  assert.ok(Math.abs(info.durationSec - 3) < 0.001)
  await assert.rejects(store.process(p.id, first.project.versions[0].id, { kind: 'fade-in', seconds: 99 }))
  assert.equal((await store.waveform(p.id, derived.id, 20)).length, 20)
  await store.flush()
})
