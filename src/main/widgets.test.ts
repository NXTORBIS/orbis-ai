import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  afterFailure,
  FAILURES_BEFORE_DISABLING,
  freshness,
  newWidgetInstance,
  normalizeWidget,
  normalizeWidgets,
  permissionsOf,
  placeWidget,
  searchWidgets,
  widgetById,
  widgetsInZone,
  WIDGETS
} from '../shared/widgets.ts'

test('every widget in the catalogue is real, named, sized and honest about what it reads', () => {
  assert.ok(WIDGETS.length >= 12)
  assert.equal(new Set(WIDGETS.map((w) => w.id)).size, WIDGETS.length)
  for (const widget of WIDGETS) {
    assert.ok(widget.name && widget.description, `${widget.id} says what it is`)
    assert.ok(widget.sizes.includes(widget.defaultSize), `${widget.id} has a size it supports`)
    assert.ok(widget.settings.every((s) => s.default !== undefined), `${widget.id} settings all have a value`)
    for (const choice of widget.settings.filter((s) => s.type === 'choice')) {
      assert.ok(choice.choices?.some((c) => c.value === choice.default), `${widget.id}.${choice.name} defaults to one of its choices`)
    }
  }
  // What a widget reaches is said in words before it is added.
  assert.deepEqual(permissionsOf(widgetById('tasks')!), ['Read your tasks'])
  assert.deepEqual(permissionsOf(widgetById('clock')!), [], 'a clock reads nothing of yours')
})

test('widgets can be searched by what they are and what they read', () => {
  assert.ok(searchWidgets('task').some((w) => w.id === 'tasks'))
  assert.ok(searchWidgets('copied').some((w) => w.id === 'clipboard'))
  assert.ok(searchWidgets('', 'time').every((w) => w.category === 'time'))
  assert.equal(searchWidgets('nothing like this').length, 0)
})

test('a new widget starts with the settings its kind says it takes', () => {
  const tasks = newWidgetInstance('tasks', 'centre', 0)!
  assert.equal(tasks.widget, 'tasks')
  assert.equal(tasks.size, 'medium')
  assert.deepEqual(tasks.settings, { view: 'today', limit: 5 })
  assert.equal(newWidgetInstance('not-a-widget', 'centre', 0), null)
})

test('stored widgets are read back safely: unknown kinds dropped, settings brought in line', () => {
  const widgets = normalizeWidgets([
    { id: 'a', widget: 'tasks', zone: 'nowhere', size: 'enormous', settings: { view: 'nonsense', limit: 999 } },
    { id: 'b', widget: 'a-widget-orbis-no-longer-has', zone: 'centre' },
    { id: 'c', widget: 'clock', settings: { seconds: 'yes' } },
    'rubbish'
  ])
  assert.deepEqual(widgets.map((w) => w.id), ['a', 'c'])
  assert.equal(widgets[0].zone, 'centre', 'an unknown zone falls back to the middle')
  assert.equal(widgets[0].size, 'medium')
  assert.equal(widgets[0].settings.view, 'today', 'a setting that is not one of the choices goes back to the default')
  assert.equal(widgets[0].settings.limit, 20, 'a number beyond what the widget supports is brought into range')
  assert.equal(widgets[1].settings.seconds, false)
  assert.equal(normalizeWidget({ widget: 'clock' }), null)
})

test('widgets sit in zones in a plain order, and moving one renumbers that zone', () => {
  const a = { ...newWidgetInstance('clock', 'left', 0)!, id: 'a' }
  const b = { ...newWidgetInstance('tasks', 'left', 1)!, id: 'b' }
  const c = { ...newWidgetInstance('notes', 'right', 0)!, id: 'c' }
  const all = [a, b, c]
  assert.deepEqual(widgetsInZone(all, 'left').map((w) => w.id), ['a', 'b'])
  assert.deepEqual(widgetsInZone(all, 'right').map((w) => w.id), ['c'])

  const moved = placeWidget(all, 'c', 'left', 0)
  assert.deepEqual(widgetsInZone(moved, 'left').map((w) => w.id), ['c', 'a', 'b'])
  assert.deepEqual(widgetsInZone(moved, 'left').map((w) => w.order), [0, 1, 2], 'the zone is renumbered')
  assert.equal(widgetsInZone(moved, 'right').length, 0)

  const setAside = { ...a, disabled: true }
  assert.deepEqual(widgetsInZone([setAside, b], 'left').map((w) => w.id), ['b'], 'a widget set aside is not shown')
})

test('a widget that keeps failing is set aside rather than taking Orbis with it', () => {
  let failures: ReturnType<typeof afterFailure>['failures'] = []
  let disable = false
  for (let i = 0; i < FAILURES_BEFORE_DISABLING; i++) {
    const result = afterFailure(failures, 'weather', 'The provider did not answer', 1000 + i)
    failures = result.failures
    disable = result.disable
  }
  assert.equal(disable, true, `set aside after ${FAILURES_BEFORE_DISABLING} failures`)

  // One widget failing says nothing about another.
  const other = afterFailure(failures, 'tasks', 'Something went wrong', 2000)
  assert.equal(other.disable, false)

  // Failures long past are forgotten, so a widget is not set aside for something that happened yesterday.
  const later = afterFailure(failures, 'weather', 'Again', 1000 + 400_000)
  assert.equal(later.disable, false)
})

test('what a widget shows is described honestly, never pretending old data is live', () => {
  const now = 1_000_000
  assert.equal(freshness({ status: 'live', value: 1, at: now }, now), 'Just now')
  assert.equal(freshness({ status: 'cached', value: 1, at: now - 3 * 3_600_000 }, now), '3 h ago')
  assert.equal(freshness({ status: 'updating', value: null, at: now - 60_000 }, now), 'Updating…')
  assert.equal(freshness({ status: 'unavailable', value: null, at: 0, error: 'No connection' }, now), 'No connection')
})
