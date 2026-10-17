import { useCallback, useEffect, useState } from 'react'
import { Check, Clock, Play, Shrink, Sparkles, Target } from 'lucide-react'
import type { Call } from './useStudent'
import type { NoticeKind } from '../../lib/notices'

/**
 * A mission: one topic, broken into steps that fit the time there is.
 *
 * ## Why the steps are shaped by what is missing
 *
 * "Revise Kinematics for half an hour" is not a plan, it is a wish. A mission asks what is actually missing for
 * *this* topic — never met it, can follow it but cannot produce it, can produce it but not use it — and makes the
 * steps out of that. So somebody who can recite a definition and cannot use it gets problems, not another read.
 *
 * ## The minutes are real
 *
 * The steps are fitted to the time the student said they have, so the sum is what the button said. A plan that says
 * twenty-five minutes and takes fifty teaches people to ignore the numbers.
 *
 * ## Nothing here invents content
 *
 * A step says what kind of work to do and for how long — "recall what you can with nothing in front of you",
 * "two questions from your own material". Orbis is not writing the questions; the student's own notes, cards and
 * book are the material, which is why the steps are instructions rather than exercises.
 */

interface Step {
  id: string
  kind: string
  label: string
  minutes: number
  proves: string | null
  done: boolean
}

interface Mission {
  id: string
  title: string
  subject: string | null
  conceptId: string | null
  chapterId: string | null
  steps: Step[]
  minutes: number
  because: string
  createdAt: number
  state: string
}

const PROVES: Record<string, string> = {
  recall: 'shows you can bring it back',
  application: 'shows you can use it',
  understanding: 'shows you follow it',
  accuracy: 'shows you can get it right',
  exposure: 'gets you in front of it'
}

const LENGTHS = [10, 25, 45]

