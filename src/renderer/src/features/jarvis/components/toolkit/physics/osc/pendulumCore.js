import { rk4, check, closeCheck, derivative, TAU } from '@jarvis/components/toolkit/physics/phys';

/**
 * Nonlinear pendulum — a point bob on a light rod, or a uniform rod pivoted at one end.
 * The period is measured from the motion and compared with the small-angle result and the
 * amplitude series; nothing is linearised in the simulation itself.
 */

const MODE_OPTIONS = [
  { value: 'simple', label: 'Simple pendulum — point bob' },
  { value: 'physical', label: 'Physical pendulum — uniform rod on a pivot' },
];

export const pendulumTheory = (p) => {
  const rod = p.mode === 'physical';
  const inertia = rod ? (p.mass * p.length * p.length) / 3 : p.mass * p.length * p.length;
  const com = rod ? p.length / 2 : p.length;
  const omega0 = Math.sqrt((p.mass * p.gravity * com) / inertia);
  const amplitude = Math.abs((p.angle0 * Math.PI) / 180);
  return {
    inertia,
    com,
    omega0,
    smallPeriod: TAU / omega0,
    equivalentLength: inertia / (p.mass * com),
    amplitudeCorrection: 1 + amplitude ** 2 / 16 + (11 * amplitude ** 4) / 3072,
    dampingRate: p.damping / inertia,
  };
};

const swing = (p) => {
  const theory = pendulumTheory(p);
  return (state) => [state[1], -(theory.omega0 ** 2) * Math.sin(state[0]) - theory.dampingRate * state[1]];
};

