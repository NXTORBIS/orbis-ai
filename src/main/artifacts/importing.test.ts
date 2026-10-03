import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDataError, parseDelimited } from '../../shared/compute/data.ts'
import { emptyDocument, fromMarkdown, isDocumentError } from '../../shared/compute/document.ts'
import { importFile } from './importing.ts'
import { writeDocx, writePptx, writeXlsx } from './office.ts'

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const body = async (name: string, bytes: Uint8Array) => {
  const out = await importFile(name, bytes)
  if ('error' in out) throw new Error(`${out.error}: ${out.message}`)
  return out
}

test('a CSV comes in as a table with the parser decisions in the notes', async () => {
  const out = await body('readings.csv', encode('date,site,mwh\n2026-10-01,HQ,412\n2026-10-02,Depot,288\n'))
  assert.equal(out.body.kind, 'table')
  if (out.body.kind !== 'table') return
  assert.equal(out.body.table.rows.length, 2)
  assert.equal(out.body.table.columns[0].type, 'date')
  assert.equal(out.title, 'readings')
  assert.equal(out.source, 'file: readings.csv')
  assert.equal(out.format, 'csv')
})

test('JSON rows come in as a table, flattened and said so', async () => {
  const out = await body('people.json', encode('[{"name":"a","age":30,"address":{"city":"x"}},{"name":"b","age":41,"address":{"city":"y"}}]'))
  assert.equal(out.body.kind, 'table')
  if (out.body.kind !== 'table') return
  assert.deepEqual(out.body.table.columns.map((one) => one.name), ['name', 'age', 'address.city'])
  assert.ok(out.notes.some((one) => /flattened/.test(one)))
})

test('Markdown comes in as a document titled from its first heading', async () => {
  const out = await body('notes.md', encode('# Field notes\n\nFirst.\n\n- a\n- b\n'))
  assert.equal(out.body.kind, 'document')
  assert.equal(out.title, 'Field notes')
  if (out.body.kind === 'document') assert.equal(out.body.document.blocks.length, 3)
})

test('plain text comes in as paragraphs', async () => {
  const out = await body('plain.txt', encode('One paragraph\nstill one.\n\nTwo.\n'))
  assert.equal(out.body.kind, 'document')
  if (out.body.kind === 'document') assert.equal(out.body.document.blocks.length, 2)
})

test('a workbook Orbis wrote comes back as the same table', async () => {
  const parsed = parseDelimited('date,site,mwh,ok\n2026-10-01,HQ,412.5,true\n2026-10-02,Depot,288,false\n')
  if (isDataError(parsed)) throw new Error(parsed.message)
  const made = await writeXlsx(parsed.table, 'Readings')
  const out = await body('Readings.xlsx', made.bytes)
  assert.equal(out.body.kind, 'table')
  if (out.body.kind !== 'table') return
  assert.deepEqual(out.body.table.columns.map((one) => `${one.name}:${one.type}`), ['date:date', 'site:text', 'mwh:number', 'ok:boolean'])
  assert.equal(out.body.table.rows.length, 2)
  assert.ok(out.notes.some((one) => /sheet "Readings"/.test(one)))
})

test('a Word document Orbis wrote comes back with its headings, lists and table', async () => {
  const parsed = fromMarkdown('# Plan\n\nIntro.\n\n## Week 1\n\n- read\n- practise\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n', 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const doc = emptyDocument('d', 'Plan')
  doc.blocks = parsed.blocks
  const made = await writeDocx(doc)
  const out = await body('Plan.docx', made.bytes)
  assert.equal(out.body.kind, 'document')
  if (out.body.kind !== 'document') return
  const kinds = out.body.document.blocks.map((one) => one.kind)
  assert.ok(kinds.includes('heading'), kinds.join(','))
  assert.ok(kinds.includes('list'), kinds.join(','))
  assert.ok(kinds.includes('table'), kinds.join(','))
  assert.equal(out.title, 'Plan')
})

/** The smallest PDF with a text layer: one page, one Helvetica line, offsets computed so the xref is honest. */
const tinyPdf = (line: string): Uint8Array => {
  const content = `BT /F1 24 Tf 72 700 Td (${line}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((one, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${one}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((one) => `${String(one).padStart(10, '0')} 00000 n `).join('\n')}\n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

test('a PDF gives its text as paragraphs, and says that layout is not read', async () => {
  const out = await body('hello.pdf', tinyPdf('Hello from a PDF'))
  assert.equal(out.body.kind, 'document')
  if (out.body.kind !== 'document') return
  assert.equal(out.body.document.blocks.length, 1)
  const first = out.body.document.blocks[0]
  assert.equal(first.kind, 'paragraph')
  if (first.kind === 'paragraph') assert.equal(first.content.map((r) => ('text' in r ? r.text : '')).join(''), 'Hello from a PDF')
  assert.ok(out.notes.some((one) => /layout are not read/.test(one)))
})

test('what cannot be read is refused with a reason, not read wrongly', async () => {
  const empty = await importFile('x.csv', new Uint8Array())
  assert.ok('error' in empty)
  const deck = await importFile('x.pptx', encode('PK\u0003\u0004junk'))
  assert.ok('error' in deck && /not a PowerPoint file Orbis can read/.test(deck.message))
  const scanned = await importFile('x.pdf', encode('%PDF-1.4\nnothing\n'))
  assert.ok('error' in scanned)
})

test('a deck comes in as a document: a heading per slide, its bullets, its table, in the order the deck shows them', async () => {
  const parsed = fromMarkdown('# Launch plan\n\n## Why now\n\n- The market is ready\n- The team is ready\n\n## Numbers\n\n| Month | Units |\n| --- | --- |\n| Jan | 12 |\n| Feb | 18 |\n\n## Next\n\nShip in March.\n', 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const doc = emptyDocument('d', 'Launch plan')
  doc.blocks = parsed.blocks
  const made = await writePptx(doc)
  const out = await body('Launch plan.pptx', made.bytes)
  assert.equal(out.body.kind, 'document')
  assert.equal(out.format, 'pptx')
  if (out.body.kind !== 'document') return
  const said = (runs: { text?: string }[]): string => runs.map((r) => r.text ?? '').join('')
  const headings = out.body.document.blocks.flatMap((one) => (one.kind === 'heading' ? [said(one.content as { text?: string }[])] : []))
  assert.equal(headings[0], 'Launch plan')
  // The deck is what Orbis's own writer made of the document: a title slide, a slide per heading, the table on a slide of its own.
  for (const title of ['Why now', 'Next']) assert.ok(headings.includes(title), `${title} in ${headings.join(' | ')}`)
  assert.ok(headings.indexOf('Why now') < headings.indexOf('Next'), 'in the order the deck shows them')
  const bullets = out.body.document.blocks.flatMap((one) => (one.kind === 'list' ? one.items.map((item) => said(item.content as { text?: string }[])) : []))
  assert.ok(bullets.includes('The market is ready') && bullets.includes('The team is ready'), bullets.join(' | '))
  const table = out.body.document.blocks.find((one) => one.kind === 'table')
  assert.ok(table && table.kind === 'table')
  if (table && table.kind === 'table') assert.deepEqual(table.rows.map((row) => row.map((cell) => said(cell.content as { text?: string }[]))), [['Month', 'Units'], ['Jan', '12'], ['Feb', '18']])
  assert.ok(out.notes.some((one) => /Read the words of \d+ slides?: titles, text, tables and speaker notes\. Pictures, charts, drawings and where things sat on a slide are not read\./.test(one)), out.notes.join(' | '))
})
