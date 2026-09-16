/**
 * Whiteboards: what a board holds, how things on it are measured, picked, moved and drawn, and how a board is written
 * out as SVG. Pure — no canvas, no storage — so the rules can be tested on their own.
 */

export type ElementKind = 'stroke' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'note' | 'image'

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface Common {
  id: string
  /** Lower numbers are further back. */
  z: number
  color: string
  createdAt: number
}

export interface StrokeElement extends Common {
  kind: 'stroke'
  points: Point[]
  width: number
  /** A highlighter draws see-through, over what is already there. */
  highlight?: boolean
}

export interface ShapeElement extends Common {
  kind: 'rectangle' | 'ellipse' | 'line' | 'arrow'
  from: Point
  to: Point
  width: number
  fill?: string
}

export interface TextElement extends Common {
  kind: 'text'
  at: Point
  text: string
  size: number
}

export interface NoteElement extends Common {
  kind: 'note'
  at: Point
  text: string
  width: number
  height: number
}

export interface ImageElement extends Common {
  kind: 'image'
  at: Point
  width: number
  height: number
  /** A data URL: boards keep their own copy so nothing breaks later. */
  src: string
  /** Where the picture came from, when it was taken from a page. */
  source?: { url: string; title: string }
}

export type BoardElement = StrokeElement | ShapeElement | TextElement | NoteElement | ImageElement

export interface Board {
  id: string
  name: string
  elements: BoardElement[]
  background: 'plain' | 'grid' | 'dots' | 'lines'
  createdAt: number
  updatedAt: number
  /** Where the view was left, so a board opens where it was. */
  view?: { x: number; y: number; scale: number }
}

export const BOARD_COLORS = ['#e8f4ff', '#3fd8ff', '#3ee58a', '#ffbe4d', '#ff4d6d', '#a78bfa', '#f472b6', '#0b0d12']
export const NOTE_COLORS = ['#ffd866', '#7ee0a5', '#7cc7ff', '#ff9aa6', '#c9a3ff', '#e8f4ff']
export const MAX_ELEMENTS = 5000

const now = (): number => Date.now()
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const point = (v: unknown): Point => ({ x: num((v as Point)?.x), y: num((v as Point)?.y) })
const color = (v: unknown, fallback = BOARD_COLORS[0]): string => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i.test(v) ? v : fallback)

export const newBoard = (patch: Partial<Board> = {}): Board => ({
  id: patch.id ?? crypto.randomUUID(),
  name: 'New board',
  elements: [],
  background: 'grid',
  createdAt: now(),
  updatedAt: now(),
  ...patch
})

/** The next z, so a new thing lands on top. */
export const topZ = (elements: BoardElement[]): number => elements.reduce((max, el) => Math.max(max, el.z), 0) + 1

// ---------------------------------------------------------------- geometry

/** The box a thing occupies, including the room its own line width takes. */
export function bounds(el: BoardElement): Box {
  switch (el.kind) {
    case 'stroke': {
      const xs = el.points.map((p) => p.x)
      const ys = el.points.map((p) => p.y)
      const pad = el.width / 2
      const x = Math.min(...xs) - pad
      const y = Math.min(...ys) - pad
      return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y }
    }
    case 'rectangle':
    case 'ellipse':
    case 'line':
    case 'arrow': {
      const pad = el.width / 2
      const x = Math.min(el.from.x, el.to.x) - pad
      const y = Math.min(el.from.y, el.to.y) - pad
      return { x, y, width: Math.abs(el.to.x - el.from.x) + pad * 2, height: Math.abs(el.to.y - el.from.y) + pad * 2 }
    }
    case 'text':
      // Text is measured from its font size: near enough for picking and for fitting the view.
      return { x: el.at.x, y: el.at.y - el.size, width: Math.max(20, el.text.split('\n').reduce((w, line) => Math.max(w, line.length), 0) * el.size * 0.55), height: Math.max(el.size, el.text.split('\n').length * el.size * 1.25) }
    case 'note':
    case 'image':
      return { x: el.at.x, y: el.at.y, width: el.width, height: el.height }
  }
}

/** The box around everything given (null when there is nothing). */
export function boardBounds(elements: BoardElement[]): Box | null {
  if (!elements.length) return null
  const boxes = elements.map(bounds)
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }
}

const inBox = (p: Point, box: Box, slack = 0): boolean => p.x >= box.x - slack && p.y >= box.y - slack && p.x <= box.x + box.width + slack && p.y <= box.y + box.height + slack

