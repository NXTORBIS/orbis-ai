import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, Play, Sparkles, X } from 'lucide-react'
import type { Call } from './useStudent'
import type { NoticeKind } from '../../lib/notices'

/**
 * What should I study?
 *
 * One answer, with the reason underneath it, and a way to disagree. Not a list.
 *
 * ## Why one
 *
 * At any moment Orbis can justify a dozen suggestions -- revision is due, an exam is close, a subject has been
 * neglected, a task is half done. Showing all of them hands the decision back to the student, which is the
 * decision they came here to avoid making. So the engine picks one, and this draws it.
 *
 * ## Why the reason is always there
 *
 * "Kinematics, because your revision is due and your Physics test is in four days" is checkable: a student can
 * look at their own history and agree or disagree. A recommendation with no reason is one they either follow
 * blindly or ignore, and both of those end with the recommendations being ignored.
 *
 * ## Why disagreeing is a first-class action
 *
 * "Something else" is next to "Start", not hidden. Every override is recorded, and the engine scales down what
 * keeps getting turned down -- so disagreeing is how the recommendations get better rather than a dead end.
 */

export interface Intervention {
  decision: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  title: string
  because: string
  actions: readonly { id: string; label: string }[]
  subject: string | null
  conceptId: string | null
  minutes: number | null
  forId: string | null
}

export default function NextBest({
  call,
  onStart,
  onGo,
  onNotify,
  onOpenOrion,
  compact
}: {
  call: Call
  onStart(options: { subject: string | null; conceptId: string | null; minutes: number | null; title: string }): void
  onGo(where: 'plan' | 'learn' | 'goals' | 'progress'): void
  onNotify(message: string, kind?: NoticeKind): void
  onOpenOrion?(prompt: string): void
  /** Set on the dashboard, where this is one card among several. */
  compact?: boolean
}): React.JSX.Element | null {
  const [one, setOne] = useState<Intervention | null>(null)
  const [loading, setLoading] = useState(true)
  /** How many pages were just saved, so closing them can be offered once and only after they are safe. */
  const [tidied, setTidied] = useState(0)

  const load = useCallback(async (): Promise<void> => {
    // `asked` is true: the student is looking at this, so it is an answer rather than an interruption.
    const out = await call<Intervention>('next-best', true, {}, [])
    setOne(out && out.decision !== 'no-action' ? out : null)
    setLoading(false)
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  const answer = async (id: string): Promise<void> => {
    if (!one) return
    // Recorded either way. This is the only thing the engine learns from.
    await call('intervention-answered', one.decision, id === 'dismiss' || id === 'other' ? 'dismissed' : 'accepted')

    switch (id) {
      case 'start':
      case 'resume':
      case 'more':
        onStart({ subject: one.subject, conceptId: one.conceptId, minutes: one.minutes, title: one.title })
        break
      case 'short':
        onStart({ subject: one.subject, conceptId: one.conceptId, minutes: 10, title: one.title })
        break
      case 'break':
        await call('start-break')
        break
      case 'end':
        await call('end-focus', 'finished from the suggestion')
        break
      case 'plan':
        onGo('plan')
        break
      case 'orion':
        if (onOpenOrion && one.conceptId) {
          void call('orion-turn')
          onOpenOrion(`Explain ${one.title} simply, then give me one example and one question to try.`)
        }
        break
      case 'organize': {
        /*
         * Saved first. Closing them is a second, separate press.
         *
         * Which of twenty tabs somebody was finished with is not Orbis's decision, so the tidy-up keeps them and
         * says where they went; the student can then close them in one go, knowing they are kept.
         */
        const out = await call<{ ok: boolean; saved: number; why?: string }>('tidy-tabs')
        if (!out?.ok) {
          onNotify(out?.why ?? 'Those pages could not be saved.', 'warn')
          break
        }
        onNotify(`${out.saved} ${out.saved === 1 ? 'page' : 'pages'} saved as a study space. Nothing was closed.`)
        setTidied(out.saved)
        break
      }
      case 'other':
        // Asked again: the engine will not repeat the same decision inside its cooldown, so this is a real change.
        await load()
        return
      default:
        break
    }
    if (id === 'dismiss') setOne(null)
    else void load()
  }

  if (loading) {
    return (
      <div className={`st-next${compact ? ' compact' : ''}`}>
        <div className="st-skeleton row" style={{ height: 72 }} />
      </div>
    )
  }

  if (!one) {
    return (
      <div className={`st-next quiet${compact ? ' compact' : ''}`} data-tour="next-best">
        <p className="st-faint">
          Nothing is due and nothing is pressing. Start anything you like, or set some time aside and Orbis will
          work out an order.
        </p>
        <div className="st-next-actions">
          <button type="button" className="st-btn primary" onClick={() => onStart({ subject: null, conceptId: null, minutes: null, title: 'Focus' })}>
            <Play size={15} aria-hidden /> Start Focus
          </button>
          <button type="button" className="st-btn" onClick={() => onGo('plan')}>
            Set up my week
          </button>
        </div>
      </div>
    )
  }

  const Icon = one.priority === 'critical' ? ArrowRight : one.priority === 'low' ? Check : Sparkles

  const closeThem = async (): Promise<void> => {
    const out = await call<{ ok: boolean; saved: number; closed?: number }>('tidy-tabs', undefined, { closeAfter: true })
    onNotify(
      out?.ok ? `${out.closed ?? 0} closed. They are all in the space, so nothing is lost.` : 'Those pages could not be closed.',
      out?.ok ? 'info' : 'warn'
    )
    setTidied(0)
    void load()
  }

  return (
    <section className={`st-next p-${one.priority}${compact ? ' compact' : ''}`} aria-label="What to do next" data-tour="next-best">
      <header>
        <span className="st-next-kicker">
          <Icon size={13} aria-hidden /> {one.priority === 'critical' ? 'Worth doing first' : one.priority === 'low' ? 'If you want' : 'Suggested'}
        </span>
        {one.minutes ? <span className="st-chip">{one.minutes} min</span> : null}
      </header>
      <h3>{one.title}</h3>
      {/* The reason. Always, and always checkable against the student's own history. */}
      <p className="st-next-because">{one.because}</p>
      <div className="st-next-actions">
        {one.actions.map((action, index) => (
          <button key={action.id} type="button" className={`st-btn${index === 0 ? ' primary' : action.id === 'dismiss' ? ' quiet' : ''}`} onClick={() => void answer(action.id)}>
            {index === 0 && /start|carry|resume/i.test(action.label) ? <Play size={15} aria-hidden /> : null}
            {action.label}
          </button>
        ))}
        {/* Only after they are saved, and never as the first press. */}
        {tidied > 0 ? (
          <button type="button" className="st-btn" onClick={() => void closeThem()}>
            Close those {tidied} pages
          </button>
        ) : null}
        {!one.actions.some((action) => action.id === 'dismiss') ? (
          <button type="button" className="st-icon" onClick={() => void answer('dismiss')} aria-label="Not now">
            <X size={15} aria-hidden />
          </button>
        ) : null}
      </div>
    </section>
  )
}
