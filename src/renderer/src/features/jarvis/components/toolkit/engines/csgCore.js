/**
 * Solid modelling: primitives, transforms and boolean operations between closed
 * triangle meshes, implemented with BSP trees — plus the measurements that decide
 * whether the result is actually sound.
 *
 * A mesh is an array of triangles; a triangle is an array of three points {x, y, z}.
 * The operations are the classic BSP formulation: build a tree from one operand, clip
 * the other against it, keep the pieces that belong inside the result, and rebuild.
 *
 * Honest limits: BSP boolean operations are numerically delicate. Coincident faces,
 * exactly touching solids and very thin features can produce slivers or stray
 * triangles. The checks below exist so the tool can tell you when that has happened
 * rather than pretending the result is perfect.
 */

const EPS = 1e-5;

export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const vlen = (a) => Math.sqrt(dot(a, a));
// Twice the area of a triangle — the test for a face too small to have a plane.
const area2 = (a, b, c) => vlen(cross(sub(b, a), sub(c, a)));
const EPS_AREA = 1e-9;
const unit = (a) => { const l = vlen(a) || 1; return mul(a, 1 / l); };
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));

class Plane {
  constructor(normal, w) {
    this.normal = normal;
    this.w = w;
  }

  static fromPoints(a, b, c) {
    const n = unit(cross(sub(b, a), sub(c, a)));
    return new Plane(n, dot(n, a));
  }

  clone() {
    return new Plane({ ...this.normal }, this.w);
  }

  flip() {
    this.normal = mul(this.normal, -1);
    this.w = -this.w;
  }

  /** Sorts a polygon into the halves of this plane, cutting it when it straddles. */
  splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
    const COPLANAR = 0;
    const FRONT = 1;
    const BACK = 2;
    const SPANNING = 3;
    let polygonType = 0;
    const types = polygon.vertices.map((point) => {
      const distance = dot(this.normal, point) - this.w;
      const type = distance < -EPS ? BACK : distance > EPS ? FRONT : COPLANAR;
      polygonType |= type;
      return type;
    });

    if (polygonType === COPLANAR) {
      (dot(this.normal, polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
      return;
    }
    if (polygonType === FRONT) { front.push(polygon); return; }
    if (polygonType === BACK) { back.push(polygon); return; }

    const frontPoints = [];
    const backPoints = [];
    polygon.vertices.forEach((point, i) => {
      const j = (i + 1) % polygon.vertices.length;
      const ti = types[i];
      const tj = types[j];
      const next = polygon.vertices[j];
      if (ti !== BACK) frontPoints.push(point);
      if (ti !== FRONT) backPoints.push({ ...point });
      if ((ti | tj) === SPANNING) {
        const t = (this.w - dot(this.normal, point)) / dot(this.normal, sub(next, point));
        const cut = lerp(point, next, t);
        frontPoints.push(cut);
        backPoints.push({ ...cut });
      }
    });
    // Slivers are dropped rather than kept: a triangle a fraction of a nanometre
    // across contributes nothing to the volume, and the plane it implies is
    // meaningless — which is how a BSP tree grows until it runs out of stack.
    if (frontPoints.length >= 3 && area2(frontPoints[0], frontPoints[1], frontPoints[2]) > EPS_AREA) front.push(new Polygon(frontPoints));
    if (backPoints.length >= 3 && area2(backPoints[0], backPoints[1], backPoints[2]) > EPS_AREA) back.push(new Polygon(backPoints));
  }
}

class Polygon {
  constructor(vertices) {
    this.vertices = vertices;
    this.plane = Plane.fromPoints(vertices[0], vertices[1], vertices[2]);
  }

  clone() {
    return new Polygon(this.vertices.map((point) => ({ ...point })));
  }

  flip() {
    this.vertices.reverse();
    this.plane.flip();
  }
}

class Node {
  constructor(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons) this.build(polygons);
  }

  clone() {
    const node = new Node();
    node.plane = this.plane && this.plane.clone();
    node.front = this.front && this.front.clone();
    node.back = this.back && this.back.clone();
    node.polygons = this.polygons.map((polygon) => polygon.clone());
    return node;
  }

  invert() {
    this.polygons.forEach((polygon) => polygon.flip());
    if (this.plane) this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    const swap = this.front;
    this.front = this.back;
    this.back = swap;
  }

  clipPolygons(polygons) {
    if (!this.plane) return polygons.slice();
    let front = [];
    let back = [];
    polygons.forEach((polygon) => this.plane.splitPolygon(polygon, front, back, front, back));
    if (this.front) front = this.front.clipPolygons(front);
    if (this.back) back = this.back.clipPolygons(back);
    else back = [];
    return front.concat(back);
  }

