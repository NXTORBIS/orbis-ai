import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ARTIFACT_KINDS, ARTIFACT_KIND_IDS, canWrite, defaultFormatFor, describeKinds, extensionFor, isArtifactKindId, kindById } from './kinds.ts'
import { FORMATS } from '../compute/interchange.ts'

/*
 * The table is the only answer to "what can Orbis create", so the test is about its honesty: every format it lists
 * as writable must have a writer the format registry agrees exists, and the stored format must be one of them.
 */

test('every format a kind writes is one the format registry can export', () => {
  for (const id of ARTIFACT_KIND_IDS) {
    const kind = ARTIFACT_KINDS[id]
    assert.ok(kind.writes.length > 0, `${id} writes nothing, so it cannot be created`)
    for (const format of kind.writes) {
      assert.equal(FORMATS[format].canExport, true, `${id} claims to write ${format}, which the registry says it cannot export`)
    }
    assert.ok(kind.writes.includes(kind.stores), `${id} is stored as ${kind.stores}, which it cannot write`)
    for (const format of kind.reads) {
      assert.equal(FORMATS[format].canImport, true, `${id} claims to read ${format}, which the registry says it cannot import`)
    }
  }
})

test('a kind is found by its id and nothing else', () => {
  assert.equal(kindById('table')?.name, 'Table')
  assert.equal(kindById('constructor'), null)
  assert.equal(kindById('toString'), null)
  assert.equal(kindById(undefined), null)
  assert.equal(isArtifactKindId('hasOwnProperty'), false)
})

test('writability is answered by the table, not by the format alone', () => {
  assert.equal(canWrite('table', 'csv'), true)
  assert.equal(canWrite('document', 'csv'), false)
  assert.equal(canWrite('document', 'html'), true)
  // XML is a format the registry knows, and until there is a writer no kind may claim it.
  assert.equal(canWrite('document', 'xml'), false)
  assert.equal(canWrite('table', 'xml'), false)
  assert.equal(defaultFormatFor('table'), 'csv')
  assert.equal(extensionFor('csv'), '.csv')
})

test('the description is built from the table and carries each format limitations', () => {
  const kinds = describeKinds()
  assert.deepEqual(kinds.map((one) => one.id), ARTIFACT_KIND_IDS)
  const table = kinds.find((one) => one.id === 'table')
  assert.ok(table)
  const csv = table.writes.find((one) => one.format === 'csv')
  assert.ok(csv)
  assert.equal(csv.extension, '.csv')
  assert.ok(csv.limitations.some((one) => /unit/i.test(one)), 'CSV should say it cannot hold units')
})
