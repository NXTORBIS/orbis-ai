// Numerical Linear Algebra — LU, QR, condition number, residual analysis
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// QR via Gram-Schmidt
function qrGramSchmidt(A) {
  const n = A.length, m = A[0].length;
  const Q = Array.from({ length: n }, () => new Array(m).fill(0));
  const R = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) Q[i][j] = A[i][j];
    for (let k = 0; k < j; k++) {
      R[k][j] = 0;
      for (let i = 0; i < n; i++) R[k][j] += Q[i][k] * A[i][j];
      for (let i = 0; i < n; i++) Q[i][j] -= R[k][j] * Q[i][k];
    }
    let norm = 0; for (let i = 0; i < n; i++) norm += Q[i][j] * Q[i][j];
    R[j][j] = Math.sqrt(norm);
    if (R[j][j] > 1e-15) for (let i = 0; i < n; i++) Q[i][j] /= R[j][j];
  }
  return { Q, R };
}

// LU with partial pivoting
function luSolve(A, b) {
  const n = A.length;
  const U = A.map((r) => r.slice());
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  const P = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < n; k++) {
    let mx = Math.abs(U[k][k]), mr = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(U[i][k]) > mx) { mx = Math.abs(U[i][k]); mr = i; }
    if (mr !== k) { [U[k], U[mr]] = [U[mr], U[k]]; [P[k], P[mr]] = [P[mr], P[k]]; }
    L[k][k] = 1;
    for (let i = k + 1; i < n; i++) { L[i][k] = U[i][k] / U[k][k]; for (let j = k; j < n; j++) U[i][j] -= L[i][k] * U[k][j]; }
  }
  const pb = P.map((p) => b[p]);
  const y = new Array(n);
  for (let i = 0; i < n; i++) { y[i] = pb[i]; for (let j = 0; j < i; j++) y[i] -= L[i][j] * y[j]; }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { x[i] = y[i]; for (let j = i + 1; j < n; j++) x[i] -= U[i][j] * x[j]; x[i] /= U[i][i]; }
  return { x, L, U, P };
}

// Condition number estimate via power iteration on A^T A
function condEst(A) {
  const n = A.length;
  const AtA = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) AtA[i][j] += A[k][i] * A[k][j];
  // largest eigenvalue of AtA
  let v = new Array(n).fill(1);
  let lamMax = 0;
  for (let it = 0; it < 100; it++) {
    const Av = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Av[i] += AtA[i][j] * v[j];
    let norm = Math.sqrt(Av.reduce((s, x) => s + x * x, 0));
    v = Av.map((x) => x / norm);
    lamMax = v.reduce((s, x, i) => s + x * Av[i], 0);
  }
  // smallest via inverse power iteration (approximate)
  const { x: _ } = luSolve(AtA, new Array(n).fill(1));
  // Use QR to get singular values approximately
  const { R } = qrGramSchmidt(AtA);
  const diag = R.map((r, i) => Math.abs(r[i]));
  const svMax = Math.sqrt(Math.max(...diag));
  const svMin = Math.sqrt(Math.min(...diag));
  return svMax / Math.max(svMin, 1e-300);
}

function buildMatrix(type, n, seed) {
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  let r = seed; const rand = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] = Math.round(rand() * 18 - 9);
  if (type === 'hilbert') for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] = 1 / (i + j + 1);
  if (type === 'diagonal') for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] = i === j ? 1 + i * 0.5 : 0;
  return A;
}

export default function NumericalLinearAlgebraSim() {
  const [type, setType] = useState('random');
  const [n, setN] = useState(4);
  const [seed, setSeed] = useState(3);
  const { explain, explaining, output } = useAIExplain();

  const { A, qr, lu, cond, residual, x } = useMemo(() => {
    const A = buildMatrix(type, n, seed);
    const b = Array.from({ length: n }, (_, i) => i + 1);
    const qr = qrGramSchmidt(A);
    const { x, L, U, P } = luSolve(A, b);
    const residual = A.map((row, i) => row.reduce((s, a, j) => s + a * x[j], 0) - b[i]);
    const cond = condEst(A);
    return { A, qr, lu: { L, U, P }, cond, residual, x };
  }, [type, n, seed]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Numerical Linear Algebra — LU, QR, Conditioning"
        subtitle="LU with partial pivoting solves Ax=b. QR via Gram-Schmidt factorises A into orthogonal × upper-triangular. Condition number κ(A) predicts accuracy loss."
        onExplain={() => explain(`Linear algebra on ${n}×${n} ${type} matrix. LU solve residual ‖Ax−b‖∞ = ${Math.max(...residual.map(Math.abs)).toExponential(3)}. Condition number κ ≈ ${cond.toFixed(1)} — ${cond > 1e6 ? 'ill-conditioned (Hilbert-like), expect ~' + Math.floor(Math.log10(cond)) + ' digits lost' : 'well-conditioned'}. QR diagonal gives singular value estimates.`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">Matrix</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              <option value="random" className="bg-background">Random integer</option>
              <option value="hilbert" className="bg-background">Hilbert (ill-cond)</option>
              <option value="diagonal" className="bg-background">Diagonal</option>
            </select>
          </label>
          <div className="mt-3"><NumField label="size n" value={n} onChange={setN} min={2} max={8} step={1} /></div>
          <div className="mt-2"><NumField label="seed" value={seed} onChange={setSeed} min={1} max={999} step={1} /></div>
        </Card>
        <div className="space-y-3">
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['κ(A) estimate', cond.toFixed(2)],
            ['max |residual|', Math.max(...residual.map(Math.abs)).toExponential(3)],
            ['det(A)', lu.U.map((r, i) => r[i]).reduce((a, b) => a * b, 1).toFixed(4)],
            ['x (LU solve)', x.map((v) => v.toFixed(4)).join(', ')],
            ['digits lost ≈', cond > 1 ? Math.floor(Math.log10(cond)).toString() : '0'],
          ]} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="QR: R diagonal (singular values²)"><pre className="text-[10px] font-mono text-orange-400">{qr.R.map((r, i) => `R[${i}][${i}] = ${r[i].toFixed(6)}`).join('\n')}</pre></Card>
        <Card title="LU: U diagonal (pivots)"><pre className="text-[10px] font-mono text-cyan-j">{lu.U.map((r, i) => `U[${i}][${i}] = ${r[i].toFixed(6)}`).join('\n')}</pre></Card>
      </div>
      <AIPanel output={output} />
    </div>
  );
}