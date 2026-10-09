import { useEffect, useState } from 'react'
import { Check, Eye, X } from 'lucide-react'
import Hints from './Hints'
import TeachBack from './TeachBack'
import type { Call } from './useStudent'

/**
 * A chapter test, made of the student's own cards and mistakes.
 *
 * ## Self-marked, on purpose
 *
 * Orbis shows the question, the student thinks, then reveals their own answer and says whether they had it. There is
 * no answer checking because there is nothing to check against: the "answer" is what they themselves wrote on the
 * card. Pretending to mark free text would be inventing a judgement.
 *
 * ## Order is not negotiable once it starts
 *
 * The questions, the pass mark and the XP are all fixed before the first one appears. A test whose pass mark moves
 * while it runs is not a measurement.
 *
 * ## Getting one wrong costs nothing
 *
 * It is recorded — a test that only counts the good news measures nothing — and then it is over. No XP is taken
 * away, nothing is reset, and the result says what to look at rather than how it went.
 */

interface Question {
  id: string
  source: 'flashcard' | 'mistake'
  sourceId: string
  ask: string
  answer: string
  conceptId: string | null
}

export interface ChallengeShape {
  id: string
  chapterId: string
  chapterName: string
  subject: string | null
  questions: readonly Question[]
  toPass: number
  xp: number
  createdAt: number
}

export default function Challenge({
  challenge,
  call,
  onClose,
  onNotify,
  onDone
}: {
  challenge: ChallengeShape
  call: Call
  onClose(): void
  onNotify(message: string, kind?: 'info' | 'warn'): void
  /** Told when the test finishes, for whatever built it — a stage records its attempt here. */
  onDone?(result: { right: string[]; passed: boolean; score: number; outOf: number }): void | Promise<void>
}): React.JSX.Element {
  const [at, setAt] = useState(0)
  const [shown, setShown] = useState(false)
  const [right, setRight] = useState<string[]>([])
  const [run, setRun] = useState(0)
  const [says, setSays] = useState<string | null>(null)
  const [done, setDone] = useState<{ passed: boolean; score: number; outOf: number; says: string; xp: number } | null>(null)
  /**
   * The hints taken on this question, and whether the student is explaining it instead.
   *
   * Cleared on every question, because help taken on one question says nothing about the next.
   */
  const [rungs, setRungs] = useState<('where' | 'shape' | 'half' | 'all')[]>([])
  const [explaining, setExplaining] = useState(false)

  const question = challenge.questions[at] ?? null

  const mark = async (gotIt: boolean): Promise<void> => {
    if (!question) return
    const kept = gotIt ? [...right, question.id] : right
    setRight(kept)

    /*
     * One attempt, with however much help was taken.
     *
     * This is what records the evidence as well as the run: a right answer reached after the whole answer was shown
     * is recorded as reading, not as recall, and it does not build a run either.
     */
    const out = await call<{ run: number; xp: number; says: string | null }>('attempted', {
      conceptId: question.conceptId,
      right: gotIt,
      rungs,
      sittingId: challenge.id
    })
    setRun(out?.run ?? 0)
    if (out?.says) setSays(out.says)

    if (at + 1 >= challenge.questions.length) {
      const out = await call<{ passed: boolean; score: number; outOf: number; says: string; xp: number }>('challenge-done', challenge, kept)
      setDone(out ?? null)
      if (out) await onDone?.({ right: kept, passed: out.passed, score: out.score, outOf: out.outOf })
      return
    }
    setAt(at + 1)
    setShown(false)
    setRungs([])
  }

  useEffect(() => {
    if (!says) return
    const timer = setTimeout(() => setSays(null), 2600)
    return () => clearTimeout(timer)
  }, [says])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      /*
       * The explanation is on top, so it gets the key.
       *
       * Both sheets listen on the window during the capture phase, and this one was mounted first -- so without
       * this check, pressing Escape in the explanation closed the test underneath it, and the key then carried on
       * and closed Student as well. One press, three things shut.
       */
      if (explaining) return
      // Stops every other handler on the window, not merely the later phases: leaving a test must not close Student.
      event.stopImmediatePropagation()
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, explaining])

  return (
    <div className="st-sheet" role="dialog" aria-modal="true" aria-label={`Test: ${challenge.chapterName}`}>
      <div className="st-sheet-card">
        <header className="st-challenge-head">
          <div>
            <h3>{challenge.chapterName}</h3>
            <p className="st-faint small">
              {/* Stated up front and never moved. */}
              {challenge.questions.length} questions from your own cards and mistakes · {challenge.toPass} to pass
            </p>
          </div>
          <button type="button" className="st-icon" onClick={onClose} aria-label="Leave the test">
            <X size={16} aria-hidden />
          </button>
        </header>

        {done ? (
          <div className="st-challenge-done">
            <strong>{done.says}</strong>
            {done.xp > 0 ? <p className="st-faint small">+{done.xp} XP</p> : null}
            <div className="st-row-actions">
              <button
                type="button"
                className="st-btn primary"
                onClick={() => {
                  onNotify(done.passed ? 'Recorded against those topics.' : 'The ones that went wrong are recorded, so they will come back round.')
                  onClose()
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : question ? (
          <>
            <div className="st-challenge-progress" aria-hidden>
              <span className="st-bar">
                <span style={{ width: `${((at + 1) / challenge.questions.length) * 100}%` }} />
              </span>
              <span className="st-faint small">
                {at + 1} of {challenge.questions.length}
                {run >= 3 ? ` · ${run} in a row` : ''}
              </span>
            </div>

            <p className="st-challenge-from st-faint small">{question.source === 'mistake' ? 'From your mistake book' : 'From one of your cards'}</p>
            <p className="st-challenge-ask">{question.ask}</p>

            {shown ? (
              <p className="st-challenge-answer">{question.answer}</p>
            ) : (
              <button type="button" className="st-btn" onClick={() => setShown(true)}>
                <Eye size={15} aria-hidden /> Show what you wrote
              </button>
            )}

            {/* Help, before the answer is revealed. After it, there is nothing left to hint at. */}
            {!shown ? (
              <Hints
                question={{ ask: question.ask, answer: question.answer, source: question.source, conceptId: question.conceptId }}
                call={call}
                taken={rungs}
                onTaken={(rung) => setRungs((held) => (held.includes(rung) ? held : [...held, rung]))}
                onTeachBack={() => setExplaining(true)}
              />
            ) : null}

            {shown ? (
              <div className="st-row-actions">
                <button type="button" className="st-btn primary" onClick={() => void mark(true)}>
                  <Check size={15} aria-hidden /> I had it
                </button>
                <button type="button" className="st-btn" onClick={() => void mark(false)}>
                  Not quite
                </button>
              </div>
            ) : null}

            {says ? <p className="st-challenge-says">{says}</p> : null}
          </>
        ) : (
          <p className="st-empty">That test has no questions in it.</p>
        )}
      </div>

      {explaining && question ? (
        <TeachBack
          question={{ ask: question.ask, answer: question.answer, source: question.source, conceptId: question.conceptId }}
          call={call}
          onNotify={(message, kind) => onNotify(message, kind)}
          onClose={() => setExplaining(false)}
        />
      ) : null}
    </div>
  )
}
