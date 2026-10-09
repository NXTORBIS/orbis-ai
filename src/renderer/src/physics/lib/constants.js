// Research-grade physical constants (CODATA 2018), SI units, prefixes, and
// deterministic unit conversion. No AI — pure data and arithmetic.

export const CONSTANTS = {
  c: { value: 299792458, unit: 'm/s', name: 'Speed of light in vacuum', sym: 'c' },
  G: { value: 6.6743e-11, unit: 'm^3 kg^-1 s^-2', name: 'Gravitational constant', sym: 'G' },
  h: { value: 6.62607015e-34, unit: 'J s', name: 'Planck constant', sym: 'h' },
  hbar: { value: 1.054571817e-34, unit: 'J s', name: 'Reduced Planck constant', sym: 'ℏ' },
  e: { value: 1.602176634e-19, unit: 'C', name: 'Elementary charge', sym: 'e' },
  kB: { value: 1.380649e-23, unit: 'J/K', name: 'Boltzmann constant', sym: 'k_B' },
  eps0: { value: 8.8541878128e-12, unit: 'F/m', name: 'Vacuum permittivity', sym: 'ε₀' },
  mu0: { value: 1.25663706212e-6, unit: 'N/A^2', name: 'Vacuum permeability', sym: 'μ₀' },
  me: { value: 9.1093837015e-31, unit: 'kg', name: 'Electron mass', sym: 'm_e' },
  mp: { value: 1.67262192369e-27, unit: 'kg', name: 'Proton mass', sym: 'm_p' },
  mn: { value: 1.67492749804e-27, unit: 'kg', name: 'Neutron mass', sym: 'm_n' },
  NA: { value: 6.02214076e23, unit: 'mol^-1', name: 'Avogadro constant', sym: 'N_A' },
  R: { value: 8.314462618, unit: 'J mol^-1 K^-1', name: 'Gas constant', sym: 'R' },
  alpha: { value: 7.2973525693e-3, unit: '', name: 'Fine-structure constant', sym: 'α' },
  sigma: { value: 5.670374419e-8, unit: 'W m^-2 K^-4', name: 'Stefan–Boltzmann constant', sym: 'σ' },
  g: { value: 9.80665, unit: 'm/s^2', name: 'Standard gravity', sym: 'g' },
  eV: { value: 1.602176634e-19, unit: 'J', name: 'Electronvolt', sym: 'eV' },
  au: { value: 1.495978707e11, unit: 'm', name: 'Astronomical unit', sym: 'AU' },
  ly: { value: 9.4607304725808e15, unit: 'm', name: 'Light-year', sym: 'ly' },
  pc: { value: 3.08567758149e16, unit: 'm', name: 'Parsec', sym: 'pc' },
  Msun: { value: 1.98847e30, unit: 'kg', name: 'Solar mass', sym: 'M☉' },
  Rsun: { value: 6.9634e8, unit: 'm', name: 'Solar radius', sym: 'R☉' },
  Lsun: { value: 3.828e26, unit: 'W', name: 'Solar luminosity', sym: 'L☉' },
  Tsun: { value: 5772, unit: 'K', name: 'Solar effective temperature', sym: 'T☉' },
};

export const PREFIXES = [
  { name: 'yotta', sym: 'Y', factor: 1e24 },
  { name: 'zetta', sym: 'Z', factor: 1e21 },
  { name: 'exa', sym: 'E', factor: 1e18 },
  { name: 'peta', sym: 'P', factor: 1e15 },
  { name: 'tera', sym: 'T', factor: 1e12 },
  { name: 'giga', sym: 'G', factor: 1e9 },
  { name: 'mega', sym: 'M', factor: 1e6 },
  { name: 'kilo', sym: 'k', factor: 1e3 },
  { name: 'hecto', sym: 'h', factor: 1e2 },
  { name: 'deca', sym: 'da', factor: 1e1 },
  { name: '', sym: '', factor: 1 },
  { name: 'deci', sym: 'd', factor: 1e-1 },
  { name: 'centi', sym: 'c', factor: 1e-2 },
  { name: 'milli', sym: 'm', factor: 1e-3 },
  { name: 'micro', sym: 'µ', factor: 1e-6 },
  { name: 'nano', sym: 'n', factor: 1e-9 },
  { name: 'pico', sym: 'p', factor: 1e-12 },
  { name: 'femto', sym: 'f', factor: 1e-15 },
  { name: 'atto', sym: 'a', factor: 1e-18 },
  { name: 'zepto', sym: 'z', factor: 1e-21 },
  { name: 'yocto', sym: 'y', factor: 1e-24 },
];

// Base SI dimensions: mass M, length L, time T, current I, temperature K,
// amount N, luminous intensity J. Each unit maps to a dimension vector and
// the factor to convert one unit into the SI base of that dimension.
const D = (M, L, T, I, K, N, J) => ({ M, L, T, I, K, N, J });

