import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TRAY, addToTray, buildComparison, describeComparison, inTray, normalizeTrayItem, removeFromTray, verifyCell } from './tray.ts'
import type { Proposal, TrayItem } from './tray.ts'

const item = (id: string, text?: string, extra: Partial<TrayItem> = {}): TrayItem => ({
  id,
  url: `https://example.com/${id}`,
  title: `Page ${id}`,
  site: 'example.com',
  vertical: 'all',
  addedAt: 1,
  ...(text ? { text } : {}),
  ...extra
})

const field = (key: string, value: string, quote: string): { key: string; label: string; value: string; quote: string } => ({
  key,
  label: key,
  value,
  quote
})

// ---------------------------------------------------------------- the one rule

test('a value the page does not contain never reaches the table', () => {
  const page = item('a', 'The Orion 14 weighs 1.2 kg and lasts 11 hours on a charge.')
  const invented: Proposal[] = [{ itemId: 'a', fields: [field('price', '$999', 'The Orion 14 costs $999 new.')] }]
  const table = buildComparison([page], invented)
  assert.equal(table.columns.length, 0)
  assert.equal(table.rows[0].cells.price, undefined)
  assert.equal(table.rejected, 1)
})

test('a real quote carrying an invented value is refused too', () => {
  const page = item('a', 'The Orion 14 weighs 1.2 kg and lasts 11 hours on a charge.')
  // The quote is genuinely on the page; the value is not in it. Checking only the quote would let this through.
  const twisted: Proposal[] = [{ itemId: 'a', fields: [field('weight', '0.9 kg', 'The Orion 14 weighs 1.2 kg')] }]
  const table = buildComparison([page], twisted)
  assert.equal(table.columns.length, 0)
  assert.equal(table.rejected, 1)
})

test('a value really on the page is kept, with the words that say it', () => {
  const page = item('a', 'The Orion 14 weighs 1.2 kg and lasts 11 hours on a charge.')
  const honest: Proposal[] = [{ itemId: 'a', fields: [field('weight', '1.2 kg', 'The Orion 14 weighs 1.2 kg')] }]
  const table = buildComparison([page], honest)
  assert.equal(table.rows[0].cells.weight?.value, '1.2 kg')
  assert.equal(table.rows[0].cells.weight?.url, 'https://example.com/a')
  assert.ok(table.rows[0].cells.weight?.quote.includes('1.2 kg'))
  assert.equal(table.rejected, 0)
})

test('a quote short enough to appear in anything proves nothing', () => {
  assert.equal(verifyCell({ value: '5', quote: '5' }, 'There are 5 of them.'), false)
})

test('a curly apostrophe is not a disagreement', () => {
  const page = 'The maker\u2019s warranty runs for 3 years.'
  assert.equal(verifyCell({ value: '3 years', quote: "The maker's warranty runs for 3 years" }, page), true)
})

test('a page that was never read contributes nothing, and is named', () => {
  const pages = [item('a', 'It weighs 1.2 kg.'), item('b', undefined, { problem: 'The page timed out.' })]
  const table = buildComparison(pages, [
    { itemId: 'a', fields: [field('weight', '1.2 kg', 'It weighs 1.2 kg')] },
    { itemId: 'b', fields: [field('weight', '1.4 kg', 'It weighs 1.4 kg')] }
  ])
  assert.equal(table.rows.length, 1)
  assert.equal(table.unread.length, 1)
  assert.equal(table.unread[0].problem, 'The page timed out.')
})

// ---------------------------------------------------------------- columns come from the items

test('a column exists when more than one page has it, and not when only one does', () => {
  const pages = [item('a', 'Weighs 1.2 kg. Ships in blue.'), item('b', 'Weighs 1.4 kg.')]
  const table = buildComparison(pages, [
    { itemId: 'a', fields: [field('weight', '1.2 kg', 'Weighs 1.2 kg'), field('colour', 'blue', 'Ships in blue')] },
    { itemId: 'b', fields: [field('weight', '1.4 kg', 'Weighs 1.4 kg')] }
  ])
  assert.deepEqual(table.columns.map((c) => c.key), ['weight'])
})

test('with a single readable page, everything it said is worth showing', () => {
  const table = buildComparison([item('a', 'Weighs 1.2 kg. Ships in blue.')], [
    { itemId: 'a', fields: [field('weight', '1.2 kg', 'Weighs 1.2 kg'), field('colour', 'blue', 'Ships in blue')] }
  ])
  assert.equal(table.columns.length, 2)
})

