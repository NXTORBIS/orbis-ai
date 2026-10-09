import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import Orbi from './Orbi'
import { defaultBehaviour } from '../../../../shared/student/orbi'
import type { Call } from './useStudent'

/**
 * The first time somebody opens Orbis Student.
 *
 * Nine screens, one question each, and every one after the name can be skipped. Two things about it matter more than
 * how it looks:
 *
 *   - **The date of birth is explained in one sentence and nothing more.** It decides the browsing protection for
 *     this profile and never leaves it. Over-explaining reads as an apology, which makes it look like the data is
 *     going somewhere.
 *   - **The answers become settings that do something.** Saying "Pomodoro" sets a real default of 25 and 5; saying
 *     "Rain Study" sets the atmosphere a session starts with. An onboarding whose answers are only stored is a form.
 */

const LEARNING = ['School', 'Competitive exams', 'College', 'University', 'Coding', 'Self-learning', 'Professional learning']
const TOWARD = ['JEE', 'NEET', 'Boards', 'University exams', 'Coding', 'Projects', 'Languages']
const STYLES: { id: 'short' | 'pomodoro' | 'long' | 'deep' | 'flexible' | 'unsure'; label: string; blurb: string }[] = [
  { id: 'short', label: 'Short sessions', blurb: 'Twenty-five minutes at a time.' },
  { id: 'pomodoro', label: 'Pomodoro', blurb: 'Twenty-five on, five off, repeated.' },
  { id: 'long', label: 'Long sessions', blurb: 'An hour or more in one go.' },
  { id: 'deep', label: 'Deep work', blurb: 'Fifty minutes, locked, nothing else open.' },
  { id: 'flexible', label: 'It depends', blurb: 'Decide each time.' },
  { id: 'unsure', label: 'Not sure yet', blurb: 'Orbis will suggest from what you finish.' }
]
const ATMOSPHERES: { id: string; label: string; blurb: string }[] = [
  { id: 'minimal', label: 'Minimal', blurb: 'No sound, nothing moving.' },
  { id: 'calm', label: 'Calm', blurb: 'Slow waves.' },
  { id: 'deep-space', label: 'Futuristic', blurb: 'A low rumble under brown noise.' },
  { id: 'cover-voices', label: 'Library', blurb: 'Steady sound for a noisy room.' },
  { id: 'rain-study', label: 'Rain', blurb: 'Rain on a window.' },
  { id: 'night', label: 'Space', blurb: 'Wind and something distant.' }
]

type Answers = {
  name: string
  dob: string
  learning: string[]
  workingToward: string[]
  focusStyle: (typeof STYLES)[number]['id']
  atmosphere: string
}

