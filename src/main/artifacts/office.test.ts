import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDataError, parseDelimited, type Table as DataTable } from '../../shared/compute/data.ts'
import { emptyDocument, fromMarkdown, isDocumentError } from '../../shared/compute/document.ts'
import { hashOf } from '../../shared/compute/interchange.ts'
import { everyTotal } from '../../shared/artifacts/formula.ts'
import { applySteps, isTransformFailure } from '../../shared/artifacts/transform.ts'
import { planSlides, verifyDocx, verifyPptx, verifyXlsx, writeDocx, writePptx, writeXlsx } from './office.ts'

/*
 * Real files from the real libraries, read back by the real checks. Nothing is stubbed: a workbook is written with
 * exceljs and re-opened with exceljs; a Word document and a deck are opened as the ZIP packages they are.
 */

const table = () => {
  const parsed = parseDelimited('date,site,consumption,ok\n2026-10-01,Head office,412.5,true\n2026-10-02,Depot,288,false\n')
  if (isDataError(parsed)) throw new Error(parsed.message)
  return parsed.table
}

const document = (markdown: string, title = 'Report') => {
  const parsed = fromMarkdown(markdown, 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const doc = emptyDocument('d', title)
  doc.blocks = parsed.blocks
  return doc
}

const shapeOf = (bytes: Uint8Array) => ({ bytes: bytes.length, hash: hashOf(bytes) })

/** The same table with a column the engine computed, which is what a live formula is written from. */
const computedTable = (): DataTable => {
  const parsed = parseDelimited('site,qty,price\nHead office,2,3.5\nDepot,4,2\n')
  if (isDataError(parsed)) throw new Error(parsed.message)
  const changed = applySteps(parsed.table, [{ op: 'compute', name: 'total', formula: 'qty * price' }])
  if (isTransformFailure(changed)) throw new Error(changed.message)
  return changed.table
}

const openSheet = async (bytes: Uint8Array) => {
  const workbook = new (await import('exceljs')).default.Workbook()
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  return workbook.worksheets[0]
}

test('a workbook keeps numbers as numbers, dates as dates, and reads back with the same shape and headings', async () => {
  const original = table()
  const made = await writeXlsx(original, 'Energy')
  assert.ok(made.bytes.length > 2000, 'a real workbook is not tiny')
  assert.equal(made.bytes[0], 0x50, 'starts with the ZIP signature')
  const result = await verifyXlsx(original, shapeOf(made.bytes), made.bytes)
  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.deepEqual(result.checks.map((one) => one.what), ['written', 'checksum', 'opens', 'round trip'])
  assert.deepEqual(result.reimported, { rows: 2, columns: 4 })
})

test('the sheet is named after the artifact, within what Excel allows', async () => {
  const made = await writeXlsx(table(), 'Site Readings: Q3/2026 [draft]')
  const workbook = new (await import('exceljs')).default.Workbook()
  await workbook.xlsx.load(made.bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  assert.equal(workbook.worksheets[0].name, 'Site Readings Q3 2026 draft')
})

test('a workbook that was tampered with fails the checks that would notice', async () => {
  const original = table()
  const made = await writeXlsx(original, 'Energy')
  const expected = shapeOf(made.bytes)
  const other = await writeXlsx({ ...original, rows: original.rows.slice(0, 1) }, 'Energy')
  const result = await verifyXlsx(original, expected, other.bytes)
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'round trip')?.passed, false)
  assert.ok(result.differences.some((one) => /Shape differs/.test(one)))
})

test('a table with nothing computed in it is written exactly as it was, whether or not formulas were asked for', async () => {
  const plain = await writeXlsx(table(), 'Energy')
  const asked = await writeXlsx(table(), 'Energy', { computed: true })
  assert.equal(hashOf(asked.bytes), hashOf(plain.bytes), 'the same bytes: there was nothing to write as a formula')
  assert.equal(asked.formulas, undefined)
  assert.deepEqual((await verifyXlsx(table(), shapeOf(asked.bytes), asked.bytes)).checks.map((one) => one.what), ['written', 'checksum', 'opens', 'round trip'])
})

