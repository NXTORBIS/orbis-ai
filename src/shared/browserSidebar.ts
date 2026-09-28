/**
 * The Orbis browser sidebar: what is in it, and how somebody has arranged it.
 *
 * The browser is where browsing is managed, so everything that manages browsing lives here rather than beside the
 * chats. This file does not know what any of those panels look like or where their data comes from. It knows only the
 * arrangement: which panels exist, which groups they sit in, what is hidden, what is pinned, and how wide the thing is.
 *
 * The arrangement belongs to the person using Orbis, so it is theirs to change: every panel can be hidden, moved,
 * pinned or put in a group of their own making, and none of that is allowed to lose a panel. Orbis ships an order that
 * makes sense; nothing here insists on it.
 *
 * Pure — no browser, no storage, no React.
 */

export type PanelId =
  | 'search'
  | 'account'
  | 'tabs'
  | 'tabGroups'
  | 'bookmarks'
  | 'history'
  | 'downloads'
  | 'readingList'
  | 'savedPages'
  | 'workspaces'
  | 'extensions'
  | 'research'
  | 'sources'
  | 'galaxy'
  | 'notes'
  | 'tasks'
  | 'reminders'
  | 'clipboard'
  | 'whiteboard'
  | 'screenshots'
  | 'media'
  | 'privacy'
  | 'adblock'
  | 'tracking'
  | 'controls'
  | 'workflows'
  | 'secrets'
  | 'orion'
  | 'customize'

export interface PanelInfo {
  id: PanelId
  label: string
  /** The group Orbis puts it in to begin with. Somebody may move it anywhere. */
  home: string
  /** Said in the sidebar's own tooltip, and to Orion when it is asked what it can open. */
  description: string
}

/**
 * Every panel the sidebar can show. Adding one here is enough for it to appear for everybody, including people whose
 * arrangement was saved before it existed.
 */
export const PANELS: PanelInfo[] = [
  { id: 'tabs', label: 'Tabs', home: 'browsing', description: 'Every open tab, to search, switch, close or reopen' },
  { id: 'tabGroups', label: 'Tab groups', home: 'browsing', description: 'The groups tabs are gathered into' },
  { id: 'bookmarks', label: 'Bookmarks', home: 'browsing', description: 'Pages kept for later, in folders' },
  { id: 'history', label: 'History', home: 'browsing', description: 'Where this profile has been' },
  { id: 'downloads', label: 'Downloads', home: 'browsing', description: 'Files Orbis has fetched, and how they are getting on' },
  { id: 'readingList', label: 'Reading list', home: 'browsing', description: 'Pages set aside to read' },
  { id: 'savedPages', label: 'Saved pages', home: 'browsing', description: 'Pages saved to this computer, readable offline' },
  { id: 'workspaces', label: 'Workspaces', home: 'browsing', description: 'Sets of tabs kept together and reopened as one' },
  { id: 'extensions', label: 'Extensions', home: 'browsing', description: 'What is installed, and whether it is on' },

  { id: 'search', label: 'Search', home: 'work', description: 'Search the web from Orbis' },
  { id: 'research', label: 'Research', home: 'work', description: 'What Orion has looked into, and what it found' },
  { id: 'sources', label: 'Sources', home: 'work', description: 'The pages behind an answer' },
  { id: 'galaxy', label: 'Galaxy', home: 'work', description: 'A map of everything kept in Orbis, and how it is really connected' },
  { id: 'notes', label: 'Notes', home: 'work', description: 'Notes kept in Orbis' },
  { id: 'tasks', label: 'Tasks', home: 'work', description: 'Things to do' },
  { id: 'reminders', label: 'Reminders', home: 'work', description: 'Tasks with a time on them' },
  { id: 'clipboard', label: 'Clipboard', home: 'work', description: 'What has been copied' },
  { id: 'whiteboard', label: 'Whiteboard', home: 'work', description: 'A board to draw on' },
  { id: 'screenshots', label: 'Screenshots', home: 'work', description: 'Pictures taken of pages' },
  { id: 'media', label: 'Media', home: 'work', description: 'What is playing, and where' },

  { id: 'privacy', label: 'Privacy', home: 'protection', description: 'What this page is allowed to do, and whether it is secure' },
  { id: 'adblock', label: 'Ad blocking', home: 'protection', description: 'What was blocked on this page, and the rules behind it' },
  { id: 'tracking', label: 'Tracking protection', home: 'protection', description: 'Trackers, pop-ups and redirects' },

  { id: 'controls', label: 'Browser controls', home: 'orbis', description: 'Everything Orbis can be asked to do, and what it has done' },
  { id: 'workflows', label: 'Workflows', home: 'orbis', description: 'Sequences Orbis runs for you, and what they did' },
  { id: 'secrets', label: 'Secrets', home: 'settings', description: 'API keys, passwords and notes, locked behind a master password' },
  { id: 'orion', label: 'Orion', home: 'orbis', description: 'Ask about this page, summarise it, or research it' },
  { id: 'customize', label: 'Customize', home: 'orbis', description: 'Themes, wallpapers, widgets and how Orbis looks' },
  // Named in `PanelId`, placed in the Settings group below, and given an icon -- but never described here, so every
  // lookup for it found nothing and the arrangement shipped with a panel that could not be drawn.
  { id: 'account', label: 'Account', home: 'settings', description: 'Who is signed in to Orbis on this computer' }
]

