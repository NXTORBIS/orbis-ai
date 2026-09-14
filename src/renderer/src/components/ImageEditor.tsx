import { useCallback, useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowUp, ChevronDown, Download, Eraser, ImageMinus, LoaderCircle, MessageSquarePlus, PenLine, Redo2, Scaling, Undo2, X } from 'lucide-react'
import type { EditableImage } from '../lib/imageEditor'
import { imageCanvas, inpaint, resizeImage, resizedSize, toDataUrl } from '../lib/imageTools'
import { cutOutSubject } from '../lib/backgroundRemoval'
import { useDismiss } from '../lib/useDismiss'
import type { NoticeKind } from '../App'

type Tool = 'markup' | 'comment' | 'removebg' | 'erase' | 'resize'

interface Pin {
  id: number
  x: number
  y: number
  text: string
}

interface Props {
  image: EditableImage
  onClose(): void
  /** Adds the image to the chat; returns false when it couldn't be added. */
  onSave(image: EditableImage): boolean
  onNotify(text: string, kind?: NoticeKind): void
  /** Tool selected when the editor opens. */
  initialTool?: Tool
}

const TOOLS: { id: Tool; label: string; icon: LucideIcon }[] = [
  { id: 'markup', label: 'Markup', icon: PenLine },
  { id: 'comment', label: 'Comment', icon: MessageSquarePlus },
  { id: 'removebg', label: 'Remove BG', icon: ImageMinus },
  { id: 'erase', label: 'Erase', icon: Eraser },
  { id: 'resize', label: 'Resize', icon: Scaling }
]
const COLORS = ['#ff4d6d', '#ffbe4d', '#3ee58a', '#3fd8ff', '#ffffff', '#111111']
const ASPECTS = [
  { label: 'Original', ratio: 0 },
  { label: 'Square', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 }
]
const SCALES = [0.5, 1, 1.5, 2]
const ZOOMS = [0.25, 0.5, 1, 1.5, 2]
const EDITING = 'Editing image…'

const nextPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

function region(x: number, y: number): string {
  const vertical = y < 1 / 3 ? 'top' : y > 2 / 3 ? 'bottom' : 'middle'
  const horizontal = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center'
  return vertical === 'middle' && horizontal === 'center' ? 'center' : `${vertical} ${horizontal}`
}

function ipcMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export default function ImageEditor({ image, onClose, onSave, onNotify, initialTool }: Props): React.JSX.Element {
  const [history, setHistory] = useState<EditableImage[]>([image])
  const [index, setIndex] = useState(0)
  const [savedSrc, setSavedSrc] = useState(image.src)
  const [tool, setTool] = useState<Tool | null>(initialTool ?? null)
  const [color, setColor] = useState(COLORS[0])
  const [penSize, setPenSize] = useState(6)
  const [eraseSize, setEraseSize] = useState(32)
  const [aspect, setAspect] = useState(0)
  const [scale, setScale] = useState(1)
  const [pins, setPins] = useState<Pin[]>([])
  const [openPin, setOpenPin] = useState<number | null>(null)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [fitPercent, setFitPercent] = useState(100)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const imgRef = useRef<HTMLImageElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const strokeRef = useRef<{ x: number; y: number } | null>(null)
  const pinSeq = useRef(1)
  useDismiss(zoomRef, zoomOpen, () => setZoomOpen(false))

  const current = history[index]
  const dirty = current.src !== savedSrc
  const notes = pins.filter((p) => p.text.trim())
  const canSubmit = !busy && (instruction.trim() !== '' || notes.length > 0)

  const push = (next: EditableImage): void => {
    setHistory((list) => [...list.slice(0, index + 1), next])
    setIndex(index + 1)
  }

  const undo = useCallback(() => {
    if (!busy) setIndex((i) => Math.max(0, i - 1))
  }, [busy])
  const redo = useCallback(() => {
    if (!busy) setIndex((i) => Math.min(history.length - 1, i + 1))
  }, [busy, history.length])

  const close = useCallback(() => {
    const message = busy === EDITING ? 'An edit is still rendering. Close the editor anyway?' : "Close the editor? Your edits haven't been saved to the chat."
    if ((dirty || busy === EDITING) && !window.confirm(message)) return
    onClose()
  }, [busy, dirty, onClose])

  const closePin = useCallback(() => {
    setPins((list) => list.filter((p) => p.text.trim()))
    setOpenPin(null)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (openPin !== null) closePin()
        else if (zoomOpen) setZoomOpen(false)
        else if (tool) setTool(null)
        else close()
        return
      }
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (typing || !(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, closePin, openPin, redo, tool, undo, zoomOpen])

  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const update = (): void => {
      if (img.naturalWidth) setFitPercent(Math.round((img.clientWidth / img.naturalWidth) * 100))
    }
    const observer = new ResizeObserver(update)
    observer.observe(img)
    return () => observer.disconnect()
  }, [])

  const onImageLoad = (): void => {
    const img = imgRef.current
    const overlay = overlayRef.current
    if (!img || !overlay) return
    setSize({ w: img.naturalWidth, h: img.naturalHeight })
    overlay.width = img.naturalWidth
    overlay.height = img.naturalHeight
    if (img.clientWidth) setFitPercent(Math.round((img.clientWidth / img.naturalWidth) * 100))
  }

  const clearOverlay = (): void => {
    const overlay = overlayRef.current
    overlay?.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height)
  }

  const pointAt = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = imgRef.current?.getBoundingClientRect()
    return rect ? { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height } : { x: -1, y: -1 }
  }

  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    const img = imgRef.current
    const ctx = overlayRef.current?.getContext('2d')
    if (!img || !ctx) return
    // Brush sizes are in screen pixels, so they feel the same at any zoom.
    ctx.lineWidth = (tool === 'erase' ? eraseSize : penSize) * (img.clientWidth ? img.naturalWidth / img.clientWidth : 1)
    ctx.strokeStyle = tool === 'erase' ? '#ff4d6d' : color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x * size.w, from.y * size.h)
    ctx.lineTo(to.x * size.w, to.y * size.h)
    ctx.stroke()
  }

  const commitStroke = async (): Promise<void> => {
    const img = imgRef.current
    const overlay = overlayRef.current
    const strokes = overlay?.getContext('2d')
    if (!img || !overlay || !strokes || !size.w) return
    if (tool === 'markup') {
      const { canvas, ctx } = imageCanvas(img, size.w, size.h)
      ctx.drawImage(overlay, 0, 0)
      clearOverlay()
      push({ ...current, src: toDataUrl(canvas, current.alpha), local: true })
      return
    }
    setBusy('Erasing…')
    await nextPaint()
    try {
      const { canvas, ctx } = imageCanvas(img, size.w, size.h)
      const pixels = ctx.getImageData(0, 0, size.w, size.h)
      const painted = strokes.getImageData(0, 0, size.w, size.h).data
      const mask = new Uint8Array(size.w * size.h)
      for (let i = 0; i < mask.length; i++) mask[i] = painted[i * 4 + 3] > 0 ? 1 : 0
      inpaint(pixels, mask)
      ctx.putImageData(pixels, 0, 0)
      push({ ...current, src: toDataUrl(canvas, current.alpha), local: true })
    } finally {
      clearOverlay()
      setBusy(null)
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (busy || e.button !== 0) return
    const p = pointAt(e)
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return
    if (tool === 'comment') {
      const id = pinSeq.current++
      setPins((list) => [...list.filter((pin) => pin.text.trim()), { id, x: p.x, y: p.y, text: '' }])
      setOpenPin(id)
      return
    }
    if (tool !== 'markup' && tool !== 'erase') return
    e.currentTarget.setPointerCapture(e.pointerId)
    strokeRef.current = p
    drawSegment(p, p)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!strokeRef.current) return
    const p = pointAt(e)
    drawSegment(strokeRef.current, p)
    strokeRef.current = p
  }

  const onPointerUp = (): void => {
    if (!strokeRef.current) return
    strokeRef.current = null
    void commitStroke()
  }

  const applyRemoveBackground = async (): Promise<void> => {
    const img = imgRef.current
    if (!img || !size.w || busy) return
    setBusy('Removing background…')
    await nextPaint()
    try {
      const { canvas, ctx } = imageCanvas(img, size.w, size.h)
      const pixels = ctx.getImageData(0, 0, size.w, size.h)
      const removed = await cutOutSubject(pixels)
      if (removed > 0.985) return onNotify("Couldn't find a clear subject to keep in this image.", 'warn')
      if (removed < 0.01) return onNotify('There was no background to remove.', 'warn')
      ctx.putImageData(pixels, 0, 0)
      push({ ...current, src: canvas.toDataURL('image/png'), alpha: true, local: true })
      setTool(null)
    } catch (err) {
      onNotify(`Couldn't remove the background: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const applyResize = (): void => {
    const img = imgRef.current
    if (!img || !size.w || busy || (aspect === 0 && scale === 1)) return
    push({ ...current, src: toDataUrl(resizeImage(img, size.w, size.h, aspect, scale), current.alpha), local: true })
    setAspect(0)
    setScale(1)
    setTool(null)
  }

  const submitEdit = async (): Promise<void> => {
    if (!canSubmit) return
    const text = [instruction.trim(), ...notes.map((p) => `in the ${region(p.x, p.y)} of the image: ${p.text.trim()}`)].filter(Boolean).join('; ')
    setBusy(EDITING)
    setTool(null)
    setOpenPin(null)
    try {
      const result = await window.api.editImage({ prompt: current.prompt, instruction: text, seed: current.seed })
      push({ src: result.url, prompt: result.prompt, seed: result.seed })
      setInstruction('')
      setPins([])
    } catch (err) {
      onNotify(`Couldn't edit the image: ${ipcMessage(err)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const download = (): void => {
    void window.api.saveImage(current.src, current.prompt || 'orbis-image').then((ok) => {
      if (ok) onNotify('Image saved.')
    })
  }

  const save = (): void => {
    if (!onSave(current)) return
    setSavedSrc(current.src)
    onNotify('Edited image added to the chat.')
  }

  const resized = resizedSize(size.w || 1, size.h || 1, aspect, scale)

  return (
    <div className="image-editor" role="dialog" aria-modal="true" aria-label="Edit image">
      <header className="editor-top">
        <button type="button" className="editor-icon-btn" aria-label="Close editor" title="Close (Esc)" onClick={close}>
          <X size={18} />
        </button>
        <span className="editor-title truncate" title={current.prompt}>
          {current.prompt || 'Image'}
        </span>
        <div className="editor-top-actions">
          <button type="button" className="editor-icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={index === 0 || Boolean(busy)} onClick={undo}>
            <Undo2 size={17} />
          </button>
          <button type="button" className="editor-icon-btn" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={index >= history.length - 1 || Boolean(busy)} onClick={redo}>
            <Redo2 size={17} />
          </button>
          <button type="button" className="editor-icon-btn" aria-label="Download" title="Download" onClick={download}>
            <Download size={17} />
          </button>
          <button type="button" className="editor-save" disabled={!dirty || Boolean(busy)} onClick={save}>
            {dirty ? 'Save to chat' : 'In chat'}
          </button>
        </div>
      </header>

      <div className="editor-toolbar-row">
        <div className="editor-toolbar" role="toolbar" aria-label="Editing tools">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`editor-tool${tool === id ? ' active' : ''}`}
              aria-pressed={tool === id}
              disabled={Boolean(busy)}
              onClick={() => {
                closePin()
                setTool(tool === id ? null : id)
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <div className="editor-zoom" ref={zoomRef}>
          <button type="button" className="editor-zoom-btn" aria-haspopup="menu" aria-expanded={zoomOpen} onClick={() => setZoomOpen((o) => !o)}>
            {zoom === null ? fitPercent : Math.round(zoom * 100)}%
            <ChevronDown size={14} />
          </button>
          {zoomOpen && (
            <div className="editor-zoom-menu glass" role="menu">
              <button type="button" role="menuitemradio" aria-checked={zoom === null} className={zoom === null ? 'selected' : undefined} onClick={() => { setZoom(null); setZoomOpen(false) }}>
                Fit
              </button>
              {ZOOMS.map((z) => (
                <button key={z} type="button" role="menuitemradio" aria-checked={zoom === z} className={zoom === z ? 'selected' : undefined} onClick={() => { setZoom(z); setZoomOpen(false) }}>
                  {z * 100}%
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="editor-options">
        {tool === null && <span>Pick a tool, or describe an edit below.</span>}
        {tool === 'markup' && (
          <>
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} className={`editor-swatch${color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
            <label>
              Size <input type="range" min={2} max={30} value={penSize} onChange={(e) => setPenSize(Number(e.target.value))} />
            </label>
          </>
        )}
        {tool === 'comment' && <span>{notes.length ? `${notes.length} comment${notes.length === 1 ? '' : 's'} will be sent with your next edit.` : 'Click the image where something should change.'}</span>}
        {tool === 'erase' && (
          <>
            <span>Paint over anything you want removed.</span>
            <label>
              Brush <input type="range" min={8} max={120} value={eraseSize} onChange={(e) => setEraseSize(Number(e.target.value))} />
            </label>
          </>
        )}
        {tool === 'removebg' && (
          <>
            <span>Separates the subject from its background, right on this device.</span>
            <button type="button" className="editor-apply" disabled={Boolean(busy)} onClick={() => void applyRemoveBackground()}>
              Remove background
            </button>
          </>
        )}
        {tool === 'resize' && (
          <>
            {ASPECTS.map((a) => (
              <button key={a.label} type="button" className={`editor-chip${aspect === a.ratio ? ' active' : ''}`} onClick={() => setAspect(a.ratio)}>
                {a.label}
              </button>
            ))}
            <span className="editor-divider" />
            {SCALES.map((s) => (
              <button key={s} type="button" className={`editor-chip${scale === s ? ' active' : ''}`} onClick={() => setScale(s)}>
                {s * 100}%
              </button>
            ))}
            <span className="editor-dims">
              {resized.width} × {resized.height}
            </span>
            <button type="button" className="editor-apply" disabled={aspect === 0 && scale === 1} onClick={applyResize}>
              Apply
            </button>
          </>
        )}
      </div>

      <div className="editor-stage">
        <div className={`editor-canvas${tool ? ` tool-${tool}` : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <img
            ref={imgRef}
            src={current.src}
            alt={current.prompt}
            draggable={false}
            onLoad={onImageLoad}
            className={zoom === null ? undefined : 'zoomed'}
            style={zoom === null || !size.w ? undefined : { width: size.w * zoom }}
          />
          <canvas ref={overlayRef} className={`editor-overlay${tool === 'erase' ? ' erase' : ''}`} />
          {pins.map((pin, i) => (
            <div key={pin.id} className="editor-pin" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }} onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" className="pin-dot" title={pin.text || 'Comment'} onClick={() => setOpenPin(pin.id)}>
                {i + 1}
              </button>
              {openPin === pin.id && (
                <div className="pin-popover glass">
                  <input
                    autoFocus
                    value={pin.text}
                    placeholder="What should change here?"
                    onChange={(e) => setPins((list) => list.map((p) => (p.id === pin.id ? { ...p, text: e.target.value } : p)))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        closePin()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="editor-icon-btn small"
                    aria-label="Remove comment"
                    onClick={() => {
                      setPins((list) => list.filter((p) => p.id !== pin.id))
                      setOpenPin(null)
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="editor-busy">
              <LoaderCircle size={18} className="editor-spin" />
              {busy}
            </div>
          )}
        </div>
      </div>

      <form
        className="editor-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void submitEdit()
        }}
      >
        <input
          autoFocus
          value={instruction}
          disabled={busy === EDITING}
          placeholder={notes.length ? 'Describe edits (your comments are included)' : 'Describe edits'}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button type="submit" className="editor-send" aria-label="Apply edit" disabled={!canSubmit}>
          <ArrowUp size={16} />
        </button>
      </form>
      {current.local && canSubmit && <p className="editor-note">Describe edits re-renders the image from its prompt, so manual changes won't carry over.</p>}
    </div>
  )
}
