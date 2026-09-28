import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  RESOURCE_ASSUMPTIONS,
  RESOURCE_LIMITS,
  cancelFor,
  emptyQueue,
  finish,
  isQueueError,
  nextJob,
  overrunning,
  pressure,
  report,
  start,
  submit,
  sweep,
  type Queue
} from './resources.ts'

const ok = <T>(value: T): Exclude<T, { error: string }> => {
  assert.ok(!isQueueError(value), `expected success, got ${JSON.stringify(value)}`)
  return value as Exclude<T, { error: string }>
}

let counter = 0
const add = (queue: Queue, pageId: string, priority = 0, at = 1000): Queue =>
  ok(submit(queue, { id: `j${counter++}`, pageId, operation: 'expression.evaluate', priority, queuedAt: at }))

/** Runs the queue to completion, recording the order Pages were served in. */
const drain = (queue: Queue, rounds = 40): string[] => {
  const order: string[] = []
  let current = queue
  for (let i = 0; i < rounds; i++) {
    const job = nextJob(current, 1000 + i)
    if (job === null) break
    order.push(job.pageId)
    current = ok(start(current, job.id, 1000 + i))
    current = finish(current, job.id, 'done', 1001 + i)
  }
  return order
}

describe('fair sharing', () => {
  it('takes work from each Page in turn rather than in the order it arrived', () => {
    // A flooded queue from one Page, one job from another. FIFO would make the second wait for all of the first.
    let queue = emptyQueue
    for (let i = 0; i < 10; i++) queue = add(queue, 'flooder')
    queue = add(queue, 'polite')

    const order = drain(queue)
    // The polite Page is served in the first two turns, not after ten.
    assert.ok(order.slice(0, 2).includes('polite'), `order was ${order.join(', ')}`)
  })

  it('alternates between Pages that both have work', () => {
    let queue = emptyQueue
    for (let i = 0; i < 4; i++) {
      queue = add(queue, 'a')
      queue = add(queue, 'b')
    }
    const order = drain(queue)
    // No Page gets two turns in a row while the other is waiting.
    for (let i = 0; i + 1 < order.length; i++) {
      assert.notEqual(order[i], order[i + 1], `order was ${order.join(', ')}`)
    }
  })

  it('lets a Page order its own work by priority', () => {
    let queue = emptyQueue
    queue = ok(submit(queue, { id: 'low', pageId: 'a', operation: 'x', priority: 0, queuedAt: 1000 }))
    queue = ok(submit(queue, { id: 'high', pageId: 'a', operation: 'x', priority: 9, queuedAt: 1001 }))
    assert.equal(nextJob(queue, 2000)?.id, 'high')
  })

  it('does not let a Page jump ahead of another by calling its own work urgent', () => {
    let queue = emptyQueue
    queue = ok(submit(queue, { id: 'theirs', pageId: 'quiet', operation: 'x', priority: 0, queuedAt: 1000 }))
    queue = ok(submit(queue, { id: 'mine', pageId: 'pushy', operation: 'x', priority: 99, queuedAt: 1001 }))
    // Both Pages have been served equally (not at all), so the tie goes to the first listed, not the loudest.
    const first = nextJob(queue, 2000)
    assert.equal(first?.pageId, 'quiet', 'priority must not cross a Page boundary')
  })

  it('breaks a tie within a Page by age, not by chance', () => {
    let queue = emptyQueue
    queue = ok(submit(queue, { id: 'later', pageId: 'a', operation: 'x', priority: 5, queuedAt: 2000 }))
    queue = ok(submit(queue, { id: 'earlier', pageId: 'a', operation: 'x', priority: 5, queuedAt: 1000 }))
    assert.equal(nextJob(queue, 3000)?.id, 'earlier')
  })
})

