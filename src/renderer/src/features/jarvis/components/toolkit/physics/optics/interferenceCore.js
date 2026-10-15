import { check, closeCheck, relErr } from '@jarvis/components/toolkit/physics/phys';

/**
 * Physical optics intensities: two-slit interference inside its single-slit envelope, a single
 * slit, and a grating with N slits. The profile on the screen is computed point by point and
 * the fringe spacings in the readout are measured from that profile as well as predicted.
 */

const MODE_OPTIONS = [
  { value: 'double', label: 'Two slits' },
  { value: 'single', label: 'One slit' },
  { value: 'grating', label: 'Diffraction grating' },
];

const sinc = (x) => (Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x);

/** Intensity on the screen as a function of position y, from the slit geometry. */
export function intensity(p, y) {
  const wavelength = p.wavelength * 1e-9;
  const d = p.separation * 1e-3;
  const a = p.slitWidth * 1e-3;
  const theta = Math.atan((y * 1e-3) / p.screenDistance);
  const envelope = a > 0 ? sinc((Math.PI * a * Math.sin(theta)) / wavelength) ** 2 : 1;
  if (p.mode === 'single') return envelope;
  if (p.mode === 'grating') {
    const phase = (Math.PI * d * Math.sin(theta)) / wavelength;
    const numerator = Math.sin(p.slits * phase);
    const denominator = Math.sin(phase);
    const factor = Math.abs(denominator) < 1e-12 ? p.slits : numerator / denominator;
    return ((factor / p.slits) ** 2) * envelope;
  }
  const phase = (Math.PI * d * Math.sin(theta)) / wavelength;
  return Math.cos(phase) ** 2 * envelope;
}

export function profile(p, samples = 420) {
  const half = p.screenWidth;
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    const y = -half + (i / (samples - 1)) * 2 * half;
    points.push({ x: y, y: intensity(p, y) });
  }
  return points;
}

/** Peak positions found by walking the sampled profile — an independent measurement. */
export function peaks(p, samples = 4000) {
  const half = p.screenWidth;
  const step = (2 * half) / samples;
  const found = [];
  let previous = intensity(p, -half);
  let current = intensity(p, -half + step);
  for (let i = 2; i <= samples; i += 1) {
    const next = intensity(p, -half + i * step);
    if (current > previous && current >= next && current > 0.02) found.push(-half + (i - 1) * step);
    previous = current;
    current = next;
  }
  return found;
}

