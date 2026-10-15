import { check, closeCheck, linspace } from '@jarvis/components/toolkit/physics/phys';

const DAY = 86400, LN2 = Math.log(2);
export const ISOTOPES = { carbon14: { label: 'Carbon-14', half: 5730 * 365.25 }, iodine131: { label: 'Iodine-131', half: 8.02 }, cobalt60: { label: 'Cobalt-60', half: 5.2714 * 365.25 } };
export const decayChain = (n0, parentHalf, daughterHalf, timeDays) => {
  const lp = LN2 / parentHalf, ld = LN2 / daughterHalf;
  const parent = n0 * Math.exp(-lp * timeDays);
  const daughter = Math.abs(lp - ld) < 1e-10 * Math.max(lp, ld)
    ? n0 * lp * timeDays * Math.exp(-lp * timeDays)
    : lp < ld ? parent * lp * (-Math.expm1(-(ld - lp) * timeDays)) / (ld - lp)
      : n0 * Math.exp(-ld * timeDays) * lp * (-Math.expm1(-(lp - ld) * timeDays)) / (lp - ld);
  return { parent, daughter, stable: Math.max(0, n0 - parent - daughter) };
};
export const bindingEnergy = (a, z) => {
  const n = a - z;
  const pairing = a % 2 ? 0 : (z % 2 ? -1 : 1) * 34 / Math.pow(a, 0.75);
  return 15.75 * a - 17.8 * a ** (2 / 3) - 0.711 * z * (z - 1) / Math.cbrt(a) - 23.7 * (a - 2 * z) ** 2 / a + pairing;
};
export const nuclearSim = {
  id: 'nuclear-decay-chain', unit: 'display s',
  isStatic: (p) => p.mode === 'binding',
  endTime: (p) => 4 * (8 - p.elapsed),
  params: { mode: 'single', isotope: 'iodine131', halfDays: 2, daughterHalf: 0.5, atoms: 1, elapsed: 0, a: 56, z: 26 },
  fields: [
    { key: 'mode', label: 'Experiment', options: [{ value: 'single', label: 'Radioactive decay & activity' }, { value: 'chain', label: 'Parent → daughter → stable' }, { value: 'binding', label: 'Nuclear binding-energy landscape' }] },
    { key: 'isotope', label: 'Isotope', options: [...Object.entries(ISOTOPES).map(([value, item]) => ({ value, label: item.label })), { value: 'custom', label: 'Custom half-life' }], when: { mode: ['single'] } },
    { key: 'halfDays', label: 'Parent half-life (days)', min: 0.001, max: 1e7, step: 0.001, when: { mode: ['chain'] } },
    { key: 'halfDays', label: 'Custom half-life (days)', min: 0.001, max: 1e7, step: 0.001, when: { mode: ['single'], isotope: ['custom'] } },
    { key: 'daughterHalf', label: 'Daughter half-life (days)', min: 0.001, max: 1e7, step: 0.001, when: { mode: ['chain'] } },
    { key: 'atoms', label: 'Initial parent atoms (×10¹²)', min: 0.001, max: 1000, step: 0.001, when: { mode: ['single', 'chain'] } },
    { key: 'elapsed', label: 'Starting time (parent half-lives)', min: 0, max: 8, step: 0.05, slider: true, when: { mode: ['single', 'chain'] } },
    { key: 'a', label: 'Mass number A', min: 12, max: 250, integer: true, when: { mode: ['binding'] } },
    { key: 'z', label: 'Proton number Z', min: 2, max: 120, integer: true, when: { mode: ['binding'] } },
  ],
  normalise: (p) => ({ ...p, z: Math.min(p.z, p.a - 1) }),
  options: { maxStep: 0.05, resetOn: ['mode', 'isotope', 'halfDays', 'daughterHalf', 'atoms', 'elapsed'] },
  init: () => ({}), step: (state) => state, series: [],
  read: (state, p) => {
    const half = p.mode === 'single' && ISOTOPES[p.isotope] ? ISOTOPES[p.isotope].half : p.halfDays;
    const time = Math.min(8, p.elapsed + (state.t ?? 0) / 4), days = time * half, n0 = p.atoms * 1e12;
    const chain = p.mode === 'chain' ? decayChain(n0, half, p.daughterHalf, days) : { parent: n0 * Math.pow(2, -time), daughter: 0, stable: n0 * (1 - Math.pow(2, -time)) };
    const binding = bindingEnergy(p.a, Math.min(p.z, p.a - 1));
    return { ...chain, n0, time, days, half, activity: LN2 * chain.parent / (half * DAY), daughterActivity: LN2 * chain.daughter / (p.daughterHalf * DAY), binding, perNucleon: binding / p.a, nuclearMass: p.z * 1.007276466621 + (p.a - p.z) * 1.00866491595 - binding / 931.49410242 };
  },
  analyse: (p) => {
    const half = p.mode === 'single' && ISOTOPES[p.isotope] ? ISOTOPES[p.isotope].half : p.halfDays;
    const times = linspace(0, 8, 161), values = times.map((t) => decayChain(1, half, p.daughterHalf, t * half));
    return { decay: [
      { label: 'Parent fraction', points: times.map((x, i) => ({ x, y: p.mode === 'chain' ? values[i].parent : Math.pow(2, -x) })) },
      { label: p.mode === 'chain' ? 'Daughter fraction' : 'Stable fraction', points: times.map((x, i) => ({ x, y: p.mode === 'chain' ? values[i].daughter : 1 - Math.pow(2, -x) })) },
      ...(p.mode === 'chain' ? [{ label: 'Stable fraction', points: times.map((x, i) => ({ x, y: values[i].stable })) }] : []),
    ], binding: Array.from({ length: 239 }, (_, i) => { const x = i + 12, z = Math.round(x / (2 + 0.711 * x ** (2 / 3) / 47.4)); return { x, y: bindingEnergy(x, z) / x }; }) };
  },
  note: 'Decay is an exact exponential expectation, not a random Monte Carlo run. Four display seconds represent one parent half-life. The binding-energy mode is the semi-empirical liquid-drop approximation, not measured isotope masses or a decay-path predictor.',
  checkNote: 'Half-life, numerical decay-rate derivative, Bateman population conservation, the equal-rate limit, positivity and mass-defect accounting.',
  verify: () => {
    const q = decayChain(1, 2, 0.5, 3), eq = decayChain(1, 2, 2, 2), eps = 1e-5;
    const numeric = -(decayChain(1, 2, 0.5, 3 + eps).parent - decayChain(1, 2, 0.5, 3 - eps).parent) / (2 * eps);
    return { checks: [
      closeCheck('One parent half-life leaves half the initial population', decayChain(1, 2, 1, 2).parent, 0.5, 1e-12),
      closeCheck('Parent, daughter and stable populations conserve atoms', q.parent + q.daughter + q.stable, 1, 1e-12),
      closeCheck('The numerical decay derivative equals λN', numeric, LN2 / 2 * q.parent, 1e-8),
      closeCheck('Equal decay constants have daughter population λt exp(−λt)', eq.daughter, LN2 / 2, 1e-12),
      check('No daughter atoms exist at time zero', decayChain(1, 2, 0.5, 0).daughter === 0, 'daughter = 0'),
      check('All chain populations remain nonnegative', linspace(0, 40, 100).every((t) => Object.values(decayChain(1, 2, 0.5, t)).every((n) => n >= 0)), '100 time samples'),
      closeCheck('The daughter equation balances production and loss', (decayChain(1, 2, 0.5, 3 + eps).daughter - decayChain(1, 2, 0.5, 3 - eps).daughter) / (2 * eps), LN2 / 2 * q.parent - LN2 / 0.5 * q.daughter, 1e-8),
      check('The equal-rate limit is continuous', Math.abs(decayChain(1, 2, 2.000001, 2).daughter - eq.daughter) < 1e-6, 'half-lives differ by one part in two million'),
      check('Iron-56 binds between 8 and 9 MeV per nucleon in this model', bindingEnergy(56, 26) / 56 > 8 && bindingEnergy(56, 26) / 56 < 9, 'liquid-drop estimate'),
      closeCheck('The computed mass defect gives the binding energy', (26 * 1.007276466621 + 30 * 1.00866491595 - nuclearSim.read({}, nuclearSim.params).nuclearMass) * 931.49410242, bindingEnergy(56, 26), 1e-10),
    ] };
  },
};