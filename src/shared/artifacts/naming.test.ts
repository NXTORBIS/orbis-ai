import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeName, unique } from './naming.ts'

test('a name loses what no filesystem will take, and keeps the rest', () => {
  assert.equal(safeName('Monthly: Expenses / 2026?'), 'Monthly Expenses 2026')
  assert.equal(safeName('  spaced   out  '), 'spaced out')
  assert.equal(safeName('report...'), 'report')
  assert.equal(safeName('a\u0000b<c>d|e'), 'a b c d e')
})

test('an empty or reserved name falls back rather than becoming a file that cannot exist', () => {
  assert.equal(safeName(''), 'artifact')
  assert.equal(safeName('???'), 'artifact')
  assert.equal(safeName('CON'), 'artifact')
  assert.equal(safeName('com1', 'table'), 'table')
})

test('a long title is cut to something a path can hold', () => {
  assert.ok(safeName('x'.repeat(300)).length <= 80)
})

test('unique counts from two, the way every desktop does', () => {
  const taken = new Set(['report.csv', 'report (2).csv'])
  assert.equal(unique('report', '.csv', (one) => taken.has(one)), 'report (3).csv')
  assert.equal(unique('fresh', '.csv', (one) => taken.has(one)), 'fresh.csv')
})

test('unique gives up rather than looping for ever', () => {
  assert.throws(() => unique('x', '.csv', () => true, 5), /free name/)
})
