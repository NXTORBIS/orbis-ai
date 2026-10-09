import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Compass, HelpCircle, LineChart, Play, Sparkles, Target, Timer, X } from 'lucide-react'
import Orbi from './Orbi'
import { spell, type Call } from './useStudent'
import { stageNow, tierFor, watchRecord } from '../../../../shared/student/orbiAnim'
import type { StudentSnapshot } from '../../../../shared/student/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * The panel that opens when somebody presses Orbi.
 *
 * It is anchored to Orbi and reads as coming out of it, rather than being a dialogue in the middle of the screen --
 * the difference between a companion that was asked something and an application that interrupted.
 *
 * ## What is on it, and what is not
 *
 * Only things that are **true right now**: where the session is up to, what the one thing was, whether a record is
 * close, and the handful of actions somebody actually reaches for. Nothing is a link to somewhere else that then
 * needs explaining, and nothing is a statistic for its own sake.
 *
 * Every row either does something immediately or opens one named place. There are no rows that only describe.
 */

export default function OrbiPanel({
  snapshot,
  ticking,
  call,
  onClose,
  onGo,
  onStart,
  onOpenOrion,
  onNotify
}: {
  snapshot: StudentSnapshot
  ticking: { elapsed: number; remaining: number; through: number } | null
  call: Call
  onClose(): void
  onGo(where: 'learn' | 'goals' | 'progress' | 'orbi' | 'later'): void
  onStart(): void
  onOpenOrion?(prompt: string): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const card = useRef<HTMLDivElement>(null)
  const [reset, setReset] = useState(false)
  const prefs = snapshot.preferences
  const session = snapshot.session
  const tier = tierFor(snapshot.level.level)

  const stage = useMemo(() => (ticking ? stageNow(ticking.through) : null), [ticking])
  const record = useMemo(() => watchRecord(session, snapshot.records, snapshot.today.focusedSeconds), [session, snapshot.records, snapshot.today.focusedSeconds])

  // Escape closes the panel. It never ends a session -- see StudentView for why that distinction is kept.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Focus moves into the panel, so the keyboard alone can use it.
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('button')?.focus()
  }, [])

  const rows: { id: string; icon: typeof Target; label: string; detail?: string; run(): void }[] = []

  if (session) {
    rows.push({
      id: 'goal',
      icon: Target,
      label: session.oneThing || session.title,
      detail: session.intention ? `You said: ${session.intention}` : 'The one thing for this session.',
      run: onClose
    })
    rows.push({
      id: 'losing',
      icon: HelpCircle,
      label: "I'm losing focus",
      detail: 'Pick one small thing instead.',
      run: () => setReset(true)
    })
    if (onOpenOrion) {
      rows.push({
        id: 'orion',
        icon: Sparkles,
        label: 'Get unstuck with Orion',
        detail: 'One step, one example, one thing to try.',
        run: () => {
          void call('orion-turn')
          onOpenOrion(
            `I am stuck while studying ${session.subject || session.title}. The task is: ${session.oneThing || session.title}. Ask me what is confusing, then explain the smallest prerequisite, give one example, and give me one small thing to try.`
          )
          onClose()
        }
      })
    }
  } else {
    rows.push({ id: 'start', icon: Play, label: 'Start a session', detail: snapshot.recommendation ? `${snapshot.recommendation.minutes} minutes suggested` : undefined, run: onStart })
    if (snapshot.queue[0]) {
      rows.push({
        id: 'next',
        icon: Timer,
        label: `Next: ${snapshot.queue[0].title}`,
        detail: 'Start a session on this.',
        run: () => {
          void call('start-focus', { taskId: snapshot.queue[0].id, subject: snapshot.queue[0].subject })
          onClose()
        }
      })
    }
  }

  rows.push({ id: 'progress', icon: LineChart, label: 'How am I doing?', detail: `Level ${snapshot.level.level} · ${spell(snapshot.records.totalFocusedSeconds)} focused in all`, run: () => onGo('progress') })
  if (snapshot.due > 0) rows.push({ id: 'review', icon: BookOpen, label: `${snapshot.due} to review`, detail: 'Things ready to come back round.', run: () => onGo('learn') })
  else rows.push({ id: 'learn', icon: BookOpen, label: "Today's learning", detail: 'A word, a concept, a puzzle.', run: () => onGo('learn') })
  if (snapshot.waiting > 0) rows.push({ id: 'later', icon: Compass, label: `${snapshot.waiting} saved for later`, run: () => onGo('later') })
  rows.push({ id: 'orbi', icon: Sparkles, label: `${snapshot.orbi.name}'s room`, detail: tier.name, run: () => onGo('orbi') })

  const resetOptions: { label: string; detail: string; run(): void }[] = [
    {
      label: 'Thirty seconds of nothing',
      detail: 'Breathe. The timer keeps going.',
      run: () => {
        onNotify('Breathe. Back when you are ready.')
        onClose()
      }
    },
    {
      label: 'Make it smaller',
      detail: 'One step instead of the whole thing.',
      run: () => {
        if (onOpenOrion && session) {
          void call('orion-turn')
          onOpenOrion(`Break "${session.oneThing || session.title}" into the smallest possible next step I can do in five minutes. Just the one step.`)
        }
        onClose()
      }
    },
    {
      label: 'Take the break now',
      detail: 'Stand up. Come back.',
      run: () => {
        void call('start-break')
        onClose()
      }
    },
    {
      label: 'Carry on',
      detail: 'Back to it.',
      run: onClose
    }
  ]

  return (
    <div className="orbi-panel-wrap" role="dialog" aria-label={`${snapshot.orbi.name}`} ref={card}>
      <div className="orbi-panel">
        <header>
          <Orbi state={session ? 'focused' : 'ready'} behaviour={prefs.orbi} reducedMotion={prefs.reducedMotion} worn={snapshot.orbi.worn} level={snapshot.level.level} size={56} />
          <div>
            <strong>{snapshot.orbi.name}</strong>
            <span className="st-faint small">
              {session
                ? `${stage?.name ?? 'In Focus'}${ticking ? ` · ${spell(ticking.remaining)} left` : ''}`
                : `Level ${snapshot.level.level} · ${tier.name}`}
            </span>
          </div>
          <button type="button" className="st-icon" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </header>

        {/* Said only when it is true, and only when it is close. */}
        {record ? (
          <p className="orbi-panel-record">
            {record.beaten ? `That is ${record.what} beaten.` : `${spell(record.inSeconds)} from ${record.what}.`}
          </p>
        ) : null}

        {stage?.next && ticking ? (
          <p className="st-faint small">
            Next: {stage.next.name} at {spell(Math.round(stage.next.at * (ticking.elapsed + ticking.remaining)))}
          </p>
        ) : null}

        <ul className="orbi-panel-rows">
          {(reset ? [] : rows).map((row) => (
            <li key={row.id}>
              <button type="button" onClick={row.run}>
                <row.icon size={15} aria-hidden />
                <span>
                  <strong>{row.label}</strong>
                  {row.detail ? <small>{row.detail}</small> : null}
                </span>
              </button>
            </li>
          ))}
          {reset
            ? resetOptions.map((one) => (
                <li key={one.label}>
                  <button type="button" onClick={one.run}>
                    <span>
                      <strong>{one.label}</strong>
                      <small>{one.detail}</small>
                    </span>
                  </button>
                </li>
              ))
            : null}
        </ul>

        {reset ? (
          <button type="button" className="st-btn quiet" onClick={() => setReset(false)}>
            Back
          </button>
        ) : null}
      </div>
    </div>
  )
}
