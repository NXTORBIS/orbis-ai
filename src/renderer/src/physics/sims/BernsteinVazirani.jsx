// Bernstein–Vazirani — dedicated simulator. Finds a hidden string s in ONE
// query where classically you'd need n. Uses f(x) = s·x (mod 2).
import React, { useState, useEffect } from 'react';
import { QState, GATES, applySingle, applyControlled, probs } from '../lib/qsim.js';
import { ResearchHeader, Card } from '../research.jsx';
import { Button } from '../ui/button.jsx';

const HIDDEN_STRINGS = ['00', '01', '10', '11'];

export default function BernsteinVazirani() {
  const [s, setS] = useState('11');
  const [result, setResult] = useState(null);

  const run = () => {
    const n = 3;
    const st = new QState(n);
    applySingle(st, 2, GATES.X); [0, 1, 2].forEach((q) => applySingle(st, q, GATES.H));
    for (let i = 0; i < s.length; i++) if (s[i] === '1') applyControlled(st, i, 2, GATES.X);
    [0, 1].forEach((q) => applySingle(st, q, GATES.H));
    const p = probs(st); const maxIdx = p.indexOf(Math.max(...p));
    const found = (maxIdx & 3).toString(2).padStart(2, '0');
    setResult({ found, correct: found === s });
  };
  useEffect(() => { run(); }, [s]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Bernstein–Vazirani Algorithm" subtitle="Find a hidden string s (where f(x)=s·x mod 2) in ONE query. Classically you'd need n queries to determine s bit by bit." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Hidden string s:</label>
        {HIDDEN_STRINGS.map((str) => <Button key={str} size="sm" variant={str === s ? 'default' : 'outline'} onClick={() => setS(str)}>{str}</Button>)}
        <Button size="sm" onClick={run}>Run</Button>
      </div>
      <p className="text-xs text-muted-foreground">Oracle: f(x)=s·x. Circuit: X(q2) → H(all) → CNOT for each s_i=1 → H(inputs) → measure. The measured bits ARE s.</p>
      {result && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Result"><div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Hidden s:</span><span className="font-mono">{s}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Found s:</span><span className="font-mono text-cyan-j text-lg">{result.found}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Correct:</span><span className="font-mono">{result.correct ? '✓' : '✗'}</span></div>
        </div></Card>
        <Card title="Linear speedup"><p className="text-xs text-muted-foreground">Classical: n queries to learn each bit of s independently. Quantum: 1 query recovers all n bits simultaneously via the Fourier transform (Hadamard) structure. This is a linear (n→1) speedup — deterministic and exact.</p></Card>
      </div>}
    </div>
  );
}