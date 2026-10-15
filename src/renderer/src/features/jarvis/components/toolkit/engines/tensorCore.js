/**
 * Symmetric 2-D tensor fields.
 *
 * Closed-form eigen-decomposition of [[a, b], [b, c]], the three invariants that cannot depend
 * on the frame, and the singularities of the eigenvector direction field — found by measuring
 * the winding index of the direction field cell by cell, which is the only method that catches
 * both eigenvalue degeneracies and places where the tensor itself vanishes.
 */

const eigen = (a, b, c) => {
  const trace = a + c;
  const disc = Math.sqrt(Math.max(0, (a - c) * (a - c) + 4 * b * b));
  const l1 = (trace + disc) / 2;
  const l2 = (trace - disc) / 2;
  const vector = (lambda) => {
    const vx = b;
    const vy = lambda - a;
    const norm = Math.hypot(vx, vy);
    if (norm < 1e-14) return [1, 0];
    return [vx / norm, vy / norm];
  };
  return { l1, l2, v1: vector(l1), v2: vector(l2), trace, det: a * c - b * b, disc };
};

export const FAMILIES = {
  uniform: { label: 'Uniform stretch', note: 'constant field — no singularity', sample: () => [1.3, 0.25, 0.7] },
  shear: { label: 'Pure shear', note: 'constant field — no singularity', sample: () => [0, 1.2, 0] },
  node: { label: 'Node at the origin', note: 'isolated eigenvalue degeneracy, index +½', sample: ([x, y]) => [x, y, -x] },
  saddle: { label: 'Saddle at the origin', note: 'isolated eigenvalue degeneracy, index −½', sample: ([x, y]) => [x, y, 2 * x] },
  dipole: { label: 'Rotating dipole', note: 'eigenvector direction winds once around the origin, index +1', sample: ([x, y]) => { const r2 = x * x + y * y; const r4 = Math.max(r2 * r2, 1e-12); return [(y * y - x * x) / r4, (-2 * x * y) / r4, (x * x - y * y) / r4]; } },
  mixed: { label: 'Node in a uniform background', note: 'degeneracy displaced off centre', sample: ([x, y]) => { const dx = x - 0.35; const dy = y + 0.2; return [0.55 + dx, dy, -0.55 - dx]; } },
};

/** Sample the field and its eigen-data on an n×n grid over [−extent, extent]². */
export function sampleField(name, { n = 40, extent = 1 } = {}) {
  const family = FAMILIES[name];
  const cells = [];
  for (let j = 0; j < n; j += 1) {
    const y = extent - (2 * extent * j) / (n - 1);
    for (let i = 0; i < n; i += 1) {
      const x = -extent + (2 * extent * i) / (n - 1);
      const [a, b, c] = family.sample([x, y]);
      const e = eigen(a, b, c);
      cells.push({ x, y, a, b, c, ...e, angle: Math.atan2(e.v1[1], e.v1[0]), magnitude: Math.hypot(a, b, c) });
    }
  }
  return { name, label: family.label, note: family.note, n, extent, cells };
}

const wrap = (angle) => {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value <= -Math.PI) value += 2 * Math.PI;
  return value;
};

const at = (field, x, y) => { const [a, b, c] = FAMILIES[field.name].sample([x, y]); return eigen(a, b, c); };

/**
 * Winding of one edge, split adaptively: close to a singularity the direction turns faster than
 * any fixed step can follow, so the segment is halved until the turn is small enough to trust.
 */
const segmentWinding = (field, a, b, depth = 0) => {
  const first = at(field, a[0], a[1]).v1;
  const second = at(field, b[0], b[1]).v1;
  const delta = wrap(2 * (Math.atan2(second[1], second[0]) - Math.atan2(first[1], first[0])));
  if (Math.abs(delta) < Math.PI / 2 || depth >= 11) return delta;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return segmentWinding(field, a, mid, depth + 1) + segmentWinding(field, mid, b, depth + 1);
};

/** Winding index of the eigenvector direction around a closed rectangle. */
const cellIndex = (field, x0, y0, x1, y1) => {
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  let total = 0;
  for (let k = 0; k < 4; k += 1) total += segmentWinding(field, corners[k], corners[(k + 1) % 4]);
  return total / (4 * Math.PI);
};

/**
 * Singular points of the direction field.
 *
 * A cell is flagged when the winding of its eigenvector direction is non-zero. Refinement keeps
 * whichever sub-cells still carry winding, and when the singularity lands on a dividing line two
 * sub-cells carry half of it each — their indices are then added, because winding is additive
 * over a subdivision, which is what keeps a full-turn centre from being reported as a half-turn.
 */
