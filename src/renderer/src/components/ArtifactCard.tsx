import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, Check, Code2, Copy, Download, ExternalLink, FileText, FolderOpen, FolderTree, Image as ImageIcon, Loader2, Music, Pencil, Table2, Video, Workflow } from 'lucide-react'
import type { ChatArtifact } from '../../../shared/types'
import type { NoticeKind } from '../lib/notices'
import { copyText } from '../lib/utils'
import { restoreEscapedBreaks } from '../../../shared/artifacts/escapes'
import { ARTIFACT_CHANGED_EVENT, openArtifact, type ArtifactChangedDetail } from '../lib/artifactEvents'
import Markdown from './Markdown'
import './artifactCard.css'

/**
 * Something Orbis made, shown in the conversation it was made in.
 *
 * The message carries only a pointer: which artifact, which version, what was done. Everything on the card is read
 * from the library when the card is drawn, so it shows what is kept now and not what was true when the reply was
 * written. Three things follow from that:
 *
 *   - a card whose artifact has since been changed says which version it was and steps aside for the newer card;
 *   - a card whose artifact has been removed says so, calmly, instead of offering buttons that would fail;
 *   - "Download" writes a real file into the Downloads folder and says "saved" only after the main process has read
 *     the file back and checked it. The name it shows is the name the file really has.
 */

type RecordKind = 'table' | 'document' | 'plot' | 'diagram' | 'code' | 'project' | 'image' | 'audio' | 'video'

interface Read {
  record: {
    artifactId: string
    versionId: string
    version: number
    kind: RecordKind
    title: string
    bytes: number
    shape: { rows: number; columns: number }
    verified: { ok: boolean; checks: { what: string; passed: boolean; describe: string }[] }
  }
  preview: string
  truncated: boolean
  columns: { id: string; name: string; type: string }[]
  grid: { rows: string[][]; total: number } | null
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

interface Saved {
  path: string
  format: string
  bytes: number
  loss: { lossy: boolean; losses: { what: string; describe: string }[] }
}

interface Problem {
  error: string
  message: string
  format: string
}

type State = { is: 'reading' } | { is: 'gone' } | { is: 'unreadable'; message: string } | { is: 'here'; read: Read }

const ICONS: Record<RecordKind, typeof Table2> = {
  table: Table2,
  document: FileText,
  plot: BarChart3,
  diagram: Workflow,
  code: Code2,
  project: FolderTree,
  image: ImageIcon,
  audio: Music,
  video: Video
}
const NAMES: Record<RecordKind, string> = {
  table: 'Table',
  document: 'Document',
  plot: 'Chart',
  diagram: 'Flowchart',
  code: 'Code',
  project: 'Project',
  image: 'Picture',
  audio: 'Sound',
  video: 'Video'
}
const DONE: Record<ChatArtifact['action'], string> = { made: 'Made', changed: 'Changed', drew: 'Drawn', kept: 'Kept', shown: 'Ready' }

/** How many rows of a table, and how much of a document, a card shows. A look, not the whole thing. */
const CARD_ROWS = 8
const CARD_COLUMNS = 8
const CARD_TEXT = 3000
const CARD_CODE_LINES = 24

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString()} ${n === 1 ? one : many}`

const sizeOf = (bytes: number): string => (bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)

/** The file's own name, from wherever it was saved. */
const nameOf = (path: string): string => path.split(/[\\/]/).pop() || path

function shapeOf(read: Read): string {
  const { rows, columns } = read.record.shape
  switch (read.record.kind) {
    case 'table':
      return `${count(rows, 'row')} × ${count(columns, 'column')}`
    case 'document':
      return count(rows, 'heading and paragraph', 'headings and paragraphs')
    case 'plot':
      return `${count(rows, 'point')} in ${count(columns, 'series', 'series')}`
    case 'diagram':
      return `${count(rows, 'box', 'boxes')}, ${count(columns, 'arrow')}`
    case 'code':
      return `${count(rows, 'line')}${read.code ? ` of ${read.code.name}` : ''}`
    case 'project':
      return read.project ? read.project.listing : count(rows, 'file')
    case 'image':
    case 'video':
      return rows > 0 && columns > 0 ? `${columns.toLocaleString()} × ${rows.toLocaleString()}` : 'size not known'
    case 'audio':
      return rows > 0 ? count(rows, 'second') : 'length not known'
  }
}

const svgUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/**
 * Why there is no picture and no player on the card, in plain words.
 *
 * Said rather than left blank, and said as the reason rather than as "unsupported": a sound and a video are kept and
 * checked and not played, and a picture over half a megabyte would have to be decoded and re-encoded to be shrunk,
 * which is the one thing these three kinds are built not to do.
 */
function mediaWords(kind: 'image' | 'audio' | 'video', facts: Read['media']): string {
  if (kind === 'audio') return 'Orbis keeps this sound and checks it, and does not play it. Save it to listen to it.'
  if (kind === 'video') return 'Orbis keeps this video and checks it, and does not play it. Save it to watch it.'
  const size = facts ? `${(facts.bytes / (1024 * 1024)).toFixed(1)} MB` : 'large'
  return `This picture is ${size}, too large to show here without changing it. Save it, or open it in a picture program.`
}

/** A figure line in a kept document: a picture that is itself a kept chart or diagram. */
const FIGURE_LINE = /^!\[([^\]]*)\]\(artifact:(artifact_[0-9a-f]{32})\)\s*$/

type Piece = { is: 'words'; text: string } | { is: 'figure'; alt: string; artifactId: string }

/**
 * A picture in a kept document that is not one of Orbis's own figures, as the words it stands for.
 *
 * A document can come from a file or from a model, and either can write `![x](https://somewhere/p.png?who=...)`. Shown
 * as a picture, opening the conversation would ask that address for it -- telling whoever runs it that the document
 * was looked at, and when. So a card shows such a picture as its description and never goes anywhere to fetch it.
 */
const withoutRemotePictures = (markdown: string): string =>
  markdown.replace(/!\[([^\]]*)\]\((?!artifact:)[^)]*\)/g, (_all, alt: string) => `[picture${alt ? `: ${alt}` : ''}]`).replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_all, alt: string) => `[picture${alt ? `: ${alt}` : ''}]`)

