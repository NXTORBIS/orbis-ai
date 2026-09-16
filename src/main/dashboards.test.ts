import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeDashboard, MAX_DASHBOARDS, newDashboard, normalizeDashboards, rememberWidgets, removeDashboard, switchTo } from '../shared/dashboards.ts'
import { newWidgetInstance } from '../shared/widgets.ts'

const widget = (kind: string, id: string) => ({ ...newWidgetInstance(kind, 'centre', 0)!, id })

test('a dashboard is a named set of widgets, and nothing else', () => {
  const dashboard = newDashboard('  Work  ', [widget('tasks', 'a'), widget('clock', 'b')], 1000)
  assert.equal(dashboard.name, 'Work')
  assert.deepEqual(dashboard.widgets.map((w) => w.id), ['a', 'b'])
  assert.equal(dashboard.createdAt, 1000)
  assert.equal(newDashboard('', [], 1000).name, 'Dashboard', 'one with no name still has one')
})

test('stored dashboards are read back safely: rubbish dropped, widgets brought in line', () => {
  const dashboards = normalizeDashboards([
    { id: 'a', name: 'Work', widgets: [{ id: 'w1', widget: 'tasks', zone: 'nowhere', size: 'enormous' }] },
    { id: 'b', widgets: [{ id: 'w2', widget: 'a-widget-orbis-no-longer-has' }] },
    { name: 'no id at all' },
    'rubbish'
  ])
  assert.deepEqual(dashboards.map((d) => d.id), ['a', 'b'])
  assert.equal(dashboards[0].widgets[0].zone, 'centre', 'a widget inside a dashboard is checked like any other')
  assert.equal(dashboards[1].widgets.length, 0, 'a widget Orbis no longer has is dropped, and the dashboard survives')
  assert.equal(dashboards[1].name, 'Dashboard')
  assert.equal(normalizeDashboards(Array.from({ length: 50 }, (_, i) => ({ id: `d${i}` }))).length, MAX_DASHBOARDS)
})

test('with no dashboards at all, the new tab simply shows the widgets you chose', () => {
  assert.equal(activeDashboard([], null), null)
  const one = newDashboard('Work', [], 1000)
  assert.equal(activeDashboard([one], null), null, 'having a dashboard does not mean one is in use')
  assert.equal(activeDashboard([one], one.id)?.name, 'Work')
  assert.equal(activeDashboard([one], 'gone'), null, 'a dashboard that was deleted leaves Orbis as it was')
})

test('switching dashboards swaps the widgets on screen and loses nothing', () => {
  const work = newDashboard('Work', [widget('tasks', 'a')], 1000)
  const reading = newDashboard('Reading', [widget('notes', 'b')], 1000)
  const dashboards = [work, reading]

  const toWork = switchTo(dashboards, null, [], work.id)!
  assert.deepEqual(toWork.widgets.map((w) => w.id), ['a'])
  assert.equal(toWork.activeId, work.id)

  // What is on screen while Work is in use follows Work when another dashboard is opened.
  const onScreen = [widget('tasks', 'a'), widget('clock', 'c')]
  const toReading = switchTo(toWork.dashboards, work.id, onScreen, reading.id)!
  assert.deepEqual(toReading.widgets.map((w) => w.id), ['b'], 'Reading’s own widgets are shown')
  assert.deepEqual(toReading.dashboards.find((d) => d.id === work.id)!.widgets.map((w) => w.id), ['a', 'c'], 'Work kept what was added to it')

  const back = switchTo(toReading.dashboards, reading.id, toReading.widgets, work.id)!
  assert.deepEqual(back.widgets.map((w) => w.id), ['a', 'c'], 'coming back finds it as it was left')
  assert.equal(switchTo(dashboards, null, [], 'not-a-dashboard'), null)
})

test('changing the widgets while a dashboard is in use changes that dashboard, and only that one', () => {
  const work = newDashboard('Work', [widget('tasks', 'a')], 1000)
  const reading = newDashboard('Reading', [widget('notes', 'b')], 1000)
  const changed = rememberWidgets([work, reading], work.id, [widget('clock', 'c')])
  assert.deepEqual(changed.find((d) => d.id === work.id)!.widgets.map((w) => w.id), ['c'])
  assert.deepEqual(changed.find((d) => d.id === reading.id)!.widgets.map((w) => w.id), ['b'], 'the other one is untouched')

  // With no dashboard in use, the widgets on screen belong to nobody but you.
  assert.deepEqual(rememberWidgets([work], null, [widget('clock', 'c')]), [work])
})

test('deleting a dashboard leaves what is on screen alone', () => {
  const work = newDashboard('Work', [widget('tasks', 'a')], 1000)
  const reading = newDashboard('Reading', [widget('notes', 'b')], 1000)

  const gone = removeDashboard([work, reading], work.id, work.id)
  assert.deepEqual(gone.dashboards.map((d) => d.name), ['Reading'])
  assert.equal(gone.activeId, null, 'nothing is in use once the one in use is deleted')

  const other = removeDashboard([work, reading], work.id, reading.id)
  assert.equal(other.activeId, work.id, 'deleting another one does not disturb the one in use')
})
