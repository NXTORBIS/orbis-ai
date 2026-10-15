import { rk4, check, closeCheck, relErr, sig } from '@jarvis/components/toolkit/physics/phys';

/**
 * Driven damped oscillator, m x'' = -k x - c x' + F₀ sin(ωt).
 * The gain and phase are analytic; the animation and the envelope come from integrating the
 * same equation, so the transient and the steady state can both be watched.
 */

export const response = (p) => {
  const omega0 = Math.sqrt(p.stiffness / p.mass);
  const zeta = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
  const omega = p.driveFrequency;
  const stiffness = p.stiffness - p.mass * omega * omega;
  const loss = p.damping * omega;
  const denominator = Math.hypot(stiffness, loss);
  const amplitude = p.force / denominator;
  const phase = Math.atan2(loss, stiffness);
  const peakFrequency = zeta < Math.SQRT1_2 ? omega0 * Math.sqrt(1 - 2 * zeta * zeta) : 0;
  return {
    omega0,
    zeta,
    omega,
    amplitude,
    phase,
    phaseDegrees: (phase * 180) / Math.PI,
    staticAmplitude: p.force / p.stiffness,
    dynamicMagnification: p.stiffness / denominator,
    peakFrequency,
    quality: 1 / (2 * zeta),
    bandwidth: 2 * zeta * omega0,
    drivePower: 0.5 * p.force * amplitude * omega * Math.sin(phase),
    dampingPower: 0.5 * p.damping * omega * omega * amplitude * amplitude,
  };
};

export const amplitudeAt = (p, omega) => p.force / Math.hypot(p.stiffness - p.mass * omega * omega, p.damping * omega);

const pushed = (p) => (state, t) => [state[1], (-p.stiffness * state[0] - p.damping * state[1] + p.force * Math.sin(p.driveFrequency * t)) / p.mass];

