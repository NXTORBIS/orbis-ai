import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, Check, CalendarPlus, Cloud, Code2, Copy, FilePlus2, FolderOpen, FolderTree, History, Image as ImageIcon, LayoutTemplate, LineChart, Loader2, Mail, Music, Pencil, Play, Save, Sparkles, Table2, FileText, Trash2, Video, Workflow, X } from 'lucide-react'
import type { NoticeKind } from '../lib/notices'
import { CreateChange } from './CreateChange'
import { CreateGrid } from './CreateGrid'
import { Button, SearchBox, Surface } from '../ui'
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
type Kind = 'table' | 'document' | 'code'
/** Every kind a kept artifact can be. */
type RecordKind = Kind | 'plot' | 'diagram' | 'project' | 'image' | 'audio' | 'video'

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
  grid: { rows: string[][]; total: number; from: number } | null
  /** The tables inside a document, so each can be taken out as a table of its own. */
  tables: { index: number; caption: string; rows: number; columns: number; headings: string[] }[]
  /** For code: which language it is. Null for anything else. */
  code: { language: string; name: string; extension: string } | null
  /** For a picture, a sound or a video: what the file says about itself. Never its bytes. */
  media: {
    kind: 'image' | 'audio' | 'video'
    format: string
    mediaType: string
    bytes: number
    width: number | null
    height: number | null
    durationMs: number | null
    from: string
    notes: readonly string[]
  } | null
  /** For a project: its files, which one it starts at, and whether it can be shown in the sandbox. */
  project: {
    files: { path: string; language: string; characters: number }[]
    entry: string
    listing: string
    languages: { name: string; files: number }[]
    shown: string
    runnable: boolean
    cannotRun: string
  } | null
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
    case 'code':
      return `${shape.rows} ${shape.rows === 1 ? 'line' : 'lines'}`
    case 'project':
      return `${shape.rows} ${shape.rows === 1 ? 'file' : 'files'}`
    // A picture and a video are as big as they say; a sound is as long as it says. A file that never said says so.
    case 'image':
    case 'video':
      return shape.columns > 0 && shape.rows > 0 ? `${shape.columns} × ${shape.rows}` : 'size not known'
    case 'audio':
      return shape.rows > 0 ? `${shape.rows} ${shape.rows === 1 ? 'second' : 'seconds'}` : 'length not known'
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
    case 'code':
      return <Code2 size={14} />
    case 'project':
      return <FolderTree size={14} />
    case 'image':
      return <ImageIcon size={14} />
    case 'audio':
      return <Music size={14} />
    case 'video':
      return <Video size={14} />
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
  { id: 'document', label: 'Document', icon: FileText, hint: 'Headings, paragraphs, lists -- Markdown' },
  { id: 'code', label: 'Code', icon: Code2, hint: 'One source file, kept exactly as written. Orbis never runs it.' }
]

const sizeOf = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * Why there is no picture and no player on screen, in plain words.
 *
 * A sound and a video are kept and checked and never played: there is no way to hand a stored file's bytes to this
 * window, and inventing one would be content crossing to the interface. A picture over half a megabyte would have to
 * be decoded and re-encoded to be shrunk, which is the one thing these three kinds are built not to do.
 */
function mediaWords(kind: 'image' | 'audio' | 'video', facts: Opened['media']): string {
  if (kind === 'audio') return 'Orbis keeps this sound and checks it, and does not play it. Save it to listen to it.'
  if (kind === 'video') return 'Orbis keeps this video and checks it, and does not play it. Save it to watch it.'
  const size = facts ? `${(facts.bytes / (1024 * 1024)).toFixed(1)} MB` : 'large'
  return `This picture is ${size}, too large to show here without changing it. Save it, or open it in a picture program.`
}

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
          <Button size="small" onClick={onAccept}>
            Write it anyway
          </Button>
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

/**
 * The last request and the last "open this" the screen acted on.
 *
 * Kept outside the component because the screen is taken down when it closes and put up again when it opens, while
 * the application still holds the last thing it was asked. Without this, opening Create a second time would make the
 * thing typed after `/create` a second time.
 */
let lastAskedToken = 0
let lastOpenAtToken = 0

