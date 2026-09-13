import { CircleX, Info, TriangleAlert, X } from 'lucide-react'
import type { Notice, NoticeKind } from '../App'

const KIND_ICONS: Record<NoticeKind, typeof Info> = { info: Info, warn: TriangleAlert, error: CircleX }

const formatTime = (ts: number): string => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })

export function ActivityPanel({ items, onClear, onClose }: { items: Notice[]; onClear(): void; onClose(): void }): React.JSX.Element {
  return (
    <aside className="activity-panel glass">
      <div className="drawer-head">
        <span className="hud-label">Activity</span>
        <div className="drawer-actions">
          {items.length > 0 && (
            <button className="text-btn" onClick={onClear}>
              Clear
            </button>
          )}
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="drawer-list">
        {items.length === 0 && <p className="drawer-empty">Model switches, rate limits, and errors will show up here.</p>}
        {[...items].reverse().map((item) => {
          const Icon = KIND_ICONS[item.kind]
          return (
            <div key={item.id} className={`activity-item ${item.kind}`}>
              <Icon size={14} />
              <div>
                <p>{item.text}</p>
                <time>{formatTime(item.at)}</time>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export function ToastStack({ toasts, onDismiss }: { toasts: Notice[]; onDismiss(id: string): void }): React.JSX.Element {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => {
        const Icon = KIND_ICONS[t.kind]
        return (
          <div key={t.id} className={`toast glass ${t.kind}`}>
            <Icon size={14} />
            <span>{t.text}</span>
            <button className="icon-btn small" title="Dismiss" onClick={() => onDismiss(t.id)}>
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Enter', 'Send message'],
  ['Shift + Enter', 'New line'],
  ['Esc', 'Stop generating'],
  ['Ctrl + Shift + O', 'New chat'],
  ['Ctrl + B', 'Toggle chat history'],
  ['Ctrl + ,', 'Settings']
]

export function ShortcutsModal({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass small" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div className="modal-header">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="shortcut-row">
              <span>{action}</span>
              <kbd>{keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
