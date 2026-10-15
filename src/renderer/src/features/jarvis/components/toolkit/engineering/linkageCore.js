const TAU = Math.PI * 2;

/** Loop-closure solution for a planar four-bar linkage, in the ground-link frame. */
export function solveFourBar(g, theta2) {
  const { a, b, c, d } = g;
  const K1 = d / a, K2 = d / c, K3 = (a * a - b * b + c * c + d * d) / (2 * a * c);
  const A = Math.cos(theta2) - K1;
  const B = Math.sin(theta2);
  const C = K2 * Math.cos(theta2) - K3;
  const radius = Math.hypot(A, B);
  if (radius < 1e-12 || Math.abs(C) > radius) return { ok: false, reason: 'No assembly for this link set at that crank angle.' };
  const phi = Math.atan2(B, A);
  const delta = Math.acos(-C / radius);
  const theta4 = phi + (g.branch >= 0 ? delta : -delta);
  const theta3 = Math.atan2(c * Math.sin(theta4) - a * Math.sin(theta2), d + c * Math.cos(theta4) - a * Math.cos(theta2));
  return { ok: true, theta3, theta4 };
}

export function loopResidual(g, theta2, theta3, theta4) {
  const x = g.a * Math.cos(theta2) + g.b * Math.cos(theta3) - g.c * Math.cos(theta4) - g.d;
  const y = g.a * Math.sin(theta2) + g.b * Math.sin(theta3) - g.c * Math.sin(theta4);
  return Math.hypot(x, y);
}

/** Analytic velocities: differentiate the loop closure with respect to the crank angle. */
export function velocities(g, theta2, theta3, theta4, omega2 = 1) {
  const determinant = Math.sin(theta3 - theta4);
  if (Math.abs(determinant) < 1e-9) return { singular: true, omega3: 0, omega4: 0, determinant };
  const omega3 = ((g.a * omega2) / g.b) * (Math.sin(theta4 - theta2) / determinant);
  const omega4 = ((g.a * omega2) / g.c) * (Math.sin(theta3 - theta2) / determinant);
  return { singular: false, omega3, omega4, determinant };
}

/** Analytic accelerations at constant input speed. */
export function accelerations(g, theta2, theta3, theta4, omega2, omega3, omega4, alpha2 = 0) {
  const determinant = Math.sin(theta3 - theta4);
  if (Math.abs(determinant) < 1e-9) return { singular: true, alpha3: 0, alpha4: 0 };
  // Differentiating the loop closure twice gives a 2x2 system in (alpha3, alpha4);
  // its Cramer solution is written out here.
  const P = g.a * omega2 ** 2 * Math.cos(theta2) + g.a * alpha2 * Math.sin(theta2)
    + g.b * omega3 ** 2 * Math.cos(theta3) - g.c * omega4 ** 2 * Math.cos(theta4);
  const Ry = -g.a * alpha2 * Math.cos(theta2) + g.a * omega2 ** 2 * Math.sin(theta2)
    + g.b * omega3 ** 2 * Math.sin(theta3) - g.c * omega4 ** 2 * Math.sin(theta4);
  const D = Math.sin(theta4 - theta3);
  const alpha3 = (P * Math.cos(theta4) + Ry * Math.sin(theta4)) / (g.b * D);
  const alpha4 = (Ry * Math.sin(theta3) + P * Math.cos(theta3)) / (g.c * D);
  return { singular: false, alpha3, alpha4 };
}

export function transmissionAngle(theta3, theta4) {
  let angle = Math.abs(theta3 - theta4) % TAU;
  if (angle > Math.PI) angle = TAU - angle;
  return angle;
}

export function grashof(g) {
  const links = [g.a, g.b, g.c, g.d];
  const sorted = [...links].sort((x, y) => x - y);
  const [s, p, q, l] = sorted;
  const type = s + l < p + q ? 'Grashof' : s + l > p + q ? 'non-Grashof' : 'change point';
  const shortest = links.indexOf(s);
  let behaviour = 'double rocker';
  if (type === 'Grashof') {
    if (shortest === 0) behaviour = 'crank–rocker (link a rotates fully)';
    else if (shortest === 1) behaviour = 'double crank (coupler rotates fully)';
    else if (shortest === 3) behaviour = 'double crank (ground is shortest: drag link)';
    else behaviour = 'rocker–crank (link c rotates fully)';
  }
  return { type, behaviour, sum: s + l, other: p + q };
}

export function couplerPoint(g, theta2, theta3, position) {
  const ax = g.a * Math.cos(theta2), ay = g.a * Math.sin(theta2);
  const angle = theta3 + (position.beta * Math.PI) / 180;
  return { x: ax + position.r * Math.cos(angle), y: ay + position.r * Math.sin(angle) };
}

