import { useCallback, useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import Report from './Report'
import { atTime, count, onDay, spell, type Call, type Catalogue } from './useStudent'
import type { FocusSession, Goal, Insight, StudentSnapshot, SubjectProgress } from '../../../../shared/student/types'

/**
 * Progress: what actually happened.
 *
 * Every number on this page was counted, and any of them could be checked by hand against the session list. There is
 * no focus score, no productivity rating and no claim about the student -- "you completed four of five sessions this
 * week" is here; "you work better at night" is not, because Orbis does not know that and four data points would not
 * tell it.
 */

type Range = 'week' | 'month' | 'all'

export default function Progress({ snapshot, catalogue, call }: { snapshot: StudentSnapshot; catalogue: Catalogue | null; call: Call }): React.JSX.Element {
  const [range, setRange] = useState<Range>('week')
  const [data, setData] = useState<{ goals: { goal: Goal; progress: { through: number; note: string; milestones: number; milestonesDone: number } }[]; insights: Insight[]; subjects: SubjectProgress[]; sessions: FocusSession[] } | null>(null)
  const [heat, setHeat] = useState<{ day: string; seconds: number }[]>([])
  const [week, setWeek] = useState<{ focusedSeconds: number; sessions: number; completed: number; averageSeconds: number | null; xp: number; tasksCompleted: number; distractionsSaved: number; days: { day: string; seconds: number }[]; bestDay: string | null } | null>(null)
  const [month, setMonth] = useState<{ focusedSeconds: number; sessions: number; completed: number; xp: number; tasksCompleted: number; quizzes: number; bestDay: { day: string; seconds: number } | null; bestSession: FocusSession | null } | null>(null)
  const [chosen, setChosen] = useState<FocusSession | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [one, two, three, four] = await Promise.all([call<typeof data>('progress'), call<typeof heat>('heatmap', 70), call<typeof week>('week-review'), call<typeof month>('month-review')])
    setData(one ?? null)
    setHeat(Array.isArray(two) ? two : [])
    setWeek(three ?? null)
    setMonth(four ?? null)
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  const most = Math.max(1, ...heat.map((one) => one.seconds))
  const sessions = data?.sessions ?? []
  const shown = range === 'all' ? sessions : sessions.filter((one) => one.startedAt > Date.now() - (range === 'week' ? 7 : 31) * 24 * 3600 * 1000)

  return (
    <div className="st-progress">
      <header className="st-section-head">
        <div>
          <h2>Progress</h2>
          <p className="st-faint">
            Level {snapshot.level.level} · {count(snapshot.level.xp)} XP · {spell(snapshot.records.totalFocusedSeconds)} focused in total
          </p>
        </div>
        <div className="st-tabs">
          {(['week', 'month', 'all'] as Range[]).map((one) => (
            <button key={one} type="button" className={`st-tab${range === one ? ' on' : ''}`} aria-pressed={range === one} onClick={() => setRange(one)}>
              {one === 'week' ? 'This week' : one === 'month' ? 'This month' : 'Everything'}
            </button>
          ))}
        </div>
      </header>

      {/* The written report sits above the raw figures: the sentences are what somebody reads, the numbers are what they check. */}
      <Report call={call} />

      <section className="st-summary-grid" aria-label="At a glance">
        <div>
          <span>Level</span>
          <strong>{snapshot.level.level}</strong>
          <small>
            {count(snapshot.level.xp - snapshot.level.from)} / {count(snapshot.level.to - snapshot.level.from)} to the next
          </small>
        </div>
        <div>
          <span>Focused</span>
          <strong>{spell(range === 'week' ? (week?.focusedSeconds ?? 0) : range === 'month' ? (month?.focusedSeconds ?? 0) : snapshot.records.totalFocusedSeconds)}</strong>
          <small>{range === 'all' ? 'since you started' : range === 'week' ? 'this week' : 'this month'}</small>
        </div>
        <div>
          <span>Sessions</span>
          <strong>{range === 'week' ? (week?.sessions ?? 0) : range === 'month' ? (month?.sessions ?? 0) : sessions.length}</strong>
          <small>
            {range === 'week' ? `${week?.completed ?? 0} finished` : range === 'month' ? `${month?.completed ?? 0} finished` : `${sessions.filter((one) => one.state === 'completed').length} finished`}
          </small>
        </div>
        <div>
          <span>Streak</span>
          <strong>{snapshot.streaks.find((one) => one.kind === 'focus')?.current ?? 0}</strong>
          <small>days · longest {snapshot.streaks.find((one) => one.kind === 'focus')?.longest ?? 0}</small>
        </div>
        <div>
          <span>Tasks</span>
          <strong>{range === 'week' ? (week?.tasksCompleted ?? 0) : (month?.tasksCompleted ?? 0)}</strong>
          <small>done</small>
        </div>
        <div>
          <span>Saved for later</span>
          <strong>{week?.distractionsSaved ?? 0}</strong>
          <small>instead of leaving</small>
        </div>
      </section>

      <section aria-label="Study days" data-tour="progress-sky">
        <h3>The last ten weeks</h3>
        <div className="st-heat" role="img" aria-label={`Focus by day. Busiest day: ${spell(most)}.`}>
          {heat.map((one) => (
            <span
              key={one.day}
              className="st-heat-cell"
              data-level={one.seconds === 0 ? 0 : Math.min(4, Math.ceil((one.seconds / most) * 4))}
              title={`${onDay(new Date(`${one.day}T12:00`).getTime())}: ${one.seconds === 0 ? 'nothing' : spell(one.seconds)}`}
            />
          ))}
        </div>
        <p className="st-faint small">Darker is more time focused. Days with nothing are left blank — resting is not a gap to explain.</p>
      </section>

      {week && week.days.length > 0 ? (
        <section aria-label="This week">
          <h3>This week</h3>
          <div className="st-bars">
            {week.days.map((one) => (
              <div key={one.day} className="st-bar-col">
                <div className="st-bar-stack" style={{ height: `${Math.max(4, (one.seconds / Math.max(1, ...week.days.map((x) => x.seconds))) * 100)}%` }} />
                <span className="st-faint small">{new Date(`${one.day}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className="st-faint small">{spell(one.seconds)}</span>
              </div>
            ))}
          </div>
          {week.averageSeconds !== null ? <p className="st-faint">Your completed sessions this week averaged {spell(week.averageSeconds)}.</p> : null}
        </section>
      ) : null}

      {(data?.insights.length ?? 0) > 0 ? (
        <section aria-label="What you did">
          <h3>What you did</h3>
          <ul className="st-insights big">
            {data?.insights.map((one) => (
              <li key={one.id}>{one.text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {(data?.subjects.length ?? 0) > 0 ? (
        <section aria-label="Subjects">
          <h3>Subjects</h3>
          <ul className="st-subject-table">
            {data?.subjects.map((one) => (
              <li key={one.subject}>
                <span>{one.subject}</span>
                <span className="st-faint">
                  {one.sessions} {one.sessions === 1 ? 'session' : 'sessions'}
                </span>
                <span className="st-faint">{one.tasksCompleted} tasks</span>
                <span className="st-faint">{one.conceptsReviewed} reviewed</span>
                <strong>{spell(one.focusedSeconds)}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(data?.goals.length ?? 0) > 0 ? (
        <section aria-label="Goals">
          <h3>Goals</h3>
          <ul className="st-goals">
            {data?.goals.map(({ goal, progress }) => (
              <li key={goal.id}>
                <span>{goal.title}</span>
                <span className="st-faint">{progress.note}</span>
                <div className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.through * 100)} aria-label={goal.title}>
                  <span style={{ width: `${progress.through * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {snapshot.achievements.length > 0 ? (
        <section aria-label="Achievements">
          <h3>Achievements</h3>
          <div className="st-achievements">
            {(catalogue?.achievements ?? []).map((rule) => {
              const got = snapshot.achievements.find((one) => one.achievementId === rule.id)
              return (
                <div key={rule.id} className={`st-achievement${got ? ' on' : ''}`}>
                  <Trophy size={15} aria-hidden />
                  <strong>{rule.title}</strong>
                  <span className="st-faint small">{rule.blurb}</span>
                  <span className="st-faint small">{got ? `Earned ${onDay(got.at)}` : `At ${rule.threshold}`}</span>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <section aria-label="Session history">
        <h3>Sessions</h3>
        {shown.length === 0 ? (
          <p className="st-empty">Nothing in this stretch.</p>
        ) : (
          <ul className="st-history">
            {shown.slice(0, 80).map((one) => (
              <li key={one.id}>
                <button type="button" onClick={() => setChosen(one)}>
                  <span className="st-history-when">
                    {onDay(one.startedAt)} {atTime(one.startedAt)}
                  </span>
                  <span className="st-history-title">{one.title}</span>
                  {one.subject ? <span className="st-faint">{one.subject}</span> : null}
                  <span className="st-faint">{spell(one.focusedSeconds)}</span>
                  <span className={`st-history-state ${one.state}`}>
                    {one.state === 'completed' ? 'finished' : one.state === 'ended-early' ? 'ended early' : one.state === 'expired' ? 'left' : one.state}
                  </span>
                  {one.xpAwarded > 0 ? <span className="st-faint">+{one.xpAwarded}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {chosen ? (
        <div className="st-sheet" role="dialog" aria-label="Session details">
          <div className="st-sheet-card">
            <h3>{chosen.title}</h3>
            <p className="st-faint">
              {onDay(chosen.startedAt)} at {atTime(chosen.startedAt)}
              {chosen.subject ? ` · ${chosen.subject}` : ''}
            </p>
            <dl className="st-complete-stats">
              <div>
                <dt>Planned</dt>
                <dd>{chosen.plannedMinutes}m</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{spell(chosen.focusedSeconds)}</dd>
              </div>
              <div>
                <dt>Finished</dt>
                <dd>{chosen.state === 'completed' ? 'Yes' : 'No'}</dd>
              </div>
              {chosen.xpAwarded > 0 ? (
                <div>
                  <dt>XP</dt>
                  <dd>+{chosen.xpAwarded}</dd>
                </div>
              ) : null}
              {chosen.savedForLater > 0 ? (
                <div>
                  <dt>Saved for later</dt>
                  <dd>{chosen.savedForLater}</dd>
                </div>
              ) : null}
              {chosen.distractionAttempts > 0 ? (
                <div>
                  <dt>Held back</dt>
                  <dd>{chosen.distractionAttempts}</dd>
                </div>
              ) : null}
              {chosen.interruptions > 0 ? (
                <div>
                  <dt>Interruptions</dt>
                  <dd>{chosen.interruptions}</dd>
                </div>
              ) : null}
              {chosen.breakSeconds > 60 ? (
                <div>
                  <dt>Break</dt>
                  <dd>{spell(chosen.breakSeconds)}</dd>
                </div>
              ) : null}
              {chosen.orionTurns > 0 ? (
                <div>
                  <dt>Asked Orion</dt>
                  <dd>
                    {chosen.orionTurns} {chosen.orionTurns === 1 ? 'time' : 'times'}
                  </dd>
                </div>
              ) : null}
            </dl>
            {chosen.intention ? <p className="st-intention">You said: “{chosen.intention}”</p> : null}
            {chosen.journal ? <p>{chosen.journal}</p> : null}
            <div className="st-sheet-foot">
              <button type="button" className="st-btn quiet" onClick={() => setChosen(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
