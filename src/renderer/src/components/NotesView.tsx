import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Check, Copy, Download, ExternalLink, FileUp, Pin, Plus, Search, Tag, Trash2, X } from 'lucide-react'
import type { Note, NoteColor, NoteSort } from '../../../shared/notes'
import { NOTE_COLORS, noteTitle, notePreview, noteToMarkdown } from '../../../shared/notes'
import type { NoticeKind } from '../App'
import { copyText } from '../lib/utils'

const SORTS: { id: NoteSort; label: string }[] = [
  { id: 'updated', label: 'Last changed' },
  { id: 'created', label: 'Newest' },
  { id: 'title', label: 'Title' }
]

const when = (time: number): string => {
  const days = Math.floor((Date.now() - time) / 86_400_000)
  if (days === 0) return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(time).toLocaleDateString()
}

/**
 * Notes: everything the user has written down, with search, tags and archiving. Editing saves itself shortly after
 * typing stops, and every button here does what it says.
 */
export default function NotesView({ onClose, onNotify }: { onClose(): void; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [notes, setNotes] = useState<Note[]>([])
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [archived, setArchived] = useState(false)
  const [sort, setSort] = useState<NoteSort>('updated')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Note | null>(null)
  const saveTimer = useRef<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    const [list, allTags] = await Promise.all([window.api.listNotes({ query, tag: tag ?? undefined, archived, sort }), window.api.noteTags()])
    setNotes(list)
    setTags(allTags)
  }

  useEffect(() => {
    void load()
  }, [query, tag, archived, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => window.api.onNotesChanged(() => void load()), [query, tag, archived, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => notes.find((n) => n.id === selectedId) ?? null, [notes, selectedId])
  useEffect(() => {
    // The editor follows the selected note unless the user is in the middle of typing in it.
    if (selected && draft?.id !== selected.id) setDraft(selected)
    if (!selected && draft && !notes.some((n) => n.id === draft.id)) setDraft(null)
  }, [selected, notes]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Saves a moment after typing stops, so nothing is lost and storage isn't hammered. */
  const edit = (patch: Partial<Note>): void => {
    setDraft((current) => {
      if (!current) return current
      const next = { ...current, ...patch, updatedAt: Date.now() }
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void window.api.saveNote(next), 400)
      return next
    })
  }

  const flush = async (): Promise<void> => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
      if (draft) await window.api.saveNote(draft)
    }
  }

  const create = async (): Promise<void> => {
    await flush()
    const note = await window.api.createNote({})
    setArchived(false)
    setSelectedId(note.id)
    setDraft(note)
    await load()
  }

  const saveFromPage = async (): Promise<void> => {
    try {
      const note = await window.api.noteFromPage()
      setSelectedId(note.id)
      setDraft(note)
      await load()
      onNotify(note.source?.quote ? 'Saved the selection as a note' : 'Saved the page as a note')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Nothing to save', 'error')
    }
  }

  const remove = async (note: Note): Promise<void> => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = null
    await window.api.removeNote(note.id)
    if (selectedId === note.id) {
      setSelectedId(null)
      setDraft(null)
    }
    await load()
    onNotify('Note deleted')
  }

  const importFile = async (file: File): Promise<void> => {
    const imported = await window.api.importNotes(await file.text()).catch(() => null)
    if (!imported?.length) return onNotify("That file didn't contain notes", 'error')
    await load()
    onNotify(`Imported ${imported.length} note${imported.length === 1 ? '' : 's'}`)
  }

  const exportAll = async (): Promise<void> => {
    const markdown = await window.api.exportNotes()
    await copyText(markdown)
    onNotify('All notes copied as Markdown')
  }

  return (
    <div className="view notes-view" role="region" aria-label="Notes">
      <header className="view-head">
        <h2>Notes</h2>
        <div className="view-actions">
          <button type="button" className="queue-btn primary" onClick={() => void create()}>
            <Plus size={14} /> New note
          </button>
          <button type="button" className="queue-btn" onClick={() => void saveFromPage()} title="Save the page you have open, with anything you have selected">
            <ExternalLink size={14} /> From page
          </button>
          <button type="button" className="queue-btn" onClick={() => void exportAll()} title="Copy every note as Markdown">
            <Download size={14} /> Export
          </button>
          <button type="button" className="queue-btn" onClick={() => fileRef.current?.click()} title="Import notes from a JSON export">
            <FileUp size={14} /> Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importFile(file)
            }}
          />
          <button type="button" className="icon-btn" aria-label="Close notes" onClick={() => void flush().then(onClose)}>
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="notes-body">
        <aside className="notes-list" aria-label="Your notes">
          <div className="notes-filters">
            <label className="notes-search">
              <Search size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as NoteSort)} aria-label="Sort notes">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="button" className={`queue-btn small${archived ? ' on' : ''}`} onClick={() => setArchived((v) => !v)} aria-pressed={archived}>
              <Archive size={12} /> Archived
            </button>
          </div>
          {tags.length > 0 && (
            <div className="notes-tags">
              <button type="button" className={`note-tag${tag === null ? ' on' : ''}`} onClick={() => setTag(null)}>
                All
              </button>
              {tags.map((t) => (
                <button key={t.tag} type="button" className={`note-tag${tag === t.tag ? ' on' : ''}`} onClick={() => setTag(tag === t.tag ? null : t.tag)}>
                  #{t.tag} <small>{t.count}</small>
                </button>
              ))}
            </div>
          )}
          <div className="notes-items">
            {notes.map((note) => (
              <button key={note.id} type="button" className={`note-item${note.id === selectedId ? ' selected' : ''} note-${note.color}`} onClick={() => void flush().then(() => setSelectedId(note.id))}>
                <span className="note-item-head">
                  <b>{noteTitle(note)}</b>
                  {note.pinned && <Pin size={12} className="note-pin" aria-label="Pinned" />}
                </span>
                <small className="note-item-preview">{notePreview(note) || 'Empty note'}</small>
                <small className="note-item-meta">
                  {when(note.updatedAt)}
                  {note.tags.length ? ` · ${note.tags.map((t) => `#${t}`).join(' ')}` : ''}
                </small>
              </button>
            ))}
            {!notes.length && <p className="view-empty">{query || tag ? 'No notes match.' : archived ? 'Nothing archived.' : 'No notes yet. Write one, or save the page you are reading.'}</p>}
          </div>
        </aside>

        <section className="note-editor" aria-label="Note">
          {draft ? (
            <>
              <div className="note-editor-bar">
                <input className="note-title" value={draft.title} placeholder={noteTitle(draft) === 'Untitled note' ? 'Title' : noteTitle(draft)} aria-label="Note title" onChange={(e) => edit({ title: e.target.value })} />
                <div className="note-editor-actions">
                  <div className="note-colors" role="group" aria-label="Note colour">
                    {NOTE_COLORS.map((color) => (
                      <button key={color} type="button" className={`note-color note-${color}${draft.color === color ? ' on' : ''}`} aria-label={`Colour: ${color}`} aria-pressed={draft.color === color} onClick={() => edit({ color: color as NoteColor })} />
                    ))}
                  </div>
                  <button type="button" className={`icon-btn${draft.pinned ? ' on' : ''}`} aria-pressed={draft.pinned} title={draft.pinned ? 'Unpin' : 'Pin to the top'} onClick={() => edit({ pinned: !draft.pinned })}>
                    <Pin size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Copy as Markdown"
                    onClick={() => void copyText(noteToMarkdown(draft)).then(() => onNotify('Note copied as Markdown'))}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={draft.archived ? 'Take out of the archive' : 'Archive'}
                    onClick={() => void window.api.archiveNote(draft.id, !draft.archived).then(() => (setSelectedId(null), setDraft(null), load()))}
                  >
                    {draft.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                  </button>
                  <button type="button" className="icon-btn danger" title="Delete this note" onClick={() => void remove(draft)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <textarea className="note-body" value={draft.body} placeholder="Write anything. Markdown works." aria-label="Note" onChange={(e) => edit({ body: e.target.value })} onBlur={() => void flush()} />
              <div className="note-foot">
                <label className="note-tags-input">
                  <Tag size={13} />
                  <input
                    value={draft.tags.join(' ')}
                    placeholder="tags separated by spaces"
                    aria-label="Tags"
                    onChange={(e) => edit({ tags: e.target.value.split(/[\s,]+/).filter(Boolean) })}
                  />
                </label>
                {draft.source && (
                  <a
                    className="note-source"
                    href={draft.source.url}
                    onClick={(e) => {
                      e.preventDefault()
                      void window.api.executeControl({ capability: 'navigation.go', params: { url: draft.source!.url } })
                    }}
                    title={draft.source.url}
                  >
                    <ExternalLink size={12} /> {draft.source.title || draft.source.url}
                  </a>
                )}
                <small className="view-muted">
                  <Check size={11} /> Saved {when(draft.updatedAt)}
                </small>
              </div>
            </>
          ) : (
            <div className="note-empty">
              <p className="view-muted">Pick a note, or write a new one.</p>
              <button type="button" className="queue-btn primary" onClick={() => void create()}>
                <Plus size={14} /> New note
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
