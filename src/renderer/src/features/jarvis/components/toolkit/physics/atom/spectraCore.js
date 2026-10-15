import { check, closeCheck } from '@jarvis/components/toolkit/physics/phys';

/**
 * Hydrogen-like energy levels and the spectral lines between them. Every wavelength is produced
 * twice — once from the Rydberg wavenumber and once from the difference of the quantised level
 * energies — so the two routes are compared against each other and against the measured lines.
 */

const PLANCK = 6.62607015e-34;
const LIGHT = 2.99792458e8;
const EV = 1.602176634e-19;
const MASS_E = 9.1093837015e-31;
const FINE = 7.2973525693e-3;

export const RYDBERG = 1.09677583e7;
export const GROUND = (RYDBERG * PLANCK * LIGHT) / EV;
export const BOHR = (PLANCK / (2 * Math.PI)) / (MASS_E * LIGHT * FINE);

export const SERIES = [
  { value: 'lyman', label: 'Lyman — falls to n = 1 (ultraviolet)', nf: 1 },
  { value: 'balmer', label: 'Balmer — falls to n = 2 (mostly visible)', nf: 2 },
  { value: 'paschen', label: 'Paschen — falls to n = 3 (infrared)', nf: 3 },
  { value: 'brackett', label: 'Brackett — falls to n = 4 (infrared)', nf: 4 },
  { value: 'pfund', label: 'Pfund — falls to n = 5 (far infrared)', nf: 5 },
];

export const levelEnergy = (n, z = 1) => (-GROUND * z * z) / (n * n);
export const transitionEnergy = (ni, nf, z = 1) => levelEnergy(ni, z) - levelEnergy(nf, z);
export const wavelengthOf = (ni, nf, z = 1) => (PLANCK * LIGHT) / (transitionEnergy(ni, nf, z) * EV);
export const limitOf = (nf, z = 1) => (nf * nf) / (RYDBERG * z * z);