test('a computed column is written as a real Excel formula with its answer cached beside it, and read back as both', async () => {
  const original = computedTable()
  const made = await writeXlsx(original, 'Energy', { computed: true })
  assert.ok(made.formulas, 'the writer says which cells hold a formula')
  assert.deepEqual(made.formulas!.cells.map((one) => one.address), ['D2', 'D3'])
  assert.ok(made.notes.some((one) => /real Excel formula/.test(one)), made.notes.join(' | '))

  const sheet = await openSheet(made.bytes)
  const cell = sheet.getCell('D2').value as { formula: string; result: number }
  assert.equal(cell.formula, 'IF(COUNT(B2,C2)=2,B2*C2,"")')
  assert.equal(cell.result, 7, 'the number is in the file, so any viewer shows a figure')

  const result = await verifyXlsx(original, shapeOf(made.bytes), made.bytes, made.formulas)
  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.deepEqual(result.checks.map((one) => one.what), ['written', 'checksum', 'opens', 'round trip', 'formulas', 'cached values'])
  assert.deepEqual(result.reimported, { rows: 2, columns: 4 })
})

test('a totals row is a row of formulas under the table, and the read-back counts the data rows without it', async () => {
  const original = table()
  const made = await writeXlsx(original, 'Energy', { totals: everyTotal(original) })
  assert.ok(made.formulas)
  assert.equal(made.formulas!.totalsRow, 4)
  const sheet = await openSheet(made.bytes)
  assert.equal(sheet.getCell('A4').value, 'Total')
  assert.deepEqual(sheet.getCell('C4').value, { formula: 'SUM(C2:C3)', result: 700.5 })
  const result = await verifyXlsx(original, shapeOf(made.bytes), made.bytes, made.formulas)
  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.deepEqual(result.reimported, { rows: 2, columns: 4 }, 'the totals row is not counted as data')
})

test('computed columns and a totals row together: the totals sum the formula column and leave themselves out', async () => {
  const original = computedTable()
  const made = await writeXlsx(original, 'Energy', { computed: true, totals: [{ column: 'total', how: 'sum' }] })
  assert.ok(made.formulas)
  assert.equal(made.formulas!.totalsRow, 4)
  const sheet = await openSheet(made.bytes)
  assert.equal((sheet.getCell('D3').value as { formula: string }).formula, 'IF(COUNT(B3,C3)=2,B3*C3,"")')
  // The range stops at the last row of data: a total that counted itself would double.
  assert.deepEqual(sheet.getCell('D4').value, { formula: 'SUM(D2:D3)', result: 15 })
  assert.equal(sheet.getCell('A4').value, 'Total')
  const result = await verifyXlsx(original, shapeOf(made.bytes), made.bytes, made.formulas)
  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.deepEqual(result.reimported, { rows: 2, columns: 4 })
})

test('a workbook whose formulas are missing fails the check for them, however well its counts agree', async () => {
  const original = computedTable()
  const withFormulas = await writeXlsx(original, 'Energy', { computed: true })
  const asValues = await writeXlsx(original, 'Energy')
  const result = await verifyXlsx(original, shapeOf(asValues.bytes), asValues.bytes, withFormulas.formulas)
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'round trip')?.passed, true, 'the shape still agrees, which is the point')
  assert.equal(result.checks.find((one) => one.what === 'formulas')?.passed, false)
  assert.ok(result.differences.some((one) => /D2 should hold the formula/.test(one)))
})

test('a Word document has real paragraphs and the package parts Word needs', async () => {
  const doc = document('# Report\n\nA finding with **bold** text.\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> quoted\n\n```js\nlet x\n```\n')
  const made = await writeDocx(doc)
  const result = verifyDocx(shapeOf(made.bytes), made.bytes)
  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.deepEqual(result.checks.map((one) => one.what), ['written', 'checksum', 'package', 'paragraphs'])
  assert.ok((result.reimported?.rows ?? 0) >= 7, `expected at least 7 paragraphs, got ${result.reimported?.rows}`)
})

test('something that is not a package is refused as such, not just by its hash', () => {
  const junk = new TextEncoder().encode('<html>not a docx</html>')
  const result = verifyDocx(shapeOf(junk), junk)
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'package')?.passed, false)
})

test('a deck is planned from the headings, with a table on its own slide and the text kept in the notes', () => {
  const doc = document('# Energy\n\nIntro sentence.\n\n## Findings\n\n- one\n- two\n- three\n\n## Figures\n\n| Site | MWh |\n| --- | --- |\n| HQ | 412 |\n\n## Method\n\nReadings were taken.\n')
  const slides = planSlides(doc)
  assert.deepEqual(slides.map((one) => one.title), ['Energy', 'Findings', 'Table 1', 'Method'])
  assert.equal(slides[1].bullets.length, 3)
  assert.ok(slides[2].table)
  assert.deepEqual(slides[2].table?.rows[0], ['Site', 'MWh'])
  assert.ok(slides[3].notes.includes('Readings were taken.'))
})