/** How far a point is from a line between two points. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Whether a point touches a thing: lines are caught near them, filled things anywhere inside. */
export function hits(el: BoardElement, p: Point, slack = 6): boolean {
  const box = bounds(el)
  if (!inBox(p, box, slack)) return false
  switch (el.kind) {
    case 'stroke':
      return el.points.some((point, i) => i > 0 && distanceToSegment(p, el.points[i - 1], point) <= el.width / 2 + slack) || (el.points.length === 1 && Math.hypot(p.x - el.points[0].x, p.y - el.points[0].y) <= el.width / 2 + slack)
    case 'line':
    case 'arrow':
      return distanceToSegment(p, el.from, el.to) <= el.width / 2 + slack
    case 'rectangle': {
      if (el.fill) return true
      const inner = { x: box.x + el.width + slack, y: box.y + el.width + slack, width: box.width - (el.width + slack) * 2, height: box.height - (el.width + slack) * 2 }
      return inner.width <= 0 || inner.height <= 0 || !inBox(p, inner)
    }
    case 'ellipse': {
      const rx = box.width / 2
      const ry = box.height / 2
      const nx = (p.x - (box.x + rx)) / Math.max(1, rx)
      const ny = (p.y - (box.y + ry)) / Math.max(1, ry)
      const d = nx * nx + ny * ny
      if (el.fill) return d <= 1
      const innerRx = Math.max(0, rx - el.width - slack)
      const innerRy = Math.max(0, ry - el.width - slack)
      const inner = innerRx && innerRy ? ((p.x - (box.x + rx)) / innerRx) ** 2 + ((p.y - (box.y + ry)) / innerRy) ** 2 : 2
      return d <= 1 && inner >= 1
    }
    default:
      return true
  }
}

/** What is under a point: the thing nearest the front. */
export function pick(elements: BoardElement[], p: Point, slack = 6): BoardElement | null {
  return [...elements].sort((a, b) => b.z - a.z).find((el) => hits(el, p, slack)) ?? null
}

/** Everything completely inside a box (a selection rectangle). */
export const pickIn = (elements: BoardElement[], box: Box): BoardElement[] =>
  elements.filter((el) => {
    const b = bounds(el)
    return b.x >= box.x && b.y >= box.y && b.x + b.width <= box.x + box.width && b.y + b.height <= box.y + box.height
  })

/** Moves one thing by an offset. */
export function move(el: BoardElement, dx: number, dy: number): BoardElement {
  switch (el.kind) {
    case 'stroke':
      return { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
    case 'rectangle':
    case 'ellipse':
    case 'line':
    case 'arrow':
      return { ...el, from: { x: el.from.x + dx, y: el.from.y + dy }, to: { x: el.to.x + dx, y: el.to.y + dy } }
    default:
      return { ...el, at: { x: el.at.x + dx, y: el.at.y + dy } }
  }
}

/** Scales a thing about a fixed point (used when resizing a selection). */
export function scale(el: BoardElement, origin: Point, factor: number): BoardElement {
  const at = (p: Point): Point => ({ x: origin.x + (p.x - origin.x) * factor, y: origin.y + (p.y - origin.y) * factor })
  switch (el.kind) {
    case 'stroke':
      return { ...el, points: el.points.map(at), width: Math.max(1, el.width * factor) }
    case 'rectangle':
    case 'ellipse':
    case 'line':
    case 'arrow':
      return { ...el, from: at(el.from), to: at(el.to), width: Math.max(1, el.width * factor) }
    case 'text':
      return { ...el, at: at(el.at), size: Math.max(6, el.size * factor) }
    default:
      return { ...el, at: at(el.at), width: Math.max(10, el.width * factor), height: Math.max(10, el.height * factor) }
  }
}

/** Fewer points along a drawn line, keeping its shape (Ramer–Douglas–Peucker). */
export function simplify(points: Point[], tolerance = 0.8): Point[] {
  if (points.length < 3) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    let farthest = -1
    let distance = tolerance
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end])
      if (d > distance) {
        distance = d
        farthest = i
      }
    }
    if (farthest > 0) {
      keep[farthest] = true
      stack.push([start, farthest], [farthest, end])
    }
  }
  return points.filter((_, i) => keep[i])
}

// ---------------------------------------------------------------- storage

export function normalizeElement(raw: unknown): BoardElement | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<BoardElement> & { kind?: string }
  if (typeof r.id !== 'string' || !r.id) return null
  const base = { id: r.id, z: num((r as Common).z), color: color((r as Common).color), createdAt: num((r as Common).createdAt, now()) }
  switch (r.kind) {
    case 'stroke': {
      const points = (Array.isArray((r as StrokeElement).points) ? (r as StrokeElement).points : []).map(point).slice(0, 5000)
      if (!points.length) return null
      return { ...base, kind: 'stroke', points, width: Math.max(1, num((r as StrokeElement).width, 2)), ...((r as StrokeElement).highlight ? { highlight: true } : {}) }
    }
    case 'rectangle':
    case 'ellipse':
    case 'line':
    case 'arrow':
      return { ...base, kind: r.kind, from: point((r as ShapeElement).from), to: point((r as ShapeElement).to), width: Math.max(1, num((r as ShapeElement).width, 2)), ...((r as ShapeElement).fill ? { fill: color((r as ShapeElement).fill) } : {}) }
    case 'text':
      return { ...base, kind: 'text', at: point((r as TextElement).at), text: String((r as TextElement).text ?? '').slice(0, 5000), size: Math.max(6, num((r as TextElement).size, 18)) }
    case 'note':
      return { ...base, kind: 'note', at: point((r as NoteElement).at), text: String((r as NoteElement).text ?? '').slice(0, 5000), width: Math.max(40, num((r as NoteElement).width, 180)), height: Math.max(40, num((r as NoteElement).height, 140)), color: color(base.color, NOTE_COLORS[0]) }
    case 'image': {
      const src = String((r as ImageElement).src ?? '')
      if (!src.startsWith('data:image/')) return null
      const source = (r as ImageElement).source
      return { ...base, kind: 'image', at: point((r as ImageElement).at), width: Math.max(10, num((r as ImageElement).width, 200)), height: Math.max(10, num((r as ImageElement).height, 150)), src, ...(source && typeof source.url === 'string' ? { source: { url: source.url.slice(0, 2048), title: String(source.title ?? '').slice(0, 300) } } : {}) }
    }
    default:
      return null
  }
}

