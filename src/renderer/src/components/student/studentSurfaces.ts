import { dayKey } from '../../../../shared/student/days.ts'
import { RESET_SCOPES } from '../../../../shared/student/prefs.ts'
import type { ResetScope } from '../../../../shared/student/prefs.ts'
import type { StudentSnapshot } from '../../../../shared/student/types.ts'
import type { SurfaceDeclaration } from '../../lib/surfaces/registry.ts'
import type { ControlDeclaration } from '../../lib/surfaces/registry.ts'

/**
 * What Orbis Student lets Orbis read, set and do, as data.
 *
 * Here rather than inside the three components for the reason `settingsSurfaces.ts` gives: a declaration written
 * inside a component can only be checked by drawing that component, and there is no browser in the test suite.
 * Written as a function of the screen's own state and its own handlers, the whole chain -- a capability in the main
 * process, the bridge, the register, these getters and setters -- is driven by
 * `src/main/browserControl/moduleSurfaces.test.ts` with no window at all.
 *
 * Nothing here reaches for anything. Every value is read from the snapshot the screen is already drawing, and every
 * setter and action is a `student:do` operation the screen's own buttons already call -- the same door, with the same
 * sender check and the same service behind it.
 *
 * ## Three things Student makes the control layer careful about
 *
 * **A session's rules are frozen when it starts, and this must not become a way round them.** Student's enforcement
 * sits on the browser's request pipeline, reading the policy the session was created with. `savePreferences` is
 * explicit that a running session keeps the policy it started with, so nothing here can loosen a session by writing a
 * preference. Every settings control that would change what a *future* session blocks says so in words, and the one
 * setting that changes what is blocked right now -- the age-based safety -- asks the person first.
 *
 * **Starting and ending a session both ask first.** Starting one makes whole categories of website refuse to load for
 * up to five hours; ending one throws away work in progress. Neither is a thing to be done on an assistant's guess,
 * so both declare `confirmation: 'always'`, which is the only thing that raises the bar on `screen.do`.
 *
 * **Nothing is read before it exists.** The snapshot arrives after the screen first draws, and a getter asked before
 * then throws rather than answering with a default -- so a control reads "could not be read", not "off".
 */

/** The levels a session can run at, as the service itself validates them. */
const LEVELS = ['light', 'focus', 'deep'] as const

/** What the Student shell has to hand over. Each one is a live reader or a handler its own controls already call. */
export interface StudentScreen {
  /** Which screen of Student is showing. A plain string, because what this does with it is hand it to a control. */
  screen(): string
  go(id: string): void
  /** The screens, as the navigation itself lists them -- never a second list written out for Orbis. */
  screens: readonly { id: string; label: string }[]
  /**
   * Everything Student knows about itself right now.
   *
   * Throws until it has arrived, on purpose: a control whose getter throws is reported as "could not be read", which
   * is the truth. Answering with a default would report a level of 1 and no streak at somebody who has both.
   */
  snapshot(): StudentSnapshot
  close(): void
  startFocus(options: { subject: string | null; minutes: number | null; level: string | null; title: string }): Promise<{ ok: boolean; why?: string }>
  restDay(): Promise<unknown>
  /** Asked of Orbis again, for checking that something happened. Null when it could not be asked. */
  check(): Promise<StudentSnapshot | null>
}

/**
 * Orbis Student, as something Orbis can work rather than click at.
 *
 * The navigation is one control, built from the strip the view draws, so a screen added to Student becomes reachable
 * in the same change. The pages that say what can be done on them are named as possible children; the running session
 * is not, because reaching it means starting one and that is not navigation.
 */
