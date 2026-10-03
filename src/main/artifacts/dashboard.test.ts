import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDataError, parseDelimited, type Table } from '../../shared/compute/data.ts'
import { blockText, fromMarkdown, isDocumentError, toMarkdown } from '../../shared/compute/document.ts'
import { dashboardDocument, isDashboardRefusal, planDashboard, type DashboardPlan } from './dashboard.ts'

/*
 * A dashboard is only worth anything if its figures are the engine's own and its charts fit the data. So the tests
 * here check the numbers against sums done by hand, and check that each shape of table gets the chart that shape of
 * table can carry -- and that the ones it cannot are refused with a reason, not drawn anyway.
 */

const tableFrom = (text: string): Table => {
  const parsed = parseDelimited(text)
  if (isDataError(parsed)) throw new Error(parsed.message)
  return parsed.table
}

/** One row per site, with a date column in order: the shape a dashboard is happiest with. */
const monthly = () => tableFrom('month,site,spend,margin %\n2026-01-01,Head office,1200,12\n2026-02-01,Depot,800,9\n2026-03-01,Yard,400,15\n')

/** Many rows per region: a chart by region needs the table totalled first. */
const transactions = () => tableFrom('region,amount\nNorth,10\nSouth,4\nNorth,6\nSouth,1\nNorth,2\n')

const planOf = (table: Table, title = 'Energy', version = 3): DashboardPlan => {
  const plan = planDashboard(table, title, version)
  if (isDashboardRefusal(plan)) throw new Error(plan.message)
  return plan
}

const headline = (plan: DashboardPlan, label: string): string | undefined => plan.headlines.find((one) => one.label === label)?.value

// ---------------------------------------------------------------- the figures

test('the headline figures are the engine\'s own sums, averages and extremes', () => {
  const plan = planOf(monthly())
  assert.equal(headline(plan, 'Rows'), '3')
  assert.equal(headline(plan, 'Columns'), '4')
  assert.equal(headline(plan, 'Total spend'), '2,400')
  assert.equal(headline(plan, 'Average spend'), '800')
  // A column that is already a rate is averaged and never added up.
  assert.equal(headline(plan, 'Average margin %'), '12')
  assert.equal(headline(plan, 'Total margin %'), undefined)
  assert.equal(headline(plan, 'Biggest site'), 'Head office — 1,200')
  assert.equal(headline(plan, 'Smallest site'), 'Yard — 400')
  assert.ok(plan.headlines.every((one) => one.how !== ''), 'every figure says how it was worked out')
})

test('a column of identifiers is left out, with the reason', () => {
  const plan = planOf(tableFrom('id,site,spend\n1,Head office,1200\n2,Depot,800\n'))
  assert.equal(headline(plan, 'Total id'), undefined)
  assert.ok(plan.leftOut.some((one) => one.column === 'id' && /label/.test(one.why)), JSON.stringify(plan.leftOut))
})

test('the breakdown gathers the rows by the first column of names and totals each group', () => {
  const plan = planOf(transactions())
  assert.ok(plan.breakdown)
  assert.deepEqual(plan.breakdown!.headers, ['region', 'Rows', 'Total amount'])
  assert.deepEqual(plan.breakdown!.rows, [
    ['North', '3', '18'],
    ['South', '2', '5']
  ])
  assert.equal(plan.breakdown!.groups, 2)
  assert.match(plan.breakdown!.caption, /biggest total amount first/)
})

test('the same table gives the same dashboard every time', () => {
  assert.deepEqual(planOf(monthly()), planOf(monthly()))
  assert.deepEqual(planOf(transactions()), planOf(transactions()))
})

// ---------------------------------------------------------------- the charts

test('dates give a line, one row per name gives bars, and few positive amounts give a pie', () => {
  const plan = planOf(monthly())
  assert.deepEqual(plan.figures.map((one) => one.kind), ['line', 'bar', 'pie'])
  const [line, bars, pie] = plan.figures
  assert.deepEqual([line.blockId, bars.blockId, pie.blockId], ['figure-1', 'figure-2', 'figure-3'])
  assert.equal(line.x, 'month')
  assert.deepEqual(line.y, ['spend', 'margin'])
  assert.equal(line.steps, undefined, 'the rows are already in date order')
  assert.match(line.why, /holds dates/)
  assert.equal(bars.x, 'site')
  assert.equal(pie.y.length, 1)
  assert.match(pie.why, /share of one total/)
  assert.ok(plan.figures.every((one) => one.caption !== '' && one.alt !== ''))
})

test('rows out of date order are sorted first, and the chart is of the sorted table', () => {
  const plan = planOf(tableFrom('month,site,spend\n2026-03-01,Yard,400\n2026-01-01,Head office,1200\n'))
  const line = plan.figures.find((one) => one.kind === 'line')
  assert.ok(line)
  assert.deepEqual(line!.steps, [{ op: 'sort', by: [{ column: 'month', descending: false }] }])
  assert.match(line!.why, /not in date order/)
})

