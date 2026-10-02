import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, FilePlus2, Loader2, Save, Sparkles, Table2, FileText, Trash2, X } from 'lucide-react'
import type { NoticeKind } from '../lib/notices'
import './create.css'

/**
 * Making something from text, keeping it, and saving it as a real file.
 *
 * The first screen of the Creation Engine, and deliberately the plainest: paste a table or some Markdown, give it a
 * name, and Orbis keeps it, reads the kept copy back, and lists the checks it ran. Save it and the same happens again
 * at the file you chose. Nothing on this screen says "made" or "saved" before the main process has read the file back
 * and compared it with what it meant to write -- the checks are shown rather than summarised, because "verified" has
 * to mean a list a person can read.
 *
 * Everything here goes through one channel and one operation map. The screen decides nothing; it asks and shows.
 */

type Kind = 'table' | 'document'

interface Check {
  what: string
  passed: boolean
  describe: string
}

interface Verified {
  ok: boolean
  checks: Check[]
  differences: string[]
}

interface Loss {
  lossy: boolean
  losses: { what: string; describe: string }[]
}

interface Record_ {
  artifactId: string
  kind: Kind
  title: string
  format: string
  bytes: number
  updatedAt: number
  loss: Loss
  verified: Verified
  source: string
  shape: { rows: number; columns: number }
  notes: string[]
}

interface Finding {
  entry: string
  looksLike: string
  line: number
}

interface Failure {
  error: string
  message: string
  findings?: Finding[]
  /** What each attempt said and what was wrong with it, when a model was asked. */
  attempts?: { said: string; problems: string[] }[]
}

interface Opened {
  record: Record_
  preview: string
  truncated: boolean
  formats: { format: string; name: string; extension: string; limitations: readonly string[] }[]
}

interface Saved {
  path: string
  format: string
  bytes: number
  loss: Loss
  verified: Verified
}

const KINDS: { id: Kind; label: string; icon: typeof Table2; hint: string }[] = [
  { id: 'table', label: 'Table', icon: Table2, hint: 'Rows and columns, separated by commas or tabs' },
  { id: 'document', label: 'Document', icon: FileText, hint: 'Headings, paragraphs, lists -- Markdown' }
]

const sizeOf = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const failureOf = (result: { ok: false; error: string; message: string; detail?: unknown }): Failure => {
  const detail = result.detail && typeof result.detail === 'object' ? (result.detail as { findings?: unknown; attempts?: unknown }) : {}
  return {
    error: result.error,
    message: result.message,
    findings: Array.isArray(detail.findings) ? (detail.findings as Finding[]) : undefined,
    attempts: Array.isArray(detail.attempts) ? (detail.attempts as { said: string; problems: string[] }[]) : undefined
  }
}

function Checks({ verified }: { verified: Verified }): React.JSX.Element {
  return (
    <ul className="create-checks" aria-label="What was checked">
      {verified.checks.map((one, i) => (
        <li key={i} className={one.passed ? 'passed' : 'failed'}>
          {one.passed ? <Check size={13} /> : <X size={13} />}
          <span>
            <strong>{one.what}</strong> {one.describe}
          </span>
        </li>
      ))}
      {verified.differences.map((one, i) => (
        <li key={`d${i}`} className="difference">
          <AlertTriangle size={13} />
          <span>{one}</span>
        </li>
      ))}
    </ul>
  )
}

function Losses({ loss }: { loss: Loss }): React.JSX.Element | null {
  if (!loss.lossy) return null
  return (
    <ul className="create-losses" aria-label="What this format cannot carry">
      {loss.losses.map((one, i) => (
        <li key={i}>
          <AlertTriangle size={13} />
          <span>{one.describe}</span>
        </li>
      ))}
    </ul>
  )
}

function Findings({ failure, onAccept }: { failure: Failure; onAccept: () => void }): React.JSX.Element {
  return (
    <section className="create-failure" aria-label="Why it was not written">
      <p>{failure.message}</p>
      {failure.findings && failure.findings.length > 0 && (
        <>
          <ul>
            {failure.findings.slice(0, 8).map((one, i) => (
              <li key={i}>
                Line {one.line}: looks like {one.looksLike}
              </li>
            ))}
          </ul>
          <button type="button" className="queue-btn small" onClick={onAccept}>
            Write it anyway
          </button>
        </>
      )}
      {/* What Orion said each time and what was wrong with it. Specific, because "could not make it" is not. */}
      {failure.attempts && failure.attempts.length > 0 && (
        <ul>
          {failure.attempts.flatMap((attempt, i) => attempt.problems.slice(0, 4).map((one, j) => <li key={`${i}-${j}`}>Attempt {i + 1}: {one}</li>))}
        </ul>
      )}
    </section>
  )
}

