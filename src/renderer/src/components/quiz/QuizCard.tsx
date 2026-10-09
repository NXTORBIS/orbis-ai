import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, X, ChevronRight, RotateCcw, Trophy, Clock, Info, SkipForward } from 'lucide-react'
import type { ChatQuiz } from '../../../../shared/types'
import { aboutQuizzes } from '../../../../shared/quiz/build'
import { mark, retryOf, howLong, type QuizAnswer } from '../../../../shared/quiz/score'
import './quiz.css'

/**
 * A quiz in the conversation.
 *
 * ## One question at a time, and the answer is shown straight away
 *
 * Showing all ten at once turns a quiz into a form. One at a time means each answer can be marked the moment it
 * is given, with the explanation underneath — which is the part that teaches anything. There is no going back to
 * change an answer, for the same reason an exam does not let you: the mark would stop meaning anything.
 *
 * ## It can be left and come back to
 *
 * Every answer is handed up as it is given and saved with the conversation, so closing Orbis half way through a
 * quiz and opening it again tomorrow carries on from the right question. That is also why the card reads its
 * state from the message rather than keeping its own: there is one copy of how far through you are.
 *
 * ## The end screen counts, it does not estimate
 *
 * Marks, percentage, time, the breakdown by topic and the list of what was missed all come from the answers
 * given. A question passed over counts as wrong, because scoring out of what was attempted would make "I
 * answered the two I knew" into full marks. There is no pass mark and no congratulation on a poor result.
 */

export default function QuizCard({
  held,
  onChange,
  onRetry
}: {
  held: ChatQuiz
  /** Hands the attempt up so it is saved with the conversation. */
  onChange(next: ChatQuiz): void
  /** Starts a second go at the questions that were missed, as a new quiz in the conversation. */
  onRetry?(quiz: ChatQuiz): void
}): React.JSX.Element {
  const { quiz, answers } = held

  /**
   * How many questions have been answered **and** read.
   *
   * The one copy of where somebody is up to. An answer is saved with the conversation the moment it is given, so
   * using `answers.length` to pick the question meant answering one moved the card straight on and the
   * explanation vanished before it could be read. This moves only when the person says they are ready.
   */
  const [moved, setMoved] = useState(() => Math.min(answers.length, quiz.questions.length))
  const [showAbout, setShowAbout] = useState(false)
  const startedAt = useRef(Date.now())
  const options = useRef<(HTMLButtonElement | null)[]>([])

  const at = Math.min(moved, quiz.questions.length)
  const finished = held.finished === true || at >= quiz.questions.length
  const question = quiz.questions[at]
  /** The answer to the question in front of you, if it has been given. Read, never kept twice. */
  const justAnswered: QuizAnswer | null = answers[at] ?? null

  // The clock for this question restarts when the question changes, not when the card re-draws.
  useEffect(() => {
    startedAt.current = Date.now()
  }, [at])

  const answer = useCallback(
    (picked: number | null) => {
      if (justAnswered !== null || question === undefined) return
      const given: QuizAnswer = {
        questionId: question.id,
        picked,
        tookMs: Math.max(0, Date.now() - startedAt.current)
      }
      // Written at `at` rather than pushed, so answering again after coming back cannot leave a gap or a double.
      const next = [...answers]
      next[at] = given
      onChange({ ...held, answers: next })
    },
    [answers, at, held, justAnswered, onChange, question]
  )

  const next = useCallback(() => {
    const after = at + 1
    setMoved(after)
    if (after >= quiz.questions.length) onChange({ ...held, finished: true })
  }, [at, held, onChange, quiz.questions.length])

  // 1 to 5 pick an option, Enter moves on. A quiz you have to reach for the mouse for is slower than it needs
  // to be, and the keys are shown on the options so nobody has to guess.
  useEffect(() => {
    if (finished) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && /^(?:INPUT|TEXTAREA)$/.test(target.tagName)) return
      if (justAnswered === null) {
        const picked = Number(event.key)
        if (Number.isInteger(picked) && picked >= 1 && picked <= (question?.options.length ?? 0)) {
          event.preventDefault()
          answer(picked - 1)
        }
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answer, finished, justAnswered, next, question])

  const marked = useMemo(() => mark(quiz, answers), [answers, quiz])

  if (finished) {
    return (
      <Finished
        held={held}
        onRetry={onRetry}
        onReopen={() => {
          setMoved(0)
          onChange({ ...held, finished: false, answers: [] })
        }}
      />
    )
  }

  if (question === undefined) {
    return <div className="quiz-card quiz-refused">This quiz has no questions left to ask.</div>
  }

  const right = justAnswered !== null && justAnswered.picked === question.answer

  return (
    <section className="quiz-card" aria-label={quiz.title}>
      <header className="quiz-head">
        <div className="quiz-title">
          <strong>{quiz.title}</strong>
          <span>
            Question {at + 1} of {quiz.questions.length}
            {question.topic !== 'General' ? ` · ${question.topic}` : ''}
          </span>
        </div>
        <button
          type="button"
          className="quiz-info"
          aria-label="What this quiz is and is not"
          aria-expanded={showAbout}
          onClick={() => setShowAbout((open) => !open)}
        >
          <Info size={14} aria-hidden />
        </button>
      </header>

      <div className="quiz-bar" role="progressbar" aria-valuenow={at} aria-valuemin={0} aria-valuemax={quiz.questions.length}>
        <span style={{ width: `${(at / quiz.questions.length) * 100}%` }} />
      </div>

      {showAbout && (
        <ul className="quiz-about">
          {aboutQuizzes.map((one) => (
            <li key={one}>{one}</li>
          ))}
        </ul>
      )}

      <p className="quiz-asks">{question.asks}</p>

      <div className="quiz-options" role="group" aria-label="The answers to choose from">
        {question.options.map((option, index) => {
          const picked = justAnswered?.picked === index
          const correct = justAnswered !== null && index === question.answer
          return (
            <button
              key={`${question.id}:${index}`}
              ref={(node) => {
                options.current[index] = node
              }}
              type="button"
              className={`quiz-option${picked ? ' picked' : ''}${correct ? ' correct' : ''}${justAnswered !== null && picked && !correct ? ' wrong' : ''}`}
              disabled={justAnswered !== null}
              onClick={() => answer(index)}
            >
              <kbd>{index + 1}</kbd>
              <span>{option}</span>
              {correct && <Check size={15} aria-hidden />}
              {picked && !correct && <X size={15} aria-hidden />}
            </button>
          )
        })}
      </div>

      {justAnswered === null ? (
        <div className="quiz-foot">
          <span className="quiz-score">
            {at === 0 ? `${quiz.questions.length} questions` : `${marked.right} right of ${at} so far`}
          </span>
          <button type="button" className="quiz-skip" onClick={() => answer(null)}>
            <SkipForward size={13} aria-hidden /> Pass — counts as wrong
          </button>
        </div>
      ) : (
        <div className="quiz-told" aria-live="polite">
          <strong className={right ? 'is-right' : 'is-wrong'}>
            {right ? 'Right.' : justAnswered.picked === null ? 'Passed over.' : 'Not that one.'}
          </strong>
          {!right && <span className="quiz-was"> The answer is “{question.options[question.answer]}”.</span>}
          <p>{question.because}</p>
          <button type="button" className="quiz-next" onClick={next} autoFocus>
            {at + 1 >= quiz.questions.length ? 'See how you did' : 'Next question'} <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      )}
    </section>
  )
}

