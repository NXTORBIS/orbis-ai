import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDelimited, isDataError } from '../compute/data.ts'
import { emptyDocument, fromMarkdown, isDocumentError } from '../compute/document.ts'
import { exportDocument, exportTable, isInterchangeError } from '../compute/interchange.ts'
import { verifyDocumentFile, verifyTableFile } from './validate.ts'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

const table = () => {
  const parsed = parseDelimited('name,age\nalice,30\nbob,41\n')
  if (isDataError(parsed)) throw new Error(parsed.message)
  return parsed.table
}

test('a table file that is exactly what was written passes every named check', () => {
  const original = table()
  const rendered = exportTable(original, { format: 'csv' })
  if (isInterchangeError(rendered)) throw new Error(rendered.message)
  const result = verifyTableFile(original, rendered, encode(rendered.text))
  assert.equal(result.ok, true)
  assert.deepEqual(result.checks.map((one) => one.what), ['written', 'checksum', 'checksum', 'size', 'round trip'])
  assert.deepEqual(result.reimported, { rows: 2, columns: 2 })
})

test('one byte changed on disk fails the checksum, and says so', () => {
  const original = table()
  const rendered = exportTable(original, { format: 'csv' })
  if (isInterchangeError(rendered)) throw new Error(rendered.message)
  const bytes = encode(rendered.text)
  bytes[bytes.length - 2] = 0x58
  const result = verifyTableFile(original, rendered, bytes)
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'checksum')?.passed, false)
  assert.equal(result.checks.find((one) => one.what === 'written')?.passed, true)
})

test('a truncated file fails on size and on the round trip', () => {
  const original = table()
  const rendered = exportTable(original, { format: 'csv' })
  if (isInterchangeError(rendered)) throw new Error(rendered.message)
  const result = verifyTableFile(original, rendered, encode(rendered.text.slice(0, 12)))
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'written')?.passed, false)
  assert.ok(result.differences.some((one) => /Row count/.test(one)))
})

test('a date leaves as a date, not as the number it is held as, and still round-trips', () => {
  const parsed = parseDelimited('date,when,amount\n2026-10-01,2026-10-01T10:30:00Z,12.50\n2026-10-02,2026-10-02T00:00:00Z,40\n')
  if (isDataError(parsed)) throw new Error(parsed.message)
  assert.equal(parsed.table.columns[0].type, 'date')
  const csv = exportTable(parsed.table, { format: 'csv' })
  if (isInterchangeError(csv)) throw new Error(csv.message)
  assert.ok(csv.text.includes('2026-10-01,2026-10-01T10:30:00.000Z,12.5'), csv.text)
  assert.ok(csv.text.includes('2026-10-02,2026-10-02,40'), 'a midnight time leaves as the date alone')
  assert.equal(csv.text.includes('1790812800000'), false)
  const json = exportTable(parsed.table, { format: 'json' })
  if (isInterchangeError(json)) throw new Error(json.message)
  assert.ok(json.text.includes('"date": "2026-10-01"'), json.text)
  // Read back from disk, the column is still a date and nothing is reported as changed.
  const result = verifyTableFile(parsed.table, csv, encode(csv.text))
  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.deepEqual(result.differences, [])
})

test('a document file reads back with the same number of blocks', () => {
  const parsed = fromMarkdown('# Title\n\nA paragraph.\n\n- one\n- two\n', 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const document = emptyDocument('d', 'Title')
  document.blocks = parsed.blocks
  const rendered = exportDocument(document, 'markdown')
  if (isInterchangeError(rendered)) throw new Error(rendered.message)
  const result = verifyDocumentFile(document.blocks.length, rendered, encode(rendered.text))
  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.equal(result.reimported?.rows, document.blocks.length)
})
