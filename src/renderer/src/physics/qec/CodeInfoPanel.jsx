import React from 'react';
import { Info, Check } from 'lucide-react';
import Section from './Section';
import { pauliToString } from '../lib/qec/pauli.js';

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export default function CodeInfoPanel({ code }) {
  return (
    <Section title="Code Parameters" icon={Info}>
      <div className="space-y-0.5">
        <Row label="Physical qubits (n)" value={code.n} />
        <Row label="Logical qubits (k)" value={code.k} />
        <Row label="Distance (d)" value={code.d} />
        <Row label="Correctable weight t" value={`${code.t} = ⌊(d−1)/2⌋`} />
        <Row label="Syndrome bits (n−k)" value={code.numSyndromeBits} />
      </div>
      <div className="mt-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Stabilizer generators</div>
        <div className="space-y-1">
          {code.stabilizerPaulis.map((s, i) => (
            <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
              <span className="text-muted-foreground">S{i + 1}:</span>
              <span className="text-cyan-j">{pauliToString(s)}</span>
              <Check className="h-3 w-3 text-emerald-500" aria-label="commutes" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Logical operators</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
          <span>X̄: <span className="text-cyan-j">{code.logicalX}</span></span>
          <span>Z̄: <span className="text-cyan-j">{code.logicalZ}</span></span>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{code.description}</p>
    </Section>
  );
}