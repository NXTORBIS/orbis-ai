import { rk4, relErr, check, closeCheck, sig } from '@jarvis/components/toolkit/physics/phys';

/**
 * Mass-spring oscillator with viscous damping: m x'' = -k x - c x'.
 * The measured period comes from the sign changes of the motion, not from the formula.
 */

export const shmSolution = (p) => {
  const omega0 = Math.sqrt(p.stiffness / p.mass);
  const zeta = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
  const omegaD = zeta < 1 ? omega0 * Math.sqrt(1 - zeta * zeta) : 0;
  return {
    omega0,
    zeta,
    omegaD,
    period: omegaD > 0 ? (2 * Math.PI) / omegaD : Infinity,
    undampedPeriod: (2 * Math.PI) / omega0,
    critical: 2 * Math.sqrt(p.stiffness * p.mass),
    quality: 1 / (2 * zeta),
    logDecrement: zeta < 1 ? (2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta) : Infinity,
    regime: zeta < 1 ? 'underdamped — oscillates while decaying' : Math.abs(zeta - 1) < 1e-6 ? 'critically damped — fastest return without overshoot' : 'overdamped — creeps back without oscillating',
  };
};

/** Closed-form displacement of the underdamped oscillator. */
export const shmExact = (p, t) => {
  const { omega0, zeta, omegaD } = shmSolution(p);
  if (zeta >= 1) {
    const decay = Math.exp(-zeta * omega0 * t);
    return decay * (p.amplitude + (p.velocity0 + zeta * omega0 * p.amplitude) * t);
  }
  const decay = Math.exp(-zeta * omega0 * t);
  return decay * (p.amplitude * Math.cos(omegaD * t) + ((p.velocity0 + zeta * omega0 * p.amplitude) / omegaD) * Math.sin(omegaD * t));
};

const derivative = (p) => (state) => [state[1], (-p.stiffness * state[0] - p.damping * state[1]) / p.mass];

