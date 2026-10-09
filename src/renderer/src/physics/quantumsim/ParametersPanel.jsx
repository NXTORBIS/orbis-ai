import React from 'react';
import { Sliders, Play, Hammer, AlertTriangle } from 'lucide-react';
import Section from './Section';
import { resourceEstimate } from '../quantum/spinEngine.js';

const NUM_STATES_OPTS = [1, 2, 5, 10, 20];

export default function ParametersPanel({ params, setParams, onBuild, onRun, status }) {
  const res = resourceEstimate(params.N);
  const set = (k, v) => setParams((p) => ({ ...p, [k]: v }));
  const busy = ['building', 'validating', 'solving', 'observables'].includes(status);
  const denseOk = params.N <= 8;

  return (
    <Section title="Parameters" icon={Sliders} right={<span className="text-[10px] text-muted-foreground">1D Heisenberg S=½ chain</span>}>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Field label={`Number of sites N = ${params.N}`}>
          <input type="range" min={2} max={16} value={params.N} onChange={(e) => set('N', +e.target.value)} className="w-full accent-cyan-500" />
          <div className="mt-1 flex justify-between text-[9px] text-muted-foreground"><span>2</span><span>16</span></div>
        </Field>
        <Field label="Exchange coupling J">
          <NumInput value={params.J} step={0.1} onChange={(v) => set('J', v)} />
          <p className="mt-1 text-[10px] text-muted-foreground">{params.J > 0 ? 'Antiferromagnetic' : params.J < 0 ? 'Ferromagnetic' : 'Non-interacting'}</p>
        </Field>
        <Field label="External field h">
          <NumInput value={params.h} step={0.1} onChange={(v) => set('h', v)} />
        </Field>
        <Field label="Boundary condition">
          <div className="flex gap-2">
            <Toggle active={!params.periodic} onClick={() => set('periodic', false)}>Open</Toggle>
            <Toggle active={params.periodic} onClick={() => set('periodic', true)}>Periodic</Toggle>
          </div>
        </Field>
        <Field label="Solver">
          <select value={params.solver} onChange={(e) => set('solver', e.target.value)} className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
            <option value="lanczos">Lanczos (sparse iterative)</option>
            <option value="dense" disabled={!denseOk}>Dense ED {denseOk ? '' : '— N≤8'}</option>
          </select>
        </Field>
        <Field label="Eigenvalues requested">
          <div className="flex flex-wrap gap-1">
            {NUM_STATES_OPTS.map((n) => (
              <button key={n} onClick={() => set('numStates', n)} className={`rounded-md border px-2 py-1 text-xs ${params.numStates === n ? 'border-cyan-j bg-cyan-j/15 text-cyan-j' : 'border-border text-muted-foreground hover:bg-accent'}`}>{n}</button>
            ))}
            <NumInput value={params.numStates} step={1} small onChange={(v) => set('numStates', Math.max(1, Math.round(v)))} />
          </div>
        </Field>
      </div>

      <div className="mt-4 grid gap-2 rounded-lg border border-border/50 bg-secondary/30 p-3 text-xs md:grid-cols-3">
        <Stat label="Hilbert dimension D" value={res.D.toLocaleString()} />
        <Stat label="Dense memory" value={`${res.denseMB.toFixed(2)} MB`} warn={res.denseMB > 512} />
        <Stat label="Recommended" value={res.method} />
      </div>
      {res.warning && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" /> <span>{res.warning}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onBuild} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50">
          <Hammer className="h-4 w-4" /> Build Hamiltonian
        </button>
        <button onClick={onRun} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-cyan-j px-5 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50">
          <Play className="h-4 w-4" /> {status === 'complete' ? 'Re-run Simulation' : 'Run Simulation'}
        </button>
      </div>
    </Section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
function NumInput({ value, step = 0.1, onChange, small }) {
  return <input type="number" value={value} step={step} onChange={(e) => onChange(parseFloat(e.target.value))} className={`${small ? 'w-16' : 'w-full'} rounded-md border border-input bg-transparent px-2 py-1.5 text-sm`} />;
}
function Toggle({ active, onClick, children }) {
  return <button onClick={onClick} className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${active ? 'border-cyan-j bg-cyan-j/15 text-cyan-j' : 'border-border text-muted-foreground hover:bg-accent'}`}>{children}</button>;
}
function Stat({ label, value, warn }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm ${warn ? 'text-amber-500' : 'text-foreground'}`}>{value}</div>
    </div>
  );
}