  clipTo(bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }

  allPolygons() {
    let polygons = this.polygons.slice();
    if (this.front) polygons = polygons.concat(this.front.allPolygons());
    if (this.back) polygons = polygons.concat(this.back.allPolygons());
    return polygons;
  }

  build(polygons) {
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane.clone();
    const front = [];
    const back = [];
    polygons.forEach((polygon) => this.plane.splitPolygon(polygon, this.polygons, this.polygons, front, back));
    if (front.length) {
      if (!this.front) this.front = new Node();
      this.front.build(front);
    }
    if (back.length) {
      if (!this.back) this.back = new Node();
      this.back.build(back);
    }
  }
}

const toPolygons = (mesh) => mesh
  .filter(([a, b, c]) => area2(a, b, c) > EPS_AREA)
  .map((triangle) => new Polygon(triangle.map((point) => ({ ...point }))));

const toMesh = (polygons) => {
  const mesh = [];
  polygons.forEach((polygon) => {
    const points = polygon.vertices;
    if (points.length < 3) return;
    // A split triangle becomes a triangle and a quad; a fan keeps both convex.
    for (let i = 2; i < points.length; i += 1) {
      const a = points[0];
      const b = points[i - 1];
      const c = points[i];
      if (vlen(cross(sub(b, a), sub(c, a))) > EPS) mesh.push([a, b, c]);
    }
  });
  return mesh;
};

export function meshUnion(a, b) {
  const left = new Node(toPolygons(a));
  const right = new Node(toPolygons(b));
  left.clipTo(right);
  right.clipTo(left);
  right.invert();
  right.clipTo(left);
  right.invert();
  left.build(right.allPolygons());
  return toMesh(left.allPolygons());
}

export function meshIntersect(a, b) {
  const left = new Node(toPolygons(a));
  const right = new Node(toPolygons(b));
  left.invert();
  right.clipTo(left);
  right.invert();
  left.clipTo(right);
  right.clipTo(left);
  left.build(right.allPolygons());
  left.invert();
  return toMesh(left.allPolygons());
}

export function meshSubtract(a, b) {
  const left = new Node(toPolygons(a));
  const right = new Node(toPolygons(b));
  left.invert();
  left.clipTo(right);
  right.clipTo(left);
  right.invert();
  right.clipTo(left);
  right.invert();
  left.build(right.allPolygons());
  left.invert();
  return toMesh(left.allPolygons());
}

// ── measurements ─────────────────────────────────────────────────────────────

export function signedVolume(mesh) {
  let total = 0;
  mesh.forEach(([a, b, c]) => { total += dot(a, cross(b, c)) / 6; });
  return total;
}

/**
 * Weld vertices on a fine grid, then look at how many triangles share every edge.
 * Exactly two means a closed surface; one means a hole; more than two means the
 * surface folds back through itself. This is how the tool can report a boolean
 * result it does not believe.
 */
/**
 * Weld points within tolerance of each other into a single vertex. The point's own
 * grid cell is searched together with its 26 neighbours, because two copies of the
 * same vertex that rounding placed either side of a cell boundary must still merge —
 * otherwise a perfectly good boolean result is reported as full of holes.
 */
function weldPoints(rawPoints, tolerance = EPS) {
  const cell = tolerance;
  const buckets = new Map();
  const representatives = [];
  const ids = new Array(rawPoints.length);
  rawPoints.forEach((point, index) => {
    const ci = Math.round(point.x / cell);
    const cj = Math.round(point.y / cell);
    const ck = Math.round(point.z / cell);
    let match = -1;
    for (let di = -1; di <= 1 && match < 0; di += 1) {
      for (let dj = -1; dj <= 1 && match < 0; dj += 1) {
        for (let dk = -1; dk <= 1 && match < 0; dk += 1) {
          const bucket = buckets.get(`${ci + di}:${cj + dj}:${ck + dk}`);
          if (!bucket) continue;
          for (const candidate of bucket) {
            const existing = representatives[candidate];
            if (Math.abs(existing.x - point.x) <= tolerance
              && Math.abs(existing.y - point.y) <= tolerance
              && Math.abs(existing.z - point.z) <= tolerance) {
              match = candidate;
              break;
            }
          }
        }
      }
    }
    if (match < 0) {
      match = representatives.length;
      representatives.push(point);
      const bucketKey = `${ci}:${cj}:${ck}`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey).push(match);
    }
    ids[index] = match;
  });
  return { ids, points: representatives };
}

