/**
 * Dashboards: named arrangements of widgets you can keep side by side and switch between — one for work, one for
 * reading, one for a project. A dashboard holds nothing but widgets, so switching one in never touches your tabs,
 * bookmarks or anything else.
 *
 * Orbis has none until you make one, and with none the new tab behaves exactly as it always has: it shows whatever
 * widgets you have chosen. Making your first dashboard keeps what is already on screen rather than throwing it away.
 *
 * Pure — no browser, no storage.
 */

import type { WidgetInstance } from './widgets'
import { normalizeWidgets } from './widgets.ts'

export const MAX_DASHBOARDS = 20

export interface Dashboard {
  id: string
  name: string
  widgets: WidgetInstance[]
  createdAt: number
}

const makeId = (): string => `dash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const newDashboard = (name: string, widgets: WidgetInstance[], at = Date.now()): Dashboard => ({
  id: makeId(),
  name: name.trim().slice(0, 60) || 'Dashboard',
  widgets: normalizeWidgets(widgets),
  createdAt: at
})

export function normalizeDashboard(raw: unknown): Dashboard | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Dashboard>
  if (typeof r.id !== 'string' || !r.id) return null
  return {
    id: r.id,
    name: String(r.name ?? 'Dashboard').slice(0, 60) || 'Dashboard',
    widgets: normalizeWidgets(r.widgets),
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0
  }
}

export const normalizeDashboards = (raw: unknown): Dashboard[] =>
  Array.isArray(raw) ? raw.map(normalizeDashboard).filter((d): d is Dashboard => d !== null).slice(0, MAX_DASHBOARDS) : []

/** The dashboard in use, or null when there is none and the new tab simply shows the widgets you have chosen. */
export const activeDashboard = (dashboards: Dashboard[], activeId: string | null): Dashboard | null =>
  (activeId ? dashboards.find((d) => d.id === activeId) : null) ?? null

/**
 * Switching to a dashboard: its widgets become the ones on screen, and the one being left keeps whatever it had, so
 * nothing is lost by looking at another dashboard and coming back.
 */
export function switchTo(
  dashboards: Dashboard[],
  activeId: string | null,
  widgets: WidgetInstance[],
  toId: string
): { dashboards: Dashboard[]; activeId: string; widgets: WidgetInstance[] } | null {
  const target = dashboards.find((d) => d.id === toId)
  if (!target) return null
  const kept = activeId ? dashboards.map((d) => (d.id === activeId ? { ...d, widgets } : d)) : dashboards
  return { dashboards: kept, activeId: target.id, widgets: target.widgets }
}

/** Keeping a change: while a dashboard is in use, editing the widgets on screen edits that dashboard too. */
export const rememberWidgets = (dashboards: Dashboard[], activeId: string | null, widgets: WidgetInstance[]): Dashboard[] =>
  activeId ? dashboards.map((d) => (d.id === activeId ? { ...d, widgets } : d)) : dashboards

/** Removing one. Whatever is on screen stays on screen; only the saved arrangement goes. */
export function removeDashboard(dashboards: Dashboard[], activeId: string | null, id: string): { dashboards: Dashboard[]; activeId: string | null } {
  return { dashboards: dashboards.filter((d) => d.id !== id), activeId: activeId === id ? null : activeId }
}
