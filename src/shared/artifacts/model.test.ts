import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isArtifactId, isArtifactRecord, isVersionId, makeArtifactId, makeVersionId, readRecord, refOf, summaryOf, type ArtifactRecord } from './model.ts'

const HEX = 'a'.repeat(32)

test('an id is exactly the prefix and 32 hexadecimal characters', () => {
  assert.equal(makeArtifactId(HEX), `artifact_${HEX}`)
  assert.equal(makeArtifactId(HEX.toUpperCase()), `artifact_${HEX}`)
  assert.throws(() => makeArtifactId('abc'), /32 hexadecimal/)
  assert.equal(isArtifactId(`artifact_${HEX}`), true)
  assert.equal(isArtifactId(`artifact_${HEX}x`), false)
  assert.equal(isArtifactId('../artifact_' + HEX), false)
  assert.equal(isArtifactId(42), false)
  assert.equal(makeVersionId(HEX), `v${HEX}`)
  assert.equal(isVersionId(`v${HEX}`), true)
  assert.equal(isVersionId('../v'), false)
})

const record = (): ArtifactRecord => ({
  artifactId: makeArtifactId(HEX),
  versionId: makeVersionId('b'.repeat(32)),
  version: 3,
  versions: [],
  reason: 'changed',
  derivedFrom: null,
  kind: 'table',
  title: 'T',
  createdAt: 1,
  updatedAt: 9,
  format: 'json',
  file: 'content.json',
  bytes: 3,
  hash: 'h',
  loss: { lossy: false, losses: [], carries: { units: true, types: true, metadata: true, formatting: false, provenance: true, hierarchy: true } },
  verified: { ok: true, checks: [], reimported: null, differences: [] },
  source: 'pasted',
  shape: { rows: 1, columns: 1 },
  tags: [],
  notes: []
})

test('a record read from disk is accepted field by field', () => {
  assert.equal(isArtifactRecord(record()), true)
  assert.equal(isArtifactRecord({ ...record(), artifactId: 'nope' }), false)
  assert.equal(isArtifactRecord({ ...record(), verified: {} }), false)
  assert.equal(isArtifactRecord({ ...record(), tags: 'x' }), false)
  assert.equal(isArtifactRecord(null), false)
})

test('a record from before versions existed is brought forward, not refused', () => {
  const old = record() as unknown as Record<string, unknown>
  delete old.versionId
  delete old.version
  delete old.versions
  delete old.reason
  delete old.derivedFrom
  old.hash = '20ed6ef8d297a1b2'
  const read = readRecord(old)
  assert.ok(read)
  assert.equal(read.version, 1)
  assert.equal(read.versionId, 'v20ed6ef8d297a1b20000000000000000')
  assert.deepEqual(read.versions, [])
  assert.equal(read.reason, '')
  assert.equal(read.derivedFrom, null)
  // A version list with something broken in it keeps the good entries.
  const mixed = readRecord({ ...record(), versions: [{ versionId: 'v' + 'c'.repeat(32), version: 1, createdAt: 1, file: 'content.json', hash: 'x', reason: '', format: 'json', bytes: 1, shape: { rows: 0, columns: 0 } }, { nope: true }] })
  assert.equal(mixed?.versions.length, 1)
})

test('a ref carries the handle and nothing that could be content, and a summary is what a version is listed as', () => {
  const ref = refOf(record())
  assert.deepEqual(Object.keys(ref).sort(), ['artifactId', 'bytes', 'format', 'hash', 'kind', 'title', 'verified', 'version', 'versionId'])
  assert.equal(ref.verified, true)
  const summary = summaryOf(record())
  assert.equal(summary.version, 3)
  assert.equal(summary.reason, 'changed')
  assert.equal(summary.createdAt, 9)
})
