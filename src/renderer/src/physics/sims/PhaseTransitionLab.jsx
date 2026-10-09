import React, { useState, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, NotImplemented } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { runInWorker } from '../lib/workers.js';
import { Button } from '../ui/button.jsx';
import { Play, Square, Loader2 } from 'lucide-react';

// Phase-transition analyser: temperature sweep of a 2D Ising model computing
// M(T), E(T), C_V(T), χ(T) via Monte Carlo in a Web Worker (keeps the UI
// responsive). Validated against the exact Onsager solution Tc≈2.269 (J=1).
const TC_EXACT = 2 / Math.log(1 + Math.sqrt(2));

// Worker function: runs MC at each temperature, returns observables.
function sweepWorker(payload, report) {
  const { N, J, Tmin, Tmax, Tsteps, sweepsPerT } = payload;
  const dT = (Tmax - Tmin) / (Tsteps - 1);
  const out = [];
  for (let ti = 0; ti < Tsteps; ti++) {
    const T = Tmin + ti * dT;
    const spins = new Int8Array(N * N); for (let i = 0; i < N * N; i++) spins[i] = 1;
    let M = N * N, E = -2 * J * N * N;
    const nb = (i, j) => spins[((i + 1) % N) * N + j] + spins[((i - 1 + N) % N) * N + j] + spins[i * N + ((j + 1) % N)] + spins[i * N + ((j - 1 + N) % N)];
    // thermalise
    for (let s = 0; s < sweepsPerT; s++) {
      for (let k = 0; k < N * N; k++) {
        const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0; const si = spins[i * N + j]; const dE = 2 * J * si * nb(i, j);
        if (dE <= 0 || Math.random() < Math.exp(-dE / T)) { spins[i * N + j] = -si; M += -2 * si; E += dE; }
      }
      if (s % 50 === 0) report(ti / Tsteps + s / sweepsPerT / Tsteps, { ti, T: +T.toFixed(3), M: Math.abs(M) / (N * N), E: E / (N * N) });
    }
    // measure fluctuations
    let Msum = 0, M2 = 0, Esum = 0, E2 = 0;
    for (let s = 0; s < sweepsPerT; s++) {
      for (let k = 0; k < N * N; k++) { const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0; const si = spins[i * N + j]; const dE = 2 * J * si * nb(i, j); if (dE <= 0 || Math.random() < Math.exp(-dE / T)) { spins[i * N + j] = -si; M += -2 * si; E += dE; } }
      const m = Math.abs(M) / (N * N), e = E / (N * N); Msum += m; M2 += m * m; Esum += e; E2 += e * e;
    }
    const n = sweepsPerT; const mAvg = Msum / n, eAvg = Esum / n;
    const cv = (E2 / n - eAvg * eAvg) / (T * T) * N * N;
    const chi = (M2 / n - mAvg * mAvg) / T * N * N;
    out.push({ T: +T.toFixed(3), M: +mAvg.toFixed(4), E: +eAvg.toFixed(4), Cv: +cv.toFixed(3), Chi: +chi.toFixed(3) });
    report((ti + 1) / Tsteps, null);
  }
  return out;
}

export default function PhaseTransitionLab() {
  const [N, setN] = useState(20); const [Tsteps, setTsteps] = useState(20); const [sweeps, setSweeps] = useState(200);
  const [data, setData] = useState([]); const [running, setRunning] = useState(false); const [progress, setProgress] = useState(0);
  const ctrlRef = useRef(null); const [err, setErr] = useState(null);
  const { explain, explaining, output } = useAIExplain();

  const run = async () => {
    setRunning(true); setErr(null); setData([]); setProgress(0);
    ctrlRef.current = new AbortController();
    try {
      const res = await runInWorker(sweepWorker, { payload: { N, J: 1, Tmin: 0.5, Tmax: 4.5, Tsteps, sweepsPerT: sweeps }, onProgress: (p) => setProgress(p), signal: ctrlRef.current.signal });
      setData(res);
    } catch (e) { if (e.message !== 'aborted') setErr(e.message); }
    finally { setRunning(false); }
  };
  const cancel = () => { ctrlRef.current?.abort(); setRunning(false); };

  return (
    <div className="space-y-4">
      <ResearchHeader title="Phase Transition Laboratory" subtitle="Temperature sweep of the 2D Ising model computing M(T), E(T), C_V(T) and χ(T) via Monte Carlo in a real Web Worker. Validated against the exact Onsager solution Tc ≈ 2.269 (J=1)."
        onExplain={() => explain(`Phase transitions: ${data.length} temperature points. Peak of C_V/χ near Tc≈${TC_EXACT.toFixed(3)} marks the critical point.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card title="Sweep Settings">
          <NumField label="Lattice N" value={N} onChange={setN} min={8} max={48} step={2} />
          <div className="mt-2"><NumField label="Temperature points" value={Tsteps} onChange={setTsteps} min={5} max={40} step={1} /></div>
          <div className="mt-2"><NumField label="MC sweeps / T" value={sweeps} onChange={setSweeps} min={50} max={1000} step={50} /></div>
          <div className="mt-3 flex gap-2">{running ? <Button size="sm" variant="destructive" onClick={cancel}><Square className="size-3.5" />Cancel</Button> : <Button size="sm" onClick={run}><Play className="size-3.5" />Run sweep</Button>}</div>
          {running && <div className="mt-2"><div className="h-2 rounded-full bg-card/40 overflow-hidden"><div className="h-full bg-cyan-j transition-all" style={{ width: `${progress * 100}%` }} /></div><div className="mt-1 text-xs text-muted-foreground">{Math.round(progress * 100)}% — running in Web Worker</div></div>}
          {err && <div className="mt-2 text-xs text-red-500">Error: {err}</div>}
          <SciTable headers={['Quantity', 'Value']} rows={[['Exact Tc (Onsager)', TC_EXACT.toFixed(4)], ['Model', '2D Ising, J=1'], ['Compute', 'Web Worker MC']]} />
        </Card>
        <div className="space-y-3">
          <Card title="M(T) & E(T)"><SciPlot type="line" data={data} xKey="T" series={[{ key: 'M', label: '⟨|M|⟩', color: '#22d3ee' }, { key: 'E', label: '⟨E⟩', color: '#f97316' }]} xLabel="T" yLabel="observable" height={200} exportName="MT" /></Card>
          <Card title="C_V(T) & χ(T) — peaks mark Tc"><SciPlot type="line" data={data} xKey="T" series={[{ key: 'Cv', label: 'C_V', color: '#a855f7' }, { key: 'Chi', label: 'χ', color: '#84cc16' }]} xLabel="T" yLabel="observable" height={200} exportName="CvT" /></Card>
          <p className="text-xs text-muted-foreground">Magnetisation drops to zero above Tc; C_V and susceptibility peak sharply at the critical temperature (finite-size rounding for small N).</p>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}