// Finite Element Method — 1D Poisson equation -u'' = f(x) via hat basis functions
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Solve -u'' = f(x) on [0,1] with u(0)=u(1)=0 using linear hat FEM
function solveFEM(nEl, fFunc) {
  const nNodes = nEl + 1;
  const h = 1 / nEl;
  // Assemble stiffness matrix K and load vector F
  const K = Array.from({ length: nNodes }, () => new Array(nNodes).fill(0));
  const F = new Array(nNodes).fill(0);
  for (let e = 0; e < nEl; e++) {
    const i = e, j = e + 1;
    const xe = e * h, xj = (e + 1) * h;
    // Local stiffness for linear element: (1/h)[[1,-1],[-1,1]]
    K[i][i] += 1 / h; K[j][j] += 1 / h; K[i][j] -= 1 / h; K[j][i] -= 1 / h;
    // Load via trapezoid quadrature: ∫f·φ_i dx ≈ (h/2)(f(xe)+f(xj))/2... use midpoint
    const xm = (xe + xj) / 2;
    F[i] += h / 2 * (fFunc(xe) + fFunc(xm)) / 2 + h / 2 * fFunc(xe) / 2;
    F[j] += h / 2 * (fFunc(xm) + fFunc(xj)) / 2 + h / 2 * fFunc(xj) / 2;
    // Simpler: lumped load F[i] += h/2 * f(xe), F[j] += h/2 * f(xj)
  }
  // Reset F with proper quadrature
  for (let i = 0; i < nNodes; i++) F[i] = 0;
  for (let e = 0; e < nEl; e++) {
    const i = e, j = e + 1;
    const xe = i * h;
    // Trapezoid rule for ∫f·φ_i and ∫f·φ_j over element [xe, xe+h]
    F[i] += h / 2 * fFunc(xe) * 0.5 + h / 2 * fFunc(xe + h) * 0;
    F[j] += h / 2 * fFunc(xe) * 0 + h / 2 * fFunc(xe + h) * 0.5;
    // Better: midpoint for each shape function
    const xm = xe + h / 2;
    F[i] = (F[i] || 0) + h * fFunc(xm) * (1 - (xm - xe) / h) * 0; // reset
  }
  // Clean re-assembly of load vector with 2-pt Gauss per element
  for (let i = 0; i < nNodes; i++) F[i] = 0;
  for (let e = 0; e < nEl; e++) {
    const i = e, j = e + 1;
    const xe = e * h;
    // 2-point Gauss-Legendre on [xe, xe+h] for ∫f·φ dx
    const gps = [[-0.57735026919, 1], [0.57735026919, 1]];
    for (const [gp, w] of gps) {
      const x = xe + h * (gp + 1) / 2;
      const phi_i = 1 - (x - xe) / h;
      const phi_j = (x - xe) / h;
      F[i] += h / 2 * w * fFunc(x) * phi_i;
      F[j] += h / 2 * w * fFunc(x) * phi_j;
    }
  }
  // Apply Dirichlet BC: u(0)=u(1)=0 → remove first and last rows/cols
  // Solve reduced system (nNodes-2 unknowns)
  const nInt = nNodes - 2;
  const Kred = Array.from({ length: nInt }, () => new Array(nInt).fill(0));
  const Fred = new Array(nInt).fill(0);
  for (let i = 0; i < nInt; i++) for (let j = 0; j < nInt; j++) Kred[i][j] = K[i + 1][j + 1];
  for (let i = 0; i < nInt; i++) Fred[i] = F[i + 1];
  // Gaussian elimination
  for (let col = 0; col < nInt; col++) {
    let maxRow = col; let maxVal = Math.abs(Kred[col][col]);
    for (let row = col + 1; row < nInt; row++) if (Math.abs(Kred[row][col]) > maxVal) { maxVal = Math.abs(Kred[row][col]); maxRow = row; }
    [Kred[col], Kred[maxRow]] = [Kred[maxRow], Kred[col]]; [Fred[col], Fred[maxRow]] = [Fred[maxRow], Fred[col]];
    for (let row = col + 1; row < nInt; row++) { const f = Kred[row][col] / Kred[col][col]; for (let k = col; k < nInt; k++) Kred[row][k] -= f * Kred[col][k]; Fred[row] -= f * Fred[col]; }
  }
  const uInt = new Array(nInt);
  for (let i = nInt - 1; i >= 0; i--) { let s = Fred[i]; for (let j = i + 1; j < nInt; j++) s -= Kred[i][j] * uInt[j]; uInt[i] = s / Kred[i][i]; }
  const u = new Array(nNodes).fill(0);
  for (let i = 0; i < nInt; i++) u[i + 1] = uInt[i];
  return { u, nodes: Array.from({ length: nNodes }, (_, i) => i * h) };
}

