import React, { useState, useMemo, useCallback } from 'react';
import { Play, StepForward, StepBack, RotateCcw, Zap } from 'lucide-react';
import Section from './Section';
import { getCode } from '../lib/qec/codes.js';
import { getDecoder } from '../lib/qec/decoders.js';
import { syndromeOf, syndromeToKey } from '../lib/qec/decoders.js';
import { sampleDataError, makeRng } from '../lib/qec/noise.js';
import { pauliMul, pauliToString, pauliWeight, toVector, inSpan, zeroPauli } from '../lib/qec/pauli.js';
import { classifyLogical } from '../lib/qec/simulation.js';
import ErrorViz from './ErrorViz';

const STAGES = ['Prepare', 'Encode', 'Inject Error', 'Syndrome', 'Decode', 'Recover', 'Measure Logical'];

export default function SingleTrialPanel({ code, model, fault, seed, onSeed }) {
  const [stage, setStage] = useState(0);
  const [manual, setManual] = useState({ qubit: 0, type: 'X' });
  const [useManual, setUseManual] = useState(false);
  const [record, setRecord] = useState(null);

  const lookup = useMemo(() => getDecoder(code, 'lookup'), [code]);

  const buildError = useCallback(() => {
    if (useManual) {
      const e = zeroPauli(code.n);
      const q = Math.max(0, Math.min(code.n - 1, manual.qubit));
      if (manual.type === 'X' || manual.type === 'Y') e.x[q] = 1;
      if (manual.type === 'Z' || manual.type === 'Y') e.z[q] = 1;
      return e;
    }
    return sampleDataError(code.n, model, makeRng(seed));
  }, [code, model, seed, useManual, manual]);

  const run = useCallback(() => {
    const error = buildError();
    let syndrome = syndromeOf(error, code.stabilizerPaulis);
    if (fault.faulty) {
      const rng = makeRng(seed + 1);
      for (let i = 0; i < syndrome.length; i++) if (rng() < (fault.uniform ? model.p : fault.pMeas)) syndrome[i] ^= 1;
    }
    const entry = lookup.get(syndromeToKey(syndrome));
    const correction = entry ? entry.correction : zeroPauli(code.n);
    const residual = pauliMul(error, correction);
    const corrected = inSpan(code.stabVectors, toVector(residual));
    const logical = corrected ? 'I' : classifyLogical(residual, code);
    setRecord({
      error, syndrome: Array.from(syndrome), correction, residual, corrected, logical,
      errorStr: pauliToString(error), correctionStr: pauliToString(correction), residualStr: pauliToString(residual),
      errorWeight: pauliWeight(error),
    });
    setStage(2);
  }, [buildError, code, lookup, fault, model, seed]);

  const reset = () => { setRecord(null); setStage(0); };

  const cur = record;
  return (
    <Section title="Interactive Single Trial" icon={Play}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} />
          <span className="text-muted-foreground">Manual injection</span>
        </label>
        {useManual && (
          <>
            <label className="flex items-center gap-1">
              <span className="text-muted-foreground">qubit</span>
              <input type="number" min="0" max={code.n - 1} value={manual.qubit} onChange={(e) => setManual({ ...manual, qubit: +e.target.value })} className="w-14 rounded border border-input bg-transparent px-1 py-0.5 font-mono" />
            </label>
            <select value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value })} className="rounded border border-input bg-transparent px-1 py-0.5 font-mono">
              <option className="bg-card">X</option><option className="bg-card">Y</option><option className="bg-card">Z</option>
            </select>
          </>
        )}
        {!useManual && (
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">seed</span>
            <input type="number" value={seed} onChange={(e) => onSeed(+e.target.value || 0)} className="w-20 rounded border border-input bg-transparent px-1 py-0.5 font-mono" />
          </label>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <button onClick={run} className="flex items-center gap-1 rounded bg-cyan-j px-2.5 py-1 text-xs text-white btn-press"><Zap className="h-3.5 w-3.5" /> Run trial</button>
        <button disabled={!cur || stage >= STAGES.length - 1} onClick={() => setStage((s) => Math.min(STAGES.length - 1, s + 1))} className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs disabled:opacity-40"><StepForward className="h-3.5 w-3.5" /> Step</button>
        <button disabled={stage <= 0} onClick={() => setStage((s) => Math.max(0, s - 1))} className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs disabled:opacity-40"><StepBack className="h-3.5 w-3.5" /> Back</button>
        <button onClick={reset} className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {STAGES.map((s, i) => (
          <span key={s} className={`rounded-full px-2 py-0.5 text-[10px] ${i === stage ? 'bg-cyan-j text-white' : i < stage ? 'bg-emerald-500/20 text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>{i + 1}. {s}</span>
        ))}
      </div>

      {cur ? (
        <div className="space-y-3">
          <ErrorViz code={code} error={cur.error} correction={cur.correction} residual={cur.residual} />
          {stage >= 3 && (
            <div className="rounded border border-border/60 p-2 font-mono text-xs">
              <div className="text-[10px] uppercase text-muted-foreground">Syndrome</div>
              <div className="text-cyan-j">{cur.syndrome.map((b, i) => `S${i + 1}:${b ? '−1' : '+1'}`).join('  ')}</div>
              <div className="mt-0.5 text-muted-foreground">Binary: {cur.syndrome.join('')}</div>
            </div>
          )}
          {stage >= 4 && <div className="text-xs">Decoder correction: <span className="font-mono text-cyan-j">{cur.correctionStr}</span></div>}
          {stage >= 6 && (
            <div className={`rounded border p-2 text-xs ${cur.corrected ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-red-500/50 bg-red-500/10 text-red-400'}`}>
              {cur.corrected ? '✓ Physical error corrected — logical state preserved.' : `✗ Logical failure — residual acts as logical ${cur.logical}.`}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Run a trial to step through the full QEC pipeline.</p>
      )}
    </Section>
  );
}