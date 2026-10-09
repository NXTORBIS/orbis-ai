import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, Lightbulb, RotateCcw, X } from 'lucide-react'
import type { Question } from '../../../../shared/courses/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * Questions, marked.
 *
 * ## Eighty per cent, and failing is never the end
 *
 * The mark is high so passing means something. Everything about what happens *below* it is recovery: what went
 * wrong, why, which concepts to go back over, and a retry with a different paper. The screen never says "failed"
 * — it says not yet, and gives three things to do about it.
 *
 * ## A hint costs something, and the learner is told so
 *
 * Hints come one at a time and are counted. Mastery is worth less when one was used, which is the honest thing to
 * do and is said plainly rather than hidden.
 *
 * ## It is usable from a keyboard
 *
 * Options are real radio and checkbox inputs in a real fieldset, not divs with click handlers.
 */

type Kind = 'quiz' | 'assessment' | 'practice' | 'check'

interface Marked {
  questionId: string
  concept: string
  right: boolean
  given: string
  expected: string
  explanation: string
}

interface Result {
  score: number
  passed: boolean
  asked: number
  right: number
  marked: Marked[]
  weak: string[]
  says: string
}

interface Answer {
  value: number[] | string | number | boolean | null
  hintsUsed: number
  checked?: { right: boolean; explanation: string; expected: string }
}

