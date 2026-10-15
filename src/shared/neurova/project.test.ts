import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectWav } from './audio.ts'
import { addVersion, compareArtifacts, newProject, normalizeProject, removeVersion, restoreVersion, safeFileName, safeRelative, type Artifact } from './project.ts'

function wav(samples: number[], rate = 8000, bits: 16 | 32 = 16): Uint8Array {
  const step = bits / 8
  const b = new Uint8Array(44 + samples.length * step)
  const v = new DataView(b.buffer)
  const w = (o: number, s: string): void => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i) }
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * step, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * step, true); v.setUint16(32, step, true); v.setUint16(34, bits, true)
  w(36, 'data'); v.setUint32(40, samples.length * step, true)
  samples.forEach((s, i) => (bits === 16 ? v.setInt16(44 + i * 2, Math.round(s * 32767), true) : v.setFloat32(44 + i * 4, s, true)))
  return b
}

test('a real tone is measured from its samples', () => {
  const s = Array.from({ length: 8000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 8000))
  const r = inspectWav(wav(s))
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.info.durationSec, 1)
  assert.ok(Math.abs(r.info.peak - 0.5) < 0.01)
  assert.ok(Math.abs(r.info.rms - 0.5 / Math.SQRT2) < 0.01)
  assert.equal(r.info.clippedSamples, 0)
  assert.deepEqual(r.info.lowEnergy, [])
})

test('clipping, silence and a truncated file are reported, not hidden', () => {
  const loud = inspectWav(wav(Array.from({ length: 8000 }, () => 1)))
  assert.ok(loud.ok && loud.info.clippedSamples > 0)
  const quiet = inspectWav(wav([...Array(8000).fill(0.5), ...Array(24000).fill(0)]))
  assert.ok(quiet.ok && quiet.info.lowEnergy.length === 1 && quiet.info.lowEnergy[0].startSec >= 0.99)
  const cut = wav(Array(8000).fill(0.3)).slice(0, 4000)
  const t = inspectWav(cut)
  assert.ok(t.ok && t.info.warnings.some((w) => /truncated/.test(w)))
})

test('things that are not audio are refused with a reason', () => {
  assert.equal(inspectWav(new Uint8Array(10)).ok, false)
  const bad = wav([0.1, 0.2, 0.3])
  bad[0] = 0
  assert.equal(inspectWav(bad).ok, false)
  assert.equal(inspectWav(wav([])).ok, false)
})

const art = (id: string, sha: string, dur = 1): Artifact => ({ id, file: `audio/${id}.wav`, sha256: sha, bytes: 10, durationSec: dur, sampleRate: 8000, channels: 1, bitDepth: 16, source: 'imported', createdAt: 1 })

test('versions only ever add; restoring never deletes later work', () => {
  let p = newProject('p', ' My song ', 'a brief')
  p = addVersion(p, { versionId: 'v1', artifact: art('a1', 'h1') })
  p = addVersion(p, { versionId: 'v2', artifact: art('a2', 'h2'), note: 'warmer' })
  assert.equal(p.versions[1].parentId, 'v1')
  p = restoreVersion(p, 'v1', 'v3')
  assert.equal(p.versions.length, 3)
  assert.equal(p.versions[2].artifactId, 'a1')
  assert.equal(p.selectedVersionId, 'v3')
  assert.equal(p.brief, 'a brief')
})

test('the same audio is stored once, and only unused audio is orphaned', () => {
  let p = newProject('p', 'x')
  p = addVersion(p, { versionId: 'v1', artifact: art('a1', 'same') })
  p = addVersion(p, { versionId: 'v2', artifact: art('a2', 'same') })
  assert.equal(p.artifacts.length, 1)
  p = addVersion(p, { versionId: 'v3', artifact: art('a3', 'other') })
  const r = removeVersion(p, 'v3')
  assert.deepEqual(r.orphaned.map((a) => a.id), ['a3'])
  const r2 = removeVersion(p, 'v1')
  assert.deepEqual(r2.orphaned, [])
})

test('stored data cannot point outside the project or at missing audio', () => {
  const p = normalizeProject({ id: 'p', artifacts: [{ id: 'a', file: '../../x.wav' }, { id: 'b', file: 'audio/b.wav' }], versions: [{ id: 'v', artifactId: 'a' }, { id: 'w', artifactId: 'b' }] })
  assert.ok(p)
  assert.deepEqual(p!.artifacts.map((a) => a.id), ['b'])
  assert.deepEqual(p!.versions.map((v) => v.id), ['w'])
  assert.equal(safeRelative('audio/ok.wav'), true)
  assert.equal(safeRelative('C:\\x.wav'), false)
  assert.equal(safeRelative('a/../b'), false)
})

test('file names are safe and differences are real', () => {
  assert.equal(safeFileName('a/b:c?', 'WAV'), 'a_b_c_.wav')
  assert.equal(safeFileName('CON', 'wav'), 'song-CON.wav')
  assert.deepEqual(compareArtifacts(art('a', 'x', 1), art('b', 'y', 2)).map((d) => d.field), ['duration'])
})
