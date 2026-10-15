import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditRequirements, diagnostics, dismiss } from './audit.ts'
import type { Requirement, Evidence } from './audit.ts'
import type { AudioInfo } from './audio.ts'

const req = (o: Partial<Requirement> & { id: string }): Requirement =>
  ({ text: 'a request', kind: 'verifiable', explicit: true, conditioned: false, ...o })
const status = (r: Requirement[], e: Evidence[], i = 0) => auditRequirements(r, e)[i]

test('reliable measurement of a verifiable requirement is verified', () => {
  const a = status([req({ id: 'a', text: 'about 30 seconds' })],
    [{ requirementId: 'a', source: 'measurement', value: '30.1 s', reliability: 'high', matches: true }])
  assert.equal(a.status, 'verified')
  assert.match(a.explanation, /You asked for/)
  assert.match(a.explanation, /Measured/)
  assert.match(a.explanation, /does not prove/)
})

test('conditioning-only is never verified', () => {
  for (const r of [req({ id: 'a', kind: 'conditioning' }), req({ id: 'a', kind: 'verifiable', conditioned: true })]) {
    const a = status([r], [{ requirementId: 'a', source: 'estimate', value: 'x', reliability: 'high', matches: true }])
    assert.notEqual(a.status, 'verified')
  }
  const k = status([req({ id: 'a', kind: 'conditioning' })],
    [{ requirementId: 'a', source: 'measurement', value: 'x', reliability: 'high', matches: true }])
  assert.notEqual(k.status, 'verified')
  assert.equal(status([req({ id: 'a', kind: 'conditioning' })], []).status, 'not-verified')
})

test('subjective needs listening unless the user judged', () => {
  const r = [req({ id: 'a', kind: 'subjective' })]
  assert.equal(status(r, []).status, 'requires-listening')
  assert.equal(status(r, [{ requirementId: 'a', source: 'measurement', value: 1, reliability: 'high', matches: true }]).status, 'requires-listening')
  assert.equal(status(r, [{ requirementId: 'a', source: 'user', value: 'good', reliability: 'high', userVerdict: 'confirmed' }]).status, 'user-confirmed')
  assert.equal(status(r, [{ requirementId: 'a', source: 'user', value: 'bad', reliability: 'high', userVerdict: 'rejected' }]).status, 'user-rejected')
})

test('low-reliability estimate is only likely-consistent or potential-mismatch', () => {
  const r = [req({ id: 'a' })]
  const yes = status(r, [{ requirementId: 'a', source: 'estimate', value: 'C major', reliability: 'low', matches: true }])
  const no = status(r, [{ requirementId: 'a', source: 'estimate', value: 'D minor', reliability: 'low', matches: false }])
  assert.equal(yes.status, 'likely-consistent')
  assert.equal(no.status, 'potential-mismatch')
  const hi = status(r, [{ requirementId: 'a', source: 'estimate', value: 'C major', reliability: 'high', matches: true }])
  assert.equal(hi.status, 'likely-consistent')
})

test('low reliability measurement cannot verify', () => {
  const a = status([req({ id: 'a' })], [{ requirementId: 'a', source: 'measurement', value: 1, reliability: 'low', matches: true }])
  assert.equal(a.status, 'likely-consistent')
})

test('unsupported, no evidence, and uncompared', () => {
  assert.equal(status([req({ id: 'a', kind: 'unsupported' })], []).status, 'unsupported')
  assert.equal(status([req({ id: 'a' })], []).status, 'not-verified')
  assert.equal(status([req({ id: 'a' })], [{ requirementId: 'a', source: 'measurement', value: 1, reliability: 'high' }]).status, 'not-verified')
})

const info = (o: Partial<AudioInfo> = {}): AudioInfo => ({
  container: 'wav', sampleRate: 44100, channels: 2, bitDepth: 16, float: false, frames: 441000, durationSec: 10,
  peak: 0.5, rms: 0.1, clippedSamples: 0, lowEnergy: [], lowEnergyThresholdDb: -60, warnings: [], ...o,
})

test('clean file has no diagnostics', () => {
  assert.deepEqual(diagnostics(info()), [])
})

test('diagnostics use measured fields only', () => {
  const d = diagnostics(info({
    clippedSamples: 500, durationSec: 0.5, peak: 0,
    lowEnergy: [{ startSec: 1, endSec: 3 }], warnings: ['Data chunk is shorter than declared (truncated).'],
  }))
  const ids = d.map((x) => x.id).sort()
  assert.deepEqual(ids, ['clipping', 'quiet-stretches', 'silent', 'truncated', 'very-short'].sort())
  assert.ok(d.every((x) => x.dismissed === false && x.evidence.length > 0 && x.suggestion.length > 0))
  assert.equal(d.find((x) => x.id === 'clipping')!.severity, 'warning')
  assert.match(d.find((x) => x.id === 'clipping')!.evidence, /500/)
})

test('dismiss keeps the measurement', () => {
  const d = diagnostics(info({ clippedSamples: 3 }))
  const e = dismiss(d, 'clipping')
  assert.equal(e[0].dismissed, true)
  assert.deepEqual(e[0].measurement, d[0].measurement)
  assert.equal(e[0].evidence, d[0].evidence)
  assert.equal(d[0].dismissed, false)
})
