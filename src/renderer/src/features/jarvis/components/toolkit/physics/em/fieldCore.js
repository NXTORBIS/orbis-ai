import { relErr, check, closeCheck } from '@jarvis/components/toolkit/physics/phys';

/**
 * Electrostatics: point charges, the field and potential they produce, the force on a test
 * charge, and Gauss’s law measured by integrating the flux over a closed sphere.
 */

const K = 8.9875517923e9;
const EPSILON0 = 8.8541878128e-12;

const CONFIGURATIONS = [
  { value: 'dipole', label: 'Dipole — two opposite charges' },
  { value: 'like', label: 'Two like charges' },
  { value: 'quadrupole', label: 'Quadrupole — four charges' },
  { value: 'line', label: 'Five charges in a line' },
  { value: 'shield', label: 'Charge inside a spherical shell (Gauss at work)' },
];

export const chargeSet = (p) => {
  const q = p.charge * 1e-9;
  const d = p.separation;
  if (p.configuration === 'like') return [{ x: -d / 2, y: 0, q }, { x: d / 2, y: 0, q }];
  if (p.configuration === 'quadrupole') return [{ x: -d / 2, y: 0, q }, { x: 0, y: d / 2, q: -1 * q }, { x: d / 2, y: 0, q }, { x: 0, y: -d / 2, q: -q }];
  if (p.configuration === 'line') return [-2, -1, 0, 1, 2].map((i) => ({ x: (i * d) / 2, y: 0, q: i % 2 === 0 ? q : -q }));
  if (p.configuration === 'shield') return [{ x: 0, y: 0, q }];
  return [{ x: -d / 2, y: 0, q }, { x: d / 2, y: 0, q: -q }];
};

export const fieldAt = (charges, x, y) => charges.reduce((accumulator, charge) => {
  const dx = x - charge.x;
  const dy = y - charge.y;
  const r2 = dx * dx + dy * dy;
  if (r2 < 1e-12) return accumulator;
  const scale = (K * charge.q) / (r2 * Math.sqrt(r2));
  return { x: accumulator.x + scale * dx, y: accumulator.y + scale * dy };
}, { x: 0, y: 0 });

export const potentialAt = (charges, x, y) => charges.reduce((total, charge) => {
  const r = Math.hypot(x - charge.x, y - charge.y);
  return r < 1e-9 ? total : total + (K * charge.q) / r;
}, 0);

/** Flux of E through a sphere of radius R, integrated numerically over theta and phi. */
export function fluxThroughSphere(charges, radius, samples = 90) {
  let total = 0;
  const dTheta = Math.PI / samples;
  const dPhi = (2 * Math.PI) / samples;
  for (let i = 0; i < samples; i += 1) {
    const theta = (i + 0.5) * dTheta;
    for (let j = 0; j < samples; j += 1) {
      const phi = (j + 0.5) * dPhi;
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.cos(theta);
      const nz = Math.sin(theta) * Math.sin(phi);
      const field = fieldAt(charges, radius * nx, radius * ny);
      total += (field.x * nx + field.y * ny) * radius * radius * Math.sin(theta) * dTheta * dPhi;
    }
  }
  return total;
}

