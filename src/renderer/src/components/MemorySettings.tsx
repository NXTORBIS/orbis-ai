import { useCallback, useEffect, useState } from 'react'
import type { MemoryCategory, MemoryEntry, MemorySettings as Settings } from '../../../shared/memory'
import { Toggle } from './SettingsModal'

const CATEGORY: Record<MemoryCategory, string> = { about: 'About you', preference: 'Preference', project: 'Project', general: 'General' }

const said = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.')

function when(ms?: number): string {
  if (!ms) return 'not used yet'
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  return days <= 0 ? 'used today' : days === 1 ? 'used yesterday' : `used ${days} days ago`
}

/**
 * Settings → Memory: everything Orbis remembers for this profile, and nothing it does not show here.
 *
 * Each entry says whether Orion has actually used it, from the store's own record. Adding, editing, pinning, archiving
 * and deleting are all the person's; Orbis never adds anything it was not asked to.
 */
export default function MemorySettings(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [message, setMessage] = useState('')

  const refresh = useCallback(() => {
    void window.api.memorySettings().then(setSettings).catch(() => undefined)
    void window.api.listMemories({ query: query.trim() || undefined, includeArchived: archived }).then(setEntries).catch(() => undefined)
  }, [query, archived])

  useEffect(() => {
    refresh()
    return window.api.onMemoryChanged(refresh)
  }, [refresh])

  const act = async (work: () => Promise<unknown>, done?: string): Promise<void> => {
    setMessage('')
    try {
      await work()
      if (done) setMessage(done)
    } catch (err) {
      setMessage(said(err))
    }
    refresh()
  }

  if (!settings) return <p className="setting-note">Loading…</p>

  const add = (): void => {
    const text = draft.trim()
    if (!text) return
    void act(async () => {
      await window.api.addMemory(text)
      setDraft('')
    })
  }

  return (
    <div className="skills-settings memory-settings">
      <div className="skills-row">
        <span>Remember things I ask Orbis to remember</span>
        <Toggle checked={settings.enabled} onChange={(v) => void act(() => window.api.setMemorySettings({ enabled: v }))} />
      </div>
      <div className="skills-row">
        <span>Use relevant memories in chat</span>
        <Toggle checked={settings.useInChat} onChange={(v) => void act(() => window.api.setMemorySettings({ useInChat: v }))} />
      </div>
      <p className="setting-note">In chat, say “remember that …”, “forget that …” or “what do you remember about me?”. Passwords, keys and card numbers are never kept.</p>

      <div className="skills-tools">
        <input
          type="text"
          placeholder="Add something to remember"
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          aria-label="Add something to remember"
          disabled={!settings.enabled}
        />
        <button type="button" className="setting-action" onClick={add} disabled={!settings.enabled || !draft.trim()}>
          Add
        </button>
      </div>
      <div className="skills-tools">
        <input type="search" placeholder="Search memory" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search memory" />
        <button type="button" className="setting-action" onClick={() => setArchived(!archived)} aria-pressed={archived}>
          {archived ? 'Hide archived' : 'Show archived'}
        </button>
        {entries.length > 0 && !query && (
          <button type="button" className="setting-action" onClick={() => window.confirm('Delete everything Orbis remembers in this profile? This cannot be undone.') && void act(() => window.api.clearMemories(), 'Memory cleared.')}>
            Delete all
          </button>
        )}
      </div>
      {message && (
        <p className="setting-note" role="status">
          {message}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="setting-note">{query ? 'Nothing matches that search.' : 'Nothing remembered yet.'}</p>
      ) : (
        <ul className="skills-list">
          {entries.map((entry) => (
            <li key={entry.id} className={`skill-item memory-item${entry.archived ? ' archived' : ''}`}>
              {editing?.id === entry.id ? (
                <div className="skills-tools">
                  <input value={editing.text} maxLength={500} onChange={(e) => setEditing({ id: entry.id, text: e.target.value })} aria-label="Edit memory" autoFocus />
                  <button type="button" className="setting-action" onClick={() => void act(async () => { await window.api.updateMemory(entry.id, { text: editing.text }); setEditing(null) })}>
                    Save
                  </button>
                  <button type="button" className="setting-action" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <p>{entry.text}</p>
              )}
              <p className="skill-meta">
                <select value={entry.category} onChange={(e) => void act(() => window.api.updateMemory(entry.id, { category: e.target.value as MemoryCategory }))} aria-label="Category">
                  {Object.entries(CATEGORY).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {' · '}
                {when(entry.lastUsedAt)}
                {entry.pinned ? ' · pinned, always used' : ''}
                {entry.archived ? ' · archived' : ''}
              </p>
              <div className="skill-actions">
                <button type="button" onClick={() => setEditing({ id: entry.id, text: entry.text })}>
                  Edit
                </button>
                <button type="button" onClick={() => void act(() => window.api.updateMemory(entry.id, { pinned: !entry.pinned }))}>
                  {entry.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button type="button" onClick={() => void act(() => window.api.updateMemory(entry.id, { archived: !entry.archived }))}>
                  {entry.archived ? 'Restore' : 'Archive'}
                </button>
                <button type="button" className="danger" onClick={() => void act(() => window.api.removeMemory(entry.id))}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
