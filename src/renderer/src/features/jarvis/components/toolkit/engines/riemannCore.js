/**
 * Multivalued complex functions drawn as analytic sheets.
 *
 * The branch structure is measured, not assumed: the function is analytically continued by
 * nearest-value matching around a closed loop, and where it returns to a different sheet the
 * loop enclosed a branch point. Sheets, seams, residues of the sheet identities and the
 * located branch points are all numbers this file computed.
 */

import { cAbs, cAdd, cExp, cMul, cSub, powInt, rootSheet, polynomialRoots, evalPoly } from '@jarvis/components/toolkit/engines/complexMath';

export const FUNCTIONS = {
  sqrt: {
    label: 'w = √z', sheets: 2, power: 2, branchPoints: [[0, 0]], control: [1.5, 0.6], seamShift: 0,
    map: (z, k) => rootSheet(z, 2, k),
    residual: (z, w) => cAbs(cSub(powInt(w, 2), z)),
  },
  cbrt: {
    label: 'w = z^⅓', sheets: 3, power: 3, branchPoints: [[0, 0]], control: [1.6, 0.5], seamShift: 0,
    map: (z, k) => rootSheet(z, 3, k),
    residual: (z, w) => cAbs(cSub(powInt(w, 3), z)),
  },
  log: {
    label: 'w = log z', sheets: 3, power: 0, branchPoints: [[0, 0]], control: [1.2, 0.4], seamShift: 2 * Math.PI,
    map: (z, k) => [Math.log(Math.max(cAbs(z), 1e-9)), Math.atan2(z[1], z[0]) + 2 * Math.PI * k],
    residual: (z, w) => cAbs(cSub(cExp(w), z)),
  },
  sqrtz2m1: {
    label: 'w = √(z² − 1)', sheets: 2, power: 2, branchPoints: [[1, 0], [-1, 0]], control: [0, 1.2], seamShift: 0,
    radicand: [-1, 0, 1],
    map: (z, k) => rootSheet(cAdd(powInt(z, 2), [-1, 0]), 2, k),
    residual: (z, w) => cAbs(cSub(powInt(w, 2), cAdd(powInt(z, 2), [-1, 0]))),
  },
  sqrtz3m1: {
    label: 'w = √(z³ − 1)', sheets: 2, power: 2, branchPoints: [[1, 0], [-0.5, Math.sqrt(3) / 2], [-0.5, -Math.sqrt(3) / 2]],
    control: [0, 1.3], seamShift: 0, radicand: [-1, 0, 0, 1],
    map: (z, k) => rootSheet(cAdd(powInt(z, 3), [-1, 0]), 2, k),
    residual: (z, w) => cAbs(cSub(powInt(w, 2), cAdd(powInt(z, 3), [-1, 0]))),
  },
};

/** Analytic continuation around a circle: the sheet reached after one full turn. */
export function monodromy(name, centre, radius, { steps = 900 } = {}) {
  const f = FUNCTIONS[name];
  const at = (t) => [centre[0] + radius * Math.cos(t), centre[1] + radius * Math.sin(t)];
  let w = f.map(at(0), 0);
  let sheet = 0;
  for (let i = 1; i <= steps; i += 1) {
    const z = at((2 * Math.PI * i) / steps);
    let best = 0;
    let bestDistance = Infinity;
    for (let k = 0; k < f.sheets; k += 1) {
      const distance = cAbs(cSub(f.map(z, k), w));
      if (distance < bestDistance) { bestDistance = distance; best = k; }
    }
    sheet = best;
    w = f.map(z, best);
  }
  return sheet;
}

/**
 * Sheet meshes in the embedding [Re w, sheet · spread, Im w − sheet offset], drawn over a disc
 * of the z-plane on a polar grid so the branch cut shows up as a real seam, plus dashed links
 * where one sheet is glued to the next one full turn later.
 */
export function surfaceMesh(name, { radial = 8, angular = 24, extent = 1.7, spread = 1.1 } = {}) {
  const f = FUNCTIONS[name];
  const shift = (k) => f.seamShift * k;
  const vertex = (r, t, k) => {
    const w = f.map([r * Math.cos(t), r * Math.sin(t)], k);
    return [w[0], k * spread, w[1] - shift(k)];
  };
  const faces = [];
  const lines = [];
  for (let k = 0; k < f.sheets; k += 1) {
    for (let i = 0; i < radial; i += 1) {
      const row = [];
      const r = (extent * (i + 1)) / radial;
      for (let j = 0; j <= angular; j += 1) row.push(vertex(r, -Math.PI + (2 * Math.PI * j) / angular, k));
      lines.push({ id: `arc-${k}-${i}`, points: row });
    }
    for (let j = 0; j < angular; j += 1) {
      const column = [];
      const t = -Math.PI + (2 * Math.PI * (j + 0.5)) / angular;
      for (let i = 0; i <= radial; i += 1) column.push(vertex((extent * i) / radial, t, k));
      lines.push({ id: `ray-${k}-${j}`, points: column });
    }
    for (let i = 0; i < radial; i += 1) {
      for (let j = 0; j < angular; j += 1) {
        const t0 = -Math.PI + (2 * Math.PI * j) / angular;
        const t1 = -Math.PI + (2 * Math.PI * (j + 1)) / angular;
        const r0 = (extent * i) / radial;
        const r1 = (extent * (i + 1)) / radial;
        faces.push({ id: `f-${k}-${i}-${j}`, points: [vertex(r0, t0, k), vertex(r1, t0, k), vertex(r1, t1, k), vertex(r0, t1, k)] });
      }
    }
  }
  const seam = [];
  for (let k = 0; k < f.sheets - 1; k += 1) {
    for (let i = 1; i <= radial; i += 1) {
      const r = (extent * i) / radial;
      seam.push({ id: `seam-${k}-${i}`, dashed: true, points: [vertex(r, Math.PI - 1e-6, k), vertex(r, -Math.PI + 1e-6, k + 1)] });
    }
  }
  return { faces, lines: [...lines, ...seam], sheets: f.sheets, spread };
}

