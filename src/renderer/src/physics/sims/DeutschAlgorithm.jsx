// Deutsch Algorithm — dedicated simulator. Decides if f:{0,1}→{0,1} is
// constant or balanced using a SINGLE query. Shows the oracle, the circuit,
// and the interference that produces the answer.
import React, { useState } from 'react';
import { QState, GATES, applySingle, applyControlled, probs } from '../lib/qsim.js';
import { ResearchHeader, Card, SciTable } from '../research.jsx';
import { Button } from '../ui/button.jsx';

const ORACLES = {
  'f=0 (constant)': { type: 'constant', gates: [] },
  'f=1 (constant)': { type: 'constant', gates: [{ g: 'X', q: 1 }] },
  'f=x (balanced)': { type: 'balanced', gates: [{ c: 'X', ctrl: 0, tgt: 1 }] },
  'f=¬x (balanced)': { type: 'balanced', gates: [{ c: 'X', ctrl: 0, tgt: 1 }, { g: 'X', q: 1 }] },
};

export default function DeutschAlgorithm() {
  const [oracle, setOracle] = useState('f=x (balanced)');
  const [result, setResult] = useState(null);

  const run = () => {
    const st = new QState(2);
    // Prepare: X on q1 (ancilla), H on both
    applySingle(st, 1, GATES.X); applySingle(st, 0, GATES.H); applySingle(st, 1, GATES.H);
    // Apply oracle
    for (const g of ORACLES[oracle].gates) { if (g.g) applySingle(st, g.q, GATES[g.g]); else applyControlled(st, g.ctrl, g.tgt, GATES.X); }
    // Final H on q0
    applySingle(st, 0, GATES.H);
    const p = probs(st); const q0prob = p[0] + p[2]; // q0=0
    const answer = q0prob > 0.5 ? 'CONSTANT' : 'BALANCED';
    setResult({ q0prob, answer, correct: answer.toLowerCase() === ORACLES[oracle].type });
  };
  React.useEffect(() => { run(); }, [oracle]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Deutsch Algorithm (Constant vs Balanced)" subtitle="Decide whether f is constant or balanced using a SINGLE quantum query — a provable advantage over classical (which needs 2)." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Oracle:</label>
        <select value={oracle} onChange={(e) => setOracle(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{Object.keys(ORACLES).map((o) => <option key={o} value={o} className="bg-background">{o}</option>)}</select>
        <Button size="sm" onClick={run}>Run</Button>
      </div>
      <p className="text-xs text-muted-foreground">Circuit: X(q1) → H(q0)H(q1) → oracle → H(q0) → measure q0. q0=0 ⟹ constant, q0=1 ⟹ balanced.</p>
      {result && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Result"><div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">P(q0=0):</span><span className="font-mono">{result.q0prob.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Decision:</span><span className="font-mono text-cyan-j text-lg">{result.answer}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Correct:</span><span className="font-mono">{result.correct ? '✓' : '✗'}</span></div>
        </div></Card>
        <Card title="Why it works"><p className="text-xs text-muted-foreground">The algorithm uses quantum interference: both f(0) and f(1) are evaluated in superposition. The final Hadamard on q0 converts the phase information into a computational-basis measurement. Constant → q0=0, balanced → q0=1, deterministically with one query.</p></Card>
      </div>}
    </div>
  );
}