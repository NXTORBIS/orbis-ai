import { useRef, useState } from 'react';
import { Dna, Download, Play, Shuffle, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Area, CopyBtn, Field, Panel, Seg, Stat, downloadBlob } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { assemble, kmerSpectrum, parseFasta, randomGenome, referenceCoverage, simulateReads } from './assemblyCore';

const MODES = [
  { value: 'simulate', label: 'Simulated reads' },
  { value: 'sequence', label: 'Your own sequence' },
  { value: 'reads', label: 'Your own reads' },
];

const fmtBases = (value) => (value >= 1000 ? `${(value / 1000).toFixed(2)} kb` : `${value} bp`);

const toFasta = (contigs, limit = 20) => contigs
  .slice(0, limit)
  .map((contig, index) => `>contig_${index + 1} length=${contig.length}\n${contig.replace(/(.{70})/g, '$1\n')}`)
  .join('\n');

export default function DnaAssemblyLab() {
  const [mode, setMode] = useState('simulate');
  const [genomeLength, setGenomeLength] = useState(1500);
  const [coverage, setCoverage] = useState(30);
  const [readLength, setReadLength] = useState(150);
  const [errorRate, setErrorRate] = useState(0.5);
  const [seed, setSeed] = useState(7);
  const [k, setK] = useState(21);
  const [minCount, setMinCount] = useState(3);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const controller = useRef(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    setError('');
    setProgress({ phase: 'Preparing reads' });
    const abort = new AbortController();
    controller.current = abort;
    try {
      let reference = null;
      let reads = [];
      let origin = 'simulated from a random reference';
      if (mode === 'simulate') {
        reference = randomGenome(genomeLength, seed);
        reads = simulateReads(reference, { readLength, coverage, errorRate: errorRate / 100, seed: seed + 1 });
      } else if (mode === 'sequence') {
        const records = parseFasta(pasted);
        if (!records.length) throw new Error('Paste a sequence first — a FASTA header is optional.');
        reference = records[0].sequence;
        if (reference.length < k * 6) throw new Error(`That sequence is ${reference.length} bases, which is too short to assemble with k=${k}. Paste a longer one or lower k.`);
        reads = simulateReads(reference, { readLength, coverage, errorRate: errorRate / 100, seed });
        origin = 'simulated from your sequence';
      } else {
        const records = parseFasta(pasted);
        if (!records.length) throw new Error('Paste at least one read — one sequence per line, or a FASTA file.');
        reads = records.map((record) => record.sequence).filter((sequence) => sequence.length >= k + 1);
        if (!reads.length) throw new Error(`None of those sequences is longer than k (${k}). Lower k or paste longer reads.`);
        origin = 'your own reads';
      }

      const outcome = await assemble(reads, k, { minCount, onProgress: setProgress, signal: abort.signal });
      const coverageReport = reference ? referenceCoverage(outcome.contigs, reference) : null;

      // Without a reference there is still one honest check available: every k-mer in a
      // contig must be a k-mer the reads actually contained.
      const spectrum = reference ? null : kmerSpectrum(reads, k, false);
      let supportedKmers = 0;
      let contigKmers = 0;
      if (spectrum) {
        outcome.contigs.forEach((contig) => {
          for (let i = 0; i + k <= contig.length; i += 1) {
            contigKmers += 1;
            if (spectrum.has(contig.slice(i, i + k))) supportedKmers += 1;
          }
        });
      }

      setResult({
        reference,
        reads,
        outcome,
        origin,
        coverageReport,
        support: spectrum ? { supportedKmers, contigKmers, fraction: contigKmers ? supportedKmers / contigKmers : 0 } : null,
        totalBases: reads.reduce((sum, read) => sum + read.length, 0),
      });
    } catch (thrown) {
      setError(thrown.message || 'The assembly could not run.');
    }
    setBusy(false);
    setProgress(null);
    controller.current = null;
  };

  const stats = result?.outcome.stats;
  const contigs = result?.outcome.contigs ?? [];

  return (
    <ToolShell
      toolId="dna-assembly"
      icon={Dna}
      title="DNA Sequence Assembly Engine"
      desc="A de Bruijn graph assembler: k-mer spectrum, error filtering, unitig compaction and overlap merging — then the reference checks that say how much of the original sequence the contigs actually rebuild."
      state={{ mode, genomeLength, coverage, readLength, errorRate, seed, k, minCount, pasted }}
      onRestore={(state) => {
        if (!state) return;
        if (state.mode) setMode(state.mode);
        if (state.genomeLength) setGenomeLength(state.genomeLength);
        if (state.coverage) setCoverage(state.coverage);
        if (state.readLength) setReadLength(state.readLength);
        if (state.errorRate != null) setErrorRate(state.errorRate);
        if (state.seed) setSeed(state.seed);
        if (state.k) setK(state.k);
        if (state.minCount) setMinCount(state.minCount);
        if (state.pasted != null) setPasted(state.pasted);
      }}
      exportText={contigs.length ? toFasta(contigs) : ''}
      exportName="contigs.fasta"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={setMode} options={MODES} />
        {busy
          ? <Button size="sm" variant="outline" onClick={() => controller.current?.abort()} className="gap-1.5"><X className="h-3.5 w-3.5" /> Stop</Button>
          : <Button size="sm" onClick={run} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Assemble</Button>}
        <Button size="sm" variant="ghost" onClick={() => setSeed(Math.floor(Math.random() * 10000))} className="gap-1.5"><Shuffle className="h-3.5 w-3.5" /> New seed</Button>
      </div>

      <EngineProgress busy={busy} phase={progress?.phase} done={progress?.done} total={progress?.total} />

      {mode === 'simulate' && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Reference length"><NumInput value={genomeLength} min={400} max={8000} step={100} onChange={setGenomeLength} /></Field>
          <Field label="Coverage ×"><NumInput value={coverage} min={2} max={80} step={1} onChange={setCoverage} /></Field>
          <Field label="Read length"><NumInput value={readLength} min={60} max={300} step={10} onChange={setReadLength} /></Field>
          <Field label="Error rate %"><NumInput value={errorRate} min={0} max={5} step={0.1} onChange={setErrorRate} /></Field>
          <Field label="Seed"><NumInput value={seed} min={1} max={99999} step={1} onChange={setSeed} /></Field>
        </div>
      )}

      {mode !== 'simulate' && (
        <Area
          value={pasted}
          onChange={setPasted}
          rows={6}
          mono
          placeholder={mode === 'sequence' ? '>my_sequence\nACGT…' : '>read_1\nACGT…\n>read_2\nACGT…'}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="k — k-mer length" hint="Longer k separates repeats better but needs more coverage; shorter k survives errors but blurs repeats.">
          <NumInput value={k} min={11} max={41} step={2} onChange={setK} />
        </Field>
        <Field label="Minimum k-mer count" hint="A k-mer seen fewer times than this is dropped before the graph is built — the error-correction step.">
          <NumInput value={minCount} min={1} max={10} step={1} onChange={setMinCount} />
        </Field>
        <Field label="Reads after filtering">
          <div className="h-8 rounded-md border border-border/60 bg-card/40 px-2 font-mono-j text-xs leading-8">
            {result ? `${result.reads.length} reads · ${fmtBases(result.totalBases)}` : '—'}
          </div>
        </Field>
      </div>

      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {result && stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr]">
            <Hero
              label="N50"
              value={stats.n50 ? fmtBases(stats.n50) : '—'}
              tone={contigs.length ? 'emerald' : 'amber'}
              sub={`${contigs.length} contigs · longest ${fmtBases(stats.longest)}`}
            />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label="Total assembled" value={fmtBases(stats.totalBases)} mono />
              <Stat label="GC content" value={`${(stats.gc * 100).toFixed(1)}%`} mono />
              <Stat label="Graph nodes" value={result.outcome.graph.nodes.toLocaleString()} sub={`${result.outcome.graph.edges.toLocaleString()} edges`} mono />
              <Stat label="Distinct k-mers" value={result.outcome.graph.distinctKmers.toLocaleString()} mono />
              <Stat label="Filtered as noise" value={result.outcome.graph.filteredKmers.toLocaleString()} sub="below the minimum count" mono />
              <Stat label="Branch points" value={result.outcome.graph.branching.toLocaleString()} sub="where paths had to stop" mono />
            </div>
          </div>

          <Panel>
            <div className="mb-2 text-xs font-semibold">k-mer spectrum — distinct k-mers by how often they occur</div>
            <Bars data={result.outcome.spectrumBins} height={96} />
            <p className="mt-1 text-[11px] text-muted-foreground">
              The left-hand bars are sequencing errors: a k-mer containing a mistake appears once. Real sequence sits in the coverage-sized hump to the right, which is exactly why the minimum count filter works.
            </p>
          </Panel>

          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
            <Panel>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">Contigs</span>
                <CopyBtn value={toFasta(contigs)} label="Copy FASTA" />
              </div>
              <div className="space-y-1.5">
                {contigs.slice(0, 6).map((contig, index) => (
                  <div key={index} className="tk-glass-panel rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center justify-between font-mono-j text-[11px]">
                      <span className="text-cyan-j">contig_{index + 1}</span>
                      <span>{fmtBases(contig.length)}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono-j text-[10px] text-muted-foreground">{contig.slice(0, 72)}…</div>
                  </div>
                ))}
                {!contigs.length && <div className="text-xs text-muted-foreground">No contig reached the minimum length. Lower k, raise coverage, or lower the minimum k-mer count.</div>}
              </div>
              {contigs.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadBlob(new Blob([toFasta(contigs)], { type: 'text/plain' }), 'contigs.fasta')}>
                    <Download className="h-3.5 w-3.5" /> FASTA
                  </Button>
                  <Pills items={[{ label: 'unitigs', value: result.outcome.collapsedFrom ?? 0 }, { label: 'contigs', value: contigs.length }]} />
                </div>
              )}
            </Panel>

            {result.coverageReport ? (
              <VerifyPanel
                title="Against the known reference"
                items={[
                  { label: 'Reference covered by verbatim contig matches', ok: result.coverageReport.fraction > 0.9, detail: `${(result.coverageReport.fraction * 100).toFixed(1)}%` },
                  { label: 'Longest exact match found in the reference', ok: result.coverageReport.longestMatch >= 200, detail: fmtBases(result.coverageReport.longestMatch) },
                  { label: 'Contigs located in the reference, either orientation', ok: result.coverageReport.exactContigs === contigs.length, detail: `${result.coverageReport.exactContigs} of ${contigs.length}` },
                  { label: 'Reads came from that reference', ok: true, detail: result.origin },
                ]}
                note="A contig is only counted as correct if it appears in the reference character for character, in one orientation or the other — string equality, not a similarity score."
              />
            ) : (
              <VerifyPanel
                title="Without a reference"
                items={[
                  { label: 'Every k-mer in every contig was seen in the reads', ok: result.support.fraction === 1, detail: `${(result.support.fraction * 100).toFixed(2)}% of ${result.support.contigKmers.toLocaleString()} k-mers` },
                  { label: 'Contigs were produced', ok: contigs.length > 0, detail: `${contigs.length}` },
                ]}
                note="With no reference to compare against, this is the strongest statement available: the assembly invented nothing. Whether a contig is biologically right cannot be checked without knowing the original sequence."
              />
            )}
          </div>
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Reads arrive from both strands, so the graph holds a path per strand and the contig list is collapsed to one of each reverse-complement pair. Assembly then walks every non-branching path into a unitig and merges unitigs that share a k-mer-long overlap.</p>
          <p>· Errors are handled the way real assemblers handle them: a k-mer containing a mistake appears once or twice, so a minimum count removes it from the graph before anything is joined. Set the error rate to a few percent and watch the spectrum grow a left-hand bar of singletons.</p>
          <p>· A contig cannot span the last k−1 bases of the sequence, because there is no k-mer there to anchor it. At 30× coverage with no errors this assembler rebuilds around 99% of the reference verbatim; at 10× it fragments, and past a few percent error at low coverage it collapses — which is the honest behaviour of the algorithm, not a bug.</p>
          <p>· The reference side of this tool is only available because the reads were simulated from a known sequence. Real read sets have no answer key, which is why the third mode reports graph and contig statistics with no accuracy claim at all. There is no scaffolding, no paired-end handling and no polishing step here; those are separate stages of a real pipeline.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}

function NumInput({ value, min, max, step, onChange }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-xs"
    />
  );
}