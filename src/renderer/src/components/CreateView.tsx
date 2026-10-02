import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, BarChart3, Check, Copy, FilePlus2, FolderOpen, History, LayoutTemplate, LineChart, Loader2, Pencil, Save, Search, Sparkles, Table2, FileText, Trash2, Workflow, X } from 'lucide-react'
import type { NoticeKind } from '../lib/notices'
import { CreateChange } from './CreateChange'
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

/** What can be pasted in. A chart comes from a table and a diagram from Orion, so neither is a paste kind. */
type Kind = 'table' | 'document'
/** Every kind a kept artifact can be. */
type RecordKind = Kind | 'plot' | 'diagram'

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

interface Version_ {
  versionId: string
  version: number
  createdAt: number
  reason: string
  bytes: number
  shape: { rows: number; columns: number }
}

interface Record_ {
  artifactId: string
  versionId: string
  version: number
  versions: Version_[]
  reason: string
  derivedFrom: { artifactId: string; versionId: string; title: string } | null
  kind: RecordKind
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

interface Hit {
  record: Record_
  where: 'title' | 'notes' | 'content'
  excerpt: string
}

const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

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
  /** A table's columns, so a chart can be asked for by name. Empty for anything that is not a table. */
  columns: { id: string; name: string; type: string; formula: string }[]
  /** The first rows of a table as text, to show as a table. Null for anything that is not one. */
  grid: { rows: string[][]; total: number } | null
  /** The tables inside a document, so each can be taken out as a table of its own. */
  tables: { index: number; caption: string; rows: number; columns: number; headings: string[] }[]
  formats: { format: string; name: string; extension: string; limitations: readonly string[] }[]
}

const CHART_KINDS = ['line', 'bar', 'scatter', 'area', 'step'] as const

/** What a record's shape means, in the words of its kind. */
const shapeText = (kind: string, shape: { rows: number; columns: number }): string => {
  switch (kind) {
    case 'table':
      return `${shape.rows} rows × ${shape.columns} columns`
    case 'plot':
      return `${shape.rows} points in ${shape.columns} series`
    case 'diagram':
      return `${shape.rows} boxes, ${shape.columns} arrows`
    default:
      return `${shape.rows} blocks`
  }
}

