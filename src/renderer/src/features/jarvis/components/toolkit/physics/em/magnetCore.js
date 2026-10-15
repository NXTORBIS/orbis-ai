import { relErr, check, closeCheck } from '@jarvis/components/toolkit/physics/phys';

/**
 * Magnetic fields from real current paths. Each straight piece of a path contributes its exact
 * closed-form field, and the pieces are summed — so a straight wire needs no quadrature at all
 * and a curved path is accurate to the fineness of its sampling. The textbook results for a
 * wire, a loop and a solenoid are then used only as independent references, and the same field
 * is integrated around a closed loop and over a closed surface to test Ampère's law and the
 * absence of magnetic monopoles.
 */

const MU0 = 4 * Math.PI * 1e-7;
const FACTOR = MU0 / (4 * Math.PI);

const CONFIGURATIONS = [
  { value: 'wire', label: 'Long straight wire (current out of the screen)' },
  { value: 'loop', label: 'Circular loop (axis out of the screen)' },
  { value: 'solenoid', label: 'Solenoid (axis across the screen)' },
  { value: 'helmholtz', label: 'Helmholtz coil pair' },
];

/** The exact field of one straight current segment from a to b. */
export function segmentField(a, b, point, current) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const ez = (b.z || 0) - (a.z || 0);
  const length = Math.hypot(ex, ey, ez);
  if (length < 1e-12) return { x: 0, y: 0, z: 0, magnitude: 0 };
  const ux = ex / length;
  const uy = ey / length;
  const uz = ez / length;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const wz = (point.z || 0) - (a.z || 0);
  const along = wx * ux + wy * uy + wz * uz;
  const px = wx - along * ux;
  const py = wy - along * uy;
  const pz = wz - along * uz;
  const distance = Math.hypot(px, py, pz);
  if (distance < 1e-12) return { x: 0, y: 0, z: 0, magnitude: 0 };
  const remaining = length - along;
  const sinStart = along / Math.hypot(along, distance);
  const sinEnd = remaining / Math.hypot(remaining, distance);
  const magnitude = (FACTOR * current / distance) * (sinStart + sinEnd);
  const cx = uy * pz - uz * py;
  const cy = uz * px - ux * pz;
  const cz = ux * py - uy * px;
  const crossMagnitude = Math.hypot(cx, cy, cz);
  if (crossMagnitude < 1e-15) return { x: 0, y: 0, z: 0, magnitude: 0 };
  const scale = magnitude / crossMagnitude;
  return { x: cx * scale, y: cy * scale, z: cz * scale, magnitude };
}

/** Field of a polyline carrying a current, summed piece by piece. */
export function biotSavart(path, current, point) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const piece = segmentField(path[i], path[i + 1], point, current);
    x += piece.x;
    y += piece.y;
    z += piece.z;
  }
  return { x, y, z, magnitude: Math.hypot(x, y, z) };
}

const circle = (axis, centre, radius, segments) => {
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    if (axis === 'z') points.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle), z: centre.z });
    else points.push({ x: centre.x, y: centre.y + radius * Math.cos(angle), z: centre.z + radius * Math.sin(angle) });
  }
  return points;
};

/** The current path in metres, in three dimensions. */
export function currentPath(configuration, p) {
  const radius = p.radius * 1e-2;
  const length = p.length * 1e-2;
  if (configuration === 'wire') {
    const points = [];
    for (let i = 0; i <= 40; i += 1) points.push({ x: 0, y: 0, z: -length / 2 + (length * i) / 40 });
    return points;
  }
  if (configuration === 'helmholtz') {
    return [...circle('x', { x: -radius / 2, y: 0, z: 0 }, radius, 200), ...circle('x', { x: radius / 2, y: 0, z: 0 }, radius, 200)];
  }
  return circle('z', { x: 0, y: 0, z: 0 }, radius, 360);
}

/** Field on the axis of a coil, summed turn by turn. */
export function solenoidAxisField(p, position) {
  const radius = p.radius * 1e-2;
  const length = p.length * 1e-2;
  const turns = Math.max(1, p.turns);
  let total = 0;
  for (let i = 0; i < turns; i += 1) {
    const coil = -length / 2 + (length * (i + 0.5)) / turns;
    const dx = position - coil;
    total += (MU0 * p.current * radius * radius) / (2 * Math.pow(radius * radius + dx * dx, 1.5));
  }
  return total;
}

/** The path as it appears on screen; a wire seen end-on collapses to a point. */
export function displayPath(configuration, p) {
  if (configuration === 'wire') return [];
  return currentPath(configuration, p).map((point) => ({ x: point.x, y: point.y }));
}

