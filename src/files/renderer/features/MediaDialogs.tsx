import React, { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../api';
import { closeDialog, toast, toastError } from '../state/app';
import { useStore } from '../state/store';
import { activePane, currentLocation, navigate } from '../state/workspace';
import { player } from '../state/player';
import { loadVideoCaps, runVideoTool, videoCaps, type VideoCaps, type VideoProbe } from '../state/video';
import { Button, Dialog, IconButton, Segmented, Toggle } from '../ui/components';
import { Icon } from '../ui/Icon';
import { FolderPicker } from './views/common';
import { itemTitle } from '../../shared/player';
import { formatTimecode, frameAt, GIF_MAX_SECONDS, parseTimecode, sheetGeometry, snapToFrame, type VideoToolSpec } from '../../shared/videoTools';

/**
 * Dialogs of the music player (save the queue as a playlist) and of the
 * video tools (trim, GIF, extract audio, contact sheet, join, rotate). The
 * tools themselves run as 'video-tool' operations in the main process; every
 * dialog says honestly when the installed FFmpeg cannot do something.
 */

const mediaUrl = (p: string) => `orbis-media://f/${encodeURIComponent(p)}`;
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '') || '/';

/* ------------------------------------------------------------------ save playlist */

export function SavePlaylistDialog({ dir }: { dir?: string }) {
  const items = useStore(player, (s) => s.state.items);
  const pane = currentLocation(activePane());
  const initialDir = dir ?? (pane.kind === 'fs' ? pane.path : items[0] ? dirOf(items[0].path) : '/');
  const [folder, setFolder] = useState(initialDir);
  const [name, setName] = useState('Playlist');
  const [exists, setExists] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const missing = items.filter((i) => i.missing).length;
  const save = async (replace: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await call<{ status: 'saved'; path: string; written: number; skipped: number } | { status: 'exists'; path: string }>('player:savePlaylist', {
        dir: folder,
        name: name.trim(),
        entries: items.map((i) => ({ path: i.path, title: i.title ?? itemTitle(i), artist: i.artist, durationSec: i.durationSec })),
        replace,
      });
      if (r.status === 'exists') {
        setExists(r.path);
        return;
      }
      closeDialog();
      toast({ level: 'success', title: `Saved ${baseName(r.path)}`, detail: `${r.written.toLocaleString()} entr${r.written === 1 ? 'y' : 'ies'}${r.skipped ? `; ${r.skipped} with a line break in the name could not be written` : ''}.`, actions: [{ label: 'Show', run: () => void navigate(activePane().id, { kind: 'fs', path: r.path }) }] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const nameOk = name.trim().length > 0 && !/[\\/]/.test(name);
  return (
    <Dialog title="Save queue as playlist" onClose={closeDialog} width={520} className="player-save-dialog" footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        {exists
          ? <Button variant="danger" disabled={busy} onClick={() => void save(true)}>Replace</Button>
          : <Button variant="primary" disabled={busy || !nameOk || !items.length} onClick={() => void save(false)}>Save</Button>}
      </>
    }>
      <p className="muted small">An extended M3U8 playlist (UTF-8) with each item's title and length. Files in the playlist's folder (or below it) are listed with relative paths, so the folder can be moved or copied with its playlist; others keep their full path.</p>
      <label className="field" htmlFor="pl-name">
        <span className="field-label">Name</span>
        <div className="input-row">
          <input id="pl-name" className="input" value={name} spellCheck={false} aria-invalid={!nameOk} onChange={(e) => {
            setName(e.target.value);
            setExists(null);
          }} />
          <span className="muted small nowrap">.m3u8</span>
        </div>
      </label>
      <FolderPicker value={folder} onChange={(v) => {
        setFolder(v);
        setExists(null);
      }} label="Save in" id="pl-folder" />
      <p className="muted small tabular">{items.length.toLocaleString()} item{items.length === 1 ? '' : 's'}{missing ? ` (${missing} missing: written as they were, so the playlist still lists them)` : ''}</p>
      {exists && <p className="warning-text" role="alert"><Icon name="warning" size={14} /> {baseName(exists)} already exists in this folder. Replace it, or choose another name.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ shared bits */

function useCaps(): { caps: VideoCaps | null; loading: boolean } {
  const st = useStore(videoCaps, (s) => ({ caps: s.caps, loading: s.loading }));
  useEffect(() => void loadVideoCaps(), []);
  return { caps: st.caps, loading: st.loading || !st.caps };
}

function useProbe(path: string | undefined): { info: VideoProbe | null; error?: string } {
  const [state, setState] = useState<{ info: VideoProbe | null; error?: string }>({ info: null });
  useEffect(() => {
    if (!path) return;
    let live = true;
    call<VideoProbe>('video:probe', { path }).then((info) => live && setState({ info }), (err) => live && setState({ info: null, error: (err as Error).message }));
    return () => {
      live = false;
    };
  }, [path]);
  return state;
}

/** FFmpeg missing / still checking: an honest line instead of the controls. */
function CapsNote({ caps, loading }: { caps: VideoCaps | null; loading: boolean }) {
  if (loading && !caps) return <p className="muted" role="status">Checking FFmpeg…</p>;
  if (caps && !caps.available) return <p className="warning-text" role="alert"><Icon name="warning" size={14} /> {caps.reason}</p>;
  return null;
}

function NumberField({ id, label, value, onChange, min, max, step = 1, suffix }: { id: string; label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  const [text, setText] = useState(String(value));
  const typed = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typed.current !== value) setText(String(value));
  }, [value]);
  const bad = !(Number(text) >= min && Number(text) <= max);
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <div className="input-row">
        <input id={id} className="input tabular" inputMode="decimal" value={text} aria-invalid={bad} onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min && n <= max) {
            typed.current = step === 1 ? Math.round(n) : n;
            onChange(typed.current);
          }
        }} />
        {suffix && <span className="muted small nowrap">{suffix}</span>}
      </div>
      {bad && <span className="field-error">{min}–{max}</span>}
    </label>
  );
}

