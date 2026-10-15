import React, { useEffect, useRef, useState } from 'react';
import { call, runJob } from '../../api';
import { app, closeDialog, confirm, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane, navigate, parentPath } from '../../state/workspace';
import { Button, Dialog, EmptyState, ErrorState, IconButton, Pill, ProgressBar, Segmented } from '../../ui/components';
import { formatBytes, formatCount, formatDate } from '../../ui/format';
import { startOperation } from '../../actions';
import { FolderPicker, JobPauseButton, useJobPaused } from './common';
import { thumbUrl } from '../FileViews';
import { mediaUrl } from '../Preview';
import { dHash, groupByHash, meanTone, type SimilarGroup, type Tone } from '../../../shared/similarity';
import { encodeImageInRenderer, smallBitmap } from '../videoThumbs';
import type { MediaMeta } from '../../../shared/media';

/* ---------------------------------------------------------------- similar images */

interface SimilarResult {
  groups: SimilarGroup[];
  hashes: Array<{ path: string; size: number; modifiedMs: number; hash: string; tone?: Tone }>;
  pending: Array<{ path: string; size: number; modifiedMs: number }>;
  scanned: number;
  complete: boolean;
  threshold: number;
}

const THRESHOLDS = [
  { value: '4', label: 'Very close' },
  { value: '8', label: 'Similar' },
  { value: '12', label: 'Loosely similar' },
];

