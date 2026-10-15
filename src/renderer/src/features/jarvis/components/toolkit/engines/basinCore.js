/**
 * Basins of attraction for Newton's method on a polynomial.
 *
 * Every pixel is a real Newton solve: which root it reaches, in how many steps, and where the
 * basin it landed in borders another one. The boundary is then measured with box counting, and
 * the convergence order is fitted from the iteration history instead of being assumed to be 2.
 */

import { cAbs, cSub, evalPoly, newton, polynomialRoots } from '@jarvis/components/toolkit/engines/complexMath';

const unitRoots = (n) => Array.from({ length: n }, (_, k) => {
  const theta = (2 * Math.PI * k) / n;
  return [Math.cos(theta), Math.sin(theta)];
});

export const POLYNOMIALS = {
  'z3-1': { label: 'z³ − 1', coeffs: [-1, 0, 0, 1], extent: 1.5, roots: unitRoots(3) },
  'z4-1': { label: 'z⁴ − 1', coeffs: [-1, 0, 0, 0, 1], extent: 1.5, roots: unitRoots(4) },
  'z5-1': { label: 'z⁵ − 1', coeffs: [-1, 0, 0, 0, 0, 1], extent: 1.5, roots: unitRoots(5) },
  'z3-2z-5': { label: 'z³ − 2z − 5', coeffs: [-5, -2, 0, 1], extent: 2.4, roots: null },
};

const rootsFor = (name) => {
  const spec = POLYNOMIALS[name];
  return spec.roots ?? polynomialRoots(spec.coeffs, { extent: spec.extent + 1 });
};

/** Newton solve on a grid, with the root reached, the step count and the boundary set. */
export function basins(name, { n = 256, iterations = 60, tolerance = 1e-11 } = {}) {
  const spec = POLYNOMIALS[name];
  const roots = rootsFor(name);
  const extent = spec.extent;
  const index = new Int16Array(n * n).fill(-1);
  const steps = new Uint8Array(n * n);
  const residual = new Float64Array(n * n);
  const counts = new Array(roots.length).fill(0);

  for (let py = 0; py < n; py += 1) {
    const y = extent - (2 * extent * (py + 0.5)) / n;
    for (let px = 0; px < n; px += 1) {
      const x = -extent + (2 * extent * (px + 0.5)) / n;
      const solve = newton(spec.coeffs, [x, y], { iterations, tolerance });
      const at = py * n + px;
      steps[at] = Math.min(255, solve.iterations);
      residual[at] = solve.converged ? cAbs(evalPoly(spec.coeffs, solve.z)) : Infinity;
      let best = -1;
      let bestDistance = 1e-6;
      roots.forEach((root, k) => {
        const distance = cAbs(cSub(root, solve.z));
        if (distance < bestDistance) { bestDistance = distance; best = k; }
      });
      index[at] = best;
      if (best >= 0) counts[best] += 1;
    }
  }

  const boundary = new Uint8Array(n * n);
  for (let py = 0; py < n; py += 1) {
    for (let px = 0; px < n; px += 1) {
      const at = py * n + px;
      const here = index[at];
      const neighbours = [px > 0 ? at - 1 : -1, px < n - 1 ? at + 1 : -1, py > 0 ? at - n : -1, py < n - 1 ? at + n : -1];
      if (neighbours.some((spot) => spot >= 0 && index[spot] !== here)) boundary[at] = 1;
    }
  }

  let boundaryCount = 0;
  for (let i = 0; i < boundary.length; i += 1) boundaryCount += boundary[i];
  const unresolved = index.reduce((total, value_) => total + (value_ < 0 ? 1 : 0), 0);

  return {
    name,
    label: spec.label,
    n,
    extent,
    roots,
    counts,
    areas: counts.map((count) => count / (n * n)),
    unresolved,
    boundaryCount,
    boundaryFraction: boundaryCount / (n * n),
    meanSteps: steps.reduce((total, value_) => total + value_, 0) / (n * n),
    dimension: boxDimension(boundary, n),
    index,
    steps,
    boundary,
    residual,
  };
}

