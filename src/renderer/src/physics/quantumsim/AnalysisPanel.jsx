import React, { useState, useRef } from 'react';
import { TrendingUp, GitCompareArrows, Play, Pause, Square } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import Section from './Section';
import { applyHamiltonian, localMagnetization } from '../quantum/spinEngine.js';
import { lanczos } from '../quantum/lanczos.js';
import { runSweep } from '../quantum/sweep.js';

export default function AnalysisPanel({ params }) {
  return (
    <>
      <SweepPanel params={params} />
      <BoundaryComparePanel params={params} />
    </>
  );
}

function SweepPanel({ params }) {
  const [param, setParam] = useState('h');
  const [start, setStart] = useState(-2);
  const [end, setEnd] = useState(2);
  const [steps, setSteps] = useState(40);
  const [data, setData] = useState([]);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const runnerRef = useRef(null);

  const run = () => {
    setData([]); setRunning(true); setProgress(0); setDone(0);
    const r = runSweep(params, { param, start, end, steps }, ({ done: d, total, results, cancelled }) => {
      setData(results); setProgress(d / total); setDone(d);
      if (cancelled || d === total) setRunning(false);
    });
    runnerRef.current = r;
  };
  const cancel = () => runnerRef.current?.cancel();

  return (
    <Section title="Parameter Sweep" icon={TrendingUp} right={
      running ? <span className="text-[11px] text-cyan-j">{done}/{steps} · {(progress * 100).toFixed(0)}%</span> : null
    }>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Parameter">
          <select value={param} onChange={(e) => setParam(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
            <option value="h">External field h</option>
            <option value="J">Coupling J</option>
          </select>
        </Field>
        <Field label="Start"><NumInput value={start} onChange={setStart} /></Field>
        <Field label="End"><NumInput value={end} onChange={setEnd} /></Field>
        <Field label="Steps"><NumInput value={steps} step={1} onChange={setSteps} /></Field>
        <div className="flex gap-2">
          {!running ? (
            <button onClick={run} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-j px-3 py-2 text-xs font-semibold text-background"><Play className="h-3.5 w-3.5" /> Run sweep</button>
          ) : (
            <button onClick={cancel} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500"><Square className="h-3.5 w-3.5" /> Cancel</button>
          )}
        </div>
      </div>
      {running && <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary"><div className="h-full bg-cyan-j transition-all" style={{ width: `${progress * 100}%` }} /></div>}
      {data.length > 1 && (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <ChartCard title={`E₀(${param})`} data={data} x={param} y="E0" color="#10b981" />
          <ChartCard title={`Gap Δ(${param})`} data={data} x={param} y="gap" color="#f59e0b" />
          <ChartCard title={`|M|(${param})`} data={data} x={param} y="Mz" color="#06b6d4" />
        </div>
      )}
      {data.length === 0 && !running && <p className="mt-2 text-xs text-muted-foreground">No sweep data — run a sweep to plot E₀, the energy gap and magnetization vs the chosen parameter.</p>}
    </Section>
  );
}

function BoundaryComparePanel({ params }) {
  const [res, setRes] = useState(null);
  const [running, setRunning] = useState(false);

  const compare = () => {
    setRunning(true);
    setTimeout(() => {
      const D = 1 << params.N;
      const runOne = (periodic) => {
        const p = { ...params, periodic };
        const apply = (v) => applyHamiltonian(v, p);
        const { eigenvalues, states, residuals } = lanczos(apply, D, { numStates: Math.min(10, params.numStates), maxIter: Math.min(D, 150) });
        const mag = localMagnetization(states[0], params.N);
        const Mz = mag.sz.reduce((a, b) => a + Math.abs(b), 0) / params.N;
        return { E0: eigenvalues[0], gap: (eigenvalues[1] ?? eigenvalues[0]) - eigenvalues[0], Mz, spectrum: eigenvalues, residual: residuals[0] };
      };
      const open = runOne(false);
      const periodic = runOne(true);
      setRes({ open, periodic });
      setRunning(false);
    }, 20);
  };

  return (
    <Section title="Boundary-Condition Comparison" icon={GitCompareArrows} right={
      <button onClick={compare} disabled={running} className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50">{running ? 'Computing…' : 'Compare open vs periodic'}</button>
    }>
      {!res ? (
        <p className="text-xs text-muted-foreground">Compare ground-state energy, gap, magnetization and spectrum for open vs periodic boundary conditions.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1.5 pr-4">Observable</th><th className="py-1.5 pr-4">Open</th><th className="py-1.5 pr-4">Periodic</th><th className="py-1.5">Difference</th></tr></thead>
            <tbody className="font-mono">
              <CmpRow k="E₀" a={res.open.E0} b={res.periodic.E0} />
              <CmpRow k="Energy gap Δ" a={res.open.gap} b={res.periodic.gap} />
              <CmpRow k="|M|/N" a={res.open.Mz} b={res.periodic.Mz} />
              <tr className="border-t border-border/30"><td className="py-1.5 pr-4 text-muted-foreground font-sans">Spectrum (lowest)</td><td className="py-1.5 pr-4">{res.open.spectrum.slice(0, 5).map((e) => e.toFixed(3)).join(', ')}</td><td className="py-1.5 pr-4">{res.periodic.spectrum.slice(0, 5).map((e) => e.toFixed(3)).join(', ')}</td><td className="py-1.5 text-muted-foreground">—</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function CmpRow({ k, a, b }) {
  return <tr className="border-t border-border/20"><td className="py-1.5 pr-4 text-muted-foreground font-sans">{k}</td><td className="py-1.5 pr-4">{a.toFixed(6)}</td><td className="py-1.5 pr-4">{b.toFixed(6)}</td><td className="py-1.5">{(b - a).toFixed(6)}</td></tr>;
}

function ChartCard({ title, data, x, y, color }) {
  return (
    <div className="rounded-lg border border-border/50 bg-secondary/30 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 2, right: 5, bottom: 2, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis dataKey={x} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} domain={['auto', 'auto']} />
          <Tooltip formatter={(v) => v.toFixed(4)} contentStyle={{ fontSize: 10 }} />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Line type="monotone" dataKey={y} stroke={color} dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Field({ label, children }) { return <div><label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</label>{children}</div>; }
function NumInput({ value, step = 0.1, onChange }) { return <input type="number" value={value} step={step} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-20 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm" />; }