import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asNumber, isDataError } from '../compute/data.ts'
import { emptyDocument, fromHtml, fromMarkdown, isDocumentError } from '../compute/document.ts'
import { extractTable, tablesIn } from './extract.ts'
import { documentTextFromReply, titleFromText } from './naming.ts'

const REPORT = `# Energy report

Some words first.

| Site | Consumption (MWh) | Solar | Checked |
| --- | --- | --- | --- |
| HQ | 412 | 96 | 2026-10-01 |
| Depot | 288 | 12 | 2026-10-02 |
| Warehouse | 530 | | 2026-10-03 |

*Readings by site*

More words.

| Name | Name | |
| --- | --- | --- |
| a | b | c |
`

const documentOf = (markdown: string) => {
  const parsed = fromMarkdown(markdown, 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const document = emptyDocument('d', 'Report')
  document.blocks = parsed.blocks
  return document
}

test('the tables in a document are listed with their size, caption and headings, and none of their contents', () => {
  const listed = tablesIn(documentOf(REPORT))
  assert.equal(listed.length, 2)
  assert.deepEqual(listed[0], { index: 1, caption: 'Readings by site', rows: 3, columns: 4, headings: ['Site', 'Consumption (MWh)', 'Solar', 'Checked'] })
  assert.equal(listed[1].rows, 1)
  assert.deepEqual(tablesIn(documentOf('# Nothing\n\nJust words.\n')), [])
})

test('a table taken out of a document has typed columns worked out from its values, and a blank stays blank', () => {
  const table = extractTable(documentOf(REPORT), 1, 'from "Report"')
  assert.ok(!isDataError(table), isDataError(table) ? table.message : '')
  if (isDataError(table)) return
  assert.deepEqual(table.columns.map((one) => one.name), ['Site', 'Consumption (MWh)', 'Solar', 'Checked'])
  assert.equal(table.columns[1].type, 'quantity', 'the unit in the heading is read, as it is for a pasted table')
  assert.equal(table.columns[3].type, 'date')
  assert.equal(table.rows.length, 3)
  assert.equal(asNumber(table.rows[2].cells[1]), 530)
  assert.equal(asNumber(table.rows[2].cells[2]), null, 'the solar reading that was not written is not a zero')
  assert.equal(table.source, 'from "Report"')
})

test('a blank or repeated heading is named by where it is, so every column still has its own name', () => {
  const table = extractTable(documentOf(REPORT), 2, '')
  assert.ok(!isDataError(table))
  if (isDataError(table)) return
  assert.deepEqual(table.columns.map((one) => one.name), ['Name', 'Name (2)', 'Column 3'])
})

test('asking for a table that is not there says how many there are', () => {
  const none = extractTable(documentOf('# Nothing\n\nJust words.\n'), 1, '')
  assert.ok(isDataError(none) && /no table in this document/.test(none.message))
  const third = extractTable(documentOf(REPORT), 3, '')
  assert.ok(isDataError(third) && /has 2 tables; there is no table 3/.test(third.message))
  const zero = extractTable(documentOf(REPORT), 0, '')
  assert.ok(isDataError(zero))
})

test('a merged cell covers its columns with its text once and blanks after, never repeated', () => {
  const parsed = fromHtml('<table><tr><th>Region</th><th>Q1</th><th>Q2</th></tr><tr><td colspan="2">North (combined)</td><td>7</td></tr><tr><td>South</td><td>3</td><td>4</td></tr></table>', 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const document = emptyDocument('d', 'Merged')
  document.blocks = parsed.blocks
  const table = extractTable(document, 1, '')
  assert.ok(!isDataError(table), isDataError(table) ? table.message : '')
  if (isDataError(table)) return
  assert.equal(table.rows.length, 2)
  assert.equal(asNumber(table.rows[0].cells[1]), null, 'the column the merged cell covered is blank, not a copy')
  assert.equal(asNumber(table.rows[0].cells[2]), 7)
  assert.equal(asNumber(table.rows[1].cells[1]), 3)
})

test('a kept reply is named by its first heading, or by its first words when it has none', () => {
  assert.equal(titleFromText('Sure!\n\n## A plan for **March**\n\nText.'), 'A plan for March')
  assert.equal(titleFromText('Here is a [link](https://example.com) and `code` to start with and then it keeps going on'), 'Here is a link and code to start with…')
  assert.equal(titleFromText('\n\n   \n'), 'Document')
  assert.equal(titleFromText('', 'Reply'), 'Reply')
  assert.ok(titleFromText('x'.repeat(500)).length <= 80)
})

test('a reply that is one fenced Markdown block is kept as the document inside it; anything else is kept as written', () => {
  const inside = '# Moons\n\n| Planet | Moons |\n| --- | --- |\n| Mars | 2 |'
  assert.equal(documentTextFromReply('```markdown\n' + inside + '\n```'), inside)
  assert.equal(documentTextFromReply('  ```md\r\n' + inside + '\r\n```\n'), inside)
  assert.equal(documentTextFromReply('```\n' + inside + '\n```'), inside, 'an unmarked fence holding a heading is a wrapped document')
  const script = '```\nnpm install\nnpm test\n```'
  assert.equal(documentTextFromReply(script), script, 'an unmarked fence of commands is code, and stays code')
  const python = '```python\nprint(1)\n```'
  assert.equal(documentTextFromReply(python), python)
  const mixed = 'Here you go:\n\n```markdown\n# T\n```'
  assert.equal(documentTextFromReply(mixed), mixed, 'prose around the fence means the reply is the document')
  const nested = '```markdown\n# T\n\n```js\nx\n```\n\nmore\n```'
  assert.equal(documentTextFromReply(nested), nested)
  assert.equal(documentTextFromReply('# Plain\n\nText.'), '# Plain\n\nText.')
})
