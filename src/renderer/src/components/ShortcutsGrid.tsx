import { useEffect, useRef, useState } from 'react'
import { EllipsisVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import type { SiteShortcut } from '../../../shared/types'
import { useDismiss } from '../lib/useDismiss'

const MAX_SHORTCUTS = 24

interface Props {
  /** Opens a shortcut's site in the current tab. */
  onOpen(url: string): void
}

/** A typed address as a web URL (https:// added), or null. Mirrors the check the main process makes. */
function siteUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    return /^https?:$/.test(url.protocol) && (url.hostname.includes('.') || url.hostname === 'localhost') ? url.toString() : null
  } catch {
    return null
  }
}

function ShortcutIcon({ shortcut }: { shortcut: SiteShortcut }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [shortcut.icon])
  if (shortcut.icon && !broken) {
    return (
      <span className="shortcut-icon">
        <img src={shortcut.icon} alt="" draggable={false} onError={() => setBroken(true)} />
      </span>
    )
  }
  // Only a site with no icon of its own (or one still being fetched) shows its first letter.
  return (
    <span className={`shortcut-icon${shortcut.icon === undefined ? ' loading' : ''}`} aria-hidden="true">
      {(shortcut.name || new URL(shortcut.url).hostname).replace(/^www\./, '').slice(0, 1).toUpperCase()}
    </span>
  )
}

function ShortcutTile({ shortcut, onOpen, onEdit }: { shortcut: SiteShortcut; onOpen(url: string): void; onEdit(): void }): React.JSX.Element {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismiss(menuRef, menu, () => setMenu(false))
  return (
    <div className="shortcut-tile" title={`${shortcut.name}\n${shortcut.url}`}>
      <button type="button" className="shortcut-open" onClick={() => onOpen(shortcut.url)} aria-label={`Open ${shortcut.name}`}>
        <ShortcutIcon shortcut={shortcut} />
        <span className="shortcut-name">{shortcut.name}</span>
      </button>
      <div ref={menuRef}>
        <button type="button" className="shortcut-more" aria-label={`Options for ${shortcut.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <EllipsisVertical size={14} />
        </button>
        {menu && (
          <div className="popover glass shortcut-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setMenu(false)
                onEdit()
              }}
            >
              <Pencil size={14} />
              Edit shortcut
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item danger"
              onClick={() => {
                setMenu(false)
                void window.api.removeShortcut(shortcut.id)
              }}
            >
              <Trash2 size={14} />
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ShortcutDialog({ shortcut, onClose }: { shortcut: SiteShortcut | null; onClose(): void }): React.JSX.Element {
  const [name, setName] = useState(shortcut?.name ?? '')
  const [url, setUrl] = useState(shortcut?.url ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLFormElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  useDismiss(ref, true, onClose)
  useEffect(() => firstRef.current?.focus(), [])

  return (
    <form
      ref={ref}
      className="popover glass shortcut-dialog"
      aria-label={shortcut ? 'Edit shortcut' : 'Add shortcut'}
      onSubmit={(e) => {
        e.preventDefault()
        const address = siteUrl(url)
        if (!address) return setError('Enter a website address, like github.com.')
        setSaving(true)
        const save = shortcut ? window.api.updateShortcut(shortcut.id, name, address) : window.api.addShortcut(name, address)
        void save.then((saved) => {
          setSaving(false)
          if (saved) onClose()
          else setError(shortcut ? 'That shortcut no longer exists.' : `You can have up to ${MAX_SHORTCUTS} shortcuts.`)
        })
      }}
    >
      <h3>{shortcut ? 'Edit shortcut' : 'Add shortcut'}</h3>
      <label>
        Name
        <input ref={firstRef} className="hud-input" value={name} maxLength={40} placeholder="Optional" onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        URL
        <input
          className="hud-input"
          value={url}
          placeholder="github.com"
          inputMode="url"
          spellCheck={false}
          required
          onChange={(e) => {
            setUrl(e.target.value)
            setError('')
          }}
        />
      </label>
      {error && (
        <p className="shortcut-dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="shortcut-dialog-actions">
        <button type="button" className="tab-edit-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="tab-edit-btn primary" disabled={saving || !url.trim()}>
          {shortcut ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  )
}

/** The new-tab page's site shortcuts: add, open, edit and remove; saved permanently with the browser library. */
export default function ShortcutsGrid({ onOpen }: Props): React.JSX.Element {
  const [shortcuts, setShortcuts] = useState<SiteShortcut[]>([])
  const [editing, setEditing] = useState<SiteShortcut | 'new' | null>(null)
  const retried = useRef(new Set<string>())

  useEffect(() => {
    const take = (library: { shortcuts?: SiteShortcut[] }): void => setShortcuts(library.shortcuts ?? [])
    void window.api.getBrowserLibrary().then(take)
    return window.api.onBrowserLibrary(take)
  }, [])

  // A shortcut saved while its site couldn't be reached (or while Orbis closed) gets its icon fetched again, once a session.
  useEffect(() => {
    for (const s of shortcuts) {
      if (s.icon !== undefined || retried.current.has(s.id)) continue
      retried.current.add(s.id)
      const age = Date.now() - s.addedAt
      if (age > 30_000) void window.api.refreshShortcutIcon(s.id)
    }
  }, [shortcuts])

  return (
    <div className="browser-shortcuts" aria-label="Shortcuts">
      {shortcuts.map((s) => (
        <ShortcutTile key={s.id} shortcut={s} onOpen={onOpen} onEdit={() => setEditing(s)} />
      ))}
      {shortcuts.length < MAX_SHORTCUTS && (
        <div className="shortcut-tile shortcut-add">
          <button type="button" className="shortcut-open" onClick={() => setEditing('new')}>
            <span className="shortcut-icon" aria-hidden="true">
              <Plus size={20} />
            </span>
            <span className="shortcut-name">Add shortcut</span>
          </button>
        </div>
      )}
      {editing && <ShortcutDialog key={editing === 'new' ? 'new' : editing.id} shortcut={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
