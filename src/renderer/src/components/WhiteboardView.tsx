import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Circle, Download, Eraser, Hand, Image as ImageIcon, Minus, MousePointer2, Plus, Redo2, Square, StickyNote, Trash2, Type, Undo2, X } from 'lucide-react'
import type { Board, BoardElement, Box, NoteElement, Point, ShapeElement, StrokeElement, TextElement } from '../../../shared/whiteboard'
import { boardBounds, BOARD_COLORS, bounds, boardToSvg, move as moveElement, NOTE_COLORS, pick, pickIn, scale as scaleElement, simplify, topZ } from '../../../shared/whiteboard'
import type { NoticeKind } from '../App'
import { copyText } from '../lib/utils'

type Tool = 'select' | 'pan' | 'pen' | 'highlighter' | 'eraser' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'note'

const TOOLS: { id: Tool; label: string; icon: typeof Square; key: string }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2, key: 'V' },
  { id: 'pan', label: 'Move around', icon: Hand, key: 'H' },
  { id: 'pen', label: 'Pen', icon: Minus, key: 'P' },
  { id: 'highlighter', label: 'Highlighter', icon: Minus, key: 'M' },
  { id: 'eraser', label: 'Eraser', icon: Eraser, key: 'E' },
  { id: 'rectangle', label: 'Rectangle', icon: Square, key: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: Circle, key: 'O' },
  { id: 'line', label: 'Line', icon: Minus, key: 'L' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, key: 'A' },
  { id: 'text', label: 'Text', icon: Type, key: 'T' },
  { id: 'note', label: 'Sticky note', icon: StickyNote, key: 'N' }
]

const WIDTHS = [2, 4, 8, 16]
const HISTORY_LIMIT = 60

interface View {
  x: number
  y: number
  scale: number
}

/** Draws a board onto the canvas at the current view. */
function draw(canvas: HTMLCanvasElement, board: Board, view: View, selected: Set<string>, preview: BoardElement | null, marquee: Box | null): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  const g = canvas.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.fillStyle = '#0b0d12'
  g.fillRect(0, 0, width, height)

  // Background pattern, drawn in board space so it moves with the board.
  if (board.background !== 'plain') {
    const step = 32 * view.scale
    if (step > 6) {
      g.strokeStyle = 'rgba(255, 255, 255, 0.05)'
      g.fillStyle = 'rgba(255, 255, 255, 0.10)'
      g.lineWidth = 1
      const startX = ((view.x % step) + step) % step
      const startY = ((view.y % step) + step) % step
      if (board.background === 'dots') {
        for (let x = startX; x < width; x += step) for (let y = startY; y < height; y += step) g.fillRect(x, y, 1.5, 1.5)
      } else {
        for (let y = startY; y < height; y += step) {
          g.beginPath()
          g.moveTo(0, y)
          g.lineTo(width, y)
          g.stroke()
        }
        if (board.background === 'grid') {
          for (let x = startX; x < width; x += step) {
            g.beginPath()
            g.moveTo(x, 0)
            g.lineTo(x, height)
            g.stroke()
          }
        }
      }
    }
  }

  g.save()
  g.translate(view.x, view.y)
  g.scale(view.scale, view.scale)
  for (const el of [...board.elements, ...(preview ? [preview] : [])].sort((a, b) => a.z - b.z)) drawElement(g, el)
  // Selection outlines.
  g.setLineDash([4, 4])
  g.strokeStyle = '#3fd8ff'
  g.lineWidth = 1 / view.scale
  for (const el of board.elements) {
    if (!selected.has(el.id)) continue
    const b = bounds(el)
    g.strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8)
  }
  g.setLineDash([])
  g.restore()

  if (marquee) {
    g.strokeStyle = '#3fd8ff'
    g.fillStyle = 'rgba(63, 216, 255, 0.10)'
    g.lineWidth = 1
    const x = view.x + marquee.x * view.scale
    const y = view.y + marquee.y * view.scale
    g.fillRect(x, y, marquee.width * view.scale, marquee.height * view.scale)
    g.strokeRect(x, y, marquee.width * view.scale, marquee.height * view.scale)
  }
}

