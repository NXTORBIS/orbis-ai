// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { call, runJob, UiError } from '../api';
import type { FileEntry } from '../../shared/model';
import { Icon } from '../ui/Icon';
import { EmptyState, FileIcon, IconButton, Loading, TextField } from '../ui/components';
import { categoryOfEntry, formatBytes, formatCount, formatMediaDuration } from '../ui/format';
import { activePane, listingKeyFor, listings, ws } from '../state/workspace';
import { parseCsv } from './csv';
import { openFile } from '../actions';
import { app, openDialog } from '../state/app';
import { useStore } from '../state/store';
import { thumbUrl } from './FileViews';
import { JobPauseButton, useJobPaused } from './views/common';
import { loadFontFace } from './videoThumbs';
import { registerPreview } from '../state/video';
import { addPaths } from '../state/player';
import { runCommand, getContext } from '../commands';
import { closeViewer, loadSlideshowPrefs, openViewer, saveSlideshowPrefs, setViewerIndex, shuffledOrder, SLIDESHOW_INTERVALS, viewer, type SlideshowPrefs } from '../state/viewer';
import { openEbook, openComic, openModel } from '../state/viewers';
import type { EbookManifest, ComicManifest, Model3DInfo } from '../../shared/viewers';
import { StructuredTreeViewer } from './StructuredTreeViewer';
import { MarkdownLivePreview } from './MarkdownLivePreview';
import { SQLITE_EXTS } from '../../shared/sqlite';
import { SqliteViewer } from './views/SqliteView';
import { ColorPalettePanel } from './ColorPalette';
import { AudioWaveform } from './AudioWaveform';
import { MetadataPanel } from './MetadataPanel';
import { VideoTimeline } from './VideoTimeline';

/**
 * Preview providers. Each handler receives the selected entry and renders a
 * read-only view. Content is treated as untrusted: Markdown is rendered to
 * React elements (raw HTML is shown as text), SVG is served with a sandboxing
 * CSP, and nothing is executed.
 */