export function meshStats(mesh) {
  const flat = [];
  mesh.forEach((triangle) => triangle.forEach((point) => flat.push(point)));
  const { ids } = weldPoints(flat);
  const edges = new Map();
  mesh.forEach((triangle, face) => {
    for (let i = 0; i < 3; i += 1) {
      const a = ids[face * 3 + i];
      const b = ids[face * 3 + ((i + 1) % 3)];
      const edge = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  });
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  edges.forEach((count) => {
    if (count === 1) boundaryEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
  });
  const vertices = new Set(ids).size;
  const edgeCount = edges.size;
  const triangles = mesh.length;
  return {
    triangles,
    vertices,
    edges: edgeCount,
    boundaryEdges,
    nonManifoldEdges,
    euler: vertices - edgeCount + triangles,
    volume: Math.abs(signedVolume(mesh)),
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0,
  };
}

/** Volume identity: V(A ∪ B) + V(A ∩ B) must equal V(A) + V(B). */
export function booleanChecks({ a, b, union, intersect, difference }) {
  const statsA = meshStats(a);
  const statsB = meshStats(b);
  const statsUnion = union ? meshStats(union) : null;
  const statsIntersect = intersect ? meshStats(intersect) : null;
  const statsDifference = difference ? meshStats(difference) : null;
  const tolerance = Math.max(1e-5, (statsA.volume + statsB.volume) * 1e-3);
  const unionIdentity = statsUnion && statsIntersect
    ? Math.abs(statsUnion.volume + statsIntersect.volume - (statsA.volume + statsB.volume))
    : null;
  const differenceIdentity = statsDifference && statsIntersect
    ? Math.abs(statsDifference.volume - (statsA.volume - statsIntersect.volume))
    : null;
  return {
    a: statsA,
    b: statsB,
    union: statsUnion,
    intersect: statsIntersect,
    difference: statsDifference,
    tolerance,
    unionIdentity,
    differenceIdentity,
    unionOk: unionIdentity != null && unionIdentity <= tolerance,
    differenceOk: differenceIdentity != null && differenceIdentity <= tolerance,
  };
}

// ── primitives ───────────────────────────────────────────────────────────────
// Every primitive is built from shared corner points, so coincident corners are
// identical bit for bit and the manifold check below is measuring geometry rather
// than floating-point noise. Winding is then fixed by measuring the volume.

const orientOutward = (mesh) => (signedVolume(mesh) < 0
  ? mesh.map(([a, b, c]) => [a, c, b])
  : mesh);

export function makeBox(width, height, depth) {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const c = [
    vec(-x, -y, -z), vec(x, -y, -z), vec(x, y, -z), vec(-x, y, -z),
    vec(-x, -y, z), vec(x, -y, z), vec(x, y, z), vec(-x, y, z),
  ];
  return orientOutward([
    [c[4], c[5], c[6]], [c[4], c[6], c[7]],
    [c[1], c[0], c[3]], [c[1], c[3], c[2]],
    [c[0], c[4], c[7]], [c[0], c[7], c[3]],
    [c[5], c[1], c[2]], [c[5], c[2], c[6]],
    [c[0], c[1], c[5]], [c[0], c[5], c[4]],
    [c[3], c[7], c[6]], [c[3], c[6], c[2]],
  ]);
}

export function makeSphere(radius, segments = 24, rings = 12) {
  const rows = Math.max(3, rings);
  const cols = Math.max(3, segments);
  const grid = [];
  for (let i = 0; i <= rows; i += 1) {
    const theta = (i / rows) * Math.PI;
    const y = radius * Math.cos(theta);
    const ringRadius = radius * Math.sin(theta);
    const row = [];
    for (let j = 0; j < cols; j += 1) {
      const phi = (j / cols) * Math.PI * 2;
      row.push(vec(ringRadius * Math.cos(phi), y, ringRadius * Math.sin(phi)));
    }
    grid.push(row);
  }
  const mesh = [];
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const j2 = (j + 1) % cols;
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const cc = grid[i + 1][j2];
      const d = grid[i][j2];
      // The pole rows collapse to a single point, so the triangle that touches it
      // twice on one side is skipped rather than emitted with no area.
      if (i !== rows - 1) mesh.push([a, b, cc]);
      if (i !== 0) mesh.push([a, cc, d]);
    }
  }
  return orientOutward(mesh);
}