export default function Quiz({
  courseId,
  scope,
  kind,
  title,
  questions: given,
  only,
  onDone,
  onBack,
  onNotify
}: {
  courseId: string
  scope: string
  kind: Kind
  title: string
  /** Supplied for a check inside a lesson; otherwise the questions are fetched. */
  questions?: Question[]
  /** Narrows supplied questions to these ids. */
  only?: string[]
  onDone(passed: boolean): void
  onBack?(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [startedAt] = useState(() => Date.now())

  const load = useCallback(async () => {
    if (given) {
      setQuestions(only ? given.filter((one) => only.includes(one.id)) : given)
      return
    }
    const out = (await window.api.courses('questions', courseId, kind === 'assessment' ? 'assessment' : 'quiz', scope).catch(() => null)) as Question[] | null
    setQuestions(out ?? [])
  }, [courseId, scope, kind, given, only])

  useEffect(() => {
    void load()
  }, [load])

  const set = (questionId: string, value: Answer['value']): void => {
    setAnswers((held) => ({ ...held, [questionId]: { ...(held[questionId] ?? { hintsUsed: 0 }), value } }))
  }

  const hint = (questionId: string): void => {
    setAnswers((held) => {
      const one = held[questionId] ?? { value: null, hintsUsed: 0 }
      return { ...held, [questionId]: { ...one, hintsUsed: one.hintsUsed + 1 } }
    })
  }

  /** A single answer, marked as it is given. Used for a check inside a lesson and for practice. */
  const checkOne = async (question: Question): Promise<void> => {
    const one = answers[question.id]
    if (!one || one.value === null) return
    setBusy(true)
    const out = (await window.api
      .courses('answer', courseId, { questionId: question.id, value: one.value, hintsUsed: one.hintsUsed, seconds: 0 }, kind === 'check' ? 'lesson' : 'practice')
      .catch(() => null)) as { right: boolean; explanation: string; expected: string; mastery: string } | null
    setBusy(false)
    if (!out) return
    setAnswers((held) => ({ ...held, [question.id]: { ...held[question.id], checked: out } }))
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    const payload = questions.map((one) => ({
      questionId: one.id,
      value: answers[one.id]?.value ?? null,
      hintsUsed: answers[one.id]?.hintsUsed ?? 0,
      seconds: Math.round((Date.now() - startedAt) / 1000 / Math.max(1, questions.length))
    }))
    const out = (await window.api.courses('submit-quiz', courseId, payload, scope).catch(() => null)) as
      | { result: Result; xp: number; recovery: { says: string; actions: { id: string; label: string }[] } | null }
      | null
    setBusy(false)
    if (!out) {
      onNotify('That could not be marked. Nothing was lost — try again.', 'warn')
      return
    }
    setResult(out.result)
    if (out.result.passed) onNotify(out.xp > 0 ? `Passed — ${out.xp} XP.` : 'Passed.')
  }

  const retry = (): void => {
    setResult(null)
    setAnswers({})
    void load()
  }

  // ---------------------------------------------------------------- after marking
  if (result) {
    return (
      <section className="co-quiz co-result" aria-label="Result">
        <h3 className={result.passed ? 'co-good' : undefined}>{result.says}</h3>
        <span className="co-bar big" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(result.score * 100)}>
          <span style={{ width: `${Math.round(result.score * 100)}%` }} />
        </span>

        <ul className="co-marked">
          {result.marked.map((one, index) => (
            <li key={one.questionId} className={one.right ? 'right' : 'wrong'}>
              <span className="co-mark" aria-hidden>
                {one.right ? <Check size={13} /> : <X size={13} />}
              </span>
              <div>
                <strong>Question {index + 1}</strong>
                {!one.right ? (
                  <p className="co-faint">
                    You put {one.given}. The answer is {one.expected}.
                  </p>
                ) : null}
                {/* The explanation is shown either way: it is the part that actually teaches. */}
                {one.explanation ? <p>{one.explanation}</p> : null}
              </div>
            </li>
          ))}
        </ul>

        <div className="co-actions">
          {!result.passed ? (
            <button type="button" className="co-btn primary" onClick={retry}>
              <RotateCcw size={15} aria-hidden /> Try again
            </button>
          ) : null}
          <button type="button" className="co-btn" onClick={() => onDone(result.passed)}>
            {result.passed ? 'Carry on' : 'Back to the lesson'}
          </button>
        </div>
      </section>
    )
  }

  if (questions.length === 0) {
    return (
      <section className="co-quiz" aria-label={title || 'Questions'}>
        <p className="co-empty">There are no questions here yet.</p>
        {onBack ? (
          <button type="button" className="co-btn" onClick={onBack}>
            Back
          </button>
        ) : null}
      </section>
    )
  }

  const answeredAll = questions.every((one) => answers[one.id]?.value !== undefined && answers[one.id]?.value !== null)
  const inline = kind === 'check'

  return (
    <section className="co-quiz" aria-label={title || 'Questions'}>
      {title ? <h3>{title}</h3> : null}
      {!inline ? (
        <p className="co-faint">
          {questions.length} questions. {Math.round(80)}% to pass, and you can retake it.
        </p>
      ) : null}

      {questions.map((question, index) => {
        const one = answers[question.id] ?? { value: null, hintsUsed: 0 }
        const shownHints = question.hints.slice(0, one.hintsUsed)
        return (
          <fieldset key={question.id} className="co-question">
            <legend>
              {!inline ? `${index + 1}. ` : ''}
              {question.prompt}
            </legend>

            {question.kind === 'choice' && question.options ? (
              question.options.map((option, at) => (
                <label key={at} className="co-option">
                  <input
                    type="radio"
                    name={question.id}
                    checked={one.value === at}
                    disabled={Boolean(one.checked)}
                    onChange={() => set(question.id, at)}
                  />
                  <span>{option}</span>
                </label>
              ))
            ) : question.kind === 'multi' && question.options ? (
              question.options.map((option, at) => {
                const chosen = Array.isArray(one.value) ? one.value : []
                return (
                  <label key={at} className="co-option">
                    <input
                      type="checkbox"
                      checked={chosen.includes(at)}
                      disabled={Boolean(one.checked)}
                      onChange={() => set(question.id, chosen.includes(at) ? chosen.filter((two) => two !== at) : [...chosen, at])}
                    />
                    <span>{option}</span>
                  </label>
                )
              })
            ) : question.kind === 'true-false' ? (
              [true, false].map((value) => (
                <label key={String(value)} className="co-option">
                  <input type="radio" name={question.id} checked={one.value === value} disabled={Boolean(one.checked)} onChange={() => set(question.id, value)} />
                  <span>{value ? 'True' : 'False'}</span>
                </label>
              ))
            ) : question.kind === 'number' ? (
              <input
                className="co-input"
                type="number"
                value={typeof one.value === 'number' ? one.value : ''}
                disabled={Boolean(one.checked)}
                onChange={(event) => set(question.id, event.target.value === '' ? null : Number(event.target.value))}
                aria-label="Your answer"
              />
            ) : (
              <textarea
                className="co-input"
                rows={question.kind === 'code' ? 6 : 2}
                value={typeof one.value === 'string' ? one.value : ''}
                disabled={Boolean(one.checked)}
                onChange={(event) => set(question.id, event.target.value.slice(0, 4000))}
                aria-label="Your answer"
              />
            )}

            {shownHints.map((two, at) => (
              <p key={at} className="co-hint">
                <Lightbulb size={13} aria-hidden /> {two}
              </p>
            ))}

            <div className="co-question-foot">
              {question.hints.length > one.hintsUsed && !one.checked ? (
                <button type="button" className="co-btn small quiet" onClick={() => hint(question.id)}>
                  <Lightbulb size={13} aria-hidden /> Hint
                  {/* Said out loud: a hint is allowed and it counts for something. */}
                  <span className="co-faint"> (counts for less)</span>
                </button>
              ) : null}
              {inline && !one.checked ? (
                <button type="button" className="co-btn small" disabled={one.value === null || busy} onClick={() => void checkOne(question)}>
                  Check
                </button>
              ) : null}
            </div>

            {one.checked ? (
              <p className={one.checked.right ? 'co-good' : 'co-warn'}>
                {one.checked.right ? 'Right.' : `Not quite — the answer is ${one.checked.expected}.`} {one.checked.explanation}
              </p>
            ) : null}
          </fieldset>
        )
      })}

      {!inline ? (
        <div className="co-actions">
          {onBack ? (
            <button type="button" className="co-btn" onClick={onBack}>
              <ArrowLeft size={15} aria-hidden /> Back
            </button>
          ) : null}
          <button type="button" className="co-btn primary" disabled={!answeredAll || busy} onClick={() => void submit()}>
            {busy ? 'Marking…' : 'Mark it'}
          </button>
          {!answeredAll ? <span className="co-faint">Answer every question first.</span> : null}
        </div>
      ) : null}
    </section>
  )
}