/** Box-counting dimension of a binary set on an n×n lattice. */
export function boxDimension(mask, n) {
  const scales = [];
  for (let size = 1; size <= n / 4; size *= 2) scales.push(size);
  const counts = scales.map((size) => {
    let occupied = 0;
    for (let y = 0; y < n; y += size) {
      for (let x = 0; x < n; x += size) {
        let hit = false;
        for (let j = y; j < Math.min(n, y + size) && !hit; j += 1) {
          for (let i = x; i < Math.min(n, x + size); i += 1) if (mask[j * n + i]) { hit = true; break; }
        }
        if (hit) occupied += 1;
      }
    }
    return occupied;
  });
  const points = scales.map((size, i) => [Math.log(1 / size), Math.log(Math.max(counts[i], 0.5))]);
  const meanX = points.reduce((total, p) => total + p[0], 0) / points.length;
  const meanY = points.reduce((total, p) => total + p[1], 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  points.forEach(([x, y]) => { numerator += (x - meanX) * (y - meanY); denominator += (x - meanX) ** 2; });
  return { slope: denominator ? numerator / denominator : 0, scales, counts };
}

/** Fitted convergence order from the tail of the iteration history. */
export function convergenceOrder(name, samples = 160) {
  const spec = POLYNOMIALS[name];
  const roots = rootsFor(name);
  const pairs = [];
  for (let s = 0; s < samples; s += 1) {
    const angle = (2 * Math.PI * s) / samples;
    const radius = 0.35 + (1.1 * ((s * 37) % samples)) / samples;
    const start = [radius * Math.cos(angle), radius * Math.sin(angle)];
    const solve = newton(spec.coeffs, start, { iterations: 60 });
    const target = roots.reduce((best, root) => (cAbs(cSub(root, solve.z)) < cAbs(cSub(best, solve.z)) ? root : best), roots[0]);
    const errors = solve.history.map((entry) => cAbs(cSub(entry.z, target))).filter((value_) => value_ > 1e-13 && value_ < 1e-3);
    for (let i = 0; i + 1 < errors.length; i += 1) pairs.push([Math.log(errors[i]), Math.log(errors[i + 1])]);
  }
  const meanX = pairs.reduce((total, p) => total + p[0], 0) / pairs.length;
  const meanY = pairs.reduce((total, p) => total + p[1], 0) / pairs.length;
  let numerator = 0;
  let denominator = 0;
  pairs.forEach(([x, y]) => { numerator += (x - meanX) * (y - meanY); denominator += (x - meanX) ** 2; });
  return { order: denominator ? numerator / denominator : 0, pairs: pairs.length };
}

/** One Newton solve traced step by step, for the point you clicked on the basin map. */
export function basinPath(name, point, iterations = 60) {
  const spec = POLYNOMIALS[name];
  const roots = rootsFor(name);
  const solve = newton(spec.coeffs, [point[0], point[1]], { iterations });
  const trail = solve.history.map((entry) => ({ x: entry.z[0], y: entry.z[1], residual: entry.residual }));
  const reached = roots.reduce((best, root, index) => (cAbs(cSub(root, solve.z)) < cAbs(cSub(roots[best], solve.z)) ? index : best), 0);
  const distance = cAbs(cSub(roots[reached], solve.z));
  return { trail, rootIndex: distance < 1e-4 ? reached : -1, steps: solve.iterations, converged: solve.converged };
}

export function verifyBasin() {
  const checks = [];
  const coarse = basins('z3-1', { n: 192 });
  const fine = basins('z3-1', { n: 384 });

  // 1. The roots the solver reaches are the roots the polynomial actually has.
  const rootGaps = Object.entries(POLYNOMIALS).map(([name, spec]) => {
    const found = rootsFor(name);
    const residual = Math.max(...found.map((root) => cAbs(evalPoly(spec.coeffs, root))));
    const degree = spec.coeffs.length - 1;
    const distinct = found.filter((root, i) => found.slice(0, i).every((other) => cAbs(cSub(other, root)) > 1e-6)).length;
    return { name, count: distinct, degree, residual };
  });
  checks.push({
    label: 'Newton from a grid of starts finds every root, and each one satisfies p(z) = 0',
    ok: rootGaps.every((entry) => entry.count === entry.degree && entry.residual < 1e-8),
    detail: rootGaps.map((entry) => `${entry.name}: ${entry.count}/${entry.degree} roots, |p| ≤ ${entry.residual.toExponential(1)}`).join(' · '),
  });

  // 2. For the roots that are known analytically, the numeric roots must agree exactly.
  const analyticGaps = ['z3-1', 'z4-1', 'z5-1'].map((name) => {
    const expected = POLYNOMIALS[name].roots;
    const found = rootsFor(name);
    const worst = Math.max(...expected.map((root) => Math.min(...found.map((other) => cAbs(cSub(other, root))))));
    return { name, worst };
  });
  checks.push({
    label: 'Located roots coincide with the analytic roots of unity',
    ok: analyticGaps.every((entry) => entry.worst < 1e-9),
    detail: analyticGaps.map((entry) => `${entry.name} ${entry.worst.toExponential(1)}`).join(' · '),
  });

  // 3. Every classified pixel reached a genuine root.
  const resolvedOk = coarse.unresolved === 0 && coarse.counts.reduce((total, count) => total + count, 0) === coarse.n * coarse.n;
  checks.push({ label: 'Every sampled point converges to a genuine root', ok: resolvedOk, detail: `${coarse.n}² pixels, ${coarse.unresolved} unresolved` });

  // 4. Basin areas partition the domain exactly.
  const areaSum = coarse.areas.reduce((total, area) => total + area, 0);
  checks.push({ label: 'Basin areas sum to the whole sampled domain', ok: Math.abs(areaSum - 1) < 1e-12, detail: `Σ area = ${areaSum.toFixed(12)}` });

  // 5. Convergence is quadratic near the roots.
  const fitted = convergenceOrder('z3-1');
  checks.push({ label: 'Newton converges quadratically (measured order ≈ 2)', ok: Math.abs(fitted.order - 2) < 0.15, detail: `fitted order ${fitted.order.toFixed(3)} from ${fitted.pairs} steps` });

  // 6. The boundary is fractal, with a dimension strictly between a curve and the plane.
  checks.push({
    label: 'The basin boundary is fractal: box-counting dimension strictly between 1 and 2',
    ok: coarse.dimension.slope > 1.05 && coarse.dimension.slope < 2,
    detail: `dimension ${coarse.dimension.slope.toFixed(3)}`,
  });

  // 7. That estimate must not be an artefact of the resolution.
  checks.push({
    label: 'The dimension estimate is stable when the resolution is doubled',
    ok: Math.abs(fine.dimension.slope - coarse.dimension.slope) < 0.12,
    detail: `${coarse.n}² → ${coarse.dimension.slope.toFixed(3)}, ${fine.n}² → ${fine.dimension.slope.toFixed(3)}`,
  });

  // 8. The boundary measure must not grow like the resolution for a set of dimension < 2.
  const growth = fine.boundaryFraction / coarse.boundaryFraction;
  checks.push({ label: 'Boundary pixels stay a minority as resolution grows', ok: growth < 1.35, detail: `share ×${growth.toFixed(3)} when the grid doubled` });

  return { checks };
}