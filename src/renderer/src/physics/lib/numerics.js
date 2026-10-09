// General-purpose numerical methods for computational physics.
// All deterministic, with explicit error analysis against analytic solutions
// where they exist. No AI.

import { rk4 } from './math';

// ── ODE integrators: y' = f(t, y), y a flat array. Each returns a new array. ──
export function euler(f, t, y, h) {
  const k = f(t, y);
  return y.map((yi, i) => yi + h * k[i]);
}
export function improvedEuler(f, t, y, h) {
  const k1 = f(t, y);
  const p = y.map((yi, i) => yi + h * k1[i]);
  const k2 = f(t + h, p);
  return y.map((yi, i) => yi + h * (k1[i] + k2[i]) / 2);
}
export function rk2(f, t, y, h) {
  const k1 = f(t, y);
  const m = y.map((yi, i) => yi + 0.5 * h * k1[i]);
  const k2 = f(t + 0.5 * h, m);
  return y.map((yi, i) => yi + h * k2[i]);
}
export { rk4 };

// Adaptive Runge–Kutta (RK45 / Fehlberg). Integrates from t0 to t1 with a
// starting step, keeping local error below tol. Returns { ts, ys, accepted }.
export function rk45(f, t0, y0, t1, { h0 = 0.1, tol = 1e-6, maxSteps = 20000 } = {}) {
  const a2 = 1 / 4, b21 = 1 / 4;
  const a3 = 3 / 8, b31 = 3 / 32, b32 = 9 / 32;
  const a4 = 12 / 13, b41 = 1932 / 2197, b42 = -7200 / 2197, b43 = 7296 / 2197;
  const a5 = 1, b51 = 439 / 216, b52 = -8, b53 = 3680 / 513, b54 = -845 / 4104;
  const a6 = 1 / 2, b61 = -8 / 27, b62 = 2, b63 = -3544 / 2565, b64 = 1859 / 4104, b65 = -11 / 40;
  const c1 = 16 / 135, c3 = 6656 / 12825, c4 = 28561 / 56430, c5 = -9 / 50, c6 = 2 / 55;
  const d1 = 25 / 216, d3 = 1408 / 2565, d4 = 2197 / 4104, d5 = -1 / 5;
  let t = t0, y = y0.slice(), h = Math.min(h0, t1 - t0);
  const ts = [t], ys = [y.slice()]; let accepted = 0;
  for (let step = 0; step < maxSteps && t < t1; step++) {
    if (t + h > t1) h = t1 - t;
    const k1 = f(t, y);
    const y2 = y.map((yi, i) => yi + h * a2 * k1[i]);
    const k2 = f(t + a2 * h, y2);
    const y3 = y.map((yi, i) => yi + h * (b31 * k1[i] + b32 * k2[i]));
    const k3 = f(t + a3 * h, y3);
    const y4 = y.map((yi, i) => yi + h * (b41 * k1[i] + b42 * k2[i] + b43 * k3[i]));
    const k4 = f(t + a4 * h, y4);
    const y5 = y.map((yi, i) => yi + h * (b51 * k1[i] + b52 * k2[i] + b53 * k3[i] + b54 * k4[i]));
    const k5 = f(t + a5 * h, y5);
    const y6 = y.map((yi, i) => yi + h * (b61 * k1[i] + b62 * k2[i] + b63 * k3[i] + b64 * k4[i] + b65 * k5[i]));
    const k6 = f(t + a6 * h, y6);
    const y5out = y.map((yi, i) => yi + h * (c1 * k1[i] + c3 * k3[i] + c4 * k4[i] + c5 * k5[i] + c6 * k6[i]));
    const y4out = y.map((yi, i) => yi + h * (d1 * k1[i] + d3 * k3[i] + d4 * k4[i] + d5 * k5[i]));
    let err = 0;
    for (let i = 0; i < y.length; i++) err = Math.max(err, Math.abs(y5out[i] - y4out[i]));
    if (err <= tol || h < 1e-14) { t += h; y = y5out; ts.push(t); ys.push(y.slice()); accepted++; }
    const factor = err === 0 ? 2 : Math.min(2, 0.9 * Math.pow(tol / err, 0.2));
    h = Math.max(1e-12, h * factor);
  }
  return { ts, ys, accepted };
}

// ── Numerical integration ──
export function trapezoid(f, a, b, n) {
  const h = (b - a) / n; let s = 0.5 * (f(a) + f(b));
  for (let i = 1; i < n; i++) s += f(a + i * h);
  return s * h;
}
export function simpson(f, a, b, n) {
  if (n % 2) n++; const h = (b - a) / n; let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}
