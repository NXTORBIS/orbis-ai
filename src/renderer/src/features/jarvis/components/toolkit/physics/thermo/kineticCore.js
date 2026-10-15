import { linspace, trapz, relErr, check, closeCheck } from '@jarvis/components/toolkit/physics/phys';

/**
 * Kinetic theory of gases. Everything here is computed from the Maxwell–Boltzmann speed
 * distribution by numerical integration — the mean speed, the mean square speed and the mean
 * kinetic energy all come from the same sampled curve, and are then compared with the
 * analytic results they must satisfy.
 */

const R = 8.314462618;
const KB = 1.380649e-23;
const NA = 6.02214076e23;

const GASES = [
  { value: 'H2', label: 'Hydrogen H₂', molar: 2.016, diameter: 0.289 },
  { value: 'He', label: 'Helium He', molar: 4.003, diameter: 0.26 },
  { value: 'N2', label: 'Nitrogen N₂', molar: 28.014, diameter: 0.37 },
  { value: 'O2', label: 'Oxygen O₂', molar: 31.998, diameter: 0.36 },
  { value: 'Ar', label: 'Argon Ar', molar: 39.948, diameter: 0.34 },
  { value: 'CO2', label: 'Carbon dioxide CO₂', molar: 44.01, diameter: 0.33 },
];

const gasOf = (p) => GASES.find((gas) => gas.value === p.gas);

/** Maxwell–Boltzmann speed distribution, normalised so that its integral over v is one. */
export const speedDistribution = (v, mass, temperature) => {
  const a = mass / (2 * KB * temperature);
  return 4 * Math.PI * Math.pow(a / Math.PI, 1.5) * v * v * Math.exp(-a * v * v);
};

/** A second, independent route to the same physics: sample molecular speeds and count them. */
export function sampleSpeeds(mass, temperature, count = 4000, seed = 12345) {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const speeds = [];
  for (let i = 0; i < count; i += 1) {
    const x = random();
    const y = random();
    const z = random();
    const gx = Math.sqrt(-2 * Math.log(Math.max(1e-12, x))) * Math.cos(2 * Math.PI * y);
    const gy = Math.sqrt(-2 * Math.log(Math.max(1e-12, x))) * Math.sin(2 * Math.PI * y);
    const gz = Math.sqrt(-2 * Math.log(Math.max(1e-12, z))) * Math.cos(2 * Math.PI * random());
    const sigma = Math.sqrt(KB * temperature / mass);
    speeds.push(Math.hypot(gx, gy, gz) * sigma);
  }
  return speeds;
}

