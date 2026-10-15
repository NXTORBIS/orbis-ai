import { check, closeCheck, linspace } from '@jarvis/components/toolkit/physics/phys';
const DEG = 180 / Math.PI;
export const reflectionAllowed = (h, k, l, lattice) => h + k + l > 0 && (lattice === 'sc' || (lattice === 'bcc' ? (h + k + l) % 2 === 0 : h % 2 === k % 2 && k % 2 === l % 2));
export const braggAngle = (a, wavelength, h, k, l) => { const q = h * h + k * k + l * l; const ratio = wavelength * Math.sqrt(q) / (2 * a); return q > 0 && ratio <= 1 ? 2 * Math.asin(ratio) * DEG : null; };
export const multiplicity = (h, k, l) => {
  const points = new Set();
  for (const triple of [[h, k, l], [h, l, k], [k, h, l], [k, l, h], [l, h, k], [l, k, h]]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) points.add(`${triple[0] * sx},${triple[1] * sy},${triple[2] * sz}`);
  return points.size;
};
export const powderPeaks = (p) => {
  const groups = new Map();
  for (let h = 0; h <= 7; h++) for (let k = 0; k <= h; k++) for (let l = 0; l <= k; l++) {
    if (!reflectionAllowed(h, k, l, p.lattice)) continue;
    const angle = braggAngle(p.a, p.wavelength, h, k, l);
    if (angle === null || angle < 10 || angle > 140) continue;
    const q = h * h + k * k + l * l, mult = multiplicity(h, k, l);
    if (groups.has(q)) { groups.get(q).multiplicity += mult; groups.get(q).families.push([h, k, l]); }
    else {
      const theta = angle / (2 * DEG), sizeWidth = 0.9 * p.wavelength / (p.size * 10 * Math.cos(theta)) * DEG, strainWidth = 4 * p.strain / 100 * Math.tan(theta) * DEG;
      groups.set(q, { h, k, l, families: [[h, k, l]], angle, d: p.a / Math.sqrt(q), multiplicity: mult, width: Math.hypot(sizeWidth, strainWidth, p.instrument) });
    }
  }
  return [...groups.values()].sort((a, b) => a.angle - b.angle);
};
export const crystalSim = {
  id: 'crystal-diffraction', unit: 'display s', static: true,
  params: { lattice: 'fcc', a: 3.6, wavelength: 1.5406, size: 40, strain: 0.1, instrument: 0.2, h: 1, k: 1, l: 1 },
  fields: [
    { key: 'lattice', label: 'Cubic lattice', options: [{ value: 'sc', label: 'Simple cubic' }, { value: 'bcc', label: 'Body-centred cubic' }, { value: 'fcc', label: 'Face-centred cubic' }] },
    { key: 'a', label: 'Lattice parameter a (Å)', min: 2, max: 6, step: 0.01, slider: true },
    { key: 'wavelength', label: 'X-ray wavelength (Å)', min: 0.7, max: 2, step: 0.0001, hint: 'Cu Kα ≈ 1.5406 Å' },
    { key: 'size', label: 'Crystallite size (nm)', min: 5, max: 150, step: 1 },
    { key: 'strain', label: 'Microstrain (%)', min: 0, max: 1, step: 0.01 },
    { key: 'instrument', label: 'Instrument FWHM (degrees)', min: 0.15, max: 2, step: 0.01 },
    { key: 'h', label: 'Miller index h', min: 0, max: 7, integer: true },
    { key: 'k', label: 'Miller index k', min: 0, max: 7, integer: true },
    { key: 'l', label: 'Miller index l', min: 0, max: 7, integer: true },
  ],
  options: { maxStep: 0.05, resetOn: ['lattice'] }, init: () => ({}), step: (s) => s, series: [],
  read: (s, p) => {
    const q = p.h ** 2 + p.k ** 2 + p.l ** 2, angle = braggAngle(p.a, p.wavelength, p.h, p.k, p.l);
    return { d: q ? p.a / Math.sqrt(q) : null, angle, allowed: reflectionAllowed(p.h, p.k, p.l, p.lattice), phase: (s.t ?? 0) % 1, atoms: p.lattice === 'sc' ? 1 : p.lattice === 'bcc' ? 2 : 4 };
  },
  analyse: (p) => {
    const peaks = powderPeaks(p);
    const xs = [...new Set([...linspace(10, 140, 1601), ...peaks.flatMap((peak) => [peak.angle - peak.width / 2, peak.angle, peak.angle + peak.width / 2])])].filter((x) => x >= 10 && x <= 140).sort((a, b) => a - b);
    const spectrum = xs.map((x) => ({ x, y: peaks.reduce((sum, peak) => { const delta = (x - peak.angle) / peak.width; return Math.abs(delta) > 4 ? sum : sum + peak.multiplicity / peak.width * Math.exp(-4 * Math.log(2) * delta * delta); }, 0) }));
    const max = Math.max(1e-12, ...spectrum.map((point) => point.y));
    return { peaks, spectrum: spectrum.map((point) => ({ x: point.x, y: point.y / max * 100 })) };
  },
  note: 'Kinematic powder diffraction for cubic monatomic lattices. Equal atomic form factors, multiplicity-weighted peaks, Gaussian broadening combining Scherrer size, microstrain and instrument width in quadrature. Intensities are illustrative, not a fitted experimental/material fingerprint; indices are bounded at 7.',
  checkNote: 'Bragg spacings/angles, systematic BCC/FCC absences, family multiplicities and Gaussian half-maximum widths.',
  verify: () => {
    const angle = braggAngle(3.6, 1.5406, 1, 1, 1), theta = angle / (2 * DEG);
    return { checks: [
      closeCheck('The (111) spacing is a/√3', 3.6 / Math.sqrt(3), 2.078460969082653, 1e-12),
      closeCheck('The Bragg angle reconstructs the X-ray wavelength', 2 * 3.6 / Math.sqrt(3) * Math.sin(theta), 1.5406, 1e-12),
      closeCheck('Cu Kα on a 3.6 Å (111) plane gives 2θ ≈ 43.51°', angle, 43.51, 0.001),
      check('BCC forbids (100) but permits (110)', !reflectionAllowed(1, 0, 0, 'bcc') && reflectionAllowed(1, 1, 0, 'bcc'), 'h+k+l must be even'),
      check('FCC forbids (110) but permits (111) and (200)', !reflectionAllowed(1, 1, 0, 'fcc') && reflectionAllowed(1, 1, 1, 'fcc') && reflectionAllowed(2, 0, 0, 'fcc'), 'all indices share parity'),
      closeCheck('The (100) family has six equivalent directions', multiplicity(1, 0, 0), 6, 1e-12),
      closeCheck('The (110) family has twelve equivalent directions', multiplicity(1, 1, 0), 12, 1e-12),
      closeCheck('The (111) family has eight equivalent directions', multiplicity(1, 1, 1), 8, 1e-12),
      check('Impossible Bragg angles return no reflection', braggAngle(2, 2, 7, 7, 7) === null, 'sin θ would exceed one'),
      closeCheck('A Gaussian is half its peak at half the FWHM', Math.exp(-4 * Math.log(2) * 0.5 ** 2), 0.5, 1e-12),
      check('Larger crystallites produce narrower reflections', powderPeaks({ ...crystalSim.params, size: 100 })[0].width < powderPeaks({ ...crystalSim.params, size: 10 })[0].width, 'Scherrer width ∝ 1/D'),
      check('The zero-index family is never a reflection', !reflectionAllowed(0, 0, 0, 'sc'), '(000) has no plane spacing'),
    ] };
  },
};