import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Percent,
  Square,
  Tag,
  Trash2,
  Type,
  Unlock,
  Waypoints
} from 'lucide-react'
import type { NoticeKind } from '../../lib/notices'
import {
  DRAWING_INFO,
  DRAWING_KINDS,
  anchorsFor,
  type Anchor,
  type Drawing,
  type DrawingKind
} from '../../../../shared/markets/drawings'

/**
 * The drawing tools, and the list of what has been drawn.
 *
 * The toolbar arms a tool; the chart places it. Nothing here knows about pixels — a drawing leaves this component as a
 * kind and a set of anchors in time and price, which is the only form it is ever stored in.
 *
 * Two decisions worth stating:
 *
 * - **Hiding and deleting are different buttons.** A chart with fifteen levels on it needs to be cleared to be read,
 *   and somebody who wants it clear almost never wants the work gone. Hiding is one click and reversible; deleting asks.
 * - **A locked drawing can still be selected.** Locking stops it moving, not being looked at — a level somebody pinned
 *   is exactly the one they will want to inspect.
 */

const ICONS: Record<DrawingKind, React.ComponentType<{ size?: number }>> = {
  trendline: MoveUpRight,
  horizontal: Minus,
  vertical: ChevronRight,
  ray: MoveUpRight,
  rectangle: Square,
  channel: Waypoints,
  fibonacci: Percent,
  text: Type,
  marker: Tag
}

/** The palette a drawing can be, from Orbis's own tokens rather than invented here. */
const COLOURS = [
  { id: 'cyan', value: '#3fd8ff', label: 'Cyan' },
  { id: 'amber', value: '#ffbe4d', label: 'Amber' },
  { id: 'green', value: '#3ee58a', label: 'Green' },
  { id: 'red', value: '#ff4d6d', label: 'Red' },
  { id: 'violet', value: '#c39bff', label: 'Violet' },
  { id: 'white', value: '#ededef', label: 'White' }
]

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

export interface DrawingToolbarProps {
  instrumentId: string
  drawings: Drawing[]
  tool: DrawingKind | null
  selected: string | null
  onTool(kind: DrawingKind | null): void
  onSelect(id: string | null): void
  onChanged(drawings: Drawing[]): void
  onNotify(message: string, kind?: NoticeKind): void
  /** For the readout beside a level: turns a market price into text in the displayed currency. */
  priceText(value: number): string
}

