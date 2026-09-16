import { useCallback, useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AppWindow,
  Maximize2,
  Minimize2,
  Bookmark,
  Boxes,
  Camera,
  ChevronRight,
  ClipboardList,
  Clock,
  Columns2,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FolderTree,
  GripVertical,
  Layers,
  ListTodo,
  Music,
  NotebookPen,
  Paintbrush,
  PenLine,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  Quote,
  RotateCcw,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Sliders,
  Sparkles,
  SquareStack,
  Telescope,
  Trash2,
  UserRound,
  Workflow,
  X
} from 'lucide-react'
import type { PanelId, SidebarLayout } from '../../../shared/browserSidebar'
import {
  addGroup,
  ICON_WIDTH,
  isPinned,
  MAX_PANEL_WIDTH,
  MAX_WIDTH,
  MIN_PANEL_WIDTH,
  MIN_WIDTH,
  movePanel,
  openPanel,
  panelInfo,
  panelLabel,
  removeGroup,
  renameGroup,
  setDensity,
  setFull,
  setGroupCollapsed,
  setMode,
  setPanelHidden,
  setPanelPinned,
  setPanelWidth,
  setWidth,
  shownWidth,
  visibleLayout
} from '../../../shared/browserSidebar'
import { useDismiss } from '../lib/useDismiss'

/**
 * The Orbis browser sidebar.
 *
 * The browser's surface stays as simple as it was — one address bar, one row of tabs — and everything that manages
 * browsing lives here instead: the tabs and the groups they are in, the bookmarks and history and downloads, the
 * research and the notes taken during it, what is being blocked, and how Orbis looks.
 *
 * None of that is implemented here. This draws the list, remembers how somebody has arranged it, and shows one panel
 * at a time; each panel is the real Orbis feature, rendered beside the page rather than over it.
 *
 * The arrangement is theirs to change. Panels can be dragged between groups, pinned to the top, hidden, or gathered
 * into groups of their own making, and the whole thing can be narrowed to icons when the page matters more.
 */

const ICONS: Record<PanelId, LucideIcon> = {
  tabs: SquareStack,
  tabGroups: FolderTree,
  bookmarks: Bookmark,
  history: Clock,
  downloads: Download,
  readingList: Layers,
  savedPages: FileDown,
  workspaces: Boxes,
  profiles: UserRound,
  extensions: Puzzle,
  research: Telescope,
  sources: Quote,
  notes: NotebookPen,
  tasks: ListTodo,
  reminders: Clock,
  clipboard: ClipboardList,
  whiteboard: PenLine,
  screenshots: Camera,
  media: Music,
  privacy: ShieldCheck,
  adblock: ShieldOff,
  tracking: Eye,
  controls: Sliders,
  workflows: Workflow,
  orion: Sparkles,
  customize: Paintbrush
}

export const panelIcon = (id: PanelId): LucideIcon => ICONS[id] ?? AppWindow

export interface BrowserSidebarProps {
  layout: SidebarLayout
  onLayout(next: SidebarLayout): void
  onReset(): void
  /** What the open panel draws. Given by the browser, so the sidebar itself knows nothing about any feature. */
  renderPanel(id: PanelId): React.ReactNode
  /** Counts shown against a panel — open tabs, downloads in progress — from the real thing, or nothing at all. */
  badges?: Partial<Record<PanelId, number>>
}

interface DragState {
  panel: PanelId
  overGroup: string | null
  overIndex: number
}

