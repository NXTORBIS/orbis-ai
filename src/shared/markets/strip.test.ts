import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_STRIP_SLOTS, stripInstruments, stripIsSparse, stripSlots } from './strip.ts'

const ask = (over: Partial<Parameters<typeof stripSlots>[0]> = {}) =>
  stripSlots({ chosen: [], viewed: [], watched: [], slots: 8, auto: true, ...over })

test('a chosen group comes first, in the order it was built', () => {
  const out = ask({ chosen: ['c', 'a', 'b'], viewed: ['z'] })
  assert.deepEqual(
    out.slice(0, 3).map((one) => one.instrumentId),
    ['c', 'a', 'b']
  )
  assert.ok(out.every((one) => (['c', 'a', 'b'] as string[]).includes(one.instrumentId) ? one.origin === 'chosen' : true))
})

test('with auto off the rail is the group and nothing else', () => {
  const out = ask({ chosen: ['a'], viewed: ['b', 'c'], watched: ['d'], auto: false })
  assert.deepEqual(out, [{ instrumentId: 'a', origin: 'chosen' }])
})

test('an empty group with auto off shows an empty strip rather than a filled one', () => {
  // The honest answer to "I have not chosen anything yet" is nothing, not a popular coin.
  assert.deepEqual(ask({ viewed: ['b'], watched: ['c'], auto: false }), [])
})

test('auto fills from what was viewed, newest first, then from what is already watched', () => {
  const out = ask({ chosen: ['a'], viewed: ['v1', 'v2'], watched: ['w1'], slots: 4 })
  assert.deepEqual(out, [
    { instrumentId: 'a', origin: 'chosen' },
    { instrumentId: 'v1', origin: 'viewed' },
    { instrumentId: 'v2', origin: 'viewed' },
    { instrumentId: 'w1', origin: 'watched' }
  ])
})

test('a market in two sources appears once, credited to the strongest', () => {
  const out = ask({ chosen: ['a'], viewed: ['a', 'b'], watched: ['a', 'b'] })
  assert.deepEqual(out, [
    { instrumentId: 'a', origin: 'chosen' },
    { instrumentId: 'b', origin: 'viewed' }
  ])
})

test('filling stops at the slot count', () => {
  const out = ask({ viewed: ['v1', 'v2', 'v3', 'v4', 'v5'], slots: 3 })
  assert.equal(out.length, 3)
})

test('a chosen group longer than the slots is kept whole', () => {
  // The slots are a target for filling, not a limit on what somebody asked to see.
  const chosen = ['a', 'b', 'c', 'd', 'e']
  const out = ask({ chosen, slots: 2, viewed: ['v'] })
  assert.deepEqual(
    out.map((one) => one.instrumentId),
    chosen,
    'the whole group, and no filling on top of an already-overrunning rail'
  )
})

test('the slot count is bounded however it is asked for', () => {
  const many = Array.from({ length: 200 }, (_, i) => `v${i}`)
  assert.equal(ask({ viewed: many, slots: 10_000 }).length, MAX_STRIP_SLOTS)
  assert.deepEqual(ask({ viewed: many, slots: -5 }), [])
  assert.deepEqual(ask({ viewed: many, slots: Number.NaN }), [])
})

test('blank and repeated ids never reach the rail', () => {
  const out = ask({ viewed: ['', 'a', 'a', ''] })
  assert.deepEqual(out, [{ instrumentId: 'a', origin: 'viewed' }])
})

test('stripInstruments is the same answer without the origins', () => {
  const request = { chosen: ['a'], viewed: ['b'], watched: [], slots: 8, auto: true }
  assert.deepEqual(stripInstruments(request), ['a', 'b'])
})

test('a short rail is reported as short, so the strip can say so instead of looking stuck', () => {
  assert.equal(stripIsSparse(ask({ viewed: ['a', 'b'] })), true)
  assert.equal(stripIsSparse(ask({ viewed: ['a', 'b', 'c', 'd'] })), false)
})
