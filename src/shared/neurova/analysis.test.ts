import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateKey, estimateSections, truePeakDb, loudnessLufsApprox, endingKind, cacheKey, isStale, fft } from './analysis.ts'
import type { Decoded } from './wav.ts'

const R = 22050
function synth(sec: number, f: (t: number) => number, rate = R): Decoded {
  const n = Math.floor(sec * rate)
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) c[i] = f(i / rate)
  return { sampleRate: rate, channels: [c] }
}
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)
const tone = (m: number, t: number, a = 0.2) => a * (Math.sin(2 * Math.PI * hz(m) * t) + 0.4 * Math.sin(4 * Math.PI * hz(m) * t))
let seed = 1
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1

test('fft finds a sine bin', () => {
  const N = 256, re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < N; i++) re[i] = Math.sin((2 * Math.PI * 10 * i) / N)
  fft(re, im)
  let best = 0
  for (let k = 1; k < N / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k
  assert.equal(best, 10)
})

test('C major triad -> C major', () => {
  const r = estimateKey(synth(10, (t) => tone(60, t) + tone(64, t) + tone(67, t)))
  assert.ok(r.ok)
  if (r.ok) { assert.equal(r.key, 'C major'); assert.ok(r.limitations.length > 0) }
})

test('A minor melody -> A minor', () => {
  const seq = [57, 59, 60, 62, 64, 65, 67, 69, 57, 60, 64, 60, 57, 64, 57, 60]
  const r = estimateKey(synth(16, (t) => tone(seq[Math.floor(t / 0.5) % seq.length], t) + 0.5 * tone(57, t)))
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.key, 'A minor')
})

test('white noise is refused or low', () => {
  const r = estimateKey(synth(10, () => 0.3 * rnd()))
  assert.ok(!r.ok || r.reliability === 'low')
})

test('key refuses silence and tiny input', () => {
  assert.equal(estimateKey(synth(10, () => 0)).ok, false)
  assert.equal(estimateKey(synth(1, (t) => tone(60, t))).ok, false)
})

test('sections: timbre and level changes at 20s and 45s', () => {
  const d = synth(70, (t) => {
    if (t < 20) return 0.1 * Math.sin(2 * Math.PI * 220 * t)
    if (t < 45) return 0.4 * (Math.sin(2 * Math.PI * 880 * t) + 0.5 * Math.sin(2 * Math.PI * 2640 * t))
    return 0.05 * Math.sin(2 * Math.PI * 110 * t)
  })
  const r = estimateSections(d)
  assert.ok(r.ok)
  if (!r.ok) return
  const ts = r.boundaries.map((b) => b.timeSec)
  assert.ok(ts.some((t) => Math.abs(t - 20) < 1.5), `got ${ts}`)
  assert.ok(ts.some((t) => Math.abs(t - 45) < 1.5), `got ${ts}`)
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 8)
  assert.ok(ts.every((t) => t > 0 && t < 70))
  assert.ok(r.boundaries.every((b) => b.label === 'boundary'))
})

test('sections: steady tone has none; short is refused', () => {
  const r = estimateSections(synth(40, (t) => 0.2 * Math.sin(2 * Math.PI * 330 * t)))
  assert.ok(r.ok && r.boundaries.length === 0)
  assert.equal(estimateSections(synth(5, () => 0.1)).ok, false)
})

test('true peak exceeds sample peak for a phase-offset fs/4 sine', () => {
  const d = synth(1, (t) => Math.sin(2 * Math.PI * (R / 4) * t + Math.PI / 4))
  const r = truePeakDb(d)
  assert.ok(r.ok)
  if (r.ok) {
    assert.ok(r.truePeakDb > r.samplePeakDb + 1.5, `${r.truePeakDb} vs ${r.samplePeakDb}`)
    assert.ok(Math.abs(r.truePeakDb) < 0.5)
  }
})

test('true peak never below sample peak', () => {
  const r = truePeakDb(synth(0.5, () => 0.5))
  assert.ok(r.ok && r.truePeakDb >= r.samplePeakDb - 1e-9)
})

test('loudness: 0.1-amplitude 1 kHz sine near -23.7 LUFS, flagged approximate', () => {
  const r = loudnessLufsApprox(synth(5, (t) => 0.1 * Math.sin(2 * Math.PI * 1000 * t), 48000))
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.approximate, true)
    assert.ok(Math.abs(r.lufs - -23.7) < 1.0, `${r.lufs}`)
  }
})

test('loudness: silence refused', () => {
  assert.equal(loudnessLufsApprox(synth(3, () => 0)).ok, false)
})

test('endings', () => {
  const body = (t: number) => 0.4 * Math.sin(2 * Math.PI * 300 * t)
  const fade = endingKind(synth(8, (t) => body(t) * (t > 5 ? Math.max(0, 1 - (t - 5) / 3) ** 2 : 1)))
  assert.ok(fade.ok && fade.kind === 'fade', JSON.stringify(fade))
  const abrupt = endingKind(synth(8, body))
  assert.ok(abrupt.ok && abrupt.kind === 'abrupt', JSON.stringify(abrupt))
  const sil = endingKind(synth(8, (t) => (t < 5 ? body(t) : 0)))
  assert.ok(sil.ok && sil.kind === 'sustained-silence')
  assert.equal(endingKind(synth(0.5, body)).ok, false)
})

test('cacheKey stable and staleness', () => {
  const a = cacheKey({ sha256: 'abc', analyzer: 'key', version: 2, params: { b: 1, a: [1, { y: 1, x: 2 }] } })
  const b = cacheKey({ sha256: 'abc', analyzer: 'key', version: 2, params: { a: [1, { x: 2, y: 1 }], b: 1 } })
  assert.equal(a, b)
  assert.notEqual(a, cacheKey({ sha256: 'abd', analyzer: 'key', version: 2, params: { b: 1 } }))
  const rec = { sha256: 'abc', analyzer: 'key', version: 2 }
  assert.equal(isStale(rec, 'abc', 2), false)
  assert.equal(isStale(rec, 'abc', 3), true)
  assert.equal(isStale(rec, 'zzz', 2), true)
  assert.equal(isStale(null, 'abc', 2), true)
})
