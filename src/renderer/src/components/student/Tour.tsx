import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Play, X } from 'lucide-react'
import Orbi from './Orbi'
import Spotlight from './Spotlight'
import OrbiTravels from './OrbiTravels'
import { bubbleBeside, orbiBeside, type Side, type Spot } from '../../../../shared/student/spotlight'
import { TOUR, indexOfStep, nextShowable, previousStep, tourProgress, type TourScreen, type TourStep } from '../../../../shared/student/tour'
import type { Pose } from '../../../../shared/student/orbiCharacter'
import type { OrbiBehaviour } from '../../../../shared/student/types'

/**
 * Orbi showing somebody round.
 *
 * ## The light points, not Orbi
 *
 * Everything except the thing being explained goes dark, and that thing is lit. Orbi stands beside it with its
 * hands to itself and looks at it. This replaced Orbi growing an arm: at the size Orbi actually appears, an arm
 * aimed across a card is ambiguous, and exactly one lit object on a dark screen cannot be. It also works on
 * anything — a button, a panel, a row — where an arm only works on something small and nearby.
 *
 * ## It drives the real product
 *
 * Each step names a real Student screen and a real element on it. The tour navigates there and lights the actual
 * thing, so "this is Focus" is said while Focus is on screen rather than over a drawing of it.
 *
 * ## Leaving is always one press
 *
 * "Skip the tour" sits on every step and works immediately. Where it got to is remembered, so leaving is never
 * the same as losing it.
 */

/**
 * What Orbi does while the light does the pointing.
 *
 * Nothing that needs an arm. A step that asked for a point or a press becomes a look, because the light has
 * already said which thing — and Orbi reaching for something that is lit is two answers to one question.
 */
function withoutHands(pose: Pose): Pose {
  switch (pose) {
    case 'point':
    case 'press':
    case 'carry':
      return 'look-around'
    case 'wave':
    case 'shield':
    case 'sit':
    case 'read':
    case 'write':
      return pose
    default:
      return pose
  }
}

