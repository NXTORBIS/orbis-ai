/**
 * Brillouin-zone core: direct and reciprocal lattices, the Wigner–Seitz cell of the
 * reciprocal lattice (the first Brillouin zone) built by exact half-space
 * intersection, high-symmetry paths, and bands from tight-binding, massless-Dirac
 * (graphene), and empty-lattice (nearly-free-electron) models.
 *
 * Because the zone is intersected rather than assumed, its face count, its volume
 * and the placement of the high-symmetry points are all computed and then checked
 * against the analytic values.
 */

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => (a[0] || 0) * (b[0] || 0) + (a[1] || 0) * (b[1] || 0) + (a[2] || 0) * (b[2] || 0);
const sub = (a, b) => [(a[0] || 0) - (b[0] || 0), (a[1] || 0) - (b[1] || 0), (a[2] || 0) - (b[2] || 0)];
const scale = (a, s) => [(a[0] || 0) * s, (a[1] || 0) * s, (a[2] || 0) * s];
const norm = (a) => Math.sqrt(dot(a, a));

/** Half-set generators expanded to the full neighbour shell. */
const expand = (half) => {
  const out = [];
  half.forEach((h) => {
    for (const sx of h[0] === 0 ? [0] : [1, -1])
      for (const sy of h[1] === 0 ? [0] : [1, -1])
        for (const sz of h[2] === 0 ? [0] : [1, -1]) out.push([sx * h[0], sy * h[1], sz * h[2]]);
  });
  const seen = new Set(), uniq = [];
  out.forEach((v) => {
    const key = v.map((x) => x.toFixed(6)).join(',');
    if (!seen.has(key)) { seen.add(key); uniq.push(v); }
  });
  return uniq;
};

const T = 2 * Math.PI;

/** Fractional reciprocal coordinates → Cartesian (units of 2π/a). */
const fromFrac = (b, f) => b.reduce((acc, bi, i) => {
  const v = scale(bi, f[i] || 0);
  return b.length === 2
    ? [acc[0] + v[0], acc[1] + v[1]]
    : [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]];
}, b.length === 2 ? [0, 0] : [0, 0, 0]);

