import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommandResult } from '../../shared/browserControl.ts'
import type { SurfaceDescriptor, SurfaceOutcome } from '../../shared/surfaces.ts'
import type { StudentPreferences, StudentSnapshot } from '../../shared/student/types.ts'
import { defaultPreferences } from '../../shared/student/prefs.ts'
import { dayKey } from '../../shared/student/days.ts'
import type { Course, Lesson, Question } from '../../shared/courses/types.ts'
import { emptyKept, type KeptArcade } from '../../shared/games/kept.ts'
import { GAMES, gameInfo } from '../../shared/offlineGames.ts'
/*
 * What a game reports about itself: the real shape, not a copy of it.
 *
 * It used to be written out here, because the only place it existed was the game engine -- browser code, which
 * dragged `HTMLCanvasElement`, `requestAnimationFrame` and `window` into the main process's typecheck and broke it.
 * The shape now lives in `src/shared/games/reported.ts`, with no DOM in it, so the arcade's declaration and this
 * test can both read the one definition and a status this test makes up cannot pass for a status a game reports.
 */
import type { GameState } from '../../shared/games/reported.ts'
import { answerSurfaceCall } from '../../renderer/src/lib/surfaces/answer.ts'
import { forgetSurfaces, registerSurface, surfacesDrawn } from '../../renderer/src/lib/surfaces/registry.ts'
import { studentSessionSurface, studentSettingsSurface, studentSurface } from '../../renderer/src/components/student/studentSurfaces.ts'
import { courseSurface, coursesSurface, lessonSurface, quizSurface } from '../../renderer/src/components/courses/coursesSurfaces.ts'
import { arcadeSurface, catalogueSurface, gameSettingsSurface, playingSurface } from '../../renderer/src/components/arcadeSurfaces.ts'
import { BrowserControl } from './registry.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

/**
 * Orbis Student, Courses and the games, driven end to end: a capability in the main process, the bridge, the register
 * in the window, and each screen's own getters, setters and handlers.
 *
 * The one hop that needs an application -- `control:window-run` between the two processes -- is replaced by a function
 * that turns everything into text and back, which is what that hop does to a value. Everything else is the real thing:
 * the real registry with its real approval, retries, verification and undo, the real six `screen.*` capabilities, the
 * real answering code, the real register, and the real declarations the components register.
 *
 * React is not here, so each screen is stood up the way React stands it up: state in an object, handlers that change
 * it and then say the screen has drawn, and a child screen that is registered while its parent shows it and taken away
 * when it does not. That is also why the declarations live in `*Surfaces.ts` files rather than inside the components:
 * a declaration written inside a component can only be checked by drawing it, and there is no browser here.
 *
 * Four faults were found by running this rather than by reading it, and each one is named at the assertion that caught
 * it: a refusal that named the wrong problem, a check that compared two different moments, a request reported as a
 * result, and two screens whose names swallowed an action on their own parent.
 */

const overTheWire = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

const run = (
  world: { control: BrowserControl; asks: string[]; approve: boolean },
  capability: string,
  params: Record<string, unknown>,
  source: 'user' | 'orion' = 'user'
): Promise<CommandResult> =>
  world.control.execute(
    { capability, params, source },
    {
      confirm: async (request) => {
        world.asks.push(request.action)
        return world.approve
      }
    }
  )

/** A registry with the six screens capabilities on it, wired to the real register in the window. */
function wired(): { control: BrowserControl; asks: string[]; approve: boolean } {
  const asks: string[] = []
  const holding = { approve: true }
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })
  return {
    control,
    asks,
    get approve() {
      return holding.approve
    },
    set approve(value: boolean) {
      holding.approve = value
    }
  }
}

// ---------------------------------------------------------------- Orbis Student

interface StudentWorld extends ReturnType<typeof wired> {
  state: {
    screen: string
    closed: boolean
    prefs: StudentPreferences | null
    session: { title: string; level: string; minutes: number; state: string; locked: boolean } | null
    paused: boolean
    restDays: string[]
    captured: string[]
    resets: string[]
  }
}