function TimeField({ id, label, value, onChange, max }: { id: string; label: string; value: number; onChange: (v: number) => void; max?: number }) {
  const [text, setText] = useState(formatTimecode(value));
  // The value this field typed last: other changes (Mark in/out) replace the text even while it has the focus.
  const typed = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typed.current !== value) setText(formatTimecode(value));
  }, [value]);
  const parsed = parseTimecode(text);
  const bad = parsed === undefined || (max !== undefined && parsed > max + 0.0005);
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} className="input tabular mono" value={text} aria-invalid={bad} spellCheck={false} onBlur={() => {
        typed.current = undefined;
        if (!bad) setText(formatTimecode(parsed!));
      }} onChange={(e) => {
        setText(e.target.value);
        const t = parseTimecode(e.target.value);
        if (t !== undefined && (max === undefined || t <= max + 0.0005)) {
          typed.current = t;
          onChange(t);
        }
      }} />
      {bad && <span className="field-error">Use 1:02.500 or seconds{max !== undefined ? `, up to ${formatTimecode(max)}` : ''}.</span>}
    </label>
  );
}

/**
 * A video (or audio) preview with frame stepping and an exact position read
 * from each presented frame (requestVideoFrameCallback when available).
 */
function PreviewPlayer({ path, info, onTime, videoRef }: { path: string; info: VideoProbe | null; onTime: (t: number) => void; videoRef: React.MutableRefObject<HTMLVideoElement | null> }) {
  const [failed, setFailed] = useState(false);
  const [t, setT] = useState(0);
  const fps = info?.fps;
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let handle = 0;
    type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    const rvfc = (v as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(v);
    const onFrame = (_n: number, meta: { mediaTime: number }) => {
      setT(meta.mediaTime);
      onTime(meta.mediaTime);
      handle = rvfc!(onFrame);
    };
    if (rvfc) handle = rvfc(onFrame);
    const onUpdate = () => {
      setT(v.currentTime);
      onTime(v.currentTime);
    };
    v.addEventListener('timeupdate', onUpdate);
    v.addEventListener('seeked', onUpdate);
    return () => {
      v.removeEventListener('timeupdate', onUpdate);
      v.removeEventListener('seeked', onUpdate);
      (v as unknown as { cancelVideoFrameCallback?: (h: number) => void }).cancelVideoFrameCallback?.(handle);
      v.pause();
    };
  }, [videoRef, onTime]);
  const step = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    const f = fps ?? 25;
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, snapToFrame(v.currentTime, f) + dir / f + 0.0001));
  };
  return (
    <div className="vt-preview">
      {failed ? (
        <div className="vt-preview-failed" role="status"><Icon name="fileVideo" size={28} /><span>This file cannot be previewed by the built-in player. Type the times instead; FFmpeg still reads it.</span></div>
      ) : (
        <video ref={videoRef} src={mediaUrl(path)} controls preload="auto" data-autofocus onError={() => setFailed(true)} aria-label={`Preview of ${baseName(path)}`} />
      )}
      <div className="vt-preview-bar">
        <IconButton icon="frameBack" label="Previous frame" disabled={failed} onClick={() => step(-1)} />
        <IconButton icon="frameForward" label="Next frame" disabled={failed} onClick={() => step(1)} />
        <span className="vt-pos tabular mono" aria-live="off">{formatTimecode(t)}{fps ? ` · frame ${frameAt(t, fps).toLocaleString()}` : ''}</span>
        {fps && <span className="muted small tabular">{Math.round(fps * 1000) / 1000} fps</span>}
      </div>
    </div>
  );
}

