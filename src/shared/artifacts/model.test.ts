import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isArtifactId, isArtifactRecord, makeArtifactId, refOf, type ArtifactRecord } from './model.ts'

const HEX = 'a'.repeat(32)

test('an id is exactly the prefix and 32 hexadecimal characters', () => {
  assert.equal(makeArtifactId(HEX), `artifact_${HEX}`)
  assert.equal(makeArtifactId(HEX.toUpperCase()), `artifact_${HEX}`)
  assert.throws(() => makeArtifactId('abc'), /32 hexadecimal/)
  assert.equal(isArtifactId(`artifact_${HEX}`), true)
  assert.equal(isArtifactId(`artifact_${HEX}x`), false)
  assert.equal(isArtifactId('../artifact_' + HEX), false)
  assert.equal(isArtifactId(42), false)
})

const record = (): ArtifactRecord => ({
  artifactId: makeArtifactId(HEX),
  kind: 'table',
  title: 'T',
  createdAt: 1,
  updatedAt: 1,
  format: 'json',
  file: 'content.json',
  bytes: 3,
  hash: 'h',
  loss: { lossy: false, losses: [], carries: { units: true, types: true, metadata: true, formatting: false, provenance: true, hierarchy: true } },
  verified: { ok: true, checks: [], reimported: null, differences: [] },
  source: 'pasted',
  shape: { rows: 1, columns: 1 },
  tags: []
})

test('a record read from disk is accepted field by field', () => {
  assert.equal(isArtifactRecord(record()), true)
  assert.equal(isArtifactRecord({ ...record(), artifactId: 'nope' }), false)
  assert.equal(isArtifactRecord({ ...record(), verified: {} }), false)
  assert.equal(isArtifactRecord({ ...record(), tags: 'x' }), false)
  assert.equal(isArtifactRecord(null), false)
})

test('a ref carries the handle and nothing that could be content', () => {
  const ref = refOf(record())
  assert.deepEqual(Object.keys(ref).sort(), ['artifactId', 'bytes', 'format', 'hash', 'kind', 'title', 'verified'])
  assert.equal(ref.verified, true)
})