const SOURCES = {
  'f = 1 (constant load)': { f: (x) => 1, exact: (x) => x * (1 - x) / 2 },
  'f = sin(πx)': { f: (x) => Math.sin(Math.PI * x), exact: (x) => Math.sin(Math.PI * x) / (Math.PI * Math.PI) },
  'f = x': { f: (x) => x, exact: (x) => x * (1 - x * x) / 6 },
  'f = e^x': { f: (x) => Math.exp(x), exact: (x) => -Math.exp(x) + (Math.E - 1) * x + 1 },
};

export default function FiniteElementSim() {
  const [srcKey, setSrcKey] = useState('f = 1 (constant load)');
  const [nEl, setNEl] = useState(10);
  const { explain, explaining, output } = useAIExplain();
  const src = SOURCES[srcKey];

  const { femData, errorData, maxErr } = useMemo(() => {
    const { u, nodes } = solveFEM(nEl, src.f);
    const femData = nodes.map((x, i) => ({ x, fem: u[i], exact: src.exact(x) }));
    // convergence
    const errorData = [];
    for (let ne = 2; ne <= 100; ne += 2) {
      const { u: uu, nodes: nn } = solveFEM(ne, src.f);
      let me = 0;
      for (let i = 0; i <= ne; i++) me = Math.max(me, Math.abs(uu[i] - src.exact(nn[i])));
      errorData.push({ h: 1 / ne, err: me });
    }
    const maxErr = Math.max(...femData.map((d) => Math.abs(d.fem - d.exact)));
    return { femData, errorData, maxErr };
  }, [srcKey, nEl]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Finite Element Method — 1D Poisson −u'' = f(x)"
        subtitle="Linear hat basis functions, Galerkin weak form, Gauss quadrature load assembly, Dirichlet BCs. Convergence is O(h²) for linear elements."
        onExplain={() => explain(`FEM solution of -u''=${srcKey} with ${nEl} elements. Max nodal error = ${maxErr.toExponential(3)}. Linear hat functions give O(h²) convergence — halving the mesh size quarters the error. The weak form ∫u'v' dx = ∫fv dx is equivalent to the strong form but works on any mesh.`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">Source f(x)</span>
            <select value={srcKey} onChange={(e) => setSrcKey(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.keys(SOURCES).map((k) => <option key={k} className="bg-background">{k}</option>)}
            </select>
          </label>
          <div className="mt-3"><NumField label="elements" value={nEl} onChange={setNEl} min={2} max={100} step={2} /></div>
        </Card>
        <div className="space-y-3">
          <SciPlot type="line" data={femData} xKey="x"
            series={[{ key: 'fem', label: 'FEM', color: '#22d3ee' }, { key: 'exact', label: 'exact', color: '#f97316' }]}
            xLabel="x" yLabel="u(x)" height={240} exportName="fem-solution" />
          <SciTable headers={['Metric', 'Value']} rows={[
            ['Elements', nEl], ['Nodes', nEl + 1], ['Max nodal error', maxErr.toExponential(4)],
            ['Element type', 'Linear hat'], ['Convergence', 'O(h²)'],
          ]} />
        </div>
      </div>
      <Card title="Convergence: error vs mesh size h (log-log)">
        <SciPlot type="line" data={errorData} xKey="h" log="log"
          series={[{ key: 'err', label: 'max error', color: '#a855f7' }]}
          xLabel="h = 1/nElements" yLabel="max |error|" height={200} exportName="fem-convergence" />
      </Card>
      <AIPanel output={output} />
    </div>
  );
}