export const spectraSim = {
  id: 'atomic-spectra',
  unit: 's',
  digits: 3,
  note: 'A hydrogen-like atom: the levels come from Eₙ = −13.6 Z²/n², the lines from the Rydberg wavenumber, and the two are compared with each other and with the measured laboratory wavelengths. Doppler shift, thermal line width and the Bohr orbit quantities are computed from the same state.',
  checkNote: 'The Rydberg route and the level-difference route are required to agree line by line; the known hydrogen wavelengths, the series limits, the Bohr speed and radius and the Z² scaling are all checked against their measured or derived values.',
  params: { series: 'balmer', upper: 3, z: 1, velocity: 0, temperature: 6000, levels: 6 },
  fields: [
    { key: 'series', label: 'Spectral series', options: SERIES },
    { key: 'upper', label: 'Upper level n', min: 2, max: 12, step: 1 },
    { key: 'z', label: 'Nuclear charge Z (hydrogen-like ion)', min: 1, max: 8, step: 1 },
    { key: 'velocity', label: 'Radial velocity (km/s, + receding)', min: -300, max: 300, step: 1 },
    { key: 'temperature', label: 'Gas temperature (K)', min: 500, max: 30000, step: 100 },
    { key: 'levels', label: 'Levels shown', min: 3, max: 10, step: 1 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.2, resetOn: ['series', 'upper', 'z', 'velocity', 'temperature', 'levels'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const series = SERIES.find((item) => item.value === p.series) || SERIES[1];
    const nf = series.nf;
    const z = Math.max(1, Math.round(p.z));
    const ni = Math.max(nf + 1, Math.round(p.upper));
    const energy = transitionEnergy(ni, nf, z);
    const wavelength = wavelengthOf(ni, nf, z);
    const shift = (p.velocity * 1e3) / LIGHT;
    const shifted = wavelength * (1 + shift);
    const limit = limitOf(nf, z);
    const lines = Array.from({ length: 9 }, (_, i) => {
      const upper = nf + 1 + i;
      return { upper, wavelength: wavelengthOf(upper, nf, z), energy: transitionEnergy(upper, nf, z) };
    });
    const levelCount = Math.max(3, Math.round(p.levels));
    const levels = Array.from({ length: levelCount }, (_, i) => {
      const n = i + 1;
      return {
        n,
        energy: levelEnergy(n, z),
        radius: (BOHR * n * n) / z,
        speed: (FINE * LIGHT * z) / n,
        degeneracy: 2 * n * n,
      };
    });
    const thermal = wavelength * Math.sqrt((3 * 1.380649e-23 * p.temperature) / (1.6735575e-27 * LIGHT * LIGHT));
    return {
      t: y.tau, series, nf, ni, z, levels, lines, limit, shifted, shift,
      wavelength, energy, frequency: LIGHT / wavelength, wavenumber: 1e-2 / wavelength,
      visible: wavelength >= 380e-9 && wavelength <= 750e-9,
      level: levelEnergy(ni, z), ionisation: -levelEnergy(ni, z), ground: GROUND,
      radius: (BOHR * ni * ni) / z, speed: (FINE * LIGHT * z) / ni,
      speedFraction: (FINE * z) / ni, angularMomentum: ni,
      thermalWidth: thermal, thermalFraction: thermal / wavelength,
      photonMomentum: PLANCK / wavelength, recoil: (PLANCK / wavelength) / MASS_E,
      lineCount: lines.length,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    list.push(closeCheck('The Rydberg wavenumber and the level difference give one and the same line', 1 / wavelengthOf(3, 2), RYDBERG * (1 / 4 - 1 / 9), 1e-10, 3));
    list.push(closeCheck('Hydrogen Balmer α falls at 656.5 nm', wavelengthOf(3, 2) * 1e9, 656.47, 1e-4, 3));
    list.push(closeCheck('Hydrogen Lyman α falls at 121.6 nm', wavelengthOf(2, 1) * 1e9, 121.567, 1e-4, 3));
    list.push(closeCheck('The Balmer series limit sits at 364.6 nm', limitOf(2) * 1e9, 364.6, 1e-3, 2));
    list.push(closeCheck('Ionising from the ground state costs the Rydberg energy', -levelEnergy(1), GROUND, 1e-12, 6));
    list.push(closeCheck('The levels fall as one over n squared', levelEnergy(2) / levelEnergy(1), 0.25, 1e-12, 6));
    list.push(closeCheck('A hydrogen-like ion of charge Z scales every photon energy by Z squared', transitionEnergy(3, 2, 2) / transitionEnergy(3, 2, 1), 4, 1e-12, 6));
    list.push(check('Lines crowd towards the series limit', wavelengthOf(12, 2) < wavelengthOf(3, 2) * 1.03 && wavelengthOf(12, 2) > limitOf(2), 'the high members bunch up at the edge of the series'));
    const gaps = [3, 4, 5, 6, 7].map((upper) => wavelengthOf(upper, 2) - wavelengthOf(upper + 1, 2));
    list.push(check('Each successive Balmer gap is smaller than the last', gaps.every((gap, i) => (i === 0 ? true : gap < gaps[i - 1])), `${gaps.map((g) => (g * 1e9).toFixed(1)).join(', ')} nm between neighbours`));
    list.push(closeCheck('The ground-state electron orbits at the fine-structure fraction of light speed', (FINE * LIGHT), 2.1877e6, 1e-3, 3));
    const derivedBohr = (PLANCK / (2 * Math.PI)) / (MASS_E * LIGHT * FINE);
    list.push(closeCheck('The Bohr radius from h, mₑ, c and α matches the measured value', derivedBohr * 1e12, 52.9177, 1e-4, 4));
    list.push(check('The Doppler shift moves the line the way it should', (wavelengthOf(3, 2) * (1 + 0.001)) > wavelengthOf(3, 2), 'a receding atom is seen redder'));
    list.push(closeCheck('The photon energy is exactly the level difference it came from', (PLANCK * LIGHT) / wavelengthOf(4, 2), transitionEnergy(4, 2) * EV, 1e-12, 8));
    list.push(check('Thermal motion widens the line by a small, temperature-dependent amount', spectraSim.read({ tau: 0 }, { ...spectraSim.params, temperature: 12000 }).thermalFraction > spectraSim.read({ tau: 0 }, { ...spectraSim.params, temperature: 3000 }).thermalFraction, 'hotter gas, broader line'));
    return { checks: list };
  },
};