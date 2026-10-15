import { useMemo, useState } from 'react';
import { Activity, Play, ShieldCheck, TrendingUp } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { Area, CopyBtn, Field, Panel, Stat } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import { MICROKINETIC_PRESETS, buildModel, sabatierVolcano, sensitivities, solveMicrokinetics, verifyMicrokinetics } from './microkineticsCore';

const number = (value, digits = 4) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
const rate = (value) => (Number.isFinite(value) ? Math.abs(value) >= 1e-3 && Math.abs(value) < 1e5 ? value.toFixed(4) : value.toExponential(2) : '—');
const labelOf = (entry, index) => entry.label ?? entry.id ?? `step ${(entry.step ?? index) + 1}`;

function VolcanoChart({ curve, peak }) {
  const width = 720;
  const height = 240;
  const xs = curve.map((point) => point.x);
  const low = Math.min(...xs);
  const high = Math.max(...xs);
  const top = Math.max(...curve.map((point) => Math.log10(Math.max(point.tof, 1e-30))));
  const bottom = Math.min(...curve.map((point) => Math.log10(Math.max(point.tof, 1e-30)))) - 0.4;
  const px = (x) => 46 + ((x - low) / (high - low || 1)) * (width - 62);
  const py = (tof) => height - 30 - ((Math.log10(Math.max(tof, 1e-30)) - bottom) / (top - bottom || 1)) * (height - 46);
  const line = curve.map((point, index) => `${index ? 'L' : 'M'}${px(point.x).toFixed(1)},${py(point.tof).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const value = bottom + (top - bottom) * fraction;
        return (
          <g key={fraction}>
            <line x1={46} x2={width - 16} y1={py(Math.pow(10, value))} y2={py(Math.pow(10, value))} stroke="hsl(var(--border))" strokeWidth="0.6" />
            <text x={8} y={py(Math.pow(10, value)) + 3} fontSize="9" fill="hsl(var(--muted-foreground))" className="font-mono-j">1e{value.toFixed(0)}</text>
          </g>
        );
      })}
      <path d={line} fill="none" stroke="hsl(189 100% 50%)" strokeWidth="2" />
      <circle cx={px(peak.x)} cy={py(peak.tof)} r="5" fill="hsl(38 92% 55%)" />
      <text x={px(peak.x) + 9} y={py(peak.tof) - 6} fontSize="10" fill="hsl(38 92% 55%)" className="font-mono-j">
        peak at x = {peak.x.toFixed(3)}, θ = {peak.theta.toFixed(3)}
      </text>
      <text x={width - 18} y={height - 8} fontSize="9" textAnchor="end" fill="hsl(var(--muted-foreground))" className="font-mono-j">
        binding strength x = ln(K/K₀)
      </text>
    </svg>
  );
}

export default function MicrokineticsStudio() {
  const [preset, setPreset] = useState('co');
  const [mechanism, setMechanism] = useState(MICROKINETIC_PRESETS.co.mechanism);
  const [pressures, setPressures] = useState(MICROKINETIC_PRESETS.co.pressures);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [checks, setChecks] = useState(null);
  const [alpha, setAlpha] = useState(0.5);
  const [volcano, setVolcano] = useState(null);

  const choose = (key) => {
    setPreset(key);
    setMechanism(MICROKINETIC_PRESETS[key].mechanism);
    setPressures(MICROKINETIC_PRESETS[key].pressures);
    setResult(null);
  };

  const solve = () => {
    setError('');
    setProgress({ busy: true, phase: 'Solving the steady state' });
    try {
      const model = buildModel({ mechanism, pressures });
      const solution = solveMicrokinetics(model);
      const control = sensitivities(model);
      setResult({ model, solution, control, preset: MICROKINETIC_PRESETS[preset]?.label ?? 'Custom mechanism' });
    } catch (issue) {
      setError(issue.message);
      setResult(null);
    } finally {
      setProgress(null);
    }
  };

  const runVolcano = () => {
    setProgress({ busy: true, phase: 'Sweeping binding strength' });
    try {
      setVolcano(sabatierVolcano({ alpha }));
    } catch (issue) {
      setError(issue.message);
    } finally {
      setProgress(null);
    }
  };

  const verify = () => {
    setProgress({ busy: true, phase: 'Running the independent checks' });
    window.setTimeout(() => {
      setChecks(verifyMicrokinetics().checks);
      setProgress(null);
    }, 20);
  };

  const solution = result?.solution;
  const coverageBars = useMemo(() => (solution
    ? [...solution.coverages.map((entry) => ({ label: entry.id, value: entry.fraction })),
      { label: '* free', value: solution.free }]
    : []), [solution]);

  const exportText = solution
    ? [
      `Microkinetics — ${result.preset}`,
      mechanism,
      `pressures: ${pressures.replace(/\n/g, ', ')}`,
      `turnover frequency ${rate(solution.tof)} per site per second`,
      `coverages: ${solution.coverages.map((entry) => `${entry.id} = ${number(entry.fraction, 5)}`).join(', ')}, free = ${number(solution.free, 5)}`,
      `converged in ${solution.iterations} iterations, residual ${solution.residual.toExponential(2)}`,
      '',
      'net step rates:',
      ...solution.stepRates.map((entry, index) => `  step ${index + 1}: net ${rate(entry.net)} (forward ${rate(entry.forward)}, reverse ${rate(entry.reverse)})`),
      '',
      'degrees of rate control and apparent orders:',
      ...(result.control.drc ?? []).map((entry, index) => `  ${labelOf(entry, index)}: ${number(entry.slope, 4)}`),
      ...(result.control.orders ?? []).map((entry, index) => `  order in ${labelOf(entry, index)}: ${number(entry.slope, 4)}`),
    ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="microkinetics"
      icon={Activity}
      title="Microkinetic Mechanism Solver"
      desc="Type elementary steps and pressures; the engine solves the steady-state coverages, then the turnover frequency, every step's net rate, Campbell degrees of rate control and the apparent reaction orders — checked against the Langmuir isotherm, the fast-equilibrium limit, detailed balance and the Sabatier volcano."
      state={{ preset, mechanism, pressures, alpha }}
      onRestore={(value) => {
        if (!value) return;
        if (value.mechanism) setMechanism(value.mechanism);
        if (value.pressures) setPressures(value.pressures);
        if (value.alpha != null) setAlpha(value.alpha);
      }}
      exportText={exportText}
      exportName="microkinetics.txt"
    >
      <div className="space-y-4">
        <Panel className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(MICROKINETIC_PRESETS).map(([key, entry]) => (
              <button
                key={key}
                type="button"
                onClick={() => choose(key)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${preset === key ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/60 text-muted-foreground hover:border-cyan-j/40 hover:text-foreground'}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <Field label="Elementary steps" hint="One step per line: A + * <=> A* : 1e6, 1e12 — use <=> for a reversible step and -> for an irreversible one.">
              <Area value={mechanism} onChange={setMechanism} rows={6} mono />
            </Field>
            <Field label="Pressures" hint="One gas per line, in the same units as the rate constants.">
              <Area value={pressures} onChange={setPressures} rows={6} mono />
            </Field>
          </div>
          {MICROKINETIC_PRESETS[preset] && <p className="text-[11px] text-muted-foreground/80">{MICROKINETIC_PRESETS[preset].note}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={solve} className="gap-1.5"><Play className="h-4 w-4" />Solve the steady state</Button>
            {exportText && <CopyBtn value={exportText} label="Copy the result" />}
          </div>
          {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{error}</p>}
        </Panel>

        <EngineProgress {...(progress ?? {})} />

        {solution && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Turnover frequency" value={rate(solution.tof)} unit="per site·s" sub="product formed per surface site per second" tone="cyan" />
              <Stat label="Most covered species" value={solution.largest ?? '—'} sub={`θ = ${number(solution.coverages.find((entry) => entry.id === solution.largest)?.fraction, 4)}`} mono />
              <Stat label="Site balance" value={number(solution.free + (1 - solution.free) * 0, 4)} sub={`free sites ${number(solution.free, 4)}, occupied ${number(solution.occupied, 4)}`} mono />
              <Stat label="Solver" value={solution.converged ? `${solution.iterations} iterations` : 'not converged'} sub={`residual ${solution.residual.toExponential(2)}`} mono />
            </div>

            <Panel className="space-y-3">
              <span className="font-display text-sm font-semibold">Surface coverages</span>
              <Bars data={coverageBars} height={130} format={(value) => value.toFixed(4)} />
              <Pills items={[
                { label: 'Σθ + θ*', value: number(solution.coverages.reduce((sum, entry) => sum + entry.fraction, 0) + solution.free, 6) },
                { label: 'site residual', value: solution.siteResidual.toExponential(2) },
                { label: 'rate scale', value: rate(solution.rateScale) },
              ]} />
            </Panel>

            <Panel className="space-y-3">
              <span className="font-display text-sm font-semibold">Step rates at steady state</span>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">Step</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Forward</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Reverse</th>
                      <th className="py-1.5 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono-j">
                    {solution.stepRates.map((entry, index) => (
                      <tr key={index} className="border-t border-border/40">
                        <td className="py-1.5 pr-3 font-body text-muted-foreground">{result.model.steps[index]?.text ?? `step ${index + 1}`}</td>
                        <td className="py-1.5 pr-3 text-right">{rate(entry.forward)}</td>
                        <td className="py-1.5 pr-3 text-right">{rate(entry.reverse)}</td>
                        <td className="py-1.5 text-right text-cyan-j">{rate(entry.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel className="space-y-3">
                <span className="font-display text-sm font-semibold">Degrees of rate control</span>
                <Bars
                  data={(result.control.drc ?? []).map((entry, index) => ({ label: labelOf(entry, index), value: entry.slope ?? 0 }))}
                  height={110}
                  format={(value) => value.toFixed(3)}
                />
                <Pills items={[{ label: 'Σ DRC', value: number(result.control.sum, 4) }, { label: 'steps with a usable derivative', value: `${result.control.usable}` }]} />
              </Panel>
              <Panel className="space-y-3">
                <span className="font-display text-sm font-semibold">Apparent reaction orders</span>
                <Bars
                  data={(result.control.orders ?? []).map((entry, index) => ({ label: labelOf(entry, index), value: entry.slope ?? 0 }))}
                  height={110}
                  format={(value) => value.toFixed(3)}
                />
                <p className="text-[11px] text-muted-foreground/80">Negative orders are real chemistry — a species that binds too strongly crowds off the sites the reaction needs.</p>
              </Panel>
            </div>
          </>
        )}

        <Panel className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-display text-sm font-semibold"><TrendingUp className="h-4 w-4 text-cyan-j" />Sabatier volcano</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">BEP slope α</span>
              <input
                type="number"
                step="0.05"
                min="0.05"
                max="0.95"
                value={alpha}
                onChange={(event) => setAlpha(Math.min(0.95, Math.max(0.05, Number(event.target.value))))}
                className="tk-glass-panel w-20 rounded-md px-2 py-1 text-xs focus-glow"
              />
              <Button variant="outline" onClick={runVolcano} className="gap-1.5"><Play className="h-4 w-4" />Sweep</Button>
            </div>
          </div>
          {volcano
            ? (
              <>
                <VolcanoChart curve={volcano.curve} peak={volcano.peak} />
                <div className="grid gap-2 sm:grid-cols-4">
                  <Stat label="Peak binding" value={number(volcano.peak.x, 4)} sub="ln(K/K₀) at the optimum" mono />
                  <Stat label="Peak coverage" value={number(volcano.peak.theta, 4)} sub={`theory says ${number(1 - volcano.alpha, 3)} for this α`} mono />
                  <Stat label="Peak TOF" value={rate(volcano.peak.tof)} sub="per site·s" mono />
                  <Stat label="Free sites at the peak" value={number(volcano.peak.free, 4)} sub="the peak sits where the surface is half free" mono />
                </div>
              </>
            )
            : <p className="text-[11px] text-muted-foreground/80">Sweeping the binding strength from weak to strong, both steps through the same solver: too weak and nothing sticks, too strong and the surface is poisoned, with the optimum in between.</p>}
        </Panel>

        <Panel className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-display text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-cyan-j" />Independent checks</span>
            <Button variant="outline" onClick={verify} className="gap-1.5">Run the checks</Button>
          </div>
          {checks
            ? <VerifyPanel items={checks} note="Langmuir, the fast-equilibrium limit, the half order a dissociating partner demands, vanishing net rate at equilibrium and the Sabatier peak — each computed from the solver's own output." />
            : <p className="text-[11px] text-muted-foreground/80">Checks the solver against the closed forms and physical limits a microkinetic model must obey.</p>}
        </Panel>
      </div>
    </ToolShell>
  );
}