/** The Student screens, as React would hold them. */
function student(): StudentWorld {
  forgetSurfaces()
  const state = {
    screen: 'home',
    closed: false,
    prefs: null as StudentPreferences | null,
    session: null as { title: string; level: string; minutes: number; state: string; locked: boolean } | null,
    paused: false,
    restDays: [] as string[],
    captured: [] as string[],
    resets: [] as string[]
  }

  /**
   * The snapshot Student hands its screens.
   *
   * Cast once, with the fields these declarations really read filled in for real. The type has some thirty fields, and
   * writing all of them out would be thirty lines about things no surface here looks at -- and would go stale the
   * moment one is added, which is a test failing for a reason that is nothing to do with surfaces.
   */
  const snapshot = (): StudentSnapshot => {
    if (!state.prefs) throw new Error('Orbis Student has not finished loading.')
    const timerState = state.session === null ? null : state.paused ? 'paused' : 'active'
    return {
      preferences: state.prefs,
      session: state.session
        ? {
            id: 'one',
            title: state.session.title,
            subject: state.session.title,
            level: state.session.level,
            plannedMinutes: state.session.minutes,
            state: state.session.state,
            policy: { locked: state.session.locked },
            interruptions: 0,
            distractionAttempts: 2,
            savedForLater: state.captured.length
          }
        : null,
      timer:
        timerState === null
          ? null
          : { state: timerState, elapsed: 600, remaining: 1500, plannedSeconds: 2100, through: 600 / 2100, block: 1, blocks: 2, breakRemaining: null, locked: false },
      level: { level: 4, xp: 1250 },
      streaks: [{ kind: 'focus', current: 3, longest: 9, lastDay: null, days: [], restDays: state.restDays }],
      today: { focusedSeconds: 1800 },
      goals: [],
      achievements: [],
      due: 5,
      waiting: state.captured.length,
      extraMinutes: 0,
      canExtend: false
    } as unknown as StudentSnapshot
  }

  let settingsPage: (() => void) | null = null
  const openSettings = (): void => {
    if (settingsPage) return
    let section = 'you'
    settingsPage = registerSurface(() =>
      studentSettingsSurface({
        snapshot,
        save: async (patch) => {
          if (!state.prefs) throw new Error('Orbis Student has not finished loading.')
          state.prefs = { ...state.prefs, ...(patch as Partial<StudentPreferences>) }
          surfacesDrawn()
        },
        section: () => section,
        openSection: (id) => {
          section = id
          surfacesDrawn()
        },
        sections: ['you', 'safety', 'focus', 'orbi', 'learning', 'sound', 'notifications', 'accessibility', 'privacy'],
        atmospheres: [
          { id: 'minimal', label: 'Minimal' },
          { id: 'rain', label: 'Rain' }
        ],
        reset: async (scope) => {
          state.resets.push(scope)
          surfacesDrawn()
        },
        check: async () => snapshot()
      })
    )
    surfacesDrawn()
  }
  const closeSettings = (): void => {
    settingsPage?.()
    settingsPage = null
    surfacesDrawn()
  }

  let sessionScreen: (() => void) | null = null
  const closeSession = (): void => {
    sessionScreen?.()
    sessionScreen = null
    surfacesDrawn()
  }
  const openSession = (): void => {
    if (sessionScreen) return
    sessionScreen = registerSurface(() =>
      studentSessionSurface({
        snapshot,
        ticking: () => {
          const timer = snapshot().timer
          return timer ? { elapsed: timer.elapsed, remaining: timer.remaining, through: timer.through } : null
        },
        pause: async () => {
          state.paused = true
          surfacesDrawn()
        },
        resume: async () => {
          state.paused = false
          surfacesDrawn()
        },
        startBreak: async () => undefined,
        endBreak: async () => undefined,
        carryOn: async () => undefined,
        extraMinute: async () => ({ ok: false, why: 'There is still time left in this session.' }),
        end: async () => {
          state.session = null
          closeSession()
          return { ok: true }
        },
        capture: async (text) => {
          state.captured.push(text)
          surfacesDrawn()
        },
        check: async () => snapshot()
      })
    )
    surfacesDrawn()
  }

  registerSurface(() =>
    studentSurface({
      screen: () => state.screen,
      // The settings page is mounted and unmounted by which screen is showing, which is what the real view does.
      go: (id) => {
        state.screen = id
        if (id === 'settings') openSettings()
        else closeSettings()
        surfacesDrawn()
      },
      screens: [
        { id: 'home', label: 'Home' },
        { id: 'focus', label: 'Focus' },
        { id: 'plan', label: 'Plan' },
        { id: 'mastery', label: 'What you know' },
        { id: 'settings', label: 'Settings' }
      ],
      snapshot,
      close: () => {
        state.closed = true
        surfacesDrawn()
      },
      startFocus: async (options) => {
        if (state.session) return { ok: false, why: 'A session is already running. Finish it first.' }
        state.session = { title: options.title, level: options.level ?? 'focus', minutes: options.minutes ?? 45, state: 'active', locked: options.level === 'deep' }
        state.paused = false
        openSession()
        return { ok: true }
      },
      restDay: async () => {
        state.restDays = [...new Set([dayKey(Date.now()), ...state.restDays])]
        surfacesDrawn()
      },
      check: async () => snapshot()
    })
  )

  return { ...wired(), state }
}

test('Student says what it has before it has loaded, without saying anything untrue', async () => {
  const world = student()
  const tree = await run(world, 'screen.tree', {})
  assert.deepEqual((tree.data as { surfaces: SurfaceDescriptor[] }).surfaces.map((one) => one.path), ['student'])

  /*
   * Which screen is showing really is readable: it is the view's own state and owes nothing to the profile. What
   * cannot be answered is whether it may be *changed*, because that depends on whether a session is running -- so the
   * control comes back readable and not writable, with the reason.
   */
  const nav = await run(world, 'screen.read', { path: 'student/screen' })
  assert.equal(nav.ok, true)
  const reading = nav.data as { readable: boolean; value: unknown; writable: boolean; note?: string }
  assert.equal(reading.readable, true)
  assert.equal(reading.value, 'home')
  assert.equal(reading.writable, false)
  assert.match(reading.note ?? '', /could not be worked out: Orbis Student has not finished loading/)

  const refused = await run(world, 'screen.write', { path: 'student/screen', value: 'plan' })
  assert.equal(refused.ok, false)
  assert.match(refused.error?.message ?? '', /has not finished loading/)
  assert.equal(world.state.screen, 'home', 'nothing moved')
})

test('getting to Student’s settings opens the page nobody mentioned, and a preference is set through its own saver', async () => {
  const world = student()
  world.state.prefs = defaultPreferences(Date.now())

  const there = await run(world, 'screen.goTo', { path: 'student/settings' })
  assert.equal(there.ok, true, there.error?.message)
  assert.deepEqual((there.data as { opened: string[] }).opened, ['student/settings'])
  assert.equal(world.state.screen, 'settings')

  // The real range, read from `patchPreferences`, checked before anything is touched.
  const tooLong = await run(world, 'screen.write', { path: 'student/settings/defaultMinutes', value: 400 })
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.error?.code, 'invalid-params')
  assert.match(tooLong.error?.message ?? '', /at most 300/)
  assert.equal(world.state.prefs?.defaultMinutes, 45, 'nothing was touched')

  const set = await run(world, 'screen.write', { path: 'student/settings/defaultMinutes', value: 25 })
  assert.equal(set.ok, true, set.error?.message)
  assert.equal(world.state.prefs?.defaultMinutes, 25)
  assert.match(set.verification?.detail ?? '', /How long a session is is now 25/)

  // A level left out, and the words on screen rather than the code's.
  const byName = await run(world, 'screen.write', { path: 'student/how strict a session is', value: 'deep' })
  assert.equal(byName.ok, true, byName.error?.message)
  assert.equal(world.state.prefs?.defaultLevel, 'deep')
})

