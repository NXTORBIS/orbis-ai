import React, { useMemo } from 'react';
import { CircuitBoard } from 'lucide-react';
import Section from './Section';

// Render the encoding circuit as a layered ASCII-style diagram.
function EncodingCircuit({ code }) {
  if (!code.encoding || code.encoding.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{code.encodingNote || 'Encoding circuit not displayed for this code.'}</p>;
  }
  const cols = code.encoding.length;
  const rows = Array.from({ length: code.n }, () => Array(cols).fill('─'));
  code.encoding.forEach((g, c) => {
    if (g.gate === 'H') { rows[g.q][c] = 'H'; }
    if (g.gate === 'CNOT') {
      rows[g.ctrl][c] = '●';
      rows[g.tgt][c] = '⊕';
      for (let r = Math.min(g.ctrl, g.tgt) + 1; r < Math.max(g.ctrl, g.tgt); r++) rows[r][c] = '│';
    }
  });
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <pre className="font-mono text-[11px] leading-5 text-cyan-j">
        {rows.map((r, i) => `q${i} ${r.join('──')}`).join('\n')}
      </pre>
    </div>
  );
}

// Syndrome-extraction circuit: for each stabilizer, list the gate sequence.
function SyndromeCircuit({ code }) {
  return (
    <div className="space-y-1.5">
      {code.stabilizerPaulis.map((s, i) => {
        const str = s.x.map((x, j) => (x ? (s.z[j] ? 'Y' : 'X') : (s.z[j] ? 'Z' : 'I'))).join('');
        return (
          <div key={i} className="font-mono text-[11px]">
            <span className="text-muted-foreground">a{i}:</span>{' '}
            <span className="text-cyan-j">|0⟩→</span>{' '}
            {str.split('').map((c, j) => c !== 'I' && <span key={j} className="text-foreground">{c}@q{j} </span>)}
            <span className="text-muted-foreground">→ measure Z</span>
          </div>
        );
      })}
    </div>
  );
}

export default function CircuitView({ code }) {
  return (
    <Section title="Circuit Visualization" icon={CircuitBoard}>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Encoding circuit</div>
      <EncodingCircuit code={code} />
      <div className="mt-3 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Syndrome extraction (per stabilizer)</div>
      <SyndromeCircuit code={code} />
    </Section>
  );
}