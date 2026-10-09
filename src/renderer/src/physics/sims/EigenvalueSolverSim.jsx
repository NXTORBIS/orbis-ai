// Eigenvalue Solver — Jacobi (all) vs power iteration (largest) on symmetric matrices
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { jacobiEigen, powerIteration } from '../lib/numerics.js';

// Build a symmetric matrix from a compact description
function buildMatrix(type, n, seed) {
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  let r = seed;
  const rand = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
  if (type === 'tridiag') {
    for (let i = 0; i < n; i++) { A[i][i] = 2; if (i > 0) A[i][i - 1] = A[i - 1][i] = -1; }
  } else if (type === 'random') {
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { const v = rand() * 2 - 1; A[i][j] = A[j][i] = v; }
  } else if (type === 'wilkinson') {
    for (let i = 0; i < n; i++) { A[i][i] = Math.abs(i - (n - 1) / 2); if (i > 0) A[i][i - 1] = A[i - 1][i] = 1; }
  }
  return A;
}

export default function EigenvalueSolverSim() {
  const [matrixType, setMatrixType] = useState('tridiag');
  const [n, setN] = useState(6);
  const [seed, setSeed] = useState(42);
  const { explain, explaining, output } = useAIExplain();

  const { eigs, power, convergence } = useMemo(() => {
    const A = buildMatrix(matrixType, n, seed);
    const eigs = jacobiEigen(A);
    // power iteration with convergence tracking
    let v = new Array(n).fill(1);
    const conv = [];
    let lambda = 0;
    for (let it = 0; it < 200; it++) {
      const Av = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Av[i] += A[i][j] * v[j];
      let norm = 0; for (let i = 0; i < n; i++) norm += Av[i] * Av[i]; norm = Math.sqrt(norm);
      v = Av.map((x) => x / norm);
      let lam = 0; for (let i = 0; i < n; i++) lam += v[i] * Av[i];
      conv.push({ it, lambda: lam, err: Math.abs(lam - lambda) });
      if (Math.abs(lam - lambda) < 1e-12) { lambda = lam; break; }
      lambda = lam;
    }
    const power = { eigenvalue: lambda, iterations: conv.length };
    return { eigs, power, convergence: conv };
  }, [matrixType, n, seed]);

  const exactTridiag = matrixType === 'tridiag'
    ? Array.from({ length: n }, (_, k) => 2 - 2 * Math.cos((Math.PI * (k + 1)) / (n + 1))).sort((a, b) => a - b)
    : null;

  return (
    <div className="space-y-4">
      <ResearchHeader title="Eigenvalue Solver — Jacobi vs Power Iteration"
        subtitle="Jacobi rotations find the full spectrum of a real symmetric matrix. Power iteration converges to the dominant eigenvalue. Compare convergence and accuracy."
        onExplain={() => explain(`Eigenvalue analysis of ${matrixType} ${n}×${n} matrix. Jacobi found ${eigs.length} eigenvalues: [${eigs.map((e) => e.toFixed(4)).join(', ')}]. Power iteration converged to λ_max=${power.eigenvalue.toFixed(6)} in ${power.iterations} iterations. ${exactTridiag ? `For tridiagonal matrices the exact eigenvalues are 2−2cos(kπ/(n+1)).` : ''}`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">Matrix type</span>
            <select value={matrixType} onChange={(e) => setMatrixType(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              <option value="tridiag" className="bg-background">Tridiagonal (−1,2,−1)</option>
              <option value="random" className="bg-background">Random symmetric</option>
              <option value="wilkinson" className="bg-background">Wilkinson</option>
            </select>
          </label>
          <div className="mt-3"><NumField label="size n" value={n} onChange={setN} min={3} max={20} step={1} /></div>
          {matrixType === 'random' && <div className="mt-2"><NumField label="seed" value={seed} onChange={setSeed} min={1} max={999} step={1} /></div>}
        </Card>
        <div className="space-y-3">
          <SciTable headers={['#', 'Jacobi λ', 'Exact (tridiag)']} rows={eigs.map((e, i) => [i + 1, e.toFixed(8), exactTridiag ? exactTridiag[i].toFixed(8) : '—'])} />
          <SciTable headers={['Method', 'λ_max', 'Iters', 'Cost']} rows={[
            ['Jacobi (all)', eigs[eigs.length - 1].toFixed(8), '—', 'O(n³) sweeps'],
            ['Power iteration', power.eigenvalue.toFixed(8), power.iterations, 'O(n²)/iter'],
          ]} />
        </div>
      </div>
      <Card title="Power iteration convergence">
        <SciPlot type="line" data={convergence} xKey="it" log="semi-logy"
          series={[{ key: 'err', label: '|Δλ|', color: '#22d3ee' }]}
          xLabel="iteration" yLabel="|λₙ − λₙ₋₁|" height={200} exportName="power-conv" />
      </Card>
      <AIPanel output={output} />
    </div>
  );
}