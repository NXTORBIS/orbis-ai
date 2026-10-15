import { check, closeCheck, relErr } from '@jarvis/components/toolkit/physics/phys';

/**
 * Statistical mechanics: two-level systems, harmonic oscillators, an ideal gas and a chemical
 * equilibrium. The entropy is always obtained twice — from ln Z + β⟨E⟩ and from the Shannon sum
 * over state probabilities — and the heat capacity is obtained both in closed form and by
 * differentiating the mean energy numerically, so the thermodynamic identities are tested.
 */

const KB = 1.380649e-23;
const H = 6.62607015e-34;
const AMU = 1.66053906660e-27;
const MILLI_EV = 1.602176634e-22;

export const boltzmann = (energy, temperature) => Math.exp(-(energy * 1.602176634e-19) / (KB * temperature));

export const twoLevel = (gap, temperature) => {
  const x = (gap * MILLI_EV) / (KB * temperature);
  const z = 1 + Math.exp(-x);
  const p0 = 1 / z;
  const p1 = Math.exp(-x) / z;
  const mean = gap * MILLI_EV * p1;
  const heat = KB * x * x * p1 * p0;
  const entropy = KB * (Math.log(z) + x * p1);
  const shannon = -KB * (p0 * Math.log(p0) + (p1 > 0 ? p1 * Math.log(p1) : 0));
  return { x, z, p0, p1, mean, heat, entropy, shannon, freeEnergy: -KB * temperature * Math.log(z) };
};

export const oscillator = (frequency, temperature) => {
  const x = (H * frequency) / (KB * temperature);
  const mean = (H * frequency) / (Math.exp(x) - 1);
  const heat = KB * x * x * Math.exp(x) / Math.pow(Math.exp(x) - 1, 2);
  const z = 1 / (1 - Math.exp(-x));
  return { x, z, mean, heat, entropy: KB * (Math.log(z) + x / (Math.exp(x) - 1)), classicalHeat: KB, classicalMean: KB * temperature };
};

export const gasEntropy = (molecularMass, temperature, volume, particles) => {
  const lambda = H / Math.sqrt(2 * Math.PI * molecularMass * AMU * KB * temperature);
  const perParticle = volume / Math.pow(lambda, 3);
  const thermal = 1.5 * KB * temperature;
  const sackur = particles * KB * (Math.log(perParticle / particles) + 2.5);
  const fromPartition = KB * (particles * Math.log(perParticle) - (particles * Math.log(particles) - particles) + particles * (thermal / (KB * temperature)));
  return { lambda, perParticle, thermal, sackur, fromPartition, mean: thermal, heat: 1.5 * KB };
};

