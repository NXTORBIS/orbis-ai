import { Component, useEffect, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { ChevronDown, ChevronUp, CircleAlert, RotateCcw, X } from 'lucide-react'
import type { WidgetFailure, WidgetInstance, ZoneName } from '../../../../shared/widgets'
import { afterFailure, clearWidgetPlacement, placedWidgets, placeWidgetFreely, widgetById, widgetsInZone, ZONES } from '../../../../shared/widgets'
import { WIDGET_VIEWS } from './views'

/**
 * The widget engine in the window: it lays widgets out in zones and keeps each one to itself. A widget that throws shows
 * as unavailable with a way to try again; one that keeps throwing is set aside so it stops costing anything, with its
 * settings kept. Nothing a widget does can take the browser, its tabs or the address bar with it.
 */

interface BoundaryProps {
  children: ReactNode
  name: string
  onFailure(message: string): void
}

class WidgetBoundary extends Component<BoundaryProps, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept for the widget inspector; the browser itself carries on regardless.
    console.error(`[widget] ${this.props.name} failed`, error, info.componentStack)
    this.props.onFailure(error.message)
  }

  retry = (): void => this.setState({ error: null })

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return (
      <div className="wg-failed" role="alert">
        <CircleAlert size={15} />
        <b>{this.props.name} is unavailable</b>
        <small className="view-muted">{this.state.error}</small>
        <button type="button" className="queue-btn small" onClick={this.retry}>
          <RotateCcw size={12} /> Try again
        </button>
      </div>
    )
  }
}

export interface WidgetHostProps {
  widgets: WidgetInstance[]
  /** Where a widget should open something (a note, a task, a page). */
  onOpen(what: { kind: 'url' | 'view'; value: string }): void
  /** A widget was changed by the user (collapsed, or set aside after failing). */
  onChange(widgets: WidgetInstance[]): void
}

