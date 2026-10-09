import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, Clock, Sparkles } from 'lucide-react'
import { spell, type Call } from './useStudent'

/**
 * The week, written out.
 *
 * ## Why the first thing it may say is "not enough yet"
 *
 * Three sessions do not support a sentence about how somebody studies. When the span holds too little, this says so
 * and shows the bare counts instead of a story -- because a confident paragraph built on two sessions is the thing
 * that makes somebody stop believing the rest of the screen.
 *
 * ## Nothing here is a grade
 *
 * Days studied is a count, not a score out of seven. Sessions ended early are counted and left alone. There is no
 * comparison with anybody else and no suggestion that more would have been better.
 */

interface Report {
  span: 'week' | 'month'
  from: string
  to: string
  days: number
  daysStudied: number
  focusedSeconds: number
  sessions: number
  completed: number
  endedEarly: number
  tasksCompleted: number
  xp: number
  bestDay: { day: string; seconds: number } | null
  longestSession: number
  subjects: readonly { subject: string; seconds: number; share: number }[]
  mastered: readonly string[]
  slipping: readonly string[]
  bestHours: readonly number[]
  before: { focusedSeconds: number; sessions: number } | null
  notes: readonly string[]
  thin: boolean
}

const hourWord = (hour: number): string => (hour === 0 ? 'midnight' : hour === 12 ? 'midday' : hour < 12 ? `${hour}am` : `${hour - 12}pm`)

const dateWord = (day: string): string => {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function Report({ call }: { call: Call }): React.JSX.Element {
  const [span, setSpan] = useState<'week' | 'month'>('week')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const out = await call<Report>('report', span)
    setReport(out ?? null)
    setLoading(false)
  }, [call, span])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="st-report" aria-label="Report">
      <header className="st-section-head">
        <div>
          <h3>
            <CalendarRange size={14} aria-hidden /> {span === 'week' ? 'Your week' : 'Your month'}
          </h3>
          {report ? (
            <p className="st-faint small">
              {dateWord(report.from)} – {dateWord(report.to)}
            </p>
          ) : null}
        </div>
        <div className="st-tabs">
          {(['week', 'month'] as const).map((one) => (
            <button key={one} type="button" className={`st-tab${span === one ? ' on' : ''}`} aria-pressed={span === one} onClick={() => setSpan(one)}>
              {one === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
      </header>

      {loading ? <div className="st-skeleton row" /> : null}

      {!loading && report ? (
        <>
          {/* The sentences come first when there are any worth reading, and say so plainly when there are not. */}
          <ul className="st-report-notes">
            {report.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>

          <div className="st-report-figures">
            <div>
              <strong>{spell(report.focusedSeconds)}</strong>
              <span className="st-faint small">focused</span>
            </div>
            <div>
              <strong>{report.sessions}</strong>
              <span className="st-faint small">{report.sessions === 1 ? 'session' : 'sessions'}</span>
            </div>
            <div>
              {/* A count of days, never a score out of the span. */}
              <strong>{report.daysStudied}</strong>
              <span className="st-faint small">{report.daysStudied === 1 ? 'day studied' : 'days studied'}</span>
            </div>
            <div>
              <strong>{report.tasksCompleted}</strong>
              <span className="st-faint small">{report.tasksCompleted === 1 ? 'task done' : 'tasks done'}</span>
            </div>
            <div>
              <strong>{report.xp.toLocaleString()}</strong>
              <span className="st-faint small">XP</span>
            </div>
            {report.longestSession > 0 ? (
              <div>
                <strong>{spell(report.longestSession)}</strong>
                <span className="st-faint small">longest sitting</span>
              </div>
            ) : null}
          </div>

          {report.subjects.length > 0 ? (
            <div className="st-report-subjects">
              <h4>Where the time went</h4>
              <ul>
                {report.subjects.map((one) => (
                  <li key={one.subject}>
                    <span>{one.subject}</span>
                    <span className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(one.share * 100)} aria-label={one.subject}>
                      <span style={{ width: `${one.share * 100}%` }} />
                    </span>
                    <span className="st-faint small">{spell(one.seconds)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Only shown when there were enough sessions for the hours to mean anything. */}
          {report.bestHours.length > 0 ? (
            <p className="st-note">
              <Clock size={15} aria-hidden />
              <span>Most of that time was around {report.bestHours.map(hourWord).join(' and ')}.</span>
            </p>
          ) : null}

          {report.mastered.length > 0 ? (
            <p className="st-note">
              <Sparkles size={15} aria-hidden />
              <span>Holding now: {report.mastered.join(', ')}.</span>
            </p>
          ) : null}

          {report.slipping.length > 0 ? (
            <p className="st-faint small">Worth another look: {report.slipping.join(', ')}.</p>
          ) : null}

          {report.bestDay && !report.thin ? (
            <p className="st-faint small">
              Your longest day was {dateWord(report.bestDay.day)} — {spell(report.bestDay.seconds)}.
            </p>
          ) : null}
        </>
      ) : null}

      {!loading && !report ? <p className="st-empty">That report could not be worked out just now.</p> : null}
    </section>
  )
}
