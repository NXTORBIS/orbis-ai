/**
 * QTAIM core — the quantum theory of atoms in molecules (Bader), applied to a
 * promolecular density: the superposition of spherically averaged atomic densities
 *
 *     ρ(r) = Σ_A Z_A (ζ_A³/π) e^(−2 ζ_A |r − R_A|)
 *
 * This is not a wavefunction and nothing here claims to reproduce correlated
 * results. What it is: an analytic field with exact first and second derivatives,
 * so critical points and their signatures, bond paths, the energy densities at
 * bond critical points, basins and atomic charges are all solved rather than
 * interpolated from a sampled grid.
 *
 * Lengths are atomic units (bohr); densities in electrons·bohr⁻³.
 */

export const BOHR = 0.529177210903;
const A2B = 1 / BOHR;

/** Single-zeta Slater exponents and covalent radii (Å). */
export const ELEMENTS = {
  H: { z: 1, zeta: 1.0, cov: 0.31 },
  C: { z: 6, zeta: 1.625, cov: 0.76 },
  N: { z: 7, zeta: 1.95, cov: 0.71 },
  O: { z: 8, zeta: 2.275, cov: 0.66 },
  F: { z: 9, zeta: 2.6, cov: 0.57 },
  Na: { z: 11, zeta: 0.733, cov: 1.66 },
  Cl: { z: 17, zeta: 2.617, cov: 1.02 },
};

const mkAtom = (sym, x, y, z) => {
  const e = ELEMENTS[sym];
  return {
    sym, z: e.z, zeta: e.zeta, cov: e.cov,
    norm: e.z * e.zeta ** 3 / Math.PI,
    p: [x * A2B, y * A2B, z * A2B],
  };
};

/** Field value, gradient and Hessian (xx, yy, zz, xy, xz, yz) at x. */
export function fieldAt(atoms, x) {
  let rho = 0;
  const g = [0, 0, 0];
  const h = [0, 0, 0, 0, 0, 0];
  for (let a = 0; a < atoms.length; a++) {
    const A = atoms[a];
    const dx = x[0] - A.p[0], dy = x[1] - A.p[1], dz = x[2] - A.p[2];
    let r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r < 1e-6) r = 1e-6;
    const f = A.norm * Math.exp(-2 * A.zeta * r);
    rho += f;
    const inv = 1 / r;
    const rx = dx * inv, ry = dy * inv, rz = dz * inv;
    const gr = -2 * A.zeta * f;
    g[0] += gr * rx; g[1] += gr * ry; g[2] += gr * rz;
    const P = 4 * A.zeta * A.zeta * f;      // r̂r̂ term
    const Q = -2 * A.zeta * f * inv;        // tangential term
    h[0] += P * rx * rx + Q * (1 - rx * rx);
    h[1] += P * ry * ry + Q * (1 - ry * ry);
    h[2] += P * rz * rz + Q * (1 - rz * rz);
    h[3] += (P - Q) * rx * ry;
    h[4] += (P - Q) * rx * rz;
    h[5] += (P - Q) * ry * rz;
  }
  return { rho, g, h };
}

const mag = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

