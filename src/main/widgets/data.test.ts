import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWidgetData, PANEL_VIEWS, weatherSymbol, type WidgetDataDeps } from './data.ts'
import type { WidgetSource } from '../../shared/widgetFeed.ts'
import { FEED_LIMITS } from '../../shared/widgetFeed.ts'
import type { Task } from '../../shared/tasks.ts'
import type { Note } from '../../shared/notes.ts'

const NOW = Date.UTC(2026, 9, 5, 10, 42)
const DAY = 86_400_000

const task = (patch: Partial<Task>): Task => ({
  id: 't1',
  listId: 'inbox',
  title: 'A task',
  notes: '',
  done: false,
  hasTime: false,
  priority: 'none',
  subtasks: [],
  order: 0,
  createdAt: NOW - DAY,
  updatedAt: NOW - DAY,
  ...patch
})

const note = (patch: Partial<Note>): Note => ({
  id: 'n1',
  title: 'A note',
  body: 'Some words.',
  tags: [],
  pinned: false,
  archived: false,
  color: 'default',
  createdAt: NOW - DAY,
  updatedAt: NOW - DAY,
  ...patch
})

const service = (deps: WidgetDataDeps) => createWidgetData({ now: () => NOW, online: () => true, ...deps })

test('a source Orbis cannot reach says so, rather than showing an empty list', async () => {
  const data = service({})
  for (const source of ['tasks', 'notes', 'clipboard', 'bookmarks', 'tabs', 'weather', 'news', 'markets'] as WidgetSource[]) {
    const feed = await data.feed({ source })
    assert.equal(feed.value, null, source)
    assert.equal(feed.status, 'unavailable', source)
    assert.ok((feed.error ?? '').length > 0, source)
  }
})

test('tasks: today, overdue and flagged are different questions', async () => {
  const tasks = [
    task({ id: 'a', title: 'Today', due: NOW + 3_600_000, hasTime: true }),
    task({ id: 'b', title: 'Yesterday', due: NOW - DAY }),
    task({ id: 'c', title: 'Important', priority: 'high' }),
    task({ id: 'd', title: 'Done', due: NOW, done: true }),
    task({ id: 'e', title: 'Next week', due: NOW + 7 * DAY })
  ]
  const data = service({ tasks: () => tasks })
  const today = await data.feed({ source: 'tasks', view: 'today' })
  assert.deepEqual(today.value && 'items' in today.value ? today.value.items.map((one) => one.id) : [], ['b', 'a'])
  assert.equal(today.value && 'items' in today.value ? today.value.items[0].overdue : false, true)

  const overdue = await data.feed({ source: 'tasks', view: 'overdue' })
  assert.deepEqual(overdue.value && 'items' in overdue.value ? overdue.value.items.map((one) => one.id) : [], ['b'])

  const flagged = await data.feed({ source: 'tasks', view: 'flagged' })
  assert.deepEqual(flagged.value && 'items' in flagged.value ? flagged.value.items.map((one) => one.id) : [], ['c'])

  const all = await data.feed({ source: 'tasks', view: 'all' })
  assert.equal(all.value && 'total' in all.value ? all.value.total : 0, 4, 'the one ticked off is not a task to do')
})

test('reminders are the tasks with a time that have not happened yet, soonest first', async () => {
  const data = service({
    tasks: () => [
      task({ id: 'late', title: 'Gone', due: NOW - 60_000, hasTime: true }),
      task({ id: 'soon', title: 'Call', due: NOW + 60_000, hasTime: true }),
      task({ id: 'later', title: 'Train', due: NOW + 3_600_000, hasTime: true }),
      task({ id: 'noTime', title: 'Someday', due: NOW + 60_000, hasTime: false })
    ]
  })
  const feed = await data.feed({ source: 'reminders' })
  assert.deepEqual(feed.value && 'items' in feed.value ? feed.value.items.map((one) => one.id) : [], ['soon', 'later'])
})

test('notes: pinned first, newest next, a short piece of the words and never the whole note', async () => {
  const data = service({
    notes: () => [
      note({ id: 'old', title: 'Old', updatedAt: NOW - 5 * DAY }),
      note({ id: 'new', title: 'New', updatedAt: NOW - 60_000, body: 'x'.repeat(5_000) }),
      note({ id: 'pin', title: 'Pinned', pinned: true, updatedAt: NOW - 9 * DAY }),
      note({ id: 'gone', title: 'Archived', archived: true })
    ]
  })
  const feed = await data.feed({ source: 'notes' })
  const items = feed.value && 'items' in feed.value ? feed.value.items : []
  assert.deepEqual(items.map((one) => one.id), ['pin', 'new', 'old'])
  assert.ok(items[1].excerpt.length <= 120)
})

