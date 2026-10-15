import { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, Play, RotateCcw, Square } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { Bars, Hero, Pills, Ring, Spark } from '../kit/premium';
import { Panel, Seg, Stat } from '../shared';

const RAFTS = [30, 50, 60, 75, 90, 100, 120, 144, 165, 180, 240];
const EDGES = [8, 12, 17, 22, 33, Infinity];
const BUCKETS = ['≤8 ms', '8–12', '12–17', '17–22', '22–33', '33+'];
const STRESS_LEVELS = [
  { value: 0, label: 'Off' },
  { value: 500, label: '500 blocks' },
  { value: 1500, label: '1,500 blocks' },
  { value: 3000, label: '3,000 blocks' },
];

const nearestRefresh = (median) => {
  let best = 60;
  let gap = Infinity;
  RAFTS.forEach((hz) => {
    const diff = Math.abs(1000 / hz - median);
    if (diff < gap) { gap = diff; best = hz; }
  });
  return best;
};

export default function FpsMeter() {
  const [running, setRunning] = useState(false);
  const [stress, setStress] = useState(0);
  const [samples, setSamples] = useState([]);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const uiRef = useRef(0);
  const bufferRef = useRef([]);

  useEffect(() => {
    if (!running) return undefined;
    lastRef.current = performance.now();
    uiRef.current = performance.now();
    const loop = (now) => {
      const delta = now - lastRef.current;
      lastRef.current = now;
      if (delta > 0 && delta < 2000) {
        bufferRef.current.push(delta);
        if (bufferRef.current.length > 900) bufferRef.current.splice(0, bufferRef.current.length - 900);
      }
      // Repaint the readouts a few times a second rather than every frame.
      if (now - uiRef.current > 220) {
        uiRef.current = now;
        setSamples(bufferRef.current.slice(-360));
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  const stats = useMemo(() => {
    if (samples.length < 12) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const worst = sorted[sorted.length - 1];
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const nominal = nearestRefresh(median);
    const budget = 1000 / nominal;
    const jank = samples.filter((s) => s > budget * 1.5).length;
    const dropped = samples.reduce((acc, s) => acc + Math.max(0, Math.round(s / budget) - 1), 0);
    const onTime = 1 - jank / samples.length;
    return { median, p95, worst, mean, nominal, budget, jank, dropped, onTime, fps: 1000 / mean, count: samples.length };
  }, [samples]);

  const histogram = useMemo(() => {
    const rows = BUCKETS.map((label) => ({ label, value: 0 }));
    samples.forEach((s) => {
      const index = EDGES.findIndex((edge) => s <= edge);
      rows[index === -1 ? rows.length - 1 : index].value += 1;
    });
    return rows;
  }, [samples]);

  const reset = () => {
    bufferRef.current = [];
    setSamples([]);
  };

  const report = stats
    ? [
      'Frames per second ' + stats.fps.toFixed(1),
      'Display refresh detected ' + stats.nominal + ' Hz (frame budget ' + stats.budget.toFixed(2) + ' ms)',
      'Median frame ' + stats.median.toFixed(1) + ' ms · 95th percentile ' + stats.p95.toFixed(1) + ' ms · worst ' + stats.worst.toFixed(1) + ' ms',
      'Frames late by more than half a budget: ' + stats.jank + ' of ' + stats.count + ' (' + ((stats.jank / stats.count) * 100).toFixed(1) + '%)',
      'Estimated dropped frames ' + stats.dropped,
      'Stress blocks on screen: ' + stress,
    ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="fps-meter"
      icon={Gauge}
      title="Frame Rate & Jank Meter"
      desc="Live frame pacing: frames per second, median and worst frame times, the share of frames that arrive late, dropped frames, and the refresh rate this display is actually running at."
      state={{ stress }}
      onRestore={(restored) => { if (restored.stress !== undefined) setStress(Number(restored.stress)); }}
      exportText={report}
      exportName="frame-rate-report.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setRunning((current) => !current)} className="gap-1.5">
          {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {running ? 'Stop measuring' : 'Start measuring'}
        </Button>
        <Button size="sm" variant="outline" onClick={reset} className="gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Clear samples</Button>
        <span className="text-[11px] text-muted-foreground">Frame times are read from the browser’s own animation callback — nothing leaves this device.</span>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium">Stress the compositor</span>
          <span className="text-[11px] text-muted-foreground">Animated blocks on the page — watch the late frames climb</span>
        </div>
        <Seg value={stress} onChange={setStress} options={STRESS_LEVELS} />
        {stress > 0 && (
          <div className="mt-3 h-40 overflow-hidden rounded-xl border border-border/60 bg-card/30">
            <div className="flex flex-wrap gap-px p-1">
              {Array.from({ length: stress }, (_, i) => (
                <span key={i} className="animate-orb-pulse h-2 w-2 rounded-sm bg-cyan-j/35" style={{ animationDelay: (i % 40) * 20 + 'ms' }} />
              ))}
            </div>
          </div>
        )}
      </Panel>

      {!stats && (
        <Panel className="!p-3">
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>Press start and leave the tab in front. Samples are collected only while this tab is visible, because a background tab throttles animation frames to a crawl and the numbers would be meaningless.</p>
            <p>Frames per second here is capped by the display: an idle 60 Hz screen reports 60, and nothing this page does can exceed it.</p>
            <p>A frame that arrives more than half a frame budget late is counted as late. That is the number to watch when an app feels stuttery while still reporting a healthy average.</p>
          </div>
        </Panel>
      )}

      {stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr]">
            <Hero
              label="Frames per second"
              value={stats.fps.toFixed(1)}
              unit="fps"
              sub={'mean over the last ' + stats.count + ' frames · display running at ' + stats.nominal + ' Hz'}
              tone={stats.fps >= stats.nominal * 0.95 ? 'emerald' : stats.fps >= stats.nominal * 0.7 ? 'cyan' : 'rose'}
            />
            <Ring
              value={stats.onTime * 100}
              max={100}
              tone={stats.onTime > 0.97 ? 'emerald' : stats.onTime > 0.9 ? 'cyan' : 'rose'}
              label="Frames on time"
              sub={stats.jank + ' of ' + stats.count + ' arrived late'}
            />
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Median frame" value={stats.median.toFixed(1) + ' ms'} mono sub={'budget ' + stats.budget.toFixed(2) + ' ms'} />
              <Stat label="95th percentile" value={stats.p95.toFixed(1) + ' ms'} mono sub="one frame in twenty is slower" />
              <Stat label="Worst frame" value={stats.worst.toFixed(1) + ' ms'} mono sub="the hitch you actually notice" />
              <Stat label="Dropped frames" value={String(stats.dropped)} mono sub="estimated from late arrivals" />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Frame times, most recent {Math.min(120, samples.length)} frames</div>
            <Spark data={samples.slice(-120)} height={52} tone={stats.onTime > 0.95 ? 'cyan' : 'rose'} />
            <p className="mt-1 text-[11px] text-muted-foreground">Flat is smooth. A spike is a dropped frame — the taller the spike, the longer the stall.</p>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">How the frame times are distributed</div>
              <Bars data={histogram} format={(value) => String(value)} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                On a {stats.nominal} Hz display the ideal frame sits near {stats.budget.toFixed(1)} ms. A second cluster above that is the real story: a steady stream of
                late frames rather than the occasional spike.
              </p>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Reading the numbers</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· Animation frames are tied to the display refresh. 60 Hz means 16.7 ms per frame, 120 Hz means 8.3 ms, and a slow screen will not show more.</p>
                <p>· A healthy average can hide trouble. Eight smooth frames followed by one 100 ms stall still reads as a good average while looking broken.</p>
                <p>· Jank often comes from JavaScript running on the main thread, a large layout that reflows, a canvas being resized, or another tab competing for the same CPU.</p>
                <p>· Laptop power-saving modes cut the GPU and CPU clocks and can halve the frame rate with no code change at all.</p>
                <p>· Thermal throttling builds up over minutes. If the rate decays while measuring, the device is heating, not the page getting worse.</p>
                <p>· With the stress blocks on, watch how quickly the on-time share falls — that is the headroom this device has for busy pages.</p>
              </div>
              <div className="mt-3">
                <Pills
                  items={[
                    { label: 'Refresh', value: stats.nominal + ' Hz' },
                    { label: 'Budget', value: stats.budget.toFixed(2) + ' ms' },
                    { label: 'Stress', value: stress ? stress + ' blocks' : 'off' },
                  ]}
                />
              </div>
            </Panel>
          </div>
        </>
      )}
    </ToolShell>
  );
}