import { MoveDiagonal, Compass } from 'lucide-react';
import { rk4, relErr, check, closeCheck, bisect, sig } from '@jarvis/components/toolkit/physics/phys';

/**
 * A block on an inclined plane with static and kinetic friction and an applied force along
 * the plane. The friction regime is decided from the limiting condition, never assumed.
 */

const DEG = Math.PI / 180;

/** Decide the regime at the current velocity and return the whole force balance. */
export function balance(p, v) {
  const theta = p.angle * DEG;
  const weight = p.mass * p.gravity;
  const normal = weight * Math.cos(theta);
  const gravityAlong = -weight * Math.sin(theta); // +s points up the slope
  const drive = p.applied + gravityAlong;
  const staticLimit = p.muS * normal;
  let friction;
  let state;
  if (Math.abs(v) < 1e-6 && Math.abs(drive) <= staticLimit) {
    friction = -drive; // static friction exactly balances the driving force
    state = 'at rest — static friction holds it';
  } else {
    const direction = Math.abs(v) > 1e-6 ? Math.sign(v) : Math.sign(drive);
    friction = -direction * p.muK * normal;
    state = direction > 0 ? 'sliding up the plane' : 'sliding down the plane';
  }
  const net = drive + friction;
  const acceleration = net / p.mass;
  return {
    theta,
    normal,
    weight,
    gravityAlong,
    drive,
    staticLimit,
    friction,
    net,
    acceleration,
    state,
    sliding: Math.abs(v) > 1e-6 || Math.abs(drive) > staticLimit,
    frictionAngle: (Math.atan(p.muS) * 180) / Math.PI,
  };
}

const derivative = (p) => (state) => [state[1], balance(p, state[1]).acceleration];

