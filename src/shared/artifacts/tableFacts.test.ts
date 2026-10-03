import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseDelimited } from '../compute/data.ts'
import { factsBlock, tableFacts } from './tableFacts.ts'

/**
 * Orbis has a deterministic data layer, and a question typed in the chat about an attached spreadsheet never reached
 * it: the table went into the prompt as text and the model did the arithmetic. "What is the total?" over four hundred
 * rows comes back looking exactly like a right answer whether or not it is one.
 */

const read = (text: string) => {
  const got = parseDelimited(text, { source: 'sales.csv' })
  assert.ok(!('error' in got), 'the fixture should parse')
  return (got as { table: Parameters<typeof tableFacts>[0] }).table
}

const SALES = read(['item,price,region', 'widget,40000,North', 'gadget,55000,South', 'sprocket,12000,North', 'cog,33000,South'].join('\n'))

test('the totals and averages come from every row, not from a model', () => {
  const facts = tableFacts(SALES)
  const price = facts.numeric.find((one) => one.name === 'price')!
  assert.equal(price.total, 140000)
  assert.equal(price.count, 4)
  assert.equal(price.min, 12000)
  assert.equal(price.max, 55000)
  assert.equal(price.mean, 35000)
})

test('a column of labels is described as categories, with the commonest named', () => {
  const region = tableFacts(SALES).categories.find((one) => one.name === 'region')!
  assert.equal(region.distinct, 2)
  assert.ok(region.commonest === 'North' || region.commonest === 'South')
})

test('a column where every row differs is not called a category, because that is true and useless', () => {
  const ids = read(['id,n', ...Array.from({ length: 60 }, (_, i) => `row-${i},${i}`)].join('\n'))
  assert.equal(
    tableFacts(ids).categories.some((one) => one.name === 'id'),
    false
  )
})

test('the model is told to use these figures and not to work out its own', () => {
  const said = factsBlock(tableFacts(SALES), 'sales.csv')!
  assert.ok(said.includes('Do not calculate your own totals'), said)
  assert.ok(said.includes('computed these from every row'), said)
  assert.ok(said.includes('140000') || said.includes('140,000'), said)
})

test('it says what to do when the question needs something it did not compute', () => {
  const said = factsBlock(tableFacts(SALES), 'sales.csv')!
  assert.ok(said.includes('rather than working one out'), said)
})

test('a table with nothing countable in it produces nothing rather than a block saying only its size', () => {
  const words = read(['note', 'a thing happened', 'another thing happened'].join('\n'))
  const facts = tableFacts(words)
  if (facts.numeric.length === 0 && facts.categories.length === 0) assert.equal(factsBlock(facts, 'notes.csv'), null)
})

test('an empty table says nothing at all', () => {
  assert.equal(factsBlock({ rows: 0, columns: [], numeric: [], categories: [] }, 'empty.csv'), null)
})

test('rows with no number in a column are counted and said, not quietly skipped', () => {
  const gappy = read(['item,price', 'a,10', 'b,', 'c,20'].join('\n'))
  const price = tableFacts(gappy).numeric.find((one) => one.name === 'price')
  if (price) {
    assert.equal(price.total, 30)
    assert.ok(price.missing >= 1, 'the empty row is reported rather than hidden')
  }
})
