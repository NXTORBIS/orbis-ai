import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Pencil, Plus, Redo2, Save, Trash2, Undo2, X } from 'lucide-react'
import { onDay, type Call } from './useStudent'
import type { NoticeKind } from '../../lib/notices'

/**
 * A whiteboard: somewhere to work something out.
 *
 * ## Why a plain canvas
 *
 * Half of studying is scribbling — a triangle, a force diagram, the same equation three times until it comes out.
 * That needs somewhere to draw and nothing else: no shapes library, no templates, no cleverness that gets in the
 * way of a hand moving.
 *
 * ## Strokes, not pixels
 *
 * A board is stored as the lines that were drawn, with their colour and width. That is why undo works, why a board
 * reopens sharp at any window size, and why a board is a few kilobytes rather than a megabyte of image. It also
 * means nothing is lost to a resize, which an image-based board always loses.
 *
 * ## Saving is the student's, with one safety net
 *
 * The board saves when you press save and when you leave it with unsaved work, because losing a worked-out proof to
 * a misclick is the one thing that would stop anybody trusting it. It does not save on every stroke: a store write
 * per pen movement is how a notes app becomes slow.
 */

interface Stroke {
  colour: string
  width: number
  /** Points in board space, 0..1 on both axes, so a board drawn in one window opens right in another. */
  points: readonly { x: number; y: number }[]
}

