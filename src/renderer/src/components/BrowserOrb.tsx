import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Ban, Check, LoaderCircle, Pause, Play, ShieldAlert, Square, X } from 'lucide-react'
import type { AutomationState, BrowserConfirmation, BrowserStep } from '../../../shared/types'
import { automationActive, automationProgress } from '../../../shared/automation'
import { OrbisMark } from './Brand'

/** What the current chat's browser work looks like right now, for the floating assistant. */
export interface BrowserOrbState {
  /** Orbis is replying in the current chat. */
  working: boolean
  /** What the reply is doing, e.g. "Working in the browser…". */
  status?: string
  automation?: AutomationState
  steps: BrowserStep[]
  confirmation?: BrowserConfirmation
  /** The latest reply's text, once there is one. */
  summary?: string
}

export interface BrowserOrbProps extends BrowserOrbState {
  onPrompt(text: string): void
  onPause(): void
  onStop(): void
  onResume(): void
  onAnswer(confirmationId: string, approved: boolean): void
}

const ORB = 38
const MARGIN = 8
/** Pointer movement (px) before a press becomes a drag, so a slightly shaky click still opens the assistant. */
const DRAG_THRESHOLD = 5
const STORAGE_KEY = 'orbis.browser.orb'

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

/** The orb's position as a share (0-1) of the free space, so it keeps its place when the viewport resizes. */
function loadPosition(): { fx: number; fy: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { fx?: unknown; fy?: unknown } | null
    if (saved && typeof saved.fx === 'number' && typeof saved.fy === 'number') return { fx: clamp(saved.fx, 0, 1), fy: clamp(saved.fy, 0, 1) }
  } catch {
    // No saved position; start in the bottom-right corner.
  }
  return { fx: 1, fy: 1 }
}

const STATUS_LABELS: Record<AutomationState['status'], string> = {
  running: 'Automation running',
  'waiting-approval': 'Waiting for your approval',
  paused: 'Paused',
  stopped: 'Stopped',
  completed: 'Completed',
  stuck: 'Stopped: no progress',
  failed: 'Stopped: error'
}

/**
 * The floating Orbis assistant over the browser page: a draggable orb that expands into a panel for giving Orbis a
 * task on the current page and following or controlling it. It works on the same tab the user is looking at.
 */
