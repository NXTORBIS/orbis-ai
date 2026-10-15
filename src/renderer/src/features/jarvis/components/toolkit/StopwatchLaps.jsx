import { useEffect, useRef, useState } from 'react';
import { Activity, Flag, Play, RotateCcw, Square } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Panel, Stat, CopyBtn } from './shared';
import ToolShell from './kit/ToolShell';

const fmt = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
};

export default function StopwatchLaps() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [laps, setLaps] = useState([]);
  const baseRef = useRef(0);
  const startedRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!running) return undefined;
    startedRef.current = performance.now();
    const tick = () => {
      setElapsed(baseRef.current + (performance.now() - startedRef.current));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  const toggle = () => {
    if (running) {
      baseRef.current += performance.now() - startedRef.current;
      setElapsed(baseRef.current);
      setRunning(false);
    } else {
      setRunning(true);
    }
  };

  const reset = () => {
    setRunning(false);
    baseRef.current = 0;
    setElapsed(0);
    setLaps([]);
  };

  const lap = () => {
    if (!elapsed) return;
    const previous = laps.length ? laps[0].total : 0;
    setLaps((current) => [{ total: elapsed, split: elapsed - previous }, ...current]);
  };

  const splits = laps.map((l) => l.split);
  const fastest = splits.length > 1 ? Math.min(...splits) : null;
  const slowest = splits.length > 1 ? Math.max(...splits) : null;

  const lapText = laps.slice().reverse().map((l, i) => `${i + 1}\t${fmt(l.split)}\t${fmt(l.total)}`).join('\n');

  return (
    <ToolShell
      toolId="stopwatch"
      icon={Activity}
      title="Stopwatch with Laps"
      desc="Precise to hundredths of a second, with split times, fastest and slowest laps."
      state={{ laps }}
      onRestore={(saved) => { setLaps(saved.laps || []); }}
      exportText={JSON.stringify(laps, null, 2)}
      exportName="laps.json"
      exportMime="application/json"
    >
      <Panel className="text-center">
        <div className="font-display text-5xl font-bold tabular-nums tracking-tight text-cyan-j sm:text-6xl">{fmt(elapsed)}</div>
        <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{running ? 'running' : elapsed ? 'paused' : 'ready'}</div>
      </Panel>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={toggle} className="gap-1.5">
          {running ? <><Square className="h-3.5 w-3.5" /> Stop</> : <><Play className="h-3.5 w-3.5" /> {elapsed ? 'Resume' : 'Start'}</>}
        </Button>
        <Button size="sm" variant="outline" onClick={lap} disabled={!elapsed} className="gap-1.5"><Flag className="h-3.5 w-3.5" /> Lap</Button>
        <Button size="sm" variant="outline" onClick={reset} disabled={!elapsed && !laps.length} className="gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
        <CopyBtn value={lapText} label="Copy laps" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Laps" value={String(laps.length)} />
        <Stat label="Fastest lap" value={fastest !== null ? fmt(fastest) : '—'} mono />
        <Stat label="Slowest lap" value={slowest !== null ? fmt(slowest) : '—'} mono />
      </div>
      {laps.length > 0 && (
        <Panel>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Laps — newest first</div>
          <div className="divide-y divide-border/50">
            {laps.map((l, i) => {
              const number = laps.length - i;
              const isFast = fastest !== null && l.split === fastest;
              const isSlow = slowest !== null && l.split === slowest;
              return (
                <div key={`${number}-${l.total}`} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-10 text-xs text-muted-foreground">#{number}</span>
                  <span className={`flex-1 font-mono-j text-xs ${isFast ? 'text-emerald-500' : isSlow ? 'text-red-500' : ''}`}>{fmt(l.split)}</span>
                  <span className="font-mono-j text-xs text-muted-foreground">{fmt(l.total)}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      <p className="text-[11px] text-muted-foreground">Lap shows the split for that lap; the grey column is the total elapsed time at that point.</p>
    </ToolShell>
  );
}