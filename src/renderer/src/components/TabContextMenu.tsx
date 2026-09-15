import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Rendered at the top of the HUD, so the browser panel's stacking can't put the address bar over the menu. */
const toTop = (node: ReactNode): React.JSX.Element => createPortal(node, document.querySelector('.hud') ?? document.body) as React.JSX.Element
import { ChevronRight, Columns2, Copy, CopyPlus, FolderPlus, Link, Pencil, Pin, PinOff, RotateCw, Star, Volume2, VolumeX, X } from 'lucide-react'
import { useDismiss } from '../lib/useDismiss'

export interface TabGroup {
  id: string
  name: string
  color: string
}

export type TabMenuAction =
  | { type: 'pin' }
  | { type: 'split' }
  | { type: 'unsplit' }
  | { type: 'group'; groupId: string }
  | { type: 'new-group' }
  | { type: 'ungroup' }
  | { type: 'bookmark' }
  | { type: 'copy' }
  | { type: 'edit' }
  | { type: 'move'; to: 'start' | 'end' | 'window' }
  | { type: 'reload' }
  | { type: 'duplicate' }
  | { type: 'mute' }
  | { type: 'close' }
  | { type: 'close-others' }
  | { type: 'close-right' }

interface Props {
  x: number
  y: number
  tab: { url: string; pinned?: boolean; groupId?: string }
  groups: TabGroup[]
  inSplit: boolean
  bookmarked: boolean
  muted: boolean
  hasOthers: boolean
  hasRight: boolean
  isFirst: boolean
  isLast: boolean
  onAction(action: TabMenuAction): void
  onClose(): void
}

