import test from 'node:test'
import assert from 'node:assert/strict'
import { anomaly, compare, withoutNoise } from './workflowDiff.ts'

const nl = (...rows: string[]): string => rows.join('\n')

// ---------------------------------------------------------------- noise is not news

test('the things that change on their own are recognised as noise', () => {
  assert.equal(withoutNoise('Updated 3 minutes ago'), 'Updated')
  assert.equal(withoutNoise('412,908 views'), '')
  assert.equal(withoutNoise('Posted at 14:32'), 'Posted at')
  assert.equal(withoutNoise('session=ab12cd34ef56'), '')
  assert.equal(withoutNoise('Advertisement'), '')
})

test('a page whose only differences are a clock and a counter has not changed', () => {
  const before = nl('Orbis Widget', '£24.99', 'In stock', 'Updated 3 minutes ago', '412 views')
  const after = nl('Orbis Widget', '£24.99', 'In stock', 'Updated 9 minutes ago', '415 views')
  const result = compare(before, after)
  assert.equal(result.changed, false)
  assert.equal(result.summary, 'Nothing meaningful changed.')
})

test('a real change alongside noise is still found', () => {
  // The whole point: the noise must not hide the price, and the price must not be lost in the noise.
  const before = nl('Orbis Widget', '£24.99', 'In stock', 'Updated 3 minutes ago')
  const after = nl('Orbis Widget', '£19.99', 'In stock', 'Updated 9 minutes ago')
  const result = compare(before, after)
  assert.equal(result.changed, true)
  assert.equal(result.changes.length, 1)
  assert.deepEqual(
    { kind: result.changes[0].kind, before: result.changes[0].before, after: result.changes[0].after },
    { kind: 'changed', before: '£24.99', after: '£19.99' }
  )
})

test('an edit is reported as one change with both values, not a removal and an addition', () => {
  const result = compare('Availability: In stock', 'Availability: Sold out')
  assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0].kind, 'changed')
  assert.match(result.summary, /“Availability: In stock” became “Availability: Sold out”/)
})

test('something genuinely new is added, and something gone is removed', () => {
  const result = compare(nl('A', 'B'), nl('A', 'C is entirely different text here'))
  const kinds = result.changes.map((c) => c.kind).sort()
  assert.deepEqual(kinds, ['added', 'removed'])
})

test('reflowing whitespace is not a change', () => {
  assert.equal(compare('Price   £10\n\n\nIn stock', 'Price £10\nIn stock').changed, false)
})

test('the summary says what changed rather than that something did', () => {
  const result = compare('Status: pending', 'Status: shipped')
  assert.doesNotMatch(result.summary, /^The page changed/)
  assert.match(result.summary, /pending.*shipped/)
})

test('a long list of changes is capped, and says how many were left out', () => {
  const before = nl(...Array.from({ length: 40 }, (_, i) => `row ${i} old`))
  const after = nl(...Array.from({ length: 40 }, (_, i) => `row ${i} new`))
  const result = compare(before, after, 5)
  assert.equal(result.changes.length, 5)
  assert.match(result.summary, /more\)/)
})

// ---------------------------------------------------------------- when the page stops being the page

test('being locked out is not a change to the page', () => {
  // Reporting this as "the price changed" would be reporting a fact about the watcher as a fact about the world.
  const found = anomaly('Orbis Widget\n£24.99\nIn stock', 'Verify you are human to continue')
  assert.equal(found?.anomaly, 'blocked')
  assert.match(found!.detail, /cannot be read/)
})

test('rate limiting is recognised for what it is', () => {
  assert.equal(anomaly('Some content here', 'Too many requests. Try again later.')?.anomaly, 'rate-limited')
})

test('a page that has gone says so', () => {
  assert.equal(anomaly('Product page', '404 Page not found')?.anomaly, 'gone')
})

test('a page that came back empty is not reported as everything being deleted', () => {
  const before = nl(...Array.from({ length: 12 }, (_, i) => `line ${i}`))
  const found = anomaly(before, '')
  assert.equal(found?.anomaly, 'emptied')
  assert.match(found!.detail, /may not have finished loading/)
})

test('an entirely different page is not an edit to the old one', () => {
  const before = nl(...Array.from({ length: 12 }, (_, i) => `original line ${i}`))
  const after = nl(...Array.from({ length: 12 }, (_, i) => `completely unrelated content ${i}`))
  assert.equal(anomaly(before, after)?.anomaly, 'replaced')
})

test('an ordinary change is not an anomaly', () => {
  const before = nl(...Array.from({ length: 12 }, (_, i) => `line ${i}`))
  const after = nl(...Array.from({ length: 12 }, (_, i) => (i === 3 ? 'line 3 changed' : `line ${i}`)))
  assert.equal(anomaly(before, after), null)
})

test('a page that was already behind a sign-in has not just become blocked', () => {
  assert.equal(anomaly('Sign in to continue', 'Sign in to continue'), null)
})
