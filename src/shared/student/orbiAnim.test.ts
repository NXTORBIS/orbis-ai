import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ANIMATIONS, EXTRA_MINUTES_A_DAY, TIERS, ambient, constellation, frame, nextAnimation, nextTier, offerExtraMinute, skyProgress, stageNow, tierFor, watchRecord, type Playing } from './orbiAnim.ts'
import { defaultBehaviour } from './orbi.ts'
import { DEFAULT_BREAKS, snapshotPolicy } from './focus.ts'
import { newSession } from './session.ts'
import { emptyRecords } from './progress.ts'
import type { FocusSession } from './types.ts'

/**
 * Orbi's animation system, tested on the thing it exists for: making sure the shield is never late.
 *
 * Everything else here is cheap to get right and cheap to get wrong in a way nobody notices, which is the same
 * reason it is worth a test file.
 */

const NOW = new Date(2026, 9, 3, 14, 0, 0).getTime()

const session = (patch: Partial<FocusSession> = {}): FocusSession => ({
  ...newSession(
    {
      id: 's1',
      profileId: 'p1',
      title: 'Kinematics',
      subject: 'Physics',
      taskId: null,
      goalId: null,
      milestoneId: null,
    conceptId: null,
      intention: '',
      oneThing: '',
      level: 'focus',
      policy: snapshotPolicy({ level: 'focus' }),
      breaks: DEFAULT_BREAKS,
      plannedMinutes: 50,
      atmosphere: null,
      playlistId: null,
      capsuleId: null,
      spaceId: null
    },
    NOW,
    1000
  ),
  ...patch
})

describe('what Orbi is doing', () => {
  it('falls back to floating when nothing is happening', () => {
    const out = nextAnimation(null, null, 'idle', NOW)
    assert.equal(out.moment, 'idle')
    assert.equal(out.endsAt, null, 'the ambient layer runs until something replaces it')
  })

  it('reads the ambient state off what the student is doing', () => {
    const base = { session: null, idleMinutes: 0, hour: 14, hovering: false, dragging: false, thinking: false }
    assert.equal(ambient(base), 'idle')
    assert.equal(ambient({ ...base, hovering: true }), 'hover')
    assert.equal(ambient({ ...base, dragging: true, hovering: true }), 'drag', 'dragging wins over hovering')
    assert.equal(ambient({ ...base, thinking: true }), 'thinking')
    assert.equal(ambient({ ...base, idleMinutes: 30, hour: 2 }), 'sleep')
    assert.equal(ambient({ ...base, session: session(), idleMinutes: 30 }), 'idle', 'a running session is never asleep')
  })

  it('puts the shield up at once, whatever was playing', () => {
    // The one case this module exists for.
    const celebrating = nextAnimation(null, 'level-up', 'idle', NOW)
    assert.equal(celebrating.moment, 'level-up')
    const shielded = nextAnimation(celebrating, 'shield', 'idle', NOW + 200)
    assert.equal(shielded.moment, 'shield', 'a celebration never delays a shield')
    assert.equal(shielded.startedAt, NOW + 200)
  })

  it('does not let a small thing interrupt a big one', () => {
    const levelling = nextAnimation(null, 'level-up', 'idle', NOW)
    const asked = nextAnimation(levelling, 'milestone', 'idle', NOW + 300)
    assert.equal(asked.moment, 'level-up')
    assert.equal(asked.startedAt, levelling.startedAt, 'and it is not restarted either')
  })

  it('drops a lower-priority animation rather than queueing it', () => {
    const levelling = nextAnimation(null, 'level-up', 'idle', NOW)
    nextAnimation(levelling, 'xp', 'idle', NOW + 100)
    // When the big one finishes, the small one does not then play: it is gone.
    const after = nextAnimation(levelling, null, 'idle', NOW + 4000)
    assert.equal(after.moment, 'idle', 'nothing is still reacting to something a minute old')
  })

  it('lets one of the same weight take over when the first says it may', () => {
    const first = nextAnimation(null, 'milestone', 'idle', NOW)
    assert.ok(ANIMATIONS.milestone.interruptible)
    const second = nextAnimation(first, 'xp', 'idle', NOW + 200)
    assert.equal(second.moment, 'xp')
  })

  it('refuses to cut a completion short', () => {
    assert.equal(ANIMATIONS['session-complete'].interruptible, false)
    const finishing = nextAnimation(null, 'session-complete', 'idle', NOW)
    const other = nextAnimation(finishing, 'restored', 'idle', NOW + 200)
    assert.equal(other.moment, 'session-complete')
  })

  it('gives the ambient layer back once a moment has passed', () => {
    const held = nextAnimation(null, 'milestone', 'idle', NOW)
    const after = nextAnimation(held, null, 'idle', NOW + 2000)
    assert.equal(after.moment, 'idle')
  })

  it('keeps the same ambient animation rather than restarting it every call', () => {
    const first = nextAnimation(null, null, 'idle', NOW)
    const second = nextAnimation(first, null, 'idle', NOW + 5000)
    assert.equal(second, first, 'the same object, so nothing re-renders')
  })
})

