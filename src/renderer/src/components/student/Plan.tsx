import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, Clock, FileUp, LifeBuoy, Play, RotateCcw, ScanText, Sparkles, Upload } from 'lucide-react'
import { spell, type Call } from './useStudent'
import { dayLabel, lastDays, shiftDay } from '../../../../shared/student/days'
import type { NoticeKind } from '../../lib/notices'

/**
 * The plan: what there is time for, and what is coming.
 *
 * ## Time comes first, because the planner cannot invent it
 *
 * Orbis knows what needs doing. It cannot know that Thursday is taken. So the first thing on this page is the
 * minutes the student actually has, day by day — and a plan is built to fit them exactly. A planner that guesses
 * availability produces a plan nobody can follow, and after that nobody looks at it.
 *
 * ## What was left out is shown
 *
 * Every day says what did not fit and why. That is the difference between a plan and a backlog: the work that
 * does not fit is visibly let go of rather than silently carried, which is what keeps the next day honest.
 *
 * ## Nothing here is red
 *
 * A missed day is an input to the next plan. There is no failed state, no streak broken, and no colour that means
 * "you did badly".
 */

interface PlanItem {
  id: string
  kind: string
  minutes: number
  subject: string | null
  conceptId: string | null
  title: string
  because: string
  state: string
  forId: string | null
}

interface DayPlan {
  day: string
  items: readonly PlanItem[]
  minutes: number
  leftOut: readonly { title: string; minutes: number; why: string }[]
  note: string
}

interface Dated {
  id: string
  kind: 'exam' | 'deadline'
  title: string
  day: string
  daysLeft: number
  ready: number | null
  note: string
}

/** What Orbis noticed about a line, in the words a person would use. Kept here beside the list that shows it. */
const CLUE_WORDS: Record<string, string> = {
  headed: 'a heading',
  numbered: 'a numbered line',
  bulleted: 'a bullet',
  colon: 'a word before a colon',
  'short-line': 'a short line on its own'
}

const KIND_LABELS: Record<string, string> = {
  learn: 'Learn',
  practice: 'Practice',
  recall: 'Recall',
  revise: 'Revise',
  mistakes: 'Mistakes',
  mock: 'Mock',
  read: 'Read',
  break: 'Break'
}

