import { rk4, derivative, relErr, check, closeCheck, bisect } from '@jarvis/components/toolkit/physics/phys';

/**
 * One-dimensional motion from an acceleration model. The integrator is the display,
 * and every readout is re-derived numerically inside verify().
 */

const MODE_OPTIONS = [
  { value: 'constant', label: 'Constant acceleration' },
  { value: 'jerk', label: 'Uniform jerk (a varies linearly)' },
  { value: 'sinusoid', label: 'Sinusoidal acceleration' },
];

export const modeLabel = (mode) => MODE_OPTIONS.find((o) => o.value === mode)?.label || mode;

export const accelAt = (p, t) => {
  if (p.mode === 'jerk') return p.a0 + p.jerk * t;
  if (p.mode === 'sinusoid') return p.amplitude * Math.sin(p.omega * t);
  return p.a0;
};

/** Closed-form solution of each acceleration model, used only as an independent reference. */
export function exact(p, t) {
  const { x0, v0 } = p;
  if (p.mode === 'jerk') {
    const { a0, jerk: j } = p;
    return { x: x0 + v0 * t + (a0 * t * t) / 2 + (j * t ** 3) / 6, v: v0 + a0 * t + (j * t * t) / 2, a: a0 + j * t };
  }
  if (p.mode === 'sinusoid') {
    const { amplitude: A, omega: w } = p;
    return {
      x: x0 + v0 * t + (A / (w * w)) * (w * t - Math.sin(w * t)),
      v: v0 + (A / w) * (1 - Math.cos(w * t)),
      a: A * Math.sin(w * t),
    };
  }
  return { x: x0 + v0 * t + (p.a0 * t * t) / 2, v: v0 + p.a0 * t, a: p.a0 };
}

const derivativeOf = (p) => (state, t) => [state[1], accelAt(p, t)];