export const PANEL_IDS: PanelId[] = PANELS.map((p) => p.id)

export function panelInfo(id: PanelId): PanelInfo | undefined {
  return PANELS.find((p) => p.id === id)
}

export function panelLabel(id: PanelId): string {
  return panelInfo(id)?.label ?? id
}

/**
 * What the sidebar actually shows.
 *
 * Twenty-six things in a list is not a sidebar, it is an inventory. These are the nine a person actually thinks in --
 * tabs, library, spaces, notes, research, media, protection, Orion, settings -- and each one opens to the panels it
 * holds. Nothing is hidden: everything is one level in rather than twenty-five rows down.
 *
 * They are only a starting point. Any panel can be moved to any section, and the sections renamed, as before.
 */
const HOME_GROUPS: { id: string; label: string; panels: PanelId[] }[] = [
  { id: 'tabs', label: 'Tabs', panels: ['tabs', 'tabGroups'] },
  { id: 'library', label: 'Library', panels: ['bookmarks', 'history', 'downloads', 'readingList', 'savedPages'] },
  { id: 'spaces', label: 'Spaces', panels: ['workspaces'] },
  { id: 'notes', label: 'Notes', panels: ['notes', 'tasks', 'reminders', 'clipboard', 'whiteboard'] },
  { id: 'research', label: 'Research', panels: ['search', 'research', 'sources', 'galaxy'] },
  { id: 'media', label: 'Media', panels: ['screenshots', 'media'] },
  { id: 'protection', label: 'Protection', panels: ['privacy', 'adblock', 'tracking'] },
  { id: 'orion', label: 'Orion', panels: ['orion', 'controls', 'workflows'] },
  { id: 'settings', label: 'Settings', panels: ['customize', 'extensions', 'secrets', 'account'] }
]

/** The icon a section is shown by: its first panel's, so a section looks like what it opens. */
export const sectionLead = (group: { items: PanelId[] }): PanelId | null => group.items[0] ?? null

/** How much of each row is shown. */
export type SidebarMode = 'icons' | 'labels'
/** How tightly the rows are packed. */
export type SidebarDensity = 'compact' | 'comfortable'

export interface SidebarGroup {
  id: string
  label: string
  collapsed: boolean
  items: PanelId[]
}