export const UNITS = {
  // length (base: m)
  m: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 1 }, km: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 1e3 },
  cm: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 1e-2 }, mm: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 1e-3 },
  um: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 1e-6 }, nm: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 1e-9 },
  A: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 1e-10 }, mi: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 1609.344 },
  ft: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 0.3048 }, in: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 0.0254 },
  ly: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 9.4607304725808e15 }, pc: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 3.08567758149e16 },
  AU: { dim: D(0, 1, 0, 0, 0, 0, 0), to: 1.495978707e11 },
  // mass (base: kg)
  kg: { dim: D(1, 0, 0, 0, 0, 0, 0), to: 1 }, g: { dim: D(1, 0, 0, 0, 0, 0, 0), to: 1e-3 },
  mg: { dim: D(1, 0, 0, 0, 0, 0, 0), to: 1e-6 }, t: { dim: D(1, 0, 0, 0, 0, 0, 0), to: 1e3 },
  u: { dim: D(1, 0, 0, 0, 0, 0, 0), to: 1.66053906660e-27 }, lb: { dim: D(1, 0, 0, 0, 0, 0, 0), to: 0.45359237 },
  // time (base: s)
  s: { dim: D(0, 0, 1, 0, 0, 0, 0), to: 1 }, ms: { dim: D(0, 0, 1, 0, 0, 0, 0), to: 1e-3 },
  us: { dim: D(0, 0, 1, 0, 0, 0, 0), to: 1e-6 }, ns: { dim: D(0, 0, 1, 0, 0, 0, 0), to: 1e-9 },
  min: { dim: D(0, 0, 1, 0, 0, 0, 0), to: 60 }, h: { dim: D(0, 0, 1, 0, 0, 0, 0), to: 3600 },
  day: { dim: D(0, 0, 1, 0, 0, 0, 0), to: 86400 }, yr: { dim: D(0, 0, 1, 0, 0, 0, 0), to: 3.15576e7 },
  // current (base: A)
  A: { dim: D(0, 0, 0, 1, 0, 0, 0), to: 1 }, mA: { dim: D(0, 0, 0, 1, 0, 0, 0), to: 1e-3 },
  // temperature (base: K)
  K: { dim: D(0, 0, 0, 0, 1, 0, 0), to: 1 }, degC: { dim: D(0, 0, 0, 0, 1, 0, 0), to: 1, offset: 273.15 },
  degF: { dim: D(0, 0, 0, 0, 1, 0, 0), to: 5 / 9, offset: 459.67 },
  // amount (base: mol)
  mol: { dim: D(0, 0, 0, 0, 0, 1, 0), to: 1 },
  // derived
  N: { dim: D(1, 1, -2, 0, 0, 0, 0), to: 1 }, Pa: { dim: D(1, -1, -2, 0, 0, 0, 0), to: 1 },
  J: { dim: D(1, 2, -2, 0, 0, 0, 0), to: 1 }, W: { dim: D(1, 2, -3, 0, 0, 0, 0), to: 1 },
  C: { dim: D(0, 0, 1, 1, 0, 0, 0), to: 1 }, V: { dim: D(1, 2, -3, -1, 0, 0, 0), to: 1 },
  ohm: { dim: D(1, 2, -3, -2, 0, 0, 0), to: 1 }, F: { dim: D(-1, -2, 4, 2, 0, 0, 0), to: 1 },
  H: { dim: D(1, 2, -2, -2, 0, 0, 0), to: 1 }, Wb: { dim: D(1, 2, -2, -1, 0, 0, 0), to: 1 },
  T: { dim: D(1, 0, -2, -1, 0, 0, 0), to: 1 }, Hz: { dim: D(0, 0, -1, 0, 0, 0, 0), to: 1 },
  eV: { dim: D(1, 2, -2, 0, 0, 0, 0), to: 1.602176634e-19 }, cal: { dim: D(1, 2, -2, 0, 0, 0, 0), to: 4.184 },
  atm: { dim: D(1, -1, -2, 0, 0, 0, 0), to: 101325 }, bar: { dim: D(1, -1, -2, 0, 0, 0, 0), to: 1e5 },
  l: { dim: D(0, 3, 0, 0, 0, 0, 0), to: 1e-3 }, cc: { dim: D(0, 3, 0, 0, 0, 0, 0), to: 1e-6 },
  mps: { dim: D(0, 1, -1, 0, 0, 0, 0), to: 1 }, kmph: { dim: D(0, 1, -1, 0, 0, 0, 0), to: 1 / 3.6 },
  mph: { dim: D(0, 1, -1, 0, 0, 0, 0), to: 0.44704 },
};

export function dimEqual(a, b) {
  return a.M === b.M && a.L === b.L && a.T === b.T && a.I === b.I && a.K === b.K && a.N === b.N && a.J === b.J;
}
export function dimString(d) {
  const parts = [];
  const labels = ['M', 'L', 'T', 'I', 'K', 'N', 'J'];
  const vals = [d.M, d.L, d.T, d.I, d.K, d.N, d.J];
  for (let i = 0; i < 7; i++) { if (vals[i] === 0) continue; parts.push(vals[i] === 1 ? labels[i] : `${labels[i]}^${vals[i]}`); }
  return parts.length ? parts.join('·') : 'dimensionless';
}

// Convert a numeric value from one unit to another. Returns { value, ok, error }.
export function convert(value, from, to) {
  const u = UNITS[from], v = UNITS[to];
  if (!u) return { ok: false, error: `Unknown unit "${from}"` };
  if (!v) return { ok: false, error: `Unknown unit "${to}"` };
  if (!dimEqual(u.dim, v.dim)) return { ok: false, error: `Dimension mismatch: ${dimString(u.dim)} ≠ ${dimString(v.dim)}` };
  const si = (value + (u.offset || 0)) * u.to;
  const out = si / v.to - (v.offset || 0);
  return { ok: true, value: out };
}