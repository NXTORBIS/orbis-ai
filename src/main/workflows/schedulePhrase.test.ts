import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missedRun, parseSchedule, scheduleRequest } from '../../shared/schedulePhrase.ts'
import { nextScheduledRun } from '../../shared/workflows.ts'

// Thursday 17 September 2026, 10:00 local time.
const NOW = new Date(2026, 8, 17, 10, 0, 0).getTime()
const local = (d: number): string => {
  const x = new Date(d)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getDay()]} ${x.getDate()} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`
}

test('schedules said in words become real schedules, starting at the next time that fits', () => {
  const friday = parseSchedule('every Friday at 9am', NOW)
  assert.ok(friday.ok)
  if (friday.ok) {
    assert.equal(friday.schedule.kind, 'weekly')
    assert.equal(local(friday.schedule.at), 'Fri 18 09:00')
    assert.equal(friday.said, 'every Friday at 9am')
    assert.equal(local(nextScheduledRun(friday.schedule, friday.schedule.at)!), 'Fri 25 09:00', 'and the scheduler repeats it weekly')
  }
  const daily = parseSchedule('daily at 18:30', NOW)
  assert.ok(daily.ok && daily.schedule.kind === 'daily' && local(daily.schedule.at) === 'Thu 17 18:30')
  const earlier = parseSchedule('every day at 7', NOW)
  assert.ok(earlier.ok && local(earlier.schedule.at) === 'Fri 18 07:00', 'a time already past today starts tomorrow')
  const monthly = parseSchedule('every month on the 1st at noon', NOW)
  assert.ok(monthly.ok && monthly.schedule.kind === 'monthly' && local(monthly.schedule.at) === 'Thu 1 12:00')
  const tomorrow = parseSchedule('tomorrow at 7:15 pm', NOW)
  assert.ok(tomorrow.ok && tomorrow.schedule.kind === 'once' && local(tomorrow.schedule.at) === 'Fri 18 19:15')
})

test('anything that is not clearly a time Orbis can keep is refused, not guessed', () => {
  for (const vague of ['every other Tuesday', 'when it rains', 'every Friday at 25:00', 'every month on the 31st', 'today at 8am', 'every day at 13pm']) {
    const result = parseSchedule(vague, NOW)
    assert.equal(result.ok, false, vague)
  }
})

test('a chat request to schedule something names the thing and the time', () => {
  assert.deepEqual(scheduleRequest('Run Morning briefing every Friday at 9am'), { name: 'Morning briefing', phrase: 'every Friday at 9am' })
  assert.deepEqual(scheduleRequest('please run the workflow "Price check" daily at 18:30.'), { name: 'Price check', phrase: 'daily at 18:30' })
  assert.equal(scheduleRequest('What is the weather every Friday?'), null)
  assert.equal(scheduleRequest('run faster'), null)
})

test('a run missed while Orbis was closed is caught up once, and only if recent', () => {
  const daily9 = { enabled: true, kind: 'daily' as const, at: new Date(2026, 8, 1, 9, 0).getTime() }
  const nineToday = new Date(2026, 8, 17, 9, 0).getTime()
  assert.equal(missedRun(daily9, new Date(2026, 8, 16, 9, 1).getTime(), NOW), nineToday, 'yesterday ran, today at 9 was missed')
  assert.equal(missedRun(daily9, nineToday + 60_000, NOW), null, 'already ran today')
  assert.equal(missedRun(daily9, new Date(2026, 8, 1, 9, 1).getTime(), NOW), nineToday, 'away for two weeks: one catch-up, for the latest')
  const oldOnce = { enabled: true, kind: 'once' as const, at: NOW - 3 * 24 * 3_600_000 }
  assert.equal(missedRun(oldOnce, undefined, NOW), null, 'a one-off from three days ago is too old to run now')
  const recentOnce = { enabled: true, kind: 'once' as const, at: NOW - 3_600_000 }
  assert.equal(missedRun(recentOnce, undefined, NOW), recentOnce.at)
  assert.equal(missedRun({ ...daily9, enabled: false }, undefined, NOW), null)
})
