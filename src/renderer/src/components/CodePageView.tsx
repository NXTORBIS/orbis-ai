import { useEffect, useRef } from 'react'

/**
 * The region of the Orbis window a Page written as code is shown in.
 *
 * The Page itself is not React and is not in this window's document: it is a sandboxed frame the main process owns,
 * placed over this rectangle. So this component draws nothing. Its whole job is to measure where it is and tell the
 * main process, the same way the browser region does -- because the renderer owns the layout and is the only thing
 * that knows where the Page area actually ended up.
 *
 * Measured on a ResizeObserver and on a slow interval. The observer catches the ordinary cases; the interval catches
 * the ones it cannot see -- a zoom change, a move to another monitor -- where the rectangle moves without this
 * element's size changing at all.
 */
export default function CodePageView({ hidden }: { hidden: boolean }): React.JSX.Element {
  const region = useRef<HTMLDivElement>(null)
  const live = useRef({ hidden })
  live.current.hidden = hidden

  useEffect(() => {
    const el = region.current
    if (!el) return

    let last = ''
    const send = (): void => {
      const r = el.getBoundingClientRect()
      const message = {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        visible: !live.current.hidden && r.width > 0 && r.height > 0
      }
      // Sent only when it changed: this runs four times a second and the channel is one-way, so a repeat is pure noise.
      const key = JSON.stringify(message)
      if (key === last) return
      last = key
      window.api.pagesCodeRegion(message)
    }

    const observer = new ResizeObserver(send)
    observer.observe(el)
    observer.observe(document.documentElement)
    window.addEventListener('resize', send)
    const poll = window.setInterval(send, 250)
    send()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', send)
      window.clearInterval(poll)
      /*
       * Zero on the way out, so a Page stops painting when its region is gone.
       *
       * Without this the frame keeps its last rectangle and stays over whatever replaced it -- a Page drawn on top of
       * the chat, still animating, with nothing on screen explaining where it came from.
       */
      window.api.pagesCodeRegion({ x: 0, y: 0, width: 0, height: 0, visible: false })
    }
  }, [hidden])

  return (
    <div className="code-page-view" hidden={hidden}>
      <div className="code-page-region" ref={region} data-testid="code-page-region" />
    </div>
  )
}