const pickDest = (paths: string[]) => dirOf(paths[0]!);

/* ------------------------------------------------------------------ trim */

export function VideoTrimDialog({ path }: { path: string }) {
  const { caps, loading } = useCaps();
  const { info, error } = useProbe(path);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [now, setNow] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState<number | null>(null);
  const [mode, setMode] = useState<'fast' | 'exact'>('exact');
  const [dest, setDest] = useState(pickDest([path]));
  const [busy, setBusy] = useState(false);
  const dur = info?.durationSec ?? 0;
  const endV = end ?? dur;
  useEffect(() => {
    if (info?.durationSec && end === null) setEnd(info.durationSec);
  }, [info, end]);
  const fps = info?.fps;
  // The element's own position is exact (state may lag a frame behind while playing).
  const at = () => videoRef.current?.currentTime ?? now;
  const markIn = () => setStart(snapToFrame(Math.min(at(), endV), fps));
  const markOut = () => setEnd(snapToFrame(Math.max(at(), start), fps));
  const valid = endV > start && (!dur || start < dur);
  const ok = !!caps?.available && !!info && valid && !busy;
  const go = async () => {
    setBusy(true);
    if (await runVideoTool([path], dest, { tool: 'trim', start, end: endV, mode })) closeDialog();
    setBusy(false);
  };
  const saveFrame = async () => {
    const t = snapToFrame(at(), fps);
    if (await runVideoTool([path], dest, { tool: 'frame', time: t })) toast({ level: 'info', title: `Saving the frame at ${formatTimecode(t)} as PNG`, detail: 'Progress is shown in Operations.' });
  };
  return (
    <Dialog title={`Trim “${baseName(path)}”`} onClose={closeDialog} width={720} className="vt-dialog vt-trim" footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!ok} onClick={() => void go()}>{busy ? 'Starting…' : 'Trim'}</Button>
      </>
    }>
      <CapsNote caps={caps} loading={loading} />
      {error && <p className="error-text" role="alert">{error}</p>}
      <PreviewPlayer path={path} info={info} onTime={setNow} videoRef={videoRef} />
      <div className="vt-marks">
        <Button size="sm" icon="markIn" onClick={markIn} disabled={!info}>Mark in</Button>
        <Button size="sm" icon="markOut" onClick={markOut} disabled={!info}>Mark out</Button>
        <Button size="sm" variant="ghost" icon="frame" onClick={() => void saveFrame()} disabled={!caps?.available || !info?.hasVideo}>Save this frame as PNG</Button>
      </div>
      <div className="form-grid vt-times">
        <TimeField id="vt-start" label="Start" value={start} max={dur || undefined} onChange={setStart} />
        <TimeField id="vt-end" label="End" value={endV} max={dur || undefined} onChange={(v) => setEnd(v)} />
        <div className="field">
          <span className="field-label">Length</span>
          <span className={`vt-length tabular mono ${valid ? '' : 'error-text'}`}>{valid ? formatTimecode(endV - start) : 'The end must be after the start.'}</span>
        </div>
      </div>
      <div className="field">
        <span className="field-label" id="vt-mode-label">Cut</span>
        <Segmented label="Cut" value={mode} onChange={setMode} options={[
          { value: 'exact', label: 'Exact (re-encode)', disabled: caps ? !caps.h264 && !!info?.hasVideo : false, reason: 'The installed FFmpeg has no H.264/AAC encoder.' },
          { value: 'fast', label: 'Fast (stream copy)' },
        ]} />
        <p className="muted small">{mode === 'fast'
          ? 'Copies the streams without re-encoding: very quick and no quality loss, but a video can only start on a keyframe, so the cut moves back to the keyframe before your start mark (often up to a few seconds earlier).'
          : 'Re-encodes the selection (H.264 + AAC, high quality) so it starts and ends on exactly the frames you marked. Slower, and a small generational quality loss.'}</p>
      </div>
      <FolderPicker value={dest} onChange={setDest} label="Save the new file in" id="vt-dest" />
      <p className="muted small">The original is not changed. The new file never replaces an existing one; it is checked with ffprobe before it is kept.{caps && !caps.pause ? ` ${caps.pauseReason}` : ''}</p>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ GIF / WebP */