test('the fullest column leads, and ties keep a stable order', () => {
  const pages = [item('a', 'Weighs 1.2 kg. Costs $999.'), item('b', 'Weighs 1.4 kg. Costs $899.'), item('c', 'Weighs 1.1 kg.')]
  const table = buildComparison(pages, [
    { itemId: 'a', fields: [field('weight', '1.2 kg', 'Weighs 1.2 kg'), field('price', '$999', 'Costs $999')] },
    { itemId: 'b', fields: [field('weight', '1.4 kg', 'Weighs 1.4 kg'), field('price', '$899', 'Costs $899')] },
    { itemId: 'c', fields: [field('weight', '1.1 kg', 'Weighs 1.1 kg')] }
  ])
  assert.deepEqual(table.columns.map((c) => c.key), ['weight', 'price'])
  assert.equal(table.columns[0].filled, 3)
  assert.equal(table.columns[1].filled, 2)
})

test('a page that did not say leaves a gap rather than borrowing a neighbour value', () => {
  const pages = [item('a', 'Costs $999.'), item('b', 'Costs $899.'), item('c', 'Nothing about money here at all.')]
  const table = buildComparison(pages, [
    { itemId: 'a', fields: [field('price', '$999', 'Costs $999')] },
    { itemId: 'b', fields: [field('price', '$899', 'Costs $899')] },
    { itemId: 'c', fields: [] }
  ])
  assert.equal(table.rows[2].cells.price, null)
})

// ---------------------------------------------------------------- disagreement is information

test('one page giving two different prices keeps both', () => {
  const page = item('a', 'Was $999 at launch. Costs $899 today.')
  const table = buildComparison([page, item('b', 'Costs $850 today.')], [
    { itemId: 'a', fields: [field('price', '$999', 'Was $999 at launch'), field('price', '$899', 'Costs $899 today')] },
    { itemId: 'b', fields: [field('price', '$850', 'Costs $850 today')] }
  ])
  assert.equal(table.rows[0].disagreements.price?.length, 2)
  assert.deepEqual(table.rows[0].disagreements.price.map((c) => c.value), ['$999', '$899'])
})

test('the same value said twice is one value, not a disagreement', () => {
  const page = item('a', 'Costs $999. The price is $999 including tax.')
  const table = buildComparison([page, item('b', 'Costs $899.')], [
    { itemId: 'a', fields: [field('price', '$999', 'Costs $999'), field('price', '$999', 'The price is $999 including tax')] },
    { itemId: 'b', fields: [field('price', '$899', 'Costs $899')] }
  ])
  assert.equal(table.rows[0].disagreements.price, undefined)
})

// ---------------------------------------------------------------- the tray itself

test('pinning the same page twice keeps one pin', () => {
  const first = addToTray([], item('a'))
  const second = addToTray(first.items, { ...item('b'), url: 'https://example.com/a' })
  assert.equal(second.items.length, 1)
  assert.equal(second.added, false)
})

test('the tray has a ceiling, and says so rather than silently dropping', () => {
  let items: TrayItem[] = []
  for (let i = 0; i < MAX_TRAY; i += 1) items = addToTray(items, item(`i${i}`)).items
  const over = addToTray(items, item('one-too-many'))
  assert.equal(over.full, true)
  assert.equal(over.added, false)
  assert.equal(over.items.length, MAX_TRAY)
})

test('removing and asking are by the things the page has', () => {
  const items = addToTray([], item('a')).items
  assert.equal(inTray(items, 'https://example.com/a'), true)
  assert.equal(removeFromTray(items, 'a').length, 0)
})

test('anything that is not a web page is refused rather than repaired', () => {
  assert.equal(normalizeTrayItem({ url: 'javascript:alert(1)' }), null)
  assert.equal(normalizeTrayItem({ url: 'file:///C:/secrets.txt' }), null)
  assert.equal(normalizeTrayItem(null), null)
  assert.equal(normalizeTrayItem({ url: 'https://example.com/x' })?.title, 'https://example.com/x')
})

// ---------------------------------------------------------------- saying what it amounts to

test('an empty comparison says so instead of showing a grid that reads as sameness', () => {
  const pages = [item('a', 'About cats.'), item('b', 'About bridges.')]
  const table = buildComparison(pages, [{ itemId: 'a', fields: [] }, { itemId: 'b', fields: [] }])
  assert.match(describeComparison(table), /nothing in common/i)
})

test('the summary counts what was refused, so a quiet table is not read as a complete one', () => {
  const pages = [item('a', 'Weighs 1.2 kg.'), item('b', 'Weighs 1.4 kg.')]
  const table = buildComparison(pages, [
    { itemId: 'a', fields: [field('weight', '1.2 kg', 'Weighs 1.2 kg'), field('price', '$999', 'Costs $999')] },
    { itemId: 'b', fields: [field('weight', '1.4 kg', 'Weighs 1.4 kg')] }
  ])
  assert.equal(table.rejected, 1)
  assert.match(describeComparison(table), /1 value left out/i)
})
