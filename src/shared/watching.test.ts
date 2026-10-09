import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { notificationFor, shouldShow } from './notifications.ts'
import { DEFAULT_NOTIFICATIONS } from './experience.ts'
import { WATCHABLE_GROUPS, watchingGroup } from './watching.ts'

test('a screen that shows the thing is watching its group; one that does not is watching nothing', () => {
  assert.equal(watchingGroup('pages'), 'pages')
  assert.equal(watchingGroup('create'), 'artifacts')
  assert.equal(watchingGroup('schedules'), 'schedules')
  assert.equal(watchingGroup('notes'), null, 'notes shows no notification group')
  assert.equal(watchingGroup(null), null, 'the chat is not watching anything')
  assert.equal(watchingGroup('nonsense'), null)
})

test('every group a screen can watch is a group notifications are actually put into', () => {
  for (const name of ['pages', 'create', 'schedules', 'workflows', 'downloads', 'library', 'research']) {
    const group = watchingGroup(name)
    assert.ok(group, name)
    assert.ok((WATCHABLE_GROUPS as readonly string[]).includes(group), `${group} is not a real group`)
  }
})

test('the mapping is what makes the suppression rule fire at all', () => {
  const noon = new Date('2026-10-03T12:00:00').getTime()
  const one = notificationFor({ type: 'download.completed', profileId: 'default', fields: { filename: 'a.pdf' }, at: noon }, 'n1')
  assert.ok(one)
  assert.equal(shouldShow(one, DEFAULT_NOTIFICATIONS, { focused: true, watching: watchingGroup('library') }, noon).show, false, 'not announced while the downloads list is open')
  assert.equal(shouldShow(one, DEFAULT_NOTIFICATIONS, { focused: true, watching: watchingGroup('notes') }, noon).show, true, 'announced anywhere else')
})