export default function DrawingToolbar({
  instrumentId,
  drawings,
  tool,
  selected,
  onTool,
  onSelect,
  onChanged,
  onNotify,
  priceText
}: DrawingToolbarProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const chosen = useMemo(() => drawings.find((one) => one.id === selected) ?? null, [drawings, selected])

  const save = useCallback(
    async (patch: Partial<Drawing>) => {
      setBusy(true)
      try {
        const result = await window.api.marketsDrawingSave(patch)
        if (refused(result)) {
          onNotify(result.message ?? 'That could not be saved', 'error')
          return
        }
        onChanged(result.drawings)
      } finally {
        setBusy(false)
      }
    },
    [onChanged, onNotify]
  )

  const remove = useCallback(
    async (id: string) => {
      const result = await window.api.marketsDrawingRemove(id, instrumentId)
      if (refused(result)) {
        onNotify(result.message ?? 'That could not be removed', 'error')
        return
      }
      onChanged(result.drawings)
      if (selected === id) onSelect(null)
    },
    [instrumentId, onChanged, onNotify, onSelect, selected]
  )

  // Escape puts the pointer back. A toolbar that stays armed after somebody has changed their mind draws a line they
  // did not want on the next click.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && tool) {
        onTool(null)
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && chosen && !chosen.locked) {
        const target = event.target as HTMLElement | null
        // Not while somebody is typing in the label box.
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
        void remove(chosen.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, chosen, onTool, remove])

  const visibleCount = drawings.filter((one) => one.visible).length

  return (
    <div className="mk-draw">
      <div className="mk-draw-tools" role="toolbar" aria-label="Drawing tools">
        <button
          type="button"
          className={tool === null ? 'on' : ''}
          onClick={() => onTool(null)}
          title="Select and move (Esc)"
          aria-pressed={tool === null}
        >
          <MousePointer2 size={14} />
        </button>
        <span className="mk-draw-divider" aria-hidden />
        {DRAWING_KINDS.map((kind) => {
          const Icon = ICONS[kind]
          return (
            <button
              key={kind}
              type="button"
              className={tool === kind ? 'on' : ''}
              onClick={() => onTool(tool === kind ? null : kind)}
              title={`${DRAWING_INFO[kind].label} — ${DRAWING_INFO[kind].hint}`}
              aria-pressed={tool === kind}
            >
              <Icon size={14} />
            </button>
          )
        })}
        <span className="mk-draw-divider" aria-hidden />
        <button
          type="button"
          className={open ? 'on' : ''}
          onClick={() => setOpen((one) => !one)}
          title={`${drawings.length} drawing${drawings.length === 1 ? '' : 's'} on this market`}
          aria-expanded={open}
        >
          <Pencil size={14} />
          {drawings.length > 0 && <b>{drawings.length}</b>}
        </button>
      </div>

      {tool && (
        <p className="mk-draw-hint" role="status">
          <b>{DRAWING_INFO[tool].label}</b> — click {anchorsFor(tool)} point{anchorsFor(tool) === 1 ? '' : 's'} on the
          chart. {DRAWING_INFO[tool].hint} Press Escape to stop.
        </p>
      )}

      {open && (
        <div className="mk-draw-list">
          <header>
            <span>
              {drawings.length} on this market
              {drawings.length > 0 && visibleCount !== drawings.length && ` · ${drawings.length - visibleCount} hidden`}
            </span>
            {drawings.length > 0 && (
              <div className="mk-draw-bulk">
                {/* Hiding everything is one click and reversible. Deleting everything asks first. */}
                <button
                  type="button"
                  onClick={() => {
                    const makeVisible = visibleCount === 0
                    void Promise.all(drawings.map((one) => save({ ...one, visible: makeVisible })))
                  }}
                >
                  {visibleCount === 0 ? 'Show all' : 'Hide all'}
                </button>
                {confirming ? (
                  <>
                    <button
                      type="button"
                      className="mk-danger"
                      onClick={() => {
                        setConfirming(false)
                        void window.api.marketsDrawingsClear(instrumentId).then((result) => {
                          if (refused(result)) {
                            onNotify(result.message ?? 'Could not clear', 'error')
                            return
                          }
                          onChanged(result.drawings)
                          onSelect(null)
                          onNotify('Drawings cleared')
                        })
                      }}
                    >
                      Delete all {drawings.length}
                    </button>
                    <button type="button" onClick={() => setConfirming(false)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="mk-danger" onClick={() => setConfirming(true)}>
                    Delete all
                  </button>
                )}
              </div>
            )}
          </header>

          {drawings.length === 0 ? (
            <p className="mk-quiet">
              Nothing drawn here yet. Pick a tool above and click the chart. A drawing is stored against the price and
              the moment, so it stays where you put it through any zoom.
            </p>
          ) : (
            <ul>
              {drawings.map((one) => {
                const Icon = ICONS[one.kind]
                const price = one.anchors[0]?.price
                return (
                  <li key={one.id} className={one.id === selected ? 'on' : ''}>
                    <button type="button" className="mk-draw-pick" onClick={() => onSelect(one.id === selected ? null : one.id)}>
                      <Icon size={13} />
                      <span style={{ color: one.colour || 'var(--cyan)' }}>{DRAWING_INFO[one.kind].label}</span>
                      <em>
                        {one.text ? one.text : typeof price === 'number' ? priceText(price) : ''}
                      </em>
                    </button>
                    <button
                      type="button"
                      onClick={() => void save({ ...one, visible: !one.visible })}
                      title={one.visible ? 'Hide' : 'Show'}
                      aria-pressed={!one.visible}
                    >
                      {one.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void save({ ...one, locked: !one.locked })}
                      title={one.locked ? 'Unlock so it can be moved' : 'Lock so it cannot be moved by accident'}
                      aria-pressed={one.locked === true}
                    >
                      {one.locked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                    <button type="button" className="mk-danger" onClick={() => void remove(one.id)} title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {chosen && (
        <div className="mk-draw-edit" aria-label={`${DRAWING_INFO[chosen.kind].label} settings`}>
          <div className="mk-draw-swatches" role="group" aria-label="Colour">
            {COLOURS.map((colour) => (
              <button
                key={colour.id}
                type="button"
                className={(chosen.colour || '#3fd8ff') === colour.value ? 'on' : ''}
                style={{ background: colour.value }}
                onClick={() => void save({ ...chosen, colour: colour.value })}
                title={colour.label}
                aria-label={colour.label}
                aria-pressed={(chosen.colour || '#3fd8ff') === colour.value}
              />
            ))}
          </div>
          {(chosen.kind === 'text' || chosen.kind === 'marker') && (
            <input
              className="mk-draw-label"
              value={chosen.text ?? ''}
              aria-label="Label for this drawing" placeholder="Label"
              maxLength={80}
              onChange={(event) => void save({ ...chosen, text: event.target.value })}
            />
          )}
          {chosen.locked && <span className="mk-quiet">Locked — unlock it to move it.</span>}
          {busy && <span className="mk-quiet">Saving…</span>}
        </div>
      )}
    </div>
  )
}

/** A drawing built from what the chart handed back. The id and the time come from the caller so this stays pure. */
export function draftDrawing(
  kind: DrawingKind,
  instrumentId: string,
  anchors: Anchor[],
  at: number
): Partial<Drawing> {
  return {
    kind,
    instrumentId,
    anchors,
    visible: true,
    createdAt: at,
    // A text drawing with nothing to say is a dot nobody can read, so it starts with something to replace.
    ...(kind === 'text' ? { text: 'Note' } : {})
  }
}