/** A document's text cut at its figures, so each figure can be shown as the picture it points at. */
function piecesOf(markdown: string): Piece[] {
  const pieces: Piece[] = []
  let words: string[] = []
  const flush = (): void => {
    const text = withoutRemotePictures(words.join('\n')).trim()
    if (text !== '') pieces.push({ is: 'words', text })
    words = []
  }
  for (const line of markdown.split('\n')) {
    const figure = FIGURE_LINE.exec(line)
    if (figure) {
      flush()
      pieces.push({ is: 'figure', alt: figure[1], artifactId: figure[2] })
    } else {
      words.push(line)
    }
  }
  flush()
  return pieces
}

/** A chart or diagram a document shows as a figure, read from the library and drawn. */
function Figure({ artifactId, alt }: { artifactId: string; alt: string }): React.JSX.Element {
  const [svg, setSvg] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    const read = (): void => {
      void window.api.creationRun({ operation: 'artifact.read', artifactId }).then((result) => {
        if (!live) return
        const value = result.ok ? (result.value as Read) : null
        setSvg(value && !value.truncated && (value.record.kind === 'plot' || value.record.kind === 'diagram') ? value.preview : null)
      })
    }
    read()
    // The chart is redrawn ("make it a bar chart") and the document that shows it shows the new drawing.
    const onChanged = (event: Event): void => {
      const changed = (event as CustomEvent<ArtifactChangedDetail>).detail?.artifactId
      if (changed === undefined || changed === artifactId) read()
    }
    window.addEventListener(ARTIFACT_CHANGED_EVENT, onChanged)
    return () => {
      live = false
      window.removeEventListener(ARTIFACT_CHANGED_EVENT, onChanged)
    }
  }, [artifactId])
  if (svg === undefined) return <p className="artifact-card-note">Reading the figure…</p>
  if (svg === null) return <p className="artifact-card-note">Figure: {alt || 'a chart'} (the chart it points at is no longer kept)</p>
  return <img className="artifact-card-drawing" alt={alt || 'Figure'} src={svgUrl(svg)} />
}

