import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { beginBreak, canMove, carryOn, endBreak, newSession, pause, resume } from './session.ts'
import type { FocusSession, SessionState } from './types.ts'
import { snapshotPolicy } from './focus.ts'

/**
 * Which of the running session's buttons can actually do anything, from where.
 *
 * The screen offers Pause, Break, Back to it and Carry on off the session's own state, and the service refuses any
 * move that is not legal from that state. Those two have to agree: a button offered for a move the rules refuse is a
 * button that looks dead. These tests pin the refusals the running screen relies on.
 */

const running = (state: SessionState): FocusSession => {
  const session = newSession(
    {
      id: 'one',
      profileId: 'p',
      title: 'Algebra',
      subject: 'maths',
      taskId: null,
      goalId: null,
      milestoneId: null,
      conceptId: null,
      intention: '',
      oneThing: '',
      level: 'focus',
      policy: snapshotPolicy({ level: 'focus' }),
      breaks: { focusMinutes: 0, breakMinutes: 5, blocks: 1, autoResume: false },
      plannedMinutes: 25,
      atmosphere: null,
      playlistId: null,
      capsuleId: null,
      spaceId: null
    },
    1000,
    0
  )
  return { ...session, state }
}

test('a break is not a move a recovering session can make', () => {
  assert.equal(canMove('recovering', 'break'), false)
  const asked = running('recovering')
  // The same thing the Break button would have asked for: the session comes back unchanged, so the service answers no.
  assert.equal(beginBreak(asked, 2000), asked)
})

test('a recovering session can be paused or carried on', () => {
  const asked = running('recovering')
  assert.equal(pause(asked, 2000).state, 'paused')
  assert.equal(carryOn(asked, 2000).state, 'active')
})

test('pause, resume and coming back off a break all move an eligible session', () => {
  assert.equal(pause(running('active'), 2000).state, 'paused')
  assert.equal(resume(running('paused'), 2000).state, 'active')
  assert.equal(endBreak(running('break'), 2000).state, 'active')
  assert.equal(beginBreak(running('active'), 2000).state, 'break')
})

test('a finished session refuses every one of them, so the screen has something to say', () => {
  for (const over of ['completed', 'ended-early', 'expired'] as const) {
    const done = running(over)
    assert.equal(pause(done, 2000), done)
    assert.equal(resume(done, 2000), done)
    assert.equal(beginBreak(done, 2000), done)
    assert.equal(endBreak(done, 2000), done)
    assert.equal(carryOn(done, 2000), done)
  }
})