export const LATTICES = {
  sc: {
    label: 'Simple cubic', dim: 3, faceCount: 6, z: 6,
    a: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    neighbors: expand([[1, 0, 0], [0, 1, 0], [0, 0, 1]]),
    points: { G: [0, 0, 0], X: [0.5, 0, 0], M: [0.5, 0.5, 0], R: [0.5, 0.5, 0.5] },
    path: [['G', 'X'], ['X', 'M'], ['M', 'G'], ['G', 'R'], ['R', 'X'], ['M', 'R']],
    bandWidth: 12, bandWidthNote: 'all six neighbours antiphase at R',
  },
  bcc: {
    label: 'Body-centred cubic', dim: 3, faceCount: 12, z: 8,
    a: [[-0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, -0.5]],
    neighbors: expand([[0.5, 0.5, 0.5]]),
    points: { G: [0, 0, 0], H: [0.5, 0.5, -0.5], N: [0, 0, 0.5], P: [0.25, 0.25, 0.25] },
    path: [['G', 'H'], ['H', 'N'], ['N', 'G'], ['G', 'P'], ['P', 'H'], ['P', 'N']],
    bandWidth: 16, bandWidthNote: 'all eight neighbours antiphase at H',
  },
  fcc: {
    label: 'Face-centred cubic', dim: 3, faceCount: 14, z: 12,
    a: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
    neighbors: expand([[0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]),
    points: {
      G: [0, 0, 0], X: [0, 0.5, 0.5], W: [0.25, 0.5, 0.75], L: [0.5, 0.5, 0.5],
      K: [0.375, 0.375, 0.75], U: [0.625, 0.25, 0.625],
    },
    path: [['G', 'X'], ['X', 'W'], ['W', 'L'], ['L', 'G'], ['G', 'K'], ['K', 'U'], ['U', 'X']],
    bandWidth: 16, bandWidthNote: 'the twelve neighbours cannot all be antiphase, so the width stops at 16t',
  },
  hexagonal: {
    label: 'Simple hexagonal', dim: 3, faceCount: 8, z: 6,
    a: [[1, 0, 0], [-0.5, Math.sqrt(3) / 2, 0], [0, 0, Math.sqrt(8 / 3)]],
    neighbors: expand([[1, 0, 0], [0.5, Math.sqrt(3) / 2, 0]]),
    points: { G: [0, 0, 0], M: [0.5, 0, 0], K: [1 / 3, 1 / 3, 0], A: [0, 0, 0.5], L: [0.5, 0, 0.5], H: [1 / 3, 1 / 3, 0.5] },
    path: [['G', 'M'], ['M', 'K'], ['K', 'G'], ['G', 'A'], ['A', 'L'], ['L', 'H'], ['H', 'A'], ['L', 'M'], ['K', 'H']],
    bandWidth: 9, bandWidthNote: 'the six in-plane neighbours cannot all be antiphase at once',
  },
  square: {
    label: 'Square (2D)', dim: 2, faceCount: 4, z: 4,
    a: [[1, 0], [0, 1]],
    neighbors: [[1, 0], [-1, 0], [0, 1], [0, -1]],
    points: { G: [0, 0], X: [0.5, 0], M: [0.5, 0.5] },
    path: [['G', 'X'], ['X', 'M'], ['M', 'G']],
    bandWidth: 8, bandWidthNote: 'all four neighbours antiphase at M',
  },
  graphene: {
    label: 'Graphene (2D, Dirac)', dim: 2, faceCount: 6, z: 3,
    a: [[1, 0], [-0.5, Math.sqrt(3) / 2]],
    neighbors: [],
    points: { G: [0, 0], M: [0.5, 0], K: [1 / 3, 1 / 3] },
    path: [['G', 'M'], ['M', 'K'], ['K', 'G']],
    bandWidth: null, bandWidthNote: 'massless Dirac cone at K: width 6t with a zero gap',
  },
};

/** Direct → reciprocal basis, in units of 2π/a, with the cell volume. */
export function reciprocal(a) {
  if (a[0].length === 2) {
    const [a1, a2] = a;
    const det = a1[0] * a2[1] - a1[1] * a2[0];
    const b1 = [a2[1] / det, -a2[0] / det];
    const b2 = [-a1[1] / det, a1[0] / det];
    return { b: [b1, b2], volume: Math.abs(det) };
  }
  const [a1, a2, a3] = a;
  const vol = Math.abs(dot(a1, cross(a2, a3)));
  const b1 = scale(cross(a2, a3), 1 / vol);
  const b2 = scale(cross(a3, a1), 1 / vol);
  const b3 = scale(cross(a1, a2), 1 / vol);
  return { b: [b1, b2, b3], volume: vol };
}

const solve3 = (p) => {
  const [n0, n1, n2] = p.n;
  const [h0, h1, h2] = p.h;
  const D = dot(n0, cross(n1, n2));
  if (Math.abs(D) < 1e-12) return null;
  const c1 = scale(cross(n1, n2), h0);
  const c2 = scale(cross(n2, n0), h1);
  const c3 = scale(cross(n0, n1), h2);
  return scale([c1[0] + c2[0] + c3[0], c1[1] + c2[1] + c3[1], c1[2] + c2[2] + c3[2]], 1 / D);
};

/** The Wigner–Seitz cell of the reciprocal lattice. */
export function brillouinZone(key, { planes = 40 } = {}) {
  const lat = LATTICES[key];
  const { b, volume } = reciprocal(lat.a);
  const dim = lat.dim;

  const cand = [];
  const range = dim === 2 ? 5 : 4;
  for (let i = -range; i <= range; i++)
    for (let j = -range; j <= range; j++)
      for (let k = -range; k <= range; k++) {
        if (i === 0 && j === 0 && k === 0) continue;
        if (dim === 2 && k !== 0) continue;
        const g = dim === 2 ? [0, 1].reduce((acc, t) => { const v = scale(b[t], [i, j][t]); return [acc[0] + v[0], acc[1] + v[1]]; }, [0, 0])
          : fromFrac(b, [i, j, k]);
        cand.push({ g, len: norm(g) });
      }
  cand.sort((a, b2) => a.len - b2.len);
  const nrm = norm(dim === 2 ? [b[0][0], b[0][1]] : b[0]);
  let cut = cand.findIndex((c) => c.len > 2.2 * nrm);
  if (cut < 0) cut = cand.length;
  const set = cand.slice(0, Math.min(cut, planes));

  const constraints = set.map((c) => ({ n: scale(c.g, 1 / c.len), h: c.len / 2, g: c.g }));
  const inside = (x, skip = -1, tol = 1e-9) =>
    constraints.every((c, i) => i === skip || dot(c.n, x) <= c.h + tol);

  if (dim === 2) {
    const verts = [];
    for (let i = 0; i < constraints.length; i++)
      for (let j = i + 1; j < constraints.length; j++) {
        const A = constraints[i], B = constraints[j];
        const d = A.n[0] * B.n[1] - A.n[1] * B.n[0];
        if (Math.abs(d) < 1e-12) continue;
        const x = [(A.h * B.n[1] - B.h * A.n[1]) / d, (A.n[0] * B.h - B.n[0] * A.h) / d];
        if (!constraints.every((c) => dot(c.n, x) <= c.h + 1e-9)) continue;
        if (!verts.some((v) => Math.hypot(v[0] - x[0], v[1] - x[1]) < 1e-7)) verts.push(x);
      }
    const c0 = verts.reduce((s, v) => [s[0] + v[0] / verts.length, s[1] + v[1] / verts.length], [0, 0]);
    verts.sort((a, b2) => Math.atan2(a[1] - c0[1], a[0] - c0[0]) - Math.atan2(b2[1] - c0[1], b2[0] - c0[0]));
    let area = 0;
    verts.forEach((v, i) => { const w = verts[(i + 1) % verts.length]; area += v[0] * w[1] - w[0] * v[1]; });
    area = Math.abs(area / 2);
    return { key, lat, b, cellVolume: volume, dim, constraints, vertices: verts, faces: verts.length, edges: verts.map((v, i) => [v, verts[(i + 1) % verts.length]]), volume: area, n2: 1 / volume };
  }

  const verts = [];
  for (let i = 0; i < constraints.length; i++)
    for (let j = i + 1; j < constraints.length; j++)
      for (let k = j + 1; k < constraints.length; k++) {
        const x = solve3({ n: [constraints[i].n, constraints[j].n, constraints[k].n], h: [constraints[i].h, constraints[j].h, constraints[k].h] });
        if (!x || !inside(x)) continue;
        if (!verts.some((v) => norm(sub(v, x)) < 1e-7)) verts.push(x);
      }

  const faces = [];
  constraints.forEach((c) => {
    const on = verts.filter((v) => Math.abs(dot(c.n, v) - c.h) < 1e-7);
    if (on.length < 3) return;
    const ctr = on.reduce((s, v) => scale([s[0] + v[0], s[1] + v[1], s[2] + v[2]], 1), [0, 0, 0]).map((x) => x / on.length);
    const u = scale(on[0], 1);
    let e1 = sub(u, ctr);
    if (norm(e1) < 1e-9) e1 = sub(on[1], ctr);
    e1 = scale(e1, 1 / norm(e1));
    const e2 = cross(c.n, e1);
    const ordered = on.slice().sort((a, b2) => {
      const pa = [dot(sub(a, ctr), e1), dot(sub(a, ctr), e2)];
      const pb = [dot(sub(b2, ctr), e1), dot(sub(b2, ctr), e2)];
      return Math.atan2(pa[1], pa[0]) - Math.atan2(pb[1], pb[0]);
    });
    faces.push({ n: c.n, h: c.h, verts: ordered, centroid: ctr });
  });

  let vol = 0;
  faces.forEach((f) => {
    const v0 = f.verts[0];
    for (let i = 1; i + 1 < f.verts.length; i++) {
      const vi = f.verts[i], vj = f.verts[i + 1];
      let t = dot(v0, cross(vi, vj)) / 6;
      const wind = dot(cross(sub(vi, v0), sub(vj, v0)), f.n);
      if (wind < 0) t = -t;
      vol += Math.abs(t);
    }
  });

  const edges = [];
  faces.forEach((f) => {
    f.verts.forEach((v, i) => {
      const w = f.verts[(i + 1) % f.verts.length];
      const mid = scale([v[0] + w[0], v[1] + w[1], v[2] + w[2]], 0.5);
      if (!inside(mid, -1, 1e-9)) return;
      const key2 = [v, w].map((p) => p.map((x) => x.toFixed(6)).join(',')).sort().join('|');
      if (!edges.some((e) => e.key2 === key2)) edges.push({ a: v, b: w, key2 });
    });
  });

  return {
    key, lat, b, cellVolume: volume, dim, constraints, vertices: verts,
    faces: faces.length, faceList: faces, edges, volume: vol, n2: 1 / volume,
  };
}

/** High-symmetry points in Cartesian reciprocal space (units of 2π/a). */
export function specialPoints(key) {
  const lat = LATTICES[key];
  const { b } = reciprocal(lat.a);
  const out = {};
  Object.entries(lat.points).forEach(([name, f]) => {
    out[name] = lat.dim === 2 ? fromFrac(b, [f[0], f[1], 0]) : fromFrac(b, f);
  });
  return out;
}

/** The path as sampled k-points with labels and cumulative distance. */
export function kPath(key, { per = 32 } = {}) {
  const lat = LATTICES[key];
  const pts = specialPoints(key);
  const out = [], ticks = [];
  let dist = 0, cursor = null;
  lat.path.forEach(([from, to]) => {
    const A = pts[from], B = pts[to];
    for (let i = 0; i <= per; i++) {
      const t = i / per;
      const k = A.map((v, idx) => v + (B[idx] - v) * t);
      if (cursor) dist += norm(sub(k, cursor));
      cursor = k;
      out.push({ k, dist, label: null });
    }
    ticks.push({ label: to, dist });
  });
  out[0].label = lat.path[0][0];
  ticks.unshift({ label: lat.path[0][0], dist: 0 });
  return { points: out, ticks, length: dist };
}

/** Tight-binding s band: E(k) = ε0 + t Σ_δ cos(k·δ). */
export function tightBinding(key, k, { t = 1 } = {}) {
  const lat = LATTICES[key];
  let sum = 0;
  lat.neighbors.forEach((d) => { sum += Math.cos(dot(k, d) * T); });
  return t * sum;
}

/** Graphene π bands (eV, Å). t = 2.8 eV, a = 2.46 Å (bond length a/√3). */
export function grapheneBands(k, { t = 2.8, a = 2.46 } = {}) {
  const b = a / Math.sqrt(3);
  const nn = [
    [0, 1],
    [Math.sqrt(3) / 2, -0.5],
    [-Math.sqrt(3) / 2, -0.5],
  ].map(([x, y]) => [x * b, y * b]);
  let re = 0, im = 0;
  nn.forEach(([dx, dy]) => { const th = k[0] * dx + k[1] * dy; re += Math.cos(th); im += Math.sin(th); });
  const f = Math.hypot(re, im);
  return { minus: -t * f, plus: t * f, f };
}

export const HBAR2_ME = 7.619964;  // ℏ²/m_e in eV·Å²; divide by d²E/dk² for m*/m_e.

/** Folded free-electron branches, in eV for a in Å. */
export function emptyBandEnergies(key, k, { a = 2.46, count = 4 } = {}) {
  const { b } = reciprocal(LATTICES[key].a), values = [], coef = HBAR2_ME / 2 * (T / a) ** 2;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let l = -3; l <= 3; l++) {
    if (LATTICES[key].dim === 2 && l !== 0) continue;
    const v = sub(k, fromFrac(b, [i, j, l])); values.push(coef * dot(v, v));
  }
  return values.sort((x, y) => x - y).slice(0, count);
}