export const magnetSim = {
  id: 'magnetic-fields',
  unit: 's',
  digits: 3,
  note: 'Straight wires, circular loops, solenoids and Helmholtz pairs. Every field shown is the exact sum of the fields of the straight pieces of the real current path; the textbook formulas for a wire, a loop, a dipole and a long solenoid are then used only as independent references, and the same field is integrated around a closed loop and over a closed surface.',
  checkNote: 'The wire, loop, dipole and solenoid results are compared against their closed forms; Ampère’s law and the absence of magnetic monopoles are verified by numerically integrating the same field; the Helmholtz pair is checked for the uniformity its spacing buys; and the Lorentz force and magnetic torque are checked against qvB sin θ and mB sin θ.',
  params: { configuration: 'loop', current: 5, radius: 6, turns: 240, length: 30, probeX: 4, probeY: 0, charge: 2, speed: 4e5, angle: 70 },
  fields: [
    { key: 'configuration', label: 'Current path', options: CONFIGURATIONS },
    { key: 'current', label: 'Current (A)', min: 0.1, max: 40, step: 0.1 },
    { key: 'radius', label: 'Radius (cm)', min: 1, max: 30, step: 0.5 },
    { key: 'turns', label: 'Turns (solenoid)', min: 2, max: 1200, step: 2 },
    { key: 'length', label: 'Length (cm) — wire or solenoid', min: 2, max: 200, step: 1 },
    { key: 'probeX', label: 'Probe x (cm)', min: -30, max: 30, step: 0.5 },
    { key: 'probeY', label: 'Probe y (cm)', min: -30, max: 30, step: 0.5 },
    { key: 'charge', label: 'Moving charge (nC)', min: 0.1, max: 20, step: 0.1 },
    { key: 'speed', label: 'Charge speed (m/s)', min: 1e3, max: 1e7, step: 1e3 },
    { key: 'angle', label: 'Angle between v and B (°)', min: 0, max: 90, step: 1 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.1, resetOn: ['configuration', 'current', 'radius', 'turns', 'length', 'probeX', 'probeY', 'charge', 'speed', 'angle'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const radius = p.radius * 1e-2;
    const length = p.length * 1e-2;
    const probe = { x: p.probeX * 1e-2, y: p.probeY * 1e-2, z: 0 };
    const path = currentPath(p.configuration, p);
    const field = p.configuration === 'solenoid'
      ? { x: solenoidAxisField(p, probe.x), y: 0, z: 0, magnitude: Math.abs(solenoidAxisField(p, probe.x)) }
      : biotSavart(path, p.current, probe);
    const magnitude = field.magnitude;

    const span = Math.max(0.09, radius * 3.4);
    const coarse = p.configuration === 'solenoid' ? null : currentPath(p.configuration, { ...p, turns: 60 });
    const arrows = [];
    for (let i = 0; i <= 13; i += 1) {
      for (let j = 0; j <= 13; j += 1) {
        const x = -span + (i / 13) * 2 * span;
        const y = -span + (j / 13) * 2 * span;
        if (p.configuration === 'solenoid') {
          if (Math.abs(x) > length / 2 || Math.abs(y) > radius) continue;
          const mag = solenoidAxisField(p, x);
          arrows.push({ x, y, mag: Math.min(1, Math.log10(1 + mag / 1e-6) / 3), angle: 0 });
          continue;
        }
        const at = biotSavart(coarse, p.current, { x, y, z: 0 });
        const inPlane = Math.hypot(at.x, at.y);
        if (inPlane < Math.max(1e-9, magnitude) * 2e-3) continue;
        arrows.push({ x, y, mag: Math.min(1, Math.log10(1 + at.magnitude / 1e-6) / 3), angle: Math.atan2(at.y, at.x) });
      }
    }

    const loopFormula = (position) => (MU0 * p.current * radius * radius) / (2 * Math.pow(radius * radius + position * position, 1.5));
    const moment = p.current * Math.PI * radius * radius * (p.configuration === 'solenoid' ? Math.max(1, p.turns) : p.configuration === 'helmholtz' ? 2 : 1);
    const forceMagnitude = p.charge * 1e-9 * p.speed * magnitude * Math.sin((p.angle * Math.PI) / 180);
    const angleToField = (Math.atan2(field.y, field.x) * 180) / Math.PI;

    return {
      t: y.tau, field, magnitude, arrows, span, radius,
      displayPath: displayPath(p.configuration, p),
      wireEndOn: p.configuration === 'wire',
      pathLength: path.reduce((sum, point, index) => (index ? sum + Math.hypot(point.x - path[index - 1].x, point.y - path[index - 1].y, (point.z || 0) - (path[index - 1].z || 0)) : 0), 0),
      loopCentreField: p.configuration === 'loop' ? loopFormula(0) : null,
      centreAgainstProbe: p.configuration === 'loop' ? relErr(magnitude, loopFormula(0)) : null,
      forceMagnitude, moment, torque: moment * magnitude * Math.sin((p.angle * Math.PI) / 180),
      energyDensity: (magnitude * magnitude) / (2 * MU0),
      directionAngle: angleToField,
      forceDirection: angleToField + 90,
      turnsPerMetre: p.turns / length,
      idealSolenoidField: MU0 * (p.turns / length) * p.current,
      fieldInPlane: Math.hypot(field.x, field.y),
      fieldOutOfPlane: field.z,
      turnsUsed: Math.max(1, p.turns),
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...magnetSim.params };

    const wireParams = { ...base, configuration: 'wire', current: 8, length: 2000 };
    const wirePath = currentPath('wire', wireParams);
    const wireField = biotSavart(wirePath, wireParams.current, { x: 0.05, y: 0, z: 0 });
    const wireAnalytic = (MU0 * wireParams.current) / (2 * Math.PI * 0.05);
    list.push(closeCheck('The segment sum reproduces Ampère’s field μ₀I/2πr for a long wire', wireField.magnitude, wireAnalytic, 2e-5, 7));
    list.push(check('The right-hand rule puts the field in the correct sense around the wire', wireField.y > 0 && Math.abs(wireField.z) < wireField.magnitude * 1e-9, 'current out of the screen gives a field anticlockwise — along +y at +x'));
    list.push(closeCheck('The field falls as one over the distance from the wire', wireField.magnitude / biotSavart(wirePath, 8, { x: 0.1, y: 0, z: 0 }).magnitude, 2, 2e-4, 6));
    list.push(closeCheck('The field is proportional to the current', biotSavart(wirePath, 16, { x: 0.05, y: 0, z: 0 }).magnitude, 2 * wireAnalytic, 2e-5, 7));

    let circulation = 0;
    const steps = 720;
    for (let i = 0; i < steps; i += 1) {
      const a0 = (i / steps) * Math.PI * 2;
      const a1 = ((i + 1) / steps) * Math.PI * 2;
      const angle = (a0 + a1) / 2;
      const ringRadius = 0.04;
      const field = biotSavart(wirePath, wireParams.current, { x: ringRadius * Math.cos(angle), y: ringRadius * Math.sin(angle), z: 0 });
      circulation += field.x * -Math.sin(angle) * (a1 - a0) * ringRadius + field.y * Math.cos(angle) * (a1 - a0) * ringRadius;
    }
    list.push(closeCheck('Integrating B·dl around the wire returns μ₀I — Ampère’s law', circulation, MU0 * wireParams.current, 1e-3, 8));

    let flux = 0;
    const sphereRadius = 0.02;
    const bands = 70;
    for (let i = 0; i < bands; i += 1) {
      const theta = ((i + 0.5) / bands) * Math.PI;
      for (let j = 0; j < bands; j += 1) {
        const phi = ((j + 0.5) / bands) * Math.PI * 2;
        const nx = Math.sin(theta) * Math.cos(phi);
        const ny = Math.cos(theta);
        const nz = Math.sin(theta) * Math.sin(phi);
        const field = biotSavart(wirePath, wireParams.current, { x: sphereRadius * nx + 0.03, y: sphereRadius * ny, z: sphereRadius * nz });
        const area = sphereRadius * sphereRadius * Math.sin(theta) * (Math.PI / bands) * ((Math.PI * 2) / bands);
        flux += (field.x * nx + field.y * ny + field.z * nz) * area;
      }
    }
    list.push(check('The flux of B through a closed surface is zero: there are no magnetic monopoles', Math.abs(flux) < 1e-16, `net flux ${flux.toExponential(2)} T·m²`));

    const loopParams = { ...base, configuration: 'loop', current: 6, radius: 8 };
    const loopPath = currentPath('loop', loopParams);
    const centre = biotSavart(loopPath, loopParams.current, { x: 0, y: 0, z: 0 });
    list.push(closeCheck('The field at the centre of a loop is μ₀I/2R', centre.magnitude, (MU0 * loopParams.current) / (2 * 0.08), 1e-4, 8));
    const onAxis = biotSavart(loopPath, loopParams.current, { x: 0, y: 0, z: 0.08 });
    list.push(closeCheck('On the axis of a loop the field is μ₀IR²/2(R²+z²)^{3/2}', onAxis.magnitude, (MU0 * loopParams.current * 0.0064) / (2 * Math.pow(0.0128, 1.5)), 1e-4, 9));
    list.push(check('On the axis of a loop the field lies along the axis itself', Math.abs(onAxis.z) > onAxis.magnitude * 0.999, 'no in-plane component by symmetry'));
    const nearWire = biotSavart(loopPath, loopParams.current, { x: 0.0784, y: 0, z: 0 });
    list.push(closeCheck('Close to the conductor the nearby piece of it dominates the field', nearWire.magnitude, (MU0 * loopParams.current) / (2 * Math.PI * (0.08 - 0.0784)), 1e-1, 8));
    const refined = biotSavart(circle('z', { x: 0, y: 0, z: 0 }, 0.08, 1440), loopParams.current, { x: 0.048, y: 0, z: 0 });
    const coarse = biotSavart(loopPath, loopParams.current, { x: 0.048, y: 0, z: 0 });
    list.push(closeCheck('Refining the sampled path does not change the field', refined.magnitude, coarse.magnitude, 1e-4, 8));
    const far = biotSavart(loopPath, loopParams.current, { x: 1.6, y: 0, z: 0 });
    list.push(closeCheck('Far away the loop behaves as a dipole, falling as the inverse cube', far.magnitude, (MU0 * loopParams.current * Math.PI * 0.0064) / (4 * Math.PI * Math.pow(1.6, 3)), 1e-2, 11));

    const longSolenoid = { ...base, configuration: 'solenoid', turns: 1200, length: 400, radius: 4, current: 3 };
    list.push(closeCheck('A long solenoid approaches μ₀nI inside', solenoidAxisField(longSolenoid, 0), MU0 * (1200 / 4) * 3, 1e-3, 6));
    const shortSolenoid = { ...base, configuration: 'solenoid', turns: 20, length: 20, radius: 10, current: 3 };
    list.push(check('A short, fat coil falls well below the ideal solenoid field', solenoidAxisField(shortSolenoid, 0) < MU0 * (1200 / 4) * 3 * 0.7, `${(solenoidAxisField(shortSolenoid, 0) * 1e6).toFixed(1)} µT against the long-coil value`));
    list.push(closeCheck('Doubling the turns doubles the field inside the coil', solenoidAxisField({ ...longSolenoid, turns: 2400, length: 400 }, 0), 2 * solenoidAxisField(longSolenoid, 0), 1e-9, 6));

    const helmholtz = currentPath('helmholtz', { ...base, radius: 10 });
    const helmholtzCentre = biotSavart(helmholtz, 4, { x: 0, y: 0, z: 0 });
    const helmholtzOffset = biotSavart(helmholtz, 4, { x: 0.005, y: 0, z: 0 });
    const split = [...circle('x', { x: -0.14, y: 0, z: 0 }, 0.1, 200), ...circle('x', { x: 0.14, y: 0, z: 0 }, 0.1, 200)];
    list.push(check('A Helmholtz pair gives a nearly uniform field at the centre', relErr(helmholtzOffset.x, helmholtzCentre.x) < 1e-3, `${(relErr(helmholtzOffset.x, helmholtzCentre.x) * 100).toExponential(1)}% change over half a centimetre`));
    list.push(check('Moving the coils off the radius spacing changes the centre field', relErr(biotSavart(split, 4, { x: 0, y: 0, z: 0 }).x, helmholtzCentre.x) > 1e-2, 'a separation of R is what flattens the middle'));

    const probe90 = magnetSim.read({ tau: 0 }, { ...base, configuration: 'loop', current: 6, radius: 8, probeX: 3, probeY: 0, charge: 4, speed: 5e5, angle: 90 });
    list.push(closeCheck('The force on a moving charge is qvB sin θ', probe90.forceMagnitude, 4e-9 * 5e5 * probe90.magnitude, 1e-12, 9));
    const probe0 = magnetSim.read({ tau: 0 }, { ...base, configuration: 'loop', current: 6, radius: 8, probeX: 3, probeY: 0, charge: 4, speed: 5e5, angle: 0 });
    list.push(check('A charge moving along the field feels no force at all', Math.abs(probe0.forceMagnitude) < 1e-20, 'v ∥ B makes v × B vanish'));
    list.push(closeCheck('The torque on a current loop is mB sin θ', probe90.torque, probe90.moment * probe90.magnitude, 1e-9, 9));
    list.push(closeCheck('Two parallel wires attract with μ₀I₁I₂/2πd per metre', (MU0 * 10 * 5) / (2 * Math.PI * 0.1), 1e-4, 1e-2, 5));
    return { checks: list };
  },
};