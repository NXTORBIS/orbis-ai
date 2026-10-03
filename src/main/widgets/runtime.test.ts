import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWidgetRuntime, findOnBoard, type RuntimeStore } from './runtime.ts'
import { defaultConfig, normalizeConfig, type ExperienceConfig } from '../../shared/experience.ts'
import type { WidgetEvent } from '../../shared/widgetFeed.ts'

/** A personalisation store held in memory, behaving as the real one does: it normalises everything it is given. */
function fakeStore(start: Partial<ExperienceConfig> = {}): RuntimeStore & { config: ExperienceConfig; refuse: boolean; saves: string[]; switchTo(profile: string): void } {
  const listeners = new Set<(config: ExperienceConfig) => void>()
  const store = {
    config: normalizeConfig({ ...defaultConfig(), ...start }),
    refuse: false,
    saves: [] as string[],
    profile: 'default',
    current: () => store.config,
    save: async (next: ExperienceConfig, reason = 'Change') => {
      if (store.refuse) throw new Error('the disk is full')
      store.saves.push(reason)
      store.config = normalizeConfig(next)
      for (const listener of [...listeners]) listener(store.config)
      return { config: store.config, changes: [] as unknown[] }
    },
    onChange: (listener: (config: ExperienceConfig) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    switchTo: (profile: string) => {
      store.profile = profile
      for (const listener of [...listeners]) listener(store.config)
    }
  }
  return store
}

let counter = 0
const runtime = (store: RuntimeStore) => createWidgetRuntime({ store, now: () => 1_700_000_000_000, makeId: () => `w${++counter}` })

test('a widget added is saved, read back and reported with its own id', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  const added = await widgets.act({ type: 'add', widget: 'clock' })
  assert.equal(added.ok, true)
  assert.ok(added.ok && added.id)
  assert.match(added.ok ? added.said : '', /start page/)
  assert.equal(store.config.widgets.length, 1)
  assert.equal(store.config.widgets[0].widget, 'clock')
  // Widgets are shown on the start page by default in Orbis, so adding one has to switch the area on.
  assert.equal(store.config.newTab.widgets, true)
  const state = await widgets.state()
  assert.equal(state.board.instances.length, 1)
  assert.equal(state.canUndo, true)
})

test('adding a widget switches the widget area on, so it cannot be kept and never seen', async () => {
  const store = fakeStore({ newTab: { ...defaultConfig().newTab, widgets: false } })
  const widgets = runtime(store)
  await widgets.act({ type: 'add', widget: 'tasks' })
  assert.equal(store.config.newTab.widgets, true)
  assert.equal((await widgets.state()).board.enabled, true)
})

test('a widget Orbis does not have, and one that cannot go on the start page, are refused in words', async () => {
  const widgets = runtime(fakeStore())
  const nope = await widgets.act({ type: 'add', widget: 'teapot' })
  assert.equal(nope.ok, false)
  assert.match(nope.ok ? '' : nope.message, /no widget called/)
  const games = await widgets.act({ type: 'add', widget: 'games' })
  assert.equal(games.ok, false)
  assert.equal(games.ok ? '' : games.error, 'unavailable')
})

test('a save that fails is reported as not saved and leaves nothing to take back', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  store.refuse = true
  const failed = await widgets.act({ type: 'add', widget: 'clock' })
  assert.equal(failed.ok, false)
  assert.equal(failed.ok ? '' : failed.error, 'not-saved')
  assert.match(failed.ok ? '' : failed.message, /could not be saved/)
  assert.equal(store.config.widgets.length, 0)
  assert.equal((await widgets.state()).canUndo, false)
  // One failed save does not stop the next from working.
  store.refuse = false
  assert.equal((await widgets.act({ type: 'add', widget: 'clock' })).ok, true)
})

test('taking a change back and putting it again', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  await widgets.act({ type: 'add', widget: 'clock' })
  await widgets.act({ type: 'add', widget: 'notepad' })
  assert.equal(store.config.widgets.length, 2)

  const undone = await widgets.act({ type: 'undo' })
  assert.equal(undone.ok, true)
  assert.equal(store.config.widgets.length, 1)
  assert.equal(store.config.widgets[0].widget, 'clock')
  assert.equal((await widgets.state()).canRedo, true)

  const again = await widgets.act({ type: 'redo' })
  assert.equal(again.ok, true)
  assert.equal(store.config.widgets.length, 2)

  await widgets.act({ type: 'undo' })
  await widgets.act({ type: 'undo' })
  const empty = await widgets.act({ type: 'undo' })
  assert.equal(empty.ok, false)
  assert.match(empty.ok ? '' : empty.message, /nothing to take back/)
})

