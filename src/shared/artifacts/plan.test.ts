import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildable, readProposal } from './plan.ts'

const errors = (problems: { severity: string; message: string }[]): string[] => problems.filter((one) => one.severity === 'error').map((one) => one.message)

test('a kind outside the table is refused by name, with the ones that exist', () => {
  const out = readProposal({ kind: 'spreadsheet', title: 'x' })
  assert.equal(out.proposal, null)
  assert.match(errors(out.problems)[0], /one of: table, document/)
  assert.equal(readProposal('nope').proposal, null)
  assert.equal(readProposal(['table']).proposal, null)
})

test('a table proposal is read column by column, and every fault is named for the retry', () => {
  const out = readProposal({
    kind: 'table',
    title: 'Expenses',
    columns: [{ name: 'Date', type: 'date' }, { name: 'Amount', type: 'money' }, { name: '' }, { name: 'date' }],
    rows: [['2026-10-01', 12.5], 'not a row', ['a', 'b', 'c', 'd', 'e']]
  })
  assert.equal(out.proposal, null)
  const found = errors(out.problems)
  assert.ok(found.some((one) => /columns\[1\].*"money"/.test(one)), found.join(' | '))
  assert.ok(found.some((one) => /columns\[2\] has no name/.test(one)))
  assert.ok(found.some((one) => /Two columns are called "date"/.test(one)))
  assert.ok(found.some((one) => /rows\[1\] is not a list/.test(one)))
  assert.ok(found.some((one) => /rows\[2\] has 5 cells/.test(one)))
})

test('a good table proposal becomes columns and example rows, and the rows are labelled as examples', () => {
  const out = readProposal({
    kind: 'table',
    title: 'Monthly expenses',
    purpose: 'Track spending by category',
    format: 'csv',
    columns: [{ name: 'Date', type: 'date' }, { name: 'Category', type: 'category' }, { name: 'Amount', type: 'number', unit: 'INR' }, 'Notes'],
    rows: [['2026-10-01', 'food', 120, 'lunch'], ['2026-10-02', 'travel', 40.5, null]]
  })
  assert.ok(buildable(out.problems))
  assert.ok(out.proposal && 'table' in out.proposal)
  if (!out.proposal || !('table' in out.proposal) || !out.proposal.table) throw new Error('no table')
  assert.equal(out.proposal.intent.format, 'csv')
  assert.deepEqual(out.proposal.table.columns.map((one) => one.name), ['Date', 'Category', 'Amount', 'Notes'])
  assert.equal(out.proposal.table.columns[2].unit, 'INR')
  assert.deepEqual(out.proposal.table.rows, [['2026-10-01', 'food', '120', 'lunch'], ['2026-10-02', 'travel', '40.5', '']])
  assert.ok(out.problems.some((one) => one.severity === 'warning' && /2 example rows/.test(one.message)))
})

test('a format the kind cannot be written in is refused with the ones it can', () => {
  const out = readProposal({ kind: 'document', title: 'x', format: 'csv', markdown: '# x' })
  assert.equal(out.proposal, null)
  assert.match(errors(out.problems)[0], /cannot be written as "csv"\. Choose one of: markdown, html, pdf, docx, pptx, text/)
})

test('a document needs its markdown and nothing else', () => {
  assert.match(errors(readProposal({ kind: 'document', title: 'x' }).problems)[0], /needs "markdown"/)
  const out = readProposal({ kind: 'document', title: 'Notes', markdown: '# Notes\n\nText.', columns: [] })
  assert.ok(out.proposal && 'markdown' in out.proposal)
  assert.ok(out.problems.some((one) => /"columns" were given for a document/.test(one.message)))
})

test('a chart is not something Orion writes: the proposal is refused and points at the table', () => {
  const out = readProposal({ kind: 'plot', title: 'Energy' })
  assert.equal(out.proposal, null)
  assert.ok(errors(out.problems).some((one) => /made from a table.s own numbers, not written: propose the table/.test(one)))
})

test('a diagram proposal is read node by node, and a dangling or malformed edge is a named fault', () => {
  const bad = readProposal({
    kind: 'diagram',
    title: 'Flow',
    nodes: [{ id: 'a', label: 'Start', shape: 'start' }, { id: 'a', label: 'Again', shape: 'step' }, { label: 'no id' }, { id: 'd', label: 'Odd', shape: 'cloud' }],
    edges: [{ from: 'a', to: 'zzz' }, 'x']
  })
  assert.equal(bad.proposal, null)
  const said = errors(bad.problems).join(' | ')
  assert.match(said, /Two nodes have the id "a"/)
  assert.match(said, /nodes\[2\] has no id/)
  assert.match(said, /shape "cloud"/)
  assert.match(said, /edges\[0\] joins "a" to "zzz"/)
  assert.match(said, /edges\[1\] joins "\?" to "\?"/)

  const good = readProposal({
    kind: 'diagram',
    title: 'Flow',
    nodes: [{ id: 'a', label: 'Start', shape: 'start' }, { id: 'b', label: 'Ok?', shape: 'decision' }, { id: 'c', label: 'Done', shape: 'end' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'yes' }, { from: 'b', to: 'a', label: 'no' }]
  })
  assert.ok(good.proposal?.diagram, errors(good.problems).join(' | '))
  assert.equal(good.proposal?.diagram?.nodes.length, 3)
  assert.equal(good.proposal?.diagram?.edges.length, 3)
  assert.equal(good.proposal?.diagram?.edges[0].label, '')
  assert.equal(good.proposal?.intent.format, 'svg')
})

test('a missing title is an error, and the default format is the kind first format', () => {
  const out = readProposal({ kind: 'table', columns: ['a'] })
  assert.ok(errors(out.problems).some((one) => /"title" is missing/.test(one)))
  const ok = readProposal({ kind: 'table', title: 'T', columns: ['a'] })
  assert.equal(ok.proposal?.intent.format, 'csv')
})