export const mediaUrl = (p: string) => `orbis-media://f/${encodeURIComponent(p)}`;

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'svg']);
const VIDEO = new Set(['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac']);
const TEXTY = new Set(['txt', 'md', 'markdown', 'log', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'csv', 'tsv', 'env', 'rst', 'html', 'htm', 'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'swift', 'php', 'sh', 'bash', 'zsh', 'sql', 'lua', 'r', 'dart', 'vue', 'svelte', 'gitignore', 'dockerfile', 'makefile', 'srt', 'vtt', 'tex', 'bib', 'properties', 'gradle', 'lock']);
const ARCHIVE = new Set(['zip', 'tar', 'tgz', 'gz', '7z', 'rar', 'xz', 'txz', 'bz2', 'tbz2', 'zst', 'tzst', 'cab', 'iso']);
const OFFICE = new Set(['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm', 'odt', 'ods', 'odp']);
const LEGACY_OFFICE = new Set(['doc', 'xls', 'ppt', 'rtf', 'pages', 'numbers', 'key']);

const FONT = new Set(['ttf', 'otf', 'woff', 'woff2']);
const EBOOK = new Set(['epub']);
const COMIC = new Set(['cbz', 'cbr', 'cb7', 'cbt']);
const MODEL3D = new Set(['stl', 'obj', 'ply', 'gltf', 'glb']);

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'archive' | 'office' | 'font' | 'ebook' | 'comic' | 'model3d' | 'sqlite' | 'folder' | 'none';

export function previewKind(e: FileEntry): PreviewKind {
  if (e.kind === 'directory' || e.linkTargetKind === 'directory') return 'folder';
  if (e.kind === 'symlink' && e.linkTargetKind === 'broken') return 'none';
  if (SQLITE_EXTS.has(e.ext)) return 'sqlite';
  if (IMAGE.has(e.ext)) return 'image';
  if (VIDEO.has(e.ext)) return 'video';
  if (AUDIO.has(e.ext)) return 'audio';
  if (e.ext === 'pdf') return 'pdf';
  if (FONT.has(e.ext)) return 'font';
  if (EBOOK.has(e.ext)) return 'ebook';
  if (COMIC.has(e.ext)) return 'comic';
  if (MODEL3D.has(e.ext)) return 'model3d';
  if (ARCHIVE.has(e.ext) || e.name.toLowerCase().endsWith('.tar.gz')) return 'archive';
  if (OFFICE.has(e.ext)) return 'office';
  if (TEXTY.has(e.ext) || (!e.ext && (e.size ?? 0) < 512 * 1024) || /^(readme|license|changelog|makefile|dockerfile)$/i.test(e.name)) return 'text';
  return 'none';
}

export function Preview({ entry }: { entry: FileEntry }) {
  const kind = previewKind(entry);
  // Remount on path or modification change so stale content never shows for another file.
  const key = `${entry.path}|${entry.modifiedMs ?? 0}`;
  switch (kind) {
    case 'sqlite': return <SqliteViewer key={key} path={entry.path} />;
    case 'image': return <ImagePreview key={key} entry={entry} />;
    case 'video': return <MediaPreview key={key} entry={entry} kind="video" />;
    case 'audio': return <MediaPreview key={key} entry={entry} kind="audio" />;
    case 'pdf': return <PdfPreview key={key} entry={entry} />;
    case 'text': return <TextPreview key={key} entry={entry} />;
    case 'archive': return <ArchivePreview key={key} entry={entry} />;
    case 'office': return <OfficeDocPreview key={key} entry={entry} />;
    case 'font': return <FontPreview key={key} entry={entry} />;
    case 'ebook': return <EbookPreview key={key} entry={entry} />;
    case 'comic': return <ComicPreview key={key} entry={entry} />;
    case 'model3d': return <Model3DPreview key={key} entry={entry} />;
    case 'folder': return <FolderPreview key={key} entry={entry} />;
    default: return <NoPreview entry={entry} reason={LEGACY_OFFICE.has(entry.ext) ? 'This older document format cannot be previewed here. Open it in an application that supports it.' : undefined} />;
  }
}

function NoPreview({ entry, reason }: { entry: FileEntry; reason?: string }) {
  return (
    <div className="preview-none">
      <FileIcon entry={entry} size={44} />
      <p>{reason ?? (entry.kind === 'symlink' && entry.linkTargetKind === 'broken' ? 'This link points to something that does not exist.' : 'No built-in preview for this type of file.')}</p>
      {entry.kind === 'file' && (
        <div className="tb-group wrap">
          <button type="button" className="btn btn-default btn-sm" onClick={() => void openFile(entry.path)}>Open with default app</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog('openWith', { path: entry.path })}>Open with…</button>
        </div>
      )}
      {entry.kind === 'file' && <HexPeek path={entry.path} />}
    </div>
  );
}

/* ---------------------------------------------------------------- image */

function ImagePreview({ entry, large }: { entry: FileEntry; large?: boolean }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [rot, setRot] = useState(0);
  if (failed) return <NoPreview entry={entry} reason="This image could not be decoded by the built-in viewer." />;
  return (
    <div className={`preview-image ${large ? 'large' : ''}`}>
      <div className="preview-tools">
        <IconButton icon="zoomOut" label="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, (z === 'fit' ? 1 : z) / 1.25))} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}>{zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
        <IconButton icon="zoomIn" label="Zoom in" onClick={() => setZoom((z) => Math.min(16, (z === 'fit' ? 1 : z) * 1.25))} />
        <IconButton icon="rotateLeft" label="Rotate left (view only)" onClick={() => setRot((r) => r - 90)} />
        <IconButton icon="rotateRight" label="Rotate right (view only)" onClick={() => setRot((r) => r + 90)} />
        {dims && <span className="muted tabular">{dims.w} × {dims.h}</span>}
        {!large && <ViewerButton entry={entry} />}
      </div>
      <div className={`image-stage ${zoom === 'fit' ? 'fit' : ''}`}>
        <img
          src={mediaUrl(entry.path)}
          alt={entry.name}
          draggable={false}
          style={{ transform: `rotate(${rot}deg)${zoom === 'fit' ? '' : ` scale(${zoom})`}` }}
          onLoad={(e) => setDims({ w: (e.target as HTMLImageElement).naturalWidth, h: (e.target as HTMLImageElement).naturalHeight })}
          onError={() => setFailed(true)}
        />
      </div>
      <ColorPalettePanel imagePath={entry.path} />
      <MetadataPanel path={entry.path} />
    </div>
  );
}

/* ---------------------------------------------------------------- audio / video */

function MediaPreview({ entry, kind, inViewer, autoPlay, onEnded, onFailed }: { entry: FileEntry; kind: 'video' | 'audio'; inViewer?: boolean; autoPlay?: boolean; onEnded?: () => void; onFailed?: () => void }) {
  const [error, setError] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const ref = useRef<HTMLMediaElement | null>(null);
  useEffect(() => () => {
    // Release decoders when the selection changes.
    if (ref.current) {
      ref.current.pause();
      ref.current.removeAttribute('src');
      ref.current.load();
    }
    registerPreview(entry.path, null);
  }, [entry.path]);
  if (error) return <NoPreview entry={entry} reason={`This ${kind} format or codec cannot be played by the built-in player.`} />;
  const common = {
    src: mediaUrl(entry.path),
    controls: true,
    autoPlay,
    preload: (autoPlay ? 'auto' : 'metadata') as 'auto' | 'metadata',
    poster: kind === 'video' ? `${thumbUrl(entry.path, 512)}&m=${entry.modifiedMs ?? 0}` : undefined,
    onError: () => {
      setError(true);
      onFailed?.();
    },
    onEnded,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => setDuration(e.currentTarget.duration),
  };
  return (
    <div className={`preview-media ${kind}`}>
      {kind === 'video' ? <video ref={(el) => {
        ref.current = el;
        // "Save frame as PNG" uses this preview's position.
        if (!inViewer) registerPreview(entry.path, el);
      }} {...common} /> : (
        <>
          <AudioWaveform path={entry.path} audioEl={ref.current} />
          <audio ref={(el) => (ref.current = el)} {...common} />
        </>
      )}
      {kind === 'video' && !inViewer && <VideoTimeline filePath={entry.path} onSeek={(t) => { if (ref.current) { ref.current.currentTime = t; } }} />}
      <div className="preview-tools">
        {duration !== null && Number.isFinite(duration) && <span className="muted tabular">Duration {formatMediaDuration(duration)}</span>}
        {kind === 'video' && !inViewer && <ViewerButton entry={entry} />}
        {kind === 'video' && !inViewer && <IconButton icon="frame" label="Save this frame as PNG" onClick={() => void runCommand('video.saveFrame', getContext(entry))} />}
        {!inViewer && <IconButton icon="cut" label="Trim…" onClick={() => void runCommand('video.trim', getContext(entry))} />}
        {kind === 'audio' && !inViewer && <IconButton icon="enqueue" label="Add to the music queue" onClick={() => void addPaths([entry.path], 'queue')} />}
        {kind === 'audio' && !inViewer && <IconButton icon="playMedia" label="Play in the music player" onClick={() => {
          ref.current?.pause();
          void addPaths([entry.path], 'play');
        }} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pdf */

function PdfPreview({ entry }: { entry: FileEntry }) {
  return (
    <div className="preview-pdf">
      <iframe title={`PDF preview of ${entry.name}`} src={mediaUrl(entry.path)} />
    </div>
  );
}

/* ---------------------------------------------------------------- text, code, markdown, json, csv */

interface TextRead { text: string; encoding: string; truncated: boolean; totalBytes: number; binary: boolean; offset: number; nextOffset?: number }

const PAGE_BYTES = 512 * 1024;

function TextPreview({ entry }: { entry: FileEntry }) {
  const [data, setData] = useState<TextRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  const [find, setFind] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  // "Largest text shown in previews" (Settings) caps how much can be loaded in total.
  const maxLoaded = useStore(app, (x) => x.settings.previewMaxTextBytes);
  const page = Math.min(PAGE_BYTES, maxLoaded);
  useEffect(() => {
    let live = true;
    call<TextRead>('fs:readText', { path: entry.path, maxBytes: page }).then((d) => live && setData(d), (e) => live && setError((e as Error).message));
    return () => {
      live = false; // drop results for a selection that is no longer current
    };
  }, [entry.path, page]);
  if (error) return <NoPreview entry={entry} reason={error} />;
  if (!data) return <Loading label="Reading…" />;
  if (data.binary) return <NoPreview entry={entry} reason="This file contains binary data and is not shown as text." />;
  const loadMore = () => {
    if (data.nextOffset === undefined) return;
    setLoadingMore(true);
    call<TextRead>('fs:readText', { path: entry.path, maxBytes: page, offset: data.nextOffset }).then(
      (more) => setData({ ...more, text: data.text + more.text, offset: data.offset }),
      (e) => setError((e as Error).message),
    ).finally(() => setLoadingMore(false));
  };
  const loadedBytes = (data.nextOffset ?? data.totalBytes) - data.offset;
  const isStructured = ['json', 'yaml', 'yml', 'xml', 'toml'].includes(entry.ext);
  const isMd = entry.ext === 'md' || entry.ext === 'markdown';
  const renderable = isMd || isStructured || ['csv', 'tsv'].includes(entry.ext);
  const findCount = find ? data.text.toLowerCase().split(find.toLowerCase()).length - 1 : 0;

  // Structured tree viewer for JSON/YAML/XML/TOML
  if (isStructured && mode === 'rendered') {
    return (
      <div className="preview-text">
        <div className="preview-tools">
          <div className="segmented" role="radiogroup" aria-label="Display">
            <button type="button" role="radio" aria-checked className="on">Tree</button>
            <button type="button" role="radio" aria-checked={false} onClick={() => setMode('source')}>Source</button>
          </div>
          <span className="muted small" title="Detected text encoding">{data.encoding === 'latin1' ? 'LATIN-1' : data.encoding.toUpperCase()}</span>
        </div>
        <StructuredTreeViewer path={entry.path} />
      </div>
    );
  }

  // Markdown live preview with edit & preview mode
  if (isMd && mode === 'rendered') {
    return (
      <div className="preview-text">
        <div className="preview-tools">
          <div className="segmented" role="radiogroup" aria-label="Display">
            <button type="button" role="radio" aria-checked className="on">Edit &amp; Preview</button>
            <button type="button" role="radio" aria-checked={false} onClick={() => setMode('source')}>Source</button>
          </div>
          <span className="muted small" title="Detected text encoding">{data.encoding === 'latin1' ? 'LATIN-1' : data.encoding.toUpperCase()}</span>
        </div>
        <MarkdownLivePreview path={entry.path} initialSource={data.text} />
      </div>
    );
  }
  return (
    <div className="preview-text">
      <div className="preview-tools">
        {renderable && (
          <div className="segmented" role="radiogroup" aria-label="Display">
            <button type="button" role="radio" aria-checked={mode === 'rendered'} className={mode === 'rendered' ? 'on' : ''} onClick={() => setMode('rendered')}>{entry.ext === 'json' ? 'Formatted' : entry.ext.startsWith('md') || entry.ext === 'markdown' ? 'Rendered' : 'Table'}</button>
            <button type="button" role="radio" aria-checked={mode === 'source'} className={mode === 'source' ? 'on' : ''} onClick={() => setMode('source')}>Source</button>
          </div>
        )}
        <div className="find-box">
          <Icon name="search" size={13} />
          <input value={find} placeholder="Find in preview" aria-label="Find in preview" onChange={(e) => setFind(e.target.value)} />
          {find && <span className="muted tabular" aria-live="polite">{findCount}</span>}
        </div>
        <span className="muted small" title="Detected text encoding">{data.encoding === 'latin1' ? 'LATIN-1' : data.encoding.toUpperCase()}</span>
      </div>
      {data.nextOffset !== undefined && (
        <p className="preview-note">
          Showing the first {formatBytes(loadedBytes)} of {formatBytes(data.totalBytes)}{find ? '; Find searches only what is loaded' : ''}.{' '}
          {loadedBytes < maxLoaded ? <button type="button" className="linklike" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Load more'}</button> : 'Open the file in an editor to see the rest.'}
        </p>
      )}
      <div className="preview-scroll">
        {mode === 'rendered' && (entry.ext === 'md' || entry.ext === 'markdown') ? <Markdown source={data.text} />
          : mode === 'rendered' && entry.ext === 'json' ? <JsonView text={data.text} find={find} partial={data.nextOffset !== undefined} />
          : mode === 'rendered' && (entry.ext === 'csv' || entry.ext === 'tsv') ? <CsvTable text={data.text} tsv={entry.ext === 'tsv'} truncated={data.nextOffset !== undefined} />
          : <CodeView text={data.text} ext={entry.ext} find={find} />}
      </div>
    </div>
  );
}

const KEYWORDS = new Set(('abstract as async await break case catch class const continue def del elif else enum except export extends false final finally fn for from func function go if impl import in interface is lambda let match mod mut new nil none not null of or package pass private protected pub public raise return self static struct super switch this throw true try type typeof use var void when where while with yield').split(' '));

/** Lightweight lexical highlighting (strings, comments, numbers, keywords). Display only. */
const MARKUP = new Set(['xml', 'html', 'htm', 'svg', 'vue', 'svelte', 'xaml', 'plist', 'csproj']);

function highlightMarkup(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(<!--.*?-->)|(<\/?[\w:.-]+)|([\w:.-]+)(=)("[^"]*"|'[^']*')|(\/?>)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="tk-c">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="tk-k">{m[2]}</span>);
    else if (m[3]) out.push(<span key={k++} className="tk-n">{m[3]}</span>, m[4], <span key={k++} className="tk-s">{m[5]}</span>);
    else if (m[6]) out.push(<span key={k++} className="tk-k">{m[6]}</span>);
    last = re.lastIndex;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function highlightLog(line: string): React.ReactNode[] {
  const m = /\b(FATAL|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/.exec(line);
  if (!m) return [line];
  const cls = /FATAL|ERR/.test(m[1]!) ? 'tk-err' : /WARN/.test(m[1]!) ? 'tk-warn' : 'tk-c';
  return [line.slice(0, m.index), <span key="lvl" className={cls}>{m[1]}</span>, line.slice(m.index + m[1]!.length)];
}

function highlight(line: string, ext: string): React.ReactNode[] {
  if (MARKUP.has(ext)) return highlightMarkup(line);
  if (ext === 'log') return highlightLog(line);
  const out: React.ReactNode[] = [];
  const hashComment = ['py', 'rb', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml', 'r', 'conf', 'ini', 'env', 'properties', 'makefile', 'dockerfile', 'gitignore'].includes(ext);
  const re = hashComment
    ? /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g
    : /(\/\/.*$|\/\*.*?\*\/|<!--.*?-->)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="tk-c">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="tk-s">{m[2]}</span>);
    else if (m[3]) out.push(<span key={k++} className="tk-n">{m[3]}</span>);
    else if (m[4]) out.push(KEYWORDS.has(m[4]) ? <span key={k++} className="tk-k">{m[4]}</span> : m[4]);
    last = re.lastIndex;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function markFind(nodes: React.ReactNode[], find: string): React.ReactNode[] {
  if (!find) return nodes;
  const f = find.toLowerCase();
  return nodes.flatMap((n, i) => {
    if (typeof n !== 'string') return [n];
    const parts: React.ReactNode[] = [];
    let idx = 0;
    const low = n.toLowerCase();
    let hit = low.indexOf(f);
    while (hit >= 0) {
      if (hit > idx) parts.push(n.slice(idx, hit));
      parts.push(<mark key={`${i}-${hit}`}>{n.slice(hit, hit + find.length)}</mark>);
      idx = hit + find.length;
      hit = low.indexOf(f, idx);
    }
    if (idx < n.length) parts.push(n.slice(idx));
    return parts;
  });
}

function CodeView({ text, ext, find }: { text: string; ext: string; find: string }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const highlightOn = lines.length < 20000;
  const width = String(lines.length).length;
  return (
    <pre className="code-view" style={{ '--gutter': `${width + 1}ch` } as React.CSSProperties}>
      {lines.map((l, i) => (
        <div key={i} className="code-line">
          <span className="ln" aria-hidden>{i + 1}</span>
          <span className="lc">{markFind(highlightOn ? highlight(l, ext) : [l], find)}</span>
        </div>
      ))}
    </pre>
  );
}

function JsonView({ text, find, partial }: { text: string; find: string; partial?: boolean }) {
  const pretty = useMemo(() => {
    try {
      return { ok: true, text: JSON.stringify(JSON.parse(text), null, 2) };
    } catch (e) {
      return { ok: false, text, error: (e as Error).message };
    }
  }, [text]);
  return (
    <>
      {!pretty.ok && <p className="preview-note warning-text">{partial ? 'Only part of this JSON file is loaded, so it is shown as text.' : `Not valid JSON: ${pretty.error}`}</p>}
      <CodeView text={pretty.text} ext="json" find={find} />
    </>
  );
}

function CsvTable({ text, tsv, truncated }: { text: string; tsv: boolean; truncated: boolean }) {
  const rows = useMemo(() => (tsv ? text.split(/\r?\n/).filter(Boolean).map((l) => l.split('\t')) : parseCsv(text)), [text, tsv]);
  const shown = rows.slice(0, 501);
  return (
    <div className="csv-wrap">
      <table className="table csv">
        <thead><tr>{(shown[0] ?? []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{shown.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
      {(rows.length > 501 || truncated) && <p className="preview-note">Showing the first {Math.min(500, rows.length - 1)} rows{truncated ? ' of a partially read file' : ''}.</p>}
    </div>
  );
}

/** Minimal, safe Markdown → React renderer. Raw HTML is displayed as text. Links show their target. */
export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className="markdown">{blocks}</div>;
}

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(!?\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\))|(~~[^~]+~~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(<code key={`${key}-${k++}`}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={`${key}-${k++}`}>{inline(t.slice(2, -2), `${key}-${k}`)}</strong>);
    else if (m[3]) out.push(<em key={`${key}-${k++}`}>{inline(t.slice(1, -1), `${key}-${k}`)}</em>);
    else if (m[5]) out.push(<del key={`${key}-${k++}`}>{t.slice(2, -2)}</del>);
    else if (m[4]) {
      const lm = /^(!?)\[([^\]]*)\]\(([^)\s]+)/.exec(t)!;
      // Images and links are not loaded or followed from previews; the target is shown instead.
      out.push(<span key={`${key}-${k++}`} className="md-link" title={lm[3]}>{lm[1] ? `[image: ${lm[2] || 'untitled'}]` : lm[2]}<span className="md-href"> ({lm[3]})</span></span>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function parseMarkdown(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      i++;
      out.push(<pre key={k++} className="code-view md-code"><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const Tag = `h${Math.min(6, h[1]!.length + 1)}` as 'h2';
      out.push(<Tag key={k++}>{inline(h[2]!, `h${k}`)}</Tag>);
      i++;
      continue;
    }
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      out.push(<hr key={k++} />);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={k++}>{parseMarkdown(body.join('\n'))}</blockquote>);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
        const text = lines[i]!.replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
        items.push(<li key={i}>{task ? <><input type="checkbox" disabled checked={task[1] !== ' '} /> {inline(task[2]!, `li${i}`)}</> : inline(text, `li${i}`)}</li>);
        i++;
      }
      out.push(ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) body.push(cells(lines[i++]!));
      out.push(
        <table key={k++} className="table md-table">
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${j}`)}</th>)}</tr></thead>
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${ri}${j}`)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]!)) para.push(lines[i++]!);
    out.push(<p key={k++}>{inline(para.join(' '), `p${k}`)}</p>);
  }
  return out;
}

/* ---------------------------------------------------------------- office documents */

type OfficeBlock = { type: 'heading'; level: number; text: string } | { type: 'para'; text: string } | { type: 'table'; rows: string[][] };
interface OfficeData { format: string; blocks?: OfficeBlock[]; sheets?: Array<{ name: string; rows: string[][]; truncated: boolean }>; slides?: Array<{ index: number; paragraphs: string[] }>; truncated: boolean; note: string }

function OfficeDocPreview({ entry }: { entry: FileEntry }) {
  const [data, setData] = useState<OfficeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    let live = true;
    call<OfficeData>('preview:office', { path: entry.path }).then((d) => live && setData(d), (e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [entry.path]);
  if (error) return <NoPreview entry={entry} reason={error} />;
  if (!data) return <Loading label="Reading document…" />;
  const empty = !(data.blocks?.length || data.sheets?.some((x) => x.rows.length) || data.slides?.some((x) => x.paragraphs.length));
  return (
    <div className="preview-text">
      <p className="preview-note">{data.format} · {data.note}{data.truncated ? ' Only the beginning is shown.' : ''}</p>
      <div className="preview-scroll office-preview">
        {empty && <p className="muted">This document has no text to show.</p>}
        {data.blocks?.map((b, i) => (b.type === 'heading' ? React.createElement(`h${Math.min(4, b.level)}`, { key: i }, b.text) : b.type === 'para' ? <p key={i}>{b.text}</p> : (
          <table key={i} className="table md-table"><tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody></table>
        )))}
        {data.sheets && (
          <>
            {data.sheets.length > 1 && <div className="office-tabs" role="tablist">{data.sheets.map((sh, i) => <button key={i} type="button" role="tab" aria-selected={i === sheet} className={`btn btn-sm ${i === sheet ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSheet(i)}>{sh.name}</button>)}</div>}
            {data.sheets[sheet] && (
              <div className="csv-wrap">
                <table className="table csv"><tbody>{data.sheets[sheet]!.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody></table>
                {data.sheets[sheet]!.truncated && <p className="preview-note">Showing the first 200 rows.</p>}
              </div>
            )}
          </>
        )}
        {data.slides?.map((sl) => (
          <section key={sl.index} className="slide" aria-label={`Slide ${sl.index}`}>
            <h4>Slide {sl.index}</h4>
            {sl.paragraphs.length ? sl.paragraphs.map((t, i) => <p key={i}>{t}</p>) : <p className="muted">No text on this slide.</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- e-book / comic / 3D model */

function EbookPreview({ entry }: { entry: FileEntry }) {
  const [info, setInfo] = useState<{ title?: string; author?: string; spineCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    call<EbookManifest>('ebook:open', { path: entry.path }).then(
      (m) => live && setInfo({ title: m.metadata.title, author: m.metadata.author, spineCount: m.spineCount }),
      (e) => live && setError((e as Error).message),
    );
    return () => { live = false; };
  }, [entry.path]);
  if (error) return <NoPreview entry={entry} reason={error} />;
  if (!info) return <Loading label="Reading e-book…" />;
  const open = async () => {
    setLoading(true);
    try {
      const manifest = await call<EbookManifest>('ebook:open', { path: entry.path });
      const pos = await call<{ index: number; scrollOffset?: number } | null>('ebook:position', { path: entry.path });
      openEbook(entry.path, manifest, pos?.index ?? 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="preview-none">
      <FileIcon entry={entry} size={44} />
      <p><strong>{info.title ?? entry.name}</strong></p>
      {info.author && <p className="muted small">{info.author}</p>}
      <p className="muted small">{info.spineCount} chapter{info.spineCount !== 1 ? 's' : ''}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={open} disabled={loading}>
        {loading ? 'Opening…' : 'Read'}
      </button>
    </div>
  );
}

function ComicPreview({ entry }: { entry: FileEntry }) {
  const [info, setInfo] = useState<{ pageCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    call<ComicManifest>('comic:open', { path: entry.path }).then(
      (m) => live && setInfo({ pageCount: m.pageCount }),
      (e) => live && setError((e as Error).message),
    );
    return () => { live = false; };
  }, [entry.path]);
  if (error) return <NoPreview entry={entry} reason={error} />;
  if (!info) return <Loading label="Reading comic…" />;
  const open = async () => {
    setLoading(true);
    try {
      const manifest = await call<ComicManifest>('comic:open', { path: entry.path });
      const pos = await call<{ index: number } | null>('comic:position', { path: entry.path });
      openComic(entry.path, manifest, pos?.index ?? 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="preview-none">
      <FileIcon entry={entry} size={44} />
      <p><strong>{entry.name}</strong></p>
      <p className="muted small">{info.pageCount} page{info.pageCount !== 1 ? 's' : ''}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={open} disabled={loading}>
        {loading ? 'Opening…' : 'Read'}
      </button>
    </div>
  );
}

function Model3DPreview({ entry }: { entry: FileEntry }) {
  const [info, setInfo] = useState<Model3DInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    call<Model3DInfo>('model3d:info', { path: entry.path }).then(
      (i) => live && setInfo(i),
      (e) => live && setError((e as Error).message),
    );
    return () => { live = false; };
  }, [entry.path]);
  if (error) return <NoPreview entry={entry} reason={error} />;
  if (!info) return <Loading label="Reading model…" />;
  const open = async () => {
    setLoading(true);
    try {
      const i = await call<Model3DInfo>('model3d:info', { path: entry.path });
      openModel(entry.path, i);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="preview-none">
      <FileIcon entry={entry} size={44} />
      <p><strong>{entry.name}</strong></p>
      <p className="muted small">{info.format.toUpperCase()}{info.fileSize !== undefined ? ` · ${(info.fileSize / 1048576).toFixed(1)} MB` : ''}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={open} disabled={loading}>
        {loading ? 'Opening…' : 'View 3D model'}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- full-screen viewer launcher */

function ViewerButton({ entry }: { entry: FileEntry }) {
  const start = () => {
    const pane = activePane();
    const listing = listings.get()[listingKeyFor(ws.get().activeTabId, pane)];
    const siblings = (listing?.entries ?? []).filter((e) => e.kind === 'file' && ['image', 'video'].includes(previewKind(e)));
    const list = siblings.some((e) => e.path === entry.path) ? siblings : [entry];
    openViewer(list, list.findIndex((e) => e.path === entry.path));
  };
  return <IconButton icon="fullscreen" label="Open in viewer (← → previous and next, Space slideshow)" onClick={start} />;
}

/* ---------------------------------------------------------------- fonts */

interface FontInfoView { format: string; outlines?: string; family?: string; subfamily?: string; fullName?: string; postscriptName?: string; version?: string; designer?: string; manufacturer?: string; copyright?: string; license?: string; typographicFamily?: string; typographicSubfamily?: string; glyphCount?: number; warnings: string[] }

const FONT_SAMPLE = 'The quick brown fox jumps over the lazy dog';
const FONT_PRESETS: Array<{ label: string; text: string }> = [
  { label: 'Pangram', text: 'The quick brown fox jumps over the lazy dog' },
  { label: 'Alphabet', text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz' },
  { label: 'Numbers', text: '0123456789 +-*/= .,;:!? @#$%^&()[]{}' },
  { label: 'Lorem', text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' },
  { label: 'Pangram DE', text: 'Victor jagt zwolf Boxkampfer quer uber den grossen Sylter Deich' },
];

interface GlyphEntry { cp: number; char: string }
interface FontGlyphsResult { glyphs: GlyphEntry[]; total: number; offset: number; hasMore: boolean }

/**
 * Font preview: names from the font's name table (read in the main process), and samples drawn
 * with the font loaded into this window only (FontFace from orbis-media://; never installed).
 * Enhanced with size slider, preset samples, and character glyph grid.
 */
function FontPreview({ entry }: { entry: FileEntry }) {
  const [info, setInfo] = useState<FontInfoView | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sample, setSample] = useState(FONT_SAMPLE);
  const [fontSize, setFontSize] = useState(36);
  const [showGlyphs, setShowGlyphs] = useState(false);
  const [glyphs, setGlyphs] = useState<GlyphEntry[]>([]);
  const [glyphTotal, setGlyphTotal] = useState(0);
  const [glyphOffset, setGlyphOffset] = useState(0);
  const [glyphLoading, setGlyphLoading] = useState(false);

  useEffect(() => {
    let live = true;
    let release: (() => void) | undefined;
    call<FontInfoView>('font:info', { path: entry.path }).then((d) => live && setInfo(d), (e) => live && setInfoError((e as Error).message));
    void loadFontFace(entry.path).then(
      (f) => {
        if (!live) return f.release();
        release = f.release;
        setFamily(f.family);
      },
      () => live && setLoadError('The font could not be loaded for display; it may be damaged or use an unsupported format.'),
    );
    return () => {
      live = false;
      release?.();
    };
  }, [entry.path]);

  const loadGlyphs = (offset: number) => {
    setGlyphLoading(true);
    call<FontGlyphsResult>('font:glyphs', { path: entry.path, offset, limit: 200 }).then(
      (r) => {
        setGlyphs(offset === 0 ? r.glyphs : (prev) => [...prev, ...r.glyphs]);
        setGlyphTotal(r.total);
        setGlyphOffset(offset + r.glyphs.length);
        setGlyphLoading(false);
      },
      () => setGlyphLoading(false),
    );
  };

  const toggleGlyphs = () => {
    if (!showGlyphs && glyphs.length === 0) loadGlyphs(0);
    setShowGlyphs((v) => !v);
  };

  if (infoError && loadError) return <NoPreview entry={entry} reason={infoError} />;
  if (!info && !infoError) return <Loading label="Reading font…" />;
  const title = info?.fullName || [info?.family, info?.subfamily].filter(Boolean).join(' ') || entry.name;
  const face = family ? { fontFamily: `"${family}", var(--font-ui)` } : undefined;
  const text = sample.trim() ? sample : FONT_SAMPLE;
  const kindLine = [info?.typographicFamily ?? info?.family, info?.typographicSubfamily ?? info?.subfamily, info ? (info.outlines ? `${info.format} (${info.outlines} outlines)` : info.format) : undefined].filter(Boolean).join(' · ');
  return (
    <div className="preview-font">
      <header className="font-head">
        <h3 className="font-name" style={face}>{title}</h3>
        {kindLine && <p className="muted small">{kindLine}</p>}
        {info?.glyphCount !== undefined && <p className="font-glyphs small tabular"><strong>{info.glyphCount.toLocaleString()}</strong> glyphs</p>}
      </header>
      {infoError && <p className="warning-text small">{infoError}</p>}
      {loadError && <p className="warning-text small">{loadError}</p>}
      {info && (
        <dl className="font-meta">
          {info.version && <><dt>Version</dt><dd>{info.version.replace(/^Version\s*/i, '')}</dd></>}
          {info.postscriptName && <><dt>PostScript name</dt><dd className="mono">{info.postscriptName}</dd></>}
          {info.designer && <><dt>Designer</dt><dd>{info.designer}</dd></>}
          {info.manufacturer && <><dt>Maker</dt><dd>{info.manufacturer}</dd></>}
          {info.copyright && <><dt>Copyright</dt><dd>{info.copyright}</dd></>}
          {info.license && <><dt>License</dt><dd className="font-license">{info.license}</dd></>}
        </dl>
      )}

      <div className="font-presets">
        {FONT_PRESETS.map((p) => (
          <button key={p.label} type="button" className={`btn btn-xs ${sample === p.text ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSample(p.text)}>{p.label}</button>
        ))}
      </div>

      <TextField id="font-sample-text" label="Sample text" value={sample} maxLength={300} onChange={(e) => setSample(e.target.value)} />

      <div className="font-size-slider">
        <label className="small muted" htmlFor="font-size-range">Size: <strong className="tabular">{fontSize} px</strong></label>
        <input id="font-size-range" type="range" min={12} max={120} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
      </div>

      <div className="font-live-sample" style={{ ...face, fontSize }}>
        {text}
      </div>

      <p className="font-charset" style={face}>ABCDEFGHIJKLMNOPQRSTUVWXYZ<br />abcdefghijklmnopqrstuvwxyz<br />0123456789 .,;:!?&amp;@()</p>

      <div className="font-glyph-section">
        <button type="button" className="btn btn-default btn-sm" onClick={toggleGlyphs}>
          {showGlyphs ? 'Hide character grid' : 'Show character grid'}
        </button>
        {showGlyphs && (
          <div className="font-glyph-grid" style={face}>
            {glyphs.map((g) => (
              <div key={g.cp} className="font-glyph-cell" title={`U+${g.cp.toString(16).toUpperCase().padStart(4, '0')} ${g.char}`}>
                <span className="font-glyph-char">{g.char}</span>
                <span className="font-glyph-code">{g.cp.toString(16).toUpperCase().padStart(4, '0')}</span>
              </div>
            ))}
            {glyphLoading && <div className="font-glyph-loading muted small">Loading…</div>}
            {!glyphLoading && glyphOffset < glyphTotal && (
              <button type="button" className="btn btn-ghost btn-xs font-glyph-more" onClick={() => loadGlyphs(glyphOffset)}>
                Load more ({glyphTotal - glyphOffset} remaining)
              </button>
            )}
          </div>
        )}
      </div>

      <p className="muted small">Shown in this window only; the font is not installed.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- archive & folder */

function ArchivePreview({ entry }: { entry: FileEntry }) {
  const [data, setData] = useState<{ format: string; supported: boolean; entries: Array<{ name: string; size?: number; unsafe?: string; kind: string }>; totalSize: number; warnings: string[]; encrypted?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    call<NonNullable<typeof data>>('tool:archiveList', { path: entry.path }).then(
      (d) => live && setData(d),
      (e) => live && setError(e instanceof UiError && e.shape.needsPassword ? 'This archive is password-protected and its file names are encrypted. Use Browse archive to enter the password.' : (e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [entry.path]);
  if (error) return <NoPreview entry={entry} reason={error} />;
  if (!data) return <Loading label="Reading archive…" />;
  if (!data.supported) return <NoPreview entry={entry} reason={data.warnings[0]} />;
  const unsafe = data.entries.filter((e) => e.unsafe).length;
  return (
    <div className="preview-archive">
      <p className="muted">{data.format.toUpperCase()} · {formatCount(data.entries.length, 'entry', 'entries')}{data.totalSize ? ` · ${formatBytes(data.totalSize)} uncompressed` : ''}{data.encrypted ? ' · password-protected' : ''}</p>
      {unsafe > 0 && <p className="warning-text">{unsafe} unsafe entr{unsafe === 1 ? 'y' : 'ies'} would be skipped on extraction.</p>}
      <ul className="archive-mini">
        {data.entries.slice(0, 60).map((e) => <li key={e.name} className={e.unsafe ? 'is-missing' : ''}><span className="mono">{e.name}</span><span className="muted tabular">{e.size !== undefined ? formatBytes(e.size) : ''}</span></li>)}
      </ul>
      {data.entries.length > 60 && <p className="muted small">…and {data.entries.length - 60} more. Use Browse archive to see everything.</p>}
    </div>
  );
}

function FolderPreview({ entry }: { entry: FileEntry }) {
  const [size, setSize] = useState<{ bytes: number; files: number; directories: number; complete: boolean; errors: number; symlinksSkipped: number } | null>(null);
  const [job, setJob] = useState<{ jobId: string; cancel: () => void } | null>(null);
  const paused = useJobPaused(job?.jobId);
  useEffect(() => () => job?.cancel(), [job]);
  const measure = () => {
    const j = runJob<NonNullable<typeof size>>((jobId) => call('fs:folderSize', { path: entry.path, jobId }), (p) => setSize(p as NonNullable<typeof size>));
    setJob({ jobId: j.jobId, cancel: j.cancel });
    j.promise.then((r) => {
      setJob(null);
      if (r.value) setSize(r.value);
    }, () => setJob(null));
  };
  return (
    <div className="preview-none">
      <FileIcon entry={entry} size={48} />
      {size ? (
        <p className="tabular">
          {formatBytes(size.bytes)} in {formatCount(size.files, 'file')} and {formatCount(size.directories, 'folder')}
          {!size.complete && <span className="muted"> {job ? (paused ? '· paused' : '· counting…') : '· incomplete'}</span>}
          {size.errors > 0 && <span className="warning-text"> · {size.errors} unreadable</span>}
        </p>
      ) : (
        <p className="muted">Folder size is calculated on request.</p>
      )}
      {job ? <><JobPauseButton jobId={job.jobId} size="sm" /><button type="button" className="btn btn-default btn-sm" onClick={job.cancel}>Stop</button></> : <button type="button" className="btn btn-default btn-sm" onClick={measure}>{size ? 'Recalculate' : 'Calculate size'}</button>}
    </div>
  );
}

/** Safe binary inspection: first 256 bytes as hex + ASCII. */
function HexPeek({ path }: { path: string }) {
  const [hex, setHex] = useState<string | null>(null);
  if (!hex) return <button type="button" className="link-btn" onClick={() => void call<string>('fs:readHead', { path, bytes: 256 }).then((b64) => setHex(b64), () => setHex(''))}>Inspect first bytes</button>;
  const bytes = Uint8Array.from(atob(hex), (c) => c.charCodeAt(0));
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = [...bytes.slice(i, i + 16)];
    rows.push(`${i.toString(16).padStart(4, '0')}  ${chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(48)}  ${chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')}`);
  }
  return <pre className="hex">{rows.join('\n')}</pre>;
}

/* ---------------------------------------------------------------- full-screen media viewer and slideshow */

/** The viewer opened from previews and the Start slideshow command (one per window). */
export function ViewerHost() {
  const open = useStore(viewer, (v) => v.open);
  if (!open) return null;
  return <MediaViewer key={open.key} entries={open.entries} index={open.index} slideshow={open.slideshow} onIndex={setViewerIndex} onClose={closeViewer} />;
}

/**
 * Full-window viewer with a slideshow: play/pause (Space), interval, shuffle, repeat, optional
 * videos (each plays to its end), window full screen (Esc leaves it), previous/next. Every change
 * is announced to screen readers; with reduced motion images change without a cross-fade.
 */
export function MediaViewer({ entries, index, onIndex, onClose, slideshow = false }: { entries: FileEntry[]; index: number; onIndex: (i: number) => void; onClose: () => void; slideshow?: boolean }) {
  const entry = entries[index]!;
  const ref = useRef<HTMLDivElement>(null);
  const [prefs, setPrefsState] = useState<SlideshowPrefs>(loadSlideshowPrefs);
  const setPrefs = (patch: Partial<SlideshowPrefs>) => setPrefsState((p) => {
    const next = { ...p, ...patch };
    saveSlideshowPrefs(next);
    return next;
  });
  const [playing, setPlaying] = useState(slideshow);
  const [order, setOrder] = useState<number[]>(() => (prefs.shuffle ? shuffledOrder(entries.length, index) : entries.map((_, i) => i)));
  const [announcement, setAnnouncement] = useState('');
  const [videoFailed, setVideoFailed] = useState(false);
  const fullscreen = useStore(app, (x) => x.windowState.fullscreen);
  const enteredFullscreen = useRef(false);
  const kind = previewKind(entry);
  const pos = Math.max(0, order.indexOf(index));
  const playable = (i: number) => {
    const k = previewKind(entries[i]!);
    return k === 'image' || (prefs.includeVideos && k === 'video');
  };
  // A repeated message gets a no-break space so screen readers announce it again.
  const say = (text: string) => setAnnouncement((prev) => (prev === text ? `${text}\u00a0` : text));

  // Modal: focus moves in, stays in (Tab cycles inside the viewer) and returns to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => opener?.focus?.();
  }, []);
  // Leave window full screen when the viewer closes (only if the viewer entered it).
  useEffect(() => () => {
    if (enteredFullscreen.current) void call('win:setFullScreen', { on: false }).catch(() => undefined);
  }, []);

  /** Move through the order. Automatic steps skip what the slideshow does not show and stop at the end unless repeating. */
  const step = (dir: 1 | -1, auto: boolean) => {
    const n = order.length;
    const wrap = prefs.loop && (auto || playing);
    for (let k = 1; k <= n; k++) {
      let p = pos + dir * k;
      if (p < 0 || p >= n) {
        if (!wrap) break;
        p = ((p % n) + n) % n;
      }
      const i = order[p]!;
      if (auto && i === index) break;
      if (!auto || playable(i)) {
        onIndex(i);
        return;
      }
    }
    if (auto) {
      setPlaying(false);
      say(order.some(playable) && order.length > 1 ? 'Slideshow finished.' : prefs.includeVideos ? 'Nothing else to show in the slideshow.' : 'No other images to show in the slideshow.');
    }
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  // Announce each item; preload the next image so the slideshow does not wait for decoding.
  useEffect(() => {
    setVideoFailed(false);
    say(`${kind === 'video' ? 'Video' : kind === 'image' ? 'Image' : 'Item'} ${pos + 1} of ${entries.length}: ${entry.name}`);
    const next = order[(pos + 1) % order.length];
    if (next !== undefined && previewKind(entries[next]!) === 'image') new Image().src = mediaUrl(entries[next]!.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  // The slideshow's timer restarts whenever the item or a setting changes.
  useEffect(() => {
    if (!playing) return;
    // A video in the slideshow plays to its end (or is skipped after the interval if it cannot play).
    if (kind === 'video' && prefs.includeVideos && !videoFailed) return;
    const t = setTimeout(() => stepRef.current(1, true), prefs.intervalSec * 1000);
    return () => clearTimeout(t);
  }, [playing, index, kind, prefs.intervalSec, prefs.includeVideos, videoFailed]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      say('Slideshow paused.');
      return;
    }
    if (!order.some(playable)) {
      say(prefs.includeVideos ? 'Nothing here can be shown in a slideshow.' : 'No images to show in the slideshow.');
      return;
    }
    setPlaying(true);
    say(`Slideshow playing, ${prefs.intervalSec} seconds per image${prefs.shuffle ? ', shuffled' : ''}${prefs.loop ? ', repeating' : ''}.`);
    if (!playable(index)) stepRef.current(1, true);
  };
  const toggleShuffle = () => {
    const on = !prefs.shuffle;
    setPrefs({ shuffle: on });
    setOrder(on ? shuffledOrder(entries.length, index) : entries.map((_, i) => i));
    say(on ? 'Shuffle on.' : 'Shuffle off.');
  };
  const toggleFullscreen = () => {
    const on = !fullscreen;
    if (on) enteredFullscreen.current = true;
    void call('win:setFullScreen', { on }).catch(() => undefined);
  };
  const atStart = pos === 0 && !(prefs.loop && playing);
  const atEnd = pos === order.length - 1 && !(prefs.loop && playing);

  return createPortal(
    <div
      ref={ref}
      className={`media-viewer ${playing ? 'is-playing' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${entry.name}${playing ? ' (slideshow)' : ''}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        const el = e.target as HTMLElement;
        const typing = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
        if (e.key === 'Tab') {
          const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), video, audio, [tabindex]:not([tabindex="-1"])') ?? [])];
          const first = items[0];
          const last = items[items.length - 1];
          if (!first || !last) e.preventDefault();
          else if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          // Esc leaves full screen first; a second Esc closes the viewer.
          if (fullscreen) void call('win:setFullScreen', { on: false }).catch(() => undefined);
          else onClose();
        } else if (e.key === ' ' && !typing) {
          e.preventDefault();
          togglePlay();
        } else if (e.key === 'ArrowRight' && !typing) {
          if (!atEnd) step(1, false);
        } else if (e.key === 'ArrowLeft' && !typing) {
          if (!atStart) step(-1, false);
        }
        // The viewer is modal: file-list shortcuts do not act behind it.
        e.stopPropagation();
      }}
    >
      <div className="mv-bar">
        <span className="ellipsis mv-title" title={entry.name}>{entry.name}</span>
        <span className="muted tabular mv-count">{pos + 1} / {entries.length}</span>
        <span className="spacer" />
        <div className="mv-slideshow" role="group" aria-label="Slideshow">
          <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause slideshow' : 'Play slideshow'} shortcut="Space" active={playing} onClick={togglePlay} />
          <select className="input mv-interval" value={prefs.intervalSec} onChange={(e) => setPrefs({ intervalSec: Number(e.target.value) })} aria-label="Seconds per image" title="Seconds per image">
            {SLIDESHOW_INTERVALS.map((n) => <option key={n} value={n}>{n} s</option>)}
          </select>
          <IconButton icon="shuffle" label="Shuffle" active={prefs.shuffle} onClick={toggleShuffle} />
          <IconButton icon="loop" label="Repeat from the start" active={prefs.loop} onClick={() => setPrefs({ loop: !prefs.loop })} />
          <IconButton icon="fileVideo" label="Include videos (each plays to its end)" active={prefs.includeVideos} onClick={() => setPrefs({ includeVideos: !prefs.includeVideos })} />
        </div>
        <IconButton icon={fullscreen ? 'exitFullscreen' : 'fullscreen'} label={fullscreen ? 'Leave full screen' : 'Full screen'} shortcut={fullscreen ? 'Esc' : undefined} onClick={toggleFullscreen} />
        <IconButton icon="close" label="Close viewer" shortcut={fullscreen ? undefined : 'Esc'} onClick={onClose} />
      </div>
      <div className="mv-stage">
        <IconButton className="mv-nav prev" icon="back" label="Previous" disabled={atStart} onClick={() => step(-1, false)} />
        <div key={entry.path} className={`mv-item ${playing ? 'mv-fade' : ''}`} data-path={entry.path}>
          {kind === 'image' ? <ImagePreview entry={entry} large />
            : kind === 'video' || kind === 'audio' ? <MediaPreview entry={entry} kind={kind} inViewer autoPlay={playing && kind === 'video' && prefs.includeVideos} onEnded={() => playing && prefs.includeVideos && stepRef.current(1, true)} onFailed={() => setVideoFailed(true)} />
            : <Preview entry={entry} />}
        </div>
        <IconButton className="mv-nav next" icon="forward" label="Next" disabled={atEnd} onClick={() => step(1, false)} />
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    </div>,
    document.body,
  );
}

export { categoryOfEntry };
export function EmptyPreview() {
  return <EmptyState icon="info" title="Select an item to see its details" />;
}
