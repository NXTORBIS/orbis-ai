import { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, SquarePen, Trash2, X } from 'lucide-react'
import type { Conversation } from '../../../shared/types'
import type { StreamState } from '../App'
import { groupConversations } from '../lib/utils'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  streams: Record<string, StreamState>
  /** Changes whenever the search box should take focus. */
  focusToken: number
  onClose(): void
  onNewChat(): void
  onSelect(id: string): void
  onRename(id: string, title: string): void
  onDelete(id: string): void
}

export default function HistoryDrawer(props: Props): React.JSX.Element {
  const { conversations, activeId, streams } = props
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => searchRef.current?.focus(), [props.focusToken])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
    const filtered = q
      ? sorted.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
      : sorted
    return groupConversations(filtered)
  }, [conversations, query])

  return (
    <aside className="history-drawer glass">
      <div className="drawer-head">
        <span className="hud-label">Chats</span>
        <div className="drawer-actions">
          <button className="icon-btn" title="New chat" onClick={props.onNewChat}>
            <SquarePen size={15} />
          </button>
          <button className="icon-btn" title="Close (Ctrl+B)" onClick={props.onClose}>
            <X size={15} />
          </button>
        </div>
      </div>

      <input ref={searchRef} className="hud-input" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="drawer-list">
        {groups.length === 0 && <p className="drawer-empty">{query ? 'No matching chats' : 'Your chats will appear here'}</p>}
        {groups.map((group) => (
          <section key={group.label}>
            <h3 className="hud-label">{group.label}</h3>
            {group.items.map((c) => {
              if (editingId === c.id) {
                return (
                  <RenameInput
                    key={c.id}
                    initial={c.title}
                    onDone={(title) => {
                      if (title !== null) props.onRename(c.id, title)
                      setEditingId(null)
                    }}
                  />
                )
              }
              if (confirmDeleteId === c.id) {
                return (
                  <div key={c.id} className="chat-row confirm">
                    <span>Delete chat?</span>
                    <button
                      className="text-btn danger"
                      onClick={() => {
                        props.onDelete(c.id)
                        setConfirmDeleteId(null)
                      }}
                    >
                      Delete
                    </button>
                    <button className="text-btn" onClick={() => setConfirmDeleteId(null)}>
                      Cancel
                    </button>
                  </div>
                )
              }
              return (
                <div key={c.id} className={`chat-row${c.id === activeId ? ' active' : ''}`}>
                  <button className="chat-row-title" title={c.title} onClick={() => props.onSelect(c.id)} onDoubleClick={() => setEditingId(c.id)}>
                    {streams[c.id] && <span className="live-dot" />}
                    <span className="truncate">{c.title}</span>
                  </button>
                  <div className="row-actions">
                    <button className="icon-btn small" title="Rename" onClick={() => setEditingId(c.id)}>
                      <Pencil size={13} />
                    </button>
                    <button className="icon-btn small" title="Delete" onClick={() => setConfirmDeleteId(c.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </aside>
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
    <div className="chat-row editing">
      <input
        ref={inputRef}
        className="hud-input compact"
        value={value}
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