export default function Missions({
  call,
  onStart,
  onNotify
}: {
  call: Call
  onStart(options: { subject: string | null; conceptId: string | null; minutes: number | null; title: string }): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [weak, setWeak] = useState<{ conceptId: string; name: string; subject: string | null; why: string }[]>([])
  const [minutes, setMinutes] = useState(25)
  const [mission, setMission] = useState<Mission | null>(null)
  const [micro, setMicro] = useState<Mission | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const [learning, small, concepts] = await Promise.all([
      call<{ weak: { conceptId: string; name: string; subject: string | null; why: string }[] }>('learning'),
      call<Mission>('micro-mission'),
      call<{ id: string; name: string; subject: string | null; measured: unknown }[]>('concepts-with-mastery')
    ])
    const weakest = learning?.weak ?? []
    /*
     * Topics nobody has touched yet count as something to take on.
     *
     * Weakness is measured from evidence, so on the day somebody types in their syllabus there is none of it -- and
     * this screen offered nothing at all, which is the wrong answer for a student whose whole course is sitting
     * there untouched. They are listed after the measured weaknesses and said plainly as not started, never dressed
     * up as a weakness Orbis has observed.
     */
    const known = new Set(weakest.map((one) => one.conceptId))
    const untouched = (Array.isArray(concepts) ? concepts : [])
      .filter((one) => !known.has(one.id) && !one.measured)
      .slice(0, 12)
      .map((one) => ({ conceptId: one.id, name: one.name, subject: one.subject, why: 'Not started yet.' }))
    setWeak([...weakest, ...untouched])
    setMicro(small ?? null)
    setReady(true)
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  const build = async (conceptId: string): Promise<void> => {
    setBusy(true)
    const out = await call<Mission>('mission', conceptId, minutes)
    setBusy(false)
    if (!out) {
      onNotify('Orbis could not put a mission together for that one.', 'warn')
      return
    }
    setMission(out)
  }

  const finishStep = async (step: Step, succeeded: boolean): Promise<void> => {
    if (!mission) return
    const out = await call<{ ok: boolean; mission: Mission }>('mission-step', mission, step.id, succeeded)
    if (out?.mission) setMission(out.mission)
    // The evidence goes to the topic, so what you know is worth re-reading after.
    if (succeeded && step.proves) void load()
  }

  const smaller = async (): Promise<void> => {
    if (!mission) return
    const out = await call<Mission>('smaller-mission', mission)
    if (!out) {
      onNotify('That is already as small as it gets.')
      return
    }
    setMission(out)
    onNotify(`Cut down to ${out.minutes} minutes.`)
  }

  const planned = mission ? mission.steps.reduce((sum, one) => sum + one.minutes, 0) : 0
  const done = mission ? mission.steps.filter((one) => one.done).length : 0

  return (
    <div className="st-missions">
      <header className="st-section-head">
        <div>
          <h2>Missions</h2>
          <p className="st-faint">One topic, broken into steps that fit the time you have.</p>
        </div>
        <div className="st-row-right">
          <span className="st-faint small">
            <Clock size={13} aria-hidden /> How long?
          </span>
          {LENGTHS.map((one) => (
            <button key={one} type="button" className={`st-pill${minutes === one ? ' on' : ''}`} aria-pressed={minutes === one} onClick={() => setMinutes(one)}>
              {one} min
            </button>
          ))}
        </div>
      </header>

      {/* Two minutes, for the days there is no time. Offered first because it is the one people actually do. */}
      {micro ? (
        <section className="st-micro" aria-label="Something small">
          <div>
            <strong>{micro.title}</strong>
            <p className="st-faint small">
              {micro.because} · {micro.minutes} min
            </p>
          </div>
          <button
            type="button"
            className="st-btn"
            onClick={() => onStart({ subject: micro.subject, conceptId: micro.conceptId, minutes: micro.minutes, title: micro.title })}
          >
            <Play size={14} aria-hidden /> Just this
          </button>
        </section>
      ) : null}

      {ready && weak.length === 0 ? (
        <p className="view-empty">
          Nothing is asking for a mission yet. Add your syllabus on the Plan page, or answer a few things, and Orbis
          will know what needs work.
        </p>
      ) : null}

      {weak.length > 0 ? (
        <section aria-label="What to take on">
          <h3>
            <Target size={14} aria-hidden /> What to take on
          </h3>
          <ul className="st-weak">
            {weak.map((one) => (
              <li key={one.conceptId}>
                <div>
                  <strong>{one.name}</strong>
                  <span className="st-faint small">{one.subject ?? ''}</span>
                  {/* The dimension that is missing: it is what decides the shape of the steps. */}
                  <p className="st-faint">{one.why}</p>
                </div>
                <div className="st-row-right">
                  <button type="button" className="st-btn primary" disabled={busy} onClick={() => void build(one.conceptId)}>
                    <Sparkles size={14} aria-hidden /> Make a {minutes}-minute mission
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mission ? (
        <div className="st-sheet" role="dialog" aria-modal="true" aria-label={mission.title}>
          <div className="st-sheet-card">
            <header className="st-challenge-head">
              <div>
                <h3>{mission.title}</h3>
                <p className="st-faint small">
                  {/* The sum is what the button said, and it is shown rather than claimed. */}
                  {mission.because} · {planned} min in {mission.steps.length} steps
                </p>
              </div>
              <button type="button" className="st-icon" aria-label="Close" onClick={() => setMission(null)}>
                ×
              </button>
            </header>

            <ol className="st-steps">
              {mission.steps.map((step) => (
                <li key={step.id} className={step.done ? 'done' : ''}>
                  <span className="st-step-minutes">{step.minutes}m</span>
                  <div className="st-step-text">
                    <strong>{step.label}</strong>
                    {step.proves ? <span className="st-faint small">{PROVES[step.proves] ?? step.proves}</span> : null}
                  </div>
                  {step.done ? (
                    <span className="st-faint small">done</span>
                  ) : (
                    <div className="st-row-right">
                      <button type="button" className="st-btn small primary" onClick={() => void finishStep(step, true)}>
                        <Check size={14} aria-hidden /> Did it
                      </button>
                      {/* Saying it did not go well is recorded too. A mission that only counts the good news measures nothing. */}
                      <button type="button" className="st-btn small" onClick={() => void finishStep(step, false)}>
                        Struggled
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>

            <div className="st-sheet-foot wrap">
              <button
                type="button"
                className="st-btn primary"
                onClick={() => {
                  onStart({ subject: mission.subject, conceptId: mission.conceptId, minutes: planned, title: mission.title })
                  setMission(null)
                }}
              >
                <Play size={15} aria-hidden /> Start {planned} minutes
              </button>
              <button type="button" className="st-btn" onClick={() => void smaller()}>
                <Shrink size={15} aria-hidden /> Make it smaller
              </button>
              <button type="button" className="st-btn quiet" onClick={() => setMission(null)}>
                {done > 0 ? 'Close' : 'Not now'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