interface BoardRow {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

const COLOURS = ['#eef2f8', '#3fd8ff', '#3ee58a', '#ffbe4d', '#ff5d73']
const WIDTHS = [2, 4, 8]

export default function Board({
  call,
  onNotify
}: {
  call: Call
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [boards, setBoards] = useState<BoardRow[]>([])
  const [open, setOpen] = useState<{ id: string | null; name: string } | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [undone, setUndone] = useState<Stroke[]>([])
  const [colour, setColour] = useState(COLOURS[0])
  const [width, setWidth] = useState(WIDTHS[1])
  const [erasing, setErasing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [ready, setReady] = useState(false)

  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<Stroke | null>(null)
  const saving = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    const held = await call<BoardRow[]>('boards')
    setBoards(Array.isArray(held) ? held.sort((a, b) => b.updatedAt - a.updatedAt) : [])
    setReady(true)
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  /** Draw everything, at whatever size the canvas happens to be. */
  const paint = useCallback(() => {
    const node = canvas.current
    if (!node) return
    const box = node.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    if (node.width !== Math.round(box.width * scale) || node.height !== Math.round(box.height * scale)) {
      node.width = Math.round(box.width * scale)
      node.height = Math.round(box.height * scale)
    }
    const pen = node.getContext('2d')
    if (!pen) return
    pen.setTransform(scale, 0, 0, scale, 0, 0)
    pen.clearRect(0, 0, box.width, box.height)
    pen.lineCap = 'round'
    pen.lineJoin = 'round'
    const all = drawing.current ? [...strokes, drawing.current] : strokes
    for (const stroke of all) {
      if (stroke.points.length === 0) continue
      pen.strokeStyle = stroke.colour
      pen.lineWidth = stroke.width
      pen.beginPath()
      stroke.points.forEach((point, index) => {
        const x = point.x * box.width
        const y = point.y * box.height
        if (index === 0) pen.moveTo(x, y)
        else pen.lineTo(x, y)
      })
      // A single tap is a dot, not nothing.
      if (stroke.points.length === 1) pen.lineTo(stroke.points[0].x * box.width + 0.1, stroke.points[0].y * box.height)
      pen.stroke()
    }
  }, [strokes])

  useEffect(() => {
    paint()
  }, [paint, open])

  useEffect(() => {
    if (!open) return
    const again = (): void => paint()
    window.addEventListener('resize', again)
    return () => window.removeEventListener('resize', again)
  }, [open, paint])

  const at = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))
    }
  }

  /** The stroke nearest a point, for the eraser. Whole strokes, because half an erased line is worse than neither. */
  const strokeNear = (point: { x: number; y: number }): number => {
    let best = -1
    let closest = 0.03
    strokes.forEach((stroke, index) => {
      for (const one of stroke.points) {
        const distance = Math.hypot(one.x - point.x, one.y - point.y)
        if (distance < closest) {
          closest = distance
          best = index
        }
      }
    })
    return best
  }

  const down = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = at(event)
    if (erasing) {
      const index = strokeNear(point)
      if (index >= 0) {
        setStrokes((held) => held.filter((_, i) => i !== index))
        setDirty(true)
      }
      return
    }
    drawing.current = { colour, width, points: [point] }
    paint()
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (erasing && event.buttons === 1) {
      const index = strokeNear(at(event))
      if (index >= 0) {
        setStrokes((held) => held.filter((_, i) => i !== index))
        setDirty(true)
      }
      return
    }
    if (!drawing.current) return
    drawing.current = { ...drawing.current, points: [...drawing.current.points, at(event)] }
    paint()
  }

  const up = (): void => {
    if (!drawing.current) return
    const stroke = drawing.current
    drawing.current = null
    setStrokes((held) => [...held, stroke])
    setUndone([])
    setDirty(true)
  }

  const save = useCallback(
    async (quietly = false): Promise<void> => {
      if (!open || saving.current) return
      saving.current = true
      const out = await call<{ ok: boolean; id?: string; why?: string }>('save-board', {
        ...(open.id ? { id: open.id } : {}),
        name: open.name,
        data: { version: 1, strokes }
      })
      saving.current = false
      if (!out?.ok) {
        onNotify(out?.why ?? 'That board could not be saved.', 'warn')
        return
      }
      if (out.id && !open.id) setOpen({ ...open, id: out.id })
      setDirty(false)
      if (!quietly) onNotify('Board saved.')
      await load()
    },
    [open, strokes, call, onNotify, load]
  )

  const openBoard = async (row: BoardRow): Promise<void> => {
    const full = await call<{ id: string; name: string; data: { strokes?: Stroke[] } | null }>('board', row.id)
    setStrokes(Array.isArray(full?.data?.strokes) ? (full?.data?.strokes as Stroke[]) : [])
    setUndone([])
    setDirty(false)
    setOpen({ id: row.id, name: full?.name ?? row.name })
  }

  const leave = async (): Promise<void> => {
    // The safety net: work in progress is never thrown away by closing.
    if (dirty && strokes.length > 0) await save(true)
    setOpen(null)
    setStrokes([])
    setUndone([])
    setDirty(false)
  }

  if (open) {
    return (
      <div className="st-board-page">
        <header className="st-section-head">
          <input
            className="st-board-name"
            value={open.name}
            onChange={(e) => {
              setOpen({ ...open, name: e.target.value.slice(0, 120) })
              setDirty(true)
            }}
            aria-label="What this board is called"
          />
          <div className="st-row-right">
            <button type="button" className="st-btn" onClick={() => void save()} disabled={!dirty}>
              <Save size={15} aria-hidden /> {dirty ? 'Save' : 'Saved'}
            </button>
            <button type="button" className="st-btn quiet" onClick={() => void leave()}>
              <X size={15} aria-hidden /> Close
            </button>
          </div>
        </header>

        <div className="st-board-tools" role="toolbar" aria-label="Drawing tools">
          <button type="button" className={`st-icon${erasing ? '' : ' on'}`} aria-label="Draw" aria-pressed={!erasing} onClick={() => setErasing(false)}>
            <Pencil size={15} aria-hidden />
          </button>
          <button type="button" className={`st-icon${erasing ? ' on' : ''}`} aria-label="Rub out" aria-pressed={erasing} onClick={() => setErasing(true)}>
            <Eraser size={15} aria-hidden />
          </button>

          <span className="st-board-sep" aria-hidden />

          {COLOURS.map((one) => (
            <button
              key={one}
              type="button"
              className={`st-swatch${colour === one && !erasing ? ' on' : ''}`}
              style={{ background: one }}
              aria-label={`Pen colour ${one}`}
              aria-pressed={colour === one}
              onClick={() => {
                setColour(one)
                setErasing(false)
              }}
            />
          ))}

          <span className="st-board-sep" aria-hidden />

          {WIDTHS.map((one) => (
            <button
              key={one}
              type="button"
              className={`st-icon${width === one ? ' on' : ''}`}
              aria-label={`Pen width ${one}`}
              aria-pressed={width === one}
              onClick={() => {
                setWidth(one)
                setErasing(false)
              }}
            >
              <span className="st-width-dot" style={{ width: one + 3, height: one + 3 }} />
            </button>
          ))}

          <span className="st-board-sep" aria-hidden />

          <button
            type="button"
            className="st-icon"
            aria-label="Undo"
            disabled={strokes.length === 0}
            onClick={() => {
              setStrokes((held) => {
                const last = held[held.length - 1]
                if (last) setUndone((gone) => [...gone, last])
                return held.slice(0, -1)
              })
              setDirty(true)
            }}
          >
            <Undo2 size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="st-icon"
            aria-label="Redo"
            disabled={undone.length === 0}
            onClick={() => {
              setUndone((gone) => {
                const last = gone[gone.length - 1]
                if (last) setStrokes((held) => [...held, last])
                return gone.slice(0, -1)
              })
              setDirty(true)
            }}
          >
            <Redo2 size={15} aria-hidden />
          </button>
          <span className="st-faint small">{strokes.length} {strokes.length === 1 ? 'stroke' : 'strokes'}</span>
        </div>

        <canvas
          ref={canvas}
          className="st-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          aria-label="Whiteboard. Draw with the mouse or a pen."
        />
      </div>
    )
  }

  return (
    <div className="st-boards">
      <header className="st-section-head">
        <div>
          <h2>Whiteboards</h2>
          <p className="st-faint">Somewhere to work something out. Kept as the lines you drew, so undo works and nothing blurs.</p>
        </div>
        <button
          type="button"
          className="st-btn primary"
          onClick={() => {
            setStrokes([])
            setUndone([])
            setDirty(false)
            setOpen({ id: null, name: `Whiteboard ${boards.length + 1}` })
          }}
        >
          <Plus size={15} aria-hidden /> New board
        </button>
      </header>

      {ready && boards.length === 0 ? <p className="st-empty big">No boards yet. Start one when something needs drawing rather than writing.</p> : null}

      <ul className="st-board-list">
        {boards.map((one) => (
          <li key={one.id}>
            <button type="button" className="st-board-open" onClick={() => void openBoard(one)}>
              <strong>{one.name}</strong>
              <span className="st-faint small">{onDay(one.updatedAt)}</span>
            </button>
            <button
              type="button"
              className="st-icon"
              aria-label={`Delete ${one.name}`}
              onClick={() => {
                void call('remove-board', one.id).then(() => {
                  onNotify('Board deleted.')
                  void load()
                })
              }}
            >
              <Trash2 size={15} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