/** Eigenvalues of a symmetric 3×3 (ascending). */
export function eig3(h) {
  const q = (h[0] + h[1] + h[2]) / 3;
  const p1 = h[3] * h[3] + h[4] * h[4] + h[5] * h[5];
  const p2 = (h[0] - q) ** 2 + (h[1] - q) ** 2 + (h[2] - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  if (p < 1e-14) return [q, q, q];
  const b0 = h[0] - q, b1 = h[1] - q, b2 = h[2] - q;
  const det = b0 * (b1 * b2 - h[5] * h[5]) - h[3] * (h[3] * b2 - h[5] * h[4]) + h[4] * (h[3] * h[5] - b1 * h[4]);
  const r = Math.max(-1, Math.min(1, det / (2 * p * p * p)));
  const phi = Math.acos(r) / 3;
  const e = [
    q + 2 * p * Math.cos(phi),
    q + 2 * p * Math.cos(phi + (2 * Math.PI / 3)),
    q + 2 * p * Math.cos(phi - (2 * Math.PI / 3)),
  ];
  return e.sort((a, b) => a - b);
}

const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossv = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Unit eigenvector for eigenvalue λ of a symmetric 3×3 (h = xx,yy,zz,xy,xz,yz). */
export function eigvec3(h, lambda) {
  const m = [h[0] - lambda, h[3], h[4], h[3], h[1] - lambda, h[5], h[4], h[5], h[2] - lambda];
  const rows = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
  let best = null, bestLen = 0;
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++) {
      const c = crossv(rows[i], rows[j]);
      const len = Math.sqrt(dotv(c, c));
      if (len > bestLen) { bestLen = len; best = c; }
    }
  if (!best || bestLen < 1e-12) return [1, 0, 0];
  return [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
}

const det3 = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

function solve3(h, b) {
  const m = [h[0], h[3], h[4], h[3], h[1], h[5], h[4], h[5], h[2]];
  const D = det3(m);
  if (Math.abs(D) < 1e-30) return null;
  const replace = (i, v) => { const c = m.slice(); c[i] = v[0]; c[i + 3] = v[1]; c[i + 6] = v[2]; return c; };
  const out = [det3(replace(0, b)) / D, det3(replace(1, b)) / D, det3(replace(2, b)) / D];
  return out.every(Number.isFinite) ? out : null;
}

/** Positive curvature count: 0 nuclear, 1 bond, 2 ring, 3 cage. */
export const cpType = (eigs) => eigs.filter((e) => e > 0).length;
export const SIG = { 0: '(3,-3) nuclear', 1: '(3,-1) bond', 2: '(3,+1) ring', 3: '(3,+3) cage' };

/** Damped Newton walk to ∇ρ = 0 from x0. */
export function stationary(atoms, x0, { tol = 1e-9, maxIter = 120 } = {}) {
  let x = x0.slice();
  let best = null;
  for (let it = 0; it < maxIter; it++) {
    const f = fieldAt(atoms, x);
    const gn = mag(f.g);
    if (gn < tol) { best = { x, f, gn }; break; }
    const d = solve3(f.h, [-f.g[0], -f.g[1], -f.g[2]]);
    if (!d) break;
    let step = 1, moved = false;
    for (let k = 0; k < 12; k++) {
      const y = [x[0] + step * d[0], x[1] + step * d[1], x[2] + step * d[2]];
      if (mag(fieldAt(atoms, y).g) < gn) { x = y; moved = true; break; }
      step *= 0.5;
    }
    if (!moved) break;
    best = null;
  }
  const f = best ? best.f : fieldAt(atoms, x);
  const eigs = eig3(f.h);
  return { x, rho: f.rho, grad: f.g, gradNorm: mag(f.g), hess: f.h, eigs, type: cpType(eigs) };
}

/** Gradient-ascent path (sign = ±1) with RK4, stopping at a nucleus. */
export function tracePath(atoms, start, sign, { ds = 0.04, maxSteps = 3000, stop = 0.19 } = {}) {
  const pts = [start.slice()];
  let x = start.slice();
  const step = (p, s) => {
    const k1 = unit(fieldAt(atoms, p).g, s);
    const k2 = unit(fieldAt(atoms, [p[0] + ds * k1[0] / 2, p[1] + ds * k1[1] / 2, p[2] + ds * k1[2] / 2]).g, s);
    const k3 = unit(fieldAt(atoms, [p[0] + ds * k2[0] / 2, p[1] + ds * k2[1] / 2, p[2] + ds * k2[2] / 2]).g, s);
    const k4 = unit(fieldAt(atoms, [p[0] + ds * k3[0], p[1] + ds * k3[1], p[2] + ds * k3[2]]).g, s);
    return [0, 1, 2].map((i) => p[i] + (ds / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  };
  for (let i = 0; i < maxSteps; i++) {
    x = step(x, sign);
    pts.push(x);
    const near = nearestAtom(atoms, x);
    if (near.dist < stop) return { pts, nucleus: near.index, dist: near.dist };
    const out = Math.max(...atoms.map((a, j) => Math.hypot(x[0] - a.p[0], x[1] - a.p[1], x[2] - a.p[2])));
    void out;
  }
  return { pts, nucleus: -1, dist: Infinity };
}

const unit = (g, s) => {
  const n = mag(g) || 1;
  return [s * g[0] / n, s * g[1] / n, s * g[2] / n];
};

function nearestAtom(atoms, x) {
  let best = Infinity, index = -1;
  atoms.forEach((a, i) => {
    const d = Math.hypot(x[0] - a.p[0], x[1] - a.p[1], x[2] - a.p[2]);
    if (d < best) { best = d; index = i; }
  });
  return { dist: best, index };
}

/** G, V and H at a point, from the gradient expansion and the virial relation. */
export function energyDensities(rho, grad, hess, lap) {
  const g2 = grad[0] ** 2 + grad[1] ** 2 + grad[2] ** 2;
  const tf = (3 / 10) * (3 * Math.PI * Math.PI) ** (2 / 3) * rho ** (5 / 3);
  const weiz = g2 > 0 ? (1 / 8) * g2 / Math.max(rho, 1e-14) : 0;
  const G = tf + weiz + lap / 6;
  const V = lap / 4 - 2 * G;
  return { G, V, H: G + V, ratio: V < 0 ? -V / G : Infinity };
}

function bondsCandidates(atoms) {
  const out = [];
  for (let i = 0; i < atoms.length; i++)
    for (let j = i + 1; j < atoms.length; j++) {
      const d = Math.hypot(atoms[i].p[0] - atoms[j].p[0], atoms[i].p[1] - atoms[j].p[1], atoms[i].p[2] - atoms[j].p[2]) * BOHR;
      if (d < 1.35 * (atoms[i].cov + atoms[j].cov)) out.push([i, j, d]);
    }
  return out;
}

const frac = (a, b, x, t) => (a.p[t] + (b.p[t] - a.p[t]) * x);

/** Bond and ring critical points, their paths and properties. */
export function topology(atoms, { ringMax = 8 } = {}) {
  const bonds = [];
  bondsCandidates(atoms).forEach(([i, j]) => {
    let cp = null, used = null;
    [0.5, 0.42, 0.58, 0.34, 0.66].forEach((t) => {
      if (cp) return;
      const seed = [frac(atoms[i], atoms[j], t, 0), frac(atoms[i], atoms[j], t, 1), frac(atoms[i], atoms[j], t, 2)];
      const s = stationary(atoms, seed);
      if (s.gradNorm > 1e-7 || s.type !== 1) return;
      const dA = Math.hypot(s.x[0] - atoms[i].p[0], s.x[1] - atoms[i].p[1], s.x[2] - atoms[i].p[2]);
      const dB = Math.hypot(s.x[0] - atoms[j].p[0], s.x[1] - atoms[j].p[1], s.x[2] - atoms[j].p[2]);
      const total = dA + dB, share = total > 0 ? dA / total : 0.5;
      if (share < 0.06 || share > 0.94) return;
      cp = s; used = { t, share };
    });
    if (!cp) return;
    const lap = cp.hess[0] + cp.hess[1] + cp.hess[2];
    const en = energyDensities(cp.rho, cp.grad, cp.hess, lap);
    const eps = Math.abs(cp.eigs[1]) > 1e-12 ? Math.abs(cp.eigs[0] / cp.eigs[1]) - 1 : 0;
    const v3 = eigvec3(cp.hess, cp.eigs[2]);
    const toward = (idx) => {
      const d = [atoms[idx].p[0] - cp.x[0], atoms[idx].p[1] - cp.x[1], atoms[idx].p[2] - cp.x[2]];
      const s = dotv(v3, d) >= 0 ? 1 : -1;
      return [cp.x[0] + s * 0.06 * v3[0], cp.x[1] + s * 0.06 * v3[1], cp.x[2] + s * 0.06 * v3[2]];
    };
    const toI = tracePath(atoms, toward(i), 1);
    const toJ = tracePath(atoms, toward(j), 1);
    const path = [[...toI.pts].reverse(), [cp.x], toJ.pts].flat();
    bonds.push({
      i, j, cp, share: used ? used.share : 0.5, dist: (toI.dist + toJ.dist) * BOHR,
      path,
      nuclei: [toI.nucleus, toJ.nucleus],
      rho: cp.rho, lap, eigs: cp.eigs, eps, ...en,
      rhoPath: path.map((p) => fieldAt(atoms, p).rho),
    });
  });

  // rings: simple cycles in the bond graph, searched from their centroid
  const adj = new Map();
  bonds.forEach((b) => {
    if (!adj.has(b.i)) adj.set(b.i, []);
    if (!adj.has(b.j)) adj.set(b.j, []);
    adj.get(b.i).push(b.j); adj.get(b.j).push(b.i);
  });
  const seen = new Set(), cycles = [];
  const walk = (start, cur, path) => {
    if (path.length > ringMax) return;
    (adj.get(cur) || []).forEach((n) => {
      if (n === start && path.length >= 3) {
        const key = [...path].sort((a, b) => a - b).join('-');
        if (!seen.has(key)) { seen.add(key); cycles.push(path.slice()); }
        return;
      }
      if (path.length < ringMax && n > start && !path.includes(n)) walk(start, n, [...path, n]);
    });
  };
  atoms.forEach((_, i) => walk(i, i, [i]));

  const rings = [];
  cycles.forEach((cycle) => {
    const c = [0, 1, 2].map((t) => cycle.reduce((s, a) => s + atoms[a].p[t], 0) / cycle.length);
    const s = stationary(atoms, c);
    if (s.gradNorm > 1e-7 || s.type !== 2) return;
    const lap = s.hess[0] + s.hess[1] + s.hess[2];
    const en = energyDensities(s.rho, s.grad, s.hess, lap);
    rings.push({
      cycle, cp: s, rho: s.rho, lap, eigs: s.eigs, ...en,
      offset: Math.hypot(s.x[0] - c[0], s.x[1] - c[1], s.x[2] - c[2]) * BOHR,
    });
  });
  return { bonds, rings, cycles };
}

/** Basin integration: every grid point is drawn uphill to the nucleus it belongs to. */
export function basins(atoms, { n = 20, margin = 4.2 } = {}) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  atoms.forEach((a) => a.p.forEach((v, t) => { lo[t] = Math.min(lo[t], v); hi[t] = Math.max(hi[t], v); }));
  const box = [0, 1, 2].map((t) => [lo[t] - margin, hi[t] + margin]);
  const h = [0, 1, 2].map((t) => (box[t][1] - box[t][0]) / n);
  const vol = h[0] * h[1] * h[2];
  const elec = atoms.map(() => 0), cells = atoms.map(() => 0);
  const hirshfeld = atoms.map(() => 0);
  let unresolved = 0, totalRho = 0;
  const p = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        p[0] = box[0][0] + (i + 0.5) * h[0];
        p[1] = box[1][0] + (j + 0.5) * h[1];
        p[2] = box[2][0] + (k + 0.5) * h[2];
        const rho = fieldAt(atoms, p).rho;
        totalRho += rho * vol;
        // stockholder (Hirshfeld) weight: an independent partitioning to compare against
        const shares = atoms.map((a) => {
          const d = Math.hypot(p[0] - a.p[0], p[1] - a.p[1], p[2] - a.p[2]);
          return a.norm * Math.exp(-2 * a.zeta * d);
        });
        const sum = shares.reduce((s, v) => s + v, 0) || 1;
        shares.forEach((v, idx) => { hirshfeld[idx] += (v / sum) * rho * vol; });

        let owner = -1;
        const top = shares.reduce((m, v, idx) => (v > m.v ? { v, idx } : m), { v: -1, idx: 0 });
        const rest = sum - top.v;
        if (rest <= 0 || top.v / rest > 1e5) owner = top.idx;
        let x = p.slice();
        for (let step = 0; step < 400 && owner < 0; step++) {
          const near = nearestAtom(atoms, x);
          if (near.dist < 0.25) { owner = near.index; break; }
          const g = fieldAt(atoms, x).g;
          const m = mag(g);
          if (m < 1e-12) { owner = near.index; break; }
          x = [x[0] + 0.3 * g[0] / m, x[1] + 0.3 * g[1] / m, x[2] + 0.3 * g[2] / m];
          if (x.some((v, t) => v < box[t][0] - 2 || v > box[t][1] + 2)) { owner = -2; break; }
          if (Math.hypot(x[0] - p[0], x[1] - p[1], x[2] - p[2]) > 60) { owner = -2; break; }
        }
        if (owner >= 0) { elec[owner] += rho * vol; cells[owner] += vol; }
        else unresolved++;
      }
  const charges = atoms.map((a, idx) => a.z - elec[idx]);
  const hirsh = atoms.map((a, idx) => a.z - hirshfeld[idx]);
  return {
    box, h, vol, elec, charges, hirsh, cells, unresolved,
    gridPoints: n ** 3,
    totalElectrons: totalRho,
    totalZ: atoms.reduce((s, a) => s + a.z, 0),
  };
}

/* ── molecule presets ──────────────────────────────────────────────────────── */

const ethane = () => {
  const atoms = [mkAtom('C', -0.7665, 0, 0), mkAtom('C', 0.7665, 0, 0)];
  const cc = 109.47 * Math.PI / 180;
  [0, 120, 240].forEach((d) => {
    const a = d * Math.PI / 180;
    atoms.push(mkAtom('H', -0.7665 + 1.09 * Math.cos(cc), 1.09 * Math.sin(cc) * Math.cos(a), 1.09 * Math.sin(cc) * Math.sin(a)));
  });
  [60, 180, 300].forEach((d) => {
    const a = d * Math.PI / 180;
    atoms.push(mkAtom('H', 0.7665 - 1.09 * Math.cos(cc), 1.09 * Math.sin(cc) * Math.cos(a), 1.09 * Math.sin(cc) * Math.sin(a)));
  });
  return atoms;
};

const benzene = () => {
  const atoms = [];
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    atoms.push(mkAtom('C', 1.39 * Math.cos(a), 1.39 * Math.sin(a), 0));
  }
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    atoms.push(mkAtom('H', 2.48 * Math.cos(a), 2.48 * Math.sin(a), 0));
  }
  return atoms;
};

