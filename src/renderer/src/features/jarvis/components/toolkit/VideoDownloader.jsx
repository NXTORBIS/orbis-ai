import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Video, Clipboard, Link2, Download, X, RotateCw, Trash2, FolderOpen,
  Pause, Play, AlertTriangle, CheckCircle2, Loader2, Film, Music2, FileVideo,
} from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, fmtBytes } from './shared';
import { cn } from '@jarvis/lib/utils';
import {
  classifyUrl, probeUrl, loadVideoMetadata, isDownloadableMedia,
  getExtension, fmtDuration, qualityLabel, containerLabel,
} from '@jarvis/lib/videoDownloader/sources';

const STATUSES = {
  queued: 'Queued', active: 'Downloading', paused: 'Paused',
  completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
};

let uid = 0;
const nextId = () => `dl-${++uid}-${Date.now()}`;

function deriveFilename(url, ext) {
  try {
    const path = new URL(url).pathname;
    const base = path.split('/').pop() || 'video';
    return base.includes('.') ? base : `${base || 'video'}.${ext || 'mp4'}`;
  } catch {
    return `video.${ext || 'mp4'}`;
  }
}

export default function VideoDownloader() {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState(null);      // { url, title, duration, width, height, size, container, type, thumbnail, ext }
  const [probeError, setProbeError] = useState('');
  const [probing, setProbing] = useState(false);
  const [queue, setQueue] = useState([]);            // download records
  const abortRef = useRef(new Map());                // id -> AbortController
  const [dragOver, setDragOver] = useState(false);

  // ---- URL preview / validation ----------------------------------------
  const inspect = useCallback(async (raw) => {
    setProbeError(''); setPreview(null);
    const trimmed = (raw || '').trim();
    if (!trimmed) return;
    const cls = classifyUrl(trimmed);
    if (cls.kind === 'invalid') { setProbeError(cls.reason); return; }
    if (cls.kind === 'restricted') {
      setProbeError(cls.reason);
      setPreview({ url: trimmed, restricted: true, name: cls.name });
      return;
    }

    setProbing(true);
    const signal = new AbortController();
    try {
      const [probe, meta] = await Promise.all([
        probeUrl(trimmed, signal.signal),
        loadVideoMetadata(trimmed, signal.signal),
      ]);

      const ext = getExtension(trimmed) || (probe?.contentType && probe.contentType.split('/')[1]) || 'mp4';
      const downloadable = isDownloadableMedia(probe?.contentType, ext);

      if (!downloadable && cls.kind === 'unknown') {
        setProbeError('This URL does not point to a directly downloadable video file, and no authorized download method is available for it. Paste a direct link to a video file you own or have permission to download.');
        setProbing(false);
        return;
      }

      setPreview({
        url: trimmed,
        title: deriveFilename(trimmed, ext),
        duration: meta?.duration || 0,
        width: meta?.width || 0,
        height: meta?.height || 0,
        size: probe?.size || 0,
        container: containerLabel(ext, probe?.contentType),
        type: probe?.contentType?.startsWith('audio/') ? 'audio' : 'video',
        thumbnail: meta?.thumbnail || null,
        ext,
        contentType: probe?.contentType || '',
      });
    } catch {
      setProbeError('Could not inspect this URL. It may be private, removed, or blocked by the server (CORS).');
    } finally {
      setProbing(false);
    }
  }, []);

  const onPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setUrl(text); inspect(text); }
    } catch { /* clipboard read blocked */ }
  }, [inspect]);

  // ---- download manager -------------------------------------------------
  const startDownload = useCallback((item) => {
    const id = item.id || nextId();
    const record = { ...item, id, status: 'active', received: 0, speed: 0, eta: 0, error: '', objectUrl: '', startedAt: Date.now() };
    setQueue((q) => [record, ...q.filter((d) => d.id !== id)]);

    const controller = new AbortController();
    abortRef.current.set(id, controller);

    (async () => {
      try {
        const res = await fetch(record.url, { signal: controller.signal, redirect: 'follow' });
        if (!res.ok) throw new Error(`Server responded ${res.status}.`);
        const total = Number(res.headers.get('content-length')) || record.size || 0;
        const reader = res.body?.getReader();
        if (!reader) throw new Error('Streaming is not supported for this response.');
        const chunks = [];
        let received = 0, lastT = performance.now(), lastB = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) { chunks.push(value); received += value.byteLength; }
          const now = performance.now();
          const dt = (now - lastT) / 1000;
          if (dt >= 0.4) {
            const speed = (received - lastB) / dt;
            lastT = now; lastB = received;
            setQueue((q) => q.map((d) => d.id === id ? {
              ...d, received, total: total || received, speed,
              eta: speed > 0 ? (total - received) / speed : 0,
            } : d));
          }
        }
        const blob = new Blob(chunks, { type: record.contentType || 'video/mp4' });
        const objectUrl = URL.createObjectURL(blob);
        setQueue((q) => q.map((d) => d.id === id ? {
          ...d, status: 'completed', received: blob.size, total: blob.size,
          speed: 0, eta: 0, objectUrl, blobSize: blob.size,
        } : d));
      } catch (e) {
        if (e.name === 'AbortError') return; // cancelled — state already set
        const msg = e.message || 'Network failure.';
        setQueue((q) => q.map((d) => d.id === id ? {
          ...d, status: 'failed',
          error: /Failed to fetch|NetworkError|CORS/i.test(msg)
            ? 'The server blocked the download (CORS or network). The source may not permit cross-origin downloads.'
            : msg,
        } : d));
      } finally {
        abortRef.current.delete(id);
      }
    })();
  }, []);

  const addFromPreview = useCallback(() => {
    if (!preview || preview.restricted) return;
    const item = {
      url: preview.url,
      filename: preview.title,
      size: preview.size,
      contentType: preview.contentType,
      ext: preview.ext,
      type: preview.type,
    };
    startDownload(item);
  }, [preview, startDownload]);

  const cancel = useCallback((id) => {
    abortRef.current.get(id)?.abort();
    abortRef.current.delete(id);
    setQueue((q) => q.map((d) => d.id === id ? { ...d, status: 'cancelled', speed: 0, eta: 0 } : d));
  }, []);

  const retry = useCallback((d) => {
    if (!d) return;
    setQueue((q) => q.filter((x) => x.id !== d.id));
    startDownload({ url: d.url, filename: d.filename, size: d.size, contentType: d.contentType, ext: d.ext, type: d.type });
  }, [startDownload]);

  const remove = useCallback((id) => {
    abortRef.current.get(id)?.abort();
    abortRef.current.delete(id);
    setQueue((q) => {
      const target = q.find((d) => d.id === id);
      if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
      return q.filter((d) => d.id !== id);
    });
  }, []);

  const open = useCallback((d) => {
    if (d.objectUrl) {
      const a = document.createElement('a');
      a.href = d.objectUrl; a.download = d.filename; a.click();
    }
  }, []);

  useEffect(() => () => {
    abortRef.current.forEach((c) => c.abort());
    abortRef.current.clear();
  }, []);

  // ---- UI ---------------------------------------------------------------
  return (
    <div className="space-y-5">
      <ToolHeader icon={Video} title="Video Downloader" desc="Download video files you own or have permission to download. Direct links to public video files are supported. Restricted platforms and DRM-protected content are not bypassed." />

      {/* URL input */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
          if (text) { setUrl(text); inspect(text); }
        }}
        className={cn(
          'rounded-xl border-2 border-dashed p-4 transition-colors',
          dragOver ? 'border-cyan-j bg-cyan-j/5' : 'border-border bg-card/50'
        )}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') inspect(url); }}
              placeholder="Paste a direct video file URL (https://…/video.mp4)"
              className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2.5 text-sm outline-none focus:border-cyan-j"
            />
          </div>
          <Button variant="outline" size="sm" onClick={onPaste} className="gap-1.5"><Clipboard className="size-4" /> Paste</Button>
          <Button size="sm" onClick={() => inspect(url)} disabled={probing || !url.trim()} className="gap-1.5">
            {probing ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />} Inspect
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Drag a link here, or paste a direct URL to a video file you have the rights to download. The tool never bypasses DRM, paywalls, or platform restrictions.</p>
      </div>

      {/* Error / restricted notice */}
      {probeError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{probeError}</span>
        </div>
      )}

      {/* Preview */}
      {preview && !preview.restricted && (
        <div className="rounded-xl border border-border/70 bg-card/50 p-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="shrink-0">
              {preview.thumbnail ? (
                <img src={preview.thumbnail} alt="thumbnail" className="h-28 w-50 rounded-lg border border-border object-cover" style={{ width: 160 }} />
              ) : (
                <div className="grid h-28 w-40 place-items-center rounded-lg border border-border bg-muted/30">
                  {preview.type === 'audio' ? <Music2 className="size-8 text-muted-foreground" /> : <FileVideo className="size-8 text-muted-foreground" />}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" title={preview.title}>{preview.title}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{preview.url}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Duration" value={fmtDuration(preview.duration)} mono />
                <Stat label="Resolution" value={preview.width ? `${preview.width}×${preview.height}` : '—'} sub={qualityLabel(preview.width, preview.height)} mono />
                <Stat label="Size" value={preview.size ? fmtBytes(preview.size) : 'Unknown'} mono />
                <Stat label="Format" value={preview.container} sub={preview.type === 'audio' ? 'Audio only' : 'Video + Audio'} mono />
              </div>
            </div>
          </div>

          {/* Format / quality cards — only what the source actually provides */}
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Available format</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <FormatCard
                active
                icon={preview.type === 'audio' ? Music2 : FileVideo}
                title={preview.container}
                quality={qualityLabel(preview.width, preview.height)}
                kind={preview.type === 'audio' ? 'Audio only' : 'Video + Audio'}
                note="Original — downloaded as-is from the source"
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Only formats the source officially provides are shown. Quality alternatives (e.g. 720p, 1080p) appear only when the source exposes them.</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={addFromPreview} className="gap-1.5"><Download className="size-4" /> Download</Button>
          </div>
        </div>
      )}

      {/* Download manager */}
      <div className="rounded-xl border border-border/70 bg-card/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Download Manager</h3>
          <span className="text-[11px] text-muted-foreground">{queue.length} item{queue.length === 1 ? '' : 's'}</span>
        </div>
        {queue.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No downloads yet. Inspect a direct video URL above to begin.</div>
        ) : (
          <div className="space-y-2.5">
            {queue.map((d) => <DownloadRow key={d.id} d={d} onCancel={cancel} onRetry={retry} onRemove={remove} onOpen={open} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function FormatCard({ icon: Icon, title, quality, kind, note, active }) {
  return (
    <div className={cn('rounded-lg border p-3 transition-colors', active ? 'border-cyan-j bg-cyan-j/5' : 'border-border bg-background/40')}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-cyan-j" />
        <span className="text-sm font-medium">{title}</span>
        {active && <CheckCircle2 className="ml-auto size-4 text-cyan-j" />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>Quality: {quality}</span>
        <span>· {kind}</span>
      </div>
      {note && <div className="mt-1 text-[11px] text-muted-foreground/70">{note}</div>}
    </div>
  );
}

function DownloadRow({ d, onCancel, onRetry, onRemove, onOpen }) {
  const pct = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
  const isActive = d.status === 'active';
  const isDone = d.status === 'completed';
  const isFailed = d.status === 'failed';
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium" title={d.filename}>{d.filename}</span>
            <StatusBadge status={d.status} />
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{d.url}</div>
          {isFailed && d.error && (
            <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{d.error}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isActive && (
            <Button size="icon" variant="ghost" className="size-8" onClick={() => onCancel(d.id)} title="Cancel"><X className="size-4" /></Button>
          )}
          {isFailed && (
            <Button size="icon" variant="ghost" className="size-8" onClick={() => onRetry(d)} title="Retry"><RotateCw className="size-4" /></Button>
          )}
          {isDone && (
            <Button size="icon" variant="ghost" className="size-8" onClick={() => onOpen(d)} title="Open file"><FolderOpen className="size-4" /></Button>
          )}
          <Button size="icon" variant="ghost" className="size-8" onClick={() => onRemove(d.id)} title="Remove"><Trash2 className="size-4" /></Button>
        </div>
      </div>

      {(isActive || isDone) && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-cyan-j transition-[width] duration-300"
              style={{ width: `${isDone ? 100 : pct}%` }}
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{fmtBytes(d.received)}{d.total ? ` / ${fmtBytes(d.total)}` : ''}</span>
            {isActive && d.speed > 0 && <span>{fmtBytes(d.speed)}/s</span>}
            {isActive && d.eta > 0 && <span>~{fmtDuration(d.eta)} left</span>}
            {isDone && d.blobSize && <span>{fmtBytes(d.blobSize)}</span>}
            {isActive && <span>{pct}%</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    queued: { icon: Loader2, cls: 'text-muted-foreground' },
    active: { icon: Download, cls: 'text-cyan-j' },
    paused: { icon: Pause, cls: 'text-amber-500' },
    completed: { icon: CheckCircle2, cls: 'text-emerald-500' },
    failed: { icon: AlertTriangle, cls: 'text-amber-600' },
    cancelled: { icon: X, cls: 'text-muted-foreground' },
  };
  const m = map[status] || map.queued;
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide', m.cls)}>
      <Icon className={cn('size-3', status === 'active' && 'animate-pulse')} />
      {STATUSES[status]}
    </span>
  );
}