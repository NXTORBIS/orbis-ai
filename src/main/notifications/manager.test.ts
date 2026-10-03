import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { NotificationManager, HISTORY_LIMIT, type Delivery, type NotificationStore } from './manager.ts'
import { DEFAULT_NOTIFICATIONS } from '../../shared/experience.ts'
import type { NotificationsConfig } from '../../shared/experience.ts'
import type { OrbisNotification } from '../../shared/notifications.ts'

const NOON = new Date('2026-10-03T12:00:00').getTime()
const NIGHT = new Date('2026-10-03T23:30:00').getTime()

class Screen implements Delivery {
  shown: OrbisNotification[] = []
  there = true
  suppressed = false
  fail = false
  private activate = new Map<string, (actionId: string) => void>()
  available(): boolean {
    return this.there
  }
  quiet(): boolean {
    return this.suppressed
  }
  async show(one: OrbisNotification, onActivate: (actionId: string) => void): Promise<boolean> {
    if (this.fail) return false
    this.shown.push(one)
    this.activate.set(one.id, onActivate)
    return true
  }
  press(id: string, actionId: string): void {
    this.activate.get(id)?.(actionId)
  }
}

class Memory implements NotificationStore {
  kept = new Map<string, OrbisNotification[]>()
  broken = false
  async read(profileId: string): Promise<OrbisNotification[]> {
    if (this.broken) throw new Error('the file is unreadable')
    return [...(this.kept.get(profileId) ?? [])]
  }
  async write(profileId: string, history: readonly OrbisNotification[]): Promise<void> {
    this.kept.set(profileId, [...history])
  }
}

interface Rig {
  manager: NotificationManager
  screen: Screen
  store: Memory
  did: { action: string; id: string }[]
  settings: { value: NotificationsConfig }
  attention: { focused: boolean; watching?: string | null }
  tick(ms: number): void
}

function rig(over: { act?: (action: string) => Promise<{ ok: boolean; message?: string }> } = {}): Rig {
  const screen = new Screen()
  const store = new Memory()
  const did: { action: string; id: string }[] = []
  const settings = { value: { ...DEFAULT_NOTIFICATIONS } }
  const attention: { focused: boolean; watching?: string | null } = { focused: false }
  let now = NOON
  const manager = new NotificationManager({
    delivery: screen,
    store,
    settings: () => settings.value,
    attention: () => attention,
    act: async (action, one) => {
      did.push({ action, id: one.id })
      return over.act ? over.act(action) : { ok: true }
    },
    now: () => now
  })
  return { manager, screen, store, did, settings, attention, tick: (ms) => void (now += ms) }
}

