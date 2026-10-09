import React, { useState } from 'react';
import { Download, Code2, Sparkles, BookOpen, Copy, Check } from 'lucide-react';
import Section from './Section';
import { base44 } from '../api/base44Client.js';

export default function InfoPanel({ params, result, observables }) {
  return (
    <div className="space-y-4">
      <ExportPanel params={params} result={result} observables={observables} />
      <CodeViewerPanel />
      <DmrgPanel />
      <AIExplanationPanel params={params} result={result} observables={observables} />
    </div>
  );
}

function download(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function ExportPanel({ params, result, observables }) {
  const [copied, setCopied] = useState(false);
  if (!result) {
    return (
      <Section title="Export & Reproducibility" icon={Download}>
        <p className="text-xs text-muted-foreground">Run a simulation to export results.</p>
      </Section>
    );
  }
  const config = { model: '1D Heisenberg spin-1/2 chain', ...params, timestamp: new Date().toISOString(), solver: result.solverInfo };
  const spectrum = result.eigenvalues.map((e, i) => ({ n: i, E: e }));
  const mag = observables?.mag;

  const csv = [
    '# Quantum Many-Body Simulator — Configuration',
    'model,1D Heisenberg spin-1/2 chain',
    `N,${params.N}`, `J,${params.J}`, `h,${params.h}`, `periodic,${params.periodic}`, `solver,${result.solverInfo.method}`,
    '', '# Energy spectrum', 'n,E',
    ...spectrum.map((s) => `${s.n},${s.E}`),
    '', '# Local magnetization', 'site,Sx,Sy,Sz',
    ...(mag ? mag.sz.map((_, i) => `${i},${mag.sx[i]},${mag.sy[i]},${mag.sz[i]}`) : []),
  ].join('\n');

  const json = JSON.stringify({
    config,
    spectrum,
    magnetization: mag && { sx: mag.sx, sy: mag.sy, sz: mag.sz },
    correlations: observables?.corr && { Ciso: observables.corr.Ciso.map((r) => Array.from(r)) },
    groundState: { E0: result.eigenvalues[0], gap: (result.eigenvalues[1] ?? result.eigenvalues[0]) - result.eigenvalues[0], residual: result.residuals[0] },
  }, null, 2);

  const py = [
    '# Reproducible Python script — 1D Heisenberg spin-1/2 chain',
    'import numpy as np',
    `N, J, h, periodic = ${params.N}, ${params.J}, ${params.h}, ${params.periodic}`,
    'D = 2**N',
    'H = np.zeros((D, D))',
    'for s in range(D):',
    '    diag = 0.0',
    '    for i in range(N - 1):',
    '        bi, bj = (s >> i) & 1, (s >> (i+1)) & 1',
    '        szi, szj = 0.5 if bi else -0.5, 0.5 if bj else -0.5',
    '        diag += J * szi * szj',
    '        if bi != bj: H[s, s ^ (1<<i) ^ (1<<(i+1))] += J * 0.5',
    '    for i in range(N): diag += -h * (0.5 if ((s>>i)&1) else -0.5)',
    '    H[s, s] += diag',
    'vals = np.linalg.eigvalsh(H)',
    'print("E0 =", vals[0], "gap =", vals[1]-vals[0])',
  ].join('\n');

  const copyConfig = () => { navigator.clipboard?.writeText(JSON.stringify(config, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const copyBtn = (
    <button onClick={copyConfig} className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-2 py-1 text-[11px] hover:bg-accent">
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />} Copy config
    </button>
  );

  return (
    <Section title="Export & Reproducibility" icon={Download} right={copyBtn}>
      <div className="flex flex-wrap gap-2">
        <ExpBtn onClick={() => download('quantum_spectrum.csv', csv, 'text/csv')}>CSV (spectrum + mag)</ExpBtn>
        <ExpBtn onClick={() => download('quantum_results.json', json, 'application/json')}>JSON (full results)</ExpBtn>
        <ExpBtn onClick={() => download('heisenberg_solve.py', py, 'text/x-python')}>Python (reproducible)</ExpBtn>
      </div>
      <pre className="mt-3 max-h-32 overflow-auto rounded-lg border border-border/40 bg-secondary/40 p-2 text-[10px] font-mono">{JSON.stringify(config, null, 2)}</pre>
    </Section>
  );
}

function CodeViewerPanel() {
  const [open, setOpen] = useState(false);
  const btn = <button onClick={() => setOpen((o) => !o)} className="text-[11px] text-cyan-j">{open ? 'Hide code' : 'View code'}</button>;
  return (
    <Section title="Numerical Implementation" icon={Code2} right={btn}>
      {open ? (
        <pre className="max-h-96 overflow-auto rounded-lg border border-border/40 bg-secondary/40 p-3 text-[10px] leading-relaxed font-mono">{IMPL_CODE}</pre>
      ) : (
        <p className="text-xs text-muted-foreground">The actual computational code used to construct operators, build the Hamiltonian, run Lanczos, and compute observables. Click "View code" to inspect.</p>
      )}
    </Section>
  );
}

function DmrgPanel() {
  return (
    <Section title="DMRG" icon={BookOpen}>
      <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p><strong className="text-foreground">Why exact diagonalization is limited.</strong> The Hilbert-space dimension grows as dim(ℋ) = 2^N. Storing the full Hamiltonian densely needs 2^(2N) numbers — already 1024×1024 for N=10 and ~10^12 entries for N=20 — so exact diagonalization scales exponentially and is only feasible for small chains.</p>
        <p><strong className="text-foreground">What DMRG does.</strong> The Density Matrix Renormalization Group represents the many-body state as a Matrix Product State (MPS), which captures the area-law entanglement of 1D gapped ground states with a bond dimension far smaller than 2^N. This makes DMRG extraordinarily accurate and efficient for one-dimensional quantum systems, reaching hundreds or thousands of sites.</p>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">⚠ Conceptual Method — Not Currently Executed. This simulator performs real exact diagonalization / Lanczos only; no DMRG calculation is run here.</div>
      </div>
    </Section>
  );
}

function AIExplanationPanel({ params, result, observables }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const explain = async () => {
    if (!result) { setErr('Run the simulation first.'); return; }
    setOpen(true); setLoading(true); setErr(''); setText('');
    const ctx = {
      model: '1D Heisenberg spin-1/2 chain',
      N: params.N, J: params.J, h: params.h, periodic: params.periodic,
      hilbertDimension: 1 << params.N,
      groundStateEnergy: result.eigenvalues[0],
      energyGap: (result.eigenvalues[1] ?? result.eigenvalues[0]) - result.eigenvalues[0],
      solver: result.solverInfo,
      magnetization: observables?.mag && { Sztot: observables.mag.sz.reduce((a, b) => a + b, 0) },
    };
    const prompt = 'You are a physics educator. Explain the following ALREADY-CALCULATED results from a 1D Heisenberg spin-1/2 chain exact-diagonalization simulation. Do NOT perform any new numerical calculations or invent values; only interpret the numbers provided. Cover: (1) what the system and Hamiltonian represent, (2) what the ground-state energy and energy gap mean, (3) what the magnetization indicates, (4) what the correlations imply, (5) the physical effect of the current J and h. Keep it concise (under 250 words), clear, and scientifically accurate.\n\nCalculated results (JSON):\n' + JSON.stringify(ctx, null, 2);
    try {
      const res = await base44.integrations.Core.InvokeLLM({ prompt });
      setText(typeof res === 'string' ? res : res?.content || JSON.stringify(res));
    } catch (e) {
      setErr('AI explanation unavailable — ' + (e?.message || 'integration error') + '. The numerical results above remain valid; this only affects the optional explanation.');
    } finally {
      setLoading(false);
    }
  };

  const btn = (
    <button onClick={explain} disabled={!result} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/40 bg-cyan-j/10 px-3 py-1.5 text-xs font-medium text-cyan-j hover:bg-cyan-j/20 disabled:opacity-40">
      <Sparkles className="h-3.5 w-3.5" /> AI Explanation
    </button>
  );

  return (
    <Section title="AI Explanation" icon={Sparkles} right={btn}>
      {!result ? (
        <p className="text-xs text-muted-foreground">Run the simulation first. This optional button only interprets already-calculated results — it never performs calculations.</p>
      ) : open ? (
        <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
          {loading && <p className="text-xs text-cyan-j">Generating explanation…</p>}
          {err && <p className="text-xs text-amber-500">{err}</p>}
          {text && <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{text}</div>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Generates a plain-language interpretation of the calculated ground-state energy, gap, magnetization and correlations. The numerical engine remains the sole source of scientific results.</p>
      )}
    </Section>
  );
}

function ExpBtn({ onClick, children }) {
  return <button onClick={onClick} className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs hover:bg-accent">{children}</button>;
}

const IMPL_CODE = [
  '// Spin-1/2 operators (Pauli matrices / 2)',
  'Sx = [[0,0.5],[0.5,0]], Sy = [[0,-0.5i],[0.5i,0]], Sz = [[0.5,0],[0,-0.5]]',
  '// Many-body operator at site i: I ⊗ ... ⊗ S^a ⊗ ... ⊗ I  (Kronecker product)',
  '',
  '// Hamiltonian in the Sz computational basis (real & symmetric):',
  '//   H = J Σ_<ij> (SxSx + SySy + SzSz) − h Σ_i Sz_i',
  '//   SzSz  -> diagonal  J·(±1/2)(±1/2)',
  '//   SxSx+SySy = ½(S+S− + S−S+) -> off-diagonal flip-flop, coeff J/2',
  'function applyHamiltonian(v, {N,J,h,periodic}) {',
  '  const D = 1<<N, w = new Float64Array(D);',
  '  for (let s=0; s<D; s++) {',
  '    let diag = 0;',
  '    for (const [i,j] of bonds) {',
  '      const szi = ((s>>i)&1)?0.5:-0.5, szj = ((s>>j)&1)?0.5:-0.5;',
  '      diag += J*szi*szj;                 // SzSz diagonal',
  '      if (((s>>i)&1) !== ((s>>j)&1))    // flip-flop',
  '        w[s ^ (1<<i) ^ (1<<j)] += J*0.5 * v[s];',
  '    }',
  '    for (let i=0;i<N;i++) diag += -h*(((s>>i)&1)?0.5:-0.5);',
  '    w[s] += diag * v[s];',
  '  }',
  '  return w;',
  '}',
  '',
  '// Lanczos with full reorthogonalization -> lowest eigenvalues + ground state.',
  '// Builds Krylov basis V and tridiagonal T (alpha, beta); diagonalizes T via',
  '// Jacobi, reconstructs ψ = Σ Ritz_k · V[k]; residual ||Hψ − Eψ|| validates it.',
  '',
  '// Observables from ground-state coefficients c_k:',
  '//   ⟨Sz_i⟩ = Σ_s |c_s|²·(±1/2)',
  '//   ⟨Sx_i⟩ = ½ Σ_s c_s·c_{s⊕(1<<i)}',
  '//   C^a_ij = ⟨ψ|S^a_i S^a_j|ψ⟩  (dot products of single-spin operator images)',
].join('\n');