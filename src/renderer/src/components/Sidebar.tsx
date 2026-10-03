import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { SettingsSectionId } from '../../../shared/settingsSections'
import type { NoticeKind } from '../lib/notices'
import {
  CalendarClock,
  CandlestickChart,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Globe,
  Images,
  Keyboard,
  LayoutGrid,
  LayoutTemplate,
  Pencil,
  PenTool,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
  X,
  FilePlus2, Archive, ArchiveRestore, Download } from 'lucide-react'
import type { Conversation } from '../../../shared/types'
import type { StreamState } from '../App'
import { groupConversations } from '../lib/utils'
import { useDismiss } from '../lib/useDismiss'
import { OrbisWordmark } from './Brand'

interface Props {
  collapsed: boolean
  /** Saved chats only; incognito chats never appear here. */
  conversations: Conversation[]
  activeId: string | null
  incognito: boolean
  streams: Record<string, StreamState>
  imageCount: number
  imagesOpen: boolean
  /** Changes whenever the search box should open and take focus. */
  searchToken: number
  userName: string
  userTitle: string
  onNewChat(): void
  onIncognito(): void
  onSearch(): void
  onImages(): void
  onBrowser(): void
  onSelect(id: string): void
  onRename(id: string, title: string): void
  onDelete(id: string): void
  /** Out of the list, still there. The alternative to deleting a chat you may want back. */
  onArchive(id: string, archived: boolean): void
  /** Saying how an action went. Optional, because the sidebar is used where there is nothing to say it with. */
  onNotify?(text: string, kind?: NoticeKind): void
  onTogglePin(id: string): void
  /**
   * Opens Settings, optionally at a named section.
   *
   * The user chip says 'account', because somebody clicking their own name wants their own name -- which is the thing
   * that used to drop them at the top of a thirty-one block scroll.
   */
  onSettings(section?: SettingsSectionId): void
  onHelp(): void
  /**
   * Opening one of Orbis's own screens: Workflows, Galaxy, Whiteboard and the rest. Each of these existed and could be
   * reached from nowhere -- the sidebar offered five things and the settings dialog a handful more, so a finished
   * feature with no button to it might as well not have been built. This is the button.
   */
  onFeature(id: FeatureId): void
  /** Which one is showing, so the row for it reads as the place you are rather than a thing you could do. */
  feature: FeatureId | null
}

/** Orbis's own screens, in the order they appear. The id is what App.tsx renders. */
/**
 * The screens that are still the chat window's.
 *
 * Everything that is about pages, tabs or what you browsed has gone to the browser, where it is about something. What
 * is left either needs a canvas the browser does not have, or is not about browsing at all. Customize and Profiles are
 * not here because they are settings, and they are in Settings.
 */
export type FeatureId = 'create' | 'pages' | 'markets' | 'whiteboard' | 'clipboard' | 'workspaces' | 'schedules'

export const FEATURES: { id: FeatureId; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'create', label: 'Create', icon: FilePlus2, hint: 'Tables and documents, kept and saved as real files' },
  { id: 'pages', label: 'Pages', icon: LayoutTemplate, hint: "Orbis's own tools, each with its own address" },
  { id: 'markets', label: 'Markets', icon: CandlestickChart, hint: 'Live crypto prices, charts and watchlists' },
  { id: 'whiteboard', label: 'Whiteboard', icon: PenTool, hint: 'Room to think' },
  { id: 'clipboard', label: 'Clipboard', icon: ClipboardList, hint: 'What you have copied' },
  { id: 'workspaces', label: 'Workspaces', icon: LayoutGrid, hint: 'Sets of tabs, kept together' },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock, hint: 'Things Orbis does at a time you chose' }
]

interface NavItem {
  label: string
  icon: LucideIcon
  onClick(): void
  active?: boolean
  badge?: number
  shortcut?: string
}

const SECTIONS_KEY = 'orbis.sidebar.sections'

function readSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'U'
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase()
}

