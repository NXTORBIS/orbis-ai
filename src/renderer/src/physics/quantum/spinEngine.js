// ─────────────────────────────────────────────────────────────────────────
// Quantum Many-Body Engine — 1D Heisenberg Spin-1/2 Chain
// Real numerical linear algebra. No AI. No fabricated data.
//
// Computational basis: |s> where s is an integer 0..2^N-1.
// Bit i (LSB = site 0) encodes the spin at site i: 1 = |↑>, 0 = |↓>.
// Sz_i |s> = (±1/2) |s>  (diagonal). Sx,Sy flip single spins (off-diagonal).
//
// Hamiltonian: H = J Σ_<ij> (SxSx + SySy + SzSz) − h Σ_i Sz_i
// In the Sz basis the Heisenberg term splits into:
//   • SzSz  → diagonal, J·(±1/2)(±1/2)
//   • SxSx+SySy = ½(S+S− + S−S+) → off-diagonal "flip-flop", coefficient J/2
//   • field  → diagonal, −h·(±1/2)
// The full matrix is therefore REAL and symmetric in this basis.
// ─────────────────────────────────────────────────────────────────────────

export const hilbertDim = (N) => 1 << N;

export function bondsFor(N, periodic) {
  const b = [];
  for (let i = 0; i < N - 1; i++) b.push([i, i + 1]);
  if (periodic && N >= 3) b.push([N - 1, 0]);
  return b;
}

// Apply H to a real vector v (Float64Array, length D). Returns new Float64Array.
export function applyHamiltonian(v, { N, J, h, periodic }) {
  const D = 1 << N;
  const w = new Float64Array(D);
  const bonds = bondsFor(N, periodic);
  for (let s = 0; s < D; s++) {
    let diag = 0;
    for (const [i, j] of bonds) {
      const bi = (s >> i) & 1;
      const bj = (s >> j) & 1;
      const szi = bi ? 0.5 : -0.5;
      const szj = bj ? 0.5 : -0.5;
      diag += J * szi * szj;
      if (bi !== bj) {
        const t = s ^ (1 << i) ^ (1 << j);
        w[t] += J * 0.5 * v[s];
      }
    }
    if (h !== 0) {
      for (let i = 0; i < N; i++) {
        const szi = ((s >> i) & 1) ? 0.5 : -0.5;
        diag += -h * szi;
      }
    }
    w[s] += diag * v[s];
  }
  return w;
}

// Build a sparse representation {D, rows, cols, vals, nnz} for inspection.
export function buildSparseH({ N, J, h, periodic }) {
  const D = 1 << N;
  const map = new Map();
  const add = (i, j, val) => {
    const k = i * D + j;
    map.set(k, (map.get(k) || 0) + val);
  };
  const bonds = bondsFor(N, periodic);
  for (let s = 0; s < D; s++) {
    let diag = 0;
    for (const [i, j] of bonds) {
      const bi = (s >> i) & 1;
      const bj = (s >> j) & 1;
      const szi = bi ? 0.5 : -0.5;
      const szj = bj ? 0.5 : -0.5;
      diag += J * szi * szj;
      if (bi !== bj) {
        const t = s ^ (1 << i) ^ (1 << j);
        add(s, t, J * 0.5);
      }
    }
    if (h !== 0) {
      for (let i = 0; i < N; i++) {
        const szi = ((s >> i) & 1) ? 0.5 : -0.5;
        diag += -h * szi;
      }
    }
    add(s, s, diag);
  }
  const rows = [];
  const cols = [];
  const vals = [];
  for (const [k, v] of map) {
    rows.push(Math.floor(k / D));
    cols.push(k % D);
    vals.push(v);
  }
  return { D, rows, cols, vals, nnz: rows.length };
}

// Validate dimension + Hermiticity (real symmetry) of a sparse Hamiltonian.
export function validateH(ham, N) {
  const D = 1 << N;
  const map = new Map();
  for (let k = 0; k < ham.rows.length; k++) map.set(ham.rows[k] * D + ham.cols[k], ham.vals[k]);
  let hermitian = true;
  let maxErr = 0;
  for (let k = 0; k < ham.rows.length; k++) {
    const i = ham.rows[k];
    const j = ham.cols[k];
    const v = ham.vals[k];
    const vt = map.get(j * D + i);
    const err = Math.abs((vt ?? 0) - v);
    if (err > 1e-9) hermitian = false;
    if (err > maxErr) maxErr = err;
  }
  return {
    dimension: D,
    hermitian,
    maxErr,
    nnz: ham.nnz,
    sparsity: 1 - ham.nnz / (D * D),
  };
}

