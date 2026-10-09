import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { StudentStore } from './store.ts'
import { StudentService, type StudentHooks } from './service.ts'
import { FocusEnforcer, shieldPage, type EnforceablePage } from './enforce.ts'
import { totalXp } from '../../shared/student/progress.ts'
import type { FocusSession, PolicyState } from '../../shared/student/types.ts'

/**
 * Orbis Student against the real store and the real service.
 *
 * The core is tested on its own elsewhere. What is tested here is the things only the whole thing can get wrong:
 * paying twice, losing a session to a restart, letting one profile see another's work, and telling the browser
 * something different from what the policy says.
 */

let root = ''

const made: StudentService[] = []

async function build(profileId = 'default'): Promise<{ store: StudentStore; service: StudentService; told: Parameters<StudentHooks['enforce']>[0][]; notices: { title: string; body: string }[] }> {
  const store = new StudentStore(root, profileId)
  const told: Parameters<StudentHooks['enforce']>[0][] = []
  const notices: { title: string; body: string }[] = []
  const service = new StudentService(store, {
    enforce: (policy) => void told.push(policy),
    notify: (notice) => void notices.push({ title: notice.title, body: notice.body })
  })
  made.push(service)
  return { store, service, told, notices }
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'orbis-student-'))
})

after(async () => {
  for (const service of made) service.stop()
  if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
})

describe('a session, start to finish', () => {
  it('starts one, refuses a second, and tells the browser what to hold back', async () => {
    const { service, told } = await build('one')
    await service.start()

    const started = await service.startFocus({ title: 'Kinematics', subject: 'Physics', minutes: 50, policy: { level: 'deep' }, intention: 'Finish before tomorrow' })
    assert.equal(started.ok, true)
    assert.equal(started.session?.policy.locked, true)
    assert.equal(started.session?.settled, false)

    const again = await service.startFocus({ minutes: 25 })
    assert.equal(again.ok, false)
    assert.match(again.why ?? '', /already running/i)

    const last = told[told.length - 1]
    assert.equal(last.state, 'locked')
    assert.ok(last.blockedCategories.includes('social'))
    assert.equal(last.sessionId, started.session?.id)
    service.stop()
  })

  it('keeps the policy it started with when settings change underneath it', async () => {
    const { service, told } = await build('snapshot')
    await service.start()
    const started = await service.startFocus({ minutes: 30, policy: { level: 'deep' } })
    // Everything turned off in Settings, while the session runs.
    await service.savePreferences({ blockedCategories: [], youtube: 'open', blockedSites: [] })
    const after = told[told.length - 1]
    assert.ok(after.blockedCategories.includes('social'), 'the running session keeps what it snapshotted')
    assert.equal(after.sessionId, started.session?.id)

    const stillBlocked = await service.mayOpen('https://instagram.com')
    assert.equal(stillBlocked.allowed, false)
    service.stop()
  })

  it('opens everything again when the session ends', async () => {
    const { service, told } = await build('ends')
    await service.start()
    await service.startFocus({ minutes: 30, policy: { level: 'focus' } })
    assert.equal((await service.mayOpen('https://instagram.com')).allowed, false)
    await service.endFocus()
    assert.equal((await service.mayOpen('https://instagram.com')).allowed, true)
    assert.equal(told[told.length - 1].state, 'normal')
    assert.equal(told[told.length - 1].blockedCategories.length, 0)
    service.stop()
  })

  it('counts a distraction attempt once per try, and saves the page for later', async () => {
    const { service, store } = await build('later')
    await service.start()
    await service.startFocus({ title: 'Physics', minutes: 30, policy: { level: 'focus' } })

    await service.mayOpen('https://youtube.com/')
    await service.mayOpen('https://instagram.com')
    const state = await store.state.read()
    assert.equal(state.session?.distractionAttempts, 2)

    const saved = await service.saveForLater('https://youtube.com/watch?v=abc&utm_source=x', 'A video')
    assert.equal(saved.ok, true)
    const later = await store.distractions.all()
    assert.equal(later.length, 1)
    // Saved as the page, not as the link somebody arrived by.
    assert.equal(later[0].url, 'https://youtube.com/watch?v=abc')
    assert.equal(later[0].sessionTitle, 'Physics')
    assert.equal((await store.state.read()).session?.savedForLater, 1)
    service.stop()
  })

  it('never offers to save something held back for safety', async () => {
    const { service } = await build('safety')
    await service.start()
    await service.savePreferences({ dob: '2014-01-01' })
    const verdict = await service.mayOpen('https://bet365.com')
    assert.equal(verdict.allowed, false)
    assert.equal(verdict.because, 'safety')
    assert.equal(verdict.saveable, false)
    service.stop()
  })

  it('keeps safety on with no session running', async () => {
    const { service, told } = await build('safety-always')
    await service.start()
    await service.savePreferences({ dob: '2016-01-01' })
    const policy = told[told.length - 1]
    assert.equal(policy.state, 'normal', 'no session')
    assert.ok(policy.safetyBlocked.includes('adult'), 'safety does not stop when a session does')
    assert.equal((await service.mayOpen('https://bet365.com')).allowed, false)
    service.stop()
  })
})