export function VideoGifDialog({ path }: { path: string }) {
  const { caps, loading } = useCaps();
  const { info, error } = useProbe(path);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [now, setNow] = useState(0);
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(3);
  const [width, setWidth] = useState(480);
  const [fps, setFps] = useState(12);
  const [format, setFormat] = useState<'gif' | 'webp'>('gif');
  const [dest, setDest] = useState(pickDest([path]));
  const [busy, setBusy] = useState(false);
  const dur = info?.durationSec ?? 0;
  const len = dur ? Math.min(duration, Math.max(0, dur - start)) : duration;
  const ok = !!caps?.available && !!info?.hasVideo && len > 0 && !busy && (format === 'gif' || caps.webp);
  const h = info?.width && info.height ? Math.round((width * info.height) / info.width) : undefined;
  const go = async () => {
    setBusy(true);
    if (await runVideoTool([path], dest, { tool: 'gif', format, start, duration: Math.min(len, GIF_MAX_SECONDS), width, fps })) closeDialog();
    setBusy(false);
  };
  return (
    <Dialog title={`Make a GIF from “${baseName(path)}”`} onClose={closeDialog} width={680} className="vt-dialog" footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!ok} onClick={() => void go()}>{busy ? 'Starting…' : format === 'gif' ? 'Make GIF' : 'Make WebP'}</Button>
      </>
    }>
      <CapsNote caps={caps} loading={loading} />
      {error && <p className="error-text" role="alert">{error}</p>}
      {info && !info.hasVideo && <p className="warning-text">This file has no video.</p>}
      <PreviewPlayer path={path} info={info} onTime={setNow} videoRef={videoRef} />
      <div className="vt-marks">
        <Button size="sm" icon="markIn" disabled={!info} onClick={() => setStart(snapToFrame(videoRef.current?.currentTime ?? now, info?.fps))}>Start here</Button>
      </div>
      <div className="form-grid vt-times">
        <TimeField id="gif-start" label="Start" value={start} max={dur || undefined} onChange={setStart} />
        <NumberField id="gif-dur" label="Length" value={duration} onChange={setDuration} min={0.1} max={GIF_MAX_SECONDS} step={0.1} suffix="s" />
        <NumberField id="gif-width" label="Width" value={width} onChange={setWidth} min={32} max={1920} suffix={h ? `px × ${h}` : 'px'} />
        <NumberField id="gif-fps" label="Frames per second" value={fps} onChange={setFps} min={1} max={50} />
      </div>
      <div className="field">
        <span className="field-label">Format</span>
        <Segmented label="Format" value={format} onChange={setFormat} options={[
          { value: 'gif', label: 'GIF' },
          { value: 'webp', label: 'Animated WebP', disabled: !!caps && !caps.webp, reason: 'The installed FFmpeg has no libwebp_anim encoder.' },
        ]} />
        <p className="muted small">{format === 'gif'
          ? 'Two passes: FFmpeg first picks the best 256 colours for this clip (palettegen), then draws every frame with them (paletteuse), which looks much better than a generic palette.'
          : 'Animated WebP keeps full colour and is usually several times smaller than a GIF; older programs may not show it.'}
          {' '}{Math.max(1, Math.round(len * fps)).toLocaleString()} frames.{caps && !caps.webp ? ' Animated WebP is not available: the installed FFmpeg has no libwebp_anim encoder.' : ''}</p>
      </div>
      <FolderPicker value={dest} onChange={setDest} label="Save in" id="gif-dest" />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ extract audio */

