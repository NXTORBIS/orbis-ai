// Scientific statistics, regression and curve fitting. Deterministic, no AI.

export function mean(a = []) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
export function median(a = []) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function variance(a = []) { const n = a.length; if (n < 2) return 0; const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1); }
export function std(a = []) { return Math.sqrt(variance(a)); }
export function rms(a = []) { return a.length ? Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length) : 0; }
export function minmax(a = []) { return a.length ? { min: Math.min(...a), max: Math.max(...a) } : { min: 0, max: 0 }; }
export function covariance(x = [], y = []) {
  const n = Math.min(x.length, y.length); if (n < 2) return 0;
  const mx = mean(x), my = mean(y); let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}
export function correlation(x = [], y = []) {
  const sx = std(x), sy = std(y); if (!sx || !sy) return 0;
  return covariance(x, y) / (sx * sy);
}

// Linear regression y = m x + c. Returns { m, c, mErr, cErr, r2, residuals }.
export function linreg(x = [], y = []) {
  const n = Math.min(x.length, y.length); if (n < 2) return { m: 0, c: 0, mErr: 0, cErr: 0, r2: 0, residuals: [] };
  const mx = mean(x), my = mean(y);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
  const m = sxy / sxx; const c = my - m * mx;
  const yhat = x.map((xi) => m * xi + c);
  const residuals = y.map((yi, i) => yi - yhat[i]);
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const r2 = syy ? 1 - ssRes / syy : 0;
  const sErr = Math.sqrt(ssRes / (n - 2));
  const mErr = sErr / Math.sqrt(sxx);
  const cErr = sErr * Math.sqrt(mean(x.map((xi) => xi * xi)) / sxx);
  return { m, c, mErr, cErr, r2, residuals, yhat };
}

// Polynomial least-squares fit of degree d. Returns coefficients [c0..cd] (c0 + c1 x + ...).
export function polyfit(x = [], y = [], d = 2) {
  const n = x.length; const k = d + 1;
  // Build normal equations A c = b
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const xp = new Array(2 * d + 1); for (let p = 0; p <= 2 * d; p++) xp[p] = Math.pow(x[i], p);
    for (let r = 0; r < k; r++) { A[r][r + 0] += xp[r + 0]; for (let cc = r + 1; cc < k; cc++) A[r][cc] += xp[r + cc]; b[r] += y[i] * xp[r]; }
  }
  for (let r = 0; r < k; r++) for (let cc = r + 1; cc < k; cc++) A[cc][r] = A[r][cc];
  // Gaussian elimination
  for (let i = 0; i < k; i++) {
    let piv = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    for (let r = i + 1; r < k; r++) { const f = A[r][i] / A[i][i]; for (let cc = i; cc < k; cc++) A[r][cc] -= f * A[i][cc]; b[r] -= f * b[i]; }
  }
  const coef = new Array(k);
  for (let i = k - 1; i >= 0; i--) { let s = b[i]; for (let cc = i + 1; cc < k; cc++) s -= A[i][cc] * coef[cc]; coef[i] = s / A[i][i]; }
  return coef;
}
export function polyval(coef, x) { return coef.reduce((s, c, i) => s + c * Math.pow(x, i), 0); }

// Generic nonlinear curve fit via Gauss–Newton. model(x, params) and
// jacobian(x, params) (partial d model/d param). Returns refined params.
export function gaussNewton(model, jac, x, y, p0, { maxIter = 50, tol = 1e-8 } = {}) {
  let p = p0.slice();
  for (let it = 0; it < maxIter; it++) {
    const n = x.length, m = p.length;
    const J = [], r = [];
    for (let i = 0; i < n; i++) { J.push(jac(x[i], p)); r.push(y[i] - model(x[i], p)); }
    // (J^T J) dp = J^T r
    const A = Array.from({ length: m }, () => new Array(m).fill(0));
    const g = new Array(m).fill(0);
    for (let i = 0; i < n; i++) for (let a = 0; a < m; a++) { g[a] += J[i][a] * r[i]; for (let b = 0; b < m; b++) A[a][b] += J[i][a] * J[i][b]; }
    // solve A dp = g
    const dp = new Array(m);
    for (let i = 0; i < m; i++) { let piv = i; for (let r2 = i + 1; r2 < m; r2++) if (Math.abs(A[r2][i]) > Math.abs(A[piv][i])) piv = i; [A[i], A[piv]] = [A[piv], A[i]]; [g[i], g[piv]] = [g[piv], g[i]]; for (let r2 = i + 1; r2 < m; r2++) { const f = A[r2][i] / A[i][i]; for (let c = i; c < m; c++) A[r2][c] -= f * A[i][c]; g[r2] -= f * g[i]; } }
    for (let i = m - 1; i >= 0; i--) { let s = g[i]; for (let c = i + 1; c < m; c++) s -= A[i][c] * dp[c]; dp[i] = s / A[i][i]; }
    let maxD = 0; for (let i = 0; i < m; i++) { p[i] += dp[i]; maxD = Math.max(maxD, Math.abs(dp[i])); }
    if (maxD < tol) break;
  }
  return p;
}

export function histogram(arr = [], bins = 20) {
  if (!arr.length) return { counts: [], edges: [] };
  const { min, max } = minmax(arr); const w = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0); const edges = new Array(bins + 1);
  for (let i = 0; i <= bins; i++) edges[i] = min + i * w;
  for (const v of arr) { let b = Math.floor((v - min) / w); if (b >= bins) b = bins - 1; if (b < 0) b = 0; counts[b]++; }
  return { counts, edges };
}