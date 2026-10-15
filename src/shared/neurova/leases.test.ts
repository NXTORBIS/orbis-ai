import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LeaseManager } from './leases.ts'

const mk = (budget = 16) => { const c = { t: 1000 }; return { c, m: new LeaseManager({ memoryBudgetGb: budget, defaultTtlMs: 5000, now: () => c.t }) } }

test('a free resource is granted; a held one is refused with a readable reason', () => {
  const { m } = mk()
  assert.ok(m.acquire({ owner: 'song', resources: ['cpu-heavy'] }).ok)
  const b = m.acquire({ owner: 'install', resources: ['cpu-heavy'] })
  assert.ok(!b.ok)
  if (!b.ok) { assert.equal(b.code, 'resource-busy'); assert.match(b.reason, /heavy processing is being used by song/); assert.deepEqual(b.heldBy, ['song']) }
})
test('different resources do not block each other', () => {
  const { m } = mk()
  assert.ok(m.acquire({ owner: 'a', resources: ['gpu'] }).ok)
  assert.ok(m.acquire({ owner: 'b', resources: ['cpu-heavy'] }).ok)
})
test('memory is never granted beyond the budget', () => {
  const { m } = mk(10)
  assert.ok(m.acquire({ owner: 'a', memoryGb: 6 }).ok)
  const r = m.acquire({ owner: 'b', memoryGb: 5 })
  assert.ok(!r.ok && r.code === 'memory-full')
  assert.ok(m.acquire({ owner: 'c', memoryGb: 4 }).ok)
  assert.equal(m.snapshot().memoryUsedGb, 10)
  const big = m.acquire({ owner: 'd', memoryGb: 11 })
  assert.ok(!big.ok && big.code === 'too-large')
})
test('release frees; a second release is a no-op and cannot free someone else', () => {
  const { m } = mk()
  const a = m.acquire({ owner: 'a', resources: ['gpu'] })
  assert.ok(a.ok)
  if (!a.ok) return
  assert.equal(m.release(a.lease), true)
  assert.ok(m.acquire({ owner: 'b', resources: ['gpu'] }).ok)
  assert.equal(m.release(a.lease), false)
  assert.equal(m.snapshot().held.length, 1)
})
test('run releases even when the work throws', async () => {
  const { m } = mk()
  await assert.rejects(m.run({ owner: 'a', resources: ['gpu'] }, () => { throw new Error('boom') }), /boom/)
  assert.equal(m.snapshot().held.length, 0)
  const r = await m.run({ owner: 'a', resources: ['gpu'] }, () => 7)
  assert.ok(r.ok && r.value === 7)
})
test('run refuses instead of waiting when busy', async () => {
  const { m } = mk()
  m.acquire({ owner: 'x', resources: ['gpu'] })
  assert.ok(!(await m.run({ owner: 'y', resources: ['gpu'] }, () => 1)).ok)
})
test('stale leases are reclaimed; a renewed one is kept; the late release is a no-op', () => {
  const { m, c } = mk()
  const a = m.acquire({ owner: 'a', resources: ['gpu'], ttlMs: 1000 })
  const b = m.acquire({ owner: 'b', resources: ['cpu-heavy'], ttlMs: 1000 })
  assert.ok(a.ok && b.ok)
  if (!a.ok || !b.ok) return
  c.t += 500
  assert.equal(m.renew(b.lease, 1000), true)
  c.t += 600
  assert.deepEqual(m.sweep().map((l) => l.owner), ['a'])
  assert.equal(m.release(a.lease), false)
  assert.equal(m.renew(a.lease), false)
  assert.equal(m.snapshot().held.length, 1)
  assert.ok(m.acquire({ owner: 'c', resources: ['gpu'] }).ok)
})
test('acquire sweeps first, so a stale holder never blocks', () => {
  const { m, c } = mk()
  m.acquire({ owner: 'a', resources: ['gpu'], ttlMs: 100 })
  c.t += 200
  assert.ok(m.acquire({ owner: 'b', resources: ['gpu'] }).ok)
})
test('waiters are served first-in-first-out and nobody jumps the line', async () => {
  const { m } = mk(10)
  const first = m.acquire({ owner: 'first', resources: ['gpu'], memoryGb: 8 })
  assert.ok(first.ok)
  if (!first.ok) return
  const order: string[] = []
  const w1 = m.wait({ owner: 'big', resources: ['gpu'], memoryGb: 8 }).then((r) => { order.push('big'); return r })
  const w2 = m.wait({ owner: 'small', memoryGb: 1 }).then((r) => { order.push('small'); return r })
  const direct = m.acquire({ owner: 'sneak', memoryGb: 1 })
  assert.ok(!direct.ok && direct.code === 'queued-ahead')
  assert.deepEqual(m.snapshot().waiting.map((w) => w.owner), ['big', 'small'])
  m.release(first.lease)
  assert.ok((await w1).ok)
  assert.ok((await w2).ok)
  assert.deepEqual(order, ['big', 'small'])
})
test('an aborted waiter leaves the line and unblocks the next', async () => {
  const { m } = mk()
  assert.ok(m.acquire({ owner: 'h', resources: ['gpu'] }).ok)
  const ac = new AbortController()
  const w1 = m.wait({ owner: 'w1', resources: ['gpu'] }, ac.signal)
  const w2 = m.wait({ owner: 'w2', memoryGb: 1 })
  ac.abort()
  assert.ok(!(await w1).ok)
  assert.ok((await w2).ok)
})
test('invalid requests are refused', () => {
  const { m } = mk()
  for (const bad of [{ owner: '' }, { owner: 'a', memoryGb: -1 }, { owner: 'a', memoryGb: NaN }, { owner: 'a', ttlMs: 0 }]) {
    const r = m.acquire(bad)
    assert.ok(!r.ok && r.code === 'invalid')
  }
  assert.equal(m.snapshot().held.length, 0)
})
test('snapshot reports held, waiting and time left', () => {
  const { m, c } = mk()
  m.acquire({ owner: 'a', resources: ['gpu'], memoryGb: 2, ttlMs: 4000 })
  void m.wait({ owner: 'b', resources: ['gpu'] })
  c.t += 1000
  const s = m.snapshot()
  assert.equal(s.held[0].heldMs, 1000)
  assert.equal(s.held[0].expiresInMs, 3000)
  assert.equal(s.waiting[0].owner, 'b')
  assert.equal(s.memoryUsedGb, 2)
})
