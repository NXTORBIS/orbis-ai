import { useEffect, useState } from 'react'
import { Bell, Cpu, Globe, Hash, Moon, PanelLeft, Plus, Search, Sun } from 'lucide-react'

interface Props {
  dark: boolean
  unread: number
  onToggleHistory(): void
  onNewChat(): void
  onSearch(): void
  onQuickPrompts(): void
  webSearch: boolean
  onToggleWebSearch(): void
  onToggleActivity(): void
  onToggleTheme(): void
  /** Chat controls (status, title, actions) shown between the bar's left and right groups. */
  children?: React.ReactNode
}

export default function SystemBar(props: Props): React.JSX.Element {
  const cpu = useCpuUsage()
  const now = useClock()

  return (
    <div className="system-bar">
      <div className="system-group">
        <button className="sys-btn" title="Chats (Ctrl+B)" onClick={props.onToggleHistory}>
          <PanelLeft size={15} />
        </button>
        <span className="core-readout" title="System CPU load">
          <Cpu size={13} />
          CORE: <b>{cpu === null ? '--' : `${cpu}%`}</b>
        </span>
        <button className="sys-btn" title="New chat (Ctrl+Shift+O)" onClick={props.onNewChat}>
          <Plus size={15} />
        </button>
      </div>

      {props.children}

      <div className="system-group">
        <button className="sys-btn" title="Search chats" onClick={props.onSearch}>
          <Search size={15} />
        </button>
        <button className="sys-btn" title="Quick prompts" onClick={props.onQuickPrompts}>
          <Hash size={15} />
        </button>
        <button
          className={`sys-btn${props.webSearch ? ' active' : ''}`}
          title={props.webSearch ? 'Web search on — replies use live results' : 'Web search off'}
          aria-pressed={props.webSearch}
          onClick={props.onToggleWebSearch}
        >
          <Globe size={15} />
        </button>
        <button className="sys-btn" title="Activity" onClick={props.onToggleActivity}>
          <Bell size={15} />
          {props.unread > 0 && <span className="badge">{props.unread > 9 ? '9+' : props.unread}</span>}
        </button>
        <button className="sys-btn" title={props.dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={props.onToggleTheme}>
          {props.dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <span className="clock">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
        <span className="clock">{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  )
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function useCpuUsage(): number | null {
  const [cpu, setCpu] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const poll = (): void => void window.api.getCpuUsage().then((value) => alive && setCpu(value))
    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return cpu
}