test('an hour that cannot be set yet says what would fix it, and then takes the value', async () => {
  const world = student()
  world.state.prefs = { ...defaultPreferences(Date.now()), quietHours: null }
  await run(world, 'screen.goTo', { path: 'student/settings' })

  const unreadable = await run(world, 'screen.read', { path: 'student/settings/quietFrom' })
  assert.equal((unreadable.data as { readable: boolean }).readable, false, 'there is no hour to read, not an hour of 0')

  const tooSoon = await run(world, 'screen.write', { path: 'student/settings/quietFrom', value: 23 })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.error?.message ?? '', /Turn quietHours on first/)

  const on = await run(world, 'screen.write', { path: 'student/settings/quiet hours', value: 'on' })
  assert.equal(on.ok, true, on.error?.message)
  assert.match(on.verification?.detail ?? '', /read “on” as on/)

  const from = await run(world, 'screen.write', { path: 'student/settings/quietFrom', value: 23 })
  assert.equal(from.ok, true, from.error?.message)
  assert.deepEqual(world.state.prefs?.quietHours, { from: 23, to: 7 })
})

test('safety asks the person first, and a refusal leaves it alone', async () => {
  const world = student()
  world.state.prefs = defaultPreferences(Date.now())
  await run(world, 'screen.goTo', { path: 'student/settings' })

  world.approve = false
  const declined = await run(world, 'screen.write', { path: 'student/settings/safetyOverride', value: 'off' }, 'orion')
  assert.equal(declined.ok, false)
  assert.equal(declined.error?.code, 'declined')
  assert.equal(world.state.prefs?.safetyOverride, 'age', 'the age protection is untouched')
  assert.deepEqual(world.asks, ['Set student/settings/safetyOverride to off'])

  world.approve = true
  const allowed = await run(world, 'screen.write', { path: 'student/settings/safetyOverride', value: 'strict' }, 'orion')
  assert.equal(allowed.ok, true, allowed.error?.message)
  assert.equal(world.state.prefs?.safetyOverride, 'strict')
})

test('a session is started only after asking, and then the whole of it can be worked', async () => {
  const world = student()
  world.state.prefs = defaultPreferences(Date.now())

  /*
   * Nobody can walk to a running session: starting one is not navigation, and the refusal says what really would.
   *
   * Asked by the name on screen rather than by the id, and that is worth knowing about the protocol: a segment is
   * matched against every word of a sibling action's name too, and "Start a focus session" contains "session" -- so
   * `student/session` lands on that action, which is a sensible answer rather than a wrong one.
   */
  const cannot = await run(world, 'screen.goTo', { path: 'student/The running session' })
  assert.equal(cannot.ok, false)
  assert.equal(cannot.error?.code, 'not-found')
  assert.match(cannot.error?.message ?? '', /a session has to be running. Use startFocus/)

  world.approve = false
  const declined = await run(world, 'screen.do', { path: 'student/startFocus', params: { minutes: 30, subject: 'Chemistry' } }, 'orion')
  assert.equal(declined.ok, false)
  assert.equal(declined.error?.code, 'declined')
  assert.equal(world.state.session, null, 'no session was started')

  world.approve = true
  const started = await run(world, 'screen.do', { path: 'student/startFocus', params: { minutes: 30, subject: 'Chemistry', level: 'deep' } }, 'orion')
  assert.equal(started.ok, true, started.error?.message)
  assert.match(started.verification?.detail ?? '', /A 30-minute deep session is running: Chemistry\./)

  // The navigation cannot be moved while a session runs, and the refusal says why rather than being a dead end.
  const moving = await run(world, 'screen.write', { path: 'student/screen', value: 'plan' })
  assert.equal(moving.ok, false)
  assert.match(moving.error?.message ?? '', /showing the session and nothing else/)

  // How far through, which the session really measures.
  const state = await run(world, 'screen.state', { path: 'student/session' })
  const said = (state.data as { state: { progress?: number; activity: string; values: Record<string, unknown> } }).state
  assert.equal(said.activity, 'running')
  assert.ok(said.progress !== undefined && said.progress > 0.28 && said.progress < 0.29, 'the fraction is the session’s own')
  assert.equal(said.values.locked, true)

  const paused = await run(world, 'screen.do', { path: 'student/session/pause' })
  assert.equal(paused.ok, true, paused.error?.message)
  assert.equal(paused.verification?.detail, 'The session is paused.')

  /*
   * Pausing again is refused by the screen itself, before anything is called -- and the refusal names the state the
   * session is really in. The first version of this answered "the session is not running, so there is nothing to
   * pause", which is a true sentence about the wrong problem and sends somebody looking for a bug in the timer.
   */
  const again = await run(world, 'screen.do', { path: 'student/session/pause' })
  assert.equal(again.ok, false)
  assert.match(again.error?.message ?? '', /It is already paused\./)

  // The service's own refusal, in its own words, reported as a failure rather than as a success carrying "ok: false".
  const noMinute = await run(world, 'screen.do', { path: 'student/session/extraMinute' })
  assert.equal(noMinute.ok, false)
  assert.match(noMinute.error?.message ?? '', /still time left in this session/)

  const written = await run(world, 'screen.do', { path: 'student/session/capture', params: { text: 'buy a laptop' } })
  assert.equal(written.ok, true, written.error?.message)
  assert.deepEqual(world.state.captured, ['buy a laptop'])
  assert.equal(written.verification?.detail, '1 thing is waiting in the later queue.')

  // Ending it asks first, and the session screen goes with the session.
  const ended = await run(world, 'screen.do', { path: 'student/session/end', params: { reason: 'done for now' } }, 'orion')
  assert.equal(ended.ok, true, ended.error?.message)
  assert.equal(ended.verification?.detail, 'The session has ended.')
  const gone = await run(world, 'screen.do', { path: 'student/session/pause' })
  assert.equal(gone.ok, false)
  assert.match(gone.error?.message ?? '', /nothing called “session”/)
})

