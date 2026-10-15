import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowDown, ArrowUp, CheckCircle2, Gauge, Globe2, MapPin, Play, RefreshCw, Square, Trash2, Wifi, Zap,
} from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Seg, Stat, ToggleRow } from './shared';

const R = 80;
const C = 2 * Math.PI * R;
const ARC_LEN = C * (240 / 360);
const META_URL = 'https://speed.cloudflare.com/meta';

const SIZES = [
  { value: 10, label: 'Quick · 10 MB' },
  { value: 25, label: 'Standard · 25 MB' },
  { value: 100, label: 'Thorough · 100 MB' },
];

const niceMax = (v) => {
  const steps = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  return steps.find((s) => v * 1.15 <= s) ?? Math.ceil((v * 1.15) / 1000) * 1000;
};

const grade = (down, latency, jitter) => {
  if (!down) return { label: 'Not measured', tone: 'text-muted-foreground', note: 'Run a test to grade this connection.' };
  if (down >= 200 && latency <= 30) return { label: 'Excellent', tone: 'text-cyan-j', note: 'Several 4K streams, large uploads and cloud backup all at once.' };
  if (down >= 80 && latency <= 60) return { label: 'Great', tone: 'text-cyan-j', note: 'Comfortable for 4K streaming, video calls and gaming.' };
  if (down >= 25 && latency <= 120) return { label: 'Good', tone: 'text-amber-400', note: 'Fine for HD streaming and everyday calls.' };
  if (down >= 8) return { label: 'Workable', tone: 'text-amber-400', note: 'One HD stream at a time; expect buffering on 4K.' };
  if (jitter > 60) return { label: 'Unstable', tone: 'text-red-500', note: 'The link works but swings a lot — check Wi-Fi or the router.' };
  return { label: 'Limited', tone: 'text-red-500', note: 'Enough for messaging, mail and light browsing.' };
};

