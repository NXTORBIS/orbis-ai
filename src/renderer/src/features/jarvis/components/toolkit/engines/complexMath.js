/**
 * Complex arithmetic and the two numerical routines the complex-plane engines share:
 * polynomial evaluation with derivatives, and complex Newton with a full iteration history
 * so convergence order can be measured rather than assumed.
 */

export const cAdd = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const cSub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const cMul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const cAbs = (z) => Math.hypot(z[0], z[1]);
export const cScale = (z, s) => [z[0] * s, z[1] * s];

export const cDiv = (a, b) => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};

export const cExp = (z) => [Math.exp(z[0]) * Math.cos(z[1]), Math.exp(z[0]) * Math.sin(z[1])];

export const powInt = (z, n) => {
  let out = [1, 0];
  for (let i = 0; i < n; i += 1) out = cMul(out, z);
  return out;
};

/** Principal n-th root continued onto sheet k: w = r^(1/n) e^{i(θ + 2πk)/n}. */
export const rootSheet = (z, n, k) => {
  const r = Math.max(cAbs(z), 1e-12);
  const theta = Math.atan2(z[1], z[0]);
  const R = Math.pow(r, 1 / n);
  const T = (theta + 2 * Math.PI * k) / n;
  return [R * Math.cos(T), R * Math.sin(T)];
};

/** Coefficients are ascending: coeffs[i] multiplies z^i. */
export const evalPoly = (coeffs, z) => {
  let out = [0, 0];
  for (let i = coeffs.length - 1; i >= 0; i -= 1) out = cAdd(cMul(out, z), [coeffs[i], 0]);
  return out;
};

export const evalDerivative = (coeffs, z) => {
  let out = [0, 0];
  for (let i = coeffs.length - 1; i >= 1; i -= 1) out = cAdd(cMul(out, z), [i * coeffs[i], 0]);
  return out;
};

export function newton(coeffs, start, { iterations = 80, tolerance = 1e-12 } = {}) {
  let z = start;
  const history = [];
  for (let i = 0; i < iterations; i += 1) {
    const p = evalPoly(coeffs, z);
    const residual = cAbs(p);
    history.push({ z, residual });
    if (residual < tolerance) return { z, history, converged: true, iterations: i };
    const d = evalDerivative(coeffs, z);
    if (cAbs(d) < 1e-300) return { z, history, converged: false, iterations: i };
    z = cSub(z, cDiv(p, d));
  }
  return { z, history, converged: cAbs(evalPoly(coeffs, z)) < 1e-8, iterations };
}

/** Every distinct root reachable by Newton from a grid of starts. */
export function polynomialRoots(coeffs, { starts = 13, extent = 2, merge = 1e-7 } = {}) {
  const found = [];
  for (let i = 0; i < starts; i += 1) {
    for (let j = 0; j < starts; j += 1) {
      const start = [-extent + (2 * extent * i) / (starts - 1), -extent + (2 * extent * j) / (starts - 1)];
      const { z, converged } = newton(coeffs, start);
      if (!converged && cAbs(evalPoly(coeffs, z)) > 1e-7) continue;
      if (!found.some((root) => cAbs(cSub(root, z)) < merge)) found.push(z);
    }
  }
  return found.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
}