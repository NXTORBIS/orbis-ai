import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  arcDash,
  asCount,
  boardWords,
  clipWord,
  countOf,
  currentFirst,
  dayMarks,
  dayTurn,
  dayWord,
  downloadShare,
  leadDownload,
  monogram,
  moreWords,
  onDial,
  readTasks,
  restWords,
  rowsFor,
  shareOf,
  snippet,
  stackOf,
  startOfDay,
  stillComing,
  viewWords,
  type DownloadItem,
  type TaskItem
} from './sums.ts'

const task = (over: Partial<TaskItem> = {}): TaskItem => ({ id: 't', title: 'A task', dueAt: null, hasTime: false, important: false, overdue: false, ...over })
const download = (over: Partial<DownloadItem> = {}): DownloadItem => ({ id: 'd', name: 'a.zip', state: 'downloading', received: 0, total: 100, at: 0, ...over })

/** Noon on an ordinary day, by this computer's own clock, so the day sums are about a real day. */
const noon = new Date(2026, 9, 5, 12, 0, 0, 0).getTime()

test('a card asks for what fits, never more than the person asked for', () => {
  const caps = { medium: 3, tall: 6, large: 8 }
  assert.equal(rowsFor('tall', 20, caps), 6)
  assert.equal(rowsFor('medium', 20, caps), 3)
  assert.equal(rowsFor('tall', 2, caps), 2, 'asking for two means two, however much room there is')
  assert.equal(rowsFor('small', 20, caps), 3, 'a size with no room of its own falls back on medium')
  assert.equal(rowsFor('medium', 0, caps), 1, 'never nothing: a list of none is not a list')
  assert.equal(rowsFor('medium', Number.NaN, caps), 3)
})

test('a setting that is not a number is the one the widget comes with', () => {
  assert.equal(asCount(7, 4), 7)
  assert.equal(asCount('7', 4), 4)
  assert.equal(asCount(undefined, 4), 4)
  assert.equal(asCount(Number.POSITIVE_INFINITY, 4), 4)
  assert.equal(asCount(6.8, 4), 6)
})

test('a part of a whole, and nothing of nothing', () => {
  assert.equal(shareOf(50, 200), 0.25)
  assert.equal(shareOf(5, 0), 0, 'nothing is known about a file with no size')
  assert.equal(shareOf(300, 200), 1, 'never more than the whole')
  assert.equal(shareOf(-5, 200), 0)
  assert.equal(shareOf(Number.NaN, 200), 0)
})

test('an arc paints its share of the circle and leaves the rest', () => {
  assert.equal(arcDash(0.25, 100), '25 75')
  assert.equal(arcDash(0, 100), '0 100')
  assert.equal(arcDash(1, 100), '100 0')
  assert.equal(arcDash(4, 100), '100 0', 'more than the whole circle is still the whole circle')
  assert.equal(arcDash(Number.NaN, 100), '0 100')
})

test('a point on a dial starts at the top and goes round clockwise', () => {
  assert.deepEqual(onDial(0, 10, 50), { x: 50, y: 40 })
  assert.deepEqual(onDial(0.25, 10, 50), { x: 60, y: 50 })
  assert.deepEqual(onDial(0.5, 10, 50), { x: 50, y: 60 })
  assert.deepEqual(onDial(0.75, 10, 50), { x: 40, y: 50 })
})

test('counts read as somebody would say them', () => {
  assert.equal(countOf(1, 'task', 'tasks'), '1 task')
  assert.equal(countOf(4, 'task', 'tasks'), '4 tasks')
  assert.equal(countOf(0, 'task', 'tasks'), '0 tasks')
  assert.equal(boardWords(14), '14 things')
  assert.equal(boardWords(1), '1 thing')
})

test('what a card could not show is said rather than dropped', () => {
  assert.equal(moreWords(3, 9), 'and 6 more')
  assert.equal(moreWords(3, 3), '')
  assert.equal(moreWords(5, 3), '', 'more shown than there are is not a negative number of others')
})

test('a source that never says how many there are is only counted as far as it was read', () => {
  // Four asked for, three came back: that was all of them, so one left over is exactly one.
  assert.equal(restWords(2, 3, 4), 'and 1 more')
  // Four asked for and four came back: there may be a fifth nobody read, so no number is claimed.
  assert.equal(restWords(2, 4, 4), 'and more')
  assert.equal(restWords(3, 3, 4), '')
  assert.equal(restWords(4, 4, 4), '')
})

test('a snippet loses its line breaks and says when it was cut', () => {
  assert.equal(snippet('  two   words\nhere ', 40), 'two words here')
  assert.equal(snippet('abcdefghij', 5), 'abcd…')
  assert.equal(snippet('abcde', 5), 'abcde')
  assert.equal(snippet('', 5), '')
})