export default function WidgetHost({ widgets, onOpen, onChange }: WidgetHostProps): React.JSX.Element | null {
  // Failures are counted in a ref: a widget can throw again while React is still committing the last render, and a
  // count read from state would miss those and let a broken widget retry for ever.
  const failures = useRef<WidgetFailure[]>([])
  const live = widgets.filter((w) => !w.disabled)
  if (!live.length) return null

  const surface = useRef<HTMLDivElement>(null)

  /**
   * Dragging a widget to put it somewhere.
   *
   * Two things make this feel like moving an object rather than operating a control. The first is that the position
   * is written straight onto the element while the pointer moves -- asking React to re-render the whole board on
   * every pointer event would make a widget lag behind the hand holding it. The second is that nothing is saved
   * until the pointer is released: a drag is one decision, not a hundred.
   *
   * A small movement stays a click, so the fold button and everything inside the widget still work.
   */
  const startDrag = (instance: WidgetInstance, event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const host = surface.current
    const card = event.currentTarget.closest('.wg-card') as HTMLElement | null
    if (!host || !card) return

    const bounds = host.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const from = card.getBoundingClientRect()
    // Where in the widget it was grabbed, kept for the whole drag so the card does not jump under the pointer.
    const grabX = event.clientX - from.left
    const grabY = event.clientY - from.top
    const startX = event.clientX
    const startY = event.clientY
    let moved = false
    let place = { x: 0, y: 0 }

    const move = (e: PointerEvent): void => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return
      if (!moved) {
        moved = true
        card.classList.add('dragging')
        // From here it is placed, so it is positioned rather than laid out by its row.
        card.style.position = 'absolute'
        card.style.width = `${from.width}px`
      }
      const left = Math.min(Math.max(e.clientX - grabX - bounds.left, 0), Math.max(0, bounds.width - from.width))
      const top = Math.min(Math.max(e.clientY - grabY - bounds.top, 0), Math.max(0, bounds.height - from.height))
      card.style.left = `${left}px`
      card.style.top = `${top}px`
      // Kept as a fraction of the surface, so the same arrangement survives a different window on a different screen.
      place = { x: left / bounds.width, y: top / bounds.height }
    }

    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      card.classList.remove('dragging')
      // The inline position was only for the drag; where it ended up is now the board's business, not the DOM's.
      card.style.position = ''
      card.style.left = ''
      card.style.top = ''
      card.style.width = ''
      if (moved) onChange(placeWidgetFreely(widgets, instance.id, place))
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const fail = (instance: WidgetInstance, message: string): void => {
    const result = afterFailure(failures.current, instance.id, message)
    failures.current = result.failures
    // Three failures in a row and the widget is put aside rather than trying forever.
    if (result.disable) onChange(widgets.map((w) => (w.id === instance.id ? { ...w, disabled: true } : w)))
  }

  /**
   * One widget, wherever it is.
   *
   * The same card is used whether the widget is in a row or has been put somewhere by hand, so a widget does not
   * change into a different thing by being moved.
   */
  const card = (instance: WidgetInstance): React.JSX.Element | null => {
    const definition = widgetById(instance.widget)
    const View = WIDGET_VIEWS[instance.widget]
    if (!definition || !View) return null
    return (
      <section
        key={instance.id}
        className={`wg-card wg-${instance.size}${instance.collapsed ? ' collapsed' : ''}${instance.place ? ' placed' : ''}`}
        aria-label={definition.name}
        style={instance.place ? { left: `${(instance.place.x * 100).toFixed(3)}%`, top: `${(instance.place.y * 100).toFixed(3)}%` } : undefined}
      >
        <header
          className="wg-head"
          onPointerDown={(event) => startDrag(instance, event)}
          // Put back where it came from, for anyone who has moved one somewhere they did not mean to.
          onDoubleClick={() => instance.place && onChange(clearWidgetPlacement(widgets, instance.id))}
          title={instance.place ? 'Drag to move. Double-click to put it back in its row' : 'Drag to move'}
        >
          <b>{definition.name}</b>
          <button
            type="button"
            className="wg-icon"
            aria-label={instance.collapsed ? `Open ${definition.name}` : `Fold ${definition.name} away`}
            onClick={() => onChange(widgets.map((w) => (w.id === instance.id ? { ...w, collapsed: !w.collapsed } : w)))}
          >
            {instance.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </header>
        {!instance.collapsed && (
          <WidgetBoundary name={definition.name} onFailure={(message) => fail(instance, message)}>
            <View instance={instance} onOpen={onOpen} />
          </WidgetBoundary>
        )}
      </section>
    )
  }

  return (
    <div className="wg-zones" ref={surface}>
      {ZONES.map((zone: ZoneName) => {
        const inZone = widgetsInZone(widgets, zone)
        if (!inZone.length) return null
        return (
          <div key={zone} className={`wg-zone wg-zone-${zone}`}>
            {inZone.map(card)}
          </div>
        )
      })}
      {/* The widgets someone has put somewhere. Drawn over the rows rather than inside them, because that is what
          having been placed means: it is no longer part of any row's arrangement. */}
      {placedWidgets(widgets).map(card)}
      {widgets.some((w) => w.disabled) && (
        <div className="wg-setaside">
          {widgets
            .filter((w) => w.disabled)
            .map((instance) => (
              <span key={instance.id} className="wg-setaside-item">
                <X size={12} /> {widgetById(instance.widget)?.name ?? instance.widget} was set aside after failing
                <button
                  type="button"
                  className="queue-btn small"
                  onClick={() => {
                    // A fresh start: its past failures are forgotten, so it gets the full three tries again.
                    failures.current = failures.current.filter((f) => f.widgetId !== instance.id)
                    onChange(widgets.map((w) => (w.id === instance.id ? { ...w, disabled: false } : w)))
                  }}
                >
                  Turn it back on
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  )
}

/**
 * Reads what the new tab should show: the widgets the user has set up, whether they asked for any, and the wallpaper
 * they chose. Everything follows changes as they are made, so the tab never has to be reopened.
 */
export function useWidgets(): { on: boolean; widgets: WidgetInstance[]; wallpaper: string | null; save(widgets: WidgetInstance[]): void } {
  const [widgets, setWidgets] = useState<WidgetInstance[]>([])
  const [on, setOn] = useState(false)
  const [wallpaper, setWallpaper] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const take = (config: {
      widgets: unknown[]
      newTab: { widgets: boolean; wallpaperId: string | null }
      wallpapers: { id: string; source: string; kind: 'image' | 'gradient' }[]
    }): void => {
      if (!alive) return
      setWidgets(config.widgets as WidgetInstance[])
      setOn(config.newTab.widgets)
      const chosen = config.newTab.wallpaperId ? config.wallpapers.find((w) => w.id === config.newTab.wallpaperId) : null
      setWallpaper(chosen ? (chosen.kind === 'image' ? `url("${chosen.source}") center / cover no-repeat` : chosen.source) : null)
    }
    void window.api.getExperience().then(take)
    const off = window.api.onExperienceChanged(take)
    return () => {
      alive = false
      off()
    }
  }, [])

  const save = (next: WidgetInstance[]): void => {
    setWidgets(next)
    void window.api.getExperience().then((config) => window.api.saveExperience({ ...config, widgets: next }, 'Changed widgets'))
  }

  return { on, widgets, wallpaper, save }
}
