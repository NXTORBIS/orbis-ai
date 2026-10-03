import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readRoute, writeRoute } from './route.ts'

test('anything that is not the gallery is the start page', () => {
  for (const hash of ['', '#', '#q=hello', '#widget', '#widgetsandmore', '#settings']) assert.deepEqual(readRoute(hash), { view: 'closed' })
})

test('the gallery, with what was typed and chosen', () => {
  assert.deepEqual(readRoute('#widgets'), { view: 'home' })
  assert.deepEqual(readRoute('#widgets?q=clock&in=time&show=installed'), { view: 'home', query: 'clock', category: 'time', filter: 'installed' })
  // A category that is not a plain word is dropped rather than passed on.
  assert.deepEqual(readRoute('#widgets?in=<script>'), { view: 'home' })
})

test('one widget from the catalogue, and one that is on the start page', () => {
  assert.deepEqual(readRoute('#widgets/Weather'), { view: 'widget', widget: 'weather' })
  assert.deepEqual(readRoute('#widgets/on/3f2c0d9e-1a2b-4c3d-8e9f-001122334455'), { view: 'instance', id: '3f2c0d9e-1a2b-4c3d-8e9f-001122334455' })
  // "on" with nothing after it is the gallery, not a widget called "on".
  assert.deepEqual(readRoute('#widgets/on'), { view: 'home' })
  assert.deepEqual(readRoute('#widgets/on/bad id!'), { view: 'home' })
})

test('what is written is read back the same', () => {
  const routes = [
    { view: 'closed' as const },
    { view: 'home' as const },
    { view: 'home' as const, query: 'to do list', category: 'productivity', filter: 'favourites' },
    { view: 'widget' as const, widget: 'markets' },
    { view: 'instance' as const, id: 'abc_DEF-123' }
  ]
  for (const route of routes) assert.deepEqual(readRoute(writeRoute(route)), route)
  assert.equal(writeRoute({ view: 'closed' }), '')
})

test('a search is cut to a sensible length', () => {
  const route = readRoute(`#widgets?q=${'a'.repeat(500)}`)
  assert.equal(route.view, 'home')
  assert.equal(route.view === 'home' && route.query?.length, 80)
})
