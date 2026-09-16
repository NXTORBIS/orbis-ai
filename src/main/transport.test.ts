import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { memoryTransport, TransportRouter } from '../shared/transport.ts'
import type { Transport } from '../shared/transport.ts'

/**
 * The seam the migration turns on.
 *
 * Orbis has to keep working while it is being moved, which means some of it speaking to Chromium while the rest still
 * speaks to Electron. These tests are about that middle state being real rather than hoped for: a domain can move on
 * its own, everything else carries on, and what has moved is something the migration can report rather than guess.
 */

test('a call goes wherever its domain goes, and everything else carries on as before', async () => {
  const electron = memoryTransport({ 'settings:get': () => ({ from: 'electron' }), 'chat:send': () => ({ from: 'electron' }) })
  const mojo: Transport = { ...memoryTransport({ 'settings:get': () => ({ from: 'mojo' }) }), kind: 'mojo' }

  const router = new TransportRouter(electron)
  assert.deepEqual(await router.invoke('settings:get'), { from: 'electron' }, 'before it moves, it goes the old way')

  router.moveTo('settings:', mojo)
  assert.deepEqual(await router.invoke('settings:get'), { from: 'mojo' }, 'once moved, it goes the new way')
  assert.deepEqual(await router.invoke('chat:send'), { from: 'electron' }, 'and everything not yet moved is untouched')
})

test('the most specific route wins, so one channel can move before the rest of its domain', async () => {
  const electron = memoryTransport({ 'library:get': () => 'old', 'library:toggle-bookmark': () => 'old' })
  const mojo: Transport = { ...memoryTransport({ 'library:toggle-bookmark': () => 'new' }), kind: 'mojo' }

  const router = new TransportRouter(electron)
  router.moveTo('library:', electron)
  router.moveTo('library:toggle-bookmark', mojo)

  assert.equal(await router.invoke('library:toggle-bookmark'), 'new')
  assert.equal(await router.invoke('library:get'), 'old')
})

test('what has moved is something the migration can report, rather than something someone remembers', () => {
  const router = new TransportRouter(memoryTransport({}))
  assert.deepEqual(router.moved(), [])
  const mojo: Transport = { ...memoryTransport({}), kind: 'mojo' }
  router.moveTo('settings:', mojo).moveTo('conversations:', mojo)
  assert.deepEqual(router.moved().sort(), ['conversations:', 'settings:'])
  assert.equal(router.routeFor('settings:get').kind, 'mojo')
  assert.equal(router.routeFor('library:get').kind, 'memory', 'anything not moved still goes to what was there before')
})

test('being told about something reaches whoever is listening, whichever transport carries it', () => {
  const electron = memoryTransport({})
  const mojo = { ...memoryTransport({}), kind: 'mojo' as const }
  const router = new TransportRouter(electron)
  router.moveTo('update:', mojo)

  const heardOld: unknown[] = []
  const heardNew: unknown[] = []
  router.subscribe('adblock:changed', (value) => heardOld.push(value))
  router.subscribe('update:changed', (value) => heardNew.push(value))

  electron.emit('adblock:changed', 'blocked something')
  mojo.emit('update:changed', 'ready to install')
  assert.deepEqual(heardOld, ['blocked something'])
  assert.deepEqual(heardNew, ['ready to install'])
})

test('listening can be stopped, so nothing is left hanging on a page that has gone', () => {
  const electron = memoryTransport({})
  const router = new TransportRouter(electron)
  const heard: unknown[] = []
  const stop = router.subscribe('chat:event', (value) => heard.push(value))
  electron.emit('chat:event', 'one')
  stop()
  electron.emit('chat:event', 'two')
  assert.deepEqual(heard, ['one'], 'nothing arrives after it stopped listening')
})

test('asking for something nothing answers fails plainly, rather than quietly returning nothing', async () => {
  const router = new TransportRouter(memoryTransport({}))
  await assert.rejects(() => router.invoke('settings:get'), /Nothing answers settings:get/)
})

test('the Mojo interfaces describe the same services the map says move first', async () => {
  const mojom = await readFile(join(import.meta.dirname, '..', '..', 'chromium', 'orbis', 'mojom', 'orbis_services.mojom'), 'utf8')

  // The services that never touched the browser engine, and so move first.
  for (const name of ['SettingsService', 'ConversationsService', 'UpdateService', 'AuthService', 'OrionService', 'ShortcutsService', 'NoticesService', 'OmniboxService']) {
    assert.match(mojom, new RegExp(`interface ${name} \\{`), `${name} should be declared`)
  }

  // Answers that arrive a piece at a time are observers rather than return values, or Orion could not stream.
  for (const name of ['ChatObserver', 'UpdateObserver', 'AuthObserver']) {
    assert.match(mojom, new RegExp(`interface ${name} \\{`), `${name} should be declared`)
  }

  // Each area is its own interface, so a page is handed exactly what it needs: the settings page cannot ask Orion
  // anything, and Orion cannot change the update channel.
  assert.doesNotMatch(mojom, /interface OrbisService \{/, 'one interface for everything would hand every page everything')
  assert.match(mojom, /module orbis\.mojom;/)
})

test('nothing about a person is written into the wire between Orbis and the browser', async () => {
  const mojom = await readFile(join(import.meta.dirname, '..', '..', 'chromium', 'orbis', 'mojom', 'orbis_services.mojom'), 'utf8')
  // Conversations and Orion requests travel as their own JSON rather than as fields here, so the browser process
  // never grows a structure describing what somebody said.
  assert.doesNotMatch(mojom, /string (message|prompt|query|password|token|api_key);/, 'these belong inside a payload, not in the interface')
  assert.match(mojom, /string payload_json;/)
})
