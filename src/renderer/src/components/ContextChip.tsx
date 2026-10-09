import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

/**
 * What Orbis thinks you are working on, in two words.
 *
 * ## The whole user interface of Ambient Intelligence
 *
 * Everything underneath — the activity, the clustering, the subjects, the confidence, the evidence — surfaces as
 * one small word in the corner of the chrome, and a popover if somebody taps it. There is deliberately no
 * dashboard, no graph and no management screen: a feature whose point is that you do not have to organise
 * anything cannot be delivered as another thing to organise.
 *
 * ## It is absent far more often than it is present
 *
 * Nothing is shown unless Orbis is actually confident, and "Orbis is not sure" is drawn as nothing at all rather
 * than as a question mark. A chip that is wrong once teaches somebody to ignore it for ever, so the bar to appear
 * is high and the way to disagree is one press.
 *
 * ## Saying it is wrong works immediately
 *
 * "Not this?" clears the guess there and then. No settings, no confirmation, no explaining why — the correction
 * is the whole interaction, and the next thing Orbis works out starts from nothing rather than from the mistake.
 */

interface Context {
  id: string
  title: string
  subject: string | null
  concept: string | null
  intent: string
  band: 'certain' | 'likely' | 'possible' | 'unknown'
  seconds: number
  evidence: { says: string; weight: number }[]
}

interface Detail {
  context: Context | null
  related: { id: string; title: string; endedAt: number }[]
  says: string
}

export default function ContextChip({ onAsk }: { onAsk?(about: string): void }): React.JSX.Element | null {
  const [context, setContext] = useState<Context | null>(null)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const holder = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const one = (await window.api.ambient('current').catch(() => null)) as Context | null
    setContext(one)
  }, [])

  useEffect(() => {
    void refresh()
    // Told when it changes rather than asking on a timer: the engine already knows when it has changed its mind.
    const stop = window.api.onAmbientChanged((one) => setContext((one as Context | null) ?? null))
    return stop
  }, [refresh])

  useEffect(() => {
    if (!open) {
      setDetail(null)
      return
    }
    void window.api
      .ambient('detail')
      .then((one) => setDetail((one as Detail | null) ?? null))
      .catch(() => setDetail(null))
  }, [open, context?.id])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setOpen(false)
    }
    const onClick = (event: MouseEvent): void => {
      if (holder.current && !holder.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onClick)
    }
  }, [open])

  const wrong = async (): Promise<void> => {
    await window.api.ambient('correct', { wrong: true }).catch(() => undefined)
    setOpen(false)
    setContext(null)
  }

  // Absent, rather than uncertain: Orbis says nothing until it is sure enough to be useful.
  if (!context) return null

  const minutes = Math.round(context.seconds / 60)

  return (
    <div className="ctx-chip-holder" ref={holder}>
      <button
        type="button"
        className={`ctx-chip${open ? ' on' : ''}`}
        onClick={() => setOpen((one) => !one)}
        aria-expanded={open}
        aria-label={`You are working on ${context.title}. Open for what is related.`}
        title={`Working on ${context.title}`}
      >
        <span className="ctx-dot" aria-hidden />
        <span className="ctx-name">{context.title}</span>
      </button>

      {open ? (
        <div className="ctx-pop" role="dialog" aria-label={`About ${context.title}`}>
          <header>
            <strong>{context.title}</strong>
            <button type="button" className="ctx-close" onClick={() => setOpen(false)} aria-label="Close">
              <X size={14} aria-hidden />
            </button>
          </header>

          <p className="ctx-line">
            {`You seem to be ${context.intent}`}
            {minutes >= 2 ? `, for about ${minutes} minutes` : ''}.
          </p>

          {/* Why Orbis thinks so, in the words it worked it out in. The answer to "how would it know that?". */}
          {context.evidence.length > 0 ? (
            <ul className="ctx-why">
              {context.evidence.slice(0, 3).map((one, index) => (
                <li key={index}>{one.says}</li>
              ))}
            </ul>
          ) : null}

          {detail && detail.related.length > 0 ? (
            <>
              <h4>You have done this before</h4>
              <ul className="ctx-related">
                {detail.related.slice(0, 3).map((one) => (
                  <li key={one.id}>{one.title}</li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="ctx-actions">
            {onAsk ? (
              <button type="button" className="ctx-btn" onClick={() => { setOpen(false); onAsk(context.title) }}>
                Ask Orion about this
              </button>
            ) : null}
            {/* The correction. One press, works immediately, needs no explanation from the person. */}
            <button type="button" className="ctx-btn quiet" onClick={() => void wrong()}>
              Not this?
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