export const linkageSim = {
  id: 'four-bar-linkage',
  unit: 'rev',
  digits: 2,
  note: 'Loop closure solved in closed form every step, with velocities and accelerations from the differentiated loop equation. Rigid planar links: no joint clearance, no link flexibility, no friction.',
  checkNote: 'Loop-closure residual, analytic velocities and accelerations against finite differences, the parallelogram case, the Jacobian singularity, the transmission angle and the Grashof classification against a full-rotation search.',
  params: { ground: 4, crank: 1, coupler: 3.6, rocker: 2.6, rpm: 30, couplerR: 2.2, couplerBeta: 35, branch: 1 },
  fields: [
    { key: 'crank', label: 'Crank a', min: 0.4, max: 4, step: 0.1 },
    { key: 'coupler', label: 'Coupler b', min: 0.8, max: 6, step: 0.1 },
    { key: 'rocker', label: 'Rocker c', min: 0.4, max: 6, step: 0.1 },
    { key: 'ground', label: 'Ground d', min: 0.8, max: 6, step: 0.1 },
    { key: 'rpm', label: 'Input speed (rpm)', min: 1, max: 120, step: 1 },
    { key: 'couplerR', label: 'Coupler point radius', min: 0, max: 6, step: 0.1 },
    { key: 'couplerBeta', label: 'Coupler point angle (°)', min: -180, max: 180, step: 5 },
    { key: 'branch', label: 'Assembly branch', options: [{ value: 1, label: 'Open (elbow down)' }, { value: -1, label: 'Crossed (elbow up)' }] },
  ],
  options: { maxStep: 1 / 600, sampleEvery: 0.02, resetOn: ['branch', 'ground'] },

  init: () => ({ theta2: 0, trace: [], revs: 0, nextTrace: 0 }),

  step(y, dt, p) {
    const g = { a: p.crank, b: p.coupler, c: p.rocker, d: p.ground, branch: Number(p.branch) < 0 ? -1 : 1 };
    const omega = (p.rpm * TAU) / 60;
    const solution = solveFourBar(g, y.theta2);
    if (!solution.ok) return y;
    y.theta2 += omega * dt;
    if (y.theta2 > TAU) { y.theta2 -= TAU; y.revs += 1; y.trace = []; }
    if (y.theta2 >= y.nextTrace) {
      const current = solveFourBar(g, y.theta2);
      if (current.ok) y.trace.push(couplerPoint(g, y.theta2, current.theta3, { r: p.couplerR, beta: p.couplerBeta }));
      y.nextTrace = y.theta2 + TAU / 240;
    }
    if (y.trace.length > 420) y.trace.shift();
    return y;
  },

  read(y, p) {
    const g = { a: p.crank, b: p.coupler, c: p.rocker, d: p.ground, branch: Number(p.branch) < 0 ? -1 : 1 };
    const solution = solveFourBar(g, y.theta2);
    if (!solution.ok) return { ok: false, reason: solution.reason, trace: y.trace };
    const omega2 = (p.rpm * TAU) / 60;
    const v = velocities(g, y.theta2, solution.theta3, solution.theta4, omega2);
    const acc = accelerations(g, y.theta2, solution.theta3, solution.theta4, omega2, v.omega3, v.omega4);
    const point = couplerPoint(g, y.theta2, solution.theta3, { r: p.couplerR, beta: p.couplerBeta });
    const arm = solution.theta3 + (p.couplerBeta * Math.PI) / 180;
    const speed = Math.hypot(
      -omega2 * g.a * Math.sin(y.theta2) - v.omega3 * p.couplerR * Math.sin(arm),
      omega2 * g.a * Math.cos(y.theta2) + v.omega3 * p.couplerR * Math.cos(arm),
    );
    return {
      ok: true,
      theta2: y.theta2, theta3: solution.theta3, theta4: solution.theta4,
      omega2, omega3: v.omega3, omega4: v.omega4,
      alpha3: acc.alpha3, alpha4: acc.alpha4,
      singular: v.singular || acc.singular,
      transmission: transmissionAngle(solution.theta3, solution.theta4),
      residual: loopResidual(g, y.theta2, solution.theta3, solution.theta4),
      grashof: grashof(g),
      point, pointSpeed: speed,
      mechanicalAdvantage: Math.abs(v.omega4) > 1e-9 ? Math.abs(omega2 / v.omega4) : Infinity,
      trace: y.trace,
      revs: y.revs,
      jointA: { x: g.a * Math.cos(y.theta2), y: g.a * Math.sin(y.theta2) },
      jointB: { x: g.d + g.c * Math.cos(solution.theta4), y: g.c * Math.sin(solution.theta4) },
      ground: g,
    };
  },
  series: [],
  verify: verifyLinkage,
};

