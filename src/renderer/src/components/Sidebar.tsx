import { useEffect, useMemo, useRef, useState } from 'react'
import { FEATURE_GROUPS } from '../lib/features'
import type { AppFeature } from '../../../shared/commandCenter'
import { avatarFor, avatarStyle } from '../../../shared/avatars'
import type { LucideIcon } from 'lucide-react'
import type { SettingsSectionId } from '../../../shared/settingsSections'
import type { NoticeKind } from '../lib/notices'
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, CircleHelp, Download, Dices, FolderOpen, Globe, Keyboard, Pencil, Pin, PinOff, Search, SquarePen, Trash2, X } from 'lucide-react'
import type { Conversation } from '../../../shared/types'
import type { StreamState } from '../lib/notices'
import { groupConversations } from '../lib/utils'
import { useDismiss } from '../lib/useDismiss'
import { ListRow } from '../ui'
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
  chanceOpen: boolean
  /** Changes whenever the search box should open and take focus. */
  searchToken: number
  userName: string
  /** The account's picture, as an id from `shared/avatars.ts`. */
  userAvatar: string
  userTitle: string
  onNewChat(): void
  onIncognito(): void
  onSearch(): void
  onImages(): void
  onChance(): void
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
/**
 * The window's screens.
 *
 * An alias, not a declaration. The list lives in the capability registry, which is what the browser's Command
 * Centre reads as well; a second copy here is how the two came to disagree about nine of them.
 */
export type FeatureId = AppFeature


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
    { label: 'Files', icon: FolderOpen, onClick: props.onImages, active: props.imagesOpen, badge: props.imageCount },
    { label: 'Chance', icon: Dices, onClick: props.onChance, active: props.chanceOpen },
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
    /*
      The chat row, on the shared one.

      Same classes, same order, same two elements inside the part you press -- what is new is that the row being
      shown says so out loud: `selected` becomes `aria-current`, where before there was only the `active` colour.
      The actions are given as words and icons rather than as five hand-written buttons, so a name is no longer
      something this file could forget. This list already revealed them on focus as well as hover, and still does:
      the rule is `.sb-row:focus-within .sb-row-actions`, and the row is still the element carrying `sb-row`.

      The double-click lives on the element around it. Double-clicking a chat renames it -- the same gesture as the
      title in the chat header, which is why the rename button was taken off that header -- and the shared row has
      no way to put a second gesture on the part you press. The check keeps it exactly where it was: on the chat,
      not on the buttons beside it.
    */
    return (
      <div key={c.id} onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('.sb-row-main')) setEditingId(c.id) }}>
        <ListRow
          as="div"
          name={c.title}
          title={c.title}
          titleClassName="truncate"
          icon={streams[c.id] ? <span className="live-dot" /> : undefined}
          onSelect={() => props.onSelect(c.id)}
          selected={c.id === activeId}
          className={`sb-row${c.id === activeId ? ' active' : ''}`}
          mainClassName="sb-row-main"
              tooltip={c.title}
          actionsClassName="sb-row-actions"
          actionClassName="sb-row-action"
          actions={[
            {
              label: `${c.pinned ? 'Unpin' : 'Pin'} ${c.title}`,
              tooltip: c.pinned ? 'Unpin' : 'Pin',
              icon: c.pinned ? <PinOff size={14} /> : <Pin size={14} />,
              onClick: () => props.onTogglePin(c.id)
            },
            { label: `Rename ${c.title}`, tooltip: 'Rename', icon: <Pencil size={14} />, onClick: () => setEditingId(c.id) },
            {
              label: `Export ${c.title}`,
              tooltip: 'Export',
              icon: <Download size={14} />,
              onClick: () =>
                void window.api.exportConversation(c.id).then((done) => {
                  if (done.message) props.onNotify?.(done.message, 'error')
                  else if (done.ok) props.onNotify?.('Saved.')
                })
            },
            {
              label: `${c.archived ? 'Bring back' : 'Archive'} ${c.title}`,
              tooltip: c.archived ? 'Bring back' : 'Archive',
              icon: c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />,
              onClick: () => props.onArchive(c.id, !c.archived)
            },
            { label: `Delete ${c.title}`, tooltip: 'Delete', icon: <Trash2 size={14} />, onClick: () => setConfirmId(c.id), danger: true }
          ]}
        />
      </div>
    )
  }

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sidebar">
      {!collapsed && (
        <div className="sb-head">
            <div className="sb-brand-anchor" ref={brandRef}>
              <button type="button" className="sb-brand" aria-label="Orbis menu" aria-haspopup="menu" aria-expanded={brandOpen} onClick={() => setBrandOpen((o) => !o)}>
                <OrbisWordmark className="sb-wordmark" />
                <ChevronDown size={14} />
              </button>
              {brandOpen && (
                <div className="popover glass sb-popover brand" role="menu">
                  {/*
                    Grouped, and built from the registry.
                    Eleven rows flat offered a 280-line notepad and a 1,950-line trading terminal as equals, and
                    left somebody reading all eleven to find either. Under their categories most of the list can
                    be skipped at a glance.
                  */}
                  {FEATURE_GROUPS.map((group) => (
                    <div key={group.id} className="sb-menu-group" role="group" aria-label={group.label}>
                      <p className="sb-menu-head">{group.label}</p>
                      {group.items.map(({ id, label, icon: Icon, hint }) => (
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
                    </div>
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
          {/* The world that was chosen during setup, and nothing else on it.
              It used to carry the first letter of the name and leave the weather off, so the orb in the sidebar --
              the one somebody sees every time they look at Orbis -- was neither the world they picked nor a letter
              they asked for. It is the world now: same body, same weather, same air, just smaller. */}
          <span className="sb-avatar" data-pattern={avatarFor(props.userAvatar).pattern} style={avatarStyle(props.userAvatar)} />
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
