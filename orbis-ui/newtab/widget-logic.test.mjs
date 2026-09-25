import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_WIDGETS, WIDGETS, addWidget, calculate, moveWidget, normalizeWidgets, removeWidget, resizeWidget, setWidgetSetting, timerText, widgetById, zoneTime } from './widget-logic.js'

const board = (...ids) => ids.map((w, i) => ({ id: `w${i}`, widget: w, size: widgetById(w).defaultSize, settings: {} }))

test('every widget in the catalogue offers its own default size', () => {
  for (const w of WIDGETS) assert.ok(w.sizes.includes(w.defaultSize), `${w.id} cannot be its default size`)
})

test('a widget is added at its default size', () => {
  const r = addWidget([], 'clock', () => 'id1')
  assert.equal(r.ok, true)
  assert.deepEqual(r.widgets, [{ id: 'id1', widget: 'clock', size: 'small', settings: {} }])
})

test('the same widget can be added twice', () => {
  const once = addWidget([], 'clock', () => 'a').widgets
  const twice = addWidget(once, 'clock', () => 'b').widgets
  assert.equal(twice.length, 2)
})

test('an unknown widget is refused by name, not added silently', () => {
  assert.deepEqual(addWidget([], 'nonsense'), { ok: false, error: 'That is not a widget Orbis has' })
})

test('the board has a limit and says so', () => {
  let list = []
  for (let i = 0; i < MAX_WIDGETS; i++) list = addWidget(list, 'clock', () => `i${i}`).widgets
  const r = addWidget(list, 'clock')
  assert.equal(r.ok, false)
  assert.match(r.error, /Remove one first/)
})

test('a saved board drops widgets that no longer exist and keeps the rest', () => {
  const saved = [{ id: 'a', widget: 'clock', size: 'small' }, { id: 'b', widget: 'gone', size: 'small' }, { id: 'c', widget: 'timer', size: 'small' }]
  assert.deepEqual(normalizeWidgets(saved).map((w) => w.widget), ['clock', 'timer'])
})

test('a size the widget does not offer falls back to its default', () => {
  assert.equal(normalizeWidgets([{ id: 'a', widget: 'timer', size: 'large' }])[0].size, 'small')
})

test('nothing saved is an empty board, not a crash', () => {
  assert.deepEqual(normalizeWidgets(null), [])
  assert.deepEqual(normalizeWidgets('what'), [])
})

test('removing takes out only the one asked for', () => {
  const list = board('clock', 'timer')
  assert.deepEqual(removeWidget(list, 'w0').map((w) => w.widget), ['timer'])
})

test('moving past either end leaves the board alone rather than wrapping', () => {
  const list = board('clock', 'timer')
  assert.deepEqual(moveWidget(list, 'w0', -1), list)
  assert.deepEqual(moveWidget(list, 'w1', 1), list)
  assert.deepEqual(moveWidget(list, 'w0', 1).map((w) => w.widget), ['timer', 'clock'])
})

test('resizing cycles through the sizes the widget offers, and back round', () => {
  let list = board('clock')
  list = resizeWidget(list, 'w0')
  assert.equal(list[0].size, 'medium')
  list = resizeWidget(list, 'w0')
  assert.equal(list[0].size, 'small')
})

test('a widget with one size is left as it is', () => {
  const list = resizeWidget(board('timer'), 'w0')
  assert.equal(list[0].size, 'small')
})

test('a setting is kept on its own widget', () => {
  const list = setWidgetSetting(board('worldclock', 'worldclock'), 'w1', 'zone', 'Asia/Tokyo')
  assert.deepEqual(list[0].settings, {})
  assert.deepEqual(list[1].settings, { zone: 'Asia/Tokyo' })
})

test('the timer reads as a clock, and never goes below zero', () => {
  assert.equal(timerText(0), '0:00')
  assert.equal(timerText(-5000), '0:00')
  assert.equal(timerText(65_000), '1:05')
  assert.equal(timerText(3_725_000), '1:02:05')
})

test('the calculator does arithmetic in the right order', () => {
  assert.deepEqual(calculate('2+3*4'), { ok: true, value: 14 })
  assert.deepEqual(calculate('(2+3)*4'), { ok: true, value: 20 })
  assert.deepEqual(calculate('-4+10'), { ok: true, value: 6 })
  assert.deepEqual(calculate('10%3'), { ok: true, value: 1 })
  assert.deepEqual(calculate('0.1+0.2'), { ok: true, value: 0.3 })
})

test('the calculator refuses anything that is not a sum, and never evaluates it', () => {
  assert.equal(calculate('fetch("http://x")').ok, false)
  assert.equal(calculate('2+').ok, false)
  assert.equal(calculate('((2)').ok, false)
  assert.equal(calculate('2 2').ok, false)
})

test('dividing by zero is said plainly rather than shown as Infinity', () => {
  assert.equal(calculate('1/0').ok, false)
})

test('an unknown time zone is null, so the card can say so', () => {
  assert.equal(zoneTime(new Date(), 'Nowhere/Nothing'), null)
  assert.match(zoneTime(new Date('2026-01-01T12:00:00Z'), 'UTC'), /^\d{2}:\d{2}$/)
})