export interface SidebarLayout {
  /** Raised when an arrangement saved by an older Orbis has to be read differently. */
  version: number
  groups: SidebarGroup[]
  /** Panels that stay out of the way until they are asked for. */
  hidden: PanelId[]
  /** Panels kept at the top, above the groups, in the order they were pinned. */
  pinned: PanelId[]
  mode: SidebarMode
  density: SidebarDensity
  /** How wide the list of panels is. An icon-only sidebar ignores it. */
  width: number
  /** Whether the sidebar is showing at all. */
  open: boolean
  /** The panel showing, or null when the list alone is showing. */
  panel: PanelId | null
}

export const LAYOUT_VERSION = 1
export const MIN_WIDTH = 168
export const MAX_WIDTH = 460
export const ICON_WIDTH = 52
export const DEFAULT_WIDTH = 210
export const MAX_GROUPS = 12
const MAX_LABEL = 40

export function defaultLayout(): SidebarLayout {
  return {
    version: LAYOUT_VERSION,
    groups: HOME_GROUPS.map((g) => ({ id: g.id, label: g.label, collapsed: false, items: [...g.panels] })),
    hidden: [],
    pinned: [],
    mode: 'labels',
    density: 'comfortable',
    width: DEFAULT_WIDTH,
    open: false,
    panel: null
  }
}

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, Math.round(n)))
const tidyLabel = (raw: unknown, fallback: string): string => {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL) : ''
  return text || fallback
}

/**
 * An arrangement read back from disk, made safe to use.
 *
 * Anything unrecognised is dropped and anything missing is put back, so a panel can never be lost: a new panel joins
 * the group it was born in, a panel that no longer exists disappears quietly, and a file written by a future Orbis, or
 * by hand, still opens something sensible.
 */
