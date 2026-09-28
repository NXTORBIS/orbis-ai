import { useCallback, useEffect, useRef, useState } from 'react'
import { HelpCircle, X } from 'lucide-react'
import type { Explanation } from '../../../../shared/markets/glossary'
import type { ExperienceState } from './useExperience'

/**
 * "What is this?" wherever a market term appears.
 *
 * Three pieces, one glossary behind all of them. Every definition comes from the main process on demand — nothing here
 * holds a copy, because a definition written beside the panel that uses it is a definition that drifts from the one Orion
 * gives for the same word.
 *
 * Two rules about when any of this appears.
 *
 * **It is never a wall.** The affordance is a question mark. The explanation arrives when somebody asks for it, and it is
 * fetched then rather than rendered hidden — a beginner's Markets should not be slower for carrying forty explanations
 * nobody opened.
 *
 * **It stops once it is known.** `Introduce` shows itself once, the first time a feature is opened, and then never again
 * for that person. Help that keeps reappearing after it has been read is not help.
 */

export function Explain({
  term,
  experience,
  label
}: {
  /** The glossary id, or anything somebody would call it. */
  term: string
  experience: ExperienceState
  /** Overrides the button's accessible name, where the surrounding text does not already say it. */
  label?: string
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [asking, setAsking] = useState(false)
  const holder = useRef<HTMLSpanElement | null>(null)

  const ask = useCallback(async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (explanation) return
    setAsking(true)
    const got = await experience.explain(term)
    setExplanation(got)
    setAsking(false)
    if (got) void experience.learn(got.id)
  }, [open, explanation, experience, term])

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent): void => {
      if (holder.current && !holder.current.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  // Switched off deliberately means switched off: nothing is drawn at all, rather than drawn and disabled.
  if (!experience.get('learnActions')) return null

  return (
    <span className="mk-explain" ref={holder}>
      <button
        type="button"
        className={`mk-explain-ask${open ? ' on' : ''}`}
        onClick={() => void ask()}
        aria-expanded={open}
        aria-label={label ? `What is ${label}?` : `What is ${term}?`}
        title={label ? `What is ${label}?` : 'What is this?'}
      >
        <HelpCircle size={13} />
      </button>
      {open ? (
        <span className="mk-explain-card" role="dialog" aria-label={explanation?.title ?? 'Explanation'}>
          {asking ? (
            <em className="mk-quiet">Looking it up…</em>
          ) : explanation ? (
            <ExplanationBody explanation={explanation} experience={experience} />
          ) : (
            // Not found rather than invented. A made-up explanation of a market term looks exactly as confident as a
            // real one, which is what makes inventing one worse than saying nothing.
            <em className="mk-quiet">Orbis does not have a definition for that term.</em>
          )}
        </span>
      ) : null}
    </span>
  )
}

function ExplanationBody({
  explanation,
  experience
}: {
  explanation: Explanation
  experience: ExperienceState
}): React.JSX.Element {
  const [shown, setShown] = useState(explanation)
  const follow = useCallback(
    async (id: string) => {
      const got = await experience.explain(id)
      if (got) {
        setShown(got)
        void experience.learn(got.id)
      }
    },
    [experience]
  )

  return (
    <>
      <strong>{shown.title}</strong>
      <p>{shown.definition}</p>
      {shown.whyItMatters ? (
        <>
          <b>Why it matters</b>
          <p>{shown.whyItMatters}</p>
        </>
      ) : null}
      {shown.howToUse ? (
        <>
          <b>How to use it</b>
          <p>{shown.howToUse}</p>
        </>
      ) : null}
      {shown.related.length > 0 ? (
        <span className="mk-explain-related">
          {shown.related.map((one) => (
            <button key={one.id} type="button" onClick={() => void follow(one.id)}>
              {one.term}
            </button>
          ))}
        </span>
      ) : null}
    </>
  )
}

/**
 * A feature explaining itself the first time it is opened.
 *
 * Only when education is on and only once. It does not hide the feature behind itself: the order book is drawn below
 * this card, not instead of it — beginner mode adapts the presentation and never withholds the thing.
 */
export function Introduce({
  term,
  experience
}: {
  term: string
  experience: ExperienceState
}): React.JSX.Element | null {
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const wanted = experience.shouldIntroduce(term)

  useEffect(() => {
    if (!wanted) return
    let alive = true
    void experience.explain(term).then((got) => {
      if (alive) setExplanation(got)
    })
    return () => {
      alive = false
    }
    // Deliberately not on the whole experience object: it changes identity on every answer, and this should run when the
    // term or the decision changes, not whenever a preference is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, wanted])

  if (!wanted || dismissed || !explanation) return null

  const close = (): void => {
    setDismissed(true)
    // Written down, so it does not come back on the next visit.
    void experience.learn(explanation.id)
  }

  return (
    <aside className="mk-introduce">
      <div className="mk-introduce-head">
        <strong>{explanation.title}</strong>
        <button type="button" onClick={close} aria-label="Got it">
          <X size={14} />
        </button>
      </div>
      <p>{explanation.definition}</p>
      {explanation.howToUse ? <p className="mk-quiet">{explanation.howToUse}</p> : null}
      <button type="button" className="mk-introduce-ok" onClick={close}>
        Got it
      </button>
    </aside>
  )
}

/**
 * A label with its definition attached.
 *
 * The tooltip is the whole point for somebody learning, and noise for somebody who is not — so it is the resolved
 * setting that decides, not the component.
 */
export function Term({
  term,
  children,
  experience
}: {
  term: string
  children: React.ReactNode
  experience: ExperienceState
}): React.JSX.Element {
  if (!experience.get('glossaryTooltips')) return <>{children}</>
  return (
    <span className="mk-term">
      {children}
      <Explain term={term} experience={experience} label={typeof children === 'string' ? children : term} />
    </span>
  )
}