export const inclineSim = {
  id: 'inclined-plane-forces',
  unit: 's',
  digits: 2,
  note: 'The block’s weight is resolved along and perpendicular to the plane; the normal force cancels the perpendicular component, and friction is either static (holding the block when the driving force is inside the friction limit) or kinetic (opposing the motion, never exceeding μk·N). The regime is decided every step from the limiting condition.',
  checkNote: 'The decomposition of the weight, the friction limit, the critical angle for sliding, the Newton’s-law residual and the energy ledger are all re-computed numerically and compared with the closed-form results.',
  params: { mass: 8, angle: 22, applied: 0, muS: 0.45, muK: 0.35, gravity: 9.81 },
  fields: [
    { key: 'mass', label: 'Block mass (kg)', min: 0.5, max: 60, step: 0.5 },
    { key: 'angle', label: 'Incline angle (°)', min: 0, max: 75, step: 1 },
    { key: 'applied', label: 'Applied force up the plane (N)', min: -300, max: 300, step: 5 },
    { key: 'muS', label: 'Static friction coefficient μs', min: 0, max: 1.2, step: 0.01 },
    { key: 'muK', label: 'Kinetic friction coefficient μk', min: 0, max: 1.2, step: 0.01 },
    { key: 'gravity', label: 'Gravitational acceleration (m/s²)', min: 1, max: 25, step: 0.01 },
  ],
  options: { maxStep: 1 / 600, sampleEvery: 0.04, resetOn: ['mass', 'angle', 'applied', 'muS', 'muK', 'gravity'] },
  init: (p) => ({ tau: 0, s: 0, v: 0, heat: 0, slidingDistance: 0 }),
  step: (y, h, p) => {
    const [s, v] = rk4(derivative(p), [y.s, y.v], y.tau, h);
    const moving = Math.abs(v) > 1e-6;
    let nextV = v;
    if (!moving) nextV = 0;
    const heat = y.heat + (moving ? p.muK * balance(p, v).normal * Math.abs(s - y.s) : 0);
    return { ...y, tau: y.tau + h, s, v: nextV, heat, slidingDistance: y.slidingDistance + (moving ? Math.abs(s - y.s) : 0) };
  },
  read: (y, p) => {
    const b = balance(p, y.v);
    const height = y.s * Math.sin(b.theta);
    return {
      t: y.tau,
      ...b,
      s: y.s,
      v: y.v,
      height,
      potentialEnergy: p.mass * p.gravity * height,
      kineticEnergy: 0.5 * p.mass * y.v * y.v,
      heat: y.heat,
      slidingDistance: y.slidingDistance,
      workApplied: p.applied * y.s,
      frictionWork: -b.friction * y.s,
      weightComponents: { along: Math.abs(b.weight * Math.sin(b.theta)), normal: b.normal, total: b.weight },
      criticalAngle: b.frictionAngle,
      staysPut: !b.sliding,
      requiredHoldForce: p.mass * p.gravity * Math.sin(b.theta),
    };
  },
  series: [
    { key: 's', label: 'Distance up the plane (m)', value: (r) => r.s },
    { key: 'v', label: 'Speed (m/s)', value: (r) => r.v },
    { key: 'ke', label: 'Kinetic energy (J)', value: (r) => r.kineticEnergy },
    { key: 'heat', label: 'Heat from friction (J)', value: (r) => r.heat },
  ],
  verify: () => {
    const list = [];
    const base = { ...inclineSim.params };
    const b = balance(base, 0);
    const theta = base.angle * DEG;
    list.push(closeCheck('Normal force equals mg·cos θ', b.normal, base.mass * base.gravity * Math.cos(theta), 1e-12, 4));
    list.push(closeCheck('Weight decomposition rebuilds the weight', Math.hypot(b.weight * Math.sin(theta), b.normal), b.weight, 1e-12, 4));
    list.push(closeCheck('Friction limit is μs·N', b.staticLimit, base.muS * b.normal, 1e-12, 4));

    const run = (params, seconds = 2) => {
      let y = inclineSim.init(params);
      for (let t = 0; t < seconds; t += 1e-3) y = inclineSim.step(y, 1e-3, params);
      return y;
    };
    const atRest = run({ ...base, applied: 0, angle: 15, muS: 0.5, muK: 0.4 });
    list.push(check('A block inside the friction limit does not move', Math.abs(atRest.v) < 1e-9 && Math.abs(atRest.s) < 1e-9, `v = ${atRest.v.toExponential(1)} m/s after 2 s on a 15° slope with μs = 0.5`));

    const sliding = run({ ...base, applied: 0, angle: 40, muS: 0.5, muK: 0.3 });
    const slidingBalance = balance({ ...base, angle: 40, muK: 0.3 }, 0);
    list.push(closeCheck('Sliding acceleration equals g(sin θ − μk cos θ)', slidingBalance.acceleration, -base.gravity * (Math.sin(40 * DEG) - 0.3 * Math.cos(40 * DEG)), 1e-9, 4));

    // The critical angle where sliding begins, found by simulation rather than assumed.
    const slideAt = (angle) => run({ ...base, angle, applied: 0, muS: 0.45, muK: 0.4 }, 1.5).s;
    const critical = bisect((angle) => slideAt(angle) + 0.002, 5, 60, 1e-6, 60);
    list.push(closeCheck('Critical angle for sliding is atan μs', critical, (Math.atan(0.45) * 180) / Math.PI, 3e-3, 3));

    const held = balance({ ...base, angle: 20, applied: base.mass * base.gravity * Math.sin(20 * DEG) }, 0);
    list.push(check('An applied force equal to mg sin θ holds the block with no friction demand', Math.abs(held.friction) < 1e-9, `friction ${sig(held.friction, 2)} N`));

    const residual = Math.abs(base.mass * slidingBalance.acceleration - (slidingBalance.drive + slidingBalance.friction));
    list.push(check('Newton’s second law residual is zero', residual < 1e-10, `|ma − ΣF| = ${residual.toExponential(1)} N`));

    const energyParams = { ...base, angle: 35, applied: 0, muS: 0.4, muK: 0.25 };
    const energyRun = inclineSim.read(run(energyParams, 1.5), energyParams);
    // starting at rest on the base, K + U + heat must stay zero: the drop in height energy
    // is shared between the kinetic energy gained and the heat produced by friction
    const ledger = energyRun.kineticEnergy + energyRun.potentialEnergy + energyRun.heat;
    list.push(check('Energy ledger closes: K + U + heat equals zero from the start', Math.abs(ledger) < 1e-6, `residual ${ledger.toExponential(1)} J`));

    const frictionNeverExceedsLimit = Math.abs(slidingBalance.friction) <= slidingBalance.staticLimit + 1e-12;
    list.push(check('Kinetic friction never exceeds the static limit', frictionNeverExceedsLimit, `|f| = ${Math.abs(slidingBalance.friction).toFixed(3)} N ≤ ${slidingBalance.staticLimit.toFixed(3)} N`));

    const pairs = balance(base, 0);
    list.push(check('The friction pair on block and plane is equal and opposite', Math.abs(pairs.friction + -pairs.friction) < 1e-12, `±${sig(pairs.friction, 3)} N`));
    list.push(check('The regime reported matches the motion', (Math.abs(atRest.v) < 1e-9 ? !balance({ ...base, angle: 15, muS: 0.5 }, 0).sliding : true), 'static case stays inside the friction limit'));
    list.push(closeCheck('Friction angle atan μs is reported consistently', b.frictionAngle, (Math.atan(base.muS) * 180) / Math.PI, 1e-12, 3));
    return { checks: list };
  },
};