const images = new Map<string, HTMLImageElement>()

function drawElement(g: CanvasRenderingContext2D, el: BoardElement): void {
  g.save()
  g.strokeStyle = el.color
  g.fillStyle = el.color
  g.lineCap = 'round'
  g.lineJoin = 'round'
  switch (el.kind) {
    case 'stroke': {
      g.globalAlpha = el.highlight ? 0.35 : 1
      g.lineWidth = el.width
      g.beginPath()
      el.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      if (el.points.length === 1) g.arc(el.points[0].x, el.points[0].y, el.width / 2, 0, Math.PI * 2)
      g.stroke()
      break
    }
    case 'rectangle':
    case 'ellipse': {
      const b = bounds(el)
      const x = b.x + el.width / 2
      const y = b.y + el.width / 2
      const w = Math.max(0, b.width - el.width)
      const h = Math.max(0, b.height - el.width)
      g.lineWidth = el.width
      g.beginPath()
      if (el.kind === 'rectangle') g.rect(x, y, w, h)
      else g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      if (el.fill) {
        g.fillStyle = el.fill
        g.fill()
      }
      g.stroke()
      break
    }
    case 'line':
    case 'arrow': {
      g.lineWidth = el.width
      g.beginPath()
      g.moveTo(el.from.x, el.from.y)
      g.lineTo(el.to.x, el.to.y)
      g.stroke()
      if (el.kind === 'arrow') {
        const angle = Math.atan2(el.to.y - el.from.y, el.to.x - el.from.x)
        const size = 6 + el.width * 2
        g.beginPath()
        g.moveTo(el.to.x, el.to.y)
        g.lineTo(el.to.x - Math.cos(angle + 0.4) * size, el.to.y - Math.sin(angle + 0.4) * size)
        g.lineTo(el.to.x - Math.cos(angle - 0.4) * size, el.to.y - Math.sin(angle - 0.4) * size)
        g.closePath()
        g.fill()
      }
      break
    }
    case 'text': {
      g.font = `${el.size}px Inter, Segoe UI, sans-serif`
      g.textBaseline = 'alphabetic'
      el.text.split('\n').forEach((line, i) => g.fillText(line, el.at.x, el.at.y + i * el.size * 1.25))
      break
    }
    case 'note': {
      g.beginPath()
      g.roundRect(el.at.x, el.at.y, el.width, el.height, 8)
      g.fill()
      g.fillStyle = '#14161c'
      g.font = '14px Inter, Segoe UI, sans-serif'
      g.textBaseline = 'top'
      let y = el.at.y + 10
      for (const paragraph of el.text.split('\n')) {
        let line = ''
        for (const word of paragraph.split(' ')) {
          const next = line ? `${line} ${word}` : word
          if (g.measureText(next).width > el.width - 20 && line) {
            g.fillText(line, el.at.x + 10, y)
            y += 18
            line = word
          } else line = next
        }
        g.fillText(line, el.at.x + 10, y)
        y += 18
      }
      break
    }
    case 'image': {
      let image = images.get(el.src)
      if (!image) {
        image = new Image()
        image.onload = () => window.dispatchEvent(new Event('orbis-board-image'))
        image.src = el.src
        images.set(el.src, image)
      }
      if (image.complete && image.naturalWidth) g.drawImage(image, el.at.x, el.at.y, el.width, el.height)
      else {
        g.strokeStyle = 'rgba(255,255,255,0.3)'
        g.strokeRect(el.at.x, el.at.y, el.width, el.height)
      }
      break
    }
  }
  g.restore()
}

/**
 * Whiteboards: an endless board you can draw, write and stick notes on, with the page you are reading dropped straight
 * in. Boards are saved as you work, and can be written out as SVG or a picture.
 */