test('a new change throws away what had been taken back', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  await widgets.act({ type: 'add', widget: 'clock' })
  await widgets.act({ type: 'undo' })
  await widgets.act({ type: 'add', widget: 'tasks' })
  assert.equal((await widgets.state()).canRedo, false)
})

test('changing to another profile clears what can be taken back', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  await widgets.act({ type: 'add', widget: 'clock' })
  assert.equal((await widgets.state()).canUndo, true)
  store.switchTo('other')
  const state = await widgets.state()
  assert.equal(state.canUndo, false)
  assert.equal(state.profileId, 'other')
})

test('the same widget asked for twice with the same id is one widget', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  const first = await widgets.act({ type: 'add', widget: 'clock', id: 'same-one-1' })
  const second = await widgets.act({ type: 'add', widget: 'clock', id: 'same-one-1' })
  assert.equal(first.ok && first.id, 'same-one-1')
  assert.equal(second.ok && second.already, true)
  assert.equal(store.config.widgets.length, 1)
})

test('settings are kept, and a setting a widget does not have is refused by name', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  const added = await widgets.act({ type: 'add', widget: 'weather' })
  const id = added.ok ? added.id! : ''
  const set = await widgets.act({ type: 'configure', id, settings: { city: 'Chennai' } })
  assert.equal(set.ok, true)
  assert.equal(store.config.widgets[0].settings.city, 'Chennai')
  const wrong = await widgets.act({ type: 'configure', id, settings: { temperature: 'hot' } })
  assert.equal(wrong.ok, false)
  assert.match(wrong.ok ? '' : wrong.message, /no setting called "temperature"/)
})

test('a locked widget will not move, and says why', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  const a = await widgets.act({ type: 'add', widget: 'clock' })
  await widgets.act({ type: 'add', widget: 'tasks' })
  const id = a.ok ? a.id! : ''
  await widgets.act({ type: 'lock', id, locked: true })
  const moved = await widgets.act({ type: 'move', id, to: 1 })
  assert.equal(moved.ok, false)
  assert.equal(moved.ok ? '' : moved.error, 'locked')
  assert.match(moved.ok ? '' : moved.message, /Unlock it/)
})

test('a ready-made layout replaces the board and can be taken back', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  await widgets.act({ type: 'add', widget: 'tabs' })
  const laid = await widgets.act({ type: 'preset', preset: 'minimal' })
  assert.equal(laid.ok, true)
  assert.deepEqual(store.config.widgets.map((one) => one.widget), ['clock', 'notepad'])
  await widgets.act({ type: 'undo' })
  assert.deepEqual(store.config.widgets.map((one) => one.widget), ['tabs'])
  const unknown = await widgets.act({ type: 'preset', preset: 'gardening' })
  assert.equal(unknown.ok, false)
  assert.match(unknown.ok ? '' : unknown.message, /no layout called/)
})

test('a layout can be saved by name, used, and forgotten', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  await widgets.act({ type: 'add', widget: 'clock' })
  const saved = await widgets.act({ type: 'layout.save', name: 'Evening' })
  assert.equal(saved.ok, true)
  const id = saved.ok ? saved.id! : ''
  assert.equal((await widgets.state()).layouts.length, 1)
  assert.equal((await widgets.state()).layouts[0].widgets, 1)

  // A layout is a snapshot: changing the start page afterwards leaves the layout as it was saved.
  await widgets.act({ type: 'add', widget: 'notepad' })
  assert.equal(store.config.dashboards[0].widgets.length, 1)

  await widgets.act({ type: 'clear' })
  const used = await widgets.act({ type: 'layout.use', id })
  assert.equal(used.ok, true)
  assert.deepEqual(store.config.widgets.map((one) => one.widget), ['clock'])

  // Saved again under the same name, it holds what is on the page now -- it is not a second layout called Evening.
  await widgets.act({ type: 'add', widget: 'notepad' })
  const again = await widgets.act({ type: 'layout.save', name: 'evening' })
  assert.equal(again.ok, true)
  assert.equal(store.config.dashboards.length, 1)
  assert.equal(store.config.dashboards[0].widgets.length, 2)

  const gone = await widgets.act({ type: 'layout.remove', id })
  assert.equal(gone.ok, true)
  assert.equal(store.config.dashboards.length, 0)
  // Forgetting a layout leaves the widgets on the start page alone.
  assert.equal(store.config.widgets.length, 2)
  assert.equal((await widgets.act({ type: 'layout.use', id })).ok, false)
})

