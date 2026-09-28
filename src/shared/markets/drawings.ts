/**
 * Annotations on a chart.
 *
 * The rule the whole file turns on: **a drawing is stored in market coordinates, never screen coordinates.** A trend line
 * is two points in time and price. Where those land in pixels depends on the zoom, the pan, the window width and the
 * price scale, all of which change constantly — and a line stored as pixels drifts off the thing it was drawn against the
 * moment any of them do. Storing time and price means the line survives zooming, panning, resizing, switching timeframe
 * and being reopened next week.
 *
 * Everything here is pure geometry and validation. Turning a point into a pixel is the chart's job, because only the
 * chart knows its own scales.
 */

export type DrawingKind =
  | 'trendline'
  | 'horizontal'
  | 'vertical'
  | 'ray'
  | 'rectangle'
  | 'channel'
  | 'fibonacci'
  | 'text'
  | 'marker'

export const DRAWING_KINDS: DrawingKind[] = [
  'trendline',
  'horizontal',
  'vertical',
  'ray',
  'rectangle',
  'channel',
  'fibonacci',
  'text',
  'marker'
]

/** One anchor: a moment and a price. The only coordinates a drawing is ever stored in. */
export interface Anchor {
  /** Milliseconds. */
  at: number
  price: number
}

export interface Drawing {
  id: string
  kind: DrawingKind
  /** Which market it was drawn on. A drawing never appears on a chart of something else. */
  instrumentId: string
  /**
   * The anchors, in the order they were placed.
   *
   * How many depends on the kind: a horizontal line needs one, a trend line two, a channel three. `anchorsFor` says how
   * many, and a drawing with the wrong number is refused rather than drawn half-defined.
   */
  anchors: Anchor[]
  /** A label, for the kinds that carry one. */
  text?: string
  colour?: string
  /** Whether it is on screen. Hidden rather than deleted, so a busy chart can be cleared without losing the work. */
  visible: boolean
  /** Locked drawings cannot be dragged, so a carefully placed level is not moved by accident. */
  locked?: boolean
  createdAt: number
}

/** How many anchors each kind needs. */
export const anchorsFor = (kind: DrawingKind): number => {
  switch (kind) {
    case 'horizontal':
    case 'vertical':
    case 'text':
    case 'marker':
      return 1
    case 'trendline':
    case 'ray':
    case 'rectangle':
    case 'fibonacci':
      return 2
    case 'channel':
      // Two for the line, one more for the width of the parallel.
      return 3
  }
}

/** What each kind is called, and what a person needs to know to place one. */
export const DRAWING_INFO: Record<DrawingKind, { label: string; hint: string }> = {
  trendline: { label: 'Trend line', hint: 'Two points. The line runs between them.' },
  horizontal: { label: 'Horizontal line', hint: 'One point. The line holds that price across the whole chart.' },
  vertical: { label: 'Vertical line', hint: 'One point. The line holds that moment.' },
  ray: { label: 'Ray', hint: 'Two points. The line starts at the first and continues past the second.' },
  rectangle: { label: 'Rectangle', hint: 'Two opposite corners.' },
  channel: { label: 'Channel', hint: 'Two points for the line, a third for the width.' },
  fibonacci: { label: 'Fibonacci retracement', hint: 'Two points. The levels are drawn between them.' },
  text: { label: 'Text', hint: 'One point, and something to say.' },
  marker: { label: 'Marker', hint: 'One point.' }
}

/** The retracement levels, as fractions. The standard set — not invented, and not configurable into nonsense. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** One anchor read from a file. Null when it is not a point on a chart. */
export function cleanAnchor(raw: unknown): Anchor | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const at = finite(o.at)
  const price = finite(o.price)
  // A price of zero or below is not a point on a market chart, and a time of zero is not a time.
  if (at === null || price === null || at <= 0 || price <= 0) return null
  return { at, price }
}

const COLOURS = new Set(['cyan', 'green', 'red', 'amber', 'muted'])

/**
 * A drawing read from a file or an import.
 *
 * Null when it cannot be drawn: an unknown kind, the wrong number of anchors, an anchor that is not a point. Refused
 * rather than repaired, because a repaired drawing is one that appears somewhere its author did not put it.
 */
export function cleanDrawing(raw: unknown, at = Date.now()): Drawing | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.slice(0, 80) : ''
  const instrumentId = typeof o.instrumentId === 'string' ? o.instrumentId.slice(0, 200) : ''
  const kind = DRAWING_KINDS.includes(o.kind as DrawingKind) ? (o.kind as DrawingKind) : null
  if (!id || !instrumentId || !kind) return null

  const anchors = (Array.isArray(o.anchors) ? o.anchors : [])
    .map((one) => cleanAnchor(one))
    .filter((one): one is Anchor => one !== null)
  if (anchors.length < anchorsFor(kind)) return null

  const colour = typeof o.colour === 'string' && COLOURS.has(o.colour) ? o.colour : undefined
  return {
    id,
    kind,
    instrumentId,
    anchors: anchors.slice(0, anchorsFor(kind)),
    // Text is a label, never anything a screen runs: stripped to what a label can be.
    text: typeof o.text === 'string' ? o.text.replace(/[<>]/g, '').slice(0, 120) : undefined,
    colour,
    visible: o.visible !== false,
    locked: o.locked === true,
    createdAt: finite(o.createdAt) ?? at
  }
}