const AUDIO_FORMATS: Array<{ id: 'm4a' | 'mp3' | 'opus' | 'flac' | 'wav'; label: string; detail: string }> = [
  { id: 'm4a', label: 'M4A (AAC)', detail: 'Plays almost everywhere; 192 kbit/s.' },
  { id: 'mp3', label: 'MP3', detail: 'Plays everywhere; VBR quality 2 (about 190 kbit/s).' },
  { id: 'opus', label: 'Opus', detail: 'Smallest for the quality; 128 kbit/s.' },
  { id: 'flac', label: 'FLAC', detail: 'Lossless, compressed.' },
  { id: 'wav', label: 'WAV', detail: 'Lossless, uncompressed (large).' },
];

export function ExtractAudioDialog({ paths }: { paths: string[] }) {
  const { caps, loading } = useCaps();
  const { info } = useProbe(paths.length === 1 ? paths[0] : undefined);
  const [format, setFormat] = useState<'copy' | 'm4a' | 'mp3' | 'opus' | 'flac' | 'wav'>('copy');
  const [dest, setDest] = useState(pickDest(paths));
  const [busy, setBusy] = useState(false);
  const enc = caps?.encoders;
  const go = async () => {
    setBusy(true);
    if (await runVideoTool(paths, dest, { tool: 'extractAudio', format })) closeDialog();
    setBusy(false);
  };
  const copyDetail = paths.length === 1
    ? info ? info.audioCopy ? `Saved as .${info.audioCopy.ext} with the ${info.audioCopy.label} audio exactly as it is: instant, no quality loss.` : 'This file has no audio track.' : 'Checking the audio track…'
    : 'Each file keeps its audio exactly as it is, in a container that holds that codec (.m4a for AAC, .mp3, .opus, .ogg, .flac, .wav for PCM, else .mka): instant, no quality loss.';
  return (
    <Dialog title={paths.length === 1 ? `Extract audio from “${baseName(paths[0]!)}”` : `Extract audio from ${paths.length} files`} onClose={closeDialog} width={540} className="vt-dialog" footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!caps?.available || busy || (paths.length === 1 && !!info && !info.hasAudio)} onClick={() => void go()}>{busy ? 'Starting…' : 'Extract'}</Button>
      </>
    }>
      <CapsNote caps={caps} loading={loading} />
      <div className="choice-list" role="radiogroup" aria-label="Audio format">
        <label className="choice">
          <input type="radio" name="xa" checked={format === 'copy'} onChange={() => setFormat('copy')} />
          <span>Copy the audio track as it is</span>
          <small className="muted">{copyDetail}</small>
        </label>
        {AUDIO_FORMATS.map((f) => {
          const off = !!enc && !enc[f.id];
          return (
            <label key={f.id} className={`choice ${off ? 'is-disabled' : ''}`} title={off ? 'The installed FFmpeg has no encoder for this format.' : undefined}>
              <input type="radio" name="xa" disabled={off} checked={format === f.id} onChange={() => setFormat(f.id)} />
              <span>Convert to {f.label}</span>
              <small className="muted">{off ? 'Not available: the installed FFmpeg has no encoder for it.' : f.detail}</small>
            </label>
          );
        })}
      </div>
      <FolderPicker value={dest} onChange={setDest} label="Save in" id="xa-dest" />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ contact sheet */