test('a layout with no name, and one saved from an empty start page, are refused', async () => {
  const widgets = runtime(fakeStore())
  assert.equal((await widgets.act({ type: 'layout.save', name: '   ' })).ok, false)
  assert.equal((await widgets.act({ type: 'layout.save', name: 'Empty' })).ok, false)
})

test('the start page’s own widgets are brought in once and never again', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  const legacy = [
    { id: 'old1', widget: 'clock', size: 'small', settings: {} },
    { id: 'old2', widget: 'countdown', size: 'small', settings: { label: 'Holiday', date: '2027-01-01' } },
    { id: 'old3', widget: 'nonsense', size: 'small', settings: {} }
  ]
  const first = await widgets.act({ type: 'adopt', legacy })
  assert.equal(first.ok, true)
  assert.equal(store.config.widgets.length, 2)
  assert.equal(store.config.widgets[1].settings.title, 'Holiday')
  assert.match(first.ok ? first.said : '', /left out/)
  assert.equal(store.config.widgetsAdopted, true)

  const second = await widgets.act({ type: 'adopt', legacy })
  assert.equal(second.ok && second.already, true)
  assert.equal(store.config.widgets.length, 2)
})

test('nothing kept by the start page is still recorded as brought in, so it is not read twice', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  const said = await widgets.act({ type: 'adopt', legacy: [] })
  assert.equal(said.ok, true)
  assert.match(said.ok ? said.said : '', /no widgets of its own/)
  assert.equal(store.config.widgetsAdopted, true)
})

test('every change tells whoever is watching, with the new state', async () => {
  const store = fakeStore()
  const widgets = runtime(store)
  const seen: WidgetEvent[] = []
  const stop = widgets.onEvent((event) => seen.push(event))
  await widgets.act({ type: 'add', widget: 'clock' })
  await widgets.act({ type: 'favourite', widget: 'clock', on: true })
  stop()
  await widgets.act({ type: 'add', widget: 'notepad' })
  assert.ok(seen.length >= 2)
  assert.equal(seen[0].type, 'state')
  assert.ok(seen[0].type === 'state' && seen[0].state.board.instances.length === 1)
  // Numbered up every time, so a page can tell that what it holds is old.
  assert.ok(seen[1].type === 'state' && seen[1].state.revision > seen[0].state.revision)
  assert.equal(seen.length, 2)
})

test('what the start page says it has drawn is kept, and goes stale', async () => {
  let clock = 1_000
  const widgets = createWidgetRuntime({ store: fakeStore(), now: () => clock, makeId: () => 'w' })
  assert.equal(widgets.rendered(), null)
  widgets.report({ revision: 3, shown: ['a', 'b'], failed: [], columns: 4, gallery: false, arranging: false })
  assert.equal(widgets.rendered()?.shown.length, 2)
  clock += 20_000
  assert.equal(widgets.rendered(), null, 'an account older than a few seconds says nothing about now')
})

test('waiting for the start page to draw a change answers yes when it does and no when nothing is open', async () => {
  const widgets = createWidgetRuntime({ store: fakeStore(), now: () => 5_000, makeId: () => 'w' })
  const waited = widgets.waitForRender(7, 50)
  widgets.report({ revision: 7, shown: ['one'], failed: [], columns: 3, gallery: false, arranging: false })
  assert.equal(await waited, true)
  assert.equal(await widgets.waitForRender(99, 20), false)
})

test('junk is refused rather than thrown', async () => {
  const widgets = runtime(fakeStore())
  for (const junk of [null, 'add', 42, {}, { type: 7 }]) {
    const result = await widgets.act(junk as never)
    assert.equal(result.ok, false, `${JSON.stringify(junk)} should be refused`)
  }
})

test('a widget is found by its own id, by its kind, or by its name - and an ambiguous name is not guessed', () => {
  const instances = [
    { id: 'i1', widget: 'clock' },
    { id: 'i2', widget: 'clock' },
    { id: 'i3', widget: 'weather' }
  ] as never as Parameters<typeof findOnBoard>[0]
  assert.deepEqual(findOnBoard(instances, 'i2'), { one: instances[1] })
  assert.deepEqual(findOnBoard(instances, 'Weather'), { one: instances[2] })
  assert.equal('many' in findOnBoard(instances, 'clock'), true)
  assert.deepEqual(findOnBoard(instances, 'teapot'), { none: true })
  assert.deepEqual(findOnBoard(instances, '  '), { none: true })
})