export function cleanDrawings(raw: unknown, at = Date.now(), max = 200): Drawing[] {
  if (!Array.isArray(raw)) return []
  const out: Drawing[] = []
  const seen = new Set<string>()
  for (const one of raw) {
    const drawing = cleanDrawing(one, at)
    if (!drawing || seen.has(drawing.id)) continue
    seen.add(drawing.id)
    out.push(drawing)
    if (out.length >= max) break
  }
  return out
}

// ---------------------------------------------------------------- geometry

/**
 * The price a two-point drawing sits at, at a given moment.
 *
 * Straight-line interpolation between the anchors, extended beyond them for a ray and a trend line — which is what makes
 * a trend line useful after the second point. Null for a vertical, which has no price at a time, and for a horizontal
 * outside nothing, which always has one.
 */
export function priceAt(drawing: Drawing, at: number): number | null {
  const [first, second] = drawing.anchors
  switch (drawing.kind) {
    case 'horizontal':
      return first?.price ?? null
    case 'vertical':
    case 'text':
    case 'marker':
      return null
    case 'trendline':
    case 'ray':
    case 'channel': {
      if (!first || !second) return null
      const span = second.at - first.at
      // Two anchors at the same moment describe a vertical, which has no slope to follow.
      if (span === 0) return null
      if (drawing.kind === 'ray' && at < first.at) return null
      const slope = (second.price - first.price) / span
      return first.price + slope * (at - first.at)
    }
    case 'rectangle':
    case 'fibonacci':
      return null
  }
}

/** The second line of a channel, offset by the third anchor's distance from the first line. */
export function channelOffset(drawing: Drawing): number | null {
  if (drawing.kind !== 'channel') return null
  const [, , third] = drawing.anchors
  if (!third) return null
  const onLine = priceAt(drawing, third.at)
  return onLine === null ? null : third.price - onLine
}

/** The retracement levels of a Fibonacci drawing, as price and label. Empty when it is not one. */
export function fibLevels(drawing: Drawing): { fraction: number; price: number; label: string }[] {
  if (drawing.kind !== 'fibonacci') return []
  const [first, second] = drawing.anchors
  if (!first || !second) return []
  const span = second.price - first.price
  return FIB_LEVELS.map((fraction) => ({
    fraction,
    // From the second anchor back toward the first, which is how a retracement is read.
    price: second.price - span * fraction,
    label: `${(fraction * 100).toFixed(1).replace(/\.0$/, '')}%`
  }))
}

/** The rectangle a two-corner drawing covers, normalised so the corners can be given in any order. */
export function boundsOf(drawing: Drawing): { from: number; to: number; low: number; high: number } | null {
  const [first, second] = drawing.anchors
  if (!first || !second) return null
  return {
    from: Math.min(first.at, second.at),
    to: Math.max(first.at, second.at),
    low: Math.min(first.price, second.price),
    high: Math.max(first.price, second.price)
  }
}

/**
 * Whether a drawing is anywhere near the visible range.
 *
 * Used to skip drawing what cannot be seen. Deliberately generous: a trend line with both anchors off to the left still
 * crosses the view, so anything with a slope is kept unless the whole chart is before it.
 */
export function inView(drawing: Drawing, from: number, to: number): boolean {
  if (drawing.kind === 'horizontal') return true
  const times = drawing.anchors.map((one) => one.at)
  if (times.length === 0) return false
  const earliest = Math.min(...times)
  if (drawing.kind === 'trendline' || drawing.kind === 'channel') return true
  if (drawing.kind === 'ray') return to >= earliest
  const latest = Math.max(...times)
  return latest >= from && earliest <= to
}

/**
 * Moves one anchor.
 *
 * Returns the drawing unchanged when it is locked, so a level somebody pinned is not nudged by a stray drag. The new
 * position is a market coordinate like the old one, which is what keeps the drawing stable afterwards.
 */
export function moveAnchor(drawing: Drawing, index: number, to: Anchor): Drawing {
  if (drawing.locked) return drawing
  if (index < 0 || index >= drawing.anchors.length) return drawing
  const cleaned = cleanAnchor(to)
  if (!cleaned) return drawing
  const anchors = [...drawing.anchors]
  anchors[index] = cleaned
  return { ...drawing, anchors }
}

/** Every drawing on one market, in the order they were made. */
export const drawingsFor = (drawings: readonly Drawing[], instrumentId: string): Drawing[] =>
  drawings.filter((one) => one.instrumentId === instrumentId).sort((a, b) => a.createdAt - b.createdAt)