test('the clipboard hands over the short line it shows, never what was copied', async () => {
  const data = service({
    clips: () => [
      { id: 'c1', kind: 'text', content: 'the whole secret sentence', preview: 'the whole secret', pinned: false, copiedAt: NOW, times: 1 } as never,
      { id: 'c2', kind: 'image', content: 'data:image/png;base64,AAA', preview: '', pinned: false, copiedAt: NOW - 1000, times: 1 } as never
    ]
  })
  const feed = await data.feed({ source: 'clipboard' })
  const items = feed.value && 'items' in feed.value ? feed.value.items : []
  assert.equal(items[0].preview, 'the whole secret')
  assert.equal(items[1].preview, 'A picture')
  assert.equal(JSON.stringify(items).includes('base64'), false, 'nothing copied is handed to a widget')
})

test('every source keeps to its own ceiling however many are asked for', async () => {
  const many = Array.from({ length: 80 }, (_, i) => task({ id: `t${i}`, title: `Task ${i}`, due: NOW }))
  const data = service({ tasks: () => many })
  const feed = await data.feed({ source: 'tasks', view: 'all', limit: 500 })
  assert.equal(feed.value && 'items' in feed.value ? feed.value.items.length : 0, FEED_LIMITS.tasks)
  const few = await data.feed({ source: 'tasks', view: 'all', limit: 3 })
  assert.equal(few.value && 'items' in few.value ? few.value.items.length : 0, 3)
})

test('weather: no city is something to do first, not a failure', async () => {
  const data = service({ weather: async () => ({ ok: false, reason: 'never asked' }) })
  const feed = await data.feed({ source: 'weather' })
  assert.equal(feed.needs, 'Choose a city')
  assert.equal(feed.value, null)
})

test('weather is read, converted to the unit asked for, and kept so the last good one can be shown', async () => {
  let fail = false
  const forecast = {
    place: 'Chennai',
    updatedAt: NOW - 600_000,
    now: { temperature: 30.4, condition: 'Partly cloudy', symbol: 'partlycloudy_day' },
    hours: [{ at: NOW + 3_600_000, temperature: 31, symbol: 'clearsky_day', condition: 'Sunny' }],
    attribution: 'MET Norway'
  }
  let when = NOW
  const data = createWidgetData({
    now: () => when,
    online: () => true,
    weather: async () => (fail ? { ok: false, reason: 'The forecast could not be read.' } : { ok: true, data: forecast as never, fetchedAt: when, stale: false })
  })
  const first = await data.feed({ source: 'weather', city: 'Chennai', unit: 'f' })
  assert.equal(first.status, 'live')
  assert.equal(first.value && 'temperature' in first.value ? first.value.temperature : 0, 87)
  assert.equal(first.value && 'symbol' in first.value ? first.value.symbol : '', 'partly')

  // Later, with no answer: the last good one, with the time it was really read and the reason it is not newer.
  fail = true
  when = NOW + 3_600_000
  const second = await data.feed({ source: 'weather', city: 'Chennai', unit: 'f', fresh: true })
  assert.equal(second.status, 'cached')
  assert.equal(second.at, NOW)
  assert.match(second.error ?? '', /could not be read/)
  assert.equal(second.value && 'temperature' in second.value ? second.value.temperature : 0, 87)
})

test('with no connection and nothing kept, a widget is told there is no connection', async () => {
  const data = createWidgetData({ now: () => NOW, online: () => false, weather: async () => ({ ok: false, reason: 'no connection' }) })
  const feed = await data.feed({ source: 'weather', city: 'Oslo' })
  assert.equal(feed.status, 'offline')
  assert.equal(feed.value, null)
})

test('news: no feeds chosen is something to do first; a feed that fails is named and the rest still show', async () => {
  const data = service({ newsFeed: async () => ({ ok: false, reason: 'nothing' }) })
  assert.equal((await data.feed({ source: 'news', feeds: [] })).needs, 'Add a feed')

  const working = service({
    newsFeed: async (url) =>
      url.includes('broken')
        ? { ok: false, reason: 'That is not a feed.' }
        : { ok: true, fetchedAt: NOW, stale: false, data: { title: 'Example', items: [{ title: 'A headline', url: 'https://example.com/1', source: 'Example', publishedAt: NOW - 1000 }] } }
  })
  const feed = await working.feed({ source: 'news', feeds: ['https://example.com/rss', 'https://broken.example/rss'] })
  assert.equal(feed.status, 'live')
  assert.equal(feed.value && 'items' in feed.value ? feed.value.items.length : 0, 1)
  assert.equal(feed.value && 'failed' in feed.value ? feed.value.failed.length : 0, 1)
  assert.match(feed.value && 'failed' in feed.value ? feed.value.failed[0] : '', /broken\.example/)
})

