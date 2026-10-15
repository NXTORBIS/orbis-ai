/** Periodic two-species reaction–diffusion, explicit Euler and isotropic 9-point diffusion.
 * Dimensionless model units; h is the cell spacing. Linear growth uses the exact spatial symbol.
 */
export const LAP_ORTH = 2 / 3;
export const LAP_DIAG = 1 / 6;
export function laplacianSymbol(kx, ky, h = 1) {
  return (2 * LAP_ORTH * (Math.cos(kx * h) + Math.cos(ky * h)) + 4 * LAP_DIAG * Math.cos(kx * h) * Math.cos(ky * h) - 10 / 3) / h ** 2;
}
export const maxLaplacianMagnitude = (h = 1) => 16 / (3 * h ** 2);
export const RD_MODELS = {
  'gray-scott': { name: 'Gray–Scott', dt: 1, defaults: { F: 0.037, k: 0.06, Du: 0.16, Dv: 0.08, h: 1 },
    steady: () => [1, 0], react: (u, v, p) => [-u * v * v + p.F * (1 - u), u * v * v - (p.F + p.k) * v],
    jac: (u, v, p) => [[-v * v - p.F, -2 * u * v], [v * v, 2 * u * v - p.F - p.k]],
    note: 'Stability is evaluated at (1,0). Finite-amplitude patterns can coexist with this stable rest state; they are not proof of a Turing instability on that branch.' },
  schnakenberg: { name: 'Schnakenberg', dt: 0.02, defaults: { a: 0.1, b: 0.9, Du: 1, Dv: 10, h: 1 },
    steady: p => [p.a + p.b, p.b / (p.a + p.b) ** 2], react: (u, v, p) => [p.a - u + u * u * v, p.b - u * u * v],
    jac: (u, v) => [[-1 + 2 * u * v, u * u], [-2 * u * v, -u * u]],
    note: 'A stable homogeneous activator–inhibitor system becomes spatially unstable when the inhibitor diffuses sufficiently faster.' },
  brusselator: { name: 'Brusselator', dt: 0.02, defaults: { a: 1, b: 3, Du: 0.01, Dv: 0.02, h: 1 },
    steady: p => [p.a, p.b / p.a], react: (u, v, p) => [p.a - (p.b + 1) * u + u * u * v, p.b * u - u * u * v],
    jac: (u, v, p) => [[-(p.b + 1) + 2 * u * v, u * u], [p.b - 2 * u * v, -u * u]],
    note: 'The homogeneous Hopf threshold is b = 1 + a². An unstable zero mode is a temporal instability, not a Turing instability.' },
  'fitzhugh-nagumo': { name: 'FitzHugh–Nagumo', dt: 0.04, defaults: { beta: 0.7, gamma: 0.8, eps: 0.08, Du: 1, Dv: 0, h: 1 },
    steady: p => { let u = -1.2; for (let i = 0; i < 30; i++) u -= (u - u ** 3 / 3 - (u + p.beta) / p.gamma) / (1 - u * u - 1 / p.gamma); return [u, (u + p.beta) / p.gamma]; },
    react: (u, v, p) => [u - u ** 3 / 3 - v, p.eps * (u + p.beta - p.gamma * v)],
    jac: (u, v, p) => [[1 - u * u, -1], [p.eps, -p.eps * p.gamma]],
    note: 'An excitable medium with stable rest, a finite excitation threshold and a refractory recovery variable. Stimulate it to launch a wave.' },
};
export const RD_PRESETS = {
  'gs-worms': { label: 'Gray–Scott · worms', model: 'gray-scott', kind: 'patches', params: RD_MODELS['gray-scott'].defaults, steps: 24 },
  'gs-bubbles': { label: 'Gray–Scott · bubbles', model: 'gray-scott', kind: 'patches', params: { F: 0.03, k: 0.0625, Du: 0.16, Dv: 0.08, h: 1 }, steps: 24 },
  'schnakenberg-spots': { label: 'Schnakenberg · spots', model: 'schnakenberg', kind: 'noise', params: RD_MODELS.schnakenberg.defaults, steps: 40 },
  'schnakenberg-wide': { label: 'Schnakenberg · wider spacing', model: 'schnakenberg', kind: 'noise', params: { a: 0.1, b: 0.9, Du: 1, Dv: 24, h: 1 }, steps: 40 },
  'brusselator-oscillations': { label: 'Brusselator · oscillations', model: 'brusselator', kind: 'noise', params: RD_MODELS.brusselator.defaults, steps: 40 },
  'fhn-spiral': { label: 'FitzHugh–Nagumo · broken front', model: 'fitzhugh-nagumo', kind: 'stimulus', params: RD_MODELS['fitzhugh-nagumo'].defaults, steps: 20 },
};
export function validateParameters(key, params) {
  const model = RD_MODELS[key];
  if (!model) throw new Error('Choose a supported reaction model.');
  const p = { ...model.defaults, ...params };
  if (Object.values(p).some(v => !Number.isFinite(v)) || p.h <= 0 || p.Du < 0 || p.Dv < 0) throw new Error('Use finite parameters, positive spacing and nonnegative diffusion.');
  if ((key === 'schnakenberg' || key === 'brusselator') && (p.a <= 0 || p.b < 0)) throw new Error('a must be positive and b nonnegative.');
  if (key === 'gray-scott' && (p.F <= 0 || p.k < 0)) throw new Error('Feed must be positive and kill rate nonnegative.');
  if (key === 'fitzhugh-nagumo' && (p.gamma <= 0 || p.eps <= 0)) throw new Error('Recovery rate and gamma must be positive.');
  return p;
}
export function fixedPoint(key, params) {
  const p = validateParameters(key, params), model = RD_MODELS[key];
  const [u, v] = model.steady(p); return { u, v, residual: Math.hypot(...model.react(u, v, p)) };
}
export const jacobian = (key, p, fp = fixedPoint(key, p)) => RD_MODELS[key].jac(fp.u, fp.v, p);
export function eigen2(A) {
  const tr = A[0][0] + A[1][1], det = A[0][0] * A[1][1] - A[0][1] * A[1][0], disc = tr * tr / 4 - det;
  return { re: tr / 2 + Math.sqrt(Math.max(0, disc)), other: tr / 2 - Math.sqrt(Math.max(0, disc)), im: Math.sqrt(Math.max(0, -disc)), tr, det };
}
export function modeGrowth(key, params, n, nx, ny) {
  const p = validateParameters(key, params), J = jacobian(key, p), lam = laplacianSymbol(2 * Math.PI * nx / (n * p.h), 2 * Math.PI * ny / (n * p.h), p.h);
  return { ...eigen2([[J[0][0] + p.Du * lam, J[0][1]], [J[1][0], J[1][1] + p.Dv * lam]]), matrix: [[J[0][0] + p.Du * lam, J[0][1]], [J[1][0], J[1][1] + p.Dv * lam]] };
}
export function dispersion(key, params, { n = 64 } = {}) {
  const p = validateParameters(key, params), fp = fixedPoint(key, p), J = jacobian(key, p), homogeneous = eigen2(J), rows = [];
  let peak = { sigma: -Infinity, k: 0, nx: 0, ny: 0 };
  for (let nx = 0; nx <= n / 2; nx++) for (let ny = 0; ny <= n / 2; ny++) {
    const e = modeGrowth(key, p, n, nx, ny), row = { k: 2 * Math.PI * Math.hypot(nx, ny) / (n * p.h), sigma: e.re, omega: e.im, nx, ny };
    rows.push(row); if (row.sigma > peak.sigma) peak = row;
  }
  const turing = homogeneous.re < 0 && peak.sigma > 1e-9 && peak.nx + peak.ny > 0;
  return { rows, peak, homogeneous, fixedPoint: fp, jacobian: J, growthAtZero: homogeneous.re, turing, wavelength: peak.k > 0 ? 2 * Math.PI / peak.k : Infinity, dtMax: Math.max(p.Du, p.Dv) ? 2 / (Math.max(p.Du, p.Dv) * maxLaplacianMagnitude(p.h)) : Infinity };
}
export function turingThreshold(key, params, { n = 64 } = {}) {
  const p = validateParameters(key, params); if (p.Du <= 0 || eigen2(jacobian(key, p)).re >= 0) return null;
  let lo = 1, hi = 2;
  while (hi < 1024 && dispersion(key, { ...p, Dv: p.Du * hi }, { n }).peak.sigma <= 0) hi *= 2;
  if (hi >= 1024) return null;
  for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (dispersion(key, { ...p, Dv: p.Du * mid }, { n }).peak.sigma > 0) hi = mid; else lo = mid; }
  return hi;
}
export function createGrid(n, key, params, { kind = 'noise', seed = 12345 } = {}) {
  if (!Number.isInteger(n) || n < 8 || n > 256 || (n & (n - 1))) throw new Error('Grid size must be a power of two from 8 to 256.');
  const p = validateParameters(key, params), fp = fixedPoint(key, p), u = new Float64Array(n * n), v = new Float64Array(n * n);
  let s = seed >>> 0; const random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = y * n + x, j = kind === 'noise' ? (random() - 0.5) * 0.02 : 0;
    u[c] = fp.u * (1 + j); v[c] = fp.v * (1 + j);
    if (kind === 'patches' && ((Math.abs(x - n / 2) < n / 10 && Math.abs(y - n / 2) < n / 10) || (Math.abs(x - n / 4) < n / 18 && Math.abs(y - n / 3) < n / 18))) { u[c] = 0.5 + 0.02 * random(); v[c] = 0.25 + 0.02 * random(); }
    if (kind === 'stimulus' && x > n / 2 && y > n / 2) { u[c] = 1; v[c] = fp.v; }
    if (kind === 'stimulus' && y < n / 2 && x > n / 2) v[c] = 0.5;
  }
  return { n, u, v, t: 0, model: key, un: new Float64Array(n * n), vn: new Float64Array(n * n) };
}
function lap(a, n, x, y) {
  const xm = (x + n - 1) % n, xp = (x + 1) % n, ym = ((y + n - 1) % n) * n, yp = ((y + 1) % n) * n, row = y * n;
  return LAP_ORTH * (a[ym + x] + a[yp + x] + a[row + xm] + a[row + xp]) + LAP_DIAG * (a[ym + xm] + a[ym + xp] + a[yp + xm] + a[yp + xp]) - (10 / 3) * a[row + x];
}
export function stableStep(key, p) { const limit = Math.max(p.Du, p.Dv) ? 0.9 * p.h ** 2 / ((10 / 3) * Math.max(p.Du, p.Dv)) : Infinity; return Math.min(RD_MODELS[key].dt, limit); }
export function stepGrid(grid, params, dt = stableStep(grid.model, params), steps = 1) {
  const p = validateParameters(grid.model, params), { n, u, v, un, vn } = grid, model = RD_MODELS[grid.model];
  if (!Number.isFinite(dt) || dt <= 0 || dt > stableStep(grid.model, p) * 1.000001) throw new Error('Time step exceeds the safe diffusion/model step.');
  for (let s = 0; s < steps; s++) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = y * n + x, r = model.react(u[c], v[c], p);
      un[c] = u[c] + dt * (p.Du * lap(u, n, x, y) / p.h ** 2 + r[0]); vn[c] = v[c] + dt * (p.Dv * lap(v, n, x, y) / p.h ** 2 + r[1]);
      if (!Number.isFinite(un[c]) || !Number.isFinite(vn[c]) || Math.max(Math.abs(un[c]), Math.abs(vn[c])) > 1e6) throw new Error('This parameter set diverged; reduce the reaction rates or reset to a preset.');
    }
    u.set(un); v.set(vn); grid.t += dt;
  }
  return grid;
}
export function diffuseOnly(grid, dt, steps, D = 0.1, h = 1) {
  const { n, u } = grid, un = new Float64Array(u.length);
  for (let s = 0; s < steps; s++) { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) un[y * n + x] = u[y * n + x] + dt * D * lap(u, n, x, y) / h ** 2; u.set(un); grid.t += dt; }
}
export function fieldStats(field, n = field.n) {
  const a = field.u, mean = a.reduce((s, v) => s + v, 0) / (n * n); let variance = 0, min = Infinity, max = -Infinity;
  for (const v of a) { variance += (v - mean) ** 2; min = Math.min(min, v); max = Math.max(max, v); }
  return { mean, variance: variance / a.length, rms: Math.sqrt(variance / a.length), min, max };
}
export function modeAmplitude(grid, n, mx, my) {
  let cs = 0, sn = 0; const mean = grid.u.reduce((s, v) => s + v, 0) / grid.u.length;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const th = 2 * Math.PI * (mx * x + my * y) / n, d = grid.u[y * n + x] - mean; cs += d * Math.cos(th); sn += d * Math.sin(th); }
  return Math.hypot(cs, sn) / grid.u.length;
}
export function seedMode(grid, params, mx, my, amp = 1e-5) {
  const fp = fixedPoint(grid.model, params), e = modeGrowth(grid.model, params, grid.n, mx, my), A = e.matrix;
  const ratio = Math.abs(A[0][1]) > 1e-12 ? (e.re - A[0][0]) / A[0][1] : 0;
  for (let y = 0; y < grid.n; y++) for (let x = 0; x < grid.n; x++) { const c = y * grid.n + x, d = amp * Math.cos(2 * Math.PI * (mx * x + my * y) / grid.n); grid.u[c] = fp.u + d; grid.v[c] = fp.v + ratio * d; }
  grid.t = 0; return grid;
}
export function measureModeGrowth(key, params, { n = 32, mx = 2, my = 0, amp = 1e-5, tEnd = 12, sample = 30 } = {}) {
  const p = validateParameters(key, params), dt = stableStep(key, p), grid = seedMode(createGrid(n, key, p, { kind: 'uniform' }), p, mx, my, amp), times = [], amps = [];
  const steps = Math.max(1, Math.round(tEnd / dt / sample));
  for (let i = 0; i < sample; i++) { stepGrid(grid, p, dt, steps); times.push(grid.t); amps.push(modeAmplitude(grid, n, mx, my)); }
  const valid = times.map((v, i) => i).filter(i => amps[i] > 1e-12 && amps[i] < 0.01); let sx = 0, sy = 0, sxx = 0, sxy = 0;
  valid.forEach(i => { sx += times[i]; sy += Math.log(amps[i]); sxx += times[i] ** 2; sxy += times[i] * Math.log(amps[i]); });
  const den = valid.length * sxx - sx ** 2, e = modeGrowth(key, p, n, mx, my);
  return { rate: den ? (valid.length * sxy - sx * sy) / den : null, predicted: e.re, discreteRate: Math.log(1 + dt * e.re) / dt, times, amps, samples: valid.length, dt };
}