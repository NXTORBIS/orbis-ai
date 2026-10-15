import { useState } from 'react';
import { Upload, Video } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Panel, Stat, fmtBytes } from './shared';

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${m}m ${String(s).padStart(2, '0')}s` : `${m}m ${String(s).padStart(2, '0')}s`;
};

export default function MediaInspector() {
  const [info, setInfo] = useState(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  const inspect = (file) => {
    if (!file) return;
    setError('');
    setName(file.name);
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    const base = { name: file.name, size: file.size, type: file.type || 'unknown', modified: new Date(file.lastModified).toLocaleString() };

    if (file.type.startsWith('image/')) {
      const image = new Image();
      image.onload = () => setInfo({ ...base, kind: 'image', width: image.naturalWidth, height: image.naturalHeight, ratio: (image.naturalWidth / image.naturalHeight).toFixed(3), megapixels: ((image.naturalWidth * image.naturalHeight) / 1e6).toFixed(1) });
      image.onerror = () => setError('That image could not be decoded.');
      image.src = objectUrl;
      return;
    }

    if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => setInfo({
        ...base, kind: 'video',
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        ratio: video.videoWidth ? (video.videoWidth / video.videoHeight).toFixed(3) : '—',
        bitrate: video.duration ? (file.size * 8) / video.duration / 1000 : 0,
      });
      video.onerror = () => setError('That video could not be read — the browser may not support its codec.');
      video.src = objectUrl;
      return;
    }

    if (file.type.startsWith('audio/')) {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => setInfo({
        ...base, kind: 'audio',
        duration: audio.duration,
        bitrate: audio.duration ? (file.size * 8) / audio.duration / 1000 : 0,
        sampleRate: audio.sampleRate || null,
      });
      audio.onerror = () => setError('That audio file could not be read.');
      audio.src = objectUrl;
      return;
    }

    setInfo({ ...base, kind: 'file' });
  };

  const report = info
    ? Object.entries(info).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${typeof value === 'number' ? Math.round(value) : value}`).join('\n')
    : '';

  return (
    <ToolShell
      toolId="media-inspector"
      icon={Video}
      title="Media File Inspector"
      desc="Read the real numbers behind an audio or video file — duration, pixel size, ratio and bitrate — before you upload or transcode it."
      exportText={report}
      exportName="media-info.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> Choose a media file</span>
          <input type="file" accept="video/*,audio/*,image/*" className="hidden" onChange={(e) => inspect(e.target.files?.[0])} />
        </label>
        {!!info && <CopyBtn value={report} label="Copy details" />}
      </div>

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      {url && info?.kind === 'video' && <video src={url} controls className="tk-card tk-depth w-full rounded-xl border border-border/70" />}
      {url && info?.kind === 'audio' && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">{name}</div>
          <audio src={url} controls className="w-full" />
        </Panel>
      )}
      {url && info?.kind === 'image' && (
        <div className="tk-card tk-depth grid place-items-center rounded-xl border border-border/70 bg-[repeating-conic-gradient(#1f2937_0%_25%,#111827_0%_50%)] bg-[length:22px_22px] p-4">
          <img src={url} alt={name} className="max-h-64 rounded-lg" />
        </div>
      )}

      {info ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="File" value={info.name} />
            <Stat label="Type" value={info.type} mono />
            <Stat label="Size" value={fmtBytes(info.size)} mono />
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            {info.duration !== undefined && <Stat label="Duration" value={formatDuration(info.duration)} mono />}
            {info.width !== undefined && <Stat label="Width" value={`${info.width}px`} mono />}
            {info.height !== undefined && <Stat label="Height" value={`${info.height}px`} mono />}
            {info.ratio !== undefined && <Stat label="Aspect ratio" value={info.ratio} mono />}
            {info.megapixels !== undefined && <Stat label="Megapixels" value={info.megapixels} mono />}
            {info.bitrate ? <Stat label="Average bitrate" value={`${Math.round(info.bitrate)} kbps`} mono /> : null}
            {info.sampleRate ? <Stat label="Sample rate" value={`${info.sampleRate} Hz`} mono /> : null}
            <Stat label="Modified" value={info.modified} mono />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">What this tells you</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              {info.duration && info.bitrate ? (
                <p>
                  At {Math.round(info.bitrate)} kbps this file is {info.bitrate > 4000 ? 'high quality — good to keep, large to move' : info.bitrate > 1200 ? 'normal quality for video' : 'fairly compressed, so re-encoding it again will lose detail'}.
                  {info.size > 25 * 1024 * 1024 ? ' It is above 25 MB, which many chat apps and email servers refuse — consider trimming or compressing before sending.' : ' It is under 25 MB, so it should pass most upload limits.'}
                </p>
              ) : null}
              {info.kind === 'image' && info.width ? (
                <p>
                  {info.width > 2000 ? 'That is a large pixel size — plenty for print, but scale it down for the web to save bandwidth.' : 'That pixel size is well suited to screens, and prints cleanly up to about A4 at 200 DPI.'}
                </p>
              ) : null}
              {info.kind === 'audio' ? <p>Audio durations and bitrates are approximate for variable-bitrate files, where the average is only an average.</p> : null}
            </div>
          </Panel>
        </>
      ) : (
        <Panel className="text-[11px] text-muted-foreground">
          Choose a video, audio clip or image. Metadata is read from the file locally in your browser — nothing is uploaded, and no frame-by-frame
          analysis happens.
        </Panel>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Worth checking before a big upload: a video that says 4K but is really 720p upscaled, an audio file with a suspiciously low bitrate, or an
          image that turns out to be 6000 pixels wide and will take ten seconds to load on a phone. Duration and dimensions are read from the file's
          own header, so they are exact.
        </p>
      </Panel>
    </ToolShell>
  );
}