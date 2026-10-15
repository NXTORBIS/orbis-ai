import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../api';
import { Icon } from '../ui/Icon';
import { formatBytes, formatDate } from '../ui/format';
import type { QuickLookData } from '../../shared/quicklook';
import { fileUri } from '../../shared/pathFormats';

/** Global quick-look state: which file is being previewed (null = closed). */
let quickLookPath: string | null = null;
let quickLookListeners: Array<() => void> = [];
let quickLookNeighbors: { prev: () => string | undefined; next: () => string | undefined } | null = null;

export function isQuickLookOpen(): boolean {
  return quickLookPath !== null;
}

export function openQuickLook(filePath: string, neighbors?: { prev: () => string | undefined; next: () => string | undefined }): void {
  quickLookPath = filePath;
  quickLookNeighbors = neighbors ?? null;
  quickLookListeners.forEach((l) => l());
}

export function closeQuickLook(): void {
  quickLookPath = null;
  quickLookNeighbors = null;
  quickLookListeners.forEach((l) => l());
}

export function toggleQuickLook(filePath: string, neighbors?: { prev: () => string | undefined; next: () => string | undefined }): void {
  if (quickLookPath === filePath) closeQuickLook();
  else openQuickLook(filePath, neighbors);
}

function useQuickLookState() {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    quickLookListeners.push(listener);
    return () => { quickLookListeners = quickLookListeners.filter((l) => l !== listener); };
  }, []);
  return quickLookPath;
}

/* ────────────────────────────── preview renderers ───────────────────────── */

function ImagePreview({ data }: { data: QuickLookData }) {
  if (!data.dataUrl) return <div className="ql-unsupported">Image too large to preview</div>;
  return <img className="ql-image" src={data.dataUrl} alt={data.name} />;
}

function VideoPreview({ data }: { data: QuickLookData }) {
  const src = fileUri(data.path);
  return (
    <video className="ql-video" controls autoPlay muted>
      <source src={src} type={data.mime} />
    </video>
  );
}

function AudioPreview({ data }: { data: QuickLookData }) {
  const src = fileUri(data.path);
  return (
    <div className="ql-audio-wrap">
      <Icon name="music" size={64} />
      <audio className="ql-audio" controls autoPlay>
        <source src={src} type={data.mime} />
      </audio>
    </div>
  );
}

function TextPreview({ data }: { data: QuickLookData }) {
  return (
    <div className="ql-text-wrap">
      <pre className="ql-text"><code>{data.textContent ?? '(empty)'}</code></pre>
    </div>
  );
}

function FontPreview({ data }: { data: QuickLookData }) {
  const fontFace = data.dataUrl
    ? `@font-face { font-family: 'ql-preview-font'; src: url('${data.dataUrl}'); }`
    : '';
  return (
    <div className="ql-font-wrap">
      {fontFace && <style>{fontFace}</style>}
      <p className="ql-font-sample" style={{ fontFamily: fontFace ? "'ql-preview-font'" : 'inherit' }}>
        ABCDEFGHIJKLM<br />NOPQRSTUVWXYZ<br />
        abcdefghijklm<br />nopqrstuvwxyz<br />
        0123456789<br />
        The quick brown fox jumps over the lazy dog.
      </p>
    </div>
  );
}

function UnsupportedPreview({ data: _data }: { data: QuickLookData }) {
  return (
    <div className="ql-unsupported">
      <Icon name="file" size={48} />
      <p>No preview available for this file type.</p>
    </div>
  );
}

function PreviewContent({ data }: { data: QuickLookData }) {
  switch (data.type) {
    case 'image': return <ImagePreview data={data} />;
    case 'video': return <VideoPreview data={data} />;
    case 'audio': return <AudioPreview data={data} />;
    case 'text': return <TextPreview data={data} />;
    case 'font': return <FontPreview data={data} />;
    case 'pdf': return <UnsupportedPreview data={data} />;
    default: return <UnsupportedPreview data={data} />;
  }
}

/* ────────────────────────────── overlay component ───────────────────────── */

export function QuickLookOverlay() {
  const currentPath = useQuickLookState();
  const [data, setData] = useState<QuickLookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const loadPreview = useCallback(async (filePath: string) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await call<QuickLookData>('quicklook:data', { path: filePath });
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentPath) void loadPreview(currentPath);
    else { setData(null); setError(null); }
  }, [currentPath, loadPreview]);

  useEffect(() => {
    if (!currentPath) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        closeQuickLook();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = quickLookNeighbors?.next();
        if (next) { quickLookPath = next; quickLookListeners.forEach((l) => l()); }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = quickLookNeighbors?.prev();
        if (prev) { quickLookPath = prev; quickLookListeners.forEach((l) => l()); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [currentPath]);

  if (!currentPath) return null;

  return (
    <div className="ql-overlay" ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) closeQuickLook(); }}>
      <div className="ql-panel glass-panel">
        <header className="ql-header">
          <div className="ql-header-info">
            <span className="ql-name" title={data?.name}>{data?.name ?? '...'}</span>
            {data && (
              <span className="ql-meta muted small">
                {formatBytes(data.size)} — {formatDate(data.modifiedMs)}
              </span>
            )}
          </div>
          <div className="ql-header-actions">
            {quickLookNeighbors && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                  const prev = quickLookNeighbors?.prev();
                  if (prev) { quickLookPath = prev; quickLookListeners.forEach((l) => l()); }
                }} aria-label="Previous file">
                  <Icon name="back" size={14} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                  const next = quickLookNeighbors?.next();
                  if (next) { quickLookPath = next; quickLookListeners.forEach((l) => l()); }
                }} aria-label="Next file">
                  <Icon name="forward" size={14} />
                </button>
              </>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeQuickLook} aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          </div>
        </header>

        <div className="ql-body">
          {loading && <div className="ql-loading"><Icon name="refresh" size={24} /><span>Loading preview...</span></div>}
          {error && <div className="ql-error"><Icon name="warning" size={24} /><span>{error}</span></div>}
          {data && !loading && <PreviewContent data={data} />}
        </div>
      </div>
    </div>
  );
}