describe('paying out', () => {
  it('pays a finished session once, however many times completion arrives', async () => {
    const { service, store } = await build('once')
    await service.start()
    await service.startFocus({ title: 'Physics', subject: 'Physics', minutes: 25, policy: { level: 'focus' } })

    // Most of the session really done, then finished three times over.
    const state = await store.state.read()
    await store.state.write({ ...state, session: { ...(state.session as FocusSession), focusedSeconds: 25 * 60 } })
    await service.endFocus()
    await service.endFocus()
    await service.endFocus()

    const events = await store.xp.all()
    const sessionPayments = events.filter((one) => one.key.includes(':complete'))
    assert.equal(sessionPayments.length, 1, `paid ${sessionPayments.length} times`)
    assert.equal(sessionPayments[0].amount, 25)
    assert.equal(sessionPayments[0].subject, 'Physics')

    const sessions = await store.sessions.all()
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].settled, true)
    assert.equal(sessions[0].xpAwarded, 25)
    service.stop()
  })

  it('pays nothing for a session started and dropped', async () => {
    const { service, store } = await build('dropped')
    await service.start()
    await service.startFocus({ minutes: 50, policy: { level: 'focus' } })
    await service.endFocus()
    assert.equal(totalXp(await store.xp.all()), 0, 'two seconds of a fifty-minute session is not worth anything')
    // It still happened, so it is still in the history.
    assert.equal((await store.sessions.all()).length, 1)
    service.stop()
  })

  it('cannot be farmed by starting and stopping', async () => {
    const { service, store } = await build('farm')
    await service.start()
    for (let i = 0; i < 6; i += 1) {
      await service.startFocus({ minutes: 15, policy: { level: 'focus' } })
      await service.endFocus()
    }
    assert.equal(totalXp(await store.xp.all()), 0)
    service.stop()
  })

  it('moves the quests, the streak, the records and the subject on one event', async () => {
    const { service, store } = await build('settle')
    await service.start()
    await service.startFocus({ title: 'Physics', subject: 'Physics', minutes: 25, policy: { level: 'focus' } })
    const state = await store.state.read()
    await store.state.write({ ...state, session: { ...(state.session as FocusSession), focusedSeconds: 25 * 60 } })
    await service.endFocus()

    const after = await store.state.read()
    assert.equal(after.session, null)
    assert.ok(after.quests.some((one) => one.questId === 'daily-focus' && one.completedAt !== null), 'the daily quest finished')
    assert.equal(after.streaks.find((one) => one.kind === 'focus')?.current, 1)
    assert.equal(after.records.longestSessionSeconds, 25 * 60)
    assert.equal(after.subjects.find((one) => one.subject === 'Physics')?.sessions, 1)
    assert.ok(after.achievements.some((one) => one.achievementId === 'first-focus'))

    // The quest and the achievement were paid, each exactly once.
    const events = await store.xp.all()
    assert.equal(events.filter((one) => one.key.startsWith('quest:daily-focus')).length, 1)
    assert.equal(events.filter((one) => one.key === 'achievement:first-focus').length, 1)
    service.stop()
  })

  it('pays a task once and moves its goal on', async () => {
    const { service, store } = await build('task')
    await service.start()
    const goal = await store.goals.put({
      id: 'g1',
      profileId: 'task',
      title: 'Physics',
      why: '',
      horizon: 'long-term',
      subject: 'Physics',
      deadline: null,
      milestones: [{ id: 'm1', title: 'Kinematics', stage: '', targetDate: null, taskIds: ['t1'], completedAt: null, order: 0 }],
      state: 'active',
      completedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    await store.tasks.put({
      id: 't1',
      profileId: 'task',
      title: 'Projectiles',
      subject: 'Physics',
      goalId: goal.id,
      milestoneId: 'm1',
      priority: 'normal',
      estimate: 30,
      actual: 0,
      due: null,
      hasTime: false,
      state: 'planned',
      notes: '',
      order: 0,
      completedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const first = await service.completeTask('t1')
    assert.equal(first.ok, true)
    assert.ok(first.xp >= 30)
    const second = await service.completeTask('t1')
    assert.equal(second.ok, false)

    const events = await store.xp.all()
    assert.equal(events.filter((one) => one.key === 'task:t1').length, 1)
    // Every task on the milestone is done, so the milestone is, and so is the goal.
    const after = await store.goals.get('g1')
    assert.equal(after?.milestones[0].completedAt !== null, true)
    assert.equal(after?.state, 'completed')
    assert.equal(events.filter((one) => one.key === 'milestone:m1').length, 1)
    assert.equal(events.filter((one) => one.key === 'goal:g1').length, 1)
    service.stop()
  })

  it('pays learning once a day and again the next day', async () => {
    const { service, store } = await build('learn')
    await service.start()
    const first = await service.answer('word-lucid', 'known')
    assert.equal(first.ok, true)
    assert.ok(first.xp > 0)
    const again = await service.answer('word-lucid', 'known')
    assert.equal(again.xp, 0, 'answering the same thing twice today pays once')

    const events = await store.xp.all()
    assert.equal(events.filter((one) => one.key.startsWith('learn:word-lucid')).length, 1)
    assert.equal((await store.state.read()).streaks.find((one) => one.kind === 'learning')?.current, 1)
    service.stop()
  })

  it('refuses a piece of learning that is not for this age, wherever the id came from', async () => {
    const { service } = await build('age-learn')
    await service.start()
    await service.savePreferences({ dob: '2019-01-01' })
    const out = await service.answer('word-empirical', 'known')
    assert.equal(out.ok, false, 'advanced content marked for teens upward')
    service.stop()
  })
})

describe('surviving a restart', () => {
  it('picks a session back up, having credited none of the time Orbis was closed', async () => {
    const first = await build('restart')
    await first.service.start()
    await first.service.startFocus({ title: 'Physics', minutes: 50, policy: { level: 'deep' } })
    // Ten minutes really done, then the window closed.
    const state = await first.store.state.read()
    await first.store.state.write({ ...state, session: { ...(state.session as FocusSession), focusedSeconds: 600 } })
    await first.service.onQuit()

    // The clock moves on by two hours while nothing is running.
    const path = join(root, 'profiles', 'restart', 'student', 'state.json')
    const held = JSON.parse(await readFile(path, 'utf8')) as { beat: { at: number } }
    held.beat = { at: Date.now() - 2 * 3600 * 1000 }
    await writeFile(path, JSON.stringify(held))

    const second = await build('restart')
    await second.service.start()
    const snapshot = await second.service.snapshot()
    assert.ok(snapshot.session, 'the session came back')
    assert.equal(snapshot.session?.state, 'recovering', 'it asks rather than carrying on silently')
    assert.equal(snapshot.timer?.elapsed, 600, 'two hours of being closed credited nothing')
    assert.ok(second.notices.some((one) => /not counted/i.test(one.body)), 'and the student is told')

    assert.equal(await second.service.carryOnFocus(), true)
    assert.equal((await second.service.snapshot()).session?.state, 'active')
    second.service.stop()
  })

  it('settles a session whose time had already run out while Orbis was closed, once', async () => {
    const first = await build('restart-done')
    await first.service.start()
    await first.service.startFocus({ title: 'Maths', subject: 'Maths', minutes: 25, policy: { level: 'focus' } })
    const state = await first.store.state.read()
    await first.store.state.write({ ...state, session: { ...(state.session as FocusSession), focusedSeconds: 25 * 60 } })
    await first.service.onQuit()

    const second = await build('restart-done')
    await second.service.start()
    assert.equal((await second.service.snapshot()).session, null)
    const sessions = await second.store.sessions.all()
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].state, 'completed')

    // Opened a third time: nothing is paid again.
    const third = await build('restart-done')
    await third.service.start()
    const events = await third.store.xp.all()
    assert.equal(events.filter((one) => one.key.includes(':complete')).length, 1)
    second.service.stop()
    third.service.stop()
  })

  it('gives up on a session nobody came back to, and pays nothing for it', async () => {
    const first = await build('abandoned')
    await first.service.start()
    await first.service.startFocus({ minutes: 50, policy: { level: 'focus' } })
    const state = await first.store.state.read()
    await first.store.state.write({ ...state, session: { ...(state.session as FocusSession), focusedSeconds: 1200 } })
    await first.service.onQuit()

    const path = join(root, 'profiles', 'abandoned', 'student', 'state.json')
    const held = JSON.parse(await readFile(path, 'utf8')) as { beat: { at: number } }
    held.beat = { at: Date.now() - 10 * 3600 * 1000 }
    await writeFile(path, JSON.stringify(held))

    const second = await build('abandoned')
    await second.service.start()
    assert.equal((await second.service.snapshot()).session, null)
    assert.equal((await second.store.sessions.all())[0].state, 'expired')
    assert.equal(totalXp(await second.store.xp.all()), 0)
    second.service.stop()
  })
})