describe('how hard the animation works', () => {
  const playing: Playing = { moment: 'level-up', startedAt: NOW, endsAt: NOW + 3600 }

  it('stops moving entirely when less movement was asked for, and keeps the state', () => {
    const out = frame(playing, NOW + 1000, defaultBehaviour(), false, true)
    assert.equal(out.ring, 0)
    assert.equal(out.float, 0)
    assert.equal(out.particles, false)
    assert.equal(out.state, 'level-up', 'the state is still legible without any motion')
    assert.ok(out.glow > 0)
  })

  it('moves less, rather than not at all, when the machine is busy', () => {
    const full = frame(playing, NOW + 1000, defaultBehaviour(), false, false)
    const low = frame(playing, NOW + 1000, defaultBehaviour(), true, false)
    assert.ok(low.ring > 0 && low.ring < full.ring)
    assert.equal(low.particles, false, 'particles are the first thing dropped')
  })

  it('holds back a celebration for somebody who asked for none', () => {
    const quiet = frame(playing, NOW + 1000, { ...defaultBehaviour(), celebration: 'off' }, false, false)
    assert.equal(quiet.ring, 0)
    const subtle = frame(playing, NOW + 1000, { ...defaultBehaviour(), celebration: 'subtle' }, false, false)
    // The default is already 'subtle', so 'full' has to be asked for by name.
    const full = frame(playing, NOW + 1000, { ...defaultBehaviour(), celebration: 'full' }, false, false)
    assert.ok(subtle.ring > 0 && subtle.ring < full.ring)
  })

  it('does not hold back the small things for the same setting', () => {
    const small: Playing = { moment: 'milestone', startedAt: NOW, endsAt: NOW + 1100 }
    const quiet = frame(small, NOW + 100, { ...defaultBehaviour(), celebration: 'off' }, false, false)
    assert.ok(quiet.ring > 0, 'a milestone is information, not a celebration')
  })

  it('reports how far through it is, and nothing for the ambient ones', () => {
    assert.equal(frame(playing, NOW + 1800, defaultBehaviour(), false, false).through, 0.5)
    assert.equal(frame({ moment: 'idle', startedAt: NOW, endsAt: null }, NOW + 9999, defaultBehaviour(), false, false).through, 0)
  })
})

describe('the stages of a session', () => {
  it('names where somebody is, and what is next', () => {
    assert.equal(stageNow(0).name, 'Start')
    assert.equal(stageNow(0.3).name, 'Momentum')
    assert.equal(stageNow(0.5).name, 'Build')
    assert.equal(stageNow(0.7).name, 'Deep focus')
    assert.equal(stageNow(0.9).name, 'Final push')
    assert.equal(stageNow(1).name, 'Complete')
    assert.equal(stageNow(0.3).next?.name, 'Build')
    assert.equal(stageNow(1).next, null)
  })

  it('does not fall over on a number outside the range', () => {
    assert.equal(stageNow(-3).name, 'Start')
    assert.equal(stageNow(9).name, 'Complete')
  })
})

