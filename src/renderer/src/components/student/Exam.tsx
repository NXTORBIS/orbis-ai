import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Check, ListChecks, Play, ShieldCheck, Trophy } from 'lucide-react'
import Challenge, { type ChallengeShape } from './Challenge'
import type { Call } from './useStudent'
import type { NoticeKind } from '../../lib/notices'

/**
 * The run-up to an exam, and working up through a subject.
 *
 * ## Exam mode is a decision, shown as one
 *
 * Orbis does not quietly change what it does because a date is near. The mode is turned on by the student, the
 * screen lists exactly what it changes before they press it, and turning it off is one press — which is why the
 * list ends with "nothing is locked, hidden or refused".
 *
 * ## The countdown is a fact, not a threat
 *
 * Days left, said once, in the same grey as everything else. No red, no "only", no exclamation marks. A student
 * three days out knows perfectly well that it is three days; what they need is which topics are worth those days.
 *
 * ## Stages are suggestions
 *
 * A stage that is not suggested yet still has a button, and says "you can take it now". Nothing in Orbis Student
 * locks a student out of their own material.
 */

interface Stage {
  id: string
  kind: 'chapter' | 'mixed' | 'final'
  chapterIds: string[]
  subject: string
  name: string
  about: string
  unlocked: boolean
  locked: string | null
  passed: boolean
  attempts: number
  bestScore: number | null
  lastAttemptAt: number | null
}

interface Ahead {
  goalId: string
  title: string
  subject: string | null
  day: string
  daysLeft: number
  phase: string
  ready: number | null
  worthDoing: { conceptId: string; name: string; score: number; why: string }[]
  says: string
}

interface After {
  goalId: string
  title: string
  sessions: number
  focusedSeconds: number
  covered: string[]
  notCovered: string[]
  says: string
}