export const kineticSim = {
  id: 'kinetic-theory',
  unit: 's',
  digits: 3,
  note: 'The Maxwell–Boltzmann speed distribution for a real gas, with the mean, most probable and rms speeds, the mean free path, the collision rate and the effusion rate. Every average is taken by integrating the drawn distribution, and the pressure is then rebuilt from that same integral as (1/3)ρ⟨v²⟩.',
  checkNote: 'The distribution is checked to be normalised, its integrals must return the analytic mean and rms speeds and the mean kinetic energy 3/2 kT, its maximum must sit at √(2RT/M), the ideal gas law must come back out of (1/3)ρ⟨v²⟩, and the mean free path must scale as the inverse square of the diameter and the inverse of the density.',
  params: { gas: 'N2', temperature: 300, pressure: 101.325, volume: 22.4 },
  fields: [
    { key: 'gas', label: 'Gas', options: GASES },
    { key: 'temperature', label: 'Temperature (K)', min: 20, max: 2000, step: 5 },
    { key: 'pressure', label: 'Pressure (kPa)', min: 1, max: 1000, step: 1 },
    { key: 'volume', label: 'Volume (L)', min: 0.1, max: 200, step: 0.1 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.1, resetOn: ['gas', 'temperature', 'pressure', 'volume'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const gas = gasOf(p);
    const mass = (gas.molar * 1e-3) / NA;
    const diameter = gas.diameter * 1e-9;
    const pressurePa = p.pressure * 1000;
    const volumeM3 = p.volume * 1e-3;
    const molecules = (pressurePa * volumeM3) / (KB * p.temperature);
    const density = molecules / volumeM3;

    const vp = Math.sqrt((2 * R * p.temperature) / (gas.molar * 1e-3));
    const vMean = Math.sqrt((8 * R * p.temperature) / (Math.PI * gas.molar * 1e-3));
    const vRms = Math.sqrt((3 * R * p.temperature) / (gas.molar * 1e-3));

    const vMax = vRms * 3.2;
    const samples = 400;
    const speeds = linspace(1, vMax, samples);
    const densityValues = speeds.map((v) => speedDistribution(v, mass, p.temperature));
    const curve = speeds.map((v, index) => ({ x: v / 1000, y: densityValues[index] * 1000 }));
    const normalisation = trapz(speeds, densityValues);
    const meanFromCurve = trapz(speeds, speeds.map((v, i) => v * densityValues[i]));
    const meanSquareFromCurve = trapz(speeds, speeds.map((v, i) => v * v * densityValues[i]));
    const energyFromCurve = 0.5 * mass * meanSquareFromCurve;
    let peakSpeed = speeds[0];
    for (let i = 1; i < samples; i += 1) if (densityValues[i] > densityValues[i - 1]) peakSpeed = speeds[i];

    const meanFreePath = 1 / (Math.SQRT2 * Math.PI * diameter * diameter * density);
    const collisionFrequency = vMean / meanFreePath;
    const collisionRateDensity = (1 / Math.SQRT2) * Math.PI * diameter * diameter * density * density * vMean;
    const effusionFlux = (density * vMean) / 4;
    const sampled = sampleSpeeds(mass, p.temperature, 3000);
    const sampledMean = sampled.reduce((sum, v) => sum + v, 0) / sampled.length;
    const sampledRms = Math.sqrt(sampled.reduce((sum, v) => sum + v * v, 0) / sampled.length);
    const pressureFromMolecules = (density * mass * meanSquareFromCurve) / 3;

    return {
      t: y.tau, gas: gas.value, mass, diameter, molecules, density,
      vp, vMean, vRms, vMax, curve, peakSpeed,
      normalisation, meanFromCurve, meanSquareFromCurve, energyFromCurve,
      meanFreePath, collisionFrequency, collisionRateDensity, effusionFlux,
      pressureFromMolecules, pressureError: relErr(pressureFromMolecules, pressurePa),
      sampledMean, sampledRms, pressureSet: p.pressure,
      meanFreePathInDiameters: meanFreePath / diameter,
      moleculesPerCubicMetre: density,
      rmsError: relErr(Math.sqrt(meanSquareFromCurve), vRms),
      meanError: relErr(meanFromCurve, vMean),
      peakError: relErr(peakSpeed, vp),
      energyError: relErr(energyFromCurve, 1.5 * KB * p.temperature),
      thermalSpeed: vMean,
      thermalWavelength: 6.62607015e-34 / (mass * vMean),
      degreesOfFreedom: 3,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...kineticSim.params };
    const nitrogen = gasOf(base);
    const mass = (nitrogen.molar * 1e-3) / NA;
    const reading = kineticSim.read({ tau: 0 }, base);

    list.push(closeCheck('The distribution integrates to one', reading.normalisation, 1, 1e-6, 6));
    list.push(closeCheck('The mean speed from the curve matches √(8RT/πM)', reading.meanFromCurve, reading.vMean, 1e-5, 4));
    list.push(closeCheck('The rms speed from the curve matches √(3RT/M)', Math.sqrt(reading.meanSquareFromCurve), reading.vRms, 1e-5, 4));
    list.push(closeCheck('The mean kinetic energy comes out as 3/2 kT', reading.energyFromCurve, 1.5 * KB * base.temperature, 1e-5, 4));
    list.push(closeCheck('The peak of the curve sits at √(2RT/M)', reading.peakSpeed, reading.vp, 4e-3, 4));
    list.push(closeCheck('The mean speed is √(8/3π) times the rms speed', reading.vMean / reading.vRms, Math.sqrt(8 / (3 * Math.PI)), 1e-12, 6));
    list.push(check('The three speeds are ordered v_p < v_mean < v_rms', reading.vp < reading.vMean && reading.vMean < reading.vRms, `${reading.vp.toFixed(1)} < ${reading.vMean.toFixed(1)} < ${reading.vRms.toFixed(1)} m/s`));

    list.push(closeCheck('The pressure rebuilt from (1/3)ρ⟨v²⟩ is the ideal gas pressure', reading.pressureFromMolecules, reading.pressureSet * 1000, 1e-5, 3));
    list.push(closeCheck('The ideal gas law gives the molecule count', reading.molecules, (base.pressure * 1000 * base.volume * 1e-3) / (KB * base.temperature), 1e-12, 4));

    const sampled = sampleSpeeds(mass, base.temperature, 20000, 99);
    const sampledMean = sampled.reduce((sum, v) => sum + v, 0) / sampled.length;
    list.push(closeCheck('Random molecular speeds drawn from the distribution agree with √(8RT/πM)', sampledMean, reading.vMean, 2e-2, 4));

    const hot = kineticSim.read({ tau: 0 }, { ...base, temperature: 1200 });
    list.push(closeCheck('Quadrupling the temperature doubles the rms speed', hot.vRms / reading.vRms, 2, 1e-12, 6));
    list.push(closeCheck('The mean free path halves when the density doubles', kineticSim.read({ tau: 0 }, { ...base, pressure: base.pressure * 2 }).meanFreePath, reading.meanFreePath / 2, 1e-12, 6));

    const wide = GASES.find((gas) => gas.value === 'CO2');
    list.push(check('A larger molecule has a shorter mean free path', kineticSim.read({ tau: 0 }, { ...base, gas: 'CO2' }).meanFreePath < reading.meanFreePath, `CO₂ (σ = ${wide.diameter} nm) against N₂ (σ = ${nitrogen.diameter} nm)`));

    const helium = kineticSim.read({ tau: 0 }, { ...base, gas: 'He' });
    list.push(closeCheck('Effusion follows Graham’s law: rate ∝ 1/√M', helium.effusionFlux / reading.effusionFlux, Math.sqrt(nitrogen.molar / gasOf({ gas: 'He' }).molar), 1e-9, 4));

    list.push(closeCheck('The collision frequency times the mean free path is the mean speed', reading.collisionFrequency * reading.meanFreePath, reading.vMean, 1e-12, 4));
    list.push(closeCheck('Light molecules move faster: H₂ against CO₂ at the same temperature', kineticSim.read({ tau: 0 }, { ...base, gas: 'H2' }).vRms / kineticSim.read({ tau: 0 }, { ...base, gas: 'CO2' }).vRms, Math.sqrt(gasOf({ gas: 'CO2' }).molar / gasOf({ gas: 'H2' }).molar), 1e-12, 6));
    list.push(check('At room temperature a nitrogen molecule collides billions of times a second', reading.collisionFrequency > 1e8, `${(reading.collisionFrequency / 1e9).toFixed(2)} × 10⁹ collisions per second`));
    list.push(check('The mean free path is many molecular diameters', reading.meanFreePathInDiameters > 50, `${reading.meanFreePathInDiameters.toFixed(0)} diameters at this pressure`));
    return { checks: list };
  },
};