import { useEffect, useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import type { Call } from './useStudent'
import type { Question } from './Hints'

/**
 * Explaining it back.
 *
 * ## Orbis does not mark this
 *
 * It cannot. Marking a free explanation against somebody else's note means judging whether two pieces of prose mean
 * the same thing, and getting that wrong either flatters somebody into an exam or tells them they are wrong when
 * they are right. So the student explains first, *then* sees their own note, and ticks the points they actually
 * covered. The ticks are their claim, and the screen says so.
 *
 * ## The one rule
 *
 * Explaining with the note already open is reading aloud. It records nothing — not a failure, nothing — and the
 * screen says that before the note is revealed, so the choice is the student's and its meaning is clear.
 */

export default function TeachBack({
  question,
  call,
  onClose,
  onNotify
}: {
  question: Question
  call: Call
  onClose(): void
  onNotify(message: string, kind?: 'info' | 'warn'): void
}): React.JSX.Element {
  const [stage, setStage] = useState<'explain' | 'compare' | 'done'>('explain')
  const [points, setPoints] = useState<readonly string[]>([])
  const [covered, setCovered] = useState<Set<number>>(new Set())
  const [lookedFirst, setLookedFirst] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  /**
   * Typing the explanation, so Orion can suggest which points it covered.
   *
   * Optional throughout: saying it out loud and ticking it yourself is the original route and still the default.
   * What is typed here is compared with the student's own notes and comes back as *suggestions* -- the ticks they
   * confirm are what gets recorded, which is why a model marking it wrong costs a correction rather than a wrong
   * measurement.
   */
  const [typed, setTyped] = useState('')
  const [canGenerate, setCanGenerate] = useState(false)
  const [marking, setMarking] = useState(false)
  const [suggested, setSuggested] = useState<{ point: string; covered: boolean; because: string | null }[] | null>(null)

  useEffect(() => {
    void call<{ ok: boolean }>('can-generate').then((out) => setCanGenerate(out?.ok === true))
  }, [call])

  /** Orion's view of which points were covered. A suggestion, applied to the ticks and still editable. */
  const suggest = async (points: readonly string[]): Promise<void> => {
    if (!canGenerate || typed.trim().length < 10) return
    setMarking(true)
    const out = await call<{ ok: boolean; points: { point: string; covered: boolean; because: string | null }[]; why?: string }>('mark-explanation', {
      about: question.ask,
      points,
      said: typed
    })
    setMarking(false)
    if (!out?.ok) {
      onNotify(out?.why ?? 'Nothing came back. Tick what you covered yourself.', 'warn')
      return
    }
    setSuggested(out.points)
    setCovered(new Set(out.points.map((one, index) => (one.covered ? index : -1)).filter((index) => index >= 0)))
  }

  const reveal = async (peeked: boolean): Promise<void> => {
    setLookedFirst(peeked)
    const out = await call<{ points: string[] }>('teach-back', { ask: question.ask, answer: question.answer, conceptId: question.conceptId ?? null })
    setPoints(out?.points ?? [])
    setStage('compare')
  }

  const finish = async (): Promise<void> => {
    const out = await call<{ kind: string | null; says: string }>('taught-back', {
      conceptId: question.conceptId ?? null,
      covered: covered.size,
      outOf: points.length,
      lookedFirst
    })
    setSaid(out?.says ?? null)
    setStage('done')
    if (out && out.kind === null && lookedFirst) onNotify('Nothing recorded — reading it through is not the same as recalling it.')
  }

  /*
   * Escape closes this and nothing else.
   *
   * `stopImmediatePropagation`, not `stopPropagation`: every one of these handlers is attached to `window`, which
   * makes `window` the event's own target -- and at the target all of its listeners run whatever phase they asked
   * for. Without this, one press closed the explanation, the test underneath it and Student behind that.
   */
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

  return (
    <div className="st-sheet" role="dialog" aria-modal="true" aria-label="Explain it back">
      <div className="st-sheet-card">
        <header className="st-challenge-head">
          <div>
            <h3>Explain it back</h3>
            <p className="st-faint small">{question.ask}</p>
          </div>
          <button type="button" className="st-icon" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </header>

        {stage === 'explain' ? (
          <>
            <p className="st-teach-ask">
              Say it out loud, or in your head, as though you were explaining it to somebody who has not met it
              before. Then see what you wrote down about it.
            </p>
            {canGenerate ? (
              <>
                <label className="st-field">
                  <span>Or type it, and Orion will say which points you covered</span>
                  <textarea
                    className="st-syllabus"
                    rows={5}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value.slice(0, 4000))}
                    placeholder="Explain it in your own words"
                    aria-label="Your explanation"
                  />
                  <small>Its marking is a suggestion. What you tick is what gets recorded.</small>
                </label>
              </>
            ) : null}
            <div className="st-row-actions">
              <button type="button" className="st-btn primary" onClick={() => void reveal(false)}>
                <Check size={15} aria-hidden /> Done — show me my note
              </button>
              {/* Stated plainly, before the choice is made. */}
              <button type="button" className="st-btn quiet" onClick={() => void reveal(true)}>
                Show it first
              </button>
            </div>
            <p className="st-faint small">Showing it first records nothing — reading it through is a different thing from recalling it.</p>
          </>
        ) : null}

        {stage === 'compare' ? (
          <>
            {points.length === 0 ? (
              <p className="st-empty">There is nothing written down about this one yet, so there is nothing to compare it with.</p>
            ) : (
              <>
                <p className="st-faint small">
                  {lookedFirst
                    ? 'With the note open this will not be recorded. Tick what you covered anyway if it helps you see the gaps.'
                    : 'Your own note. Tick what you actually said.'}
                </p>
                {canGenerate && typed.trim().length >= 10 && !suggested ? (
                  <div className="st-row-actions">
                    <button type="button" className="st-btn" disabled={marking} onClick={() => void suggest(points)}>
                      <Sparkles size={15} aria-hidden /> {marking ? 'Reading it…' : 'Have Orion suggest the ticks'}
                    </button>
                  </div>
                ) : null}
                {suggested ? <p className="st-faint small">Orion's suggestion is ticked below. Change anything it got wrong.</p> : null}
                <ul className="st-teach-points">
                  {points.map((point, index) => (
                    <li key={index}>
                      <label className="st-check">
                        <input
                          type="checkbox"
                          checked={covered.has(index)}
                          onChange={(e) =>
                            setCovered((held) => {
                              const next = new Set(held)
                              if (e.target.checked) next.add(index)
                              else next.delete(index)
                              return next
                            })
                          }
                        />
                        <span>
                        {point}
                        {/* Why it thinks so, shown as a suggestion under the point it belongs to. */}
                        {suggested?.[index]?.because ? <span className="st-faint small">{suggested[index].because}</span> : null}
                      </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="st-row-actions">
                  <button type="button" className="st-btn primary" onClick={() => void finish()}>
                    {covered.size} of {points.length} — that is my answer
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}

        {stage === 'done' ? (
          <>
            <p className="st-teach-said">{said}</p>
            <div className="st-row-actions">
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
