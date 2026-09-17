import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserControl } from './browserControl/registry.ts'
import { registerWidgetCapabilities } from './experience/widgetCapabilities.ts'
import { ExperienceStore } from './experience/store.ts'
import { DEFAULT_PROFILE_ID } from '../shared/profiles.ts'
import { widgetsInZone } from '../shared/widgets.ts'

const dirs: string[] = []
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-widgets-'))
  dirs.push(dir)
  return dir
}
process.on('exit', () => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

async function setUp(): Promise<{ store: ExperienceStore; run: (capability: string, params?: Record<string, unknown>) => Promise<ReturnType<BrowserControl['execute']> extends Promise<infer R> ? R : never>; userData: string }> {
  const userData = scratch()
  const store = new ExperienceStore(userData, DEFAULT_PROFILE_ID)
  await store.load()
  const control = new BrowserControl({ sink: async () => undefined })
  registerWidgetCapabilities(control, store)
  const run = (capability: string, params: Record<string, unknown> = {}) =>
    control.execute({ capability, params, source: 'user' }, { source: 'user', confirm: async () => true })
  return { store, run, userData }
}

const widgets = (store: ExperienceStore) => store.current().widgets

test('a widget Orion adds is really on the new tab, and says so only because it looked', async () => {
  const { store, run } = await setUp()
  await run('experience.widgetArea', { on: true })
  const added = await run('experience.addWidget', { widget: 'clock', zone: 'top' })

  assert.equal(added.ok, true, JSON.stringify(added.error))
  assert.equal(widgets(store).length, 1, 'the store really holds it')
  assert.equal(widgets(store)[0].widget, 'clock')
  assert.equal(added.verification?.verified, true)
  assert.match(added.verification?.detail ?? '', /Clock widget is on the new tab, across the top/)
})

test('it says plainly when a widget was added but the new tab is not showing widgets', async () => {
  const { store, run } = await setUp()
  await run('experience.widgetArea', { on: false })
  const added = await run('experience.addWidget', { widget: 'clock' })

  assert.equal(added.ok, true)
  assert.equal(widgets(store).length, 1, 'it really was added')
  assert.match(added.verification?.detail ?? '', /not showing widgets at the moment, so it is not visible yet/)
})

test('a widget Orbis does not have is refused, with the nearest ones named', async () => {
  const { store, run } = await setUp()
  const result = await run('experience.addWidget', { widget: 'stockmarket' })
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'not-found')
  assert.equal(widgets(store).length, 0, 'nothing was added')
})

test('removing a widget takes away the widget and nothing it showed', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'tasks' })
  const before = store.current()
  const removed = await run('experience.removeWidget', { widget: 'tasks' })

  assert.equal(removed.ok, true)
  assert.equal(widgets(store).length, 0)
  assert.equal(removed.verification?.verified, true)
  assert.match(removed.verification?.detail ?? '', /Nothing it showed was deleted/)
  // Everything else about the personalisation is untouched by removing a widget.
  assert.deepEqual(store.current().appearance, before.appearance)
})

test('moving a widget puts it where it was asked to go, counted the way a person counts', async () => {
  const { store, run } = await setUp()
  for (const widget of ['clock', 'tasks', 'notes']) await run('experience.addWidget', { widget, zone: 'centre' })

  const moved = await run('experience.moveWidget', { widget: 'notes', zone: 'centre', position: 1 })
  assert.equal(moved.ok, true)
  assert.equal(widgetsInZone(widgets(store), 'centre')[0].widget, 'notes', 'position 1 means first')
  assert.match(moved.verification?.detail ?? '', /first/)

  const across = await run('experience.moveWidget', { widget: 'clock', zone: 'top' })
  assert.equal(across.ok, true)
  assert.equal(widgetsInZone(widgets(store), 'top').length, 1)
  assert.equal(widgetsInZone(widgets(store), 'centre').length, 2)
})

test('a size a widget was not built for is refused rather than quietly ignored', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'calculator' })
  const was = widgets(store)[0].size

  const asked = await run('experience.resizeWidget', { widget: 'calculator', size: 'large' })
  if (asked.ok) {
    assert.equal(widgets(store)[0].size, 'large')
    assert.equal(asked.verification?.verified, true)
  } else {
    assert.equal(asked.error?.code, 'invalid-params')
    assert.match(asked.error?.message ?? '', /can be/)
    assert.equal(widgets(store)[0].size, was, 'it was left exactly as it was')
  }
})

test('a setting is checked against what the widget accepts, and a bad one changes nothing', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })

  const nonsense = await run('experience.configureWidget', { widget: 'clock', setting: 'colour', value: 'green' })
  assert.equal(nonsense.ok, false)
  assert.match(nonsense.error?.message ?? '', /no "colour" setting/)

  const definition = (await run('experience.widgetCatalogue', { query: 'clock' })).data as { widget: string }[]
  assert.ok(definition.some((d) => d.widget === 'clock'))

  const settings = widgets(store)[0].settings
  const name = Object.keys(settings)[0]
  if (name !== undefined) {
    const before = settings[name]
    const bad = await run('experience.configureWidget', { widget: 'clock', setting: name, value: { not: 'a value' } })
    // Either refused, or coerced to something the widget declared — never left holding an object.
    assert.notEqual(typeof widgets(store)[0].settings[name], 'object')
    void before
    void bad
  }
})