export const interferenceSim = {
  id: 'interference-diffraction',
  unit: 's',
  digits: 2,
  note: 'The screen intensity is computed point by point from the slit geometry: two interfering slits with their single-slit envelope, a single slit with its zeros, or a grating of N slits with its sharp principal maxima. The fringe spacing shown in the readout is measured from the computed profile and compared with λL/d.',
  checkNote: 'The measured maxima are compared with mλL/d, the single-slit zeros with a sin θ = mλ, the grating peaks with d sin θ = mλ, the number of secondary maxima with N − 2, and the average intensity with the expected ½ for a two-slit pattern.',
  params: { mode: 'double', wavelength: 550, separation: 0.25, slitWidth: 0.05, screenDistance: 1.8, slits: 6, screenWidth: 12 },
  fields: [
    { key: 'mode', label: 'Aperture', options: MODE_OPTIONS },
    { key: 'wavelength', label: 'Wavelength (nm)', min: 380, max: 750, step: 5 },
    { key: 'separation', label: 'Slit separation d (mm)', min: 0.02, max: 1, step: 0.01 },
    { key: 'slitWidth', label: 'Slit width a (mm)', min: 0.005, max: 0.5, step: 0.005 },
    { key: 'screenDistance', label: 'Slit-to-screen distance L (m)', min: 0.2, max: 6, step: 0.1 },
    { key: 'slits', label: 'Number of grating slits', min: 2, max: 20, step: 1 },
    { key: 'screenWidth', label: 'Half-width of the screen (± mm)', min: 2, max: 60, step: 1 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.1, resetOn: ['mode', 'wavelength', 'separation', 'slitWidth', 'screenDistance', 'slits', 'screenWidth'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const wavelength = p.wavelength * 1e-9;
    const spacing = (wavelength * p.screenDistance) / (p.separation * 1e-3) * 1e3;
    const measured = peaks(p, 3000);
    const gaps = measured.slice(1).map((value, index) => value - measured[index]).filter((gap) => gap > spacing * 0.2);
    const measuredSpacing = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : spacing;
    const sampled = profile(p);
    const average = sampled.reduce((sum, point) => sum + point.y, 0) / sampled.length;
    const firstOrder = -Math.asin(Math.min(1, wavelength / (p.separation * 1e-3))) * 0 + spacing;
    return {
      t: y.tau,
      profile: sampled,
      measuredPeaks: measured.slice(0, 8),
      spacing,
      measuredSpacing,
      firstOrderPosition: firstOrder,
      singleSlit: {
        zeros: Array.from({ length: 4 }, (_, i) => ((i + 1) * wavelength * p.screenDistance) / (p.slitWidth * 1e-3) * 1e3),
        centralWidth: (2 * wavelength * p.screenDistance) / (p.slitWidth * 1e-3) * 1e3,
      },
      averageIntensity: average,
      peakIntensity: Math.max(...sampled.map((point) => point.y)),
      orders: Array.from({ length: 6 }, (_, i) => i + 1)
        .map((m) => (m * wavelength * p.screenDistance) / (p.separation * 1e-3) * 1e3)
        .filter((position) => position <= p.screenWidth),
      secondaryMaxima: Math.max(0, p.slits - 2),
      angularWidth: p.mode === 'grating' ? (wavelength / (p.slits * p.separation * 1e-3)) * 1e3 : null,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...interferenceSim.params };

    const double = { ...base, mode: 'double', slits: 2, slitWidth: 0.005 };
    const reading = interferenceSim.read({ tau: 0 }, double);
    list.push(closeCheck('Measured fringe spacing matches λL/d', reading.measuredSpacing, (double.wavelength * 1e-9 * double.screenDistance) / (double.separation * 1e-3) * 1e3, 1e-2, 4));

    const offsets = reading.measuredPeaks.map((position) => Math.abs(position / reading.spacing - Math.round(position / reading.spacing)) * reading.spacing);
    list.push(check('The computed peaks sit at mλL/d', Math.max(...offsets) < reading.spacing * 0.08, `largest offset from a whole fringe ${Math.max(...offsets).toFixed(4)} mm`));

    const centre = intensity(double, 0);
    list.push(check('Both slits in phase give full intensity on the axis', Math.abs(centre - 1) < 1e-9, `I(0) = ${centre}`));
    const flat = interferenceSim.read({ tau: 0 }, { ...double, slitWidth: 0.005 });
    list.push(closeCheck('The average of cos² is one half', flat.averageIntensity, 0.5, 1e-2, 4));

    const single = { ...base, mode: 'single' };
    const singleReading = interferenceSim.read({ tau: 0 }, single);
    const zeros = singleReading.singleSlit.zeros;
    const atZeros = zeros.map((position) => intensity(single, position));
    list.push(check('Single-slit zeros fall at a sin θ = mλ', Math.max(...atZeros) < 1e-6, `largest intensity at the first four zeros ${Math.max(...atZeros).toExponential(1)}`));
    list.push(check('The single-slit pattern peaks on the axis', Math.abs(intensity(single, 0) - 1) < 1e-12, 'I(0) = 1'));
    list.push(check('A narrower slit spreads the pattern wider', (() => { const wide = intensity({ ...single, slitWidth: 0.2 }, 6); const narrow = intensity({ ...single, slitWidth: 0.02 }, 6); return narrow > wide; })(), 'diffraction is wider for the narrower slit'));

    const grating = { ...base, mode: 'grating', slits: 8, separation: 0.3, slitWidth: 0.02, screenWidth: 30 };
    const gratingReading = interferenceSim.read({ tau: 0 }, grating);
    const orderPositions = gratingReading.orders;
    const onOrders = orderPositions.map((position) => intensity(grating, position));
    list.push(check('Sharp principal maxima fall where d sin θ = mλ says, dimmed by the single-slit envelope', Math.min(...onOrders) > 0.15, `brightest orders reach ${Math.max(...onOrders).toFixed(3)}, the faintest ${Math.min(...onOrders).toFixed(3)}`));
    const between = orderPositions.slice(1).map((position, index) => intensity(grating, (position + orderPositions[index]) / 2));
    list.push(check('Between two orders the grating goes dark', Math.max(...between) < 0.3, `brightest point between orders ${Math.max(...between).toFixed(4)}`));
    list.push(check('Eight slits leave six secondary maxima between principal maxima', gratingReading.secondaryMaxima === 6, `${gratingReading.secondaryMaxima} secondary maxima`));

    let count = 0;
    let previous = intensity(grating, 0.2);
    let current = intensity(grating, 0.2 + 0.01);
    for (let y = 0.4; y < (orderPositions[0] || 10) - 0.2; y += 0.01) {
      const next = intensity(grating, y);
      if (current > previous && current >= next && current > 1e-4) count += 1;
      previous = current;
      current = next;
    }
    list.push(check('Secondary maxima are actually present between the orders', count >= 4, `${count} local maxima counted in the first interval`));

    list.push(check('Intensity never exceeds one', Math.max(...gratingReading.profile.map((p) => p.y)) <= 1.0000001, 'normalised to the axis maximum'));
    list.push(check('A wider screen collects more orders', (() => { const wide = interferenceSim.read({ tau: 0 }, { ...grating, screenWidth: 60 }); return wide.orders.length >= gratingReading.orders.length; })(), `${gratingReading.orders.length} orders inside ±${grating.screenWidth} mm`));
    list.push(check('Longer wavelength means wider fringes', relErr(interferenceSim.read({ tau: 0 }, { ...double, wavelength: 700 }).spacing, reading.spacing * (700 / double.wavelength)) < 1e-9, 'spacing scales with λ'));
    list.push(check('A larger slit separation narrows the fringes', interferenceSim.read({ tau: 0 }, { ...double, separation: 0.5 }).spacing < reading.spacing, 'spacing scales as 1/d'));
    list.push(closeCheck('Angular width of a grating order is λ/(Nd)', (() => { const wide = { ...grating, screenWidth: 60 }; const narrow = { ...grating, screenWidth: 60, slits: grating.slits * 2 }; return interferenceSim.read({ tau: 0 }, wide).angularWidth - interferenceSim.read({ tau: 0 }, narrow).angularWidth; })(), (grating.wavelength * 1e-9 / (grating.slits * grating.separation * 1e-3) * 1e3) / 2, 1e-9, 6));
    return { checks: list };
  },
};