export function normalizeBoard(raw: unknown): Board | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Board>
  if (typeof r.id !== 'string' || !r.id) return null
  const elements = (Array.isArray(r.elements) ? r.elements : []).map(normalizeElement).filter((el): el is BoardElement => el !== null).slice(0, MAX_ELEMENTS)
  return {
    id: r.id,
    name: (typeof r.name === 'string' ? r.name : '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled board',
    elements,
    background: (['plain', 'grid', 'dots', 'lines'] as const).includes(r.background as Board['background']) ? (r.background as Board['background']) : 'grid',
    createdAt: num(r.createdAt, now()),
    updatedAt: num(r.updatedAt, num(r.createdAt, now())),
    ...(r.view ? { view: { x: num(r.view.x), y: num(r.view.y), scale: Math.min(8, Math.max(0.1, num(r.view.scale, 1))) } } : {})
  }
}

// ---------------------------------------------------------------- export

const escapeXml = (text: string): string => text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c)

/** A board written as SVG, so it can be saved or opened anywhere. */
export function boardToSvg(board: Board, padding = 24): string {
  const box = boardBounds(board.elements) ?? { x: 0, y: 0, width: 800, height: 600 }
  const width = Math.ceil(box.width + padding * 2)
  const height = Math.ceil(box.height + padding * 2)
  const shift = (p: Point): Point => ({ x: p.x - box.x + padding, y: p.y - box.y + padding })
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`, `<rect width="${width}" height="${height}" fill="#0b0d12"/>`]
  for (const el of [...board.elements].sort((a, b) => a.z - b.z)) {
    if (el.kind === 'stroke') {
      const d = el.points.map(shift).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
      parts.push(`<path d="${d}" fill="none" stroke="${el.color}" stroke-width="${el.width}" stroke-linecap="round" stroke-linejoin="round"${el.highlight ? ' opacity="0.4"' : ''}/>`)
    } else if (el.kind === 'rectangle' || el.kind === 'ellipse') {
      const b = bounds(el)
      const p = shift({ x: b.x + el.width / 2, y: b.y + el.width / 2 })
      const w = b.width - el.width
      const h = b.height - el.width
      parts.push(
        el.kind === 'rectangle'
          ? `<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${el.fill ?? 'none'}" stroke="${el.color}" stroke-width="${el.width}"/>`
          : `<ellipse cx="${(p.x + w / 2).toFixed(1)}" cy="${(p.y + h / 2).toFixed(1)}" rx="${Math.max(0, w / 2).toFixed(1)}" ry="${Math.max(0, h / 2).toFixed(1)}" fill="${el.fill ?? 'none'}" stroke="${el.color}" stroke-width="${el.width}"/>`
      )
    } else if (el.kind === 'line' || el.kind === 'arrow') {
      const a = shift(el.from)
      const b = shift(el.to)
      parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${el.color}" stroke-width="${el.width}" stroke-linecap="round"/>`)
      if (el.kind === 'arrow') {
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        const size = 6 + el.width * 2
        const wing = (turn: number): string => `${(b.x - Math.cos(angle + turn) * size).toFixed(1)},${(b.y - Math.sin(angle + turn) * size).toFixed(1)}`
        parts.push(`<polygon points="${b.x.toFixed(1)},${b.y.toFixed(1)} ${wing(0.4)} ${wing(-0.4)}" fill="${el.color}"/>`)
      }
    } else if (el.kind === 'text') {
      const p = shift(el.at)
      el.text.split('\n').forEach((line, i) => parts.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + i * el.size * 1.25).toFixed(1)}" fill="${el.color}" font-family="Inter, Segoe UI, sans-serif" font-size="${el.size}">${escapeXml(line)}</text>`))
    } else if (el.kind === 'note') {
      const p = shift(el.at)
      parts.push(`<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${el.width}" height="${el.height}" rx="8" fill="${el.color}"/>`)
      el.text.split('\n').forEach((line, i) => parts.push(`<text x="${(p.x + 10).toFixed(1)}" y="${(p.y + 24 + i * 18).toFixed(1)}" fill="#14161c" font-family="Inter, Segoe UI, sans-serif" font-size="14">${escapeXml(line)}</text>`))
    } else if (el.kind === 'image') {
      const p = shift(el.at)
      parts.push(`<image x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${el.width}" height="${el.height}" href="${el.src}"/>`)
    }
  }
  parts.push('</svg>')
  return parts.join('\n')
}
