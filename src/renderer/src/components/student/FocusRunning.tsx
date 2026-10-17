import { useEffect, useRef, useState } from 'react'
import { Coffee, HelpCircle, Lock, Pause, Play, Save, Sparkles, Target, Volume2, X } from 'lucide-react'
import Orbi from './Orbi'
import { atmosphere } from './atmosphere'
import { clock, spell, type Call, type Catalogue } from './useStudent'
import { useSurface } from '../../lib/surfaces'
import { studentSessionSurface } from './studentSurfaces'
import { stageNow } from '../../../../shared/student/orbiAnim'
import type { OrbiState, StudentSnapshot } from '../../../../shared/student/types'
import type { OrbiMoment } from '../../../../shared/student/orbiAnim'
import type { NoticeKind } from '../../lib/notices'

/**
 * A session, while it is running.
 *
 * The timer is the middle of the screen and almost nothing else is. Everything a student might reach for -- the
 * break, the sound, the thought they need to write down, the moment they lose the thread -- is one press from here,
 * because every one of those is a moment where the alternative is leaving.
 *
 * ## The three things this screen is careful about
 *
 * **Leaving is always possible.** Deep Focus asks for a deliberate press and shows the reason the session was
 * started, once. It never shames, never refuses, and the application can always be closed -- a study tool that can
 * trap somebody is not a study tool.
 *
 * **Quick Capture is genuinely quick.** One key, a line of text, gone. The whole feature exists because "I need to
 * buy a laptop" turns into forty minutes of shopping if there is nowhere to put it.
 *
 * **Losing focus is a normal thing that happens.** The reset panel offers the smallest possible next step rather
 * than encouragement, because what works at that moment is making the task smaller.
 */

const BREATHS = 4