describe('profiles', () => {
  it('cannot see another profile’s work, and switching moves everything at once', async () => {
    const a = await build('student-a')
    await a.service.start()
    await a.service.startFocus({ title: 'A physics session', minutes: 30, policy: { level: 'deep' } })
    await a.service.savePreferences({ name: 'Ana', dob: '2010-01-01' })
    await a.service.saveForLater('https://example.com/a', 'A saved page')

    await a.service.useProfile('student-b')
    const asB = await a.service.snapshot()
    assert.equal(asB.session, null, 'B does not get A’s running session')
    assert.equal(asB.preferences.name, '', 'nor A’s name')
    assert.equal(asB.band, 'unknown', 'nor A’s age')
    assert.equal(asB.waiting, 0, 'nor A’s saved pages')
    assert.equal((await a.store.distractions.all()).length, 0)

    // And A still has everything on the way back.
    await a.service.useProfile('student-a')
    const back = await a.service.snapshot()
    assert.equal(back.preferences.name, 'Ana')
    assert.equal(back.waiting, 1)
    assert.ok(back.session, 'A’s session was put down, not thrown away')
    assert.equal(back.session?.title, 'A physics session')
    a.service.stop()
  })

  it('keeps each profile in its own folder, and tells the browser nothing is in force while it switches', async () => {
    const a = await build('folders-a')
    await a.service.start()
    await a.service.savePreferences({ name: 'One' })
    await a.service.useProfile('folders-b')
    assert.equal(a.told[a.told.length - 1].state, 'normal')
    await a.service.savePreferences({ name: 'Two' })
    await a.service.flush()

    const first = JSON.parse(await readFile(join(root, 'profiles', 'folders-a', 'student', 'preferences.json'), 'utf8')) as { name: string }
    const second = JSON.parse(await readFile(join(root, 'profiles', 'folders-b', 'student', 'preferences.json'), 'utf8')) as { name: string }
    assert.equal(first.name, 'One')
    assert.equal(second.name, 'Two')
    a.service.stop()
  })
})