export function normalizeLayout(raw: unknown): SidebarLayout {
  const base = defaultLayout()
  const input = (raw ?? {}) as Partial<SidebarLayout>
  if (!input || typeof input !== 'object') return base

  const known = new Set<PanelId>(PANEL_IDS)
  const placed = new Set<PanelId>()

  const groups: SidebarGroup[] = []
  for (const group of Array.isArray(input.groups) ? input.groups.slice(0, MAX_GROUPS) : []) {
    if (!group || typeof group !== 'object') continue
    const id = typeof group.id === 'string' && group.id.trim() ? group.id.trim().slice(0, 64) : `group-${groups.length + 1}`
    if (groups.some((g) => g.id === id)) continue
    const items: PanelId[] = []
    for (const item of Array.isArray(group.items) ? group.items : []) {
      if (known.has(item as PanelId) && !placed.has(item as PanelId)) {
        placed.add(item as PanelId)
        items.push(item as PanelId)
      }
    }
    groups.push({ id, label: tidyLabel(group.label, id), collapsed: group.collapsed === true, items })
  }
  if (!groups.length) groups.push(...base.groups.map((g) => ({ ...g, items: [] as PanelId[] })))

  // A panel nobody has placed goes to the section it belongs to, or to the first one if that has been removed.
  for (const panel of PANELS) {
    if (placed.has(panel.id)) continue
    const born = HOME_GROUPS.find((g) => g.panels.includes(panel.id))?.id
    const home = groups.find((g) => g.id === born) ?? groups[0]
    home.items.push(panel.id)
    placed.add(panel.id)
  }

  const listOf = (value: unknown): PanelId[] => {
    const out: PanelId[] = []
    for (const item of Array.isArray(value) ? value : []) if (known.has(item as PanelId) && !out.includes(item as PanelId)) out.push(item as PanelId)
    return out
  }

  return {
    version: LAYOUT_VERSION,
    groups,
    hidden: listOf(input.hidden),
    pinned: listOf(input.pinned),
    mode: input.mode === 'icons' ? 'icons' : 'labels',
    density: input.density === 'comfortable' ? 'comfortable' : 'compact',
    width: clamp(typeof input.width === 'number' && Number.isFinite(input.width) ? input.width : DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
    open: input.open === true,
    // A panel that has been hidden since, or that no longer exists, is not reopened.
    panel: known.has(input.panel as PanelId) && !listOf(input.hidden).includes(input.panel as PanelId) ? (input.panel as PanelId) : null
  }
}

// ---------------------------------------------------------------- changing the arrangement

const withGroups = (layout: SidebarLayout, groups: SidebarGroup[]): SidebarLayout => ({ ...layout, groups })

/** Where a panel is now, or null when it is somehow nowhere. */
export function locate(layout: SidebarLayout, id: PanelId): { groupId: string; index: number } | null {
  for (const group of layout.groups) {
    const index = group.items.indexOf(id)
    if (index >= 0) return { groupId: group.id, index }
  }
  return null
}

/**
 * Moves a panel, whether within its group or into another one.
 *
 * The index is where it should end up once it has left where it was, which is what dropping it somewhere means.
 */
export function movePanel(layout: SidebarLayout, id: PanelId, toGroupId: string, toIndex: number): SidebarLayout {
  if (!PANEL_IDS.includes(id) || !layout.groups.some((g) => g.id === toGroupId)) return layout
  const groups = layout.groups.map((g) => ({ ...g, items: g.items.filter((item) => item !== id) }))
  const target = groups.find((g) => g.id === toGroupId)!
  target.items.splice(clamp(toIndex, 0, target.items.length), 0, id)
  return withGroups(layout, groups)
}

/** Hiding a panel takes it out of the sidebar without forgetting where it sat, so showing it again puts it back. */
export function setPanelHidden(layout: SidebarLayout, id: PanelId, hidden: boolean): SidebarLayout {
  if (!PANEL_IDS.includes(id)) return layout
  const without = layout.hidden.filter((h) => h !== id)
  return {
    ...layout,
    hidden: hidden ? [...without, id] : without,
    pinned: hidden ? layout.pinned.filter((p) => p !== id) : layout.pinned,
    // Hiding the panel that is open closes it, rather than leaving it showing with no way back to it.
    panel: hidden && layout.panel === id ? null : layout.panel
  }
}

export function isHidden(layout: SidebarLayout, id: PanelId): boolean {
  return layout.hidden.includes(id)
}

/** Pinning lifts a panel above the groups. A hidden panel is shown again by pinning it, since that is what was meant. */
export function setPanelPinned(layout: SidebarLayout, id: PanelId, pinned: boolean): SidebarLayout {
  if (!PANEL_IDS.includes(id)) return layout
  const without = layout.pinned.filter((p) => p !== id)
  return { ...layout, pinned: pinned ? [...without, id] : without, hidden: pinned ? layout.hidden.filter((h) => h !== id) : layout.hidden }
}

export function isPinned(layout: SidebarLayout, id: PanelId): boolean {
  return layout.pinned.includes(id)
}

export function movePinned(layout: SidebarLayout, id: PanelId, toIndex: number): SidebarLayout {
  if (!layout.pinned.includes(id)) return layout
  const pinned = layout.pinned.filter((p) => p !== id)
  pinned.splice(clamp(toIndex, 0, pinned.length), 0, id)
  return { ...layout, pinned }
}

export function addGroup(layout: SidebarLayout, label: string): SidebarLayout {
  if (layout.groups.length >= MAX_GROUPS) return layout
  let id = `group-${Date.now().toString(36)}`
  while (layout.groups.some((g) => g.id === id)) id = `${id}x`
  return withGroups(layout, [...layout.groups, { id, label: tidyLabel(label, 'New group'), collapsed: false, items: [] }])
}

export function renameGroup(layout: SidebarLayout, groupId: string, label: string): SidebarLayout {
  return withGroups(
    layout,
    layout.groups.map((g) => (g.id === groupId ? { ...g, label: tidyLabel(label, g.label) } : g))
  )
}

/** Removing a group keeps its panels: they join the group above, since nothing should vanish with a container. */
export function removeGroup(layout: SidebarLayout, groupId: string): SidebarLayout {
  if (layout.groups.length <= 1) return layout
  const index = layout.groups.findIndex((g) => g.id === groupId)
  if (index < 0) return layout
  const going = layout.groups[index]
  const groups = layout.groups.filter((g) => g.id !== groupId)
  const keeper = groups[Math.max(0, index - 1)]
  keeper.items = [...keeper.items, ...going.items]
  return withGroups(layout, groups)
}

export function setGroupCollapsed(layout: SidebarLayout, groupId: string, collapsed: boolean): SidebarLayout {
  return withGroups(
    layout,
    layout.groups.map((g) => (g.id === groupId ? { ...g, collapsed } : g))
  )
}

export function moveGroup(layout: SidebarLayout, groupId: string, toIndex: number): SidebarLayout {
  const index = layout.groups.findIndex((g) => g.id === groupId)
  if (index < 0) return layout
  const groups = [...layout.groups]
  const [group] = groups.splice(index, 1)
  groups.splice(clamp(toIndex, 0, groups.length), 0, group)
  return withGroups(layout, groups)
}

export function setMode(layout: SidebarLayout, mode: SidebarMode): SidebarLayout {
  return { ...layout, mode }
}

export function setDensity(layout: SidebarLayout, density: SidebarDensity): SidebarLayout {
  return { ...layout, density }
}

export function setWidth(layout: SidebarLayout, width: number): SidebarLayout {
  return { ...layout, width: clamp(width, MIN_WIDTH, MAX_WIDTH) }
}

/** Opens a panel, or closes the open one. Opening a hidden panel shows it again, since that is what was asked for. */
export function openPanel(layout: SidebarLayout, panel: PanelId | null): SidebarLayout {
  if (panel === null) return { ...layout, panel: null }
  if (!PANEL_IDS.includes(panel)) return layout
  const shown = layout.hidden.includes(panel) ? setPanelHidden(layout, panel, false) : layout
  return { ...shown, open: true, panel }
}

export function setOpen(layout: SidebarLayout, open: boolean): SidebarLayout {
  return { ...layout, open }
}

/** How wide the sidebar actually is on screen: an icon-only sidebar is as wide as an icon, whatever was dragged. */
export function shownWidth(layout: SidebarLayout): number {
  return layout.mode === 'icons' ? ICON_WIDTH : layout.width
}

/** What the sidebar draws, in order: the pinned panels, then each group with its visible panels. */
export function visibleLayout(layout: SidebarLayout): { pinned: PanelId[]; groups: { id: string; label: string; collapsed: boolean; items: PanelId[] }[] } {
  const shown = (id: PanelId): boolean => !layout.hidden.includes(id) && !layout.pinned.includes(id)
  return {
    pinned: layout.pinned.filter((id) => PANEL_IDS.includes(id)),
    groups: layout.groups.map((g) => ({ id: g.id, label: g.label, collapsed: g.collapsed, items: g.items.filter(shown) }))
  }
}

/** Every panel that can be reached right now, pinned or in a group — what Orion is allowed to open. */
export function reachablePanels(layout: SidebarLayout): PanelId[] {
  const view = visibleLayout(layout)
  return [...view.pinned, ...view.groups.flatMap((g) => g.items)]
}

/** A panel named in words, for Orion: "bookmarks", "Reading list", "ad blocking" all find their panel. */
export function findPanel(text: string): PanelId | null {
  const wanted = text.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (!wanted) return null
  const match = PANELS.find((p) => p.id.toLowerCase() === wanted || p.label.toLowerCase().replace(/[\s_-]+/g, '') === wanted)
  if (match) return match.id
  // "my bookmarks", "the downloads panel": the name is in there somewhere.
  return PANELS.find((p) => wanted.includes(p.label.toLowerCase().replace(/[\s_-]+/g, '')))?.id ?? null
}
