import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  badge,
  cleanLine,
  coalesce,
  deliveryOrder,
  heldSummary,
  isDuplicate,
  notificationFor,
  NOTIFICATION_TEMPLATES,
  prune,
  redactSecrets,
  shouldShow,
  unreadCount,
  type OrbisNotification
} from './notifications.ts'
import { DEFAULT_NOTIFICATIONS } from './experience.ts'
import type { NotificationsConfig } from './experience.ts'

const settings = (over: Partial<NotificationsConfig> = {}): NotificationsConfig => ({ ...DEFAULT_NOTIFICATIONS, ...over })
const awake = { focused: false }
const NOON = new Date('2026-10-03T12:00:00').getTime()
const NIGHT = new Date('2026-10-03T23:30:00').getTime()

const make = (type: string, fields: Record<string, string> = {}, id = 'n1'): OrbisNotification => {
  const one = notificationFor({ type, profileId: 'default', fields, at: NOON }, id)
  assert.ok(one, `${type} should produce a notification`)
  return one!
}

// ---------------------------------------------------------------- an event becomes a notification

test('an event Orbis does not interrupt anybody for produces nothing', () => {
  assert.equal(notificationFor({ type: 'tab.opened', profileId: 'default' }, 'n1'), null)
  assert.equal(notificationFor({ type: 'page.scrolled', profileId: 'default' }, 'n1'), null)
})

test('an event with no profile produces nothing, because it could not be kept apart', () => {
  assert.equal(notificationFor({ type: 'workflow.completed', profileId: '' }, 'n1'), null)
})

test('a workflow finishing says so in words a person would use', () => {
  const one = make('workflow.completed', { name: 'Daily research', workflowId: 'w1' })
  assert.equal(one.title, 'Daily research finished')
  assert.equal(one.category, 'workflows')
  assert.equal(one.priority, 'normal')
  assert.deepEqual(one.subject, { workflowId: 'w1' }, 'it carries the id and nothing else of it')
})

test('a workflow failing is more urgent than one finishing, and offers to try again', () => {
  const failed = make('workflow.failed', { name: 'Daily research', reason: 'the site could not be reached' })
  assert.equal(failed.priority, 'high')
  assert.ok(failed.actions.some((a) => a.id === 'retry'))
  assert.ok(failed.body.includes('could not be reached'))
})

test('something waiting for a person is its own category, whatever it came from', () => {
  assert.equal(make('captcha.required', { site: 'example.org' }).category, 'attention')
  assert.equal(make('workflow.waiting').category, 'attention')
  assert.equal(make('orion.waiting').category, 'attention')
})

test('a thing that waits for a person never expires, and a finished download does', () => {
  assert.equal(make('captcha.required').expiresAt, null)
  assert.ok((make('download.completed', { filename: 'a.pdf' }).expiresAt ?? 0) > NOON)
})

test('the same event twice gives the same key, and two runs of a daily job do not', () => {
  const a = make('schedule.completed', { name: 'Morning', scheduleId: 's1', runId: 'r1' })
  const b = make('schedule.completed', { name: 'Morning', scheduleId: 's1', runId: 'r1' }, 'n2')
  const next = make('schedule.completed', { name: 'Morning', scheduleId: 's1', runId: 'r2' }, 'n3')
  assert.equal(a.dedupe, b.dedupe)
  assert.notEqual(a.dedupe, next.dedupe, 'each run of a recurring job is its own event')
  assert.equal(isDuplicate(b, [a]), true)
  assert.equal(isDuplicate(next, [a]), false)
})

test('two different events with no ids to tell them apart are two events', () => {
  // With nothing distinguishing them they all shared one key, and the second and third were dropped as repeats.
  const a = make('download.completed', { filename: 'a.pdf' }, 'n1')
  const b = make('download.completed', { filename: 'b.pdf' }, 'n2')
  const same = make('download.completed', { filename: 'a.pdf' }, 'n3')
  assert.notEqual(a.dedupe, b.dedupe, 'two different files are two downloads')
  assert.equal(a.dedupe, same.dedupe, 'the same file reported twice is still one download')
})

