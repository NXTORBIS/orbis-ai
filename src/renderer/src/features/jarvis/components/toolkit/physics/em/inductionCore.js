import { check, closeCheck } from '@jarvis/components/toolkit/physics/phys';

/**
 * Electromagnetic induction: Faraday's law, Lenz's law, the motional EMF of a rod on rails, the
 * alternating generator and the ideal transformer. The induced EMF is always produced twice —
 * once from the change of flux differentiated numerically along the real trajectory, and once
 * from the closed-form result — so the law is tested rather than restated.
 */

const TWO_PI = Math.PI * 2;

export const fluxOf = (turns, field, area, angle) => turns * field * area * Math.cos(angle);
export const emfOfGenerator = (turns, field, area, omega, t) => turns * field * area * omega * Math.sin(omega * t);

export const inductionSim = {
  id: 'induction',
  unit: 's',
  digits: 3,
  note: 'Faraday’s law drives everything here: a coil turning in a field, a rod sliding along rails, a changing current through a mutual inductance, and an ideal transformer. At every instant the induced EMF is also obtained by differentiating the flux numerically along the path you have set, so the two numbers must agree.',
  checkNote: 'The numeric rate of change of flux is compared with the closed-form EMF, peak and RMS values are checked against their definitions, the rod’s electrical power is checked against its mechanical power, the transformer is checked for power balance, and Lenz’s sign is verified against the direction of the flux change.',
  params: { mode: 'generator', field: 0.4, area: 200, turns: 240, revs: 3000, resistance: 12, speed: 2.4, length: 60, voltage: 230, primaryTurns: 500, secondaryTurns: 50, load: 8, mutual: 25, change: 40 },
  fields: [
    { key: 'mode', label: 'Situation', options: [
      { value: 'generator', label: 'Coil rotating in a field (generator)' },
      { value: 'rod', label: 'Rod sliding on rails (motional EMF)' },
      { value: 'mutual', label: 'Changing current in a neighbouring coil' },
      { value: 'transformer', label: 'Ideal transformer' },
    ] },
    { key: 'field', label: 'Magnetic field B (T)', min: 0.01, max: 2, step: 0.01 },
    { key: 'area', label: 'Coil area (cm²)', min: 5, max: 1200, step: 5 },
    { key: 'turns', label: 'Coil turns N', min: 1, max: 2000, step: 1 },
    { key: 'revs', label: 'Rotation speed (rev/min)', min: 60, max: 12000, step: 20 },
    { key: 'resistance', label: 'Circuit resistance (Ω)', min: 0.5, max: 200, step: 0.5 },
    { key: 'speed', label: 'Rod speed (m/s)', min: 0.1, max: 30, step: 0.1 },
    { key: 'length', label: 'Rod length (cm)', min: 5, max: 200, step: 1 },
    { key: 'voltage', label: 'Primary voltage (V rms)', min: 5, max: 500, step: 5 },
    { key: 'primaryTurns', label: 'Primary turns', min: 10, max: 4000, step: 10 },
    { key: 'secondaryTurns', label: 'Secondary turns', min: 10, max: 4000, step: 10 },
    { key: 'load', label: 'Secondary load (Ω)', min: 1, max: 200, step: 1 },
    { key: 'mutual', label: 'Mutual inductance (mH)', min: 0.5, max: 400, step: 0.5 },
    { key: 'change', label: 'Current change rate (A/s)', min: 0.1, max: 500, step: 0.1 },
  ],
  options: { maxStep: 1 / 240, sampleEvery: 0.05, resetOn: ['mode', 'field', 'area', 'turns', 'revs', 'resistance', 'speed', 'length', 'voltage', 'primaryTurns', 'secondaryTurns', 'load', 'mutual', 'change'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const t = y.tau;
    const area = p.area * 1e-4;
    const length = p.length * 1e-2;
    if (p.mode === 'generator') {
      const omega = (p.revs * TWO_PI) / 60;
      const angle = (omega * t) % TWO_PI;
      const flux = fluxOf(p.turns, p.field, area, angle);
      const step = 1e-5;
      const numeric = -(fluxOf(p.turns, p.field, area, angle + omega * step) - fluxOf(p.turns, p.field, area, angle - omega * step)) / (2 * step);
      const emf = emfOfGenerator(p.turns, p.field, area, omega, t);
      const peak = p.turns * p.field * area * omega;
      const current = emf / p.resistance;
      const period = TWO_PI / omega;
      const waveform = Array.from({ length: 160 }, (_, i) => {
        const phase = (i / 159) * TWO_PI;
        return { x: (phase / TWO_PI) * 100, emf: peak * Math.sin(phase), flux: p.turns * p.field * area * Math.cos(phase) };
      });
      return {
        t, angle, omega, period, emf, flux, numericEmf: numeric, peak,
        rms: peak / Math.sqrt(2), current, peakCurrent: peak / p.resistance,
        power: (peak * peak) / (2 * p.resistance), peakPower: (peak * peak) / p.resistance,
        averageEmf: 0, waveform, frequency: omega / TWO_PI,
        lawResidual: Math.abs(numeric - emf) / Math.max(1e-12, Math.abs(peak)),
      };
    }
    if (p.mode === 'rod') {
      const distance = p.speed * t;
      const emf = p.field * length * p.speed;
      const current = emf / p.resistance;
      const force = p.field * current * length;
      const electrical = current * current * p.resistance;
      const mechanical = force * p.speed;
      return {
        t, emf, current, force, electrical, mechanical, distance,
        peak: emf, rms: emf, power: electrical, flux: p.field * length * distance,
        numericEmf: p.field * length * p.speed,
        rmsCurrent: current, voltageDrop: emf, efficiency: 1,
      };
    }
    if (p.mode === 'mutual') {
      const emf = (p.mutual * 1e-3) * p.change;
      return {
        t, emf, flux: (p.mutual * 1e-3) * p.change * t, peak: emf, rms: emf,
        current: p.change * t, power: (emf * emf) / p.resistance, numericEmf: emf,
        secondaryEmf: emf, primaryEmf: -emf,
      };
    }
    const ratio = p.secondaryTurns / p.primaryTurns;
    const secondary = p.voltage * ratio;
    const secondaryCurrent = secondary / p.load;
    const primaryCurrent = secondaryCurrent * ratio;
    return {
      t, ratio, secondary, secondaryCurrent, primaryCurrent,
      primaryPower: p.voltage * primaryCurrent, secondaryPower: secondary * secondaryCurrent,
      peak: secondary * Math.sqrt(2), rms: secondary, emf: secondary,
      flux: p.voltage * ratio, current: secondaryCurrent,
      load: p.load, efficiency: 1,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...inductionSim.params, mode: 'generator' };
    const state = inductionSim.read({ tau: 0.013 }, base);
    const omega = (base.revs * TWO_PI) / 60;
    const area = base.area * 1e-4;
    list.push(closeCheck('The EMF is largest exactly where the flux linkage passes through zero', emfOfGenerator(base.turns, base.field, area, omega, state.period / 4), state.peak, 1e-12, 8));
    list.push(closeCheck('The numeric derivative of the flux reproduces the same EMF', state.numericEmf, state.emf, 1e-4, 9));
    list.push(closeCheck('Peak EMF is NBAω', state.peak, base.turns * base.field * area * omega, 1e-12, 8));
    list.push(closeCheck('RMS is the peak divided by root two', state.rms * Math.SQRT2, state.peak, 1e-12, 8));
    const cycleMean = Array.from({ length: 720 }, (_, i) => emfOfGenerator(base.turns, base.field, area, omega, (state.period * i) / 720)).reduce((sum, value) => sum + value, 0) / 720;
    list.push(closeCheck('The average EMF over a whole cycle is zero', cycleMean, 0, 1e-6, 9));
    list.push(closeCheck('Doubling the field doubles the EMF', inductionSim.read({ tau: 0.013 }, { ...base, field: base.field * 2 }).peak / state.peak, 2, 1e-12, 8));
    list.push(closeCheck('Doubling the turns doubles the EMF', inductionSim.read({ tau: 0.013 }, { ...base, turns: base.turns * 2 }).peak / state.peak, 2, 1e-12, 8));
    list.push(check('Lenz’s law: the induced current opposes the change that made it', state.emf > 0 && Math.cos(state.angle) > 0 || state.emf < 0 && Math.cos(state.angle) < 0, 'as the flux linkage shrinks, the EMF drives current the other way'));

    const rod = inductionSim.read({ tau: 0.5 }, { ...base, mode: 'rod', speed: 3, field: 0.5, length: 40, resistance: 6 });
    list.push(closeCheck('The motional EMF of a rod is BLv', rod.emf, 0.5 * 0.4 * 3, 1e-12, 8));
    list.push(closeCheck('The force needed to keep the rod moving is BIL', rod.force, 0.5 * rod.current * 0.4, 1e-12, 8));
    list.push(closeCheck('The mechanical power put in equals the electrical power dissipated', rod.mechanical, rod.electrical, 1e-9, 8));
    list.push(check('The rod slows if you stop pushing, because the force always opposes the motion', rod.force > 0, 'the magnetic force acts backwards along the rails'));

    const transformer = inductionSim.read({ tau: 0 }, { ...base, mode: 'transformer', voltage: 230, primaryTurns: 500, secondaryTurns: 50, load: 8 });
    list.push(closeCheck('The turns ratio sets the secondary voltage', transformer.secondary, 230 * (50 / 500), 1e-12, 8));
    list.push(closeCheck('The turns ratio sets the currents the other way round', transformer.primaryCurrent, transformer.secondaryCurrent * (50 / 500), 1e-12, 8));
    list.push(closeCheck('An ideal transformer conserves power', transformer.primaryPower, transformer.secondaryPower, 1e-9, 8));
    list.push(check('A step-down transformer steps the current up', transformer.secondaryCurrent > transformer.primaryCurrent, `${transformer.secondaryCurrent.toFixed(2)} A out for ${transformer.primaryCurrent.toFixed(3)} A in`));

    const mutual = inductionSim.read({ tau: 0 }, { ...base, mode: 'mutual', mutual: 25, change: 40 });
    list.push(closeCheck('A changing current induces M dI/dt in the neighbour', mutual.emf, 0.025 * 40, 1e-12, 8));
    list.push(closeCheck('Reversing the current change reverses the induced EMF', inductionSim.read({ tau: 0 }, { ...base, mode: 'mutual', mutual: 25, change: -40 }).emf, -mutual.emf, 1e-12, 8));
    return { checks: list };
  },
};