test('a site stands for itself by its first letter, and never by an invented one', () => {
  assert.equal(monogram('example.org'), 'E')
  assert.equal(monogram('www.example.org'), 'E')
  assert.equal(monogram('  "quoted" site'), 'Q')
  assert.equal(monogram('…'), '·')
  assert.equal(monogram(''), '·')
})

test('days are this computer’s days', () => {
  assert.equal(startOfDay(noon), new Date(2026, 9, 5, 0, 0, 0, 0).getTime())
  assert.equal(dayTurn(noon), 0.5)
  assert.equal(dayTurn(new Date(2026, 9, 5, 6, 0, 0, 0).getTime()), 0.25)
  assert.equal(dayWord(noon, noon), 'Today')
  assert.equal(dayWord(new Date(2026, 9, 6, 9, 0).getTime(), noon), 'Tomorrow')
  assert.equal(dayWord(new Date(2026, 9, 4, 23, 0).getTime(), noon), 'Yesterday')
  assert.equal(dayWord(new Date(2026, 9, 9, 9, 0).getTime(), noon), '', 'a day far enough off wants its own name')
})

test('a count of the tasks read is only a count when they were all read', () => {
  const items = [task({ id: 'a', overdue: true }), task({ id: 'b', important: true }), task({ id: 'c' })]
  const whole = readTasks({ items, total: 3 })
  assert.deepEqual(whole, { total: 3, shown: 3, overdue: 1, important: 1, whole: true })
  const part = readTasks({ items, total: 9 })
  assert.equal(part.whole, false, 'three of nine read cannot say how many of the nine are overdue')
  assert.equal(part.total, 9)
})

test('a total smaller than what came back is the number that came back', () => {
  assert.equal(readTasks({ items: [task(), task()], total: 0 }).total, 2)
})

test('the word under the count says which tasks these are', () => {
  assert.equal(viewWords('today'), 'due today')
  assert.equal(viewWords('overdue'), 'overdue')
  assert.equal(viewWords('flagged'), 'important')
  assert.equal(viewWords('all'), 'in all')
})

test('only a task with a time, today, has a place on today’s dial', () => {
  const marks = dayMarks(
    [
      task({ id: 'with-time', dueAt: new Date(2026, 9, 5, 18, 0).getTime(), hasTime: true }),
      task({ id: 'no-time', dueAt: noon, hasTime: false }),
      task({ id: 'tomorrow', dueAt: new Date(2026, 9, 6, 9, 0).getTime(), hasTime: true }),
      task({ id: 'none', dueAt: null, hasTime: true })
    ],
    noon
  )
  assert.deepEqual(marks, [{ id: 'with-time', turn: 0.75, overdue: false }])
})

test('how far a download has come, and when nothing says', () => {
  assert.equal(downloadShare({ received: 50, total: 200 }), 0.25)
  assert.equal(downloadShare({ received: 50, total: 0 }), null, 'a file with no size shows no bar')
  assert.equal(stillComing({ state: 'downloading' }), true)
  assert.equal(stillComing({ state: 'paused' }), true)
  assert.equal(stillComing({ state: 'done' }), false)
  assert.equal(stillComing({ state: 'failed' }), false)
})

test('the download shown large is the newest one still running', () => {
  assert.equal(leadDownload([download({ id: 'done', state: 'done' })]), null)
  const items = [download({ id: 'old', at: 1 }), download({ id: 'new', at: 5 }), download({ id: 'held', state: 'paused', at: 9 }), download({ id: 'done', state: 'done', at: 10 })]
  assert.equal(leadDownload(items)?.id, 'new', 'running beats paused, however recent the paused one is')
  assert.equal(leadDownload([download({ id: 'held', state: 'paused', at: 1 }), download({ id: 'held2', state: 'paused', at: 2 })])?.id, 'held2')
})

test('a clip is named by the kind of thing it is', () => {
  assert.equal(clipWord('text'), 'Text')
  assert.equal(clipWord('link'), 'Link')
  assert.equal(clipWord('image'), 'Picture')
  assert.equal(clipWord('other'), 'Copied')
})

test('the workspace you are in comes first, and the set is unchanged', () => {
  const items = [
    { id: 'a', name: 'Study', tabs: 6, current: false },
    { id: 'b', name: 'Work', tabs: 9, current: true },
    { id: 'c', name: 'Trip', tabs: 4, current: false }
  ]
  assert.deepEqual(currentFirst(items).map((one) => one.id), ['b', 'a', 'c'])
  assert.equal(currentFirst(items).length, items.length)
  assert.equal(items[0].id, 'a', 'the list handed in is left alone')
})

test('a pile shows a few and counts the rest against the real total', () => {
  assert.deepEqual(stackOf(['a', 'b', 'c'], 2, 7), { shown: ['a', 'b'], hidden: 5 })
  assert.deepEqual(stackOf(['a'], 4, 1), { shown: ['a'], hidden: 0 })
  assert.deepEqual(stackOf([], 4, 0), { shown: [], hidden: 0 })
})
