import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  calculate,
  indicatorInfo,
  type Candle,
  type IndicatorKind,
  type Series
} from '../../../../shared/markets/indicators'
import {
  anchorsFor,
  DRAWING_INFO,
  boundsOf,
  channelOffset,
  fibLevels,
  inView,
  priceAt,
  type Anchor,
  type Drawing,
  type DrawingKind
} from '../../../../shared/markets/drawings'

/**
 * The chart.
 *
 * Real candles from the provider, drawn on a canvas. The reason it is a canvas and not a few hundred DOM nodes is the
 * update rate: the current candle changes whenever the price does, and re-laying out a element per bar at that rate is how
 * a chart makes the rest of the browser stutter.
 *
 * What it will not do:
 *
 *  - **It never draws a candle that did not happen.** A gap in the data is a gap on the screen. Nothing is interpolated
 *    across it, because a straight line through a missing hour looks exactly like an hour in which the price did not move.
 *  - **It never draws an indicator before it has enough bars.** Every series here is the same length as the candle array
 *    with nulls where the period has not elapsed, and a null is a break in the line rather than a zero.
 *  - **The crosshair reports the candle it is over**, not an interpolation between two.
 *
 * Panning left asks the page for more history through `onNeedHistory`; the page fetches and the viewport stays where it
 * was, because a chart that jumped back to the latest bar every time it loaded more would be unusable.
 */

export type ChartType = 'candles' | 'line' | 'area' | 'ohlc'

export interface ChartIndicator {
  kind: IndicatorKind
  options: Record<string, number>
}

/** Where an indicator's output goes: over the price, or in its own pane underneath. */
const OVERLAYS = new Set<IndicatorKind>(['sma', 'ema', 'wma', 'vwap', 'bollinger', 'keltner'])

/** Distinct enough to tell apart, and from the Orbis palette rather than invented per chart. */
const LINE_COLOURS = ['#3fd8ff', '#ffbe4d', '#c39bff', '#3ee58a', '#ff7b9c', '#ffe066']

export interface MarketChartProps {
  candles: Candle[]
  /** For the axis labels. Not used for anything numeric. */
  interval: string
  type: ChartType
  indicators: ChartIndicator[]
  /** How many decimals the price is quoted to, so the axis does not invent precision or hide movement. */
  precision: number
  /**
   * Turns a price in the market's own currency into text in the currency being displayed.
   *
   * Passed in rather than done here, so the axis, the crosshair and the readout beneath all come from the one currency
   * hook. Without it the axis drew the source-currency number while the readout showed a converted one, and the two
   * disagreed on screen about what the same candle closed at.
   */
  priceText?(value: number): string
  showVolume: boolean
  /** Told what the pointer is over, so the page can show the OHLC of that bar outside the canvas. */
  onHover?(candle: Candle | null, values: { label: string; value: number | null }[]): void
  /** Asked for older candles when the viewport reaches the left edge of what is loaded. */
  onNeedHistory?(): void
  /** Set while older candles are being fetched, so the chart can say so rather than looking stuck. */
  loadingHistory?: boolean
  height?: number

  // ---------------------------------------------------------------- annotations

  /**
   * The drawings on this market, in time and price.
   *
   * Never pixels. Where each one lands is worked out here on every frame from the current scales, which is what lets a
   * line survive zooming, panning, resizing and being reopened next week.
   */
  drawings?: readonly Drawing[]
  /** The tool armed in the toolbar. Null means the chart pans and zooms as usual. */
  tool?: DrawingKind | null
  /** Which drawing is selected, so it can be shown with its handles. */
  selectedDrawing?: string | null
  /** A drawing finished: every anchor its kind needs has been placed. */
  onDrawingPlaced?(kind: DrawingKind, anchors: Anchor[]): void
  /** A drawing clicked. Null when the click landed on empty chart. */
  onDrawingPicked?(id: string | null): void
  /** An anchor dragged to a new place. */
  onDrawingMoved?(id: string, index: number, to: Anchor): void
}

/** The scales of the last frame, so the pointer can be turned back into a time and a price. */
interface Scales {
  step: number
  plotWidth: number
  priceHeight: number
  top: number
  bottom: number
  /** The first visible candle's time, and how long a bar lasts. Together these map a time to a column. */
  firstTime: number
  barMs: number
}

const PRICE_PADDING = 0.06
const AXIS_WIDTH = 64
const TIME_HEIGHT = 22
const PANE_GAP = 8
const MIN_BARS = 12

