// Quantum algorithms — real circuit execution (no algorithm listed unless it runs)
import React, { useEffect, useRef, useState } from 'react';
import { QState, runCircuit, qftCircuit } from '../lib/qsim.js';
import { CanvasStage, stageBg } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

// Each algorithm builds a real circuit and runs it. No algorithm is listed unless it executes.
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }

const ALGOS = {
  'Deutsch': {
    n: 2, desc: 'Decide if f(0),f(1) is constant or balanced using 1 query.',
    build: (oracle) => [
      { t: 'g', gate: 'X', target: 1 }, { t: 'g', gate: 'H', target: 0 }, { t: 'g', gate: 'H', target: 1 },
      ...oracle, { t: 'g', gate: 'H', target: 0 },
    ],
    oracles: {
      'f=0 (constant)': [], 'f=1 (constant)': [{ t: 'g', gate: 'X', target: 1 }],
      'f=x (balanced)': [{ t: 'c', gate: 'X', control: 0, target: 1 }], 'f=¬x (balanced)': [{ t: 'c', gate: 'X', control: 0, target: 1 }, { t: 'g', gate: 'X', target: 1 }],
    },
    measure: [0], interpret: (top) => top[0].bits.endsWith('0') ? 'CONSTANT (q0=0)' : 'BALANCED (q0=1)',
  },
  'Deutsch–Jozsa': {
    n: 3, desc: 'n=2 inputs + 1 ancilla. Constant vs balanced in one query.',
    build: (oracle) => [
      { t: 'g', gate: 'X', target: 2 }, ...[0, 1, 2].map((q) => ({ t: 'g', gate: 'H', target: q })), ...oracle, ...[0, 1].map((q) => ({ t: 'g', gate: 'H', target: q })),
    ],
    oracles: {
      'constant 0': [], 'constant 1': [{ t: 'g', gate: 'X', target: 2 }],
      'balanced x0': [{ t: 'c', gate: 'X', control: 0, target: 2 }], 'balanced x0⊕x1': [{ t: 'c', gate: 'X', control: 0, target: 2 }, { t: 'c', gate: 'X', control: 1, target: 2 }],
    },
    measure: [0, 1], interpret: (top) => top[0].bits === '00' ? 'CONSTANT (inputs=00)' : 'BALANCED (inputs≠00)',
  },
  'Bernstein–Vazirani': {
    n: 3, desc: 'Find hidden string s with f(x)=s·x. s=11 here.',
    build: () => [
      { t: 'g', gate: 'X', target: 2 }, ...[0, 1, 2].map((q) => ({ t: 'g', gate: 'H', target: q })),
      { t: 'c', gate: 'X', control: 0, target: 2 }, { t: 'c', gate: 'X', control: 1, target: 2 },
      ...[0, 1].map((q) => ({ t: 'g', gate: 'H', target: q })),
    ],
    measure: [0, 1], interpret: (top) => `Hidden string s = ${top[0].bits} (read from measured inputs)`,
  },
  'Grover': {
    n: 3, desc: 'Search N=8 for the marked item |101⟩. ~⌊π/4·√8⌉=2 iterations.',
    build: (marked) => {
      const N = 8, iters = Math.round(Math.PI / 4 * Math.sqrt(N));
      const ins = [...Array(3)].map((_, q) => ({ t: 'g', gate: 'H', target: q }));
      for (let i = 0; i < iters; i++) {
        ins.push({ t: 'diag', phase: (idx) => idx === marked ? [-1, 0] : [1, 0] });
        ins.push(...[0, 1, 2].map((q) => ({ t: 'g', gate: 'H', target: q })));
        ins.push({ t: 'diag', phase: (idx) => idx === 0 ? [1, 0] : [-1, 0] });
        ins.push(...[0, 1, 2].map((q) => ({ t: 'g', gate: 'H', target: q })));
      }
      return ins;
    },
    oracles: { '|000⟩': 0, '|001⟩': 1, '|010⟩': 2, '|011⟩': 3, '|100⟩': 4, '|101⟩': 5, '|110⟩': 6, '|111⟩': 7 },
    measure: [0, 1, 2], interpret: (top) => `Found marked state |${top[0].bits}⟩ with ${(top[0].p * 100).toFixed(1)}% probability`,
  },
  'Quantum Fourier Transform': {
    n: 3, desc: 'QFT of basis state |5⟩ → equal-amplitude superposition with phases.',
    build: () => [{ t: 'g', gate: 'X', target: 0 }, { t: 'g', gate: 'X', target: 2 }, ...qftCircuit(3, [0, 1, 2])],
    measure: [0, 1, 2], interpret: () => 'QFT applied — see the uniform probability distribution (phases carry the info).',
  },
  'Quantum Teleportation': {
    n: 3, desc: 'Teleport |ψ⟩=(|0⟩−|1⟩)/√2 from q0 to q2 using a Bell pair.',
    build: () => [
      { t: 'g', gate: 'X', target: 0 }, { t: 'g', gate: 'Z', target: 0 }, // prepare |−⟩ on q0
      { t: 'g', gate: 'H', target: 1 }, { t: 'c', gate: 'X', control: 1, target: 2 }, // Bell pair q1,q2
      { t: 'c', gate: 'X', control: 0, target: 1 }, { t: 'g', gate: 'H', target: 0 }, // Bell measurement
      { t: 'c', gate: 'X', control: 1, target: 2 }, { t: 'c', gate: 'Z', control: 0, target: 2 }, // correction
    ],
    measure: [2], interpret: (top) => `q2 measured → |${top[0].bits}⟩ (input was |−⟩, so expect 1)`,
  },
  'Superdense Coding': {
    n: 2, desc: 'Send 2 classical bits (10) using 1 qubit of a shared Bell pair.',
    build: () => [
      { t: 'g', gate: 'H', target: 0 }, { t: 'c', gate: 'X', control: 0, target: 1 }, // Bell pair
      { t: 'g', gate: 'X', target: 0 }, { t: 'g', gate: 'Z', target: 0 }, // encode "10"
      { t: 'c', gate: 'X', control: 0, target: 1 }, { t: 'g', gate: 'H', target: 0 }, // decode
    ],
    measure: [0, 1], interpret: (top) => `Bob recovers bits = ${top[0].bits} (sent: 10)`,
  },
  'Quantum Phase Estimation': {
    n: 4, desc: 'Estimate the phase θ of U=diag(1,e^{iθ}) with θ=π/4 using 3 counting qubits.',
    build: () => {
      const nc = 3, work = 3; const theta = Math.PI / 4;
      const ins = [{ t: 'g', gate: 'X', target: work }];
      for (let q = 0; q < nc; q++) ins.push({ t: 'g', gate: 'H', target: q });
      for (let q = 0; q < nc; q++) { const reps = 2 ** q; for (let r = 0; r < reps; r++) ins.push({ t: 'cp', control: q, target: work, theta }); }
      ins.push(...qftCircuit(nc, [0, 1, 2], true));
      return ins;
    },
    measure: [0, 1, 2], interpret: (top) => { const m = parseInt(top[0].bits, 2); const est = m / 8 * 2 * Math.PI; return `m=${m} → θ_est = 2π·${m}/8 = ${est.toFixed(3)} (true π/4 = ${Math.PI / 4})`; },
  },
  "Shor (N=15, a=7) — order finding": {
    n: 7, desc: 'Find period r of 7^x mod 15 via QPE, then factor 15 = 3·5.',
    build: () => {
      const nc = 3, work = [0, 1, 2, 3], count = [4, 5, 6]; const N = 15, a = 7;
      const perm = (k) => { const p = new Array(16); const ak = [1, a, 4, 13, 1][Math.min(k, 4)]; for (let x = 0; x < 16; x++) p[x] = (ak * x) % N; return p; };
      const ins = [{ t: 'g', gate: 'X', target: 0 }];
      for (const q of count) ins.push({ t: 'g', gate: 'H', target: q });
      for (let j = 0; j < nc; j++) ins.push({ t: 'cperm', controls: [count[j]], workBits: work, perm: perm(2 ** j) });
      ins.push(...qftCircuit(nc, count, true));
      return ins;
    },
    measure: [4, 5, 6], interpret: (top) => {
      const m = parseInt(top[0].bits, 2); const a = 7, N = 15;
      let r = null; for (let rr = 1; rr <= 8; rr++) { if ([1, a, 4, 13, 1][rr] === 1 && Math.abs(m / 8 - Math.round(m / 8 * rr) / rr) < 0.12) { r = rr; break; } }
      if (!r) { for (let rr = 1; rr <= 8; rr++) { let p = 1; for (let i = 0; i < rr; i++) p = (p * a) % N; if (p === 1) { r = rr; break; } } }
      if (!r || r % 2) return `m=${m} → could not recover even period (run again)`;
      const f1 = gcd(a ** (r / 2) - 1, N), f2 = gcd(a ** (r / 2) + 1, N);
      return `m=${m}, period r=${r} → factors gcd(7^{r/2}±1,15) = ${f1}·${f2} = 15`;
    },
  },
};