test('a reset asks first, and is checked against the thing it was supposed to empty', async () => {
  const world = student()
  world.state.prefs = defaultPreferences(Date.now())
  await run(world, 'screen.goTo', { path: 'student/settings' })

  const nonsense = await run(world, 'screen.do', { path: 'student/settings/reset', params: { scope: 'the lot' } })
  assert.equal(nonsense.ok, false)
  assert.match(nonsense.error?.message ?? '', /must be one of/)

  const done = await run(world, 'screen.do', { path: 'student/settings/reset', params: { scope: 'goals' } }, 'orion')
  assert.equal(done.ok, true, done.error?.message)
  assert.deepEqual(world.state.resets, ['goals'])
  assert.equal(done.verification?.detail, 'There are no goals left.')
  assert.deepEqual(world.asks, ['Do student/settings/reset in Orbis'])

  /*
   * A scope nothing on the snapshot measures says exactly that, instead of a check that would always pass.
   *
   * The outcome is `attempted`, which for an action is `ok: true` on purpose -- a retry is what a caller does with a
   * failure, and a reset done twice is not what anybody wanted. The words are where the honesty lives.
   */
  const unconfirmable = await run(world, 'screen.do', { path: 'student/settings/reset', params: { scope: 'learning' } })
  assert.equal(unconfirmable.ok, true, unconfirmable.error?.message)
  assert.equal((unconfirmable.data as SurfaceOutcome).status, 'attempted')
  assert.match(unconfirmable.verification?.detail ?? '', /nothing Orbis can read from here measures it/)
})

test('marking today as a rest day is confirmed by asking what today looks like now', async () => {
  const world = student()
  world.state.prefs = defaultPreferences(Date.now())
  const done = await run(world, 'screen.do', { path: 'student/restDay' })
  assert.equal(done.ok, true, done.error?.message)
  assert.equal(done.verification?.detail, 'Today is marked as a rest day.')
  assert.deepEqual(world.state.restDays, [dayKey(Date.now())])
})

// ---------------------------------------------------------------- Courses

const QUESTIONS: Question[] = [
  {
    id: 'q-weights',
    kind: 'choice',
    concept: 'weights',
    prompt: 'What does training change?',
    difficulty: 'beginner',
    options: ['The weights', 'The question', 'The screen'],
    answer: 0,
    explanation: 'Training changes the weights.',
    hints: ['It is the only part that is learned.']
  },
  { id: 'q-general', kind: 'true-false', concept: 'narrow-ai', prompt: 'Every system that exists is narrow.', difficulty: 'beginner', answer: true, explanation: 'General intelligence is a goal.', hints: [] }
]

/** What the marking gives back. The same object the screen shows and the check reads, as the real one is. */
const MARK = { score: 1, passed: true, asked: 2, right: 2, says: 'Passed.', weak: [] as string[] }

const LESSON: Lesson = {
  id: 'l-one',
  title: 'What training means',
  minutes: 12,
  difficulty: 'beginner',
  intro: 'One idea, and the vocabulary for it.',
  objectives: ['Say what a weight is', 'Say what training changes'],
  blocks: [
    { kind: 'heading', text: 'Training' },
    { kind: 'text', text: 'A model is a set of numbers.' },
    { kind: 'text', text: 'Training changes those numbers.' },
    { kind: 'check', questionId: 'q-weights' }
  ],
  questions: QUESTIONS
} as unknown as Lesson

const COURSE: Course = {
  id: 'orbis.ai.02',
  title: 'How AI actually works',
  shortDescription: 'From a weight to a model.',
  description: 'From a weight to a model.',
  difficulty: 'beginner',
  lessonCount: 2,
  moduleCount: 1,
  estimatedMinutes: 30,
  objectives: ['Say what training changes'],
  prerequisites: [],
  certificate: true,
  modules: [
    {
      id: 'm-one',
      title: 'The vocabulary',
      lessons: [
        { id: 'l-one', title: 'What training means', minutes: 12 },
        { id: 'l-two', title: 'What a model is', minutes: 18 }
      ]
    }
  ]
} as unknown as Course

interface CoursesWorld extends ReturnType<typeof wired> {
  state: {
    query: string
    where: string
    expanded: string | null
    enrolled: boolean
    readAt: number
    finished: boolean
    asked: string[]
    answers: Record<string, unknown>
    hints: Record<string, number>
    marked: boolean
  }
}

