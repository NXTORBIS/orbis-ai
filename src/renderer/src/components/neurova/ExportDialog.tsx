import { useState } from 'react'
import { Modal } from '../../ui'

export interface AudioProps {
  format: string
  durationSec: number
  sampleRate: number
  channels: number
  bitDepth: number
  bytes: number
}

export interface ExportProgress {
  state: 'idle' | 'working' | 'done' | 'failed'
  /** Real fraction 0..1, only when the caller truly knows it. */
  fraction?: number
  message?: string
  /** Where the file went, once done. */
  path?: string
}

export interface ExportOptions {
  format: string
  fileName: string
  overwrite: 'ask' | 'replace' | 'number'
  includeTitle: boolean
  includePrompt: boolean
  includePaths: boolean
}

export interface ExportDialogProps {
  formats: string[]
  source: AudioProps
  /** What the chosen format would produce, if known. */
  output: AudioProps | null
  defaultName: string
  safeName: (name: string, format: string) => string
  progress: ExportProgress
  onExport: (o: ExportOptions) => void
  onClose: () => void
}

const details = (a: AudioProps | null): React.JSX.Element =>
  a === null ? (
    <p className="nv-x-note">not known</p>
  ) : (
    <dl className="nv-x-dl">
      <dt>Format</dt><dd>{a.format}</dd>
      <dt>Length</dt><dd>{a.durationSec.toFixed(1)} s</dd>
      <dt>Sample rate</dt><dd>{a.sampleRate} Hz</dd>
      <dt>Channels</dt><dd>{a.channels}</dd>
      <dt>Bit depth</dt><dd>{a.bitDepth}</dd>
      <dt>Size</dt><dd>{(a.bytes / 1048576).toFixed(2)} MB</dd>
    </dl>
  )

export function ExportDialog(p: ExportDialogProps): React.JSX.Element {
  const [format, setFormat] = useState(p.formats[0] ?? '')
  const [name, setName] = useState(p.defaultName)
  const [overwrite, setOverwrite] = useState<ExportOptions['overwrite']>('ask')
  const [includeTitle, setTitle] = useState(true)
  const [includePrompt, setPrompt] = useState(false)
  const [includePaths, setPaths] = useState(false)
  const working = p.progress.state === 'working'
  return (
    <Modal label="Export" title="Export" onClose={p.onClose} canClose={!working}>
      <div className="nv-export">
        <label className="nv-x-field"><span>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={p.formats.length <= 1 || working}>
            {p.formats.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <div className="nv-x-cols">
          <div><h4>Source</h4>{details(p.source)}</div>
          <div><h4>Output</h4>{details(p.output)}</div>
        </div>
        <label className="nv-x-field"><span>File name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={working} />
        </label>
        <p className="nv-x-note">Will be saved as: <code>{p.safeName(name, format)}</code></p>
        <label className="nv-x-field"><span>If the file exists</span>
          <select value={overwrite} onChange={(e) => setOverwrite(e.target.value as ExportOptions['overwrite'])} disabled={working}>
            <option value="ask">Ask me</option>
            <option value="number">Keep both (add a number)</option>
            <option value="replace">Replace it</option>
          </select>
        </label>
        <fieldset className="nv-x-fieldset" disabled={working}>
          <legend>Metadata to include</legend>
          <label className="nv-x-check"><input type="checkbox" checked={includeTitle} onChange={(e) => setTitle(e.target.checked)} /><span>Title</span></label>
          <label className="nv-x-check"><input type="checkbox" checked={includePrompt} onChange={(e) => setPrompt(e.target.checked)} /><span>Prompt text</span></label>
          <label className="nv-x-check"><input type="checkbox" checked={includePaths} onChange={(e) => setPaths(e.target.checked)} /><span>File paths</span></label>
        </fieldset>
        <div aria-live="polite" className="nv-x-findings">
          {p.progress.state === 'working' ? <p>Exporting{p.progress.fraction !== undefined ? ` ${Math.round(p.progress.fraction * 100)}%` : ''}…</p> : null}
          {p.progress.state === 'done' ? <p>Done.{p.progress.path ? ` Saved to ${p.progress.path}` : ''}</p> : null}
          {p.progress.state === 'failed' ? <p role="alert">Export failed. {p.progress.message ?? ''}</p> : null}
        </div>
        <div className="nv-x-actions">
          <button type="button" className="queue-btn" disabled={working || !format || !name.trim()}
            onClick={() => p.onExport({ format, fileName: p.safeName(name, format), overwrite, includeTitle, includePrompt, includePaths })}>
            {working ? 'Exporting…' : 'Export'}
          </button>
          <button type="button" className="queue-btn ghost" onClick={p.onClose} disabled={working}>Close</button>
        </div>
      </div>
    </Modal>
  )
}