describe('being about to beat a record', () => {
  it('says nothing when there is no record worth beating', () => {
    assert.equal(watchRecord(session({ focusedSeconds: 600 }), emptyRecords(), 600), null)
  })

  it('says so only when it is close', () => {
    const records = { ...emptyRecords(), longestSessionSeconds: 3000 }
    assert.equal(watchRecord(session({ focusedSeconds: 600 }), records, 600), null, 'forty minutes early is noise')
    const close = watchRecord(session({ focusedSeconds: 2800 }), records, 2800)
    assert.equal(close?.what, 'your longest session')
    assert.equal(close?.inSeconds, 200)
    assert.equal(close?.beaten, false)
  })

  it('says the moment it is beaten, and then stops', () => {
    const records = { ...emptyRecords(), longestSessionSeconds: 3000 }
    assert.equal(watchRecord(session({ focusedSeconds: 3010 }), records, 3010)?.beaten, true)
    assert.equal(watchRecord(session({ focusedSeconds: 3400 }), records, 3400), null, 'it is not still being announced minutes later')
  })

  it('watches the day as well as the session', () => {
    const records = { ...emptyRecords(), bestDaySeconds: 7200 }
    const close = watchRecord(session({ focusedSeconds: 600 }), records, 7000)
    assert.equal(close?.what, "your best day's total")
  })

  it('says nothing with no session running', () => {
    assert.equal(watchRecord(null, { ...emptyRecords(), longestSessionSeconds: 3000 }, 2900), null)
  })
})

describe('Orbi growing up', () => {
  it('changes how it looks as the student levels, and nothing else', () => {
    assert.equal(tierFor(1).id, 'basic')
    assert.equal(tierFor(7).id, 'explorer')
    assert.equal(tierFor(10).id, 'scholar')
    assert.equal(tierFor(60).id, 'orbit-master')
    assert.equal(nextTier(1)?.id, 'explorer')
    assert.equal(nextTier(60), null)
  })

  it('names the tiers after places rather than ranks', () => {
    for (const tier of TIERS) {
      assert.ok(!/genius|smart|clever|best|elite|pro/i.test(`${tier.name} ${tier.blurb}`), `${tier.name} reads as a judgement`)
    }
  })
})

describe('the constellation', () => {
  const goals = [
    { id: 'g1', title: 'Physics', state: 'completed', milestones: [{ id: 'm1', title: 'Kinematics', completedAt: NOW }, { id: 'm2', title: 'Forces', completedAt: null }] },
    { id: 'g2', title: 'Maths', state: 'active', milestones: [] }
  ]

  it('lights a star only for something actually finished', () => {
    const stars = constellation(goals, [])
    assert.equal(stars.find((one) => one.id === 'goal:g1')?.lit, true)
    assert.equal(stars.find((one) => one.id === 'goal:g2')?.lit, false)
    assert.equal(stars.find((one) => one.id === 'milestone:m1')?.lit, true)
    assert.equal(stars.find((one) => one.id === 'milestone:m2')?.lit, false)
  })

  it('hangs a milestone off its goal', () => {
    const stars = constellation(goals, [])
    assert.equal(stars.find((one) => one.id === 'milestone:m1')?.parent, 'goal:g1')
    assert.equal(stars.find((one) => one.id === 'goal:g1')?.parent, null)
  })

  it('keeps every star on screen', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, title: `Goal ${i}`, state: 'active', milestones: Array.from({ length: 5 }, (_, j) => ({ id: `m${i}-${j}`, title: 'M', completedAt: null })) }))
    for (const star of constellation(many, [])) {
      assert.ok(star.x >= 0 && star.x <= 1, `x out of the box: ${star.x}`)
      assert.ok(star.y >= 0 && star.y <= 1, `y out of the box: ${star.y}`)
    }
  })

  it('puts a star in the same place every time', () => {
    const first = constellation(goals, [{ subject: 'Physics', focusedSeconds: 7200 }])
    const second = constellation(goals, [{ subject: 'Physics', focusedSeconds: 7200 }])
    assert.deepEqual(first, second, 'nothing moves between renders')
  })

  it('leaves out a subject with barely any time against it', () => {
    const stars = constellation([], [{ subject: 'Physics', focusedSeconds: 300 }])
    assert.equal(stars.length, 0)
  })

  it('counts what is lit', () => {
    assert.deepEqual(skyProgress(constellation(goals, [])), { lit: 2, total: 4 })
  })
})

describe('one more minute', () => {
  it('is offered only right at the end', () => {
    assert.equal(offerExtraMinute(session({ focusedSeconds: 600 }), 0), false)
    assert.equal(offerExtraMinute(session({ focusedSeconds: 50 * 60 - 30 }), 0), true)
  })

  it('cannot be taken all day', () => {
    assert.equal(offerExtraMinute(session({ focusedSeconds: 50 * 60 - 30 }), EXTRA_MINUTES_A_DAY), false)
  })

  it('is not offered when the time is already up, or when nothing is running', () => {
    assert.equal(offerExtraMinute(session({ focusedSeconds: 50 * 60 }), 0), false)
    assert.equal(offerExtraMinute(null, 0), false)
  })
})