export function ContactSheetDialog({ paths }: { paths: string[] }) {
  const { caps, loading } = useCaps();
  const { info } = useProbe(paths[0]);
  const [columns, setColumns] = useState(4);
  const [rows, setRows] = useState(4);
  const [tileWidth, setTileWidth] = useState(320);
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [timestamps, setTimestamps] = useState(true);
  const [dest, setDest] = useState(pickDest(paths));
  const [busy, setBusy] = useState(false);
  const geo = info?.width && info.height ? sheetGeometry({ width: info.width, height: info.height }, { columns, rows, tileWidth }) : undefined;
  const noText = !!caps && !caps.drawtext;
  const go = async () => {
    setBusy(true);
    if (await runVideoTool(paths, dest, { tool: 'contactSheet', columns, rows, tileWidth, format, timestamps: timestamps && !noText })) closeDialog();
    setBusy(false);
  };
  return (
    <Dialog title={paths.length === 1 ? `Contact sheet of “${baseName(paths[0]!)}”` : `Contact sheets of ${paths.length} videos`} onClose={closeDialog} width={540} className="vt-dialog" footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!caps?.available || busy} onClick={() => void go()}>{busy ? 'Starting…' : 'Make contact sheet'}</Button>
      </>
    }>
      <CapsNote caps={caps} loading={loading} />
      <p className="muted small">{columns * rows} frames spread evenly over the video, in one picture (FFmpeg's tile filter).</p>
      <div className="form-grid">
        <NumberField id="cs-cols" label="Columns" value={columns} onChange={setColumns} min={1} max={10} />
        <NumberField id="cs-rows" label="Rows" value={rows} onChange={setRows} min={1} max={12} />
        <NumberField id="cs-tile" label="Picture width" value={tileWidth} onChange={setTileWidth} min={64} max={960} suffix="px" />
      </div>
      <div className="field">
        <span className="field-label">Format</span>
        <Segmented label="Format" value={format} onChange={setFormat} options={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }]} />
      </div>
      <Toggle id="cs-ts" label="Time stamps on each picture" checked={timestamps && !noText} disabled={noText} onChange={setTimestamps}
        description={noText ? 'Not available: the installed FFmpeg has no drawtext filter (it needs FreeType). The sheet is made without them.' : 'Drawn by FFmpeg (drawtext). If no font can be found, the sheet is made without them and a note says so.'} />
      {geo && <p className="muted small tabular">Result: {geo.width.toLocaleString()} × {geo.height.toLocaleString()} px{paths.length > 1 ? ' for the first video' : ''}.</p>}
      <FolderPicker value={dest} onChange={setDest} label="Save in" id="cs-dest" />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ join */

interface JoinCheck { match: boolean; reasons: string[]; totalSec: number; items: Array<{ path: string; durationSec?: number; summary: string }> }

