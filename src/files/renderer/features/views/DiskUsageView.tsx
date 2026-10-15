import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { call, runJob } from '../../api';
import { app, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane } from '../../state/workspace';
import { EmptyState, ProgressBar } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes } from '../../ui/format';
import { FolderPicker, JobPauseButton, useJobPaused } from './common';
import type { DiskNode, DiskScanProgress, DiskScanResult } from '../../../shared/diskUsage';

/* ────────────────────────────── squarified treemap layout ────────────────── */

interface Rect { x: number; y: number; w: number; h: number; node: DiskNode; depth: number }

function squarify(nodes: DiskNode[], bounds: { x: number; y: number; w: number; h: number }, depth: number): Rect[] {
  if (!nodes.length || bounds.w <= 0 || bounds.h <= 0) return [];

  const total = nodes.reduce((s, n) => s + n.size, 0);
  if (total <= 0) return [];

  const rects: Rect[] = [];
  let x = bounds.x;
  let y = bounds.y;
  let w = bounds.w;
  let h = bounds.h;

  const sorted = [...nodes].sort((a, b) => b.size - a.size);
  let i = 0;

  while (i < sorted.length) {
    const remaining = sorted.slice(i).reduce((s, n) => s + n.size, 0);
    if (remaining <= 0) break;

    const isHorizontal = w >= h;
    const side = isHorizontal ? h : w;
    if (side <= 0) break;

    // Find the best row
    let row: DiskNode[] = [];
    let rowArea = 0;
    let bestRatio = Infinity;

    for (let j = i; j < sorted.length; j++) {
      const candidate = [...row, sorted[j]!];
      const candidateArea = rowArea + sorted[j]!.size;
      const stripSize = (candidateArea / remaining) * (isHorizontal ? w : h);
      if (stripSize <= 0) break;

      let worstRatio = 0;
      for (const n of candidate) {
        const itemSize = (n.size / candidateArea) * side;
        if (itemSize <= 0) continue;
        const r = Math.max(stripSize / itemSize, itemSize / stripSize);
        worstRatio = Math.max(worstRatio, r);
      }

      if (worstRatio <= bestRatio) {
        bestRatio = worstRatio;
        row = candidate;
        rowArea = candidateArea;
      } else {
        break;
      }
    }

    if (!row.length) break;

    // Lay out the row
    const stripSize = (rowArea / remaining) * (isHorizontal ? w : h);
    let offset = 0;

    for (const node of row) {
      const fraction = node.size / rowArea;
      const itemSize = fraction * side;

      const rect: Rect = isHorizontal
        ? { x: x, y: y + offset, w: stripSize, h: itemSize, node, depth }
        : { x: x + offset, y: y, w: itemSize, h: stripSize, node, depth };

      rects.push(rect);
      offset += itemSize;
    }

    if (isHorizontal) {
      x += stripSize;
      w -= stripSize;
    } else {
      y += stripSize;
      h -= stripSize;
    }

    i += row.length;
  }

  return rects;
}

/* ────────────────────────────── color helpers ────────────────────────────── */

const COLORS = [
  'var(--hue-folder, #5b9bd5)',
  'var(--hue-image, #e67e73)',
  'var(--hue-video, #b07cd8)',
  'var(--hue-audio, #e5a950)',
  'var(--hue-doc, #6bc275)',
  'var(--hue-code, #6ec5d0)',
  'var(--hue-archive, #c97e58)',
  'var(--hue-other, #8b8b8b)',
];

function colorFor(index: number): string {
  return COLORS[index % COLORS.length]!;
}

/* ────────────────────────────── treemap component ───────────────────────── */

