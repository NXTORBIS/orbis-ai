import { useEffect, useRef, useState } from 'react'
import { rings, sideFor, spotlightFor, travelTime, worthLighting, type Side, type Spot } from '../../../../shared/student/spotlight'

/**
 * A light on the one thing being talked about.
 *
 * ## How the hole is made
 *
 * One element the size of the lit area, with an enormous spread `box-shadow` around it. The shadow darkens the
 * entire window and the element itself casts none over its own box, so what is left is a hole — no masks, no
 * clip paths, no second canvas, and it animates by moving one element. Four darkening panels around a gap would
 * need four animations kept in step and would show a seam the moment anything moved.
 *
 * ## What makes it look like something
 *
 * Four things, layered, and each costs one property:
 *
 *   - **the edge** glows and breathes, so the hole has a rim rather than just stopping;
 *   - **sonar rings** travel outward from that rim and fade, staggered so they chase each other;
 *   - **a sweep** — a conic gradient turning slowly behind the rim, which reads as something scanning the object
 *     rather than a static ring drawn around it;
 *   - **the move**, which is the hole itself travelling from one thing to the next rather than cutting.
 *
 * All of it is transform and opacity. Under reduced motion the hole and the rim remain and everything that moves
 * stops, because the point of the thing — *this* is what I mean — survives perfectly well without motion.
 *
 * ## It never traps a press
 *
 * The darkness lets everything through. Somebody can carry on using the screen while it is lit, which matters:
 * the tour is explaining a real product, and a product you cannot touch while it is explained is a video.
 */

export default function Spotlight({
  mark,
  onPlaced,
  onMissing
}: {
  /** The `data-tour` name of the element to light. Null draws nothing at all. */
  mark: string | null
  /** Where it landed, so Orbi and the words can be placed beside it. */
  onPlaced?(where: { spot: Spot; side: Side }): void
  /** Told when the element is not there, so a tour can move on rather than lighting nothing. */
  onMissing?(): void
}): React.JSX.Element | null {
  const [spot, setSpot] = useState<Spot | null>(null)
  const [moving, setMoving] = useState(0)
  const was = useRef<Spot | null>(null)
  const missed = useRef<string | null>(null)

  useEffect(() => {
    if (!mark) {
      setSpot(null)
      was.current = null
      return
    }

    let stopped = false
    let watcher: MutationObserver | null = null
    const since = Date.now()
    const GRACE = 2200

    const measure = (): void => {
      if (stopped) return
      const element = document.querySelector(`[data-tour="${mark}"]`)
      if (!(element instanceof HTMLElement)) {
        /*
         * A screen that is still arriving is not a missing element.
         *
         * Student loads its screens the first time they are opened, so measuring in the same breath as navigating
         * finds nothing. This waits and watches before giving up.
         */
        if (Date.now() - since < GRACE) {
          if (!watcher) {
            watcher = new MutationObserver(() => measure())
            watcher.observe(document.body, { childList: true, subtree: true })
          }
          return
        }
        if (missed.current !== mark) {
          missed.current = mark
          onMissing?.()
        }
        setSpot(null)
        return
      }

      missed.current = null
      watcher?.disconnect()
      watcher = null

      const box = element.getBoundingClientRect()
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      if (!worthLighting({ left: box.left, top: box.top, width: box.width, height: box.height }, viewport)) {
        setSpot(null)
        return
      }
      const next = spotlightFor({ left: box.left, top: box.top, width: box.width, height: box.height }, viewport)
      setMoving(travelTime(was.current, next))
      was.current = next
      setSpot(next)
      onPlaced?.({ spot: next, side: sideFor(next, viewport) })
    }

    measure()
    const settle = window.setTimeout(measure, 120)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      stopped = true
      watcher?.disconnect()
      window.clearTimeout(settle)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [mark, onPlaced, onMissing])

  if (!mark || !spot) return null

  const style = {
    left: `${spot.left}px`,
    top: `${spot.top}px`,
    width: `${spot.width}px`,
    height: `${spot.height}px`,
    borderRadius: `${spot.radius}px`,
    // How long the light takes to travel is the engine's number, so the CSS cannot disagree with it.
    transitionDuration: `${moving}ms`
  } as React.CSSProperties

  return (
    <div className="st-spot-layer" aria-hidden>
      {/* The hole: one element, one huge shadow, and the darkness is whatever the shadow covers. */}
      <div className="st-spot" style={style}>
        {/* The sweep, turning slowly behind the rim. */}
        <span className="st-spot-sweep" style={{ borderRadius: `${spot.radius}px` }} />
      </div>

      {/* The rings, travelling outward from the rim. Same shape as the hole, so they look like it is pulsing. */}
      {rings(spot).map((one, index) => (
        <span
          key={index}
          className="st-spot-ring"
          style={
            {
              left: `${spot.left}px`,
              top: `${spot.top}px`,
              width: `${spot.width}px`,
              height: `${spot.height}px`,
              borderRadius: `${spot.radius}px`,
              animationDelay: `${one.delay}s`,
              ['--st-ring-to' as string]: String(one.scale)
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
