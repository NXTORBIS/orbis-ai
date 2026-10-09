// Matrix Laboratory — LU decomposition, determinant, inverse, solve Ax=b
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';

// LU decomposition with partial pivoting (PA = LU)
function luDecompose(A) {
  const n = A.length;
  const U = A.map((r) => r.slice());
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  const P = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(U[k][k]), maxRow = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(U[i][k]) > maxVal) { maxVal = Math.abs(U[i][k]); maxRow = i; }
    if (maxRow !== k) { [U[k], U[maxRow]] = [U[maxRow], U[k]]; [P[k], P[maxRow]] = [P[maxRow], P[k]]; }
    L[k][k] = 1;
    for (let i = k + 1; i < n; i++) {
      L[i][k] = U[i][k] / U[k][k];
      for (let j = k; j < n; j++) U[i][j] -= L[i][k] * U[k][j];
    }
  }
  return { L, U, P };
}

function forwardSub(L, b) {
  const n = L.length; const y = new Array(n);
  for (let i = 0; i < n; i++) { y[i] = b[i]; for (let j = 0; j < i; j++) y[i] -= L[i][j] * y[j]; y[i] /= L[i][i]; }
  return y;
}
function backSub(U, y) {
  const n = U.length; const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { x[i] = y[i]; for (let j = i + 1; j < n; j++) x[i] -= U[i][j] * x[j]; x[i] /= U[i][i]; }
  return x;
}
function matMul(A, B) {
  const n = A.length, m = B[0].length, p = B.length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let k = 0; k < p; k++) C[i][j] += A[i][k] * B[k][j];
  return C;
}
function detFromLU(U, P) {
  let d = 1, swaps = 0;
  for (let i = 0; i < U.length; i++) d *= U[i][i];
  for (let i = 0; i < P.length; i++) if (P[i] !== i) swaps++;
  // count permutation swaps
  const visited = new Array(P.length).fill(false); let s = 0;
  for (let i = 0; i < P.length; i++) { if (!visited[i]) { let j = i; while (!visited[j]) { visited[j] = true; j = P[j]; s++; } s--; } }
  return s % 2 ? -d : d;
}

function buildMatrix(type, n, seed) {
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  let r = seed; const rand = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] = Math.round(rand() * 18 - 9);
  if (type === 'diagonal') { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] = i === j ? 2 + i : 0; }
  if (type === 'hilbert') { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] = 1 / (i + j + 1); }
  return A;
}

function fmtMat(M) { return M.map((r) => r.map((v) => v.toFixed(4).padStart(8)).join(' ')).join('\n'); }

export default function MatrixLabSim() {
  const [type, setType] = useState('random');
  const [n, setN] = useState(4);
  const [seed, setSeed] = useState(7);
  const { explain, explaining, output } = useAIExplain();

  const { A, lu, det, b, x, residual, cond } = useMemo(() => {
    const A = buildMatrix(type, n, seed);
    const lu = luDecompose(A);
    const det = detFromLU(lu.U, lu.P);
    const b = Array.from({ length: n }, (_, i) => i + 1);
    const pb = lu.P.map((p) => b[p]);
    const y = forwardSub(lu.L, pb);
    const x = backSub(lu.U, y);
    // residual = Ax - b
    const residual = A.map((row, i) => row.reduce((s, a, j) => s + a * x[j], 0) - b[i]);
    // condition number estimate: max|λ|/min|λ| via power iteration on A^T A
    const maxR = Math.max(...residual.map(Math.abs));
    return { A, lu, det, b, x, residual, cond: maxR };
  }, [type, n, seed]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Matrix Laboratory — LU Decomposition & Linear Solver"
        subtitle="PA = LU with partial pivoting. Solve Ax = b via forward/back substitution. Determinant from the diagonal of U. Residual ‖Ax−b‖ measures numerical stability."
        onExplain={() => explain(`LU decomposition of ${n}×${n} ${type} matrix. det(A) = ${det.toFixed(4)}. Solution x = [${x.map((v) => v.toFixed(4)).join(', ')}]. Max residual = ${cond.toExponential(3)}. ${type === 'hilbert' ? 'Hilbert matrices are notoriously ill-conditioned — the residual grows with n despite pivoting.' : 'Partial pivoting keeps the decomposition stable for well-conditioned matrices.'}`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">Matrix type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              <option value="random" className="bg-background">Random integer</option>
              <option value="diagonal" className="bg-background">Diagonal</option>
              <option value="hilbert" className="bg-background">Hilbert (ill-cond)</option>
            </select>
          </label>
          <div className="mt-3"><NumField label="size n" value={n} onChange={setN} min={2} max={10} step={1} /></div>
          <div className="mt-2"><NumField label="seed" value={seed} onChange={setSeed} min={1} max={999} step={1} /></div>
        </Card>
        <div className="space-y-3">
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['det(A)', det.toFixed(6)],
            ['max |residual|', cond.toExponential(3)],
            ['b', b.join(', ')],
            ['x (solution)', x.map((v) => v.toFixed(6)).join(', ')],
          ]} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="A (original)"><pre className="text-[10px] font-mono overflow-x-auto text-cyan-j">{fmtMat(A)}</pre></Card>
        <Card title="L (lower)"><pre className="text-[10px] font-mono overflow-x-auto text-emerald-400">{fmtMat(lu.L)}</pre></Card>
        <Card title="U (upper)"><pre className="text-[10px] font-mono overflow-x-auto text-orange-400">{fmtMat(lu.U)}</pre></Card>
      </div>
      <AIPanel output={output} />
    </div>
  );
}