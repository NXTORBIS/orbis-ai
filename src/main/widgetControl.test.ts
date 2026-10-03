import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserControl, type CapabilityDefinition } from './browserControl/registry.ts'
import { registerWidgetCapabilities } from './experience/widgetCapabilities.ts'
import { ExperienceStore } from './experience/store.ts'
import { createWidgetRuntime } from './widgets/runtime.ts'
import type { WidgetRuntimeApi } from './widgets/contract.ts'
import { DEFAULT_PROFILE_ID } from '../shared/profiles.ts'

/**
 * Orion's hands on the widgets.
 *
 * Every one of these goes through the same runtime the start page goes through, and the thing being checked here is
 * never "did the capability answer" but "is the widget really on the start page afterwards". The whole arrangement
 * exists so that Orion cannot report having added a widget that is not there, and that is what these tests look at.
 */

const dirs: string[] = []
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-widgets-'))
  dirs.push(dir)
  return dir
}
process.on('exit', () => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

type Run = (capability: string, params?: Record<string, unknown>) => Promise<Awaited<ReturnType<BrowserControl['execute']>>>

async function setUp(): Promise<{ store: ExperienceStore; runtime: WidgetRuntimeApi; run: Run; control: BrowserControl; opened: { name?: unknown; at?: unknown }[] }> {
  const store = new ExperienceStore(scratch(), DEFAULT_PROFILE_ID)
  await store.load()
  const control = new BrowserControl({ sink: async () => undefined })
  const runtime = createWidgetRuntime({ store })
  registerWidgetCapabilities(control, runtime)

  // Opening one of the browser's own pages belongs to the browser. Here it is recorded rather than done.
  const opened: { name?: unknown; at?: unknown }[] = []
  control.register({
    id: 'surface.open',
    domain: 'surface',
    name: 'Open one of the browser’s own pages',
    description: 'Stands in for the real one.',
    params: { name: { type: 'string', description: 'Which page.', required: true }, at: { type: 'string', description: 'A place within it.' } },
    mutates: true,
    confirmation: 'none',
    run: (p) => {
      opened.push({ name: p.name, at: p.at })
      return { opened: true }
    }
  } as CapabilityDefinition)

  const run: Run = (capability, params = {}) => control.execute({ capability, params, source: 'user' }, { source: 'user', confirm: async () => true })
  return { store, runtime, run, control, opened }
}

const widgets = (store: ExperienceStore) => store.current().widgets
const onlyId = (store: ExperienceStore) => widgets(store)[0].id

test('a widget Orion adds is really on the start page, and is said to be only because it was looked at', async () => {
  const { store, run } = await setUp()
  const added = await run('experience.addWidget', { widget: 'clock' })
  assert.equal(added.ok, true, JSON.stringify(added.error))
  assert.equal(widgets(store).length, 1, 'the store really holds it')
  assert.equal(widgets(store)[0].widget, 'clock')
  // Nothing was drawing it, and that is said rather than guessed at.
  assert.equal((added.data as { shownOnStartPage: unknown }).shownOnStartPage, 'no start page is open')
  assert.equal((added.data as { id?: string }).id, widgets(store)[0].id)
})

test('adding a widget switches the widget area on, so it is never kept and never seen', async () => {
  const { store, run } = await setUp()
  await store.save({ ...store.current(), newTab: { ...store.current().newTab, widgets: false } }, 'off')
  await run('experience.addWidget', { widget: 'tasks' })
  assert.equal(store.current().newTab.widgets, true)
})

test('a widget Orbis does not have is refused, and nothing is added', async () => {
  const { store, run } = await setUp()
  const nope = await run('experience.addWidget', { widget: 'teapot' })
  assert.equal(nope.ok, false)
  assert.match(nope.error?.message ?? '', /no widget called/)
  assert.equal(widgets(store).length, 0)
})

test('a widget that cannot go on the start page says why', async () => {
  const { run } = await setUp()
  const nope = await run('experience.addWidget', { widget: 'games' })
  assert.equal(nope.ok, false)
  assert.match(nope.error?.message ?? '', /Orbis window/)
})

test('a size the widget does not come in is refused by name, with the sizes it does come in', async () => {
  const { run } = await setUp()
  const nope = await run('experience.addWidget', { widget: 'clock', size: 'wide' })
  assert.equal(nope.ok, false)
  assert.match(nope.error?.message ?? '', /does not come in/)
})

test('what is on the start page is listed in order, with what is hidden kept apart', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })
  await run('experience.addWidget', { widget: 'notepad' })
  const second = widgets(store)[1].id
  await run('experience.showWidget', { widget: second, show: false })

  const listed = await run('experience.widgets')
  const data = listed.data as { count: number; widgets: { name: string; place: string }[]; hidden: { name: string }[]; shownOnStartPage: boolean }
  assert.equal(data.count, 1)
  assert.equal(data.widgets[0].name, 'Clock')
  assert.equal(data.widgets[0].place, '1 of 1')
  assert.equal(data.hidden[0].name, 'Sticky note')
  assert.equal(data.shownOnStartPage, true)
})

