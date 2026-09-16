import { Component, useEffect, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { ChevronDown, ChevronUp, CircleAlert, RotateCcw, X } from 'lucide-react'
import type { WidgetFailure, WidgetInstance, ZoneName } from '../../../../shared/widgets'
import { afterFailure, widgetById, widgetsInZone, ZONES } from '../../../../shared/widgets'
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

  const fail = (instance: WidgetInstance, message: string): void => {
    const result = afterFailure(failures.current, instance.id, message)
    failures.current = result.failures
    // Three failures in a row and the widget is put aside rather than trying forever.
    if (result.disable) onChange(widgets.map((w) => (w.id === instance.id ? { ...w, disabled: true } : w)))
  }

  return (
    <div className="wg-zones">
      {ZONES.map((zone: ZoneName) => {
        const inZone = widgetsInZone(widgets, zone)
        if (!inZone.length) return null
        return (
          <div key={zone} className={`wg-zone wg-zone-${zone}`}>
            {inZone.map((instance) => {
              const definition = widgetById(instance.widget)
              const View = WIDGET_VIEWS[instance.widget]
              if (!definition || !View) return null
              return (
                <section key={instance.id} className={`wg-card wg-${instance.size}${instance.collapsed ? ' collapsed' : ''}`} aria-label={definition.name}>
                  <header className="wg-head">
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
            })}
          </div>
        )
      })}
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

/** Reads the widgets the user has set up and whether they asked for any, and follows every change to them. */
export function useWidgets(): { on: boolean; widgets: WidgetInstance[]; save(widgets: WidgetInstance[]): void } {
  const [widgets, setWidgets] = useState<WidgetInstance[]>([])
  const [on, setOn] = useState(false)

  useEffect(() => {
    let alive = true
    const take = (config: { widgets: unknown[]; newTab: { widgets: boolean } }): void => {
      if (!alive) return
      setWidgets(config.widgets as WidgetInstance[])
      setOn(config.newTab.widgets)
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

  return { on, widgets, save }
}
