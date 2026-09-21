import { useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'

/**
 * The browser view: the region of the Orbis window that Chromium's own window sits in (the main process places the native window
 * over it). It measures itself and tells the main process; a header keeps "Return to chat" (the browser stays open behind it).
 */
export default function BrowserView({ hidden, onBackToChat }: { hidden: boolean; onBackToChat: () => void }): React.JSX.Element {
  const region = useRef<HTMLDivElement>(null)
  const live = useRef({ hidden })
  live.current.hidden = hidden

  useEffect(() => {
    const el = region.current
    if (!el) return
    let last = ''
    const send = (visible: boolean): void => {
      const r = el.getBoundingClientRect()
      const msg = { x: r.left, y: r.top, width: r.width, height: r.height, dpr: window.devicePixelRatio, viewportWidth: document.documentElement.clientWidth, visible: visible && !live.current.hidden }
      const key = JSON.stringify(msg)
      if (key === last) return
      last = key
      window.api.chromiumEmbedRegion(msg)
    }
    const measure = (): void => send(true)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(document.documentElement)
    window.addEventListener('resize', measure)
    const poll = window.setInterval(measure, 250) // catches moves the observers cannot see (zoom, monitor changes)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.clearInterval(poll)
      window.api.chromiumEmbedRegion({ x: 0, y: 0, width: 0, height: 0, dpr: window.devicePixelRatio || 1, visible: false })
    }
  }, [hidden])

  return (
    <div className="browser-view" hidden={hidden}>
      <div className="browser-view-bar">
        <button type="button" className="browser-back-chat" title="Back to the Orbis chat. The browser stays open" onClick={onBackToChat}>
          <ArrowLeft size={15} />
          <span>Return to chat</span>
        </button>
      </div>
      <div className="browser-view-region" ref={region} data-testid="browser-view-region" />
    </div>
  )
}
