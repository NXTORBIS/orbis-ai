/**
 * The little of framer-motion the ported chemistry pages use, without the package.
 *
 * Orbis does not ship framer-motion, and adding a whole animation library to fade six panels in would be a lot of
 * weight for very little. These keep the same shape — `motion.div`, `motion.button`, `AnimatePresence` — so none
 * of the user's pages needs editing, and do the animation in CSS instead.
 *
 * The motion props are read rather than dropped: `initial` and `animate` become a short fade-and-rise, which is
 * what every one of those pages is asking for. Anything else is ignored on purpose rather than approximated —
 * an animation that is nearly right reads as a bug, and no animation reads as a choice.
 *
 * `prefers-reduced-motion` is honoured by the stylesheet, so this does not need to check it.
 */
import React, { forwardRef } from 'react'

/** Props that belong to the animation and must never reach the DOM, where React would warn about each one. */
const MOTION_PROPS = new Set([
  'initial',
  'animate',
  'exit',
  'transition',
  'variants',
  'whileHover',
  'whileTap',
  'whileInView',
  'viewport',
  'layout',
  'layoutId',
  'drag',
  'dragConstraints',
  'onAnimationComplete'
])

const make = (Tag) =>
  forwardRef(function Motion({ children, className = '', style, ...rest }, ref) {
    const mine = {}
    for (const [key, value] of Object.entries(rest)) {
      if (!MOTION_PROPS.has(key)) mine[key] = value
    }
    /*
     * One class, one keyframe. The duration comes from the transition when one was given, so a page that asked
     * for a slow reveal still gets one, within reason -- a five-second fade would read as the screen hanging.
     */
    const asked = Number(rest.transition?.duration)
    const seconds = Number.isFinite(asked) ? Math.min(1.2, Math.max(0.08, asked)) : 0.26
    return (
      <Tag
        ref={ref}
        className={`jx-rise ${className}`.trim()}
        style={{ ...style, animationDuration: `${seconds}s` }}
        {...mine}
      >
        {children}
      </Tag>
    )
  })

export const motion = new Proxy(
  {},
  {
    get: (held, tag) => {
      if (typeof tag !== 'string') return undefined
      if (!held[tag]) held[tag] = make(tag)
      return held[tag]
    }
  }
)

/**
 * Renders its children and nothing more.
 *
 * Without the library there is no way to hold a removed element on screen while it fades out, so it leaves at
 * once. That is the honest version: the alternative is keeping something mounted that the page has already
 * decided is gone.
 */
export function AnimatePresence({ children }) {
  return <>{children}</>
}

export default motion
