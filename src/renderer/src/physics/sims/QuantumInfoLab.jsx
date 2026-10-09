import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { jacobiEigen } from '../lib/numerics.js';

// Quantum Information research: density matrices, quantum channels (Kraus),
// purity, von Neumann entropy, fidelity, trace distance, Bell-state analysis,
// and state tomography. Real linear algebra on 1–2 qubit systems. No AI.

function matMul(A, B) { const n = A.length, m = B[0].length, k = B.length; const C = Array.from({ length: n }, () => new Array(m).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let p = 0; p < k; p++) C[i][j] += A[i][p] * B[p][j]; return C; }
function matAdj(A) { const n = A.length, m = A[0].length; const C = Array.from({ length: m }, () => new Array(n).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) C[j][i] = A[i][j]; return C; }
const trace = (A) => A.reduce((s, r, i) => s + r[i], 0);
function eigenvalues(A) { return jacobiEigen(A); }
// Recover the statevector from a rank-1 (pure-state) density matrix.
function stateFromRho(rho) { const n = rho.length; const psi = new Array(n); psi[0] = Math.sqrt(Math.max(0, rho[0][0])); for (let i = 1; i < n; i++) psi[i] = psi[0] ? rho[0][i] / psi[0] : 0; return psi; }

function density(psi) { const n = psi.length; const rho = Array.from({ length: n }, () => new Array(n).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rho[i][j] = psi[i] * psi[j]; return rho; }
function purity(rho) { return trace(matMul(rho, rho)); }
function vonNeumann(rho) { const eigs = eigenvalues(rho); let S = 0; for (const e of eigs) if (e > 1e-12) S -= e * Math.log2(e); return S; }
// Uhlmann fidelity. For pure states F = |⟨ψ|φ⟩|² (recovered from the rank-1
// density matrices); falls back to the trace-overlap for mixed states.
function fidelity(rho, sigma) {
  const a = stateFromRho(rho), b = stateFromRho(sigma);
  let dot = 0; for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const fPure = dot * dot;
  if (fPure > 1e-9) return Math.min(1, fPure);
  let tr = 0; for (let i = 0; i < rho.length; i++) for (let j = 0; j < rho.length; j++) tr += rho[i][j] * sigma[j][i];
  return Math.min(1, Math.max(0, tr));
}
function traceDistance(rho, sigma) { const d = rho.map((r, i) => r.map((v, j) => Math.abs(v - sigma[i][j]))); const eigs = eigenvalues(d); return 0.5 * eigs.reduce((s, e) => s + Math.abs(e), 0); }
function applyChannel(rho, kraus) { let acc = null; for (const K of kraus) { const Kd = matAdj(K); const term = matMul(matMul(K, rho), Kd); acc = acc ? acc.map((r, i) => r.map((v, j) => v + term[i][j])) : term; } return acc; }

const PAULI = { X: [[0, 1], [1, 0]], Z: [[1, 0], [0, -1]], I: [[1, 0], [0, 1]] };
function scaleMat(M, s) { return M.map((r) => r.map((v) => v * s)); }
const CHANNELS = {
  bitflip: (p) => [scaleMat(PAULI.I, Math.sqrt(1 - p)), scaleMat(PAULI.X, Math.sqrt(p))],
  dephase: (p) => [scaleMat(PAULI.I, Math.sqrt(1 - p)), scaleMat(PAULI.Z, Math.sqrt(p))],
};

export default function QuantumInfoLab() {
  const [tab, setTab] = useState('density');
  const { explain, explaining, output } = useAIExplain();
  const tabs = [['density', 'Density & Purity'], ['channel', 'Quantum Channels'], ['entropy', 'Von Neumann Entropy'], ['fidelity', 'Fidelity & Trace Distance'], ['bell', 'Bell States'], ['tomo', 'Tomography']];
  return (
    <div className="space-y-4">
      <ResearchHeader title="Quantum Information Research Laboratory" subtitle="Density matrices, quantum channels (Kraus operators), purity, von Neumann entropy, fidelity, trace distance, Bell-state analysis and state tomography. Real linear algebra — no AI in the computation."
        onExplain={() => explain('Quantum information lab: density matrices, channels, entropy, fidelity and tomography computed deterministically.')} explaining={explaining} />
      <div className="flex flex-wrap gap-1.5">{tabs.map(([id, n]) => <button key={id} onClick={() => setTab(id)} className={`rounded-full px-3 py-1.5 text-xs ${tab === id ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{n}</button>)}</div>
      {tab === 'density' && <DensityPanel />}
      {tab === 'channel' && <ChannelPanel />}
      {tab === 'entropy' && <EntropyPanel />}
      {tab === 'fidelity' && <FidelityPanel />}
      {tab === 'bell' && <BellPanel />}
      {tab === 'tomo' && <TomoPanel />}
      <AIPanel output={output} />
    </div>
  );
}

function DensityPanel() {
  const [a, setA] = useState(0.7); const [b, setB] = useState(0.071);
  const psi = [a, b]; const norm = Math.hypot(a, b); const pn = [a / norm, b / norm];
  const rho = density(pn); const pur = purity(rho);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="State |ψ⟩ = a|0⟩ + b|1⟩">
        <NumField label="a" value={a} onChange={setA} min={-1} max={1} step={0.01} />
        <div className="mt-2"><NumField label="b" value={b} onChange={setB} min={-1} max={1} step={0.01} /></div>
        <div className="mt-3 text-xs text-muted-foreground">Normalised: |ψ⟩ = {(a / norm).toFixed(3)}|0⟩ + {(b / norm).toFixed(3)}|1⟩</div>
      </Card>
      <Card title="Density Matrix ρ = |ψ⟩⟨ψ| & Purity">
        <SciTable headers={['', '|0⟩', '|1⟩']} rows={rho.map((r, i) => [`⟨${i}|`, r[0].toFixed(3), r[1].toFixed(3)])} />
        <div className="mt-2 rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-2.5"><span className="text-xs text-muted-foreground">Tr(ρ) = </span><span className="font-mono">{trace(rho).toFixed(4)}</span><span className="ml-3 text-xs text-muted-foreground">Purity Tr(ρ²) = </span><span className="font-mono text-cyan-j">{pur.toFixed(4)}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">Purity = 1 for a pure state, &lt; 1 for mixed. Verify Tr(ρ)=1.</p>
      </Card>
    </div>
  );
}
function ChannelPanel() {
  const [p, setP] = useState(0.1); const [ch, setCh] = useState('bitflip');
  const rho0 = density([1, 0]); const rho = applyChannel(rho0, CHANNELS[ch](p));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Channel"><select value={ch} onChange={(e) => setCh(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">{['bitflip', 'dephase'].map((c) => <option key={c} className="bg-background">{c}</option>)}</select>
        <div className="mt-2"><NumField label="probability p" value={p} onChange={setP} min={0} max={1} step={0.01} /></div>
        <p className="mt-2 text-xs text-muted-foreground">ρ' = Σ Kₖ ρ Kₖ†. Bit-flip: (1−p)ρ + p XρX. Dephasing: (1−p)ρ + p ZρZ.</p></Card>
      <Card title="Output ρ'"><SciTable headers={['', '|0⟩', '|1⟩']} rows={rho.map((r, i) => [`⟨${i}|`, r[0].toFixed(3), r[1].toFixed(3)])} />
        <div className="mt-2 text-xs text-muted-foreground">Purity after channel: <span className="font-mono text-cyan-j">{purity(rho).toFixed(4)}</span> (decreases — the channel mixes the state).</div></Card>
    </div>
  );
}
function EntropyPanel() {
  const [p, setP] = useState(0.3);
  const rho = [[1 - p, 0], [0, p]]; const S = vonNeumann(rho);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Mixed state ρ = diag(1−p, p)"><NumField label="p" value={p} onChange={setP} min={0} max={1} step={0.01} /></Card>
      <Card title="Von Neumann Entropy"><div className="rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3"><div className="font-mono text-2xl text-cyan-j">S = {S.toFixed(4)} bits</div></div>
        <p className="mt-2 text-xs text-muted-foreground">S = −Tr(ρ log₂ ρ). Maximum (1 bit) at p=½ (maximally mixed); zero for a pure state (p=0 or 1).</p></Card>
    </div>
  );
}
function FidelityPanel() {
  const rho = density([1, 0]); const sigma = density([Math.SQRT1_2, Math.SQRT1_2]);
  return (
    <Card title="Fidelity & Trace Distance">
      <SciTable headers={['States', 'Fidelity F', 'Trace Distance D']} rows={[
        ['|0⟩ vs |0⟩', fidelity(rho, rho).toFixed(4), traceDistance(rho, rho).toFixed(4)],
        ['|0⟩ vs |+⟩', fidelity(rho, sigma).toFixed(4), traceDistance(rho, sigma).toFixed(4)],
        ['|0⟩ vs |1⟩', fidelity(density([1, 0]), density([0, 1])).toFixed(4), traceDistance(density([1, 0]), density([0, 1])).toFixed(4)],
      ]} />
      <p className="mt-2 text-xs text-muted-foreground">Fidelity F(ρ,σ)=Tr√(√ρ σ √ρ), 0 ≤ F ≤ 1. Trace distance D=½‖ρ−σ‖₁. Orthogonal states: F=0, D=1.</p>
    </Card>
  );
}
function BellPanel() {
  const bells = [
    ['|Φ⁺⟩', [1 / 2, 0, 0, 1 / 2]], ['|Φ⁻⟩', [1 / 2, 0, 0, -1 / 2]],
    ['|Ψ⁺⟩', [0, 1 / 2, 1 / 2, 0]], ['|Ψ⁻⟩', [0, 1 / 2, -1 / 2, 0]],
  ];
  return (
    <Card title="Bell States (maximally entangled 2-qubit)">
      <SciTable headers={['State', '|00⟩', '|01⟩', '|10⟩', '|11⟩', 'Purity', 'Entropy']} rows={bells.map(([n, v]) => { const r = density(v); return [n, v[0].toFixed(3), v[1].toFixed(3), v[2].toFixed(3), v[3].toFixed(3), purity(r).toFixed(3), vonNeumann(r).toFixed(3)]; })} />
      <p className="mt-2 text-xs text-muted-foreground">Each Bell state is pure (Tr(ρ²)=1) globally, yet each qubit alone is maximally mixed (entropy 1 bit) — the signature of entanglement.</p>
    </Card>
  );
}
function TomoPanel() {
  const [rx, setRx] = useState(0.6); const [ry, setRy] = useState(0); const [rz, setRz] = useState(0.2);
  const rhoR = [[(1 + rz) / 2, rx / 2], [rx / 2, (1 - rz) / 2]];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Measured expectations"><NumField label="⟨X⟩" value={rx} onChange={setRx} min={-1} max={1} step={0.05} /><div className="mt-2"><NumField label="⟨Y⟩" value={ry} onChange={setRy} min={-1} max={1} step={0.05} /></div><div className="mt-2"><NumField label="⟨Z⟩" value={rz} onChange={setRz} min={-1} max={1} step={0.05} /></div></Card>
      <Card title="Reconstructed ρ = ½(I + r⃗·σ⃗)"><SciTable headers={['', '|0⟩', '|1⟩']} rows={rhoR.map((r, i) => [`⟨${i}|`, r[0].toFixed(3), r[1].toFixed(3)])} />
        <div className="mt-2 text-xs text-muted-foreground">Purity: <span className="font-mono text-cyan-j">{purity(rhoR).toFixed(4)}</span> · Bloch vector |r⃗| = <span className="font-mono">{Math.hypot(rx, ry, rz).toFixed(3)}</span> (1 = pure).</div></Card>
    </div>
  );
}