export default function CreateView({
  onClose,
  onNotify,
  asked,
  openAt
}: {
  onClose: () => void
  onNotify(message: string, kind?: NoticeKind): void
  /** A request typed into the chat as `/create ...`. The token changes each time, so the same words asked twice are made twice. */
  asked?: { text: string; token: number } | null
  /** An artifact a card in the conversation asked to have opened here. */
  openAt?: { artifactId: string; token: number } | null
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

  /** Which file of a project is being looked at. Empty means the one it starts at. */
  const [filePath, setFilePath] = useState('')

  const open = useCallback(async (artifactId: string, from = 0, path = '') => {
    setSaved(null)
    setSaveFailure(null)
    // `from`: which row a table's screenful starts at, so a long one can be walked through.
    const result = await window.api.creationRun({ operation: 'artifact.read', artifactId, from, ...(path !== '' ? { path } : {}) })
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
  const [languages, setLanguages] = useState<{ id: string; name: string; extension: string; checked: boolean }[]>([])
  const [language, setLanguage] = useState('python')

  useEffect(() => {
    void window.api.creationRun({ operation: 'artifact.languages' }).then((result) => {
      if (result.ok) setLanguages(result.value as { id: string; name: string; extension: string; checked: boolean }[])
    })
  }, [])
  const [templateId, setTemplateId] = useState('')
  const [starting, setStarting] = useState(false)
  const [figureId, setFigureId] = useState('')
  const [figureCaption, setFigureCaption] = useState('')
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
    if (!asked || asked.text.trim() === '' || asked.token === lastAskedToken) return
    lastAskedToken = asked.token
    setRequest(asked.text)
    void ask(false, asked.text)
  }, [askedToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Open" on a card in the conversation: show that artifact, and bring it into view.
  const openAtToken = openAt?.token
  useEffect(() => {
    if (!openAt || openAt.token === lastOpenAtToken) return
    lastOpenAtToken = openAt.token
    void open(openAt.artifactId).then(() => requestAnimationFrame(() => document.querySelector('.create-opened')?.scrollIntoView({ block: 'start' })))
  }, [openAtToken]) // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * A scanned PDF Orbis stopped at, and the question it asked.
   *
   * Two steps, because reading the pictures of its pages means sending them to a service outside this computer. The
   * words shown are the ones the reader itself wrote -- not a shorter version of them -- and the yes is sent back as
   * the answer to that question about that file.
   */
  const [scanned, setScanned] = useState<{ pages: number; to: string; ask: string } | null>(null)

  const importOne = async (acceptSecrets = false, readScanned = false): Promise<void> => {
    if (importing) return
    setImporting(true)
    setAskFailure(null)
    if (!readScanned) setScanned(null)
    try {
      const result = await window.api.creationRun({
        operation: 'artifact.import',
        acceptSecrets,
        ...(readScanned ? { readScanned: { agreed: true, to: 'Mistral' } } : {})
      })
      if (!result.ok) {
        if (result.error === 'cancelled') return
        if (result.error === 'scanned') {
          const detail = (result.detail ?? {}) as { pages?: number; to?: string; ask?: string }
          setScanned({ pages: detail.pages ?? 0, to: detail.to ?? 'Mistral', ask: detail.ask ?? result.message })
          return
        }
        setAskFailure(failureOf(result))
        return
      }
      setScanned(null)
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
      const result = await window.api.creationRun({ operation: 'artifact.create', kind, title, text, source: 'pasted', acceptSecrets, ...(kind === 'code' ? { language } : {}) })
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

  const save = async (format: string, acceptSecrets = false, extra: Record<string, unknown> = {}): Promise<void> => {
    if (!opened || saving) return
    setSaving(format)
    setSaved(null)
    setSaveFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.export', artifactId: opened.record.artifactId, format, acceptSecrets, ...extra })
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

  // ---------------------------------------------------------------- the four new places something can go

  /** The folders a cloud program keeps in step, looked for once. Empty means there is nowhere, and no button. */
  const [cloud, setCloud] = useState<{ id: string; name: string; path: string; writable: boolean; keptBy: string }[]>([])
  useEffect(() => {
    void window.api.creationRun({ operation: 'artifact.cloudFolders' }).then((result) => {
      if (result.ok) setCloud((result.value as { folders: typeof cloud }).folders ?? [])
    })
  }, [])

  const [emailing, setEmailing] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [draft, setDraft] = useState<{ path: string; notes: string[] } | null>(null)

  /** A mail draft with this artifact attached. Orbis writes the file; sending it is the person's own act. */
  const writeDraft = async (format: string): Promise<void> => {
    if (!opened || emailing) return
    setEmailing(true)
    setSaveFailure(null)
    setDraft(null)
    try {
      const result = await window.api.creationRun({
        operation: 'artifact.emailDraft',
        artifactId: opened.record.artifactId,
        format,
        subject: opened.record.title,
        body: `${opened.record.title} is attached.`,
        ...(emailTo.trim() !== '' ? { to: emailTo.split(/[,;]/).map((one) => one.trim()).filter((one) => one !== '') } : {}),
        where: 'downloads'
      })
      if (!result.ok) {
        if (result.error !== 'cancelled') setSaveFailure(failureOf(result))
        return
      }
      const made = result.value as { path: string; notes: string[] }
      setDraft(made)
      onNotify(`The draft was written and checked: ${made.path}`, 'info')
    } finally {
      setEmailing(false)
    }
  }

  /** A copy into a folder a cloud program watches. The uploading is that program's doing, not Orbis's. */
  const saveToCloud = async (folder: string, format: string): Promise<void> => {
    if (!opened || saving) return
    setSaving(`cloud:${folder}`)
    setSaved(null)
    setSaveFailure(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.saveToCloud', artifactId: opened.record.artifactId, folder, format })
      if (!result.ok) {
        setSaveFailure(failureOf(result))
        return
      }
      const outcome = result.value as Saved
      setSaved(outcome)
      onNotify(`A copy was saved and checked: ${outcome.path}`, 'info')
    } finally {
      setSaving(null)
    }
  }

  const [running, setRunning] = useState(false)
  const [ran, setRan] = useState<{ ok: boolean; message: string; notes: string[] } | null>(null)

  /** A project that is one web page, shown in Orbis's sandbox. Nothing is run on this computer. */
  const runInSandbox = async (): Promise<void> => {
    if (!opened || running) return
    setRunning(true)
    setRan(null)
    try {
      const result = await window.api.creationRun({ operation: 'artifact.run', artifactId: opened.record.artifactId })
      if (!result.ok) {
        const detail = (result.detail ?? {}) as { problems?: string[]; notes?: string[] }
        setRan({ ok: false, message: result.message, notes: [...(detail.problems ?? []), ...(detail.notes ?? [])].slice(0, 6) })
        return
      }
      const outcome = result.value as { entry?: string; notes?: string[] }
      setRan({ ok: true, message: `It is open in the sandbox, showing ${outcome.entry ?? 'its page'}.`, notes: (outcome.notes ?? []).slice(0, 4) })
    } finally {
      setRunning(false)
    }
  }

  const [fileText, setFileText] = useState('')
  const [editingFile, setEditingFile] = useState(false)

  /** One file of a project saved as a new version. The version before it stays, as for every other change. */
  const saveFile = async (): Promise<void> => {
    if (!opened || !opened.project || editingFile) return
    const path = filePath || opened.project.entry
    setEditingFile(true)
    setSaveFailure(null)
    try {
      const done = await change({ operation: 'artifact.update', artifactId: opened.record.artifactId, path, text: fileText }, (did) => did[0] ?? `Changed ${path}.`)
      if (done) setFileText('')
    } finally {
      setEditingFile(false)
    }
  }

  const remove = async (artifactId: string): Promise<void> => {
    await window.api.creationRun({ operation: 'artifact.remove', artifactId })
    if (opened?.record.artifactId === artifactId) setOpened(null)
    await refresh()
  }

  return (
    <Surface title="Create" closeLabel="Back to chat" onClose={onClose} className="create-view">
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
            <label className="pages-ask create-ask-input">
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
            {/* `busy` is the dance this used to write out: the words swapped for "Writing…", the button disabled, and both put back. */}
            <Button
              type="submit"
              kind="primary"
              busy={asking}
              busyLabel="Writing…"
              disabled={request.trim() === ''}
              icon={asking ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            >
              Make it with Orion
            </Button>
            <Button disabled={importing} onClick={() => void importOne()} title="Open a CSV, Excel, Word, PDF, Markdown, JSON or text file" icon={importing ? <Loader2 size={13} className="spin" /> : <FolderOpen size={13} />}>
              Open a file…
            </Button>
          </form>
          {/*
           * A scanned PDF, and the question before anything is sent.
           *
           * The words are the reader's own, shown exactly: how many pages, where the pictures would go, that the
           * words would be a model's reading and may be wrong, and that nothing is sent unless you say yes. The yes
           * is this button and nothing else.
           */}
          {scanned && (
            <section className="create-failure" aria-label="This PDF is pictures of its pages">
              <p>{scanned.ask}</p>
              <div className="create-save">
                <Button kind="primary" size="small" disabled={importing} onClick={() => void importOne(false, true)} icon={importing ? <Loader2 size={13} className="spin" /> : <Check size={13} />}>
                  Yes, send {scanned.pages === 1 ? 'the picture' : `all ${scanned.pages} pictures`} to {scanned.to}
                </Button>
                <Button size="small" onClick={() => setScanned(null)}>
                  No
                </Button>
              </div>
            </section>
          )}
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
              <Button
                type="submit"
                disabled={starting || templateId === ''}
                title="A table with its columns chosen, or a document with its headings written. Works with no connection."
                icon={starting ? <Loader2 size={13} className="spin" /> : <LayoutTemplate size={13} />}
              >
                Start
              </Button>
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
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'table' ? 'Monthly expenses' : kind === 'code' ? 'Rename photos' : 'Project notes'} maxLength={120} disabled={working} />
          </label>
          {kind === 'code' && (
            <label className="create-field">
              <span>Language</span>
              <select className="create-template" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={working}>
                {languages.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name} ({one.extension}){one.checked ? ' — Orbis can check that it reads' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="create-field create-text">
            <span>{kind === 'table' ? 'The table, as text' : kind === 'code' ? 'The file, exactly as it should be kept' : 'The document, as Markdown'}</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === 'table' ? 'date,category,amount\n2026-10-01,food,12.50\n2026-10-02,travel,40' : kind === 'code' ? 'import os\n\nfor name in os.listdir("."):\n    print(name)' : '# Title\n\nA paragraph.\n\n- a list'}
              spellCheck={false}
              disabled={working}
            />
          </label>
          <div className="create-actions">
            <Button
              kind="primary"
              busy={working}
              busyLabel="Making…"
              disabled={text.trim() === ''}
              onClick={() => void make()}
              icon={working ? <Loader2 size={13} className="spin" /> : <FilePlus2 size={13} />}
            >
              Make it
            </Button>
            {/* The same text can replace what is open, as its next version. The version before stays. */}
            {opened && opened.record.kind === kind && (
              <Button
                disabled={busy !== null || text.trim() === ''}
                onClick={() => void act('update', { operation: 'artifact.update', artifactId: opened.record.artifactId, text, reason: 'Replaced with new text.' }, (r) => `"${r.title}" is now version ${r.version}; version ${r.version - 1} is kept.`)}
                title="Keeps the current version and makes this the next one"
                icon={<History size={13} />}
              >
                {' '}
                Replace “{opened.record.title}” with this
              </Button>
            )}
            <span className="create-hint">Orbis keeps it, reads the copy back, and shows what it checked.</span>
          </div>
          {failure && <Findings failure={failure} onAccept={() => void make(true)} />}
        </section>

        <section className="create-library" aria-label="What you have made">
          <h3>Made so far</h3>
          <SearchBox value={query} onChange={setQuery} label="Find an artifact" placeholder="Find by name, notes or what is in it" className="create-search" />
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
                  <input value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={120} autoFocus aria-label="New name" onKeyDown={(e) => {
                      if (e.key !== 'Escape') return
                      // Cancels the rename and nothing else; the shell must not close Create as well.
                      e.preventDefault()
                      e.stopPropagation()
                      setRenaming(null)
                    }} />
                  <Button type="submit" size="small">
                    Rename
                  </Button>
                </form>
              ) : (
                <h3>{opened.record.title}</h3>
              )}
              <span className="create-row-meta">
                version {opened.record.version} · kept as {opened.code ? `${opened.code.name} (${opened.code.extension})` : opened.record.format} · {sizeOf(opened.record.bytes)} · from {opened.record.source}
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
                    <Button kind="quiet" size="small" disabled={busy !== null} onClick={() => void act('restore', { operation: 'artifact.restore', artifactId: opened.record.artifactId, versionId: one.versionId }, (r) => `Version ${one.version} is current again, as version ${r.version}.`)}>
                      Restore
                    </Button>
                  </li>
                ))}
                {opened.record.reason && <li className="create-history-now"><span>Version {opened.record.version} (current) · {opened.record.reason}</span></li>}
              </ul>
            )}
            <Checks verified={opened.record.verified} />
            <Losses loss={opened.record.loss} />
            {(opened.record.kind === 'plot' || opened.record.kind === 'diagram') && !opened.truncated ? (
              <img className="create-drawing" alt={`${opened.record.title}, drawn`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(opened.preview)}`} />
            ) : opened.record.kind === 'image' && opened.preview !== '' ? (
              // The preview is already a data: URL, made in the main process. The bytes never cross whole.
              <img className="create-drawing" alt={opened.record.title} src={opened.preview} />
            ) : opened.record.kind === 'image' || opened.record.kind === 'audio' || opened.record.kind === 'video' ? (
              <p className="create-note">{mediaWords(opened.record.kind, opened.media)}</p>
            ) : opened.record.kind === 'project' && opened.project ? (
              <div className="create-project">
                <div className="create-save" aria-label="The files in this project">
                  {opened.project.files.map((one) => (
                    <Button
                      key={one.path}
                      size="small"
                      kind={(filePath || opened.project!.entry) === one.path ? 'primary' : 'normal'}
                      onClick={() => {
                        setFilePath(one.path)
                        setFileText('')
                        void open(opened.record.artifactId, 0, one.path)
                      }}
                      title={`${one.characters.toLocaleString()} characters${one.path === opened.project!.entry ? ' — the project starts here' : ''}`}
                    >
                      {one.path}
                      {one.path === opened.project!.entry ? ' ★' : ''}
                    </Button>
                  ))}
                </div>
                <textarea
                  className="create-text"
                  value={fileText === '' ? opened.project.shown : fileText}
                  onChange={(event) => setFileText(event.target.value)}
                  spellCheck={false}
                  aria-label={`${filePath || opened.project.entry}, its text`}
                  rows={14}
                />
                <div className="create-save">
                  <Button
                    size="small"
                    disabled={editingFile || fileText === '' || fileText === opened.project.shown}
                    onClick={() => void saveFile()}
                    title="Kept as a new version. The one before it stays."
                    icon={editingFile ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                  >
                    Save {filePath || opened.project.entry}
                  </Button>
                  {opened.project.runnable ? (
                    <Button
                      size="small"
                      disabled={running}
                      onClick={() => void runInSandbox()}
                      title="Shown in Orbis's sandbox: no network, no files, no Node. Nothing is run on this computer."
                      icon={running ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
                    >
                      Run in the sandbox
                    </Button>
                  ) : (
                    // A reason, not a greyed-out button: a button that cannot say why is worse than no button.
                    <span className="create-note">{opened.project.cannotRun}</span>
                  )}
                </div>
                {ran && (
                  <section className={ran.ok ? 'create-saved' : 'create-failure'} aria-label="What happened when it ran">
                    <p>{ran.message}</p>
                    {ran.notes.length > 0 && (
                      <ul>
                        {ran.notes.map((one, i) => (
                          <li key={i}>{one}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </div>
            ) : opened.record.kind === 'table' && opened.grid ? (
              <CreateGrid
                artifactId={opened.record.artifactId}
                versionId={opened.record.versionId}
                title={opened.record.title}
                columns={opened.columns}
                grid={opened.grid}
                pageSize={100}
                onPage={(from) => void open(opened.record.artifactId, from)}
                run={change}
              />
            ) : (
              <pre className="create-preview">
                {opened.preview}
                {opened.truncated ? '\n…' : ''}
              </pre>
            )}
            {opened.record.kind === 'document' && library.some((one) => one.kind === 'plot' || one.kind === 'diagram') && (
              <form
                className="create-ask"
                aria-label="Add a chart or diagram to this document"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (figureId === '') return
                  void act('place', { operation: 'artifact.place', artifactId: opened.record.artifactId, figureId, caption: figureCaption }, () => 'Added as a figure. Saved as PDF, Word, slides or HTML, the document carries the picture.').then(() => {
                    setFigureId('')
                    setFigureCaption('')
                  })
                }}
              >
                <select className="create-template" value={figureId} onChange={(event) => setFigureId(event.target.value)} aria-label="Chart or diagram to add">
                  <option value="">Add a chart or diagram as a figure…</option>
                  {library
                    .filter((one) => one.kind === 'plot' || one.kind === 'diagram')
                    .map((one) => (
                      <option key={one.artifactId} value={one.artifactId}>
                        {one.title} ({one.kind === 'plot' ? 'chart' : 'diagram'})
                      </option>
                    ))}
                </select>
                <input className="create-revise" value={figureCaption} onChange={(event) => setFigureCaption(event.target.value)} placeholder="Caption (optional)" aria-label="Caption" maxLength={200} />
                <Button
                  type="submit"
                  size="small"
                  disabled={busy !== null || figureId === ''}
                  title="The document points at the chart rather than copying it, so a chart redrawn later is the chart the document shows the next time it is saved."
                  icon={<LineChart size={13} />}
                >
                  Add figure
                </Button>
              </form>
            )}
            {opened.record.kind === 'document' && opened.tables.length > 0 && (
              <div className="create-save" aria-label="Tables in this document">
                <span>Take a table out</span>
                {opened.tables.map((one) => (
                  <Button
                    key={one.index}
                    size="small"
                    disabled={busy !== null}
                    title={`Kept as a table of its own, so it can be sorted, totalled and drawn. Headings: ${one.headings.join(', ')}`}
                    onClick={() => void act(`extract-${one.index}`, { operation: 'artifact.extractTable', artifactId: opened.record.artifactId, index: one.index }, (r) => `Took out "${r.title}" as a table of its own.`)}
                    icon={<Table2 size={13} />}
                  >
                    {one.caption || `Table ${one.index}`} ({one.rows} rows × {one.columns} columns)
                  </Button>
                ))}
              </div>
            )}
            {(opened.record.kind === 'document' || opened.record.kind === 'diagram' || opened.record.kind === 'code') && (
              <form
                className="create-ask"
                aria-label={`Revise this ${opened.record.kind === 'document' ? 'document' : opened.record.kind === 'code' ? 'file' : 'flowchart'}`}
                onSubmit={(event) => {
                  event.preventDefault()
                  void revise()
                }}
              >
                <input
                  className="create-revise"
                  value={revision}
                  onChange={(event) => setRevision(event.target.value)}
                  placeholder={opened.record.kind === 'document' ? 'Say what to change — e.g. make it shorter, add a section on risks' : opened.record.kind === 'code' ? 'Say what to change — e.g. skip hidden files, add a comment to each function' : 'Say what to change — e.g. add a step to check the email first'}
                  aria-label="What to change"
                  maxLength={2000}
                />
                <Button
                  type="submit"
                  size="small"
                  busy={revising}
                  busyLabel="Revising…"
                  disabled={revision.trim() === ''}
                  title="Orion rewrites it and Orbis keeps the result as a new version. The one before stays."
                  icon={revising ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                >
                  Revise with Orion
                </Button>
              </form>
            )}
            {opened.record.kind === 'table' && (
              <>
                <div className="create-save">
                  <Button
                    size="small"
                    disabled={analysing}
                    onClick={() => void analyse()}
                    title="Counts, statistics, quality and relationships, computed by Orbis and kept as a document"
                    icon={analysing ? <Loader2 size={13} className="spin" /> : <BarChart3 size={13} />}
                  >
                    Analyse this table
                  </Button>
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
                    <Button
                      type="submit"
                      size="small"
                      disabled={charting || chartY.length === 0}
                      title="A chart drawn by Orbis from these columns, kept as a drawing that remembers this table"
                      icon={charting ? <Loader2 size={13} className="spin" /> : <LineChart size={13} />}
                    >
                      Draw a chart
                    </Button>
                  </form>
                )}
              </>
            )}
            <div className="create-save">
              <span>Save as</span>
              {opened.formats.map((one) => (
                <Button
                  key={one.format}
                  size="small"
                  disabled={saving !== null}
                  onClick={() => void save(one.format)}
                  title={one.limitations.join(' ')}
                  icon={saving === one.format ? <Loader2 size={13} className="spin" /> : one.format === 'ics' ? <CalendarPlus size={13} /> : <Save size={13} />}
                >
                  {one.name} ({one.extension})
                </Button>
              ))}
              {/*
               * A workbook whose computed columns and totals stay live.
               *
               * Offered only for a table that really has a column Orbis computed, because for every other table it
               * would write the same numbers under a different name. Each formula is proved against the number Orbis
               * already worked out before it is written, and anything that cannot be written exactly is written as
               * numbers with the reason said in the notes.
               */}
              {opened.record.kind === 'table' && opened.columns.some((one) => one.type === 'number' || one.type === 'integer') && (
                <Button
                  size="small"
                  disabled={saving !== null}
                  onClick={() => void save('xlsx', false, { liveFormulas: true, totalsRow: true })}
                  title="The columns Orbis computed and a row of totals are written as real Excel formulas, with the numbers Orbis worked out already in the cells. Anything Excel would answer differently is written as numbers, and the notes say which."
                  icon={saving === 'xlsx' ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                >
                  Excel, with live formulas
                </Button>
              )}
            </div>
            {/*
             * A mail draft with this attached.
             *
             * Orbis has no mail account and sends nothing: it writes a file that opens as a draft in whatever mail
             * program this computer has. The sentence under it is the operation's own, not one written here.
             */}
            <div className="create-save" aria-label="Email it">
              <span>Email it</span>
              <input
                className="create-revise"
                value={emailTo}
                onChange={(event) => setEmailTo(event.target.value)}
                placeholder="To (optional) — you can also fill it in when the draft opens"
                aria-label="Who the draft is addressed to"
                maxLength={400}
              />
              <Button
                size="small"
                disabled={emailing || opened.formats.length === 0}
                onClick={() => void writeDraft(opened.formats[0]?.format ?? opened.record.format)}
                title="Writes a draft file with this attached into your Downloads folder, reads it back and checks it. Orbis does not send it."
                icon={emailing ? <Loader2 size={13} className="spin" /> : <Mail size={13} />}
              >
                Write a draft
              </Button>
            </div>
            {draft && (
              <section className="create-saved" aria-label="The draft">
                <p>
                  <Check size={13} /> The draft is at <code>{draft.path}</code>, read back and checked.
                </p>
                <Notes notes={draft.notes} />
              </section>
            )}
            {/*
             * A copy into a folder a cloud program keeps in step.
             *
             * Shown only when such a folder was found, so there is never a button that implies an account could be
             * added. A folder Orbis cannot write into is shown with the reason rather than left out silently.
             */}
            {cloud.length > 0 && (
              <div className="create-save" aria-label="Save a copy to a cloud folder">
                <span>Save a copy to</span>
                {cloud.map((one) => (
                  <Button
                    key={one.path}
                    size="small"
                    disabled={saving !== null || !one.writable}
                    onClick={() => void saveToCloud(one.path, opened.formats[0]?.format ?? opened.record.format)}
                    title={
                      one.writable
                        ? `${one.keptBy} uploads what appears in that folder. Orbis writes the file there, reads it back and checks it; it does not upload anything and has no account there.`
                        : `Orbis cannot write into ${one.name}. Check that the folder is not read-only and that ${one.keptBy} is running.`
                    }
                    icon={saving === `cloud:${one.path}` ? <Loader2 size={13} className="spin" /> : <Cloud size={13} />}
                  >
                    {one.name}
                  </Button>
                ))}
              </div>
            )}
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
    </Surface>
  )
}
