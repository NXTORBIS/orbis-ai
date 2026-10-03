import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { applyChange, changeNote, describePlan, makePlan, MAX_PLANNED_QUERIES, reachable } from './researchRun.ts'

/**
 * Research used to be one call you could only stop, and stopping threw away every page it had read. These guard the
 * two halves of the fix: what a change to a plan does, and -- the harder half -- what it honestly cannot do any more.
 */

const PLAN = makePlan({ queries: ['lithium battery life'], recency: 'month', prefer: { prefer: [], avoid: [], blocked: [] } })

test('a plan is checked, deduplicated and capped', () => {
  const plan = makePlan({ queries: ['  a  b  ', 'A B', 'c', 'd', 'e'], recency: 'week' })
  assert.deepEqual(plan.queries, ['a b', 'c', 'd'])
  assert.equal(plan.queries.length, MAX_PLANNED_QUERIES)
  assert.equal(plan.recency, 'week')
})

test('a plan with nonsense in it comes back sensible rather than broken', () => {
  const plan = makePlan({ queries: ['', '   '], recency: 'whenever', prefer: 'rubbish' })
  assert.deepEqual(plan.queries, [])
  assert.equal(plan.recency, 'any')
  assert.deepEqual(plan.prefer.prefer, [])
})

test('before anything has run, everything about the plan can be changed', () => {
  assert.deepEqual(reachable('planning'), { queries: true, recency: true, sources: true })
})

test('once the searches are away they cannot be changed, and that is said', () => {
  const applied = applyChange(PLAN, { queries: ['something else'] }, 'searching')
  assert.deepEqual(applied.plan.queries, PLAN.queries, 'the plan is untouched')
  assert.deepEqual(applied.changed, [])
  assert.ok(applied.tooLate[0].includes('already been sent'), applied.tooLate[0])
})

test('which sources are preferred can still be changed while pages are being read', () => {
  const applied = applyChange(PLAN, { prefer: ['official'] }, 'reading')
  assert.deepEqual(applied.plan.prefer.prefer, ['official'])
  assert.ok(applied.changed[0].includes('official'), applied.changed[0])
  assert.deepEqual(applied.tooLate, [])
})

test('a change arriving after everything is read is refused, not pretended', () => {
  const applied = applyChange(PLAN, { prefer: ['academic'] }, 'done')
  assert.deepEqual(applied.plan, PLAN)
  assert.deepEqual(applied.changed, [])
  assert.ok(applied.tooLate[0].includes('already been read'), applied.tooLate[0])
})

test('changing the searches before anything runs really changes them', () => {
  const applied = applyChange(PLAN, { queries: ['battery degradation study'] }, 'planning')
  assert.deepEqual(applied.plan.queries, ['battery degradation study'])
  assert.ok(applied.changed[0].includes('battery degradation study'))
})

test('blocking a site mid-run reaches the pages not yet read', () => {
  const applied = applyChange(PLAN, { blocked: ['example.com'] }, 'reading')
  assert.deepEqual(applied.plan.prefer.blocked, ['example.com'])
  assert.ok(applied.changed[0].includes('example.com'))
})

test('a change that asks for what is already true changes nothing and claims nothing', () => {
  const applied = applyChange(PLAN, { recency: 'month' }, 'planning')
  assert.deepEqual(applied.changed, [])
  assert.deepEqual(applied.tooLate, [])
  assert.equal(changeNote(applied), null)
})

test('what is said about a change is what happened, never both at once', () => {
  const done = changeNote(applyChange(PLAN, { prefer: ['official'] }, 'reading'))!
  assert.ok(done.startsWith('Now '), done)
  const late = changeNote(applyChange(PLAN, { queries: ['x'] }, 'reading'))!
  assert.ok(late.includes('too late'), late)
})

test('a plan says what it is going to do, in words', () => {
  const lines = describePlan(makePlan({ queries: ['one', 'two'], recency: 'week', prefer: { prefer: ['official'], blocked: ['x.example'] } }))
  assert.ok(lines[0].includes('Search for "one"'))
  assert.ok(lines.some((l) => l.includes('past week')))
  assert.ok(lines.some((l) => l.includes('official')))
  assert.ok(lines.some((l) => l.includes('x.example')))
})

test('a plan with nothing special to say says only its searches', () => {
  assert.deepEqual(describePlan(makePlan({ queries: ['one'] })), ['1. Search for "one"'])
})
