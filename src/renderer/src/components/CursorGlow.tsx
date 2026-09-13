import { useEffect, useRef } from 'react'

const INTERACTIVE = 'button, a, input, textarea, select, [role="button"], [role="option"]'

/** A glowing ring that eases after the pointer and grows over clickable elements. */
export default function CursorGlow(): React.JSX.Element {
  const ringRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ring = ringRef.current
    if (!ring) return
    let x = 0
    let y = 0
    let targetX = 0
    let targetY = 0
    let frame = 0
    let placed = false

    const step = (): void => {
      x += (targetX - x) * 0.28
      y += (targetY - y) * 0.28
      ring.style.transform = `translate3d(${x}px, ${y}px, 0)`
      frame = Math.abs(targetX - x) + Math.abs(targetY - y) > 0.3 ? requestAnimationFrame(step) : 0
    }

    const onMove = (e: PointerEvent): void => {
      targetX = e.clientX
      targetY = e.clientY
      if (!placed) {
        x = targetX
        y = targetY
        placed = true
      }
      ring.classList.add('visible')
      ring.classList.toggle('active', Boolean((e.target as Element | null)?.closest?.(INTERACTIVE)))
      if (!frame) frame = requestAnimationFrame(step)
    }
    const onLeave = (): void => ring.classList.remove('visible')
    const onDown = (): void => ring.classList.add('pressed')
    const onUp = (): void => ring.classList.remove('pressed')

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <div ref={ringRef} className="cursor-glow" aria-hidden="true">
      <span />
    </div>
  )
}