export default function NetworkSpeedTest() {
  const [size, setSize] = useState(25);
  const [useMeta, setUseMeta] = useState(true);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [gaugeMax, setGaugeMax] = useState(100);
  const [progress, setProgress] = useState(0);
  const [down, setDown] = useState(null);
  const [up, setUp] = useState(null);
  const [latency, setLatency] = useState(null);
  const [jitter, setJitter] = useState(null);
  const [meta, setMeta] = useState(null);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('toolkit:speedtest-history')) || []; } catch { return []; }
  });
  const abortRef = useRef(null);
  const rafRef = useRef(null);
  const emaRef = useRef(0);

  const cancelRaf = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };

  const loadMeta = async (signal) => {
    try {
      const res = await fetch(META_URL, { signal, cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      setMeta({
        ip: data.clientIp || data.ip || '',
        isp: data.asOrganization || data.asn || '',
        city: data.city || '',
        country: data.country || '',
        colo: data.colo || '',
      });
    } catch {
      setMeta(null);
    }
    return null;
  };

  const measureLatency = async (signal) => {
    const samples = [];
    for (let i = 0; i < 8; i++) {
      if (signal.aborted) return null;
      const t = performance.now();
      try {
        await fetch(`https://speed.cloudflare.com/__down?bytes=0&_=${Math.random()}`, { cache: 'no-store', mode: 'no-cors', signal });
      } catch (e) {
        if (e.name === 'AbortError') return null;
        continue;
      }
      samples.push(performance.now() - t);
      setProgress(1 + i);
    }
    if (!samples.length) return null;
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const spread = samples[Math.floor(samples.length * 0.9)] - samples[Math.floor(samples.length * 0.1)];
    setJitter(Math.round(spread));
    return { latency: Math.round(median), jitter: Math.round(spread) };
  };

  const downloadTest = async (signal) => {
    const bytes = size * 1_000_000;
    const url = `https://speed.cloudflare.com/__down?bytes=${bytes}&_=${Math.random()}`;
    const resp = await fetch(url, { cache: 'no-store', signal });
    const reader = resp.body?.getReader();
    if (!reader) return 0;
    let received = 0;
    const start = performance.now();
    let lastUpdate = start;
    let intervalBytes = 0;
    emaRef.current = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) { try { reader.cancel(); } catch { /* aborted */ } return null; }
      received += value.length;
      intervalBytes += value.length;
      const now = performance.now();
      if (now - lastUpdate > 140) {
        const inst = (intervalBytes * 8) / ((now - lastUpdate) / 1000) / 1e6;
        emaRef.current = emaRef.current ? emaRef.current * 0.55 + inst * 0.45 : inst;
        const v = emaRef.current;
        setLiveSpeed(v);
        setGaugeMax((m) => Math.max(m, niceMax(v)));
        setProgress(10 + Math.min(45, (received / bytes) * 45));
        lastUpdate = now;
        intervalBytes = 0;
      }
      if (now - start > 15000) { try { reader.cancel(); } catch { /* long enough */ } break; }
    }
    const elapsed = (performance.now() - start) / 1000;
    return received > 0 ? (received * 8) / elapsed / 1e6 : 0;
  };

  const uploadTest = async (signal) => {
    const chunk = 4_000_000;
    const blob = new Blob([new Uint8Array(chunk)]);
    const rounds = Math.max(2, Math.min(6, Math.round((size * 1_000_000) / chunk)));
    let total = 0;
    const start = performance.now();
    const animStart = performance.now();
    const peak = gaugeMax;
    rafRef.current = requestAnimationFrame(function loop() {
      const t = (performance.now() - animStart) / 1000;
      const sweep = 0.5 + 0.5 * Math.sin(t * 1.8);
      setLiveSpeed(peak * (0.25 + 0.5 * sweep));
      rafRef.current = requestAnimationFrame(loop);
    });
    for (let i = 0; i < rounds; i += 1) {
      if (signal.aborted) break;
      try {
        await fetch(`https://speed.cloudflare.com/__up?_=${Math.random()}`, { method: 'POST', body: blob, signal });
        total += chunk;
        setProgress(55 + (total / (rounds * chunk)) * 44);
      } catch (e) {
        if (e.name === 'AbortError') { cancelRaf(); return null; }
      }
    }
    cancelRaf();
    const elapsed = (performance.now() - start) / 1000;
    return total > 0 ? (total * 8) / elapsed / 1e6 : 0;
  };

  const run = async () => {
    setRunning(true);
    setDown(null); setUp(null); setLatency(null); setJitter(null);
    setProgress(0); setLiveSpeed(0); setGaugeMax(100); setPhase('latency');
    abortRef.current = new AbortController();
    const sig = abortRef.current.signal;
    try {
      if (useMeta) loadMeta(sig);
      const measured = await measureLatency(sig);
      if (sig.aborted || !measured) return;
      setLatency(measured.latency);
      setPhase('download');
      const d = await downloadTest(sig);
      if (sig.aborted) return;
      setDown(d);
      setPhase('upload');
      setProgress(55);
      const u = await uploadTest(sig);
      if (sig.aborted) return;
      setUp(u);
      setPhase('done');
      setLiveSpeed(d ?? 0);
      setProgress(100);
      const record = { down: d, up: u, latency: measured.latency, jitter: measured.jitter, size, at: Date.now() };
      const next = [record, ...history].slice(0, 10);
      setHistory(next);
      localStorage.setItem('toolkit:speedtest-history', JSON.stringify(next));
    } catch {
      cancelRaf();
      setPhase('error');
    } finally {
      setRunning(false);
      cancelRaf();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    cancelRaf();
    setRunning(false);
    setPhase('idle');
    setLiveSpeed(0);
  };

  const clear = () => {
    setHistory([]);
    localStorage.removeItem('toolkit:speedtest-history');
  };

  useEffect(() => () => { abortRef.current?.abort(); cancelRaf(); }, []);

  const pct = Math.max(0, Math.min(1, liveSpeed / gaugeMax));
  const offset = ARC_LEN * (1 - pct);
  const live = running && (phase === 'download' || phase === 'upload');
  const verdict = grade(down, latency ?? 999, jitter ?? 0);
  const best = history.reduce((acc, h) => Math.max(acc, h.down || 0), 0);

  const report = phase === 'done'
    ? `Download ${down?.toFixed(1)} Mbps · Upload ${up?.toFixed(1)} Mbps · Latency ${latency} ms · Jitter ${jitter} ms · ${verdict.label}`
    : 'Network speed test — not run yet';

  return (
    <ToolShell
      toolId="speed-test"
      icon={Gauge}
      title="Network Speed Test"
      desc="Real download, upload, latency and jitter over Cloudflare's speed endpoints, plus what your connection reveals about itself."
      state={{ size, useMeta }}
      onRestore={(saved) => {
        if (saved.size) setSize(saved.size);
        setUseMeta(saved.useMeta ?? true);
      }}
      exportText={report}
      exportName="speed-test.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        {!running ? (
          <Button size="sm" onClick={run} className="gap-1.5"><Play className="h-4 w-4" /> Run test</Button>
        ) : (
          <Button size="sm" variant="destructive" onClick={stop} className="gap-1.5"><Square className="h-4 w-4" /> Stop</Button>
        )}
        <Field label="">
          <Seg value={size} onChange={(v) => setSize(Number(v))} options={SIZES} />
        </Field>
        {history.length > 0 && (
          <Button size="sm" variant="ghost" onClick={clear} className="gap-1.5"><Trash2 className="h-4 w-4" /> Clear history</Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="flex flex-col items-center">
          <div className="relative">
            <svg width="220" height="220" viewBox="0 0 200 200" className="drop-shadow-[0_0_12px_hsl(189_100%_50%/0.15)]">
              <defs>
                <linearGradient id="spd-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="hsl(189 100% 60%)" />
                  <stop offset="100%" stopColor="hsl(189 100% 45%)" />
                </linearGradient>
              </defs>
              <circle cx="100" cy="100" r={R} fill="none" stroke="hsl(var(--secondary))" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${ARC_LEN} ${C}`} transform="rotate(150 100 100)" />
              <circle cx="100" cy="100" r={R} fill="none" stroke="url(#spd-grad)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${ARC_LEN} ${C}`} strokeDashoffset={offset} transform="rotate(150 100 100)" style={{ transition: 'stroke-dashoffset 0.18s ease-out' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-display text-4xl font-bold tabular-nums">{(live ? liveSpeed : phase === 'done' ? (down ?? 0) : 0).toFixed(1)}</div>
              <div className="text-[10px] tracking-[0.25em] text-muted-foreground">Mbps</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-cyan-j">
                {phase === 'download' && <ArrowDown className="h-3 w-3" />}
                {phase === 'upload' && <ArrowUp className="h-3 w-3" />}
                {phase === 'latency' && <Zap className="h-3 w-3" />}
                {phase === 'idle' && <Wifi className="h-3 w-3" />}
                {phase === 'done' && <CheckCircle2 className="h-3 w-3" />}
                {phase === 'error' && <Activity className="h-3 w-3" />}
                {phase === 'idle' ? 'Ready' : phase === 'done' ? 'Complete' : phase === 'error' ? 'Failed' : phase.charAt(0).toUpperCase() + phase.slice(1)}
              </div>
            </div>
          </div>
          <div className="flex w-[220px] justify-between px-3 text-[10px] tabular-nums text-muted-foreground">
            <span>0</span><span>{gaugeMax >= 1000 ? `${gaugeMax / 1000}G` : gaugeMax}</span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Download" value={down != null ? down.toFixed(1) : '—'} sub="Mbps" mono />
            <Stat label="Upload" value={up != null ? up.toFixed(1) : '—'} sub="Mbps" mono />
            <Stat label="Latency" value={latency != null ? String(latency) : '—'} sub="ms" mono />
            <Stat label="Jitter" value={jitter != null ? String(jitter) : '—'} sub="ms spread" mono />
          </div>

          {(running || phase === 'done') && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>{phase === 'done' ? 'Finished' : 'Measuring…'}</span><span>{Math.round(progress)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-j/70 to-cyan-j transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          <Panel className={down ? 'border-cyan-j/40' : undefined}>
            <div className="flex items-start gap-3">
              <Activity className={`mt-0.5 h-4 w-4 shrink-0 ${verdict.tone}`} />
              <div>
                <div className={`text-sm font-semibold ${verdict.tone}`}>{verdict.label}</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{verdict.note}</p>
                {best > 0 && <p className="mt-1 text-[11px] text-muted-foreground/70">Best download you have recorded here: {best.toFixed(1)} Mbps</p>}
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <ToggleRow label="Show what this connection reveals" checked={useMeta} onChange={setUseMeta} hint="IP, network and edge location" />

      {meta && (
        <Panel>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium">
            <Globe2 className="h-3.5 w-3.5 text-cyan-j" /> Your connection
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Public IP" value={meta.ip || '—'} mono />
            <Stat label="Network" value={meta.isp || '—'} />
            <Stat label="Looks like" value={[meta.city, meta.country].filter(Boolean).join(', ') || '—'} />
            <Stat label="Served from" value={meta.colo ? `Edge ${meta.colo}` : '—'} mono />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3" /> This is what the site you are testing with can see — roughly your city, not your address.
          </p>
        </Panel>
      )}

      {history.length > 0 && (
        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium">Past runs</span>
            <span className="text-[11px] text-muted-foreground">download · upload</span>
          </div>
          <div className="flex h-24 items-end gap-1.5">
            {[...history].reverse().map((h) => {
              const max = Math.max(...history.map((x) => x.down || 0), 1);
              return (
                <div key={h.at} className="flex flex-1 flex-col items-center gap-0.5" title={`${h.down?.toFixed(1)} / ${h.up?.toFixed(1)} Mbps`}>
                  <div className="flex h-20 w-full items-end gap-0.5">
                    <span className="w-1/2 rounded-t bg-cyan-j/80" style={{ height: `${Math.max(4, ((h.down || 0) / max) * 100)}%` }} />
                    <span className="w-1/2 rounded-t bg-amber-400/70" style={{ height: `${Math.max(4, ((h.up || 0) / max) * 100)}%` }} />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 space-y-1">
            {history.map((h) => (
              <div key={h.at} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-2 py-1.5 font-mono-j text-[11px]">
                <span className="text-muted-foreground">{new Date(h.at).toLocaleString()}</span>
                <span>↓{h.down?.toFixed(1)} ↑{h.up?.toFixed(1)} · {h.latency} ms</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium">
          <RefreshCw className="h-3.5 w-3.5 text-cyan-j" /> How to read this
        </div>
        <p className="text-[11px] text-muted-foreground">
          Latency is the round trip to the nearest edge, taken as the middle of eight quiet requests; jitter is how much that spread
          stretched, and it matters more than raw speed for calls and games. Downloads stream real bytes and measure as they arrive, so the
          gauge is live rather than a single figure. Wi-Fi, a busy household and the browser's own throttling all show up here, so run it
          twice before blaming your provider.
        </p>
      </Panel>
    </ToolShell>
  );
}