test('text after a table slide continues its own section, not one named after the document', () => {
  const doc = document('# Energy\n\n## Figures\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> The one worth repeating.\n\n## Next\n\nMore.\n', 'Energy')
  const slides = planSlides(doc)
  // "Figures" had nothing before its table, so the quote after the table opens "Figures" itself, not "(continued)".
  assert.deepEqual(slides.map((one) => one.title), ['Table 1', 'Figures', 'Next'])
  const withText = planSlides(document('## Figures\n\nLead-in.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n', 'E'))
  assert.deepEqual(withText.map((one) => one.title), ['Figures', 'Table 1', 'Figures (continued)'])
})

test('a section with too many points runs on to a continued slide', () => {
  const doc = document(`# Long\n\n${Array.from({ length: 10 }, (_, i) => `- point ${i + 1}`).join('\n')}\n`)
  const slides = planSlides(doc)
  assert.deepEqual(slides.map((one) => one.title), ['Long', 'Long (continued)'])
  assert.equal(slides[0].bullets.length, 7)
  assert.equal(slides[1].bullets.length, 3)
})

test('a deck is written with the slides that were planned plus a title slide, and reads back with that many', async () => {
  const doc = document('# Energy\n\nIntro.\n\n## Findings\n\n- one\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n', 'Energy')
  const made = await writePptx(doc)
  // Title slide + Energy + Findings + Table 1
  assert.equal(made.count, 4)
  const result = verifyPptx({ ...shapeOf(made.bytes), slides: made.count }, made.bytes)
  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.deepEqual(result.checks.map((one) => one.what), ['written', 'checksum', 'package', 'slides'])
  assert.equal(result.reimported?.rows, 4)
  const wrong = verifyPptx({ ...shapeOf(made.bytes), slides: 9 }, made.bytes)
  assert.equal(wrong.checks.find((one) => one.what === 'slides')?.passed, false)
})

test('a figure with a picture is drawn into Word and gets a slide of its own; one without is written as its description', async () => {
  const { encodePng } = await import('../chromium/png.ts')
  const png = new Uint8Array(encodePng({ width: 880, height: 520, bgra: Buffer.alloc(880 * 520 * 4, 0x80) }))
  const parsed = fromMarkdown('# Energy\n\nWords.\n\n![Chart](artifact:artifact_0123456789abcdef0123456789abcdef)\n\n*Consumption by site*\n\n![Gone](artifact:artifact_ffffffffffffffffffffffffffffffff)\n', 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const document = emptyDocument('d', 'Energy')
  document.blocks = parsed.blocks
  const drawn = document.blocks.find((one) => one.kind === 'image')!
  const pictures = new Map([[drawn.id, { png, width: 880, height: 520 }]])

  const word = await writeDocx(document, pictures)
  assert.equal(word.pictures, 1)
  assert.ok(word.notes.some((one) => /1 image is written as its description/.test(one)), 'the figure with no picture says so')
  const checkedWord = verifyDocx({ bytes: word.bytes.length, hash: hashOf(word.bytes), pictures: 1 }, word.bytes)
  assert.equal(checkedWord.ok, true, JSON.stringify(checkedWord.checks))
  assert.match(checkedWord.checks.find((one) => one.what === 'pictures')!.describe, /holds 1 picture; 1 was put in/)
  // A file that claims a picture it does not hold is caught.
  const plain = await writeDocx(document)
  assert.equal(verifyDocx({ bytes: plain.bytes.length, hash: hashOf(plain.bytes), pictures: 1 }, plain.bytes).ok, false)

  const slides = planSlides(document, new Set([drawn.id]))
  const figureSlide = slides.find((one) => one.picture === drawn.id)
  assert.ok(figureSlide, 'the figure has a slide of its own')
  assert.match(figureSlide!.title, /^Figure 1: Consumption by site$/)
  const deck = await writePptx(document, pictures)
  assert.equal(deck.pictures, 1)
  const checkedDeck = verifyPptx({ bytes: deck.bytes.length, hash: hashOf(deck.bytes), slides: deck.count, pictures: 1 }, deck.bytes)
  assert.equal(checkedDeck.ok, true, JSON.stringify(checkedDeck.checks))
})
