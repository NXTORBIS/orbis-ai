import { useState } from 'react';
import { Activity, Play, ShieldCheck } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { Area, CopyBtn, Field, Panel, Stat } from '../shared';
import { Hero } from '../kit/premium';
import { KINETICS_PRESETS, simulate, verifyKinetics } from './kineticsCore';

const COLOURS = ['hsl(189 100% 50%)', 'hsl(265 85% 68%)', 'hsl(160 84% 52%)', 'hsl(38 92% 55%)', 'hsl(350 89% 60%)', 'hsl(210 90% 65%)'];

function TraceChart({ series, species }) {
  const width = 720;
  const height = 220;
  const maxT = Math.max(...series.map((point) => point.t), 1e-9);
  const maxV = Math.max(...series.flatMap((point) => species.map((id) => point.values[id])), 1e-9);
  const line = (id) => series.map((point, index) => `${index ? 'L' : 'M'}${((point.t / maxT) * width).toFixed(1)},${(height - (point.values[id] / maxV) * (height - 12) - 6).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full">
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line key={fraction} x1="0" x2={width} y1={height * fraction} y2={height * fraction} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3 5" />
      ))}
      {species.map((id, index) => (
        <path key={id} d={line(id)} fill="none" stroke={COLOURS[index % COLOURS.length]} strokeWidth="2" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

export default function KineticsStudio() {
  const [setup, setSetup] = useState({ presetId: 'firstOrder', ...KINETICS_PRESETS.firstOrder, span: 20, dt: 0.002 });
  const [result, setResult] = useState(null);
  const [verification, setVerification] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const applyPreset = (id) => {
    setSetup({ presetId: id, ...KINETICS_PRESETS[id], span: id === 'brusselator' ? 40 : 20, dt: id === 'secondOrder' ? 0.001 : 0.002 });
    setResult(null);
    setError(null);
  };

  const run = async () => {
    setBusy('run');
    setError(null);
    try {
      setResult(await simulate({
        mechanism: setup.mechanism,
        concentrations: setup.concentrations,
        span: setup.span,
        dt: setup.dt,
        onProgress: (value) => setProgress(value),
      }));
    } catch (problem) {
      setError(problem.message);
    } finally {
      setProgress(null);
      setBusy(null);
    }
  };

  const verify = async () => {
    setBusy('verify');
    setError(null);
    try {
      setVerification(await verifyKinetics());
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(null);
    }
  };

  const exportText = result
    ? ['time,' + result.species.join(','), ...result.series.map((point) => [point.t.toFixed(6), ...result.species.map((id) => point.values[id].toExponential(8))].join(','))].join('\n')
    : '';

  return (
    <ToolShell
      toolId="reaction-kinetics"
      icon={Activity}
      title="Reaction Kinetics Simulator"
      desc="Elementary steps in, coupled rate equations out. Reversible steps, held-constant reservoirs and automatic step halving for positivity — with every run checked against the closed forms that exist for it."
      state={setup}
      onRestore={(value) => value && setSetup(value)}
      exportText={exportText}
      exportName="kinetics.csv"
    >
      <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="space-y-3">
            <Field label="Mechanism — one elementary step per line">
              <Area rows={6} mono value={setup.mechanism} onChange={(value) => setSetup({ ...setup, mechanism: value })} placeholder={'A -> B : 0.35\nA <=> C : 0.6, 0.2'} />
            </Field>
            <Field label="Amounts — @ marks a species held constant" hint="A = 1 · @A = 1 keeps a reservoir topped up">
              <Area rows={4} mono value={setup.concentrations} onChange={(value) => setSetup({ ...setup, concentrations: value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Time span">
                <input type="number" min="0.1" step="1" value={setup.span} onChange={(e) => setSetup({ ...setup, span: Number(e.target.value) })} className="tk-glass-panel h-9 w-full rounded-md px-3 text-sm" />
              </Field>
              <Field label="Integrator step">
                <input type="number" min="0.0001" step="0.0005" value={setup.dt} onChange={(e) => setSetup({ ...setup, dt: Number(e.target.value) })} className="tk-glass-panel h-9 w-full rounded-md px-3 text-sm" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={run} disabled={busy === 'run'} className="gap-1.5">
                <Play className="h-3.5 w-3.5" />
                {busy === 'run' ? 'Integrating…' : 'Run the mechanism'}
              </Button>
              <Button size="sm" variant="outline" onClick={verify} disabled={Boolean(busy)} className="gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                {busy === 'verify' ? 'Checking…' : 'Run the verification suite'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(KINETICS_PRESETS).map(([id, preset]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPreset(id)}
                  className={`rounded-lg border px-2 py-1 text-[11px] transition ${setup.presetId === id ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/60 text-muted-foreground hover:text-foreground'}`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            {KINETICS_PRESETS[setup.presetId]?.note && <p className="text-[11px] text-muted-foreground/80">{KINETICS_PRESETS[setup.presetId].note}</p>}
            {error && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">{error}</p>}
          </Panel>

          <Panel className="space-y-3">
            <EngineProgress busy={busy === 'run'} phase={busy === 'run' ? 'Integrating the rate equations' : null} done={progress?.done} total={progress?.total} />
            {result ? (
              <>
                <TraceChart series={result.series} species={result.species} />
                <div className="flex flex-wrap gap-1.5">
                  {result.species.map((id, index) => (
                    <span key={id} className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1 font-mono-j text-[10px]">
                      <span className="h-2 w-2 rounded-full" style={{ background: COLOURS[index % COLOURS.length] }} />
                      {id}
                      {result.held.includes(id) && <span className="text-cyan-j">held</span>}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="Final amount" value={Object.entries(result.stats.finalState).map(([id, value]) => `${id} ${value.toPrecision(4)}`).join(' · ')} />
                  <Stat label="Steps taken" value={result.stats.stepCount.toLocaleString()} sub={`smallest accepted step ${result.stats.smallestStep.toExponential(1)}`} />
                  <Stat label="Step halvings" value={result.stats.halvings} sub={`${result.stats.clamps} values clamped to zero`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead><tr className="text-left text-muted-foreground"><th className="py-1">Species</th><th>Start</th><th>Final</th><th>Min</th><th>Max</th><th>Drift, last fifth</th></tr></thead>
                    <tbody className="font-mono-j">
                      {result.stats.species.map((entry) => (
                        <tr key={entry.id} className="border-t border-border/50">
                          <td className="py-1">{entry.id}{entry.held ? ' (held)' : ''}</td>
                          <td>{entry.start.toPrecision(4)}</td>
                          <td>{entry.final.toPrecision(4)}</td>
                          <td>{entry.min.toPrecision(3)}</td>
                          <td>{entry.max.toPrecision(3)}</td>
                          <td>{entry.held ? '—' : `${(entry.drift * 100).toFixed(3)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <CopyBtn value={exportText} label="Copy the trajectory" />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Pick a preset or write your own mechanism and run it. Every step is elementary, so its rate follows mass action on its own reactants.</p>
            )}
          </Panel>
        </div>

        {verification && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Oscillator period" value={verification.checks[6].ok ? 'stable' : 'none'} sub={`${verification.osc.series.slice(-1)[0]?.t.toFixed(0)} time units integrated`} />
              <Stat label="First-order error" value={verification.checks[0].detail.split('error ')[1]?.split(' ')[0]} sub="against the analytic exponential" />
              <Stat label="Second-order error" value={verification.checks[1].detail.split('error ')[1]?.split(' ')[0]} sub="against 1/(1 + 2k[A]₀t)" />
              <Stat label="Reversible ratio" value={`${(verification.back.series.slice(-1)[0].values.B / verification.back.series.slice(-1)[0].values.A).toFixed(5)}`} sub="[B]/[A] against k₁/k₂ = 3" />
            </div>
            <VerifyPanel items={verification.checks} note="Closed-form solutions are the referee here: first order, second order, the logistic for autocatalysis and the detailed-balance ratio are all known independently of this integrator." />
          </>
        )}
      </div>
    </ToolShell>
  );
}