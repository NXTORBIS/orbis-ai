import { useEffect, useState } from 'react'
import { Check, Pencil, Sparkles, X } from 'lucide-react'
import type { Call } from './useStudent'
import type { NoticeKind } from '../../lib/notices'

/**
 * Cards Orion drafted from a piece of material, before any of them are yours.
 *
 * ## Nothing is saved until it is ticked
 *
 * This is the cold-start fix — tests are built from your cards, and writing cards is the chore nobody does — but a
 * model drafting straight into somebody's deck would be a model quietly putting its mistakes into their revision.
 * So: drafts, ticked, editable, and only then kept.
 *
 * ## Each draft says where it came from
 *
 * The line of the material it was drawn from is shown under it. That is what makes checking twenty drafts quick
 * rather than a second reading of the whole document.
 */

interface Draft {
  front: string
  back: string
  conceptId: string | null
  from: string | null
}

export default function Drafts({
  material,
  subject,
  conceptId,
  call,
  onClose,
  onKept,
  onNotify
}: {
  material: string
  subject?: string | null
  conceptId?: string | null
  call: Call
  onClose(): void
  onKept?(count: number): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => {
    let stopped = false
    void call<{ ok: boolean; cards: Draft[]; note: string | null; why?: string }>('draft-cards', material, { subject, conceptId, howMany: 10 }).then((out) => {
      if (stopped) return
      setDrafts(out?.ok ? out.cards : [])
      setWhy(out?.ok ? out.note : (out?.why ?? 'Nothing came back.'))
      // Everything ticked to begin with: the common case is keeping most of them and dropping one or two.
      if (out?.ok) setTicked(new Set(out.cards.map((_, index) => index)))
    })
    return () => {
      stopped = true
    }
  }, [call, material, subject, conceptId])

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

  const keep = async (): Promise<void> => {
    if (!drafts) return
    const chosen = [...ticked].map((index) => drafts[index]).filter(Boolean)
    if (chosen.length === 0) {
      onNotify('Nothing ticked.', 'warn')
      return
    }
    const out = await call<{ kept: number }>(
      'keep-drafts',
      chosen.map((one) => ({ front: one.front, back: one.back, conceptId: one.conceptId ?? conceptId ?? null, subject: subject ?? null }))
    )
    onNotify(`${out?.kept ?? 0} ${out?.kept === 1 ? 'card' : 'cards'} kept. They say Orion wrote them.`)
    onKept?.(out?.kept ?? 0)
    onClose()
  }

  const change = (index: number, patch: Partial<Draft>): void => {
    setDrafts((held) => (held ? held.map((one, i) => (i === index ? { ...one, ...patch } : one)) : held))
  }

  return (
    <div className="st-sheet" role="dialog" aria-modal="true" aria-label="Cards Orion drafted">
      <div className="st-sheet-card">
        <header className="st-challenge-head">
          <div>
            <h3>Cards from your material</h3>
            <p className="st-faint small">
              <Sparkles size={12} aria-hidden /> Drafted by Orion · nothing is kept until you tick it
            </p>
          </div>
          <button type="button" className="st-icon" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </header>

        {drafts === null ? <div className="st-skeleton row" style={{ height: 120 }} /> : null}

        {drafts !== null && drafts.length === 0 ? (
          <>
            <p className="st-empty">{why}</p>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={onClose}>
                Right
              </button>
            </div>
          </>
        ) : null}

        {drafts && drafts.length > 0 ? (
          <>
            <ul className="st-drafts">
              {drafts.map((one, index) => (
                <li key={index} className={ticked.has(index) ? '' : 'out'}>
                  <label className="st-check">
                    <input
                      type="checkbox"
                      checked={ticked.has(index)}
                      onChange={(e) =>
                        setTicked((held) => {
                          const next = new Set(held)
                          if (e.target.checked) next.add(index)
                          else next.delete(index)
                          return next
                        })
                      }
                      aria-label={`Keep: ${one.front}`}
                    />
                    <span>
                      {editing === index ? (
                        <>
                          <textarea
                            rows={2}
                            value={one.front}
                            onChange={(e) => change(index, { front: e.target.value.slice(0, 1000) })}
                            aria-label="The question"
                            className="st-syllabus"
                          />
                          <textarea
                            rows={3}
                            value={one.back}
                            onChange={(e) => change(index, { back: e.target.value.slice(0, 2000) })}
                            aria-label="The answer"
                            className="st-syllabus"
                          />
                        </>
                      ) : (
                        <>
                          <strong>{one.front}</strong>
                          <span className="st-faint small">{one.back}</span>
                          {/* Where it came from, so twenty drafts can be checked quickly. */}
                          {one.from ? <span className="st-faint small">from “{one.from}”</span> : null}
                        </>
                      )}
                    </span>
                  </label>
                  <button
                    type="button"
                    className="st-icon"
                    aria-label={editing === index ? `Done editing: ${one.front}` : `Edit: ${one.front}`}
                    onClick={() => setEditing(editing === index ? null : index)}
                  >
                    {editing === index ? <Check size={15} aria-hidden /> : <Pencil size={15} aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>

            {why ? <p className="st-faint small">{why}</p> : null}

            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={() => void keep()} disabled={ticked.size === 0}>
                Keep {ticked.size} {ticked.size === 1 ? 'card' : 'cards'}
              </button>
              <button type="button" className="st-btn quiet" onClick={onClose}>
                None of these
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