describe('starting over', () => {
  it('clears exactly what was asked for and nothing else', async () => {
    const { service, store } = await build('reset')
    await service.start()
    await service.savePreferences({ name: 'Ana' })
    await service.answer('word-candid', 'known')
    await service.startFocus({ title: 'Physics', subject: 'Physics', minutes: 25, policy: { level: 'focus' } })
    const state = await store.state.read()
    await store.state.write({ ...state, session: { ...(state.session as FocusSession), focusedSeconds: 25 * 60 } })
    await service.endFocus()

    assert.ok(totalXp(await store.xp.all()) > 0)
    await service.reset('xp')
    assert.equal(totalXp(await store.xp.all()), 0)
    // Only the XP: the history, the settings and the learning are untouched.
    assert.equal((await store.sessions.all()).length, 1)
    assert.equal((await store.prefs.read()).name, 'Ana')
    assert.equal((await store.reviews.read()).length, 1)

    await service.reset('everything')
    assert.equal((await store.sessions.all()).length, 0)
    assert.equal((await store.reviews.read()).length, 0)
    assert.equal((await store.prefs.read()).name, '')
    assert.equal((await store.state.read()).achievements.length, 0)
    service.stop()
  })

  it('reads a damaged settings file without losing the rest of the feature', async () => {
    const folder = join(root, 'profiles', 'damaged', 'student')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'preferences.json'), '{ this is not json')
    const { service } = await build('damaged')
    await service.start()
    const snapshot = await service.snapshot()
    assert.equal(snapshot.preferences.safetyOverride, 'age', 'and safety is not widened by a bad read')
    const started = await service.startFocus({ minutes: 20, policy: { level: 'focus' } })
    assert.equal(started.ok, true, 'a session still starts')
    service.stop()
  })
})

