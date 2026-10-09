import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { absError, relError, pctError, sampleStats } from '../lib/uncertainty.js';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';

// Virtual Experimental Physics Laboratory. Each experiment provides apparatus
// (parameter controls), multiple trials with realistic measurement uncertainty,
// raw measurements, a calculated value with uncertainty, % error vs theory,
// and observations. Deterministic physics — measurement noise is random but
// the underlying law is exact.

const EXPERIMENTS = {
  projectile: { name: 'Projectile Motion', theory: (p) => p.v * p.v * Math.sin(2 * p.angle) / 9.81, calc: (trials) => trials.map((t) => t.range), label: 'Range R (m)', measure: (p) => p.v * p.v * Math.sin(2 * p.angle) / 9.81 * (1 + (Math.random() - 0.5) * 0.04), params: [['v', 'Initial speed (m/s)', 20, 5, 50, 1], ['angle', 'Angle (deg)', 45, 10, 80, 1]] },
  pendulum: { name: 'Simple Pendulum (measure g)', theory: (p) => 9.81, calc: (trials, p) => trials.map((t) => 4 * Math.PI * Math.PI * p.L / (t.T * t.T)), label: 'g (m/s²)', measure: (p) => 2 * Math.PI * Math.sqrt(p.L / 9.81) * (1 + (Math.random() - 0.5) * 0.02), measureLabel: 'T (s)', params: [['L', 'Length L (m)', 1, 0.2, 2, 0.05]] },
  ohm: { name: "Ohm's Law", theory: (p) => p.V / p.R, calc: (trials) => trials.map((t) => t.I), label: 'Current I (A)', measure: (p) => (p.V / p.R) * (1 + (Math.random() - 0.5) * 0.03), measureLabel: 'I (A)', params: [['V', 'Voltage (V)', 6, 1, 12, 0.5], ['R', 'Resistance (Ω)', 100, 10, 1000, 10]] },
  lens: { name: 'Convex Lens (focal length)', theory: (p) => 1 / (1 / p.u + 1 / p.v), calc: (trials, p) => trials.map((t) => 1 / (1 / p.u + 1 / t.v)), label: 'f (cm)', measure: (p) => (p.u * p.v / (p.u + p.v)) * (1 + (Math.random() - 0.5) * 0.05), measureLabel: 'v (cm)', params: [['u', 'Object distance u (cm)', 30, 10, 80, 1], ['v', 'Image distance v (cm)', 30, 10, 80, 1]] },
  resonance: { name: 'Resonance Tube (speed of sound)', theory: (p) => 343, calc: (trials, p) => trials.map((t) => 4 * p.f * t.L), label: 'v (m/s)', measure: (p) => (343 / (4 * p.f)) * (1 + (Math.random() - 0.5) * 0.03), measureLabel: 'L (m)', params: [['f', 'Frequency (Hz)', 512, 200, 1000, 1]] },
};

export default function VirtualExperiments() {
  const [exp, setExp] = useState('projectile');
  const [params, setParams] = useState({ v: 20, angle: 45, L: 1, V: 6, R: 100, u: 30, v: 30, f: 512 });
  const [trials, setTrials] = useState([]);
  const E = EXPERIMENTS[exp];
  const { explain, explaining, output } = useAIExplain();

  const takeTrial = () => { const m = E.measure(params); const trial = E.measureLabel ? { [E.measureLabel === 'T (s)' ? 'T' : E.measureLabel === 'I (A)' ? 'I' : E.measureLabel === 'v (cm)' ? 'v' : 'L']: m } : { range: m }; setTrials((t) => [...t, trial]); };
  const theoretical = useMemo(() => E.theory(params), [E, params]);
  const calcValues = useMemo(() => { if (!trials.length) return []; return E.calc(trials, params); }, [trials, E, params]);
  const stats = useMemo(() => sampleStats(calcValues), [calcValues]);
  const pctErr = stats.n ? pctError(stats.mean, theoretical) : 0;

  return (
    <div className="space-y-4">
      <ResearchHeader title="Virtual Experimental Physics Laboratory" subtitle="Perform experiments from setup to final result: apparatus, adjustable parameters, multiple trials, raw measurements, calculated values with uncertainty, % error vs theory, and observations."
        onExplain={() => explain(`Virtual experiment: ${E.name}. ${trials.length} trials, measured ${E.label} = ${stats.mean?.toFixed(4) ?? '—'} vs theory ${theoretical.toFixed(4)} (${pctErr.toFixed(2)}% error).`)} explaining={explaining} />
      <div className="flex flex-wrap gap-1.5">{Object.entries(EXPERIMENTS).map(([k, e]) => <button key={k} onClick={() => { setExp(k); setTrials([]); }} className={`rounded-full px-3 py-1.5 text-xs ${exp === k ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{e.name}</button>)}</div>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card title="Apparatus / Setup">
          {E.params.map(([key, label, def, min, max, step]) => <div key={key} className="mt-1"><NumField label={label} value={params[key]} onChange={(v) => setParams((p) => ({ ...p, [key]: v }))} min={min} max={max} step={step} /></div>)}
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Take measurement</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" />Reset</Button></div>
          <div className="mt-2 text-xs text-muted-foreground">Theoretical {E.label}: <span className="font-mono text-cyan-j">{theoretical.toFixed(4)}</span></div>
        </Card>
        <div className="space-y-3">
          <Card title={`Raw Measurements (${trials.length} trials)`}>
            {trials.length ? <SciTable headers={['Trial #', ...Object.keys(trials[0]), 'Calculated']} rows={trials.map((t, i) => [i + 1, ...Object.values(t).map((v) => v.toFixed(4)), calcValues[i]?.toFixed(4)])} /> : <div className="text-sm text-muted-foreground py-6 text-center">Take measurements to populate the data table.</div>}
          </Card>
          {stats.n > 0 && (
            <Card title="Analysis & Uncertainty">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[['Mean', stats.mean.toFixed(4)], ['Std Dev', stats.sd.toFixed(4)], ['Std of Mean', stats.sdm.toFixed(4)], ['% Error', pctErr.toFixed(2) + '%']].map(([k, v]) => <div key={k} className="rounded-lg border border-border/50 bg-card/30 px-2.5 py-1.5"><div className="text-[10px] uppercase text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>)}
              </div>
              <SciPlot type="scatter" data={calcValues.map((c, i) => ({ x: i + 1, y: c }))} xKey="x" series={[{ key: 'y', label: E.label, color: '#22d3ee' }]} xLabel="trial" yLabel={E.label} height={180} exportName="trials" />
              <p className="mt-2 text-xs text-muted-foreground">Measured {E.label} = <span className="font-mono">{stats.mean.toFixed(4)} ± {stats.sdm.toFixed(4)}</span> vs theoretical <span className="font-mono">{theoretical.toFixed(4)}</span>. {pctErr < 5 ? 'Excellent agreement.' : pctErr < 15 ? 'Good agreement within experimental uncertainty.' : 'Significant deviation — check setup or reduce noise.'}</p>
            </Card>
          )}
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}