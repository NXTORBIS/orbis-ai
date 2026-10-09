import React, { useState, useRef } from 'react';
import { Play, Pause, Square, BarChart3 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import Section from './Section';
import { getCode } from '../lib/qec/codes.js';
import { getDecoder } from '../lib/qec/decoders.js';
import { runMonteCarlo, proportionCI } from '../lib/qec/simulation.js';

export default function MonteCarloPanel({ code, model, fault, seed, onSeed, onResults }) {
  const [trials, setTrials] = useState(20000);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const ctrlRef = useRef(null);

  const start = () => {
    const lookup = getDecoder(code, 'lookup');
    setRunning(true); setPaused(false); setResults(null); setProgress(0);
    const opts = { trials, seed, faulty: fault.faulty, pMeas: fault.uniform ? model.p : fault.pMeas, batchSize: 1000 };
    const ctrl = runMonteCarlo(code, model, lookup, opts, (p) => setProgress(p.done / p.trials));
    ctrlRef.current = ctrl;
    ctrl.promise.then((res) => {
      setResults(res); setRunning(false); setPaused(false); setProgress(1);
      onResults(res);
    });
  };
  const cancel = () => ctrlRef.current?.cancel();
  const togglePause = () => { if (paused) { ctrlRef.current?.resume(); setPaused(false); } else { ctrlRef.current?.pause(); setPaused(true); } };

  const ci = results ? proportionCI(results.failures, results.trials) : null;
  const noFailures = results && results.failures === 0;

  return (
    <Section title="Monte Carlo Analysis" icon={BarChart3}>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col">
          <span className="text-muted-foreground">Trials</span>
          <input type="number" min="1" step="1000" value={trials} onChange={(e) => setTrials(Math.max(1, +e.target.value || 1))} disabled={running} className="w-28 rounded border border-input bg-transparent px-2 py-1 font-mono" />
        </label>
        <label className="flex flex-col">
          <span className="text-muted-foreground">Seed</span>
          <input type="number" value={seed} onChange={(e) => onSeed(+e.target.value || 0)} disabled={running} className="w-24 rounded border border-input bg-transparent px-2 py-1 font-mono" />
        </label>
        {!running ? (
          <button onClick={start} className="flex items-center gap-1 rounded bg-cyan-j px-3 py-1.5 text-white btn-press"><Play className="h-3.5 w-3.5" /> Run</button>
        ) : (
          <>
            <button onClick={togglePause} className="flex items-center gap-1 rounded border border-border px-3 py-1.5">{paused ? <><Play className="h-3.5 w-3.5" /> Resume</> : <><Pause className="h-3.5 w-3.5" /> Pause</>}</button>
            <button onClick={cancel} className="flex items-center gap-1 rounded border border-red-500/50 px-3 py-1.5 text-red-400"><Square className="h-3.5 w-3.5" /> Cancel</button>
          </>
        )}
      </div>

      {(running || progress > 0) && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded bg-secondary">
            <div className="h-full bg-cyan-j transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">{Math.round(progress * (results ? results.trials : trials))} trials</div>
        </div>
      )}

      {results && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Trials" value={results.trials.toLocaleString()} />
            <Stat label="Corrected" value={results.corrected.toLocaleString()} />
            <Stat label="Logical failures" value={results.failures.toLocaleString()} />
            <Stat label="Trials/sec" value={Math.round(results.tps).toLocaleString()} />
          </div>
          <div className="rounded border border-border/60 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Logical error rate p_L</div>
            <div className="font-mono text-lg text-cyan-j">{results.pL.toExponential(4)}</div>
            {noFailures ? (
              <div className="text-[11px] text-amber-500">No failures observed in {results.trials.toLocaleString()} trials — p_L is an upper bound, not exactly zero.</div>
            ) : (
              <div className="text-[11px] text-muted-foreground">95% CI: [{ci.lower.toExponential(3)}, {ci.upper.toExponential(3)}]</div>
            )}
          </div>
          {results.cancelled && <div className="text-[11px] text-amber-500">Simulation cancelled — partial results shown ({results.trials} completed).</div>}
          <div className="text-[11px] text-muted-foreground">
            Logical breakdown: I={results.logicalCounts.I} X={results.logicalCounts.X} Y={results.logicalCounts.Y} Z={results.logicalCounts.Z}
          </div>
        </div>
      )}
    </Section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}