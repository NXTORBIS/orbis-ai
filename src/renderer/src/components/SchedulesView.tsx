import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BatteryCharging, CalendarClock, CalendarDays, Check, Clock, Info, Moon, Pause, Pencil, Play, Plus, SkipForward, Trash2, Zap } from 'lucide-react'
import type { TemporalJob } from '../../../shared/temporal/job'
import { describeAction, describeRecurrence } from '../../../shared/temporal/phrase'
import type { NoticeKind } from '../lib/notices'
import { Button, IconButton, Surface } from '../ui'

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
type Power = Awaited<ReturnType<typeof window.api.schedulePower>>
type Coming = Awaited<ReturnType<typeof window.api.upcomingSchedules>>

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
  const [power, setPower] = useState<Power | null>(null)
  const [showPower, setShowPower] = useState(false)
  const [hibernating, setHibernating] = useState(false)
  const [coming, setComing] = useState<Coming>([])
  const [showComing, setShowComing] = useState(false)
  /** The schedule being edited, and the sentence being retyped for it. */
  const [editing, setEditing] = useState<{ jobId: string; name: string; phrase: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setJobs(await window.api.listSchedules())
    setComing(await window.api.upcomingSchedules(7))
  }

  useEffect(() => {
    void load()
    void window.api.scheduleCapabilities().then((c) => setCaps(c))
    // Read once, since power settings and firmware do not change while somebody is looking at this screen.
    void window.api.schedulePower().then((p) => setPower(p))
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
    <Surface
      className="sched-view"
      title="Schedules"
      closeLabel="Close schedules"
      onClose={onClose}
      actions={
        <>
          <IconButton label="What Orbis cannot do" onClick={() => setShowLimits((s) => !s)}>
            <Info size={15} />
          </IconButton>
          {/*
            `aria-pressed` is passed straight through rather than through `on`, because `on` would also light the
            button, and these two have never been lit. Day one looks the same; what it says is unchanged too.
          */}
          <IconButton label="What is coming" aria-pressed={showComing} onClick={() => setShowComing((s) => !s)}>
            <CalendarDays size={15} />
          </IconButton>
          <IconButton label="Waking this computer" aria-pressed={showPower} onClick={() => setShowPower((s) => !s)}>
            <BatteryCharging size={15} />
          </IconButton>
        </>
      }
    >

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

        {/*
          What this computer can actually be woken from.

          Read from the machine rather than assumed, because the answer is different for a desktop and a laptop, and
          different again depending on settings nobody remembers making. Nothing here changes a setting: where a
          change is needed it is named, and where nothing can change it that is said plainly.
        */}
        {/*
          What is actually coming, across every schedule.

          Worth its own list because a rule read back in words is not the same as seeing that two of them land at
          eight in the morning on Thursday. A run the clocks will move is marked, rather than appearing an hour out.
        */}
        {showComing && (
          <div className="sched-coming">
            <h3>The next seven days</h3>
            {coming.length === 0 ? (
              <p className="view-muted">Nothing is due in the next seven days.</p>
            ) : (
              <ol>
                {coming.map((one) => (
                  <li key={`${one.jobId}-${one.at}`} className={one.paused ? 'sched-coming-paused' : undefined}>
                    <span className="sched-coming-when">
                      {new Date(one.at).toLocaleString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </span>
                    <span className="sched-coming-name">{one.name}</span>
                    {one.paused && <span className="sched-coming-tag">paused</span>}
                    {one.resolution !== 'exact' && (
                      <span className="sched-coming-tag">
                        {one.resolution === 'skipped' ? 'clocks go forward' : 'clocks go back'}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {showPower && power && (
          <div className="sched-power">
            <h3>Waking this computer</h3>
            <p className="view-muted">{power.summary}</p>
            <ul>
              {power.findings.map((finding) => (
                <li key={finding.state} className={`sched-stand-${finding.standing}`}>
                  <span className="sched-stand-dot" />
                  <div>
                    <strong>{finding.title}</strong>
                    <span>{finding.detail}</span>
                    {finding.todo && <em>{finding.todo}</em>}
                  </div>
                </li>
              ))}
            </ul>

            {/*
              The one thing on this screen that does something rather than describing something.

              A hibernated computer can be woken for a schedule; a switched-off one cannot, and nothing in software
              can change that. So this is offered as the alternative to switching off, not as a tidy-up.
            */}
            {power.facts.windows && (
              <div className="sched-power-do">
                {/*
                  `busy` is the half of this the button used to only half-say: it already stopped a second press
                  while hibernating, but nothing announced that it was working. It still says "Hibernate now"
                  either way, because that is what it said before.
                */}
                <Button
                  icon={<Moon size={14} />}
                  busy={hibernating}
                  disabled={power.facts.canHibernate === false}
                  onClick={() => {
                    setHibernating(true)
                    void window.api.hibernateNow().then((result) => {
                      setHibernating(false)
                      if (!result.ok) onNotify(result.detail, 'error')
                    })
                  }}
                >
                  {' '}
                  Hibernate now
                </Button>
                <span className="view-muted">
                  {power.facts.canHibernate === false
                    ? 'Hibernate is switched off on this computer, so Orbis cannot use it.'
                    : 'Everything stays as it is, no power is used, and a schedule can still wake it.'}
                </span>
              </div>
            )}
          </div>
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
                <Button key={example} size="small" onClick={() => setPhrase(example)}>
                  {example}
                </Button>
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
              {/* The margin and the left edge come from `.sched-read .queue-btn`, which still finds this. */}
              <Button kind="primary" icon={<Plus size={14} />} onClick={() => void keep()}>
                {' '}
                Keep this
              </Button>
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
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Change ${job.name}`}
                    onClick={() =>
                      setEditing(editing?.jobId === job.jobId ? null : { jobId: job.jobId, name: job.name, phrase: job.said })
                    }
                  >
                    <Pencil size={14} />
                  </button>
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

                {editing?.jobId === job.jobId && (
                  <div className="sched-edit">
                    <label>
                      <span className="view-muted">Name</span>
                      <input
                        value={editing.name}
                        maxLength={120}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        aria-label={`Name for ${job.name}`}
                      />
                    </label>
                    <label>
                      <span className="view-muted">When, and what</span>
                      <input
                        value={editing.phrase}
                        placeholder={job.said || 'e.g. every weekday at 8am'}
                        onChange={(e) => setEditing({ ...editing, phrase: e.target.value })}
                        aria-label={`When ${job.name} happens`}
                      />
                    </label>

                    {/*
                      Two kinds of change, kept apart.

                      A name is just a name. Changing when or what means reading a sentence again, and that is only
                      applied when it reads cleanly -- otherwise the schedule is left exactly as it was rather than
                      half-changed into something nobody asked for.
                    */}
                    <div className="sched-edit-row">
                      <Button
                        kind="primary"
                        icon={<Check size={14} />}
                        onClick={() => {
                          const phrase = editing.phrase.trim()
                          const rename = editing.name.trim()
                          void (async () => {
                            if (phrase && phrase !== job.said) {
                              const reread = await window.api.readSchedulePhrase(phrase)
                              if (!reread.ok) {
                                onNotify(reread.why, 'error')
                                return
                              }
                              const saved = await window.api.updateSchedule(job.jobId, {
                                name: rename || reread.said.slice(0, 80),
                                action: reread.action,
                                schedule: reread.schedule,
                                conditions: reread.conditions
                              })
                              if (!saved.ok) {
                                onNotify(saved.problems[0] ?? 'Orbis could not change that.', 'error')
                                return
                              }
                              onNotify(`Changed: ${reread.said}`)
                            } else if (rename && rename !== job.name) {
                              const saved = await window.api.updateSchedule(job.jobId, { name: rename })
                              if (!saved.ok) {
                                onNotify(saved.problems[0] ?? 'Orbis could not change that.', 'error')
                                return
                              }
                            }
                            setEditing(null)
                            await load()
                          })()
                        }}
                      >
                        {' '}
                        Save
                      </Button>
                      <Button size="small" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>

                    {/* Snoozing, which is a pause with an end rather than a different idea. */}
                    <div className="sched-edit-row">
                      <span className="view-muted">Snooze</span>
                      {[
                        ['1 hour', 3_600_000],
                        ['Until tomorrow', 86_400_000],
                        ['A week', 7 * 86_400_000]
                      ].map(([label, ms]) => (
                        <Button
                          key={String(label)}
                          size="small"
                          onClick={() => {
                            void window.api.pauseSchedule(job.jobId, Date.now() + Number(ms)).then(() => {
                              setEditing(null)
                              onNotify(`“${job.name}” is paused for ${String(label).toLowerCase()}.`)
                              return load()
                            })
                          }}
                        >
                          {String(label)}
                        </Button>
                      ))}
                    </div>

                    {/* What to do about a run that was missed, and about one that fails. */}
                    {/*
                      The chosen one of each set below keeps `aria-pressed` written out rather than taking the
                      shared `on`. Both say the same thing out loud, but `on` also lights the button with the
                      window's cyan fill, and the chosen setting here is a border and text colour only --
                      `.sched-edit-row .queue-btn[aria-pressed='true']`. Same words, different picture.
                    */}
                    <div className="sched-edit-row">
                      <span className="view-muted">If Orbis was not running</span>
                      {(
                        [
                          ['Run it late', 'runWhenAvailable'],
                          ['Only if recent', 'withinWindow'],
                          ['Let it go', 'skip']
                        ] as const
                      ).map(([label, value]) => (
                        <Button
                          key={value}
                          size="small"
                          aria-pressed={job.policies.missed === value}
                          onClick={() => void window.api.updateSchedule(job.jobId, { policies: { missed: value } }).then(load)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>

                    <div className="sched-edit-row">
                      <span className="view-muted">If several were missed</span>
                      {(
                        [
                          ['Just the last', 'latestOnly'],
                          ['All of them', 'all'],
                          ['None', 'nextOnly']
                        ] as const
                      ).map(([label, value]) => (
                        <Button
                          key={value}
                          size="small"
                          aria-pressed={job.policies.catchUp === value}
                          onClick={() => void window.api.updateSchedule(job.jobId, { policies: { catchUp: value } }).then(load)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>

                    <div className="sched-edit-row">
                      <span className="view-muted">If it does not work</span>
                      {(
                        [
                          ['Try 3 times', 3],
                          ['Try once', 1],
                          ['Do not retry', 0]
                        ] as const
                      ).map(([label, attempts]) => (
                        <Button
                          key={label}
                          size="small"
                          aria-pressed={
                            attempts === 0
                              ? job.policies.retry.kind === 'none'
                              : job.policies.retry.kind === 'backoff' && job.policies.retry.attempts === attempts
                          }
                          onClick={() =>
                            void window.api
                              .updateSchedule(job.jobId, {
                                policies: {
                                  retry: attempts === 0 ? { kind: 'none' } : { kind: 'backoff', attempts, firstDelayMs: 30_000 }
                                }
                              })
                              .then(load)
                          }
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

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
                      <Button size="small" onClick={() => void window.api.runScheduleNow(job.jobId).then(load)}>
                        Try it now
                      </Button>
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
    </Surface>
  )
}
