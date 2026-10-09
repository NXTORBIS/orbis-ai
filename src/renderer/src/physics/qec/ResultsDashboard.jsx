import React from 'react';
import { Gauge } from 'lucide-react';
import Section from './Section';

export default function ResultsDashboard({ code, model, fault, seed, results, threshold }) {
  const pL = results?.pL;
  const p = model.type === 'custom' ? (model.pX + model.pY + model.pZ) : model.p;
  const suppressing = pL != null && pL <= p;

  return (
    <Section title="Results Dashboard" icon={Gauge}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Physical system</div>
          <dl className="mt-1 space-y-0.5 text-xs">
            <Line k="Code" v={`${code.name} ${code.tag}`} />
            <Line k="Physical qubits" v={code.n} />
            <Line k="Logical qubits" v={code.k} />
            <Line k="Distance" v={code.d} />
          </dl>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Noise</div>
          <dl className="mt-1 space-y-0.5 text-xs">
            <Line k="Model" v={model.type} />
            <Line k="Physical p" v={p.toExponential(3)} />
            <Line k="Mode" v={fault.faulty ? 'Fault-tolerant' : 'Ideal QEC'} />
            {fault.faulty && <Line k="p_meas" v={(fault.uniform ? model.p : fault.pMeas).toExponential(3)} />}
          </dl>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Logical performance</div>
          <dl className="mt-1 space-y-0.5 text-xs">
            <Line k="Decoder" v="Lookup (min-weight)" />
            <Line k="Trials" v={results ? results.trials.toLocaleString() : '—'} />
            <Line k="p_L" v={pL != null ? pL.toExponential(4) : '—'} />
            <Line k="Failures" v={results ? results.failures.toLocaleString() : '—'} />
          </dl>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Fault-tolerance verdict</div>
          {pL == null ? (
            <p className="mt-1 text-[11px] text-muted-foreground">Run a simulation to compare p_L against p.</p>
          ) : (
            <div className={`mt-1 rounded p-2 text-xs ${suppressing ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {suppressing ? '✓ Suppressing' : '✗ Amplifying'} — p_L = {pL.toExponential(3)} vs p = {p.toExponential(3)}.
              <div className="mt-1 text-[10px] text-muted-foreground">{results.failures === 0 ? 'No failures observed (upper bound).' : `95% CI [${results.ci.lower.toExponential(2)}, ${results.ci.upper.toExponential(2)}]`}</div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 text-[10px] text-muted-foreground">
        Seed: <span className="font-mono">{seed}</span> · backend: stabilizer (binary symplectic) · {results ? `${Math.round(results.tps).toLocaleString()} trials/s` : '—'}
      </div>
    </Section>
  );
}

function Line({ k, v }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono text-foreground">{v}</dd>
    </div>
  );
}