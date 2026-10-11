import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, BookOpen, CalendarCheck, CalendarClock, CalendarDays, Brain, GraduationCap, Home as HomeIcon, Layers, Library, PenLine, Rocket, Settings2, Sparkles, Target, X } from 'lucide-react'
import Orbi from './Orbi'
import HomeBoard, { Completion } from './Home'
import FocusStart from './FocusStart'
import FocusRunning from './FocusRunning'
import Onboarding from './Onboarding'
import Tour from './Tour'
import type { TourScreen } from '../../../../shared/student/tour'
import OrbiPanel from './OrbiPanel'
import OrbiAppears from './OrbiAppears'
import Listen from './Listen'
import { atmosphere } from './atmosphere'
import { useReducedMotion, useStudent } from './useStudent'
import { coach, newCoachState, type CoachState } from '../../../../shared/student/orbi'
import type { FocusSession, MotivationEvent, OrbiState } from '../../../../shared/student/types'
import type { OrbiMoment } from '../../../../shared/student/orbiAnim'
import type { NoticeKind } from '../../lib/notices'
import './student.css'

const Learn = lazy(() => import('./Learn'))
const Goals = lazy(() => import('./Goals'))
const Study = lazy(() => import('./Study'))
const Progress = lazy(() => import('./Progress'))
const StudentSettings = lazy(() => import('./StudentSettings'))
const OrbiRoom = lazy(() => import('./OrbiRoom'))
const Plan = lazy(() => import('./Plan'))
const Mastery = lazy(() => import('./Mastery'))
const Cards = lazy(() => import('./Cards'))
const Missions = lazy(() => import('./Missions'))
const Day = lazy(() => import('./Day'))
const Board = lazy(() => import('./Board'))
const Exam = lazy(() => import('./Exam'))

/**
 * Orbi saying something out loud, when that was asked for.
 *
 * Off by default, and on "minimal" only the things that matter are spoken -- a companion that reads every milestone
 * aloud is one somebody silences within a day. Whatever is already being said is cancelled first, so two messages
 * never talk over each other, and a browser with no speech simply does nothing rather than failing.
 */
function speak(text: string, voice: 'off' | 'minimal' | 'normal', volume: number, priority: 'high' | 'medium' | 'low'): void {
  if (voice === 'off') return
  if (voice === 'minimal' && priority !== 'high') return
  try {
    const engine = window.speechSynthesis
    if (!engine) return
    engine.cancel()
    const said = new SpeechSynthesisUtterance(text)
    said.volume = Math.max(0, Math.min(1, volume))
    said.rate = 1
    engine.speak(said)
  } catch {
    // No speech on this computer. Orbi is written down either way.
  }
}

/**
 * Orbis Student.
 *
 * The shell: one screen at a time, Orbi beside it, and the running session taking over everything when there is one.
 * Four decisions in here are worth knowing about.
 *
 * **A running session replaces the dashboard.** Not a banner over it -- the whole screen. During Focus there is
 * nothing to browse, nothing to discover and nothing to score; there is a timer and the task. The dashboard comes
 * back when the session does not exist any more.
 *
 * **Orbi's rate limiting lives here.** The service says what happened; this decides whether it is worth saying out
 * loud, using the same pure `coach` the tests cover. Keeping it in the interface means the cooldowns follow what is
 * actually on screen -- whether somebody is typing, mid-quiz or waiting on Orion -- which the main process cannot
 * know.
 *
 * **Escape closes a panel, and never ends a session.** Twenty-five minutes of work must not be undone by a keypress
 * somebody uses to dismiss things.
 *
 * **Nothing here is required for Student to work.** If Orbi fails to draw, the timer, the policy and the learning
 * carry on; if the atmosphere cannot play, the session does.
 */

type Screen = 'home' | 'focus' | 'plan' | 'learn' | 'cards' | 'missions' | 'mastery' | 'goals' | 'exams' | 'study' | 'board' | 'day' | 'progress' | 'orbi' | 'settings'

