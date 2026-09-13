import { useRef, useState } from 'react'
import { Check, ChevronDown, Ellipsis, Orbit, Pencil, Share2, SquarePen, Trash2, Users } from 'lucide-react'
import { PERSONAS, personaInfo } from '../../../shared/personas'
import { useDismiss } from '../lib/useDismiss'

interface Props {
  title: string
  hasConversation: boolean
  persona: string
  personaMenuOpen: boolean
  thinking: boolean
  userInitial: string
  onPersonaMenuChange(open: boolean): void
  onPersonaChange(id: string): void
  onRename(title: string): void
  onShare(): void
  onDelete(): void
  onOpenSettings(): void
}

export default function ChatHeader(props: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const personaRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  useDismiss(personaRef, props.personaMenuOpen, () => props.onPersonaMenuChange(false))
  useDismiss(moreRef, moreOpen, () => setMoreOpen(false))

  const persona = personaInfo(props.persona)

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
        <div className="popover-anchor" ref={personaRef}>
          <button className="persona-pill" onClick={() => props.onPersonaMenuChange(!props.personaMenuOpen)}>
            <Orbit size={14} />
            {persona.label}
            <ChevronDown size={14} />
          </button>
          {props.personaMenuOpen && (
            <div className="popover glass" role="menu">
              <span className="hud-label">Assistant</span>
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  role="menuitemradio"
                  aria-checked={p.id === persona.id}
                  className={`menu-item${p.id === persona.id ? ' selected' : ''}`}
                  onClick={() => {
                    props.onPersonaChange(p.id)
                    props.onPersonaMenuChange(false)
                  }}
                >
                  <span className="menu-text">
                    <b>{p.label}</b>
                    <small>{p.description}</small>
                  </span>
                  {p.id === persona.id && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className={`status ${props.thinking ? 'thinking' : 'idle'}`}>
          <i />
          {props.thinking ? 'THINKING' : 'IDLE'}
        </span>
      </div>

      <div className="header-title">
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

      <div className="header-side right">
        <button className="icon-btn" title="Assistants" onClick={() => props.onPersonaMenuChange(true)}>
          <Users size={16} />
        </button>
        <button className="icon-btn" title="Rename chat" disabled={!props.hasConversation} onClick={startRename}>
          <SquarePen size={16} />
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
                className="menu-item"
                disabled={!props.hasConversation}
                onClick={() => {
                  props.onShare()
                  setMoreOpen(false)
                }}
              >
                <Share2 size={14} />
                Copy as Markdown
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
        <button className="avatar user-avatar" title="Profile and settings" onClick={props.onOpenSettings}>
          {props.userInitial}
        </button>
      </div>
    </header>
  )
}
