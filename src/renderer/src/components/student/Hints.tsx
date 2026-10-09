import { useState } from 'react'
import { HelpCircle, Mic } from 'lucide-react'
import type { Call } from './useStudent'

/**
 * Getting stuck, without being shown the answer.
 *
 * ## Why the cost is on the button
 *
 * Each rung says what it will do to the attempt *before* it is taken — "still counts", "counts as practice, not
 * recall", "will not count as recall". Taking help is never discouraged; it is just honest about what the attempt
 * will prove afterwards, because a recall score built from revealed answers is a score nobody can trust.
 *
 * ## Nothing here is written by Orbis
 *
 * The rungs are: where the question came from, what shape the answer takes, the first half of it, and all of it.
 * Every one of those is the student's own answer, cut or described. A hint Orbis composed would be Orbis guessing at
 * somebody else's course.
 */

export interface Question {
  ask: string
  answer: string
  source: 'flashcard' | 'mistake' | 'review'
  conceptId?: string | null
  where?: string | null
}

type Rung = 'where' | 'shape' | 'half' | 'all'

const RUNGS: readonly { rung: Rung; label: string; costs: string }[] = [
  { rung: 'where', label: 'Where does this come from?', costs: 'Still counts' },
  { rung: 'shape', label: 'What shape is the answer?', costs: 'Counts a little less' },
  { rung: 'half', label: 'Show me the first half', costs: 'Counts as practice, not recall' },
  { rung: 'all', label: 'Show me all of it', costs: 'Will not count as recall' }
]

export default function Hints({
  question,
  call,
  taken,
  onTaken,
  onTeachBack
}: {
  question: Question
  call: Call
  /** The rungs already taken for this question, held by whatever is running the practice. */
  taken: readonly Rung[]
  onTaken(rung: Rung): void
  /** Offered only where explaining it back makes sense — never during a timed test. */
  onTeachBack?(): void
}): React.JSX.Element {
  const [shown, setShown] = useState<{ rung: Rung; text: string; costs: string }[]>([])
  const [open, setOpen] = useState(false)

  const climb = async (rung: Rung): Promise<void> => {
    if (shown.some((one) => one.rung === rung)) return
    const hint = await call<{ rung: Rung; text: string; costs: string }>('hint', rung, {
      ask: question.ask,
      answer: question.answer,
      source: question.source,
      where: question.where ?? null
    })
    if (!hint) return
    setShown((held) => [...held, hint])
    onTaken(rung)
  }

  const next = RUNGS.find((one) => !taken.includes(one.rung) && !shown.some((two) => two.rung === one.rung))

  return (
    <div className="st-hints">
      {shown.length > 0 ? (
        <ul className="st-hint-list">
          {shown.map((one) => (
            <li key={one.rung}>
              {/* The student's own words, cut or described. Never anything Orbis wrote. */}
              <span>{one.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="st-row-actions">
        {!open ? (
          <button type="button" className="st-btn quiet small" onClick={() => setOpen(true)}>
            <HelpCircle size={14} aria-hidden /> Stuck?
          </button>
        ) : next ? (
          <span className="st-hint-next">
            <button type="button" className="st-btn small" onClick={() => void climb(next.rung)}>
              {next.label}
            </button>
            {/* Said before it is taken, so nothing about the attempt changes without warning. */}
            <span className="st-faint small">{next.costs}</span>
          </span>
        ) : (
          <span className="st-faint small">That is all of it. Worth coming back to this one from memory later.</span>
        )}
        {/*
          * Always offered, including after a hint has been taken.
          *
          * It used to vanish the moment somebody asked for help, which is exactly backwards: the student who is
          * stuck is the one most likely to get somewhere by explaining what they do know.
          */}
        {onTeachBack ? (
          <button type="button" className="st-btn quiet small" onClick={onTeachBack}>
            <Mic size={14} aria-hidden /> Explain it instead
          </button>
        ) : null}
      </div>
    </div>
  )
}