/** The Courses screens, as React would hold them: the shelf always, and one of the course or the lesson. */
function courses(): CoursesWorld {
  forgetSurfaces()
  const state = {
    query: '',
    where: 'shelf',
    expanded: null as string | null,
    enrolled: false,
    readAt: 0,
    finished: false,
    asked: [] as string[],
    answers: {} as Record<string, unknown>,
    hints: {} as Record<string, number>,
    marked: false
  }
  const card = { id: COURSE.id, title: COURSE.title, completedAt: null } as never

  let coursePage: (() => void) | null = null
  let lessonPage: (() => void) | null = null
  let quizPanel: (() => void) | null = null

  const show = (where: string): void => {
    state.where = where
    coursePage?.()
    coursePage = null
    lessonPage?.()
    lessonPage = null
    quizPanel?.()
    quizPanel = null
    if (where === 'course') {
      coursePage = registerSurface(() =>
        courseSurface({
          course: () => COURSE,
          progress: () => 0.5,
          enrolled: () => state.enrolled,
          modules: () => [{ moduleId: 'm-one', title: 'The vocabulary', lessons: 2, done: 1, quizPassed: false }],
          next: () => ({ kind: 'lesson', id: 'l-two', title: 'What a model is' }),
          certificate: () => ({ eligible: false, unmet: [{ says: 'Finish the lessons.' }] }),
          openModule: () => state.expanded,
          expand: (id) => {
            state.expanded = id
            surfacesDrawn()
          },
          start: async () => {
            state.enrolled = true
            show('lesson')
          },
          lesson: () => show('lesson'),
          back: () => show('shelf'),
          check: async () => ({ progress: 0.5, enrolled: state.enrolled })
        })
      )
    }
    if (where === 'lesson') {
      lessonPage = registerSurface(() =>
        lessonSurface({
          lesson: () => LESSON,
          courseTitle: () => COURSE.title,
          readAt: () => state.readAt,
          readTo: async (block) => {
            state.readAt = block
            surfacesDrawn()
          },
          offered: () => ['hint', 'explain'] as never,
          ask: async (mode) => {
            state.asked.push(mode)
            surfacesDrawn()
          },
          finished: () => state.finished,
          finish: async () => {
            state.finished = true
            surfacesDrawn()
          },
          quizzing: () => quizPanel !== null,
          hasModuleQuiz: () => true,
          startQuiz: () => {
            if (quizPanel) return
            quizPanel = registerSurface(() =>
              quizSurface({
                title: () => 'The vocabulary quiz',
                questions: () => QUESTIONS,
                answer: (id) => (state.answers[id] ?? null) as never,
                put: (id, value) => {
                  state.answers[id] = value
                  surfacesDrawn()
                },
                hintsUsed: (id) => state.hints[id] ?? 0,
                hint: (id) => {
                  state.hints[id] = (state.hints[id] ?? 0) + 1
                  surfacesDrawn()
                },
                busy: () => false,
                result: () => (state.marked ? MARK : null),
                // The mark comes back from the marking as well as going on screen, which is what lets it be checked
                // without reading a screen that has not redrawn.
                submit: async () => {
                  state.marked = true
                  surfacesDrawn()
                  return MARK
                },
                retry: () => {
                  state.marked = false
                  state.answers = {}
                  surfacesDrawn()
                },
                done: () => show('lesson')
              })
            )
            surfacesDrawn()
          },
          back: () => show('course'),
          check: async () => ({ done: state.finished, readAt: state.readAt })
        })
      )
    }
    surfacesDrawn()
  }

  registerSurface(() =>
    coursesSurface({
      search: () => state.query,
      setSearch: (text) => {
        state.query = text
        surfacesDrawn()
      },
      all: () => [card],
      continuing: () => (state.enrolled ? [card] : []),
      loading: () => false,
      open: () => show('course'),
      close: () => show('shelf'),
      check: async () => [card]
    })
  )

  return { ...wired(), state }
}

test('a course is opened by the title on screen, and what that really did is not overstated', async () => {
  const world = courses()

  /*
   * A course id has dots in it, so it can never be a path. It is a parameter, with the real shelf as its list.
   *
   * The answer is `attempted`: the course screen draws and registers itself afterwards, so reporting this as
   * confirmed would be reporting the request as the result. That was the first version of it.
   */
  const opened = await run(world, 'screen.do', { path: 'courses/open', params: { course: 'How AI actually works' } })
  assert.equal(opened.ok, true, opened.error?.message)
  assert.equal((opened.data as SurfaceOutcome).status, 'attempted')
  assert.match(opened.verification?.detail ?? '', /says what is on it once it has loaded, as courses\/course/)
  assert.equal(world.state.where, 'course')

  const wrong = await run(world, 'screen.do', { path: 'courses/open', params: { course: 'Pottery' } })
  assert.equal(wrong.ok, false)
  assert.match(wrong.error?.message ?? '', /must be one of/)

  // How far through, which the main process measured -- and only once somebody is on the course.
  const before = await run(world, 'screen.state', { path: 'courses/course' })
  assert.equal((before.data as { state: { progress?: number } }).state.progress, undefined, 'nobody is on it, so there is no progress to have')

  const started = await run(world, 'screen.do', { path: 'courses/course/start' })
  assert.equal(started.ok, true, started.error?.message)
  assert.equal(started.verification?.detail, 'You are on this course, 50% through.')
  assert.equal(world.state.where, 'lesson')
})