const niceNumber = (value: number, precision: number): string => {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  // Enough digits to see the movement, few enough to read. A price of 0.00001234 needs more than two decimals; one of
  // 84,000 does not need eight.
  const digits = abs >= 1000 ? Math.min(2, precision) : abs >= 1 ? Math.min(4, precision) : precision
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: Math.max(0, digits) })
}

export const compactNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toFixed(2)
}

const timeLabel = (ms: number, interval: string): string => {
  const date = new Date(ms)
  if (!Number.isFinite(ms)) return ''
  // Days and above get a date; anything intraday gets a clock, because a row of identical dates says nothing.
  const daily = interval === '1d' || interval === '1w' || interval === '1M'
  return daily
    ? date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** A theme value, read from the stylesheet so the chart follows Orbis rather than carrying its own palette. */
const token = (name: string, fallback: string): string => {
  try {
    const found = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return found || fallback
  } catch {
    return fallback
  }
}

export default function MarketChart({
  candles,
  interval,
  type,
  indicators,
  precision,
  priceText,
  showVolume,
  onHover,
  onNeedHistory,
  loadingHistory = false,
  height = 380,
  drawings = [],
  tool = null,
  selectedDrawing = null,
  onDrawingPlaced,
  onDrawingPicked,
  onDrawingMoved
}: MarketChartProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height })

  /** How many bars are visible, and how far the right edge is from the newest bar. */
  const [view, setView] = useState({ bars: 120, offset: 0 })
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; offset: number } | null>(null)
  /**
   * The scales the last frame used.
   *
   * A ref rather than state: the pointer handler needs the same mapping the canvas just drew with, and putting it in
   * state would mean a render between drawing and being able to read it back -- so a click would use the scales from
   * one frame ago, which on a live chart is a different price.
   */
  const scales = useRef<Scales | null>(null)
  /** Anchors placed so far for the drawing being made. Empty when nothing is being drawn. */
  const [placing, setPlacing] = useState<Anchor[]>([])
  /** The anchor being dragged: which drawing, which anchor. */
  const dragAnchor = useRef<{ id: string; index: number } | null>(null)

  // Arming a different tool abandons a half-placed drawing rather than mixing its anchors into the new one.
  useEffect(() => {
    setPlacing([])
  }, [tool])
  /** So asking for history does not repeat every frame while the viewport sits at the left edge. */
  const askedFor = useRef(0)

  // ---------------------------------------------------------------- indicators

  /**
   * Every indicator, calculated once per candle set.
   *
   * Memoised on the candles and the configuration, which is what keeps a live chart from recomputing an EMA over three
   * hundred bars on every tick of the current one.
   */
  const computed = useMemo(() => {
    return indicators.map((one, index) => {
      const info = indicatorInfo(one.kind)
      let series: Record<string, Series> = {}
      try {
        series = calculate(one.kind, candles, one.options)
      } catch {
        // An indicator that cannot be computed draws nothing. It does not take the chart with it.
        series = {}
      }
      const label = `${info?.name ?? one.kind}${Object.values(one.options).length ? ` ${Object.values(one.options).join(', ')}` : ''}`
      return { ...one, info, series, label, overlay: OVERLAYS.has(one.kind), colour: LINE_COLOURS[index % LINE_COLOURS.length] }
    })
  }, [candles, indicators])

  const panes = useMemo(() => computed.filter((one) => !one.overlay), [computed])

  // ---------------------------------------------------------------- size

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setSize({ width: Math.max(0, Math.floor(box.width)), height: Math.max(120, Math.floor(box.height)) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // ---------------------------------------------------------------- the viewport

  const visible = useMemo(() => {
    if (candles.length === 0) return { from: 0, to: 0, rows: [] as Candle[] }
    const bars = Math.max(MIN_BARS, Math.min(candles.length, Math.round(view.bars)))
    const to = Math.max(bars, Math.min(candles.length, candles.length - Math.round(view.offset)))
    const from = Math.max(0, to - bars)
    return { from, to, rows: candles.slice(from, to) }
  }, [candles, view])

  // Reaching the left edge of what is loaded is a request for more, once per arrival of new data.
  useEffect(() => {
    if (!onNeedHistory || loadingHistory) return
    if (candles.length === 0) return
    if (visible.from > 2) return
    if (askedFor.current === candles.length) return
    askedFor.current = candles.length
    onNeedHistory()
  }, [visible.from, candles.length, onNeedHistory, loadingHistory])

  // ---------------------------------------------------------------- drawing

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0) return
    const context = canvas.getContext('2d')
    if (!context) return

    const ratio = window.devicePixelRatio || 1
    if (canvas.width !== Math.floor(size.width * ratio) || canvas.height !== Math.floor(size.height * ratio)) {
      canvas.width = Math.floor(size.width * ratio)
      canvas.height = Math.floor(size.height * ratio)
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, size.width, size.height)

    const ink = token('--text', '#ededef')
    const faint = token('--faint', '#6e727b')
    const grid = 'rgba(255,255,255,0.06)'
    // Orbis's own palette. A token that does not exist would fail silently and leave the fallback, so these are the names
    // the stylesheet actually defines.
    const up = token('--green', '#3ee58a')
    const down = token('--red', '#ff4d6d')

    const rows = visible.rows
    if (rows.length === 0) {
      context.fillStyle = faint
      context.font = '13px system-ui, sans-serif'
      context.textAlign = 'center'
      // Said, rather than an empty grid that reads as a market that did not move.
      context.fillText('No candles for this market and interval.', size.width / 2, size.height / 2)
      return
    }

    // Vertical budget: the price pane, an optional volume strip, and one pane per non-overlay indicator.
    const volumeHeight = showVolume ? Math.round(size.height * 0.14) : 0
    const paneHeight = panes.length > 0 ? Math.round((size.height - TIME_HEIGHT) * 0.16) : 0
    const priceHeight = size.height - TIME_HEIGHT - volumeHeight - panes.length * (paneHeight + PANE_GAP)
    const plotWidth = size.width - AXIS_WIDTH
    const step = plotWidth / rows.length
    const bodyWidth = Math.max(1, Math.min(14, step * 0.68))

    // Price extent over what is visible, including any overlay that is drawn on the same scale -- otherwise a Bollinger
    // band outside the price range would be clipped without saying so.
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (const candle of rows) {
      if (Number.isFinite(candle.low)) low = Math.min(low, candle.low)
      if (Number.isFinite(candle.high)) high = Math.max(high, candle.high)
    }
    for (const one of computed) {
      if (!one.overlay) continue
      for (const series of Object.values(one.series)) {
        for (let i = visible.from; i < visible.to; i++) {
          const value = series[i]
          if (typeof value === 'number' && Number.isFinite(value)) {
            low = Math.min(low, value)
            high = Math.max(high, value)
          }
        }
      }
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) return
    if (high === low) {
      // A flat window still needs a range, or every bar sits on one pixel line.
      high = low + Math.abs(low || 1) * 0.001
    }
    const span = high - low
    const top = high + span * PRICE_PADDING
    const bottom = low - span * PRICE_PADDING
    const yFor = (value: number): number => priceHeight - ((value - bottom) / (top - bottom)) * priceHeight
    const xFor = (index: number): number => index * step + step / 2

    /**
     * How long one bar lasts, from the visible candles themselves.
     *
     * Taken from the data rather than parsed out of the interval string, because the string is the provider's label and
     * the spacing is what the chart actually drew. A single visible bar has no spacing to measure, so an hour is used --
     * it only affects how far a drawing extrapolates past the edge, which is off screen anyway.
     */
    const barMs = rows.length > 1 ? (rows[rows.length - 1].time - rows[0].time) / (rows.length - 1) : 3_600_000
    const firstTime = rows[0].time
    /** A moment as a column. Fractional, so a drawing sits where it belongs rather than snapping to a bar. */
    const xForTime = (at: number): number => xFor((at - firstTime) / barMs)
    scales.current = { step, plotWidth, priceHeight, top, bottom, firstTime, barMs }

    // ---- grid and price axis
    context.font = '11px system-ui, sans-serif'
    context.textBaseline = 'middle'
    const lines = 5
    for (let i = 0; i <= lines; i++) {
      const value = bottom + ((top - bottom) * i) / lines
      const y = Math.round(yFor(value)) + 0.5
      context.strokeStyle = grid
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(plotWidth, y)
      context.stroke()
      context.fillStyle = faint
      context.textAlign = 'left'
      context.fillText(priceText ? priceText(value) : niceNumber(value, precision), plotWidth + 6, y)
    }

    // ---- the price series
    if (type === 'candles' || type === 'ohlc') {
      rows.forEach((candle, i) => {
        // Direction from the close against the open, which is what a candle means -- not from the 24-hour change.
        const rising = candle.close >= candle.open
        context.strokeStyle = rising ? up : down
        context.fillStyle = rising ? up : down
        const x = xFor(i)
        const wickX = Math.round(x) + 0.5
        context.beginPath()
        context.moveTo(wickX, yFor(candle.high))
        context.lineTo(wickX, yFor(candle.low))
        context.stroke()

        if (type === 'candles') {
          const openY = yFor(candle.open)
          const closeY = yFor(candle.close)
          const bodyTop = Math.min(openY, closeY)
          // A doji still has to be visible, so a body that rounds to nothing is drawn as a line.
          const bodyHeight = Math.max(1, Math.abs(closeY - openY))
          context.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight)
        } else {
          context.beginPath()
          context.moveTo(x - bodyWidth / 2, yFor(candle.open))
          context.lineTo(wickX, yFor(candle.open))
          context.moveTo(wickX, yFor(candle.close))
          context.lineTo(x + bodyWidth / 2, yFor(candle.close))
          context.stroke()
        }
      })
    } else {
      // Line and area are the same series; the fill is presentation and not separate data.
      context.beginPath()
      rows.forEach((candle, i) => {
        const x = xFor(i)
        const y = yFor(candle.close)
        if (i === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.strokeStyle = token('--cyan', '#3fd8ff')
      context.lineWidth = 1.5
      context.stroke()
      if (type === 'area') {
        context.lineTo(xFor(rows.length - 1), priceHeight)
        context.lineTo(xFor(0), priceHeight)
        context.closePath()
        const fill = context.createLinearGradient(0, 0, 0, priceHeight)
        fill.addColorStop(0, 'rgba(63,216,255,0.22)')
        fill.addColorStop(1, 'rgba(63,216,255,0)')
        context.fillStyle = fill
        context.fill()
      }
      context.lineWidth = 1
    }

    /** One series as a line, broken wherever the value is null. */
    const plot = (series: Series, colour: string, project: (value: number) => number, offsetY = 0): void => {
      context.strokeStyle = colour
      context.lineWidth = 1.25
      context.beginPath()
      let drawing = false
      for (let i = visible.from; i < visible.to; i++) {
        const value = series[i]
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          // A period that has not elapsed is a break in the line. Joining across it would draw a value that was never
          // calculated.
          drawing = false
          continue
        }
        const x = xFor(i - visible.from)
        const y = project(value) + offsetY
        if (!drawing) {
          context.moveTo(x, y)
          drawing = true
        } else {
          context.lineTo(x, y)
        }
      }
      context.stroke()
      context.lineWidth = 1
    }

    for (const one of computed) {
      if (!one.overlay) continue
      const names = Object.keys(one.series)
      for (const name of names) {
        // Bands share the indicator's colour, with the middle line dimmed so the three are distinguishable.
        const colour = names.length > 1 && name === 'middle' ? `${one.colour}88` : one.colour
        plot(one.series[name], colour, yFor)
      }
    }

    // ---- volume
    let cursorY = priceHeight
    if (showVolume) {
      const hasVolume = rows.some((c) => typeof c.volume === 'number' && Number.isFinite(c.volume))
      if (hasVolume) {
        let peak = 0
        for (const candle of rows) if (typeof candle.volume === 'number') peak = Math.max(peak, candle.volume)
        rows.forEach((candle, i) => {
          if (typeof candle.volume !== 'number' || !Number.isFinite(candle.volume) || peak <= 0) return
          const barHeight = (candle.volume / peak) * (volumeHeight - 4)
          context.fillStyle = candle.close >= candle.open ? `${up}55` : `${down}55`
          context.fillRect(xFor(i) - bodyWidth / 2, cursorY + volumeHeight - barHeight, bodyWidth, barHeight)
        })
      } else {
        context.fillStyle = faint
        context.textAlign = 'left'
        context.fillText('Volume unavailable', 4, cursorY + volumeHeight / 2)
      }
      cursorY += volumeHeight
    }

    // ---- indicator panes, each on its own scale
    for (const one of panes) {
      cursorY += PANE_GAP
      const names = Object.keys(one.series)
      let paneLow = Number.POSITIVE_INFINITY
      let paneHigh = Number.NEGATIVE_INFINITY
      for (const name of names) {
        for (let i = visible.from; i < visible.to; i++) {
          const value = one.series[name][i]
          if (typeof value === 'number' && Number.isFinite(value)) {
            paneLow = Math.min(paneLow, value)
            paneHigh = Math.max(paneHigh, value)
          }
        }
      }
      // A pane with nothing computed yet says so; forcing RSI onto the price axis would make both unreadable.
      if (!Number.isFinite(paneLow) || !Number.isFinite(paneHigh)) {
        context.fillStyle = faint
        context.textAlign = 'left'
        context.fillText(`${one.label} — not enough history`, 4, cursorY + paneHeight / 2)
        cursorY += paneHeight
        continue
      }
      if (paneHigh === paneLow) paneHigh = paneLow + 1
      const project = (value: number): number => paneHeight - ((value - paneLow) / (paneHigh - paneLow)) * paneHeight

      context.strokeStyle = grid
      context.beginPath()
      context.moveTo(0, Math.round(cursorY) + 0.5)
      context.lineTo(plotWidth, Math.round(cursorY) + 0.5)
      context.stroke()

      if (one.kind === 'macd' && one.series.histogram) {
        for (let i = visible.from; i < visible.to; i++) {
          const value = one.series.histogram[i]
          if (typeof value !== 'number' || !Number.isFinite(value)) continue
          const zero = project(0)
          const y = project(value)
          context.fillStyle = value >= 0 ? `${up}66` : `${down}66`
          context.fillRect(xFor(i - visible.from) - bodyWidth / 2, Math.min(zero, y) + cursorY, bodyWidth, Math.max(1, Math.abs(y - zero)))
        }
      }
      names.forEach((name, i) => {
        if (one.kind === 'macd' && name === 'histogram') return
        plot(one.series[name], i === 0 ? one.colour : `${one.colour}99`, project, cursorY)
      })

      context.fillStyle = faint
      context.textAlign = 'left'
      context.fillText(one.label, 4, cursorY + 9)
      context.fillText(niceNumber(paneHigh, 2), plotWidth + 6, cursorY + 9)
      context.fillText(niceNumber(paneLow, 2), plotWidth + 6, cursorY + paneHeight - 9)
      cursorY += paneHeight
    }

    // ---- time axis
    const ticks = Math.max(2, Math.min(8, Math.floor(plotWidth / 90)))
    context.fillStyle = faint
    context.textAlign = 'center'
    for (let i = 0; i < ticks; i++) {
      const index = Math.round((rows.length - 1) * (i / (ticks - 1)))
      const candle = rows[index]
      if (!candle) continue
      const x = Math.min(plotWidth - 20, Math.max(20, xFor(index)))
      context.fillText(timeLabel(candle.time, interval), x, size.height - TIME_HEIGHT / 2)
    }

    // ---- crosshair
    if (pointer && pointer.x <= plotWidth) {
      const index = Math.max(0, Math.min(rows.length - 1, Math.floor(pointer.x / step)))
      const candle = rows[index]
      const x = Math.round(xFor(index)) + 0.5
      context.strokeStyle = 'rgba(255,255,255,0.28)'
      context.setLineDash([3, 3])
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, size.height - TIME_HEIGHT)
      context.moveTo(0, Math.round(pointer.y) + 0.5)
      context.lineTo(plotWidth, Math.round(pointer.y) + 0.5)
      context.stroke()
      context.setLineDash([])

      // The price under the pointer, on the axis. It is the pointer's price, not the candle's, and is labelled as such by
      // sitting on the axis rather than in the bar readout.
      if (pointer.y <= priceHeight) {
        const value = bottom + ((priceHeight - pointer.y) / priceHeight) * (top - bottom)
        const text = priceText ? priceText(value) : niceNumber(value, precision)
        context.fillStyle = 'rgba(20,24,32,0.92)'
        context.fillRect(plotWidth + 2, pointer.y - 8, AXIS_WIDTH - 4, 16)
        context.fillStyle = ink
        context.textAlign = 'left'
        context.fillText(text, plotWidth + 6, pointer.y)
      }
      void candle
    }

    // ---- annotations
    //
    // Drawn last so they sit over the candles, and clipped to the plot so a line cannot run across the price axis.
    context.save()
    context.beginPath()
    context.rect(0, 0, plotWidth, priceHeight)
    context.clip()

    const accent = token('--cyan', '#3fd8ff')
    const from = firstTime
    const to = firstTime + barMs * rows.length

    /** One drawing, at whatever scale this frame is using. */
    const paint = (drawing: Drawing, ghost: boolean): void => {
      if (!drawing.visible && !ghost) return
      if (!ghost && !inView(drawing, from, to)) return
      const colour = drawing.colour || accent
      const chosen = drawing.id === selectedDrawing
      context.strokeStyle = colour
      context.fillStyle = colour
      context.lineWidth = chosen ? 2 : 1.4
      // A drawing still being placed is dashed, so it reads as unfinished rather than as a line somebody left crooked.
      context.setLineDash(ghost ? [4, 4] : [])

      const [first, second, third] = drawing.anchors
      switch (drawing.kind) {
        case 'horizontal': {
          if (!first) break
          const y = yFor(first.price)
          context.beginPath()
          context.moveTo(0, y)
          context.lineTo(plotWidth, y)
          context.stroke()
          break
        }
        case 'vertical': {
          if (!first) break
          const x = xForTime(first.at)
          context.beginPath()
          context.moveTo(x, 0)
          context.lineTo(x, priceHeight)
          context.stroke()
          break
        }
        case 'trendline':
        case 'ray': {
          if (!first || !second) break
          // Extended to the edges through the engine's own `priceAt`, so the line the chart draws is the line the
          // engine would report a price from. Two implementations of one slope would eventually disagree.
          const startAt = drawing.kind === 'ray' ? first.at : from
          const startPrice = priceAt(drawing, startAt)
          const endPrice = priceAt(drawing, to)
          if (startPrice === null || endPrice === null) break
          context.beginPath()
          context.moveTo(xForTime(startAt), yFor(startPrice))
          context.lineTo(xForTime(to), yFor(endPrice))
          context.stroke()
          break
        }
        case 'channel': {
          if (!first || !second) break
          const startPrice = priceAt(drawing, from)
          const endPrice = priceAt(drawing, to)
          if (startPrice === null || endPrice === null) break
          context.beginPath()
          context.moveTo(xForTime(from), yFor(startPrice))
          context.lineTo(xForTime(to), yFor(endPrice))
          context.stroke()
          const offset = third ? channelOffset(drawing) : null
          if (offset !== null) {
            context.beginPath()
            context.moveTo(xForTime(from), yFor(startPrice + offset))
            context.lineTo(xForTime(to), yFor(endPrice + offset))
            context.stroke()
            context.globalAlpha = 0.08
            context.beginPath()
            context.moveTo(xForTime(from), yFor(startPrice))
            context.lineTo(xForTime(to), yFor(endPrice))
            context.lineTo(xForTime(to), yFor(endPrice + offset))
            context.lineTo(xForTime(from), yFor(startPrice + offset))
            context.closePath()
            context.fill()
            context.globalAlpha = 1
          }
          break
        }
        case 'rectangle': {
          const box = boundsOf(drawing)
          if (!box) break
          const left = xForTime(box.from)
          const right = xForTime(box.to)
          const topY = yFor(box.high)
          const bottomY = yFor(box.low)
          context.globalAlpha = 0.1
          context.fillRect(left, topY, right - left, bottomY - topY)
          context.globalAlpha = 1
          context.strokeRect(left, topY, right - left, bottomY - topY)
          break
        }
        case 'fibonacci': {
          if (!first || !second) break
          const levels = fibLevels(drawing)
          const left = xForTime(Math.min(first.at, second.at))
          const right = xForTime(Math.max(first.at, second.at))
          context.font = '10px system-ui, sans-serif'
          context.textBaseline = 'middle'
          for (const level of levels) {
            const y = yFor(level.price)
            context.globalAlpha = level.fraction === 0 || level.fraction === 1 ? 0.9 : 0.55
            context.beginPath()
            context.moveTo(left, y)
            context.lineTo(right, y)
            context.stroke()
            context.textAlign = 'left'
            context.fillText(level.label, right + 4, y)
          }
          context.globalAlpha = 1
          break
        }
        case 'text': {
          if (!first) break
          context.font = '12px system-ui, sans-serif'
          context.textAlign = 'left'
          context.textBaseline = 'bottom'
          context.fillText(drawing.text || 'Note', xForTime(first.at) + 6, yFor(first.price) - 4)
          break
        }
        case 'marker': {
          if (!first) break
          const x = xForTime(first.at)
          const y = yFor(first.price)
          context.beginPath()
          context.arc(x, y, chosen ? 6 : 4.5, 0, Math.PI * 2)
          context.fill()
          if (drawing.text) {
            context.font = '11px system-ui, sans-serif'
            context.textAlign = 'center'
            context.textBaseline = 'bottom'
            context.fillText(drawing.text, x, y - 8)
          }
          break
        }
      }

      // Handles, only on the selected one. Showing them on every drawing turns a busy chart into confetti.
      if (chosen && !ghost) {
        context.setLineDash([])
        for (const anchor of drawing.anchors) {
          const x = xForTime(anchor.at)
          const y = drawing.kind === 'horizontal' ? yFor(anchor.price) : yFor(anchor.price)
          context.fillStyle = ink
          context.strokeStyle = colour
          context.lineWidth = 2
          context.beginPath()
          context.arc(x, y, 4, 0, Math.PI * 2)
          context.fill()
          context.stroke()
        }
      }
      context.setLineDash([])
    }

    for (const drawing of drawings) paint(drawing, false)

    // The one being placed, including the point under the pointer so it follows the cursor while it is being made.
    if (tool && placing.length > 0) {
      const live: Anchor[] = [...placing]
      if (pointer && pointer.x <= plotWidth && pointer.y <= priceHeight && live.length < anchorsFor(tool)) {
        live.push({
          at: firstTime + ((pointer.x - step / 2) / step) * barMs,
          price: bottom + ((priceHeight - pointer.y) / priceHeight) * (top - bottom)
        })
      }
      paint(
        { id: '', kind: tool, instrumentId: '', anchors: live, visible: true, createdAt: 0 },
        true
      )
    }

    context.restore()
  }, [
    size,
    visible,
    computed,
    panes,
    type,
    precision,
    priceText,
    showVolume,
    interval,
    pointer,
    drawings,
    tool,
    placing,
    selectedDrawing
  ])

  useEffect(() => {
    // One frame per change rather than one per event: several prints can arrive between two frames and only the last one
    // is worth drawing.
    const frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [draw])

  // ---------------------------------------------------------------- pointer

  const report = useCallback(
    (index: number | null) => {
      if (!onHover) return
      if (index === null) {
        onHover(null, [])
        return
      }
      const absolute = visible.from + index
      const candle = candles[absolute] ?? null
      const values = computed.flatMap((one) =>
        Object.entries(one.series).map(([name, series]) => ({
          label: Object.keys(one.series).length > 1 ? `${one.label} ${name}` : one.label,
          value: typeof series[absolute] === 'number' ? (series[absolute] as number) : null
        }))
      )
      onHover(candle, values)
    },
    [candles, computed, onHover, visible.from]
  )

  /**
   * A point on the canvas as a moment and a price.
   *
   * Reads the scales the last frame drew with, so a click lands where the person saw it. Null once the pointer is over
   * the axis or below the price pane, where there is no price to speak of.
   */
  const anchorAt = useCallback((x: number, y: number): Anchor | null => {
    const current = scales.current
    if (!current) return null
    if (x > current.plotWidth || y > current.priceHeight) return null
    const at = current.firstTime + ((x - current.step / 2) / current.step) * current.barMs
    const price = current.bottom + ((current.priceHeight - y) / current.priceHeight) * (current.top - current.bottom)
    if (!Number.isFinite(at) || !Number.isFinite(price) || price <= 0) return null
    return { at, price }
  }, [])

  /** Where a drawing's anchor sits on screen right now, for hit-testing. */
  const anchorPoint = useCallback((anchor: Anchor): { x: number; y: number } | null => {
    const current = scales.current
    if (!current) return null
    return {
      x: ((anchor.at - current.firstTime) / current.barMs) * current.step + current.step / 2,
      y: current.priceHeight - ((anchor.price - current.bottom) / (current.top - current.bottom)) * current.priceHeight
    }
  }, [])

  /** How close a click has to be to count as hitting something, in pixels. */
  const HIT = 7

  /**
   * The drawing under a point, or null.
   *
   * Searched newest first, so the thing most recently drawn wins when two overlap -- which is what somebody expects
   * when they have just put a line on top of another.
   */
  const pickAt = useCallback(
    (x: number, y: number): { id: string; anchor: number | null } | null => {
      const current = scales.current
      if (!current) return null
      const point = anchorAt(x, y)
      if (!point) return null

      for (let i = drawings.length - 1; i >= 0; i--) {
        const drawing = drawings[i]
        if (!drawing.visible) continue

        // An anchor first: dragging a handle has to beat selecting the shape it belongs to.
        for (let a = 0; a < drawing.anchors.length; a++) {
          const at = anchorPoint(drawing.anchors[a])
          if (at && Math.hypot(at.x - x, at.y - y) <= HIT) return { id: drawing.id, anchor: a }
        }

        // Then the shape itself, by whatever geometry it has.
        const box = boundsOf(drawing)
        switch (drawing.kind) {
          case 'horizontal': {
            const at = anchorPoint(drawing.anchors[0])
            if (at && Math.abs(at.y - y) <= HIT) return { id: drawing.id, anchor: null }
            break
          }
          case 'vertical':
          case 'text':
          case 'marker': {
            const at = anchorPoint(drawing.anchors[0])
            if (!at) break
            const near = drawing.kind === 'vertical' ? Math.abs(at.x - x) <= HIT : Math.hypot(at.x - x, at.y - y) <= HIT * 2
            if (near) return { id: drawing.id, anchor: null }
            break
          }
          case 'trendline':
          case 'ray':
          case 'channel': {
            // Vertical distance to the line at this moment, which is what "near the line" means on a price chart.
            const onLine = priceAt(drawing, point.at)
            if (onLine === null) break
            const lineY = anchorPoint({ at: point.at, price: onLine })
            if (lineY && Math.abs(lineY.y - y) <= HIT) return { id: drawing.id, anchor: null }
            if (drawing.kind === 'channel') {
              const offset = channelOffset(drawing)
              if (offset !== null) {
                const other = anchorPoint({ at: point.at, price: onLine + offset })
                if (other && Math.abs(other.y - y) <= HIT) return { id: drawing.id, anchor: null }
              }
            }
            break
          }
          case 'rectangle': {
            if (!box) break
            if (point.at >= box.from && point.at <= box.to && point.price >= box.low && point.price <= box.high) {
              return { id: drawing.id, anchor: null }
            }
            break
          }
          case 'fibonacci': {
            if (!box) break
            if (point.at < box.from || point.at > box.to) break
            for (const level of fibLevels(drawing)) {
              const at = anchorPoint({ at: point.at, price: level.price })
              if (at && Math.abs(at.y - y) <= HIT) return { id: drawing.id, anchor: null }
            }
            break
          }
        }
      }
      return null
    },
    [drawings, anchorAt, anchorPoint]
  )

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    setPointer({ x, y })

    // Dragging a handle moves that anchor and nothing else: the chart must not pan underneath it at the same time.
    if (dragAnchor.current && onDrawingMoved) {
      const to = anchorAt(x, y)
      if (to) onDrawingMoved(dragAnchor.current.id, dragAnchor.current.index, to)
      return
    }

    if (drag.current) {
      const plotWidth = size.width - AXIS_WIDTH
      const step = plotWidth / Math.max(1, visible.rows.length)
      const moved = Math.round((x - drag.current.x) / Math.max(1, step))
      setView((current) => ({
        ...current,
        // Dragging right walks back in time. Clamped to the data that exists, so the chart cannot be dragged into empty
        // space where it would look broken.
        offset: Math.max(0, Math.min(candles.length - MIN_BARS, drag.current!.offset + moved))
      }))
      return
    }
    const plotWidth = size.width - AXIS_WIDTH
    const step = plotWidth / Math.max(1, visible.rows.length)
    report(x <= plotWidth ? Math.max(0, Math.min(visible.rows.length - 1, Math.floor(x / step))) : null)
  }

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault()
    setView((current) => {
      const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15
      const bars = Math.max(MIN_BARS, Math.min(Math.max(candles.length, MIN_BARS), Math.round(current.bars * factor)))
      return { ...current, bars }
    })
  }

  const reset = (): void => setView({ bars: 120, offset: 0 })

  return (
    <div className="mk-chart" ref={wrapRef} style={{ height }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: tool ? 'copy' : drag.current ? 'grabbing' : 'crosshair'
        }}
        onPointerMove={onPointerMove}
        onPointerDown={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const x = event.clientX - box.left
          const y = event.clientY - box.top
          event.currentTarget.setPointerCapture(event.pointerId)

          // A tool is armed: this click places an anchor and does nothing else.
          if (tool) {
            const anchor = anchorAt(x, y)
            if (!anchor) return
            const needed = anchorsFor(tool)
            const next = [...placing, anchor]
            if (next.length >= needed) {
              setPlacing([])
              onDrawingPlaced?.(tool, next)
            } else {
              setPlacing(next)
            }
            return
          }

          // No tool: a click on a drawing selects it, on a handle starts a drag, and on empty chart pans.
          const hit = pickAt(x, y)
          if (hit) {
            onDrawingPicked?.(hit.id)
            const drawing = drawings.find((one) => one.id === hit.id)
            // A locked drawing is selected but not moved, which is the whole point of locking one.
            if (hit.anchor !== null && drawing && !drawing.locked) {
              dragAnchor.current = { id: hit.id, index: hit.anchor }
            }
            return
          }
          if (selectedDrawing) onDrawingPicked?.(null)
          drag.current = { x, offset: view.offset }
        }}
        onPointerUp={(event) => {
          drag.current = null
          dragAnchor.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerLeave={() => {
          drag.current = null
          dragAnchor.current = null
          setPointer(null)
          report(null)
        }}
        onWheel={onWheel}
        onDoubleClick={reset}
        role="img"
        aria-label={
          tool
            ? `Placing a ${tool}. ${anchorsFor(tool) - placing.length} more point${anchorsFor(tool) - placing.length === 1 ? '' : 's'} to click.`
            : `${candles.length} ${interval} candles. Drag to pan, scroll to zoom, double-click to reset.`
        }
      />
      {tool && (
        <span className="mk-chart-note">
          {placing.length} of {anchorsFor(tool)} points placed — {DRAWING_INFO[tool].hint}
        </span>
      )}
      {loadingHistory && <span className="mk-chart-note">Loading more history…</span>}
    </div>
  )
}
