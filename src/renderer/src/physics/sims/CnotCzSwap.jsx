// CNOT / CZ / SWAP — dedicated explorer for the three fundamental two-qubit
// gates. Shows the control-target structure, truth table, and the effect on
// basis states, highlighting entanglement creation.
import React, { useState } from 'react';
import { QState, GATES, applySingle, applyControlled, applySwap, probs } from '../lib/qsim.js';
import { ResearchHeader, Card, SciTable } from '../research.jsx';
import { Button } from '../ui/button.jsx';

const GATE_DEFS = {
  CNOT: { desc: 'Controlled-NOT: flips target if control=1. Creates entanglement from superposition.', apply: (st) => applyControlled(st, 0, 1, GATES.X) },
  CZ: { desc: 'Controlled-Z: phases target if control=1. Also entangling, diagonal in computational basis.', apply: (st) => applyControlled(st, 0, 1, GATES.Z) },
  SWAP: { desc: 'Swaps the two qubits. Not entangling by itself, but essential for routing.', apply: (st) => applySwap(st, 0, 1) },
};

const INPUTS = ['|00⟩', '|01⟩', '|10⟩', '|11⟩'];

export default function CnotCzSwap() {
  const [gate, setGate] = useState('CNOT');
  const [input, setInput] = useState(0); // 0..3
  const [result, setResult] = useState(null);

  const run = () => {
    const st = new QState(2);
    if (input & 1) applySingle(st, 0, GATES.X);
    if (input & 2) applySingle(st, 1, GATES.X);
    const before = probs(st).slice();
    GATE_DEFS[gate].apply(st);
    const after = probs(st);
    setResult({ before, after });
  };
  React.useEffect(() => { run(); }, [gate, input]);

  const truthTable = [0, 1, 2, 3].map((i) => {
    const st = new QState(2); if (i & 1) applySingle(st, 0, GATES.X); if (i & 2) applySingle(st, 1, GATES.X);
    const b = probs(st); GATE_DEFS[gate].apply(st); const a = probs(st);
    const bMax = b.indexOf(Math.max(...b)); const aMax = a.indexOf(Math.max(...a));
    return [INPUTS[i], INPUTS[bMax], INPUTS[aMax]];
  });

  return (
    <div className="space-y-4">
      <ResearchHeader title="CNOT / CZ / SWAP (Entangling & Controlled Gates)" subtitle="The three fundamental two-qubit gates. See their truth tables, control-target structure, and entangling power." />
      <div className="flex flex-wrap items-center gap-2">
        {Object.keys(GATE_DEFS).map((g) => <Button key={g} size="sm" variant={g === gate ? 'default' : 'outline'} onClick={() => setGate(g)}>{g}</Button>)}
        <label className="text-xs text-muted-foreground ml-2">Input:</label>
        <select value={input} onChange={(e) => setInput(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{INPUTS.map((s, i) => <option key={i} value={i} className="bg-background">{s}</option>)}</select>
      </div>
      <p className="text-xs text-muted-foreground">{GATE_DEFS[gate].desc}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Truth table"><SciTable headers={['Input', 'Before', 'After']} rows={truthTable} /></Card>
        {result && <Card title={`Effect on ${INPUTS[input]}`}>
          <div className="space-y-2 text-sm">
            <div>Before: {result.before.map((p, i) => `${INPUTS[i]}=${p.toFixed(2)}`).join('  ')}</div>
            <div>After:  {result.after.map((p, i) => `${INPUTS[i]}=${p.toFixed(2)}`).join('  ')}</div>
            <p className="mt-2 text-xs text-muted-foreground">CNOT and CZ create entanglement when the control is in superposition (e.g. H then CNOT on |00⟩ → Bell state). SWAP just exchanges qubit values.</p>
          </div>
        </Card>}
      </div>
    </div>
  );
}