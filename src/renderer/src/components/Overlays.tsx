import { CircleX, Info, TriangleAlert, X } from 'lucide-react'
import type { Notice, NoticeKind } from '../App'
import { SLASH_COMMANDS } from '../lib/commands'

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
  ['Tab', 'Use the suggestion in the message box'],
  ['Esc', 'Stop generating'],
  ['Ctrl + Shift + O', 'New chat'],
  ['Ctrl + Shift + N', 'Incognito chat'],
  ['Ctrl + B', 'Toggle chat history'],
  ['Ctrl + K', 'Search chats'],
  ['Ctrl + ,', 'Settings']
]

/** Browser shortcuts: they work while the browser or a web page has focus. */
const BROWSER_SHORTCUTS: [string, string][] = [
  ['Ctrl + T', 'New tab'],
  ['Ctrl + W', 'Close tab'],
  ['Ctrl + Shift + T', 'Reopen closed tab'],
  ['Ctrl + Tab / Ctrl + Shift + Tab', 'Next / previous tab'],
  ['Ctrl + 1 … 8 / Ctrl + 9', 'Go to tab / last tab'],
  ['Ctrl + Shift + PageUp / PageDown', 'Move tab left / right'],
  ['Alt + ← / Alt + →', 'Back / forward'],
  ['Ctrl + R or F5', 'Reload'],
  ['Ctrl + Shift + R or Ctrl + F5', 'Reload without cache'],
  ['Esc', 'Stop loading'],
  ['Ctrl + L, Alt + D or F6', 'Go to the URL bar'],
  ['↑ / ↓ in the URL bar', 'Choose a suggestion'],
  ['Enter in the URL bar', 'Open or search in Orbis'],
  ['Ctrl + Enter in the URL bar', 'Ask Orion; the answer opens over the page'],
  ['Shift + Enter in the URL bar', 'Open in your default browser'],
  ['Alt + Enter in the URL bar', 'Open in a new tab'],
  ['Shift + Delete in the URL bar', 'Remove the chosen history or search suggestion'],
  ['Ctrl + F', 'Find in page'],
  ['F3 / Shift + F3', 'Next / previous match'],
  ['Ctrl + + / Ctrl + - / Ctrl + 0', 'Zoom in / out / reset'],
  ['F11', 'Fullscreen'],
  ['Ctrl + H', 'History'],
  ['Ctrl + J', 'Downloads'],
  ['Ctrl + D', 'Bookmark page'],
  ['Ctrl + Shift + D', 'Bookmark all tabs'],
  ['Ctrl + Shift + B', 'Bookmarks'],
  ['Ctrl + P', 'Print'],
  ['Ctrl + S', 'Save page'],
  ['Ctrl + U', 'View page source'],
  ['F12', 'Page developer tools'],
  ['Ctrl + click / middle-click', 'Open link in a background tab'],
  ['Shift + click', 'Open link in a new window']
]

export function ShortcutsModal({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass small shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div className="modal-header">
          <h2 id="shortcuts-title">Commands and shortcuts</h2>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <p className="hud-label shortcuts-section">Commands · type / in the message box</p>
          {SLASH_COMMANDS.map((command) => (
            <div key={command.name} className="shortcut-row">
              <span>{command.description}</span>
              <kbd>
                /{command.name}
                {command.args ? ` ${command.args}` : ''}
              </kbd>
            </div>
          ))}
          <p className="hud-label shortcuts-section">Keyboard shortcuts</p>
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="shortcut-row">
              <span>{action}</span>
              <kbd>{keys}</kbd>
            </div>
          ))}
          <p className="hud-label shortcuts-section">Browser · while the browser or a page has focus</p>
          {BROWSER_SHORTCUTS.map(([keys, action]) => (
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