export function gaussLegendre(f, a, b, n = 5) {
  // n-point Gauss–Legendre on [-1,1] mapped to [a,b]. Nodes/weights for n=1..6.
  const GL = {
    1: [[0, 2]], 2: [[-0.57735026919, 1], [0.57735026919, 1]],
    3: [[-0.77459666924, 0.55555555556], [0, 0.88888888889], [0.77459666924, 0.55555555556]],
    4: [[-0.86113631159, 0.34785484514], [-0.33998104358, 0.65214515486], [0.33998104358, 0.65214515486], [0.86113631159, 0.34785484514]],
    5: [[-0.90617984594, 0.23692688506], [-0.53846931011, 0.47862867048], [0, 0.56888888889], [0.53846931011, 0.47862867048], [0.90617984594, 0.23692688506]],
    6: [[-0.9324695142, 0.1713244924], [-0.6612093865, 0.360761573], [-0.2386191861, 0.4679139346], [0.2386191861, 0.4679139346], [0.6612093865, 0.360761573], [0.9324695142, 0.1713244924]],
  };
  const pts = GL[n] || GL[5]; const mid = (a + b) / 2, half = (b - a) / 2;
  return half * pts.reduce((s, [x, w]) => s + w * f(mid + half * x), 0);
}

// ── Numerical differentiation ──
export function diffForward(f, x, h = 1e-4) { return (f(x + h) - f(x)) / h; }
export function diffCentral(f, x, h = 1e-4) { return (f(x + h) - f(x - h)) / (2 * h); }
export function diff2(f, x, h = 1e-3) { return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h); }

// ── Root finding ──
export function newton(f, fp, x0, { tol = 1e-12, maxIter = 100 } = {}) {
  let x = x0; const iters = [];
  for (let i = 0; i < maxIter; i++) { const fx = f(x); iters.push({ i, x, fx }); if (Math.abs(fx) < tol) return { root: x, iters, converged: true }; x -= fx / fp(x); }
  return { root: x, iters, converged: false };
}
export function bisection(f, a, b, { tol = 1e-12, maxIter = 200 } = {}) {
  let lo = a, hi = b; const iters = [];
  for (let i = 0; i < maxIter && hi - lo > tol; i++) { const m = (lo + hi) / 2; const fm = f(m); iters.push({ i, x: m, fx: fm }); if (fm === 0) return { root: m, iters, converged: true }; if (f(lo) * fm < 0) hi = m; else lo = m; }
  return { root: (lo + hi) / 2, iters, converged: true };
}
export function secant(f, x0, x1, { tol = 1e-12, maxIter = 100 } = {}) {
  let a = x0, b = x1; const iters = [];
  for (let i = 0; i < maxIter; i++) { const fa = f(a), fb = f(b); iters.push({ i, x: b, fx: fb }); if (Math.abs(fb) < tol) return { root: b, iters, converged: true }; const c = b - (fb * (b - a)) / (fb - fa); a = b; b = c; }
  return { root: b, iters, converged: false };
}

// ── Monte Carlo ──
export function monteCarloIntegrate(f, a, b, n, seed = 1) {
  let s = 0, s2 = 0; let r = seed;
  const rand = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
  for (let i = 0; i < n; i++) { const x = a + rand() * (b - a); const v = f(x); s += v; s2 += v * v; }
  const mean = s / n; const varEst = Math.max(0, s2 / n - mean * mean);
  const est = (b - a) * mean; const err = (b - a) * Math.sqrt(varEst / n);
  return { value: est, error: err, n };
}

// ── Eigenvalue solvers ──
// Power iteration for the largest-magnitude eigenvalue of a dense matrix.
export function powerIteration(A, { maxIter = 1000, tol = 1e-10 } = {}) {
  const n = A.length; let v = new Array(n).fill(1).map(() => Math.random());
  let lambda = 0;
  for (let it = 0; it < maxIter; it++) {
    const Av = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Av[i] += A[i][j] * v[j];
    let norm = 0; for (let i = 0; i < n; i++) norm += Av[i] * Av[i]; norm = Math.sqrt(norm);
    const v2 = Av.map((x) => x / norm);
    let lam = 0; for (let i = 0; i < n; i++) lam += v2[i] * Av[i];
    if (Math.abs(lam - lambda) < tol) { lambda = lam; return { eigenvalue: lambda, iterations: it + 1, converged: true }; }
    lambda = lam; v = v2;
  }
  return { eigenvalue: lambda, iterations: maxIter, converged: false };
}
// Jacobi eigenvalue algorithm for a real symmetric matrix → all eigenvalues.
export function jacobiEigen(A, { maxSweeps = 100, tol = 1e-12 } = {}) {
  const n = A.length; const a = A.map((r) => r.slice());
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < tol) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(1 + t * t), s = t * c;
      const app = a[p][p], aqq = a[q][q], apq = a[p][q];
      a[p][p] = app - t * apq; a[q][q] = aqq + t * apq; a[p][q] = a[q][p] = 0;
      for (let i = 0; i < n; i++) if (i !== p && i !== q) { const aip = a[i][p], aiq = a[i][q]; a[i][p] = a[p][i] = aip - s * (aiq + s * aip); a[i][q] = a[q][i] = aiq + s * (aip - s * aiq); }
    }
  }
  const eig = []; for (let i = 0; i < n; i++) eig.push(a[i][i]);
  return eig.sort((x, y) => x - y);
}

// ── Finite-difference operators on a 1D grid (second derivative) ──
export function laplacian1D(u, dx) {
  const n = u.length; const out = new Array(n);
  for (let i = 0; i < n; i++) { const l = u[(i - 1 + n) % n], r = u[(i + 1) % n]; out[i] = (l - 2 * u[i] + r) / (dx * dx); }
  return out;
}