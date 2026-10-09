import React, { useState, useRef } from 'react';
import { GitCompare, Play } from 'lucide-react';
import Section from './Section';
import { CODE_LIST } from '../lib/qec/codes.js';
import { getDecoder } from '../lib/qec/decoders.js';
import { runMonteCarlo } from '../lib/qec/simulation.js';

export default function ComparisonPanel({ model, fault, seed }) {
  const [trials, setTrials] = useState(10000);
  const [rows, setRows] = useState(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const cancelRef = useRef(false);

  const run = async () => {
    setRunning(true); setRows(null); setDone(0); cancelRef.current = false;
    const out = [];
    for (let i = 0; i < CODE_LIST.length; i++) {
      if (cancelRef.current) break;
      const code = CODE_LIST[i];
      const lookup = getDecoder(code, 'lookup');
      const opts = { trials, seed, faulty: fault.faulty, pMeas: fault.uniform ? model.p : fault.pMeas, batchSize: 1000 };
      const res = await runMonteCarlo(code, model, lookup, opts).promise;
      out.push({ code: code.name, tag: code.tag, n: code.n, d: code.d, pL: res.pL, failures: res.failures, trials: res.trials });
      setRows(out.slice());
      setDone(i + 1);
    }
    setRunning(false);
  };

  return (
    <Section title="Code Comparison" icon={GitCompare}>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col">
          <span className="text-muted-foreground">Trials / code</span>
          <input type="number" step="1000" value={trials} onChange={(e) => setTrials(Math.max(1, +e.target.value || 1))} disabled={running} className="w-28 rounded border border-input bg-transparent px-2 py-1 font-mono" />
        </label>
        {!running ? (
          <button onClick={run} className="flex items-center gap-1 rounded bg-cyan-j px-3 py-1.5 text-white btn-press"><Play className="h-3.5 w-3.5" /> Compare codes</button>
        ) : (
          <button onClick={() => { cancelRef.current = true; }} className="rounded border border-red-500/50 px-3 py-1.5 text-xs text-red-400">Cancel</button>
        )}
        {running && <span className="text-[11px] text-muted-foreground">{done}/{CODE_LIST.length} codes…</span>}
      </div>

      {rows && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="px-2 py-1">Code</th><th className="px-2 py-1">[[n,k,d]]</th><th className="px-2 py-1">n</th><th className="px-2 py-1">d</th><th className="px-2 py-1">p_L</th><th className="px-2 py-1">failures</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-t border-border/40 font-mono">
                  <td className="px-2 py-1">{r.code}</td>
                  <td className="px-2 py-1 text-cyan-j">{r.tag}</td>
                  <td className="px-2 py-1">{r.n}</td>
                  <td className="px-2 py-1">{r.d}</td>
                  <td className="px-2 py-1 text-cyan-j">{r.pL.toExponential(3)}</td>
                  <td className="px-2 py-1">{r.failures}/{r.trials}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-muted-foreground">Same noise model, decoder, trials, and seed across all codes for a fair comparison.</p>
        </div>
      )}
    </Section>
  );
}