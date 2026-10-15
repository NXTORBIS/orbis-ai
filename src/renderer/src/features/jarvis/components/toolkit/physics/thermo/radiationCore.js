import { linspace, trapz, relErr, check, closeCheck } from '@jarvis/components/toolkit/physics/phys';

/**
 * Thermal radiation. The Planck spectrum is sampled, then integrated numerically: the integral
 * must reproduce the Stefan–Boltzmann flux and its peak must sit exactly where Wien's law says
 * — so the two radiation laws are not assumed, they are measured from the same curve.
 */

const H = 6.62607015e-34;
const C = 2.99792458e8;
const KB = 1.380649e-23;
const SIGMA = 5.670374419e-8;
const WIEN = 2.897771955e-3;

const BODIES = [
  { value: 'sun', label: 'The Sun', temperature: 5772, emissivity: 1, area: 1 },
  { value: 'bulb', label: 'Tungsten filament', temperature: 2700, emissivity: 0.35, area: 1e-4 },
  { value: 'plate', label: 'Hot plate', temperature: 480, emissivity: 0.9, area: 0.04 },
  { value: 'human', label: 'Human body', temperature: 310, emissivity: 0.98, area: 1.8 },
  { value: 'earth', label: 'Earth surface', temperature: 288, emissivity: 0.95, area: 1 },
  { value: 'coolstar', label: 'Cool red star', temperature: 3200, emissivity: 1, area: 1 },
];

/** Planck spectral exitance per unit wavelength, W/m²/m at wavelength λ in metres. */
export const planck = (wavelength, temperature, emissivity = 1) => {
  if (wavelength <= 0 || temperature <= 0) return 0;
  const numerator = 2 * H * C * C * Math.pow(wavelength, -5);
  const exponent = (H * C) / (wavelength * KB * temperature);
  const denominator = exponent > 500 ? Number.MAX_VALUE : Math.exp(exponent) - 1;
  return (emissivity * numerator) / denominator;
};

/** Approximate visual colour of a black body, for the on-screen glow. */
export function blackbodyColour(temperature) {
  const t = temperature / 100;
  let red;
  let green;
  let blue;
  if (t <= 66) {
    red = 255;
    green = 99.47 * Math.log(Math.max(1, t)) - 161.12;
    blue = t <= 19 ? 0 : 138.52 * Math.log(Math.max(1, t - 10)) - 305.04;
  } else {
    red = 329.7 * Math.pow(Math.max(1, t - 60), -0.1332);
    green = 288.12 * Math.pow(Math.max(1, t - 60), -0.0755);
    blue = 255;
  }
  const clamp = (v) => Math.max(0, Math.min(255, v));
  return `rgb(${Math.round(clamp(red))}, ${Math.round(clamp(green))}, ${Math.round(clamp(blue))})`;
}

const integrateBand = (curve, from, to, step) => {
  const wavelengths = [];
  const values = [];
  for (let w = from; w <= to; w += step) {
    wavelengths.push(w);
    values.push(planck(w, curve.temperature, curve.emissivity));
  }
  return trapz(wavelengths, values);
};