export function studentSurface(screen: StudentScreen): SurfaceDeclaration {
  const running = (): boolean => screen.snapshot().session !== null
  /*
   * Handed over as the function rather than its answer.
   *
   * Called here it would run while this declaration is being built -- on every draw, before the snapshot has arrived
   * -- and throw, which would take the whole of Student out of the register rather than one control out of the answer.
   */
  const notDuringASession = (): true | string =>
    running() ? 'A focus session is running, so Student is showing the session and nothing else. End the session first, or wait for it to finish.' : true

  return {
    id: 'student',
    parent: null,
    name: 'Orbis Student',
    about: 'Focus sessions, a study plan, what you know, and Orbi.',
    kind: 'module',
    keywords: ['student', 'study', 'focus', 'revision', 'homework', 'school', 'exam', 'learn', 'orbi', 'pomodoro'],
    controls: {
      screen: {
        name: 'Screen',
        about: 'Which part of Student is showing.',
        spec: { type: 'string', description: 'Which part of Student is showing.', enum: screen.screens.map((one) => one.id) },
        get: () => screen.screen(),
        set: (value) => screen.go(String(value)),
        writable: notDuringASession,
        default: 'home'
      }
    },
    actions: {
      startFocus: {
        name: 'Start a focus session',
        about:
          'Starts a session. While it runs, whole categories of website refuse to load, which is why this asks first. It can be ended at any time.',
        params: {
          minutes: { type: 'integer', description: 'How long to plan for. Student allows 5 to 300.', min: 5, max: 300 },
          subject: { type: 'string', description: 'What it is about, in the student’s own words.' },
          level: { type: 'string', description: 'How strict it is. Deep locks the policy until the time is up.', enum: [...LEVELS] },
          title: { type: 'string', description: 'What to call it. Defaults to the subject.' }
        },
        confirmation: 'always',
        run: async (params) => {
          const subject = typeof params.subject === 'string' && params.subject.trim() ? params.subject.trim() : null
          const out = await screen.startFocus({
            subject,
            minutes: typeof params.minutes === 'number' ? params.minutes : null,
            level: typeof params.level === 'string' ? params.level : null,
            title: typeof params.title === 'string' && params.title.trim() ? params.title.trim() : (subject ?? 'Focus')
          })
          // The service's own refusal, said in its own words rather than turned into a thrown error: "a session is
          // already running" is an answer, not a fault.
          if (!out?.ok) throw new Error(out?.why ?? 'That session could not be started.')
          return out
        },
        // Asked of Orbis again rather than read off this screen, which may not have redrawn yet.
        verify: async () => {
          const now = await screen.check()
          if (!now) return { done: false, detail: 'Orbis Student could not be asked whether a session is running.' }
          return now.session
            ? { done: true, detail: `A ${now.session.plannedMinutes}-minute ${now.session.level} session is running: ${now.session.title}.` }
            : { done: false, detail: 'No session is running.' }
        }
      },
      restDay: {
        name: 'Mark today as a rest day',
        about: 'Today costs nothing: a rest day neither breaks a run of days nor extends it.',
        run: () => screen.restDay(),
        verify: async () => {
          const now = await screen.check()
          if (!now) return { done: false, detail: 'Orbis Student could not be asked about today.' }
          const today = dayKey(Date.now())
          const marked = now.streaks.some((one) => one.restDays.includes(today))
          return { done: marked, detail: marked ? 'Today is marked as a rest day.' : 'Today is not marked as a rest day.' }
        }
      },
      close: {
        name: 'Close Orbis Student',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    /*
     * The pages that say what can be done on them, and only those.
     *
     * `session` is deliberately absent: reaching it means starting a session, and a walk that starts one to satisfy a
     * navigation request is the opposite of what anybody asked for. It is named with `manual` so a route to it is
     * refused with the sentence that says what would really get you there.
     */
    possibleChildren: [
      { id: 'settings', name: 'Settings', kind: 'page', reach: { kind: 'control', control: 'screen', value: 'settings' } },
      { id: 'session', name: 'The running session', kind: 'tool', reach: { kind: 'manual', how: 'a session has to be running. Use startFocus on Orbis Student, which asks first.' } }
    ],
    state: () => {
      const now = screen.snapshot()
      const focus = now.streaks.find((one) => one.kind === 'focus')
      return {
        activity: now.session ? (now.timer?.state === 'paused' ? 'paused' : now.timer?.state === 'break' ? 'paused' : 'running') : 'idle',
        ...(now.session ? { detail: `${now.session.policy.locked ? 'Focus Locked' : 'In Focus'}: ${now.session.title}` } : {}),
        values: {
          screen: screen.screen(),
          level: now.level.level,
          xp: now.level.xp,
          focusStreak: focus?.current ?? 0,
          sessionRunning: now.session !== null,
          dueToReview: now.due,
          savedForLater: now.waiting,
          minutesToday: Math.round(now.today.focusedSeconds / 60)
        }
      }
    }
  }
}

// ---------------------------------------------------------------- the running session

/** What the running-session screen has to hand over. */
export interface StudentSessionScreen {
  /** Throws when there is no session, which cannot happen while this screen is drawn. */
  snapshot(): StudentSnapshot
  /** Seconds elapsed and left, counted between snapshots. Null when there is no timer. */
  ticking(): { elapsed: number; remaining: number; through: number } | null
  pause(): Promise<unknown>
  resume(): Promise<unknown>
  startBreak(): Promise<unknown>
  endBreak(): Promise<unknown>
  carryOn(): Promise<unknown>
  extraMinute(): Promise<{ ok: boolean; why?: string; minutes?: number }>
  end(reason: string): Promise<{ ok: boolean }>
  capture(text: string): Promise<unknown>
  check(): Promise<StudentSnapshot | null>
}

/**
 * A session while it is running.
 *
 * No controls: a session's policy is snapshotted when it starts and never edited after, which is what makes the
 * blocking trustworthy. What there is here is what a student can actually do from this screen, and every one of them
 * is checked afterwards by asking Orbis again.
 */
export function studentSessionSurface(screen: StudentSessionScreen): SurfaceDeclaration {
  const session = (): NonNullable<StudentSnapshot['session']> => {
    const one = screen.snapshot().session
    if (!one) throw new Error('No session is running.')
    return one
  }
  const state = (): string => screen.snapshot().timer?.state ?? session().state

  /**
   * Why one of these cannot be done, naming the state the session is really in.
   *
   * Written out per state rather than as one sentence per action, because a single fallback got it wrong: pausing an
   * already-paused session answered "the session is not running, so there is nothing to pause", which is a true
   * sentence about the wrong problem and sends somebody looking for a bug in the timer. Found by pausing twice.
   */
  const unless = (allowed: readonly string[], said: Record<string, string>): (() => string | null) => () => {
    const now = state()
    if (allowed.includes(now)) return null
    return said[now] ?? `The session is ${now}, so that cannot be done now.`
  }
  const ELSEWHERE: Record<string, string> = {
    active: 'The session is running.',
    paused: 'The session is paused. Use resume.',
    break: 'The session is on a break. Use endBreak.',
    recovering: 'The session is waiting to be picked up. Use carryOn.'
  }

  return {
    id: 'session',
    parent: 'student',
    name: 'The running session',
    about: 'The timer, the break, the extra minute, and the way out.',
    kind: 'tool',
    keywords: ['session', 'focus', 'timer', 'pomodoro', 'break', 'pause', 'studying'],
    controls: {},
    actions: {
      pause: {
        name: 'Pause',
        about: 'Stops the clock. Paused time is not counted as focused time.',
        unavailable: unless(['active'], { ...ELSEWHERE, paused: 'It is already paused.' }),
        run: () => screen.pause(),
        verify: async () => {
          const now = await screen.check()
          const paused = now?.timer?.state === 'paused'
          return { done: paused, detail: paused ? 'The session is paused.' : `The session is ${now?.timer?.state ?? 'not there any more'}.` }
        }
      },
      resume: {
        name: 'Carry on',
        unavailable: unless(['paused'], { ...ELSEWHERE, active: 'It is already running.' }),
        run: () => screen.resume(),
        verify: async () => {
          const now = await screen.check()
          const active = now?.timer?.state === 'active'
          return { done: active, detail: active ? 'The session is running again.' : `The session is ${now?.timer?.state ?? 'not there any more'}.` }
        }
      },
      startBreak: {
        name: 'Take a break',
        unavailable: unless(['active', 'paused'], { ...ELSEWHERE, break: 'The session is already on a break.' }),
        run: () => screen.startBreak(),
        verify: async () => {
          const now = await screen.check()
          const onBreak = now?.timer?.state === 'break'
          return { done: onBreak, detail: onBreak ? 'The session is on a break.' : `The session is ${now?.timer?.state ?? 'not there any more'}.` }
        }
      },
      endBreak: {
        name: 'End the break',
        unavailable: unless(['break'], ELSEWHERE),
        run: () => screen.endBreak(),
        verify: async () => {
          const now = await screen.check()
          const active = now?.timer?.state === 'active'
          return { done: active, detail: active ? 'The break is over and the session is running.' : `The session is ${now?.timer?.state ?? 'not there any more'}.` }
        }
      },
      carryOn: {
        name: 'Get back to it',
        about: 'After losing the thread: the session picks up where it was rather than starting again.',
        unavailable: unless(['recovering'], ELSEWHERE),
        run: () => screen.carryOn(),
        verify: async () => {
          const now = await screen.check()
          const active = now?.timer?.state === 'active'
          return { done: active, detail: active ? 'The session is running again.' : `The session is ${now?.timer?.state ?? 'not there any more'}.` }
        }
      },
      extraMinute: {
        name: 'One more minute',
        about: 'Adds a minute to the plan. Offered only near the end, and only a few times a day.',
        run: async () => {
          const out = await screen.extraMinute()
          // The service says why not, in words a student reads. Thrown so the outcome is a failure with that reason
          // rather than a success carrying a quiet "ok: false".
          if (!out?.ok) throw new Error(out?.why ?? 'That minute could not be added.')
          return out
        },
        verify: async (data) => {
          const wanted = (data as { minutes?: number }).minutes
          const now = await screen.check()
          const planned = now?.session?.plannedMinutes
          return {
            done: typeof planned === 'number' && planned === wanted,
            detail: typeof planned === 'number' ? `The session is now planned for ${planned} minutes.` : 'The session is not there any more.'
          }
        }
      },
      capture: {
        name: 'Write a thought down',
        about: 'Puts something out of mind without leaving the session. It comes back in the later queue.',
        params: { text: { type: 'string', description: 'What to put aside, in one line.', required: true } },
        run: (params) => screen.capture(String(params.text)),
        verify: async () => {
          const now = await screen.check()
          return now
            ? { done: true, detail: `${now.waiting} ${now.waiting === 1 ? 'thing is' : 'things are'} waiting in the later queue.` }
            : { done: false, detail: 'Orbis Student could not be asked about the later queue.' }
        }
      },
      end: {
        name: 'End the session',
        about:
          'Ends it now. Work already done still counts and is still paid for, but the time that is left is gone -- which is why this asks first.',
        params: { reason: { type: 'string', description: 'Why, in a few words. Kept with the session.' } },
        confirmation: 'always',
        run: async (params) => {
          const out = await screen.end(typeof params.reason === 'string' ? params.reason : 'ended by Orbis')
          if (!out?.ok) throw new Error('There was no session to end.')
          return out
        },
        verify: async () => {
          const now = await screen.check()
          if (!now) return { done: false, detail: 'Orbis Student could not be asked whether the session ended.' }
          return now.session === null ? { done: true, detail: 'The session has ended.' } : { done: false, detail: 'The session is still running.' }
        }
      }
    },
    state: () => {
      const now = screen.snapshot()
      const one = session()
      const timer = now.timer
      const moving = screen.ticking()
      return {
        activity: timer?.state === 'paused' || timer?.state === 'break' ? 'paused' : timer?.state === 'active' || timer?.state === 'recovering' ? 'running' : 'idle',
        detail: `${one.title} — ${timer?.state ?? one.state}`,
        /*
         * A real measurement, so it is reported.
         *
         * The session knows how long it was planned for and how much of that has been focused, which is the one place
         * in Student where a fraction is a fact rather than a guess.
         */
        ...(moving ? { progress: moving.through } : {}),
        values: {
          title: one.title,
          subject: one.subject,
          level: one.level,
          locked: one.policy.locked,
          plannedMinutes: one.plannedMinutes,
          ...(moving ? { secondsFocused: moving.elapsed, secondsLeft: moving.remaining } : {}),
          block: timer ? `${timer.block} of ${timer.blocks}` : null,
          breakSecondsLeft: timer?.breakRemaining ?? null,
          interruptions: one.interruptions,
          reachedForSomethingBlocked: one.distractionAttempts,
          savedForLater: one.savedForLater,
          extraMinutesToday: now.extraMinutes,
          anotherMinuteOnOffer: now.canExtend
        }
      }
    }
  }
}

// ---------------------------------------------------------------- Student's own settings

/** What Student's settings page has to hand over. */
export interface StudentSettingsScreen {
  /** Throws until the snapshot has arrived. */
  snapshot(): StudentSnapshot
  /** The patch goes through the same `save-settings` the page's own fields call, so one set of rules reads it. */
  save(patch: Record<string, unknown>): Promise<unknown>
  /** Which group of settings is open. */
  section(): string
  openSection(id: string): void
  sections: readonly string[]
  /** The soundscapes Orbis offers, as the page lists them. Empty until the catalogue has arrived. */
  atmospheres: readonly { id: string; label: string }[]
  reset(scope: string): Promise<unknown>
  check(): Promise<StudentSnapshot | null>
}

/**
 * Student's settings, control by control.
 *
 * Every type, range and list here is read from `patchPreferences` in `src/shared/student/prefs.ts` -- the one place
 * that decides what a preference may be. Nothing is described twice: a range written out again here would be a second
 * range, and the wrong one is always the one a caller is told about.
 */
export function studentSettingsSurface(screen: StudentSettingsScreen): SurfaceDeclaration {
  const prefs = (): StudentSnapshot['preferences'] => screen.snapshot().preferences
  const saveVolume = (which: 'music' | 'atmosphere' | 'ui' | 'orbi') => (value: unknown) =>
    void screen.save({ volumes: { ...prefs().volumes, [which]: Number(value) } })

  /** A switch, saved through the page's own handler. Four lines each otherwise, nineteen times. */
  const flag = (name: string, key: keyof StudentSnapshot['preferences'], description: string, fallback: boolean): ControlDeclaration => ({
    name,
    spec: { type: 'boolean', description },
    get: () => prefs()[key] === true,
    set: (on) => void screen.save({ [key]: on === true }),
    default: fallback
  })

  const volume = (name: string, which: 'music' | 'atmosphere' | 'ui' | 'orbi', description: string, fallback: number): ControlDeclaration => ({
    name,
    spec: { type: 'number', description, min: 0, max: 1 },
    get: () => prefs().volumes[which],
    set: saveVolume(which),
    default: fallback
  })

  return {
    id: 'settings',
    parent: 'student',
    name: 'Settings',
    about: 'How Student works for this person: focus defaults, safety, Orbi, sound, notifications and what is stored.',
    kind: 'page',
    keywords: ['student settings', 'preferences', 'safety', 'focus defaults', 'volumes', 'accessibility'],
    controls: {
      section: {
        name: 'Group',
        about: 'Which group of settings is open.',
        spec: { type: 'string', description: 'Which group of settings is open.', enum: [...screen.sections] },
        get: () => screen.section(),
        set: (value) => screen.openSection(String(value)),
        default: 'you'
      },
      defaultMinutes: {
        name: 'How long a session is',
        about: 'The length a new session starts with. A session already running keeps the length it was started with.',
        spec: { type: 'integer', description: 'Minutes. Student allows 5 to 300.', min: 5, max: 300 },
        get: () => prefs().defaultMinutes,
        set: (value) => void screen.save({ defaultMinutes: Number(value) }),
        default: 45
      },
      defaultLevel: {
        name: 'How strict a session is',
        about: 'Light warns, Focus blocks, Deep blocks and locks. This is the level a new session starts at.',
        spec: { type: 'string', description: 'The level a new session starts at.', enum: [...LEVELS] },
        get: () => prefs().defaultLevel,
        set: (value) => void screen.save({ defaultLevel: String(value) }),
        default: 'focus'
      },
      difficulty: {
        name: 'How hard the learning is',
        spec: { type: 'string', description: 'The difficulty of what Student offers to read and answer.', enum: ['beginner', 'intermediate', 'advanced'] },
        get: () => prefs().difficulty,
        set: (value) => void screen.save({ difficulty: String(value) }),
        default: 'intermediate'
      },
      motivationStyle: {
        name: 'How Orbi talks to you',
        spec: {
          type: 'string',
          description: 'The tone Orbi uses.',
          enum: ['calm', 'goal', 'energetic', 'academic', 'self-competition', 'minimal']
        },
        get: () => prefs().motivationStyle,
        set: (value) => void screen.save({ motivationStyle: String(value) }),
        default: 'calm'
      },
      musicOnFocus: {
        name: 'Music when a session starts',
        spec: { type: 'string', description: 'Whether a session starts music by itself, offers to, or leaves it alone.', enum: ['off', 'suggest', 'auto'] },
        get: () => prefs().musicOnFocus,
        set: (value) => void screen.save({ musicOnFocus: String(value) }),
        default: 'suggest'
      },
      atmosphere: {
        name: 'Soundscape',
        about: 'The background sound a session uses.',
        spec: {
          type: 'string',
          description: 'The soundscape a session uses.',
          // Left out until the list has arrived: an empty list of allowed values refuses every value, which would
          // read as the soundscape being unsettable rather than as the list not being known yet.
          ...(screen.atmospheres.length ? { enum: screen.atmospheres.map((one) => one.id) } : {})
        },
        get: () => prefs().atmosphere,
        set: (value) => void screen.save({ atmosphere: String(value) }),
        writable: () => (screen.atmospheres.length ? true : 'The list of soundscapes has not arrived yet, so Orbis cannot tell which ones are real.'),
        default: 'minimal'
      },
      notifications: {
        name: 'What Student tells you about',
        spec: { type: 'string', description: 'How much Student interrupts.', enum: ['all', 'important', 'focus', 'off'] },
        get: () => prefs().notifications,
        set: (value) => void screen.save({ notifications: String(value) }),
        default: 'important'
      },
      density: {
        name: 'How much is on screen',
        spec: { type: 'string', description: 'How tightly Student is laid out.', enum: ['calm', 'standard', 'dense'] },
        get: () => prefs().density,
        set: (value) => void screen.save({ density: String(value) }),
        default: 'standard'
      },
      /*
       * The one setting here that changes what is blocked right now.
       *
       * Everything else about a session's policy is frozen when the session starts. Safety is not part of a session --
       * the service re-applies it at once -- so turning it off while somebody is studying really does open things up,
       * and that is a decision for a person rather than for an assistant.
       */
      safetyOverride: {
        name: 'Safety',
        about: 'Follow the age, be stricter than the age, or turn the age protection off. Turning it off applies immediately, to the browser as well.',
        spec: { type: 'string', description: 'age follows the date of birth, strict is stricter than that, off turns the age protection off.', enum: ['age', 'strict', 'off'] },
        get: () => prefs().safetyOverride,
        set: (value) => void screen.save({ safetyOverride: String(value) }),
        effects: ['write'],
        confirmation: 'always',
        default: 'age'
      },
      quietFrom: {
        name: 'Orbi quiet from',
        about: 'The hour Orbi stops saying anything, on a 24-hour clock.',
        spec: { type: 'integer', description: 'The hour Orbi goes quiet, 0 to 23.', min: 0, max: 23 },
        get: () => {
          const hours = prefs().quietHours
          // Null is "no quiet hours", which is a different answer from a time, and saying so is better than a 0 that
          // would read as midnight.
          if (!hours) throw new Error('Quiet hours are off, so there is no hour to read. Turn quietHours on first.')
          return hours.from
        },
        set: (value) => void screen.save({ quietHours: { from: Number(value), to: prefs().quietHours?.to ?? 7 } }),
        writable: () => (prefs().quietHours ? true : 'Quiet hours are off, so there are no hours to set. Turn quietHours on first.')
      },
      quietUntil: {
        name: 'Orbi quiet until',
        spec: { type: 'integer', description: 'The hour Orbi starts again, 0 to 23.', min: 0, max: 23 },
        get: () => {
          const hours = prefs().quietHours
          if (!hours) throw new Error('Quiet hours are off, so there is no hour to read. Turn quietHours on first.')
          return hours.to
        },
        set: (value) => void screen.save({ quietHours: { from: prefs().quietHours?.from ?? 22, to: Number(value) } }),
        writable: () => (prefs().quietHours ? true : 'Quiet hours are off, so there are no hours to set. Turn quietHours on first.')
      },
      quietHours: {
        name: 'Quiet hours',
        about: 'Hours when Orbi says nothing at all.',
        spec: { type: 'boolean', description: 'Whether Orbi has hours when it says nothing.' },
        get: () => prefs().quietHours !== null,
        // Back to the hours it had, or the usual night, rather than to a range nobody chose.
        set: (on) => void screen.save({ quietHours: on === true ? (prefs().quietHours ?? { from: 22, to: 7 }) : null }),
        default: true
      },
      weatherCity: {
        name: 'Town for the weather',
        about: 'Typed in, and nothing else: Student never asks the computer where it is. Empty means the weather is not part of how Orbi moves.',
        spec: { type: 'string', description: 'A town name, or empty for none.' },
        get: () => prefs().weatherCity ?? '',
        set: (value) => void screen.save({ weatherCity: String(value ?? '') }),
        default: ''
      },
      exitConfirmation: flag('Ask before leaving a session', 'exitConfirmation', 'Whether leaving a session early asks first.', true),
      learningReminders: flag('Remind me to come back to things', 'learningReminders', 'Whether Student reminds you what is due to review.', true),
      briefingMorning: flag('A word in the morning', 'briefingMorning', 'Whether Student says what the day holds.', false),
      briefingEvening: flag('A word in the evening', 'briefingEvening', 'Whether Student says how the day went.', false),
      reducedMotion: flag('Less movement', 'reducedMotion', 'Whether Student holds still.', false),
      reducedTransparency: flag('Solid panels', 'reducedTransparency', 'Whether panels stop being see-through.', false),
      highContrast: flag('High contrast', 'highContrast', 'Whether Student uses stronger colours.', false),
      largerText: flag('Larger text', 'largerText', 'Whether Student sets its text bigger.', false),
      musicVolume: volume('Music volume', 'music', 'How loud music is in Student, from 0 to 1.', 0.7),
      atmosphereVolume: volume('Soundscape volume', 'atmosphere', 'How loud the soundscape is, from 0 to 1.', 0.5),
      interfaceVolume: volume('Interface volume', 'ui', 'How loud Student’s own sounds are, from 0 to 1.', 0.4),
      orbiVolume: volume('Orbi’s voice volume', 'orbi', 'How loud Orbi speaks, from 0 to 1.', 0.6)
    },
    actions: {
      reset: {
        name: 'Start part of Student over',
        about: 'Removes one kind of Student data for this profile. It never touches the browser, the history, or any Orbis setting outside Student.',
        params: {
          scope: {
            type: 'string',
            description: `What to remove. ${RESET_SCOPES.map((one) => `${one.id}: ${one.blurb}`).join(' ')}`,
            enum: RESET_SCOPES.map((one) => one.id),
            required: true
          }
        },
        effects: ['delete'],
        confirmation: 'always',
        run: async (params) => {
          await screen.reset(String(params.scope))
          return { scope: String(params.scope) }
        },
        verify: async (data) => {
          const scope = (data as { scope: ResetScope }).scope
          const now = await screen.check()
          if (!now) return { done: false, detail: 'Orbis Student could not be asked what is left.' }
          // Checked against the thing each scope really empties, rather than against a success flag.
          if (scope === 'xp' || scope === 'everything') return { done: now.level.xp === 0, detail: now.level.xp === 0 ? 'There is no XP left.' : `${now.level.xp} XP is still there.` }
          if (scope === 'achievements') return { done: now.achievements.length === 0, detail: now.achievements.length === 0 ? 'No achievements are unlocked.' : `${now.achievements.length} are still unlocked.` }
          if (scope === 'goals') return { done: now.goals.length === 0, detail: now.goals.length === 0 ? 'There are no goals left.' : `${now.goals.length} goals are still there.` }
          if (scope === 'distractions') return { done: now.waiting === 0, detail: now.waiting === 0 ? 'The later queue is empty.' : `${now.waiting} things are still waiting.` }
          // The rest are real and nothing on the snapshot measures them, so this says that rather than inventing a
          // check that would always pass.
          return { done: false, detail: `${scope} was removed, and nothing Orbis can read from here measures it, so this is not confirmed.` }
        }
      }
    },
    state: () => {
      const now = prefs()
      return {
        values: {
          group: screen.section(),
          safety: now.safetyOverride,
          quietHours: now.quietHours ? `${now.quietHours.from} to ${now.quietHours.to}` : 'off',
          sessionLength: now.defaultMinutes,
          level: now.defaultLevel,
          blockedCategories: now.blockedCategories.length,
          sitesAlwaysAllowed: now.approvedSites.length
        }
      }
    }
  }
}
