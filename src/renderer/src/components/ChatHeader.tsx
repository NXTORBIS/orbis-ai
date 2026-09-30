import { useLayoutEffect, useRef, useState } from 'react'
import { Ellipsis, HatGlasses, Pencil, Share2, Trash2 } from 'lucide-react'
import { useDismiss } from '../lib/useDismiss'

interface Props {
  title: string
  hasConversation: boolean
  thinking: boolean
  incognito: boolean
  onToggleIncognito(): void
  onRename(title: string): void
  onShare(): void
  onDelete(): void
}

export default function ChatHeader(props: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  useDismiss(moreRef, moreOpen, () => setMoreOpen(false))
  const titleRef = useRef<HTMLDivElement>(null)
  const [titleBox, setTitleBox] = useState<{ left: number; width: number } | null>(null)

  // Centre the title on the whole bar, sized to the free space between the button groups so it never overlaps them.
  useLayoutEffect(() => {
    const bar = titleRef.current?.closest<HTMLElement>('.system-bar')
    if (!bar) return
    const sides = [...bar.querySelectorAll<HTMLElement>('.system-group, .header-side')]
    const update = (): void => {
      const barRect = bar.getBoundingClientRect()
      const center = barRect.width / 2
      let left = 0
      let right = barRect.width
      for (const side of sides) {
        const r = side.getBoundingClientRect()
        if (!r.width) continue
        if (r.left - barRect.left < center) left = Math.max(left, r.right - barRect.left)
        else right = Math.min(right, r.left - barRect.left)
      }
      const gap = 16
      const half = Math.min(center - left, right - center) - gap
      const next = half >= 60 ? { left: center - half, width: half * 2 } : { left: left + gap, width: Math.max(0, right - left - gap * 2) }
      setTitleBox((current) => (current && Math.abs(current.left - next.left) < 0.5 && Math.abs(current.width - next.width) < 0.5 ? current : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    sides.forEach((side) => observer.observe(side))
    return () => observer.disconnect()
  }, [])


  const startRename = (): void => {
    if (!props.hasConversation) return
    setDraft(props.title)
    setEditing(true)
    setMoreOpen(false)
  }

  const finishRename = (save: boolean): void => {
    if (save && draft.trim()) props.onRename(draft)
    setEditing(false)
  }

  return (
    <header className="chat-header">
      <div className="header-side">
        <span className={`status ${props.thinking ? 'thinking' : 'idle'}`}>
          <i />
          {props.thinking ? 'THINKING' : 'IDLE'}
        </span>
        {props.incognito && (
          <span className="incognito-pill">
            <HatGlasses size={12} />
            Incognito
          </span>
        )}
      </div>

      <div
        ref={titleRef}
        className="header-title"
        style={titleBox ? { left: titleBox.left, width: titleBox.width } : { visibility: 'hidden' }}
      >
        {editing ? (
          <input
            className="hud-input compact"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishRename(true)
              if (e.key === 'Escape') finishRename(false)
            }}
            onBlur={() => finishRename(true)}
          />
        ) : (
          <span className="truncate" onDoubleClick={startRename}>
            {props.title}
          </span>
        )}
      </div>

      {/*
        What is left is what is about *this chat* and nothing else: whether it is incognito, sharing it, and the menu
        that holds deleting it.

        Gone from here: the rename button, because the same action is in that menu and on a double-click of the title,
        which made three ways to rename one chat; "Copy as Markdown", because it called the very same handler as the
        Share button beside it; and the avatar, because the sidebar's own user chip opens the same Settings and now
        opens it at Account.
      */}
      <div className="header-side right">
        <button
          className={`icon-btn incognito-btn${props.incognito ? ' active' : ''}`}
          title={props.incognito ? 'Turn off incognito (Ctrl+Shift+N)' : 'Incognito chat (Ctrl+Shift+N)'}
          aria-pressed={props.incognito}
          onClick={props.onToggleIncognito}
        >
          <HatGlasses size={16} />
        </button>
        <button className="share-btn" disabled={!props.hasConversation} onClick={props.onShare}>
          <Share2 size={14} />
          Share
        </button>
        <div className="popover-anchor" ref={moreRef}>
          <button className="icon-btn" title="More" onClick={() => setMoreOpen((o) => !o)}>
            <Ellipsis size={16} />
          </button>
          {moreOpen && (
            <div className="popover glass align-right" role="menu">
              <button className="menu-item" disabled={!props.hasConversation} onClick={startRename}>
                <Pencil size={14} />
                Rename
              </button>
              <button
                className="menu-item danger"
                disabled={!props.hasConversation}
                onClick={() => {
                  props.onDelete()
                  setMoreOpen(false)
                }}
              >
                <Trash2 size={14} />
                Delete chat
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
