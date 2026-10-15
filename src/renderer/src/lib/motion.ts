import { useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

/** True when the person (or the system) asked for less motion. Read at the moment of use, never cached. */
export const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Runs a state change as a shared-element transition where the browser supports it, so a card that is clicked can
 * grow into the screen it opens. The change is applied synchronously inside the transition (that is what the browser
 * needs to take its "after" picture). Without support, or with reduced motion, it is just the change.
 */
export function withTransition(change: () => void): void {
  const d = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> } }
  if (!d.startViewTransition || reducedMotion() || document.visibilityState === 'hidden') {
    change()
    return
  }
  // A transition can be skipped (the page was hidden, another began): the change still happens, and a skipped
  // transition is not an error worth surfacing.
  const t = d.startViewTransition(() => flushSync(change))
  for (const p of [t.ready, t.finished, t.updateCallbackDone]) p.catch(() => undefined)
}

/**
 * Lets a list reorder smoothly. Give it a container and a key that changes when the list does; every direct child
 * with `data-flip="<id>"` slides from where it was to where it is now, and a child that is new fades up.
 */
export function useFlip(container: React.RefObject<HTMLElement | null>, key: unknown): void {
  const before = useRef<Map<string, DOMRect>>(new Map())
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-flip]')]
    const now = new Map<string, DOMRect>()
    for (const el of nodes) now.set(el.dataset.flip as string, el.getBoundingClientRect())
    if (!reducedMotion()) {
      for (const el of nodes) {
        const id = el.dataset.flip as string
        const was = before.current.get(id)
        const is = now.get(id) as DOMRect
        if (was) {
          const dy = was.top - is.top
          if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)' })
        } else if (before.current.size > 0) {
          el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 170, easing: 'ease-out' })
        }
      }
    }
    before.current = now
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** Which Arena card a screen was opened from, so closing it can fold back into that card. Read once, then cleared. */
let arenaReturn: 'football' | 'f1' | null = null
export const setArenaReturn = (id: 'football' | 'f1' | null): void => {
  arenaReturn = id
}
export const peekArenaReturn = (): 'football' | 'f1' | null => arenaReturn