export function singularities(name, { n = 48, extent = 1, tolerance = 0.25 } = {}) {
  const field = { name, n, extent };
  const raw = [];
  const step = (2 * extent) / (n - 1);
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const x0 = -extent + i * step;
      const y0 = extent - (j + 1) * step;
      let index = cellIndex(field, x0, y0, x0 + step, y0 + step);
      if (Math.abs(index) < tolerance) continue;
      let box = [x0, y0, x0 + step, y0 + step];
      for (let round = 0; round < 6; round += 1) {
        const sub = (box[2] - box[0]) / 2;
        const cells = [];
        for (let sj = 0; sj < 2; sj += 1) {
          for (let si = 0; si < 2; si += 1) {
            const candidate = [box[0] + si * sub, box[1] + sj * sub, box[0] + (si + 1) * sub, box[1] + (sj + 1) * sub];
            const value = cellIndex(field, candidate[0], candidate[1], candidate[2], candidate[3]);
            if (Math.abs(value) > 1e-9) cells.push({ value, box: candidate });
          }
        }
        if (!cells.length) break;
        index = cells.reduce((total, cell) => total + cell.value, 0);
        if (cells.length > 1) {
          box = [Math.min(...cells.map((cell) => cell.box[0])), Math.min(...cells.map((cell) => cell.box[1])), Math.max(...cells.map((cell) => cell.box[2])), Math.max(...cells.map((cell) => cell.box[3]))];
          break;
        }
        box = cells[0].box;
      }
      raw.push({ x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, index });
    }
  }

  // A grid line through the singularity splits it across neighbours; merge and add.
  const merged = [];
  raw.forEach((point) => {
    const twin = merged.find((other) => Math.hypot(other.x - point.x, other.y - point.y) < 2.2 * step);
    if (!twin) { merged.push({ ...point, hits: 1 }); return; }
    const total = twin.index + point.index;
    twin.x = (twin.x * twin.hits + point.x) / (twin.hits + 1);
    twin.y = (twin.y * twin.hits + point.y) / (twin.hits + 1);
    twin.hits += 1;
    twin.index = total;
  });

  return merged
    .filter((point) => Math.abs(point.index) >= tolerance)
    .map((point) => ({ ...point, kind: Math.abs(Math.abs(point.index) - 0.5) < 0.08 ? (point.index > 0 ? 'node' : 'saddle') : 'centre' }))
    .sort((a, b) => Math.abs(b.index) - Math.abs(a.index));
}

const describe = (index) => {
  const magnitude = Math.abs(index);
  if (Math.abs(magnitude - 0.5) < 0.06) return index > 0 ? 'eigenvalue-degenerate node (index +½)' : 'eigenvalue-degenerate saddle (index −½)';
  if (Math.abs(magnitude - 1) < 0.06) return index > 0 ? 'centre (index +1)' : 'centre (index −1)';
  return `index ${index.toFixed(2)}`;
};

