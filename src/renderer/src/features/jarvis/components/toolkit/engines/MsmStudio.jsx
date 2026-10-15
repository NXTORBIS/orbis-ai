import { useMemo, useState } from 'react';
import { Check, GitBranch, Play, ShieldCheck, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { CopyBtn, Field, Panel, Stat } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import TraceChart from './TraceChart';
import { PRESETS, buildNetwork, committor, dominantPath, meanFirstPassage, monteCarlo, propagate, reactiveFlux, spectrum, verifyNetwork } from './msmCore';

const number = (value, digits = 4) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

function NetworkGraph({ net, q, path, flux }) {
  const width = 640;
  const height = 300;
  const px = (value) => 60 + value * (width - 120);
  const py = (value) => 40 + value * (height - 80);
  const peak = Math.max(...net.pi, 1e-9);
  const topFlux = Math.max(...flux.edges.map((edge) => edge.flux), 1e-9);
  const onPath = new Set(path.edges?.map((edge) => `${edge.from}|${edge.to}`) ?? []);
  const indexOf = new Map(net.states.map((state, index) => [state.id, index]));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      <defs>
        <marker id="msm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--muted-foreground))" />
        </marker>
      </defs>
      {flux.edges.map((edge, index) => {
        const from = net.states[indexOf.get(edge.from)];
        const to = net.states[indexOf.get(edge.to)];
        const highlighted = onPath.has(`${edge.from}|${edge.to}`);
        const x1 = px(from.x);
        const y1 = py(from.y);
        const x2 = px(to.x);
        const y2 = py(to.y);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy) || 1;
        const offset = 26;
        return (
          <line
            key={`${edge.from}-${edge.to}-${index}`}
            x1={x1 + (dx / length) * offset}
            y1={y1 + (dy / length) * offset}
            x2={x2 - (dx / length) * offset}
            y2={y2 - (dy / length) * offset}
            stroke={highlighted ? 'hsl(38 92% 55%)' : 'hsl(var(--muted-foreground) / 0.55)'}
            strokeWidth={highlighted ? 2.6 : 0.8 + 5 * (edge.flux / topFlux)}
            markerEnd="url(#msm-arrow)"
          />
        );
      })}
      {net.states.map((state, index) => {
        const radius = 14 + 20 * (net.pi[index] / peak);
        const hue = 189 + 76 * Math.min(1, Math.max(0, q[index]));
        return (
          <g key={state.id}>
            <circle cx={px(state.x)} cy={py(state.y)} r={radius} fill={`hsl(${hue} 90% 60% / 0.18)`} stroke={`hsl(${hue} 90% 65%)`} strokeWidth="1.6" />
            <text x={px(state.x)} y={py(state.y) - 2} textAnchor="middle" fontSize="12" fill="hsl(var(--foreground))" className="font-mono-j">{state.id}</text>
            <text x={px(state.x)} y={py(state.y) + 12} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))" className="font-mono-j">
              {(net.pi[index] * 100).toFixed(1)}%
            </text>
            <text x={px(state.x)} y={py(state.y) - radius - 5} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))" className="font-mono-j">
              {state.label}
            </text>
          </g>
        );
      })}
      <text x={width - 16} y={22} textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))" className="font-mono-j">
        node size: equilibrium population · node colour: committor · amber: dominant pathway
      </text>
    </svg>
  );
}

