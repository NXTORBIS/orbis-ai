import { useCallback, useState } from 'react';
import { call } from '../../api';
import { toast, toastError } from '../../state/app';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/components';
import { formatBytes } from '../../ui/format';
import type { PdfFileInfo } from '../../../shared/pdfTools';

type Tab = 'merge' | 'split' | 'rotate' | 'extract' | 'info';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'merge', label: 'Merge', icon: 'merge' },
  { id: 'split', label: 'Split', icon: 'split' },
  { id: 'rotate', label: 'Rotate', icon: 'rotate' },
  { id: 'extract', label: 'Extract', icon: 'extract' },
  { id: 'info', label: 'Info', icon: 'info' },
];

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function PdfToolsView() {
  const [tab, setTab] = useState<Tab>('merge');

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>PDF Tools</h1>
      </header>
      <nav className="pdf-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`pdf-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="pdf-content">
        {tab === 'merge' && <MergePanel />}
        {tab === 'split' && <SplitPanel />}
        {tab === 'rotate' && <RotatePanel />}
        {tab === 'extract' && <ExtractPanel />}
        {tab === 'info' && <InfoPanel />}
      </div>
    </div>
  );
}

// ── Helpers ──

function usePickDir() {
  return useCallback(async (): Promise<string | null> => {
    return call<string | null>('fs:pickDirectory', { title: 'Choose output folder' });
  }, []);
}

// ── Merge Panel ──

