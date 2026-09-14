import { useRef, useState } from 'react'
import { Check, Ellipsis, HatGlasses, Pencil, Share2, SquarePen, Trash2, Users } from 'lucide-react'
import { PERSONAS, personaInfo } from '../../../shared/personas'
import { useDismiss } from '../lib/useDismiss'

interface Props {
  title: string
  hasConversation: boolean
  persona: string
  personaMenuOpen: boolean
  thinking: boolean
  userInitial: string
  incognito: boolean
  onToggleIncognito(): void
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
        <button
          className={`icon-btn incognito-btn${props.incognito ? ' active' : ''}`}
          title={props.incognito ? 'Turn off incognito (Ctrl+Shift+N)' : 'Incognito chat (Ctrl+Shift+N)'}
          aria-pressed={props.incognito}
          onClick={props.onToggleIncognito}
        >
          <HatGlasses size={16} />
        </button>
        <div className="popover-anchor" ref={personaRef}>
          <button
            className={`icon-btn${props.personaMenuOpen ? ' active' : ''}`}
            title={`Assistant: ${persona.label}`}
            aria-label="Choose assistant"
            aria-haspopup="menu"
            aria-expanded={props.personaMenuOpen}
            onClick={() => props.onPersonaMenuChange(!props.personaMenuOpen)}
          >
            <Users size={16} />
          </button>
          {props.personaMenuOpen && (
            <div className="popover glass align-right" role="menu">
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
