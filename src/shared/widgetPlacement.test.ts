import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearWidgetPlacement,
  flowedWidgets,
  MIN_WIDGET_FRACTION,
  newWidgetInstance,
  normalizePlacement,
  normalizeWidget,
  placedWidgets,
  placeWidgetFreely,
  widgetsInZone,
  WIDGETS,
  type WidgetInstance
} from './widgets.ts'

const some = WIDGETS[0]
const make = (id: string): WidgetInstance => ({ ...newWidgetInstance(some.id, 'centre', 0)!, id })

test('a widget nobody has moved is untouched', () => {
  const w = make('a')
  assert.equal(w.place, undefined, 'placement is only there once someone puts it somewhere')
  assert.equal(flowedWidgets([w]).length, 1)
  assert.equal(placedWidgets([w]).length, 0)
})

test('a placement is read back exactly', () => {
  assert.deepEqual(normalizePlacement({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 })
  assert.deepEqual(normalizePlacement({ x: 0.2, y: 0.3, w: 0.4, h: 0.5 }), { x: 0.2, y: 0.3, w: 0.4, h: 0.5 })
})

test('a widget cannot be saved somewhere it could never be grabbed again', () => {
  assert.deepEqual(normalizePlacement({ x: -40, y: 900 }), { x: 0, y: 1 })
  assert.deepEqual(normalizePlacement({ x: Number.NaN, y: 0.5 }), null)
  assert.deepEqual(normalizePlacement({ x: Infinity, y: 0.5 }), null)
  assert.equal(normalizePlacement(null), null)
  assert.equal(normalizePlacement('somewhere'), null)
})

test('a widget cannot be made too small to use', () => {
  const tiny = normalizePlacement({ x: 0.5, y: 0.5, w: 0.0001, h: 0 })
  assert.ok(tiny)
  assert.ok(tiny.w !== undefined && tiny.w >= MIN_WIDGET_FRACTION)
  assert.ok(tiny.h !== undefined && tiny.h >= MIN_WIDGET_FRACTION)
})

test('putting a widget somewhere takes it out of its zone flow', () => {
  const w = make('a')
  const before = widgetsInZone([w], w.zone)
  assert.equal(before.length, 1)

  const after = placeWidgetFreely([w], 'a', { x: 0.6, y: 0.2 })
  assert.deepEqual(after[0].place, { x: 0.6, y: 0.2 })
  // Otherwise it would be drawn twice: once where it was dropped, once in the row it came from.
  assert.equal(widgetsInZone(after, w.zone).length, 0)
  assert.equal(placedWidgets(after).length, 1)
  assert.equal(flowedWidgets(after).length, 0)
})

test('it can be given back to its zone', () => {
  const placed = placeWidgetFreely([make('a')], 'a', { x: 0.6, y: 0.2 })
  const returned = clearWidgetPlacement(placed, 'a')
  assert.equal(returned[0].place, undefined)
  assert.equal(widgetsInZone(returned, returned[0].zone).length, 1)
})

test('placing something that is not there changes nothing', () => {
  const widgets = [make('a')]
  assert.deepEqual(placeWidgetFreely(widgets, 'nobody', { x: 0.5, y: 0.5 }), widgets)
  assert.deepEqual(clearWidgetPlacement(widgets, 'nobody'), widgets)
})

test('a nonsense placement is refused rather than half-applied', () => {
  const widgets = [make('a')]
  assert.deepEqual(placeWidgetFreely(widgets, 'a', { x: Number.NaN, y: 0.5 }), widgets)
})

test('placement survives being stored and read back', () => {
  const placed = placeWidgetFreely([make('a')], 'a', { x: 0.42, y: 0.18, w: 0.3 })[0]
  const readBack = normalizeWidget(JSON.parse(JSON.stringify(placed)))
  assert.ok(readBack)
  assert.deepEqual(readBack.place, { x: 0.42, y: 0.18, w: 0.3 })
})

test('a layout saved before any of this existed still loads', () => {
  const old = { ...make('a') } as Record<string, unknown>
  delete old.place
  const readBack = normalizeWidget(old)
  assert.ok(readBack)
  assert.equal(readBack.place, undefined, 'it stays in its zone, exactly as it was')
})

test('a stored placement that is rubbish falls back to the zone rather than breaking the widget', () => {
  const broken = { ...make('a'), place: { x: 'left', y: null } } as unknown
  const readBack = normalizeWidget(broken)
  assert.ok(readBack, 'the widget still loads')
  assert.equal(readBack.place, undefined)
})