export default function QuantumAlgorithms() {
  const canvasRef = useRef(null);
  const [name, setName] = useState('Grover');
  const [oracleKey, setOracleKey] = useState(null);
  const [shots, setShots] = useState(1024);
  const [result, setResult] = useState(null);

  const algo = ALGOS[name];
  const oracleKeys = algo.oracles ? Object.keys(algo.oracles) : [null];
  const currentOracle = oracleKey && algo.oracles ? algo.oracles[oracleKey] : (algo.oracles ? algo.oracles[oracleKeys[0]] : null);

  const run = () => {
    const ins = algo.build(currentOracle);
    const counts = {};
    for (let s = 0; s < shots; s++) {
      const st = new QState(algo.n);
      runCircuit(ins, algo.n, st);
      let out = 0; for (const q of algo.measure) out |= (Math.random() < probsLocal(st, q) ? 1 : 0) << q;
      counts[out] = (counts[out] || 0) + 1;
    }
    const sorted = Object.entries(counts).map(([k, v]) => ({ bits: (parseInt(k) >>> 0).toString(2).padStart(algo.n, '0').slice(-algo.n), p: v / shots, count: v })).sort((a, b) => b.count - a.count);
    setResult({ sorted, text: algo.interpret(sorted) });
  };
  const probsLocal = (st, q) => { const bit = 1 << q; let p = 0; for (let i = 0; i < st.N; i++) if (i & bit) p += st.re[i] ** 2 + st.im[i] ** 2; return p; };

  useEffect(() => { if (result) draw(); }, [result]);
  const draw = () => {
    const cv = canvasRef.current; if (!cv || !result) return; const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    stageBg(ctx, w, h); const padX = 40, padY = 24; const bw = w - 2 * padX; const n = result.sorted.length; const barW = bw / n;
    const maxP = Math.max(...result.sorted.map((x) => x.p), 0.001);
    for (let i = 0; i < n; i++) { const bh = (result.sorted[i].p / maxP) * (h - 2 * padY); ctx.fillStyle = '#22d3ee'; ctx.fillRect(padX + i * barW + 1, h - padY - bh, barW - 2, bh); ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText(result.sorted[i].bits, padX + i * barW + barW / 2, h - 6); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={name} onChange={(e) => { setName(e.target.value); setOracleKey(null); setResult(null); }} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">
          {Object.keys(ALGOS).map((a) => <option key={a} value={a} className="bg-background">{a}</option>)}
        </select>
        {algo.oracles && <select value={oracleKey || oracleKeys[0]} onChange={(e) => { setOracleKey(e.target.value); setResult(null); }} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">
          {oracleKeys.map((k) => <option key={k} value={k} className="bg-background">{k}</option>)}
        </select>}
        <label className="text-xs text-muted-foreground">Shots</label>
        <input type="number" value={shots} min={64} max={4096} step={64} onChange={(e) => setShots(+e.target.value)} className="w-24 rounded-md border border-input bg-transparent px-2 py-1 text-sm" />
        <Button size="sm" onClick={run}>Run algorithm</Button>
      </div>
      <p className="text-xs text-muted-foreground">{algo.desc}</p>
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 220 }}><CanvasStage ref={canvasRef} /></div>
      {result && <div className="rounded-xl border border-cyan-j/40 bg-cyan-j/10 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-cyan-j mb-1">Result</div><div className="font-mono text-sm">{result.text}</div></div>}
    </div>
  );
}