export default function BrowserOrb(props: BrowserOrbProps): React.JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const gesture = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [position, setPosition] = useState(loadPosition)
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null)
  const [pressing, setPressing] = useState(false)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [text, setText] = useState('')

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const update = (): void => setSize({ width: layer.clientWidth, height: layer.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(layer)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (open && !closing) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, closing])

  const freeX = Math.max(0, size.width - ORB - MARGIN * 2)
  const freeY = Math.max(0, size.height - ORB - MARGIN * 2)
  const x = dragPoint ? dragPoint.x : MARGIN + position.fx * freeX
  const y = dragPoint ? dragPoint.y : MARGIN + position.fy * freeY
  const pointAt = (clientX: number, clientY: number): { x: number; y: number } => {
    const g = gesture.current!
    return { x: clamp(g.originX + clientX - g.startX, MARGIN, MARGIN + freeX), y: clamp(g.originY + clientY - g.startY, MARGIN, MARGIN + freeY) }
  }

  const toggle = (): void => {
    if (open) {
      setClosing(true)
      window.setTimeout(() => {
        setOpen(false)
        setClosing(false)
      }, 140)
    } else {
      setOpen(true)
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return
    // No text selection on the page, and the press stays with the orb even over the web page.
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    gesture.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, originX: x, originY: y, moved: false }
    setPressing(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return
    g.moved = true
    setDragPoint(pointAt(e.clientX, e.clientY))
  }

  const endGesture = (e: React.PointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    setPressing(false)
    if (!g.moved) {
      gesture.current = null
      if (!cancelled) toggle()
      return
    }
    const end = pointAt(e.clientX, e.clientY)
    gesture.current = null
    const next = { fx: freeX ? (end.x - MARGIN) / freeX : 0, fy: freeY ? (end.y - MARGIN) / freeY : 0 }
    setPosition(next)
    setDragPoint(null)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable: the position lasts for this session only.
    }
  }

  const submit = (): void => {
    const task = text.trim()
    if (!task) return
    props.onPrompt(task)
    setText('')
  }

  const { automation, confirmation, working } = props
  const running = Boolean(working && automation && automationActive(automation))
  const resumable = !working && automation && (automation.status === 'paused' || automation.status === 'stopped' || automation.status === 'stuck')
  const headline = confirmation
    ? 'Waiting for your approval'
    : running
      ? automation!.kind === 'game'
        ? 'Playing'
        : 'Automation running'
      : working
        ? props.status || 'Orbis is working…'
        : automation
          ? STATUS_LABELS[automation.status]
          : 'Ask Orbis to act on this page'
  const recent = props.steps.slice(-4).reverse()

  // The panel opens toward the middle of the viewport, so it never spills off the edge the orb sits on.
  const panelWidth = Math.max(220, Math.min(340, size.width - MARGIN * 2))
  const openLeft = x + ORB / 2 > size.width / 2
  const openUp = y + ORB / 2 > size.height / 2
  const panelStyle: React.CSSProperties = {
    width: panelWidth,
    left: clamp(openLeft ? x + ORB - panelWidth : x, MARGIN, size.width - panelWidth - MARGIN),
    maxHeight: Math.max(180, openUp ? y - MARGIN * 2 : size.height - (y + ORB + MARGIN * 2)),
    transformOrigin: `${openLeft ? 'right' : 'left'} ${openUp ? 'bottom' : 'top'}`,
    ...(openUp ? { bottom: size.height - y + MARGIN } : { top: y + ORB + MARGIN })
  }

  return (
    <div className="browser-orb-layer" ref={layerRef}>
      {pressing && <div className="browser-orb-shield" />}

      {open && (
        <section
          className={`browser-orb-panel${closing ? ' closing' : ''}`}
          style={panelStyle}
          aria-label="Orbis browser assistant"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              toggle()
            }
          }}
        >
          <header className="orb-panel-head">
            <OrbisMark size={18} />
            <b>Orbis</b>
            <span className={`orb-panel-state${running || working ? ' live' : ''}`}>{headline}</span>
            <button type="button" className="b-icon" aria-label="Collapse assistant" title="Collapse (Esc)" onClick={toggle}>
              <X size={15} />
            </button>
          </header>

          <div className="orb-panel-body">
            {automation && (
              <div className={`orb-progress ${automation.status}`}>
                <span className="orb-progress-text">{automationProgress(automation)}</span>
                {automation.total ? (
                  <span className="orb-meter" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, (automation.completed / automation.total) * 100)}%` }} />
                  </span>
                ) : null}
                <span className="orb-progress-meta">Goal: {automation.objective}</span>
                {automation.current && <span className="orb-progress-meta">Now: {automation.current}</span>}
                {!running && automation.reason && <span className="orb-progress-meta">{automation.reason}</span>}
              </div>
            )}

            {confirmation && (
              <div className="orb-confirm" role="alertdialog" aria-label="Approve this action">
                <div className="orb-confirm-head">
                  <ShieldAlert size={14} />
                  Orbis wants to:
                </div>
                <p className="orb-confirm-action">{confirmation.action}</p>
                <p className="orb-confirm-reason">{confirmation.reason} Nothing happens until you approve.</p>
                <div className="orb-actions">
                  <button type="button" className="text-btn" onClick={() => props.onAnswer(confirmation.id, false)}>
                    Cancel
                  </button>
                  <button type="button" className="primary-btn" onClick={() => props.onAnswer(confirmation.id, true)}>
                    Approve
                  </button>
                </div>
              </div>
            )}

            {recent.length > 0 && (
              <ol className="orb-steps">
                {recent.map((s) => (
                  <li key={s.id} className={s.status}>
                    {s.status === 'waiting' ? (
                      <LoaderCircle size={12} className="spin" />
                    ) : s.status === 'declined' ? (
                      <Ban size={12} />
                    ) : s.status === 'blocked' ? (
                      <ShieldAlert size={12} />
                    ) : (
                      <Check size={12} />
                    )}
                    <span>{s.text}</span>
                  </li>
                ))}
              </ol>
            )}

            {!working && props.summary && <p className="orb-summary">{props.summary.length > 320 ? `${props.summary.slice(0, 317)}…` : props.summary}</p>}

            {(working || resumable) && (
              <div className="orb-actions">
                {running && (
                  <button type="button" className="queue-btn" onClick={props.onPause}>
                    <Pause size={11} />
                    Pause
                  </button>
                )}
                {working && (
                  <button type="button" className="queue-btn danger" onClick={props.onStop}>
                    <Square size={10} />
                    Stop
                  </button>
                )}
                {resumable && (
                  <button type="button" className="queue-btn primary" onClick={props.onResume}>
                    <Play size={11} />
                    Resume
                  </button>
                )}
              </div>
            )}
          </div>

          <form
            className="orb-prompt"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <textarea
              ref={inputRef}
              rows={2}
              value={text}
              placeholder={working ? 'Tell Orbis to stop, pause, or change the task…' : 'What should Orbis do on this page?'}
              aria-label="Tell Orbis what to do on this page"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <button type="submit" className="orb-send" aria-label="Send to Orbis" disabled={!text.trim()}>
              <ArrowUp size={15} />
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className={`browser-orb${working ? ' working' : ''}${confirmation ? ' attention' : ''}${dragPoint ? ' dragging' : ''}${open ? ' open' : ''}`}
        // At rest the orb is placed as a fraction of the free space in CSS, so it keeps its spot through any resize
        // (full page, back to chat, window changes) without waiting for a measurement; while dragging it follows the pointer.
        style={
          dragPoint
            ? { left: dragPoint.x, top: dragPoint.y }
            : { left: `calc(${MARGIN}px + (100% - ${ORB + MARGIN * 2}px) * ${position.fx})`, top: `calc(${MARGIN}px + (100% - ${ORB + MARGIN * 2}px) * ${position.fy})` }
        }
        aria-label={open ? 'Collapse Orbis assistant' : 'Open Orbis assistant'}
        aria-expanded={open}
        title="Orbis: click to open, drag to move"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e, false)}
        onPointerCancel={(e) => endGesture(e, true)}
        // Keyboard activation (Enter/Space) arrives as a click with no pointer gesture.
        onClick={(e) => {
          if (e.detail === 0) toggle()
        }}
      >
        <OrbisMark size={26} />
        {(working || confirmation) && <span className="browser-orb-dot" aria-hidden="true" />}
      </button>
    </div>
  )
}
