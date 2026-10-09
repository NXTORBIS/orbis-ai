import React from 'react';
import { Sigma } from 'lucide-react';
import Section from './Section';

const FORMULAS = [
  { t: 'Quantum state', f: '|ψ⟩ = α|0⟩ + β|1⟩,  |α|²+|β|² = 1' },
  { t: 'Pauli operators', f: 'X = [[0,1],[1,0]]  Z = [[1,0],[0,-1]]  Y = [[0,-i],[i,0]]' },
  { t: 'Depolarizing channel', f: 'E(ρ) = (1−p)ρ + p/3 (XρX + YρY + ZρZ)' },
  { t: 'Stabilizer condition', f: 'Sᵢ |ψ_L⟩ = +|ψ_L⟩  (∀ i)' },
  { t: 'Syndrome bit', f: 'sᵢ ∈ {+1,−1}  (anticommutation with Sᵢ)' },
  { t: 'Code parameters', f: '[[n, k, d]]' },
  { t: 'Correctable weight', f: 't = ⌊(d−1)/2⌋' },
  { t: 'Logical error rate', f: 'p_L = N_failures / N_trials' },
  { t: 'Residual test', f: 'R = E·C  →  corrected iff R ∈ Stab(S)' },
];

export default function MathPanel() {
  return (
    <Section title="Educational Mathematics" icon={Sigma}>
      <div className="space-y-1.5">
        {FORMULAS.map((x) => (
          <div key={x.t} className="rounded border border-border/50 px-2 py-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{x.t}</div>
            <div className="font-mono text-[11px] text-cyan-j">{x.f}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}