export function JoinVideosDialog({ paths }: { paths: string[] }) {
  const { caps, loading } = useCaps();
  const [order, setOrder] = useState(paths);
  const [check, setCheck] = useState<JoinCheck | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [mode, setMode] = useState<'copy' | 'reencode' | null>(null);
  const [dest, setDest] = useState(pickDest(paths));
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    let live = true;
    call<JoinCheck>('video:joinCheck', { paths: order }).then((c) => {
      if (!live) return;
      setCheck(c);
      setMode((m) => (m === 'copy' && !c.match ? 'reencode' : m ?? (c.match ? 'copy' : 'reencode')));
    }, (err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
  }, [order]);
  const byPath = useMemo(() => new Map(check?.items.map((i) => [i.path, i]) ?? []), [check]);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const n = [...order];
    [n[i], n[j]] = [n[j]!, n[i]!];
    setOrder(n);
    setFocus(j);
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>('.vt-join-item')[j]?.focus());
  };
  const go = async () => {
    if (!mode) return;
    setBusy(true);
    if (await runVideoTool(order, dest, { tool: 'join', mode })) closeDialog();
    setBusy(false);
  };
  return (
    <Dialog title={`Join ${order.length} files`} onClose={closeDialog} width={600} className="vt-dialog" footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!caps?.available || !check || !mode || busy || (mode === 'reencode' && !caps.h264)} onClick={() => void go()}>{busy ? 'Starting…' : 'Join'}</Button>
      </>
    }>
      <CapsNote caps={caps} loading={loading} />
      {error && <p className="error-text" role="alert">{error}</p>}
      <p className="muted small">In this order (Alt+↑/↓ or the arrows move the selected file):</p>
      <ol className="vt-join" ref={listRef} aria-label="Files to join, in order">
        {order.map((p, i) => (
          <li key={p} className="vt-join-row">
            <div className="vt-join-item" tabIndex={i === focus ? 0 : -1} onFocus={() => setFocus(i)} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onKeyDown={(e) => {
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                move(i, e.key === 'ArrowUp' ? -1 : 1);
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const j = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)));
                setFocus(j);
                listRef.current?.querySelectorAll<HTMLElement>('.vt-join-item')[j]?.focus();
              }
            }}>
              <span className="vt-join-n tabular">{i + 1}</span>
              <span className="vt-join-text">
                <span className="vt-join-name">{baseName(p)}</span>
                <span className="muted small">{byPath.get(p) ? `${byPath.get(p)!.summary}${byPath.get(p)!.durationSec ? ` · ${formatTimecode(byPath.get(p)!.durationSec!)}` : ''}` : 'Reading…'}</span>
              </span>
            </div>
            <IconButton icon="chevronUp" label={`Move ${baseName(p)} up`} tabIndex={-1} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="chevronDown" label={`Move ${baseName(p)} down`} tabIndex={-1} disabled={i === order.length - 1} onClick={() => move(i, 1)} />
          </li>
        ))}
      </ol>
      {check && (
        <div className="choice-list" role="radiogroup" aria-label="How to join">
          <label className={`choice ${check.match ? '' : 'is-disabled'}`}>
            <input type="radio" name="join" checked={mode === 'copy'} disabled={!check.match} onChange={() => setMode('copy')} />
            <span>Join without re-encoding</span>
            <small className="muted">{check.match ? 'Every file has the same codecs, size and frame rate, so the streams are put one after another (concat demuxer): quick and lossless.' : `Not possible: ${check.reasons.slice(0, 3).join(' ')}`}</small>
          </label>
          <label className="choice">
            <input type="radio" name="join" checked={mode === 'reencode'} onChange={() => setMode('reencode')} />
            <span>Re-encode into one MP4 (H.264 + AAC)</span>
            <small className="muted">Works for any mix: each file is scaled to the picture size and frame rate of the first one (letterboxed where the shape differs), its sound resampled, and silence added where a file has none. Takes longer and loses a little quality.</small>
          </label>
        </div>
      )}
      {check && <p className="muted small tabular">Total length about {formatTimecode(check.totalSec)}.</p>}
      <FolderPicker value={dest} onChange={setDest} label="Save in" id="join-dest" />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ rotate / flip */

