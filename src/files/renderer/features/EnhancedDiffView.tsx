import React, { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../api';
import { Icon } from '../ui/Icon';
import { Loading } from '../ui/components';
import { formatBytes } from '../ui/format';
import type { DiffResult, DiffHunk, DiffStats } from '../../shared/diff';
import { mediaUrl } from './Preview';

/* ---------------------------------------------------------------- Types */

type DiffLayout = 'split' | 'unified';
type ImageMode = 'side-by-side' | 'overlay' | 'difference';

/* ---------------------------------------------------------------- Main component */

export function EnhancedDiffView({ left, right }: { left: string; right: string }) {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call<DiffResult>('diff:compute', { pathA: left, pathB: right })
      .then((r) => live && setResult(r))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [left, right]);

  if (error) return <div className="diff-error"><Icon name="alert-circle" size={20} /><p>{error}</p></div>;
  if (!result) return <Loading label="Computing diff..." />;

  if (result.identical) {
    return (
      <div className="diff-identical">
        <Icon name="check-circle" size={24} />
        <p>Files are identical</p>
        {result.type !== 'text' && <span className="muted">{formatBytes(result.leftSize)}</span>}
      </div>
    );
  }

  switch (result.type) {
    case 'text': return <TextDiff result={result} />;
    case 'image': return <ImageDiff result={result} left={left} right={right} />;
    case 'binary': return <BinaryDiff result={result} left={left} right={right} />;
  }
}

/* ---------------------------------------------------------------- Text Diff */

