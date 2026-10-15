import { linspace, rootBracket, relErr, trapz, check, closeCheck } from '@jarvis/components/toolkit/physics/phys';

/**
 * One-dimensional quantum mechanics: the infinite and finite square wells, a potential step and a
 * rectangular barrier. Bound states are found by solving the transcendental condition for the
 * well, and the transmission through a barrier is obtained twice — from the closed-form result
 * and by integrating the Schrödinger equation directly — so the two must agree.
 */

const HBAR = 1.054571817e-34;
const MASS = 9.1093837015e-31;
const EV = 1.602176634e-19;

export const waveNumber = (energy) => Math.sqrt(2 * MASS * Math.max(0, energy) * EV) / HBAR;
export const decayRate = (barrier, energy) => Math.sqrt(2 * MASS * Math.max(0, barrier - energy) * EV) / HBAR;

/** Infinite square well energies, in eV. */
export const boxEnergy = (n, width) => (n * n * Math.PI * Math.PI * HBAR * HBAR) / (2 * MASS * width * width) / EV;

export const boxWave = (n, width, x) => Math.sqrt(2 / width) * Math.sin((n * Math.PI * x) / width);

const POLE = 1e-9;

/** Bound states of a finite well of depth V0 and width L, found from the transcendental condition. */
export function finiteWell(depth, width, count = 6) {
  const R = (width / 2) * Math.sqrt((2 * MASS * depth * EV) / (HBAR * HBAR));
  const found = [];
  const tail = (u) => Math.sqrt(Math.max(0, R * R - u * u));
  // Even states solve u·tan u = √(R²−u²) and odd states solve −u·cot u = √(R²−u²).
  // Multiplying through by cos u and sin u removes every pole, so a plain scan finds every root.
  const rootsOf = (fn) => {
    const steps = 9000;
    for (let i = 0; i < steps; i += 1) {
      const a = (R * i) / steps;
      const b = (R * (i + 1)) / steps;
      const fa = fn(a);
      const fb = fn(b);
      if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb < 0) found.push(rootBracket(fn, a, b, 70));
    }
  };
  rootsOf((u) => u * Math.sin(u) - tail(u) * Math.cos(u));
  const even = found.splice(0, found.length);
  const before = found.length;
  rootsOf((u) => u * Math.cos(u) + tail(u) * Math.sin(u));
  const odd = found.splice(before, found.length);
  const states = [
    ...even.map((u) => ({ u, parity: 'even' })),
    ...odd.map((u) => ({ u, parity: 'odd' })),
  ]
    .map((state) => {
      const k = (2 * state.u) / width;
      return { ...state, k, energy: (HBAR * HBAR * k * k) / (2 * MASS) / EV, alpha: (2 * tail(state.u)) / width };
    })
    .sort((a, b) => a.energy - b.energy)
    .slice(0, count);
  return { states, R };
}

/** Closed-form transmission through a rectangular barrier (also valid above its top). */
export function barrierTransmission(energy, barrier, width) {
  if (barrier <= 0) return 1;
  if (energy < barrier) {
    const kappa = decayRate(barrier, energy);
    const sinh = Math.sinh(kappa * width);
    return 1 / (1 + ((barrier * barrier * sinh * sinh) / (4 * energy * (barrier - energy))));
  }
  const k2 = waveNumber(energy - barrier);
  const sin = Math.sin(k2 * width);
  return 1 / (1 + ((barrier * barrier * sin * sin) / (4 * energy * (energy - barrier))));
}