export default function MsmStudio() {
  const [preset, setPreset] = useState('folding');
  const [energies, setEnergies] = useState({});
  const [barriers, setBarriers] = useState({});
  const [prefactor, setPrefactor] = useState(PRESETS.folding.prefactor);
  const [sourceId, setSourceId] = useState('U');
  const [sinkId, setSinkId] = useState('N');
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [checkRun, setCheckRun] = useState(null);
  const [simulation, setSimulation] = useState(null);

  const base = PRESETS[preset];
  const net = useMemo(
    () => (analysis ? analysis.net : null),
    [analysis],
  );

  const choose = (key) => {
    setPreset(key);
    setEnergies({});
    setBarriers({});
    setPrefactor(PRESETS[key].prefactor);
    setSourceId(PRESETS[key].states[0].id);
    const deepest = [...PRESETS[key].states].sort((a, b) => b.energy - a.energy)[0];
    setSinkId(deepest.id);
    setAnalysis(null);
    setSimulation(null);
  };

  const analyse = () => {
    setError('');
    setProgress({ busy: true, phase: 'Solving the network' });
    try {
      const network = buildNetwork({ preset, energies, barriers, prefactor });
      const sourceIndex = network.states.findIndex((state) => state.id === sourceId);
      const sinkIndex = network.states.findIndex((state) => state.id === sinkId);
      if (sourceIndex < 0 || sinkIndex < 0 || sourceIndex === sinkIndex) throw new Error('Choose two different states for the source and the sink.');
      const spectrumResult = spectrum(network);
      const mfpt = meanFirstPassage(network, sinkIndex);
      const q = committor(network, sourceIndex, sinkIndex);
      const flux = reactiveFlux(network, q.values, { source: [sourceIndex], sink: [sinkIndex] });
      const path = dominantPath(network, q.values, [sourceIndex], [sinkIndex]);
      const times = Array.from({ length: 30 }, (_, index) => ((index + 1) * spectrumResult.timescales[0]) / 6);
      const curves = propagate(network, network.states.map((_, index) => (index === sourceIndex ? 1 : 0)), times);
      setAnalysis({ net: network, spectrum: spectrumResult, mfpt, q, flux, path, times, curves, sourceIndex, sinkIndex });
      setSimulation(null);
    } catch (issue) {
      setError(issue.message);
      setAnalysis(null);
    } finally {
      setProgress(null);
    }
  };

  const simulate = () => {
    if (!analysis) return;
    setProgress({ busy: true, phase: 'Simulating the jump process' });
    window.setTimeout(() => {
      try {
        const interior = analysis.q.values
          .map((value, index) => ({ value, index }))
          .filter((entry) => entry.index !== analysis.sourceIndex && entry.index !== analysis.sinkIndex)
          .sort((a, b) => Math.abs(a.value - 0.5) - Math.abs(b.value - 0.5))[0];
        const jump = monteCarlo(analysis.net, { start: analysis.sourceIndex, target: analysis.sinkIndex, trials: 20000 });
        const committed = interior
          ? monteCarlo(analysis.net, { start: interior.index, target: analysis.sinkIndex, competitor: analysis.sourceIndex, trials: 20000 })
          : null;
        const occupancy = monteCarlo(analysis.net, { start: analysis.sourceIndex, trials: 600, maxTime: analysis.spectrum.timescales[0] * 20 });
        setSimulation({ jump, committed, interior, occupancy });
      } catch (issue) {
        setError(issue.message);
      } finally {
        setProgress(null);
      }
    }, 20);
  };

  const runChecks = () => {
    setProgress({ busy: true, phase: 'Running the independent checks' });
    window.setTimeout(() => {
      setCheckRun(verifyNetwork().checks);
      setProgress(null);
    }, 20);
  };

  const setEnergy = (id, value) => setEnergies((current) => ({ ...current, [id]: value }));
  const setBarrier = (from, to, value) => setBarriers((current) => ({ ...current, [`${from}|${to}`]: value }));

  const exportText = analysis
    ? [
      `${analysis.net.label} — ${analysis.net.states.map((state) => `${state.id} ${state.energy.toFixed(2)} kT`).join(', ')}`,
      `rates in the barrier construction, prefactor ${analysis.net.prefactor} per ${analysis.net.timeUnit}`,
      '',
      `implied timescales: ${analysis.spectrum.timescales.map((value, index) => `τ${index + 1} = ${number(value, 4)} ${analysis.net.timeUnit}`).join(', ')}`,
      `equilibrium populations: ${analysis.net.states.map((state, index) => `${state.id} = ${number(analysis.net.pi[index], 4)}`).join(', ')}`,
      '',
      `mean first-passage times to ${sinkId}:`,
      ...analysis.net.states.map((state, index) => `  from ${state.id}: ${number(analysis.mfpt.values[index], 4)} ${analysis.net.timeUnit}`),
      '',
      `committor ${sourceId} → ${sinkId}: ${analysis.net.states.map((state, index) => `${state.id} = ${number(analysis.q.values[index], 4)}`).join(', ')}`,
      `dominant pathway: ${analysis.path.ids.join(' → ')}`,
      `reactive flux across the dividing surface: ${analysis.flux.outOfSource.toExponential(3)} per ${analysis.net.timeUnit}`,
      simulation
        ? `simulation check — MFPT ${number(simulation.jump.mean, 4)} ± ${number(3 * simulation.jump.standardError, 4)} against the solve's ${number(analysis.mfpt.values[analysis.sourceIndex], 4)}`
        : '',
    ].filter(Boolean).join('\n')
    : '';

  return (
    <ToolShell
      toolId="molecular-network"
      icon={GitBranch}
      title="Molecular Kinetics Network"
      desc="A molecule is a Markov chain over its states: give free energies and barriers and the engine solves the equilibrium, the implied timescales, mean first-passage times, committors, the reactive flux and the dominant pathway — then validates all of it against a direct simulation of the jump process."
      state={{ preset, energies, barriers, prefactor, sourceId, sinkId }}
      onRestore={(value) => {
        if (!value) return;
        if (value.preset) choose(value.preset);
        if (value.energies) setEnergies(value.energies);
        if (value.barriers) setBarriers(value.barriers);
        if (value.prefactor != null) setPrefactor(value.prefactor);
        if (value.sourceId) setSourceId(value.sourceId);
        if (value.sinkId) setSinkId(value.sinkId);
      }}
      exportText={exportText}
      exportName="molecular-network.txt"
    >
      <div className="space-y-4">
        <Panel className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PRESETS).map(([key, entry]) => (
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
          <p className="text-[11px] text-muted-foreground/80">{base.note}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="State free energies (kT)" hint="Lower is more stable; barriers are measured above the higher of the two states.">
              <div className="space-y-1.5">
                {base.states.map((state) => (
                  <div key={state.id} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 font-mono-j text-[11px] text-muted-foreground">{state.label}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={energies[state.id] ?? state.energy}
                      onChange={(event) => setEnergy(state.id, Number(event.target.value))}
                      className="tk-glass-panel w-full rounded-md px-2 py-1.5 text-xs focus-glow"
                    />
                  </div>
                ))}
              </div>
            </Field>
            <Field label="Edge barriers (kT)" hint="One number per connection; the prefactor sets the overall timescale.">
              <div className="space-y-1.5">
                {base.edges.map((edge) => (
                  <div key={`${edge.from}-${edge.to}`} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 font-mono-j text-[11px] text-muted-foreground">{edge.from}–{edge.to}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={barriers[`${edge.from}|${edge.to}`] ?? edge.barrier}
                      onChange={(event) => setBarrier(edge.from, edge.to, Number(event.target.value))}
                      className="tk-glass-panel w-full rounded-md px-2 py-1.5 text-xs focus-glow"
                    />
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 font-mono-j text-[11px] text-muted-foreground">prefactor</span>
                  <input
                    type="number"
                    step="10"
                    value={prefactor}
                    onChange={(event) => setPrefactor(Math.max(1e-6, Number(event.target.value)))}
                    className="tk-glass-panel w-full rounded-md px-2 py-1.5 text-xs focus-glow"
                  />
                </div>
              </div>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Source state">
              <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="tk-glass-panel w-full rounded-md px-2 py-2 text-sm focus-glow">
                {base.states.map((state) => <option key={state.id} value={state.id}>{state.id} — {state.label}</option>)}
              </select>
            </Field>
            <Field label="Target state">
              <select value={sinkId} onChange={(event) => setSinkId(event.target.value)} className="tk-glass-panel w-full rounded-md px-2 py-2 text-sm focus-glow">
                {base.states.map((state) => <option key={state.id} value={state.id}>{state.id} — {state.label}</option>)}
              </select>
            </Field>
            <div className="flex items-end gap-2">
              <Button onClick={analyse} className="gap-1.5"><Play className="h-4 w-4" />Solve the network</Button>
              {exportText && <CopyBtn value={exportText} label="Copy" />}
            </div>
          </div>
          {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{error}</p>}
        </Panel>

        <EngineProgress {...(progress ?? {})} />

        {analysis && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero
                label={`Mean first passage ${sourceId} → ${sinkId}`}
                value={number(analysis.mfpt.values[analysis.sourceIndex], 4)}
                unit={analysis.net.timeUnit}
                sub={`equilibrium population of ${sourceId} is ${(analysis.net.pi[analysis.sourceIndex] * 100).toFixed(1)}%`}
                tone="cyan"
              />
              <Stat label="Slowest implied timescale" value={number(analysis.spectrum.timescales[0], 4)} sub={`${analysis.net.timeUnit} — the process that sets the timescale`} mono />
              <Stat label="Dominant pathway" value={analysis.path.ids.join(' → ') || '—'} sub="largest-product route, not the shortest one" />
              <Stat label="Reactive flux" value={analysis.flux.outOfSource.toExponential(3)} sub={`per ${analysis.net.timeUnit} across the dividing surface`} mono />
            </div>

            <Panel className="space-y-3">
              <span className="font-display text-sm font-semibold">Free-energy network</span>
              <NetworkGraph net={analysis.net} q={analysis.q.values} path={analysis.path} flux={analysis.flux} />
              <Pills items={[
                { label: 'detailed-balance imbalance', value: analysis.net.worstDetailedBalance.toExponential(2) },
                { label: 'stationarity residual', value: analysis.net.stationaryResidual.toExponential(2) },
                { label: 'state populations', value: analysis.net.states.map((state, index) => `${state.id} ${number(analysis.net.pi[index], 3)}`).join(' · ') },
              ]} />
            </Panel>

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel className="space-y-3">
                <span className="font-display text-sm font-semibold">Implied timescales</span>
                <Bars
                  data={analysis.spectrum.timescales.map((value, index) => ({ label: `τ${index + 1}`, value: Math.log10(Math.max(value, 1e-12)) }))}
                  height={110}
                  format={(value) => `1e${value.toFixed(1)}`}
                  suffix={` ${analysis.net.timeUnit}`}
                />
                <p className="text-[11px] text-muted-foreground/80">
                  Each bar is a relaxation process the molecule runs through; the first one is what a bulk measurement sees as the slow step.
                </p>
              </Panel>
              <Panel className="space-y-3">
                <span className="font-display text-sm font-semibold">Mean first-passage time to {sinkId}</span>
                <Bars
                  data={analysis.net.states.map((state, index) => ({ label: state.id, value: analysis.mfpt.values[index] }))}
                  height={110}
                  format={(value) => number(value, 3)}
                  suffix={` ${analysis.net.timeUnit}`}
                  highlightLast={false}
                />
                <Pills items={[
                  { label: 'backward-equation residual', value: analysis.mfpt.residual.toExponential(2) },
                  { label: 'committor harmonic residual', value: analysis.q.harmonicResidual.toExponential(2) },
                ]} />
              </Panel>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel className="space-y-3">
                <span className="font-display text-sm font-semibold">Committor — probability of reaching {sinkId} before {sourceId}</span>
                <Bars
                  data={analysis.net.states.map((state, index) => ({ label: state.id, value: analysis.q.values[index] }))}
                  height={110}
                  format={(value) => value.toFixed(4)}
                />
                <Pills items={[{ label: 'in [0, 1]', value: analysis.q.inRange ? 'yes' : 'no' }, { label: 'boundary values exact', value: analysis.q.values[analysis.sourceIndex] === 0 && analysis.q.values[analysis.sinkIndex] === 1 ? 'yes' : 'no' }]} />
              </Panel>
              <Panel className="space-y-3">
                <span className="font-display text-sm font-semibold">Relaxation from {sourceId}</span>
                <TraceChart
                  series={[{
                    label: sinkId,
                    points: analysis.times.map((t, index) => ({ x: t, y: analysis.curves[index][analysis.sinkIndex] })),
                  }]}
                  height={170}
                />
                <p className="text-[11px] text-muted-foreground/80">
                  The population of {sinkId} climbing over {analysis.times[analysis.times.length - 1].toFixed(2)} {analysis.net.timeUnit}, computed by scaling and squaring the generator rather than from the eigenvalues — the two routes agree, which is checked below.
                </p>
              </Panel>
            </div>

            <Panel className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-sm font-semibold">Validate by direct simulation</span>
                <Button variant="outline" onClick={simulate} className="gap-1.5"><Play className="h-4 w-4" />Run 20 000 trajectories</Button>
              </div>
              {simulation
                ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="tk-glass-panel rounded-xl p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Mean first-passage time</div>
                      <div className="font-mono-j text-sm">{number(simulation.jump.mean, 4)} ± {number(3 * simulation.jump.standardError, 4)}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {Math.abs(simulation.jump.mean - analysis.mfpt.values[analysis.sourceIndex]) < 3 * simulation.jump.standardError
                          ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                          : <X className="h-3.5 w-3.5 text-amber-400" />}
                        against the solve's {number(analysis.mfpt.values[analysis.sourceIndex], 4)} {analysis.net.timeUnit}
                      </div>
                    </div>
                    <div className="tk-glass-panel rounded-xl p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Committor{simulation.interior ? ` from ${analysis.net.states[simulation.interior.index].id}` : ''}</div>
                      {simulation.committed ? (
                        <>
                          <div className="font-mono-j text-sm">
                            {number(simulation.committed.committedFraction, 4)} ± {number(3 * Math.sqrt(Math.max(simulation.committed.committedFraction * (1 - simulation.committed.committedFraction), 1e-6) / Math.max(simulation.committed.resolved, 1)), 4)}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {Math.abs(simulation.committed.committedFraction - analysis.q.values[simulation.interior.index]) < 3 * Math.sqrt(Math.max(analysis.q.values[simulation.interior.index] * (1 - analysis.q.values[simulation.interior.index]), 1e-6) / Math.max(simulation.committed.resolved, 1))
                              ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                              : <X className="h-3.5 w-3.5 text-amber-400" />}
                            against the solve's {number(analysis.q.values[simulation.interior.index], 4)}
                          </div>
                        </>
                      ) : <div className="text-[11px] text-muted-foreground">The source and the sink are adjacent — there is no interior state to test.</div>}
                    </div>
                    <div className="tk-glass-panel rounded-xl p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Residence times</div>
                      <div className="space-y-0.5 font-mono-j text-[11px]">
                        {analysis.net.states.map((state, index) => (
                          <div key={state.id} className="flex justify-between gap-3">
                            <span className="text-muted-foreground">{state.id}</span>
                            <span>{number(simulation.occupancy.occupancy[index], 4)} vs {number(analysis.net.pi[index], 4)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
                : <p className="text-[11px] text-muted-foreground/80">
                  The jump process is simulated directly — exponential waiting times, jumps drawn in proportion to the rates — with nothing shared with the linear algebra above, so agreement is evidence rather than tautology.
                </p>}
            </Panel>
          </>
        )}

        <Panel className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-display text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-cyan-j" />Independent checks</span>
            <Button variant="outline" onClick={runChecks} className="gap-1.5">Run the checks</Button>
          </div>
          {checkRun
            ? <VerifyPanel items={checkRun} note="Detailed balance, the Boltzmann equilibrium, stationarity, the spectrum against the trace, the two-state analytic answer, the backward equation, harmonicity of the committor, two Monte Carlo ensembles, the exact birth–death MFPT and probability conservation." />
            : <p className="text-[11px] text-muted-foreground/80">Eighteen checks across four networks, including the exact mean first-passage time on a one-dimensional chain and two independent simulations.</p>}
        </Panel>
      </div>
    </ToolShell>
  );
}