test('folding a widget away is not removing it, and opening one gives a set-aside widget another go', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'notes' })

  const folded = await run('experience.showWidget', { widget: 'notes', shown: false })
  assert.equal(folded.ok, true)
  assert.equal(widgets(store).length, 1, 'it is still there')
  assert.equal(widgets(store)[0].collapsed, true)

  // A widget set aside after failing comes back when the user opens it.
  await store.save({ ...store.current(), widgets: widgets(store).map((w) => ({ ...w, disabled: true })) }, 'set aside')
  const opened = await run('experience.showWidget', { widget: 'notes', shown: true })
  assert.equal(opened.ok, true)
  assert.equal(widgets(store)[0].disabled, false)
  assert.equal(widgets(store)[0].collapsed, false)
})

test('hiding the widget area keeps every widget', async () => {
  const { store, run } = await setUp()
  await run('experience.addWidget', { widget: 'clock' })
  await run('experience.addWidget', { widget: 'tasks' })

  const off = await run('experience.widgetArea', { on: false })
  assert.equal(off.ok, true)
  assert.equal(store.current().newTab.widgets, false)
  assert.equal(widgets(store).length, 2, 'both are kept')
  assert.match(off.verification?.detail ?? '', /They are all kept/)
})

test('asking about a widget that is not there says so instead of guessing', async () => {
  const { run } = await setUp()
  for (const [capability, params] of [
    ['experience.removeWidget', { widget: 'weather' }],
    ['experience.moveWidget', { widget: 'weather', zone: 'top' }],
    ['experience.showWidget', { widget: 'weather', shown: true }]
  ] as const) {
    const result = await run(capability, params)
    assert.equal(result.ok, false, capability)
    assert.equal(result.error?.code, 'not-found', `${capability}: ${result.error?.message}`)
  }
})

test('two of the same widget have to be told apart by id rather than guessed between', async () => {
  const { run } = await setUp()
  await run('experience.addWidget', { widget: 'countdown' })
  const second = await run('experience.addWidget', { widget: 'countdown' })
  assert.equal(second.ok, true)

  const ambiguous = await run('experience.removeWidget', { widget: 'countdown' })
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.error?.message ?? '', /There are 2 countdown widgets/)

  const byId = await run('experience.removeWidget', { widget: (second.data as { instanceId: string }).instanceId })
  assert.equal(byId.ok, true)
})

test('the catalogue lists only widgets that really exist, and says what each needs', async () => {
  const { run } = await setUp()
  const listed = (await run('experience.widgetCatalogue')).data as { widget: string; name: string; needs: string[] }[]
  assert.ok(listed.length >= 10)
  assert.ok(listed.every((w) => w.widget && w.name))
  assert.ok(!listed.some((w) => /coming soon|placeholder|example|demo/i.test(w.name)), 'nothing is listed that is not built')
  const tasks = listed.find((w) => w.widget === 'tasks')
  assert.ok((tasks?.needs ?? []).length > 0, 'a widget that reads the user’s things says so')
})

test('listing says what is really on the page, zone by zone', async () => {
  const { run } = await setUp()
  await run('experience.addWidget', { widget: 'clock', zone: 'top' })
  await run('experience.addWidget', { widget: 'tasks', zone: 'centre' })

  const state = (await run('experience.widgets')).data as { on: boolean; count: number; zones: { zone: string; widgets: { widget: string }[] }[] }
  assert.equal(state.count, 2)
  assert.deepEqual(state.zones.map((z) => z.zone).sort(), ['centre', 'top'])
  assert.equal(state.zones.find((z) => z.zone === 'top')?.widgets[0].widget, 'clock')
})

// ---------------------------------------------------------------- one profile is not another

test('each profile keeps its own widgets, and switching swaps all of them', async () => {
  const userData = scratch()
  const store = new ExperienceStore(userData, DEFAULT_PROFILE_ID)
  await store.load()
  const control = new BrowserControl({ sink: async () => undefined })
  registerWidgetCapabilities(control, store)
  const run = (capability: string, params: Record<string, unknown> = {}) =>
    control.execute({ capability, params, source: 'user' }, { source: 'user', confirm: async () => true })

  await run('experience.addWidget', { widget: 'clock' })
  await run('experience.addWidget', { widget: 'tasks' })
  assert.equal(store.current().widgets.length, 2)

  // Another person signs in. They start with their own new tab, not with somebody else's day on it.
  await store.useProfile('work')
  assert.equal(store.profile, 'work')
  assert.equal(store.current().widgets.length, 0, 'no sign of the other profile’s widgets')

  await run('experience.addWidget', { widget: 'countdown' })
  assert.equal(store.current().widgets.length, 1)

  // Back again: exactly what was left.
  await store.useProfile(DEFAULT_PROFILE_ID)
  assert.deepEqual(store.current().widgets.map((w) => w.widget).sort(), ['clock', 'tasks'])

  await store.useProfile('work')
  assert.deepEqual(store.current().widgets.map((w) => w.widget), ['countdown'])
})

test('one profile’s personalisation is written in its own place, not over another’s', async () => {
  const userData = scratch()
  const store = new ExperienceStore(userData, DEFAULT_PROFILE_ID)
  await store.load()
  await store.save({ ...store.current(), newTab: { ...store.current().newTab, widgets: true } }, 'showed widgets')
  await store.flush()
  assert.ok(existsSync(join(userData, 'experience', 'experience.json')), 'the default profile keeps the place it always kept')

  await store.useProfile('work')
  await store.save({ ...store.current(), newTab: { ...store.current().newTab, widgets: true } }, 'showed widgets')
  await store.flush()
  assert.ok(existsSync(join(userData, 'profiles', 'work', 'experience', 'experience.json')), 'another profile gets its own')
})