/** The manager waits a moment before showing, to fold a burst. This is that moment. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 4200))

// ---------------------------------------------------------------- publishing

test('an event Orbis does not notify about makes nothing, and is not an error', async () => {
  const { manager, store } = rig()
  assert.equal(await manager.publish({ type: 'tab.opened', profileId: 'a' }), null)
  assert.equal((await manager.list('a')).length, 0)
  assert.equal(store.kept.size, 0)
})

test('a real event is recorded and then shown', async () => {
  const { manager, screen } = rig()
  const one = await manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'report.pdf' } })
  assert.ok(one)
  assert.equal((await manager.list('a')).length, 1)
  assert.equal(screen.shown.length, 0, 'it waits a moment first, in case more arrive')
  await settle()
  assert.equal(screen.shown.length, 1)
  assert.equal(screen.shown[0]?.body, 'report.pdf')
  assert.equal((await manager.list('a'))[0]?.status, 'delivered')
})

test('the same event twice is one notification', async () => {
  const { manager } = rig()
  await manager.publish({ type: 'workflow.completed', profileId: 'a', fields: { name: 'Daily', workflowId: 'w1' } })
  await manager.publish({ type: 'workflow.completed', profileId: 'a', fields: { name: 'Daily', workflowId: 'w1' } })
  assert.equal((await manager.list('a')).length, 1)
})

test('one profile cannot see another profile notifications', async () => {
  const { manager } = rig()
  await manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  await manager.publish({ type: 'download.completed', profileId: 'b', fields: { filename: 'b.pdf' } })
  assert.equal((await manager.list('a')).length, 1)
  assert.equal((await manager.list('b')).length, 1)
  assert.equal((await manager.list('a'))[0]?.body, 'a.pdf')
})

// ---------------------------------------------------------------- deciding

test('a switched-off category is kept in the history but never shown', async () => {
  const r = rig()
  r.settings.value = { ...DEFAULT_NOTIFICATIONS, categories: { downloads: false } }
  await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  await settle()
  assert.equal(r.screen.shown.length, 0)
  const history = await r.manager.list('a')
  assert.equal(history.length, 1, 'it still happened, and you can still go and look')
  assert.equal(history[0]?.status, 'suppressed')
})

test('what quiet hours hold is said afterwards, as one line', async () => {
  const r = rig()
  r.settings.value = { ...DEFAULT_NOTIFICATIONS, quietHours: { enabled: true, from: '22:00', to: '07:00' } }
  r.tick(NIGHT - NOON)
  await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'b.pdf' } })
  await settle()
  assert.equal(r.screen.shown.length, 0, 'nothing at half past eleven at night')
  await r.manager.releaseHeld('a')
  assert.equal(r.screen.shown.length, 1)
  assert.ok(r.screen.shown[0]?.title.includes('2'), r.screen.shown[0]?.title)
})

test('the computer being set not to disturb stops even a critical one, and keeps it', async () => {
  const r = rig()
  r.screen.suppressed = true
  await r.manager.publish({ type: 'security.blocked', profileId: 'a', fields: { reason: 'a dangerous download' } })
  await settle()
  assert.equal(r.screen.shown.length, 0)
  assert.equal((await r.manager.list('a'))[0]?.status, 'held')
  r.screen.suppressed = false
  await r.manager.releaseHeld('a')
  assert.equal(r.screen.shown.length, 1)
})

test('nothing is announced about the thing you are already watching', async () => {
  const r = rig()
  r.attention.focused = true
  r.attention.watching = 'downloads'
  await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  await settle()
  assert.equal(r.screen.shown.length, 0)
})

// ---------------------------------------------------------------- several at once

test('a burst of downloads becomes one line', async () => {
  const r = rig()
  for (const name of ['a.pdf', 'b.pdf', 'c.pdf']) {
    await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: name } })
  }
  await settle()
  assert.equal(r.screen.shown.length, 1)
  assert.equal(r.screen.shown[0]?.title, '3 downloads finished')
  assert.equal((await r.manager.list('a')).length, 3, 'all three are still in the history')
})

test('a critical event is not buried behind a pile of ordinary ones', async () => {
  const r = rig()
  for (let i = 0; i < 30; i++) {
    await r.manager.publish({ type: 'research.completed', profileId: 'a', fields: { topic: `t${i}`, researchId: `r${i}` } })
  }
  await r.manager.publish({ type: 'security.blocked', profileId: 'a', fields: { reason: 'a dangerous download' } })
  await settle()
  assert.equal(r.screen.shown[0]?.event, 'security.blocked', `the first thing shown was ${r.screen.shown[0]?.event}`)
})

test('two things waiting for you are two things, never folded into one', async () => {
  const r = rig()
  await r.manager.publish({ type: 'captcha.required', profileId: 'a', fields: { site: 'a.org', tabId: '1' } })
  await r.manager.publish({ type: 'captcha.required', profileId: 'a', fields: { site: 'b.org', tabId: '2' } })
  await settle()
  assert.equal(r.screen.shown.length, 2)
})

test('a storm of events cannot grow without bound', async () => {
  const r = rig()
  for (let i = 0; i < HISTORY_LIMIT + 120; i++) {
    await r.manager.publish({ type: 'research.completed', profileId: 'a', fields: { topic: `t${i}`, researchId: `r${i}` } })
  }
  assert.equal((await r.manager.list('a')).length, HISTORY_LIMIT)
})

// ---------------------------------------------------------------- pressing one

test('pressing a button runs it, and records that it was pressed', async () => {
  const r = rig()
  const one = await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf', path: 'C:/a.pdf' } })
  const result = await r.manager.activate(one!.id, 'a', 'open-file')
  assert.equal(result.ok, true)
  assert.deepEqual(r.did, [{ action: 'open-file', id: one!.id }])
  const history = await r.manager.list('a')
  assert.equal(history[0]?.status, 'actioned')
  assert.equal(history[0]?.read, true)
})

test('a button it never offered does nothing, whatever it is called', async () => {
  const r = rig()
  const one = await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  const result = await r.manager.activate(one!.id, 'a', 'delete-everything')
  assert.equal(result.ok, false)
  assert.equal(r.did.length, 0, 'nothing ran')
})

test('a notification from another profile cannot be acted on', async () => {
  const r = rig()
  const one = await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  const result = await r.manager.activate(one!.id, 'b', 'open-file')
  assert.equal(result.ok, false)
  assert.equal(r.did.length, 0)
})

test('a notification that no longer exists fails politely', async () => {
  const r = rig()
  const result = await r.manager.activate('nope', 'a', 'open')
  assert.equal(result.ok, false)
  assert.ok(result.message)
})

test('when the thing is gone, the button says so instead of pretending', async () => {
  const r = rig({ act: async () => ({ ok: false, message: 'That file is no longer there.' }) })
  const one = await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  const result = await r.manager.activate(one!.id, 'a', 'open-file')
  assert.equal(result.ok, false)
  assert.equal(result.message, 'That file is no longer there.')
  assert.equal((await r.manager.list('a'))[0]?.status, 'failed')
})

test('pressing the one the system shows runs its first button', async () => {
  const r = rig()
  const one = await r.manager.publish({ type: 'research.completed', profileId: 'a', fields: { topic: 'tides', researchId: 'x1' } })
  await settle()
  r.screen.press(one!.id, 'open')
  await new Promise((done) => setTimeout(done, 50))
  assert.deepEqual(r.did, [{ action: 'open', id: one!.id }])
})

// ---------------------------------------------------------------- the history

test('read, unread and clearing work on the real list', async () => {
  const r = rig()
  const one = await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  await r.manager.publish({ type: 'research.completed', profileId: 'a', fields: { topic: 'tides', researchId: 'x' } })
  assert.equal(await r.manager.unread('a'), 2)
  await r.manager.markRead('a', one!.id)
  assert.equal(await r.manager.unread('a'), 1)
  await r.manager.markRead('a', null)
  assert.equal(await r.manager.unread('a'), 0)
  await r.manager.clear('a', null)
  assert.equal((await r.manager.list('a')).length, 0)
})

test('the history survives being written and read again', async () => {
  const first = rig()
  await first.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  const kept = first.store.kept

  const again = rig()
  again.store.kept = kept
  const history = await again.manager.list('a')
  assert.equal(history.length, 1)
  assert.equal(history[0]?.body, 'a.pdf')
})

test('a history that will not read does not stop anything', async () => {
  const r = rig()
  r.store.broken = true
  const one = await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  assert.ok(one, 'the event still produced a notification')
  await settle()
  assert.equal(r.screen.shown.length, 1)
})

test('nowhere to show it is recorded as that, not as shown', async () => {
  const r = rig()
  r.screen.there = false
  await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf' } })
  await settle()
  const history = await r.manager.list('a')
  assert.equal(history[0]?.status, 'failed', 'never "delivered" when nothing delivered it')
  assert.equal(r.manager.capabilities().native, false)
})

test('clearing the history says nothing about the downloads themselves', async () => {
  // Nothing here can reach a download, a workflow or a file. That is the point, and this is the guard for it.
  const r = rig()
  await r.manager.publish({ type: 'download.completed', profileId: 'a', fields: { filename: 'a.pdf', downloadId: 'd1' } })
  await r.manager.clear('a', null)
  assert.equal(r.did.length, 0, 'clearing ran no action of any kind')
})

test('the one timer can be stopped', () => {
  const r = rig()
  r.manager.stop()
  assert.ok(true)
})