function Preview({ read }: { read: Read }): React.JSX.Element {
  const { record } = read
  const pieces = useMemo(() => (record.kind === 'document' ? piecesOf(read.preview.slice(0, CARD_TEXT)) : []), [record.kind, read.preview])

  if (record.kind === 'plot' || record.kind === 'diagram') {
    if (read.truncated) return <p className="artifact-card-note">This drawing is too large to show here. Open it to see it.</p>
    return <img className="artifact-card-drawing" alt={`${record.title}, drawn`} src={svgUrl(read.preview)} />
  }

  /*
   * A picture, a sound or a video.
   *
   * The preview for a picture is already a `data:` URL made in the main process -- the same way a drawing arrives,
   * and the same way a picture made in the chat arrives -- so this is one `<img>` and no new channel. A large picture
   * has no preview, and a sound and a video never do: there is no way to hand a stored file's bytes to this window,
   * so the card says what the file is rather than showing a player that could not play anything.
   */
  if (record.kind === 'image' || record.kind === 'audio' || record.kind === 'video') {
    const facts = read.media
    const said = facts ? [...facts.notes].slice(0, 3) : []
    return (
      <div className="artifact-card-media">
        {record.kind === 'image' && read.preview !== '' ? (
          <img className="artifact-card-drawing" alt={record.title} src={read.preview} />
        ) : (
          <p className="artifact-card-note">{mediaWords(record.kind, facts)}</p>
        )}
        {said.length > 0 && (
          <ul className="artifact-card-did" aria-label="What Orbis read from the file">
            {said.map((one, i) => (
              <li key={i}>{one}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (record.kind === 'project' && read.project) {
    const project = read.project
    return (
      <div className="artifact-card-project" role="region" aria-label={`${record.title}, its files`} tabIndex={0}>
        <ul className="artifact-card-did" aria-label="The files in this project">
          {project.files.slice(0, 10).map((one) => (
            <li key={one.path}>
              <code>{one.path}</code>
              {one.path === project.entry ? ' — it starts here' : ''}
            </li>
          ))}
        </ul>
        {project.files.length > 10 && <p className="artifact-card-more">The first 10 of {project.files.length} files. Every one is in the archive.</p>}
        <p className="artifact-card-note">
          {project.languages.map((one) => `${one.name} (${one.files})`).join(', ')}. Orbis never runs any of it on your computer.
        </p>
      </div>
    )
  }

  if (record.kind === 'table' && read.grid) {
    const rows = read.grid.rows.slice(0, CARD_ROWS)
    const columns = read.columns.slice(0, CARD_COLUMNS)
    const hiddenColumns = read.columns.length - columns.length
    return (
      <div className="artifact-card-grid" role="region" aria-label={`${record.title}, as a table`} tabIndex={0}>
        <table>
          <thead>
            <tr>
              {columns.map((one) => (
                <th key={one.id} className={one.type === 'number' || one.type === 'quantity' ? 'num' : undefined}>
                  {one.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((one, at) => (
                  <td key={one.id} className={one.type === 'number' || one.type === 'quantity' ? 'num' : undefined}>
                    {row[at] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {read.grid.total === 0 && <p className="artifact-card-more">No rows yet: the columns are the whole table.</p>}
        {(read.grid.total > rows.length || hiddenColumns > 0) && (
          <p className="artifact-card-more">
            {read.grid.total > rows.length ? `The first ${rows.length} of ${read.grid.total.toLocaleString()} rows` : `All ${count(read.grid.total, 'row')}`}
            {hiddenColumns > 0 ? `, and the first ${columns.length} of ${read.columns.length} columns` : ''}. Every row and column is in the file.
          </p>
        )}
      </div>
    )
  }

  if (record.kind === 'document') {
    const cut = read.preview.length > CARD_TEXT || read.truncated
    return (
      <div className="artifact-card-document" role="region" aria-label={`${record.title}, the start of it`} tabIndex={0}>
        {pieces.map((one, i) => (one.is === 'figure' ? <Figure key={i} artifactId={one.artifactId} alt={one.alt} /> : <Markdown key={i} text={one.text} />))}
        {cut && <p className="artifact-card-more">This is the start. The whole document is in the file.</p>}
      </div>
    )
  }

  const lines = restoreEscapedBreaks(read.preview).text.split('\n')
  return (
    <div className="artifact-card-code" role="region" aria-label={`${record.title}, the start of it`} tabIndex={0}>
      <pre>{lines.slice(0, CARD_CODE_LINES).join('\n')}</pre>
      {(lines.length > CARD_CODE_LINES || read.truncated) && <p className="artifact-card-more">The first {CARD_CODE_LINES} lines. The whole file is saved exactly as written.</p>}
    </div>
  )
}

/** What a card holds, as text a person can paste: code and documents as written, a table as tab-separated rows. */
function copyableText(read: Read, kind: RecordKind): { text: string; partial: boolean } | null {
  if (kind === 'code') return { text: restoreEscapedBreaks(read.preview).text, partial: read.truncated }
  if (kind === 'document') return { text: read.preview, partial: read.truncated }
  if (kind === 'table' && read.grid) {
    const head = read.columns.map((c) => c.name).join('\t')
    const body = read.grid.rows.map((row) => row.map((cell) => String(cell ?? '')).join('\t')).join('\n')
    return { text: `${head}\n${body}`, partial: read.grid.total > read.grid.rows.length }
  }
  return null
}

/** A small copy button for the card's header: it copies what is inside the output, and says when that is only the start. */
function CopyButton({ read, kind, onNotify }: { read: Read; kind: RecordKind; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element | null {
  const [done, setDone] = useState(false)
  const what = copyableText(read, kind)
  if (!what || what.text.trim() === '') return null
  const copy = (): void => {
    void copyText(what.text).then(() => {
      setDone(true)
      setTimeout(() => setDone(false), 1500)
      onNotify(what.partial ? 'Copied the part shown here; the saved file has all of it.' : 'Copied.')
    })
  }
  return (
    <button type="button" className="artifact-card-copy" onClick={copy} title={done ? 'Copied' : 'Copy'} aria-label={`Copy ${NAMES[kind].toLowerCase()}`}>
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function ArtifactCard({ artifact, onNotify }: { artifact: ChatArtifact; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const { artifactId } = artifact.ref
  const [state, setState] = useState<State>({ is: 'reading' })
  const [format, setFormat] = useState('')
  const [busy, setBusy] = useState<'download' | 'choose' | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)

  const read = useCallback(async (): Promise<void> => {
    const result = await window.api.creationRun({ operation: 'artifact.read', artifactId })
    if (result.ok) setState({ is: 'here', read: result.value as Read })
    else setState(result.error === 'not-found' ? { is: 'gone' } : { is: 'unreadable', message: result.message })
  }, [artifactId])

  useEffect(() => {
    void read()
  }, [read])

  // Changed from somewhere else -- a later message, or the Create screen: read it again.
  useEffect(() => {
    const onChanged = (event: Event): void => {
      const changed = (event as CustomEvent<ArtifactChangedDetail>).detail?.artifactId
      if (changed === undefined || changed === artifactId) void read()
    }
    window.addEventListener(ARTIFACT_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(ARTIFACT_CHANGED_EVENT, onChanged)
  }, [artifactId, read])

  const Icon = ICONS[artifact.ref.kind] ?? FileText

  if (state.is !== 'here') {
    return (
      <section className="artifact-card quiet" aria-label={artifact.ref.title}>
        <header>
          <Icon size={15} className="artifact-card-icon" />
          <strong>{artifact.ref.title}</strong>
          <span className="artifact-card-meta">
            {state.is === 'reading' ? 'Opening…' : state.is === 'gone' ? 'Removed from Orbis. A file you already downloaded is still where it was saved.' : state.message}
          </span>
        </header>
      </section>
    )
  }

  const { record, formats } = state.read
  const newer = record.versionId !== artifact.ref.versionId
  // What "Download" writes when nobody has chosen: the format that was asked for, when this kind can be saved as it.
  const chosen = formats.find((one) => one.format === format) ?? formats.find((one) => one.format === artifact.format) ?? formats[0]

  const save = async (operation: 'artifact.download' | 'artifact.export', acceptSecrets = false): Promise<void> => {
    if (!chosen || busy) return
    setBusy(operation === 'artifact.download' ? 'download' : 'choose')
    setProblem(null)
    try {
      const result = await window.api.creationRun({ operation, artifactId, format: chosen.format, acceptSecrets })
      if (!result.ok) {
        // Closing the "save as" window is a decision, not a failure.
        if (result.error === 'cancelled') return
        if (result.error === 'not-found') {
          setState({ is: 'gone' })
          return
        }
        setProblem({ error: result.error, message: result.message, format: chosen.format })
        return
      }
      const outcome = result.value as Saved
      setSaved(outcome)
      onNotify(`Saved and checked: ${nameOf(outcome.path)}`, 'info')
    } finally {
      setBusy(null)
    }
  }

  const reveal = async (open: boolean): Promise<void> => {
    if (!saved) return
    const result = await window.api.creationRun({ operation: 'artifact.reveal', path: saved.path, open })
    if (!result.ok) onNotify(result.message, 'error')
  }

  if (newer) {
    return (
      <section className="artifact-card quiet" aria-label={record.title}>
        <header>
          <Icon size={15} className="artifact-card-icon" />
          <strong>{record.title}</strong>
          <span className="artifact-card-meta">
            This was version {artifact.ref.version}. It has been changed since and is now version {record.version}; every version is kept.
          </span>
          <button type="button" className="queue-btn small" onClick={() => openArtifact(artifactId)}>
            <ExternalLink size={13} />
            Open
          </button>
        </header>
      </section>
    )
  }

  const whatSaved = saved ? formats.find((one) => one.format === saved.format) : undefined

  return (
    <section className="artifact-card" aria-label={`${NAMES[record.kind]}: ${record.title}`}>
      <header>
        <Icon size={15} className="artifact-card-icon" />
        <strong>{record.title}</strong>
        <span className="artifact-card-meta">
          {DONE[artifact.action]} · {NAMES[record.kind]} · {shapeOf(state.read)}
          {record.version > 1 ? ` · version ${record.version}` : ''}
        </span>
        {record.verified.ok && (
          <span className="artifact-card-checked" title={record.verified.checks.map((one) => one.describe).join(' ')}>
            <Check size={12} />
            Checked
          </span>
        )}
        <CopyButton read={state.read} kind={record.kind} onNotify={onNotify} />
      </header>

      {artifact.action !== 'shown' && <Preview read={state.read} />}

      {artifact.did.length > 0 && (
        <ul className="artifact-card-did" aria-label="What was done">
          {artifact.did.map((one, i) => (
            <li key={i}>{one}</li>
          ))}
        </ul>
      )}

      <div className="artifact-card-actions">
        <button type="button" className="queue-btn small" onClick={() => openArtifact(artifactId)} title="See all of it on the Create screen, with its versions and its checks">
          <ExternalLink size={13} />
          Open
        </button>
        {chosen && (
          <>
            <button type="button" className="queue-btn small primary" disabled={busy !== null} onClick={() => void save('artifact.download')} title="Writes the file into your Downloads folder and checks it">
              {busy === 'download' ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
              {busy === 'download' ? 'Saving…' : `Download ${chosen.name}`}
            </button>
            {formats.length > 1 && (
              <select className="artifact-card-format" value={chosen.format} onChange={(event) => setFormat(event.target.value)} aria-label="File type" disabled={busy !== null}>
                {formats.map((one) => (
                  <option key={one.format} value={one.format}>
                    {one.name} ({one.extension})
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="queue-btn small" disabled={busy !== null} onClick={() => void save('artifact.export')} title="Choose the folder and the name yourself">
              {busy === 'choose' ? <Loader2 size={13} className="spin" /> : <FolderOpen size={13} />}
              Save as…
            </button>
          </>
        )}
        <button
          type="button"
          className="queue-btn small"
          title="Say what to change, in the message box"
          onClick={() => window.dispatchEvent(new CustomEvent('orbis:compose', { detail: `Change "${record.title}": ` }))}
        >
          <Pencil size={13} />
          Edit
        </button>
      </div>

      {chosen && chosen.limitations.length > 0 && !saved && (
        <p className="artifact-card-note">
          As {chosen.name}: {chosen.limitations.join(' ')}
        </p>
      )}

      {saved && (
        <div className="artifact-card-saved" role="status">
          <p>
            <Check size={13} />
            Saved as <code>{nameOf(saved.path)}</code> ({sizeOf(saved.bytes)}), read back and checked.
          </p>
          <span className="artifact-card-where" title={saved.path}>
            {saved.path}
          </span>
          <div className="artifact-card-actions">
            {/*
              * A source file and an archive of them are shown in their folder and no more.
              *
              * The question is about the file that was saved, not about the artifact, and it is the service that
              * decides: this only leaves off a button whose answer would be a refusal.
              */}
            {saved.format !== 'code' && saved.format !== 'zip' && (
              <button type="button" className="queue-btn small" onClick={() => void reveal(true)}>
                <ExternalLink size={13} />
                Open the file
              </button>
            )}
            <button type="button" className="queue-btn small" onClick={() => void reveal(false)}>
              <FolderOpen size={13} />
              Show in folder
            </button>
          </div>
          {saved.loss.lossy && (
            <ul className="artifact-card-did" aria-label={`What ${whatSaved?.name ?? 'this file type'} could not carry`}>
              {saved.loss.losses.slice(0, 4).map((one, i) => (
                <li key={i}>{one.describe}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {problem && (
        <div className="artifact-card-problem" role="alert">
          <p>
            <AlertTriangle size={13} />
            {problem.message}
          </p>
          {problem.error === 'secrets' && (
            <button type="button" className="queue-btn small danger" disabled={busy !== null} onClick={() => void save('artifact.download', true)}>
              Download anyway
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export default memo(
  ArtifactCard,
  (a, b) =>
    a.artifact.ref.artifactId === b.artifact.ref.artifactId &&
    a.artifact.ref.versionId === b.artifact.ref.versionId &&
    a.artifact.action === b.artifact.action &&
    a.artifact.format === b.artifact.format &&
    a.artifact.did.length === b.artifact.did.length
)