const items = (root: HTMLElement | null): HTMLElement[] => [...(root?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not(:disabled)') ?? [])]

/** Moves focus through a menu's items with the arrow keys, Home and End. */
function moveFocus(e: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null): boolean {
  const list = items(root)
  if (!list.length) return false
  const at = list.indexOf(document.activeElement as HTMLElement)
  const to = e.key === 'ArrowDown' ? (at + 1) % list.length : e.key === 'ArrowUp' ? (at - 1 + list.length) % list.length : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1
  if (to < 0) return false
  e.preventDefault()
  list[to].focus()
  return true
}

/** The menu for a browser tab (right-click, the Menu key or Shift+F10 on a tab). */
export default function TabContextMenu({ x, y, tab, groups, inSplit, bookmarked, muted, hasOthers, hasRight, isFirst, isLast, onAction, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState<'group' | 'move' | null>(null)
  const [pos, setPos] = useState({ left: x, top: y, flip: false })
  useDismiss(ref, true, onClose)

  // Kept inside the window: opens up or left when there's no room below or to the right.
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
      flip: x + width + 230 > window.innerWidth
    })
  }, [x, y])

  useEffect(() => {
    items(ref.current)[0]?.focus()
  }, [])

  useEffect(() => {
    if (sub) items(subRef.current)[0]?.focus()
  }, [sub])

  const act = (action: TabMenuAction): void => {
    onAction(action)
    onClose()
  }
  const web = /^https?:\/\//i.test(tab.url)

  const submenu = (kind: 'group' | 'move'): React.JSX.Element => (
    <div
      ref={subRef}
      className={`popover glass tab-menu tab-submenu${pos.flip ? ' flip' : ''}`}
      role="menu"
      onKeyDown={(e) => {
        if (moveFocus(e, subRef.current)) return
        if (e.key === 'ArrowLeft' || e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setSub(null)
          ref.current?.querySelector<HTMLElement>(`[data-sub="${kind}"]`)?.focus()
        }
      }}
    >
      {kind === 'group' ? (
        <>
          <button type="button" role="menuitem" className="menu-item" onClick={() => act({ type: 'new-group' })}>
            <FolderPlus size={14} />
            New group
          </button>
          {groups.map((g) => (
            <button key={g.id} type="button" role="menuitem" className="menu-item" disabled={tab.groupId === g.id} onClick={() => act({ type: 'group', groupId: g.id })}>
              <span className="tab-group-dot" style={{ background: g.color }} />
              {g.name}
            </button>
          ))}
          {tab.groupId && (
            <button type="button" role="menuitem" className="menu-item" onClick={() => act({ type: 'ungroup' })}>
              <X size={14} />
              Remove from group
            </button>
          )}
        </>
      ) : (
        <>
          <button type="button" role="menuitem" className="menu-item" disabled={isFirst} onClick={() => act({ type: 'move', to: 'start' })}>
            Start of tab strip
          </button>
          <button type="button" role="menuitem" className="menu-item" disabled={isLast} onClick={() => act({ type: 'move', to: 'end' })}>
            End of tab strip
          </button>
          <button type="button" role="menuitem" className="menu-item" disabled={!web} onClick={() => act({ type: 'move', to: 'window' })}>
            New window
          </button>
        </>
      )}
    </div>
  )

  const opener = (kind: 'group' | 'move', label: string, icon?: React.JSX.Element): React.JSX.Element => (
    <div className="tab-menu-sub-anchor">
      <button
        type="button"
        role="menuitem"
        className={`menu-item${sub === kind ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={sub === kind}
        data-sub={kind}
        onClick={() => setSub((s) => (s === kind ? null : kind))}
        onMouseEnter={() => setSub(kind)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            setSub(kind)
          }
        }}
      >
        {icon ?? <span className="menu-icon-space" />}
        <span className="menu-grow">{label}</span>
        <ChevronRight size={14} />
      </button>
      {sub === kind && submenu(kind)}
    </div>
  )

  return toTop(
    <div
      ref={ref}
      className="popover glass tab-menu"
      role="menu"
      aria-label="Tab"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLElement && subRef.current?.contains(e.target)) return
        if (moveFocus(e, ref.current)) return
        if (e.key === 'Tab') e.preventDefault()
      }}
    >
      <button type="button" role="menuitem" className="menu-item" onClick={() => act({ type: 'pin' })}>
        {tab.pinned ? <PinOff size={14} /> : <Pin size={14} />}
        {tab.pinned ? 'Unpin tab' : 'Pin tab'}
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => act({ type: inSplit ? 'unsplit' : 'split' })}>
        <Columns2 size={14} />
        {inSplit ? 'Close split view' : 'Open in split view'}
      </button>
      {opener('group', tab.groupId ? 'Move tab to group' : 'Add tab to group', <FolderPlus size={14} />)}
      <button type="button" role="menuitem" className="menu-item" disabled={!web} onClick={() => act({ type: 'bookmark' })}>
        <Star size={14} className={bookmarked ? 'filled' : undefined} />
        {bookmarked ? 'Remove bookmark' : 'Bookmark tab'}
      </button>
      <div className="menu-sep" role="separator" />
      <button type="button" role="menuitem" className="menu-item" disabled={!web} onClick={() => act({ type: 'copy' })}>
        <Link size={14} />
        Copy link
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => act({ type: 'edit' })}>
        <Pencil size={14} />
        Edit name and icon…
      </button>
      <div className="menu-sep" role="separator" />
      {opener('move', 'Move to')}
      <div className="menu-sep" role="separator" />
      <button type="button" role="menuitem" className="menu-item" disabled={!tab.url} onClick={() => act({ type: 'reload' })}>
        <RotateCw size={14} />
        <span className="menu-grow">Reload</span>
        <kbd>Ctrl+R</kbd>
      </button>
      <button type="button" role="menuitem" className="menu-item" disabled={!tab.url} onClick={() => act({ type: 'duplicate' })}>
        <CopyPlus size={14} />
        Duplicate
      </button>
      <button type="button" role="menuitem" className="menu-item" disabled={!web} onClick={() => act({ type: 'mute' })}>
        {muted ? <Volume2 size={14} /> : <VolumeX size={14} />}
        {muted ? 'Unmute site' : 'Mute site'}
      </button>
      <div className="menu-sep" role="separator" />
      <button type="button" role="menuitem" className="menu-item" onClick={() => act({ type: 'close' })}>
        <X size={14} />
        <span className="menu-grow">Close</span>
        <kbd>Ctrl+W</kbd>
      </button>
      <button type="button" role="menuitem" className="menu-item" disabled={!hasOthers} onClick={() => act({ type: 'close-others' })}>
        <span className="menu-icon-space" />
        Close other tabs
      </button>
      <button type="button" role="menuitem" className="menu-item" disabled={!hasRight} onClick={() => act({ type: 'close-right' })}>
        <span className="menu-icon-space" />
        Close tabs to the right
      </button>
    </div>
  )
}

const ICON_CHOICES = ['⭐', '📌', '📚', '💼', '🎵', '🎬', '🛒', '📰', '💬', '🧪', '🔥', '✅']

interface EditProps {
  x: number
  y: number
  name: string
  icon: string
  /** The page's own title, shown as the placeholder and restored by Reset. */
  pageTitle: string
  onSave(name: string, icon: string): void
  onCancel(): void
}

/** Renames a tab and gives it an emoji icon; empty fields go back to the page's own title and icon. */
export function TabEditDialog({ x, y, name, icon, pageTitle, onSave, onCancel }: EditProps): React.JSX.Element {
  const ref = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draftName, setDraftName] = useState(name)
  const [draftIcon, setDraftIcon] = useState(icon)
  useDismiss(ref, true, onCancel)
  useEffect(() => inputRef.current?.select(), [])
  const left = Math.max(8, Math.min(x, window.innerWidth - 300))

  return toTop(
    <form
      ref={ref}
      className="popover glass tab-edit"
      style={{ left, top: y }}
      aria-label="Edit tab name and icon"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(draftName.trim(), draftIcon.trim())
      }}
    >
      <label className="tab-edit-label" htmlFor="tab-edit-name">
        Name
      </label>
      <input id="tab-edit-name" ref={inputRef} className="hud-input" value={draftName} placeholder={pageTitle || 'New tab'} maxLength={80} onChange={(e) => setDraftName(e.target.value)} />
      <span className="tab-edit-label">Icon</span>
      <div className="tab-edit-icons" role="radiogroup" aria-label="Icon">
        <button type="button" role="radio" aria-checked={!draftIcon} className={`tab-edit-icon${!draftIcon ? ' on' : ''}`} title="The site's own icon" onClick={() => setDraftIcon('')}>
          <Copy size={13} />
        </button>
        {ICON_CHOICES.map((choice) => (
          <button key={choice} type="button" role="radio" aria-checked={draftIcon === choice} className={`tab-edit-icon${draftIcon === choice ? ' on' : ''}`} onClick={() => setDraftIcon(choice)}>
            {choice}
          </button>
        ))}
      </div>
      <div className="tab-edit-actions">
        <button type="button" className="tab-edit-btn" onClick={() => onSave('', '')}>
          Reset
        </button>
        <button type="button" className="tab-edit-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="tab-edit-btn primary">
          Save
        </button>
      </div>
    </form>
  )
}