export function RotateVideoDialog({ paths }: { paths: string[] }) {
  const { caps, loading } = useCaps();
  const { info } = useProbe(paths[0]);
  const [rotate, setRotate] = useState<'0' | '90' | '180' | '270'>('90');
  const [hflip, setHflip] = useState(false);
  const [vflip, setVflip] = useState(false);
  const [reencode, setReencode] = useState(false);
  const [dest, setDest] = useState(pickDest(paths));
  const [busy, setBusy] = useState(false);
  const allLossless = paths.every((p) => /\.(mp4|m4v|mov)$/i.test(p));
  const someLossless = paths.some((p) => /\.(mp4|m4v|mov)$/i.test(p));
  const nothing = rotate === '0' && !hflip && !vflip;
  const go = async () => {
    setBusy(true);
    const spec: VideoToolSpec = { tool: 'rotate', rotate: Number(rotate) as 0 | 90 | 180 | 270, hflip, vflip, mode: reencode ? 'reencode' : 'auto' };
    if (await runVideoTool(paths, dest, spec)) closeDialog();
    setBusy(false);
  };
  const how = reencode
    ? 'Every frame is turned and encoded again into an MP4 (H.264 + AAC): works in every player, takes a while, loses a little quality.'
    : allLossless
      ? 'Lossless: only the rotation flag (display matrix) in the MP4/MOV is changed; the video is copied as it is. Almost every player honours it; choose re-encoding for the few that do not.'
      : someLossless
        ? 'MP4 and MOV files get a lossless rotation flag; other files cannot store one and are re-encoded to MP4 (H.264 + AAC).'
        : `${(info?.container ?? 'These').toUpperCase()} files cannot store a rotation flag, so they are re-encoded to MP4 (H.264 + AAC).`;
  return (
    <Dialog title={paths.length === 1 ? `Rotate or flip “${baseName(paths[0]!)}”` : `Rotate or flip ${paths.length} videos`} onClose={closeDialog} width={540} className="vt-dialog" footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!caps?.available || busy || nothing} onClick={() => void go()}>{busy ? 'Starting…' : 'Rotate'}</Button>
      </>
    }>
      <CapsNote caps={caps} loading={loading} />
      <div className="field">
        <span className="field-label">Turn</span>
        <Segmented label="Turn" value={rotate} onChange={setRotate} options={[
          { value: '90', label: '90° right' }, { value: '180', label: '180°' }, { value: '270', label: '90° left' }, { value: '0', label: 'None' },
        ]} />
      </div>
      <Toggle id="rv-h" label="Flip horizontally (mirror)" checked={hflip} onChange={setHflip} />
      <Toggle id="rv-v" label="Flip vertically" checked={vflip} onChange={setVflip} />
      <Toggle id="rv-re" label="Always re-encode" checked={reencode} onChange={setReencode} description="For players and sites that ignore the rotation flag." />
      <p className="muted small">{how}{info?.rotation ? ` This video is already shown turned by ${Math.abs(info.rotation)}°; the new turn is added to that.` : ''}</p>
      {nothing && <p className="warning-text">Choose a turn or a flip.</p>}
      <FolderPicker value={dest} onChange={setDest} label="Save in" id="rv-dest" />
    </Dialog>
  );
}

/** Save the frame shown by the details-panel preview (or the first frame) as a PNG next to the video. */
export async function saveFrameNow(path: string, time: number | undefined): Promise<void> {
  const caps = await loadVideoCaps();
  if (caps && !caps.available) {
    toast({ level: 'warning', title: 'Cannot save the frame', detail: caps.reason });
    return;
  }
  try {
    if (await runVideoTool([path], dirOf(path), { tool: 'frame', time: time ?? 0 })) toast({ level: 'info', title: `Saving the frame at ${formatTimecode(time ?? 0)} as PNG`, detail: time === undefined ? 'No preview was open, so the first frame is used. Open the preview and pause where you want a frame.' : 'Next to the video; progress is shown in Operations.' });
  } catch (err) {
    toastError(err);
  }
}