export default function Plan({
  call,
  onStart,
  onNotify
}: {
  call: Call
  onStart(options: { subject: string | null; conceptId: string | null; minutes: number | null; title: string }): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [days, setDays] = useState<DayPlan[]>([])
  const [radar, setRadar] = useState<Dated[]>([])
  const [availability, setAvailability] = useState<Record<string, number>>({})
  const [editing, setEditing] = useState(false)
  const [syllabus, setSyllabus] = useState('')
  const [importing, setImporting] = useState(false)
  const [recovery, setRecovery] = useState<{ honest: string; covered: number; total: number } | null>(null)
  /** Written help, when Orion is set up: a structure out of a messy document. */
  const [canGenerate, setCanGenerate] = useState(false)
  const [proposed, setProposed] = useState<{ subject: string; chapters: { name: string; topics: string[] }[] } | null>(null)
  /** The week in a sentence or two. Rewording the plan, never changing it. */
  const [described, setDescribed] = useState<string | null>(null)
  /**
   * Topics Orbis thinks it can see in a piece of the student's own material.
   *
   * Nothing here is added until it is ticked. Orbis is only pointing at lines that look like headings, and it says
   * which clue it noticed for each one -- so a wrong guess is visibly a guess rather than a fact in a syllabus.
   */
  const [found, setFound] = useState<{ candidates: readonly { name: string; line: number; clue: string; confidence: number }[]; lines: number; note: string } | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [into, setInto] = useState({ subject: '', chapter: '' })

  const load = useCallback(async (): Promise<void> => {
    const out = await call<{ days: DayPlan[]; radar: Dated[]; availability: Record<string, number> }>('plan', 7)
    setDays(out?.days ?? [])
    setRadar(out?.radar ?? [])
    setAvailability(out?.availability ?? {})
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void call<{ ok: boolean }>('can-generate').then((out) => setCanGenerate(out?.ok === true))
  }, [call])

  const week = useMemo(() => lastDays(Date.now(), 1).concat(Array.from({ length: 7 }, (_, i) => shiftDay(lastDays(Date.now(), 1)[0], i))).slice(1, 8), [])
  const planned = days.reduce((sum, one) => sum + one.minutes, 0)

  const setMinutes = async (day: string, minutes: number): Promise<void> => {
    const next = { ...availability, [day]: Math.max(0, Math.min(960, minutes)) }
    setAvailability(next)
    await call('set-availability', { [day]: next[day] })
    await load()
  }

  const importText = async (): Promise<void> => {
    if (!syllabus.trim()) return
    setImporting(true)
    const out = await call<{ added: number; chapters: number; skipped: string[] }>('import-syllabus', syllabus)
    setImporting(false)
    setSyllabus('')
    if (out) {
      onNotify(
        out.added === 0
          ? 'Nothing new to add — Orbis already had those.'
          : `${out.added} ${out.added === 1 ? 'topic' : 'topics'} added${out.skipped.length > 0 ? `. ${out.skipped.length} could not be placed.` : '.'}`,
        out.skipped.length > 0 ? 'warn' : 'info'
      )
    }
    await load()
  }

  const anyTime = Object.values(availability).some((one) => one > 0)

  return (
    <div className="st-plan-page">
      <header className="st-section-head">
        <div>
          <h2>Plan</h2>
          <p className="st-faint">{anyTime ? `${spell(planned * 60)} planned across the week.` : 'Tell Orbis how much time you have, and it will work out an order.'}</p>
        </div>
        <button type="button" className="st-btn" onClick={() => setEditing((one) => !one)} aria-expanded={editing}>
          <Clock size={15} aria-hidden /> {editing ? 'Done' : 'My time'}
        </button>
      </header>

      {/* Time first. Nothing below here can be planned without it. */}
      {editing || !anyTime ? (
        <section className="st-plan-time" aria-label="How much time you have">
          <h3>How much time have you got?</h3>
          <p className="st-faint small">Minutes per day. Leave a day at zero and Orbis plans nothing for it.</p>
          <ul className="st-plan-days">
            {week.map((day) => (
              <li key={day}>
                <label>
                  <span>{dayLabel(day, Date.now())}</span>
                  <input
                    type="number"
                    min={0}
                    max={960}
                    step={15}
                    value={availability[day] ?? 0}
                    onChange={(e) => void setMinutes(day, Number(e.target.value))}
                    aria-label={`Minutes on ${dayLabel(day, Date.now())}`}
                  />
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {radar.length > 0 ? (
        <section aria-label="What is coming">
          <h3>Coming up</h3>
          <ul className="st-radar">
            {radar.map((one) => (
              <li key={one.id}>
                <span className="st-radar-when">
                  {one.daysLeft === 0 ? 'Today' : one.daysLeft === 1 ? 'Tomorrow' : `${one.daysLeft} days`}
                </span>
                <span className="st-radar-title">
                  {one.kind === 'exam' ? <CalendarClock size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
                  {one.title}
                </span>
                {/* Readiness from the mastery underneath it, never from time spent. */}
                <span className="st-faint small">{one.note}</span>
                {one.ready !== null ? (
                  <span className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(one.ready * 100)} aria-label={`${one.title} readiness`}>
                    <span style={{ width: `${one.ready * 100}%` }} />
                  </span>
                ) : null}
                <button
                  type="button"
                  className="st-btn"
                  onClick={() =>
                    void call<{ honest: string; covered: number; total: number }>('recovery-plan', one.day).then((out) => {
                      setRecovery(out ?? null)
                      void load()
                    })
                  }
                >
                  <LifeBuoy size={14} aria-hidden /> Plan for it
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recovery ? (
        <p className="st-note">
          <LifeBuoy size={15} aria-hidden />
          {/* Said plainly, including when it will not fit. */}
          <span>{recovery.honest}</span>
        </p>
      ) : null}

      <section aria-label="The week">
        <h3>The week</h3>
        {canGenerate && days.some((one) => one.items.length > 0) ? (
          <div className="st-row-actions">
            {described ? (
              <p className="st-note">
                <Sparkles size={15} aria-hidden />
                <span>{described}</span>
              </p>
            ) : (
              <button
                type="button"
                className="st-btn quiet"
                onClick={() =>
                  void call<{ ok: boolean; text?: string; why?: string }>('describe-plan', 7).then((out) => {
                    if (out?.ok && out.text) setDescribed(out.text)
                    else onNotify(out?.why ?? 'Nothing came back.', 'warn')
                  })
                }
              >
                <Sparkles size={14} aria-hidden /> Say it in plain English
              </button>
            )}
          </div>
        ) : null}
        {days.every((one) => one.items.length === 0) ? (
          <p className="view-empty">
            {anyTime
              ? 'Nothing to plan yet. Add a syllabus below, or set a goal, and the days will fill themselves.'
              : 'Set some minutes above and the week will fill itself.'}
          </p>
        ) : (
          <ol className="st-week">
            {days.map((day) => (
              <li key={day.day}>
                <header>
                  <strong>{dayLabel(day.day, Date.now())}</strong>
                  <span className="st-faint small">{day.note}</span>
                  {day.items.some((one) => one.state === 'planned') ? (
                    <button type="button" className="st-link" onClick={() => void call('replan', day.day).then((out) => (onNotify((out as { note?: string })?.note ?? 'Moved.'), load()))}>
                      <RotateCcw size={13} aria-hidden /> Move it
                    </button>
                  ) : null}
                </header>
                {day.items.length === 0 ? (
                  <p className="st-faint small">Nothing planned.</p>
                ) : (
                  <ul className="st-day-items">
                    {day.items.map((one) => (
                      <li key={one.id} className={one.kind === 'break' ? 'break' : ''}>
                        <span className="st-day-minutes">{one.minutes}m</span>
                        <span className="st-day-kind">{KIND_LABELS[one.kind] ?? one.kind}</span>
                        <span className="st-day-title">
                          {one.subject ? <span className="st-faint">{one.subject} · </span> : null}
                          {one.title}
                        </span>
                        <span className="st-faint small st-day-why">{one.because}</span>
                        {one.kind !== 'break' ? (
                          <button
                            type="button"
                            className="st-btn"
                            onClick={() => onStart({ subject: one.subject, conceptId: one.conceptId, minutes: one.minutes, title: one.title })}
                          >
                            <Play size={13} aria-hidden /> Start
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {/* What did not fit, and why. Let go of rather than carried. */}
                {day.leftOut.length > 0 ? (
                  <details className="st-left-out">
                    <summary>
                      {day.leftOut.length} {day.leftOut.length === 1 ? 'thing' : 'things'} did not fit
                    </summary>
                    <ul>
                      {day.leftOut.map((one, index) => (
                        <li key={index}>
                          {one.title} — {one.why}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Your syllabus">
        <h3>Your syllabus</h3>
        <p className="st-faint small">
          Paste or type what you are studying. Indent a chapter under its subject, and a topic under its chapter.
          Orbis adds nothing you did not write.
        </p>
        <textarea
          className="st-syllabus"
          value={syllabus}
          onChange={(e) => setSyllabus(e.target.value.slice(0, 20_000))}
          rows={8}
          placeholder={'Physics\n  Kinematics\n    Velocity\n    Acceleration\n    Projectile motion\n  Forces\n    Newton’s laws'}
          aria-label="Your syllabus"
        />
        <div className="st-row-actions">
          <button type="button" className="st-btn primary" disabled={!syllabus.trim() || importing} onClick={() => void importText()}>
            <Upload size={15} aria-hidden /> {importing ? 'Adding' : 'Add these'}
          </button>
          {/*
            * The same box, read differently: notes rather than an indented list. Orbis finds the lines that look
            * like headings and hands them back to be ticked, and adds nothing on its own.
            */}
          <button
            type="button"
            className="st-btn"
            disabled={!syllabus.trim()}
            onClick={() =>
              void call<typeof found>('topics-in', syllabus).then((out) => {
                setFound(out ?? null)
                setTicked(new Set((out?.candidates ?? []).filter((one) => one.confidence >= 0.8).map((one) => one.name)))
              })
            }
          >
            <ScanText size={15} aria-hidden /> Find the topics in it
          </button>
          {/*
            * The same material, read for its shape rather than its headings.
            *
            * Orbis finds heading-shaped lines by itself; Orion can see that chapter three has four topics under it.
            * Both end in the same place: a list you tick before anything is added.
            */}
          {canGenerate ? (
            <button
              type="button"
              className="st-btn"
              disabled={!syllabus.trim()}
              onClick={() =>
                void call<{ ok: boolean; structure?: typeof proposed; why?: string }>('propose-structure', syllabus).then((out) => {
                  if (out?.ok && out.structure) setProposed(out.structure)
                  else onNotify(out?.why ?? 'Nothing came back.', 'warn')
                })
              }
            >
              <Sparkles size={15} aria-hidden /> Have Orion lay it out
            </button>
          ) : null}
          {/*
            * A file, read on this machine and put in the box.
            *
            * The text lands in the same box somebody could have typed into, so they can see exactly what Orbis
            * read before anything is added -- a PDF that came out as gibberish is obvious rather than silently
            * becoming a syllabus. Nothing is uploaded: the reading happens here.
            */}
          <button
            type="button"
            className="st-btn"
            onClick={() =>
              void window.api
                .pickTextFiles()
                .then((picked) => {
                  const files = picked?.attachments ?? []
                  if (files.length === 0) return
                  const gap = String.fromCharCode(10)
                  const text = files.map((one) => `${one.name}${gap}${one.content}`).join(gap + gap)
                  setSyllabus(text.slice(0, 20_000))
                  setFound(null)
                  onNotify(
                    `Read ${files.length} ${files.length === 1 ? 'file' : 'files'}${(picked?.skipped?.length ?? 0) > 0 ? `, skipped ${picked.skipped.length}` : ''}. Check it looks right, then find the topics in it.`
                  )
                })
                .catch(() => onNotify('That file could not be read.', 'warn'))
            }
          >
            <FileUp size={15} aria-hidden /> Read a file
          </button>
          <button
            type="button"
            className="st-btn quiet"
            onClick={() => {
              setSyllabus('')
              setFound(null)
            }}
            disabled={!syllabus}
          >
            Clear
          </button>
        </div>

        {proposed ? (
          <div className="st-found">
            <p className="st-faint small">
              Orion read it as {proposed.chapters.length} {proposed.chapters.length === 1 ? 'chapter' : 'chapters'} of{' '}
              {proposed.subject}. Nothing is added until you press the button.
            </p>
            <ul className="st-proposed">
              {proposed.chapters.map((chapter) => (
                <li key={chapter.name}>
                  <strong>{chapter.name}</strong>
                  <span className="st-faint small">{chapter.topics.join(' · ') || 'no topics under it'}</span>
                </li>
              ))}
            </ul>
            <div className="st-row-actions">
              <button
                type="button"
                className="st-btn primary"
                onClick={() => {
                  const gap = String.fromCharCode(10)
                  const lines = [proposed.subject]
                  for (const chapter of proposed.chapters) {
                    lines.push(`  ${chapter.name}`)
                    for (const topic of chapter.topics) lines.push(`    ${topic}`)
                  }
                  void call<{ added: number }>('import-syllabus', lines.join(gap)).then((out) => {
                    onNotify(out && out.added > 0 ? `${out.added} topics added.` : 'Nothing new to add — Orbis already had those.')
                    setProposed(null)
                    void load()
                  })
                }}
              >
                Add these
              </button>
              <button type="button" className="st-btn quiet" onClick={() => setProposed(null)}>
                No
              </button>
            </div>
          </div>
        ) : null}

        {found ? (
          <div className="st-found">
            <p className="st-faint small">{found.note}</p>
            {found.candidates.length > 0 ? (
              <>
                <ul className="st-found-list">
                  {found.candidates.map((one) => (
                    <li key={`${one.line}:${one.name}`}>
                      <label className="st-check">
                        <input
                          type="checkbox"
                          checked={ticked.has(one.name)}
                          onChange={(e) =>
                            setTicked((held) => {
                              const next = new Set(held)
                              if (e.target.checked) next.add(one.name)
                              else next.delete(one.name)
                              return next
                            })
                          }
                        />
                        <span>
                          <strong>{one.name}</strong>
                          {/* What Orbis actually noticed, so a wrong guess reads as a guess. */}
                          <span className="st-faint small">
                            {CLUE_WORDS[one.clue] ?? one.clue} · line {one.line}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="st-row-actions">
                  <label className="st-field inline">
                    <span>Subject</span>
                    <input value={into.subject} onChange={(e) => setInto({ ...into, subject: e.target.value.slice(0, 80) })} aria-label="Subject for these topics" placeholder="Physics" />
                  </label>
                  <label className="st-field inline">
                    <span>Chapter</span>
                    <input value={into.chapter} onChange={(e) => setInto({ ...into, chapter: e.target.value.slice(0, 120) })} aria-label="Chapter for these topics" placeholder="Kinematics" />
                  </label>
                  <button
                    type="button"
                    className="st-btn primary"
                    disabled={ticked.size === 0}
                    onClick={() =>
                      void call<{ added: number; skipped: string[] }>('add-topics', into.subject, into.chapter, [...ticked]).then((out) => {
                        onNotify(
                          out && out.added > 0
                            ? `${out.added} ${out.added === 1 ? 'topic' : 'topics'} added.`
                            : 'Nothing new to add — Orbis already had those.'
                        )
                        setFound(null)
                        setTicked(new Set())
                        void load()
                      })
                    }
                  >
                    Add {ticked.size > 0 ? `${ticked.size} ${ticked.size === 1 ? 'topic' : 'topics'}` : 'the ticked ones'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-label="Little time">
        <h3>Very little time?</h3>
        <div className="st-row-actions">
          {[5, 10, 15].map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="st-btn"
              onClick={() =>
                void call<{ items: { title: string; minutes: number; conceptId: string | null; subject: string | null }[]; note: string }>('short-plan', minutes).then((out) => {
                  const first = out?.items?.[0]
                  if (!first) {
                    onNotify(out?.note ?? 'Nothing is due, so a short session would not add much.')
                    return
                  }
                  onStart({ subject: first.subject, conceptId: first.conceptId, minutes, title: first.title })
                })
              }
            >
              <Check size={14} aria-hidden /> {minutes} minutes
            </button>
          ))}
        </div>
        <p className="st-faint small">These keep things alive. They are not a replacement for a real session.</p>
      </section>
    </div>
  )
}
