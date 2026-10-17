import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Coffee, NotebookPen, Sparkles } from 'lucide-react'
import { atTime, clock, spell, type Call } from './useStudent'
import { dayKey, dayLabel, shiftDay } from '../../../../shared/student/days'
import type { DailyRecap, FocusSession, XPEvent } from '../../../../shared/student/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * A day, as it actually went.
 *
 * ## Everything here was recorded, nothing is worked out about the person
 *
 * The counts, the sessions in the order they happened, what each one earned and what the student wrote about it.
 * There is no score for the day and no judgement of it — a quiet day is shown as a quiet day.
 *
 * ## The journal is the student's own words
 *
 * Written after a session, kept with it, and never read by anything that scores them. It exists so somebody can
 * say "that was a slog because I had not eaten" and find it again a fortnight later, which is the sort of thing
 * no measurement catches.
 *
 * ## A rest day is a decision, not a failure
 *
 * Taking one marks the day as deliberate so a streak survives it. It is here next to the record of the day rather
 * than hidden in settings, because that is where somebody is when they decide they are done.
 */

interface Recap extends DailyRecap {
  day: string
}

export default function Day({
  call,
  onNotify
}: {
  call: Call
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [day, setDay] = useState(() => dayKey(Date.now()))
  const [recap, setRecap] = useState<Recap | null>(null)
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [xp, setXp] = useState<XPEvent[]>([])
  const [briefing, setBriefing] = useState<{ title: string; body: string } | null>(null)
  const [writing, setWriting] = useState<{ id: string; text: string } | null>(null)
  const [ready, setReady] = useState(false)

  const today = dayKey(Date.now())
  const isToday = day === today

  const load = useCallback(async (): Promise<void> => {
    const [one, two, three, four] = await Promise.all([
      call<Recap>('day-recap', day),
      call<FocusSession[]>('timeline', day),
      call<XPEvent[]>('xp-history', 400),
      // Morning before the evening is over, the evening summary once the day has something in it.
      call<{ title: string; body: string }>('briefing', new Date().getHours() >= 17 ? 'evening' : 'morning')
    ])
    setRecap(one ?? null)
    setSessions(Array.isArray(two) ? two : [])
    setXp(Array.isArray(three) ? three.filter((event) => dayKey(event.at) === day) : [])
    setBriefing(four ?? null)
    setReady(true)
  }, [call, day])

  useEffect(() => {
    void load()
  }, [load])

  const saveJournal = async (): Promise<void> => {
    if (!writing) return
    await call('journal', writing.id, writing.text)
    setWriting(null)
    onNotify('Saved with that session.')
    await load()
  }

  const restDay = async (): Promise<void> => {
    await call('rest-day')
    onNotify('Marked as a rest day. Your streak keeps going.')
    await load()
  }

  const nothing = ready && (recap?.sessions ?? 0) === 0 && sessions.length === 0

  return (
    <div className="st-day-page">
      <header className="st-section-head">
        <div>
          <h2>
            <CalendarDays size={16} aria-hidden /> {dayLabel(day, Date.now())}
          </h2>
          <p className="st-faint">{isToday ? 'How today has gone so far.' : 'How that day went.'}</p>
        </div>
        <div className="st-row-right">
          <button type="button" className="st-icon" aria-label="The day before" onClick={() => setDay(shiftDay(day, -1))}>
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button type="button" className="st-icon" aria-label="The day after" disabled={isToday} onClick={() => setDay(shiftDay(day, 1))}>
            <ChevronRight size={16} aria-hidden />
          </button>
          {!isToday ? (
            <button type="button" className="st-btn quiet" onClick={() => setDay(today)}>
              Today
            </button>
          ) : null}
        </div>
      </header>

      {/* The briefing, where somebody can actually read it rather than only catching it as a notification. */}
      {isToday && briefing ? (
        <section className="st-briefing" aria-label="Your briefing">
          <strong>
            <Sparkles size={14} aria-hidden /> {briefing.title}
          </strong>
          <p>{briefing.body}</p>
        </section>
      ) : null}

      {recap ? (
        <div className="st-report-figures">
          <div>
            <strong>{spell(recap.focusedSeconds)}</strong>
            <span className="st-faint small">focused</span>
          </div>
          <div>
            <strong>{recap.sessions}</strong>
            <span className="st-faint small">{recap.sessions === 1 ? 'session' : 'sessions'}</span>
          </div>
          <div>
            <strong>{recap.completed}</strong>
            <span className="st-faint small">finished</span>
          </div>
          <div>
            <strong>{recap.tasksCompleted}</strong>
            <span className="st-faint small">{recap.tasksCompleted === 1 ? 'task done' : 'tasks done'}</span>
          </div>
          <div>
            <strong>{recap.learningItems + recap.quizzes}</strong>
            <span className="st-faint small">things reviewed</span>
          </div>
          <div>
            <strong>{recap.xp.toLocaleString()}</strong>
            <span className="st-faint small">XP</span>
          </div>
          {recap.distractionsSaved > 0 ? (
            <div>
              <strong>{recap.distractionsSaved}</strong>
              <span className="st-faint small">put off till later</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {nothing ? (
        <p className="view-empty">
          Nothing recorded for this day.
          {isToday ? ' A day with nothing on it is a day off, which is allowed.' : ''}
        </p>
      ) : null}

      {recap && recap.subjects.length > 0 ? (
        <section className="st-report-subjects" aria-label="Where the time went">
          <h4>Where the time went</h4>
          <ul>
            {recap.subjects.map((one) => (
              <li key={one.subject}>
                <span>{one.subject}</span>
                <span className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((one.seconds / Math.max(1, recap.focusedSeconds)) * 100)} aria-label={one.subject}>
                  <span style={{ width: `${(one.seconds / Math.max(1, recap.focusedSeconds)) * 100}%` }} />
                </span>
                <span className="st-faint small">{spell(one.seconds)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sessions.length > 0 ? (
        <section aria-label="The sessions, in order">
          <h3>What happened, in order</h3>
          <ol className="st-timeline">
            {sessions.map((one) => (
              <li key={one.id} data-state={one.state}>
                <span className="st-timeline-when">{atTime(one.startedAt)}</span>
                <div className="st-timeline-what">
                  <strong>{one.title}</strong>
                  <span className="st-faint small">
                    {clock(one.focusedSeconds)} of {one.plannedMinutes}m
                    {one.subject ? ` · ${one.subject}` : ''}
                    {one.state === 'ended-early' ? ' · ended early' : ''}
                    {one.interruptions > 0 ? ` · ${one.interruptions} ${one.interruptions === 1 ? 'interruption' : 'interruptions'}` : ''}
                    {one.xpAwarded > 0 ? ` · +${one.xpAwarded} XP` : ''}
                  </span>
                  {/* Their own words about it, if there are any. */}
                  {one.journal ? <p className="st-journal">{one.journal}</p> : null}
                </div>
                <button type="button" className="st-btn small" onClick={() => setWriting({ id: one.id, text: one.journal ?? '' })}>
                  <NotebookPen size={14} aria-hidden /> {one.journal ? 'Edit note' : 'Add a note'}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {xp.length > 0 ? (
        <section aria-label="Where the XP came from">
          <h3>Where the XP came from</h3>
          <ul className="st-xp-list">
            {xp.map((one) => (
              <li key={one.id}>
                <span className="st-xp-amount">+{one.amount}</span>
                <span>
                  {one.source.replace(/-/g, ' ')}
                  {one.subject ? ` · ${one.subject}` : ''}
                </span>
                <span className="st-faint small">{atTime(one.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* A rest day, taken deliberately. Only offered for today: yesterday is already whatever it was. */}
      {isToday ? (
        <section aria-label="A day off">
          <h3>Done for today?</h3>
          <p className="st-faint small">
            Taking a rest day on purpose keeps your streak going. It is not the same as forgetting, and Orbis does not
            treat it as one.
          </p>
          <button type="button" className="st-btn" onClick={() => void restDay()}>
            <Coffee size={15} aria-hidden /> Make today a rest day
          </button>
        </section>
      ) : null}

      {writing ? (
        <div className="st-sheet" role="dialog" aria-modal="true" aria-label="A note about that session">
          <div className="st-sheet-card tight">
            <h3>How did that one go?</h3>
            <p className="st-faint small">Your own words, kept with the session. Nothing reads these or scores them.</p>
            <textarea
              className="st-syllabus"
              rows={6}
              value={writing.text}
              onChange={(e) => setWriting({ ...writing, text: e.target.value.slice(0, 2000) })}
              aria-label="A note about that session"
            />
            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={() => void saveJournal()}>
                Save
              </button>
              <button type="button" className="st-btn quiet" onClick={() => setWriting(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
