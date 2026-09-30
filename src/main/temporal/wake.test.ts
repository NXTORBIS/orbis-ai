import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_POLICIES, TEMPORAL_FORMAT, type JobState, type TemporalJob } from '../../shared/temporal/job.ts'
import { WAKE_FURTHEST_MS, WAKE_SOONEST_MS, earliestWake, shouldStayAlive, taskTime, wakeTaskXml, wakeWording } from './wake.ts'

/**
 * Keeping the clock alive, and waking a sleeping computer.
 *
 * These are about restraint as much as correctness: one task rather than one per schedule, no wake for something
 * that will still be due when the machine wakes anyway, and no process left running with nothing to run.
 */

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)

function job(nextRunAt: number | null, state: JobState = 'scheduled'): TemporalJob {
  return {
    format: TEMPORAL_FORMAT,
    jobId: `j${nextRunAt}-${state}`,
    profileId: 'p1',
    name: 'Morning news',
    said: '',
    action: { kind: 'notify', message: 'Morning' },
    schedule: { recurrence: { kind: 'daily', time: { hour: 8, minute: 0 } }, timeZone: 'UTC' },
    policies: { ...DEFAULT_POLICIES },
    conditions: [],
    state,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW,
    version: 1,
    nextRunAt,
    lastRunAt: null,
    runsSoFar: 0,
    history: [],
    skipped: []
  }
}

// ---------------------------------------------------------------- staying alive

test('Orbis stays running only when it was asked to and has something to run', () => {
  const soon = [job(NOW + 3_600_000)]
  assert.equal(shouldStayAlive(soon, true).stay, true)
  assert.equal(shouldStayAlive(soon, false).stay, false, 'not asked for')
  assert.equal(shouldStayAlive([], true).stay, false, 'nothing to stay alive for')
})

test('paused and stopped schedules are not a reason to keep running', () => {
  assert.equal(shouldStayAlive([job(NOW + 3_600_000, 'paused')], true).stay, false)
  assert.equal(shouldStayAlive([job(NOW + 3_600_000, 'cancelled')], true).stay, false)
  assert.equal(shouldStayAlive([job(null, 'completed')], true).stay, false)
})

test('when it stays, it says why and how to stop it', () => {
  // A process running with no way to see or quit it is not a feature.
  const answer = shouldStayAlive([job(NOW + 3_600_000), job(NOW + 7_200_000)], true)
  assert.match(answer.because, /2 schedules/)
  assert.match(answer.because, /tray/)
})

// ---------------------------------------------------------------- when to wake

test('the soonest schedule decides the wake, and there is only ever one', () => {
  const at = earliestWake([job(NOW + 6 * 3_600_000), job(NOW + 2 * 3_600_000), job(NOW + 86_400_000)], NOW)
  assert.equal(at, NOW + 2 * 3_600_000)
})

test('nothing wakes the machine for something a few minutes away', () => {
  /**
   * It will still be due when the machine wakes on its own, and a wake every couple of minutes is how a laptop never
   * really sleeps at all.
   */
  assert.equal(earliestWake([job(NOW + 60_000)], NOW), null)
  assert.equal(earliestWake([job(NOW + WAKE_SOONEST_MS - 1)], NOW), null)
  assert.equal(earliestWake([job(NOW + WAKE_SOONEST_MS + 1)], NOW), NOW + WAKE_SOONEST_MS + 1)
})

test('nothing holds a standing wake for something a month away', () => {
  assert.equal(earliestWake([job(NOW + WAKE_FURTHEST_MS + 86_400_000)], NOW), null)
})

test('a schedule that is due now is not a wake either', () => {
  // It is due; the scheduler runs it on this pass rather than asking to be woken for it.
  assert.equal(earliestWake([job(NOW - 3_600_000)], NOW), null)
})

test('paused and stopped schedules do not wake the machine', () => {
  assert.equal(earliestWake([job(NOW + 3_600_000, 'paused')], NOW), null)
  assert.equal(earliestWake([job(NOW + 3_600_000, 'cancelled')], NOW), null)
})

// ---------------------------------------------------------------- the task itself

test('the task carries the flag that is the whole point of it', () => {
  const xml = wakeTaskXml(NOW + 3_600_000, 'C:\\Orbis\\Orbis.exe')
  // Without this the task simply runs late, when the machine happens to wake on its own.
  assert.match(xml, /<WakeToRun>true<\/WakeToRun>/)
  assert.match(xml, /<TimeTrigger>/)
  assert.match(xml, /C:\\Orbis\\Orbis\.exe/)
})

test('it runs once, at least privilege, and does not stop itself on battery', () => {
  const xml = wakeTaskXml(NOW + 3_600_000, 'C:\\Orbis\\Orbis.exe')
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/, 'a schedule needs no administrator')
  assert.match(xml, /<DisallowStartIfOnBatteries>false</)
  assert.match(xml, /<StopIfGoingOnBatteries>false</)
  // One instance, so a wake arriving while Orbis is already running does not start a second.
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew</)
  assert.equal((xml.match(/<TimeTrigger>/g) ?? []).length, 1)
})

test('a path with characters XML cares about does not end the document early', () => {
  const xml = wakeTaskXml(NOW + 3_600_000, 'C:\\Program Files\\Orbis & Co\\Orbis.exe', ['--from="wake"'])
  assert.match(xml, /Orbis &amp; Co/)
  assert.match(xml, /&quot;wake&quot;/)
  assert.ok(!xml.includes('Co\\Orbis.exe</Command>&'), 'nothing escaped out of its element')
})

test('arguments are left out entirely when there are none', () => {
  // An empty <Arguments/> is accepted but reads as though something was meant to be there.
  assert.ok(!wakeTaskXml(NOW, 'C:\\Orbis\\Orbis.exe').includes('<Arguments>'))
  assert.match(wakeTaskXml(NOW, 'C:\\Orbis\\Orbis.exe', ['--woken']).trim(), /<Arguments>--woken<\/Arguments>/)
})

test('the time is local and has no zone on it, which is what Task Scheduler reads', () => {
  const text = taskTime(new Date(2026, 5, 15, 8, 5).getTime())
  assert.equal(text, '2026-06-15T08:05:00')
  assert.ok(!text.endsWith('Z'), 'a Z would be read as UTC and fire at the wrong local time')
})

// ---------------------------------------------------------------- what it says about it

test('what it cannot do is said, not implied', () => {
  const words = wakeWording(NOW + 3_600_000)
  assert.match(words, /fully switched off/)
  assert.match(words, /wake timers/)
  assert.match(words, /battery/)
  assert.match(wakeWording(null), /Nothing is close enough/)
})
