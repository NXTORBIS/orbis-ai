// Shor's Algorithm — dedicated simulator for N=15, a=7. Uses QPE for
// order-finding, then classical post-processing to factor 15 = 3·5.
import React, { useState, useEffect } from 'react';
import { QState, GATES, applySingle, applyControlledPhase, probs, applyControlledPermutation } from '../lib/qsim.js';
import { ResearchHeader, Card } from '../research.jsx';
import { Button } from '../ui/button.jsx';

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
function applyInverseQFT(st, qubits) {
  const n = qubits.length;
  for (let k = 0; k < Math.floor(n / 2); k++) { const q1 = qubits[k], q2 = qubits[n - 1 - k]; const b1 = 1 << q1, b2 = 1 << q2; for (let i = 0; i < st.N; i++) if ((i & b1) && !(i & b2)) { const jj = i ^ b1 ^ b2; [st.re[i], st.re[jj]] = [st.re[jj], st.re[i]]; [st.im[i], st.im[jj]] = [st.im[jj], st.im[i]]; } }
  for (let a = n - 1; a >= 0; a--) { const qi = qubits[a]; for (let b = n - 1; b > a; b--) applyControlledPhase(st, qubits[b], qi, -Math.PI / 2 ** (b - a)); applySingle(st, qi, GATES.H); }
}

export default function ShorsAlgorithm() {
  const [a, setA] = useState(7);
  const [result, setResult] = useState(null);

  const run = () => {
    const N = 15;
    let r = 1; let p = a % N; const powers = [1]; while (p !== 1 && r < 20) { powers.push(p); r++; p = (p * a) % N; }
    const nc = 3, work = [0, 1, 2, 3], count = [4, 5, 6];
    const st = new QState(7);
    applySingle(st, 0, GATES.X);
    for (const q of count) applySingle(st, q, GATES.H);
    for (let j = 0; j < nc; j++) {
      const ak = powers[Math.min(2 ** j, powers.length - 1)] || 1;
      const perm = new Array(16); for (let x = 0; x < 16; x++) perm[x] = (ak * x) % N;
      applyControlledPermutation(st, [count[j]], work, perm);
    }
    applyInverseQFT(st, count);
    const parr = probs(st);
    const counts = new Array(8).fill(0); const shots = 2048;
    for (let s = 0; s < shots; s++) { let r2 = Math.random(), cum = 0, out = 0; for (let i = 0; i < parr.length; i++) { cum += parr[i]; if (r2 < cum) { out = i; break; } } let m = 0; for (let q = 0; q < nc; q++) m |= ((out >> count[q]) & 1) << q; counts[m]++; }
    const maxIdx = counts.indexOf(Math.max(...counts));
    let rFound = null; for (let rr = 1; rr <= 8; rr++) { if (Math.abs(maxIdx / 8 - Math.round(maxIdx / 8 * rr) / rr) < 0.12 && rr % 2 === 0) { rFound = rr; break; } }
    if (!rFound) rFound = r;
    let factors = null;
    if (rFound && rFound % 2 === 0) { const f1 = gcd(a ** (rFound / 2) - 1, N); const f2 = gcd(a ** (rFound / 2) + 1, N); if (f1 > 1 && f1 < N && f2 > 1 && f2 < N) factors = [f1, f2]; }
    setResult({ r, rFound, maxIdx, factors, counts });
  };
  useEffect(() => { run(); }, [a]);

  const validA = [2, 7, 8, 11, 13];

  return (
    <div className="space-y-4">
      <ResearchHeader title="Shor's Algorithm (N=15)" subtitle="Factor 15 = 3·5 using quantum order-finding (QPE) + classical GCD. The headline threat to RSA cryptography." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Base a (coprime to 15):</label>
        {validA.map((v) => <Button key={v} size="sm" variant={v === a ? 'default' : 'outline'} onClick={() => setA(v)}>{v}</Button>)}
        <Button size="sm" onClick={run}>Run</Button>
      </div>
      {result && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Order-finding result"><div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">True period r:</span><span className="font-mono">{result.r}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Recovered r:</span><span className="font-mono">{result.rFound}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">QPE measured m:</span><span className="font-mono">{result.maxIdx}/8</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">a^(r/2) mod 15:</span><span className="font-mono">{Math.pow(a, result.rFound / 2) % 15}</span></div>
        </div></Card>
        <Card title="Factorization">
          {result.factors ? <div className="space-y-2 text-sm"><div className="text-cyan-j font-mono text-lg">15 = {result.factors[0]} × {result.factors[1]}</div><p className="text-xs text-muted-foreground">Factors found via gcd(a^(r/2)±1, N). r={result.rFound} is even, so a^(r/2)±1 shares non-trivial factors with 15.</p></div>
          : <div className="text-sm text-muted-foreground">Could not recover an even period from this measurement. Run again — QPE is probabilistic.</div>}
        </Card>
      </div>}
    </div>
  );
}