function Finished({
  held,
  onRetry,
  onReopen
}: {
  held: ChatQuiz
  onRetry?(quiz: ChatQuiz): void
  onReopen(): void
}): React.JSX.Element {
  const marked = useMemo(() => mark(held.quiz, held.answers), [held])
  const again = useMemo(() => retryOf(held.quiz, marked, `${held.quiz.id}_again`, Date.now()), [held, marked])

  return (
    <section className="quiz-card quiz-done" aria-label={`${held.quiz.title} — how you did`}>
      <header className="quiz-head">
        <div className="quiz-title">
          <strong>{held.quiz.title}</strong>
          <span>{held.retryOf ? 'A second go at the ones you missed' : held.quiz.from}</span>
        </div>
      </header>

      <div className="quiz-marks">
        <div className="quiz-big">
          <Trophy size={18} aria-hidden />
          <strong>
            {marked.right}
            <span>/{marked.outOf}</span>
          </strong>
          <em>{marked.percent}%</em>
        </div>
        <ul>
          <li>
            <Clock size={13} aria-hidden /> {howLong(marked.tookMs)}
            {marked.perQuestionMs !== null ? ` · ${howLong(marked.perQuestionMs)} a question` : ''}
          </li>
          {marked.skipped > 0 && <li>{marked.skipped} passed over, counted as wrong</li>}
          {held.quiz.dropped !== undefined && (
            // Said rather than hidden: the quiz asked fewer questions than were written, and why.
            <li>
              {held.quiz.dropped} question{held.quiz.dropped === 1 ? '' : 's'} Orion wrote {held.quiz.dropped === 1 ? 'was' : 'were'} thrown
              away before you saw {held.quiz.dropped === 1 ? 'it' : 'them'} — they could not be answered properly.
            </li>
          )}
        </ul>
      </div>

      <p className="quiz-says">{marked.says}</p>

      {marked.byTopic.length > 1 && (
        <div className="quiz-topics">
          <h4>By topic — weakest first</h4>
          {marked.byTopic.map((one) => (
            <div key={one.topic} className="quiz-topic">
              <span>{one.topic}</span>
              <div className="quiz-topic-bar">
                <span style={{ width: `${one.percent}%` }} />
              </div>
              <em>
                {one.right}/{one.outOf}
              </em>
            </div>
          ))}
        </div>
      )}

      {marked.missed.length > 0 && (
        <div className="quiz-missed">
          <h4>What to go back over</h4>
          {marked.missed.map((one) => (
            <div key={one.question.id} className="quiz-missed-one">
              <p className="quiz-missed-asks">{one.question.asks}</p>
              <p className="quiz-missed-picked">
                {one.pickedText === null ? 'You passed over this one.' : `You said “${one.pickedText}”.`} The answer is{' '}
                <strong>“{one.answerText}”</strong>.
              </p>
              <p className="quiz-missed-why">{one.question.because}</p>
            </div>
          ))}
        </div>
      )}

      <div className="quiz-again">
        {again !== null && onRetry !== undefined && (
          <button
            type="button"
            className="quiz-next"
            onClick={() => onRetry({ quiz: again, answers: [], retryOf: held.quiz.id })}
          >
            <RotateCcw size={14} aria-hidden /> Try the {again.questions.length} you missed
          </button>
        )}
        <button type="button" className="quiz-skip" onClick={onReopen}>
          Start this quiz again
        </button>
      </div>

      <p className="quiz-small">
        These marks are for this attempt. They are not a measurement of what you know — Orbis measures that in
        Student, from work over time.
      </p>
    </section>
  )
}
