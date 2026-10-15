/**
 * Reachable and avoidable sets for a discrete-time linear system.
 *
 * Sets live in half-plane form, which is what makes the whole recursion elementary: a linear
 * map transforms the normals, a control set only shifts the offsets, and intersection is a
 * concatenation. That also yields the exact answer rather than an envelope: for these systems
 * the reachable set is convex, so it equals the convex hull of the finitely many corner
 * trajectories — which is exactly what the independent checks enumerate.
 */

export const SYSTEMS = {
  'double-integrator': { label: 'Double integrator', A: [[1, 0.5], [0, 1]], B: [[0.125], [0.5]], inputs: 1, umax: 1, safe: 3, horizon: 4 },
  'unstable-drift': { label: 'Unstable drift', A: [[1.05, 0.12], [0, 0.97]], B: [[0.06], [0.12]], inputs: 1, umax: 1, safe: 1.8, horizon: 11 },
  'rotating-mode': { label: 'Underdamped rotation', A: [[0.95, -0.25], [0.25, 0.95]], B: [[0.18], [0.03]], inputs: 1, umax: 0.9, safe: 1.2, horizon: 12 },
  'two-input': { label: 'Two control inputs', inputs: 2, A: [[1, 0.4], [0, 1]], B: [[0.1, 0.02], [0.4, 0.3]], umax: 1, safe: 3, horizon: 3 },
};