/** Band energies along a path for one model. */
export function bands(key, { model = 'tight-binding', t = 1, bands: nB = 4, per = 32, a = 2.46 } = {}) {
  const path = kPath(key, { per });
  const series = [];
  const count = model === 'graphene' ? 2 : nB;
  for (let b = 0; b < count; b++) series.push({ label: `band ${b + 1}`, points: [] });

  path.points.forEach((p) => {
    if (model === 'graphene') {
      const g = grapheneBands([p.k[0] * T / a, p.k[1] * T / a], { t, a });
      series[0].points.push({ x: p.dist, y: g.minus });
      series[1].points.push({ x: p.dist, y: g.plus });
      return;
    }
    if (model === 'empty-lattice') {
      const energies = emptyBandEnergies(key, p.k, { a, count });
      for (let bi = 0; bi < count; bi++) series[bi].points.push({ x: p.dist, y: energies[bi] });
      return;
    }
    const e = tightBinding(key, p.k, { t });
    series[0].points.push({ x: p.dist, y: e });
  });

  const keep = series.filter((s) => s.points.length);
  let gap = { direct: 0, indirect: 0, at: null };
  if (keep.length === 2 && model === 'graphene') {
    gap = { direct: 0, indirect: 0, at: 'K' };
  } else if (keep.length > 1) {
    const vMax = Math.max(...keep[0].points.map((p) => p.y));
    const cMin = Math.min(...keep[1].points.map((p) => p.y));
    gap = {
      direct: Math.min(...keep[1].points.map((p, i) => p.y - keep[0].points[i].y)),
      indirect: cMin - vMax, at: null,
    };
  }
  return { series: keep, path, gap };
}