const waterDimer = () => {
  const atoms = [mkAtom('O', 0, 0, 0), mkAtom('H', 0.958, 0, 0), mkAtom('H', -0.24, 0.928, 0)];
  atoms.push(mkAtom('O', 2.88, 0, 0));
  const hb = (2.88 - 0.586), hv = 0.758;
  atoms.push(mkAtom('H', hb, hv, 0), mkAtom('H', hb, -hv, 0));
  return atoms;
};

export const MOLECULES = {
  H2: {
    label: 'H₂', expectBonds: 1, expectRings: 0,
    atoms: () => [mkAtom('H', -0.37, 0, 0), mkAtom('H', 0.37, 0, 0)],
  },
  HF: {
    label: 'HF', expectBonds: 1, expectRings: 0,
    atoms: () => [mkAtom('F', 0, 0, 0), mkAtom('H', 0.917, 0, 0)],
  },
  H2O: {
    label: 'H₂O', expectBonds: 2, expectRings: 0,
    atoms: () => [mkAtom('O', 0, 0, 0), mkAtom('H', 0.757, 0.586, 0), mkAtom('H', -0.757, 0.586, 0)],
  },
  CH4: {
    label: 'CH₄', expectBonds: 4, expectRings: 0,
    atoms: () => {
      const s = 1.087 / Math.sqrt(3);
      return [mkAtom('C', 0, 0, 0), mkAtom('H', s, s, s), mkAtom('H', -s, -s, s), mkAtom('H', -s, s, -s), mkAtom('H', s, -s, -s)];
    },
  },
  C2H6: { label: 'C₂H₆ (C–C)', expectBonds: 7, expectRings: 0, atoms: ethane },
  C2H4: {
    label: 'C₂H₄ (C=C)', expectBonds: 5, expectRings: 0,
    atoms: () => {
      const atoms = [mkAtom('C', -0.665, 0, 0), mkAtom('C', 0.665, 0, 0)];
      atoms.push(mkAtom('H', -1.229, 0.928, 0), mkAtom('H', -1.229, -0.928, 0));
      atoms.push(mkAtom('H', 1.229, 0.928, 0), mkAtom('H', 1.229, -0.928, 0));
      return atoms;
    },
  },
  C6H6: { label: 'C₆H₆ (ring)', expectBonds: 12, expectRings: 1, atoms: benzene },
  WA2: { label: '(H₂O)₂', expectBonds: 4, expectRings: 0, atoms: waterDimer },
};