test('a lesson’s reading position is a real control, and asking Orion is declared as leaving the computer', async () => {
  const world = courses()
  await run(world, 'screen.do', { path: 'courses/open', params: { course: 'orbis.ai.02' } })
  await run(world, 'screen.do', { path: 'courses/course/openLesson', params: { lesson: 'What training means' } })

  const read = await run(world, 'screen.read', { path: 'courses/lesson/readAt' })
  const reading = read.data as { value: unknown; min: number; max: number; writable: boolean }
  assert.equal(reading.value, 0)
  assert.deepEqual([reading.min, reading.max], [0, 3], 'the range is the lesson’s own block count')

  const past = await run(world, 'screen.write', { path: 'courses/lesson/readAt', value: 9 })
  assert.equal(past.ok, false)
  assert.match(past.error?.message ?? '', /at most 3/)

  const moved = await run(world, 'screen.write', { path: 'courses/lesson/readAt', value: 2 })
  assert.equal(moved.ok, true, moved.error?.message)
  assert.equal(world.state.readAt, 2)

  // It sends the material to a model, so Orion is asked first -- and it is never reported as confirmed, because
  // nothing on this screen can see what came back.
  world.approve = false
  const declined = await run(world, 'screen.do', { path: 'courses/lesson/ask', params: { mode: 'hint' } }, 'orion')
  assert.equal(declined.ok, false)
  assert.equal(declined.error?.code, 'declined')
  assert.deepEqual(world.state.asked, [])

  world.approve = true
  const asked = await run(world, 'screen.do', { path: 'courses/lesson/ask', params: { mode: 'hint' } }, 'orion')
  assert.equal(asked.ok, true, asked.error?.message)
  assert.deepEqual(world.state.asked, ['hint'])
  assert.equal((asked.data as SurfaceOutcome).status, 'attempted', 'carried out, and nothing here can confirm it')
  assert.match(asked.verification?.detail ?? '', /Nothing on this screen can see the answer/)

  // A mode this lesson does not offer is refused with the ones it does.
  const unoffered = await run(world, 'screen.do', { path: 'courses/lesson/ask', params: { mode: 'quiz-me' } })
  assert.equal(unoffered.ok, false)
  assert.match(unoffered.error?.message ?? '', /must be one of: hint, explain/)
})

test('the quiz is answered question by question, and will not be marked until it is finished', async () => {
  const world = courses()
  await run(world, 'screen.do', { path: 'courses/open', params: { course: 'orbis.ai.02' } })
  await run(world, 'screen.do', { path: 'courses/course/openLesson', params: { lesson: 'l-one' } })

  /*
   * The quiz does not exist until it is started, and the lesson says what starts it.
   *
   * Asking to go to `courses/lesson/quiz` before it exists lands on the lesson's own "Take the module quiz" action --
   * a segment is matched against a sibling action's words, and that action is in fact the thing to do. So the step is
   * taken by doing it, and then the quiz is really there.
   */
  const started = await run(world, 'screen.do', { path: 'courses/lesson/startQuiz' })
  assert.equal(started.ok, true, started.error?.message)
  const tree = (await run(world, 'screen.tree', {})).data as { surfaces: SurfaceDescriptor[] }
  assert.deepEqual(tree.surfaces.map((one) => one.path).sort(), ['courses', 'courses/lesson', 'courses/lesson/quiz'])

  const there = await run(world, 'screen.goTo', { path: 'courses/lesson/quiz' })
  assert.deepEqual(there.data, { path: 'courses/lesson/quiz', opened: [], alreadyThere: true })

  const tooSoon = await run(world, 'screen.do', { path: 'courses/lesson/quiz/mark' })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.error?.message ?? '', /2 questions have no answer yet/)

  // One control per question, with the type the question really is.
  const first = await run(world, 'screen.read', { path: 'courses/lesson/quiz/q1' })
  const q1 = first.data as { type: string; min: number; max: number }
  assert.equal(q1.type, 'integer')
  assert.deepEqual([q1.min, q1.max], [0, 2], 'the range is the number of options')

  const outOfRange = await run(world, 'screen.write', { path: 'courses/lesson/quiz/q1', value: 7 })
  assert.equal(outOfRange.ok, false)
  assert.match(outOfRange.error?.message ?? '', /at most 2/)

  assert.equal((await run(world, 'screen.write', { path: 'courses/lesson/quiz/q1', value: 0 })).ok, true)
  const second = await run(world, 'screen.write', { path: 'courses/lesson/quiz/q2', value: true })
  assert.equal(second.ok, true, second.error?.message)

  /*
   * A hint, checked by having gone up rather than by matching a number worked out beforehand.
   *
   * The first version read the count after asking and added one, which assumed the screen's setter takes effect at
   * once. It does here and it does not in React, so the check compared two different moments and reported a hint that
   * really was shown as unconfirmed.
   */
  const hinted = await run(world, 'screen.do', { path: 'courses/lesson/quiz/hint', params: { question: '1' } })
  assert.equal(hinted.ok, true, hinted.error?.message)
  assert.equal(hinted.verification?.detail, '1 hint has been shown for that question.')
  const noMore = await run(world, 'screen.do', { path: 'courses/lesson/quiz/hint', params: { question: '2' } })
  assert.equal(noMore.ok, false)
  assert.match(noMore.error?.message ?? '', /no more hints/)

  // The mark the marking gave back, not the mark on screen.
  const marked = await run(world, 'screen.do', { path: 'courses/lesson/quiz/mark' })
  assert.equal(marked.ok, true, marked.error?.message)
  assert.equal(marked.verification?.detail, '2 of 2 right — 100%. Passed.')

  // Marked, so the answers are no longer settable, with the sentence that says what would change that.
  const locked = await run(world, 'screen.write', { path: 'courses/lesson/quiz/q1', value: 1 })
  assert.equal(locked.ok, false)
  assert.match(locked.error?.message ?? '', /Use retry to answer it again/)
})

// ---------------------------------------------------------------- the games

interface ArcadeWorld extends ReturnType<typeof wired> {
  state: { kept: KeptArcade | null; refused: string | null; view: string; playing: string | null; reported: GameState | null }
}