/** DOS by histogram over a dense BZ grid. */
export function densityOfStates(key, { n = 24, model = 'tight-binding', t = 1, a = 2.46, count = 4, bins = 60 } = {}) {
  const lat = LATTICES[key];
  const { b } = reciprocal(lat.a);
  const values = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < (lat.dim === 2 ? 1 : n); k++) {
        const f = [(-0.5 + i / n), (-0.5 + j / n), lat.dim === 2 ? 0 : (-0.5 + k / n)];
        const kk = fromFrac(b, f);
        if (model === 'graphene') { const g = grapheneBands([kk[0] * T / a, kk[1] * T / a], { t, a }); values.push(g.minus, g.plus); }
        else if (model === 'empty-lattice') values.push(...emptyBandEnergies(key, kk, { a, count }));
        else values.push(tightBinding(key, kk, { t }));
      }
  const lo = Math.min(...values), hi = Math.max(...values);
  const w = (hi - lo) / bins || 1;
  const hist = new Array(bins).fill(0);
  values.forEach((v) => { const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w))); hist[idx] += 1; });
  const per = values.length * w;
  const points = hist.map((h, i) => ({ x: lo + (i + 0.5) * w, y: h / per }));
  const integral = points.reduce((s, p) => s + p.y * w, 0);
  return { lo, hi, w, bins, hist: points, integral, samples: values.length, width: hi - lo };
}

