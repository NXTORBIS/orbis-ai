import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDelivery, pruneApprovals, setApproval, stateOf, versionState, type ApprovalRecord } from './approval.ts'

const A = 'a'.repeat(64); const B = 'b'.repeat(64)
test('default draft and valid moves', () => {
  assert.equal(stateOf({}, A), 'draft')
  const r = setApproval({}, A, 'approved', 5, 'me')
  assert.ok(r.ok && r.record[A].state === 'approved')
  assert.equal(setApproval({}, A, 'exported', 5).ok, false)
  assert.equal(setApproval({}, 'bad', 'review', 5).ok, false)
})
test('approval stays with the audio, not the version', () => {
  const rec: ApprovalRecord = { [A]: { state: 'approved', at: 1 } }
  const v = { artifactId: 'x' }
  assert.equal(versionState(rec, v, [{ id: 'x', sha256: A }]), 'approved')
  assert.equal(versionState(rec, v, [{ id: 'x', sha256: B }]), 'draft')
  assert.deepEqual(Object.keys(pruneApprovals(rec, [B])), [])
})
test('delivery checks', () => {
  const ok = { sourceExists: true, decodable: true, metadataTitle: 'T', destinationWritable: true, formatSupported: true }
  assert.deepEqual(checkDelivery(ok), { blocking: [], warnings: [] })
  const bad = checkDelivery({ ...ok, sourceExists: false, metadataTitle: ' ', formatSupported: false })
  assert.equal(bad.blocking.length, 2); assert.equal(bad.warnings.length, 1)
})