export default function BrowserSidebar({ layout, onLayout, onReset, renderPanel, badges }: BrowserSidebarProps): React.JSX.Element {
  const view = visibleLayout(layout)
  const [arranging, setArranging] = useState(false)
  const [menu, setMenu] = useState<{ panel: PanelId; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const drag = useRef<DragState | null>(null)
  const [dragging, setDragging] = useState<PanelId | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useDismiss(menuRef, Boolean(menu), () => setMenu(null))

  const icons = layout.mode === 'icons' && !layout.full
  const full = layout.full
  const change = useCallback((next: SidebarLayout) => onLayout(next), [onLayout])

  // Dragging the edge of either column. The width is stored as it settles, not on every frame.
  const startResize = (which: 'list' | 'panel') => (event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = which === 'list' ? layout.width : layout.panelWidth
    const [low, high] = which === 'list' ? [MIN_WIDTH, MAX_WIDTH] : [MIN_PANEL_WIDTH, MAX_PANEL_WIDTH]
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    let latest = startWidth
    const move = (e: PointerEvent): void => {
      latest = Math.min(high, Math.max(low, startWidth + (e.clientX - startX)))
      const element = which === 'list' ? listRef.current : listRef.current?.parentElement?.querySelector('.bsb-panel')
      if (element instanceof HTMLElement) element.style.width = `${latest}px`
    }
    const done = (): void => {
      target.releasePointerCapture(event.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', done)
      change(which === 'list' ? setWidth(layout, latest) : setPanelWidth(layout, latest))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', done)
  }

  // Arrow keys walk the list, so the sidebar is usable without a mouse.
  const onListKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('.bsb-row') ?? [])]
    const at = rows.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    rows[Math.min(rows.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  const dropOn = (groupId: string, index: number) => (event: React.DragEvent): void => {
    event.preventDefault()
    const panel = drag.current?.panel
    drag.current = null
    setDragging(null)
    if (panel) change(movePanel(layout, panel, groupId, index))
  }

  const row = (id: PanelId, groupId: string | null, index: number): React.JSX.Element => {
    const Icon = panelIcon(id)
    const info = panelInfo(id)
    const on = layout.panel === id
    const count = badges?.[id]
    return (
      <button
        key={id}
        type="button"
        className={`bsb-row${on ? ' on' : ''}${dragging === id ? ' dragging' : ''}`}
        aria-pressed={on}
        title={icons ? `${panelLabel(id)} — ${info?.description ?? ''}` : info?.description}
        draggable={Boolean(groupId)}
        onDragStart={() => {
          drag.current = { panel: id, overGroup: groupId, overIndex: index }
          setDragging(id)
        }}
        onDragEnd={() => {
          drag.current = null
          setDragging(null)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={groupId ? dropOn(groupId, index) : undefined}
        onClick={() => change(openPanel(layout, on ? null : id))}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ panel: id, x: e.clientX, y: e.clientY })
        }}
      >
        <Icon size={16} aria-hidden="true" />
        {!icons && <span className="bsb-row-label truncate">{panelLabel(id)}</span>}
        {!icons && count ? <span className="bsb-count">{count > 99 ? '99+' : count}</span> : null}
        {!icons && arranging && (
          <span className="bsb-row-tools">
            <span
              role="button"
              tabIndex={-1}
              aria-label={isPinned(layout, id) ? `Unpin ${panelLabel(id)}` : `Pin ${panelLabel(id)}`}
              title={isPinned(layout, id) ? 'Unpin' : 'Pin to the top'}
              onClick={(e) => {
                e.stopPropagation()
                change(setPanelPinned(layout, id, !isPinned(layout, id)))
              }}
            >
              {isPinned(layout, id) ? <PinOff size={13} /> : <Pin size={13} />}
            </span>
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Hide ${panelLabel(id)}`}
              title="Hide from the sidebar"
              onClick={(e) => {
                e.stopPropagation()
                change(setPanelHidden(layout, id, true))
              }}
            >
              <EyeOff size={13} />
            </span>
            <GripVertical size={13} className="bsb-grip" aria-hidden="true" />
          </span>
        )}
      </button>
    )
  }

  return (
    <>
      <div
        ref={listRef}
        className={`bsb-list${icons ? ' icons' : ''}${layout.density === 'compact' ? ' compact' : ''}${full ? ' full' : ''}`}
        style={full ? undefined : { width: shownWidth(layout) }}
        role="navigation"
        aria-label="Browser sidebar"
        onKeyDown={onListKeyDown}
      >
        <div className="bsb-list-scroll">
          {view.pinned.length > 0 && <div className="bsb-pinned">{view.pinned.map((id, i) => row(id, null, i))}</div>}

          {/*
            * One row per section, not per panel: nine things a person thinks in, rather than twenty-six they have to
            * read through. The section opens to whichever of its panels was last looked at, and the rest are tabs
            * along the top of it. Arranging still works on the panels themselves.
            */}
          {full &&
            view.groups
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <section key={group.id} className="bsb-group">
                  <div className="bsb-group-head">
                    <span className="bsb-group-name as-label">{group.label}</span>
                  </div>
                  <div className="bsb-group-body">{group.items.map((id, i) => row(id, group.id, i))}</div>
                </section>
              ))}

          {!full && !arranging &&
            view.groups
              .filter((group) => group.items.length > 0)
              .map((group) => {
                const lead = group.items.includes(layout.panel as PanelId) ? (layout.panel as PanelId) : group.items[0]
                const Icon = panelIcon(lead)
                const on = Boolean(layout.panel && group.items.includes(layout.panel))
                const count = group.items.reduce((sum, id) => sum + (badges?.[id] ?? 0), 0)
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`bsb-row${on ? ' on' : ''}`}
                    aria-pressed={on}
                    title={`${group.label}: ${group.items.map((id) => panelLabel(id)).join(', ')}`}
                    onClick={() => change(openPanel(layout, on ? null : lead))}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ panel: lead, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {!icons && <span className="bsb-row-label truncate">{group.label}</span>}
                    {!icons && count ? <span className="bsb-count">{count > 99 ? '99+' : count}</span> : null}
                  </button>
                )
              })}

          {!full && arranging &&
            view.groups.map((group) => (
            <section key={group.id} className="bsb-group">
              {!icons && (
                <div className="bsb-group-head">
                  {renaming === group.id ? (
                    <input
                      className="hud-input compact"
                      defaultValue={group.label}
                      aria-label="Group name"
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        change(renameGroup(layout, group.id, e.currentTarget.value))
                        setRenaming(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="bsb-group-name"
                        aria-expanded={!group.collapsed}
                        onClick={() => change(setGroupCollapsed(layout, group.id, !group.collapsed))}
                        onDoubleClick={() => arranging && setRenaming(group.id)}
                      >
                        <ChevronRight size={12} className={group.collapsed ? undefined : 'open'} />
                        {group.label}
                      </button>
                      {arranging && (
                        <span className="bsb-group-tools">
                          <button type="button" aria-label={`Rename ${group.label}`} title="Rename" onClick={() => setRenaming(group.id)}>
                            <Settings2 size={12} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${group.label}`}
                            title="Remove the group; its panels move up"
                            onClick={() => change(removeGroup(layout, group.id))}
                          >
                            <Trash2 size={12} />
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
              {!group.collapsed && (
                <div className="bsb-group-body" onDragOver={(e) => e.preventDefault()} onDrop={dropOn(group.id, group.items.length)}>
                  {group.items.map((id, i) => row(id, group.id, i))}
                  {arranging && !icons && group.items.length === 0 && <p className="bsb-empty">Drop a panel here</p>}
                </div>
              )}
            </section>
            ))}

          {arranging && !icons && (
            <section className="bsb-arrange">
              {layout.hidden.length > 0 && (
                <>
                  <h4>Hidden</h4>
                  <div className="bsb-hidden">
                    {layout.hidden.map((id) => {
                      const Icon = panelIcon(id)
                      return (
                        <button key={id} type="button" className="bsb-hidden-row" title={`Show ${panelLabel(id)}`} onClick={() => change(setPanelHidden(layout, id, false))}>
                          <Icon size={14} aria-hidden="true" />
                          <span className="truncate">{panelLabel(id)}</span>
                          <Eye size={13} aria-hidden="true" />
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
              <div className="bsb-arrange-actions">
                <button type="button" className="bsb-text-btn" onClick={() => change(addGroup(layout, 'New group'))}>
                  <Plus size={13} /> New group
                </button>
                <button type="button" className="bsb-text-btn" onClick={onReset}>
                  <RotateCcw size={13} /> Reset
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="bsb-foot">
          <button
            type="button"
            className={`bsb-foot-btn${arranging ? ' on' : ''}`}
            aria-pressed={arranging}
            title="Arrange the sidebar: pin, hide, group and reorder"
            onClick={() => setArranging((a) => !a)}
          >
            <Sliders size={15} />
            {!icons && <span>Arrange</span>}
          </button>
          <button
            type="button"
            className={`bsb-foot-btn${full ? ' on' : ''}`}
            aria-label={full ? 'Show beside the page' : 'Fill the browser'}
            aria-pressed={full}
            title={full ? 'Show beside the page' : 'Fill the browser, like a settings screen'}
            onClick={() => change(setFull(layout, !full))}
          >
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {full && <span>Beside the page</span>}
          </button>
          <button
            type="button"
            className="bsb-foot-btn"
            hidden={full}
            aria-label={icons ? 'Show labels' : 'Icons only'}
            title={icons ? 'Show labels' : 'Icons only'}
            onClick={() => change(setMode(layout, icons ? 'labels' : 'icons'))}
          >
            <Columns2 size={15} />
          </button>
          {!icons && (
            <button
              type="button"
              className="bsb-foot-btn"
              aria-label={layout.density === 'compact' ? 'Roomier rows' : 'Tighter rows'}
              title={layout.density === 'compact' ? 'Roomier rows' : 'Tighter rows'}
              onClick={() => change(setDensity(layout, layout.density === 'compact' ? 'comfortable' : 'compact'))}
            >
              <Layers size={15} />
            </button>
          )}
        </div>

        {!icons && !full && <div className="bsb-resizer" onPointerDown={startResize('list')} aria-hidden="true" />}
      </div>

      {layout.panel && (
        <div className={`bsb-panel column${full ? ' full' : ''}`} style={full ? undefined : { width: layout.panelWidth }}>
          {/* The rest of this section, so opening "Library" still reaches history and downloads in one press. */}
          {(() => {
            const section = layout.groups.find((g) => g.items.includes(layout.panel as PanelId))
            const siblings = (section?.items ?? []).filter((id) => !layout.hidden.includes(id))
            if (siblings.length < 2) return null
            return (
              <nav className="bsb-panel-tabs" aria-label={`${section?.label ?? ''} panels`}>
                {siblings.map((id) => {
                  const Icon = panelIcon(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`bsb-panel-tab${id === layout.panel ? ' on' : ''}`}
                      aria-current={id === layout.panel}
                      title={panelInfo(id)?.description}
                      onClick={() => change(openPanel(layout, id))}
                    >
                      <Icon size={13} aria-hidden="true" />
                      <span className="truncate">{panelLabel(id)}</span>
                    </button>
                  )
                })}
              </nav>
            )
          })()}
          <div className="bsb-panel-body">{renderPanel(layout.panel)}</div>
          {!full && <div className="bsb-resizer" onPointerDown={startResize('panel')} aria-hidden="true" />}
        </div>
      )}

      {menu && (
        <div ref={menuRef} className="popover glass bsb-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 180) }}>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              change(openPanel(layout, menu.panel))
              setMenu(null)
            }}
          >
            <ChevronRight size={14} /> Open {panelLabel(menu.panel)}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              change(setPanelPinned(layout, menu.panel, !isPinned(layout, menu.panel)))
              setMenu(null)
            }}
          >
            {isPinned(layout, menu.panel) ? <PinOff size={14} /> : <Pin size={14} />}
            {isPinned(layout, menu.panel) ? 'Unpin' : 'Pin to the top'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              change(setPanelHidden(layout, menu.panel, true))
              setMenu(null)
            }}
          >
            <EyeOff size={14} /> Hide from the sidebar
          </button>
          <div className="menu-sep" />
          <span className="menu-label">Move to</span>
          {layout.groups.map((group) => (
            <button
              key={group.id}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                change(movePanel(layout, menu.panel, group.id, group.items.length))
                setMenu(null)
              }}
            >
              <FolderTree size={14} /> {group.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/** The button on the browser's toolbar that shows and hides the sidebar. */
export function SidebarToggle({ open, onToggle }: { open: boolean; onToggle(): void }): React.JSX.Element {
  return (
    <button type="button" className={`b-icon${open ? ' on' : ''}`} aria-label="Browser sidebar" aria-pressed={open} title="Browser sidebar (Ctrl+B)" onClick={onToggle}>
      {open ? <X size={15} /> : <Columns2 size={15} />}
    </button>
  )
}

/** A panel's own heading, so every panel in the sidebar is titled and closed the same way. */
export function PanelFrame({ id, onClose, actions, children }: { id: PanelId; onClose(): void; actions?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  const Icon = panelIcon(id)
  return (
    <section className="bsb-pane" role="region" aria-label={panelLabel(id)}>
      <header className="bsb-pane-head">
        <Icon size={15} aria-hidden="true" />
        <h3 className="truncate">{panelLabel(id)}</h3>
        {actions}
        <button type="button" className="bsb-pane-close" aria-label="Close panel" title="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="bsb-pane-body">{children}</div>
    </section>
  )
}

/** Keeps a panel's data out of memory until it has been looked at, and keeps it once it has. */
export function useSeen(id: PanelId | null): (panel: PanelId) => boolean {
  const seen = useRef(new Set<PanelId>())
  useEffect(() => {
    if (id) seen.current.add(id)
  }, [id])
  return useCallback((panel: PanelId) => seen.current.has(panel), [])
}

export { ICON_WIDTH }
