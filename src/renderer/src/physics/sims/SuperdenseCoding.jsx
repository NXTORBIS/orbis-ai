// Superdense Coding — dedicated simulator for the superdense coding protocol.
// Alice sends 2 classical bits to Bob using 1 qubit of a shared Bell pair.
// Shows the encoding gates, the Bell-state channel, and Bob's decoding.
import React, { useState } from 'react';
import { QState, GATES, applySingle, applyControlled, probs } from '../lib/qsim.js';
import { ResearchHeader, Card, SciTable } from '../research.jsx';
import { Button } from '../ui/button.jsx';

const MESSAGES = {
  '00': { desc: 'Send 00: apply I (nothing)', gates: [] },
  '01': { desc: 'Send 01: apply X', gates: [{ g: 'X', q: 0 }] },
  '10': { desc: 'Send 10: apply Z', gates: [{ g: 'Z', q: 0 }] },
  '11': { desc: 'Send 11: apply X then Z', gates: [{ g: 'X', q: 0 }, { g: 'Z', q: 0 }] },
};

export default function SuperdenseCoding() {
  const [msg, setMsg] = useState('10');
  const [result, setResult] = useState(null);

  const run = () => {
    // 1. Create Bell pair
    const st = new QState(2); applySingle(st, 0, GATES.H); applyControlled(st, 0, 1, GATES.X);
    const bellState = probs(st).slice();
    // 2. Alice encodes
    for (const g of MESSAGES[msg].gates) applySingle(st, g.q, GATES[g.g]);
    const encoded = probs(st).slice();
    // 3. Bob decodes: CNOT then H on q0
    applyControlled(st, 0, 1, GATES.X); applySingle(st, 0, GATES.H);
    const decoded = probs(st);
    const maxIdx = decoded.indexOf(Math.max(...decoded));
    const received = maxIdx.toString(2).padStart(2, '0');
    setResult({ bellState, encoded, decoded, received, success: received === msg });
  };
  React.useEffect(() => { run(); }, [msg]);

  const INPUTS = ['00', '01', '10', '11'];
  const fmt = (arr) => arr.map((p, i) => `${INPUTS[i]}:${p.toFixed(3)}`).join('  ');

  return (
    <div className="space-y-4">
      <ResearchHeader title="Superdense Coding (2 bits via 1 qubit)" subtitle="Alice sends 2 classical bits using only 1 qubit of a shared Bell pair — the dual of teleportation." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Alice sends:</label>
        {Object.keys(MESSAGES).map((m) => <Button key={m} size="sm" variant={m === msg ? 'default' : 'outline'} onClick={() => setMsg(m)}>{m}</Button>)}
      </div>
      <p className="text-xs text-muted-foreground">{MESSAGES[msg].desc}</p>
      {result && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Protocol stages">
          <div className="space-y-3 text-sm">
            <div><div className="text-xs text-muted-foreground">1. Shared Bell pair:</div><div className="font-mono text-xs mt-1">{fmt(result.bellState)}</div></div>
            <div><div className="text-xs text-muted-foreground">2. After Alice encodes:</div><div className="font-mono text-xs mt-1">{fmt(result.encoded)}</div></div>
            <div><div className="text-xs text-muted-foreground">3. After Bob decodes (CNOT+H):</div><div className="font-mono text-xs mt-1">{fmt(result.decoded)}</div></div>
          </div>
        </Card>
        <Card title="Result">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Sent:</span><span className="font-mono">{msg}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Bob receives:</span><span className="font-mono text-cyan-j">{result.received}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Success:</span><span className="font-mono">{result.success ? '✓ YES' : '✗ NO'}</span></div>
            <p className="mt-2 text-xs text-muted-foreground">Superdense coding transmits 2 classical bits using 1 qubit — but only because Alice and Bob pre-shared entanglement. The 4 messages map to the 4 Bell states via I, X, Z, XZ.</p>
          </div>
        </Card>
      </div>}
    </div>
  );
}