function MergePanel() {
  const [files, setFiles] = useState<string[]>([]);
  const [output, setOutput] = useState('merged');
  const [destDir, setDestDir] = useState('');
  const [busy, setBusy] = useState(false);
  const pickDir = usePickDir();

  const addFile = useCallback(async () => {
    const p = await call<string | null>('fs:pickFile', { title: 'Add PDF to merge' });
    if (p) setFiles((f) => [...f, p]);
  }, []);

  const removeFile = useCallback((i: number) => {
    setFiles((f) => f.filter((_, j) => j !== i));
  }, []);

  const moveFile = useCallback((i: number, dir: -1 | 1) => {
    setFiles((f) => {
      const next = [...f];
      const ni = i + dir;
      if (ni < 0 || ni >= next.length) return f;
      [next[i]!, next[ni]!] = [next[ni]!, next[i]!];
      return next;
    });
  }, []);

  const merge = useCallback(async () => {
    if (files.length < 2 || !destDir) return;
    setBusy(true);
    try {
      await call('ops:start', {
        type: 'pdf-tools',
        sources: files,
        destination: destDir,
        params: { job: { action: 'merge', output: output || 'merged' } },
      });
      toast({ level: 'success', title: 'PDF merge started' });
    } catch (err) {
      toastError(err, 'Merge failed');
    } finally {
      setBusy(false);
    }
  }, [files, destDir, output]);

  return (
    <div className="pdf-panel">
      <p className="pdf-help">Combine multiple PDFs into one document. Drag to reorder.</p>
      <div className="pdf-file-list">
        {files.map((f, i) => (
          <div key={`${f}-${i}`} className="pdf-file-row">
            <span className="pdf-file-num">{i + 1}</span>
            <Icon name="file" size={14} />
            <span className="pdf-file-name" title={f}>{baseName(f)}</span>
            <span className="spacer" />
            <button type="button" className="btn-icon-sm" title="Move up" disabled={i === 0} onClick={() => moveFile(i, -1)}><Icon name="arrowUp" size={14} /></button>
            <button type="button" className="btn-icon-sm" title="Move down" disabled={i === files.length - 1} onClick={() => moveFile(i, 1)}><Icon name="arrowDown" size={14} /></button>
            <button type="button" className="btn-icon-sm" title="Remove" onClick={() => removeFile(i)}><Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="default" onClick={addFile}><Icon name="plus" size={14} /> Add PDF</Button>
      <div className="pdf-field">
        <label>Output name</label>
        <input type="text" className="input" value={output} onChange={(e) => setOutput(e.target.value)} placeholder="merged" />
      </div>
      <div className="pdf-field">
        <label>Output folder</label>
        <div className="pdf-path-row">
          <input type="text" className="input" value={destDir} readOnly placeholder="Choose a folder..." />
          <Button size="sm" variant="default" onClick={async () => { const d = await pickDir(); if (d) setDestDir(d); }}>Browse</Button>
        </div>
      </div>
      <Button variant="primary" disabled={files.length < 2 || !destDir || busy} onClick={merge}>
        {busy ? 'Merging...' : `Merge ${files.length} PDFs`}
      </Button>
    </div>
  );
}

// ── Split Panel ──

function SplitPanel() {
  const [file, setFile] = useState('');
  const [ranges, setRanges] = useState('');
  const [destDir, setDestDir] = useState('');
  const [mode, setMode] = useState<'ranges' | 'every'>('ranges');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<PdfFileInfo | null>(null);
  const pickDir = usePickDir();

  const pickFile = useCallback(async () => {
    const p = await call<string | null>('fs:pickFile', { title: 'Choose a PDF to split' });
    if (p) {
      setFile(p);
      try {
        const i = await call<PdfFileInfo>('pdf:info', { path: p });
        setInfo(i);
      } catch { setInfo(null); }
    }
  }, []);

  const split = useCallback(async () => {
    if (!file || !destDir) return;
    setBusy(true);
    try {
      const base = baseName(file).replace(/\.pdf$/i, '');
      await call('ops:start', {
        type: 'pdf-tools',
        sources: [file],
        destination: destDir,
        params: { job: { action: 'split', mode, ranges: mode === 'ranges' ? ranges : undefined, baseName: base } },
      });
      toast({ level: 'success', title: 'PDF split started' });
    } catch (err) {
      toastError(err, 'Split failed');
    } finally {
      setBusy(false);
    }
  }, [file, destDir, mode, ranges]);

  return (
    <div className="pdf-panel">
      <p className="pdf-help">Split a PDF into separate files by page ranges or every page.</p>
      <div className="pdf-field">
        <label>PDF file</label>
        <div className="pdf-path-row">
          <input type="text" className="input" value={file ? baseName(file) : ''} readOnly placeholder="Choose a PDF..." />
          <Button size="sm" variant="default" onClick={pickFile}>Browse</Button>
        </div>
        {info && <span className="pdf-page-count">{info.pageCount} pages</span>}
      </div>
      <div className="pdf-field">
        <label>Split mode</label>
        <div className="pdf-radio-group">
          <label><input type="radio" checked={mode === 'ranges'} onChange={() => setMode('ranges')} /> By ranges</label>
          <label><input type="radio" checked={mode === 'every'} onChange={() => setMode('every')} /> Every page</label>
        </div>
      </div>
      {mode === 'ranges' && (
        <div className="pdf-field">
          <label>Page ranges (e.g. 1-3, 5, 7-10)</label>
          <input type="text" className="input" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="1-3, 5, 7-10" />
        </div>
      )}
      <div className="pdf-field">
        <label>Output folder</label>
        <div className="pdf-path-row">
          <input type="text" className="input" value={destDir} readOnly placeholder="Choose a folder..." />
          <Button size="sm" variant="default" onClick={async () => { const d = await pickDir(); if (d) setDestDir(d); }}>Browse</Button>
        </div>
      </div>
      <Button variant="primary" disabled={!file || !destDir || (mode === 'ranges' && !ranges.trim()) || busy} onClick={split}>
        {busy ? 'Splitting...' : 'Split PDF'}
      </Button>
    </div>
  );
}

// ── Rotate Panel ──

function RotatePanel() {
  const [file, setFile] = useState('');
  const [info, setInfo] = useState<PdfFileInfo | null>(null);
  const [degrees, setDegrees] = useState<90 | 180 | 270>(90);
  const [pageMode, setPageMode] = useState<'all' | 'select'>('all');
  const [selectedPages, setSelectedPages] = useState('');
  const [destDir, setDestDir] = useState('');
  const [busy, setBusy] = useState(false);
  const pickDir = usePickDir();

  const pickFile = useCallback(async () => {
    const p = await call<string | null>('fs:pickFile', { title: 'Choose a PDF to rotate' });
    if (p) {
      setFile(p);
      try {
        const i = await call<PdfFileInfo>('pdf:info', { path: p });
        setInfo(i);
      } catch { setInfo(null); }
    }
  }, []);

  const rotate = useCallback(async () => {
    if (!file || !destDir) return;
    setBusy(true);
    try {
      // Build a page plan: each page with its rotation
      const count = info?.pageCount ?? 0;
      let pageIndexes: number[];
      if (pageMode === 'all') {
        pageIndexes = Array.from({ length: count }, (_, i) => i);
      } else {
        pageIndexes = parsePageList(selectedPages, count);
      }
      // Build plan: all pages, with rotation applied to selected ones
      const selectedSet = new Set(pageIndexes);
      const plan = Array.from({ length: count }, (_, i) => ({
        page: i,
        rotate: selectedSet.has(i) ? degrees : 0,
      }));
      const base = baseName(file).replace(/\.pdf$/i, '');
      await call('ops:start', {
        type: 'pdf-tools',
        sources: [file],
        destination: destDir,
        params: { job: { action: 'pages', output: `${base} (rotated)`, plan } },
      });
      toast({ level: 'success', title: 'PDF rotation started' });
    } catch (err) {
      toastError(err, 'Rotate failed');
    } finally {
      setBusy(false);
    }
  }, [file, destDir, degrees, pageMode, selectedPages, info]);

  return (
    <div className="pdf-panel">
      <p className="pdf-help">Rotate pages in a PDF. Creates a new file; the original is not changed.</p>
      <div className="pdf-field">
        <label>PDF file</label>
        <div className="pdf-path-row">
          <input type="text" className="input" value={file ? baseName(file) : ''} readOnly placeholder="Choose a PDF..." />
          <Button size="sm" variant="default" onClick={pickFile}>Browse</Button>
        </div>
        {info && <span className="pdf-page-count">{info.pageCount} pages</span>}
      </div>
      <div className="pdf-field">
        <label>Rotation</label>
        <div className="pdf-radio-group">
          <label><input type="radio" checked={degrees === 90} onChange={() => setDegrees(90)} /> 90° clockwise</label>
          <label><input type="radio" checked={degrees === 180} onChange={() => setDegrees(180)} /> 180°</label>
          <label><input type="radio" checked={degrees === 270} onChange={() => setDegrees(270)} /> 90° counter-clockwise</label>
        </div>
      </div>
      <div className="pdf-field">
        <label>Pages</label>
        <div className="pdf-radio-group">
          <label><input type="radio" checked={pageMode === 'all'} onChange={() => setPageMode('all')} /> All pages</label>
          <label><input type="radio" checked={pageMode === 'select'} onChange={() => setPageMode('select')} /> Specific pages</label>
        </div>
        {pageMode === 'select' && (
          <input type="text" className="input" value={selectedPages} onChange={(e) => setSelectedPages(e.target.value)} placeholder="1, 3-5, 8" />
        )}
      </div>
      <div className="pdf-field">
        <label>Output folder</label>
        <div className="pdf-path-row">
          <input type="text" className="input" value={destDir} readOnly placeholder="Choose a folder..." />
          <Button size="sm" variant="default" onClick={async () => { const d = await pickDir(); if (d) setDestDir(d); }}>Browse</Button>
        </div>
      </div>
      <Button variant="primary" disabled={!file || !destDir || (pageMode === 'select' && !selectedPages.trim()) || busy} onClick={rotate}>
        {busy ? 'Rotating...' : 'Rotate pages'}
      </Button>
    </div>
  );
}

// ── Extract Panel ──

function ExtractPanel() {
  const [file, setFile] = useState('');
  const [info, setInfo] = useState<PdfFileInfo | null>(null);
  const [pages, setPages] = useState('');
  const [output, setOutput] = useState('extracted');
  const [destDir, setDestDir] = useState('');
  const [busy, setBusy] = useState(false);
  const pickDir = usePickDir();

  const pickFile = useCallback(async () => {
    const p = await call<string | null>('fs:pickFile', { title: 'Choose a PDF' });
    if (p) {
      setFile(p);
      try {
        const i = await call<PdfFileInfo>('pdf:info', { path: p });
        setInfo(i);
      } catch { setInfo(null); }
    }
  }, []);

  const extract = useCallback(async () => {
    if (!file || !destDir || !pages.trim()) return;
    setBusy(true);
    try {
      await call('ops:start', {
        type: 'pdf-tools',
        sources: [file],
        destination: destDir,
        params: { job: { action: 'extract', output: output || 'extracted', ranges: pages } },
      });
      toast({ level: 'success', title: 'PDF extraction started' });
    } catch (err) {
      toastError(err, 'Extract failed');
    } finally {
      setBusy(false);
    }
  }, [file, destDir, pages, output]);

  return (
    <div className="pdf-panel">
      <p className="pdf-help">Extract specific pages from a PDF into a new document.</p>
      <div className="pdf-field">
        <label>PDF file</label>
        <div className="pdf-path-row">
          <input type="text" className="input" value={file ? baseName(file) : ''} readOnly placeholder="Choose a PDF..." />
          <Button size="sm" variant="default" onClick={pickFile}>Browse</Button>
        </div>
        {info && <span className="pdf-page-count">{info.pageCount} pages</span>}
      </div>
      <div className="pdf-field">
        <label>Pages to extract (e.g. 1-3, 5, 7-10)</label>
        <input type="text" className="input" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="1-3, 5, 7-10" />
      </div>
      <div className="pdf-field">
        <label>Output name</label>
        <input type="text" className="input" value={output} onChange={(e) => setOutput(e.target.value)} placeholder="extracted" />
      </div>
      <div className="pdf-field">
        <label>Output folder</label>
        <div className="pdf-path-row">
          <input type="text" className="input" value={destDir} readOnly placeholder="Choose a folder..." />
          <Button size="sm" variant="default" onClick={async () => { const d = await pickDir(); if (d) setDestDir(d); }}>Browse</Button>
        </div>
      </div>
      <Button variant="primary" disabled={!file || !destDir || !pages.trim() || busy} onClick={extract}>
        {busy ? 'Extracting...' : 'Extract pages'}
      </Button>
    </div>
  );
}

// ── Info Panel ──

function InfoPanel() {
  const [file, setFile] = useState('');
  const [info, setInfo] = useState<PdfFileInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const pickFile = useCallback(async () => {
    const p = await call<string | null>('fs:pickFile', { title: 'Choose a PDF' });
    if (p) {
      setFile(p);
      setLoading(true);
      try {
        const i = await call<PdfFileInfo>('pdf:info', { path: p });
        setInfo(i);
      } catch { setInfo(null); }
      setLoading(false);
    }
  }, []);

  return (
    <div className="pdf-panel">
      <p className="pdf-help">View information about a PDF file: page count, dimensions and metadata.</p>
      <div className="pdf-field">
        <label>PDF file</label>
        <div className="pdf-path-row">
          <input type="text" className="input" value={file ? baseName(file) : ''} readOnly placeholder="Choose a PDF..." />
          <Button size="sm" variant="default" onClick={pickFile}>Browse</Button>
        </div>
      </div>
      {loading && <div className="pdf-loading"><Icon name="spinner" size={16} /> Loading...</div>}
      {info && (
        <div className="pdf-info-grid">
          <div className="pdf-info-row"><span className="pdf-info-label">File</span><span>{baseName(info.path)}</span></div>
          <div className="pdf-info-row"><span className="pdf-info-label">Size</span><span>{formatBytes(info.size)}</span></div>
          <div className="pdf-info-row"><span className="pdf-info-label">Pages</span><span>{info.pageCount}</span></div>
          {info.title && <div className="pdf-info-row"><span className="pdf-info-label">Title</span><span>{info.title}</span></div>}
          <div className="pdf-info-row"><span className="pdf-info-label">Encrypted</span><span>{info.encrypted ? 'Yes' : 'No'}</span></div>
          {info.pages.length > 0 && (
            <div className="pdf-info-pages">
              <h3>Page dimensions</h3>
              <div className="pdf-page-table">
                <div className="pdf-page-table-head">
                  <span>Page</span><span>Width (pt)</span><span>Height (pt)</span><span>Rotation</span>
                </div>
                {info.pages.slice(0, 50).map((p, i) => (
                  <div key={i} className="pdf-page-table-row">
                    <span>{i + 1}</span>
                    <span>{Math.round(p.width)}</span>
                    <span>{Math.round(p.height)}</span>
                    <span>{p.rotation}°</span>
                  </div>
                ))}
                {info.pages.length > 50 && <div className="pdf-page-table-more">...and {info.pages.length - 50} more pages</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Utilities ──

/** Parse "1, 3-5, 8" into 0-based indices. */
function parsePageList(text: string, count: number): number[] {
  const result: number[] = [];
  for (const part of text.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const from = Math.max(1, parseInt(m[1]!, 10));
      const to = Math.min(count, parseInt(m[2]!, 10));
      for (let i = from; i <= to; i++) result.push(i - 1);
    } else {
      const n = parseInt(trimmed, 10);
      if (n >= 1 && n <= count) result.push(n - 1);
    }
  }
  return [...new Set(result)].sort((a, b) => a - b);
}