test('the catalogue says what each widget reads and whether it needs the internet', async () => {
  const { run } = await setUp()
  const listed = await run('experience.widgetCatalogue', { query: 'weather' })
  const rows = listed.data as { widget: string; reads: string[]; needsInternet: boolean; shows: string[] }[]
  const weather = rows.find((one) => one.widget === 'weather')
  assert.ok(weather, 'the weather widget is in the catalogue')
  assert.equal(weather!.needsInternet, true)
  assert.ok(weather!.reads.length > 0)
  assert.ok(weather!.shows.some((one) => /MET Norway/i.test(one)), 'it says where the forecast comes from')
})

test('nothing in the catalogue offers to read a password, a cookie or another profile', async () => {
  const { run } = await setUp()
  const listed = await run('experience.widgetCatalogue')
  const words = JSON.stringify(listed.data).toLowerCase()
  for (const forbidden of ['password', 'cookie', 'vault', 'secret', 'token']) assert.equal(words.includes(forbidden), false, forbidden)
})

test('a widget is moved by a number, by first and last, and by before and after another', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })
  await run('experience.addWidget', { widget: 'notepad' })
  await run('experience.addWidget', { widget: 'tasks' })

  const moved = await run('experience.moveWidget', { widget: 'tasks', place: 'first' })
  assert.equal(moved.ok, true, JSON.stringify(moved.error))
  assert.deepEqual(widgets(store).map((one) => one.widget), ['tasks', 'clock', 'notepad'])

  await run('experience.moveWidget', { widget: 'tasks', place: 'after notepad' })
  assert.deepEqual(widgets(store).map((one) => one.widget), ['clock', 'notepad', 'tasks'])

  // Given as text, because that is the one shape the control layer checks this parameter against.
  await run('experience.moveWidget', { widget: 'clock', place: '2' })
  assert.deepEqual(widgets(store).map((one) => one.widget), ['notepad', 'clock', 'tasks'])

  const nonsense = await run('experience.moveWidget', { widget: 'clock', place: 'sideways' })
  assert.equal(nonsense.ok, false)
})

test('a locked widget will not be moved by Orion either, and says why', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })
  await run('experience.addWidget', { widget: 'notepad' })
  const clock = widgets(store)[0].id
  await run('experience.lockWidget', { widget: clock, locked: true })
  const moved = await run('experience.moveWidget', { widget: clock, place: 'last' })
  assert.equal(moved.ok, false)
  assert.match(moved.error?.message ?? '', /locked/)
  assert.deepEqual(widgets(store).map((one) => one.widget), ['clock', 'notepad'])
})

test('a size is changed, and the store really holds the new one', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'tasks' })
  const resized = await run('experience.resizeWidget', { widget: 'tasks', size: 'large' })
  assert.equal(resized.ok, true, JSON.stringify(resized.error))
  assert.equal(widgets(store)[0].size, 'large')
})

test('a setting is changed, and one the widget does not have is refused by name', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'weather' })
  const set = await run('experience.configureWidget', { widget: 'weather', settings: { city: 'Chennai' } })
  assert.equal(set.ok, true, JSON.stringify(set.error))
  assert.equal(widgets(store)[0].settings.city, 'Chennai')

  const wrong = await run('experience.configureWidget', { widget: 'weather', settings: { temperature: 'hot' } })
  assert.equal(wrong.ok, false)
  assert.match(wrong.error?.message ?? '', /no setting called "temperature"/)
})

test('a widget is put back to how it comes, keeping where it sits and how big it is', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'weather', size: 'large' })
  await run('experience.configureWidget', { widget: 'weather', settings: { city: 'Oslo' } })
  const reset = await run('experience.resetWidget', { widget: 'weather' })
  assert.equal(reset.ok, true, JSON.stringify(reset.error))
  assert.equal(widgets(store)[0].settings.city, '')
  assert.equal(widgets(store)[0].size, 'large', 'its size was left alone')
})

test('how a card looks is changed, and a card Orbis does not have is refused', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })
  const looked = await run('experience.widgetLook', { widget: 'clock', card: 'tint', spacing: 'compact' })
  assert.equal(looked.ok, true, JSON.stringify(looked.error))
  assert.equal(widgets(store)[0].look.tone, 'tint')
  assert.equal(widgets(store)[0].look.density, 'compact')
  assert.equal((await run('experience.widgetLook', { widget: 'clock', card: 'marble' })).ok, false)
})