export const pendulumSim = {
  id: 'pendulum-lab',
  unit: 's',
  digits: 2,
  note: 'The pendulum is integrated from θ̈ = −ω₀² sin θ, so the restoring torque is never linearised: the swing is exact for large amplitudes and the period grows with amplitude exactly as the elliptic integral predicts. Choose a point bob or a uniform rod, which changes the moment of inertia and the centre-of-mass distance.',
  checkNote: 'The measured period is compared with 2π√(I/mgd) and with the amplitude series, the energy is followed, the string tension at the lowest point is checked against mg(3 − 2cos θ₀), and the restoring torque is re-derived from the potential energy.',
  params: { mode: 'simple', length: 1.1, mass: 1.5, angle0: 30, damping: 0, gravity: 9.81 },
  fields: [
    { key: 'mode', label: 'Pendulum', options: MODE_OPTIONS },
    { key: 'length', label: 'Length (m)', min: 0.2, max: 4, step: 0.05 },
    { key: 'mass', label: 'Mass (kg)', min: 0.2, max: 20, step: 0.1 },
    { key: 'angle0', label: 'Release angle (°)', min: 1, max: 175, step: 1 },
    { key: 'damping', label: 'Pivot damping (N·m·s/rad)', min: 0, max: 1, step: 0.01 },
    { key: 'gravity', label: 'Gravitational acceleration (m/s²)', min: 1, max: 25, step: 0.01 },
  ],
  options: { maxStep: 1 / 900, sampleEvery: 0.02, resetOn: ['mode', 'length', 'mass', 'angle0', 'damping', 'gravity'] },
  init: (p) => {
    const theory = pendulumTheory(p);
    return {
      tau: 0,
      theta: (p.angle0 * Math.PI) / 180,
      omega: 0,
      lastCross: null,
      measuredPeriod: 0,
      lowestTension: 0,
      energy: p.mass * p.gravity * theory.com * (1 - Math.cos((p.angle0 * Math.PI) / 180)),
    };
  },
  step: (y, h, p) => {
    const [theta, omega] = rk4(swing(p), [y.theta, y.omega], y.tau, h);
    let measuredPeriod = y.measuredPeriod;
    let lastCross = y.lastCross;
    if (Math.sign(theta) !== Math.sign(y.theta) && Math.abs(y.theta) > 1e-9) {
      // consecutive crossings of the vertical are half a period apart
      if (lastCross !== null) measuredPeriod = 2 * (y.tau + h - lastCross);
      lastCross = y.tau + h;
    }
    const theory = pendulumTheory(p);
    const tension = p.mode === 'simple' ? p.mass * (p.gravity * Math.cos(theta) + p.length * omega * omega) : 0;
    return {
      ...y,
      tau: y.tau + h,
      theta,
      omega,
      measuredPeriod,
      lastCross,
      lowestTension: Math.max(y.lowestTension, tension),
      energy: 0.5 * theory.inertia * omega * omega + p.mass * p.gravity * theory.com * (1 - Math.cos(theta)),
    };
  },
  read: (y, p) => {
    const theory = pendulumTheory(p);
    const height = theory.com * (1 - Math.cos(y.theta));
    const potential = p.mass * p.gravity * height;
    const kinetic = 0.5 * theory.inertia * y.omega * y.omega;
    return {
      t: y.tau,
      ...theory,
      theta: y.theta,
      degrees: (y.theta * 180) / Math.PI,
      omega: y.omega,
      height,
      potential,
      kinetic,
      total: potential + kinetic,
      measuredPeriod: y.measuredPeriod,
      periodRatio: y.measuredPeriod ? y.measuredPeriod / theory.smallPeriod : 1,
      tension: p.mode === 'simple' ? p.mass * (p.gravity * Math.cos(y.theta) + p.length * y.omega * y.omega) : 0,
      lowestTension: y.lowestTension,
      restoreTorque: -p.mass * p.gravity * theory.com * Math.sin(y.theta),
      angularMomentum: theory.inertia * y.omega,
    };
  },
  series: [
    { key: 'theta', label: 'Angle (rad)', value: (r) => r.theta },
    { key: 'omega', label: 'Angular velocity (rad/s)', value: (r) => r.omega },
    { key: 'energy', label: 'Total energy (J)', value: (r) => r.total },
  ],
  verify: () => {
    const list = [];
    const run = (params, seconds, h = 2e-4) => {
      let y = pendulumSim.init(params);
      const samples = [];
      for (let t = 0; t < seconds; t += h) { y = pendulumSim.step(y, h, params); samples.push({ t: y.tau, energy: y.energy }); }
      return { y, samples };
    };
    const base = { ...pendulumSim.params, damping: 0 };

    const small = run({ ...base, angle0: 0.5 }, 6);
    list.push(closeCheck('Small swings give the period 2π√(L/g)', small.y.measuredPeriod, 2 * Math.PI * Math.sqrt(base.length / base.gravity), 2e-3, 5));

    const large = run({ ...base, angle0: 60 }, 8);
    const series = pendulumTheory({ ...base, angle0: 60 });
    list.push(closeCheck('At 60° the period matches the amplitude series', large.y.measuredPeriod, series.smallPeriod * series.amplitudeCorrection, 5e-3, 4));

    const wider = run({ ...base, angle0: 120 }, 12);
    list.push(check('The period grows with amplitude', wider.y.measuredPeriod > large.y.measuredPeriod && large.y.measuredPeriod > small.y.measuredPeriod, `${small.y.measuredPeriod.toFixed(3)} s · ${large.y.measuredPeriod.toFixed(3)} s · ${wider.y.measuredPeriod.toFixed(3)} s`));

    const drift = Math.max(...small.samples.map((s) => Math.abs(s.energy - small.samples[0].energy)));
    list.push(check('Undamped swings keep their energy', drift < 1e-8, `largest energy drift ${drift.toExponential(1)} J`));

    const bottom = run({ ...base, angle0: 45 }, 4);
    const theoryTension = base.mass * base.gravity * (3 - 2 * Math.cos((45 * Math.PI) / 180));
    list.push(closeCheck('String tension at the bottom is mg(3 − 2cos θ₀)', bottom.y.lowestTension, theoryTension, 3e-3, 3));

    const rod = run({ ...base, mode: 'physical', angle0: 1 }, 8);
    list.push(closeCheck('Physical rod gives 2π√(2L/3g)', rod.y.measuredPeriod, 2 * Math.PI * Math.sqrt((2 * base.length) / (3 * base.gravity)), 2e-3, 5));
    list.push(closeCheck('The rod swings like a simple pendulum of length 2L/3', pendulumTheory({ ...base, mode: 'physical' }).equivalentLength, (2 * base.length) / 3, 1e-12, 4));

    const theory = pendulumTheory({ ...base, angle0: 40 });
    const potentialOf = (theta) => base.mass * base.gravity * theory.com * (1 - Math.cos(theta));
    list.push(closeCheck('Restoring torque equals the negative gradient of the potential', -derivative(potentialOf, 0.4), -base.mass * base.gravity * theory.com * Math.sin(0.4), 1e-6, 6));

    let damped = pendulumSim.init({ ...base, damping: 0.2, angle0: 60 });
    let decreasing = true;
    let previous = damped.energy;
    for (let t = 0; t < 5; t += 2e-3) { damped = pendulumSim.step(damped, 2e-3, { ...base, damping: 0.2, angle0: 60 }); if (damped.energy > previous + 1e-9) decreasing = false; previous = damped.energy; }
    list.push(check('A damped pivot loses energy monotonically', decreasing, `${previous.toFixed(5)} J left after 5 s`));

    const rest = pendulumSim.read({ theta: 0, omega: 0, tau: 0, measuredPeriod: 0, lowestTension: 0, energy: 0, lastCross: null }, base);
    list.push(check('At rest at the bottom the restoring torque vanishes', Math.abs(rest.restoreTorque) < 1e-12, 'θ = 0 gives zero torque'));
    list.push(check('Angular momentum is I·ω', Math.abs(rest.angularMomentum) < 1e-12, `I = ${rest.inertia.toFixed(4)} kg·m²`));
    return { checks: list };
  },
};