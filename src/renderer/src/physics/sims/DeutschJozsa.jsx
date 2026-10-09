// Deutsch–Jozsa — dedicated simulator. Generalises Deutsch to n inputs:
// decide constant vs balanced in one query. Uses n=2 input qubits + 1 ancilla.
import React, { useState, useEffect } from 'react';
import { QState, GATES, applySingle, applyControlled, probs } from '../lib/qsim.js';
import { ResearchHeader, Card } from '../research.jsx';
import { Button } from '../ui/button.jsx';

const ORACLES = {
  'constant 0': { type: 'constant', gates: [] },
  'constant 1': { type: 'constant', gates: [{ g: 'X', q: 2 }] },
  'balanced x0': { type: 'balanced', gates: [{ c: 'X', ctrl: 0, tgt: 2 }] },
  'balanced x0⊕x1': { type: 'balanced', gates: [{ c: 'X', ctrl: 0, tgt: 2 }, { c: 'X', ctrl: 1, tgt: 2 }] },
};

export default function DeutschJozsa() {
  const [oracle, setOracle] = useState('balanced x0⊕x1');
  const [result, setResult] = useState(null);

  const run = () => {
    const st = new QState(3);
    applySingle(st, 2, GATES.X); [0, 1, 2].forEach((q) => applySingle(st, q, GATES.H));
    for (const g of ORACLES[oracle].gates) { if (g.g) applySingle(st, g.q, GATES[g.g]); else applyControlled(st, g.ctrl, g.tgt, GATES.X); }
    [0, 1].forEach((q) => applySingle(st, q, GATES.H));
    const p = probs(st); const inputsZero = p[0];
    const answer = inputsZero > 0.5 ? 'CONSTANT' : 'BALANCED';
    setResult({ inputsZero, answer, correct: answer.toLowerCase() === ORACLES[oracle].type });
  };
  useEffect(() => { run(); }, [oracle]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Deutsch–Jozsa Algorithm" subtitle="Generalise Deutsch to n=2 inputs: decide constant vs balanced in ONE query (classically may need 2^(n-1)+1 queries in the worst case)." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Oracle:</label>
        <select value={oracle} onChange={(e) => setOracle(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{Object.keys(ORACLES).map((o) => <option key={o} value={o} className="bg-background">{o}</option>)}</select>
        <Button size="sm" onClick={run}>Run</Button>
      </div>
      <p className="text-xs text-muted-foreground">Circuit: X(q2) → H(all) → oracle → H(q0)H(q1) → measure inputs. All-zero ⟹ constant, anything else ⟹ balanced.</p>
      {result && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Result"><div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">P(00):</span><span className="font-mono">{result.inputsZero.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Decision:</span><span className="font-mono text-cyan-j text-lg">{result.answer}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Correct:</span><span className="font-mono">{result.correct ? '✓' : '✗'}</span></div>
        </div></Card>
        <Card title="The advantage"><p className="text-xs text-muted-foreground">Classically, to distinguish constant from balanced you might need up to 2^(n-1)+1 queries (half plus one). Deutsch–Jozsa does it in exactly 1 query by evaluating f on all 2^n inputs in superposition, then using interference to amplify the constant/balanced signature.</p></Card>
      </div>}
    </div>
  );
}