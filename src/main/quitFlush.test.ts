import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { QuitFlush } from './quitFlush.ts'

/**
 * The bug being guarded: `app.on('before-quit', () => void store.flush())` does not wait, so the process could end
 * mid-write. These assert that closing is held open until every save has finished -- and that it is not held open for
 * ever by one that never does.
 */

const later = (ms: number, value?: unknown): Promise<unknown> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

test('the first ask to close is stopped, and closing is asked for again only after everything has saved', async () => {
  const order: string[] = []
  const flush = new QuitFlush({ quit: () => order.push('quit') })
  flush.add('notes', async () => {
    await later(20)
    order.push('notes saved')
  })
  flush.add('tasks', async () => {
    await later(5)
    order.push('tasks saved')
  })

  assert.equal(flush.beforeQuit(), true, 'the first ask must be stopped, or the writes race the process ending')
  await later(60)
  assert.deepEqual(order, ['tasks saved', 'notes saved', 'quit'], 'both saved, and only then was closing asked for')
  assert.equal(flush.beforeQuit(), false, 'and the close that follows goes straight through')
})

test('asking again while it is saving changes nothing and does not start the saves twice', async () => {
  let runs = 0
  const flush = new QuitFlush({ quit: () => undefined })
  flush.add('notes', async () => {
    runs += 1
    await later(20)
  })
  assert.equal(flush.beforeQuit(), true)
  assert.equal(flush.beforeQuit(), true, 'still held')
  assert.equal(flush.beforeQuit(), true)
  await later(60)
  assert.equal(runs, 1)
})

test('a save that never finishes does not keep Orbis open for ever', async () => {
  const problems: string[] = []
  let quits = 0
  const flush = new QuitFlush({ quit: () => (quits += 1), limitMs: 30, onProblem: (what) => problems.push(what) })
  flush.add('a store that hangs', () => new Promise(() => undefined))
  flush.beforeQuit()
  await later(80)
  assert.equal(quits, 1, 'closing carried on')
  assert.deepEqual(problems, ['saving everything'], 'and it said why rather than closing quietly')
})

test('one store failing does not stop the others saving', async () => {
  const saved: string[] = []
  const problems: string[] = []
  const flush = new QuitFlush({ quit: () => undefined, onProblem: (what) => problems.push(what) })
  flush.add('broken', () => Promise.reject(new Error('the disk is full')))
  flush.add('notes', () => {
    saved.push('notes')
  })
  await flush.runAll()
  assert.deepEqual(saved, ['notes'])
  assert.deepEqual(problems, ['broken'])
})

test('something that saves with no promise at all is still waited for correctly', async () => {
  let done = false
  const flush = new QuitFlush({ quit: () => undefined })
  flush.add('a plain one', () => {
    done = true
  })
  await flush.runAll()
  assert.equal(done, true)
  assert.equal(flush.count, 1)
})
