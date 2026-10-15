import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { encodeWav16 } from '../../shared/neurova/wav.ts'
import { addToMusic, registerWithFiles, describeMusicApi } from './integrations.ts'

const wav = (n = 4410): Uint8Array => encodeWav16({ sampleRate: 44100, channels: [Float32Array.from({ length: n }, (_, i) => Math.sin(i / 10) * 0.5)] }).bytes
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

function setup(files: Record<string, Uint8Array>, tracks: Array<{ id: string; file?: string }> = []) {
  const imported: string[] = []
  const lib = {
    importFile: async (p: string) => { imported.push(p); return { kind: 'added' as const, track: { id: 't1' }, file: p } },
    allTracks: async () => tracks,
    fingerprint: async (p: string) => (files[p] ? sha(files[p]).slice(0, 32) : null)
  }
  const deps = { readFile: async (p: string) => { if (!files[p]) throw new Error('nope'); return files[p] } }
  return { lib, deps, imported }
}
const base = (lib: any, b: Uint8Array) => ({ musicLibrary: lib, artifactPath: '/a.wav', sha256: sha(b), title: 'T', projectTitle: 'P', versionName: 'V1' })

test('adds a valid wav', async () => {
  const b = wav(); const s = setup({ '/a.wav': b })
  const r = await addToMusic(base(s.lib, b), s.deps)
  assert.deepEqual(r, { ok: true, trackId: 't1', already: false }); assert.deepEqual(s.imported, ['/a.wav'])
})
test('refuses missing, undecodable, and changed files', async () => {
  const b = wav(); let s = setup({})
  assert.equal((await addToMusic(base(s.lib, b), s.deps)).ok, false)
  s = setup({ '/a.wav': new Uint8Array(100) })
  assert.equal((await addToMusic(base(s.lib, b), s.deps)).ok, false)
  s = setup({ '/a.wav': b })
  const r = await addToMusic({ ...base(s.lib, b), sha256: 'f'.repeat(64) }, s.deps)
  assert.equal(r.ok, false); assert.equal(s.imported.length, 0)
})
test('duplicate by path and by hash is not imported again', async () => {
  const b = wav(); let s = setup({ '/a.wav': b }, [{ id: 'x', file: '/A.wav' }])
  assert.deepEqual(await addToMusic(base(s.lib, b), s.deps), { ok: true, trackId: 'x', already: true })
  s = setup({ '/a.wav': b, '/copy.wav': b }, [{ id: 'y', file: '/copy.wav' }])
  assert.deepEqual(await addToMusic(base(s.lib, b), s.deps), { ok: true, trackId: 'y', already: true })
  assert.equal(s.imported.length, 0)
})
test('same prefix but different audio is not a duplicate', async () => {
  const b = wav(); const o = wav(); o[o.length - 1] ^= 1
  const s = setup({ '/a.wav': b, '/o.wav': o }, [{ id: 'z', file: '/o.wav' }])
  s.lib.fingerprint = async () => 'same'
  const r = await addToMusic(base(s.lib, b), s.deps)
  assert.equal(r.ok && r.already, false)
})
test('library exceptions become a reason', async () => {
  const b = wav(); const s = setup({ '/a.wav': b })
  s.lib.importFile = async () => { throw new Error('boom') }
  assert.deepEqual(await addToMusic(base(s.lib, b), s.deps), { ok: false, reason: 'boom' })
})
test('registerWithFiles', async () => {
  const b = wav(); const s = setup({ '/a.wav': b }); const calls: any[] = []
  const catalog = { registerGenerated: (g: any) => { calls.push(g); return 'g1' } }
  const inp = { catalog, artifactPath: '/a.wav', sha256: sha(b), projectTitle: 'P', versionName: 'V', engine: 'ace-step' }
  assert.deepEqual(await registerWithFiles(inp, s.deps), { ok: true, trackId: 'g1' })
  assert.equal(calls[0].generator, 'neurova:ace-step')
  assert.equal((await registerWithFiles({ ...inp, catalog: null }, s.deps)).ok, false)
  assert.deepEqual(await registerWithFiles({ ...inp, alreadyRegistered: () => true }, s.deps), { ok: true, already: true })
  assert.equal((await registerWithFiles({ ...inp, sha256: '0'.repeat(64) }, s.deps)).ok, false)
  assert.equal(calls.length, 1)
})
test('describeMusicApi lists real functions', () => { assert.ok(describeMusicApi().length >= 3) })
