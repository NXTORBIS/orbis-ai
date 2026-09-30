import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, CalendarClock, Check, Clock, Info, Pause, Play, Plus, SkipForward, Trash2, Zap } from 'lucide-react'
import type { TemporalJob } from '../../../shared/temporal/job'
import { describeAction, describeRecurrence } from '../../../shared/temporal/phrase'
import type { NoticeKind } from '../App'

/**
 * Things Orbis does at a time you chose.
 *
 * The screen is built around one idea: **say what will happen before it is agreed to, and say what happened after.**
 * So a schedule is made by typing a sentence, Orbis reads it back in words with the next few dates it worked out, and
 * nothing is kept until that is confirmed.
 *
 * ## What it will not do
 *
 * **It never implies a schedule runs while the computer is off.** Nothing here does, because there is no Orbis
 * server, and the notice at the top says so rather than leaving people to find out when a reminder never arrives.
 *
 * **It never shows a state that hides a problem.** A schedule waiting on the browser, one blocked because what it
 * named is gone, and one whose moment passed all read differently, because each needs something different from a
 * person.
 *
 * **It never accepts a sentence it did not understand.** A refusal shows the reason, and something Orbis genuinely
 * cannot do shows what it cannot do and the nearest thing it can.
 */

interface Capabilities {
  zone: string
  unsupported: { ask: string; because: string; instead: string | null }[]
  needsThisComputer: boolean
}

type Reading = Awaited<ReturnType<typeof window.api.readSchedulePhrase>>

const EXAMPLES = [
  'remind me to stretch every hour',
  'open news.ycombinator.com every weekday at 8am',
  'remind me to pay rent every month on the 1st at 9am',
  'refresh status.example every 30 minutes only on wifi',
  'remind me to join the standup every weekday at 9am new york time'
]

