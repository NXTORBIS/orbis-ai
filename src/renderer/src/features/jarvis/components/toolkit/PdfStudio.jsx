import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, FileText, Loader2, RotateCw, Scissors, Trash2, X } from 'lucide-react';
import { base44 } from '@jarvis/api/base44Client';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat, downloadBlob, fmtBytes, readFileAsDataURL } from './shared';

const MODES = [
  { value: 'merge', label: 'Merge' },
  { value: 'extract', label: 'Extract pages' },
  { value: 'rotate', label: 'Rotate' },
];

const ANGLES = [
  { value: 90, label: '90° right' },
  { value: 180, label: '180°' },
  { value: 270, label: '90° left' },
];

const base64ToBlob = (pdfBase64) => {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
};

export default function PdfStudio() {
  const [mode, setMode] = useState('merge');
  const [files, setFiles] = useState([]);
  const [index, setIndex] = useState(0);
  const [range, setRange] = useState('');
  const [angle, setAngle] = useState(90);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const pending = useRef(0);

  const addFiles = async (fileList) => {
    const list = Array.from(fileList || []).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')).slice(0, 12);
    if (!list.length) { setError('Choose PDF files — other file types cannot be merged here.'); return; }
    const loaded = await Promise.all(list.map(async (file) => ({
      name: file.name,
      size: file.size,
      dataUrl: await readFileAsDataURL(file),
      pages: null,
      error: '',
    })));
    const next = [...files, ...loaded].slice(0, 12);
    setFiles(next);
    setResult(null);
    setError('');
    const token = Date.now();
    pending.current = token;
    setBusy('Reading page counts…');
    try {
      const response = await base44.functions.invoke('pdfTools', { operation: 'info', files: next });
      if (pending.current !== token) return;
      const details = response?.data?.files ?? [];
      setFiles((current) => current.map((entry, i) => ({
        ...entry,
        pages: details[i]?.pages || 0,
        error: details[i]?.error || '',
      })));
    } catch {
      setError('The page counts could not be read, but you can still try the job.');
    } finally {
      if (pending.current === token) setBusy('');
    }
  };

  const move = (from, delta) => {
    const to = from + delta;
    if (to < 0 || to >= files.length) return;
    const next = [...files];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setFiles(next);
    setIndex(0);
  };

  const run = async () => {
    if (!files.length) { setError('Add at least one PDF first.'); return; }
    setError('');
    setStatus('');
    setResult(null);
    setBusy(mode === 'merge' ? 'Merging…' : mode === 'extract' ? 'Extracting…' : 'Rotating…');
    try {
      const payload = { operation: mode, files, index, pages: range.trim(), angle };
      const response = await base44.functions.invoke('pdfTools', payload);
      const data = response?.data ?? {};
      if (data.error) { setError(data.error); return; }
      if (!data.pdfBase64) { setError('The server did not return a document.'); return; }
      const blob = base64ToBlob(data.pdfBase64);
      setResult({ name: data.fileName || 'result.pdf', blob, bytes: data.bytes ?? blob.size, pages: data.pages ?? 0, note: data.note || '' });
      setStatus(`${data.fileName || 'result.pdf'} is ready — ${data.pages} pages, ${fmtBytes(data.bytes ?? blob.size)}.`);
      downloadBlob(blob, data.fileName || 'result.pdf');
    } catch (e) {
      setError(e?.response?.data?.error || 'The PDF job failed. Try again with fewer or smaller files.');
    } finally {
      setBusy('');
    }
  };

  const totalPages = files.reduce((sum, file) => sum + (file.pages || 0), 0);
  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const activeFile = files[index] ?? files[0];

  const report = files.length
    ? `${mode} · ${files.length} file(s) · ${totalPages} pages · ${fmtBytes(totalSize)}`
    : 'No PDFs loaded';

  return (
    <ToolShell
      toolId="pdf-studio"
      icon={FileText}
      title="PDF Studio"
      desc="Merge PDFs in the order you choose, pull out a page range, or turn pages around — all handled on the server, then straight back to you."
      state={{ mode, range, angle }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (restored.range !== undefined) setRange(restored.range);
        if (restored.angle) setAngle(restored.angle);
      }}
      exportText={report}
      exportName="pdf-job.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Add PDFs
          <input type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </label>
        {!!files.length && (
          <button
            type="button"
            onClick={() => { setFiles([]); setResult(null); setStatus(''); setError(''); }}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear all
          </button>
        )}
        {busy && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-cyan-j">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}
          </span>
        )}
      </div>

      <Field label="What to do">
        <Seg value={mode} onChange={(v) => { setMode(v); setResult(null); setStatus(''); }} options={MODES} />
      </Field>

      {!!files.length && (
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">{files.length} file{files.length === 1 ? '' : 's'} loaded</span>
            {mode !== 'merge' && <span className="text-[11px] text-muted-foreground">pick the file to work on</span>}
          </div>
          <div className="space-y-1.5">
            {files.map((file, i) => {
              const selected = mode !== 'merge' && (files[index] ?? files[0]) === file;
              return (
                <div
                  key={`${file.name}-${i}`}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${selected ? 'border-cyan-j/50 bg-cyan-j/5' : 'border-border/60'}`}
                >
                  {mode !== 'merge' && (
                    <button
                      type="button"
                      onClick={() => setIndex(i)}
                      title="Use this file"
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${selected ? 'border-cyan-j bg-cyan-j/20 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
                    >
                      {selected ? '●' : ''}
                    </button>
                  )}
                  <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-j" />
                  <span className="min-w-0 flex-1 truncate text-[11px]" title={file.name}>{file.name}</span>
                  {file.error
                    ? <span className="shrink-0 text-[10px] text-amber-500">unreadable</span>
                    : <span className="shrink-0 font-mono-j text-[10px] text-muted-foreground">{file.pages != null ? `${file.pages}p` : '…'} · {fmtBytes(file.size)}</span>}
                  {mode === 'merge' && (
                    <>
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground transition hover:text-cyan-j disabled:opacity-30">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === files.length - 1} className="text-muted-foreground transition hover:text-cyan-j disabled:opacity-30">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => { setFiles(files.filter((_, j) => j !== i)); setIndex(0); }}
                    className="text-muted-foreground transition hover:text-red-500"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {mode === 'merge' && (
        <Panel>
          <p className="text-[11px] text-muted-foreground">
            Files join top to bottom in the order shown — use the arrows to shuffle them. Bookmarks, forms and annotations from the originals are
            carried over page by page, and the merged file keeps a clean, readable structure.
          </p>
        </Panel>
      )}

      {mode === 'extract' && (
        <Field label="Pages to keep" hint="Examples: 1-3, 5, 8- ; leave it empty to keep the whole document">
          <input
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder={activeFile?.pages ? `1-${activeFile.pages}` : '1-3, 5'}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm"
          />
        </Field>
      )}

      {mode === 'rotate' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Turn by">
            <Seg value={angle} onChange={setAngle} options={ANGLES} />
          </Field>
          <Field label="Which pages" hint="Empty turns every page">
            <input
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="all pages"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm"
            />
          </Field>
        </div>
      )}

      {!!files.length && activeFile && mode !== 'merge' && (
        <p className="text-[11px] text-muted-foreground">
          Working on <span className="font-mono-j">{activeFile.name}</span>
          {activeFile.pages ? ` · ${activeFile.pages} pages` : ''}
        </p>
      )}

      <button
        type="button"
        onClick={run}
        disabled={!files.length || !!busy}
        className="inline-flex items-center gap-2 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-2 text-xs font-medium text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'merge' ? <FileText className="h-4 w-4" /> : mode === 'extract' ? <Scissors className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
        {mode === 'merge' ? 'Merge files' : mode === 'extract' ? 'Extract pages' : 'Rotate pages'}
      </button>

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      {status && (
        <Panel className="border-cyan-j/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-cyan-j">{status}</div>
              {result?.note && <div className="text-[11px] text-muted-foreground">{result.note}</div>}
            </div>
            {result && (
              <button
                type="button"
                onClick={() => downloadBlob(result.blob, result.name)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-[11px] text-cyan-j transition hover:bg-cyan-j/20"
              >
                <Download className="h-3.5 w-3.5" /> Download again
              </button>
            )}
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Files" value={String(files.length)} />
        <Stat label="Total pages" value={totalPages ? String(totalPages) : '—'} mono />
        <Stat label="Total size" value={totalSize ? fmtBytes(totalSize) : '—'} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Your files are sent to the app's own backend, stitched there, and handed straight back as a download — nothing is stored and nothing is
          kept after the job. Jobs are capped at 12 files and about 20 MB in total, which is comfortable for contracts, statements, tickets and
          scans; batch anything larger.
        </p>
      </Panel>
    </ToolShell>
  );
}