export default function Sidebar(props: Props): React.JSX.Element {
  const { collapsed, conversations, activeId, streams } = props
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [sections, setSections] = useState<Record<string, boolean>>(readSections)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const brandRef = useRef<HTMLDivElement>(null)
  useDismiss(brandRef, brandOpen, () => setBrandOpen(false))

  useEffect(() => {
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections))
    } catch {
      // Storage can be unavailable; sections just won't be remembered.
    }
  }, [sections])

  useEffect(() => {
    if (!props.searchToken) return
    setSearching(true)
  }, [props.searchToken])

  // Focus once the search field exists: on a first request it only renders after the effect above.
  useEffect(() => {
    if (props.searchToken && searching) searchRef.current?.focus()
  }, [props.searchToken, searching])

  const { pinned, groups, archived } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
    // Image messages are skipped: scanning their base64 would be slow and never match.
    const matches = q
      ? sorted.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => !m.content.includes('data:image/') && m.content.toLowerCase().includes(q)))
      : sorted
    // Archived chats are out of the way, not gone: they keep their own section and are still searchable from it.
    const archived = matches.filter((c) => c.archived)
    const live = matches.filter((c) => !c.archived)
    return { pinned: live.filter((c) => c.pinned), groups: groupConversations(live.filter((c) => !c.pinned)), archived }
  }, [conversations, query])

  const closeSearch = (): void => {
    setQuery('')
    setSearching(false)
  }

  const nav: NavItem[] = [
    { label: 'New chat', icon: SquarePen, onClick: props.onNewChat, shortcut: 'Ctrl+Shift+O' },
    /*
      Incognito is not a place, so it is not a row.

      It is a property of the chat you are about to start, and a permanent entry for it sat beside "New chat" implying
      two different screens when there is one. Ctrl+Shift+N still starts one, the slash command still does, and a chat
      that is incognito still says so -- what has gone is the standing invitation.
    */
    { label: 'Search chats', icon: Search, onClick: props.onSearch },
    { label: 'Images', icon: Images, onClick: props.onImages, active: props.imagesOpen, badge: props.imageCount },
    // Everything that manages browsing lives in the browser's own sidebar now. This is the way to it.
    { label: 'Browser', icon: Globe, onClick: props.onBrowser, shortcut: 'Ctrl+Shift+B' }
  ]

  const isOpen = (id: string): boolean => Boolean(query.trim()) || sections[id] !== false

  const section = (id: string, label: string, body: React.ReactNode): React.JSX.Element => (
    <section className="sb-section">
      <button type="button" className="sb-section-head" aria-expanded={isOpen(id)} onClick={() => setSections((s) => ({ ...s, [id]: s[id] === false }))}>
        {label}
        <ChevronRight size={14} className={isOpen(id) ? 'open' : undefined} />
      </button>
      {isOpen(id) && <div className="sb-section-body">{body}</div>}
    </section>
  )

  const row = (c: Conversation): React.JSX.Element => {
    if (editingId === c.id) {
      return (
        <RenameInput
          key={c.id}
          initial={c.title}
          onDone={(title) => {
            if (title?.trim()) props.onRename(c.id, title)
            setEditingId(null)
          }}
        />
      )
    }
    if (confirmId === c.id) {
      return (
        <div key={c.id} className="sb-row confirm">
          <span className="truncate">Delete this chat?</span>
          <button
            type="button"
            className="sb-text-btn danger"
            onClick={() => {
              props.onDelete(c.id)
              setConfirmId(null)
            }}
          >
            Delete
          </button>
          <button type="button" className="sb-text-btn" onClick={() => setConfirmId(null)}>
            Cancel
          </button>
        </div>
      )
    }
    return (
      <div key={c.id} className={`sb-row${c.id === activeId ? ' active' : ''}`}>
        <button type="button" className="sb-row-main" title={c.title} onClick={() => props.onSelect(c.id)} onDoubleClick={() => setEditingId(c.id)}>
          {streams[c.id] && <span className="live-dot" />}
          <span className="truncate">{c.title}</span>
        </button>
        {/* Pin, rename and delete sit in line with the chat, shown on hover or focus. */}
        <div className="sb-row-actions">
          <button type="button" className="sb-row-action" aria-label={`${c.pinned ? 'Unpin' : 'Pin'} ${c.title}`} title={c.pinned ? 'Unpin' : 'Pin'} onClick={() => props.onTogglePin(c.id)}>
            {c.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button type="button" className="sb-row-action" aria-label={`Rename ${c.title}`} title="Rename" onClick={() => setEditingId(c.id)}>
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="sb-row-action"
            aria-label={`Export ${c.title}`}
            title="Export"
            onClick={() =>
              void window.api.exportConversation(c.id).then((done) => {
                if (done.message) props.onNotify?.(done.message, 'error')
                else if (done.ok) props.onNotify?.('Saved.')
              })
            }
          >
            <Download size={14} />
          </button>
          <button
            type="button"
            className="sb-row-action"
            aria-label={`${c.archived ? 'Bring back' : 'Archive'} ${c.title}`}
            title={c.archived ? 'Bring back' : 'Archive'}
            onClick={() => props.onArchive(c.id, !c.archived)}
          >
            {c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
          <button type="button" className="sb-row-action danger" aria-label={`Delete ${c.title}`} title="Delete" onClick={() => setConfirmId(c.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sidebar">
      {!collapsed && (
        <div className="sb-head">
            <div className="sb-brand-anchor" ref={brandRef}>
              <button type="button" className="sb-brand" aria-haspopup="menu" aria-expanded={brandOpen} onClick={() => setBrandOpen((o) => !o)}>
                <OrbisWordmark className="sb-wordmark" />
                <ChevronDown size={14} />
              </button>
              {brandOpen && (
                <div className="popover glass sb-popover brand" role="menu">
                  {FEATURES.map(({ id, label, icon: Icon, hint }) => (
                    <button
                      key={id}
                      type="button"
                      role="menuitem"
                      className={`menu-item${props.feature === id ? ' selected' : ''}`}
                      title={hint}
                      onClick={() => {
                        props.onFeature(id)
                        setBrandOpen(false)
                      }}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                  {/*
                    Settings is not a row here.

                    It is on the user chip at the foot of this sidebar, which opens it at Account, and on Ctrl+comma.
                    A third way in, in a list of screens, made a settings dialog look like one more feature.
                  */}
                  <div className="menu-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      props.onHelp()
                      setBrandOpen(false)
                    }}
                  >
                    <Keyboard size={14} />
                    Keyboard shortcuts
                  </button>
                </div>
              )}
            </div>
        </div>
      )}

      <div className="sb-nav">
        {nav.map(({ label, icon: Icon, onClick, active, badge, shortcut }) => (
          <button
            key={label}
            type="button"
            className={`sb-nav-item${active ? ' active' : ''}`}
            aria-label={label}
            aria-pressed={active}
            title={shortcut ? `${label} (${shortcut})` : label}
            onClick={onClick}
          >
            <Icon size={17} />
            {!collapsed && <span className="sb-nav-label">{label}</span>}
            {!collapsed && badge ? <span className="sb-badge">{badge}</span> : null}
          </button>
        ))}
      </div>

      {collapsed ? (
        <div className="sb-spacer" />
      ) : (
        <div className="sb-scroll">
          {searching && (
            <div className="sb-search">
              <Search size={14} />
              <input
                ref={searchRef}
                value={query}
                placeholder="Search chats"
                aria-label="Search chats"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeSearch()
                }}
              />
              <button type="button" className="sb-icon small" aria-label="Close search" onClick={closeSearch}>
                <X size={13} />
              </button>
            </div>
          )}
          {pinned.length > 0 && section('pinned', 'Pinned', pinned.map(row))}
          {section(
            'recents',
            'Recents',
            groups.length ? (
              groups.map((group) => (
                <div key={group.label} className="sb-group">
                  <span className="sb-group-label">{group.label}</span>
                  {group.items.map(row)}
                </div>
              ))
            ) : (
              <p className="sb-empty">{query.trim() ? 'No matching chats' : pinned.length ? 'Everything here is pinned' : 'Your chats will appear here'}</p>
            )
          )}
          {archived.length > 0 && section('archived', 'Archived', archived.map(row))}
        </div>
      )}

      <div className="sb-foot">
        <button type="button" className="sb-user" title="Profile and settings" onClick={() => props.onSettings('account')}>
          <span className="sb-avatar">{initials(props.userName)}</span>
          {!collapsed && (
            <span className="sb-user-text">
              <b className="truncate">{props.userName}</b>
              {props.userTitle && <small className="truncate">{props.userTitle}</small>}
            </span>
          )}
        </button>
        {!collapsed && (
          <button type="button" className="sb-icon" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" onClick={props.onHelp}>
            <CircleHelp size={17} />
          </button>
        )}
      </div>
    </nav>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone(title: string | null): void }): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => inputRef.current?.select(), [])

  const finish = (title: string | null): void => {
    if (doneRef.current) return
    doneRef.current = true
    onDone(title)
  }

  return (
    <div className="sb-row editing">
      <input
        ref={inputRef}
        className="hud-input compact"
        value={value}
        aria-label="Chat name"
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(value)
          if (e.key === 'Escape') finish(null)
        }}
        onBlur={() => finish(value)}
      />
    </div>
  )
}
