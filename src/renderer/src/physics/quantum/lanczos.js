// ─────────────────────────────────────────────────────────────────────────
// Lanczos eigensolver for real symmetric (sparse) Hamiltonians.
// Full reorthogonalization → robust low-lying eigenvalues, no ghost states.
// Reconstructs Ritz eigenvectors of the original H from the Krylov basis.
// Also provides a dense Jacobi eigensolver for small full-spectrum ED.
// No AI. Pure deterministic numerical linear algebra.
// ─────────────────────────────────────────────────────────────────────────

const norm = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); };
const dotp = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Cyclic Jacobi for a dense symmetric matrix (n×n). Returns sorted eigenvalues + eigenvectors.
export function jacobiDense(Ain, n) {
  const a = Array.from({ length: n }, (_, i) => Float64Array.from(Ain[i]));
  const V = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n); r[i] = 1; return r; });
  for (let sweep = 0; sweep < 80; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-26) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = a[p][p], aqq = a[q][q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const newApp = c * c * app - 2 * s * c * apq + s * s * aqq;
        const newAqq = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p][p] = newApp; a[q][q] = newAqq; a[p][q] = 0; a[q][p] = 0;
        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue;
          const akp = a[k][p], akq = a[k][q];
          const np = c * akp - s * akq;
          const nq = s * akp + c * akq;
          a[k][p] = np; a[p][k] = np;
          a[k][q] = nq; a[q][k] = nq;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const evals = new Float64Array(n);
  for (let i = 0; i < n; i++) evals[i] = a[i][i];
  const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => evals[i] - evals[j]);
  const sortedE = new Float64Array(n);
  const sortedV = Array.from({ length: n }, () => new Float64Array(n));
  for (let j = 0; j < n; j++) {
    const src = idx[j];
    sortedE[j] = evals[src];
    for (let i = 0; i < n; i++) sortedV[i][j] = V[i][src];
  }
  return { eigenvalues: sortedE, eigenvectors: sortedV };
}

// Diagonalize a symmetric tridiagonal matrix (diag d[n], off e[n-1]).
function tridiagEigen(d, e) {
  const n = d.length;
  const A = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n); r[i] = d[i]; if (i < n - 1) { r[i + 1] = e[i]; r[i + 1] = e[i]; } return r; });
  for (let i = 0; i < n - 1; i++) { A[i][i + 1] = e[i]; A[i + 1][i] = e[i]; }
  return jacobiDense(A, n);
}

// Lanczos with full reorthogonalization. Returns the lowest `numStates` Ritz pairs.
// A fixed, adequate iteration count is used and the tridiagonal is diagonalized
// ONCE at the end (diagonalizing inside the loop is O(m³) per check and far too
// slow). Convergence is validated post-hoc via the exact residual ||Hψ−Eψ||.
export function lanczos(applyH, D, { numStates = 1, maxIter } = {}) {
  const cap = Math.min(maxIter || Math.min(D, Math.max(numStates * 4 + 30, 40)), D);
  const v0 = new Float64Array(D);
  for (let i = 0; i < D; i++) v0[i] = Math.random() - 0.5;
  let nrm = norm(v0);
  for (let i = 0; i < D; i++) v0[i] /= nrm;

  const V = [v0];
  const alpha = [];
  const beta = [];
  let w = applyH(v0);
  let a = dotp(v0, w);
  alpha.push(a);
  for (let i = 0; i < D; i++) w[i] -= a * v0[i];
  reorth(w, V);
  let b = norm(w);
  beta.push(b);

  let iter = 1;
  while (iter < cap && b > 1e-13) {
    const vPrev = V[iter - 1];
    const vk = new Float64Array(D);
    for (let i = 0; i < D; i++) vk[i] = w[i] / b;
    V.push(vk);
    w = applyH(vk);
    const aNew = dotp(vk, w);
    alpha.push(aNew);
    for (let i = 0; i < D; i++) w[i] -= aNew * vk[i] + b * vPrev[i];
    reorth(w, V);
    b = norm(w);
    beta.push(b);
    iter++;
  }

  const m = alpha.length;
  const e = beta.slice(0, m - 1);
  const { eigenvalues, eigenvectors } = tridiagEigen(alpha, e);

  const k = Math.min(numStates, m);
  const states = [];
  const residuals = [];
  for (let j = 0; j < k; j++) {
    const psi = new Float64Array(D);
    const ritz = eigenvectors; // [row][col]
    for (let t = 0; t < m; t++) {
      const coef = ritz[t][j];
      if (coef === 0) continue;
      const vt = V[t];
      for (let i = 0; i < D; i++) psi[i] += coef * vt[i];
    }
    // normalize (guard against numerical drift)
    const pn = norm(psi) || 1;
    for (let i = 0; i < D; i++) psi[i] /= pn;
    // residual ||Hψ − Eψ||
    const Hp = applyH(psi);
    let res2 = 0;
    for (let i = 0; i < D; i++) { const d = Hp[i] - eigenvalues[j] * psi[i]; res2 += d * d; }
    states.push(psi);
    residuals.push(Math.sqrt(res2));
  }

  return {
    eigenvalues: Array.from(eigenvalues.slice(0, k)),
    states,
    residuals,
    iters: m,
    converged: residuals.map((r) => r < 1e-6),
  };
}

// Dense exact diagonalization for small systems (build dense H, full Jacobi spectrum).
export function denseED({ N, J, h, periodic }) {
  const D = 1 << N;
  const A = Array.from({ length: D }, () => new Float64Array(D));
  const bonds = [];
  for (let i = 0; i < N - 1; i++) bonds.push([i, i + 1]);
  if (periodic && N >= 3) bonds.push([N - 1, 0]);
  for (let s = 0; s < D; s++) {
    let diag = 0;
    for (const [i, j] of bonds) {
      const bi = (s >> i) & 1, bj = (s >> j) & 1;
      const szi = bi ? 0.5 : -0.5, szj = bj ? 0.5 : -0.5;
      diag += J * szi * szj;
      if (bi !== bj) { const t = s ^ (1 << i) ^ (1 << j); A[s][t] += J * 0.5; }
    }
    if (h !== 0) for (let i = 0; i < N; i++) { const szi = ((s >> i) & 1) ? 0.5 : -0.5; diag += -h * szi; }
    A[s][s] += diag;
  }
  const { eigenvalues, eigenvectors } = jacobiDense(A, D);
  return { eigenvalues: Array.from(eigenvalues), eigenvectors, D, fullSpectrum: true };
}

function reorth(w, V) {
  for (const v of V) {
    const c = dotp(w, v);
    if (c !== 0) for (let i = 0; i < w.length; i++) w[i] -= c * v[i];
  }
}