// ---------------------------------------------------------------- nothing unsafe reaches a screen

test('anything that looks like a secret is taken out of the words', () => {
  const one = make('download.completed', { filename: 'ghp_abcdefghijklmnopqrstuvwxyz0123.txt' })
  assert.ok(!one.body.includes('ghp_abcdefghijklmnopqrstuvwxyz0123'), one.body)
  assert.ok(one.body.includes('[hidden]'))
})

test('ordinary words are left alone', () => {
  assert.equal(redactSecrets('Quarterly report final.pdf'), 'Quarterly report final.pdf')
  assert.equal(redactSecrets('my password is in the drawer'), 'my password is in the drawer')
})

test('control characters and direction marks are stripped, and long lines are cut', () => {
  assert.equal(cleanLine('a\u0000b‮c', 90), 'abc')
  const long = cleanLine('x'.repeat(400), 90)
  assert.equal(long.length, 90)
  assert.ok(long.endsWith('…'))
})

test('a security notification is marked as not for a locked screen', () => {
  assert.equal(make('security.blocked', { reason: 'a dangerous download' }).sensitive, true)
  assert.equal(make('download.completed', { filename: 'a.pdf' }).sensitive, false)
})

// ---------------------------------------------------------------- whether to say it

test('an ordinary notification is shown', () => {
  assert.deepEqual(shouldShow(make('download.completed', { filename: 'a.pdf' }), settings(), awake, NOON), { show: true })
})

test('a category switched off is not shown, and the download still happened', () => {
  const off = settings({ categories: { downloads: false } })
  const verdict = shouldShow(make('download.completed', { filename: 'a.pdf' }), off, awake, NOON)
  assert.equal(verdict.show, false)
  assert.equal(verdict.show === false && verdict.hold, false, 'switched off means never, not later')
})

test('quiet hours hold a notification rather than throwing it away', () => {
  const quiet = settings({ quietHours: { enabled: true, from: '22:00', to: '07:00' } })
  const verdict = shouldShow(make('download.completed', { filename: 'a.pdf' }), quiet, awake, NIGHT)
  assert.equal(verdict.show, false)
  assert.equal(verdict.show === false && verdict.hold, true)
})

test('something critical gets through quiet hours and a switched-off category', () => {
  const quiet = settings({ quietHours: { enabled: true, from: '22:00', to: '07:00' }, categories: { security: false } })
  assert.deepEqual(shouldShow(make('security.blocked', { reason: 'a dangerous download' }), quiet, awake, NIGHT), { show: true })
})

test('the computer being set not to disturb is respected, even by something critical', () => {
  const verdict = shouldShow(make('security.blocked', { reason: 'x' }), settings(), { focused: false, doNotDisturb: true }, NOON)
  assert.equal(verdict.show, false)
  assert.equal(verdict.show === false && verdict.hold, true, 'it waits rather than being lost')
})

test('nothing is said about what you are already watching', () => {
  const watching = { focused: true, watching: 'downloads' }
  assert.equal(shouldShow(make('download.completed', { filename: 'a.pdf' }), settings(), watching, NOON).show, false)
  // ...but being asked for something is exactly when you need telling.
  assert.equal(shouldShow(make('captcha.required', { site: 'example.org' }), settings(), { focused: true, watching: 'captcha.required:default' }, NOON).show, true)
})

test('watching one thing does not silence another', () => {
  const watching = { focused: true, watching: 'downloads' }
  assert.equal(shouldShow(make('research.completed', { topic: 'tides' }), settings(), watching, NOON).show, true)
})

test('an expired notification is never shown', () => {
  const old = make('download.completed', { filename: 'a.pdf' })
  assert.equal(shouldShow(old, settings(), awake, NOON + 10 * 24 * 60 * 60 * 1000).show, false)
})

// ---------------------------------------------------------------- several at once

