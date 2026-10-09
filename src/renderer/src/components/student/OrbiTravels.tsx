import { useEffect, useRef, useState } from 'react'
import Orbi from './Orbi'
import { headingOf, shouldWalk, trailOf, walkTime, type Expression, type Pose } from '../../../../shared/student/orbiCharacter'
import type { OrbiBehaviour } from '../../../../shared/student/types'

/**
 * Orbi getting from one place to another.
 *
 * ## It glides, and leaves something behind
 *
 * Legs tucked, leaning into the move, riding its own ring, with a line of fading motes along the path it has
 * already covered. Every mote sits on ground Orbi has actually crossed, never ahead of it, which is what makes
 * the movement read as travel rather than as a cut.
 *
 * ## It is told where to go, not what to point at
 *
 * This takes a point. Working out *which* point — beside the spotlight, out of its way, on the side with room —
 * belongs to `spotlight.ts`, so the same travelling works for anything that wants to move Orbi somewhere.
 *
 * ## It never traps a press
 *
 * `pointer-events: none`, always. Orbi standing in front of something must not be the reason somebody cannot
 * press it.
 */

export default function OrbiTravels({
  to,
  size = 72,
  flip = false,
  pose,
  expression,
  behaviour,
  reducedMotion,
  worn = [],
  level = 1
}: {
  /** Where to be, in pixels on the page. Null draws nothing. */
  to: { x: number; y: number } | null
  size?: number
  flip?: boolean
  pose: Pose
  expression: Expression
  behaviour: OrbiBehaviour
  reducedMotion: boolean
  worn?: readonly string[]
  level?: number
}): React.JSX.Element | null {
  const [travel, setTravel] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; startedAt: number; length: number; heading: number } | null>(null)
  const [through, setThrough] = useState(1)
  const was = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!to) {
      was.current = null
      setTravel(null)
      return
    }
    const from = was.current
    was.current = { x: to.x, y: to.y }
    if (!from || !shouldWalk(from, to, reducedMotion)) {
      setTravel(null)
      setThrough(1)
      return
    }
    setTravel({ from, to: { x: to.x, y: to.y }, startedAt: Date.now(), length: walkTime(from, to), heading: headingOf(from, to) })
    setThrough(0)
  }, [to?.x, to?.y, reducedMotion, to])

  /*
   * The glide itself, one frame at a time.
   *
   * Only while travelling: the loop starts when a move begins and stops the moment it lands, so a settled Orbi
   * costs nothing at all. Without it the trail would have no path to sit along.
   */
  useEffect(() => {
    if (!travel) return
    let handle = 0
    const tick = (): void => {
      const at = (Date.now() - travel.startedAt) / travel.length
      if (at >= 1) {
        setThrough(1)
        setTravel(null)
        return
      }
      setThrough(at)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [travel])

  if (!to) return null

  const moving = travel !== null && through < 1
  const at = moving && travel ? { x: travel.from.x + (travel.to.x - travel.from.x) * through, y: travel.from.y + (travel.to.y - travel.from.y) * through } : to
  const trail = moving && travel ? trailOf(travel.from, travel.to, through) : []

  return (
    <>
      {/* The trail: motes on ground Orbi has already crossed, oldest and faintest furthest back. */}
      {trail.map((one, index) => (
        <span
          key={index}
          className="orbi-trail-mote"
          aria-hidden
          style={{
            left: `${one.x}px`,
            top: `${one.y}px`,
            opacity: one.fade * 0.75,
            width: `${Math.max(4, size * 0.16 * one.fade)}px`,
            height: `${Math.max(4, size * 0.16 * one.fade)}px`,
            transform: `translate(-50%, -50%) rotate(${travel?.heading ?? 0}deg) scaleX(${1 + one.fade * 1.6})`
          }}
        />
      ))}

      <div
        className={`st-tour-orbi-at${moving ? ' gliding' : ''}`}
        style={{
          left: `${at.x}px`,
          top: `${at.y}px`,
          // While gliding the position comes frame by frame, so a transition would fight it.
          transitionDuration: moving ? '0ms' : '220ms'
        }}
      >
        <Orbi
          state="ready"
          behaviour={behaviour}
          reducedMotion={reducedMotion}
          // Gliding overrides the asked pose: Orbi cannot be reading something while on its way across the screen.
          pose={moving ? 'glide' : pose}
          expression={expression}
          flip={moving ? (travel?.heading ?? 0) > 90 || (travel?.heading ?? 0) < -90 : flip}
          size={size}
          worn={worn}
          level={level}
        />
      </div>
    </>
  )
}
