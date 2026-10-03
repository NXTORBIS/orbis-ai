import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { destinationFor, type WindowFeature } from './notificationRoute.ts'

/**
 * Pressing a notification has to arrive somewhere.
 *
 * The bug these guard against shipped for months: the window was brought forward and nothing else happened, because
 * the message saying where to go had no listener. It looked exactly like a working button.
 */

test('a schedule takes you to Schedules, with the one it is about', () => {
  const where = destinationFor('schedule.completed', { scheduleId: 's-7' })
  assert.deepEqual(where, { kind: 'feature', id: 'schedules', focus: 's-7' })
})

test('a rule firing lands on the same screen as a schedule', () => {
  assert.equal(destinationFor('rule.fired', { ruleId: 'r-2' }).kind, 'feature')
})

test('a file Orbis made takes you to the screen it was made on', () => {
  const where = destinationFor('artifact.created', { filename: 'report.pdf' })
  assert.deepEqual(where, { kind: 'feature', id: 'create', focus: 'report.pdf' })
})

test('Orion finishing takes you back to the conversation it happened in', () => {
  assert.deepEqual(destinationFor('orion.completed', { conversationId: 'c-1' }), { kind: 'chat', conversationId: 'c-1' })
})

test('research with no conversation named still goes to the chat rather than nowhere', () => {
  assert.deepEqual(destinationFor('research.completed', {}), { kind: 'chat', conversationId: null })
})

test('anything about a page in the browser goes to the browser', () => {
  for (const event of ['workflow.completed', 'workflow.waiting', 'captcha.required', 'browser.attention', 'download.completed']) {
    assert.equal(destinationFor(event, {}).kind, 'browser', event)
  }
})

test('something blocked takes you to the security settings, not the top of settings', () => {
  assert.deepEqual(destinationFor('security.blocked', {}), { kind: 'settings', section: 'security' })
})

test('an update takes you to where updates are', () => {
  assert.deepEqual(destinationFor('update.ready', {}), { kind: 'settings', section: 'about' })
})

test('an event with nowhere real to land says so instead of pretending', () => {
  assert.deepEqual(destinationFor('something.invented', { id: 'x' }), { kind: 'none' })
})

test('where it goes cannot be influenced by the words in the notification', () => {
  // A subject is ids. Feeding one a destination-shaped value changes nothing about where it lands.
  const where = destinationFor('schedule.completed', { kind: 'browser', section: 'account', scheduleId: 's-1' })
  assert.deepEqual(where, { kind: 'feature', id: 'schedules', focus: 's-1' })
})

test('every event Orbis can notify about has somewhere to go', () => {
  const source = readFileSync(new URL('./notifications.ts', import.meta.url), 'utf8')
  const events = [...new Set([...source.matchAll(/^  '([a-z]+\.[a-zA-Z]+)': \{/gm)].map((m) => m[1]))]
  assert.ok(events.length > 10, `expected the template table to be found, got ${events.length}`)
  const lost = events.filter((event) => destinationFor(event, {}).kind === 'none')
  assert.deepEqual(lost, [], 'these notifications would bring the window forward and land nowhere')
})

test('the feature names here are the ones the window actually has', () => {
  const sidebar = readFileSync(new URL('../renderer/src/components/Sidebar.tsx', import.meta.url), 'utf8')
  const line = /export type FeatureId =([^\n]+)/.exec(sidebar)
  assert.ok(line, "the window's feature list moved; this guard needs updating")
  const windowHas = new Set([...line[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]))
  const used: WindowFeature[] = ['schedules', 'create', 'pages']
  for (const id of used) assert.ok(windowHas.has(id), `notifications route to "${id}" and the window has no such screen`)
})