function Notes({ notes }: { notes: string[] }): React.JSX.Element | null {
  if (notes.length === 0) return null
  return (
    <ul className="create-notes" aria-label="Where this came from">
      {notes.map((one, i) => (
        <li key={i}>{one}</li>
      ))}
    </ul>
  )
}

export default function CreateView({ onClose, onNotify }: { onClose: () => void; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [request, setRequest] = useState('')
  const [asking, setAsking] = useState(false)
  const [askFailure, setAskFailure] = useState<Failure | null>(null)
  const [kind, setKind] = useState<Kind>('table')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [working, setWorking] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [library, setLibrary] = useState<Record_[]>([])
  const [opened, setOpened] = useState<Opened | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [saveFailure, setSaveFailure] = useState<Failure | null>(null)

  const refresh = useCallback(async () => {
    const result = await window.api.creationRun({ operation: 'artifact.list' })
    if (result.ok) setLibrary((result.value as { record: Record_ }[]).map((one) => one.record))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const open = useCallback(async (artifactId: string) => {
    setSaved(null)
    setSaveFailure(null)
    const result = await window.api.creationRun({ operation: 'artifact.read', artifactId })
    if (result.ok) setOpened(result.value as Opened)
  }, [])

  const ask = async (acceptSecrets = false): Promise<void> => {
    const words = request.trim()
    if (words === '' || asking) return
    setAsking(true)
    setAskFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.generate', request: words, acceptSecrets })
      if (!result.ok) {
        setAskFailure(failureOf(result))
        return
      }
      const made = result.value as { record: Record_ }
      onNotify(`Made "${made.record.title}" and checked the copy.`, 'info')
      setRequest('')
      await refresh()
      await open(made.record.artifactId)
    } finally {
      setAsking(false)
    }
  }

  const make = async (acceptSecrets = false): Promise<void> => {
    if (working || text.trim() === '') return
    setWorking(true)
    setFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.create', kind, title, text, source: 'pasted', acceptSecrets })
      if (!result.ok) {
        setFailure(failureOf(result))
        return
      }
      const made = result.value as { record: Record_ }
      onNotify(`Kept "${made.record.title}" and checked the copy.`, 'info')
      setText('')
      setTitle('')
      await refresh()
      await open(made.record.artifactId)
    } finally {
      setWorking(false)
    }
  }

  const save = async (format: string, acceptSecrets = false): Promise<void> => {
    if (!opened || saving) return
    setSaving(format)
    setSaved(null)
    setSaveFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.export', artifactId: opened.record.artifactId, format, acceptSecrets })
      if (!result.ok) {
        // Cancelling the dialog is not a failure worth a red box.
        if (result.error !== 'cancelled') setSaveFailure(failureOf(result))
        return
      }
      const outcome = result.value as Saved
      setSaved(outcome)
      onNotify(`Saved and checked: ${outcome.path}`, 'info')
    } finally {
      setSaving(null)
    }
  }

  const remove = async (artifactId: string): Promise<void> => {
    await window.api.creationRun({ operation: 'artifact.remove', artifactId })
    if (opened?.record.artifactId === artifactId) setOpened(null)
    await refresh()
  }

  return (
    <div className="view create-view" role="region" aria-label="Create">
      <header className="view-head">
        <button type="button" className="icon-btn" aria-label="Back to chat" onClick={onClose}>
          <ArrowLeft size={16} />
        </button>
        <h2>Create</h2>
        <div className="view-actions" />
      </header>

      <div className="create-body">
        <section className="create-make" aria-label="Make something">
          {/* The sentence first. Orion decides whether it is a table or a document and writes it; the rest is the same path. */}
          <form
            className="create-ask"
            onSubmit={(e) => {
              e.preventDefault()
              void ask()
            }}
          >
            <label className="pages-search create-ask-input">
              <Sparkles size={14} />
              <input
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="Describe what you want — a monthly expense tracker, a study plan, a project proposal"
                aria-label="Describe what you want made"
                disabled={asking}
                maxLength={4000}
              />
            </label>
            <button type="submit" className="queue-btn primary" disabled={asking || request.trim() === ''}>
              {asking ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
              {asking ? 'Writing…' : 'Make it with Orion'}
            </button>
          </form>
          {askFailure && <Findings failure={askFailure} onAccept={() => void ask(true)} />}
          <p className="create-or">or paste it yourself</p>

          <div className="create-kinds" role="radiogroup" aria-label="What to make">
            {KINDS.map((one) => (
              <button
                key={one.id}
                type="button"
                role="radio"
                aria-checked={kind === one.id}
                className={`create-kind${kind === one.id ? ' active' : ''}`}
                onClick={() => setKind(one.id)}
                title={one.hint}
              >
                <one.icon size={14} /> {one.label}
              </button>
            ))}
          </div>
          <label className="create-field">
            <span>Name</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'table' ? 'Monthly expenses' : 'Project notes'} maxLength={120} disabled={working} />
          </label>
          <label className="create-field create-text">
            <span>{kind === 'table' ? 'The table, as text' : 'The document, as Markdown'}</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === 'table' ? 'date,category,amount\n2026-10-01,food,12.50\n2026-10-02,travel,40' : '# Title\n\nA paragraph.\n\n- a list'}
              spellCheck={false}
              disabled={working}
            />
          </label>
          <div className="create-actions">
            <button type="button" className="queue-btn primary" disabled={working || text.trim() === ''} onClick={() => void make()}>
              {working ? <Loader2 size={13} className="spin" /> : <FilePlus2 size={13} />}
              {working ? 'Making…' : 'Make it'}
            </button>
            <span className="create-hint">Orbis keeps it, reads the copy back, and shows what it checked.</span>
          </div>
          {failure && <Findings failure={failure} onAccept={() => void make(true)} />}
        </section>

        <section className="create-library" aria-label="What you have made">
          <h3>Made so far</h3>
          {library.length === 0 ? (
            <p className="view-empty">Nothing yet. Make a table or a document and it appears here.</p>
          ) : (
            <ul className="create-list">
              {library.map((one) => (
                <li key={one.artifactId} className={opened?.record.artifactId === one.artifactId ? 'selected' : ''}>
                  <button type="button" className="create-row" onClick={() => void open(one.artifactId)}>
                    {one.kind === 'table' ? <Table2 size={14} /> : <FileText size={14} />}
                    <span className="create-row-title">{one.title}</span>
                    <span className="create-row-meta">
                      {one.kind === 'table' ? `${one.shape.rows} rows × ${one.shape.columns} columns` : `${one.shape.rows} blocks`} · {sizeOf(one.bytes)}
                      {one.verified.ok ? '' : ' · not verified'}
                    </span>
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Remove ${one.title}`} onClick={() => void remove(one.artifactId)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {opened && (
          <section className="create-opened" aria-label={opened.record.title}>
            <header>
              <h3>{opened.record.title}</h3>
              <span className="create-row-meta">
                Kept as {opened.record.format} · {sizeOf(opened.record.bytes)} · from {opened.record.source}
              </span>
            </header>
            <Notes notes={opened.record.notes ?? []} />
            <Checks verified={opened.record.verified} />
            <Losses loss={opened.record.loss} />
            <pre className="create-preview">
              {opened.preview}
              {opened.truncated ? '\n…' : ''}
            </pre>
            <div className="create-save">
              <span>Save as</span>
              {opened.formats.map((one) => (
                <button
                  key={one.format}
                  type="button"
                  className="queue-btn small"
                  disabled={saving !== null}
                  onClick={() => void save(one.format)}
                  title={one.limitations.join(' ')}
                >
                  {saving === one.format ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                  {one.name} ({one.extension})
                </button>
              ))}
            </div>
            {saveFailure && <Findings failure={saveFailure} onAccept={() => void save(saveFailure.findings ? opened.formats[0].format : opened.record.format, true)} />}
            {saved && (
              <section className="create-saved" aria-label="Saved">
                <p>
                  <Check size={13} /> Saved to <code>{saved.path}</code> ({sizeOf(saved.bytes)}), read back and checked.
                </p>
                <Losses loss={saved.loss} />
                <Checks verified={saved.verified} />
              </section>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