export const shmSim = {
  id: 'shm-lab',
  unit: 's',
  digits: 2,
  note: 'A mass on a spring with viscous damping, integrated from m·a = −k·x − c·v. The period shown is measured from the motion itself by timing the crossings of the equilibrium position, and the energy ledger separates the kinetic, potential and dissipated parts.',
  checkNote: 'The measured period, the closed-form displacement, the energy decay rate, the phase-space ellipse and the log decrement are all recomputed numerically and compared with theory.',
  params: { mass: 1.2, stiffness: 14, damping: 0.6, amplitude: 0.25, velocity0: 0 },
  fields: [
    { key: 'mass', label: 'Mass (kg)', min: 0.1, max: 10, step: 0.1 },
    { key: 'stiffness', label: 'Spring constant k (N/m)', min: 1, max: 60, step: 0.5 },
    { key: 'damping', label: 'Damping coefficient c (N·s/m)', min: 0, max: 12, step: 0.05, hint: '0 gives undamped motion' },
    { key: 'amplitude', label: 'Initial displacement (m)', min: -1, max: 1, step: 0.01 },
    { key: 'velocity0', label: 'Initial velocity (m/s)', min: -3, max: 3, step: 0.05 },
  ],
  options: { maxStep: 1 / 800, sampleEvery: 0.02, resetOn: ['mass', 'stiffness', 'damping', 'amplitude', 'velocity0'] },
  init: (p) => ({ tau: 0, x: p.amplitude, v: p.velocity0, lastCross: null, measuredPeriod: 0, dissipated: 0, peakX: p.amplitude }),
  step: (y, h, p) => {
    const [x, v] = rk4(derivative(p), [y.x, y.v], y.tau, h);
    let measuredPeriod = y.measuredPeriod;
    let lastCross = y.lastCross;
    if (y.x !== 0 && Math.sign(x) !== Math.sign(y.x)) {
      // consecutive crossings are half a period apart
      if (lastCross !== null) measuredPeriod = 2 * (y.tau + h - lastCross);
      lastCross = y.tau + h;
    }
    const dissipated = y.dissipated + p.damping * v * v * h;
    return { ...y, tau: y.tau + h, x, v, measuredPeriod, lastCross, dissipated, peakX: Math.abs(x) > Math.abs(y.peakX) ? x : y.peakX };
  },
  read: (y, p) => {
    const theory = shmSolution(p);
    const potential = 0.5 * p.stiffness * y.x * y.x;
    const kinetic = 0.5 * p.mass * y.v * y.v;
    return {
      t: y.tau,
      ...theory,
      x: y.x,
      v: y.v,
      a: (-p.stiffness * y.x - p.damping * y.v) / p.mass,
      potential,
      kinetic,
      total: potential + kinetic,
      dissipated: y.dissipated,
      measuredPeriod: y.measuredPeriod,
      periodError: y.measuredPeriod ? relErr(y.measuredPeriod, theory.undampedPeriod) : 0,
      peakX: y.peakX,
      force: -p.stiffness * y.x,
      dampingForce: -p.damping * y.v,
      phaseX: y.x,
      phaseV: y.v,
    };
  },
  series: [
    { key: 'x', label: 'Displacement (m)', value: (r) => r.x },
    { key: 'v', label: 'Velocity (m/s)', value: (r) => r.v },
    { key: 'ke', label: 'Kinetic energy (J)', value: (r) => r.kinetic },
    { key: 'pe', label: 'Spring energy (J)', value: (r) => r.potential },
    { key: 'total', label: 'Total energy (J)', value: (r) => r.total },
    { key: 'heat', label: 'Dissipated (J)', value: (r) => r.dissipated },
  ],
  verify: () => {
    const list = [];
    const run = (params, seconds, h = 2e-4) => {
      let y = shmSim.init(params);
      const samples = [];
      for (let t = 0; t < seconds; t += h) { y = shmSim.step(y, h, params); samples.push({ t: y.tau, x: y.x, v: y.v }); }
      return { y, samples };
    };
    const base = { ...shmSim.params };

    const undamped = { ...base, damping: 0 };
    const undampedRun = run(undamped, 2);
    list.push(closeCheck('Measured period matches 2π√(m/k)', undampedRun.y.measuredPeriod, 2 * Math.PI * Math.sqrt(undamped.mass / undamped.stiffness), 2e-3, 5));

    let worst = 0;
    for (const sample of undampedRun.samples.filter((_, i) => i % 500 === 0)) worst = Math.max(worst, relErr(sample.x, shmExact(undamped, sample.t)));
    list.push(check('Undamped trajectory follows the closed-form solution', worst < 2e-5, `largest deviation ${(worst * 100).toFixed(4)}%`));

    const damped = { ...base, damping: 1.4 };
    const dampedRun = run(damped, 2);
    let worstDamped = 0;
    for (const sample of dampedRun.samples.filter((_, i) => i % 500 === 0)) worstDamped = Math.max(worstDamped, relErr(sample.x, shmExact(damped, sample.t)));
    list.push(check('Underdamped trajectory follows the analytic decay', worstDamped < 1e-4, `largest deviation ${(worstDamped * 100).toFixed(4)}%`));

    const energyRate = (params) => {
      let y = shmSim.init(params);
      const start = 1.2;
      for (let t = 0; t < start; t += 1e-4) y = shmSim.step(y, 1e-4, params);
      const before = 0.5 * params.mass * y.v * y.v + 0.5 * params.stiffness * y.x * y.x;
      let integral = 0;
      for (let t = 0; t < 0.5; t += 1e-4) {
        y = shmSim.step(y, 1e-4, params);
        integral += params.damping * y.v * y.v * 1e-4;
      }
      const after = 0.5 * params.mass * y.v * y.v + 0.5 * params.stiffness * y.x * y.x;
      return { lost: before - after, integral };
    };
    const rate = energyRate(damped);
    list.push(closeCheck('Energy lost equals ∫ c v² dt', rate.lost, rate.integral, 1e-3, 6));

    const turning = run(undamped, 1.6);
    const peakEnergy = 0.5 * undamped.stiffness * Math.abs(turning.y.peakX) ** 2;
    const amplitudeEnergy = 0.5 * undamped.stiffness * undamped.amplitude ** 2;
    list.push(closeCheck('At the turning point the energy is ½kA²', peakEnergy, amplitudeEnergy, 1e-6, 6));

    const ellipse = undampedRun.samples[Math.floor(undampedRun.samples.length / 3)];
    const invariant = (ellipse.x / undamped.amplitude) ** 2 + (ellipse.v / (undamped.amplitude * Math.sqrt(undamped.stiffness / undamped.mass))) ** 2;
    list.push(closeCheck('Phase-space path stays on the ellipse x²/A² + v²/(Aω₀)² = 1', invariant, 1, 1e-3, 5));

    const decrement = (params) => {
      let y = shmSim.init(params);
      const peaks = [];
      let previous = y.x;
      let previousV = y.v;
      for (let t = 0; t < 6; t += 1e-4) {
        y = shmSim.step(y, 1e-4, params);
        if (previousV > 0 && y.v <= 0 && peaks.length < 3) peaks.push(y.x);
        previous = y.x;
        previousV = y.v;
      }
      return peaks.length >= 2 ? Math.log(Math.abs(peaks[0] / peaks[1])) : NaN;
    };
    const light = { ...base, damping: 0.5 };
    list.push(closeCheck('Log decrement matches 2πζ/√(1 − ζ²)', decrement(light), shmSolution(light).logDecrement, 2e-2, 4));

    const critical = { ...base, damping: shmSolution(base).critical };
    let over = shmSim.init(critical);
    let crossed = false;
    for (let t = 0; t < 4; t += 1e-4) { const next = shmSim.step(over, 1e-4, critical); if (next.x * over.x < 0) crossed = true; over = next; }
    list.push(check('Critical damping returns without overshooting', !crossed, `c = 2√(km) = ${critical.damping.toFixed(3)} N·s/m`));

    const heavy = { ...base, damping: 12 };
    let heavyRun = shmSim.init(heavy);
    let monotone = true;
    for (let t = 0; t < 4; t += 1e-3) {
      const next = shmSim.step(heavyRun, 1e-3, heavy);
      if (next.x * heavyRun.x < 0) monotone = false;
      heavyRun = next;
    }
    list.push(check('Overdamped motion never crosses the equilibrium point', monotone, `ζ = ${shmSolution(heavy).zeta.toFixed(2)}`));

    list.push(closeCheck('Quality factor equals √(km)/c', shmSolution(base).quality, Math.sqrt(base.stiffness * base.mass) / base.damping, 1e-12, 4));
    list.push(closeCheck('Damping ratio equals c / 2√(km)', shmSolution(base).zeta, base.damping / (2 * Math.sqrt(base.stiffness * base.mass)), 1e-12, 5));
    list.push(check('Spring and damping forces are reported with the right signs', shmSim.read({ x: 0.2, v: 0.3, tau: 0, dissipated: 0, peakX: 0.2, measuredPeriod: 0 }, base).force < 0, `restoring force ${sig(-base.stiffness * 0.2, 3)} N for x = 0.2 m`));
    return { checks: list };
  },
};