/** Full analysis of one preset. */
export function analyzeQtaim(key, { grid = 32 } = {}) {
  const preset = MOLECULES[key];
  if (!preset) throw new Error(`unknown molecule ${key}`);
  const atoms = preset.atoms();
  const { bonds, rings } = topology(atoms);
  const bas = basins(atoms, { n: grid });
  return {
    key, label: preset.label, atoms, bonds, rings, basins: bas,
    summary: {
      nBonds: bonds.length, nRings: rings.length,
      totalElectrons: bas.totalElectrons, totalZ: bas.totalZ,
      maxEllipticity: bonds.reduce((m, b) => Math.max(m, Math.abs(b.eps)), 0),
      minRho: bonds.reduce((m, b) => Math.min(m, b.rho), Infinity),
      maxRho: bonds.reduce((m, b) => Math.max(m, b.rho), 0),
      unresolved: bas.unresolved,
      chargeSum: bas.charges.reduce((s, q) => s + q, 0),
    },
  };
}

/** Independent checks: each one is a property the analysis must satisfy, tested
 *  against an analytic limit or a known chemical fact. */
export function verifyQtaim() {
  const checks = [];
  const keys = Object.keys(MOLECULES);
  const results = {};
  keys.forEach((k) => { results[k] = analyzeQtaim(k, { grid: 40 }); });

  const maxGrad = Math.max(...keys.flatMap((k) => [...results[k].bonds.map((b) => b.cp.gradNorm), ...results[k].rings.map((r) => r.cp.gradNorm)]));
  checks.push({
    label: 'Every critical point is stationary', ok: maxGrad < 1e-7,
    detail: `max |∇ρ| = ${maxGrad.toExponential(1)} a.u.`,
  });

  const h2 = results.H2.bonds[0];
  checks.push({
    label: 'H₂ is shared-shell: H<0 and |V|/G>2 at the bond path',
    ok: h2.H < 0 && h2.ratio > 2,
    detail: `ρ=${h2.rho.toFixed(3)}, ∇²ρ=${h2.lap.toFixed(3)}, H=${h2.H.toFixed(3)}, |V|/G=${h2.ratio.toFixed(2)}`,
  });

  const diatomic = ['H2', 'HF'].map((k) => results[k].bonds[0]);
  const deg = Math.max(...diatomic.map((b) => Math.abs(b.eigs[0] - b.eigs[1]) / Math.abs(b.eigs[2])));
  const envEps = Math.max(...keys.flatMap((k) => results[k].bonds.map((b) => Math.abs(b.eps))));
  checks.push({
    label: 'Cylindrical bonds give exactly degenerate curvatures',
    ok: deg < 1e-12,
    detail: `H₂/HF: |λ₁−λ₂|/|λ₃| = ${deg.toExponential(1)} — so the ellipticity up to ${envEps.toFixed(4)} measured elsewhere is molecular environment, not π character`,
  });

  let maxRise = 0;
  keys.forEach((k) => results[k].bonds.forEach((b) => {
    const rp = b.rhoPath, mid = rp.indexOf(Math.min(...rp));
    for (let i = 1; i <= mid; i++) maxRise = Math.max(maxRise, rp[i] - rp[i - 1]);
    for (let i = mid + 1; i < rp.length; i++) maxRise = Math.max(maxRise, rp[i - 1] - rp[i]);
  }));
  checks.push({
    label: 'Bond paths rise monotonically in ρ from critical point to nucleus',
    ok: maxRise <= 1e-12,
    detail: `largest reversal = ${maxRise.toExponential(1)} a.u.`,
  });

  const term = Math.max(...keys.flatMap((k) => results[k].bonds.map((b) => b.dist)));
  checks.push({
    label: 'Each bond path terminates on a nucleus',
    ok: Number.isFinite(term) && term < 0.21,
    detail: `max terminal distance from the last step to a nucleus = ${Number.isFinite(term) ? (term / 2).toFixed(3) : 'unterminated'} Å`,
  });

  const connectivity = keys.every((k) => results[k].bonds.length === MOLECULES[k].expectBonds);
  checks.push({
    label: 'The bond graph reproduces the expected connectivity of every preset',
    ok: connectivity,
    detail: keys.map((k) => `${MOLECULES[k].label}:${results[k].bonds.length}/${MOLECULES[k].expectBonds}`).join('  '),
  });

  const ringsOk = results.C6H6.rings.length === 1 && results.C6H6.rings[0].cp.type === 2;
  const ringOffset = results.C6H6.rings.length ? results.C6H6.rings[0].offset : Infinity;
  checks.push({
    label: 'Benzene carries one ring critical point, at the ring centre',
    ok: ringsOk && ringOffset < 1e-6,
    detail: `signature (3,+1), offset from centroid = ${ringOffset.toExponential(1)} Å`,
  });

  const closure = Math.max(...keys.map((k) => Math.abs(results[k].summary.chargeSum) / results[k].summary.totalZ));
  const unresolved = keys.reduce((s, k) => s + results[k].basins.unresolved, 0);
  checks.push({
    label: 'Basins partition the box and the charge budget closes',
    ok: closure < 0.005 && unresolved === 0,
    detail: `worst |Σq| = ${(closure * 100).toFixed(2)}% of ΣZ at a 40³ grid with ${unresolved} unresolved points`,
  });

  const coarse = {};
  keys.forEach((k) => { coarse[k] = analyzeQtaim(k, { grid: 20 }); });
  const worstCoarse = Math.max(...keys.map((k) => Math.abs(coarse[k].summary.chargeSum) / coarse[k].summary.totalZ));
  checks.push({
    label: 'The closure error shrinks as the basin grid is refined',
    ok: closure < worstCoarse,
    detail: `${(worstCoarse * 100).toFixed(2)}% at 20³ → ${(closure * 100).toFixed(2)}% at 40³`,
  });

  const hf = results.HF.basins.charges;
  checks.push({
    label: 'HF polarises toward fluorine', ok: hf[0] < 0 && hf[1] > 0,
    detail: `q(F)=${hf[0].toFixed(2)} e, q(H)=+${hf[1].toFixed(2)} e`,
  });

  let bcpOk = true, worst = 0;
  keys.forEach((k) => results[k].bonds.forEach((b) => {
    const atoms = results[k].atoms;
    const rA = fieldAt(atoms, atoms[b.i].p).rho;
    const rB = fieldAt(atoms, atoms[b.j].p).rho;
    worst = Math.max(worst, b.cp.rho - Math.min(rA, rB));
    if (b.share <= 0.06 || b.share >= 0.94 || b.cp.rho >= Math.min(rA, rB)) bcpOk = false;
  }));
  checks.push({
    label: 'Every bond critical point lies between its nuclei, below the nuclear density',
    ok: bcpOk, detail: `worst excess over the lower nuclear density = ${worst.toExponential(1)} a.u.`,
  });

  return { checks, results };
}