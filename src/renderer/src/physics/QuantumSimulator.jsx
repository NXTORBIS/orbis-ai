import React, { useState, useCallback, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from './ui/router.jsx';
import PageTitle from './ui/PageTitle.jsx';
import ParametersPanel from './quantumsim/ParametersPanel.jsx';
import ComputationPanel from './quantumsim/ComputationPanel.jsx';
import HilbertPanel from './quantumsim/HilbertPanel.jsx';
import MatrixViewer from './quantumsim/MatrixViewer.jsx';
import SpectrumPanel from './quantumsim/SpectrumPanel.jsx';
import ObservablesPanel from './quantumsim/ObservablesPanel.jsx';
import AnalysisPanel from './quantumsim/AnalysisPanel.jsx';
import InfoPanel from './quantumsim/InfoPanel.jsx';
import PresetManager from './quantumsim/PresetManager.jsx';
import { buildSparseH, validateH, localMagnetization, correlations, applyHamiltonian } from './quantum/spinEngine.js';
import { lanczos, denseED } from './quantum/lanczos.js';

const DEFAULT_PARAMS = { N: 10, J: 1, h: 0, periodic: false, solver: 'lanczos', numStates: 5 };

export default function QuantumSimulator() {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [status, setStatus] = useState('idle');
  const [hamiltonian, setHamiltonian] = useState(null);
  const [validation, setValidation] = useState(null);
  const [buildTime, setBuildTime] = useState(null);
  const [result, setResult] = useState(null);
  const [observables, setObservables] = useState(null);
  const [selectedState, setSelectedState] = useState(0);
  const [cached, setCached] = useState(false);
  const cache = useRef(new Map());

  const configKey = JSON.stringify({ N: params.N, J: params.J, h: params.h, periodic: params.periodic, solver: params.solver, numStates: params.numStates });

  const build = useCallback(() => {
    setStatus('building');
    setTimeout(() => {
      const t0 = performance.now();
      const ham = buildSparseH(params);
      const t1 = performance.now();
      setHamiltonian(ham);
      setBuildTime(t1 - t0);
      setStatus('validating');
      setTimeout(() => {
        const val = validateH(ham, params.N);
        setValidation(val);
        setStatus(val.hermitian ? 'idle' : 'failed');
      }, 30);
    }, 30);
  }, [params]);

  const run = useCallback(async () => {
    const cachedHit = cache.current.get(configKey);
    if (cachedHit) {
      setHamiltonian(cachedHit.hamiltonian);
      setValidation(cachedHit.validation);
      setBuildTime(cachedHit.buildTime);
      setResult(cachedHit.result);
      setObservables(cachedHit.observables);
      setSelectedState(0);
      setCached(true);
      setStatus('complete');
      return;
    }
    setCached(false);
    setStatus('building');
    await tick(40);
    const t0 = performance.now();
    const ham = buildSparseH(params);
    const t1 = performance.now();
    setHamiltonian(ham);
    setBuildTime(t1 - t0);
    setStatus('validating');
    await tick(40);
    const val = validateH(ham, params.N);
    setValidation(val);
    if (!val.hermitian) { setStatus('failed'); return; }

    setStatus('solving');
    await tick(40);
    let solveResult;
    try {
      if (params.solver === 'dense' && params.N <= 8) {
        const t2 = performance.now();
        const dense = denseED(params);
        const states = [];
        const k = Math.min(params.numStates, dense.eigenvalues.length);
        for (let j = 0; j < k; j++) states.push(dense.eigenvectors.map((row) => row[j]));
        const residuals = states.map((psi) => residualOf(params, psi, dense.eigenvalues[states.indexOf(psi)]));
        solveResult = {
          eigenvalues: dense.eigenvalues.slice(0, k),
          states,
          residuals,
          solverInfo: { method: 'Dense Exact Diagonalization (Jacobi)', D: dense.D, iters: dense.D, runtime: performance.now() - t2, residual: residuals[0] || 0, converged: true, fullSpectrum: true },
        };
      } else {
        const t2 = performance.now();
        const D = 1 << params.N;
        const apply = (v) => applyHVec(v, params);
        const lanc = lanczos(apply, D, { numStates: params.numStates, maxIter: Math.min(D, 200) });
        solveResult = {
          eigenvalues: lanc.eigenvalues,
          states: lanc.states,
          residuals: lanc.residuals,
          solverInfo: { method: 'Lanczos (sparse iterative)', D, iters: lanc.iters, runtime: performance.now() - t2, residual: lanc.residuals[0] || 0, converged: (lanc.converged[0] !== false) },
        };
      }
    } catch (e) {
      console.error(e);
      setStatus('failed');
      return;
    }
    setResult(solveResult);

    setStatus('observables');
    await tick(40);
    const psi0 = solveResult.states[0];
    const obs = { mag: localMagnetization(psi0, params.N), corr: correlations(psi0, params.N) };
    setObservables(obs);

    cache.current.set(configKey, { hamiltonian: ham, validation: val, buildTime: t1 - t0, result: solveResult, observables: obs });
    setSelectedState(0);
    setStatus('complete');
  }, [params, configKey]);

  const probabilities = result?.states?.[selectedState] ? Array.from(result.states[selectedState]).map((c) => c * c) : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Link to="/studios/physics" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Physics Studio · Quantum Mechanics
      </Link>
      <PageTitle title="Quantum Many-Body Simulator" subtitle="1D Heisenberg spin-½ chain · real exact diagonalization & Lanczos — no AI in the physics" />
      {cached && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-600 dark:text-emerald-400">Cached Result — reusing a previously computed configuration.</div>}

      <div className="mt-4 space-y-4">
        <PresetManager params={params} setParams={setParams} />
        <ParametersPanel params={params} setParams={setParams} onBuild={build} onRun={run} status={status} />
        <ComputationPanel params={params} validation={validation} status={status} buildTime={buildTime} result={result} />
        <div className="grid gap-4 lg:grid-cols-2">
          <HilbertPanel params={params} probabilities={probabilities} />
          <MatrixViewer hamiltonian={hamiltonian} />
        </div>
        <SpectrumPanel result={result} params={params} selectedState={selectedState} setSelectedState={setSelectedState} />
        <ObservablesPanel observables={observables} params={params} />
        <AnalysisPanel params={params} />
        <InfoPanel params={params} result={result} observables={observables} />
      </div>

      <p className="mt-6 text-center text-[10px] text-muted-foreground">
        Every numerical value is computed by a deterministic engine (Heisenberg Hamiltonian construction + Lanczos/Jacobi eigensolver). The AI Explanation button only interprets already-calculated results.
      </p>
    </div>
  );
}

function tick(ms) { return new Promise((r) => setTimeout(r, ms)); }

function applyHVec(v, params) { return applyHamiltonian(v, params); }
function residualOf(params, psi, E) {
  const Hp = applyHamiltonian(psi, params);
  let s = 0;
  for (let i = 0; i < Hp.length; i++) { const d = Hp[i] - E * psi[i]; s += d * d; }
  return Math.sqrt(s);
}