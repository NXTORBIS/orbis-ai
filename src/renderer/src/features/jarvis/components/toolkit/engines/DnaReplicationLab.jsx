import { useEffect, useMemo, useRef, useState } from 'react';
import { Dna, Pause, Play, RefreshCw, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { complementStrand, replicate, verifyReplication } from './replicationCore';

const LENGTHS = [
  { value: 1500, label: '1.5 kb' },
  { value: 4000, label: '4 kb' },
  { value: 8000, label: '8 kb' },
];

const RATES = [
  { value: 40, label: '40 bp/s' },
  { value: 80, label: '80 bp/s' },
  { value: 160, label: '160 bp/s' },
];

export default function DnaReplicationLab() {
  const [genomeLength, setGenomeLength] = useState(4000);
  const [origins, setOrigins] = useState(1);
  const [forkRate, setForkRate] = useState(80);
  const [linear, setLinear] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [verification, setVerification] = useState(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);

  const run = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    setFrame(0);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const outcome = await replicate({
        genomeLength,
        origins,
        forkRate,
        linear,
        fragmentLength: 180,
        primerLength: 10,
        seed: Math.floor(Math.random() * 10000),
        onProgress: (update) => setProgress(update),
        signal: abort.signal,
      });
      setResult(outcome);
      setFrame(outcome.snapshots.length - 1);
      setPlaying(true);
    } catch (thrown) {
      setError(thrown.message || 'Replication could not run.');
    }
    setBusy(false);
    setProgress(null);
    controller.current = null;
  };

  const runChecks = async () => {
    setBusy(true);
    setError('');
    try {
      setVerification(await verifyReplication({ forkRate }));
    } catch (thrown) {
      setError(thrown.message || 'The checks could not run.');
    }
    setBusy(false);
  };

  useEffect(() => {
    if (!playing || !result) return undefined;
    const timer = setInterval(() => {
      setFrame((current) => {
        if (current >= result.snapshots.length - 1) { setPlaying(false); return current; }
        return current + 1;
      });
    }, 60);
    return () => clearInterval(timer);
  }, [playing, result]);

  const snapshot = result?.snapshots[frame];
  const coverageBars = useMemo(() => {
    if (!result) return [];
    const buckets = 60;
    const size = Math.max(1, Math.ceil(result.coverage.length / buckets));
    return Array.from({ length: buckets }, (_, index) => {
      let copied = 0;
      for (let i = index * size; i < Math.min(result.coverage.length, (index + 1) * size); i += 1) if (result.coverage[i] > 0) copied += 1;
      return { label: `${Math.round((index * size) / 1000)}k`, value: copied };
    });
  }, [result]);

  const exportText = result ? [
    `genome ${result.genomeLength} bp, ${result.settings.origins} origin(s), ${linear ? 'linear' : 'circular'}`,
    `elapsed ${result.elapsed.toFixed(1)} s, ${result.timing.rateAchieved.toFixed(1)} bp/s achieved`,
    `leading strand ${result.stats.leadingBases} bases, lagging strand ${result.stats.laggingBases} bases in ${result.stats.fragments} fragments`,
    `fragment length min ${result.stats.minFragment} / mean ${result.stats.meanFragment.toFixed(1)} / max ${result.stats.maxFragment}`,
    `uncopied ${result.stats.gaps}, copied twice ${result.stats.overlaps}, complement errors ${result.stats.complementErrors}`,
    `telomere loss ${result.stats.telomereLoss} bp`,
  ].join('\n') : '';

  return (
    <ToolShell
      toolId="dna-replication"
      icon={Dna}
      title="DNA Replication Visualizer"
      desc="A fork-level simulation: origins fire, forks run at a real rate in both directions, the leading strand extends continuously while the lagging strand is built from Okazaki fragments that each need their own RNA primer."
      state={{ genomeLength, origins, forkRate, linear }}
      onRestore={(state) => {
        if (!state) return;
        if (state.genomeLength) setGenomeLength(state.genomeLength);
        if (typeof state.origins === 'number') setOrigins(state.origins);
        if (state.forkRate) setForkRate(state.forkRate);
        if (typeof state.linear === 'boolean') setLinear(state.linear);
      }}
      exportText={exportText}
      exportName="replication-report.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={genomeLength} onChange={(value) => { setGenomeLength(value); setResult(null); }} options={LENGTHS} />
        <Seg value={forkRate} onChange={(value) => { setForkRate(value); setResult(null); }} options={RATES} />
        <Field label="">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">origins</span>
            {[1, 2, 4].map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => { setOrigins(count); setResult(null); }}
                className={`rounded-lg border px-2.5 py-1 text-[11px] ${origins === count ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 text-muted-foreground'}`}
              >
                {count}
              </button>
            ))}
          </div>
        </Field>
        {busy
          ? <Button size="sm" variant="outline" onClick={() => controller.current?.abort()} className="gap-1.5"><X className="h-3.5 w-3.5" /> Stop</Button>
          : <Button size="sm" onClick={run} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Replicate</Button>}
        <Button size="sm" variant="outline" onClick={runChecks} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Run the checks</Button>
      </div>

      <ToggleRow label="Linear chromosome" checked={linear} onChange={(value) => { setLinear(value); setResult(null); }} hint="a circular genome has no ends, so nothing is lost to the end-replication problem" />

      <EngineProgress busy={busy} phase={progress?.phase} done={progress?.done} total={progress?.total} stats={progress ? [`${progress.elapsed?.toFixed(1)} s`, `${progress.openForks} forks still running`] : []} />
      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {result && snapshot && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero
              label="Time to copy the genome"
              value={result.elapsed.toFixed(1)}
              unit="s"
              tone={result.check.complete ? 'emerald' : 'amber'}
              sub={`${result.timing.rateAchieved.toFixed(1)} bp/s across ${result.settings.origins} origin(s)`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Bases copied" value={`${result.stats.covered.toLocaleString()} / ${result.genomeLength.toLocaleString()}`} sub={`${result.stats.gaps} uncopied · ${result.stats.overlaps} copied twice`} mono />
              <Stat label="Okazaki fragments" value={result.stats.fragments} sub={`mean ${result.stats.meanFragment.toFixed(0)} bp, longest ${result.stats.maxFragment} bp`} mono />
            </div>
          </div>

          <Panel>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold">Replication fork progression — {snapshot.t.toFixed(1)} s</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPlaying((value) => !value)} className="gap-1.5">
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {playing ? 'Pause' : 'Play'}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={result.snapshots.length - 1}
                  value={frame}
                  onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)); }}
                  className="w-28"
                />
              </div>
            </div>

            <div className="space-y-2">
              {snapshot.forks.map((fork, index) => {
                const start = Math.min(fork.originPosition ?? fork.position, fork.position);
                const end = Math.max(fork.originPosition ?? fork.position, fork.position);
                return (
                  <div key={`${fork.origin}-${fork.direction}-${index}`} className="relative h-11 w-full overflow-hidden rounded-lg border border-border/50 bg-secondary/30">
                    <div className="absolute inset-y-0 left-0 w-full neural-grid opacity-30" />
                    {result.origins.map((origin) => (
                      <span key={origin} className="absolute top-0 h-full w-px bg-cyan-j/50" style={{ left: `${(origin / result.genomeLength) * 100}%` }} />
                    ))}
                    <div
                      className="absolute top-5 h-1.5 rounded-full bg-gradient-to-r from-cyan-j/40 to-cyan-j"
                      style={{ left: `${(start / result.genomeLength) * 100}%`, width: `${Math.max(0.2, ((end - start) / result.genomeLength) * 100)}%` }}
                    />
                    <div
                      className="absolute top-1.5 h-1 rounded-full bg-violet-400/70"
                      style={{ left: `${(start / result.genomeLength) * 100}%`, width: `${Math.max(0.2, ((end - start) / result.genomeLength) * 100)}%` }}
                    />
                    <span className="absolute right-2 top-1 font-mono-j text-[10px] text-muted-foreground">
                      fork {index + 1} · {fork.direction > 0 ? '→' : '←'} · {fork.fragments} fragment(s) {fork.done ? '· finished' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Violet is the leading strand, laid down continuously behind the fork; the cyan track is the lagging strand, built as fragments that each start from their own primer.</p>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-semibold">Which parts of the genome are copied</div>
            <Bars data={coverageBars} />
            <p className="mt-2 text-[11px] text-muted-foreground">Every column above zero means that stretch is present twice in the daughter strands — the point of semiconservative replication.</p>
          </Panel>

          <div className="grid gap-3 md:grid-cols-2">
            <Panel>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">Strands synthesised</span>
                <CopyBtn value={result.forks.map((fork) => fork.leadingSample).join('\n')} />
              </div>
              <div className="space-y-1 font-mono-j text-[10px] text-muted-foreground">
                {result.forks.map((fork, index) => (
                  <div key={index} className="truncate">
                    <span className="text-violet-400">{fork.direction > 0 ? '→' : '←'}</span> {fork.leadingSample || '—'}
                  </div>
                ))}
                <div className="pt-1 text-cyan-j">template 5′ {result.genomeHead.slice(0, 60)} 3′</div>
                <div>copied 3′ {complementStrand(result.genomeHead.slice(0, 60))} 5′</div>
              </div>
            </Panel>

            <Panel>
              <div className="mb-2 text-xs font-semibold">Fragment lengths</div>
              <Bars
                data={result.fragments.slice(0, 40).map((fragment, index) => ({ label: index % 5 === 0 ? `${index + 1}` : '', value: fragment.length, tone: fragment.primerReplaced ? undefined : 'rose' }))}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {result.stats.primersUnreplaced
                  ? `${result.stats.primersUnreplaced} fragment at the chromosome end cannot have its primer replaced, so ${result.stats.telomereLoss} bp are lost this round.`
                  : 'No primer is stranded at an end, so nothing is lost this round.'}
              </p>
            </Panel>
          </div>

          <Pills items={[
            { label: 'leading', value: `${result.stats.leadingBases} bases` },
            { label: 'lagging', value: `${result.stats.laggingBases} bases` },
            { label: 'fragments', value: result.stats.fragments },
            { label: 'primers', value: result.stats.primers },
            { label: 'strands', value: result.forks.length },
            { label: 'telomere loss', value: `${result.stats.telomereLoss} bp` },
          ]} />

          <VerifyPanel
            items={[
              { label: 'Every base of the genome is copied exactly once', ok: result.check.complete, detail: `${result.stats.gaps} uncopied, ${result.stats.overlaps} copied twice` },
              { label: 'Every synthesised base is complementary to its template', ok: result.check.complementary, detail: `${result.stats.complementErrors} mismatches across leading and lagging strands and every primer` },
              { label: 'Both daughter molecules are complete', ok: result.check.strandIdentity, detail: `${result.stats.leadingBases} leading + ${result.stats.laggingBases} lagging bases across ${result.stats.covered} template bases` },
              { label: 'No fragment exceeds the fragment length, and each has one primer', ok: result.check.fragmentsWithinRange && result.check.onePrimerPerFragment, detail: `longest ${result.stats.maxFragment} bp, ${result.stats.primers} primers` },
              { label: 'The rate achieved matches the rate set', ok: Math.abs(result.timing.errorPercent) < 10, detail: `${result.timing.rateAchieved.toFixed(1)} bp/s against ${result.settings.forkRate} bp/s` },
              { label: result.settings.linear ? 'A linear chromosome loses its end primer' : 'A circular genome loses nothing', ok: result.check.telomeresAsExpected, detail: `telomere loss ${result.stats.telomereLoss} bp` },
            ]}
            note="Complementarity is checked base by base against the template each base was copied from, and coverage is counted per position — so a gap or an over-copy would be found rather than assumed away."
          />
        </>
      )}

      {verification && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="One origin" value={`${verification.single.elapsed.toFixed(1)} s`} sub={`${verification.single.stats.fragments} fragments`} mono />
            <Stat label="Four origins" value={`${verification.multi.elapsed.toFixed(1)} s`} sub={`${verification.multi.stats.fragments} fragments`} mono />
            <Stat label="Circular genome" value={`${verification.circular.elapsed.toFixed(1)} s`} sub={`loses ${verification.circular.stats.telomereLoss} bp`} mono />
          </div>
          <VerifyPanel title="Control runs" items={verification.checks} note="The same engine is pointed at one origin, four origins and a circular genome; the differences are what replication biology predicts." />
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Forks stop when they meet another fork: the position is already covered, so it is not copied twice and the two forks do not pass through each other.</p>
          <p>· The lagging strand is laid down as blocks running away from the fork, because polymerase can only extend a strand 5′ to 3′ — which is exactly why that strand needs a primer per fragment.</p>
          <p>· The last block before the chromosome end is shorter than the fragment length, and on a linear chromosome its primer has nothing upstream to be replaced from: that unreplaced primer is the end-replication problem.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}