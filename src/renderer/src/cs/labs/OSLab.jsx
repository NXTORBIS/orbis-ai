import React, { useState } from 'react';
import { Terminal, Play, Plus, Trash2 } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// CPU scheduling simulator: FCFS, SJF, SRTF, Round Robin.
// Input processes → compute Gantt chart + avg wait/turnaround time.
const ALGOS = ['FCFS', 'SJF', 'SRTF', 'RR'];

export default function OSLab() {
  const [algo, setAlgo] = useState('FCFS');
  const [quantum, setQuantum] = useState(2);
  const [procs, setProcs] = useState([
    { id: 'P1', burst: 5, arrival: 0 },
    { id: 'P2', burst: 3, arrival: 1 },
    { id: 'P3', burst: 8, arrival: 2 },
  ]);

  const addProc = () => setProcs((p) => [...p, { id: `P${p.length + 1}`, burst: 4, arrival: 0 }]);
  const removeProc = (i) => setProcs((p) => p.filter((_, idx) => idx !== i));
  const updateProc = (i, key, val) => setProcs((p) => p.map((x, idx) => idx === i ? { ...x, [key]: +val } : x));

  const result = computeSchedule(procs, algo, quantum);

  return (
    <LabShell icon={Terminal} title="Operating Systems" description="CPU scheduling simulator — compare FCFS, SJF, SRTF and Round Robin with a live Gantt chart.">
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex gap-1">
            {ALGOS.map((a) => (
              <button key={a} onClick={() => setAlgo(a)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${algo === a ? 'bg-cyan-j text-background' : 'border border-border text-muted-foreground hover:border-cyan-j/40'}`}>{a}</button>
            ))}
          </div>
          {algo === 'RR' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Quantum:</span>
              <input type="number" min="1" value={quantum} onChange={(e) => setQuantum(Math.max(1, +e.target.value))} className="w-16 rounded-md border border-border bg-card px-2 py-1 font-mono-j" />
            </div>
          )}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold">Processes</span>
              <button onClick={addProc} className="flex items-center gap-1 rounded bg-cyan-j/10 px-2 py-0.5 text-xs text-cyan-j hover:bg-cyan-j/20"><Plus className="size-3" /> Add</button>
            </div>
            <div className="divide-y divide-border">
              {procs.map((p, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2">
                  <span className="w-8 font-mono-j text-xs font-bold text-cyan-j">{p.id}</span>
                  <label className="flex flex-1 flex-col text-[9px] text-muted-foreground">Arrival
                    <input type="number" value={p.arrival} onChange={(e) => updateProc(i, 'arrival', e.target.value)} className="rounded border border-border bg-background px-1.5 py-1 font-mono-j text-xs" />
                  </label>
                  <label className="flex flex-1 flex-col text-[9px] text-muted-foreground">Burst
                    <input type="number" value={p.burst} onChange={(e) => updateProc(i, 'burst', e.target.value)} className="rounded border border-border bg-background px-1.5 py-1 font-mono-j text-xs" />
                  </label>
                  <button onClick={() => removeProc(i)} aria-label="Remove this process" title="Remove this process" className="text-muted-foreground hover:text-red-400"><Trash2 className="size-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 text-xs font-semibold">Gantt Chart</div>
            <div className="flex h-12 overflow-x-auto scrollbar-thin">
              {result.gantt.map((g, i) => (
                <div key={i} className="flex flex-col items-center border-r border-border px-1" style={{ width: `${Math.max(24, g.end - g.start * 8)}px` }}>
                  <div className="flex-1 w-full bg-cyan-j/15" style={{ backgroundColor: g.id === 'idle' ? 'transparent' : `hsl(${(g.id.charCodeAt(1) * 60) % 360} 70% 45% / 0.35)` }} />
                  <div className="text-[9px] font-mono-j">{g.id === 'idle' ? '—' : g.id}</div>
                  <div className="text-[8px] text-muted-foreground">{g.start}</div>
                </div>
              ))}
            </div>
            <div className="mt-1 text-right text-[10px] text-muted-foreground">ends at t={result.totalTime}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Avg Wait" value={result.avgWait.toFixed(2)} />
            <Stat label="Avg Turnaround" value={result.avgTurnaround.toFixed(2)} />
            <Stat label="Throughput" value={`${(procs.length / result.totalTime).toFixed(2)} proc/t`} />
            <Stat label="CPU Util" value={`${((result.totalTime - result.idleTime) / result.totalTime * 100).toFixed(0)}%`} />
          </div>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="grid grid-cols-5 border-b border-border px-3 py-2 text-[10px] font-semibold text-muted-foreground">
              <span>Process</span><span>Arrival</span><span>Burst</span><span>Wait</span><span>Turnaround</span>
            </div>
            {result.metrics.map((m, i) => (
              <div key={i} className="grid grid-cols-5 px-3 py-1.5 font-mono-j text-xs odd:bg-muted/20">
                <span className="font-bold text-cyan-j">{m.id}</span><span>{m.arrival}</span><span>{m.burst}</span><span>{m.wait}</span><span>{m.turnaround}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </LabShell>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono-j text-lg font-bold text-cyan-j">{value}</div>
    </div>
  );
}

function computeSchedule(procs, algo, quantum) {
  if (!procs.length) return { gantt: [], avgWait: 0, avgTurnaround: 0, totalTime: 0, idleTime: 0, metrics: [] };
  const list = procs.map((p) => ({ ...p, remaining: p.burst, done: false, start: -1, end: -1 }));
  const gantt = [];
  let t = 0, idleTime = 0;
  const completed = [];

  if (algo === 'FCFS') {
    const sorted = [...list].sort((a, b) => a.arrival - b.arrival);
    for (const p of sorted) {
      if (t < p.arrival) { idleTime += p.arrival - t; gantt.push({ id: 'idle', start: t, end: p.arrival }); t = p.arrival; }
      p.start = t; t += p.burst; p.end = t; p.done = true;
      gantt.push({ id: p.id, start: p.start, end: t });
      completed.push(p);
    }
  } else if (algo === 'SJF') {
    while (list.some((p) => !p.done)) {
      const ready = list.filter((p) => !p.done && p.arrival <= t);
      if (!ready.length) { idleTime++; t++; continue; }
      ready.sort((a, b) => a.burst - b.burst);
      const p = ready[0];
      p.start = t; t += p.burst; p.end = t; p.done = true;
      gantt.push({ id: p.id, start: p.start, end: t });
      completed.push(p);
    }
  } else if (algo === 'SRTF') {
    while (list.some((p) => !p.done)) {
      const ready = list.filter((p) => !p.done && p.arrival <= t);
      if (!ready.length) { idleTime++; t++; continue; }
      ready.sort((a, b) => a.remaining - b.remaining);
      const p = ready[0];
      if (p.start === -1) p.start = t;
      p.remaining--; t++;
      if (p.remaining === 0) { p.end = t; p.done = true; completed.push(p); }
      if (gantt.length && gantt[gantt.length - 1].id === p.id) gantt[gantt.length - 1].end = t;
      else gantt.push({ id: p.id, start: t - 1, end: t });
    }
  } else if (algo === 'RR') {
    const queue = [];
    const sorted = [...list].sort((a, b) => a.arrival - b.arrival);
    let idx = 0;
    while (idx < sorted.length || queue.length) {
      while (idx < sorted.length && sorted[idx].arrival <= t) queue.push(sorted[idx++]);
      if (!queue.length) { idleTime++; t++; continue; }
      const p = queue.shift();
      if (p.start === -1) p.start = t;
      const run = Math.min(quantum, p.remaining);
      gantt.push({ id: p.id, start: t, end: t + run });
      t += run; p.remaining -= run;
      while (idx < sorted.length && sorted[idx].arrival <= t) queue.push(sorted[idx++]);
      if (p.remaining > 0) queue.push(p);
      else { p.end = t; p.done = true; completed.push(p); }
    }
  }

  const metrics = procs.map((p) => {
    const c = completed.find((x) => x.id === p.id);
    const turnaround = c ? c.end - p.arrival : 0;
    const wait = turnaround - p.burst;
    return { id: p.id, arrival: p.arrival, burst: p.burst, wait, turnaround };
  });
  const avgWait = metrics.reduce((s, m) => s + m.wait, 0) / metrics.length;
  const avgTurnaround = metrics.reduce((s, m) => s + m.turnaround, 0) / metrics.length;
  return { gantt, avgWait, avgTurnaround, totalTime: t, idleTime, metrics };
}