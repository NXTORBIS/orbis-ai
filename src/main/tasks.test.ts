import { test } from 'node:test'
import assert from 'node:assert/strict'
import { completeTask, filterTasks, newList, newTask, normalizeTask, parseTaskInput, startOfDay, taskCounts } from '../shared/tasks.ts'

const DAY = 86_400_000
const NOW = new Date(2026, 8, 16, 10, 0, 0).getTime()

test('a stored task is cleaned up: capped text, known priority, sane repeat, valid subtasks', () => {
  const clean = normalizeTask({ id: 't1', title: '  Buy   milk ', notes: 'x'.repeat(20_000), priority: 'urgent', repeat: { every: 'week', interval: 0 }, subtasks: [{ id: 's1', title: ' a ', done: 'yes' }, { title: 'no id' }], due: '123', listId: '' })
  assert.equal(clean?.title, 'Buy milk')
  assert.equal(clean?.notes.length, 10_000)
  assert.equal(clean?.priority, 'none')
  assert.deepEqual(clean?.repeat, { every: 'week', interval: 1 })
  assert.deepEqual(clean?.subtasks, [{ id: 's1', title: 'a', done: false }])
  assert.equal(clean?.due, 123)
  assert.equal(clean?.listId, 'inbox')
  assert.equal(normalizeTask({ title: 'no id' }), null)
})

test('views split tasks into today, overdue, upcoming, flagged and completed', () => {
  const tasks = [
    newTask({ id: 'a', title: 'Today', due: NOW + 3600_000 }),
    newTask({ id: 'b', title: 'Late', due: NOW - 3 * DAY }),
    newTask({ id: 'c', title: 'Later', due: NOW + 5 * DAY }),
    newTask({ id: 'd', title: 'Someday' }),
    newTask({ id: 'e', title: 'Important', priority: 'high' }),
    newTask({ id: 'f', title: 'Done', done: true, completedAt: NOW })
  ]
  const ids = (view: Parameters<typeof filterTasks>[1]): string[] => filterTasks(tasks, view, NOW).map((t) => t.id)
  assert.deepEqual(ids({ view: 'today' }).sort(), ['a', 'b'])
  assert.deepEqual(ids({ view: 'overdue' }), ['b'])
  assert.deepEqual(ids({ view: 'upcoming' }), ['c'])
  assert.deepEqual(ids({ view: 'flagged' }), ['e'])
  assert.deepEqual(ids({ view: 'completed' }), ['f'])
  assert.deepEqual(ids({ query: 'import' }), ['e'])
  assert.deepEqual(filterTasks(tasks, { sort: 'due' }, NOW).map((t) => t.id), ['b', 'a', 'c', 'd', 'e'])

  const counts = taskCounts(tasks, NOW)
  assert.equal(counts.open, 5)
  assert.equal(counts.done, 1)
  assert.equal(counts.today, 2)
  assert.equal(counts.overdue, 1)
  assert.equal(counts.upcoming, 1)
  assert.equal(counts.flagged, 1)
  assert.equal(counts.byList.inbox, 5)
})

test('completing a repeating task moves it to its next date instead of finishing it', () => {
  const weekly = newTask({ title: 'Water plants', due: NOW - 10 * DAY, repeat: { every: 'week', interval: 1 }, subtasks: [{ id: 's', title: 'kitchen', done: true }] })
  const { task, repeated } = completeTask(weekly, true, NOW)
  assert.equal(repeated, true)
  assert.equal(task.done, false)
  assert.ok(task.due! > NOW, 'the next date is in the future')
  assert.equal((task.due! - weekly.due!) % (7 * DAY), 0)
  assert.equal(task.subtasks[0].done, false)

  const plain = completeTask(newTask({ title: 'Once' }), true, NOW)
  assert.equal(plain.repeated, false)
  assert.equal(plain.task.done, true)
  assert.equal(plain.task.completedAt, NOW)
  assert.equal(completeTask(plain.task, false, NOW).task.completedAt, undefined)
})

test('a task typed in one line sets its date, time, priority and list', () => {
  const lists = [newList({ id: 'l1', name: 'Bills' })]
  const parsed = parseTaskInput('Pay rent tomorrow 9am !high #bills', lists, NOW)
  assert.equal(parsed.title, 'Pay rent')
  assert.equal(parsed.priority, 'high')
  assert.equal(parsed.listId, 'l1')
  assert.equal(parsed.hasTime, true)
  assert.equal(parsed.due, new Date(2026, 8, 17, 9, 0, 0).getTime())

  const evening = parseTaskInput('Call mum tonight', [], NOW)
  assert.equal(evening.title, 'Call mum')
  assert.equal(evening.due, new Date(2026, 8, 16, 20, 0, 0).getTime())

  const dated = parseTaskInput('Renew licence 2026-12-01', [], NOW)
  assert.equal(dated.due, new Date(2026, 11, 1).getTime())
  assert.equal(dated.hasTime, undefined)

  // An unknown list stays part of the title rather than being silently dropped.
  const unknown = parseTaskInput('Read paper #research', lists, NOW)
  assert.equal(unknown.title, 'Read paper #research')
  assert.equal(unknown.listId, undefined)

  const plain = parseTaskInput('Buy 3 apples', [], NOW)
  assert.equal(plain.title, 'Buy 3 apples')
  assert.equal(plain.due, undefined)
  assert.equal(startOfDay(NOW), new Date(2026, 8, 16).getTime())
})