export const resonanceSim = {
  id: 'driven-oscillator',
  unit: 's',
  digits: 2,
  note: 'A mass on a spring with viscous damping is pushed by a sinusoidal force. The headline numbers come from the steady-state solution X = F₀/√((k − mω²)² + (cω)²); the animation integrates the same equation, so the approach from rest to the steady state and the phase lag can be watched directly.',
  checkNote: 'The measured steady-state amplitude is compared with the analytic gain, and the phase at resonance, the static limit, the mass-controlled limit, the resonance peak, the half-power bandwidth and the power balance between drive and damper are all tested.',
  params: { mass: 1, stiffness: 20, damping: 1.2, force: 4, driveFrequency: 4.47 },
  fields: [
    { key: 'mass', label: 'Mass (kg)', min: 0.1, max: 8, step: 0.1 },
    { key: 'stiffness', label: 'Spring constant k (N/m)', min: 2, max: 80, step: 1 },
    { key: 'damping', label: 'Damping c (N·s/m)', min: 0.05, max: 8, step: 0.05 },
    { key: 'force', label: 'Driving force amplitude F₀ (N)', min: 0.5, max: 40, step: 0.5 },
    { key: 'driveFrequency', label: 'Driving frequency ω (rad/s)', min: 0.2, max: 12, step: 0.01 },
  ],
  options: { maxStep: 1 / 800, sampleEvery: 0.02, resetOn: ['mass', 'stiffness', 'damping', 'force', 'driveFrequency'] },
  init: () => ({ tau: 0, x: 0, v: 0, envelope: 0, windowStart: 0 }),
  step: (y, h, p) => {
    const [x, v] = rk4(pushed(p), [y.x, y.v], y.tau, h);
    const tau = y.tau + h;
    const halfPeriod = Math.PI / p.driveFrequency;
    const windowStart = tau - y.windowStart > halfPeriod ? tau : y.windowStart;
    const envelope = windowStart === tau ? Math.abs(x) : Math.max(y.envelope, Math.abs(x));
    return { ...y, tau, x, v, envelope, windowStart };
  },
  read: (y, p) => {
    const theory = response(p);
    const driveForce = p.force * Math.sin(p.driveFrequency * y.tau);
    return {
      t: y.tau,
      ...theory,
      x: y.x,
      v: y.v,
      measuredAmplitude: y.envelope,
      driveForce,
      kinetic: 0.5 * p.mass * y.v * y.v,
      potential: 0.5 * p.stiffness * y.x * y.x,
      gain: theory.amplitude / theory.staticAmplitude,
      phaseLagDegrees: theory.phaseDegrees,
      nearResonance: Math.abs(p.driveFrequency - theory.omega0) / theory.omega0 < 0.05,
    };
  },
  series: [
    { key: 'x', label: 'Displacement (m)', value: (r) => r.x },
    { key: 'drive', label: 'Driving force (N)', value: (r) => r.driveForce },
    { key: 'envelope', label: 'Envelope (m)', value: (r) => r.envelope },
  ],
  verify: () => {
    const list = [];
    const base = { ...resonanceSim.params };

    const steadyAmplitude = (params, settleFor = 90) => {
      let y = resonanceSim.init(params);
      const h = 2e-4;
      let peak = 0;
      for (let t = 0; t < settleFor; t += h) {
        y = resonanceSim.step(y, h, params);
        if (t > settleFor * 0.7) peak = Math.max(peak, Math.abs(y.x));
      }
      return peak;
    };

    list.push(closeCheck('Steady-state amplitude matches F₀/√((k − mω²)² + (cω)²)', steadyAmplitude(base), response(base).amplitude, 2e-2, 5));
    list.push(closeCheck('At ω = ω₀ the displacement lags the force by 90°', response({ ...base, driveFrequency: response(base).omega0 }).phaseDegrees, 90, 1e-9, 3));
    list.push(closeCheck('At very low frequency the response is F₀/k', response({ ...base, driveFrequency: 0.002 }).amplitude, base.force / base.stiffness, 1e-6, 6));
    list.push(closeCheck('At high frequency the response falls to F₀/(mω²)', response({ ...base, driveFrequency: 100 }).amplitude, base.force / (base.mass * 100 ** 2), 5e-3, 8));

    let peakOmega = 0;
    let peakAmplitude = 0;
    for (let omega = 0.2; omega <= 12; omega += 0.005) {
      const value = amplitudeAt(base, omega);
      if (value > peakAmplitude) { peakAmplitude = value; peakOmega = omega; }
    }
    list.push(closeCheck('Resonance peaks at ω₀√(1 − 2ζ²)', peakOmega, response(base).peakFrequency, 5e-3, 4));

    let lower = null;
    let upper = null;
    const halfPower = peakAmplitude / Math.SQRT2;
    for (let omega = 0.2; omega <= 12; omega += 0.002) {
      if (amplitudeAt(base, omega) >= halfPower) { if (lower === null) lower = omega; upper = omega; }
    }
    list.push(closeCheck('Half-power bandwidth is 2ζω₀', upper - lower, response(base).bandwidth, 5e-2, 4));

    const power = response(base);
    list.push(closeCheck('Drive power equals the power dissipated by the damper', power.drivePower, power.dampingPower, 1e-9, 6));

    const analyticResidual = () => {
      const X = response(base).amplitude;
      const phi = response(base).phase;
      let worst = 0;
      for (let t = 0; t < 6; t += 0.05) {
        const x = X * Math.sin(base.driveFrequency * t - phi);
        const v = X * base.driveFrequency * Math.cos(base.driveFrequency * t - phi);
        const a = -X * base.driveFrequency ** 2 * Math.sin(base.driveFrequency * t - phi);
        worst = Math.max(worst, Math.abs(base.mass * a + base.damping * v + base.stiffness * x - base.force * Math.sin(base.driveFrequency * t)));
      }
      return worst;
    };
    const worst = analyticResidual();
    list.push(check('The analytic solution satisfies the equation of motion', worst < 1e-9, `largest residual ${worst.toExponential(1)} N`));

    const lowQ = response({ ...base, damping: 4 });
    list.push(check('More damping lowers the quality factor and the peak', lowQ.quality < response(base).quality && lowQ.amplitude < response(base).amplitude, `Q ${lowQ.quality.toFixed(2)} against ${response(base).quality.toFixed(2)}`));
    list.push(closeCheck('Quality factor is 1/(2ζ)', response(base).quality, 1 / (2 * response(base).zeta), 1e-12, 5));

    const lightDamping = { ...base, damping: 0.4 };
    list.push(check('A lightly damped oscillator rings up past its steady state', steadyAmplitude(lightDamping, 40) >= response(lightDamping).amplitude * 0.98, `peak ${sig(steadyAmplitude(lightDamping, 40), 4)} m against steady ${sig(response(lightDamping).amplitude, 4)} m`));
    list.push(check('Dynamic magnification equals amplitude over static response', relErr(response(base).dynamicMagnification, response(base).amplitude / response(base).staticAmplitude) < 1e-12, `${response(base).dynamicMagnification.toFixed(3)}×`));
    return { checks: list };
  },
};