const NAV: { id: Screen; label: string; icon: typeof HomeIcon }[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'focus', label: 'Focus', icon: Target },
  { id: 'plan', label: 'Plan', icon: CalendarDays },
  { id: 'learn', label: 'Learn', icon: BookOpen },
  { id: 'cards', label: 'Cards', icon: Layers },
  { id: 'missions', label: 'Missions', icon: Rocket },
  { id: 'mastery', label: 'What you know', icon: Brain },
  { id: 'goals', label: 'Goals', icon: GraduationCap },
  { id: 'exams', label: 'Exams', icon: CalendarClock },
  { id: 'study', label: 'Study', icon: Library },
  { id: 'board', label: 'Whiteboard', icon: PenLine },
  { id: 'day', label: 'Today', icon: CalendarCheck },
  { id: 'progress', label: 'Progress', icon: BarChart3 },
  { id: 'orbi', label: 'Orbi', icon: Sparkles },
  { id: 'settings', label: 'Settings', icon: Settings2 }
]

export default function StudentView({
  onClose,
  onNotify,
  onOpenOrion,
  onOpenUrl
}: {
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
  onOpenOrion?(prompt: string): void
  onOpenUrl?(url: string): void
}): React.JSX.Element {
  const { snapshot, catalogue, ticking, call, refresh, problems } = useStudent()
  const [screen, setScreen] = useState<Screen>('home')
  /*
   * Whether Orbi is showing somebody round.
   *
   * Held here rather than in the tour, because the tour has to be able to navigate this view -- that is the whole
   * reason it teaches the real product instead of pictures of it.
   */
  const [touring, setTouring] = useState(false)
  /*
   * Where a deliberately started tour begins.
   *
   * "Meet Orbi again" means from the beginning, and saving `tourAt: null` is not enough on its own: the snapshot
   * that holds it has not come back yet, so the tour would open on the step somebody stopped at. This says which
   * was meant, rather than racing the save.
   */
  const [tourFrom, setTourFrom] = useState<string | null | undefined>(undefined)
  const [studyTab, setStudyTab] = useState<'capsules' | 'spaces' | 'library' | 'later'>('capsules')
  const [starting, setStarting] = useState(false)
  const [finished, setFinished] = useState<{ session: FocusSession; xp: number } | null>(null)
  const [says, setSays] = useState<string | null>(null)
  const [moment, setMoment] = useState<string | null>(null)
  const [panel, setPanel] = useState(false)
  /**
   * What Orbi should react to, held for a moment and then cleared.
   *
   * Separate from `moment`, which is what the main process says is happening. This is the interface's own feed of
   * things it saw -- a task ticked off, XP arriving -- which the main process has no reason to know about.
   */
  const [reaction, setReaction] = useState<OrbiMoment | null>(null)
  const coachState = useRef<CoachState>(newCoachState())
  const lastSession = useRef<FocusSession | null>(null)
  const typing = useRef(false)

  const prefs = snapshot?.preferences
  const reduced = useReducedMotion(prefs?.reducedMotion ?? false)

  /** Whether somebody is in the middle of writing something. Orbi stays quiet whenever they are. */
  useEffect(() => {
    const check = (): void => {
      const active = document.activeElement
      typing.current = active instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(active.tagName)
    }
    document.addEventListener('focusin', check)
    document.addEventListener('focusout', check)
    return () => {
      document.removeEventListener('focusin', check)
      document.removeEventListener('focusout', check)
    }
  }, [])

  const say = useCallback(
    (event: MotivationEvent): void => {
      if (!prefs) return
      const out = coach(
        event,
        { typing: typing.current, reading: screen === 'learn', quizzing: screen === 'learn', waitingOnOrion: false, behaviour: prefs.orbi, sessionId: snapshot?.session?.id ?? null },
        coachState.current,
        Date.now()
      )
      coachState.current = out.state
      if (!out.message) return
      setSays(out.message.text)
      speak(out.message.text, prefs.orbi.voice, prefs.volumes.orbi, out.message.priority)
    },
    [prefs, screen, snapshot?.session?.id]
  )

  /** A session appearing or disappearing is what moves this screen, and what Orbi reacts to. */
  useEffect(() => {
    const now = snapshot?.session ?? null
    const before = lastSession.current
    if (now && !before) {
      setScreen('focus')
      setStarting(false)
      say('session-started')
    }
    if (!now && before && !before.settled) {
      // It finished while this screen was open: show the card, with the numbers that were actually recorded.
      void call<FocusSession | null>('session', before.id).then((stored) => {
        const done = stored ?? before
        if (done.focusedSeconds >= 300) setFinished({ session: done, xp: done.xpAwarded })
        setScreen('home')
      })
      say('session-complete')
    }
    lastSession.current = now
  }, [snapshot?.session, call, say])

  /** What Orbi is reacting to right now, asked rather than guessed. */
  useEffect(() => {
    void call<string | null>('moment').then((one) => setMoment(one ?? null))
  }, [call, snapshot])

  useEffect(() => {
    if (!reaction) return
    const timer = setTimeout(() => setReaction(null), 4000)
    return () => clearTimeout(timer)
  }, [reaction])

  /**
   * A record being beaten is worth exactly one reaction.
   *
   * Driven off the snapshot's own `record.beaten`, which only stays true for a minute, so this cannot fire twice
   * for the same record.
   */
  const beaten = snapshot?.record?.beaten ?? false
  useEffect(() => {
    if (beaten) setReaction('record')
  }, [beaten])

  useEffect(() => {
    // Leaving Student lets go of the audio engine, and stops Orbi mid-sentence. Nothing is left making a noise
    // behind a closed screen.
    return () => {
      atmosphere().release()
      try {
        window.speechSynthesis?.cancel()
      } catch {
        // Nothing was speaking.
      }
    }
  }, [])

  useEffect(() => {
    for (const problem of problems) onNotify(problem, 'warn')
  }, [problems, onNotify])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      /*
       * Claimed while there is something to step back out of, so the shell's own Escape does not close Student from
       * underneath a panel. Where this handler has nowhere left to go it leaves the key alone and the shell closes
       * the screen, which is the same rule everywhere else.
       */
      const claim = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }
      // Never ends a session. A panel closes itself; this only gets the plain case.
      if (panel) {
        claim()
        setPanel(false)
        return
      }
      if (finished) {
        setFinished(null)
        return
      }
      if (starting) {
        setStarting(false)
        return
      }
      if (snapshot?.session) return
      if (screen !== 'home') {
        setScreen('home')
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, starting, finished, panel, snapshot?.session, onClose])

  if (!snapshot || !prefs) {
    return (
      <div className="view st-view" role="region" aria-label="Orbis Student">
        <div className="st-loading">
          <div className="st-skeleton head" />
          <div className="st-skeleton row" />
          <div className="st-skeleton row" />
        </div>
      </div>
    )
  }

  if (!prefs.onboarded) {
    return (
      <div className="view st-view" role="region" aria-label="Orbis Student">
        {/*
          A way out of the first screen anybody sees.

          Its first step is deliberately not skippable, and it sat in a bare view with no heading row -- so the
          only exit was Escape, which works and which nothing said. The close button the rest of Student has,
          in the same corner, doing the same thing.
        */}
        <div className="st-onb-exit">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close Orbis Student">
            <X size={16} />
          </button>
        </div>
        <Onboarding call={call} onDone={() => void refresh()} />
      </div>
    )
  }

  const session = snapshot.session
  /** What the main process said, turned into an animation name. */
  const fromMain: OrbiMoment | null =
    moment === 'level-up' ? 'level-up' : moment === 'achievement' ? 'achievement' : moment === 'celebrating' ? 'session-complete' : moment === 'distraction' ? 'shield' : null
  const orbiMoment: OrbiMoment | null = fromMain ?? reaction
  const orbiState: OrbiState =
    moment === 'level-up'
      ? 'level-up'
      : moment === 'achievement'
        ? 'achievement'
        : moment === 'celebrating'
          ? 'celebrating'
          : moment === 'distraction'
            ? 'distraction-warning'
            : session?.state === 'break'
              ? 'break'
              : session?.state === 'recovering'
                ? 'recovery'
                : session
                  ? session.policy.locked
                    ? 'focus-locked'
                    : 'focused'
                  : 'ready'

  const startCapsule = async (id: string): Promise<void> => {
    const out = await call<{ ok: boolean; why?: string }>('start-focus', { capsuleId: id })
    if (!out?.ok) onNotify(out?.why ?? 'That capsule could not be started.', 'warn')
  }

  /**
   * Starting a session on a particular thing -- from the plan, the mastery map or a suggestion.
   *
   * The concept travels with the session so that finishing it records that the concept was worked on. Everything
   * else is a default the student can still change on the start screen.
   */
  const startOn = async (options: { subject: string | null; conceptId: string | null; minutes: number | null; title: string }): Promise<void> => {
    /*
     * Nothing specified means nothing to start.
     *
     * A button that says only "Start Focus" has not been told what to work on or for how long, so it opens the
     * setup screen rather than silently committing somebody to twenty-five minutes of a subject Orbis picked.
     */
    if (!options.conceptId && !options.subject && options.minutes === null) {
      setStarting(true)
      return
    }
    const out = await call<{ ok: boolean; why?: string }>('start-focus', {
      subject: options.subject,
      conceptId: options.conceptId,
      title: options.title,
      ...(options.minutes ? { minutes: options.minutes } : {})
    })
    if (!out?.ok) onNotify(out?.why ?? 'That session could not be started.', 'warn')
  }

  const startTask = async (taskId: string | null, subject: string | null): Promise<void> => {
    const out = await call<{ ok: boolean; why?: string }>('start-focus', { taskId, subject })
    if (!out?.ok) onNotify(out?.why ?? 'That session could not be started.', 'warn')
  }

  return (
    <div
      className={`view st-view density-${prefs.density}${prefs.largerText ? ' st-larger' : ''}${prefs.highContrast ? ' st-contrast' : ''}${prefs.reducedTransparency ? ' st-solid' : ''}${reduced ? ' st-still' : ''}`}
      role="region"
      aria-label="Orbis Student"
    >
      <header className="view-head st-head">
        <div className="st-head-left">
          <GraduationCap size={17} aria-hidden />
          <strong>Orbis Student</strong>
          {session ? (
            <span className="st-head-session">
              {session.policy.locked ? 'Focus Locked' : 'In Focus'} · {session.title}
            </span>
          ) : null}
        </div>
        <div className="st-head-right">
          {/*
            * Saying it instead of pressing it.
            *
            * Only the things that are safe to mishear: start, pause, carry on, break, finish, and opening screens.
            * Nothing spoken deletes anything.
            */}
          <Listen
            onNotify={onNotify}
            onCommand={async (command) => {
              switch (command.kind) {
                case 'start-focus':
                  if (snapshot.session) {
                    onNotify('A session is already running.', 'warn')
                    return
                  }
                  await startOn({ subject: command.subject, conceptId: null, minutes: command.minutes, title: command.subject ?? 'Focus' })
                  return
                case 'end-focus': {
                  if (!snapshot.session) {
                    onNotify('No session is running.')
                    return
                  }
                  const out = await call<{ ok: boolean; why?: string }>('end-focus', 'finished out loud')
                  if (!out?.ok) onNotify(out?.why ?? 'That did not work.', 'warn')
                  return
                }
                case 'pause':
                  await call('pause-focus')
                  return
                case 'resume':
                  await call('resume-focus')
                  return
                case 'break':
                  await call('start-break')
                  return
                case 'rest-day':
                  await call('rest-day')
                  onNotify('Marked as a rest day. Your streak keeps going.')
                  return
                case 'how-long':
                  onNotify(
                    snapshot.session
                      ? `${Math.max(0, Math.round(snapshot.session.plannedMinutes - snapshot.session.focusedSeconds / 60))} minutes left.`
                      : 'No session is running.'
                  )
                  return
                case 'what-next':
                  setScreen('home')
                  return
                case 'go':
                  setScreen(command.where as Screen)
                  return
                default:
                  return
              }
            }}
          />
          <span className="st-chip">Level {snapshot.level.level}</span>
          <span className="st-chip">{snapshot.level.xp.toLocaleString()} XP</span>
          {(snapshot.streaks.find((one) => one.kind === 'focus')?.current ?? 0) > 0 ? (
            <span className="st-chip">🔥 {snapshot.streaks.find((one) => one.kind === 'focus')?.current}</span>
          ) : null}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close Orbis Student">
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>

      {/* During a session the navigation is out of the way: there is one thing to do and it is on screen. */}
      {!session ? (
        <nav className="st-nav" aria-label="Orbis Student">
          {NAV.map((one) => (
            <button
              key={one.id}
              type="button"
              className={`st-nav-btn${screen === one.id ? ' on' : ''}`}
              aria-current={screen === one.id}
              /*
               * The name is on the button itself as well as in it.
               *
               * The strip shrinks to fit the window rather than scrolling sideways, so in a narrow window the words
               * shorten and eventually give way to the icons. The label has to survive that, for a screen reader and
               * for a hover.
               */
              aria-label={one.label}
              title={one.label}
              onClick={() => setScreen(one.id)}
            >
              <one.icon size={15} aria-hidden />
              <span className="st-nav-label">{one.label}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <div className="st-body">
        {session ? (
          <FocusRunning snapshot={snapshot} ticking={ticking} catalogue={catalogue} moment={orbiMoment} call={call} onOpenOrion={onOpenOrion} onNotify={onNotify} />
        ) : starting ? (
          <FocusStart snapshot={snapshot} catalogue={catalogue} call={call} onClose={() => setStarting(false)} onStarted={() => setStarting(false)} onNotify={onNotify} />
        ) : (
          <Suspense fallback={<div className="st-loading"><div className="st-skeleton row" /></div>}>
            {screen === 'home' ? (
              <HomeBoard
                snapshot={snapshot}
                catalogue={catalogue}
                call={call}
                onStart={() => setStarting(true)}
                onStartOn={(options) => void startOn(options)}
                onOpenOrion={onOpenOrion}
                onGo={(where) => {
                  if (where === 'later') {
                    setStudyTab('later')
                    setScreen('study')
                    return
                  }
                  setScreen(where as Screen)
                }}
                onNotify={(message, kind) => {
                  // XP arriving in a message is the interface's own cue for a small reaction.
                  if (/\+\d+ XP/.test(message)) setReaction('xp')
                  onNotify(message, kind)
                }}
              />
            ) : null}
            {screen === 'plan' ? <Plan call={call} onStart={(options) => void startOn(options)} onNotify={onNotify} /> : null}
            {screen === 'mastery' ? (
              <Mastery call={call} onStart={(options) => void startOn(options)} onNotify={onNotify} onOpenOrion={onOpenOrion} />
            ) : null}
            {screen === 'focus' ? <FocusStart snapshot={snapshot} catalogue={catalogue} call={call} onClose={() => setScreen('home')} onStarted={() => setScreen('home')} onNotify={onNotify} /> : null}
            {screen === 'learn' ? <Learn snapshot={snapshot} call={call} onNotify={onNotify} onOpenOrion={onOpenOrion} /> : null}
            {screen === 'cards' ? <Cards call={call} onNotify={onNotify} /> : null}
            {screen === 'missions' ? <Missions call={call} onStart={(options) => void startOn(options)} onNotify={onNotify} /> : null}
            {screen === 'goals' ? <Goals call={call} onNotify={onNotify} onStart={(taskId, subject) => void startTask(taskId, subject)} onOpenOrion={onOpenOrion} /> : null}
            {screen === 'study' ? (
              <Study
                snapshot={snapshot}
                catalogue={catalogue}
                call={call}
                tab={studyTab}
                onTab={setStudyTab}
                onNotify={onNotify}
                onStartCapsule={(id) => void startCapsule(id)}
                onOpen={(url) => onOpenUrl?.(url)}
              />
            ) : null}
            {screen === 'exams' ? <Exam call={call} onStart={(options) => void startOn(options)} onNotify={onNotify} /> : null}
            {screen === 'board' ? <Board call={call} onNotify={onNotify} /> : null}
            {screen === 'day' ? <Day call={call} onNotify={onNotify} /> : null}
            {screen === 'progress' ? <Progress snapshot={snapshot} catalogue={catalogue} call={call} /> : null}
            {screen === 'orbi' ? <OrbiRoom snapshot={snapshot} catalogue={catalogue} call={call} onNotify={onNotify} /> : null}
            {screen === 'settings' ? <StudentSettings snapshot={snapshot} catalogue={catalogue} call={call} onNotify={onNotify} onTour={(fromStart) => {
                  setTourFrom(fromStart ? null : undefined)
                  setTouring(true)
                }} /> : null}
          </Suspense>
        )}
      </div>

      {/*
        * The tour, over the real screens.
        *
        * Offered unasked exactly once -- after the setup questions, before anything else -- and never again unless
        * somebody asks for it from Settings. Skipping it keeps the step it was on, so "carry on" means carry on.
        */}
      {(touring || (!prefs.tourDone && prefs.tourAt === null && !session)) && prefs.orbi.enabled ? (
        <Tour
          behaviour={prefs.orbi}
          reducedMotion={reduced}
          startAt={tourFrom === undefined ? prefs.tourAt : tourFrom}
          screen={screen as TourScreen}
          worn={snapshot.orbi.worn}
          level={snapshot.level.level}
          onGo={(to) => setScreen(to as Screen)}
          onLeave={(stoppedAt) => {
            setTouring(false)
            setTourFrom(undefined)
            void call('save-settings', { tourAt: stoppedAt }).then(() => refresh())
          }}
          onFinish={() => {
            setTouring(false)
            setTourFrom(undefined)
            // Straight into the thing the tour was about, rather than back to a screen nobody asked for.
            void call('save-settings', { tourDone: true, tourAt: null }).then(() => refresh())
            setScreen('focus')
          }}
        />
      ) : null}

      {/* Orbi, beside the work rather than in it. Never drawn during a session: FocusRunning places it itself. */}
      {!session && !touring && prefs.orbi.enabled && prefs.orbi.visibility !== 'hidden' ? (
        <div className={`st-orbi-corner ${prefs.orbi.position}`}>
          <Orbi
            state={orbiState}
            moment={orbiMoment}
            behaviour={prefs.orbi}
            reducedMotion={reduced}
            says={says}
            worn={snapshot.orbi.worn}
            level={snapshot.level.level}
            at={prefs.orbiAt}
            weatherCity={prefs.weatherCity}
            onMove={(spot) => void call('move-orbi', spot)}
            size={84}
            floating
            onClick={() => setPanel(true)}
          />
          {/*
            * Orbi turning up on its own, beside itself rather than over the work.
            *
            * Only when there is no session, nothing is being typed and no panel is already open -- and even then the
            * main process has the final say, including the day's budget and the quiet hours.
            */}
          {!panel && prefs.orbi.messages !== 'off' ? (
            <OrbiAppears
              call={call}
              enabled={!session && !starting && !finished}
              busy={{ typing: typing.current, reading: screen === 'learn' }}
              screen={screen}
              onStart={(options) => void startOn(options)}
              onGo={(where) => setScreen(where as Screen)}
              onSays={(text) => setSays(text)}
            />
          ) : null}
          {panel ? (
            <OrbiPanel
              snapshot={snapshot}
              ticking={ticking}
              call={call}
              onClose={() => setPanel(false)}
              onStart={() => {
                setPanel(false)
                setStarting(true)
              }}
              onGo={(where) => {
                setPanel(false)
                if (where === 'later') {
                  setStudyTab('later')
                  setScreen('study')
                  return
                }
                setScreen(where as Screen)
              }}
              onOpenOrion={onOpenOrion}
              onNotify={onNotify}
            />
          ) : null}
        </div>
      ) : null}

      {finished ? (
        <Completion
          session={finished.session}
          xp={finished.xp}
          saved={finished.session.savedForLater}
          call={call}
          onOpenUrl={onOpenUrl}
          onStartOn={(options) => {
            setFinished(null)
            void startOn(options)
          }}
          onAgain={() => {
            setFinished(null)
            setStarting(true)
          }}
          onBreak={() => setFinished(null)}
          onReview={() => {
            setFinished(null)
            setScreen('learn')
          }}
          onClose={() => {
            setFinished(null)
            onClose()
          }}
        />
      ) : null}
    </div>
  )
}