export default function WhiteboardView({ onClose, onNotify }: { onClose(): void; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [boards, setBoards] = useState<(Omit<Board, 'elements'> & { count: number })[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState(BOARD_COLORS[1])
  const [width, setWidth] = useState(4)
  const [filled, setFilled] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [editing, setEditing] = useState<{ id: string; text: string; box: Box; kind: 'text' | 'note'; since: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const drafting = useRef<BoardElement | null>(null)
  const gesture = useRef<{ kind: 'draw' | 'move' | 'pan' | 'marquee'; start: Point; last: Point; ids: string[] } | null>(null)
  const [marquee, setMarquee] = useState<Box | null>(null)
  const history = useRef<{ past: BoardElement[][]; future: BoardElement[][] }>({ past: [], future: [] })
  const saveTimer = useRef<number | null>(null)
  const boardRef = useRef<Board | null>(null)
  boardRef.current = board

  const loadList = useCallback(async (): Promise<void> => setBoards(await window.api.listBoards()), [])

  useEffect(() => {
    void loadList().then(async () => {
      const list = await window.api.listBoards()
      const first = list[0] ? await window.api.getBoard(list[0].id) : await window.api.createBoard({ name: 'My board' })
      setBoard(first)
      if (first?.view) setView(first.view)
    })
    return window.api.onBoardsChanged(() => void loadList())
  }, [loadList])

  /** Saves the board a moment after the last change. */
  const persist = useCallback((next: Board): void => {
    setBoard(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void window.api.saveBoard(next).then(loadList), 400)
  }, [loadList])

  /** Changes what is on the board, remembering the previous state so it can be undone. */
  const change = useCallback(
    (elements: BoardElement[], remember = true): void => {
      const current = boardRef.current
      if (!current) return
      if (remember) {
        history.current.past = [...history.current.past, current.elements].slice(-HISTORY_LIMIT)
        history.current.future = []
      }
      persist({ ...current, elements })
    },
    [persist]
  )

  const undo = useCallback((): void => {
    const current = boardRef.current
    const previous = history.current.past.pop()
    if (!current || !previous) return
    history.current.future = [current.elements, ...history.current.future].slice(0, HISTORY_LIMIT)
    persist({ ...current, elements: previous })
  }, [persist])

  const redo = useCallback((): void => {
    const current = boardRef.current
    const next = history.current.future.shift()
    if (!current || !next) return
    history.current.past = [...history.current.past, current.elements].slice(-HISTORY_LIMIT)
    persist({ ...current, elements: next })
  }, [persist])

  // Redraw whenever anything visible changes, and when the stage is resized.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !board) return
    let frame = requestAnimationFrame(() => draw(canvas, board, view, selected, drafting.current, marquee))
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => draw(canvas, board, view, selected, drafting.current, marquee))
    })
    observer.observe(canvas)
    const onImage = (): void => void draw(canvas, board, view, selected, drafting.current, marquee)
    window.addEventListener('orbis-board-image', onImage)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('orbis-board-image', onImage)
    }
  }, [board, view, selected, marquee])

  const toBoard = (e: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left - view.x) / view.scale, y: (e.clientY - rect.top - view.y) / view.scale }
  }

  const finishDraft = (): void => {
    const draft = drafting.current
    drafting.current = null
    if (!draft || !board) return
    // A shape that was never dragged anywhere is not worth keeping (measured by the drag itself, not the line width).
    if (draft.kind !== 'stroke') {
      const shape = draft as ShapeElement
      if (Math.abs(shape.to.x - shape.from.x) < 4 && Math.abs(shape.to.y - shape.from.y) < 4) return
    }
    if (draft.kind === 'stroke') {
      const points = simplify((draft as StrokeElement).points)
      change([...board.elements, { ...(draft as StrokeElement), points }])
      return
    }
    change([...board.elements, draft])
  }

  const startEditing = (el: TextElement | NoteElement): void => {
    setEditing({ id: el.id, text: el.text, box: bounds(el), kind: el.kind, since: Date.now() })
    setSelected(new Set([el.id]))
  }

  const commitEditing = (reason: 'blur' | 'done' = 'done'): void => {
    const current = editing
    // Letting go of the mouse that placed a note moves focus to the board; that blur is not the user leaving the text.
    if (reason === 'blur' && current && Date.now() - current.since < 500) {
      requestAnimationFrame(() => editorRef.current?.focus())
      return
    }
    setEditing(null)
    if (!current || !board) return
    const text = current.text.trim()
    const existing = board.elements.find((el) => el.id === current.id)
    if (!existing) return
    // Text with nothing in it is removed rather than left as an invisible thing.
    if (!text) return change(board.elements.filter((el) => el.id !== current.id))
    change(board.elements.map((el) => (el.id === current.id ? ({ ...el, text } as BoardElement) : el)))
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!board || e.button === 2) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const point = toBoard(e)
    const panning = tool === 'pan' || e.button === 1 || e.altKey
    if (panning) {
      gesture.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, last: { x: e.clientX, y: e.clientY }, ids: [] }
      return
    }
    if (editing) commitEditing()

    if (tool === 'eraser') {
      const hit = pick(board.elements, point, 8 / view.scale)
      if (hit) change(board.elements.filter((el) => el.id !== hit.id))
      gesture.current = { kind: 'draw', start: point, last: point, ids: [] }
      return
    }

    if (tool === 'select') {
      const hit = pick(board.elements, point, 8 / view.scale)
      if (!hit) {
        setSelected(new Set())
        gesture.current = { kind: 'marquee', start: point, last: point, ids: [] }
        return
      }
      const ids = e.shiftKey ? new Set([...selected, hit.id]) : selected.has(hit.id) ? selected : new Set([hit.id])
      setSelected(ids)
      gesture.current = { kind: 'move', start: point, last: point, ids: [...ids] }
      return
    }

    const base = { id: crypto.randomUUID(), z: topZ(board.elements), color, createdAt: Date.now() }
    if (tool === 'text') {
      const el: TextElement = { ...base, kind: 'text', at: point, text: '', size: Math.max(14, width * 4) }
      change([...board.elements, el])
      startEditing(el)
      setTool('select')
      return
    }
    if (tool === 'note') {
      const el: NoteElement = { ...base, kind: 'note', color: NOTE_COLORS[0], at: point, text: '', width: 180, height: 140 }
      change([...board.elements, el])
      startEditing(el)
      setTool('select')
      return
    }
    if (tool === 'pen' || tool === 'highlighter') {
      drafting.current = { ...base, kind: 'stroke', points: [point], width: tool === 'highlighter' ? width * 3 : width, ...(tool === 'highlighter' ? { highlight: true } : {}) } as StrokeElement
    } else {
      drafting.current = { ...base, kind: tool, from: point, to: point, width, ...(filled && (tool === 'rectangle' || tool === 'ellipse') ? { fill: color } : {}) } as ShapeElement
    }
    gesture.current = { kind: 'draw', start: point, last: point, ids: [] }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const current = gesture.current
    if (!current || !board) return
    if (current.kind === 'pan') {
      setView((v) => ({ ...v, x: v.x + (e.clientX - current.last.x), y: v.y + (e.clientY - current.last.y) }))
      current.last = { x: e.clientX, y: e.clientY }
      return
    }
    const point = toBoard(e)
    if (current.kind === 'marquee') {
      setMarquee({ x: Math.min(current.start.x, point.x), y: Math.min(current.start.y, point.y), width: Math.abs(point.x - current.start.x), height: Math.abs(point.y - current.start.y) })
      return
    }
    if (current.kind === 'move') {
      const dx = point.x - current.last.x
      const dy = point.y - current.last.y
      current.last = point
      persist({ ...board, elements: board.elements.map((el) => (current.ids.includes(el.id) ? moveElement(el, dx, dy) : el)) })
      return
    }
    if (tool === 'eraser') {
      const hit = pick(board.elements, point, 8 / view.scale)
      if (hit) change(board.elements.filter((el) => el.id !== hit.id), false)
      return
    }
    const draft = drafting.current
    if (!draft) return
    if (draft.kind === 'stroke') drafting.current = { ...draft, points: [...draft.points, point] }
    else if (draft.kind === 'rectangle' || draft.kind === 'ellipse' || draft.kind === 'line' || draft.kind === 'arrow') {
      // Holding shift keeps squares square and lines straight.
      const to = e.shiftKey ? squared(draft.from, point, draft.kind) : point
      drafting.current = { ...draft, to }
    }
    if (canvasRef.current) draw(canvasRef.current, board, view, selected, drafting.current, null)
  }

  const onPointerUp = (): void => {
    const current = gesture.current
    gesture.current = null
    if (!board) return
    if (current?.kind === 'marquee' && marquee) {
      setSelected(new Set(pickIn(board.elements, marquee).map((el) => el.id)))
      setMarquee(null)
      return
    }
    if (current?.kind === 'move') {
      // The move is one step in history, not one per pointer event.
      history.current.past = [...history.current.past, board.elements].slice(-HISTORY_LIMIT)
      return
    }
    if (current?.kind === 'draw') finishDraft()
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY / 400)
      setView((v) => {
        const scale = Math.min(8, Math.max(0.1, v.scale * factor))
        return { scale, x: px - ((px - v.x) / v.scale) * scale, y: py - ((py - v.y) / v.scale) * scale }
      })
    } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
  }

  const removeSelected = useCallback((): void => {
    const current = boardRef.current
    if (!current || !selected.size) return
    change(current.elements.filter((el) => !selected.has(el.id)))
    setSelected(new Set())
  }, [change, selected])

  // Keys only act while the board itself has focus, so Orbis shortcuts are untouched.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (editing) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      e.shiftKey ? redo() : undo()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeSelected()
      return
    }
    if (e.key === 'Escape') {
      /*
       * Dropping the selection, and claiming the key so the shell does not close the board.
       *
       * Only claimed when there was actually something selected — with nothing selected there is nothing to drop, and
       * Escape should then mean what it means everywhere else.
       */
      if (selected.size > 0) {
        e.preventDefault()
        setSelected(new Set())
      }
      return
    }
    const picked = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase())
    if (picked) {
      e.preventDefault()
      setTool(picked.id)
    }
  }

  const fit = (): void => {
    if (!board || !canvasRef.current) return
    const box = boardBounds(board.elements)
    if (!box) return setView({ x: 0, y: 0, scale: 1 })
    const rect = canvasRef.current.getBoundingClientRect()
    const scale = Math.min(4, Math.max(0.1, Math.min((rect.width - 80) / box.width, (rect.height - 80) / box.height)))
    setView({ scale, x: rect.width / 2 - (box.x + box.width / 2) * scale, y: rect.height / 2 - (box.y + box.height / 2) * scale })
  }

  const openBoard = async (id: string): Promise<void> => {
    if (saveTimer.current && board) {
      window.clearTimeout(saveTimer.current)
      await window.api.saveBoard(board)
    }
    const next = await window.api.getBoard(id)
    history.current = { past: [], future: [] }
    setSelected(new Set())
    setBoard(next)
    setView(next?.view ?? { x: 0, y: 0, scale: 1 })
  }

  const addPage = async (): Promise<void> => {
    if (!board) return
    try {
      const next = await window.api.addPageToBoard(board.id, { x: Math.round(-view.x / view.scale) + 40, y: Math.round(-view.y / view.scale) + 40 })
      history.current.past = [...history.current.past, board.elements].slice(-HISTORY_LIMIT)
      setBoard(next)
      onNotify('The page is on the board')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'No page to add', 'error')
    }
  }

  const exportSvg = async (): Promise<void> => {
    if (!board) return
    await copyText(boardToSvg(board))
    onNotify('Board copied as SVG')
  }

  const exportPng = (): void => {
    const canvas = canvasRef.current
    if (!canvas || !board) return
    const link = document.createElement('a')
    link.download = `${board.name.replace(/[^\w -]+/g, '') || 'board'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    onNotify('Board saved as a picture')
  }

  /** Grows or shrinks what is selected, about the middle of it. */
  const resize = (factor: number): void => {
    const current = boardRef.current
    const box = boardBounds(current?.elements.filter((el) => selected.has(el.id)) ?? [])
    if (!current || !box) return
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    change(current.elements.map((el) => (selected.has(el.id) ? scaleElement(el, middle, factor) : el)))
  }

  const selectedElements = useMemo(() => board?.elements.filter((el) => selected.has(el.id)) ?? [], [board, selected])

  return (
    <div className="view board-view" role="region" aria-label="Whiteboard">
      <header className="view-head">
        <h2>Whiteboard</h2>
        <div className="view-actions">
          <input
            className="board-name"
            value={board?.name ?? ''}
            aria-label="Board name"
            onChange={(e) => board && persist({ ...board, name: e.target.value })}
            onBlur={() => board && void window.api.renameBoard(board.id, board.name).then(loadList)}
          />
          <select value={board?.background ?? 'grid'} aria-label="Background" onChange={(e) => board && persist({ ...board, background: e.target.value as Board['background'] })}>
            <option value="grid">Grid</option>
            <option value="dots">Dots</option>
            <option value="lines">Lines</option>
            <option value="plain">Plain</option>
          </select>
          <button type="button" className="queue-btn" onClick={() => void addPage()} title="Put a picture of the page you have open on the board">
            <ImageIcon size={14} /> Add page
          </button>
          <button type="button" className="queue-btn" onClick={() => void exportSvg()} title="Copy the board as SVG">
            <Download size={14} /> SVG
          </button>
          <button type="button" className="queue-btn" onClick={exportPng} title="Save what you see as a picture">
            <Download size={14} /> PNG
          </button>
          <button type="button" className="icon-btn" aria-label="Close whiteboard" onClick={() => void (board ? window.api.saveBoard(board) : Promise.resolve()).then(onClose)}>
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="board-body">
        <aside className="board-list" aria-label="Boards">
          <button
            type="button"
            className="queue-btn primary"
            onClick={() =>
              void window.api.createBoard({ name: `Board ${boards.length + 1}` }).then((made) => {
                void loadList()
                void openBoard(made.id)
              })
            }
          >
            <Plus size={14} /> New board
          </button>
          {boards.map((item) => (
            <div key={item.id} className={`board-item${item.id === board?.id ? ' selected' : ''}`}>
              <button type="button" className="board-item-main" onClick={() => void openBoard(item.id)}>
                <b>{item.name}</b>
                <small className="view-muted">
                  {item.count} thing{item.count === 1 ? '' : 's'} · {new Date(item.updatedAt).toLocaleDateString()}
                </small>
              </button>
              <button
                type="button"
                className="icon-btn danger"
                aria-label={`Delete ${item.name}`}
                onClick={() =>
                  void window.api.removeBoard(item.id).then(async () => {
                    await loadList()
                    if (item.id === board?.id) {
                      const rest = await window.api.listBoards()
                      const next = rest[0] ? await window.api.getBoard(rest[0].id) : await window.api.createBoard({ name: 'My board' })
                      setBoard(next)
                    }
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </aside>

        <div className="board-main">
          <div className="board-tools" role="toolbar" aria-label="Tools">
            {TOOLS.map((t) => (
              <button key={t.id} type="button" className={`board-tool${tool === t.id ? ' on' : ''}${t.id === 'highlighter' ? ' highlighter' : ''}`} title={`${t.label} (${t.key})`} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
                <t.icon size={15} />
              </button>
            ))}
            <span className="board-sep" />
            <div className="board-colors" role="group" aria-label="Colour">
              {BOARD_COLORS.map((c) => (
                <button key={c} type="button" className={`board-color${color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
              ))}
            </div>
            <div className="board-widths" role="group" aria-label="Thickness">
              {WIDTHS.map((w) => (
                <button key={w} type="button" className={`board-width${width === w ? ' on' : ''}`} aria-label={`Thickness ${w}`} aria-pressed={width === w} onClick={() => setWidth(w)}>
                  <span style={{ width: w + 6, height: w, background: 'currentColor', borderRadius: 999 }} />
                </button>
              ))}
            </div>
            <button type="button" className={`queue-btn small${filled ? ' on' : ''}`} aria-pressed={filled} onClick={() => setFilled((v) => !v)} title="Fill new shapes">
              Fill
            </button>
            <span className="board-sep" />
            <button type="button" className="board-tool" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo} disabled={!history.current.past.length}>
              <Undo2 size={15} />
            </button>
            <button type="button" className="board-tool" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={redo} disabled={!history.current.future.length}>
              <Redo2 size={15} />
            </button>
            <button type="button" className="board-tool" title="Delete what is selected" aria-label="Delete selection" onClick={removeSelected} disabled={!selected.size}>
              <Trash2 size={15} />
            </button>
            <span className="board-sep" />
            <button type="button" className="queue-btn small" onClick={fit}>
              Fit
            </button>
            <button type="button" className="queue-btn small" onClick={() => setView({ x: 0, y: 0, scale: 1 })}>
              {Math.round(view.scale * 100)}%
            </button>
          </div>

          <div
            ref={stageRef}
            className={`board-stage tool-${tool}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onDoubleClick={(e) => {
              if (!board) return
              const hit = pick(board.elements, toBoard(e), 8 / view.scale)
              if (hit && (hit.kind === 'text' || hit.kind === 'note')) startEditing(hit)
            }}
          >
            <canvas ref={canvasRef} className="board-canvas" />
            {editing && (
              <textarea
                ref={editorRef}
                className={`board-editor ${editing.kind}`}
                autoFocus
                value={editing.text}
                aria-label={editing.kind === 'note' ? 'Note text' : 'Text'}
                style={{
                  left: view.x + editing.box.x * view.scale,
                  top: view.y + editing.box.y * view.scale,
                  width: Math.max(120, editing.box.width * view.scale),
                  height: Math.max(40, editing.box.height * view.scale),
                  fontSize: (editing.kind === 'note' ? 14 : 18) * view.scale
                }}
                onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                onBlur={() => commitEditing('blur')}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) commitEditing('done')
                }}
              />
            )}
            {selectedElements.length > 0 && !editing && (
              <div className="board-selection-bar">
                <span>
                  {selectedElements.length} selected
                </span>
                <button type="button" className="queue-btn small" onClick={() => board && change(board.elements.map((el) => (selected.has(el.id) ? { ...el, z: topZ(board.elements) } : el)))}>
                  Bring to front
                </button>
                <button type="button" className="queue-btn small" onClick={() => board && change(board.elements.map((el) => (selected.has(el.id) ? { ...el, z: Math.min(0, ...board.elements.map((x) => x.z)) - 1 } : el)))}>
                  Send to back
                </button>
                <button type="button" className="queue-btn small" onClick={() => resize(1.25)}>
                  Bigger
                </button>
                <button type="button" className="queue-btn small" onClick={() => resize(0.8)}>
                  Smaller
                </button>
                <button
                  type="button"
                  className="queue-btn small"
                  onClick={() => {
                    if (!board) return
                    const copies = selectedElements.map((el, i) => ({ ...moveElement(el, 24, 24), id: crypto.randomUUID(), z: topZ(board.elements) + i }))
                    change([...board.elements, ...copies])
                    setSelected(new Set(copies.map((c) => c.id)))
                  }}
                >
                  Duplicate
                </button>
                <button type="button" className="queue-btn small danger" onClick={removeSelected}>
                  Delete
                </button>
              </div>
            )}
          </div>
          <p className="board-hint view-muted">Scroll to move · Ctrl+scroll to zoom · Alt-drag or H to pan · Double-click text or a note to edit it</p>
        </div>
      </div>
    </div>
  )
}

/** Keeps a shape square, or a line at a right angle, while shift is held. */
function squared(from: Point, to: Point, kind: ShapeElement['kind']): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (kind === 'line' || kind === 'arrow') {
    return Math.abs(dx) > Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y }
  }
  const size = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: from.x + Math.sign(dx || 1) * size, y: from.y + Math.sign(dy || 1) * size }
}