/** The arcade's three screens and the Games page in Orbis settings, as React would hold them. */
function arcade(): ArcadeWorld {
  forgetSurfaces()
  const state = {
    kept: null as KeptArcade | null,
    refused: null as string | null,
    view: 'page',
    playing: null as string | null,
    reported: null as GameState | null
  }
  const record = (): KeptArcade => {
    if (!state.kept) throw new Error('Your games have not been read from this profile yet.')
    return state.kept
  }
  const change = (next: (held: KeptArcade) => KeptArcade): void => {
    state.kept = next(record())
    surfacesDrawn()
  }
  const prefs = {
    prefs: () => record().library.prefs,
    setPref: <K extends keyof KeptArcade['library']['prefs']>(key: K, value: KeptArcade['library']['prefs'][K]): void =>
      change((held) => ({ ...held, library: { ...held.library, prefs: { ...held.library.prefs, [key]: value } } })),
    refused: () => state.refused
  }

  // Orbis settings, with its own Games page inside it -- which is where the preferences really are in the window.
  registerSurface(() => ({ id: 'settings', parent: null, name: 'Settings', kind: 'module', controls: {}, actions: {} }))
  registerSurface(() =>
    gameSettingsSurface({
      ...prefs,
      dayStartHour: () => record().dayStartHour,
      setDayStartHour: (hour) => change((held) => ({ ...held, dayStartHour: hour }))
    })
  )

  let catalogue: (() => void) | null = null
  let playing: (() => void) | null = null
  const closeCatalogue = (): void => {
    catalogue?.()
    catalogue = null
    surfacesDrawn()
  }
  const openCatalogue = (): void => {
    if (catalogue) return
    const filters = { query: '', category: 'all', sort: 'name', favouritesFirst: true, boards: false }
    catalogue = registerSurface(() =>
      catalogueSurface({
        search: () => filters.query,
        setSearch: (text) => {
          filters.query = text
          surfacesDrawn()
        },
        category: () => filters.category as never,
        setCategory: (id) => {
          filters.category = id
          surfacesDrawn()
        },
        categories: [
          { id: 'all', label: 'All' },
          { id: 'puzzle', label: 'Puzzle' },
          { id: 'arcade', label: 'Arcade' }
        ],
        sort: () => filters.sort as never,
        setSort: (id) => {
          filters.sort = id
          surfacesDrawn()
        },
        sorts: [
          { id: 'name', label: 'By name' },
          { id: 'best', label: 'Best score' }
        ],
        favouritesFirst: () => filters.favouritesFirst,
        setFavouritesFirst: (on) => {
          filters.favouritesFirst = on
          surfacesDrawn()
        },
        boardsOpen: () => filters.boards,
        setBoardsOpen: (on) => {
          filters.boards = on
          surfacesDrawn()
        },
        shown: () => (filters.category === 'all' ? GAMES : GAMES.filter((one) => one.categories.includes(filters.category as never)))
      })
    )
    surfacesDrawn()
  }
  const openGame = (id: string): void => {
    state.playing = id
    state.reported = { status: 'running', score: 120, elapsedMs: 9000, difficulty: 1.4, level: 2, hud: [{ label: 'Lines', value: 7 }] }
    if (playing) return
    playing = registerSurface(() =>
      playingSurface({
        ...prefs,
        game: () => gameInfo(state.playing as never),
        reported: () => state.reported,
        loading: () => false,
        best: () => (state.playing === null ? undefined : (record().library.scores as Record<string, { best?: number } | undefined>)[state.playing]?.best),
        // A game says what it is doing on its own next step, so these set the status the way a game reports it.
        pause: () => {
          state.reported = state.reported ? { ...state.reported, status: 'paused' } : null
          surfacesDrawn()
        },
        resume: () => {
          state.reported = state.reported ? { ...state.reported, status: 'running' } : null
          surfacesDrawn()
        },
        restart: () => {
          state.reported = { status: 'running', score: 0, elapsedMs: 0, difficulty: 1 }
          surfacesDrawn()
        },
        exit: () => {
          playing?.()
          playing = null
          state.playing = null
          state.view = 'library'
          openCatalogue()
          surfacesDrawn()
        }
      })
    )
    surfacesDrawn()
  }

  registerSurface(() =>
    arcadeSurface({
      ...prefs,
      view: () => state.view,
      setView: (id) => {
        state.view = id
        if (id === 'library') openCatalogue()
        else closeCatalogue()
        surfacesDrawn()
      },
      views: ['page', 'ask', 'library', 'game'],
      dayStartHour: () => record().dayStartHour,
      setDayStartHour: (hour) => change((held) => ({ ...held, dayStartHour: hour })),
      favourites: () => record().library.favorites,
      setFavourite: (id, on) =>
        change((held) => ({
          ...held,
          library: { ...held.library, favorites: on ? [...new Set([...held.library.favorites, id])] : held.library.favorites.filter((one) => one !== id) }
        })),
      unfinished: () => [],
      best: (id) => record().library.scores[id]?.best,
      daily: () => 'snake',
      play: (id) => {
        state.view = 'game'
        closeCatalogue()
        openGame(id)
      },
      playing: () => (state.view === 'game' ? (state.playing as never) : null)
    })
  )

  return { ...wired(), state }
}