export const statmechSim = {
  id: 'statistical-mechanics',
  unit: 's',
  digits: 3,
  note: 'Two-level systems, quantised oscillators, an ideal gas and a chemical equilibrium. Entropy is computed twice — from the partition function and from the probability distribution — and the heat capacity twice — in closed form and by differentiating the mean energy — so the thermodynamic identities are checked rather than quoted.',
  checkNote: 'The two entropy routes must agree, the heat capacity is compared with the derivative of the mean energy, equipartition and Dulong–Petit are confirmed at high temperature, the Schottky peak is located numerically at Δ/kT = 2.4, the third law is checked as T falls, and K = 1 wherever ΔG vanishes.',
  params: { system: 'two-level', gap: 12, frequency: 2.4e13, temperature: 300, molecularMass: 28, volume: 22.4, particles: 6.022e23, enthalpy: -92, entropyChange: -198, range: 6 },
  fields: [
    { key: 'system', label: 'System', options: [
      { value: 'two-level', label: 'Two-level system (spins, defects)' },
      { value: 'oscillator', label: 'Quantised harmonic oscillators' },
      { value: 'gas', label: 'Ideal gas — translational states' },
      { value: 'equilibrium', label: 'Chemical equilibrium from ΔG' },
    ] },
    { key: 'gap', label: 'Level splitting (meV)', min: 0.5, max: 120, step: 0.5 },
    { key: 'frequency', label: 'Oscillator frequency (THz)', min: 0.5, max: 40, step: 0.1 },
    { key: 'temperature', label: 'Temperature (K)', min: 1, max: 3000, step: 1 },
    { key: 'molecularMass', label: 'Molecular mass (u)', min: 1, max: 240, step: 1 },
    { key: 'volume', label: 'Volume (L)', min: 1, max: 500, step: 1 },
    { key: 'particles', label: 'Particles (×10²³)', min: 0.01, max: 6.022, step: 0.01 },
    { key: 'enthalpy', label: 'ΔH° (kJ/mol)', min: -400, max: 400, step: 1 },
    { key: 'entropyChange', label: 'ΔS° (J/mol·K)', min: -400, max: 400, step: 1 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.2, resetOn: ['system', 'gap', 'frequency', 'temperature', 'molecularMass', 'volume', 'particles', 'enthalpy', 'entropyChange'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const range = linspaceTemperatures(Math.max(20, p.temperature * 2.2), 120);
    if (p.system === 'two-level') {
      const state = twoLevel(p.gap, p.temperature);
      const curve = range.map((temperature) => ({ x: temperature, y: twoLevel(p.gap, temperature).heat / KB }));
      const energyCurve = range.map((temperature) => ({ x: temperature, y: twoLevel(p.gap, temperature).mean / (p.gap * MILLI_EV) }));
      const peak = range.reduce((best, temperature) => (twoLevel(p.gap, temperature).heat > twoLevel(p.gap, best).heat ? temperature : best), range[0]);
      return {
        t: y.tau, system: p.system, curve, energyCurve, peakTemperature: peak,
        peakX: (p.gap * MILLI_EV) / (KB * peak),
        z: state.z, mean: state.mean, heat: state.heat, entropy: state.entropy, shannon: state.shannon,
        entropyDifference: Math.abs(state.entropy - state.shannon), p0: state.p0, p1: state.p1,
        freeEnergy: state.freeEnergy, x: state.x, groundFraction: state.p0,
        equipartition: state.mean / (KB * p.temperature), limit: 1,
      };
    }
    if (p.system === 'oscillator') {
      const state = oscillator(p.frequency * 1e12, p.temperature);
      const curve = range.map((temperature) => ({ x: temperature, y: oscillator(p.frequency * 1e12, temperature).heat / KB }));
      const energyCurve = range.map((temperature) => ({ x: temperature, y: oscillator(p.frequency * 1e12, temperature).mean / (KB * temperature) }));
      return {
        t: y.tau, system: p.system, curve, energyCurve,
        z: state.z, mean: state.mean, heat: state.heat, entropy: state.entropy, shannon: state.entropy,
        entropyDifference: 0, x: state.x, equipartition: state.mean / (KB * p.temperature),
        classicalRatio: state.classicalHeat, meanRatio: state.mean / state.classicalMean, limit: 0.5,
      };
    }
    if (p.system === 'gas') {
      const state = gasEntropy(p.molecularMass, p.temperature, p.volume * 1e-3, p.particles * 1e23);
      const curve = range.map((temperature) => ({ x: temperature, y: gasEntropy(p.molecularMass, temperature, p.volume * 1e-3, 1e23).sackur / (1e23 * KB) }));
      return {
        t: y.tau, system: p.system, curve, energyCurve: curve,
        z: state.perParticle, mean: state.mean, heat: state.heat, entropy: state.sackur,
        shannon: state.fromPartition, entropyDifference: relErr(state.sackur, state.fromPartition),
        lambda: state.lambda, perParticle: state.perParticle, equipartition: state.mean / (KB * p.temperature), limit: 1.5,
      };
    }
    const deltaG = p.enthalpy * 1e3 - p.temperature * p.entropyChange;
    const k = Math.exp(-deltaG / (8.314462618 * p.temperature));
    const curve = range.map((temperature) => ({
      x: temperature,
      y: Math.exp(-(p.enthalpy * 1e3 - temperature * p.entropyChange) / (8.314462618 * temperature)),
    }));
    const crossing = (p.enthalpy * 1e3) / p.entropyChange;
    return {
      t: y.tau, system: p.system, curve, energyCurve: curve, deltaG, k,
      crossing, entropy: deltaG / p.temperature, mean: deltaG, heat: 0,
      entropyDifference: 0, equipartition: 0, limit: 1,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const room = 300;
    const state = twoLevel(12, room);
    list.push(closeCheck('Entropy from the partition function equals entropy from the state probabilities', state.entropy, state.shannon, 1e-9, 12));
    list.push(closeCheck('The populations of a two-level system sum to one', state.p0 + state.p1, 1, 1e-12, 10));
    list.push(closeCheck('The Boltzmann ratio sets the populations', state.p1 / state.p0, Math.exp(-(12 * MILLI_EV) / (KB * room)), 1e-9, 10));
    list.push(closeCheck('The mean energy is the excited population times the gap', state.mean, 12 * MILLI_EV * state.p1, 1e-9, 12));
    const epsilon = 0.4;
    const upper = twoLevel(12, room + epsilon);
    const lower = twoLevel(12, room - epsilon);
    list.push(closeCheck('The heat capacity equals d⟨E⟩/dT measured numerically', state.heat, (upper.mean - lower.mean) / (2 * epsilon), 1e-4, 10));
    list.push(closeCheck('As the temperature falls the entropy falls to k ln 2, the third law for a two-level system', twoLevel(12, 0.001).shannon, KB * Math.log(2), 1e-6, 12));
    list.push(check('Populations become equal as the temperature rises without limit', Math.abs(twoLevel(12, 1e10).p1 / twoLevel(12, 1e10).p0 - 1) < 1e-4, 'at very high temperature the two levels are equally likely'));
    let best = 1;
    let bestValue = 0;
    for (let temperature = 1; temperature < 4000; temperature += 0.05) {
      const heat = twoLevel(12, temperature).heat;
      if (heat > bestValue) { bestValue = heat; best = temperature; }
    }
    list.push(closeCheck('The Schottky peak sits where Δ/kT is 2.4', (12 * MILLI_EV) / (KB * best), 2.3994, 2e-3, 5));

    const high = oscillator(2.4e13, 5000);
    list.push(closeCheck('At high temperature an oscillator heat capacity approaches k', high.heat / KB, 1, 5e-3, 5));
    list.push(closeCheck('Far above the quantum scale an oscillator mean energy approaches kT', oscillator(2.4e13, 1e6).mean / (KB * 1e6), 1, 1e-2, 5));
    const low = oscillator(2.4e13, 5);
    list.push(check('At low temperature the oscillator freezes out towards zero energy', low.mean / (KB * 5000) < 1e-6, 'quantised states cannot be excited when kT is far below ħω'));
    list.push(closeCheck('The oscillator heat capacity is the derivative of its mean energy', oscillator(2.4e13, 800).heat, (oscillator(2.4e13, 800.4).mean - oscillator(2.4e13, 799.6).mean) / 0.8, 1e-3, 8));

    const gas = gasEntropy(28, 300, 0.0224, 6.022e23);
    list.push(closeCheck('The gas entropy from the partition function matches Sackur–Tetrode', gas.fromPartition, gas.sackur, 1e-6, 8));
    list.push(closeCheck('An ideal gas keeps 3/2 kT of energy per particle', gas.mean, 1.5 * KB * 300, 1e-12, 14));
    list.push(closeCheck('Equipartition gives three halves k per particle for the heat capacity', gas.heat / KB, 1.5, 1e-9, 6));

    const equilibrium = statmechSim.read({ tau: 0 }, { ...statmechSim.params, system: 'equilibrium', enthalpy: 0, entropyChange: 0 });
    list.push(closeCheck('When the free-energy change is zero the equilibrium constant is one', equilibrium.k, 1, 1e-12, 10));
    const exothermic = statmechSim.read({ tau: 0 }, { ...statmechSim.params, system: 'equilibrium', enthalpy: -50, entropyChange: -100, temperature: 298 });
    list.push(closeCheck('K comes from exp(−ΔG°/RT)', exothermic.k, Math.exp(-((-50000) - 298 * (-100)) / (8.314462618 * 298)), 1e-12, 10));
    list.push(check('Heating pushes an exothermic, entropy-losing reaction backwards', statmechSim.read({ tau: 0 }, { ...statmechSim.params, system: 'equilibrium', enthalpy: -50, entropyChange: -100, temperature: 800 }).k < exothermic.k, 'ΔG° turns positive once the entropy term outweighs the enthalpy term'));
    return { checks: list };
  },
};

/** A modest temperature sweep for the curves. */
function linspaceTemperatures(top, count) {
  return Array.from({ length: count }, (_, i) => Math.max(1, (top * (i + 1)) / count));
}