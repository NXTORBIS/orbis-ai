import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Ellipsis,
  Globe,
  HatGlasses,
  Images,
  Keyboard,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  SquarePen,
  Trash2,
  Users,
  X
} from 'lucide-react'
import type { Conversation } from '../../../shared/types'
import type { StreamState } from '../App'
import { groupConversations } from '../lib/utils'
import { useDismiss } from '../lib/useDismiss'
import { OrbisMark, OrbisWordmark } from './Brand'

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
  onToggleCollapsed(): void
  onNewChat(): void
  onIncognito(): void
  onSearch(): void
  onImages(): void
  onAssistants(): void
  onBrowser(): void
  onSelect(id: string): void
  onRename(id: string, title: string): void
  onDelete(id: string): void
  onTogglePin(id: string): void
  onSettings(): void
  onHelp(): void
}

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
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const brandRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismiss(brandRef, brandOpen, () => setBrandOpen(false))
  useDismiss(menuRef, menuId !== null, () => setMenuId(null))

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
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [props.searchToken])

  const { pinned, groups } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
    // Image messages are skipped: scanning their base64 would be slow and never match.
    const matches = q
      ? sorted.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => !m.content.includes('data:image/') && m.content.toLowerCase().includes(q)))
      : sorted
    return { pinned: matches.filter((c) => c.pinned), groups: groupConversations(matches.filter((c) => !c.pinned)) }
  }, [conversations, query])

  const closeSearch = (): void => {
    setQuery('')
    setSearching(false)
  }

  const nav: NavItem[] = [
    { label: 'New chat', icon: SquarePen, onClick: props.onNewChat, shortcut: 'Ctrl+Shift+O' },
    { label: 'Incognito chat', icon: HatGlasses, onClick: props.onIncognito, active: props.incognito, shortcut: 'Ctrl+Shift+N' },
    { label: 'Search chats', icon: Search, onClick: props.onSearch },
    { label: 'Images', icon: Images, onClick: props.onImages, active: props.imagesOpen, badge: props.imageCount },
    { label: 'Assistants', icon: Users, onClick: props.onAssistants },
    { label: 'Browser', icon: Globe, onClick: props.onBrowser }
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
    const menuOpen = menuId === c.id
    return (
      <div key={c.id} className={`sb-row${c.id === activeId ? ' active' : ''}${menuOpen ? ' menu-open' : ''}`}>
        <button type="button" className="sb-row-main" title={c.title} onClick={() => props.onSelect(c.id)} onDoubleClick={() => setEditingId(c.id)}>
          {streams[c.id] && <span className="live-dot" />}
          <span className="truncate">{c.title}</span>
        </button>
        <div className="sb-row-menu" ref={menuOpen ? menuRef : undefined}>
          <button type="button" className="sb-row-more" aria-label={`Options for ${c.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuId(menuOpen ? null : c.id)}>
            <Ellipsis size={15} />
          </button>
          {menuOpen && (
            <div className="popover glass sb-popover" role="menu">
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  props.onTogglePin(c.id)
                  setMenuId(null)
                }}
              >
                {c.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                {c.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setEditingId(c.id)
                  setMenuId(null)
                }}
              >
                <Pencil size={14} />
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item danger"
                onClick={() => {
                  setConfirmId(c.id)
                  setMenuId(null)
                }}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sidebar">
      <div className="sb-head">
        {collapsed ? (
          <button type="button" className="sb-logo" title="Open sidebar (Ctrl+B)" aria-label="Open sidebar" onClick={props.onToggleCollapsed}>
            <OrbisMark size={26} className="sb-logo-mark" />
            <PanelLeftOpen size={18} className="sb-logo-toggle" />
          </button>
        ) : (
          <>
            <div className="sb-brand-anchor" ref={brandRef}>
              <button type="button" className="sb-brand" aria-haspopup="menu" aria-expanded={brandOpen} onClick={() => setBrandOpen((o) => !o)}>
                <OrbisWordmark className="sb-wordmark" />
                <ChevronDown size={14} />
              </button>
              {brandOpen && (
                <div className="popover glass sb-popover brand" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      props.onSettings()
                      setBrandOpen(false)
                    }}
                  >
                    <Settings size={14} />
                    Settings
                  </button>
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
            <button type="button" className="sb-icon" title="Close sidebar (Ctrl+B)" aria-label="Close sidebar" onClick={props.onToggleCollapsed}>
              <PanelLeftClose size={17} />
            </button>
          </>
        )}
      </div>

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
        </div>
      )}

      <div className="sb-foot">
        <button type="button" className="sb-user" title="Profile and settings" onClick={props.onSettings}>
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
