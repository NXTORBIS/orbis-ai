import React, { useEffect, useRef, useState } from 'react'
import type { SkillMatch, SkillPreview, SkillSettings, SkillView } from '../../../shared/skills'
import type { ActiveWorkflowRun, WorkflowRunSummary } from '../../../shared/workflows'

/** Sent by the orb when a step-by-step request matches saved skills, so the run panel can offer them. */
export const SKILL_OFFER_EVENT = 'orbis:skill-offer'
export interface SkillOfferDetail {
  task: string
  matches: SkillMatch[]
  reuse: SkillSettings['reuse']
}

/**
 * After a step-by-step run finishes well: offer to keep it as a skill, showing exactly what would be kept first.
 *
 * Shown only when the person has switched learning on and the run actually taught something. Saving is theirs to do;
 * "Not now" leaves nothing behind.
 */
export function SaveSkillOffer({ runId }: { runId: string }): React.JSX.Element | null {
  const [preview, setPreview] = useState<SkillPreview | null>(null)
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'dismissed'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    void window.api
      .previewSkill(runId)
      .then((p) => {
        if (!live) return
        setPreview(p)
        setName(p.candidate?.name ?? '')
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [runId])

  if (!preview?.offer || !preview.candidate || state === 'dismissed') return null
  const c = preview.candidate

  if (state === 'saved') {
    return (
      <div className="skill-offer saved" role="status">
        <p>Saved as a skill: “{name || c.name}”. Orion will suggest it when you ask for something like this again.</p>
      </div>
    )
  }

  const save = async (): Promise<void> => {
    setState('saving')
    setError('')
    try {
      await window.api.saveSkill(runId, { name })
      setState('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'It could not be saved.')
      setState('idle')
    }
  }

  return (
    <div className="skill-offer" role="region" aria-label="Save as a skill">
      <p className="skill-offer-q">Save this as a reusable skill?</p>
      {open && (
        <div className="skill-preview">
          <label>
            Name
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <ol>
            {c.steps.map((step, i) => (
              <li key={i}>
                {step.name}
                {step.byYou && <em> · you do this one</em>}
              </li>
            ))}
          </ol>
          {c.inputs.length > 0 && <p className="skill-meta">Asks for: {c.inputs.map((i) => i.label).join(', ')}</p>}
          {c.domains.length > 0 && <p className="skill-meta">Site: {c.domains.join(', ')}</p>}
          {c.permissions.length > 0 && <p className="skill-meta">Uses: {c.permissions.join(', ')}</p>}
          {c.notes.map((note, i) => (
            <p key={i} className="skill-note">
              {note}
            </p>
          ))}
          <p className="skill-meta">Anything that changes something will still ask you before it happens.</p>
        </div>
      )}
      {error && <p className="skill-error">{error}</p>}
      <div className="skill-actions">
        {open ? (
          <button type="button" className="primary" onClick={() => void save()} disabled={state === 'saving'}>
            {state === 'saving' ? 'Saving…' : 'Save skill'}
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => setOpen(true)}>
            Review and save
          </button>
        )}
        <button type="button" onClick={() => setState('dismissed')}>
          Not now
        </button>
      </div>
    </div>
  )
}

const RUN_SAID: Record<string, string> = {
  running: 'Working',
  paused: 'Paused',
  'waiting-confirmation': 'Waiting for you to confirm',
  'waiting-user': 'Waiting for you',
  stopping: 'Stopping',
  stopped: 'Stopped',
  completed: 'Done',
  failed: 'Could not finish'
}

/**
 * A step-by-step request that a saved skill could handle: offered, or used straight away when the person chose that.
 *
 * The skill runs through the workflow engine, which asks before anything consequential, however it was started. If it
 * cannot finish, the choice to plan it fresh is offered rather than taken.
 */
export function SkillSuggestion({ offer, onPlan, onClose }: { offer: SkillOfferDetail; onPlan(task: string): void; onClose(): void }): React.JSX.Element {
  const [views, setViews] = useState<SkillView[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [run, setRun] = useState<ActiveWorkflowRun | null>(null)
  const [summary, setSummary] = useState<WorkflowRunSummary | null>(null)
  const [error, setError] = useState('')
  const [autoTried, setAutoTried] = useState(false)
  const best = offer.matches[0]
  const view = views.find((v) => v.workflow.id === best.workflow.id)
  const missing = view?.workflow.inputs.filter((input) => !input.hasDefault && !values[input.name]?.trim()) ?? []

  useEffect(() => {
    void window.api.listSkills().then(setViews).catch(() => undefined)
  }, [])

  // Listening starts before the skill does: a short skill can finish before its start has even been answered, and a
  // finish nobody was listening for would leave this saying "Working" for ever.
  const heard = useRef<{ updates: Map<string, ActiveWorkflowRun>; finished: Map<string, WorkflowRunSummary> }>({ updates: new Map(), finished: new Map() })
  const current = useRef<string | null>(null)
  useEffect(() => {
    const offs = [
      window.api.onWorkflowRunUpdate((next) => {
        heard.current.updates.set(next.runId, next)
        if (next.runId === current.current) setRun(next)
      }),
      window.api.onWorkflowRunFinished((done) => {
        heard.current.finished.set(done.runId, done)
        if (done.runId === current.current) setSummary(done)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const use = async (): Promise<void> => {
    setError('')
    try {
      const started = await window.api.runSkill(best.workflow.id, values, offer.task)
      current.current = started.runId
      setRun(heard.current.updates.get(started.runId) ?? started)
      const already = heard.current.finished.get(started.runId)
      if (already) setSummary(already)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The skill could not start.')
    }
  }

  // Used without asking only when the person chose that, the match is strong, and nothing needs filling in.
  useEffect(() => {
    if (autoTried || !view || run) return
    setAutoTried(true)
    if (offer.reuse === 'auto' && best.level === 'high' && missing.length === 0) void use()
  }, [view])

  if (run) {
    const s = run.state
    const status = summary?.status ?? s.status
    const over = Boolean(summary)
    return (
      <section className="steprun skillrun" aria-label="Using a saved skill">
        <header className="steprun-head">
          <span className={`steprun-dot ${status === 'completed' ? 'done' : status === 'failed' ? 'failed' : 'running'}`} aria-hidden="true" />
          <div className="steprun-headings">
            <h3>Using saved skill: {best.workflow.name}</h3>
            <p>
              {RUN_SAID[status] ?? status}
              {!over && s.stepCount ? ` · step ${Math.min((s.stepIndex ?? 0) + 1, s.stepCount)} of ${s.stepCount}` : ''}
              {!over && s.currentAction ? ` · ${s.currentAction}` : ''}
            </p>
          </div>
        </header>
        {!over && s.waitingFor && <div className="steprun-captcha" role="status"><p>{s.waitingFor.message}</p></div>}
        {summary?.error && <p className="skill-error">{summary.error.stepLabel ? `“${summary.error.stepLabel}”: ` : ''}{summary.error.message}</p>}
        <footer className="steprun-foot">
          <span>{over ? `${summary!.stepsRun} steps run` : `${s.stepsRun} steps run`}</span>
          <div className="steprun-actions">
            {!over && (s.status === 'waiting-user' || s.status === 'paused') && (
              <button type="button" className="primary" onClick={() => void window.api.controlWorkflowRun(run.runId, 'resume')}>
                Continue
              </button>
            )}
            {!over && (
              <button type="button" onClick={() => void window.api.controlWorkflowRun(run.runId, 'stop')}>
                Stop
              </button>
            )}
            {over && status !== 'completed' && (
              <button type="button" onClick={() => onPlan(offer.task)}>
                Plan it step by step instead
              </button>
            )}
            {over && (
              <button type="button" onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </footer>
      </section>
    )
  }

  return (
    <section className="steprun skillrun" aria-label="A saved skill can do this">
      <header className="steprun-head">
        <span className="steprun-dot paused" aria-hidden="true" />
        <div className="steprun-headings">
          <h3>A saved skill can do this</h3>
          <p>
            {best.workflow.name}
            {best.level === 'medium' ? ' · might fit, check before using' : ''}
          </p>
        </div>
      </header>
      {view && view.workflow.inputs.some((input) => !input.hasDefault) && (
        <div className="skill-preview">
          {view.workflow.inputs
            .filter((input) => !input.hasDefault)
            .map((input) => (
              <label key={input.name}>
                {input.label}
                <input value={values[input.name] ?? ''} onChange={(e) => setValues({ ...values, [input.name]: e.target.value })} />
              </label>
            ))}
        </div>
      )}
      {error && <p className="skill-error">{error}</p>}
      <footer className="steprun-foot">
        <span>{view ? `${view.stats.succeeded} of ${view.stats.runs} runs worked` : ''}</span>
        <div className="steprun-actions">
          <button type="button" className="primary" onClick={() => void use()} disabled={!view || missing.length > 0}>
            Use skill
          </button>
          <button type="button" onClick={() => onPlan(offer.task)}>
            Plan it fresh
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </footer>
    </section>
  )
}