export default function Exam({
  call,
  onStart,
  onNotify
}: {
  call: Call
  onStart(options: { subject: string | null; conceptId: string | null; minutes: number | null; title: string }): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [ahead, setAhead] = useState<Ahead | null>(null)
  const [after, setAfter] = useState<After | null>(null)
  const [settings, setSettings] = useState<{ goalId: string | null; quieter: boolean; longerSessions: boolean }>({ goalId: null, quieter: true, longerSessions: true })
  const [changes, setChanges] = useState<string[]>([])
  const [subjects, setSubjects] = useState<{ subject: string; passed: number; total: number; says: string }[]>([])
  const [openSubject, setOpenSubject] = useState<string | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [test, setTest] = useState<(ChallengeShape & { stageId?: string | null }) | null>(null)
  const [ready, setReady] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const [exam, list] = await Promise.all([
      call<{ ahead: Ahead | null; settings: typeof settings; changes: string[]; after: After | null }>('exam'),
      call<typeof subjects>('subjects-with-stages')
    ])
    setAhead(exam?.ahead ?? null)
    setAfter(exam?.after ?? null)
    setSettings(exam?.settings ?? { goalId: null, quieter: true, longerSessions: true })
    setChanges(exam?.changes ?? [])
    setSubjects(Array.isArray(list) ? list : [])
    setReady(true)
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  const openStages = async (subject: string): Promise<void> => {
    if (openSubject === subject) {
      setOpenSubject(null)
      return
    }
    const out = await call<{ stages: Stage[] }>('stages', subject)
    setStages(out?.stages ?? [])
    setOpenSubject(subject)
  }

  const takeStage = async (stage: Stage): Promise<void> => {
    const out = await call<(ChallengeShape & { stageId?: string | null }) | { ready: false; why: string }>('stage-challenge', stage.id, stage.subject)
    if (out && 'questions' in out) setTest({ ...out, stageId: stage.id })
    else onNotify((out as { why?: string })?.why ?? 'There is not enough of your own material for that one yet.', 'warn')
  }

  const on = settings.goalId !== null

  return (
    <div className="st-exam-page">
      <header className="st-section-head">
        <div>
          <h2>Exams</h2>
          <p className="st-faint">What is coming, what is worth the time left, and how far through each subject you are.</p>
        </div>
      </header>

      {ready && !ahead && !after ? (
        <p className="st-empty big">
          No exam set. Add a goal with a date on it — on the Goals page — and this becomes a countdown, a plan for the
          days left, and a review of it afterwards.
        </p>
      ) : null}

      {/* ---- the day after */}
      {after ? (
        <section className="st-after" aria-label="After the exam">
          <h3>
            <Check size={15} aria-hidden /> {after.title} is done
          </h3>
          {/* What went in, counted. Orbis has no idea how it went and does not ask. */}
          <p>{after.says}</p>
          <div className="st-row-actions">
            <span className="st-faint small">
              {after.covered.length} {after.covered.length === 1 ? 'topic' : 'topics'} studied
              {after.notCovered.length > 0 ? ` · ${after.notCovered.length} never got to` : ''}
            </span>
          </div>
          {after.notCovered.length > 0 ? (
            <details className="st-left-out">
              <summary>What never got covered</summary>
              <ul>
                {after.notCovered.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {on ? (
            <button type="button" className="st-btn" onClick={() => void call('exam-mode', { goalId: null }).then(() => (onNotify('Exam mode off.'), load()))}>
              Turn exam mode off
            </button>
          ) : null}
        </section>
      ) : null}

      {/* ---- the run-up */}
      {ahead && ahead.phase !== 'after' ? (
        <section className="st-ahead" aria-label="The exam ahead">
          <header>
            <div>
              <h3>
                <CalendarClock size={15} aria-hidden /> {ahead.title}
              </h3>
              {/* The number, said once, in the same grey as everything else. */}
              <p className="st-faint">
                {ahead.daysLeft === 0 ? 'Today' : ahead.daysLeft === 1 ? 'Tomorrow' : `${ahead.daysLeft} days away`}
                {ahead.subject ? ` · ${ahead.subject}` : ''}
              </p>
            </div>
            {ahead.ready !== null ? (
              <div className="st-ready">
                <span className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ahead.ready * 100)} aria-label="How much is holding">
                  <span style={{ width: `${ahead.ready * 100}%` }} />
                </span>
                <span className="st-faint small">{Math.round(ahead.ready * 100)}% holding</span>
              </div>
            ) : (
              <span className="st-faint small">Nothing measured yet</span>
            )}
          </header>

          <p className="st-ahead-says">{ahead.says}</p>

          <div className="st-exam-mode">
            <div>
              <strong>
                <ShieldCheck size={14} aria-hidden /> Exam mode {on ? 'is on' : 'is off'}
              </strong>
              <ul className="st-exam-changes">
                {changes.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              className={on ? 'st-btn' : 'st-btn primary'}
              onClick={() =>
                void call('exam-mode', { goalId: on ? null : ahead.goalId }).then(() => {
                  onNotify(on ? 'Exam mode off. Everything back to normal.' : `Exam mode on for ${ahead.title}.`)
                  void load()
                })
              }
            >
              {on ? 'Turn it off' : 'Turn it on'}
            </button>
          </div>

          {ahead.worthDoing.length > 0 ? (
            <>
              <h4>Worth the time left</h4>
              <ul className="st-weak">
                {ahead.worthDoing.map((one) => (
                  <li key={one.conceptId}>
                    <div>
                      <strong>{one.name}</strong>
                      {/* Which rule picked it, so a student can disagree with the ordering. */}
                      <p className="st-faint">{one.why}</p>
                    </div>
                    <div className="st-row-right">
                      <span className="st-faint small">{Math.round(one.score * 100)}%</span>
                      <button
                        type="button"
                        className="st-btn"
                        onClick={() => onStart({ subject: ahead.subject, conceptId: one.conceptId, minutes: 25, title: one.name })}
                      >
                        <Play size={14} aria-hidden /> 25 minutes
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {/* ---- working up through a subject */}
      {subjects.length > 0 ? (
        <section aria-label="How far through each subject">
          <h3>
            <Trophy size={15} aria-hidden /> How far through
          </h3>
          <ul className="st-subject-stages">
            {subjects.map((one) => (
              <li key={one.subject}>
                <button type="button" className="st-tree-row" aria-expanded={openSubject === one.subject} onClick={() => void openStages(one.subject)}>
                  <strong>{one.subject}</strong>
                  <span className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((one.passed / Math.max(1, one.total)) * 100)} aria-label={one.subject}>
                    <span style={{ width: `${(one.passed / Math.max(1, one.total)) * 100}%` }} />
                  </span>
                  <span className="st-faint small">{one.says}</span>
                </button>

                {openSubject === one.subject ? (
                  <ol className="st-stages">
                    {stages.map((stage) => (
                      <li key={stage.id} className={stage.passed ? 'done' : ''}>
                        <div className="st-stage-text">
                          <strong>
                            {stage.name}
                            {stage.passed ? ' ✓' : ''}
                          </strong>
                          <span className="st-faint small">
                            {stage.about}
                            {stage.attempts > 0 ? ` · ${stage.attempts} ${stage.attempts === 1 ? 'go' : 'goes'}` : ''}
                            {stage.bestScore !== null ? ` · best ${Math.round(stage.bestScore * 100)}%` : ''}
                          </span>
                          {/* Not a door: it says why it is not suggested and offers it anyway. */}
                          {stage.locked ? <span className="st-faint small">{stage.locked}</span> : null}
                        </div>
                        <button type="button" className={stage.unlocked && !stage.passed ? 'st-btn primary' : 'st-btn'} onClick={() => void takeStage(stage)}>
                          <ListChecks size={14} aria-hidden /> {stage.passed ? 'Again' : 'Take it'}
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ahead && ahead.ready !== null && ahead.ready > 0 ? (
        <p className="st-faint small">
          {/* The honest reading of the number above it. */}
          Holding means measured — recalled, used or explained. Topics you have not met count as nothing, which is why
          this moves slowly at first.
        </p>
      ) : null}

      {test ? (
        <Challenge
          challenge={test}
          call={call}
          onNotify={(message, kind) => onNotify(message, kind)}
          onDone={async (result) => {
            if (test.stageId) await call('stage-done', test, result.right, test.stageId)
          }}
          onClose={() => {
            setTest(null)
            void load()
            if (openSubject) void openStages(openSubject)
          }}
        />
      ) : null}

    </div>
  )
}
