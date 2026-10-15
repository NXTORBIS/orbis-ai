import { useState } from 'react';
import { Binary, Play, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { CopyBtn, Field, Panel, Stat, readFileAsArrayBuffer } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { compareBinaries, runSimilarityBenchmark } from './binarySimCore';

const hex = (value) => `0x${(value >>> 0).toString(16)}`;

export default function BinarySimilarity() {
  const [threshold, setThreshold] = useState(0.35);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [bench, setBench] = useState(null);
  const [error, setError] = useState('');
  const [names, setNames] = useState({ a: '', b: '' });
  const controller = { current: null };

  const runBenchmark = () => {
    setBusy(true);
    setError('');
    setResult(null);
    setBench(null);
    setProgress({ phase: 'Assembling two binaries and matching them' });
    try {
      const outcome = runSimilarityBenchmark({ seed: Math.floor(Math.random() * 100000), count: 28, replaced: 4, threshold });
      setResult(outcome.result);
      setBench(outcome.ground);
    } catch (thrown) {
      setError(thrown.message || 'The benchmark could not run.');
    }
    setBusy(false);
    setProgress(null);
  };

  const runFiles = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    setBench(null);
    setProgress({ phase: 'Reading the binaries' });
    try {
      const a = new Uint8Array(await readFileAsArrayBuffer(document.getElementById('binary-a').files[0]));
      const b = new Uint8Array(await readFileAsArrayBuffer(document.getElementById('binary-b').files[0]));
      setProgress({ phase: 'Recovering functions and matching' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      setResult(compareBinaries(a, b, { threshold }));
    } catch (thrown) {
      setError(thrown.message || 'The two binaries could not be compared.');
    }
    setBusy(false);
    setProgress(null);
  };

  const exportText = result
    ? [
      `${result.stats.formats} — ${result.stats.matches} match(es) above ${result.stats.threshold}`,
      ...result.matches.map((match) => `${hex(match.a.address)}\t${hex(match.b.address)}\t${match.score.toFixed(3)}\t${match.a.tokenCount} tokens`),
    ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="binary-similarity"
      icon={Binary}
      title="Binary Function Similarity Engine"
      desc="Recovers functions from real binaries, decodes their instructions into an address-oblivious token stream and matches them with MinHash — measured against a ground truth built by transforming a known binary."
      state={{ threshold }}
      onRestore={(state) => { if (state?.threshold) setThreshold(state.threshold); }}
      exportText={exportText}
      exportName="function-matches.tsv"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={runBenchmark} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Run the ground-truth benchmark</Button>
        <Button size="sm" variant="outline" onClick={runFiles} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Compare my two files</Button>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          match threshold
          <input
            type="range"
            min={0.15}
            max={0.8}
            step={0.05}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            className="w-28"
          />
          <span className="font-mono-j text-cyan-j">{threshold.toFixed(2)}</span>
        </label>
      </div>

      <EngineProgress busy={busy} phase={progress?.phase} />

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="First binary" hint="ELF, PE, Mach-O or a raw code region. Nothing is uploaded — the file is read in the browser.">
          <input id="binary-a" type="file" onChange={(event) => setNames((current) => ({ ...current, a: event.target.files?.[0]?.name ?? '' }))} className="w-full text-[11px] text-muted-foreground" />
        </Field>
        <Field label="Second binary (a later build, ideally)">
          <input id="binary-b" type="file" onChange={(event) => setNames((current) => ({ ...current, b: event.target.files?.[0]?.name ?? '' }))} className="h-auto w-full text-[11px] text-muted-foreground" />
        </Field>
      </div>
      {(names.a || names.b) && <div className="font-mono-j text-[11px] text-muted-foreground">{names.a || '—'} vs {names.b || '—'}</div>}

      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {bench && result && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero
              label="Recall at this threshold"
              value={`${(bench.recall * 100).toFixed(0)}%`}
              tone={bench.recall > 0.9 ? 'emerald' : 'amber'}
              sub={`${bench.truePositives} of ${bench.expected} transformed functions recovered`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Precision" value={`${(bench.precision * 100).toFixed(1)}%`} sub={`${bench.falsePositives} stray match(es), ${bench.misplaced} misplaced`} mono />
              <Stat label="Rewritten functions" value={`max ${bench.maxRewrittenSimilarity.toFixed(2)}`} sub={`mean ${bench.meanRewrittenSimilarity.toFixed(2)} against their original`} mono />
            </div>
          </div>

          <VerifyPanel
            items={[
              { label: 'Correct pairs found with no stray matches', ok: bench.falsePositives === 0, detail: `${bench.truePositives} true, ${bench.falsePositives} false` },
              { label: 'Rewritten bodies stay below the threshold', ok: bench.maxRewrittenSimilarity < threshold, detail: `highest ${bench.maxRewrittenSimilarity.toFixed(3)} vs ${threshold.toFixed(2)}` },
              { label: 'Transformed pairs stay above the threshold', ok: bench.meanCorrectSimilarity > threshold, detail: `mean ${bench.meanCorrectSimilarity.toFixed(3)}` },
              { label: 'Instructions decoded rather than skipped', ok: bench.tokenCoverage > 0.99, detail: `${(bench.tokenCoverage * 100).toFixed(2)}% of function bytes became tokens` },
            ]}
            note={`The benchmark builds two real ELF64 files: the second is reordered, rebased, padded, partly re-registered and has ${bench.replaced} functions genuinely rewritten, so the correct answer is known for every function.`}
          />
        </>
      )}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Functions recovered" value={`${result.stats.functionsA} → ${result.stats.functionsB}`} sub={result.stats.formats} mono />
            <Stat label="Matches above threshold" value={result.stats.matches} sub={`${result.unmatchedA.length} unmatched on the left, ${result.unmatchedB.length} on the right`} mono />
            <Stat label="Mean similarity" value={result.stats.meanSimilarity.toFixed(3)} sub={`${result.stats.exactRewrites} byte-identical token stream(s)`} mono />
          </div>

          <Panel>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">Matches</span>
              <CopyBtn value={result.matches.map((match) => `${hex(match.a.address)} → ${hex(match.b.address)}  ${match.score.toFixed(3)}`).join('\n')} />
            </div>
            <div className="max-h-72 space-y-1 overflow-auto scrollbar-thin">
              {result.matches.map((match) => (
                <div key={`${match.a.address}-${match.b.address}`} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-2.5 py-1.5 font-mono-j text-[11px]">
                  <span>{hex(match.a.address)} → {hex(match.b.address)}</span>
                  <span className="text-muted-foreground">{match.a.section} · {match.a.tokenCount} tokens</span>
                  <span className="text-muted-foreground">{match.a.calls} calls</span>
                  <span className="text-cyan-j">{match.score.toFixed(3)}</span>
                </div>
              ))}
              {!result.matches.length && <div className="text-xs text-muted-foreground">No function pair reached the threshold. Lower it, or check that the two files are the same architecture.</div>}
            </div>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-semibold">Similarity of the matched pairs</div>
            <Bars data={result.matches.slice(0, 40).map((match, index) => ({ label: `${index + 1}`, value: Number(match.score.toFixed(3)) }))} />
          </Panel>

          <Pills items={[
            { label: 'format', value: result.stats.formats },
            { label: 'token coverage', value: bench ? `${(bench.tokenCoverage * 100).toFixed(1)}%` : 'measured' },
            { label: 'threshold', value: threshold.toFixed(2) },
            { label: 'architecture', value: result.a.container.arch },
          ]} />
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Boundaries come from prologue patterns and terminating returns — the same heuristic real binary-diff tools start from, with the same limitation: a function built without a frame pointer may be missed.</p>
          <p>· The token stream drops branch and call targets, RIP-relative displacements and large immediates, because those are exactly the bytes that move when a binary is rebuilt; registers collapse to a single symbol.</p>
          <p>· Matching uses MinHash over single tokens and three-token phrases: the first keeps the score high when instructions are inserted or removed, the second keeps genuinely rewritten bodies apart.</p>
          <p>· x86-64 is decoded in full for the instruction set a compiler actually emits; AArch64 covers the common encodings. Bytes outside that subset are counted and reported as token coverage rather than quietly ignored.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}