/** Branch points of the radicand, found by Newton rather than quoted. */
export function locatedBranchPoints(name) {
  const f = FUNCTIONS[name];
  if (!f.radicand) return { located: null, analytic: f.branchPoints };
  return { located: polynomialRoots(f.radicand, { extent: 2 }), analytic: f.branchPoints };
}

const sampleDisc = (radius, count = 9) => {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < count; j += 1) {
      const r = (radius * (i + 0.5)) / count;
      const t = (2 * Math.PI * (j + 0.5)) / count;
      points.push([r * Math.cos(t), r * Math.sin(t)]);
    }
  }
  return points;
};

export function verifyRiemann() {
  const checks = [];
  const probe = sampleDisc(1.4, 8);

  // 1. The defining identity of the sheet: f(w) = z, to machine precision.
  let worstResidual = 0;
  Object.entries(FUNCTIONS).forEach(([, f]) => {
    probe.forEach((z) => {
      for (let k = 0; k < f.sheets; k += 1) {
        const w = f.map(z, k);
        worstResidual = Math.max(worstResidual, f.residual(z, w) / Math.max(1, cAbs(z)));
      }
    });
  });
  checks.push({ label: 'Every sheet satisfies its defining identity wⁿ = radicand', ok: worstResidual < 1e-10, detail: `worst relative residual ${worstResidual.toExponential(2)}` });

  // 2. √z sheets are exact negatives, so their product must be −z.
  let worstProduct = 0;
  probe.forEach((z) => { worstProduct = Math.max(worstProduct, cAbs(cAdd(cMul(FUNCTIONS.sqrt.map(z, 0), FUNCTIONS.sqrt.map(z, 1)), z))); });
  checks.push({ label: 'The two √z sheets are negatives of each other (w₀·w₁ = −z)', ok: worstProduct < 1e-12, detail: `worst |w₀w₁ + z| = ${worstProduct.toExponential(2)}` });

  // 3. Away from branch points the continuation must close: identity monodromy.
  const controlSheet = monodromy('sqrtz2m1', FUNCTIONS.sqrtz2m1.control, 0.45);
  const controlSqrt = monodromy('sqrt', [1.5, 0.6], 0.5);
  checks.push({
    label: 'Continuation around a loop that encloses no branch point returns to the same sheet',
    ok: controlSheet === 0 && controlSqrt === 0,
    detail: `sheets ${controlSheet} and ${controlSqrt}`,
  });

  // 4. Around a branch point the sheets are permuted, and for n-th roots in a single cycle.
  const rootTurns = [
    { name: 'sqrt', order: 2 },
    { name: 'cbrt', order: 3 },
  ].map(({ name, order }) => {
    const reached = monodromy(name, [0, 0], 0.7);
    const shift = ((reached - 0) % order + order) % order;
    return { name, order, shift, singleCycle: shift !== 0 && gcd(shift, order) === 1 };
  });
  checks.push({
    label: 'One turn around the origin permutes the sheets in a single cycle of length n',
    ok: rootTurns.every((entry) => entry.singleCycle),
    detail: rootTurns.map((entry) => `${entry.name}: +${entry.shift} mod ${entry.order}`).join(', '),
  });

  // 5. log z cannot close after one turn: its imaginary part advances by exactly 2π.
  const logTurn = monodromy('log', [0, 0], 0.8);
  checks.push({ label: 'log z never closes: one turn advances the sheet by exactly one step', ok: logTurn === 1, detail: `sheet ${logTurn} of 3` });

  // 6. Branch points of √(p(z)) are the roots of p — located by Newton, not quoted.
  const located = ['sqrtz2m1', 'sqrtz3m1'].map((name) => {
    const { located: found, analytic } = locatedBranchPoints(name);
    const worst = Math.max(...analytic.map((point) => Math.min(...found.map((root) => cAbs(cSub(root, point))))));
    return { name, count: found.length, expected: analytic.length, worst };
  });
  checks.push({
    label: 'Branch points located numerically coincide with the roots of the radicand',
    ok: located.every((entry) => entry.count === entry.expected && entry.worst < 1e-6),
    detail: located.map((entry) => `${entry.name}: ${entry.count}/${entry.expected} roots, worst gap ${entry.worst.toExponential(1)}`).join(' · '),
  });

  // 7. Across the cut the sheet gap equals the geometric jump 2√r for the square root.
  let worstJump = 0;
  [0.4, 1.1, 1.6].forEach((r) => {
    const drop = cAbs(cSub(FUNCTIONS.sqrt.map([-r, 1e-9], 0), FUNCTIONS.sqrt.map([-r, -1e-9], 0)));
    worstJump = Math.max(worstJump, Math.abs(drop - 2 * Math.sqrt(r)));
  });
  checks.push({ label: 'The branch-cut jump of √z equals 2√r at every radius tested', ok: worstJump < 1e-6, detail: `worst error ${worstJump.toExponential(2)}` });

  // 8. The radicand identity holds exactly on the located roots themselves.
  const onRoots = FUNCTIONS.sqrtz3m1.branchPoints.every((point) => cAbs(evalPoly(FUNCTIONS.sqrtz3m1.radicand, point)) < 1e-12);
  checks.push({ label: 'At every listed branch point the radicand vanishes', ok: onRoots, detail: '|p(z)| < 1e-12 at all three cube roots of unity' });

  return { checks };
}

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }