/** Small numeric helpers shared by every engineering simulator. */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const sign = (v, dead = 0) => (v > dead ? 1 : v < -dead ? -1 : v / dead);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Integrate one state object forward with a fixed sub-step, capped so a frame never stalls. */
export function integrate(sim, state, dt, params, maxStep, maxSubSteps = 6000) {
  if (!dt) return state;
  const steps = Math.min(maxSubSteps, Math.max(1, Math.ceil(Math.abs(dt) / maxStep)));
  const h = dt / steps;
  let y = state;
  for (let i = 0; i < steps; i += 1) y = sim.step(y, h, params) || y;
  return y;
}

/** Rolling series buffer for the live plots. */
export function createHistory(capacity = 480) {
  return { capacity, xs: [], data: {} };
}

export function pushSample(history, x, values) {
  history.xs.push(x);
  for (const [key, value] of Object.entries(values)) {
    if (!history.data[key]) history.data[key] = [];
    history.data[key].push(value);
  }
  if (history.xs.length > history.capacity) {
    history.xs.shift();
    for (const key of Object.keys(history.data)) history.data[key].shift();
  }
  return history;
}

/** Peak of a sampled window — used for RMS-style measurements from waveforms. */
export function peak(values) {
  let m = 0;
  for (const v of values) m = Math.max(m, Math.abs(v));
  return m;
}

export const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export const rmsOf = (values) => (values.length ? Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length) : 0);

/** Numeric derivative of a sampled function of one variable, used to cross-check analytic results. */
export function derivative(fn, x, h = 1e-5) {
  return (fn(x + h) - fn(x - h)) / (2 * h);
}

export function secondDerivative(fn, x, h = 1e-4) {
  return (fn(x + h) - 2 * fn(x) + fn(x - h)) / (h * h);
}

/** Bisection root find for the independent checks. */
export function bisect(fn, lo, hi, tolerance = 1e-10, iterations = 200) {
  let a = lo, b = hi, fa = fn(a), fb = fn(b);
  if (fa * fb > 0) return null;
  for (let i = 0; i < iterations; i += 1) {
    const m = (a + b) / 2, fm = fn(m);
    if (Math.abs(fm) < tolerance || (b - a) / 2 < tolerance) return m;
    if (fa * fm <= 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

export const fmt = (value, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : '—');