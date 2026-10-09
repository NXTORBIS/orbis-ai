/*
 * Number formatting and physical constants for the chemistry studios.
 *
 * NOT the user's own file. Their `src/lib/chemistry/units.js` is not in any of the extracted archives, so this is
 * written from the call sites: every studio imports `fmtSci`, three import `fmtUnits`, and the constants are the
 * standard ones the equations in those studios use. The values are the published ones (CODATA / NIST), not
 * invented, and the formatting matches how their numbers are shown beside each other in a stat row.
 */

/** The constants the studios' equations need, in SI. */
export const CONSTANTS = {
  /** Gas constant, J/(mol·K). */
  R: 8.314462618,
  /** Boltzmann constant, J/K. */
  kB: 1.380649e-23,
  /** Avogadro constant, 1/mol. */
  NA: 6.02214076e23,
  /** Faraday constant, C/mol. */
  F: 96485.33212,
  /** Planck constant, J·s. */
  h: 6.62607015e-34,
  /** Reduced Planck constant, J·s. */
  hbar: 1.054571817e-34,
  /** Speed of light in vacuum, m/s. */
  c: 299792458,
  /** Elementary charge, C. */
  e: 1.602176634e-19,
  /** Electron mass, kg. */
  me: 9.1093837015e-31,
  /** Atomic mass constant, kg. */
  u: 1.66053906660e-27,
  /** Standard gravity, m/s². */
  g: 9.80665,
  /** Stefan–Boltzmann constant, W/(m²·K⁴). */
  sigma: 5.670374419e-8,
  /** Vacuum permittivity, F/m. */
  eps0: 8.8541878128e-12,
  /** Standard atmosphere, Pa. */
  atm: 101325,
  /** Zero Celsius in kelvin. */
  T0: 273.15,
  /** Rydberg constant, 1/m. */
  Rinf: 10973731.568160,
  /** Bohr radius, m. */
  a0: 5.29177210903e-11
};

/**
 * A number a person can read, at a sensible precision.
 *
 * Plain decimal in the range where decimals are readable, and exponent form outside it. A value that is not a
 * number comes back as a dash rather than as "NaN": a studio showing NaN reads as broken, and a dash reads as
 * "nothing to show here yet", which is what it means when a control has not been set.
 */
export function fmtSci(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const size = Math.abs(n);
  if (size >= 1e-3 && size < 1e6) {
    // Keep `digits` significant figures, then drop trailing zeros so a whole number does not read as 25.00.
    const shown = Number(n.toPrecision(Math.max(1, digits) + 1));
    return String(Number(shown.toFixed(Math.max(0, digits))));
  }
  const exp = Math.floor(Math.log10(size));
  const mantissa = n / 10 ** exp;
  const SUPER = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const up = String(exp)
    .split('')
    .map((ch) => SUPER[ch] ?? ch)
    .join('');
  return `${Number(mantissa.toFixed(Math.max(0, digits - 1)))}×10${up}`;
}

/** The same number with its unit after it, so a stat row does not have to concatenate by hand. */
export function fmtUnits(value, unit, digits = 3) {
  const shown = fmtSci(value, digits);
  if (shown === '—') return '—';
  return unit ? `${shown} ${unit}` : shown;
}

/** Celsius to kelvin, and back. Used wherever a studio offers a temperature in the unit people think in. */
export const toKelvin = (celsius) => Number(celsius) + CONSTANTS.T0;
export const toCelsius = (kelvin) => Number(kelvin) - CONSTANTS.T0;
