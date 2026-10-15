import { useRef, useState } from 'react';
import { Activity, Play, ShieldCheck, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Panel, Seg, Stat, ToggleRow } from '../shared';
import { Hero, Pills, Ring } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import TraceChart from './TraceChart';
import { CELL_TYPES, simulateCycle, verifyCellCycle } from './cellCycleCore';

const CELL_OPTIONS = Object.values(CELL_TYPES).map((type) => ({ value: type.id, label: type.name }));
const CYCLES = [
  { value: 2, label: '2 cycles' },
  { value: 3, label: '3 cycles' },
  { value: 5, label: '5 cycles' },
];
const PHASES = ['G1', 'S', 'G2', 'M'];

export default function CellCycleLab() {
  const [cellType, setCellType] = useState('mammalian');
  const [checkpoint, setCheckpoint] = useState(true);
  const [cycles, setCycles] = useState(3);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [verification, setVerification] = useState(null);
  const [error, setError] = useState('');
  const controller = useRef(null);

  const run = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      setResult(await simulateCycle({ cellType, checkpoint, cycles, onProgress: setProgress, signal: abort.signal }));
    } catch (thrown) {
      setError(thrown.message || 'The simulation could not run.');
    }
    setBusy(false);
    setProgress(null);
    controller.current = null;
  };

  const runChecks = async () => {
    setBusy(true);
    setError('');
    try {
      setVerification(await verifyCellCycle({ cellType: 'mammalian', cycles: 2 }));
    } catch (thrown) {
      setError(thrown.message || 'The checks could not run.');
    }
    setBusy(false);
  };

  const bands = result
    ? result.transitions.slice(0, -1).map((transition, index) => ({
      from: transition.seconds / 3600,
      to: result.transitions[index + 1].seconds / 3600,
      fill: 'hsl(189 100% 50% / 0.05)',
      label: transition.to,
    }))
    : [];

  const phaseSeries = result ? [
    { label: 'CDK1–cyclin (MPF)', stroke: 'hsl(350 89% 60%)', width: 2, points: result.samples.map((sample) => ({ x: sample.seconds / 3600, y: sample.m * 5 })) },
    { label: 'APC/C', stroke: 'hsl(265 85% 68%)', width: 1.6, points: result.samples.map((sample) => ({ x: sample.seconds / 3600, y: sample.a * 5 })) },
    { label: 'cyclin', stroke: 'hsl(189 100% 50%)', width: 1.6, points: result.samples.map((sample) => ({ x: sample.seconds / 3600, y: sample.c * 20 })) },
  ] : [];

  const traceFor = (key, stroke) => (result ? [{ label: key, stroke, width: 2, points: result.samples.map((sample) => ({ x: sample.seconds / 3600, y: sample[key] })) }] : []);

  const phaseSeconds = PHASES.map((phase) => {
    if (!result) return { phase, seconds: 0 };
    const seconds = result.transitions.reduce((sum, transition, index) => {
      if (transition.to !== phase) return sum;
      const next = result.transitions[index + 1];
      return sum + (next ? next.seconds - transition.seconds : 0);
    }, 0);
    return { phase, seconds };
  });

  const exportText = result ? [
    `${result.cellType.name}, checkpoint ${result.checkpoint ? 'enforced' : 'removed'}, ${cycles} cycles`,
    `divisions ${result.stats.divisions}, cycle length ${(result.stats.cycleSeconds / 3600).toFixed(2)} h`,
    `DNA at each division: ${result.stats.dnaAtDivision.map((value) => `${value.toFixed(2)}C`).join(', ') || 'none'}`,
    `mass ratio at division ${result.stats.meanMassRatio.toFixed(4)}`,
    `premature mitoses ${result.stats.checkpointViolations}, held in G2 ${result.stats.heldInG2Hours.toFixed(2)} h`,
  ].join('\n') : '';

  return (
    <ToolShell
      toolId="cell-cycle"
      icon={Activity}
      title="Cell Cycle Visualizer"
      desc="A CDK1/APC limit-cycle oscillator drives the phases — nothing is scripted — with DNA content, cell mass and the G2/M checkpoint tracked on top, so what a cell must do can be audited against what the model does."
      state={{ cellType, checkpoint, cycles }}
      onRestore={(state) => {
        if (!state) return;
        if (state.cellType) setCellType(state.cellType);
        if (typeof state.checkpoint === 'boolean') setCheckpoint(state.checkpoint);
        if (state.cycles) setCycles(state.cycles);
      }}
      exportText={exportText}
      exportName="cell-cycle-report.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={cellType} onChange={(value) => { setCellType(value); setResult(null); }} options={CELL_OPTIONS} />
        <Seg value={cycles} onChange={(value) => { setCycles(value); setResult(null); }} options={CYCLES} />
        {busy
          ? <Button size="sm" variant="outline" onClick={() => controller.current?.abort()} className="gap-1.5"><X className="h-3.5 w-3.5" /> Stop</Button>
          : <Button size="sm" onClick={run} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Run the cycle</Button>}
        <Button size="sm" variant="outline" onClick={runChecks} className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Run the checks</Button>
      </div>

      <ToggleRow
        label="G2/M checkpoint enforced"
        checked={checkpoint}
        onChange={(value) => { setCheckpoint(value); setResult(null); }}
        hint="off, the cell divides on the oscillator's schedule whatever the state of replication"
      />

      <EngineProgress busy={busy} phase={progress?.phase} done={progress?.done} total={progress?.total} />
      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero
              label="Cycle length"
              value={(result.stats.cycleSeconds / 3600).toFixed(1)}
              unit="h"
              tone={result.stats.checkpointViolations ? 'amber' : 'emerald'}
              sub={`${result.stats.divisions} divisions · cycle-to-cycle spread ${(result.stats.periodSpread * 100).toFixed(2)}%`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="DNA at division" value={result.stats.dnaComplete ? '4.00C → 2.00C' : 'incomplete'} sub={`range ${result.stats.dnaMin.toFixed(3)}C – ${result.stats.dnaMax.toFixed(3)}C`} mono />
              <Stat label="Mass ratio at division" value={result.stats.meanMassRatio.toFixed(3)} sub={`${result.stats.massRatios.length} divisions`} mono />
            </div>
          </div>

          <Panel>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold">Oscillator over time (hours)</span>
              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                <span className="text-rose-400">CDK1–cyclin</span>
                <span className="text-violet-400">APC/C</span>
                <span className="text-cyan-j">cyclin</span>
              </div>
            </div>
            <TraceChart series={phaseSeries} bands={bands} yMin={0} yMax={5.2} />
            <div className="mt-1 flex flex-wrap gap-1">
              {result.transitions.slice(0, -1).map((transition, index) => {
                const seconds = result.transitions[index + 1].seconds - transition.seconds;
                return (
                  <span key={`${transition.seconds}-${index}`} className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {transition.to} · {(seconds / 3600).toFixed(1)}h
                  </span>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Phase changes come from the oscillator's own state: a phase begins when the CDK1 and APC activities say it does.</p>
          </Panel>

          <div className="grid gap-3 md:grid-cols-2">
            <Panel>
              <div className="mb-2 text-xs font-semibold">DNA content</div>
              <TraceChart series={traceFor('dna', 'hsl(160 84% 52%)')} bands={bands} yMin={1.8} yMax={4.2} />
              <p className="mt-1 text-[11px] text-muted-foreground">2C in G1, rising through S to exactly 4C, then halved at cytokinesis.</p>
            </Panel>
            <Panel>
              <div className="mb-2 text-xs font-semibold">Cell mass, relative to birth</div>
              <TraceChart series={traceFor('mass', 'hsl(38 92% 55%)')} bands={bands} yMin={0.9} yMax={2.2} />
              <p className="mt-1 text-[11px] text-muted-foreground">Exponential growth, halved at each division — which is what keeps cell size stable across cycles.</p>
            </Panel>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {phaseSeconds.map((entry) => (
              <Stat
                key={entry.phase}
                label={`${entry.phase} phase`}
                value={`${(entry.seconds / 3600).toFixed(1)} h`}
                sub={`${result.stats.cycleSeconds ? ((entry.seconds / result.stats.cycleSeconds) * 100).toFixed(0) : 0}% of the cycle`}
                mono
              />
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1.6fr]">
            <Ring value={result.stats.dnaComplete ? 100 : 0} size={140} thickness={10} label="Divisions at a full 4C" unit={`${result.stats.divisions} divisions`} tone={result.stats.dnaComplete ? 'cyan' : 'amber'} />
            <Panel>
              <div className="mb-2 text-xs font-semibold">Divisions</div>
              <div className="space-y-1">
                {result.divisions.map((division) => (
                  <div key={division.seconds} className="flex items-center justify-between rounded-lg border border-border/50 px-2.5 py-1.5 font-mono-j text-[11px]">
                    <span>{(division.seconds / 3600).toFixed(2)} h</span>
                    <span className="text-muted-foreground">DNA {division.dnaAtDivision.toFixed(2)}C</span>
                    <span className="text-muted-foreground">mass ×{division.massRatio.toFixed(3)}</span>
                  </div>
                ))}
                {!result.divisions.length && <div className="text-xs text-muted-foreground">No complete division in this run — give it more cycles.</div>}
              </div>
            </Panel>
          </div>

          <Pills items={[
            { label: 'transitions', value: result.stats.transitions },
            { label: 'order', value: result.stats.legalOrder ? 'legal' : 'broken' },
            { label: 'held in G2', value: `${result.stats.heldInG2Hours.toFixed(2)} h` },
            { label: 'premature mitoses', value: result.stats.checkpointViolations },
            { label: 'MPF peak in M', value: result.stats.mpfPeakDuringM.toFixed(2) },
          ]} />

          <VerifyPanel
            items={[
              { label: 'The oscillator settles into a stable limit cycle', ok: result.stats.periodSpread < 0.03, detail: `cycle-to-cycle within ${(result.stats.periodSpread * 100).toFixed(2)}%` },
              { label: 'Phases occur in the order a cell must pass through them', ok: result.stats.legalOrder, detail: result.stats.transitionSet.join(', ') },
              { label: 'DNA reaches exactly 4C and never passes it', ok: Math.abs(result.stats.dnaMax - 4) < 1e-6 && result.stats.dnaMin >= 2 - 1e-9, detail: `range ${result.stats.dnaMin.toFixed(4)}C – ${result.stats.dnaMax.toFixed(4)}C` },
              { label: 'Each division restores exactly 2C', ok: result.stats.dnaComplete, detail: result.stats.dnaAtDivision.map((value) => `${value.toFixed(2)}C`).join(', ') || 'no division yet' },
              { label: 'Mass at division is twice the birth mass', ok: Math.abs(result.stats.meanMassRatio - 2) < 0.05, detail: `mean ratio ${result.stats.meanMassRatio.toFixed(4)}` },
              { label: 'Active CDK1 peaks in mitosis', ok: result.stats.mpfPeakDuringM > result.stats.mpfPeakDuringInterphase, detail: `${result.stats.mpfPeakDuringM.toFixed(3)} in M against ${result.stats.mpfPeakDuringInterphase.toFixed(3)} in interphase` },
              result.checkpoint
                ? { label: 'Mitosis is never entered with replication unfinished', ok: result.stats.checkpointViolations === 0, detail: `${result.stats.checkpointViolations} premature entries` }
                : { label: 'Without the checkpoint, mitosis does start early', ok: result.stats.checkpointViolations > 0, detail: `first entry with ${result.stats.earliestMitosisDna === null ? '—' : `${result.stats.earliestMitosisDna.toFixed(1)}%`} of the genome copied` },
            ]}
            note="The checkpoint is not a rule in the phase machine: it inhibits APC, which is what holds CDK1 high while replication finishes. Switching it off removes that inhibition, so the difference you see is the mechanism."
          />
        </>
      )}

      {verification && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Normal cell" value={`${verification.guarded.stats.divisions} divisions`} sub={`${verification.guarded.stats.checkpointViolations} premature entries`} mono />
            <Stat label="Slow replication, checkpoint on" value={`held ${verification.slow.stats.heldInG2Hours.toFixed(1)} h`} sub={`${verification.slow.stats.checkpointViolations} premature entries`} mono />
            <Stat label="Slow replication, checkpoint off" value={`${verification.slowUnguarded.stats.checkpointViolations} premature`} sub={`first with ${verification.slowUnguarded.stats.earliestMitosisDna?.toFixed(0)}% copied`} mono />
          </div>
          <VerifyPanel title="Control runs" items={verification.checks} note="Four runs of one engine: a normal cell and a slow-replicating cell, each with and without the checkpoint." />
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· The oscillator is integrated at a fixed step and its own period is measured first, then mapped onto the chosen cell's cycle length — the shape is the model's, only the time axis is biological.</p>
          <p>· DNA content is a tracked quantity, not a label: it rises through S at the rate the cell type's S phase implies and is halved at cytokinesis.</p>
          <p>· A checkpoint is a mechanism here: it keeps APC/C switched off, so CDK1 stays high and the cell waits in G2 until replication is done.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}