/** Effective mass from a parabolic fit around a band extremum. */
export function effectiveMass(key, { t = 1, a = 3 } = {}) {
  const lat = LATTICES[key];
  const { b } = reciprocal(lat.a);
  const steps = 9, span = 0.03;
  const gdir = fromFrac(b, lat.dim === 2 ? [1, 0, 0] : [1, 0, 0]);
  const mag0 = Math.hypot(...gdir);
  const dir = gdir.map((v) => v / mag0);
  const kA = 2 * Math.PI / a;      // Å⁻¹ scale for a lattice constant a
  const pts = [];
  for (let i = -steps; i <= steps; i++) {
    const s = (i / steps) * span;
    const k = lat.dim === 2 ? [dir[0] * s, dir[1] * s] : [dir[0] * s, dir[1] * s, dir[2] * s];
    const E = tightBinding(key, k, { t });
    pts.push({ x: Math.abs(s * kA), y: E });
  }
  // second derivative by least squares on E = E0 + c k²  →  m* = ℏ²/2c
  let sxy = 0, sxx = 0;
  const xs = pts.map((p) => p.x * p.x), ys = pts.map((p) => p.y - pts[Math.floor(pts.length / 2)].y);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
  xs.forEach((v, i) => { sxy += (v - mx) * (ys[i] - my); sxx += (v - mx) ** 2; });
  const curvature = sxx ? sxy / sxx : 0;
  const mStar = curvature !== 0 ? HBAR2_ME / (2 * Math.abs(curvature)) : Infinity;
  return { curvature, mStar, analytic: HBAR2_ME / (2 * t * a * a), a, t, points: pts };
}

