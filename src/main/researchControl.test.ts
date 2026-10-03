import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ResearchControl, type RunView } from './researchControl.ts'
import { makePlan } from '../shared/researchRun.ts'

/**
 * Holding a research run, for real.
 *
 * The thing worth testing is not that a button exists but that a paused run is a run that is not doing anything. A
 * "pause" that lets the work carry on and only changes a label is worse than no pause at all.
 */

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

test('a run that is not paused goes straight through', async () => {
  const control = new ResearchControl()
  const gate = control.begin({ id: 'r1', question: 'x', showPlanFirst: false, notify: () => undefined })
  const plan = await gate('planning', makePlan({ queries: ['one'] }))
  assert.deepEqual(plan.queries, ['one'])
  control.end('r1')
})

test('a paused run really stops: the stage after it does not happen until it is let go', async () => {
  const control = new ResearchControl()
  const gate = control.begin({ id: 'r2', question: 'x', showPlanFirst: false, notify: () => undefined })
  await gate('planning', makePlan({ queries: ['one'] }))

  control.pause('r2')
  let wentOn = false
  const waiting = gate('searching', makePlan({ queries: ['one'] })).then((plan) => {
    wentOn = true
    return plan
  })

  await settle()
  await settle()
  assert.equal(wentOn, false, 'it is still held')

  control.resume('r2')
  await waiting
  assert.equal(wentOn, true)
  control.end('r2')
})

test('showing the plan first holds it at the one stage where the searches can still change', async () => {
  const control = new ResearchControl()
  const gate = control.begin({ id: 'r3', question: 'x', showPlanFirst: true, notify: () => undefined })
  let started = false
  const waiting = gate('planning', makePlan({ queries: ['first guess'] })).then((plan) => {
    started = true
    return plan
  })
  await settle()
  assert.equal(started, false, 'nothing is searched until the plan is agreed')

  control.change('r3', { queries: ['a better search'] })
  control.resume('r3')
  const plan = await waiting
  assert.deepEqual(plan.queries, ['a better search'], 'and what was searched is what was agreed')
  control.end('r3')
})

test('a change asked for mid-run is applied at the next stage, and said', async () => {
  const control = new ResearchControl()
  const notes: (string | null)[] = []
  const gate = control.begin({ id: 'r4', question: 'x', showPlanFirst: false, notify: (_v, note) => notes.push(note) })
  await gate('planning', makePlan({ queries: ['one'] }))

  control.change('r4', { prefer: ['official'] })
  const plan = await gate('reading', makePlan({ queries: ['one'] }))
  assert.deepEqual(plan.prefer.prefer, ['official'])
  assert.ok(notes.some((n) => n?.includes('official')), JSON.stringify(notes))
  control.end('r4')
})

test('a change that arrives too late says so instead of being silently dropped', async () => {
  const control = new ResearchControl()
  const notes: (string | null)[] = []
  const gate = control.begin({ id: 'r5', question: 'x', showPlanFirst: false, notify: (_v, note) => notes.push(note) })
  await gate('planning', makePlan({ queries: ['one'] }))

  control.change('r5', { queries: ['too late'] })
  const plan = await gate('searching', makePlan({ queries: ['one'] }))
  assert.deepEqual(plan.queries, ['one'])
  assert.ok(notes.some((n) => n?.includes('too late')), JSON.stringify(notes))
  control.end('r5')
})

test('a run that ends while paused does not leave anything waiting for ever', async () => {
  const control = new ResearchControl()
  const gate = control.begin({ id: 'r6', question: 'x', showPlanFirst: false, notify: () => undefined })
  await gate('planning', makePlan({ queries: ['one'] }))
  control.pause('r6')
  const waiting = gate('reading', makePlan({ queries: ['one'] }))
  await settle()
  control.end('r6')
  await waiting
  assert.deepEqual(control.list(), [])
})

test('what is running is reported as what it is, not as what it was asked to be', async () => {
  const control = new ResearchControl()
  const seen: RunView[] = []
  const gate = control.begin({ id: 'r7', question: 'how long do batteries last', showPlanFirst: false, notify: (view) => seen.push(view) })
  await gate('planning', makePlan({ queries: ['battery life'], recency: 'month' }))
  const view = control.list()[0]
  assert.equal(view.stage, 'planning')
  assert.equal(view.paused, false)
  assert.ok(view.plan[0].includes('battery life'))
  assert.ok(seen.length > 0)
  control.end('r7')
})

test('pausing or changing something that is not running changes nothing', () => {
  const control = new ResearchControl()
  assert.equal(control.pause('nothing'), false)
  assert.equal(control.resume('nothing'), false)
  assert.equal(control.change('nothing', { prefer: ['news'] }), false)
})