export default function Tour({
  behaviour,
  reducedMotion,
  startAt,
  screen,
  onGo,
  onFinish,
  onLeave,
  worn = [],
  level = 1
}: {
  behaviour: OrbiBehaviour
  reducedMotion: boolean
  /** Where to pick up from. Null starts at the beginning. */
  startAt?: string | null
  /** The screen the Student view is on now, so the step waits until the navigation has happened. */
  screen: TourScreen
  onGo(to: TourScreen): void
  /** The end of the tour: offers the first session. */
  onFinish(): void
  /** Left deliberately. Carries where it got to, so it can be resumed. */
  onLeave(at: string): void
  worn?: readonly string[]
  level?: number
}): React.JSX.Element | null {
  const [id, setId] = useState<string | null>(startAt ?? TOUR[0].id)
  const [lit, setLit] = useState<{ spot: Spot; side: Side } | null>(null)
  const step: TourStep | null = useMemo(() => TOUR.find((one) => one.id === id) ?? null, [id])

  // Asks the view to navigate the moment the step changes. The step's own body waits for it to arrive.
  useEffect(() => {
    if (step && step.screen !== screen) onGo(step.screen)
  }, [step, screen, onGo])

  // A new step means a new thing to light; the old placement would put the words beside the wrong one.
  useEffect(() => {
    setLit(null)
  }, [id])

  const marksOnScreen = useCallback((): string[] => {
    return [...document.querySelectorAll('[data-tour]')]
      .map((one) => one.getAttribute('data-tour'))
      .filter((one): one is string => one !== null)
  }, [])

  const go = useCallback(() => {
    if (!step) return
    // The screen matters: a step elsewhere is decided after navigating there, not from what is here now.
    const next = nextShowable(step.id, marksOnScreen(), screen)
    if (!next) {
      onFinish()
      return
    }
    setId(next.id)
  }, [step, marksOnScreen, onFinish, screen])

  const back = useCallback(() => {
    const before = previousStep(id)
    if (before) setId(before.id)
  }, [id])

  const onMissing = useCallback(() => {
    if (!step || step.mark === null) return
    go()
  }, [step, go])

  const placed = useCallback((where: { spot: Spot; side: Side }) => setLit(where), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        event.preventDefault()
        onLeave(id ?? TOUR[0].id)
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault()
        go()
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [id, go, back, onLeave])

  if (!step) return null

  const arrived = step.screen === screen
  const where = tourProgress(step.id)
  const last = indexOfStep(step.id) === TOUR.length - 1
  const lighting = arrived && step.mark !== null

  const viewport = typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight }
  const orbiSize = 76
  const orbiAt = lit ? orbiBeside(lit.spot, lit.side, orbiSize, viewport) : null
  const bubbleAt = lit ? bubbleBeside(lit.spot, lit.side, viewport) : null

  const controls = (
    <div className="st-tour-foot">
      <span className="st-faint small">{where.says}</span>
      <div className="st-row-actions">
        {indexOfStep(step.id) > 0 ? (
          <button type="button" className="st-btn quiet" onClick={back}>
            <ArrowLeft size={15} aria-hidden /> Back
          </button>
        ) : null}
        {/* Always here, always works, on every single step. */}
        <button type="button" className="st-btn quiet" onClick={() => onLeave(step.id)}>
          <X size={15} aria-hidden /> Skip the tour
        </button>
        <button type="button" className="st-btn primary" onClick={last ? onFinish : go}>
          {last ? <Play size={15} aria-hidden /> : null}
          {step.next ?? 'Next'}
          {last ? null : <ArrowRight size={15} aria-hidden />}
        </button>
      </div>
    </div>
  )

  return (
    <div className="st-tour" role="dialog" aria-modal="false" aria-label="Orbi is showing you round">
      {/*
        * The dim veil, only when nothing is lit.
        *
        * The spotlight brings its own darkness, and two layers of it would make the lit thing look washed out
        * rather than bright.
        */}
      {!lighting ? <div className="st-tour-veil" aria-hidden /> : null}

      {lighting ? <Spotlight mark={step.mark} onPlaced={placed} onMissing={onMissing} /> : null}

      {/* Orbi beside the light, hands to itself, gliding there with its trail and then looking at the thing. */}
      {lighting ? (
        <OrbiTravels
          to={orbiAt ? { x: orbiAt.x, y: orbiAt.y } : null}
          flip={orbiAt?.flip ?? false}
          pose={withoutHands(step.pose)}
          expression={step.expression}
          behaviour={behaviour}
          reducedMotion={reducedMotion}
          size={orbiSize}
          worn={worn}
          level={level}
        />
      ) : null}

      {lighting ? (
        bubbleAt ? (
          <div className="st-tour-bubble" style={{ left: `${bubbleAt.left}px`, top: `${bubbleAt.top}px`, width: '320px' }} role="status" aria-live="polite">
            <p className="st-tour-says">{step.says}</p>
            <div className="st-tour-dots" role="presentation">
              {TOUR.map((one) => (
                <span key={one.id} className={`st-tour-dot${one.id === step.id ? ' on' : ''}`} />
              ))}
            </div>
            {controls}
          </div>
        ) : null
      ) : (
        /* About a whole screen rather than one thing on it: Orbi stands in the card and says it from there. */
        <div className="st-tour-card">
          <div className="st-tour-orbi">
            <Orbi
              state="ready"
              behaviour={behaviour}
              reducedMotion={reducedMotion}
              pose={step.pose}
              expression={step.expression}
              size={88}
              worn={worn}
              level={level}
            />
          </div>
          <p className="st-tour-says">{step.says}</p>
          <div className="st-tour-dots" role="presentation">
            {TOUR.map((one) => (
              <span key={one.id} className={`st-tour-dot${one.id === step.id ? ' on' : ''}`} />
            ))}
          </div>
          {controls}
        </div>
      )}
    </div>
  )
}