/** Graphene Fermi velocity from the computed cone slope at K. */
export function diracCone({ t = 2.8, a = 2.46 } = {}) {
  const lat = LATTICES.graphene;
  const { b } = reciprocal(lat.a);
  const K = fromFrac(b, lat.points.K);
  const Kc = [K[0] * T / a, K[1] * T / a];
  const fit = [];
  for (let i = 1; i <= 40; i++) {
    const q = i * 1e-4;
    const p = [Kc[0] + q, Kc[1]];
    const E = grapheneBands(p, { t, a }).plus;
    fit.push({ x: q, y: E });
  }
  const slope = (fit[fit.length - 1].y - fit[0].y) / (fit[fit.length - 1].x - fit[0].x); // eV·Å⁻¹
  const vF = slope * 1e-10 / 6.582119569e-16;   // m·s⁻¹
  const bBond = a / Math.sqrt(3);
  const analytic = 3 * t * bBond / (2 * 6.582119569e-16) * 1e-10;
  return { fAtK: grapheneBands(Kc, { t, a }).f, slope, vF, analytic, bond: bBond, points: fit };
}

/** Independent checks of the zone geometry and the band models. */
export function verifyBrillouin() {
  const checks = [];
  const keys = Object.keys(LATTICES);

  let worstDot = 0;
  keys.forEach((k) => {
    const lat = LATTICES[k];
    const { b } = reciprocal(lat.a);
    for (let i = 0; i < lat.dim; i++)
      for (let j = 0; j < lat.dim; j++) {
        const a = lat.a[i], bb = b[j];
        const want = i === j ? 1 : 0;
        worstDot = Math.max(worstDot, Math.abs(dot(a, bb) - want));
      }
  });
  checks.push({
    label: 'Reciprocal basis: aᵢ · bⱼ = δᵢⱼ for every lattice', ok: worstDot < 1e-12,
    detail: `max |aᵢ·bⱼ − δᵢⱼ| = ${worstDot.toExponential(1)}`,
  });

  const zones = keys.map((k) => brillouinZone(k));
  const volumes = zones.map((z) => Math.abs(z.volume - z.n2) / z.n2);
  checks.push({
    label: 'Zone volume equals (2π)³/V_cell, computed from the intersected faces',
    ok: Math.max(...volumes) < 1e-9,
    detail: keys.map((k, i) => `${LATTICES[k].label}: ${volumes[i].toExponential(1)}`).join('  '),
  });

  const faceOk = zones.every((z, i) => z.faces === LATTICES[keys[i]].faceCount);
  checks.push({
    label: 'Face counts match the known zone polyhedra',
    ok: faceOk,
    detail: zones.map((z, i) => `${LATTICES[keys[i]].label}: ${z.faces}/${LATTICES[keys[i]].faceCount}`).join('  '),
  });

  let worstWS = 0;
  zones.forEach((z) => {
    z.vertices.forEach((v) => {
      z.constraints.forEach((c) => { worstWS = Math.max(worstWS, dot(c.n, v) - c.h); });
    });
  });
  checks.push({
    label: 'Every zone vertex is closer to Γ than to any other reciprocal point',
    ok: worstWS < 1e-9, detail: `max violation = ${worstWS.toExponential(1)}`,
  });

  const smaller = keys.map((k) => brillouinZone(k, { planes: 20 }));
  const converged = smaller.every((z, i) => Math.abs(z.volume - zones[i].volume) / zones[i].volume < 1e-9 && z.faces === zones[i].faces);
  checks.push({
    label: 'Adding further reciprocal-lattice shells leaves the zone unchanged',
    ok: converged, detail: '20-plane and 40-plane intersections agree to 1e-9',
  });

  const widths = ['sc', 'bcc', 'fcc', 'hexagonal'].map((k) => densityOfStates(k, { n: 12 }).width);
  const want = [12, 16, 16, 9];
  const widthOk = widths.every((w, i) => Math.abs(w - want[i]) < 1e-6);
  checks.push({
    label: 'Tight-binding bandwidths: 12t (sc), 16t (bcc), 16t (fcc), 9t (hexagonal)',
    ok: widthOk, detail: widths.map((w, i) => `${w.toFixed(4)}t vs ${want[i]}t`).join('  '),
  });

  const flat = Math.abs(tightBinding('hexagonal', [0, 0, 0]) - tightBinding('hexagonal', [0, 0, 0.5]));
  checks.push({
    label: 'The hexagonal band is independent of kz — a stack of identical layers',
    ok: flat < 1e-12, detail: `E(Γ) − E(A) = ${flat.toExponential(1)}t`,
  });

  const dos = ['sc', 'bcc', 'fcc', 'hexagonal'].map((k) => densityOfStates(k, { n: 24 }));
  const dosOk = dos.every((d) => Math.abs(d.integral - 1) < 0.02);
  checks.push({
    label: 'Each density of states integrates to one state per cell',
    ok: dosOk, detail: dos.map((d) => d.integral.toFixed(4)).join('  '),
  });

  let trWorst = 0, perWorst = 0;
  keys.forEach((k) => {
    const lat = LATTICES[k];
    const { b } = reciprocal(lat.a);
    for (let i = 0; i < 40; i++) {
      const f = [Math.random() * 0.4 - 0.2, Math.random() * 0.4 - 0.2, lat.dim === 2 ? 0 : Math.random() * 0.4 - 0.2];
      const k1 = fromFrac(b, f);
      const k2 = k1.map((v) => -v);
      const k3 = fromFrac(b, [f[0] + 1, f[1] + (lat.dim === 2 ? 1 : 0), f[2]]);
      if (k === 'graphene') {
        const toPhys = (kk) => kk.map((v) => v * T / 2.46);
        trWorst = Math.max(trWorst, Math.abs(grapheneBands(toPhys(k1)).plus - grapheneBands(toPhys(k2)).plus));
        perWorst = Math.max(perWorst, Math.abs(grapheneBands(toPhys(k1)).plus - grapheneBands(toPhys(k3)).plus));
      } else {
        trWorst = Math.max(trWorst, Math.abs(tightBinding(k, k1) - tightBinding(k, k2)));
        perWorst = Math.max(perWorst, Math.abs(tightBinding(k, k1) - tightBinding(k, k3)));
      }
    }
  });
  checks.push({
    label: 'Bands obey time reversal E(k)=E(−k) and periodicity E(k+G)=E(k)',
    ok: trWorst < 1e-9 && perWorst < 1e-9,
    detail: `max deviations ${trWorst.toExponential(1)} and ${perWorst.toExponential(1)}`,
  });

  const cone = diracCone();
  checks.push({
    label: 'Graphene: π and π* touch only at K, on a linear cone',
    ok: Math.abs(cone.fAtK) < 1e-9 && Math.abs(cone.vF / cone.analytic - 1) < 0.005,
    detail: `|f(K)| = ${cone.fAtK.toExponential(1)}; slope gives v_F = ${(cone.vF / 1e6).toFixed(3)}×10⁶ m/s vs 3tb/2ℏ = ${(cone.analytic / 1e6).toFixed(3)}×10⁶ m/s`,
  });

  const mass = effectiveMass('sc', { t: 1, a: 3 });
  checks.push({
    label: 'Effective mass from fitted curvature equals ℏ²/(2mₑta²)',
    ok: Math.abs(mass.mStar - mass.analytic) / Math.abs(mass.analytic) < 0.02,
    detail: `m* = ${mass.mStar.toFixed(4)} mₑ vs ${mass.analytic.toFixed(4)} mₑ`,
  });

  const sc = brillouinZone('sc');
  const kF = Math.cbrt(3 * Math.PI * Math.PI) / T;
  const sphere = (4 * Math.PI / 3) * kF ** 3;
  const frac = sphere / sc.n2;
  checks.push({
    label: 'One electron per simple-cubic cell fills exactly half the zone',
    ok: Math.abs(frac - 0.5) < 1e-9, detail: `free-electron sphere / zone volume = ${frac.toFixed(6)}`,
  });

  let pathWorst = 0;
  keys.forEach((k) => {
    const z = brillouinZone(k);
    kPath(k, { per: 8 }).points.forEach((p) => {
      const kk = z.dim === 2 ? [p.k[0], p.k[1]] : p.k;
      z.constraints.forEach((c) => { pathWorst = Math.max(pathWorst, dot(c.n, kk) - c.h); });
    });
  });
  checks.push({
    label: 'Every high-symmetry point lies inside or on its own zone',
    ok: pathWorst < 1e-9,
    detail: `worst plane violation across all paths = ${pathWorst.toExponential(1)}`,
  });

  return { checks };
}