const iconFor = (kind: string): React.JSX.Element => {
  switch (kind) {
    case 'table':
      return <Table2 size={14} />
    case 'plot':
      return <LineChart size={14} />
    case 'diagram':
      return <Workflow size={14} />
    default:
      return <FileText size={14} />
  }
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

interface TemplateEntry {
  id: string
  kind: 'table' | 'document'
  name: string
  describe: string
  group: string
}

export default function CreateView({
  onClose,
  onNotify,
  asked
}: {
  onClose: () => void
  onNotify(message: string, kind?: NoticeKind): void
  /** A request typed into the chat as `/create ...`. The token changes each time, so the same words asked twice are made twice. */
  asked?: { text: string; token: number } | null
}): React.JSX.Element {
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

  const ask = async (acceptSecrets = false, given?: string): Promise<void> => {
    const words = (given ?? request).trim()
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

  const [importing, setImporting] = useState(false)
  const [analysing, setAnalysing] = useState(false)
  const [templates, setTemplates] = useState<TemplateEntry[]>([])
  const [templateId, setTemplateId] = useState('')
  const [starting, setStarting] = useState(false)
  const [revision, setRevision] = useState('')
  const [revising, setRevising] = useState(false)

  useEffect(() => {
    void window.api.creationRun({ operation: 'artifact.templates' }).then((result) => {
      if (result.ok) setTemplates(result.value as TemplateEntry[])
    })
  }, [])

  // What was typed after /create in the chat: put it in the box and make it, once per time it was asked.
  const askedToken = asked?.token
  useEffect(() => {
    if (!asked || asked.text.trim() === '') return
    setRequest(asked.text)
    void ask(false, asked.text)
  }, [askedToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const startFromTemplate = async (): Promise<void> => {
    if (starting || templateId === '') return
    setStarting(true)
    setAskFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.fromTemplate', templateId })
      if (!result.ok) {
        setAskFailure(failureOf(result))
        return
      }
      const made = result.value as { record: Record_ }
      onNotify(`Started "${made.record.title}". It is structure only: the rows and the "(fill in)" parts are yours.`, 'info')
      await refresh()
      await open(made.record.artifactId)
    } finally {
      setStarting(false)
    }
  }

  const revise = async (): Promise<void> => {
    if (!opened || revising || revision.trim() === '') return
    setRevising(true)
    setSaveFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.revise', artifactId: opened.record.artifactId, request: revision.trim() })
      if (!result.ok) {
        setSaveFailure(failureOf(result))
        return
      }
      const made = result.value as { record: Record_ }
      onNotify(`Revised "${made.record.title}" as version ${made.record.version}. The one before is kept.`, 'info')
      setRevision('')
      await refresh()
      await open(made.record.artifactId)
    } finally {
      setRevising(false)
    }
  }
  const [chartX, setChartX] = useState('')
  const [chartY, setChartY] = useState<string[]>([])
  const [chartKind, setChartKind] = useState<(typeof CHART_KINDS)[number]>('line')
  const [charting, setCharting] = useState(false)

  // When a table is opened, the first column is the x axis and the first numeric column after it is drawn.
  useEffect(() => {
    if (!opened || opened.record.kind !== 'table' || opened.columns.length === 0) return
    const numeric = opened.columns.filter((one) => one.type === 'number' || one.type === 'integer' || one.type === 'quantity')
    const x = opened.columns[0]
    setChartX(x.id)
    const y = numeric.find((one) => one.id !== x.id) ?? opened.columns.find((one) => one.id !== x.id)
    setChartY(y ? [y.id] : [])
  }, [opened])

  const chart = async (): Promise<void> => {
    if (!opened || charting || chartY.length === 0) return
    setCharting(true)
    setSaveFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.chart', artifactId: opened.record.artifactId, x: chartX, y: chartY, kind: chartKind })
      if (!result.ok) {
        setSaveFailure(failureOf(result))
        return
      }
      const made = result.value as { record: Record_ }
      onNotify(`Drew "${made.record.title}" and checked the kept copy.`, 'info')
      await refresh()
      await open(made.record.artifactId)
    } finally {
      setCharting(false)
    }
  }
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Search as you type, a quarter-second after the last key. An empty box is the plain library again.
  useEffect(() => {
    const words = query.trim()
    if (words === '') {
      setHits(null)
      return
    }
    const timer = window.setTimeout(() => {
      void window.api.creationRun({ operation: 'artifact.search', query: words }).then((result) => {
        if (result.ok) setHits(result.value as Hit[])
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  /** One of the operations that produce a record and then open it: restore, duplicate, update, rename. */
  const act = async (label: string, request: Record<string, unknown>, said: (record: Record_) => string): Promise<void> => {
    if (busy) return
    setBusy(label)
    setSaveFailure(null)
    try {
      const result = await window.api.creationRun(request)
      if (!result.ok) {
        setSaveFailure(failureOf(result))
        return
      }
      const made = result.value as { record: Record_ }
      onNotify(said(made.record), 'info')
      setQuery('')
      await refresh()
      await open(made.record.artifactId)
    } finally {
      setBusy(null)
    }
  }

  /** One change to the opened table. Says what each step did, and shows the result -- or the reason it was refused. */
  const change = async (request: Record<string, unknown>, said: (did: string[], title: string) => string): Promise<boolean> => {
    setSaveFailure(null)
    const result = await window.api.creationRun(request)
    if (!result.ok) {
      setSaveFailure(failureOf(result))
      return false
    }
    const made = result.value as { record: Record_; did?: string[] }
    onNotify(said(made.did ?? [], made.record.title), 'info')
    await refresh()
    await open(made.record.artifactId)
    return true
  }

  const importOne = async (acceptSecrets = false): Promise<void> => {
    if (importing) return
    setImporting(true)
    setAskFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.import', acceptSecrets })
      if (!result.ok) {
        if (result.error !== 'cancelled') setAskFailure(failureOf(result))
        return
      }
      const made = result.value as { record: Record_ }
      onNotify(`Opened "${made.record.title}" and checked the kept copy.`, 'info')
      await refresh()
      await open(made.record.artifactId)
    } finally {
      setImporting(false)
    }
  }

  const analyse = async (): Promise<void> => {
    if (!opened || analysing) return
    setAnalysing(true)
    setSaveFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.analyse', artifactId: opened.record.artifactId })
      if (!result.ok) {
        setSaveFailure(failureOf(result))
        return
      }
      const made = result.value as { record: Record_; findings: number }
      onNotify(`Analysed: ${made.findings} findings, kept as "${made.record.title}".`, 'info')
      await refresh()
      await open(made.record.artifactId)
    } finally {
      setAnalysing(false)
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
            <button type="button" className="queue-btn" disabled={importing} onClick={() => void importOne()} title="Open a CSV, Excel, Word, PDF, Markdown, JSON or text file">
              {importing ? <Loader2 size={13} className="spin" /> : <FolderOpen size={13} />}
              Open a file…
            </button>
          </form>
          {askFailure && <Findings failure={askFailure} onAccept={() => void ask(true)} />}
          {templates.length > 0 && (
            <form
              className="create-ask"
              aria-label="Start from a template"
              onSubmit={(event) => {
                event.preventDefault()
                void startFromTemplate()
              }}
            >
              <select className="create-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)} aria-label="Template">
                <option value="">Start from a template…</option>
                {[...new Set(templates.map((one) => one.group))].map((group) => (
                  <optgroup key={group} label={group}>
                    {templates
                      .filter((one) => one.group === group)
                      .map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.name} ({one.kind}) — {one.describe}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <button type="submit" className="queue-btn" disabled={starting || templateId === ''} title="A table with its columns chosen, or a document with its headings written. Works with no connection.">
                {starting ? <Loader2 size={13} className="spin" /> : <LayoutTemplate size={13} />}
                Start
              </button>
            </form>
          )}
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
            {/* The same text can replace what is open, as its next version. The version before stays. */}
            {opened && opened.record.kind === kind && (
              <button
                type="button"
                className="queue-btn"
                disabled={busy !== null || text.trim() === ''}
                onClick={() => void act('update', { operation: 'artifact.update', artifactId: opened.record.artifactId, text, reason: 'Replaced with new text.' }, (r) => `"${r.title}" is now version ${r.version}; version ${r.version - 1} is kept.`)}
                title="Keeps the current version and makes this the next one"
              >
                <History size={13} /> Replace “{opened.record.title}” with this
              </button>
            )}
            <span className="create-hint">Orbis keeps it, reads the copy back, and shows what it checked.</span>
          </div>
          {failure && <Findings failure={failure} onAccept={() => void make(true)} />}
        </section>

        <section className="create-library" aria-label="What you have made">
          <h3>Made so far</h3>
          <label className="pages-search create-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find by name, notes or what is in it" aria-label="Find an artifact" />
          </label>
          {hits !== null ? (
            hits.length === 0 ? (
              <p className="view-empty">Nothing has “{query.trim()}” in its name, notes or content.</p>
            ) : (
              <ul className="create-list">
                {hits.map((hit) => (
                  <li key={hit.record.artifactId} className={opened?.record.artifactId === hit.record.artifactId ? 'selected' : ''}>
                    <button type="button" className="create-row" onClick={() => void open(hit.record.artifactId)}>
                      {hit.record.kind === 'table' ? <Table2 size={14} /> : <FileText size={14} />}
                      <span className="create-row-title">{hit.record.title}</span>
                      <span className="create-row-meta">
                        {hit.where === 'title' ? 'in the name' : hit.where === 'notes' ? 'in the notes' : 'in the content'}: {hit.excerpt}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : library.length === 0 ? (
            <p className="view-empty">Nothing yet. Make a table or a document and it appears here.</p>
          ) : (
            <ul className="create-list">
              {library.map((one) => (
                <li key={one.artifactId} className={opened?.record.artifactId === one.artifactId ? 'selected' : ''}>
                  <button type="button" className="create-row" onClick={() => void open(one.artifactId)}>
                    {iconFor(one.kind)}
                    <span className="create-row-title">{one.title}</span>
                    <span className="create-row-meta">
                      {shapeText(one.kind, one.shape)} · {sizeOf(one.bytes)}
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
              {renaming !== null ? (
                <form
                  className="create-rename"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const title = renaming.trim()
                    setRenaming(null)
                    if (title !== '' && title !== opened.record.title) void act('rename', { operation: 'artifact.rename', artifactId: opened.record.artifactId, title }, (r) => `Renamed to "${r.title}".`)
                  }}
                >
                  <input value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={120} autoFocus aria-label="New name" onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} />
                  <button type="submit" className="queue-btn small">
                    Rename
                  </button>
                </form>
              ) : (
                <h3>{opened.record.title}</h3>
              )}
              <span className="create-row-meta">
                version {opened.record.version} · kept as {opened.record.format} · {sizeOf(opened.record.bytes)} · from {opened.record.source}
              </span>
              <span className="create-opened-actions">
                <button type="button" className="icon-btn" aria-label="Rename" title="Rename" disabled={busy !== null} onClick={() => setRenaming(opened.record.title)}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="icon-btn" aria-label="Duplicate" title="Make a copy that remembers where it came from" disabled={busy !== null} onClick={() => void act('duplicate', { operation: 'artifact.duplicate', artifactId: opened.record.artifactId }, (r) => `Made "${r.title}".`)}>
                  <Copy size={13} />
                </button>
              </span>
            </header>
            <Notes notes={opened.record.notes ?? []} />
            {/* Every earlier version, oldest first. Restoring one makes it current again as a newer version; nothing is removed. */}
            {opened.record.versions.length > 0 && (
              <ul className="create-history" aria-label="Earlier versions">
                {opened.record.versions.map((one) => (
                  <li key={one.versionId}>
                    <History size={13} />
                    <span>
                      <strong>Version {one.version}</strong> · {when(one.createdAt)} · {shapeText(opened.record.kind, one.shape)} · {sizeOf(one.bytes)}
                      {one.reason ? ` · ${one.reason}` : ''}
                    </span>
                    <button type="button" className="queue-btn small ghost" disabled={busy !== null} onClick={() => void act('restore', { operation: 'artifact.restore', artifactId: opened.record.artifactId, versionId: one.versionId }, (r) => `Version ${one.version} is current again, as version ${r.version}.`)}>
                      Restore
                    </button>
                  </li>
                ))}
                {opened.record.reason && <li className="create-history-now"><span>Version {opened.record.version} (current) · {opened.record.reason}</span></li>}
              </ul>
            )}
            <Checks verified={opened.record.verified} />
            <Losses loss={opened.record.loss} />
            {(opened.record.kind === 'plot' || opened.record.kind === 'diagram') && !opened.truncated ? (
              <img className="create-drawing" alt={`${opened.record.title}, drawn`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(opened.preview)}`} />
            ) : opened.record.kind === 'table' && opened.grid ? (
              <div className="create-grid" role="region" aria-label={`${opened.record.title}, as a table`} tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      {opened.columns.slice(0, opened.grid.rows[0]?.length ?? opened.columns.length).map((one) => (
                        <th key={one.id} scope="col" className={one.type === 'number' || one.type === 'integer' || one.type === 'quantity' ? 'num' : ''} title={one.type}>
                          {one.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {opened.grid.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className={opened.columns[j] && (opened.columns[j].type === 'number' || opened.columns[j].type === 'integer' || opened.columns[j].type === 'quantity') ? 'num' : ''}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {opened.grid.total === 0 && <p className="create-grid-more">No rows yet: the columns are the whole table.</p>}
                {opened.grid.total > opened.grid.rows.length && (
                  <p className="create-grid-more">
                    Showing the first {opened.grid.rows.length} of {opened.grid.total.toLocaleString()} rows. Every row is in the saved file.
                  </p>
                )}
              </div>
            ) : (
              <pre className="create-preview">
                {opened.preview}
                {opened.truncated ? '\n…' : ''}
              </pre>
            )}
            {opened.record.kind === 'document' && opened.tables.length > 0 && (
              <div className="create-save" aria-label="Tables in this document">
                <span>Take a table out</span>
                {opened.tables.map((one) => (
                  <button
                    key={one.index}
                    type="button"
                    className="queue-btn small"
                    disabled={busy !== null}
                    title={`Kept as a table of its own, so it can be sorted, totalled and drawn. Headings: ${one.headings.join(', ')}`}
                    onClick={() => void act(`extract-${one.index}`, { operation: 'artifact.extractTable', artifactId: opened.record.artifactId, index: one.index }, (r) => `Took out "${r.title}" as a table of its own.`)}
                  >
                    <Table2 size={13} />
                    {one.caption || `Table ${one.index}`} ({one.rows} rows × {one.columns} columns)
                  </button>
                ))}
              </div>
            )}
            {(opened.record.kind === 'document' || opened.record.kind === 'diagram') && (
              <form
                className="create-ask"
                aria-label={`Revise this ${opened.record.kind === 'document' ? 'document' : 'flowchart'}`}
                onSubmit={(event) => {
                  event.preventDefault()
                  void revise()
                }}
              >
                <input
                  className="create-revise"
                  value={revision}
                  onChange={(event) => setRevision(event.target.value)}
                  placeholder={opened.record.kind === 'document' ? 'Say what to change — e.g. make it shorter, add a section on risks' : 'Say what to change — e.g. add a step to check the email first'}
                  aria-label="What to change"
                  maxLength={2000}
                />
                <button type="submit" className="queue-btn small" disabled={revising || revision.trim() === ''} title="Orion rewrites it and Orbis keeps the result as a new version. The one before stays.">
                  {revising ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                  {revising ? 'Revising…' : 'Revise with Orion'}
                </button>
              </form>
            )}
            {opened.record.kind === 'table' && (
              <>
                <div className="create-save">
                  <button type="button" className="queue-btn small" disabled={analysing} onClick={() => void analyse()} title="Counts, statistics, quality and relationships, computed by Orbis and kept as a document">
                    {analysing ? <Loader2 size={13} className="spin" /> : <BarChart3 size={13} />}
                    Analyse this table
                  </button>
                </div>
                <CreateChange
                  artifactId={opened.record.artifactId}
                  title={opened.record.title}
                  columns={opened.columns}
                  others={library.filter((one) => one.kind === 'table' && one.artifactId !== opened.record.artifactId).map((one) => ({ artifactId: one.artifactId, title: one.title }))}
                  run={change}
                />
                {opened.columns.length >= 2 && (
                  <form
                    className="create-chart"
                    aria-label="Draw a chart from this table"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void chart()
                    }}
                  >
                    <label className="create-field">
                      <span>Across</span>
                      <select value={chartX} onChange={(event) => setChartX(event.target.value)}>
                        {opened.columns.map((one) => (
                          <option key={one.id} value={one.id}>
                            {one.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="create-field create-chart-y">
                      <legend>Draw</legend>
                      {opened.columns
                        .filter((one) => one.id !== chartX)
                        .map((one) => (
                          <label key={one.id} className="create-chip">
                            <input
                              type="checkbox"
                              checked={chartY.includes(one.id)}
                              onChange={(event) => setChartY(event.target.checked ? [...chartY, one.id] : chartY.filter((id) => id !== one.id))}
                            />
                            {one.name}
                          </label>
                        ))}
                    </fieldset>
                    <label className="create-field">
                      <span>As</span>
                      <select value={chartKind} onChange={(event) => setChartKind(event.target.value as (typeof CHART_KINDS)[number])}>
                        {CHART_KINDS.map((one) => (
                          <option key={one} value={one}>
                            {one}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="queue-btn small" disabled={charting || chartY.length === 0} title="A chart drawn by Orbis from these columns, kept as a drawing that remembers this table">
                      {charting ? <Loader2 size={13} className="spin" /> : <LineChart size={13} />}
                      Draw a chart
                    </button>
                  </form>
                )}
              </>
            )}
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