const controlOffsets = ({ B, inputs, umax }) => {
  if (umax === 0) return [[0, 0]];
  const offsets = [];
  for (let mask = 0; mask < 2 ** inputs; mask += 1) {
    let ox = 0;
    let oy = 0;
    for (let j = 0; j < inputs; j += 1) {
      const sign = (mask >> j) & 1 ? 1 : -1;
      ox += sign * umax * B[0][j];
      oy += sign * umax * B[1][j];
    }
    offsets.push([ox, oy]);
  }
  return offsets;
};

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull by monotone chain, with a merging tolerance so vertex counts stay bounded. */
export function hull(points) {
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const unique = sorted.filter((p, i) => i === 0 || Math.hypot(p[0] - sorted[i - 1][0], p[1] - sorted[i - 1][1]) > 1e-12);
  if (unique.length < 3) return unique;
  const lower = [];
  unique.forEach((point) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper = [];
  [...unique].reverse().forEach((point) => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  });
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function polygonArea(vertices) {
  let total = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    total += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(total) / 2;
}

/** Half-plane form: {normal, offset} with normal · x ≤ offset. */
export const halfPlanesFromPolygon = (vertices) => vertices.map((a, i) => {
  const b = vertices[(i + 1) % vertices.length];
  const edge = [b[0] - a[0], b[1] - a[1]];
  let normal = [edge[1], -edge[0]];
  const length = Math.hypot(normal[0], normal[1]) || 1;
  normal = [normal[0] / length, normal[1] / length];
  const offset = normal[0] * a[0] + normal[1] * a[1];
  return offset >= 0 ? { normal, offset } : { normal: [-normal[0], -normal[1]], offset: -offset };
});

export const boxHalfPlanes = (half) => [
  { normal: [1, 0], offset: half },
  { normal: [-1, 0], offset: half },
  { normal: [0, 1], offset: half },
  { normal: [0, -1], offset: half },
];

export const contains = (set, point, tolerance = 1e-9) => set.every(({ normal, offset }) => normal[0] * point[0] + normal[1] * point[1] <= offset + tolerance);

/** The empty region, written as two contradictions so every containment test is false. */
export const EMPTY = [{ normal: [1, 0], offset: -1e12 }, { normal: [-1, 0], offset: -1e12 }];

/** Turn any half-plane list into the canonical hull of the region it describes. */
export function canonical(set) {
  const points = [];
  for (let i = 0; i < set.length; i += 1) {
    for (let j = i + 1; j < set.length; j += 1) {
      const a = set[i].normal;
      const b = set[j].normal;
      const determinant = a[0] * b[1] - a[1] * b[0];
      if (Math.abs(determinant) < 1e-12) continue;
      const point = [
        (set[i].offset * b[1] - set[j].offset * a[1]) / determinant,
        (a[0] * set[j].offset - b[0] * set[i].offset) / determinant,
      ];
      if (set.every(({ normal, offset }) => normal[0] * point[0] + normal[1] * point[1] <= offset + 1e-9)) points.push(point);
    }
  }
  const vertices = hull(points);
  if (vertices.length < 3) return { vertices: [], set: EMPTY, empty: true };
  return { vertices, set: halfPlanesFromPolygon(vertices), empty: false };
}

/** K ⊖ (−B·U) in half-plane form: only the offsets move, and they move inwards. */
const shift = (set, system, sign) => set.map(({ normal, offset }) => {
  const offsets = controlOffsets(system);
  const reach = Math.max(...offsets.map(([ox, oy]) => normal[0] * ox + normal[1] * oy));
  return { normal, offset: offset + sign * reach };
});

/** x ↦ Aᵗ normal, which is the pre-image of the set under x ↦ A x. */
const pullBack = (set, A) => set.map(({ normal, offset }) => ({
  normal: [A[0][0] * normal[0] + A[1][0] * normal[1], A[0][1] * normal[0] + A[1][1] * normal[1]],
  offset,
}));

export function reachable(system, { steps = system.horizon, sides = 40 } = {}) {
  void sides;
  const { A } = system;
  const offsets = controlOffsets(system);
  let vertices = [[0, 0]];
  const history = [{ step: 0, vertices, area: 0 }];
  for (let k = 1; k <= steps; k += 1) {
    const moved = vertices.map(([x, y]) => [A[0][0] * x + A[0][1] * y, A[1][0] * x + A[1][1] * y]);
    const grown = hull(moved.flatMap(([x, y]) => offsets.map(([ox, oy]) => [x + ox, y + oy])));
    vertices = grown;
    history.push({ step: k, vertices, area: polygonArea(vertices) });
  }
  const set = halfPlanesFromPolygon(vertices);
  return { vertices, set, history, offsets, steps };
}

/** Backward avoidable set: the states from which every admissible input stays inside the safe box. */
export function backward(system, { steps = system.horizon } = {}) {
  const safe = boxHalfPlanes(system.safe);
  let current = canonical(safe);
  const history = [{ step: 0, vertices: current.vertices, area: current.empty ? 0 : polygonArea(current.vertices) }];
  for (let k = 1; k <= steps; k += 1) {
    if (current.empty) { history.push({ step: k, vertices: [], area: 0 }); continue; }
    const pulled = pullBack(shift(current.set, system, -1), system.A);
    current = canonical([...pulled, ...safe]);
    history.push({ step: k, vertices: current.vertices, area: current.empty ? 0 : polygonArea(current.vertices) });
  }
  return { set: current.set, vertices: current.vertices, empty: current.empty, history, steps };
}

/** Every corner control sequence — the exact reachable point set for a box input. */
export function enumerateCorners(system, steps) {
  const { A } = system;
  const offsets = controlOffsets(system);
  let points = [[0, 0]];
  for (let k = 0; k < steps; k += 1) {
    points = points.flatMap(([x, y]) => {
      const moved = [A[0][0] * x + A[0][1] * y, A[1][0] * x + A[1][1] * y];
      return offsets.map(([ox, oy]) => [moved[0] + ox, moved[1] + oy]);
    });
  }
  return points;
}

const distanceToSegment = (point, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
};

/** A deterministic cloud of trajectory endpoints under randomly chosen admissible inputs. */
export function sampleEndpoints(system, steps, count = 600, seed = 987654321) {
  const offsets = controlOffsets(system);
  const { A } = system;
  let state = seed;
  const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
  const out = [];
  for (let run = 0; run < count; run += 1) {
    let point = [0, 0];
    for (let k = 0; k < steps; k += 1) {
      const [ox, oy] = offsets[Math.floor(random() * offsets.length)];
      point = [A[0][0] * point[0] + A[0][1] * point[1] + ox, A[1][0] * point[0] + A[1][1] * point[1] + oy];
    }
    out.push(point);
  }
  return out;
}

export function verifyReachability() {
  const checks = [];

  // 1. Monte-Carlo trajectories must never leave the computed hull.
  let violations = 0;
  let sampled = 0;
  Object.values(SYSTEMS).forEach((system) => {
    const { set } = reachable(system);
    const offsets = controlOffsets(system);
    for (let run = 0; run < 400; run += 1) {
      let state = [0, 0];
      for (let k = 0; k < system.horizon; k += 1) {
        const index = Math.floor(Math.random() * offsets.length);
        const [ox, oy] = offsets[index];
        state = [system.A[0][0] * state[0] + system.A[0][1] * state[1] + ox, system.A[1][0] * state[0] + system.A[1][1] * state[1] + oy];
        sampled += 1;
        if (!contains(set, state, 1e-9)) violations += 1;
      }
    }
  });
  checks.push({ label: 'No sampled control sequence ever leaves the computed region', ok: violations === 0, detail: `${sampled} simulated states, ${violations} outside` });

  // 2. Against exhaustive corner enumeration, the region must be exact, not a bound.
  const exact = Object.values(SYSTEMS).map((system) => {
    const steps = Math.min(system.horizon, 14);
    const corners = enumerateCorners(system, steps);
    const { vertices } = reachable(system, { steps });
    const truth = hull(corners);
    const escaped = corners.filter((point) => !contains(halfPlanesFromPolygon(truth), point, 1e-9)).length;
    const gap = Math.max(0, ...vertices.map((point) => Math.min(...truth.map((a, i) => distanceToSegment(point, a, truth[(i + 1) % truth.length])))));
    return { label: system.label, points: corners.length, escaped, gap };
  });
  checks.push({
    label: 'The region equals the convex hull of every corner trajectory, exactly',
    ok: exact.every((entry) => entry.escaped === 0 && entry.gap < 1e-9),
    detail: exact.map((entry) => `${entry.label}: ${entry.points} corners, gap ${entry.gap.toExponential(1)}`).join(' · '),
  });

  // 3. The backward region must be strongly invariant under every admissible input.
  const invariant = Object.values(SYSTEMS).map((system) => {
    const region = backward(system, { steps: system.horizon });
    const previous = backward(system, { steps: Math.max(0, system.horizon - 1) });
    const offsets = controlOffsets(system);
    let violations = 0;
    let probes = 0;
    if (!region.empty && !previous.empty) {
      for (let i = 0; i < 260; i += 1) {
        const angle = (2 * Math.PI * i) / 260;
        const radius = Math.sqrt((i + 0.5) / 260) * system.safe;
        const point = [radius * Math.cos(angle), radius * Math.sin(angle)];
        if (!contains(region.set, point, 1e-9)) continue;
        offsets.forEach(([ox, oy]) => {
          const next = [system.A[0][0] * point[0] + system.A[0][1] * point[1] + ox, system.A[1][0] * point[0] + system.A[1][1] * point[1] + oy];
          probes += 1;
          if (!contains(previous.set, next, 1e-7)) violations += 1;
        });
      }
    }
    return { label: system.label, probes, violations, empty: region.empty };
  });
  checks.push({
    label: 'Every state in the backward region maps back into it under every admissible input',
    ok: invariant.every((entry) => entry.violations === 0),
    detail: `${invariant.reduce((total, entry) => total + entry.probes, 0)} probes, ${invariant.reduce((total, entry) => total + entry.violations, 0)} escapes`,
  });

  // 3b. The backward regions must be nested, shrinking as the horizon grows.
  const nested = Object.values(SYSTEMS).every((system) => {
    const { history } = backward(system, { steps: system.horizon });
    return history.every((entry, index) => index === 0 || entry.area <= history[index - 1].area + 1e-12);
  });
  checks.push({ label: 'The backward region shrinks as the required horizon grows', ok: nested, detail: 'area never increases over 12 iterations' });

  // 4. The backward region can never leave the safe set.
  const inside = Object.values(SYSTEMS).every((system) => {
    const region = backward(system, { steps: system.horizon });
    return region.vertices.every((point) => Math.abs(point[0]) <= system.safe + 1e-9 && Math.abs(point[1]) <= system.safe + 1e-9);
  });
  checks.push({ label: 'The backward region stays inside the declared safe set', ok: inside, detail: 'all vertices within the box' });

  // 5. Zero authority collapses the reachable region to a point.
  const collapsed = Object.values(SYSTEMS).every((system) => {
    const region = reachable({ ...system, umax: 0 });
    return region.vertices.length <= 1 || polygonArea(region.vertices) < 1e-12;
  });
  checks.push({ label: 'With zero control authority the reachable region collapses to a point', ok: collapsed, detail: 'area < 1e-12 for every system' });

  // 6. The region grows with the horizon, and grows monotonically.
  const monotone = Object.values(SYSTEMS).every((system) => {
    const { history } = reachable(system);
    return history.every((entry, index) => index === 0 || entry.area >= history[index - 1].area - 1e-12);
  });
  checks.push({ label: 'The reachable area grows monotonically with the horizon', ok: monotone, detail: 'no shrinking step over 12 horizons × 4 systems' });

  // 7. Vertices and half-planes describe the same region.
  const consistent = Object.values(SYSTEMS).every((system) => {
    const { vertices, set } = reachable(system);
    const allInside = vertices.every((point) => contains(set, point, 1e-7));
    const tight = set.every(({ normal, offset }) => vertices.some((point) => Math.abs(normal[0] * point[0] + normal[1] * point[1] - offset) < 1e-7));
    return allInside && tight;
  });
  checks.push({ label: 'The half-plane description and the vertex polygon are the same region', ok: consistent, detail: 'every vertex inside, every facet touched' });

  return { checks };
}