test('markets: a symbol Orbis Markets does not know is said, never a price of zero', async () => {
  const data = service({ marketQuote: async (symbol) => (symbol === 'BTC' ? { symbol: 'BTC', name: 'Bitcoin', price: 64_250, change: 1.8, currency: 'USD', points: [1, 2, 3], asOf: NOW } : null) })
  const good = await data.feed({ source: 'markets', symbol: 'btc' })
  assert.equal(good.value && 'price' in good.value ? good.value.price : 0, 64_250)
  const bad = await data.feed({ source: 'markets', symbol: 'nonsense' })
  assert.equal(bad.value, null)
  assert.match(bad.error ?? '', /no price for NONSENSE/)
})

test('junk asked for is answered, never thrown', async () => {
  const data = service({ tasks: () => [] })
  for (const junk of [null, undefined, 'tasks', { source: 'passwords' }, { source: 7 }, {}]) {
    const feed = await data.feed(junk as never)
    assert.equal(feed.value, null)
    assert.ok((feed.error ?? '').length > 0)
  }
})

test('a reader that throws becomes a reason in words', async () => {
  const data = service({
    bookmarks: async () => {
      throw new Error('the library is locked')
    }
  })
  const feed = await data.feed({ source: 'bookmarks' })
  assert.equal(feed.value, null)
  assert.match(feed.error ?? '', /the library is locked/)
})

test('commands: each does one thing, and anything not on the list is refused', async () => {
  const done: string[] = []
  const data = service({
    completeTask: async (id) => (done.push(`task:${id}`), id === 'real'),
    createNote: async () => (done.push('note'), 'n9'),
    copyClip: async () => true,
    openWorkspace: async () => false,
    activateTab: async () => true,
    showDownload: async () => true,
    openPanel: async (view) => (done.push(`panel:${view}`), true),
    askOrion: async (words) => (done.push(`orion:${words}`), true)
  })
  assert.deepEqual(await data.run({ do: 'task.complete', id: 'real' }), { ok: true, message: 'Ticked off.' })
  assert.equal((await data.run({ do: 'task.complete', id: 'gone' })).ok, false)
  assert.equal((await data.run({ do: 'note.create' })).ok, true)
  assert.equal((await data.run({ do: 'workspace.open', id: 'w1' })).ok, false)
  assert.equal((await data.run({ do: 'panel.open', view: 'tasks' })).ok, true)
  assert.equal((await data.run({ do: 'panel.open', view: 'settings' })).ok, false, 'a screen Orbis has no such thing as')
  assert.equal((await data.run({ do: 'orion.ask', text: '   ' })).ok, false)
  assert.equal((await data.run({ do: 'format-the-disk' } as never)).ok, false)
  assert.ok(done.includes('panel:tasks'))
  // Only screens the panel really has: 'ask' is not one of them yet, so no widget may offer to open it.
  assert.equal(PANEL_VIEWS.includes('ask'), false)
  assert.ok(PANEL_VIEWS.includes('notes'))
})

test('a question for Orion is cut to a sensible length', async () => {
  let asked = ''
  const data = service({ askOrion: async (words) => ((asked = words), true) })
  await data.run({ do: 'orion.ask', text: 'why '.repeat(400) })
  assert.ok(asked.length <= 500 && asked.length > 0)
})

test('a store changing tells the widgets reading it', async () => {
  let tell: ((source: WidgetSource) => void) | null = null
  const seen: WidgetSource[] = []
  const data = service({ onStoreChange: (listen) => ((tell = listen), () => undefined) })
  const stop = data.onChange((source) => seen.push(source))
  tell!('notes')
  stop()
  tell!('tasks')
  assert.deepEqual(seen, ['notes'])
})

test('MET Norway’s codes become the pictures the start page draws', () => {
  assert.equal(weatherSymbol('clearsky_day'), 'clear')
  assert.equal(weatherSymbol('clearsky_night'), 'night')
  assert.equal(weatherSymbol('heavyrainandthunder'), 'thunder')
  assert.equal(weatherSymbol('lightsleetshowers_polartwilight'), 'sleet')
  assert.equal(weatherSymbol('snow'), 'snow')
  assert.equal(weatherSymbol('rainshowers_day'), 'showers')
  assert.equal(weatherSymbol('fog'), 'fog')
  assert.equal(weatherSymbol('something_new_they_added'), 'unknown')
})
