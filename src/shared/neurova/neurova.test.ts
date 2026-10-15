import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENGINES, evaluate, type MachineFacts } from './engines.ts'
import { apply, newJob } from './job.ts'
import { interpret } from './intent.ts'

const facts = (o: Partial<MachineFacts> = {}): MachineFacts => ({
  pythonVersion: '3.12', gpuName: 'GPU', gpuMemoryGb: 12, freeDiskGb: 100,
  filesFound: { 'ace-step': ENGINES[0].requiredFiles, heartmula: ENGINES[1].requiredFiles }, runtimeInstalled: { 'ace-step': true, heartmula: true }, ...o
})
const ace = ENGINES[0]

test('files on disk are never enough to be ready', () => {
  assert.equal(evaluate(ace, facts(), false).readiness, 'unverified')
  assert.equal(evaluate(ace, facts(), true).readiness, 'ready')
})

test('missing pieces are named truthfully', () => {
  assert.equal(evaluate(ace, facts({ pythonVersion: null }), true).readiness, 'no-runtime')
  assert.equal(evaluate(ace, facts({ filesFound: {} }), true).readiness, 'no-model')
  assert.equal(evaluate(ENGINES[1], facts({ gpuName: null }), false).readiness, 'no-accelerator')
  assert.equal(evaluate(ace, facts({ freeDiskGb: 1 }), true).readiness, 'low-disk')
})

test('a job cannot complete without validated output, or leave a terminal state', () => {
  let j = newJob('a')
  j = apply(j, { jobId: 'a', seq: 1, to: 'preparing' })
  j = apply(j, { jobId: 'a', seq: 2, to: 'generating' })
  j = apply(j, { jobId: 'a', seq: 3, to: 'validating' })
  assert.equal(apply(j, { jobId: 'a', seq: 4, to: 'completed' }).state, 'validating')
  j = apply(j, { jobId: 'a', seq: 4, to: 'completed', outputPath: 'x.wav' })
  assert.equal(j.state, 'completed')
  assert.equal(apply(j, { jobId: 'a', seq: 9, to: 'generating' }).state, 'completed')
})

test('stale, foreign and illegal events are ignored', () => {
  const j = apply(newJob('a'), { jobId: 'a', seq: 5, to: 'preparing' })
  assert.equal(apply(j, { jobId: 'a', seq: 3, to: 'generating' }), j)
  assert.equal(apply(j, { jobId: 'b', seq: 6, to: 'generating' }), j)
  assert.equal(apply(newJob('a'), { jobId: 'a', seq: 1, to: 'completed', outputPath: 'x' }).state, 'queued')
})

test('intent keeps the original, flags conflicts, rejects blanks', () => {
  assert.equal(interpret({ prompt: '   ' }).ok, false)
  const r = interpret({ prompt: 'Instrumental piano piece, no drums', lyrics: 'la la' })
  assert.ok(r.ok && r.intent.original === 'Instrumental piano piece, no drums')
  assert.ok(r.ok && r.intent.conflicts.length === 1 && r.intent.lyrics === 'la la')
  assert.ok(r.ok && r.intent.avoid.includes('no drums'))
})
