import React, { useState, useRef } from 'react';
import { TrendingUp, Play, Square } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts';
import Section from './Section';
import { getCode } from '../lib/qec/codes.js';
import { runThresholdSweep } from '../lib/qec/simulation.js';

export default function ThresholdPanel({ code, model, fault, seed, onSeed, onThreshold }) {
  const [pMin, setPMin] = useState(0.001);
  const [pMax, setPMax] = useState(0.2);
  const [points, setPoints] = useState(12);
  const [trialsPerPoint, setTrialsPerPoint] = useState(5000);
  const [loglog, setLoglog] = useState(true);
  const [data, setData] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const ctrlRef = useRef(null);

  const start = () => {
    const ps = Array.from({ length: points }, (_, i) => pMin + ((pMax - pMin) * i) / (points - 1));
    setData(null); setRunning(true); setProgress(0);
    const opts = { seed, faulty: fault.faulty, pMeas: fault.uniform ? model.p : fault.pMeas };
    const ctrl = runThresholdSweep(code, model, 'lookup', ps, trialsPerPoint, opts, (p) => setProgress((p.index + 1) / p.total));
    ctrlRef.current = ctrl;
    ctrl.promise.then((res) => { setData(res); setRunning(false); if (onThreshold) onThreshold(res); });
  };
  const cancel = () => ctrlRef.current?.cancel();

  const chartData = data?.points.filter((d) => d.trials > 0).map((d) => ({ p: d.p, pL: d.pL, ciLo: d.ci.lower, ciHi: d.ci.upper })) || [];
  const valid = chartData.filter((d) => d.pL > 0);

  // crude threshold estimate: last p where p_L < p (suppression). Honest, from data.
  let crossing = null;
  for (const d of chartData) { if (d.pL <= d.p) crossing = d.p; else break; }

  return (
    <Section title="Threshold Analysis" icon={TrendingUp}>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <Num label="p min" value={pMin} onChange={setPMin} step={0.001} />
        <Num label="p max" value={pMax} onChange={setPMax} step={0.01} />
        <Num label="points" value={points} onChange={setPoints} step={1} />
        <Num label="trials/point" value={trialsPerPoint} onChange={setTrialsPerPoint} step={1000} />
        <label className="flex items-center gap-1 text-muted-foreground"><input type="checkbox" checked={loglog} onChange={(e) => setLoglog(e.target.checked)} /> log–log</label>
        {!running ? (
          <button onClick={start} className="flex items-center gap-1 rounded bg-cyan-j px-3 py-1.5 text-white btn-press"><Play className="h-3.5 w-3.5" /> Sweep</button>
        ) : (
          <button onClick={cancel} className="flex items-center gap-1 rounded border border-red-500/50 px-3 py-1.5 text-red-400"><Square className="h-3.5 w-3.5" /> Cancel</button>
        )}
      </div>

      {(running || progress > 0) && (
        <div className="mt-3 h-2 overflow-hidden rounded bg-secondary">
          <div className="h-full bg-cyan-j" style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      {data && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase text-muted-foreground">p_L vs p — estimated from simulation ({trialsPerPoint.toLocaleString()} trials/point)</div>
          {valid.length < 2 ? (
            <p className="text-[11px] text-amber-500">No logical failures observed — increase trials or p range to see p_L &gt; 0.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData} margin={{ top: 5, right: 12, bottom: 18, left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis type="number" dataKey="p" scale={loglog ? 'log' : 'linear'} domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} label={{ value: 'p (physical)', position: 'insideBottom', offset: -10, fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                <YAxis type="number" dataKey="pL" scale={loglog ? 'log' : 'linear'} domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} label={{ value: 'p_L', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                <Tooltip formatter={(v) => v.toExponential(3)} contentStyle={{ fontSize: 11 }} />
                <ReferenceLine segment={[{ p: pMin, pL: pMin }, { p: pMax, pL: pMax }]} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="pL" stroke="#06b6d4" dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
          {crossing != null && <div className="mt-1 text-[11px] text-muted-foreground">Suppression (p_L &lt; p) observed up to p ≈ {crossing.toExponential(3)} — threshold estimate, not exact.</div>}
          {data.cancelled && <div className="text-[11px] text-amber-500">Sweep cancelled — partial data shown.</div>}
        </div>
      )}
    </Section>
  );
}

function Num({ label, value, onChange, step }) {
  return (
    <label className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(+e.target.value || 0)} className="w-24 rounded border border-input bg-transparent px-2 py-1 font-mono" />
    </label>
  );
}