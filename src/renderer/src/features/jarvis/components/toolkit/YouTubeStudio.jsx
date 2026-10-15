import { useMemo, useState } from 'react';
import { Clock3, Copy, Download, ExternalLink, Image as ImageIcon, Link2, Loader2, Play, Search } from 'lucide-react';
import { Youtube } from '@jarvis/lib/brandIcons';
import { base44 } from '@jarvis/api/base44Client';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat, ToggleRow, downloadBlob } from './shared';

const THUMBS = [
  { key: 'maxresdefault', label: 'Max HD', size: '1280 × 720' },
  { key: 'sddefault', label: 'SD', size: '640 × 480' },
  { key: 'hqdefault', label: 'HQ', size: '480 × 360' },
  { key: 'mqdefault', label: 'Medium', size: '320 × 180' },
  { key: 'default', label: 'Small', size: '120 × 90' },
];

const parseLink = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;
  const idOnly = /^[A-Za-z0-9_-]{11}$/.test(text);
  let url = null;
  try {
    url = new URL(text.startsWith('http') ? text : `https://${text}`);
  } catch {
    url = null;
  }

  const idPattern = /^[A-Za-z0-9_-]{11}$/;
  const pick = (...cands) => cands.find((c) => c && idPattern.test(c));
  const path = url?.pathname ?? '';
  const segments = path.split('/').filter(Boolean);

  let kind = 'video';
  let id = idOnly ? text : null;
  let list = url?.searchParams.get('list') || '';

  if (!id && url) {
    if (url.hostname.includes('youtu.be')) id = pick(segments[0]);
    else if (segments[0] === 'shorts') { id = pick(segments[1]); kind = 'short'; }
    else if (segments[0] === 'live') { id = pick(segments[1]); kind = 'live'; }
    else if (segments[0] === 'embed' || segments[0] === 'v') id = pick(segments[1]);
    else id = pick(url.searchParams.get('v'), segments[1]);
  }

  if (!id && !list) {
    if (segments[0]?.startsWith('@')) return { kind: 'channel', handle: segments[0], original: text };
    if (segments[0] === 'channel' || segments[0] === 'c' || segments[0] === 'user') return { kind: 'channel', handle: segments.slice(1).join('/'), original: text };
    return { kind: 'unknown', original: text };
  }

  if (list && !id) return { kind: 'playlist', list, original: text };
  return { kind, id, list, original: text, host: url?.hostname ?? '' };
};

const videoUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