export function SimilarImagesView() {
  const home = useStore(app, (s) => s.known.find((k) => k.id === 'pictures')?.path ?? s.known.find((k) => k.id === 'home')?.path ?? '/');
  const startDir = (() => {
    const l = activePane().history[activePane().index];
    return l?.kind === 'fs' ? l.path : home;
  })();
  const [root, setRoot] = useState(startDir);
  const [threshold, setThreshold] = useState('8');
  const [stage, setStage] = useState<{ text: string; frac?: number } | null>(null);
  const [result, setResult] = useState<{ groups: SimilarGroup[]; analysed: number; undecodable: number; complete: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<{ jobId: string; cancel: () => void } | null>(null);
  const paused = useJobPaused(job?.jobId);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState<[string, string] | null>(null);
  const cancelled = useRef(false);

  const scan = () => {
    setResult(null);
    setError(null);
    setMarked(new Set());
    cancelled.current = false;
    setStage({ text: 'Reading images…' });
    const j = runJob<SimilarResult>((jobId) => call('tool:similarImages', { roots: [root], threshold: Number(threshold), jobId }), (p) => {
      const pr = p as { scanned: number; hashed: number };
      setStage({ text: `Analysing · ${formatCount(pr.scanned, 'image')}` });
    }, 'Finding similar images');
    setJob({ jobId: j.jobId, cancel: () => { cancelled.current = true; j.cancel(); } });
    j.promise.then(async (r) => {
      if (!r.value) {
        setJob(null);
        setStage(null);
        return;
      }
      const v = r.value;
      // Formats the platform codec cannot read (WebP, GIF, AVIF…) are decoded here by Chromium.
      const extra: Array<{ path: string; hash: bigint; size: number; modifiedMs: number; tone: Tone }> = [];
      let undecodable = 0;
      for (const [i, f] of v.pending.entries()) {
        if (cancelled.current) break;
        setStage({ text: `Analysing other formats · ${i + 1} of ${v.pending.length}`, frac: (i + 1) / v.pending.length });
        try {
          const bmp = await smallBitmap(f.path);
          extra.push({ ...f, hash: dHash(bmp), tone: meanTone(bmp) });
        } catch {
          undecodable++;
        }
      }
      const all = [...v.hashes.map((h) => ({ ...h, hash: BigInt(`0x${h.hash}`) })), ...extra];
      setResult({ groups: groupByHash(all, Number(threshold)), analysed: all.length, undecodable, complete: v.complete && !cancelled.current });
      setJob(null);
      setStage(null);
    }, (err) => {
      setJob(null);
      setStage(null);
      setError((err as Error).message);
    });
  };

  const trashMarked = async () => {
    const list = [...marked];
    if (!(await confirm({ title: `Move ${formatCount(list.length, 'image')} to Trash?`, body: 'These are visually similar to images you are keeping, but they are not necessarily identical. Check each one first. You can restore them from the Trash.', confirmLabel: 'Move to Trash', detail: list.slice(0, 8) }))) return;
    await startOperation({ type: 'trash', sources: list, origin: 'similar-images' });
    setMarked(new Set());
  };

  return (
    <>
      <p className="muted">Finds pictures that look alike — resized, re-saved or lightly edited copies — using a perceptual fingerprint. Similar is not the same as identical: review every group yourself. Nothing is removed automatically.</p>
      <div className="tool-controls">
        <FolderPicker value={root} onChange={setRoot} label="Folder to search" />
        <Segmented label="How similar" value={threshold} onChange={setThreshold} options={THRESHOLDS} />
        {job ? <><JobPauseButton jobId={job.jobId} /><button type="button" className="btn btn-default btn-md" onClick={job.cancel}>Stop</button></> : <button type="button" className="btn btn-primary btn-md" onClick={scan}>Find similar images</button>}
      </div>
      {stage && <div className="tool-progress" role="status"><ProgressBar label="Finding similar images" value={stage.frac} tone={paused ? 'warning' : 'accent'} /><span className="tabular">{paused ? 'Paused · ' : ''}{stage.text}</span></div>}
      {error && <ErrorState title="The search failed" body={error} />}
      {result && (
        <>
          <div className="stat-strip">
            <div className="stat"><span className="stat-label">Images analysed</span><span className="stat-value tabular">{result.analysed.toLocaleString()}</span></div>
            <div className="stat"><span className="stat-label">Similar groups</span><span className="stat-value tabular">{result.groups.length.toLocaleString()}</span></div>
            <div className="stat-flags">{result.complete ? <Pill tone="success">Complete</Pill> : <Pill tone="warning">Partial</Pill>}{result.undecodable > 0 && <Pill tone="warning">{result.undecodable} could not be decoded</Pill>}</div>
          </div>
          {!result.groups.length ? <EmptyState icon="check" title="No similar images found" /> : (
            <>
              <div className="selection-bar sticky">
                <span>{marked.size ? `${formatCount(marked.size, 'image')} marked` : 'Mark images you want to remove; at least one image per group is always kept.'}</span>
                <span className="spacer" />
                <button type="button" className="btn btn-danger btn-sm" disabled={!marked.size} onClick={() => void trashMarked()}>Move marked to Trash…</button>
              </div>
              {result.groups.map((g, gi) => {
                const groupMarked = g.items.filter((i) => marked.has(i.path)).length;
                return (
                  <div key={gi} className="dup-group">
                    <div className="dup-head">
                      <strong>{formatCount(g.items.length, 'image')}</strong>
                      <Pill tone={g.maxDistance === 0 ? 'success' : 'accent'}>{g.maxDistance === 0 ? 'look identical' : `similar (difference ${g.maxDistance}/64)`}</Pill>
                      {g.items.length >= 2 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCompare([g.items[0]!.path, g.items[1]!.path])}>Compare first two</button>}
                    </div>
                    <div className="similar-grid">
                      {g.items.map((it) => {
                        const isMarked = marked.has(it.path);
                        const lastKept = !isMarked && groupMarked === g.items.length - 1;
                        return (
                          <div key={it.path} className={`similar-card ${isMarked ? 'marked' : ''}`}>
                            <img src={`${thumbUrl(it.path, 256)}&m=${it.modifiedMs}`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).src = mediaUrl(it.path))} />
                            <div className="mono small similar-name" title={it.path}>{it.path.split(/[\\/]/).pop()}</div>
                            <div className="muted small tabular">{formatBytes(it.size)} · {formatDate(it.modifiedMs)}</div>
                            <div className="tb-group wrap">
                              <label className="check"><input type="checkbox" checked={isMarked} disabled={lastKept} title={lastKept ? 'At least one image in each group is kept.' : undefined} onChange={(e) => {
                                const s = new Set(marked);
                                if (e.target.checked) s.add(it.path);
                                else s.delete(it.path);
                                setMarked(s);
                              }} /> Remove</label>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigate(activePane().id, { kind: 'fs', path: parentPath(it.path)! }, { select: it.path })}>Show</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
      {!result && !stage && !error && <EmptyState icon="similar" title="Choose a folder of pictures to look for similar images" />}
      {compare && <ImageCompareDialog left={compare[0]} right={compare[1]} onClose={() => setCompare(null)} />}
    </>
  );
}

/* ---------------------------------------------------------------- image compare */

export function ImageCompareDialog({ left, right, onClose }: { left: string; right: string; onClose: () => void }) {
  return (
    <Dialog title="Compare images" width={1180} onClose={onClose} className="dialog-wide">
      <ImageCompare left={left} right={right} />
    </Dialog>
  );
}

export function ImageCompare({ left, right }: { left: string; right: string }) {
  const [mode, setMode] = useState<'side' | 'slider' | 'difference'>('side');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [split, setSplit] = useState(50);
  const [meta, setMeta] = useState<[MediaMeta | null, MediaMeta | null]>([null, null]);
  const [sizes, setSizes] = useState<[number | undefined, number | undefined]>([undefined, undefined]);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => {
    void Promise.all([call<MediaMeta>('meta:read', { path: left }).catch(() => null), call<MediaMeta>('meta:read', { path: right }).catch(() => null)]).then((m) => setMeta(m as [MediaMeta | null, MediaMeta | null]));
    void Promise.all([call<{ size?: number }>('fs:stat', { path: left }).catch(() => ({ size: undefined })), call<{ size?: number }>('fs:stat', { path: right }).catch(() => ({ size: undefined }))]).then(([a, b]) => setSizes([a.size, b.size]));
  }, [left, right]);
  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  const handlers = {
    onWheel: (e: React.WheelEvent) => setZoom((z) => Math.max(0.1, Math.min(16, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))),
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (drag.current) setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
    },
    onPointerUp: () => (drag.current = null),
  };
  const row = (label: string, f: (m: MediaMeta | null, i: 0 | 1) => string | undefined) => {
    const a = f(meta[0], 0);
    const b = f(meta[1], 1);
    return <tr key={label}><th scope="row">{label}</th><td className={a !== b ? 'differs' : ''}>{a ?? '—'}</td><td className={a !== b ? 'differs' : ''}>{b ?? '—'}</td></tr>;
  };
  const name = (p: string) => p.split(/[\\/]/).pop();
  return (
    <div className="image-compare">
      <div className="tool-controls">
        <Segmented label="Comparison mode" value={mode} onChange={setMode} options={[{ value: 'side', label: 'Side by side' }, { value: 'slider', label: 'Slider' }, { value: 'difference', label: 'Difference' }]} />
        <span className="spacer" />
        <IconButton icon="zoomOut" label="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))} />
        <span className="tabular muted">{Math.round(zoom * 100)}%</span>
        <IconButton icon="zoomIn" label="Zoom in" onClick={() => setZoom((z) => Math.min(16, z * 1.25))} />
        <Button size="sm" variant="ghost" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</Button>
      </div>
      {mode === 'side' ? (
        <div className="ic-side">
          {[left, right].map((p) => (
            <div key={p} className="ic-stage" {...handlers}>
              <img src={mediaUrl(p)} alt={name(p)} draggable={false} style={{ transform }} />
              <span className="ic-label">{name(p)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="ic-stage ic-overlay" {...handlers}>
          <img src={mediaUrl(left)} alt={name(left)} draggable={false} style={{ transform }} />
          <img
            src={mediaUrl(right)}
            alt={name(right)}
            draggable={false}
            className="ic-top"
            style={{ transform, clipPath: mode === 'slider' ? `inset(0 0 0 ${split}%)` : undefined, mixBlendMode: mode === 'difference' ? 'difference' : undefined }}
          />
          {mode === 'slider' && <input type="range" className="ic-slider" min={0} max={100} value={split} aria-label="Divider position" onChange={(e) => setSplit(Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()} />}
          <span className="ic-label">{mode === 'difference' ? 'Black = identical pixels; bright = differences' : `${name(left)} | ${name(right)}`}</span>
        </div>
      )}
      <table className="table ic-meta">
        <thead><tr><th><span className="sr-only">Property</span></th><th>{name(left)}</th><th>{name(right)}</th></tr></thead>
        <tbody>
          {row('Dimensions', (m) => (m?.width && m.height ? `${m.width} × ${m.height}` : undefined))}
          {row('File size', (_m, i) => (sizes[i] !== undefined ? formatBytes(sizes[i]) : undefined))}
          {row('Format', (m) => m?.format)}
          {row('Taken', (m) => m?.exif?.takenAt)}
          {row('Camera', (m) => [m?.exif?.make, m?.exif?.model].filter(Boolean).join(' ') || undefined)}
          {row('Location data', (m) => (m ? (m.hasLocation ? 'Yes' : 'No') : undefined))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- conversion */

interface ConvertCaps { ffmpeg: { available: boolean; version?: string; presets: Array<{ id: string; label: string; kind: 'audio' | 'video' }>; note?: string } }
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;
const NATIVE_RE = /\.(png|jpe?g)$/i;
const MEDIA_RE = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|mp3|wav|flac|ogg|oga|opus|m4a|aac|wma|wmv)$/i;

export function ConvertDialog({ paths, dir }: { paths: string[]; dir: string }) {
  const images = paths.every((p) => IMAGE_RE.test(p));
  const media = paths.every((p) => MEDIA_RE.test(p));
  const [caps, setCaps] = useState<ConvertCaps | null>(null);
  const [imgFormat, setImgFormat] = useState<'png' | 'jpeg' | 'webp'>('jpeg');
  const [quality, setQuality] = useState(88);
  const [maxDim, setMaxDim] = useState('');
  const [preset, setPreset] = useState('');
  const [dest, setDest] = useState(dir);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void call<ConvertCaps>('convert:capabilities').then((c) => {
      setCaps(c);
      setPreset(c.ffmpeg.presets[0]?.id ?? '');
    }, toastError);
  }, []);
  const hasVideo = paths.some((p) => /\.(mp4|m4v|mov|webm|mkv|avi|ogv|wmv)$/i.test(p));
  const presets = (caps?.ffmpeg.presets ?? []).filter((p) => hasVideo || p.kind === 'audio');
  const go = async () => {
    if (images) {
      const max = maxDim ? Math.max(16, Number(maxDim)) : undefined;
      // PNG/JPEG → PNG/JPEG use the platform codec in one operation; other formats are encoded by Chromium per file.
      if (imgFormat !== 'webp' && paths.every((p) => NATIVE_RE.test(p))) {
        if (await startOperation({ type: 'convert', sources: paths, destination: dest, params: { kind: 'image', format: imgFormat, quality, maxDimension: max }, conflictPolicy: 'ask', origin: 'convert' })) closeDialog();
        return;
      }
      for (const [i, p] of paths.entries()) {
        setBusy(`Encoding ${i + 1} of ${paths.length}…`);
        try {
          const enc = await encodeImageInRenderer(p, imgFormat, quality, max);
          await startOperation({ type: 'convert', sources: [p], destination: dest, params: { kind: 'image-bytes', format: imgFormat, data: enc.data, width: enc.width, height: enc.height }, conflictPolicy: 'ask', origin: 'convert' });
        } catch (err) {
          toastError(err, `Could not convert ${p.split(/[\\/]/).pop()}`);
        }
      }
      setBusy(null);
      closeDialog();
      return;
    }
    if (await startOperation({ type: 'convert', sources: paths, destination: dest, params: { kind: 'media', preset }, conflictPolicy: 'ask', origin: 'convert' })) closeDialog();
  };
  const disabled = !!busy || (!images && (!media || !caps?.ffmpeg.available || !preset));
  return (
    <Dialog title={`Convert ${paths.length === 1 ? `“${paths[0]!.split(/[\\/]/).pop()}”` : `${paths.length} files`}`} onClose={closeDialog} width={520} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={disabled} onClick={() => void go()}>{busy ?? 'Convert'}</Button>
      </>
    }>
      <p className="muted small">The originals are not changed. Converted copies are saved as new files and checked before they are kept.</p>
      {!images && !media ? <p className="error-text">Select only images, or only audio and video files.</p> : images ? (
        <div className="form-grid">
          <label className="field" htmlFor="cv-format"><span className="field-label">Format</span>
            <select id="cv-format" className="input" value={imgFormat} onChange={(e) => setImgFormat(e.target.value as typeof imgFormat)}>
              <option value="jpeg">JPEG — photos, smaller files</option>
              <option value="png">PNG — lossless, keeps transparency</option>
              <option value="webp">WebP — modern, small</option>
            </select>
          </label>
          {imgFormat !== 'png' && <label className="field" htmlFor="cv-q"><span className="field-label">Quality ({quality})</span><input id="cv-q" type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} /></label>}
          <label className="field" htmlFor="cv-max"><span className="field-label">Longest side (pixels, optional)</span><input id="cv-max" className="input" inputMode="numeric" placeholder="Keep original size" value={maxDim} onChange={(e) => setMaxDim(e.target.value.replace(/\D/g, ''))} /></label>
        </div>
      ) : !caps ? <p className="muted">Checking for FFmpeg…</p> : !caps.ffmpeg.available ? <p className="warning-text">{caps.ffmpeg.note}</p> : (
        <>
          <label className="field" htmlFor="cv-preset"><span className="field-label">Convert to</span>
            <select id="cv-preset" className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <p className="muted small">Uses {caps.ffmpeg.version}. Progress is shown in Operations and the result is checked for the full duration before it is kept.</p>
        </>
      )}
      <FolderPicker value={dest} onChange={setDest} label="Save converted files in" />
    </Dialog>
  );
}