export function makeCylinder(radius, height, segments = 24) {
  const cols = Math.max(3, segments);
  const top = [];
  const bottom = [];
  for (let j = 0; j < cols; j += 1) {
    const phi = (j / cols) * Math.PI * 2;
    const x = radius * Math.cos(phi);
    const z = radius * Math.sin(phi);
    top.push(vec(x, height / 2, z));
    bottom.push(vec(x, -height / 2, z));
  }
  const topCentre = vec(0, height / 2, 0);
  const bottomCentre = vec(0, -height / 2, 0);
  const mesh = [];
  for (let j = 0; j < cols; j += 1) {
    const j2 = (j + 1) % cols;
    mesh.push([bottom[j], bottom[j2], top[j2]]);
    mesh.push([bottom[j], top[j2], top[j]]);
    mesh.push([topCentre, top[j], top[j2]]);
    mesh.push([bottomCentre, bottom[j2], bottom[j]]);
  }
  return orientOutward(mesh);
}

export function makeCone(radius, height, segments = 24) {
  const cols = Math.max(3, segments);
  const apex = vec(0, height / 2, 0);
  const baseCentre = vec(0, -height / 2, 0);
  const ring = [];
  for (let j = 0; j < cols; j += 1) {
    const phi = (j / cols) * Math.PI * 2;
    ring.push(vec(radius * Math.cos(phi), -height / 2, radius * Math.sin(phi)));
  }
  const mesh = [];
  for (let j = 0; j < cols; j += 1) {
    const j2 = (j + 1) % cols;
    mesh.push([ring[j], ring[j2], apex]);
    mesh.push([baseCentre, ring[j2], ring[j]]);
  }
  return orientOutward(mesh);
}

export function makeTorus(majorRadius, minorRadius, segments = 32, rings = 16) {
  const cols = Math.max(4, segments);
  const rows = Math.max(3, rings);
  const grid = [];
  for (let i = 0; i <= rows; i += 1) {
    const u = (i / rows) * Math.PI * 2;
    const row = [];
    for (let j = 0; j < cols; j += 1) {
      const v = (j / cols) * Math.PI * 2;
      const r = majorRadius + minorRadius * Math.cos(u);
      row.push(vec(r * Math.cos(v), minorRadius * Math.sin(u), r * Math.sin(v)));
    }
    grid.push(row);
  }
  const mesh = [];
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const j2 = (j + 1) % cols;
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j2];
      const d = grid[i][j2];
      mesh.push([a, b, c]);
      mesh.push([a, c, d]);
    }
  }
  return orientOutward(mesh);
}

export function transform(mesh, { translate = [0, 0, 0], rotate = [0, 0, 0], scaleFactor = 1 } = {}) {
  const [sx, sy, sz] = Array.isArray(scaleFactor) ? scaleFactor : [scaleFactor, scaleFactor, scaleFactor];
  const [rx, ry, rz] = rotate.map((d) => (d * Math.PI) / 180);
  const cosX = Math.cos(rx); const sinX = Math.sin(rx);
  const cosY = Math.cos(ry); const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz); const sinZ = Math.sin(rz);
  const apply = (point) => {
    let p = { x: point.x * sx, y: point.y * sy, z: point.z * sz };
    p = { x: p.x, y: p.y * cosX - p.z * sinX, z: p.y * sinX + p.z * cosX };
    p = { x: p.x * cosY + p.z * sinY, y: p.y, z: -p.x * sinY + p.z * cosY };
    p = { x: p.x * cosZ - p.y * sinZ, y: p.x * sinZ + p.y * cosZ, z: p.z };
    return add(p, vec(translate[0], translate[1], translate[2]));
  };
  return mesh.map((triangle) => triangle.map(apply));
}

// ── exchange formats ─────────────────────────────────────────────────────────

const weld = (mesh) => {
  const flat = [];
  const faces = mesh.map((triangle) => triangle.map((point) => {
    flat.push(point);
    return flat.length - 1;
  }));
  const { ids, points } = weldPoints(flat);
  return { points, faces: faces.map(([a, b, c]) => [ids[a], ids[b], ids[c]]) };
};

export function toOBJ(mesh) {
  const { points, faces } = weld(mesh);
  const lines = ['# exported by the mesh boolean engine', '# vertices'];
  points.forEach((point) => lines.push(`v ${point.x.toFixed(6)} ${point.y.toFixed(6)} ${point.z.toFixed(6)}`));
  lines.push('# faces');
  faces.forEach(([a, b, c]) => lines.push(`f ${a + 1} ${b + 1} ${c + 1}`));
  return lines.join('\n');
}

export function toSTL(mesh, name = 'boolean') {
  const lines = [`solid ${name}`];
  mesh.forEach(([a, b, c]) => {
    const normal = unit(cross(sub(b, a), sub(c, a)));
    lines.push(`  facet normal ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}`);
    lines.push('    outer loop');
    [a, b, c].forEach((point) => lines.push(`      vertex ${point.x.toFixed(6)} ${point.y.toFixed(6)} ${point.z.toFixed(6)}`));
    lines.push('    endloop');
    lines.push('  endfacet');
  });
  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}