function Treemap({
  node,
  onDrill,
  width,
  height,
}: {
  node: DiskNode;
  onDrill: (n: DiskNode) => void;
  width: number;
  height: number;
}) {
  const rects = useMemo(
    () => squarify(node.children ?? [], { x: 0, y: 0, w: width, h: height }, 0),
    [node.children, width, height],
  );

  const [hover, setHover] = useState<string | null>(null);

  if (!(node.children ?? []).length) {
    return (
      <div className="disk-treemap-empty">
        <EmptyState icon="folder" title="Empty folder" body="This folder has no contents to display." />
      </div>
    );
  }

  return (
    <div className="disk-treemap" style={{ width, height, position: 'relative' }}>
      {rects.map((r, i) => {
        const isDir = !!(r.node.children && r.node.children.length > 0);
        const isHovered = hover === r.node.path;
        const minLabel = r.w > 60 && r.h > 28;
        const minSize = r.w > 80 && r.h > 42;

        return (
          <div
            key={r.node.path}
            className={`disk-treemap-rect ${isHovered ? 'is-hover' : ''}`}
            style={{
              position: 'absolute',
              left: r.x,
              top: r.y,
              width: Math.max(r.w - 2, 0),
              height: Math.max(r.h - 2, 0),
              backgroundColor: colorFor(i),
              cursor: isDir ? 'pointer' : 'default',
            }}
            title={`${r.node.name}\n${formatBytes(r.node.size)} — ${r.node.fileCount} files`}
            onClick={() => isDir && onDrill(r.node)}
            onMouseEnter={() => setHover(r.node.path)}
            onMouseLeave={() => setHover(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              void handleContextMenu(r.node);
            }}
          >
            {minLabel && <span className="disk-treemap-name">{r.node.name}</span>}
            {minSize && <span className="disk-treemap-size">{formatBytes(r.node.size)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function handleContextMenu(node: DiskNode): void {
  void call('fs:copyText', { text: node.path });
}

/* ────────────────────────────── breadcrumb ───────────────────────────────── */

function Breadcrumb({ trail, onNavigate }: { trail: DiskNode[]; onNavigate: (index: number) => void }) {
  return (
    <nav className="disk-breadcrumb" aria-label="Disk usage breadcrumb">
      {trail.map((node, i) => (
        <React.Fragment key={node.path}>
          {i > 0 && <Icon name="chevronRight" size={12} />}
          <button
            type="button"
            className={`disk-breadcrumb-item ${i === trail.length - 1 ? 'is-current' : ''}`}
            onClick={() => onNavigate(i)}
            disabled={i === trail.length - 1}
          >
            {node.name}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

/* ────────────────────────────── largest files list ───────────────────────── */

function LargestFiles({ files, onOpen }: { files: Array<{ path: string; size: number }>; onOpen: (path: string) => void }) {
  if (!files.length) return null;
  return (
    <div className="disk-largest">
      <h3>Largest files</h3>
      <table className="data-table compact">
        <thead>
          <tr><th>File</th><th style={{ textAlign: 'right' }}>Size</th></tr>
        </thead>
        <tbody>
          {files.slice(0, 20).map((f) => (
            <tr key={f.path} className="clickable-row" onClick={() => onOpen(f.path)}>
              <td className="ellipsis" title={f.path}>{f.path.split(/[\\/]/).pop()}</td>
              <td style={{ textAlign: 'right' }} className="tabular">{formatBytes(f.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────────── main view ────────────────────────────────── */

export function DiskUsageView() {
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'home')?.path ?? '/');
  const [root, setRoot] = useState(() => {
    const loc = activePane().history.find((l) => l.kind === 'fs');
    return loc?.kind === 'fs' ? loc.path : home;
  });
  const [progress, setProgress] = useState<DiskScanProgress | null>(null);
  const [result, setResult] = useState<DiskScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<{ jobId: string; cancel: () => void } | null>(null);
  const paused = useJobPaused(job?.jobId);
  const [trail, setTrail] = useState<DiskNode[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 600, height: 400 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ width: el.clientWidth, height: Math.max(300, el.clientHeight - 10) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scan = useCallback(() => {
    setError(null);
    setResult(null);
    setProgress(null);
    setTrail([]);
    const handle = runJob<DiskScanResult>(
      (jobId) => call('disk:scan', { path: root, jobId }),
      (p) => setProgress(p as DiskScanProgress),
      'Disk usage scan',
    );
    setJob({ jobId: handle.jobId, cancel: handle.cancel });
    handle.promise.then(
      (r) => {
        setJob(null);
        if (r.cancelled) return;
        if (r.value) {
          setResult(r.value);
          setTrail([r.value.tree]);
        }
      },
      (err) => {
        setJob(null);
        setError((err as Error).message);
        toastError(err, 'Disk usage scan failed');
      },
    );
  }, [root]);

  const currentNode = trail.length ? trail[trail.length - 1]! : result?.tree;

  const drillInto = useCallback((node: DiskNode) => {
    setTrail((t) => [...t, node]);
  }, []);

  const navigateBreadcrumb = useCallback((index: number) => {
    setTrail((t) => t.slice(0, index + 1));
  }, []);

  const openFile = useCallback((filePath: string) => {
    void call('fs:open', { path: filePath });
  }, []);

  return (
    <div className="tool-view scroll-y disk-usage-view">
      <header className="view-header">
        <h1><Icon name="storage" size={20} /> Disk Usage Analyzer</h1>
        <p className="muted">Visualize how disk space is used inside a folder.</p>
      </header>

      <div className="disk-controls">
        <FolderPicker label="Folder" value={root} onChange={setRoot} />
        <div className="disk-actions">
          {job ? (
            <>
              <button type="button" className="btn btn-default" onClick={job.cancel}>
                <Icon name="close" size={14} /> Cancel
              </button>
              <JobPauseButton jobId={job.jobId} />
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={scan}>
              <Icon name="search" size={14} /> Scan
            </button>
          )}
        </div>
      </div>

      {progress && !result && (
        <div className="disk-progress">
          <ProgressBar label="Scanning" />
          <p className="small muted">
            {progress.files.toLocaleString()} files, {formatBytes(progress.bytes)}
            {paused && <span className="pill-sm muted"> Paused</span>}
          </p>
        </div>
      )}

      {error && (
        <div className="disk-error">
          <p className="error">{error}</p>
        </div>
      )}

      {result && currentNode && (
        <>
          <div className="disk-summary">
            <dl className="hero-stats">
              <div><dt>Total size</dt><dd className="tabular">{formatBytes(result.totalSize)}</dd></div>
              <div><dt>Files</dt><dd className="tabular">{result.totalFiles.toLocaleString()}</dd></div>
              <div><dt>Folders</dt><dd className="tabular">{result.totalDirs.toLocaleString()}</dd></div>
              <div><dt>Scan time</dt><dd className="tabular">{(result.scannedMs / 1000).toFixed(1)}s</dd></div>
            </dl>
          </div>

          {trail.length > 1 && (
            <Breadcrumb trail={trail} onNavigate={navigateBreadcrumb} />
          )}

          <div className="disk-treemap-container" ref={containerRef}>
            <Treemap
              node={currentNode}
              onDrill={drillInto}
              width={dims.width}
              height={dims.height}
            />
          </div>

          <LargestFiles files={result.largestFiles} onOpen={openFile} />
        </>
      )}

      {!result && !progress && !error && (
        <EmptyState icon="storage" title="Analyze disk usage" body="Choose a folder and click Scan to see how space is used." />
      )}
    </div>
  );
}