describe('the Focus Shield', () => {
  const decision = {
    allowed: false,
    reason: 'Social sites are held back until this session finishes.',
    saveable: true,
    because: 'focus',
    category: 'social',
    remaining: 1380,
    sessionTitle: 'Physics — Kinematics'
  }

  it('says what is happening and offers the three useful things', () => {
    const html = shieldPage('https://instagram.com/explore', decision, 'focus')
    assert.match(html, /Focus Shield/)
    assert.match(html, /instagram\.com can wait/)
    assert.match(html, /23 minutes remaining/)
    assert.match(html, /Physics — Kinematics/)
    assert.match(html, /Return to Focus/)
    assert.match(html, /Save for later/)
    assert.match(html, /End session/)
    assert.ok(!/denied|forbidden|blocked by/i.test(html), 'never an error page')
  })

  it('offers neither saving nor ending when it was safety', () => {
    const html = shieldPage('https://bet365.com', { ...decision, because: 'safety', saveable: false, sessionTitle: '', remaining: null }, 'normal')
    assert.match(html, /Not available on this profile/)
    assert.ok(!/Save for later/.test(html))
    assert.ok(!/End session/.test(html))
  })

  it('does not offer a casual way out of a locked session', () => {
    const html = shieldPage('https://instagram.com', decision, 'locked')
    assert.ok(!/End session/.test(html), 'Deep Focus is left from the session itself, deliberately')
    assert.match(html, /Return to Focus/)
  })

  it('needs no network and names no implementation detail', () => {
    const html = shieldPage('https://instagram.com', decision, 'focus')
    assert.ok(!/https?:\/\/(?!instagram)/.test(html.replace(/https:\/\/instagram\.com[^"'<\s]*/g, '')), 'nothing is fetched')
    assert.ok(!/Fetch\.|CDP|requestPaused|declarativeNetRequest/i.test(html))
  })

  it('escapes whatever was in the address', () => {
    const html = shieldPage('https://example.com/?q=<script>alert(1)</script>', decision, 'focus')
    assert.ok(!html.includes('<script>alert(1)</script>'))
  })
})

describe('the enforcer', () => {
  /** A tab that records what it was told, so what reaches the browser can be checked. */
  function fakePage(id: number, showing = ""): EnforceablePage & { sent: { method: string; params?: Record<string, unknown> }[]; fire(method: string, params: Record<string, unknown>): void } {
    const listeners = new Set<(event: { method: string; params?: Record<string, unknown> }) => void>()
    const sent: { method: string; params?: Record<string, unknown> }[] = []
    return {
      id,
      targetId: `t${id}`,
      sent,
      getURL: () => showing,
      debugger: {
        sendCommand: async (method, params) => {
          sent.push({ method, params })
          return {}
        }
      },
      onEvent: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      fire: (method, params) => {
        for (const listener of [...listeners]) listener({ method, params })
      }
    }
  }

  function browserOf(pages: EnforceablePage[]): { list: () => EnforceablePage[]; onChange: (l: (c: { type: 'opened' | 'closed' | 'changed'; page: EnforceablePage }) => void) => () => void; open(page: EnforceablePage): void } {
    const listeners = new Set<(c: { type: 'opened' | 'closed' | 'changed'; page: EnforceablePage }) => void>()
    return {
      list: () => pages,
      onChange: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      open: (page) => {
        pages.push(page)
        for (const l of [...listeners]) l({ type: 'opened', page })
      }
    }
  }

  const policy = (state: PolicyState): Parameters<FocusEnforcer['apply']>[0] => ({
    state,
    blockedCategories: state === 'normal' ? [] : ['social'],
    blockedHosts: [],
    safetyBlocked: []
  })

  it('touches nothing at all while no policy is in force', async () => {
    const page = fakePage(1)
    const enforcer = new FocusEnforcer({ mayOpen: async () => ({ allowed: true }) as never, saveForLater: async () => undefined, endFocus: async () => undefined })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('normal'))
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual(page.sent, [], 'a browser with no session is a browser Student has not touched')
    enforcer.stop()
  })

  it('pauses only top-level documents, and lets an allowed one straight through', async () => {
    const page = fakePage(2)
    const asked: string[] = []
    const enforcer = new FocusEnforcer({
      mayOpen: async (url) => {
        asked.push(url)
        return { allowed: true, reason: '', saveable: false, because: 'allowed', category: 'education', remaining: null, sessionTitle: '' }
      },
      saveForLater: async () => undefined,
      endFocus: async () => undefined
    })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('focus'))
    await new Promise((r) => setTimeout(r, 10))

    const enable = page.sent.find((one) => one.method === 'Fetch.enable')
    assert.ok(enable, 'the pause is on')
    assert.deepEqual((enable?.params?.patterns as { resourceType: string }[])[0].resourceType, 'Document')

    page.fire('Fetch.requestPaused', { requestId: 'r1', request: { url: 'https://khanacademy.org' } })
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual(asked, ['https://khanacademy.org'])
    assert.ok(page.sent.some((one) => one.method === 'Fetch.continueRequest'))
    assert.ok(!page.sent.some((one) => one.method === 'Fetch.fulfillRequest'))
    enforcer.stop()
  })

  it('answers a refused page with the shield rather than letting it load', async () => {
    const page = fakePage(3)
    const enforcer = new FocusEnforcer({
      mayOpen: async () => ({ allowed: false, reason: 'Social is held back.', saveable: true, because: 'focus', category: 'social', remaining: 600, sessionTitle: 'Physics' }),
      saveForLater: async () => undefined,
      endFocus: async () => undefined
    })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('focus'))
    await new Promise((r) => setTimeout(r, 10))

    page.fire('Fetch.requestPaused', { requestId: 'r1', request: { url: 'https://instagram.com' } })
    await new Promise((r) => setTimeout(r, 10))
    const fulfilled = page.sent.find((one) => one.method === 'Fetch.fulfillRequest')
    assert.ok(fulfilled, 'the request was answered, not continued')
    assert.ok(!page.sent.some((one) => one.method === 'Fetch.continueRequest'))
    const body = Buffer.from(String(fulfilled?.params?.body), 'base64').toString('utf8')
    assert.match(body, /Focus Shield/)
    assert.match(body, /Physics/)
    enforcer.stop()
  })

  it('arms a pop-up the moment it exists', async () => {
    const page = fakePage(4)
    const browser = browserOf([page])
    const enforcer = new FocusEnforcer({
      mayOpen: async () => ({ allowed: false, reason: 'held back', saveable: true, because: 'focus', category: 'social', remaining: null, sessionTitle: '' }),
      saveForLater: async () => undefined,
      endFocus: async () => undefined
    })
    enforcer.watch(browser)
    enforcer.apply(policy('deep'))
    await new Promise((r) => setTimeout(r, 10))

    const popup = fakePage(5)
    browser.open(popup)
    await new Promise((r) => setTimeout(r, 10))
    assert.ok(popup.sent.some((one) => one.method === 'Fetch.enable'), 'a new tab is not a way round the policy')
    enforcer.stop()
  })

  it('catches a page that came back from the cache, which never makes a request', async () => {
    const page = fakePage(6)
    const enforcer = new FocusEnforcer({
      mayOpen: async () => ({ allowed: false, reason: 'held back', saveable: true, because: 'focus', category: 'social', remaining: null, sessionTitle: '' }),
      saveForLater: async () => undefined,
      endFocus: async () => undefined
    })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('focus'))
    await new Promise((r) => setTimeout(r, 10))

    page.fire('Page.frameNavigated', { frame: { url: 'https://instagram.com' } })
    await new Promise((r) => setTimeout(r, 20))
    assert.ok(page.sent.some((one) => one.method === 'Page.navigate'), 'back and forward are covered too')
    enforcer.stop()
  })

  it('ignores a sub-frame navigation, so an advert cannot shield the page it is on', async () => {
    const page = fakePage(7)
    const enforcer = new FocusEnforcer({
      mayOpen: async () => ({ allowed: false, reason: '', saveable: false, because: 'focus', category: 'social', remaining: null, sessionTitle: '' }),
      saveForLater: async () => undefined,
      endFocus: async () => undefined
    })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('focus'))
    await new Promise((r) => setTimeout(r, 10))
    page.fire('Page.frameNavigated', { frame: { url: 'https://instagram.com', parentId: 'main' } })
    await new Promise((r) => setTimeout(r, 20))
    assert.ok(!page.sent.some((one) => one.method === 'Page.navigate'))
    enforcer.stop()
  })

  it('lets a page load when Orbis cannot answer, rather than breaking browsing', async () => {
    const page = fakePage(8)
    const enforcer = new FocusEnforcer({
      mayOpen: async () => {
        throw new Error('Student is broken')
      },
      saveForLater: async () => undefined,
      endFocus: async () => undefined
    })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('focus'))
    await new Promise((r) => setTimeout(r, 10))
    page.fire('Fetch.requestPaused', { requestId: 'r1', request: { url: 'https://example.com' } })
    await new Promise((r) => setTimeout(r, 10))
    assert.ok(page.sent.some((one) => one.method === 'Fetch.continueRequest'), 'a bug in a study feature must not stop the web loading')
    enforcer.stop()
  })

  it('does the shield’s buttons, and only the ones it knows', async () => {
    const page = fakePage(9)
    const saved: string[] = []
    let ended = 0
    const enforcer = new FocusEnforcer({
      mayOpen: async () => ({ allowed: false, reason: '', saveable: true, because: 'focus', category: 'social', remaining: null, sessionTitle: '' }),
      saveForLater: async (url) => void saved.push(url),
      endFocus: async () => void (ended += 1)
    })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('focus'))
    await new Promise((r) => setTimeout(r, 10))

    page.fire('Runtime.bindingCalled', { name: 'orbisStudentShield', payload: JSON.stringify({ action: 'save', url: 'https://instagram.com', title: 'Instagram' }) })
    page.fire('Runtime.bindingCalled', { name: 'orbisStudentShield', payload: JSON.stringify({ action: 'end' }) })
    page.fire('Runtime.bindingCalled', { name: 'orbisStudentShield', payload: JSON.stringify({ action: 'do-whatever-i-say' }) })
    page.fire('Runtime.bindingCalled', { name: 'somethingElse', payload: JSON.stringify({ action: 'end' }) })
    await new Promise((r) => setTimeout(r, 10))

    assert.deepEqual(saved, ['https://instagram.com'])
    assert.equal(ended, 1, 'a made-up action and another binding both do nothing')
    enforcer.stop()
  })

  it('shields a tab that was already showing the page when the session started', async () => {
    // The moment the feature is for: somebody opens Focus because a feed already has their attention.
    const page = fakePage(11, 'https://instagram.com/explore')
    const enforcer = new FocusEnforcer({
      mayOpen: async () => ({ allowed: false, reason: 'held back', saveable: true, because: 'focus', category: 'social', remaining: null, sessionTitle: 'Physics' }),
      saveForLater: async () => undefined,
      endFocus: async () => undefined
    })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('focus'))
    await new Promise((r) => setTimeout(r, 30))
    const sent = page.sent.find((one) => one.method === 'Page.navigate')
    assert.ok(sent, 'a page already on screen is not left there')
    assert.ok(String(sent?.params?.url).startsWith('data:text/html'))
    enforcer.stop()
  })

  it('leaves an allowed tab that was already open exactly where it is', async () => {
    const page = fakePage(12, 'https://khanacademy.org')
    const enforcer = new FocusEnforcer({
      mayOpen: async () => ({ allowed: true, reason: '', saveable: false, because: 'allowed', category: 'education', remaining: null, sessionTitle: '' }),
      saveForLater: async () => undefined,
      endFocus: async () => undefined
    })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('focus'))
    await new Promise((r) => setTimeout(r, 30))
    assert.ok(!page.sent.some((one) => one.method === 'Page.navigate'))
    enforcer.stop()
  })

  it('switches the pause off again when the session ends', async () => {
    const page = fakePage(10)
    const enforcer = new FocusEnforcer({ mayOpen: async () => ({ allowed: true }) as never, saveForLater: async () => undefined, endFocus: async () => undefined })
    enforcer.watch(browserOf([page]))
    enforcer.apply(policy('focus'))
    await new Promise((r) => setTimeout(r, 10))
    enforcer.apply(policy('normal'))
    await new Promise((r) => setTimeout(r, 10))
    assert.ok(page.sent.some((one) => one.method === 'Fetch.disable'), 'normal Orbis does not stay slower')
    enforcer.stop()
  })
})