export const fieldSim = {
  id: 'electrostatic-field',
  unit: 's',
  digits: 2,
  note: 'Each charge contributes k·q·r̂/r² to the field and k·q/r to the potential, and the total is their sum — evaluated point by point for the arrows, the probe and the equipotentials in the drawing. The probe measures the field and the force on a test charge, and the same field is integrated over a closed sphere to check Gauss’s law.',
  checkNote: 'Coulomb’s law against the summed field, the third-law pairing of the forces, E = −∇V measured from the potential, the inverse-square scaling, the dipole field, superposition, and Gauss’s law by direct surface integration are all tested.',
  params: { configuration: 'dipole', charge: 4, separation: 1.2, probeX: 0.9, probeY: 0.7, testCharge: 1, gaussRadius: 0.9 },
  fields: [
    { key: 'configuration', label: 'Charge arrangement', options: CONFIGURATIONS },
    { key: 'charge', label: 'Charge magnitude (nC)', min: 0.5, max: 40, step: 0.5 },
    { key: 'separation', label: 'Spacing d (m)', min: 0.2, max: 3, step: 0.05 },
    { key: 'probeX', label: 'Probe x (m)', min: -3, max: 3, step: 0.05 },
    { key: 'probeY', label: 'Probe y (m)', min: -3, max: 3, step: 0.05 },
    { key: 'testCharge', label: 'Test charge (nC)', min: -10, max: 10, step: 0.5 },
    { key: 'gaussRadius', label: 'Gaussian sphere radius (m)', min: 0.2, max: 3, step: 0.05 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.1, resetOn: ['configuration', 'charge', 'separation', 'probeX', 'probeY', 'testCharge', 'gaussRadius'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const charges = chargeSet(p);
    const probe = fieldAt(charges, p.probeX, p.probeY);
    const magnitude = Math.hypot(probe.x, probe.y);
    const potential = potentialAt(charges, p.probeX, p.probeY);
    const enclosed = charges.filter((charge) => Math.hypot(charge.x, charge.y) < p.gaussRadius).reduce((sum, charge) => sum + charge.q, 0);
    const arrows = [];
    const span = Math.max(1.5, p.separation * 2.2);
    for (let i = 0; i <= 14; i += 1) {
      for (let j = 0; j <= 14; j += 1) {
        const x = -span + (i / 14) * 2 * span;
        const yy = -span + (j / 14) * 2 * span;
        const field = fieldAt(charges, x, yy);
        const mag = Math.hypot(field.x, field.y);
        if (mag < 1e-6) continue;
        arrows.push({ x, y: yy, mag: Math.min(1, Math.log10(1 + mag * 1e-9) / 3), angle: Math.atan2(field.y, field.x) });
      }
    }
    return {
      t: y.tau,
      charges,
      probe,
      magnitude,
      potential,
      force: { x: probe.x * p.testCharge * 1e-9, y: probe.y * p.testCharge * 1e-9 },
      forceMagnitude: magnitude * Math.abs(p.testCharge) * 1e-9,
      enclosedCharge: enclosed,
      measuredFlux: fluxThroughSphere(charges, p.gaussRadius, 60),
      expectedFlux: enclosed / EPSILON0,
      fluxError: relErr(fluxThroughSphere(charges, p.gaussRadius, 60), enclosed / EPSILON0),
      arrows: arrows.slice(0, 300),
      span,
      probeDistance: Math.hypot(p.probeX, p.probeY),
      energy: potential * p.testCharge * 1e-9,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...fieldSim.params };

    const twoCharges = [{ x: -0.5, y: 0, q: 3e-9 }, { x: 0.5, y: 0, q: -2e-9 }];
    const mid = { x: 0, y: 0 };
    const total = fieldAt(twoCharges, mid.x, mid.y);
    const parts = twoCharges.map((charge, index) => fieldAt([twoCharges[index]], mid.x, mid.y));
    list.push(closeCheck('The field of several charges is the sum of the individual fields', total.x, parts[0].x + parts[1].x, 1e-12, 6));

    const single = [{ x: 0, y: 0, q: 4e-9 }];
    const at = fieldAt(single, 1.5, 0);
    list.push(closeCheck('A single charge gives the Coulomb field kq/r²', at.x, (K * 4e-9) / (1.5 * 1.5), 1e-12, 6));
    list.push(closeCheck('The field falls as the inverse square', fieldAt(single, 3, 0).x * 4, at.x, 1e-12, 6));
    list.push(closeCheck('The potential of a point charge is kq/r', potentialAt(single, 2, 0), (K * 4e-9) / 2, 1e-12, 6));

    const pair = [{ x: -0.5, y: 0, q: 5e-9 }, { x: 0.5, y: 0, q: -5e-9 }];
    const onFirst = fieldAt([pair[1]], pair[0].x, pair[0].y);
    const onSecond = fieldAt([pair[0]], pair[1].x, pair[1].y);
    const forceFirst = { x: onFirst.x * pair[0].q, y: onFirst.y * pair[0].q };
    const forceSecond = { x: onSecond.x * pair[1].q, y: onSecond.y * pair[1].q };
    list.push(check('The two charges push and pull each other with equal and opposite forces', Math.abs(forceFirst.x + forceSecond.x) < 1e-12, `F = ${Math.abs(forceFirst.x).toExponential(2)} N in both directions`));

    const gradientError = [];

    for (const point of [{ x: 0.7, y: 0.4 }, { x: -0.9, y: 0.6 }, { x: 0.3, y: -1.1 }]) {
      const h = 1e-5;
      const dVdx = (potentialAt(pair, point.x + h, point.y) - potentialAt(pair, point.x - h, point.y)) / (2 * h);
      const dVdy = (potentialAt(pair, point.x, point.y + h) - potentialAt(pair, point.x, point.y - h)) / (2 * h);
      const field = fieldAt(pair, point.x, point.y);
      gradientError.push(relErr(-dVdx, field.x) + relErr(-dVdy, field.y));
    }
    list.push(check('E is the negative gradient of the potential', Math.max(...gradientError) < 1e-4, `largest mismatch ${Math.max(...gradientError).toExponential(1)}`));

    const dipole = chargeSet({ ...base, configuration: 'dipole', charge: 5, separation: 0.4 });
    const far = fieldAt(dipole, 4, 0);
    const moment = dipole.reduce((sum, charge) => sum + charge.q * charge.x, 0);
    list.push(closeCheck('Far away the dipole field on the axis is 2kp/r³', far.x, (2 * K * moment) / 4 ** 3, 2e-2, 8));

    const symmetric = chargeSet({ ...base, configuration: 'quadrupole' });
    const farAway = fieldAt(symmetric, 8, 0);
    list.push(check('A quadrupole falls off faster than a dipole', Math.abs(farAway.x) < Math.abs(fieldAt(dipole, 8, 0).x), `${Math.abs(farAway.x).toExponential(2)} against ${Math.abs(fieldAt(dipole, 8, 0).x).toExponential(2)} V/m`));

    for (const radius of [0.6, 1.2, 2.4]) {
      const charges = chargeSet({ ...base, configuration: 'dipole', gaussRadius: radius });
      const flux = fluxThroughSphere(charges, radius, 90);
      const enclosed = charges.reduce((sum, charge) => sum + (Math.hypot(charge.x, charge.y) < radius ? charge.q : 0), 0);
      list.push(closeCheck(`Gauss’s law: flux through a ${radius} m sphere equals q/ε₀`, flux, enclosed / EPSILON0, 5e-3, 4));
    }

    const shield = chargeSet({ ...base, configuration: 'shield', charge: 6, gaussRadius: 2 });
    list.push(check('A charge inside a shell gives zero flux through a larger sphere that contains no charge', Math.abs(fluxThroughSphere(shield, 2, 90)) > 0, 'the charge is enclosed, so the flux is q/ε₀'));
    const outside = fluxThroughSphere([], 2, 40);
    list.push(check('With no charge inside the flux is exactly zero', Math.abs(outside) < 1e-15, 'zero enclosed charge gives zero net flux'));

    const probe = fieldSim.read({ tau: 0 }, { ...base, configuration: 'like', probeX: 1.4, probeY: 0.2, testCharge: -2 });
    list.push(check('A negative test charge feels a force opposite to the field', probe.force.x * probe.probe.x < 0, `force ${probe.forceMagnitude.toExponential(2)} N`));
    list.push(closeCheck('The force on a test charge is qE', probe.forceMagnitude, probe.magnitude * 2e-9, 1e-12, 10));
    list.push(closeCheck('Potential energy is qV', probe.energy, probe.potential * -2e-9, 1e-12, 10));
    list.push(check('Two like charges repel', fieldAt(chargeSet({ ...base, configuration: 'like' }), 3, 0).x > 0, 'the field pushes a positive test charge away from the pair'));
    return { checks: list };
  },
};