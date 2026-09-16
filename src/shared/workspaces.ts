/**
 * Workspaces: a named set of tabs and tab groups you can come back to. Pure — no browser, no storage — so what a
 * workspace is, how one is taken from the window, and whether the window still matches it can all be tested.
 */

export interface WorkspaceTab {
  url: string
  title: string
  pinned: boolean
  /** The name of the group it belongs to, when it is in one. */
  group?: string
  active?: boolean
  muted?: boolean
}

export interface WorkspaceGroup {
  name: string
  color: string
  collapsed: boolean
}

export interface Workspace {
  id: string
  name: string
  color: string
  tabs: WorkspaceTab[]
  groups: WorkspaceGroup[]
  /** Keeps itself up to date as you browse, instead of waiting to be saved. */
  autoUpdate: boolean
  createdAt: number
  updatedAt: number
  lastOpenedAt?: number
  order: number
}

export const WORKSPACE_COLORS = ['#3fd8ff', '#3ee58a', '#ffbe4d', '#ff4d6d', '#a78bfa', '#f472b6']
export const MAX_WORKSPACE_TABS = 300

const now = (): number => Date.now()

export const newWorkspace = (patch: Partial<Workspace> = {}): Workspace => ({
  id: patch.id ?? crypto.randomUUID(),
  name: 'New workspace',
  color: WORKSPACE_COLORS[0],
  tabs: [],
  groups: [],
  autoUpdate: false,
  createdAt: now(),
  updatedAt: now(),
  order: 0,
  ...patch
})

/** Only pages worth reopening: real addresses, not blank tabs or Orbis's own pages. */
export const keepableUrl = (url: string): boolean => /^(https?|file):/i.test(url) && !/^about:|^chrome:|^devtools:/i.test(url)

export function normalizeWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Workspace>
  if (typeof r.id !== 'string' || !r.id) return null
  const groups = (Array.isArray(r.groups) ? r.groups : [])
    .filter((g): g is WorkspaceGroup => Boolean(g) && typeof g.name === 'string')
    .map((g) => ({ name: g.name.replace(/\s+/g, ' ').trim().slice(0, 40), color: typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : WORKSPACE_COLORS[0], collapsed: g.collapsed === true }))
    .slice(0, 50)
  const groupNames = new Set(groups.map((g) => g.name))
  const tabs = (Array.isArray(r.tabs) ? r.tabs : [])
    .filter((t): t is WorkspaceTab => Boolean(t) && typeof t.url === 'string' && keepableUrl(t.url))
    .map((t) => ({
      url: t.url.slice(0, 2048),
      title: String(t.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      pinned: t.pinned === true,
      ...(t.group && groupNames.has(t.group) ? { group: t.group } : {}),
      ...(t.active ? { active: true } : {}),
      ...(t.muted ? { muted: true } : {})
    }))
    .slice(0, MAX_WORKSPACE_TABS)
  return {
    id: r.id,
    name: (typeof r.name === 'string' ? r.name : '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled workspace',
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : WORKSPACE_COLORS[0],
    tabs,
    groups: groups.filter((g) => tabs.some((t) => t.group === g.name)),
    autoUpdate: r.autoUpdate === true,
    createdAt: Number(r.createdAt) || now(),
    updatedAt: Number(r.updatedAt) || Number(r.createdAt) || now(),
    ...(Number(r.lastOpenedAt) ? { lastOpenedAt: Number(r.lastOpenedAt) } : {}),
    order: Number(r.order) || 0
  }
}

/** What the browser window holds right now, as a workspace's tabs and groups. Private tabs are never saved. */
export function fromBrowserState(
  state: { tabs: { url: string; title: string; pinned?: boolean; private?: boolean; muted?: boolean; active?: boolean; groupId?: string | null }[]; groups?: { id: string; name: string; color: string; collapsed?: boolean }[] } | null | undefined
): { tabs: WorkspaceTab[]; groups: WorkspaceGroup[] } {
  const groupsById = new Map((state?.groups ?? []).map((g) => [g.id, g]))
  const tabs: WorkspaceTab[] = (state?.tabs ?? [])
    .filter((t) => !t.private && keepableUrl(t.url))
    .map((t) => {
      const group = t.groupId ? groupsById.get(t.groupId) : undefined
      return {
        url: t.url,
        title: t.title ?? '',
        pinned: t.pinned === true,
        ...(group ? { group: group.name } : {}),
        ...(t.active ? { active: true } : {}),
        ...(t.muted ? { muted: true } : {})
      }
    })
    .slice(0, MAX_WORKSPACE_TABS)
  const used = new Set(tabs.map((t) => t.group).filter(Boolean))
  const groups: WorkspaceGroup[] = (state?.groups ?? []).filter((g) => used.has(g.name)).map((g) => ({ name: g.name, color: g.color, collapsed: g.collapsed === true }))
  return { tabs, groups }
}

export interface WorkspaceSummary {
  tabs: number
  groups: number
  pinned: number
  /** The sites in it, most tabs first, for a one-line description. */
  sites: string[]
}

export function summarize(workspace: Workspace): WorkspaceSummary {
  const counts = new Map<string, number>()
  for (const tab of workspace.tabs) {
    try {
      const host = new URL(tab.url).host.replace(/^www\./, '')
      counts.set(host, (counts.get(host) ?? 0) + 1)
    } catch {
      // A page whose address can't be read still counts as a tab.
    }
  }
  return {
    tabs: workspace.tabs.length,
    groups: workspace.groups.length,
    pinned: workspace.tabs.filter((t) => t.pinned).length,
    sites: [...counts].sort((a, b) => b[1] - a[1]).map(([host]) => host).slice(0, 4)
  }
}

/** Whether the window still holds what the workspace says, ignoring order (so switching back is not offered wrongly). */
export function matchesState(workspace: Workspace, current: { tabs: WorkspaceTab[] }): boolean {
  const saved = new Set(workspace.tabs.map((t) => t.url))
  const open = new Set(current.tabs.map((t) => t.url))
  if (saved.size !== open.size) return false
  for (const url of saved) if (!open.has(url)) return false
  return true
}

/** What opening a workspace would do to the window, so the user can be told before anything closes. */
export function openPlan(workspace: Workspace, current: { tabs: WorkspaceTab[] }, replace: boolean): { open: number; close: number; keep: number } {
  const wanted = workspace.tabs.map((t) => t.url)
  const openNow = current.tabs.map((t) => t.url)
  const already = wanted.filter((url) => openNow.includes(url))
  return {
    open: wanted.length - already.length,
    close: replace ? openNow.filter((url) => !wanted.includes(url)).length : 0,
    keep: replace ? already.length : openNow.length
  }
}