describe('what the screen is given', () => {
  it('works everything out rather than storing it', async () => {
    const { service } = await build('snapshot-shape')
    await service.start()
    const snapshot = await service.snapshot()
    assert.equal(snapshot.session, null)
    assert.equal(snapshot.timer, null)
    assert.equal(snapshot.level.level, 1)
    assert.equal(snapshot.quests.length >= 8, true)
    assert.ok(snapshot.recommendation, 'there is always something to suggest')
    assert.equal(snapshot.today.day.length, 10)
    assert.equal(snapshot.band, 'unknown')
    service.stop()
  })

  it('shows what will happen before a strict session starts', async () => {
    const { service } = await build('preview')
    await service.start()
    const preview = await service.preview({ level: 'deep' })
    assert.ok(preview.blocked.length > 0)
    assert.ok(preview.allowed.some((one) => one.includes('Orbis')))
    assert.match(preview.note, /fixed for this session/)
    service.stop()
  })

  it('marks a rest day without taking anything away', async () => {
    const { service, store } = await build('rest')
    await service.start()
    await service.restDay()
    const state = await store.state.read()
    assert.equal(state.streaks.every((one) => one.restDays.length === 1), true)
    assert.equal(state.streaks.find((one) => one.kind === 'focus')?.current, 0)
    assert.equal(state.streaks.find((one) => one.kind === 'focus')?.longest, 0)
    service.stop()
  })
})
