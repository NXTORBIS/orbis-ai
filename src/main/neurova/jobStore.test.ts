import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobStore, newRecord, reconcile, retryRequest } from './jobStore.ts'

const req = { prompt: 'calm piano', lyrics: '', instrumental: true, durationSec: 30, seed: 7 }
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'jobstore-'))
  return { dir, store: new JobStore(dir, 'default'), done: () => rm(dir, { recursive: true, force: true }) }
}

test('put/get/list/update persist across instances', async () => {
  const { dir, store, done } = await setup()
  await store.put(newRecord({ id: 'a', projectId: 'p', request: req }))
  await store.update('a', { state: 'preparing' }, 'go')
  await store.flush()
  const again = new JobStore(dir, 'default')
  const r = await again.get('a')
  assert.equal(r?.state, 'preparing')
  assert.ok(r?.startedAt)
  assert.equal(r?.history.length, 2)
  assert.equal((await again.list('other')).length, 0)
  await done()
})

test('history is capped at 50', async () => {
  const { store, done } = await setup()
  await store.put(newRecord({ id: 'a', projectId: 'p', request: req }))
  for (let i = 0; i < 70; i++) await store.update('a', { state: i % 2 ? 'preparing' : 'generating' }, 't' + i)
  assert.equal((await store.get('a'))?.history.length, 50)
  await done()
})

test('reconcile interrupts orphaned jobs, keeps running ones, never completes', async () => {
  const { store, done } = await setup()
  await store.put(newRecord({ id: 'gen', projectId: 'p', request: req }))
  await store.update('gen', { state: 'generating' })
  await store.put(newRecord({ id: 'live', projectId: 'p', request: req }))
  await store.update('live', { state: 'preparing' })
  await store.put(newRecord({ id: 'val', projectId: 'p', request: req }))
  await store.update('val', { state: 'validating', outputPath: '/x.wav' })
  const rep = await reconcile(store, { isRunning: (id) => id === 'live', outputExists: async () => true })
  assert.deepEqual(rep.interrupted.map((i) => i.id).sort(), ['gen', 'val'])
  assert.equal((await store.get('val'))?.state, 'interrupted')
  assert.equal((await store.get('live'))?.state, 'preparing')
  await done()
})

test('reconcile flags a completed job whose output vanished', async () => {
  const { store, done } = await setup()
  await store.put({ ...newRecord({ id: 'c', projectId: 'p', request: req }), state: 'completed', outputPath: '/gone.wav' })
  const rep = await reconcile(store, { isRunning: () => false, outputExists: async () => false })
  assert.equal(rep.interrupted.length, 1)
  assert.equal((await store.get('c'))?.state, 'failed')
  await done()
})

test('retryRequest rules', () => {
  const base = { ...newRecord({ id: 'a', projectId: 'p', request: req }), state: 'failed' as const }
  const ok = retryRequest({ ...base, code: 'WORKER_CRASHED' }, { id: 'n' })
  assert.ok(ok.ok && ok.record.attempt === 2 && ok.record.parentId === 'a' && ok.record.id === 'n' && ok.record.state === 'queued')
  const no = retryRequest({ ...base, code: 'OUT_OF_MEMORY' })
  assert.ok(!no.ok && no.code === 'NOT_RETRYABLE')
  const canc = retryRequest({ ...base, state: 'cancelled', userCancelled: true })
  assert.ok(!canc.ok && canc.code === 'USER_CANCELLED')
  assert.ok(!retryRequest({ ...base, code: 'WORKER_CRASHED', attempt: 2 }).ok)
  const live = retryRequest({ ...base, state: 'generating' })
  assert.ok(!live.ok && live.code === 'NOT_FINISHED')
  assert.ok(retryRequest({ ...base, state: 'interrupted' }).ok)
})
