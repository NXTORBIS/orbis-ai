import React, { useState, useMemo } from 'react';
import { buildSparseH, applyHamiltonian } from '../quantum/spinEngine.js';
import { lanczos } from '../quantum/lanczos.js';
import { jacobiEigen } from '../lib/numerics.js';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Loader2 } from 'lucide-react';

// Quantum Many-Body Research: ground-state entanglement entropy S_A of the
// 1D Heisenberg chain, computed by exact diagonalisation + Schmidt decomposition
// of the bipartition, plus finite-size scaling of the energy gap.

function groundState(N, J, h) {
  const params = { N, J, h, periodic: false };
  const D = 1 << N;
  const apply = (v) => applyHamiltonian(v, params);
  const lanc = lanczos(apply, D, { numStates: 1, maxIter: Math.min(D, 120) });
  return { psi: lanc.states[0], E0: lanc.eigenvalues[0], D };
}

// Entanglement entropy of subsystem A (first nA sites) for state psi (length 2^N).
function entanglementEntropy(psi, N, nA) {
  const nB = N - nA; const dA = 1 << nA, dB = 1 << nB;
  // reshape psi into dA x dB matrix M; singular values of M = sqrt(eig(M M†))
  const M = Array.from({ length: dA }, () => new Array(dB).fill(0));
  for (let i = 0; i < psi.length; i++) { const a = i >> nB, b = i & (dB - 1); M[a][b] = psi[i]; }
  const MMT = Array.from({ length: dA }, () => new Array(dA).fill(0));
  for (let i = 0; i < dA; i++) for (let j = 0; j < dA; j++) { let s = 0; for (let k = 0; k < dB; k++) s += M[i][k] * M[j][k]; MMT[i][j] = s; }
  const eigs = jacobiEigen(MMT);
  let S = 0; for (const e of eigs) { const sv = Math.max(0, e); if (sv > 1e-12) S -= sv * Math.log2(sv); }
  return S;
}

export default function QuantumManyBodyResearch() {
  const [N, setN] = useState(10); const [h, setH] = useState(0);
  const [running, setRunning] = useState(false);
  const [entropyData, setEntropyData] = useState([]);
  const [scalingData, setScalingData] = useState([]);
  const { explain, explaining, output } = useAIExplain();

  const compute = async () => {
    setRunning(true); setEntropyData([]); setScalingData([]);
    await new Promise((r) => setTimeout(r, 50));
    try {
      // entanglement profile for current N
      const { psi, E0 } = groundState(N, 1, h);
      const ed = []; for (let nA = 1; nA <= Math.floor(N / 2); nA++) ed.push({ nA, S: entanglementEntropy(psi, N, nA) }); setEntropyData(ed);
      // finite-size scaling of the gap Δ = E1 - E0
      const sd = [];
      for (let n = 6; n <= Math.min(14, N); n += 2) {
        const g = groundState(n, 1, h); const apply = (v) => applyHamiltonian({ N: n, J: 1, h, periodic: false }, v);
        // E1 via Lanczos with 2 states
        const l2 = lanczos((v) => applyHamiltonian(v, { N: n, J: 1, h, periodic: false }), 1 << n, { numStates: 2, maxIter: Math.min(1 << n, 120) });
        sd.push({ N: n, E0: g.E0, gap: l2.eigenvalues[1] - l2.eigenvalues[0] });
      }
      setScalingData(sd);
    } catch (e) { console.error(e); } finally { setRunning(false); }
  };

  return (
    <div className="space-y-4">
      <ResearchHeader title="Quantum Many-Body Research Laboratory" subtitle="Ground-state entanglement entropy S_A = −Tr(ρ_A ln ρ_A) of the 1D Heisenberg chain via exact diagonalisation + Schmidt decomposition, and finite-size scaling of the excitation gap. DMRG / tensor networks / QMC are NOT implemented here."
        onExplain={() => explain(`Many-body research: N=${N}, h=${h}. Entanglement entropy profile and gap scaling computed by Lanczos exact diagonalisation.`)} explaining={explaining} />
      <Card title="Parameters">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumField label="Chain length N" value={N} onChange={setN} min={6} max={14} step={2} />
          <NumField label="Field h" value={h} onChange={setH} min={0} max={3} step={0.1} />
          <div className="flex items-end"><button onClick={compute} disabled={running} className="rounded-md bg-cyan-j px-4 py-1.5 text-sm text-background">{running ? 'Computing…' : 'Compute'}</button></div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Lanczos exact diagonalisation (sparse). N≤14 keeps the Hilbert space (2^N) tractable in-browser.</p>
      </Card>
      {running && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Diagonalising Hamiltonian…</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Entanglement Entropy S_A vs subsystem size">
          <SciPlot type="line" data={entropyData} xKey="nA" series={[{ key: 'S', label: 'S_A (bits)', color: '#22d3ee' }]} xLabel="n_A (sites)" yLabel="S_A" height={220} exportName="entanglement" />
          <p className="mt-1 text-xs text-muted-foreground">For the critical Heisenberg chain (h=0), S_A grows logarithmically with n_A — a signature of the conformal critical point.</p>
        </Card>
        <Card title="Finite-Size Scaling (energy gap)">
          <SciPlot type="line" data={scalingData} xKey="N" series={[{ key: 'gap', label: 'Δ = E₁−E₀', color: '#f97316' }]} xLabel="N" yLabel="gap" height={220} exportName="gap-scaling" />
          <p className="mt-1 text-xs text-muted-foreground">A gap closing as 1/N signals a critical (gapless) phase; a finite gap signals a gapped phase.</p>
        </Card>
      </div>
      <AIPanel output={output} />
    </div>
  );
}