/** A moment, as somebody would say it. */
const when = (at: number | null): string => {
  if (at === null) return 'nothing more due'
  const gap = at - Date.now()
  if (gap < 0) return 'due now'
  const minutes = Math.round(gap / 60_000)
  if (minutes < 1) return 'in under a minute'
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  const date = new Date(at)
  const clock = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `at ${clock}, in ${hours} hour${hours === 1 ? '' : 's'}`
  return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${clock}`
}

/** What a state means, in words rather than in the word the code uses. */
const stateText = (job: TemporalJob): { text: string; tone: 'ok' | 'waiting' | 'problem' } => {
  switch (job.state) {
    case 'scheduled':
      return { text: when(job.nextRunAt), tone: 'ok' }
    case 'ready':
    case 'running':
      return { text: 'running now', tone: 'ok' }
    case 'retrying':
      return { text: 'it did not work — trying again', tone: 'waiting' }
    case 'waitingForDevice':
      return { text: 'waiting for the browser', tone: 'waiting' }
    case 'waitingForCondition':
      return { text: 'waiting for the conditions you set', tone: 'waiting' }
    case 'blocked':
      return { text: 'needs you — what it opens is gone, or a key is missing', tone: 'problem' }
    case 'completed':
      return { text: 'done', tone: 'ok' }
    case 'failed':
      return { text: 'it did not work', tone: 'problem' }
    case 'missed':
      return { text: 'its moment passed', tone: 'problem' }
    case 'cancelled':
      return { text: 'stopped', tone: 'waiting' }
    case 'paused':
      return { text: 'paused', tone: 'waiting' }
  }
}

export default function SchedulesView({
  onClose,
  onNotify
}: {
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [jobs, setJobs] = useState<TemporalJob[]>([])
  const [phrase, setPhrase] = useState('')
  const [reading, setReading] = useState<Reading | null>(null)
  const [reads, setReads] = useState(false)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [showLimits, setShowLimits] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = async (): Promise<void> => setJobs(await window.api.listSchedules())

  useEffect(() => {
    void load()
    void window.api.scheduleCapabilities().then((c) => setCaps(c))
    return window.api.onSchedulesChanged(() => void load())
  }, [])

  // Read as it is typed, but not on every keystroke: a sentence half-written is refused for the wrong reason.
  useEffect(() => {
    if (phrase.trim().length < 6) {
      setReading(null)
      return
    }
    setReads(true)
    const timer = setTimeout(() => {
      void window.api
        .readSchedulePhrase(phrase)
        .then((result) => setReading(result))
        .finally(() => setReads(false))
    }, 350)
    return () => clearTimeout(timer)
  }, [phrase])

  const keep = async (): Promise<void> => {
    if (!reading?.ok) return
    const result = await window.api.addSchedule({
      name: reading.said.slice(0, 80),
      said: phrase,
      action: reading.action,
      schedule: reading.schedule,
      policies: reading.policies,
      conditions: reading.conditions
    })
    if (!result.ok) {
      onNotify(result.problems[0] ?? 'Orbis could not keep that.', 'error')
      return
    }
    setPhrase('')
    setReading(null)
    onNotify('Kept. Orbis will do it when it is due.')
    await load()
  }

  const live = useMemo(() => jobs.filter((j) => j.state !== 'cancelled'), [jobs])
  const stopped = useMemo(() => jobs.filter((j) => j.state === 'cancelled'), [jobs])

  return (
    <div className="view sched-view" role="region" aria-label="Schedules">
      <header className="view-head">
        <h2>Schedules</h2>
        <div className="view-actions">
          <button type="button" className="icon-btn" aria-label="What Orbis cannot do" onClick={() => setShowLimits((s) => !s)}>
            <Info size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Close schedules" onClick={onClose}>
            <Ban size={15} />
          </button>
        </div>
      </header>

      <div className="sched-body">
        {/*
          Said once, at the top, rather than in small print.
          Somebody who thinks a reminder will arrive with the laptop shut only finds out otherwise after the moment
          has gone, and that is not recoverable.
        */}
        {caps?.needsThisComputer && (
          <p className="sched-truth">
            <AlertTriangle size={13} /> These run on this computer, with Orbis open. If it is closed when one is due,
            Orbis does it the next time you open it and says how late it was.
          </p>
        )}

        {showLimits && caps && (
          <div className="sched-limits">
            <h3>What Orbis cannot do</h3>
            <ul>
              {caps.unsupported.map((item) => (
                <li key={item.ask}>
                  <strong>{item.ask}</strong>
                  <span>{item.because}</span>
                  {item.instead && <em>{item.instead}</em>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="sched-make">
          <label className="sched-say">
            <CalendarClock size={14} />
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && reading?.ok && void keep()}
              placeholder="Say when, and what. “remind me to stretch every hour”"
              aria-label="What Orbis should do, and when"
            />
          </label>

          {!phrase && (
            <div className="sched-examples">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="queue-btn small" onClick={() => setPhrase(example)}>
                  {example}
                </button>
              ))}
            </div>
          )}

          {/* What Orbis understood, before anything is kept. Nothing is saved from this box until it is confirmed. */}
          {reading?.ok && (
            <div className="sched-read">
              <p className="sched-read-said">
                <Check size={14} /> {reading.said}
              </p>
              {reading.assumedTime && <p className="view-muted">No time was given, so Orbis chose one. Say a time to change it.</p>}
              {reading.preview.length > 0 && (
                <p className="view-muted">
                  Next:{' '}
                  {reading.preview
                    .map((o) => new Date(o.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))
                    .join(' · ')}
                </p>
              )}
              {reading.preview.some((o) => o.resolution !== 'exact') && (
                <p className="sched-warn">
                  <AlertTriangle size={13} /> One of those is on a morning the clocks change, so it moves by an hour.
                </p>
              )}
              <button type="button" className="queue-btn primary" onClick={() => void keep()}>
                <Plus size={14} /> Keep this
              </button>
            </div>
          )}

          {reading && !reading.ok && (
            <div className="sched-refused">
              <p>{reading.why}</p>
              {'unsupported' in reading && reading.unsupported?.instead && (
                <p className="view-muted">Orbis can do this instead: {reading.unsupported.instead}</p>
              )}
            </div>
          )}
          {reads && !reading && <p className="view-muted">Reading…</p>}
        </div>

        {live.length === 0 && <p className="view-empty">Nothing is scheduled yet.</p>}

        <ul className="sched-list">
          {live.map((job) => {
            const state = stateText(job)
            const last = job.history[job.history.length - 1]
            return (
              <li key={job.jobId} className={`sched-row sched-${state.tone}`}>
                <button type="button" className="sched-main" onClick={() => setOpen(open === job.jobId ? null : job.jobId)}>
                  <span className="sched-name">{job.name}</span>
                  <span className="sched-rule">
                    {describeAction(job.action)} · {describeRecurrence(job.schedule.recurrence)}
                  </span>
                  <span className="sched-state">
                    <Clock size={12} /> {state.text}
                  </span>
                </button>

                <div className="sched-tools">
                  <button type="button" className="icon-btn" aria-label={`Run ${job.name} now`} onClick={() => void window.api.runScheduleNow(job.jobId).then(load)}>
                    <Zap size={14} />
                  </button>
                  {job.state === 'paused' ? (
                    <button type="button" className="icon-btn" aria-label={`Switch ${job.name} back on`} onClick={() => void window.api.resumeSchedule(job.jobId).then(load)}>
                      <Play size={14} />
                    </button>
                  ) : (
                    <button type="button" className="icon-btn" aria-label={`Pause ${job.name}`} onClick={() => void window.api.pauseSchedule(job.jobId, null).then(load)}>
                      <Pause size={14} />
                    </button>
                  )}
                  {job.nextRunAt !== null && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Skip the next run of ${job.name}`}
                      onClick={() => void window.api.skipNextRun(job.jobId, job.nextRunAt!).then(load)}
                    >
                      <SkipForward size={14} />
                    </button>
                  )}
                  <button type="button" className="icon-btn" aria-label={`Delete ${job.name}`} onClick={() => void window.api.removeSchedule(job.jobId).then(load)}>
                    <Trash2 size={14} />
                  </button>
                </div>

                {open === job.jobId && (
                  <div className="sched-detail">
                    <p className="view-muted">
                      {job.schedule.timeZone} · {job.runsSoFar} {job.runsSoFar === 1 ? 'run' : 'runs'} so far
                      {job.conditions.length > 0 && ` · only ${job.conditions.map((c) => c.kind).join(', ')}`}
                    </p>
                    {job.said && <p className="view-muted">You said: “{job.said}”</p>}
                    {/*
                      What actually happened, including what did not. A list that only shows successes is one nobody
                      can work out a problem from.
                    */}
                    {job.history.length === 0 ? (
                      <p className="view-muted">It has not run yet.</p>
                    ) : (
                      <ul className="sched-history">
                        {[...job.history]
                          .reverse()
                          .slice(0, 8)
                          .map((run) => (
                            <li key={run.executionId}>
                              <span className={`sched-dot sched-dot-${run.state}`} />
                              {new Date(run.startedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                              {' — '}
                              {run.state === 'completed'
                                ? run.detail || 'done'
                                : run.state === 'missed'
                                  ? run.detail || 'its moment passed'
                                  : run.detail || 'it did not work'}
                              {run.attempt > 1 && ` (try ${run.attempt})`}
                            </li>
                          ))}
                      </ul>
                    )}
                    {last && last.state === 'failed' && (
                      <button type="button" className="queue-btn small" onClick={() => void window.api.runScheduleNow(job.jobId).then(load)}>
                        Try it now
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {stopped.length > 0 && (
          <details className="sched-stopped">
            <summary>{stopped.length} stopped</summary>
            <ul className="sched-list">
              {stopped.map((job) => (
                <li key={job.jobId} className="sched-row sched-waiting">
                  <span className="sched-name">{job.name}</span>
                  <button type="button" className="icon-btn" aria-label={`Delete ${job.name}`} onClick={() => void window.api.removeSchedule(job.jobId).then(load)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
