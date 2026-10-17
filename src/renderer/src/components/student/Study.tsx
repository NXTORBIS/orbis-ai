import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookMarked, Check, Copy, ExternalLink, Package, Plus, Star, Trash2, X } from 'lucide-react'
import { onDay, type Call, type Catalogue } from './useStudent'
import type { CapturedThought, DistractionItem, FocusCapsule, FocusSpace, StudentSnapshot, StudyNote, StudyResource } from '../../../../shared/student/types'
import type { NoticeKind } from '../../lib/notices'
import { SearchBox } from '../../ui'

/**
 * Study: the things a student keeps, and the sessions they can start again.
 *
 * Four lists behind one set of tabs -- capsules, spaces, the library, and the later queue. They are together because
 * they are all answers to "what do I come back to", and apart from the dashboard because none of them is about
 * today.
 *
 * The later queue is the one with a rule worth stating: after a session it offers to open, to keep, to turn into a
 * task or to let go, and it never opens anything by itself. The point of saving a distraction is deciding later
 * rather than now, and a queue that launches six tabs the moment a session ends has undone its own purpose.
 */

type Tab = 'capsules' | 'spaces' | 'library' | 'later'

export default function Study({
  snapshot,
  catalogue,
  call,
  tab,
  onTab,
  onNotify,
  onStartCapsule,
  onOpen
}: {
  snapshot: StudentSnapshot
  catalogue: Catalogue | null
  call: Call
  tab: Tab
  onTab(tab: Tab): void
  onNotify(message: string, kind?: NoticeKind): void
  onStartCapsule(id: string): void
  onOpen(url: string): void
}): React.JSX.Element {
  const [capsules, setCapsules] = useState<FocusCapsule[]>([])
  const [spaces, setSpaces] = useState<FocusSpace[]>([])
  const [resources, setResources] = useState<StudyResource[]>([])
  const [notes, setNotes] = useState<StudyNote[]>([])
  const [later, setLater] = useState<DistractionItem[]>([])
  const [thoughts, setThoughts] = useState<CapturedThought[]>([])
  const [filter, setFilter] = useState('')
  const [subject, setSubject] = useState('')
  const [editing, setEditing] = useState<Partial<FocusCapsule> | null>(null)
  const [adding, setAdding] = useState<{ url: string; title: string; subject: string } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [c, s, r, n, l, t] = await Promise.all([
      call<FocusCapsule[]>('capsules'),
      call<FocusSpace[]>('spaces'),
      call<StudyResource[]>('resources'),
      call<StudyNote[]>('notes'),
      call<DistractionItem[]>('later'),
      call<CapturedThought[]>('thoughts')
    ])
    setCapsules(Array.isArray(c) ? c : [])
    setSpaces(Array.isArray(s) ? s : [])
    setResources(Array.isArray(r) ? r : [])
    setNotes(Array.isArray(n) ? n : [])
    setLater(Array.isArray(l) ? l : [])
    setThoughts(Array.isArray(t) ? t : [])
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  const subjects = useMemo(() => [...new Set([...resources, ...notes].map((one) => one.subject).filter((one): one is string => !!one))].sort(), [resources, notes])

  const shownResources = useMemo(() => {
    const words = filter.trim().toLowerCase()
    return resources.filter((one) => {
      if (subject && one.subject !== subject) return false
      if (!words) return true
      return one.title.toLowerCase().includes(words) || one.url.toLowerCase().includes(words) || one.tags.some((tag) => tag.toLowerCase().includes(words))
    })
  }, [resources, filter, subject])

  const waiting = later.filter((one) => one.state === 'waiting')
  const captured = thoughts.filter((one) => one.state === 'waiting')

  const saveCapsule = async (): Promise<void> => {
    if (!editing?.name?.trim()) return
    await call('save-capsule', editing)
    setEditing(null)
    await load()
    onNotify('Capsule saved.')
  }

  const saveResource = async (): Promise<void> => {
    if (!adding?.url.trim()) return
    const out = await call<{ ok: boolean; duplicate: boolean; why?: string }>('save-resource', adding)
    setAdding(null)
    await load()
    // Said plainly rather than quietly making a second copy of the same page.
    onNotify(out?.duplicate ? 'Already in your study library.' : 'Saved to your study library.', out?.duplicate ? 'warn' : 'info')
  }

  return (
    <div className="st-study">
      <header className="st-section-head">
        <div>
          <h2>Study</h2>
          <p className="st-faint">
            {capsules.length} capsules · {resources.length} saved · {waiting.length} for later
          </p>
        </div>
        <div className="st-tabs">
          {(['capsules', 'spaces', 'library', 'later'] as Tab[]).map((one) => (
            <button key={one} type="button" className={`st-tab${tab === one ? ' on' : ''}`} aria-pressed={tab === one} onClick={() => onTab(one)}>
              {one === 'later' ? `Later${waiting.length ? ` (${waiting.length})` : ''}` : one[0].toUpperCase() + one.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {tab === 'capsules' ? (
        <>
          <div className="st-row-actions">
            <button
              type="button"
              className="st-btn primary"
              onClick={() =>
                setEditing({
                  name: '',
                  subject: snapshot.recommendation?.subject ?? '',
                  task: '',
                  minutes: snapshot.preferences.defaultMinutes,
                  level: snapshot.preferences.defaultLevel,
                  blocked: [...snapshot.preferences.blockedCategories],
                  approved: [],
                  intention: '',
                  notes: '',
                  locked: false
                })
              }
            >
              <Plus size={15} aria-hidden /> New capsule
            </button>
          </div>
          {capsules.length === 0 ? (
            <p className="view-empty">A capsule is a session you can start again with one press — the subject, the length, the sound and what stays open.</p>
          ) : (
            <div className="st-grid">
              {capsules.map((one) => (
                <article key={one.id} className="st-tile">
                  <header>
                    <h4>
                      <Package size={14} aria-hidden /> {one.name}
                    </h4>
                    <button
                      type="button"
                      className="st-icon"
                      onClick={() => void call('save-capsule', { ...one, favourite: !one.favourite }).then(() => void load())}
                      aria-label={one.favourite ? 'Remove from favourites' : 'Add to favourites'}
                      aria-pressed={one.favourite}
                    >
                      <Star size={14} aria-hidden className={one.favourite ? 'on' : ''} />
                    </button>
                  </header>
                  <p className="st-faint">
                    {one.minutes}m · {catalogue?.levels[one.level]?.label ?? one.level}
                    {one.subject ? ` · ${one.subject}` : ''}
                    {one.locked ? ' · locked' : ''}
                  </p>
                  {one.task ? <p>{one.task}</p> : null}
                  {one.used > 0 ? (
                    <p className="st-faint small">
                      Started {one.used} {one.used === 1 ? 'time' : 'times'} · {one.completed} finished
                    </p>
                  ) : null}
                  <div className="st-tile-foot">
                    <button type="button" className="st-btn primary" onClick={() => onStartCapsule(one.id)}>
                      Start
                    </button>
                    <button type="button" className="st-btn" onClick={() => setEditing(one)}>
                      Edit
                    </button>
                    <button type="button" className="st-icon" onClick={() => void call('duplicate-capsule', one.id).then(() => void load())} aria-label={`Duplicate ${one.name}`}>
                      <Copy size={14} aria-hidden />
                    </button>
                    <button type="button" className="st-icon" onClick={() => void call('remove-capsule', one.id).then(() => void load())} aria-label={`Remove ${one.name}`}>
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === 'spaces' ? (
        <>
          <div className="st-row-actions">
            <button type="button" className="st-btn primary" onClick={() => void call('save-space', { name: 'New space' }).then(() => void load())}>
              <Plus size={15} aria-hidden /> New space
            </button>
          </div>
          {spaces.length === 0 ? (
            <p className="view-empty">A space remembers one subject: the pages you work from, your notes, and the capsules that go with it.</p>
          ) : (
            <div className="st-grid">
              {spaces.map((one) => (
                <article key={one.id} className="st-tile">
                  <header>
                    <h4>{one.name}</h4>
                  </header>
                  <p className="st-faint">
                    {one.subject ? `${one.subject} · ` : ''}
                    {one.tabs.length} {one.tabs.length === 1 ? 'page' : 'pages'}
                    {one.lastUsedAt ? ` · used ${onDay(one.lastUsedAt)}` : ''}
                  </p>
                  {one.tabs.slice(0, 3).map((tabRow) => (
                    <button key={tabRow.url} type="button" className="st-link block" onClick={() => onOpen(tabRow.url)}>
                      <ExternalLink size={12} aria-hidden /> {tabRow.title || tabRow.url}
                    </button>
                  ))}
                  <div className="st-tile-foot">
                    <button type="button" className="st-btn" onClick={() => one.tabs.forEach((tabRow) => onOpen(tabRow.url))} disabled={one.tabs.length === 0}>
                      Open pages
                    </button>
                    <button type="button" className="st-icon" onClick={() => void call('remove-space', one.id).then(() => void load())} aria-label={`Remove ${one.name}`}>
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === 'library' ? (
        <>
          <div className="st-row-actions">
            <SearchBox value={filter} onChange={setFilter} label="Search your study library" placeholder="Search your library" className="st-library-find" />
            <select value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject">
              <option value="">Every subject</option>
              {subjects.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
            <button type="button" className="st-btn primary" onClick={() => setAdding({ url: '', title: '', subject })}>
              <Plus size={15} aria-hidden /> Add a page
            </button>
          </div>
          {shownResources.length === 0 ? (
            <p className="view-empty">
              {resources.length === 0 ? 'Save a page while you are studying and it will be here, with your notes on it.' : 'Nothing matches that.'}
            </p>
          ) : (
            <ul className="st-library">
              {shownResources.map((one) => (
                <li key={one.id}>
                  <div>
                    <button type="button" className="st-link" onClick={() => void call('opened-resource', one.id).then(() => onOpen(one.url))}>
                      <BookMarked size={13} aria-hidden /> {one.title}
                    </button>
                    <span className="st-faint small">
                      {one.subject ? `${one.subject} · ` : ''}
                      {one.kind} · saved {onDay(one.savedAt)}
                      {one.read ? ' · opened' : ' · unread'}
                    </span>
                    {one.notes ? <p className="st-faint">{one.notes}</p> : null}
                  </div>
                  <div className="st-row-right">
                    <button
                      type="button"
                      className="st-icon"
                      onClick={() => void call('save-resource', { ...one, favourite: !one.favourite }).then(() => void load())}
                      aria-label={one.favourite ? 'Remove from favourites' : 'Add to favourites'}
                      aria-pressed={one.favourite}
                    >
                      <Star size={14} aria-hidden className={one.favourite ? 'on' : ''} />
                    </button>
                    <button type="button" className="st-icon" onClick={() => void call('remove-resource', one.id).then(() => void load())} aria-label={`Remove ${one.title}`}>
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {notes.length > 0 ? (
            <>
              <h3>Notes</h3>
              <ul className="st-note-list">
                {notes.slice(0, 20).map((one) => (
                  <li key={one.id}>
                    <strong>{one.title || 'Untitled'}</strong>
                    <span className="st-faint small">
                      {one.kind}
                      {one.subject ? ` · ${one.subject}` : ''} · {onDay(one.updatedAt)}
                    </span>
                    <p>{one.body.slice(0, 220)}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'later' ? (
        <>
          {waiting.length === 0 && captured.length === 0 ? (
            <p className="view-empty">Nothing waiting for later. Anything you save during a session turns up here.</p>
          ) : null}

          {waiting.length > 0 ? (
            <>
              <h3>Pages you saved</h3>
              <ul className="st-later">
                {waiting.map((one) => (
                  <li key={one.id}>
                    <div>
                      <strong>{one.title}</strong>
                      <span className="st-faint small">
                        {catalogue?.categories[one.category] ?? one.category}
                        {one.sessionTitle ? ` · saved during ${one.sessionTitle}` : ''} · {onDay(one.savedAt)}
                      </span>
                    </div>
                    <div className="st-row-right">
                      <button type="button" className="st-btn" onClick={() => void call('later-state', one.id, 'opened').then(() => (onOpen(one.url), load()))}>
                        Open
                      </button>
                      <button type="button" className="st-btn" onClick={() => void call('later-state', one.id, 'became-task').then(() => void load())}>
                        Make it a task
                      </button>
                      <button type="button" className="st-btn quiet" onClick={() => void call('later-state', one.id, 'archived').then(() => void load())}>
                        Let it go
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {captured.length > 0 ? (
            <>
              <h3>Things you wrote down</h3>
              <ul className="st-later">
                {captured.map((one) => (
                  <li key={one.id}>
                    <div>
                      <strong>{one.text}</strong>
                      <span className="st-faint small">{onDay(one.at)}</span>
                    </div>
                    <div className="st-row-right">
                      <button type="button" className="st-btn" onClick={() => void call('thought-state', one.id, 'became-task').then(() => void load())}>
                        <Check size={14} aria-hidden /> Make it a task
                      </button>
                      <button type="button" className="st-btn" onClick={() => void call('thought-state', one.id, 'became-note').then(() => void load())}>
                        Keep as a note
                      </button>
                      <button type="button" className="st-btn quiet" onClick={() => void call('thought-state', one.id, 'discarded').then(() => void load())}>
                        Discard
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <div className="st-sheet" role="dialog" aria-label="Capsule">
          <div className="st-sheet-card">
            <header className="st-sheet-head">
              <h3>{editing.id ? 'Edit capsule' : 'New capsule'}</h3>
              <button type="button" className="st-icon" onClick={() => setEditing(null)} aria-label="Close">
                <X size={16} aria-hidden />
              </button>
            </header>
            <label className="st-field">
              <span>Name</span>
              <input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value.slice(0, 120) })} placeholder="Physics — Kinematics" autoFocus />
            </label>
            <div className="st-row">
              <label className="st-field">
                <span>Subject</span>
                <input value={editing.subject ?? ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value.slice(0, 80) })} placeholder="Physics" />
              </label>
              <label className="st-field">
                <span>Minutes</span>
                <input type="number" min={5} max={300} step={5} value={editing.minutes ?? 50} onChange={(e) => setEditing({ ...editing, minutes: Number(e.target.value) })} />
              </label>
            </div>
            <label className="st-field">
              <span>The task</span>
              <input value={editing.task ?? ''} onChange={(e) => setEditing({ ...editing, task: e.target.value.slice(0, 300) })} placeholder="Projectile motion problems" />
            </label>
            <label className="st-field">
              <span>How strict</span>
              <select value={editing.level ?? 'focus'} onChange={(e) => setEditing({ ...editing, level: e.target.value as FocusCapsule['level'], locked: e.target.value === 'deep' })}>
                <option value="light">Light</option>
                <option value="focus">Focus</option>
                <option value="deep">Deep Focus</option>
              </select>
            </label>
            <label className="st-field">
              <span>Atmosphere</span>
              <select value={editing.atmosphere ?? ''} onChange={(e) => setEditing({ ...editing, atmosphere: e.target.value || null })}>
                <option value="">None</option>
                {(catalogue?.atmospheres ?? []).map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="st-field">
              <span>Always open in this session</span>
              <textarea
                value={(editing.approved ?? []).join('\n')}
                onChange={(e) => setEditing({ ...editing, approved: e.target.value.split('\n').map((one) => one.trim()).filter(Boolean) })}
                rows={3}
                placeholder={'ncert.nic.in\ndesmos.com'}
              />
            </label>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn quiet" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="st-btn primary" disabled={!editing.name?.trim()} onClick={() => void saveCapsule()}>
                Save capsule
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {adding ? (
        <div className="st-sheet" role="dialog" aria-label="Add a page">
          <div className="st-sheet-card tight">
            <header className="st-sheet-head">
              <h3>Add a page to your library</h3>
              <button type="button" className="st-icon" onClick={() => setAdding(null)} aria-label="Close">
                <X size={16} aria-hidden />
              </button>
            </header>
            <label className="st-field">
              <span>Address</span>
              <input value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value.slice(0, 2048) })} placeholder="https://" autoFocus />
            </label>
            <label className="st-field">
              <span>What is it?</span>
              <input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value.slice(0, 300) })} placeholder="NCERT Physics chapter 3" />
            </label>
            <label className="st-field">
              <span>Subject</span>
              <input value={adding.subject} onChange={(e) => setAdding({ ...adding, subject: e.target.value.slice(0, 80) })} placeholder="Physics" />
            </label>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn quiet" onClick={() => setAdding(null)}>
                Cancel
              </button>
              <button type="button" className="st-btn primary" disabled={!adding.url.trim()} onClick={() => void saveResource()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