test('a name that appears on more than one row gives bars of the totals, with the step that makes them', () => {
  const plan = planOf(transactions())
  assert.deepEqual(plan.figures.map((one) => one.kind), ['bar'])
  const bars = plan.figures[0]
  assert.deepEqual(bars.steps, [{ op: 'group', by: ['region'], totals: [{ column: 'amount', how: 'sum', as: 'Total amount' }] }])
  assert.deepEqual(bars.y, ['Total amount'], 'the chart is drawn from the column the group step makes')
  assert.match(bars.why, /totalled by it first/)
})

test('a pie is not drawn when a value is negative: a share of a total nothing was taken from is not a share', () => {
  const plan = planOf(tableFrom('site,spend\nHead office,1200\nDepot,-200\n'))
  assert.deepEqual(plan.figures.map((one) => one.kind), ['bar'])
})

test('there is no chart when nothing in the table can carry one, and it says so', () => {
  const plan = planOf(tableFrom('width,height\n1,2\n3,4\n'))
  assert.deepEqual(plan.figures, [])
  assert.ok(plan.notes.some((one) => /No chart was drawn/.test(one)), plan.notes.join(' | '))
})

test('a chart is never drawn with more bars than can be read; the breakdown carries the figures instead', () => {
  const rows = Array.from({ length: 50 }, (_, i) => `Site ${i + 1},${i + 1}`).join('\n')
  const plan = planOf(tableFrom(`site,spend\n${rows}\n`))
  assert.deepEqual(plan.figures, [])
  assert.ok(plan.leftOut.some((one) => /cannot be read/.test(one.why)), JSON.stringify(plan.leftOut))
  assert.ok(plan.breakdown, 'the numbers are still there, as a table')
})

// ---------------------------------------------------------------- refusals

test('a table with no rows and a table with no numbers are both refused in plain words', () => {
  const empty = planDashboard({ ...monthly(), rows: [] }, 'Energy', 1)
  assert.ok(isDashboardRefusal(empty))
  assert.match(empty.message, /has no rows yet/)
  const wordsOnly = planDashboard(tableFrom('site,note\nHead office,fine\nDepot,busy\n'), 'Notes', 1)
  assert.ok(isDashboardRefusal(wordsOnly))
  assert.match(wordsOnly.message, /needs a column of numbers/)
  assert.match(wordsOnly.message, /"note" holds text/)
})

// ---------------------------------------------------------------- the document

test('the charts that were drawn become figures pointing at their own artifacts', () => {
  const plan = planOf(monthly())
  const drawn = plan.figures.slice(0, 2).map((one, i) => ({ blockId: one.blockId, artifactId: `artifact_${String(i + 1).repeat(32)}`.slice(0, 41), title: one.caption }))
  const document = dashboardDocument(plan, drawn, [{ blockId: 'figure-3', why: 'a pie of twelve slices or fewer was all that could be read and there were more' }])
  const images = document.blocks.filter((one) => one.kind === 'image')
  assert.equal(images.length, 2)
  assert.deepEqual(images.map((one) => one.id), ['figure-1', 'figure-2'])
  assert.ok(images.every((one) => one.kind === 'image' && /^artifact:artifact_[0-9a-f]{32}$/.test(one.source)), JSON.stringify(images))
  // The one that was not drawn is a sentence in its place, never a gap.
  assert.ok(document.blocks.some((one) => /There is no chart of .* because a pie of twelve slices/.test(blockText(one))))
})

test('the document says what it is, holds the figures and the breakdown, and names what it left out', () => {
  const plan = planOf(tableFrom('id,site,spend\n1,Head office,1200\n2,Depot,800\n'))
  const document = dashboardDocument(plan)
  assert.equal(document.metadata.title, 'Dashboard of Energy')
  assert.equal(document.metadata.source, 'Computed by Orbis from "Energy" (version 3)')
  const headings = document.blocks.filter((one) => one.kind === 'heading').map((one) => blockText(one))
  assert.deepEqual(headings, ['Dashboard of Energy', 'In short', 'Charts', 'By site', 'What was left out', 'How this was worked out'])
  assert.match(blockText(document.blocks[1]), /nothing on this page was written by a model/)
  assert.match(blockText(document.blocks[1]), /of version 3/)
  const tables = document.blocks.filter((one) => one.kind === 'table')
  assert.equal(tables.length, 2, 'the headline figures and the breakdown')
})

test('the document reads back from the Markdown it is stored as', () => {
  const plan = planOf(monthly())
  const document = dashboardDocument(plan, [{ blockId: 'figure-1', artifactId: `artifact_${'a'.repeat(32)}`, title: 'Spend over month' }])
  const markdown = toMarkdown(document)
  const again = fromMarkdown(markdown, 'b')
  if (isDocumentError(again)) throw new Error(again.message)
  assert.equal(again.blocks.length, document.blocks.length, markdown)
  assert.deepEqual(again.blocks.map((one) => one.kind), document.blocks.map((one) => one.kind))
  const image = again.blocks.find((one) => one.kind === 'image')
  assert.ok(image && image.kind === 'image' && image.source === `artifact:artifact_${'a'.repeat(32)}`, 'the figure still points at its chart')
})