test('hiding keeps a widget and everything it is set to; showing brings it back', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'weather' })
  await run('experience.configureWidget', { widget: 'weather', settings: { city: 'Oslo' } })
  await run('experience.showWidget', { widget: 'weather', show: false })
  assert.equal(widgets(store)[0].hidden, true)
  assert.equal(widgets(store)[0].settings.city, 'Oslo', 'nothing it was set to was thrown away')
  await run('experience.showWidget', { widget: 'weather', show: true })
  assert.equal(widgets(store)[0].hidden, false)
})

test('a widget that was set aside after failing is started again by showing it', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })
  const id = onlyId(store)
  await store.save({ ...store.current(), widgets: store.current().widgets.map((one) => ({ ...one, disabled: true })) }, 'set aside')
  const shown = await run('experience.showWidget', { widget: id, show: true })
  assert.equal(shown.ok, true, JSON.stringify(shown.error))
  assert.equal(widgets(store)[0].disabled, false)
})

test('a widget is taken off the start page, and the store no longer holds it', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })
  const removed = await run('experience.removeWidget', { widget: 'clock' })
  assert.equal(removed.ok, true, JSON.stringify(removed.error))
  assert.equal(widgets(store).length, 0)
  assert.equal((await run('experience.removeWidget', { widget: 'clock' })).ok, false, 'and again is not found')
})

test('two of the same widget are not guessed between: Orion is told to say which', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })
  await run('experience.addWidget', { widget: 'clock' })
  const asked = await run('experience.removeWidget', { widget: 'clock' })
  assert.equal(asked.ok, false)
  assert.match(asked.error?.message ?? '', /Say which one by its id/)
  assert.equal(widgets(store).length, 2, 'neither was removed')

  // Named by its own id, it is removed.
  const removed = await run('experience.removeWidget', { widget: widgets(store)[1].id })
  assert.equal(removed.ok, true, JSON.stringify(removed.error))
  assert.equal(widgets(store).length, 1)
})

test('one widget can be looked at on its own, with what it can be set to', async () => {
  const { run } = await setUp()
  await run('experience.addWidget', { widget: 'worldclock' })
  const looked = await run('experience.widget', { widget: 'worldclock' })
  const data = looked.data as { name: string; comesIn: string[]; canBeSet: { name: string }[] }
  assert.equal(data.name, 'World clock')
  assert.ok(data.comesIn.length > 0)
  assert.ok(data.canBeSet.some((one) => one.name === 'zones'))
})

test('a ready-made layout is put on the start page, and can be taken back', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'tabs' })
  const laid = await run('experience.widgetLayout', { layout: 'minimal' })
  assert.equal(laid.ok, true, JSON.stringify(laid.error))
  assert.deepEqual(widgets(store).map((one) => one.widget), ['clock', 'notepad'])

  const back = await run('experience.undoWidgets')
  assert.equal(back.ok, true, JSON.stringify(back.error))
  assert.deepEqual(widgets(store).map((one) => one.widget), ['tabs'])

  assert.equal((await run('experience.widgetLayout', { layout: 'gardening' })).ok, false)
})

test('with nothing to take back, Orion is told so rather than being told it worked', async () => {
  const { run } = await setUp()
  const nothing = await run('experience.undoWidgets')
  assert.equal(nothing.ok, false)
  assert.match(nothing.error?.message ?? '', /nothing to take back/)
})

test('the widgets on the start page can be hidden altogether and every one of them is kept', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })
  const off = await run('experience.widgetArea', { show: false })
  assert.equal(off.ok, true, JSON.stringify(off.error))
  assert.equal(store.current().newTab.widgets, false)
  assert.equal(widgets(store).length, 1, 'the widget itself is still there')
})

test('the gallery is opened through the browser’s own page opener, at one widget when asked', async () => {
  const { run, opened } = await setUp()
  const all = await run('experience.openWidgetGallery')
  assert.equal(all.ok, true, JSON.stringify(all.error))
  assert.deepEqual(opened[0], { name: 'widgets', at: undefined })

  const one = await run('experience.openWidgetGallery', { widget: 'weather' })
  assert.equal(one.ok, true, JSON.stringify(one.error))
  assert.deepEqual(opened[1], { name: 'widgets', at: '#widgets/weather' })

  const nope = await run('experience.openWidgetGallery', { widget: 'teapot' })
  assert.equal(nope.ok, false)
  assert.equal(opened.length, 2, 'nothing was opened for a widget Orbis does not have')
})

test('every widget capability is about the start page and none of them writes anywhere else', async () => {
  const { control } = await setUp()
  const ours = control.list({ domain: 'experience' }).filter((one) => one.id.toLowerCase().includes('widget'))
  assert.ok(ours.length >= 12, `only ${ours.length} widget capabilities`)
  for (const one of ours) {
    assert.ok(one.description.length > 20, `${one.id} says too little`)
    assert.equal(/zone/i.test(one.description), false, `${one.id} still talks about zones`)
  }
})
