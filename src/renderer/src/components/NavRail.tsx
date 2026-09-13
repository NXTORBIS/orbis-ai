import { CircleHelp, Globe, Search, Settings, SquarePen, Users } from 'lucide-react'
import type { Conversation } from '../../../shared/types'
import type { StreamState } from '../App'
import { OrbisMark } from './Brand'

interface Props {
  recent: Conversation[]
  activeId: string | null
  streams: Record<string, StreamState>
  onNewChat(): void
  onSearch(): void
  onAssistants(): void
  onSelect(id: string): void
  onSettings(): void
  onHelp(): void
  onBrowser(): void
}

export default function NavRail(props: Props): React.JSX.Element {
  return (
    <nav className="nav-rail">
      <button className="rail-logo" title="New chat" onClick={props.onNewChat}>
        <OrbisMark size={28} />
      </button>
      <button className="rail-btn" title="New chat (Ctrl+Shift+O)" onClick={props.onNewChat}>
        <SquarePen size={17} />
      </button>
      <button className="rail-btn" title="Search chats" onClick={props.onSearch}>
        <Search size={17} />
      </button>
      <button className="rail-btn" title="Assistants" onClick={props.onAssistants}>
        <Users size={17} />
      </button>

      <div className="rail-recent">
        {props.recent.map((c) => (
          <button
            key={c.id}
            className={`rail-chat${c.id === props.activeId ? ' active' : ''}${props.streams[c.id] ? ' live' : ''}`}
            title={c.title}
            onClick={() => props.onSelect(c.id)}
          >
            <span>{c.title.trim().charAt(0).toUpperCase() || '•'}</span>
            <i />
          </button>
        ))}
      </div>

      <div className="rail-spacer" />
      <button className="rail-btn" title="Browser" onClick={props.onBrowser}>
        <Globe size={17} />
      </button>
      <button className="rail-btn" title="Settings (Ctrl+,)" onClick={props.onSettings}>
        <Settings size={17} />
      </button>
      <button className="rail-btn" title="Keyboard shortcuts" onClick={props.onHelp}>
        <CircleHelp size={17} />
      </button>
    </nav>
  )
}
