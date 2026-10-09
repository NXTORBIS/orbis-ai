import React from 'react';
import { Grid3x3 } from 'lucide-react';
import Section from './Section';
import { pauliToString } from '../lib/qec/pauli.js';

const COLOR = { I: 'bg-secondary', X: 'bg-amber-500', Y: 'bg-fuchsia-500', Z: 'bg-sky-500' };

export default function ErrorViz({ code, error, residual, correction }) {
  const errStr = error ? pauliToString(error) : 'I'.repeat(code.n);
  const resStr = residual ? pauliToString(residual) : 'I'.repeat(code.n);
  const corStr = correction ? pauliToString(correction) : 'I'.repeat(code.n);

  const Row = ({ title, str }) => (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {str.split('').map((c, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${COLOR[c] || 'bg-secondary'} ${c !== 'I' ? 'text-white' : 'text-muted-foreground'}`}>
              {c}
            </div>
            <span className="mt-0.5 text-[9px] text-muted-foreground">q{i}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Section title="Physical Qubits" icon={Grid3x3}>
      <div className="space-y-3">
        <Row title="Injected error" str={errStr} />
        <Row title="Decoder correction" str={corStr} />
        <Row title="Residual (after recovery)" str={resStr} />
      </div>
    </Section>
  );
}