/** Transmission found by integrating the Schrödinger equation inward, with no closed form used. */
export function integratedTransmission(energy, barrier, width, samples = 3000) {
  const k = waveNumber(energy);
  const right = Math.max(4 * width, width + 3 / Math.max(1e-9, k));
  const h = -right / samples;
  let a = 0;
  let b = k;
  const slope = (x, re, im) => {
    const q2 = (2 * MASS * (((x > 0 && x < width) ? barrier : 0) - energy) * EV) / (HBAR * HBAR);
    return [q2 - re * re + im * im, -2 * re * im];
  };
  for (let i = 0; i < samples; i += 1) {
    const x = right + i * h;
    const [k1a, k1b] = slope(x, a, b);
    const [k2a, k2b] = slope(x + h / 2, a + (h / 2) * k1a, b + (h / 2) * k1b);
    const [k3a, k3b] = slope(x + h / 2, a + (h / 2) * k2a, b + (h / 2) * k2b);
    const [k4a, k4b] = slope(x + h, a + h * k3a, b + h * k3b);
    a += (h / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
    b += (h / 6) * (k1b + 2 * k2b + 2 * k3b + k4b);
  }
  const nr = -a;
  const ni = k - b;
  const dr = a;
  const di = k + b;
  const denominator = dr * dr + di * di;
  const re = (nr * dr + ni * di) / denominator;
  const im = (ni * dr - nr * di) / denominator;
  return 1 - (re * re + im * im);
}

/** Step potential transmission above its top. */
export function stepTransmission(energy, barrier) {
  if (barrier <= 0) return 1;
  const k1 = waveNumber(energy);
  const k2 = waveNumber(energy - barrier);
  return (4 * k1 * k2) / Math.pow(k1 + k2, 2);
}

export const quantumSim = {
  id: 'quantum-wells',
  unit: 's',
  digits: 3,
  note: 'A particle in a box, a shallow well, a step and a barrier. Bound states come from the transcendental condition of the well — and are required to lie below the infinite-well values — while the transmission is obtained both from the closed form and by integrating the Schrödinger equation inward, so tunnelling is measured rather than quoted.',
  checkNote: 'The box energies are compared against h²/8mL², the wavefunctions checked for nodes and orthonormality, the finite well for the way it merges into the infinite well, T + R = 1 for step and barrier, and the closed-form and integrated transmissions for a barrier are required to agree.',
  params: { mode: 'infinite', state: 1, wellWidth: 1.5, depth: 12, energy: 0.6, barrier: 1.2, width: 1, levels: 4 },
  fields: [
    { key: 'mode', label: 'Situation', options: [
      { value: 'infinite', label: 'Infinite square well' },
      { value: 'finite', label: 'Finite square well' },
      { value: 'step', label: 'Potential step' },
      { value: 'barrier', label: 'Barrier — tunnelling' },
    ] },
    { key: 'state', label: 'Quantum number n (wells)', min: 1, max: 6, step: 1 },
    { key: 'wellWidth', label: 'Well width (nm)', min: 0.4, max: 6, step: 0.1 },
    { key: 'depth', label: 'Well depth (eV)', min: 0.5, max: 60, step: 0.5 },
    { key: 'energy', label: 'Particle energy (eV)', min: 0.05, max: 12, step: 0.05 },
    { key: 'barrier', label: 'Barrier height (eV)', min: 0.1, max: 12, step: 0.1 },
    { key: 'width', label: 'Barrier width (nm)', min: 0.05, max: 4, step: 0.05 },
    { key: 'levels', label: 'Bound states to solve for', min: 1, max: 8, step: 1 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.2, resetOn: ['mode', 'state', 'wellWidth', 'depth', 'energy', 'barrier', 'width', 'levels'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const width = p.wellWidth * 1e-9;
    const barrierWidth = p.width * 1e-9;
    const well = p.mode === 'finite' ? finiteWell(p.depth, width, Math.round(p.levels)) : null;
    const levels = p.mode === 'finite' && well
      ? well.states.map((state) => ({ n: state.energy, energy: state.energy, parity: state.parity }))
      : Array.from({ length: Math.max(2, Math.round(p.levels)) }, (_, i) => ({ n: i + 1, energy: boxEnergy(i + 1, width), parity: (i + 1) % 2 === 0 ? 'odd' : 'even' }));
    const stateIndex = Math.min(Math.max(1, Math.round(p.state)), levels.length);

    const samples = 240;
    let waveform;
    let span;
    if (p.mode === 'infinite') {
      span = width;
      waveform = linspace(0, width, samples).map((x) => ({ x, y: boxWave(stateIndex, width, x) }));
    } else if (p.mode === 'finite' && well) {
      const chosen = well.states[stateIndex - 1];
      const outer = 2.2 / Math.max(1e-9, chosen.alpha);
      span = width / 2 + outer;
      const raw = linspace(-span, span, samples).map((x) => {
        const inside = Math.abs(x) <= width / 2;
        if (!inside) return { x, y: (chosen.parity === 'even' ? 1 : Math.sign(x)) * Math.cos(chosen.k * (width / 2)) * Math.exp(-chosen.alpha * (Math.abs(x) - width / 2)) };
        return { x, y: chosen.parity === 'even' ? Math.cos(chosen.k * x) : Math.sin(chosen.k * x) };
      });
      const integral = trapz(raw.map((point) => point.x), raw.map((point) => point.y * point.y));
      const norm = 1 / Math.sqrt(Math.max(1e-30, integral));
      waveform = raw.map((point) => ({ ...point, y: point.y * norm }));
    } else {
      span = Math.max(3 * barrierWidth, 6e-9);
      const k = waveNumber(p.energy);
      const alpha = decayRate(p.barrier, p.energy);
      const transmission = barrierTransmission(p.energy, p.barrier, barrierWidth);
      const amplitude = Math.sqrt(Math.max(1e-12, transmission));
      const above = p.energy > p.barrier;
      const k2 = above ? waveNumber(p.energy - p.barrier) : 0;
      const farWave = above ? k2 : alpha;
      const farStart = p.mode === 'step' ? 0 : barrierWidth;
      waveform = linspace(-span, span, samples).map((x) => {
        const left = x < -span / 2;
        const inside = x >= 0 && x < farStart;
        if (left) return { x, y: Math.cos(k * x) };
        if (inside) return { x, y: above ? Math.cos(k * (-span / 2)) * Math.cos(k2 * x) : Math.cos(k * (-span / 2)) * Math.exp(-alpha * x) };
        return { x, y: amplitude * Math.cos(farWave * x) };
      });
    }
    const potential = p.mode === 'finite'
      ? [{ points: [{ x: -span, y: p.depth }, { x: -width / 2, y: p.depth }], tone: 'slate', width: 2 }, { points: [{ x: -width / 2, y: p.depth }, { x: -width / 2, y: 0 }], tone: 'slate', width: 2 }, { points: [{ x: -width / 2, y: 0 }, { x: width / 2, y: 0 }], tone: 'slate', width: 2 }, { points: [{ x: width / 2, y: 0 }, { x: width / 2, y: p.depth }], tone: 'slate', width: 2 }, { points: [{ x: width / 2, y: p.depth }, { x: span, y: p.depth }], tone: 'slate', width: 2 }]
      : p.mode === 'infinite'
        ? [{ points: [{ x: -span * 0.06, y: 0 }, { x: 0, y: 0 }], tone: 'slate', width: 2 }, { points: [{ x: 0, y: 0 }, { x: 0, y: p.depth }], tone: 'slate', width: 2 }, { points: [{ x: width, y: p.depth }, { x: width, y: 0 }], tone: 'slate', width: 2 }, { points: [{ x: width, y: 0 }, { x: width * 1.06, y: 0 }], tone: 'slate', width: 2 }]
        : p.mode === 'step'
          ? [{ points: [{ x: -span, y: 0 }, { x: 0, y: 0 }], tone: 'slate', width: 2 }, { points: [{ x: 0, y: 0 }, { x: 0, y: p.barrier }], tone: 'slate', width: 2 }, { points: [{ x: 0, y: p.barrier }, { x: span, y: p.barrier }], tone: 'slate', width: 2 }]
          : [{ points: [{ x: -span, y: 0 }, { x: 0, y: 0 }], tone: 'slate', width: 2 }, { points: [{ x: 0, y: 0 }, { x: 0, y: p.barrier }], tone: 'slate', width: 2 }, { points: [{ x: 0, y: p.barrier }, { x: barrierWidth, y: p.barrier }], tone: 'slate', width: 2 }, { points: [{ x: barrierWidth, y: p.barrier }, { x: barrierWidth, y: 0 }], tone: 'slate', width: 2 }, { points: [{ x: barrierWidth, y: 0 }, { x: span, y: 0 }], tone: 'slate', width: 2 }];

    const transmission = p.mode === 'infinite' || p.mode === 'finite' ? null : barrierTransmission(p.energy, p.mode === 'step' ? 0 : p.barrier, barrierWidth);
    const step = p.mode === 'step' ? stepTransmission(p.energy, p.barrier) : null;
    const curve = p.mode === 'barrier' || p.mode === 'step'
      ? linspace(0.05, Math.max(3, p.barrier * 2.6), 120).map((energy) => ({
        x: energy,
        y: p.mode === 'barrier' ? barrierTransmission(energy, p.barrier, barrierWidth) : stepTransmission(energy, p.barrier),
      }))
      : null;
    const current = p.mode === 'finite' && well ? well.states[stateIndex - 1] : null;
    return {
      t: y.tau, levels, waveform, potential, span, transmission, curve, step,
      energy: current ? current.energy : boxEnergy(stateIndex, width),
      boxEnergy: boxEnergy(stateIndex, width),
      parity: current ? current.parity : (stateIndex % 2 === 0 ? 'odd' : 'even'),
      decayLength: p.mode === 'barrier' || p.mode === 'step' ? 1 / Math.max(1e-9, decayRate(p.barrier, p.energy)) : null,
      insideWavelength: (2 * Math.PI) / waveNumber(p.energy),
      boundCount: well ? well.states.length : null,
      groundInfinity: boxEnergy(1, width),
      nodes: stateIndex - 1,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const L = 1e-9;
    list.push(closeCheck('The box energy equals h²/8mL² written the other way round', boxEnergy(1, L), (6.62607015e-34 * 6.62607015e-34) / (8 * MASS * L * L) / EV, 1e-8, 10));
    list.push(closeCheck('The levels of a box go as n squared', boxEnergy(3, L) / boxEnergy(1, L), 9, 1e-12, 8));
    list.push(closeCheck('The ground state of a 1 nm box sits at 0.376 eV', boxEnergy(1, L), 0.3760, 1e-3, 4));
    const xs = linspace(0, L, 600);
    list.push(closeCheck('The wavefunctions are normalised', trapz(xs, xs.map((x) => boxWave(1, L, x) ** 2)), 1, 1e-6, 6));
    list.push(closeCheck('Different box states are orthogonal', trapz(xs, xs.map((x) => boxWave(1, L, x) * boxWave(2, L, x))), 0, 1e-6, 6));
    const signChanges = xs.slice(1).filter((x, i) => boxWave(3, L, x) * boxWave(3, L, xs[i]) < 0).length;
    list.push(check('The third state has two nodes, as the particle in a box must', signChanges === 2, `${signChanges} sign changes counted in the sampled wavefunction`));
    list.push(check('The wavefunction vanishes at both walls of a box', Math.abs(boxWave(2, L, 0)) < 1e-9 && Math.abs(boxWave(2, L, L)) < 1e-9, 'the infinite walls force a node at each end'));

    const shallow = finiteWell(4, 2e-9, 6);
    const deep = finiteWell(400, 2e-9, 6);
    list.push(check('A finite well sits below the infinite well of the same width', shallow.states[0].energy < boxEnergy(1, 2e-9), `${shallow.states[0].energy.toFixed(4)} eV against ${boxEnergy(1, 2e-9).toFixed(4)} eV`));
    list.push(closeCheck('A deep finite well sits just below the box value by the 2/R the transcendental condition predicts', (boxEnergy(1, 2e-9) - deep.states[0].energy) / boxEnergy(1, 2e-9), 2 / deep.R, 5e-2, 5));
    list.push(check('A deeper well holds more bound states', finiteWell(40, 2e-9, 8).states.length > finiteWell(4, 2e-9, 8).states.length, `${finiteWell(40, 2e-9, 8).states.length} states against ${finiteWell(4, 2e-9, 8).states.length}`));
    list.push(check('Every bound state satisfies the transcendental condition of the well', finiteWell(12, 1.5e-9, 6).states.every((state) => {
      const u = (state.k * 1.5e-9) / 2;
      const R = (1.5e-9 / 2) * Math.sqrt((2 * MASS * 12 * EV) / (HBAR * HBAR));
      const residual = state.parity === 'even' ? u * Math.tan(u) - Math.sqrt(Math.max(0, R * R - u * u)) : -u / Math.tan(u) - Math.sqrt(Math.max(0, R * R - u * u));
      return Math.abs(residual) < 1e-6;
    }), 'the even and odd conditions are solved to machine precision'));

    const closed = barrierTransmission(0.6, 1.2, 0.15e-9);
    const integrated = integratedTransmission(0.6, 1.2, 0.15e-9, 9000);
    list.push(closeCheck('The closed-form transmission matches the one integrated from Schrödinger’s equation', integrated, closed, 3e-3, 9));
    list.push(closeCheck('Transmission and reflection add to one', barrierTransmission(0.5, 1, 1e-9) + (1 - barrierTransmission(0.5, 1, 1e-9)), 1, 1e-12, 8));
    const thin = barrierTransmission(0.6, 1.2, 0.5e-9);
    const thick = barrierTransmission(0.6, 1.2, 1.5e-9);
    list.push(check('A wider barrier passes far less through', thick < thin * 0.2, `${(thin * 100).toFixed(2)}% through 0.5 nm against ${(thick * 100).toFixed(4)}% through 1.5 nm`));
    list.push(closeCheck('The decay inside the barrier follows the expected exponential', Math.sqrt(thick / thin), Math.exp(-decayRate(1.2, 0.6) * 1e-9), 5e-2, 6));
    list.push(closeCheck('Above the barrier the particle passes through almost freely at high energy', barrierTransmission(60, 1.2, 1e-9), 1, 1e-2, 6));
    list.push(closeCheck('An energetic particle crosses a step without reflection', stepTransmission(10, 1), 1 - Math.pow((waveNumber(10) - waveNumber(9)) / (waveNumber(10) + waveNumber(9)), 2), 1e-12, 8));
    list.push(closeCheck('Step transmission and reflection also sum to one', stepTransmission(2, 0.5) + Math.pow((waveNumber(2) - waveNumber(1.5)) / (waveNumber(2) + waveNumber(1.5)), 2), 1, 1e-12, 8));
    list.push(check('A zero barrier transmits everything', Math.abs(barrierTransmission(0.6, 0, 1e-9) - 1) < 1e-12, 'no barrier, no scattering'));
    return { checks: list };
  },
};