function TextDiff({ result }: { result: Extract<DiffResult, { type: 'text' }> }) {
  const [layout, setLayout] = useState<DiffLayout>('split');
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const syncScroll = useCallback((source: 'left' | 'right') => {
    if (syncing.current) return;
    syncing.current = true;
    const a = source === 'left' ? leftRef.current : rightRef.current;
    const b = source === 'left' ? rightRef.current : leftRef.current;
    if (a && b) {
      const ratio = a.scrollTop / (a.scrollHeight - a.clientHeight || 1);
      b.scrollTop = ratio * (b.scrollHeight - b.clientHeight);
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  return (
    <div className="diff-text-view">
      <DiffStatsBar stats={result.stats} />
      <div className="diff-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Layout">
          <button type="button" role="radio" aria-checked={layout === 'split'} className={layout === 'split' ? 'on' : ''} onClick={() => setLayout('split')}>Split</button>
          <button type="button" role="radio" aria-checked={layout === 'unified'} className={layout === 'unified' ? 'on' : ''} onClick={() => setLayout('unified')}>Unified</button>
        </div>
      </div>
      {layout === 'split' ? (
        <div className="diff-split">
          <div className="diff-pane" ref={leftRef} onScroll={() => syncScroll('left')}>
            <SplitLines hunks={result.hunks} side="left" />
          </div>
          <div className="diff-pane" ref={rightRef} onScroll={() => syncScroll('right')}>
            <SplitLines hunks={result.hunks} side="right" />
          </div>
        </div>
      ) : (
        <div className="diff-unified">
          <UnifiedLines hunks={result.hunks} />
        </div>
      )}
    </div>
  );
}

function DiffStatsBar({ stats }: { stats: DiffStats }) {
  return (
    <div className="diff-stats">
      {stats.linesAdded > 0 && <span className="diff-stat-added">+{stats.linesAdded} added</span>}
      {stats.linesRemoved > 0 && <span className="diff-stat-removed">-{stats.linesRemoved} removed</span>}
      {stats.linesChanged > 0 && <span className="diff-stat-changed">~{stats.linesChanged} changed</span>}
    </div>
  );
}

function SplitLines({ hunks, side }: { hunks: DiffHunk[]; side: 'left' | 'right' }) {
  let lineNum = 1;
  const rows: React.ReactNode[] = [];
  for (let hi = 0; hi < hunks.length; hi++) {
    const hunk = hunks[hi]!;
    if (hunk.kind === 'same') {
      for (const line of hunk.lines) {
        rows.push(
          <div key={`${side}-${lineNum}`} className="diff-line diff-same">
            <span className="diff-ln">{lineNum}</span>
            <span className="diff-content">{line}</span>
          </div>,
        );
        lineNum++;
      }
    } else if (hunk.kind === 'removed' && side === 'left') {
      for (const line of hunk.lines) {
        rows.push(
          <div key={`${side}-${lineNum}`} className="diff-line diff-removed">
            <span className="diff-ln">{lineNum}</span>
            <span className="diff-content">{line}</span>
          </div>,
        );
        lineNum++;
      }
    } else if (hunk.kind === 'added' && side === 'right') {
      for (const line of hunk.lines) {
        rows.push(
          <div key={`${side}-${lineNum}`} className="diff-line diff-added">
            <span className="diff-ln">{lineNum}</span>
            <span className="diff-content">{line}</span>
          </div>,
        );
        lineNum++;
      }
    } else if (hunk.kind === 'removed' && side === 'right') {
      // Show blank spacer lines on the right for removed lines
      for (const _line of hunk.lines) {
        rows.push(<div key={`${side}-spacer-${lineNum++}`} className="diff-line diff-spacer"><span className="diff-ln" /><span className="diff-content" /></div>);
      }
    } else if (hunk.kind === 'added' && side === 'left') {
      // Show blank spacer lines on the left for added lines
      for (const _line of hunk.lines) {
        rows.push(<div key={`${side}-spacer-${lineNum++}`} className="diff-line diff-spacer"><span className="diff-ln" /><span className="diff-content" /></div>);
      }
    }
  }
  return <div className="diff-lines">{rows}</div>;
}

function UnifiedLines({ hunks }: { hunks: DiffHunk[] }) {
  let leftNum = 1;
  let rightNum = 1;
  const rows: React.ReactNode[] = [];
  for (const hunk of hunks) {
    if (hunk.kind === 'same') {
      for (const line of hunk.lines) {
        rows.push(
          <div key={`u-${leftNum}-${rightNum}`} className="diff-line diff-same">
            <span className="diff-ln">{leftNum}</span>
            <span className="diff-ln">{rightNum}</span>
            <span className="diff-marker"> </span>
            <span className="diff-content">{line}</span>
          </div>,
        );
        leftNum++;
        rightNum++;
      }
    } else if (hunk.kind === 'removed') {
      for (const line of hunk.lines) {
        rows.push(
          <div key={`u-r-${leftNum}`} className="diff-line diff-removed">
            <span className="diff-ln">{leftNum}</span>
            <span className="diff-ln" />
            <span className="diff-marker">-</span>
            <span className="diff-content">{line}</span>
          </div>,
        );
        leftNum++;
      }
    } else if (hunk.kind === 'added') {
      for (const line of hunk.lines) {
        rows.push(
          <div key={`u-a-${rightNum}`} className="diff-line diff-added">
            <span className="diff-ln" />
            <span className="diff-ln">{rightNum}</span>
            <span className="diff-marker">+</span>
            <span className="diff-content">{line}</span>
          </div>,
        );
        rightNum++;
      }
    }
  }
  return <div className="diff-lines">{rows}</div>;
}

/* ---------------------------------------------------------------- Image Diff */

function ImageDiff({ result, left, right }: { result: Extract<DiffResult, { type: 'image' }>; left: string; right: string }) {
  const [mode, setMode] = useState<ImageMode>('side-by-side');
  const [opacity, setOpacity] = useState(0.5);

  return (
    <div className="diff-image-view">
      <div className="diff-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Compare mode">
          <button type="button" role="radio" aria-checked={mode === 'side-by-side'} className={mode === 'side-by-side' ? 'on' : ''} onClick={() => setMode('side-by-side')}>Side by side</button>
          <button type="button" role="radio" aria-checked={mode === 'overlay'} className={mode === 'overlay' ? 'on' : ''} onClick={() => setMode('overlay')}>Overlay</button>
          <button type="button" role="radio" aria-checked={mode === 'difference'} className={mode === 'difference' ? 'on' : ''} onClick={() => setMode('difference')}>Difference</button>
        </div>
        <div className="diff-size-info">
          <span className="muted">{formatBytes(result.leftSize)}</span>
          <Icon name="arrow-right" size={12} />
          <span className="muted">{formatBytes(result.rightSize)}</span>
        </div>
      </div>
      {mode === 'side-by-side' && (
        <div className="diff-image-split">
          <div className="diff-image-pane">
            <div className="diff-image-label">Left</div>
            <img src={mediaUrl(left)} alt="Left" draggable={false} />
          </div>
          <div className="diff-image-pane">
            <div className="diff-image-label">Right</div>
            <img src={mediaUrl(right)} alt="Right" draggable={false} />
          </div>
        </div>
      )}
      {mode === 'overlay' && (
        <div className="diff-image-overlay">
          <img src={mediaUrl(left)} alt="Left" className="diff-img-base" draggable={false} />
          <img src={mediaUrl(right)} alt="Right" className="diff-img-top" style={{ opacity }} draggable={false} />
          <div className="diff-overlay-slider">
            <label>Opacity: <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} /></label>
          </div>
        </div>
      )}
      {mode === 'difference' && (
        <div className="diff-image-difference">
          <img src={mediaUrl(left)} alt="Left" className="diff-img-base" draggable={false} />
          <img src={mediaUrl(right)} alt="Right" className="diff-img-diff" draggable={false} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Binary Diff */

function BinaryDiff({ result, left, right }: { result: Extract<DiffResult, { type: 'binary' }>; left: string; right: string }) {
  const leftBytes = Uint8Array.from(atob(result.leftHex), (c) => c.charCodeAt(0));
  const rightBytes = Uint8Array.from(atob(result.rightHex), (c) => c.charCodeAt(0));

  return (
    <div className="diff-binary-view">
      <div className="diff-toolbar">
        <div className="diff-size-info">
          <span className="muted">{formatBytes(result.leftSize)}</span>
          <Icon name="arrow-right" size={12} />
          <span className="muted">{formatBytes(result.rightSize)}</span>
        </div>
        <span className="muted">First {formatBytes(Math.max(leftBytes.length, rightBytes.length))} shown</span>
      </div>
      <div className="diff-split">
        <div className="diff-pane">
          <div className="diff-binary-label">{left.split('/').pop()}</div>
          <HexGrid bytes={leftBytes} compareWith={rightBytes} />
        </div>
        <div className="diff-pane">
          <div className="diff-binary-label">{right.split('/').pop()}</div>
          <HexGrid bytes={rightBytes} compareWith={leftBytes} />
        </div>
      </div>
    </div>
  );
}

function HexGrid({ bytes, compareWith }: { bytes: Uint8Array; compareWith: Uint8Array }) {
  const rows: React.ReactNode[] = [];
  const perRow = 16;
  for (let off = 0; off < bytes.length; off += perRow) {
    const hexParts: React.ReactNode[] = [];
    const ascParts: React.ReactNode[] = [];
    for (let j = 0; j < perRow; j++) {
      const idx = off + j;
      if (idx >= bytes.length) {
        hexParts.push(<span key={j} className="hex-byte">  </span>);
        ascParts.push(<span key={`a${j}`}> </span>);
        continue;
      }
      const b = bytes[idx]!;
      const differs = idx < compareWith.length && compareWith[idx] !== b;
      const cls = `hex-byte${differs ? ' hex-diff' : ''}`;
      hexParts.push(<span key={j} className={cls}>{b.toString(16).padStart(2, '0')}</span>);
      const ch = b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
      ascParts.push(<span key={`a${j}`} className={differs ? 'hex-diff' : ''}>{ch}</span>);
    }
    rows.push(
      <div key={off} className="hex-row">
        <span className="hex-offset">{off.toString(16).padStart(8, '0')}</span>
        <span className="hex-bytes">{hexParts}</span>
        <span className="hex-ascii">{ascParts}</span>
      </div>,
    );
  }
  return <div className="hex-grid">{rows}</div>;
}
