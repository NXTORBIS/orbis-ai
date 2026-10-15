import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import ChatProject from './ChatProject'
import type { NoticeKind } from '../lib/notices'
import { FileDown, FlaskConical, Ellipsis, HatGlasses, Pencil, Share2, Trash2 } from 'lucide-react'
import { useDismiss } from '../lib/useDismiss'

const SearchLabs = lazy(() => import('./native/SearchLabs'))

interface Props {
  title: string
  hasConversation: boolean
  thinking: boolean
  incognito: boolean
  onToggleIncognito(): void
  /**
   * Opens a Native App, from Search Labs.
   *
   * Optional, because the header is rendered in places where there is no conversation to open an app into, and a
   * button that cannot do anything is not drawn at all rather than drawn and disabled.
   */
  onOpenApp?(appId: string): void
  onRename(title: string): void
  onShare(): void
  /** Saves the conversation to Downloads. Optional: not drawn where there is nothing to save it from. */
  onExport?(kind: 'md' | 'pdf'): void
  onDelete(): void
  /** The conversation on screen, so it can be put in a project. Null before anything has been said. */
  conversationId: string | null
  onNotify(text: string, kind?: NoticeKind): void
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


  /*
   * Search Labs, and where it opens.
   *
   * It used to sit in the composer's tool row, beside the attachment button, which was the wrong place twice over:
   * that row is about the message being written, and Search Labs is about the whole conversation. It also made the
   * popover open upwards into the chat it was meant to add to.
   *
   * Here it is next to the chat's own controls and opens downwards, which is the direction there is always room in.
   * The height is still measured rather than assumed — the list wants about 410px and a short window does not have
   * it, and capping it is what stops a hundred pixels of it going off the bottom of the screen.
   */
  const [labsOpen, setLabsOpen] = useState(false)
  const [labsPlacement, setLabsPlacement] = useState({ down: true, offset: 0, maxHeight: 420 })
  const labsRef = useRef<HTMLDivElement | null>(null)
  useDismiss(labsRef, labsOpen, () => setLabsOpen(false))

  const openLabs = (): void => {
    const anchor = labsRef.current?.getBoundingClientRect()
    if (anchor) {
      const below = window.innerHeight - 16 - anchor.bottom
      setLabsPlacement({
        down: true,
        offset: Math.round(anchor.height + 8),
        maxHeight: Math.max(220, Math.round(Math.min(420, below - 12)))
      })
    }
    setLabsOpen(true)
  }

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

        {/*
          Search Labs: the one manual route to a Native App.

          Orion stays the main entrance — "simulate a projectile" should never need a menu walked — so this is for the
          times somebody would rather look than ask. It is drawn only when there is somewhere to open an app into.
        */}
        {props.onOpenApp !== undefined && (
          <div className="popover-anchor labs-anchor" ref={labsRef}>
            <button
              type="button"
              className={`labs-btn${labsOpen ? ' open' : ''}`}
              title="Search Labs — open an interactive tool"
              aria-label="Search Labs"
              aria-expanded={labsOpen}
              aria-haspopup="dialog"
              onClick={() => (labsOpen ? setLabsOpen(false) : openLabs())}
            >
              <FlaskConical size={14} />
              <span>Labs</span>
            </button>
            {labsOpen && (
              <Suspense fallback={null}>
                <SearchLabs
                  placement={labsPlacement}
                  onClose={() => setLabsOpen(false)}
                  onOpen={(appId) => {
                    props.onOpenApp?.(appId)
                    setLabsOpen(false)
                  }}
                />
              </Suspense>
            )}
          </div>
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
        {/* Which project this chat is kept in -- and therefore whose instructions Orion follows while answering it. */}
        <ChatProject conversationId={props.conversationId} onNotify={props.onNotify} />
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
              {props.onExport && (
                <>
                  <button className="menu-item" disabled={!props.hasConversation} onClick={() => { props.onExport?.('md'); setMoreOpen(false) }}>
                    <FileDown size={14} />
                    Save as Markdown
                  </button>
                  <button className="menu-item" disabled={!props.hasConversation} onClick={() => { props.onExport?.('pdf'); setMoreOpen(false) }}>
                    <FileDown size={14} />
                    Save as PDF
                  </button>
                </>
              )}
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
