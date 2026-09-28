import { useCallback, useEffect, useRef, useState } from 'react'
import type { EquityBar } from '../../../../shared/markets/backtest'

/**
 * A backtest's equity against buying and holding.
 *
 * Two lines, one scale, because that is the comparison: a strategy that returned 8% while the market returned 40% has
 * not done well, and showing each on its own axis would hide that. Both start from the same money on the same bar.
 *
 * The shaded stretches are the bars with a position open. A strategy that made its return while in the market for three
 * percent of the time is a different thing from one that was always in, and the shape says so without a number.
 */

const token = (name: string, fallback: string): string => {
  try {
    const found = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return found || fallback
  } catch {
    return fallback
  }
}

export default function EquityChart({
  equity,
  height = 200
}: {
  equity: EquityBar[]
  height?: number
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setWidth(Math.max(0, Math.floor(box.width)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const context = canvas.getContext('2d')
    if (!context) return

    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * ratio)
    canvas.height = Math.floor(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)

    const faint = token('--faint', '#6e727b')
    if (equity.length < 2) {
      context.fillStyle = faint
      context.font = '12px system-ui, sans-serif'
      context.textAlign = 'center'
      context.fillText('Not enough bars to draw a curve.', width / 2, height / 2)
      return
    }

    const cyan = token('--cyan', '#3fd8ff')
    const muted = token('--muted', '#a2a6ae')
    const axis = 58
    const plot = width - axis
    const step = plot / (equity.length - 1)

    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (const bar of equity) {
      for (const value of [bar.equity, bar.benchmark]) {
        if (Number.isFinite(value)) {
          low = Math.min(low, value)
          high = Math.max(high, value)
        }
      }
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) return
    if (high === low) high = low + Math.abs(low || 1) * 0.01
    const pad = (high - low) * 0.08
    const top = high + pad
    const bottom = low - pad
    const yFor = (value: number): number => height - 14 - ((value - bottom) / (top - bottom)) * (height - 28)

    // Shaded where a position was open.
    context.fillStyle = 'rgba(63, 216, 255, 0.07)'
    let runStart: number | null = null
    for (let i = 0; i <= equity.length; i++) {
      const inPosition = equity[i]?.inPosition === true
      if (inPosition && runStart === null) runStart = i
      if (!inPosition && runStart !== null) {
        context.fillRect(runStart * step, 0, Math.max(1, (i - runStart) * step), height - 14)
        runStart = null
      }
    }

    const line = (pick: (bar: EquityBar) => number, colour: string, dashed: boolean): void => {
      context.strokeStyle = colour
      context.lineWidth = dashed ? 1 : 1.6
      context.setLineDash(dashed ? [4, 4] : [])
      context.beginPath()
      equity.forEach((bar, i) => {
        const value = pick(bar)
        if (!Number.isFinite(value)) return
        const x = i * step
        const y = yFor(value)
        if (i === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.stroke()
      context.setLineDash([])
    }

    // Buy and hold underneath, dashed, so the strategy reads as the subject and the benchmark as the yardstick.
    line((bar) => bar.benchmark, muted, true)
    line((bar) => bar.equity, cyan, false)

    context.font = '11px system-ui, sans-serif'
    context.fillStyle = faint
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    for (const value of [top, (top + bottom) / 2, bottom]) {
      context.fillText(Math.round(value).toLocaleString(), plot + 6, yFor(value))
    }

    if (hover !== null && equity[hover]) {
      const bar = equity[hover]
      const x = Math.round(hover * step) + 0.5
      context.strokeStyle = 'rgba(255,255,255,0.25)'
      context.setLineDash([3, 3])
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, height - 14)
      context.stroke()
      context.setLineDash([])
      context.fillStyle = token('--text', '#ededef')
      context.textAlign = hover > equity.length / 2 ? 'right' : 'left'
      const label = `${new Date(bar.at).toLocaleDateString()} · ${Math.round(bar.equity).toLocaleString()} vs ${Math.round(bar.benchmark).toLocaleString()}`
      context.fillText(label, hover > equity.length / 2 ? x - 6 : x + 6, 10)
    }
  }, [equity, width, height, hover])

  useEffect(() => {
    const frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [draw])

  return (
    <div className="mk-equity" ref={wrapRef} style={{ height }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const x = event.clientX - box.left
          const step = (box.width - 58) / Math.max(1, equity.length - 1)
          setHover(Math.max(0, Math.min(equity.length - 1, Math.round(x / step))))
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Equity over ${equity.length} bars, against buying and holding the same market.`}
      />
      <p className="mk-equity-key">
        <span className="strategy">Strategy</span>
        <span className="benchmark">Buy and hold</span>
        <span className="held">Shaded: a position was open</span>
      </p>
    </div>
  )
}