function Pills({ options, chosen, onToggle }: { options: string[]; chosen: string[]; onToggle(value: string): void }): React.JSX.Element {
  return (
    <div className="st-pills">
      {options.map((one) => {
        const on = chosen.includes(one)
        return (
          <button key={one} type="button" className={`st-pill${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onToggle(one)}>
            {on ? <Check size={14} aria-hidden /> : null}
            {one}
          </button>
        )
      })}
    </div>
  )
}

export default function Onboarding({ call, onDone }: { call: Call; onDone(): void }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [answers, setAnswers] = useState<Answers>({ name: '', dob: '', learning: [], workingToward: [], focusStyle: 'unsure', atmosphere: 'minimal' })

  const toggle = (key: 'learning' | 'workingToward') => (value: string) =>
    setAnswers((held) => ({ ...held, [key]: held[key].includes(value) ? held[key].filter((one) => one !== value) : [...held[key], value] }))

  const finish = async (): Promise<void> => {
    setSaving(true)
    await call('onboard', { ...answers, dob: answers.dob || null })
    setSaving(false)
    onDone()
  }

  const summary = useMemo(() => {
    const style = STYLES.find((one) => one.id === answers.focusStyle)
    const atmosphere = ATMOSPHERES.find((one) => one.id === answers.atmosphere)
    const out: { label: string; value: string }[] = []
    if (answers.name) out.push({ label: 'Name', value: answers.name })
    if (answers.dob) out.push({ label: 'Browsing protection', value: 'Set for your age' })
    if (answers.learning.length) out.push({ label: 'Learning', value: answers.learning.join(', ') })
    if (answers.workingToward.length) out.push({ label: 'Working toward', value: answers.workingToward.join(', ') })
    out.push({ label: 'Sessions', value: style?.label ?? 'Flexible' })
    out.push({ label: 'Atmosphere', value: atmosphere?.label ?? 'Minimal' })
    return out
  }, [answers])

  const steps: { title: string; blurb?: string; body: React.JSX.Element; skippable: boolean; next?: string }[] = [
    {
      title: 'Welcome to Orbis Student',
      blurb: "A study environment inside your browser. Let's set it up — it takes a minute, and you can skip anything.",
      body: (
        <div className="st-onb-hero">
          <Orbi state="ready" behaviour={defaultBehaviour()} reducedMotion={false} size={140} />
        </div>
      ),
      skippable: false,
      next: 'Get started'
    },
    {
      title: "What's your name?",
      blurb: 'So Orbis knows what to call you.',
      body: (
        <label className="st-field">
          <span>Name</span>
          <input value={answers.name} onChange={(e) => setAnswers((held) => ({ ...held, name: e.target.value.slice(0, 60) }))} placeholder="Your name" autoFocus maxLength={60} />
        </label>
      ),
      skippable: true
    },
    {
      title: 'When were you born?',
      // One sentence. Anything longer reads as an excuse.
      blurb: 'This sets age-appropriate browsing protection on this profile. It stays on this computer.',
      body: (
        <label className="st-field">
          <span>Date of birth</span>
          <input type="date" value={answers.dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setAnswers((held) => ({ ...held, dob: e.target.value }))} />
        </label>
      ),
      skippable: true
    },
    {
      title: 'What are you learning?',
      blurb: 'Pick as many as fit.',
      body: <Pills options={LEARNING} chosen={answers.learning} onToggle={toggle('learning')} />,
      skippable: true
    },
    {
      title: 'What are you working toward?',
      blurb: 'You can add your own goals later.',
      body: <Pills options={TOWARD} chosen={answers.workingToward} onToggle={toggle('workingToward')} />,
      skippable: true
    },
    {
      title: 'Meet Orbi',
      blurb: 'Orbi keeps you company while you study. It says very little, stays quiet while you type, and you can turn it off entirely.',
      body: (
        <div className="st-onb-hero">
          <Orbi state="encouraging" behaviour={defaultBehaviour()} reducedMotion={false} size={140} says="Ready when you are." />
        </div>
      ),
      skippable: false
    },
    {
      title: 'How do you like to focus?',
      blurb: 'This sets your default session. You can change it any time.',
      body: (
        <div className="st-choices">
          {STYLES.map((one) => (
            <button
              key={one.id}
              type="button"
              className={`st-choice${answers.focusStyle === one.id ? ' on' : ''}`}
              aria-pressed={answers.focusStyle === one.id}
              onClick={() => setAnswers((held) => ({ ...held, focusStyle: one.id }))}
            >
              <strong>{one.label}</strong>
              <span>{one.blurb}</span>
            </button>
          ))}
        </div>
      ),
      skippable: true
    },
    {
      title: 'Choose your atmosphere',
      blurb: 'Sound and surroundings while you study. Nothing plays until you start a session.',
      body: (
        <div className="st-choices">
          {ATMOSPHERES.map((one) => (
            <button
              key={one.id}
              type="button"
              className={`st-choice${answers.atmosphere === one.id ? ' on' : ''}`}
              aria-pressed={answers.atmosphere === one.id}
              onClick={() => setAnswers((held) => ({ ...held, atmosphere: one.id }))}
            >
              <strong>{one.label}</strong>
              <span>{one.blurb}</span>
            </button>
          ))}
        </div>
      ),
      skippable: true
    },
    {
      title: "You're ready",
      blurb: 'Everything here can be changed in Student Settings.',
      body: (
        <dl className="st-summary">
          {summary.map((one) => (
            <div key={one.label}>
              <dt>{one.label}</dt>
              <dd>{one.value}</dd>
            </div>
          ))}
        </dl>
      ),
      skippable: false,
      next: 'Open Orbis Student'
    }
  ]

  const current = steps[step]
  const last = step === steps.length - 1

  return (
    <div className="st-onb">
      <div className="st-onb-card">
        <div className="st-onb-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, index) => (
            <span key={index} className={index <= step ? 'on' : ''} />
          ))}
        </div>
        <h1>{current.title}</h1>
        {current.blurb ? <p className="st-onb-blurb">{current.blurb}</p> : null}
        <div className="st-onb-body">{current.body}</div>
        <div className="st-onb-foot">
          {step > 0 ? (
            <button type="button" className="st-btn quiet" onClick={() => setStep((one) => one - 1)}>
              <ArrowLeft size={15} aria-hidden /> Back
            </button>
          ) : (
            <span />
          )}
          <div className="st-onb-right">
            {current.skippable && !last ? (
              <button type="button" className="st-btn quiet" onClick={() => setStep((one) => one + 1)}>
                Skip
              </button>
            ) : null}
            <button type="button" className="st-btn primary" disabled={saving} onClick={() => (last ? void finish() : setStep((one) => one + 1))}>
              {current.next ?? 'Continue'}
              {!last ? <ArrowRight size={15} aria-hidden /> : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
