import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDataError, parseDelimited } from '../../shared/compute/data.ts'
import { emptyDocument, fromMarkdown, isDocumentError } from '../../shared/compute/document.ts'
import { isReadForChat, nameToOpenAs, readForChat } from './attaching.ts'
import { importFile } from './importing.ts'
import { writeDocx, writeXlsx } from './office.ts'

const workbook = async (csv: string, title = 'Sales'): Promise<Uint8Array> => {
  const parsed = parseDelimited(csv, { source: 'test' })
  if (isDataError(parsed)) throw new Error(parsed.message)
  return (await writeXlsx(parsed.table, title)).bytes
}

test('a workbook attached to the chat arrives as its rows, and opens again as the same table', async () => {
  const bytes = await workbook('Month,Units,Revenue\nJanuary,12,1200\nFebruary,18,1800\nMarch,15,1500\n')
  const read = await readForChat('sales.xlsx', bytes, 200_000)
  if ('error' in read) throw new Error(read.message)
  assert.equal(read.mimeType, 'text/csv')
  assert.equal(read.content.trim(), 'Month,Units,Revenue\nJanuary,12,1200\nFebruary,18,1800\nMarch,15,1500')
  assert.match(read.notes[0], /Read from the Excel workbook by Orbis: 3 rows and 3 columns\./)

  // Made into an artifact later, it is opened as the rows it now is, under the name it came with.
  const name = nameToOpenAs('sales.xlsx', read.mimeType)
  assert.equal(name, 'sales.csv')
  const opened = await importFile(name, new TextEncoder().encode(read.content))
  if ('error' in opened) throw new Error(opened.message)
  assert.equal(opened.title, 'sales')
  assert.ok(opened.body.kind === 'table')
  if (opened.body.kind !== 'table') return
  assert.equal(opened.body.table.rows.length, 3)
  assert.deepEqual(opened.body.table.columns.map((one) => `${one.name}:${one.type}`), ['Month:text', 'Units:integer', 'Revenue:integer'], 'numbers are numbers again')
})

test('a Word file arrives as its words, and a file with nothing readable in it is refused with the reason', async () => {
  const parsed = fromMarkdown('# Plan\n\nShip it on **Friday**.\n\n- one\n- two\n', 'p')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const document = emptyDocument('d', 'Plan')
  document.blocks = parsed.blocks
  const bytes = (await writeDocx(document)).bytes
  const read = await readForChat('plan.docx', bytes, 200_000)
  if ('error' in read) throw new Error(read.message)
  assert.equal(read.mimeType, 'text/markdown')
  assert.match(read.content, /# Plan/)
  assert.match(read.content, /Ship it on \*\*Friday\*\*\./)
  assert.match(read.notes[0], /Read from the Word document by Orbis\./)
  assert.equal(nameToOpenAs('plan.docx', read.mimeType), 'plan.md')

  const broken = await readForChat('broken.xlsx', new Uint8Array([1, 2, 3, 4, 5]), 200_000)
  assert.ok('error' in broken)
  const notPdf = await readForChat('scan.pdf', new TextEncoder().encode('%PDF-1.4\nnot really a pdf'), 200_000)
  assert.ok('error' in notPdf, 'a PDF that cannot be read is refused, not attached as nothing')
})

test('a workbook longer than a message holds is cut at the end of a row, and says how many rows are not there', async () => {
  const rows = Array.from({ length: 400 }, (_, i) => `row ${i},${i},${i * 10}`).join('\n')
  const bytes = await workbook(`Name,N,Value\n${rows}\n`)
  const read = await readForChat('big.xlsx', bytes, 2_000)
  if ('error' in read) throw new Error(read.message)
  assert.ok(read.content.length <= 2_000)
  const lines = read.content.split('\n')
  assert.match(lines[lines.length - 1], /^row \d+,\d+,\d+$/, 'the last line is a whole row')
  const kept = lines.length - 1
  assert.ok(read.notes.some((one) => one === `It is longer than one message holds: the last ${(400 - kept).toLocaleString('en')} rows are not attached.`), read.notes.join(' | '))
})

test('only the four file types are read this way; everything else keeps its own name', () => {
  assert.equal(isReadForChat('a.XLSX'), true)
  assert.equal(isReadForChat('a.docx'), true)
  assert.equal(isReadForChat('a.pdf'), true)
  assert.equal(isReadForChat('a.csv'), false)
  assert.equal(isReadForChat('a.pptx'), true)
  assert.equal(isReadForChat('a.key'), false)
  assert.equal(nameToOpenAs('notes.txt', 'text/markdown'), 'notes.txt')
  assert.equal(nameToOpenAs('sales.xlsx', undefined), 'sales.xlsx')
})
