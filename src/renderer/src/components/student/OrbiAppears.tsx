import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Call } from './useStudent'
import type { Intervention } from './NextBest'

/**
 * Orbi turning up on its own.
 *
 * ## The whole design is about not doing this
 *
 * Every rule here exists to stop something appearing: it asks at most once every few minutes, it asks the main
 * process rather than deciding for itself, and the main process refuses while a session is running, while somebody
 * is typing, during quiet hours, and once the day's small budget of interruptions is spent. An uninvited companion
 * that gets it wrong twice is one somebody turns off for good, so the bar is "worth being interrupted for", not
 * "technically relevant".
 *
 * ## It never steals what you were doing
 *
 * It appears beside Orbi, it takes no focus, and Escape closes it. Nothing it shows can block the screen, and
 * ignoring it is a complete answer -- it goes away on its own after a while and is recorded as dismissed, which is
 * what teaches the engine to offer that kind of thing less.
 */

/** How often the renderer may even ask. The main process decides whether anything is said. */
const ASK_EVERY = 150_000
/** Unanswered, it leaves rather than sitting there. */
const LEAVES_AFTER = 45_000
/** How long Student is left alone after it opens before anything may interrupt. */
const SETTLES_IN = 60_000

export default function OrbiAppears({
  call,
  enabled,
  busy,
  onStart,
  onGo,
  onSays,
  screen
}: {
  call: Call
  /** False while a session runs, while Student is closed, or when Orbi is switched off. */
  enabled: boolean
  busy: { typing: boolean; reading: boolean }
  onStart(options: { subject: string | null; conceptId: string | null; minutes: number | null; title: string }): void
  onGo(where: 'plan' | 'learn' | 'goals' | 'progress' | 'mastery'): void
  /**
   * The screen somebody is on.
   *
   * Changing it puts the suggestion away. Somebody who has just navigated is already doing something, and an
   * offer made about the last screen follows them around looking stuck — which is exactly how it looked.
   */
  screen?: string
  /** What Orbi should say out loud, if the student has that switched on. */
  onSays?(text: string): void
}): React.JSX.Element | null {
  const [one, setOne] = useState<Intervention | null>(null)
  const asked = useRef(0)
  /*
   * Nothing is offered in the first minute.
   *
   * Somebody who has just opened Student is already doing the thing an interruption would be asking them to do.
   * Without this, a brand new profile was greeted by a suggestion card before it had been looked at.
   */
  const opened = useRef(Date.now())

  // A change of screen puts away whatever was being offered about the last one.
  useEffect(() => {
    setOne(null)
  }, [screen])

  const answer = useCallback(
    async (id: string, intervention: Intervention): Promise<void> => {
      await call('intervention-answered', intervention.decision, id === 'dismiss' || id === 'later' ? 'dismissed' : 'accepted')
      setOne(null)
      switch (id) {
        case 'start':
        case 'resume':
        case 'more':
          onStart({ subject: intervention.subject, conceptId: intervention.conceptId, minutes: intervention.minutes, title: intervention.title })
          break
        case 'short':
          onStart({ subject: intervention.subject, conceptId: intervention.conceptId, minutes: 10, title: intervention.title })
          break
        case 'plan':
          onGo('plan')
          break
        case 'review':
          onGo('learn')
          break
        default:
          break
      }
    },
    [call, onStart, onGo]
  )

  useEffect(() => {
    if (!enabled) {
      setOne(null)
      return
    }
    let stopped = false
    const look = async (): Promise<void> => {
      if (stopped || one) return
      // Typing is checked here as well as in the main process: the renderer knows sooner.
      if (busy.typing) return
      if (Date.now() - asked.current < ASK_EVERY) return
      if (Date.now() - opened.current < SETTLES_IN) return
      asked.current = Date.now()
      const out = await call<{ appear: boolean; intervention: Intervention; why: string }>('appearance', busy)
      if (stopped || !out?.appear || out.intervention?.decision === 'no-action') return
      setOne(out.intervention)
      onSays?.(out.intervention.title)
    }
    void look()
    const timer = setInterval(() => void look(), 30_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [enabled, busy, call, one, onSays])

  // Unanswered, it leaves. Recorded as dismissed, because that is what happened.
  useEffect(() => {
    if (!one) return
    const timer = setTimeout(() => {
      void call('intervention-answered', one.decision, 'dismissed')
      setOne(null)
    }, LEAVES_AFTER)
    return () => clearTimeout(timer)
  }, [one, call])

  useEffect(() => {
    if (!one) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Stops every other handler on the window: Escape dismisses this and nothing else.
      event.stopImmediatePropagation()
      void answer('dismiss', one)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [one, answer])

  if (!one) return null

  return (
    <aside className="st-appears" role="status" aria-label="Orbi">
      <div className="st-appears-body">
        <strong>{one.title}</strong>
        {/* The reason, always. An uninvited suggestion with no reason is just an advert. */}
        <p className="st-faint small">{one.because}</p>
      </div>
      <div className="st-appears-actions">
        {one.actions.slice(0, 2).map((action, index) => (
          <button key={action.id} type="button" className={`st-btn${index === 0 ? ' primary' : ' quiet'} small`} onClick={() => void answer(action.id, one)}>
            {action.label}
          </button>
        ))}
        <button type="button" className="st-icon" aria-label="Not now" onClick={() => void answer('dismiss', one)}>
          <X size={14} aria-hidden />
        </button>
      </div>
    </aside>
  )
}
