import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTable, isDataError } from '../compute/data.ts'
import { fromMarkdown, isDocumentError, toMarkdown, emptyDocument } from '../compute/document.ts'
import { gateForWrite } from './secrets.ts'
import { listTemplates, templateById, TEMPLATES } from './templates.ts'

test('every template has its own id and name, and the list leaves the contents out', () => {
  assert.equal(new Set(TEMPLATES.map((one) => one.id)).size, TEMPLATES.length)
  assert.equal(new Set(TEMPLATES.map((one) => one.name.toLowerCase())).size, TEMPLATES.length)
  const listed = listTemplates()
  assert.equal(listed.length, TEMPLATES.length)
  for (const one of listed) {
    assert.deepEqual(Object.keys(one).sort(), ['columns', 'describe', 'group', 'id', 'kind', 'name'])
    assert.ok(one.describe.length > 10 && one.describe.endsWith('.'))
  }
  assert.equal(templateById('nope'), null)
  assert.equal(templateById('budget')?.kind, 'table')
})

test('a table template builds into a table with its typed columns and no rows at all', () => {
  for (const template of TEMPLATES) {
    if (template.kind !== 'table') continue
    const table = buildTable(
      template.columns.map((one) => one.name),
      [],
      { source: `template: ${template.name}`, types: template.columns.map((one) => one.type), units: template.columns.map((one) => one.unit ?? '') }
    )
    assert.ok(!isDataError(table), `${template.id}: ${isDataError(table) ? table.message : ''}`)
    if (isDataError(table)) continue
    assert.equal(table.rows.length, 0, `${template.id} starts with no rows: a sample row left in is a false record`)
    assert.deepEqual(table.columns.map((one) => one.type), template.columns.map((one) => one.type), template.id)
    assert.equal(new Set(table.columns.map((one) => one.name.toLowerCase())).size, table.columns.length, `${template.id} has no repeated column`)
    const measured = template.columns.findIndex((one) => one.type === 'quantity')
    if (measured >= 0) assert.ok(table.columns[measured].unit !== null, `${template.id}: a quantity column knows its unit`)
  }
})

test('a document template reads as a document, survives a round trip, and claims nothing', () => {
  for (const template of TEMPLATES) {
    if (template.kind !== 'document') continue
    const parsed = fromMarkdown(template.markdown, 'b')
    assert.ok(!isDocumentError(parsed), template.id)
    if (isDocumentError(parsed)) continue
    assert.ok(parsed.blocks.length >= 5, `${template.id} has structure`)
    assert.equal(parsed.blocks[0].kind === 'heading' || parsed.blocks[0].kind === 'paragraph', true)
    const document = emptyDocument('d', template.name)
    document.blocks = parsed.blocks
    const again = fromMarkdown(toMarkdown(document), 'b')
    assert.ok(!isDocumentError(again) && again.blocks.length === parsed.blocks.length, `${template.id} keeps its ${parsed.blocks.length} blocks through a round trip`)
    assert.ok(template.markdown.includes('(fill in'), `${template.id} says where the person writes`)
    assert.equal(/\d{4}-\d{2}-\d{2}|\d+%|[$€£]\s?\d/.test(template.markdown), false, `${template.id} has no made-up date, percentage or price in it`)
  }
})

test('no template trips the secret gate', () => {
  for (const template of TEMPLATES) {
    const text = template.kind === 'table' ? template.columns.map((one) => one.name).join(',') : template.markdown
    assert.equal(gateForWrite(`${template.id}.md`, text, false).ok, true, template.id)
  }
})