export default function FocusRunning({
  snapshot,
  ticking,
  catalogue,
  moment,
  call,
  onOpenOrion,
  onNotify
}: {
  snapshot: StudentSnapshot
  ticking: { elapsed: number; remaining: number; through: number } | null
  catalogue: Catalogue | null
  /**
   * What Orbi should react to.
   *
   * Threaded in rather than worked out here, because during a session this is the only Orbi on screen -- the one
   * in the corner is deliberately hidden. Without it, reaching for a distraction changed nothing a student could
   * see, which is the one reaction that has to land.
   */
  moment: OrbiMoment | null
  call: Call
  onOpenOrion?(prompt: string): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const session = snapshot.session
  const timer = snapshot.timer
  const [panel, setPanel] = useState<'none' | 'reset' | 'leave' | 'capture' | 'breathe'>('none')
  const [capture, setCapture] = useState('')
  const [breath, setBreath] = useState(0)
  const [holding, setHolding] = useState(0)
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const captureBox = useRef<HTMLInputElement>(null)

  const onBreak = timer?.state === 'break'
  const paused = timer?.state === 'paused'
  const recovering = timer?.state === 'recovering'
  const locked = Boolean(session?.policy.locked)

  /** The atmosphere follows the session: it starts with it, stops with it, and is quieter on a break. */
  useEffect(() => {
    if (!session?.atmosphere) return
    const engine = atmosphere()
    const preset = catalogue?.atmospheres.find((one) => one.id === session.atmosphere)
    if (!preset) return
    engine.setVolume(snapshot.preferences.volumes.atmosphere * (onBreak ? 0.5 : 1))
    if (paused || recovering) engine.stopAll()
    else engine.setMix(preset.mix.layers)
    return () => undefined
  }, [session?.atmosphere, catalogue, onBreak, paused, recovering, snapshot.preferences.volumes.atmosphere])

  useEffect(() => {
    return () => atmosphere().stopAll()
  }, [])

  /*
   * What the running session lets Orbis do.
   *
   * Registered here rather than on Student itself because this screen's life *is* the session's life: it is drawn when
   * a session exists and taken away when one does not, which is exactly what the register wants. A session surface
   * that outlived the session would offer "pause" for something that is not running.
   *
   * No controls, and that is the design: a session's policy is snapshotted when it starts and never edited after,
   * which is what makes the blocking worth trusting. What there is here is what a student can really do from this
   * screen, each through the same `student:do` operation its own button calls.
   */
  useSurface(
    studentSessionSurface({
      snapshot: () => snapshot,
      ticking: () => ticking,
      pause: () => call('pause-focus'),
      resume: () => call('resume-focus'),
      startBreak: () => call('start-break'),
      endBreak: () => call('end-break'),
      carryOn: () => call('carry-on'),
      extraMinute: () => call<{ ok: boolean; why?: string; minutes?: number }>('extra-minute'),
      end: (reason) => call<{ ok: boolean }>('end-focus', reason),
      capture: (text) => call('capture', text),
      // Asked of Orbis again: whether a session really paused is the service's answer, not this screen's.
      check: () => call<StudentSnapshot | null>('snapshot')
    })
  )

  // Quick Capture on a key, because its whole value is being faster than opening a tab.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && panel !== 'none') {
        event.preventDefault()
        setPanel('none')
        return
      }
      const typing = event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)
      if (typing) return
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPanel('capture')
        setTimeout(() => captureBox.current?.focus(), 30)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel])

  useEffect(() => {
    if (panel !== 'breathe') return
    setBreath(0)
    const step = setInterval(() => setBreath((one) => one + 1), 4000)
    return () => clearInterval(step)
  }, [panel])

  useEffect(() => {
    if (panel === 'breathe' && breath >= BREATHS) setPanel('none')
  }, [panel, breath])

  const startHold = (): void => {
    if (holdTimer.current) return
    holdTimer.current = setInterval(() => setHolding((one) => one + 100), 100)
  }
  const stopHold = (): void => {
    if (holdTimer.current) clearInterval(holdTimer.current)
    holdTimer.current = null
    setHolding(0)
  }
  useEffect(() => {
    if (holding < 1500) return
    stopHold()
    void leave()
  }, [holding])

  /**
   * One of the session controls, which Orbis is allowed to refuse.
   *
   * Pausing, taking a break and coming back off one all end in a state change the service either makes or declines,
   * and it declines when the move is not a legal one from where the session is -- taking a break while Orbis is
   * still asking whether to carry on after a gap, for instance. Every one of these buttons used to throw that answer
   * away, which is exactly what makes a button look dead: the press lands, nothing happens, and nothing is said. So
   * a refusal is said out loud, in the words of the thing that was being asked for.
   */
  const move = async (op: string, refused: string): Promise<void> => {
    const out = await call<{ ok: boolean }>(op)
    if (!out?.ok) onNotify(refused, 'warn')
  }

  const leave = async (): Promise<void> => {
    const out = await call<{ ok: boolean }>('end-focus', 'ended by the student')
    if (out?.ok) {
      atmosphere().stopAll()
      setPanel('none')
      return
    }
    onNotify('That session could not be ended. It may already have finished.', 'warn')
  }

  const saveThought = async (): Promise<void> => {
    const text = capture.trim()
    // An empty box with a Save button pressed is a person expecting something to happen, so it answers rather than
    // returning in silence and looking broken.
    if (!text) {
      onNotify('Write the thought down first, then press Save.', 'warn')
      captureBox.current?.focus()
      return
    }
    const out = await call<{ ok: boolean }>('capture', text)
    if (!out?.ok) {
      onNotify('That could not be saved. Nothing was written down.', 'warn')
      return
    }
    setCapture('')
    setPanel('none')
    onNotify('Saved. Carry on.')
  }

  if (!session || !timer) {
    return <div className="view-empty">No session is running.</div>
  }

  const orbiState: OrbiState = recovering ? 'recovery' : onBreak ? 'break' : paused ? 'ready' : locked ? 'focus-locked' : 'focused'
  const through = onBreak ? 1 - (timer.breakRemaining ?? 0) / Math.max(1, session.breaks.breakMinutes * 60) : (ticking?.through ?? timer.through)
  const shown = onBreak ? (timer.breakRemaining ?? 0) : (ticking?.remaining ?? timer.remaining)
  const circumference = 2 * Math.PI * 132
  /*
   * Where the session is up to, named.
   *
   * "Next: Deep focus at 33 minutes" is easier to hold on to than "twenty-three minutes remaining", which is the
   * whole point: a long session becomes a handful of short ones.
   */
  const stage = stageNow(ticking?.through ?? timer.through)

  return (
    <div className={`st-focus${locked ? ' locked' : ''}${onBreak ? ' breaking' : ''}`}>
      <header className="st-focus-head">
        <span className="st-focus-tag">
          {locked ? <Lock size={12} aria-hidden /> : null}
          {onBreak ? 'Break' : (catalogue?.levels[session.level]?.label ?? session.level)}
          {locked && !onBreak ? ' · Focus Locked' : ''}
        </span>
        <div className="st-focus-chips">
          <span className="st-chip">+{snapshot.level.xp} XP</span>
          {(snapshot.streaks.find((one) => one.kind === 'focus')?.current ?? 0) > 0 ? <span className="st-chip">🔥 {snapshot.streaks.find((one) => one.kind === 'focus')?.current}</span> : null}
          <span className="st-chip">
            Block {timer.block} of {timer.blocks}
          </span>
        </div>
      </header>

      <div className="st-focus-middle">
        <div className="st-ring-wrap">
          <svg viewBox="0 0 300 300" className="st-ring" aria-hidden>
            <circle cx="150" cy="150" r="132" className="st-ring-track" />
            <circle cx="150" cy="150" r="132" className="st-ring-fill" style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - Math.max(0, Math.min(1, through))) }} />
            {/* The milestones, marked so progress is visible without reading a number. */}
            {[0.25, 0.5, 0.75, 0.9].map((one) => (
              <circle key={one} cx={150 + 132 * Math.cos(2 * Math.PI * one - Math.PI / 2)} cy={150 + 132 * Math.sin(2 * Math.PI * one - Math.PI / 2)} r="3.5" className={through >= one ? 'st-mark on' : 'st-mark'} />
            ))}
          </svg>
          <div className="st-ring-inner">
            {/* The clock a screen reader is told about at a useful interval, not every second. */}
            <strong className="st-time" aria-hidden>
              {clock(shown)}
            </strong>
            <span className="sr-only" role="timer" aria-live="off">
              {spell(shown)} {onBreak ? 'of break remaining' : 'remaining'}
            </span>
            <span className="st-focus-title">{session.title}</span>
            {session.oneThing ? <span className="st-focus-one">{session.oneThing}</span> : null}
            {!onBreak ? (
              <span className="st-stage">
                {stage.name}
                {stage.next ? <span className="st-faint"> · next {stage.next.name} at {clock(Math.round(stage.next.at * timer.plannedSeconds))}</span> : null}
              </span>
            ) : null}
          </div>
        </div>

        <Orbi
          state={orbiState}
          moment={moment}
          behaviour={snapshot.preferences.orbi}
          reducedMotion={snapshot.preferences.reducedMotion}
          worn={snapshot.orbi.worn}
          level={snapshot.level.level}
          size={104}
        />
      </div>

      {recovering ? (
        <div className="st-recover" role="status">
          <p>
            <strong>Orbis was not running for a while.</strong> That time was not counted. {spell(timer.elapsed)} of {spell(timer.plannedSeconds)} is done.
          </p>
          <div className="st-recover-actions">
            <button type="button" className="st-btn primary" onClick={() => void move('carry-on', 'This session could not be picked back up. Finish here instead.')}>
              Carry on
            </button>
            <button type="button" className="st-btn quiet" onClick={() => void leave()}>
              Finish here
            </button>
          </div>
        </div>
      ) : null}

      <footer className="st-focus-foot">
        {onBreak ? (
          <button type="button" className="st-btn primary" onClick={() => void move('end-break', 'The break could not be ended. Check the timer: it may already be running again.')}>
            <Play size={15} aria-hidden /> Back to it
          </button>
        ) : paused ? (
          <button type="button" className="st-btn primary" onClick={() => void move('resume-focus', 'This session could not be started again. It may already be running.')}>
            <Play size={15} aria-hidden /> Resume
          </button>
        ) : (
          <>
            <button type="button" className="st-btn" onClick={() => void move('pause-focus', 'This session could not be paused right now.')}>
              <Pause size={15} aria-hidden /> Pause
            </button>
            {/*
              * The break, offered only while the session is actually running.
              *
              * While Orbis is asking whether to carry on after a gap, a break is not a move the session can make, so
              * the button was there and did nothing. The recovery panel above is the only thing to answer at that
              * point, and it offers the break itself once the session is going again.
              */}
            {!recovering ? (
              <button type="button" className="st-btn" onClick={() => void move('start-break', 'A break could not be started right now.')}>
                <Coffee size={15} aria-hidden /> Break
              </button>
            ) : null}
          </>
        )}
        <button type="button" className="st-btn" onClick={() => setPanel('capture')}>
          <Save size={15} aria-hidden /> Quick capture
        </button>
        <button type="button" className="st-btn" onClick={() => setPanel('reset')}>
          <HelpCircle size={15} aria-hidden /> I&apos;m losing focus
        </button>
        <span className="st-focus-spacer" />
        {session.atmosphere ? (
          <span className="st-chip">
            <Volume2 size={13} aria-hidden /> {catalogue?.atmospheres.find((one) => one.id === session.atmosphere)?.label ?? 'Atmosphere'}
          </span>
        ) : null}
        {session.playlistId ? (
          <span className="st-chip">
            Music
          </span>
        ) : null}
        {snapshot.canExtend ? (
          <button
            type="button"
            className="st-btn"
            onClick={() => {
              void call<{ ok: boolean; why?: string }>('extra-minute').then((out) => {
                if (out?.ok) onNotify('One more minute.')
                else if (out?.why) onNotify(out.why, 'warn')
              })
            }}
          >
            One more minute
          </button>
        ) : null}
        <button type="button" className="st-btn quiet" onClick={() => setPanel('leave')}>
          End session
        </button>
      </footer>

      {snapshot.record && !onBreak ? (
        <p className="st-record" role="status">
          {snapshot.record.beaten ? `That is ${snapshot.record.what} beaten.` : `${spell(snapshot.record.inSeconds)} from ${snapshot.record.what}.`}
        </p>
      ) : null}

      {snapshot.waiting > 0 ? (
        <p className="st-focus-saved">
          {snapshot.waiting} {snapshot.waiting === 1 ? 'thing' : 'things'} saved for later.
        </p>
      ) : null}

      {panel === 'capture' ? (
        <div className="st-sheet" role="dialog" aria-label="Quick capture">
          <div className="st-sheet-card tight">
            <p className="st-faint">Write it down and carry on. It will be waiting afterwards.</p>
            <input
              ref={captureBox}
              value={capture}
              onChange={(e) => setCapture(e.target.value.slice(0, 1000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveThought()
              }}
              placeholder="Buy a laptop charger"
              aria-label="What you want to write down"
              autoFocus
            />
            <div className="st-sheet-foot">
              <button type="button" className="st-btn quiet" onClick={() => setPanel('none')}>
                Cancel
              </button>
              <button type="button" className="st-btn primary" onClick={() => void saveThought()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {panel === 'reset' ? (
        <div className="st-sheet" role="dialog" aria-label="Reset">
          <div className="st-sheet-card">
            <h3>That happens. Pick one.</h3>
            <div className="st-reset-list">
              <button type="button" onClick={() => setPanel('breathe')}>
                <strong>Thirty seconds of nothing</strong>
                <span>Breathe. The timer keeps going.</span>
              </button>
              {session.oneThing || session.intention ? (
                <button type="button" onClick={() => setPanel('none')}>
                  <strong>
                    <Target size={14} aria-hidden /> {session.oneThing || session.intention}
                  </strong>
                  <span>That is the one thing. Start with the smallest part of it.</span>
                </button>
              ) : null}
              {onOpenOrion ? (
                <button
                  type="button"
                  onClick={() => {
                    void call('orion-turn')
                    onOpenOrion(
                      `I am stuck while studying ${session.subject || session.title}. The task is: ${session.oneThing || session.title}. Ask me what is confusing, then explain the smallest prerequisite, give one example, and give me one small thing to try.`
                    )
                    setPanel('none')
                  }}
                >
                  <strong>
                    <Sparkles size={14} aria-hidden /> Get unstuck with Orion
                  </strong>
                  <span>It asks what is confusing, explains one step, and gives you something small to try.</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void move('start-break', 'A break could not be started right now.')
                  setPanel('none')
                }}
              >
                <strong>Take the break now</strong>
                <span>Stand up. Come back.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPanel('none')
                  onNotify('Still going. One small step.')
                }}
              >
                <strong>Carry on</strong>
                <span>Back to it.</span>
              </button>
            </div>
            <button type="button" className="st-btn quiet" onClick={() => setPanel('none')}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {panel === 'breathe' ? (
        <div className="st-sheet breathe" role="dialog" aria-label="Breathing reset">
          <div className="st-breathe">
            <div className={`st-breathe-orb${snapshot.preferences.reducedMotion ? ' still' : ''}`} />
            <p>{breath % 2 === 0 ? 'Breathe in' : 'Breathe out'}</p>
            <span className="st-faint">
              {BREATHS - breath} to go · the timer is still running
            </span>
            <button type="button" className="st-btn quiet" onClick={() => setPanel('none')}>
              Back to it
            </button>
          </div>
        </div>
      ) : null}

      {panel === 'leave' ? (
        <div className="st-sheet" role="dialog" aria-label="End session">
          <div className="st-sheet-card">
            <h3>{clock(ticking?.remaining ?? timer.remaining)} left of this session.</h3>
            {/* Shown once, here, and nowhere else. It is a reminder, not a lever. */}
            {session.intention ? <p className="st-intention">You said: “{session.intention}”</p> : null}
            <p className="st-faint">Ending now keeps the {spell(ticking?.elapsed ?? timer.elapsed)} you have done.</p>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={() => setPanel('none')}>
                Keep going
              </button>
              {locked ? (
                <button
                  type="button"
                  className={`st-btn hold${holding > 0 ? ' holding' : ''}`}
                  style={{ ['--held' as string]: `${Math.min(100, (holding / 1500) * 100)}%` }}
                  onPointerDown={startHold}
                  onPointerUp={stopHold}
                  onPointerLeave={stopHold}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') startHold()
                  }}
                  onKeyUp={stopHold}
                >
                  <X size={15} aria-hidden /> Hold to end
                </button>
              ) : (
                <button type="button" className="st-btn quiet" onClick={() => void leave()}>
                  End session
                </button>
              )}
            </div>
            <p className="st-faint small">You can always close Orbis. The session will be here when you come back.</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
