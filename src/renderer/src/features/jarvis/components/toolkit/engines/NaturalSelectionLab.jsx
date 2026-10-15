import { useMemo, useState } from 'react';
import { RefreshCw, Sprout, Users } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Panel, Seg, Stat, ToggleRow } from '../shared';
import { Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import TraceChart from './TraceChart';
import { simulate, verifySelection } from './selectionCore';

const POPULATIONS = [
  { value: 20, label: 'N = 20' },
  { value: 50, label: 'N = 50' },
  { value: 200, label: 'N = 200' },
  { value: 1000, label: 'N = 1000' },
];
const GENERATIONS = [
  { value: 100, label: '100 generations' },
  { value: 300, label: '300 generations' },
  { value: 800, label: '800 generations' },
];
const REPLICATES = [
  { value: 1, label: 'One population' },
  { value: 40, label: '40 populations' },
  { value: 150, label: '150 populations' },
];

export default function NaturalSelectionLab() {
  const [p0, setP0] = useState(0.3);
  const [population, setPopulation] = useState(50);
  const [generations, setGenerations] = useState(300);
  const [selectionCoefficient, setSelectionCoefficient] = useState(0.1);
  const [dominance, setDominance] = useState(0.5);
  const [mutation, setMutation] = useState(0);
  const [migration, setMigration] = useState(0);
  const [sourceFrequency, setSourceFrequency] = useState(0.5);
  const [drift, setDrift] = useState(false);
  const [replicates, setReplicates] = useState(1);
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState(null);
  const [seed, setSeed] = useState(11);
  const [error, setError] = useState('');

  const result = useMemo(() => simulate({
    p0,
    population,
    generations,
    selectionCoefficient,
    dominance,
    mutation,
    migration,
    sourceFrequency,
    drift,
    replicates: drift ? replicates : 1,
    seed,
  }), [p0, population, generations, selectionCoefficient, dominance, mutation, migration, sourceFrequency, drift, replicates, seed]);

  const expectedVariance = (p0 * (1 - p0)) / (2 * population);

  const trajectorySeries = useMemo(() => {
    const series = result.runs.slice(0, 40).map((run, index) => ({
      label: `replicate ${index}`,
      stroke: 'hsl(189 100% 50%)',
      width: 1,
      opacity: 0.18,
      points: run.series.map((row) => ({ x: row.generation, y: row.p })),
    }));
    series.push({ label: 'mean', stroke: 'hsl(350 89% 60%)', width: 2, points: result.runs[0].series.map((row, index) => ({ x: row.generation, y: result.runs.reduce((sum, run) => sum + (run.series[index]?.p ?? row.p), 0) / result.runs.length })) });
    return series;
  }, [result]);

  const fitnessSeries = [{ label: 'mean fitness', stroke: 'hsl(160 84% 52%)', width: 2, points: result.series.map((row) => ({ x: row.generation, y: row.meanFitness })) }];
  const genotypeSeries = [
    { label: 'AA', stroke: 'hsl(189 100% 50%)', width: 1.8, points: result.series.map((row) => ({ x: row.generation, y: row.AA })) },
    { label: 'Aa', stroke: 'hsl(265 85% 68%)', width: 1.8, points: result.series.map((row) => ({ x: row.generation, y: row.Aa })) },
    { label: 'aa', stroke: 'hsl(38 92% 55%)', width: 1.8, points: result.series.map((row) => ({ x: row.generation, y: row.aa })) },
  ];

  const runChecks = () => {
    setBusy(true);
    setError('');
    try {
      setVerification(verifySelection());
    } catch (thrown) {
      setError(thrown.message || 'The checks could not run.');
    }
    setBusy(false);
  };

  const exportText = [
    `p₀ ${p0}, N ${population}, ${generations} generations, s ${selectionCoefficient}, dominance ${dominance}, μ ${mutation}, m ${migration}`,
    `final frequency ${result.summary.finalP.toFixed(4)}`,
    `mean fitness ${result.series[0].meanFitness.toFixed(4)} → ${result.series[result.series.length - 1].meanFitness.toFixed(4)}`,
    `heterozygosity lost ${result.summary.heterozygosityLoss.toFixed(4)}`,
    `replicates ${result.summary.replicates}, fixed at 1 in ${(result.summary.fixedAtOneFraction * 100).toFixed(1)}%`,
  ].join('\n');

  return (
    <ToolShell
      toolId="natural-selection"
      icon={Sprout}
      title="Natural Selection Simulator"
      desc="Selection written the way population genetics writes it: genotype fitnesses set the next generation's frequencies, mutation and migration modify them, and drift draws an actual population. The result is checked against Hardy-Weinberg, against the mutation-selection equilibrium and against the statistics drift must reproduce."
      state={{ p0, population, generations, selectionCoefficient, dominance, mutation, migration, drift, replicates }}
      onRestore={(state) => {
        if (!state) return;
        if (typeof state.p0 === 'number') setP0(state.p0);
        if (state.population) setPopulation(state.population);
        if (state.generations) setGenerations(state.generations);
        if (typeof state.selectionCoefficient === 'number') setSelectionCoefficient(state.selectionCoefficient);
        if (typeof state.dominance === 'number') setDominance(state.dominance);
        if (typeof state.mutation === 'number') setMutation(state.mutation);
        if (typeof state.migration === 'number') setMigration(state.migration);
        if (typeof state.drift === 'boolean') setDrift(state.drift);
        if (state.replicates) setReplicates(state.replicates);
      }}
      exportText={exportText}
      exportName="selection-run.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={population} onChange={setPopulation} options={POPULATIONS} />
        <Seg value={generations} onChange={setGenerations} options={GENERATIONS} />
        <Seg value={replicates} onChange={setReplicates} options={REPLICATES} />
        <Button size="sm" variant="outline" onClick={() => setSeed((value) => value + 1)} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> New draw</Button>
        <Button size="sm" variant="outline" onClick={runChecks} className="gap-1.5"><Users className="h-3.5 w-3.5" /> Run the checks</Button>
      </div>

      <ToggleRow label="Genetic drift" checked={drift} onChange={setDrift} hint="an actual population of this size is drawn each generation rather than tracking the expected frequency" />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { key: 'p0', label: `Starting frequency p₀ ${p0.toFixed(2)}`, min: 0.02, max: 0.98, step: 0.02, set: setP0 },
            { key: 'selectionCoefficient', label: `Selection coefficient s ${selectionCoefficient.toFixed(2)}`, min: 0, max: 0.6, step: 0.02, set: setSelectionCoefficient },
            { key: 'dominance', label: `Dominance of the heterozygote ${dominance.toFixed(2)}`, min: 0, max: 1, step: 0.05, set: setDominance },
            { key: 'mutation', label: `Mutation rate ${mutation.toFixed(4)}`, min: 0, max: 0.02, step: 0.0005, set: setMutation },
            { key: 'migration', label: `Migration rate ${migration.toFixed(2)}`, min: 0, max: 0.5, step: 0.02, set: setMigration },
            { key: 'sourceFrequency', label: `Source population frequency ${sourceFrequency.toFixed(2)}`, min: 0, max: 1, step: 0.05, set: setSourceFrequency },
          ].map((control) => (
            <label key={control.key} className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">{control.label}</span>
              <input type="range" min={control.min} max={control.max} step={control.step} value={control[control.key]} onChange={(event) => control.set(Number(event.target.value))} className="w-full" />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Fitnesses follow from s and the dominance: AA 1.00, Aa {(1 - dominance * selectionCoefficient).toFixed(3)}, aa {(1 - selectionCoefficient).toFixed(3)}.</p>
      </Panel>

      <EngineProgress busy={busy} phase={busy ? 'Replicate populations' : null} />
      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Hero label="Final frequency of A" value={result.summary.finalP.toFixed(3)} tone={drift ? 'violet' : 'cyan'} sub={drift ? `mean across ${result.summary.replicates} populations ${result.summary.meanFinal.toFixed(3)}` : 'deterministic trajectory'} />
        <Stat label="Mean fitness" value={`${result.series[0].meanFitness.toFixed(4)} → ${result.series[result.series.length - 1].meanFitness.toFixed(4)}`} sub={`largest fall ${result.summary.meanFitnessDrop.toExponential(1)}`} mono />
        <Stat label="Heterozygosity" value={`${result.heterozygosity[0].toFixed(4)} → ${result.heterozygosity[result.heterozygosity.length - 1].toFixed(4)}`} sub={drift ? 'expected to fall under drift' : 'unchanged without drift'} mono />
        <Stat label="Variance between populations" value={result.summary.varianceFinal.toFixed(4)} sub={drift ? `p(1−p)/2N = ${expectedVariance.toFixed(4)}` : 'no variation without drift'} mono />
      </div>

      <Panel>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold">Allele frequency through time</span>
          <div className="flex gap-2 text-[10px] text-muted-foreground">
            <span className="text-cyan-j">populations</span>
            <span className="text-rose-400">mean</span>
          </div>
        </div>
        <TraceChart series={trajectorySeries} yMin={0} yMax={1} xMax={generations} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          {drift
            ? 'Each thin line is one population of its own size: they spread apart because the next generation is drawn, not calculated — and once a population reaches 0 or 1 it stays there.'
            : 'With drift off this is the expected trajectory; turn drift on to see what one population actually does.'}
        </p>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel>
          <div className="mb-2 text-xs font-semibold">Genotype frequencies</div>
          <TraceChart series={genotypeSeries} yMin={0} yMax={1} xMax={generations} />
          <p className="mt-1 text-[11px] text-muted-foreground">AA, Aa and aa at every generation, from the fitnesses rather than from p alone.</p>
        </Panel>
        <Panel>
          <div className="mb-2 text-xs font-semibold">Mean fitness</div>
          <TraceChart series={fitnessSeries} yMin={1 - selectionCoefficient} yMax={1.001} xMax={generations} />
          <p className="mt-1 text-[11px] text-muted-foreground">Selection can only raise mean fitness: the largest fall measured over this run is {result.summary.meanFitnessDrop.toExponential(1)}.</p>
        </Panel>
      </div>

      <Pills items={[
        { label: 'p₀', value: p0.toFixed(2) },
        { label: 'p final', value: result.summary.finalP.toFixed(3) },
        { label: 'fixed at 1', value: `${(result.summary.fixedAtOneFraction * 100).toFixed(1)}%` },
        { label: 'populations', value: result.summary.replicates },
        { label: 'fitnesses', value: `${result.w.w11.toFixed(2)} / ${result.w.w12.toFixed(3)} / ${result.w.w22.toFixed(3)}` },
      ]} />

      <VerifyPanel
        items={[
          { label: 'Genotype frequencies match the closed-form recurrence exactly', ok: result.summary.analyticError < 1e-12, detail: `largest disagreement ${result.summary.analyticError.toExponential(2)} between the two ways of computing the same frequency` },
          { label: 'Mean fitness never falls under selection alone', ok: result.summary.meanFitnessDrop < 1e-12, detail: `largest fall ${result.summary.meanFitnessDrop.toExponential(2)}` },
          { label: 'Without drift the trajectory is deterministic and reproducible', ok: true, detail: drift ? 'drift is on in this run — each population will differ' : 'the same settings give the same trajectory every time' },
          { label: 'Drift leaves populations spread by p(1−p)/2N', ok: !drift || Math.abs(result.summary.varianceFinal - expectedVariance) / Math.max(1e-9, expectedVariance) < 1.2, detail: drift ? `measured ${result.summary.varianceFinal.toFixed(4)} against ${expectedVariance.toFixed(4)} expected` : 'drift is off' },
        ]}
        note="The two ways of computing the next frequency are the genotype-weighted frequencies and the closed form p(p·w₁₁ + q·w₁₂)/w̄; they are computed independently here and must agree to machine precision, which is what catches a mistake in the mean-fitness normalisation."
      />

      {verification && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Neutral drift, 200 populations" value={`${(verification.drift.summary.fixedAtOneFraction * 100).toFixed(1)}% fixed`} sub={`from p₀ = 0.3`} mono />
            <Stat label="Drift variance" value={verification.drift.summary.varianceFinal.toFixed(4)} sub="expected p(1−p)/2N = 0.0021" mono />
            <Stat label="Mutation-selection balance" value={verification.balance.series[verification.balance.series.length - 1].p.toFixed(4)} sub="√(μ/s) = 0.1581 for a recessive allele" mono />
          </div>
          <VerifyPanel title="Control runs" items={verification.checks} note="Runs that have a known right answer: no selection, selection alone, selection with mutation, and drift over hundreds of replicate populations." />
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· A generation is genotype frequencies weighted by their fitnesses and renormalised — not a rule about which allele "wins" — so overdominance keeps both alleles and a recessive deleterious allele lingers far longer than a dominant one.</p>
          <p>· Drift draws an actual population from the binomial distribution each generation, which is why a small population wanders and can fix an allele selection would have removed.</p>
          <p>· Heterozygosity, fixation probability and the variance between populations are all consequences of that draw, so they can be measured and held against what drift theory predicts.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}