import { useEffect, useRef } from 'react'
import { startBackdrop } from '../../../shared/backdrop'

/**
 * Gradient + grid backdrop with the drifting starfield drawn on a canvas.
 *
 * The drawing itself is in `shared/backdrop.ts` rather than here. It used to live in this file, which meant the
 * browser -- the same application, a window away -- had no way to draw it and showed a flat colour instead. One
 * implementation now, mounted by both.
 */
export default function HudBackground({ animated }: { animated: boolean }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !animated) return
    /*
     * The page, as the shared drawing describes it.
     *
     * The drawing is used by the browser as well, so it has no platform of its own and is handed the few things it
     * needs. Here they come from this document.
     */
    const backdrop = startBackdrop(
      canvas,
      {
        get hidden() {
          return document.hidden
        },
        addEventListener: (type, listener) => document.addEventListener(type, listener),
        removeEventListener: (type, listener) => document.removeEventListener(type, listener),
        createCanvas: () => document.createElement('canvas'),
        get devicePixelRatio() {
          return window.devicePixelRatio
        },
        requestFrame: (run) => window.requestAnimationFrame(run),
        cancelFrame: (handle) => window.cancelAnimationFrame(handle)
      },
      { animated: true }
    )
    // The canvas fills the window, so the window changing size is the only thing that changes its size.
    window.addEventListener('resize', backdrop.resize)
    return () => {
      window.removeEventListener('resize', backdrop.resize)
      backdrop.stop()
    }
  }, [animated])

  return (
    <div className="hud-bg" aria-hidden="true">
      <div className="hud-grid" />
      {animated && <canvas ref={canvasRef} className="hud-particles" />}
    </div>
  )
}
