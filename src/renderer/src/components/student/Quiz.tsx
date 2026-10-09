import { useEffect, useState } from 'react'
import { Check, Flag, Sparkles, X } from 'lucide-react'
import type { Call } from './useStudent'
import type { NoticeKind } from '../../lib/notices'

/**
 * Questions Orion wrote, about one topic.
 *
 * ## Practice, and said to be practice
 *
 * Every question carries "written by Orion" and a way to throw it out. A right answer here records the lighter
 * evidence — it nudges recall rather than claiming it — because nobody checked the question was fair. That is the
 * whole bargain: the student gets unlimited practice, and the measurement stays honest.
 *
 * ## Rejecting is a first-class button, not a complaint form
 *
 * A model will eventually write something wrong or off-course. One press removes it, records it, and it is never
 * asked again — and nothing it touched is kept. Without that button, generated questions would be a slow leak of
 * wrong facts into somebody's revision.
 */

interface Question {
  id: string
  form: 'recall' | 'apply' | 'spot-the-mistake' | 'explain'
  ask: string
  answer: string
  because: string | null
  conceptId: string | null
}

const FORMS: Record<Question['form'], string> = {
  recall: 'From memory',
  apply: 'Use it',
  'spot-the-mistake': 'Find the mistake',
  explain: 'Explain it'
}

export default function Quiz({
  conceptId,
  topic,
  call,
  onClose,
  onNotify
}: {
  conceptId: string
  topic: string
  call: Call
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [at, setAt] = useState(0)
  const [shown, setShown] = useState(false)
  const [right, setRight] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let stopped = false
    void call<{ ok: boolean; questions: Question[]; why?: string }>('quiz-me', conceptId, 6).then((out) => {
      if (stopped) return
      setQuestions(out?.ok ? out.questions : [])
      setWhy(out?.ok ? null : (out?.why ?? 'Nothing came back.'))
    })
    return () => {
      stopped = true
    }
  }, [call, conceptId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const question = questions && !done ? questions[at] : null

  const next = (): void => {
    if (!questions) return
    if (at + 1 >= questions.length) {
      setDone(true)
      return
    }
    setAt(at + 1)
    setShown(false)
  }

  const mark = async (gotIt: boolean): Promise<void> => {
    if (!question) return
    await call('answered-generated', question.conceptId, gotIt, `quiz:${conceptId}`)
    if (gotIt) setRight(right + 1)
    next()
  }

  const reject = async (): Promise<void> => {
    if (!question) return
    await call('reject-question', question.ask, question.conceptId)
    onNotify('Thrown out. That one will not come back.')
    // Nothing is recorded for a rejected question: it may have been the question that was wrong.
    next()
  }

  return (
    <div className="st-sheet" role="dialog" aria-modal="true" aria-label={`Questions about ${topic}`}>
      <div className="st-sheet-card">
        <header className="st-challenge-head">
          <div>
            <h3>{topic}</h3>
            <p className="st-faint small">
              {/* Said on every screen where generated work appears. */}
              <Sparkles size={12} aria-hidden /> Questions written by Orion · practice, not a measurement
            </p>
          </div>
          <button type="button" className="st-icon" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </header>

        {questions === null ? <div className="st-skeleton row" style={{ height: 90 }} /> : null}

        {questions !== null && questions.length === 0 ? (
          <>
            {/* "Not set up" and "it would not write any" are different answers, and this says which. */}
            <p className="st-empty">{why}</p>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={onClose}>
                Right
              </button>
            </div>
          </>
        ) : null}

        {question ? (
          <>
            <div className="st-challenge-progress" aria-hidden>
              <span className="st-bar">
                <span style={{ width: `${((at + 1) / (questions?.length ?? 1)) * 100}%` }} />
              </span>
              <span className="st-faint small">
                {at + 1} of {questions?.length}
              </span>
            </div>

            <p className="st-challenge-from st-faint small">{FORMS[question.form]}</p>
            <p className="st-challenge-ask">{question.ask}</p>

            {shown ? (
              <>
                <p className="st-challenge-answer">{question.answer}</p>
                {question.because ? <p className="st-faint small">{question.because}</p> : null}
                <div className="st-row-actions">
                  <button type="button" className="st-btn primary" onClick={() => void mark(true)}>
                    <Check size={15} aria-hidden /> I had it
                  </button>
                  <button type="button" className="st-btn" onClick={() => void mark(false)}>
                    Not quite
                  </button>
                  {/* Always here, and never buried: a wrong question has to be one press from gone. */}
                  <button type="button" className="st-btn quiet" onClick={() => void reject()}>
                    <Flag size={15} aria-hidden /> That question was wrong
                  </button>
                </div>
              </>
            ) : (
              <div className="st-row-actions">
                <button type="button" className="st-btn primary" onClick={() => setShown(true)}>
                  Show the answer
                </button>
                <button type="button" className="st-btn quiet" onClick={() => void reject()}>
                  <Flag size={15} aria-hidden /> Not about my course
                </button>
              </div>
            )}
          </>
        ) : null}

        {done ? (
          <>
            <p className="st-teach-said">
              {right} of {questions?.length} from memory.
            </p>
            <p className="st-faint small">
              These counted as practice. What moves the mastery map further is your own cards and the chapter tests
              built from them.
            </p>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