describe('limits', () => {
  it('refuses a Page more jobs than it may have, and names its own limit', () => {
    let queue = emptyQueue
    for (let i = 0; i < RESOURCE_LIMITS.perPage; i++) queue = add(queue, 'busy')
    const refused = submit(queue, { id: 'one-more', pageId: 'busy', operation: 'x', priority: 0, queuedAt: 1000 })
    assert.ok(isQueueError(refused))
    assert.equal(refused.error, 'too-many-for-page')
    assert.match(refused.message, /This Page already has/)
  })

  it('still accepts work from a different Page when one has filled its own quota', () => {
    let queue = emptyQueue
    for (let i = 0; i < RESOURCE_LIMITS.perPage; i++) queue = add(queue, 'busy')
    assert.ok(!isQueueError(submit(queue, { id: 'other', pageId: 'quiet', operation: 'x', priority: 0, queuedAt: 1000 })))
  })

  it('refuses when everything is full, and says so differently', () => {
    let queue = emptyQueue
    let page = 0
    while (queue.jobs.filter((one) => one.state === 'queued').length < RESOURCE_LIMITS.total) {
      queue = add(queue, `page${Math.floor(page / RESOURCE_LIMITS.perPage)}`)
      page += 1
    }
    const refused = submit(queue, { id: 'extra', pageId: 'newcomer', operation: 'x', priority: 0, queuedAt: 1000 })
    assert.ok(isQueueError(refused))
    assert.equal(refused.error, 'too-many-overall')
  })

  it('runs no more at once than it has workers for', () => {
    let queue = emptyQueue
    for (let i = 0; i < 10; i++) queue = add(queue, `page${i}`)
    for (let i = 0; i < RESOURCE_LIMITS.workers; i++) {
      const job = nextJob(queue, 1000)
      assert.ok(job !== null, `expected a job on turn ${i + 1}`)
      queue = ok(start(queue, job.id, 1000))
    }
    assert.equal(nextJob(queue, 1000), null, 'it handed out more work than it has workers')
  })
})

describe('jobs ending', () => {
  it('records a job as done', () => {
    let queue = add(emptyQueue, 'a')
    const job = nextJob(queue, 1000)
    assert.ok(job !== null)
    queue = ok(start(queue, job.id, 1000))
    queue = finish(queue, job.id, 'done', 1500)
    assert.equal(queue.jobs[0].state, 'done')
    assert.equal(queue.jobs[0].finishedAt, 1500)
  })

  it('refuses to start a job that is not waiting', () => {
    assert.ok(isQueueError(start(emptyQueue, 'nothing', 1000)))
    let queue = add(emptyQueue, 'a')
    const job = nextJob(queue, 1000)
    queue = ok(start(queue, (job as { id: string }).id, 1000))
    assert.ok(isQueueError(start(queue, (job as { id: string }).id, 1000)), 'a running job should not start twice')
  })

  it('stops a job that has run too long, and says it was stopped rather than that it failed', () => {
    let queue = add(emptyQueue, 'a')
    const job = nextJob(queue, 1000)
    queue = ok(start(queue, (job as { id: string }).id, 1000))
    const later = 1000 + RESOURCE_LIMITS.jobMs + 1
    assert.equal(overrunning(queue, later).length, 1)

    const swept = sweep(queue, later)
    assert.equal(swept.abandoned.length, 1)
    assert.equal(swept.queue.jobs[0].state, 'abandoned')
    assert.match(swept.queue.jobs[0].note, /It did not fail; it was cut short/)
  })

  it('leaves a job that is still within its time alone', () => {
    let queue = add(emptyQueue, 'a')
    const job = nextJob(queue, 1000)
    queue = ok(start(queue, (job as { id: string }).id, 1000))
    assert.equal(sweep(queue, 1500).abandoned.length, 0)
  })

  it('forgets a finished job once its result can no longer be wanted', () => {
    let queue = add(emptyQueue, 'a')
    const job = nextJob(queue, 1000)
    queue = ok(start(queue, (job as { id: string }).id, 1000))
    queue = finish(queue, (job as { id: string }).id, 'done', 1100)
    assert.equal(sweep(queue, 1200).queue.jobs.length, 1, 'a fresh result should still be collectable')
    assert.equal(sweep(queue, 1100 + RESOURCE_LIMITS.resultMs + 1).queue.jobs.length, 0)
  })

  it('cancels everything belonging to a Page that closed', () => {
    let queue = emptyQueue
    queue = add(queue, 'closing')
    queue = add(queue, 'closing')
    queue = add(queue, 'staying')
    queue = cancelFor(queue, 'closing', 2000)
    assert.equal(queue.jobs.filter((one) => one.state === 'cancelled').length, 2)
    assert.equal(queue.jobs.filter((one) => one.state === 'queued').length, 1)
  })

  it('leaves an already-finished job alone when its Page closes', () => {
    let queue = add(emptyQueue, 'a')
    const job = nextJob(queue, 1000)
    queue = ok(start(queue, (job as { id: string }).id, 1000))
    queue = finish(queue, (job as { id: string }).id, 'done', 1100)
    queue = cancelFor(queue, 'a', 2000)
    assert.equal(queue.jobs[0].state, 'done')
  })
})

