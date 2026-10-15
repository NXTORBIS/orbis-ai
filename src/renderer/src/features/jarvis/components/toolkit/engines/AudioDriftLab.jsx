import { useRef, useState } from 'react';
import { AudioWaveform, Play, RefreshCw, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { CopyBtn, Field, Panel, Stat } from '../shared';
import { Bars, Hero, Pills, Spark } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { correctDrift, decodeToMono, estimateDrift, residualOffset, verifyDriftCorrection } from './audioDriftCore';
const fmt = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

export default function AudioDriftLab() {
  const [seconds, setSeconds] = useState(2);
  const [ppm, setPpm] = useState(250);
  const [offsetMs, setOffsetMs] = useState(12);
  const [seed, setSeed] = useState(5);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [files, setFiles] = useState({ reference: null, drifting: null });
  const [sampleRate, setSampleRate] = useState(8000);
  const controller = useRef(null);

  const runSynthetic = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const outcome = await verifyDriftCorrection({
        seconds,
        sampleRate,
        ppm,
        offsetMs,
        seed,
        onProgress: (update) => setProgress(update),
        signal: abort.signal,
      });
      setResult(outcome);
    } catch (thrown) {
      setError(thrown.message || 'The measurement could not run.');
    }
    setBusy(false);
    setProgress(null);
    controller.current = null;
  };

  const runRecordings = async () => {
    if (!files.reference || !files.drifting) {
      setError('Choose two recordings first — the same performance captured twice, as separate WAV files.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const reference = await decodeToMono(files.reference);
      const other = await decodeToMono(files.drifting);
      if (Math.abs(reference.sampleRate - other.sampleRate) > 1) throw new Error('The two recordings use different sample rates — resample one so they match.');
      const drift = estimateDrift(reference.signal, other.signal, {
        sampleRate: reference.sampleRate,
        windows: 10,
        maxLag: Math.ceil(reference.sampleRate),
        onProgress: (update) => setProgress(update),
      });
      const corrected = correctDrift(reference.signal, other.signal, { sampleRate: reference.sampleRate, ppm: drift.ppm, offsetSamples: drift.offsetSamples });
      const before = residualOffset(reference.signal, other.signal, { sampleRate: reference.sampleRate, windows: 10, maxLag: 400 });
      const after = residualOffset(reference.signal, corrected, { sampleRate: reference.sampleRate, windows: 10, maxLag: 120 });
      setResult({
        recordings: true,
        sampleRate: reference.sampleRate,
        duration: reference.duration,
        estimated: { ppm: drift.ppm, offsetMs: drift.offsetMs, r2: drift.r2, spreadMs: (drift.spreadSamples / reference.sampleRate) * 1000 },
        residual: { beforeMs: before.meanMs, beforeRms: before.rmsMs, afterMs: after.meanMs, afterRms: after.rmsMs, afterPeakMs: after.peakMs },
        correlation: { before: before.correlation, after: after.correlation },
        offsets: drift.windows.map((window) => ({ label: `${window.seconds.toFixed(2)}s`, value: window.ms })),
        curves: {
          source: Array.from(reference.signal.subarray(0, 4000)),
          drifting: Array.from(other.signal.subarray(0, 4000)),
          corrected: Array.from(corrected.subarray(0, 4000)),
        },
      });
    } catch (thrown) {
      setError(thrown.message || 'The recordings could not be analysed.');
    }
    setBusy(false);
    setProgress(null);
  };

  const regenerate = () => {
    setSeed(Math.floor(Math.random() * 1000));
    setResult(null);
  };

  const measured = result?.estimated;

  return (
    <ToolShell
      toolId="audio-drift"
      icon={AudioWaveform}
      title="Audio Clock Drift Correction Engine"
      desc="Measures the offset and rate difference between two recordings of the same source by FFT cross-correlation, then resamples the drifting stream onto the reference timeline with a windowed-sinc interpolator."
      state={{ seconds, ppm, offsetMs, seed, sampleRate }}
      onRestore={(state) => {
        if (!state) return;
        if (state.seconds) setSeconds(state.seconds);
        if (typeof state.ppm === 'number') setPpm(state.ppm);
        if (typeof state.offsetMs === 'number') setOffsetMs(state.offsetMs);
        if (state.seed) setSeed(state.seed);
        if (state.sampleRate) setSampleRate(state.sampleRate);
      }}
      exportText={result ? [
        `measured drift ${fmt(measured.ppm, 3)} ppm (${result.settings ? `true ${result.settings.truePpm} ppm` : 'no ground truth'})`,
        `measured offset ${fmt(measured.offsetMs, 3)} ms`,
        `fit r² ${fmt(measured.r2, 5)}`,
        ...result.offsets.map((offset) => `${offset.label}\t${fmt(offset.value, 4)} ms`),
        `residual before ${fmt(result.residual.beforeRms, 4)} ms rms, after ${fmt(result.residual.afterRms, 4)} ms rms`,
      ].join('\n') : ''}
      exportName="drift-measurement.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={runSynthetic} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Measure a generated pair</Button>
        <Button size="sm" variant="outline" onClick={runRecordings} className="gap-1.5">Measure my recordings</Button>
        <Button size="sm" variant="outline" onClick={regenerate} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> New pair</Button>
        {busy && <Button size="sm" variant="outline" onClick={() => controller.current?.abort()} className="gap-1.5"><X className="h-3.5 w-3.5" /> Stop</Button>}
      </div>

      <EngineProgress busy={busy} phase={progress?.phase} done={progress?.done} total={progress?.total} />

      <div className="grid gap-3 md:grid-cols-2">
        <Panel>
          <div className="mb-2 text-xs font-semibold">Generated pair (ground truth known)</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Duration (seconds)">
              <input type="number" min={0.5} max={8} step={0.5} value={seconds} onChange={(event) => setSeconds(Math.max(0.5, Number(event.target.value) || 2))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
            <Field label="Sample rate">
              <input type="number" min={8000} max={48000} step={4000} value={sampleRate} onChange={(event) => setSampleRate(Math.max(8000, Number(event.target.value) || 8000))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
            <Field label="Clock difference (ppm)">
              <input type="number" value={ppm} onChange={(event) => setPpm(Number(event.target.value) || 0)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
            <Field label="Start offset (ms)">
              <input type="number" value={offsetMs} onChange={(event) => setOffsetMs(Number(event.target.value) || 0)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">The pair is produced by resampling a known source at exactly this rate difference, so the estimate can be held against the number that was used.</p>
        </Panel>

        <Panel>
          <div className="mb-2 text-xs font-semibold">Your own recordings</div>
          <div className="grid gap-2">
            <Field label="Reference recording">
              <input type="file" accept="audio/*" onChange={(event) => setFiles((current) => ({ ...current, reference: event.target.files?.[0] ?? null }))} className="w-full text-[11px] text-muted-foreground" />
            </Field>
            <Field label="Drifting recording">
              <input type="file" accept="audio/*" onChange={(event) => setFiles((current) => ({ ...current, drifting: event.target.files?.[0] ?? null }))} className="h-auto w-full text-[11px] text-muted-foreground" />
            </Field>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Both files are decoded and analysed in the browser; nothing is uploaded. Two takes of the same performance work best when they share a clear transient near the start.</p>
        </Panel>
      </div>

      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero
              label="Measured clock difference"
              value={fmt(measured.ppm, 1)}
              unit="ppm"
              tone="cyan"
              sub={result.settings ? `generated at ${result.settings.truePpm} ppm — error ${fmt(measured.ppm - result.settings.truePpm, 2)} ppm` : 'no ground truth for your own recordings'}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Start offset" value={`${fmt(measured.offsetMs, 2)} ms`} sub={result.settings ? `generated at ${result.settings.trueOffsetMs} ms` : `${result.offsets.length} windows correlated`} mono />
              <Stat label="Fit quality" value={`r² ${fmt(measured.r2, 4)}`} sub={`${result.offsets.length} windows correlated`} mono />
            </div>
          </div>

          <Panel>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">Offset across the recording (ms per window)</span>
              <CopyBtn value={result.offsets.map((offset) => `${offset.label} ${fmt(offset.value, 4)}`).join('\n')} />
            </div>
            <Bars data={result.offsets.map((offset) => ({ label: offset.label, value: offset.value }))} />
            <p className="mt-2 text-[11px] text-muted-foreground">The slope of this line is the clock difference; its intercept at the start is the offset.</p>
          </Panel>

          {result.curves && (
            <div className="grid gap-3 md:grid-cols-3">
              {[['Reference', result.curves.source], ['Drifting', result.curves.drifting], ['Corrected', result.curves.corrected]].map(([label, data]) => (
                <Panel key={label} className="!p-3">
                  <div className="mb-1 text-xs font-semibold">{label}</div>
                  <Spark data={data} />
                </Panel>
              ))}
            </div>
          )}

          <Pills items={[
            { label: 'before', value: `${fmt(result.residual.beforeRms, 3)} ms rms` },
            { label: 'after', value: `${fmt(result.residual.afterRms, 3)} ms rms` },
            { label: 'correlation', value: `${fmt(result.correlation.before, 3)} → ${fmt(result.correlation.after, 3)}` },
            { label: 'windows', value: result.offsets.length },
          ]} />

          <VerifyPanel
            items={[
              result.settings
                ? { label: 'Drift recovered against the generated value', ok: Math.abs(measured.ppm - result.settings.truePpm) <= Math.max(4, Math.abs(result.settings.truePpm) * 0.12), detail: `${fmt(measured.ppm - result.settings.truePpm, 2)} ppm error` }
                : { label: 'Drift fit is linear enough to trust', ok: measured.r2 > 0.9, detail: `r² ${fmt(measured.r2, 4)}` },
              result.settings
                ? { label: 'Offset recovered against the generated value', ok: Math.abs(measured.offsetMs - result.settings.trueOffsetMs) < 1.5, detail: `${fmt(measured.offsetMs - result.settings.trueOffsetMs, 3)} ms error` }
                : { label: 'Start offset is within the recording', ok: Math.abs(measured.offsetMs) < 1000, detail: `${fmt(measured.offsetMs, 2)} ms` },
              { label: 'Residual misalignment is reduced', ok: Math.abs(result.residual.afterRms) < Math.abs(result.residual.beforeRms) / 2, detail: `${fmt(result.residual.beforeRms, 3)} → ${fmt(result.residual.afterRms, 3)} ms rms` },
              { label: 'Correlation with the reference improves', ok: result.correlation.after > result.correlation.before, detail: `${fmt(result.correlation.before, 3)} → ${fmt(result.correlation.after, 3)}` },
            ]}
            note="The correction resamples the drifting stream with a 16-tap windowed-sinc interpolator at a linearly varying position, so it interpolates between samples rather than shifting whole ones."
          />
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Offsets are measured by cross-correlation computed through a radix-2 FFT, with the peak refined by fitting a parabola to the three points around it — integer-sample precision is not enough to see a clock difference of a few hundred ppm.</p>
          <p>· Every window is measured the same way and searched over the same range; mixing two estimators with different lag conventions is what turns a clean line into noise.</p>
          <p>· A recording that genuinely has no drift should come back at zero ppm with almost no slope — the fit quality drops, which is the correct answer rather than a failure.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}