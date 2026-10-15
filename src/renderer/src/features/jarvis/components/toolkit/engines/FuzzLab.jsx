import { useState } from 'react';
import { Bug, Play, ShieldCheck, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { CopyBtn, Panel, Seg, Stat } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { TARGETS, minimiseCrash, runFuzz, verifyFuzzer } from './fuzzCore';

const TARGET_OPTIONS = TARGETS.map((target) => ({ value: target.id, label: target.name }));
const VARIANTS = [
  { value: 'vulnerable', label: 'Defective build' },
  { value: 'hardened', label: 'Validated build' },
];
const BUDGETS = [
  { value: 600, label: '600 runs' },
  { value: 1500, label: '1 500 runs' },
  { value: 4000, label: '4 000 runs' },
];

const hexDump = (bytes, limit = 64) => Array.from(bytes.subarray(0, limit), (b) => b.toString(16).padStart(2, '0')).join(' ');

export default function FuzzLab() {
  const [targetId, setTargetId] = useState('zip');
  const [variant, setVariant] = useState('vulnerable');
  const [iterations, setIterations] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [run, setRun] = useState(null);
  const [acceptance, setAcceptance] = useState(null);
  const [minimised, setMinimised] = useState(null);
  const [error, setError] = useState('');
  const [controller] = useState(() => ({ current: null }));

  const target = TARGETS.find((entry) => entry.id === targetId);

  const start = async () => {
    setBusy(true);
    setError('');
    setRun(null);
    setMinimised(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const outcome = await runFuzz({
        targetId,
        variant,
        iterations,
        seed: Math.floor(Math.random() * 100000),
        onProgress: (update) => setProgress(update),
        signal: abort.signal,
      });
      setRun(outcome);
    } catch (thrown) {
      setError(thrown.message || 'The fuzzer could not run.');
    }
    setBusy(false);
    setProgress(null);
    controller.current = null;
  };

  const runAcceptance = async () => {
    setBusy(true);
    setError('');
    setAcceptance(null);
    try {
      const outcome = await verifyFuzzer({ iterations: 900, seed: Math.floor(Math.random() * 100000), onProgress: (update) => setProgress(update) });
      setAcceptance(outcome);
    } catch (thrown) {
      setError(thrown.message || 'The acceptance test could not run.');
    }
    setBusy(false);
    setProgress(null);
  };

  const shrink = () => {
    if (!run?.crashes?.length) return;
    try {
      setMinimised(minimiseCrash({ targetId, bytes: run.crashes[0].bytes, variant }));
    } catch (thrown) {
      setError(thrown.message);
    }
  };

  return (
    <ToolShell
      toolId="binary-fuzz"
      icon={Bug}
      title="Binary Format Fuzzing Engine"
      desc="A coverage-guided mutational fuzzer in the shape of AFL — deterministic mutation stages, edge coverage with hit buckets, a novelty-scored corpus and delta-debugged crash inputs — run against real format parsers."
      state={{ targetId, variant, iterations }}
      onRestore={(state) => {
        if (!state) return;
        if (state.targetId) setTargetId(state.targetId);
        if (state.variant) setVariant(state.variant);
        if (state.iterations) setIterations(state.iterations);
      }}
      exportText={run ? [
        `${target.name} (${variant}) — ${run.executions} executions, ${run.faults} faults`,
        `coverage ${run.edgesHit} edges over ${run.edgeSites} sites, corpus ${run.corpusSize}`,
        ...run.crashes.map((crash) => `crash at run ${crash.iteration} (${crash.size} bytes): ${crash.message}`),
      ].join('\n') : ''}
      exportName="fuzzing-report.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={targetId} onChange={(value) => { setTargetId(value); setRun(null); }} options={TARGET_OPTIONS} />
        <Seg value={variant} onChange={setVariant} options={VARIANTS} />
        <Seg value={iterations} onChange={setIterations} options={BUDGETS} />
        {busy
          ? <Button size="sm" variant="outline" onClick={() => controller.current?.abort()} className="gap-1.5"><X className="h-3.5 w-3.5" /> Stop</Button>
          : <Button size="sm" onClick={start} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Fuzz</Button>}
        <Button size="sm" variant="outline" onClick={runAcceptance} className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Run the acceptance test</Button>
      </div>

      <EngineProgress
        busy={busy}
        phase={progress?.phase}
        done={progress?.done}
        total={progress?.total}
        stats={run || progress ? [
          `${(run?.executions ?? progress?.executions ?? 0).toLocaleString()} executions`,
          `${run?.edgesHit ?? progress?.edges ?? 0} edges`,
          `corpus ${run?.corpusSize ?? progress?.corpus ?? 0}`,
        ] : []}
      />

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Target: <span className="text-foreground">{target.format}</span> — {target.edgeCount} instrumented branch sites.</p>
          <p>· The <span className="text-foreground">defective build</span> deliberately omits one bounds check: {target.defect}.</p>
          <p>· A fault is a read outside the input, reported with its offset and size — the same failure mode a real out-of-bounds read produces.</p>
        </div>
      </Panel>

      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {run && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero
              label="Faults found"
              value={run.faults}
              tone={run.faults ? 'amber' : 'emerald'}
              sub={`${run.executions.toLocaleString()} executions at ${run.executionsPerSecond.toLocaleString()}/s`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Coverage" value={`${run.edgesHit} edges`} sub={`${run.buckets} hit-count buckets over ${run.edgeSites} sites`} mono />
              <Stat label="Corpus" value={run.corpusSize} sub={run.firstFaultAt === null ? 'no fault reached' : `first fault after ${run.firstFaultAt} iterations`} mono />
            </div>
          </div>

          {run.curve.length > 1 && (
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-semibold">Edges reached as the run progressed</div>
              <Bars data={run.curve.map((point) => ({ label: point.label, value: point.value }))} />
            </Panel>
          )}

          <Panel>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">Faults ({run.crashes.length} distinct)</span>
              <Button size="sm" variant="outline" onClick={shrink} disabled={!run.crashes.length}>Minimise the first input</Button>
            </div>
            <div className="space-y-2">
              {run.crashes.map((crash) => (
                <div key={`${crash.iteration}-${crash.size}`} className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-amber-400">{crash.message}</span>
                    <span className="font-mono-j text-muted-foreground">{crash.size} bytes · iteration {crash.iteration}</span>
                  </div>
                  <div className="mt-1 break-all font-mono-j text-[10px] text-muted-foreground">{hexDump(crash.bytes)}</div>
                </div>
              ))}
              {!run.crashes.length && (
                <div className="text-xs text-muted-foreground">
                  No fault in {run.executions.toLocaleString()} executions — which is the expected result on the validated build.
                </div>
              )}
            </div>
          </Panel>

          {minimised && (
            <Panel>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">Minimised input — {minimised.originalSize} → {minimised.bytes.length} bytes in {minimised.passes} passes</span>
                <CopyBtn value={hexDump(minimised.bytes, 256)} />
              </div>
              <div className="break-all font-mono-j text-[11px] text-cyan-j">{hexDump(minimised.bytes, 256)}</div>
              <p className="mt-2 text-[11px] text-muted-foreground">{minimised.message}</p>
            </Panel>
          )}

          <Pills items={[
            { label: 'variant', value: variant === 'vulnerable' ? 'defective' : 'validated' },
            { label: 'executions', value: run.executions.toLocaleString() },
            { label: 'exec/s', value: run.executionsPerSecond.toLocaleString() },
            { label: 'elapsed', value: `${run.elapsedMs} ms` },
          ]} />

          <VerifyPanel
            title="Run checks"
            items={[
              { label: 'A fault is reproducible in the input shown', ok: run.faults > 0 || variant === 'hardened', detail: run.crashes[0] ? run.crashes[0].message : '' },
              { label: 'The minimised input still faults', ok: minimised ? minimised.stillCrashes : false, detail: minimised ? `${minimised.bytes.length} bytes, ${(1 - minimised.bytes.length / minimised.originalSize) * 100 | 0}% smaller` : 'run the minimiser' },
              { label: 'Coverage grew beyond the seeds', ok: run.corpusSize > target.seeds.length, detail: `corpus ${target.seeds.length} → ${run.corpusSize}` },
            ]}
            note="Every kept input reached a coverage bucket the corpus had not seen, so the queue is a set of inputs that taught the fuzzer something rather than a pile of random mutations."
          />
        </>
      )}

      {acceptance && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Targets tested" value={acceptance.results.length} sub={`${acceptance.iterations} runs per build`} mono />
            <Stat label="Validated builds survived" value={`${acceptance.results.filter((entry) => entry.passed.validatedSurvived).length}/${acceptance.results.length}`} mono />
            <Stat label="Defects found and minimised" value={`${acceptance.results.filter((entry) => entry.passed.defectFound && entry.passed.minimised).length}/${acceptance.results.length}`} mono />
          </div>

          <div className="space-y-2">
            {acceptance.results.map((entry) => (
              <Panel key={entry.id} className="!p-3">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">{entry.name}</span>
                  <span className={entry.passed.validatedSurvived && entry.passed.defectFound ? 'text-emerald-400' : 'text-amber-400'}>
                    {entry.passed.validatedSurvived ? 'validated build survived' : 'validated build faulted'} · {entry.passed.defectFound ? 'defect reproduced' : 'defect not reached'}
                  </span>
                </div>
                <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                  <span>validated: {entry.hardened.faults} faults, {entry.hardened.edgesHit} edges, corpus {entry.hardened.corpus}</span>
                  <span>defective: {entry.vulnerable.faults} faults, {entry.vulnerable.edgesHit} edges{entry.vulnerable.minimised ? `, minimised to ${entry.vulnerable.minimised.size} bytes` : ''}</span>
                </div>
                {entry.vulnerable.minimised && <p className="mt-1 font-mono-j text-[10px] text-amber-400">{entry.vulnerable.minimised.message}</p>}
              </Panel>
            ))}
          </div>

          <VerifyPanel
            title="Acceptance test"
            items={[
              { label: 'Every validated parser survived its run', ok: acceptance.results.every((entry) => entry.passed.validatedSurvived), detail: `${acceptance.results.reduce((sum, entry) => sum + entry.hardened.faults, 0)} faults across all validated builds` },
              { label: 'Every defect was reached', ok: acceptance.results.every((entry) => entry.passed.defectFound), detail: `${acceptance.results.filter((entry) => entry.passed.defectFound).length}/${acceptance.results.length} targets` },
              { label: 'Every crashing input was minimised', ok: acceptance.results.every((entry) => entry.passed.minimised), detail: acceptance.results.filter((entry) => entry.vulnerable.minimised).map((entry) => `${entry.id}: ${entry.vulnerable.minimised.size}b`).join(', ') },
            ]}
            note="The same engine and the same seed are pointed at both builds of each parser. Surviving the validated build and breaking the defective one is the pair of results that shows the fuzzer is finding the missing check rather than stumbling into any fault at all."
          />
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Mutation runs in deterministic stages — bit flips, byte arithmetic, interesting 16- and 32-bit values, inserts, deletes, block duplication, dictionary tokens and splices — followed by a random havoc stage.</p>
          <p>· Coverage is edge-based: each execution records (previous site → current site) with a hit-count bucket, so a branch that suddenly runs twice as often counts as new information.</p>
          <p>· Minimisation is delta debugging: chunks of decreasing size are removed while the fault survives, then the bytes are zeroed one at a time, which is what turns a 640-byte seed into the handful of bytes that actually matter.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}