import assert from 'node:assert/strict'
import { test } from 'node:test'
import { understand } from './intent2.ts'
import { describeDiff, isRepeatedAttempt, reviseBrief, type RevisionBrief } from './revision.ts'

const base = understand('warm piano piece. no vocals. 90 bpm')

test('source separation is analysis-only', () => {
  const b = reviseBrief({ base, request: 'remove the drums from this audio', locked: [] }) as RevisionBrief
  assert.equal(b.workflow, 'analysis-only')
  assert.ok(b.unsupported.length === 1)
  assert.ok(/regenerate with revised wording/i.test(b.alternatives[0]))
})
test('quieter is post-processing, warmer is regeneration', () => {
  assert.equal((reviseBrief({ base, request: 'make it quieter', locked: [] }) as RevisionBrief).workflow, 'post-processing')
  assert.equal((reviseBrief({ base, request: 'fade out at the end', locked: [] }) as RevisionBrief).workflow, 'post-processing')
  assert.equal((reviseBrief({ base, request: 'make it warmer', locked: [] }) as RevisionBrief).workflow, 'regeneration')
})
test('never claims preservation', () => {
  const b = reviseBrief({ base, request: 'more energetic', locked: ['piano'] }) as RevisionBrief
  assert.ok(b.preserve.every((p) => p.basis === 'intended' && p.observed === 'unverified'))
  assert.ok(/not yet measured/.test(b.summaryIntended))
  assert.ok(/nothing is guaranteed/.test(b.summaryIntended))
})
test('drift guard blocks locked contradictions', () => {
  const r = reviseBrief({ base, request: 'remove the piano', locked: ['piano'] })
  assert.equal(r.blocked, true)
  const v = reviseBrief({ base, request: 'add vocals', locked: [] })
  assert.equal(v.blocked, true)
  const t = reviseBrief({ base, request: 'make it 140 bpm', locked: ['90 bpm'] })
  assert.equal(t.blocked, true)
})
test('diff from real differences', () => {
  const next = understand('warm piano piece. no vocals. 120 bpm')
  const d = describeDiff(base, next)
  assert.ok(d.changed.some((c) => /tempoBpm: 90 -> 120/.test(c)))
  assert.ok(d.preserved.some((p) => /avoid vocals/.test(p)))
  assert.ok(d.notGuaranteed.length > 0)
})
test('repeated attempts', () => {
  const h = [{ change: 'make it more energetic', outcome: 'unsuccessful' as const }, { change: 'add strings', outcome: 'successful' as const }]
  assert.equal(isRepeatedAttempt(h, 'Make it more energetic!').repeated, true)
  assert.equal(isRepeatedAttempt(h, 'add strings').repeated, false)
})