export default function YouTubeStudio() {
  const [input, setInput] = useState('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const [nocookie, setNocookie] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [startHour, setStartHour] = useState(0);
  const [startMin, setStartMin] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const parsed = useMemo(() => parseLink(input), [input]);
  const id = parsed?.id || '';
  const seconds = startHour * 3600 + startMin * 60 + startSec;
  const stamp = [startHour ? `${startHour}h` : '', startMin ? `${startMin}m` : '', startSec ? `${startSec}s` : ''].join('') || '0s';

  const embed = useMemo(() => {
    if (!id) return '';
    const host = nocookie ? 'www.youtube-nocookie.com' : 'www.youtube.com';
    const params = new URLSearchParams();
    if (autoplay) params.set('autoplay', '1');
    if (seconds) params.set('start', String(seconds));
    const query = params.toString();
    return `<iframe width="560" height="315" src="https://${host}/embed/${id}${query ? `?${query}` : ''}" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }, [id, nocookie, autoplay, seconds]);

  const timestamped = id ? `${videoUrl(id)}&t=${stamp}` : '';

  const exportText = [
    id ? `Video: ${videoUrl(id)}` : '',
    id ? `Timestamp link: ${timestamped}` : '',
    id ? `Embed:\n${embed}` : '',
    parsed?.list ? `Playlist: https://www.youtube.com/playlist?list=${parsed.list}` : '',
    details?.title ? `Title: ${details.title}` : '',
    details?.author ? `Channel: ${details.author}` : '',
    id ? `Thumbnails:\n${THUMBS.map((t) => `${t.label}: https://i.ytimg.com/vi/${id}/${t.key}.jpg`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const fetchDetails = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const response = await base44.functions.invoke('videoMeta', { videoId: id });
      const data = response?.data ?? {};
      if (data.error) { setError(data.error); setDetails(null); } else { setDetails(data); }
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not reach YouTube for the details.');
      setDetails(null);
    } finally {
      setLoading(false);
    }
  };

  const saveThumb = async (key) => {
    if (!id) return;
    const url = `https://i.ytimg.com/vi/${id}/${key}.jpg`;
    setSaved(key);
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('blocked');
      const blob = await res.blob();
      downloadBlob(blob, `${id}-${key}.jpg`);
      flashSaved(`${key}:saved`);
    } catch {
      window.open(url, '_blank', 'noopener');
      flashSaved(`${key}:opened`);
    }
  };

  const flashSaved = (value) => {
    setSaved(value);
    setTimeout(() => setSaved(''), 1800);
  };

  const thumbState = (key) => (saved.startsWith(key) ? saved.split(':')[1] : '');

  return (
    <ToolShell
      toolId="yt-studio"
      icon={Youtube}
      title="YouTube Link Studio"
      desc="Paste any YouTube link to pull out the video id, every thumbnail, the embed code and a shareable timestamp — plus the title and channel."
      state={{ input, nocookie, autoplay, startHour, startMin, startSec }}
      onRestore={(restored) => {
        if (restored.input !== undefined) setInput(restored.input);
        setNocookie(!!restored.nocookie);
        setAutoplay(!!restored.autoplay);
        setStartHour(restored.startHour ?? 0);
        setStartMin(restored.startMin ?? 0);
        setStartSec(restored.startSec ?? 0);
      }}
      exportText={exportText}
      exportName="youtube-links.txt"
    >
      <Field label="Video link, short link, Shorts link — or just the id">
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); setDetails(null); setError(''); }}
            placeholder="https://www.youtube.com/watch?v=…"
            className="h-10 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm"
          />
        </div>
      </Field>

      {parsed?.kind === 'unknown' && (
        <Panel className="border-amber-500/40 text-[11px] text-amber-500">
          That does not look like a YouTube link. Paste the address from the browser bar and the details appear here.
        </Panel>
      )}

      {(parsed?.kind === 'channel' || parsed?.kind === 'playlist') && (
        <Panel>
          <div className="text-xs font-medium">{parsed.kind === 'channel' ? 'Channel link' : 'Playlist link'}</div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {parsed.kind === 'channel'
              ? `Handle ${parsed.handle} — a channel address carries no single video, so there is nothing to preview. Paste a video link for the full treatment.`
              : 'Playlist addresses carry a list id rather than a video. Open the video you want and paste that link.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {parsed.list && <CopyBtn value={`https://www.youtube.com/playlist?list=${parsed.list}`} label="Copy playlist link" />}
            <CopyBtn value={parsed.original} label="Copy what you pasted" />
          </div>
        </Panel>
      )}

      {id && (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr] lg:items-start">
            <Panel className="!p-3">
              <div className="relative overflow-hidden rounded-lg border border-border/70">
                <img
                  src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
                  alt="Video thumbnail"
                  className="w-full"
                  onError={(e) => { e.currentTarget.style.opacity = 0.25; }}
                />
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                    <Play className="h-6 w-6" />
                  </span>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-j text-[11px] text-muted-foreground">{id}</span>
                  <CopyBtn value={id} label="Copy id" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={videoUrl(id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-[11px] text-cyan-j transition hover:bg-cyan-j/20">
                    <ExternalLink className="h-3.5 w-3.5" /> Watch on YouTube
                  </a>
                  <CopyBtn value={videoUrl(id)} label="Copy link" />
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium">Details</span>
                <button
                  type="button"
                  onClick={fetchDetails}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1.5 text-[11px] text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  {loading ? 'Looking up…' : 'Fetch title & channel'}
                </button>
              </div>
              {error && <p className="text-[11px] text-amber-500">{error}</p>}
              {details && (
                <div className="space-y-2">
                  <div className="text-sm font-medium leading-snug">{details.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {details.author}
                    {details.authorUrl && (
                      <a href={details.authorUrl} target="_blank" rel="noreferrer" className="ml-2 text-cyan-j hover:underline">visit channel</a>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {details.thumbnail && <CopyBtn value={details.thumbnail} label="Copy channel thumbnail" />}
                    <CopyBtn value={`${details.title} — ${details.author}`} label="Copy title" />
                  </div>
                </div>
              )}
              {!details && !error && (
                <p className="text-[11px] text-muted-foreground">
                  Title and channel come from YouTube's public oEmbed endpoint through your app's backend, so the network can never block the lookup.
                </p>
              )}
            </Panel>
          </div>

          <Panel>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium">
              <ImageIcon className="h-3.5 w-3.5 text-cyan-j" /> Thumbnails
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {THUMBS.map((thumb) => {
                const url = `https://i.ytimg.com/vi/${id}/${thumb.key}.jpg`;
                const state = thumbState(thumb.key);
                return (
                  <div key={thumb.key} className="tk-card overflow-hidden rounded-xl border border-border/70 bg-card/50">
                    <img src={url} alt={`${thumb.label} thumbnail`} className="w-full" loading="lazy" onError={(e) => { e.currentTarget.style.opacity = 0.2; }} />
                    <div className="space-y-1.5 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium">{thumb.label}</span>
                        <span className="font-mono-j text-[10px] text-muted-foreground">{thumb.size}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => saveThumb(thumb.key)}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2 py-1 text-[10px] text-cyan-j transition hover:bg-cyan-j/20"
                        >
                          {state === 'saved' ? <Copy className="h-3 w-3" /> : <Download className="h-3 w-3" />}
                          {state === 'saved' ? 'Saved' : state === 'opened' ? 'Opened' : 'Save'}
                        </button>
                        <CopyBtn value={url} label="Copy URL" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Sizes above 720p only exist when the uploader provided them — the faded ones fall back to YouTube's placeholder. Saving opens the
              picture in a new tab if the browser blocks the direct download.
            </p>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <div className="mb-3 flex items-center gap-2 text-xs font-medium">
                <Clock3 className="h-3.5 w-3.5 text-cyan-j" /> Timestamped link
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label={`Hours · ${startHour}`}>
                  <input type="range" min={0} max={5} value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
                </Field>
                <Field label={`Minutes · ${startMin}`}>
                  <input type="range" min={0} max={59} value={startMin} onChange={(e) => setStartMin(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
                </Field>
                <Field label={`Seconds · ${startSec}`}>
                  <input type="range" min={0} max={59} value={startSec} onChange={(e) => setStartSec(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
                </Field>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-md border border-border/70 bg-card/60 px-2 py-1.5 font-mono-j text-[10px]">{timestamped}</span>
                  <CopyBtn value={timestamped} label="Copy" />
                </div>
                <p className="text-[11px] text-muted-foreground">Use &amp;t={stamp} on any link to jump straight to that moment.</p>
              </div>
            </Panel>

            <Panel>
              <div className="mb-3 flex items-center gap-2 text-xs font-medium">
                <Play className="h-3.5 w-3.5 text-cyan-j" /> Embed code
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <ToggleRow label="No-cookie domain" checked={nocookie} onChange={setNocookie} hint="no tracking until play" />
                <ToggleRow label="Autoplay on load" checked={autoplay} onChange={setAutoplay} />
              </div>
              <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/70 bg-card/60 p-2 font-mono-j text-[10px] scrollbar-thin">{embed}</pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyBtn value={embed} label="Copy embed" />
                <Seg value={nocookie ? 'safe' : 'standard'} onChange={(v) => setNocookie(v === 'safe')} options={[{ value: 'standard', label: 'Standard' }, { value: 'safe', label: 'No-cookie' }]} />
              </div>
            </Panel>
          </div>
        </>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Link kind" value={parsed?.kind ?? '—'} />
        <Stat label="Video id" value={id || '—'} mono />
        <Stat label="Thumbnails" value={id ? `${THUMBS.length} sizes` : '—'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Everything here is the public data around a video: its id, its thumbnails, its embed and its oEmbed title. The video file itself is not
          fetched or stored — to keep a copy you own, use the download option YouTube provides on your own uploads.
        </p>
      </Panel>
    </ToolShell>
  );
}