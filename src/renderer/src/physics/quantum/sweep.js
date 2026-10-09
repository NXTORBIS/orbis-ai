// ─────────────────────────────────────────────────────────────────────────
// Parameter sweep runner — controlled, cancellable, progress-reporting.
// For each parameter value: build Hamiltonian, solve (Lanczos), compute
// observables, store results. No AI. Reuses the deterministic engine.
// ─────────────────────────────────────────────────────────────────────────
import { applyHamiltonian, localMagnetization } from './spinEngine';
import { lanczos } from './lanczos';

export function runSweep(base, sweepCfg, onProgress) {
  // base: { N, J, h, periodic, numStates }
  // sweepCfg: { param: 'h'|'J', start, end, steps }
  const { param, start, end, steps } = sweepCfg;
  const n = Math.max(2, Math.floor(steps));
  const token = { cancelled: false };
  const results = [];

  const task = async () => {
    for (let i = 0; i < n; i++) {
      if (token.cancelled) {
        onProgress({ done: i, total: n, results, cancelled: true });
        return { results, cancelled: true, completed: i };
      }
      const val = start + (end - start) * (i / (n - 1));
      const params = { ...base, [param]: val };
      const D = 1 << base.N;
      const apply = (v) => applyHamiltonian(v, params);
      const { eigenvalues, states, residuals } = lanczos(apply, D, { numStates: Math.max(2, base.numStates), maxIter: Math.min(D, 120) });
      const E0 = eigenvalues[0];
      const E1 = eigenvalues[1] ?? eigenvalues[0];
      const gap = E1 - E0;
      const psi = states[0];
      const mag = psi ? localMagnetization(psi, base.N) : { sx: [], sy: [], sz: [] };
      const Mz = psi ? mag.sz.reduce((a, b) => a + Math.abs(b), 0) / base.N : 0;
      results.push({ [param]: val, E0, gap, Mz, residual: residuals[0] });
      onProgress({ done: i + 1, total: n, results, cancelled: false });
      // yield to the event loop so the UI stays responsive
      await new Promise((r) => setTimeout(r, 0));
    }
    return { results, cancelled: false, completed: n };
  };

  return { promise: task(), cancel: () => { token.cancelled = true; } };
}