export function verifyTensor() {
  const checks = [];
  const samples = ['uniform', 'node', 'saddle', 'dipole', 'mixed'].flatMap((name) => {
    const field = FAMILIES[name];
    const out = [];
    for (let i = 0; i < 60; i += 1) {
      const x = -1 + (2 * ((i * 17) % 60)) / 60;
      const y = -1 + (2 * ((i * 23) % 60)) / 60;
      const [a, b, c] = field.sample([x, y]);
      out.push({ name, a, b, c, e: eigen(a, b, c) });
    }
    return out;
  });

  // 1. The eigenvalues reproduce the two frame-independent combinations exactly.
  const traceWorst = Math.max(...samples.map((s) => Math.abs(s.e.l1 + s.e.l2 - s.e.trace)));
  const detWorst = Math.max(...samples.map((s) => Math.abs(s.e.l1 * s.e.l2 - s.e.det) / Math.max(1, Math.abs(s.e.det))));
  checks.push({ label: 'λ₁ + λ₂ = trace and λ₁λ₂ = det at every sample', ok: traceWorst < 1e-12 && detWorst < 1e-12, detail: `sum ${traceWorst.toExponential(1)}, product ${detWorst.toExponential(1)}` });

  // 2. Eigenvectors are unit length and orthogonal wherever the eigenvalues differ.
  const separated = samples.filter((s) => s.e.disc > 1e-6);
  const orthoWorst = Math.max(...separated.map((s) => Math.abs(s.e.v1[0] * s.e.v2[0] + s.e.v1[1] * s.e.v2[1])));
  const unitWorst = Math.max(...separated.map((s) => Math.abs(Math.hypot(s.e.v1[0], s.e.v1[1]) - 1)));
  checks.push({ label: 'Eigenvectors are unit length and mutually orthogonal wherever the eigenvalues separate', ok: orthoWorst < 1e-12 && unitWorst < 1e-12, detail: `orthogonality ${orthoWorst.toExponential(1)}, norm ${unitWorst.toExponential(1)} over ${separated.length} samples` });

  // 3. Each eigenpair actually satisfies A v = λ v.
  const eigenWorst = Math.max(...samples.map((s) => {
    const left = [s.a * s.e.v1[0] + s.b * s.e.v1[1], s.b * s.e.v1[0] + s.c * s.e.v1[1]];
    const right = [s.e.l1 * s.e.v1[0], s.e.l1 * s.e.v1[1]];
    return Math.max(Math.abs(left[0] - right[0]), Math.abs(left[1] - right[1]));
  }));
  checks.push({ label: 'Every eigenpair satisfies A v = λ v to machine precision', ok: eigenWorst < 1e-12, detail: `worst residual ${eigenWorst.toExponential(1)}` });

  // 4. Rotating the frame cannot change the invariants.
  const angle = 0.7;
  let rotationWorst = 0;
  samples.forEach((s) => {
    const a11 = s.a * Math.cos(angle) ** 2 + 2 * s.b * Math.sin(angle) * Math.cos(angle) + s.c * Math.sin(angle) ** 2;
    const a12 = (s.c - s.a) * Math.sin(angle) * Math.cos(angle) + s.b * (Math.cos(angle) ** 2 - Math.sin(angle) ** 2);
    const a22 = s.a * Math.sin(angle) ** 2 - 2 * s.b * Math.sin(angle) * Math.cos(angle) + s.c * Math.cos(angle) ** 2;
    const e = eigen(a11, a12, a22);
    rotationWorst = Math.max(rotationWorst, Math.abs(e.trace - s.e.trace), Math.abs(e.det - s.e.det), Math.abs(e.disc - s.e.disc));
  });
  checks.push({ label: 'Trace, determinant and discriminant are unchanged by a frame rotation', ok: rotationWorst < 1e-12, detail: `worst drift ${rotationWorst.toExponential(1)}` });

  // 5. Every located singularity carries a half-integer index.
  const all = Object.keys(FAMILIES).flatMap((name) => singularities(name).map((point) => ({ ...point, name })));
  const halfInteger = all.every((point) => Math.abs(point.index * 2 - Math.round(point.index * 2)) < 0.06);
  checks.push({ label: 'Every located singularity carries a half-integer index', ok: halfInteger, detail: all.length ? all.map((p) => `${p.index.toFixed(2)}`).join(', ') : 'none located' });

  // 6. Constant fields must produce nothing at all — the false-positive test.
  const constants = ['uniform', 'shear'].every((name) => singularities(name).length === 0);
  checks.push({ label: 'Constant fields report no singularities', ok: constants, detail: 'uniform stretch and pure shear both clean' });

  // 7. The three known degeneracies carry the index the analytic form predicts.
  const expectations = [
    { name: 'node', index: 0.5 },
    { name: 'saddle', index: -0.5 },
    { name: 'dipole', index: 1 },
  ].map(({ name, index }) => {
    const found = singularities(name);
    const match = found.length ? found.reduce((best, point) => (Math.abs(point.index - index) < Math.abs(best.index - index) ? point : best), found[0]) : null;
    return { name, expected: index, measured: match ? match.index : null, count: found.length, at: match ? [match.x, match.y] : null };
  });
  checks.push({
    label: 'Node, saddle and rotating dipole carry the predicted indices +½, −½ and +1',
    ok: expectations.every((entry) => entry.measured != null && Math.abs(entry.measured - entry.expected) < 0.08),
    detail: expectations.map((entry) => `${entry.name} ${entry.measured == null ? '—' : entry.measured.toFixed(2)} of ${entry.expected}`).join(' · '),
  });

  // 8. The degeneracy is where it should be, to the resolution of the search.
  const nodePoint = singularities('node')[0];
  checks.push({ label: 'The node is located at the field’s degeneracy on the grid', ok: !!nodePoint && Math.hypot(nodePoint.x, nodePoint.y) < 0.05, detail: nodePoint ? `(${nodePoint.x.toFixed(3)}, ${nodePoint.y.toFixed(3)})` : 'not located' });

  return { checks, describe };
}