function verifyLinkage() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const g = { a: 1, b: 3.6, c: 2.6, d: 4, branch: 1 };

  let worstResidual = 0, worstVelocity = 0, worstAcceleration = 0, sampled = 0;
  const h = 1e-6, h2 = 1e-4;
  for (let i = 0; i < 72; i += 1) {
    const theta2 = (i / 72) * TAU;
    const solution = solveFourBar(g, theta2);
    if (!solution.ok) continue;
    const plus = solveFourBar(g, theta2 + h), minus = solveFourBar(g, theta2 - h);
    if (!plus.ok || !minus.ok) continue;
    // Skip configurations sitting on a limit, where the branch flips under a finite difference.
    if (Math.abs(plus.theta4 - minus.theta4) > 0.2) continue;
    sampled += 1;
    worstResidual = Math.max(worstResidual, loopResidual(g, theta2, solution.theta3, solution.theta4));
    const analytic = velocities(g, theta2, solution.theta3, solution.theta4, 1);
    if (!analytic.singular) {
      const numeric4 = (plus.theta4 - minus.theta4) / (2 * h);
      const numeric3 = (plus.theta3 - minus.theta3) / (2 * h);
      worstVelocity = Math.max(worstVelocity, Math.abs(numeric4 - analytic.omega4), Math.abs(numeric3 - analytic.omega3));
      const far = solveFourBar(g, theta2 + h2), farMinus = solveFourBar(g, theta2 - h2);
      if (far.ok && farMinus.ok) {
        const acc4 = (far.theta4 - 2 * solution.theta4 + farMinus.theta4) / (h2 * h2);
        worstAcceleration = Math.max(worstAcceleration, Math.abs(acc4 - accelerations(g, theta2, solution.theta3, solution.theta4, 1, analytic.omega3, analytic.omega4).alpha4));
      }
    }
  }
  push('Loop closure is satisfied over the whole rotation', worstResidual < 1e-9, `worst |residual| ${worstResidual.toExponential(2)} m over ${sampled} crank positions`);
  push('Analytic velocities match finite differences of the solution', worstVelocity < 1e-3, `worst deviation ${worstVelocity.toExponential(2)} rad/rad`);
  push('Analytic accelerations match second differences', worstAcceleration < 1e-3, `worst deviation ${worstAcceleration.toExponential(2)} rad/rad²`);

  const parallel = { a: 1, b: 2, c: 1, d: 2, branch: -1 };
  const atQuarter = solveFourBar(parallel, Math.PI / 2);
  push('Parallelogram linkage keeps the rocker parallel to the crank', Math.abs(atQuarter.theta4 - Math.PI / 2) < 1e-9, `θ4 = ${(atQuarter.theta4 * 180 / Math.PI).toFixed(4)}° at θ2 = 90° on the parallelogram assembly`);
  const pv = velocities(parallel, Math.PI / 2, atQuarter.theta3, atQuarter.theta4, 1);
  push('Parallelogram linkage gives equal input and output speeds', Math.abs(pv.omega4 - 1) < 1e-9, `ω4/ω2 = ${pv.omega4.toFixed(9)}`);

  const changePoint = { a: 1, b: 2, c: 1, d: 2, branch: -1 };
  const atDead = solveFourBar(changePoint, 0);
  const deadPoint = atDead.ok ? velocities(changePoint, 0, atDead.theta3, atDead.theta4, 1).singular : false;
  push('Jacobian singularity is detected at the change point', deadPoint === true, 'sin(θ3 − θ4) → 0 with the links collinear');

  const classification = grashof(g);
  let fullRotation = true;
  for (let i = 0; i < 360; i += 1) if (!solveFourBar(g, (i * Math.PI) / 180).ok) fullRotation = false;
  push('Grashof classification agrees with an exhaustive rotation search', (classification.behaviour.startsWith('crank') || classification.behaviour.startsWith('double')) === fullRotation, `${classification.type}: ${classification.behaviour}, search ${fullRotation ? 'passes' : 'fails'}`);

  // Independent geometry: the angle between the coupler and rocker vectors from the joint positions.
  const solved = solveFourBar(g, 1.1);
  const a2 = { x: g.a * Math.cos(1.1), y: g.a * Math.sin(1.1) };
  const b2 = { x: g.d + g.c * Math.cos(solved.theta4), y: g.c * Math.sin(solved.theta4) };
  const couplerVector = { x: b2.x - a2.x, y: b2.y - a2.y };
  const rockerVector = { x: b2.x - g.d, y: b2.y };
  const dotProduct = couplerVector.x * rockerVector.x + couplerVector.y * rockerVector.y;
  const cosine = Math.abs(dotProduct) / (Math.hypot(couplerVector.x, couplerVector.y) * Math.hypot(rockerVector.x, rockerVector.y));
  const fromVectors = Math.acos(Math.min(1, cosine));
  const angle = transmissionAngle(solved.theta3, solved.theta4);
  push('Transmission angle matches the joint geometry', Math.abs(angle - fromVectors) < 1e-9, `${(angle * 180 / Math.PI).toFixed(3)}° against ${(fromVectors * 180 / Math.PI).toFixed(3)}° from the joint positions`);
  push('Transmission angle stays inside 0–180°', angle >= 0 && angle <= Math.PI, `${(angle * 180 / Math.PI).toFixed(2)}°`);

  return { checks };
}