// ── Observables (from a real eigenvector c, Float64Array length D) ──

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Sx_i |ψ> is real: (Sx_i ψ)[s] = ½ ψ[s ⊕ (1<<i)]
function applySx(c, N, i) {
  const D = 1 << N;
  const r = new Float64Array(D);
  const bit = 1 << i;
  for (let s = 0; s < D; s++) r[s] = 0.5 * c[s ^ bit];
  return r;
}
// Sy_i |ψ> is purely imaginary; store the real coefficient a where (Sy_i ψ)[s] = i·a[s].
// a[s] = ½·η_i(s)·ψ[s ⊕ (1<<i)], η = +1 if bit i is 0, −1 if bit i is 1.
function applySyCoeff(c, N, i) {
  const D = 1 << N;
  const r = new Float64Array(D);
  const bit = 1 << i;
  for (let s = 0; s < D; s++) r[s] = 0.5 * (((s >> i) & 1) ? -1 : 1) * c[s ^ bit];
  return r;
}
// Sz_i is diagonal: (Sz_i ψ)[s] = (±1/2) ψ[s]
function applySz(c, N, i) {
  const D = 1 << N;
  const r = new Float64Array(D);
  const bit = 1 << i;
  for (let s = 0; s < D; s++) r[s] = ((s >> i) & 1 ? 0.5 : -0.5) * c[s];
  return r;
}

export function localMagnetization(c, N) {
  const sx = new Array(N), sy = new Array(N), sz = new Array(N);
  for (let i = 0; i < N; i++) {
    sx[i] = dot(c, applySx(c, N, i));
    sy[i] = dot(c, applySyCoeff(c, N, i)); // real eigenvector ⇒ <Sy> = 0
    sz[i] = dot(c, applySz(c, N, i));
  }
  return { sx, sy, sz };
}

export function totalMagnetization(c, N) {
  const { sx, sy, sz } = localMagnetization(c, N);
  const Sztot = sz.reduce((a, b) => a + b, 0);
  // S_total² = Σ_i S_i·S_i + 2 Σ_{i<j} S_i·S_j ; here report <Sz_tot> and Σ<Sz_i²>
  let Sz2 = 0;
  for (let i = 0; i < N; i++) Sz2 += dot(applySz(c, N, i), applySz(c, N, i));
  return { Sztot, Sx_tot: sx.reduce((a, b) => a + b, 0), Sy_tot: sy.reduce((a, b) => a + b, 0), Sz2 };
}

export function correlations(c, N) {
  const Cxx = Array.from({ length: N }, () => new Float64Array(N));
  const Cyy = Array.from({ length: N }, () => new Float64Array(N));
  const Czz = Array.from({ length: N }, () => new Float64Array(N));
  const opsX = [], opsY = [], opsZ = [];
  for (let i = 0; i < N; i++) {
    opsX.push(applySx(c, N, i));
    opsY.push(applySyCoeff(c, N, i));
    opsZ.push(applySz(c, N, i));
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      Cxx[i][j] = dot(opsX[i], opsX[j]);
      Cyy[i][j] = dot(opsY[i], opsY[j]); // (i·a)·(i·b) = a·b (real)
      Czz[i][j] = dot(opsZ[i], opsZ[j]);
    }
  }
  const Ciso = Array.from({ length: N }, () => new Float64Array(N));
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) Ciso[i][j] = (Cxx[i][j] + Cyy[i][j] + Czz[i][j]) / 3;
  return { Cxx, Cyy, Czz, Ciso };
}

// Correlation as a function of separation r = |i−j| (averaged over all pairs).
export function correlationVsDistance(C, N) {
  const maxR = N - 1;
  const sums = new Array(maxR + 1).fill(0);
  const counts = new Array(maxR + 1).fill(0);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const r = Math.abs(i - j);
    sums[r] += C[i][j];
    counts[r]++;
  }
  return sums.map((s, r) => ({ r, C: counts[r] ? s / counts[r] : 0 }));
}

// ── Basis-state formatting ──
export function basisLabel(s, N) {
  let str = '';
  for (let i = 0; i < N; i++) str += ((s >> i) & 1) ? '↑' : '↓';
  return `|${str}⟩`;
}
export function basisBinary(s, N) {
  let str = '';
  for (let i = 0; i < N; i++) str += ((s >> i) & 1);
  return str;
}

// ── Resource estimate ──
export function resourceEstimate(N) {
  const D = 1 << N;
  const denseBytes = D * D * 8;
  const nnzEst = D * (N + 1);
  const sparseBytes = nnzEst * 12;
  const krylovBytes = Math.min(D, 200) * D * 8;
  let method = 'Lanczos (sparse iterative)';
  let warning = '';
  if (N <= 8) method = 'Dense Exact Diagonalization or Lanczos';
  if (N > 14) { method = 'Lanczos (sparse iterative)'; warning = 'Large system — Krylov storage and reorthogonalization may be slow.'; }
  if (N > 16) warning = 'Very large system — may exceed available browser memory.';
  return {
    D, denseBytes, sparseBytes, krylovBytes, nnzEst, method, warning,
    denseMB: denseBytes / 1048576,
    sparseMB: sparseBytes / 1048576,
    krylovMB: krylovBytes / 1048576,
  };
}

// ── Equation string (live from parameters) ──
export function hamiltonianEquation({ N, J, h, periodic }) {
  const range = periodic ? 'i=1..N (N+1→1)' : 'i=1..N−1';
  let eq = `H = ${J}·Σ_{${range}} (SᵢˣS_{i+1}ˣ + SᵢʸS_{i+1}ʸ + SᵢᶻS_{i+1}ᶻ)`;
  if (h !== 0) eq += ` − ${h}·Σᵢ Sᵢᶻ`;
  return eq;
}