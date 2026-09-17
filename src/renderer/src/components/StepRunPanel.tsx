import React, { useEffect, useState } from 'react'
import type { StepRunView } from '../../../shared/stepPlan'
import type { PublicStep } from '../../../shared/stepPlan'

/**
 * What Orbis is doing, step by step, while it is doing it.
 *
 * The rule this screen exists to keep is that nothing here may look finished before it is. A step that has been
 * thought of but not run reads as still to come; one that is running says so; one reaches its tick only when the
 * browser has been looked at and agreed. The words come from the run itself rather than being composed here, so what
 * is on screen cannot drift from what actually happened.
 *
 * When a site asks to verify a person, this is where it is said, plainly and without a button that would answer it.
 * The offer is help reaching the challenge: Orbis brings the tab forward and puts it on screen, and the person does
 * the rest, because the site asked for a person and that is the honest answer.
 */

const MARK: Record<PublicStep['phase'], string> = {
  ready: '○',
  executing: '◐',
  verifying: '◑',
  success: '●',
  retrying: '◌',
  failed: '×',
  waiting: '⏸',
  skipped: '–',
  cancelled: '–'
}

const SAID: Record<PublicStep['phase'], string> = {
  ready: 'still to do',
  executing: 'doing it',
  verifying: 'checking the page',
  success: 'confirmed',
  retrying: 'trying again',
  failed: 'did not work',
  waiting: 'waiting for you',
  skipped: 'skipped',
  cancelled: 'not run'
}

export default function StepRunPanel(): React.JSX.Element | null {
  const [view, setView] = useState<StepRunView | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [small, setSmall] = useState(false)

  useEffect(() => window.api.onStepsChanged((next) => {
    setView(next)
    setRunId(next.session.id)
  }), [])

  if (!view || !runId) return null
  const { session, saying, captcha } = view
  const over = session.status === 'done' || session.status === 'failed' || session.status === 'stopped'
  const done = session.steps.filter((step) => step.phase === 'success').length

  const call = (name: 'pauseSteps' | 'resumeSteps' | 'stopSteps' | 'skipStep' | 'stepsVerified'): void => {
    void window.api[name](runId).then((next) => next && setView(next))
  }

  return (
    <section className={`steprun${small ? ' small' : ''}${over ? ' over' : ''}`} aria-label="What Orbis is doing">
      <header className="steprun-head">
        <span className={`steprun-dot ${session.status}`} aria-hidden="true" />
        <div className="steprun-headings">
          <h3>{session.goal}</h3>
          <p>{saying}</p>
        </div>
        <button type="button" className="steprun-fold" onClick={() => setSmall(!small)} aria-expanded={!small} aria-label={small ? 'Show the steps' : 'Hide the steps'}>
          {small ? '▴' : '▾'}
        </button>
      </header>

      {captcha && (
        // Never a button that answers it. Orbis can bring it to the person; the person answers it.
        <div className="steprun-captcha" role="status">
          <p>{captcha.note ?? 'A site has asked to verify you are a person.'}</p>
          <div className="steprun-captcha-actions">
            <button type="button" onClick={() => void window.api.executeControl({ capability: 'captcha.show', params: {}, target: {}, source: 'user' })}>
              Show me
            </button>
            <button type="button" className="primary" onClick={() => call('stepsVerified')}>
              I have done it
            </button>
            <button type="button" onClick={() => call('skipStep')}>
              Skip
            </button>
          </div>
        </div>
      )}

      {!small && (
        <ol className="steprun-steps">
          {session.steps.map((step) => (
            <li key={step.id} className={`steprun-step ${step.phase}`}>
              <span className="steprun-mark" aria-hidden="true">
                {MARK[step.phase]}
              </span>
              <span className="steprun-what">
                {step.intent}
                {/* Said out loud rather than left to the shape of an icon, which is easy to read as finished. */}
                <em>
                  {SAID[step.phase]}
                  {step.attempts > 1 && step.phase !== 'failed' ? ` · attempt ${step.attempts}` : ''}
                </em>
                {step.phase === 'failed' && (step.error?.message || step.note) && <small>{step.error?.message ?? step.note}</small>}
                {step.phase === 'success' && step.verification?.detail && <small>{step.verification.detail}</small>}
              </span>
            </li>
          ))}
          {!session.steps.length && <li className="steprun-step ready">Working out where to start.</li>}
        </ol>
      )}

      <footer className="steprun-foot">
        {/* Confirmed, not attempted: the count is of steps the browser agreed with. */}
        <span>{done === 1 ? '1 step confirmed' : `${done} steps confirmed`}</span>
        <div className="steprun-actions">
          {over ? (
            <button type="button" onClick={() => setView(null)}>
              Close
            </button>
          ) : (
            <>
              {session.status === 'paused' ? (
                <button type="button" onClick={() => call('resumeSteps')}>
                  Resume
                </button>
              ) : (
                <button type="button" onClick={() => call('pauseSteps')} disabled={session.status === 'waiting'}>
                  Pause
                </button>
              )}
              <button type="button" onClick={() => call('stopSteps')}>
                Stop
              </button>
            </>
          )}
        </div>
      </footer>
    </section>
  )
}