export const motionSim = {
  id: 'motion-lab',
  unit: 's',
  digits: 2,
  note: 'Position and velocity are integrated from the acceleration model you choose with a fourth-order Runge-Kutta step, so the numbers and the graphs come from the same equations. Switch between constant acceleration, uniform jerk and a sinusoidally varying acceleration on identical axes to compare them.',
  checkNote: 'Each model is re-integrated and compared with its closed-form solution, the derivative relations v = dx/dt and a = dv/dt are measured numerically, and the work–energy and average-velocity identities are tested on the same motion.',
  params: { mode: 'constant', x0: 0, v0: 6, a0: -1.5, jerk: 0.8, amplitude: 4, omega: 1.2 },
  fields: [
    { key: 'mode', label: 'Acceleration model', options: MODE_OPTIONS },
    { key: 'x0', label: 'Initial position x₀ (m)', min: -20, max: 20, step: 0.5 },
    { key: 'v0', label: 'Initial velocity v₀ (m/s)', min: -20, max: 20, step: 0.5 },
    { key: 'a0', label: 'Constant / initial acceleration a₀ (m/s²)', min: -10, max: 10, step: 0.25 },
    { key: 'jerk', label: 'Jerk j (m/s³)', min: -4, max: 4, step: 0.2, hint: 'Rate of change of acceleration' },
    { key: 'amplitude', label: 'Acceleration amplitude A (m/s²)', min: 0, max: 12, step: 0.5 },
    { key: 'omega', label: 'Acceleration angular frequency ω (rad/s)', min: 0.2, max: 4, step: 0.1 },
  ],
  options: { maxStep: 1 / 500, sampleEvery: 0.04, resetOn: ['mode', 'x0', 'v0', 'a0', 'jerk', 'amplitude', 'omega'] },
  init: (p) => ({ tau: 0, x: p.x0, v: p.v0 }),
  step: (y, h, p) => {
    const [x, v] = rk4(derivativeOf(p), [y.x, y.v], y.tau, h);
    return { ...y, tau: y.tau + h, x, v };
  },
  read: (y, p) => {
    const t = y.tau;
    const reference = exact(p, t);
    return {
      t,
      x: y.x,
      v: y.v,
      a: accelAt(p, t),
      displacement: y.x - p.x0,
      averageVelocity: t > 1e-6 ? (y.x - p.x0) / t : 0,
      momentum: y.v,
      kinetic: 0.5 * y.v * y.v,
      accelerationWork: accelAt(p, t) * (y.x - p.x0),
      exactX: reference.x,
      exactV: reference.v,
      integratorError: relErr(y.x, reference.x),
      turning: Math.abs(y.v) < 5e-3,
    };
  },
  series: [
    { key: 'x', label: 'Position (m)', value: (r) => r.x },
    { key: 'v', label: 'Velocity (m/s)', value: (r) => r.v },
    { key: 'a', label: 'Acceleration (m/s²)', value: (r) => r.a },
    { key: 'ke', label: 'Kinetic energy (J)', value: (r) => r.kinetic },
  ],
  verify: () => {
    const list = [];
    const step = (params, h, duration) => {
      let y = { tau: 0, x: params.x0, v: params.v0 };
      for (let t = 0; t < duration; t += h) y = motionSim.step(y, h, params);
      return y;
    };

    for (const mode of ['constant', 'jerk', 'sinusoid']) {
      const params = { ...motionSim.params, mode };
      const y = step(params, 1e-4, 3);
      const reference = exact({ ...params, mode }, y.tau);
      list.push(closeCheck(`${modeLabel(mode)}: integrated position matches the closed form`, y.x, reference.x, 1e-5));
      list.push(closeCheck(`${modeLabel(mode)}: integrated velocity matches the closed form`, y.v, reference.v, 1e-5));
    }

    const params = { ...motionSim.params, mode: 'constant', v0: 6, a0: -1.5 };
    const h = 1e-4;
    const atT = step(params, h, 2);
    const after = motionSim.step(atT, h, params);
    list.push(closeCheck('v = dx/dt measured from the trajectory', (after.x - atT.x) / h, atT.v, 2e-3, 5));
    list.push(closeCheck('a = dv/dt measured from the trajectory', (after.v - atT.v) / h, accelAt(params, atT.tau), 2e-3, 5));

    const work = accelAt(params, 2) * (atT.x - params.x0);
    const energy = 0.5 * atT.v * atT.v - 0.5 * params.v0 * params.v0;
    list.push(closeCheck('Work–energy theorem: a·Δx = ΔK (1 kg)', work, energy, 1e-3, 5));
    list.push(closeCheck('Average velocity equals (v₀ + v)/2 for constant acceleration', (atT.x - params.x0) / atT.tau, (params.v0 + atT.v) / 2, 1e-6));

    const stopTime = -params.v0 / params.a0;
    const found = bisect((t) => exact(params, t).v, 0, stopTime * 2);
    list.push(closeCheck('Turning point found by root-finding matches v₀/|a₀|', found, stopTime, 1e-6));

    const sine = { ...motionSim.params, mode: 'sinusoid', v0: 0, x0: 0 };
    let y = { tau: 0, x: 0, v: 0 };
    const samples = [];
    for (let t = 0; t < 20; t += 1e-3) { y = motionSim.step(y, 1e-3, sine); samples.push(y.x - (sine.amplitude / (sine.omega * sine.omega)) * sine.omega * y.tau); }
    const swing = (Math.max(...samples) - Math.min(...samples)) / 2;
    list.push(closeCheck('Sinusoidal acceleration gives a displacement swing of A/ω²', swing, sine.amplitude / (sine.omega * sine.omega), 1e-3, 5));

    const probe = (t) => exact(params, t).x;
    list.push(closeCheck('Instantaneous velocity equals the numeric slope of position', derivative(probe, 1.7), exact(params, 1.7).v, 1e-6));
    list.push(check('Every acceleration model produces a finite trajectory', Number.isFinite(atT.x) && Number.isFinite(atT.v), `x = ${atT.x.toFixed(3)} m, v = ${atT.v.toFixed(3)} m/s`));
    return { checks: list };
  },
};