test('the games’ preferences cannot be written over a record that could not be read, and say why', async () => {
  const world = arcade()
  world.state.kept = emptyKept('test')
  world.state.refused = 'Your scores could not be read. Nothing has been written over them.'

  const stuck = await run(world, 'screen.write', { path: 'settings/games/difficulty', value: 'hard' })
  assert.equal(stuck.ok, false)
  assert.match(stuck.error?.message ?? '', /could not be read/)
  assert.equal(world.state.kept?.library.prefs.difficulty, 'normal', 'nothing was written over it')

  world.state.refused = null
  const set = await run(world, 'screen.write', { path: 'settings/games/difficulty', value: 'hard' })
  assert.equal(set.ok, true, set.error?.message)
  assert.equal(world.state.kept?.library.prefs.difficulty, 'hard')
  assert.match(set.verification?.detail ?? '', /Difficulty is now “hard”/)
})

test('the default game can only be one that exists, and is named the way the record keeps it', async () => {
  const world = arcade()
  world.state.kept = emptyKept('test')

  const nonsense = await run(world, 'screen.write', { path: 'settings/games/defaultGame', value: 'Chess' })
  assert.equal(nonsense.ok, false)
  assert.match(nonsense.error?.message ?? '', /must be one of/)

  const set = await run(world, 'screen.write', { path: 'settings/games/defaultGame', value: 'number-puzzle' })
  assert.equal(set.ok, true, set.error?.message)
  assert.equal(world.state.kept?.library.prefs.defaultGame, 'number-puzzle')

  // The whole catalogue is the list of allowed values, read from the catalogue rather than written out here.
  const values = (await run(world, 'screen.read', { path: 'settings/games/defaultGame' })).data as { values: string[] }
  assert.equal(values.values.length, GAMES.length)
})

test('a game is started by name, and what it reports is what is said about it', async () => {
  const world = arcade()
  world.state.kept = emptyKept('test')

  // The catalogue really is reached by setting a control, so the walk takes that step itself.
  const there = await run(world, 'screen.goTo', { path: 'games/catalogue' })
  assert.equal(there.ok, true, there.error?.message)
  assert.deepEqual((there.data as { opened: string[] }).opened, ['games/catalogue'])

  const narrowed = await run(world, 'screen.write', { path: 'games/catalogue/category', value: 'puzzle' })
  assert.equal(narrowed.ok, true, narrowed.error?.message)
  const showing = (await run(world, 'screen.state', { path: 'games/catalogue' })).data as { state: { values: { showing: number; games: number } } }
  assert.equal(showing.state.values.games, GAMES.length)
  assert.ok(showing.state.values.showing < GAMES.length && showing.state.values.showing > 0, 'the filter really narrowed the list')

  const missing = await run(world, 'screen.do', { path: 'games/play', params: { game: 'Solitaire', carryOn: true } })
  assert.equal(missing.ok, false)
  assert.match(missing.error?.message ?? '', /no saved Solitaire to carry on from/)

  const playing = await run(world, 'screen.do', { path: 'games/play', params: { game: 'Snake' } })
  assert.equal(playing.ok, true, playing.error?.message)
  assert.equal(playing.verification?.detail, 'Snake is open.')

  // The engine's controls, and the game's own report of itself.
  const said = (await run(world, 'screen.state', { path: 'games/current' })).data as { state: { activity: string; progress?: number; values: Record<string, unknown> } }
  assert.equal(said.state.activity, 'running')
  assert.equal(said.state.progress, undefined, 'nothing measures how far through a game is, so nothing is reported')
  assert.equal(said.state.values.score, 120)
  assert.equal(said.state.values.hardness, 1.4)
  assert.equal(said.state.values.Lines, 7, 'the game’s own numbers come through as it named them')

  const paused = await run(world, 'screen.do', { path: 'games/current/pause' })
  assert.equal(paused.ok, true, paused.error?.message)
  assert.equal(paused.verification?.detail, 'The game says it is paused.')
  const twice = await run(world, 'screen.do', { path: 'games/current/pause' })
  assert.equal(twice.ok, false)
  assert.match(twice.error?.message ?? '', /already paused/)

  // The same preference, on the screen that is in front of somebody. One value, two places it is offered.
  const quieter = await run(world, 'screen.write', { path: 'games/current/sound', value: 'off' })
  assert.equal(quieter.ok, true, quieter.error?.message)
  assert.equal(world.state.kept?.library.prefs.sound, false)
  assert.equal(((await run(world, 'screen.read', { path: 'settings/games/sound' })).data as { value: unknown }).value, false)

  // Showing the game screen with no game is refused rather than drawing an empty one.
  await run(world, 'screen.do', { path: 'games/current/exit' })
  const nothing = await run(world, 'screen.write', { path: 'games/view', value: 'game' })
  assert.equal(nothing.ok, false)
  assert.match(nothing.error?.message ?? '', /No game is open/)
})

test('starring a game is confirmed by reading the list back, and can be put back through the same door', async () => {
  const world = arcade()
  world.state.kept = emptyKept('test')

  const starred = await run(world, 'screen.do', { path: 'games/favourite', params: { game: 'snake' } })
  assert.equal(starred.ok, true, starred.error?.message)
  assert.equal(starred.verification?.detail, 'Snake is starred.')
  assert.deepEqual(world.state.kept?.library.favorites, ['snake'])

  const off = await run(world, 'screen.do', { path: 'games/favourite', params: { game: 'Snake', starred: false } })
  assert.equal(off.ok, true, off.error?.message)
  assert.deepEqual(world.state.kept?.library.favorites, [])
})

test('what is on the Orbis screens is in the state Orion is given, shallow', async () => {
  const world = arcade()
  world.state.kept = emptyKept('test')
  await run(world, 'screen.goTo', { path: 'games/catalogue' })
  const snapshot = (await world.control.snapshot(['screens'])) as { screens: { registered: number; screens: { path: string; canOpen: string[] }[] } }
  const games = snapshot.screens.screens.find((one) => one.path === 'games')
  assert.deepEqual(games?.canOpen, ['catalogue', 'current'])
})