describe('reporting', () => {
  it('says nothing is waiting when nothing is', () => {
    assert.equal(report(emptyQueue, 1000).describe, 'Nothing is waiting.')
  })

  it('counts what is waiting and running', () => {
    let queue = emptyQueue
    for (let i = 0; i < 3; i++) queue = add(queue, 'a')
    const job = nextJob(queue, 1000)
    queue = ok(start(queue, (job as { id: string }).id, 1000))
    const result = report(queue, 1000)
    assert.equal(result.running, 1)
    assert.equal(result.queued, 2)
  })

  it('says work is taken in turn, so somebody waiting knows why', () => {
    let queue = emptyQueue
    queue = add(queue, 'a')
    queue = add(queue, 'b')
    assert.match(report(queue, 1000).describe, /taken in turn/)
  })

  it('reports the longest wait', () => {
    const queue = add(emptyQueue, 'a', 0, 1000)
    assert.equal(report(queue, 5000).longestWaitMs, 4000)
  })
})

describe('memory pressure', () => {
  it('says there is plenty of room when there is', () => {
    const result = pressure({ used: 10, available: 100, pages: 1 })
    assert.equal(result.level, 'comfortable')
    assert.deepEqual([...result.shed], [])
  })

  it('has a middle state, so it does less before it stops doing anything', () => {
    const result = pressure({ used: 80, available: 100, pages: 2 })
    assert.equal(result.level, 'tight')
    assert.ok(result.shed.length > 0)
    assert.match(result.describe, /avoids having to stop later/)
  })

  it('says what to give up in order, cheapest first', () => {
    const result = pressure({ used: 95, available: 100, pages: 5 })
    assert.equal(result.level, 'critical')
    // The first suggestion costs almost nothing; the last is the one somebody would notice.
    assert.match(result.shed[0], /fewer points/)
    assert.match(result.shed[result.shed.length - 1], /can be closed/)
  })

  it('only refuses new work at the critical level', () => {
    assert.ok(!pressure({ used: 80, available: 100, pages: 1 }).shed.some((one) => /Refuse new work/.test(one)))
    assert.ok(pressure({ used: 99, available: 100, pages: 1 }).shed.some((one) => /Refuse new work/.test(one)))
  })

  it('never reports a fraction outside zero to one', () => {
    assert.equal(pressure({ used: 500, available: 100, pages: 1 }).fraction, 1)
    assert.equal(pressure({ used: 0, available: 100, pages: 1 }).fraction, 0)
  })

  it('does not divide by zero when nothing is available', () => {
    const result = pressure({ used: 10, available: 0, pages: 1 })
    assert.ok(Number.isFinite(result.fraction))
    assert.equal(result.level, 'critical')
  })
})

describe('assumptions', () => {
  it('says work is taken from each Page in turn', () => {
    assert.ok(RESOURCE_ASSUMPTIONS.some((one) => /in turn, not in the order it arrived/.test(one)))
  })

  it('says a Page cannot jump ahead of another', () => {
    assert.ok(RESOURCE_ASSUMPTIONS.some((one) => /never jumps ahead of another Page/.test(one)))
  })

  it('says being stopped and failing are different', () => {
    assert.ok(RESOURCE_ASSUMPTIONS.some((one) => /stopped and failing are different/.test(one)))
  })
})