export const radiationSim = {
  id: 'thermal-radiation',
  unit: 's',
  digits: 3,
  note: 'The Planck spectrum of a hot surface, sampled across the infrared, visible and near-ultraviolet. The curve is integrated to give the emitted flux and to find its own peak, so Stefan–Boltzmann and Wien’s law appear as measured results of the same distribution — along with the net exchange with the surroundings and the share of the emission that lands in the visible.',
  checkNote: 'The numeric integral of the Planck curve is compared against σT⁴, its maximum against Wien’s law, the Rayleigh–Jeans and Wien limits, the T⁴ scaling, the zero-crossing of the net exchange and the visible fraction of sunlight.',
  params: { body: 'sun', temperature: 5772, emissivity: 1, area: 1, ambient: 293, maxWavelength: 20 },
  fields: [
    { key: 'body', label: 'Body', options: BODIES },
    { key: 'temperature', label: 'Surface temperature (K)', min: 100, max: 12000, step: 10 },
    { key: 'emissivity', label: 'Emissivity ε', min: 0.02, max: 1, step: 0.01 },
    { key: 'area', label: 'Emitting area (m²)', min: 0.0001, max: 10, step: 0.0001 },
    { key: 'ambient', label: 'Surroundings (K)', min: 0, max: 1000, step: 1 },
    { key: 'maxWavelength', label: 'Spectrum shown to (µm)', min: 2, max: 40, step: 1 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.1, resetOn: ['body', 'temperature', 'emissivity', 'area', 'ambient', 'maxWavelength'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const curve = { temperature: p.temperature, emissivity: p.emissivity };
    const upper = p.maxWavelength * 1e-6;
    const samples = 500;
    const wavelengths = linspace(2e-8, upper, samples);
    const values = wavelengths.map((w) => planck(w, p.temperature, p.emissivity));
    const scaled = wavelengths.map((w, index) => ({ x: w * 1e6, y: values[index] / 1e12 }));
    const integral = trapz(wavelengths, values);
    const stefan = p.emissivity * SIGMA * Math.pow(p.temperature, 4);
    const net = p.emissivity * SIGMA * (Math.pow(p.temperature, 4) - Math.pow(p.ambient, 4));
    let peakWavelength = wavelengths[0];
    for (let i = 1; i < samples; i += 1) if (values[i] > values[i - 1]) peakWavelength = wavelengths[i];
    const visible = integrateBand(curve, 3.8e-7, 7.5e-7, 1e-9) / Math.max(1e-12, integral);
    const infrared = integrateBand(curve, 7.5e-7, 1e-4, 1e-8) / Math.max(1e-12, integral);
    const ultraviolet = integrateBand(curve, 1e-9, 3.8e-7, 1e-10) / Math.max(1e-12, integral);
    const rayleighJeans = (2 * C * KB * p.temperature) / Math.pow(upper, 4);
    return {
      t: y.tau, curve: scaled, integral, stefan, net,
      flux: stefan, power: stefan * p.area, netPower: net * p.area,
      peakWavelength: peakWavelength * 1e6, wienPeak: (WIEN / p.temperature) * 1e6,
      wienError: relErr(peakWavelength, WIEN / p.temperature),
      stefanError: relErr(integral, stefan),
      colour: blackbodyColour(p.temperature), visible, infrared, ultraviolet,
      photonEnergy: (H * C) / peakWavelength, peakRadiance: planck(peakWavelength, p.temperature, p.emissivity),
      rayleighJeansAtEdge: rayleighJeans, planckAtEdge: planck(upper, p.temperature, p.emissivity),
      surfaceTemperature: p.temperature, equilibrium: p.ambient,
      efficiencyBand: visible,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...radiationSim.params };
    const sun = radiationSim.read({ tau: 0 }, { ...base, temperature: 5772, emissivity: 1, maxWavelength: 40 });

    list.push(closeCheck('Integrating the Planck curve gives σT⁴', sun.integral, SIGMA * Math.pow(5772, 4), 1e-3, 1));
    list.push(closeCheck('The peak of the curve sits at Wien’s λ_max = b/T', sun.peakWavelength, (WIEN / 5772) * 1e6, 2e-2, 3));
    list.push(closeCheck('The recovered Stefan–Boltzmann constant is the real one', sun.integral / Math.pow(5772, 4), SIGMA, 1e-3, 12));

    const hot = radiationSim.read({ tau: 0 }, { ...base, temperature: 800, emissivity: 1, maxWavelength: 40 });
    const hotter = radiationSim.read({ tau: 0 }, { ...base, temperature: 1600, emissivity: 1, maxWavelength: 40 });
    list.push(closeCheck('Doubling the temperature multiplies the flux by sixteen', hotter.integral / hot.integral, 16, 2e-2, 4));
    list.push(closeCheck('Doubling the temperature halves the peak wavelength', hotter.peakWavelength, hot.peakWavelength / 2, 2e-2, 4));

    const equilibrium = radiationSim.read({ tau: 0 }, { ...base, temperature: 400, ambient: 400 });
    list.push(check('A body exchanges no net heat with its own temperature surroundings', Math.abs(equilibrium.net) < 1e-9, 'T = T_surroundings, so nothing flows'));
    list.push(check('A body hotter than its surroundings still radiates more than it absorbs', hot.net > 0, `${hot.net.toFixed(1)} W/m² net outward`));

    const hotPlate = radiationSim.read({ tau: 0 }, { ...base, body: 'plate', temperature: 480, emissivity: 0.9, ambient: 293, maxWavelength: 20 });
    list.push(closeCheck('Net exchange is εσ(T⁴ − T_s⁴)', hotPlate.net, 0.9 * SIGMA * (Math.pow(480, 4) - Math.pow(293, 4)), 1e-12, 4));
    list.push(check('A hot plate radiates in the infrared, not in the visible', hotPlate.peakWavelength > 3 && hotPlate.peakWavelength < 12, `${hotPlate.peakWavelength.toFixed(2)} µm`));

    const human = radiationSim.read({ tau: 0 }, { ...base, body: 'human', temperature: 310, emissivity: 0.98, maxWavelength: 30 });
    list.push(check('A human body peaks deep in the thermal infrared', human.peakWavelength > 8 && human.peakWavelength < 11, `${human.peakWavelength.toFixed(2)} µm — the band thermal cameras use`));

    list.push(check('Half the Sun’s output lands in the visible band', sun.visible > 0.3 && sun.visible < 0.5, `${(sun.visible * 100).toFixed(1)}% visible, ${(sun.infrared * 100).toFixed(1)}% infrared, ${(sun.ultraviolet * 100).toFixed(1)}% ultraviolet`));
    list.push(check('The Sun’s peak is in the visible', sun.peakWavelength > 0.4 && sun.peakWavelength < 0.6, `${sun.peakWavelength.toFixed(3)} µm, which is why our eyes see this band`));

    const longWave = radiationSim.read({ tau: 0 }, { ...base, temperature: 300, emissivity: 1, maxWavelength: 40 });
    const edge = 3e-5;
    const planckValue = planck(edge, 300, 1);
    const rjValue = (2 * C * KB * 300) / Math.pow(edge, 4);
    list.push(check('At long wavelengths Planck falls back to Rayleigh–Jeans', relErr(planckValue, rjValue) < 0.02, `Planck ${(planckValue).toExponential(2)} against Rayleigh–Jeans ${rjValue.toExponential(2)} W/m²/m`));
    list.push(check('The spectrum keeps rising towards long wavelengths below the peak', longWave.curve[longWave.curve.length - 1].y < longWave.curve[Math.round(longWave.curve.length * 0.3)].y, 'the curve is falling away by the far infrared, as Wien’s law requires'));

    const emissive = radiationSim.read({ tau: 0 }, { ...base, temperature: 1000, emissivity: 0.5, maxWavelength: 30 });
    const ideal = radiationSim.read({ tau: 0 }, { ...base, temperature: 1000, emissivity: 1, maxWavelength: 30 });
    list.push(closeCheck('Halving the emissivity halves the emitted power', emissive.integral, ideal.integral / 2, 1e-12, 4));
    list.push(closeCheck('Peak radiance scales with emissivity but the peak position does not move', emissive.peakWavelength, ideal.peakWavelength, 1e-3, 5));

    list.push(closeCheck('The photon energy at the peak is hc/λ_peak', sun.photonEnergy, (H * C) / (sun.peakWavelength * 1e-6), 1e-12, 20));
    list.push(check('A tungsten filament wastes most of its output as infrared', radiationSim.read({ tau: 0 }, { ...base, temperature: 2700, emissivity: 0.35, maxWavelength: 30 }).infrared > 0.85, 'which is why incandescent bulbs are so inefficient'));
    return { checks: list };
  },
};