test('urgent things are delivered before a pile of ordinary ones', () => {
  const queue = [
    ...Array.from({ length: 20 }, (_, i) => make('download.completed', { filename: `f${i}.pdf` }, `d${i}`)),
    make('security.blocked', { reason: 'a dangerous download' }, 'sec')
  ]
  assert.equal(deliveryOrder(queue)[0]?.id, 'sec', 'a critical event must not be buried')
})

test('a burst of the same kind becomes one line', () => {
  const downloads = [1, 2, 3].map((n) => make('download.completed', { filename: `f${n}.pdf` }, `d${n}`))
  const folded = coalesce(downloads)
  assert.equal(folded?.title, '3 downloads finished')
  assert.ok(folded?.body.includes('f1.pdf'))
})

test('one on its own is not folded, and things waiting for you are never folded', () => {
  assert.equal(coalesce([make('download.completed', { filename: 'a.pdf' })]), null)
  const waiting = [make('captcha.required', { site: 'a.org' }, 'c1'), make('captcha.required', { site: 'b.org' }, 'c2')]
  assert.equal(coalesce(waiting), null, 'two things to go and do are two things, not one line')
})

test('unrelated events are not folded together', () => {
  const mixed = [make('download.completed', { filename: 'a.pdf' }, 'd1'), make('research.completed', { topic: 'tides' }, 'r1')]
  assert.equal(coalesce(mixed), null)
})

test('what was held overnight is summarised in one line', () => {
  const held = [make('download.completed', { filename: 'a.pdf' }, 'd1'), make('download.completed', { filename: 'b.pdf' }, 'd2')]
  const summary = heldSummary(held)
  assert.ok(summary?.title.includes('2'))
  assert.equal(heldSummary([]), null)
  assert.equal(heldSummary([held[0]!])?.title, held[0]!.title, 'one held notification is just said')
})

// ---------------------------------------------------------------- the history

test('expired entries are dropped, and the newest are kept', () => {
  const now = NOON + 5 * 24 * 60 * 60 * 1000
  const history = [make('download.completed', { filename: 'old.pdf' }, 'd1'), { ...make('captcha.required', {}, 'c1'), at: now }]
  const kept = prune(history, 50, now)
  assert.equal(kept.length, 1)
  assert.equal(kept[0]?.id, 'c1')
})

test('the history is capped, newest first', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ ...make('captcha.required', {}, `c${i}`), at: NOON + i }))
  const kept = prune(many, 100, NOON)
  assert.equal(kept.length, 100)
  assert.equal(kept[0]?.id, 'c299')
})

test('the unread count is real, and the badge never shows a number nothing can draw', () => {
  const history = [make('captcha.required', {}, 'a'), { ...make('captcha.required', {}, 'b'), read: true }]
  assert.equal(unreadCount(history), 1)
  assert.equal(badge(0), '')
  assert.equal(badge(7), '7')
  assert.equal(badge(1200), '99+')
})

// ---------------------------------------------------------------- the templates themselves

test('every template says something, keeps it short, and offers only real actions', () => {
  const allowed = new Set(['open', 'open-file', 'open-challenge', 'show-in-folder', 'retry', 'run-now', 'restart', 'stop', 'dismiss'])
  for (const type of Object.keys(NOTIFICATION_TEMPLATES)) {
    const one = notificationFor({ type, profileId: 'default', fields: {} }, 'x')
    assert.ok(one, `${type} produced nothing even with no fields`)
    assert.ok(one!.title.length > 0 && one!.title.length <= 90, `${type} has a bad title: ${one!.title}`)
    assert.ok(one!.body.length <= 220, `${type} has a body too long`)
    assert.ok(one!.actions.length <= 2, `${type} offers too many buttons`)
    for (const action of one!.actions) assert.ok(allowed.has(action.id), `${type} offers an action nothing handles: ${action.id}`)
  }
})

test('a template missing the field it wanted still says something sensible', () => {
  const one = make('workflow.completed', {})
  assert.equal(one.title, 'A workflow finished')
  assert.ok(one.body.length > 0)
})
