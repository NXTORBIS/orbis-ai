const TAU = Math.PI * 2;

const cx = (r, x) => ({ r, x });
const cadd = (a, b) => cx(a.r + b.r, a.x + b.x);
const cmul = (a, b) => cx(a.r * b.r - a.x * b.x, a.r * b.x + a.x * b.r);
const cdiv = (a, b) => { const d = b.r * b.r + b.x * b.x; return cx((a.r * b.r + a.x * b.x) / d, (a.x * b.r - a.r * b.x) / d); };
const cabs = (a) => Math.hypot(a.r, a.x);

/** Series load impedance at the secondary, scaled by a current fraction. */
export function loadImpedance(p, factor = 1) {
  const ratio = p.n1 / p.n2;
  const secondary = p.voltage / ratio;
  const apparent = (p.loadKW * 1000) / Math.max(0.05, p.powerFactor);
  const magnitude = (secondary * secondary) / Math.max(1e-9, apparent) / Math.max(0.05, factor);
  const angle = Math.acos(Math.min(1, Math.max(-1, p.powerFactor)));
  return cx(magnitude * Math.cos(angle), magnitude * Math.sin(angle));
}

/** Steady-state equivalent circuit, everything referred to the primary. */
export function phasorSolution(p, loadFactor = 1) {
  const ratio = p.n1 / p.n2;
  const secondaryNominal = p.voltage / ratio;
  const zLoad = loadImpedance(p, loadFactor);
  const referred = cx(zLoad.r * ratio * ratio, zLoad.x * ratio * ratio);
  const series = cx(p.r1 + p.r2 * ratio * ratio + referred.r, p.x1 + p.x2 * ratio * ratio + referred.x);
  const secondaryCurrent = cdiv(cx(p.voltage, 0), series);
  const magnetising = cdiv(cmul(cx(p.rc, 0), cx(0, p.xm)), cadd(cx(p.rc, 0), cx(0, p.xm)));
  const noLoadCurrent = cdiv(cx(p.voltage, 0), magnetising);
  const primaryCurrent = cadd(noLoadCurrent, secondaryCurrent);
  const current2 = cabs(secondaryCurrent) * ratio;
  const voltage2 = cabs(cmul(secondaryCurrent, referred)) / ratio;
  const copper = cabs(primaryCurrent) ** 2 * p.r1 + current2 * current2 * p.r2;
  const iron = (p.voltage * p.voltage) / p.rc;
  const output = current2 * current2 * zLoad.r;
  const fluxPeak = (p.voltage * Math.SQRT2) / (TAU * p.frequency * p.n1);
  return {
    ratio, secondaryNominal, current1: cabs(primaryCurrent), current2, voltage2,
    noLoadCurrent: cabs(noLoadCurrent),
    copper, iron, output,
    losses: copper + iron,
    input: output + copper + iron,
    efficiency: output / Math.max(1e-9, output + copper + iron),
    regulation: (secondaryNominal - voltage2) / secondaryNominal,
    fluxPeak, coreArea: p.coreArea * 1e-4,
    fluxDensity: fluxPeak / (p.coreArea * 1e-4),
    currentRatio: cabs(primaryCurrent) / Math.max(1e-9, current2),
    loadFactor,
  };
}

/** Load fraction at which copper loss equals iron loss — the efficiency peak. */
export function maximumEfficiencyLoad(p) {
  const full = phasorSolution(p, 1);
  return Math.sqrt(full.iron / Math.max(1e-12, full.copper));
}

export function efficiencyCurve(p, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const factor = 0.1 + (i / steps) * 1.2;
    const solution = phasorSolution(p, factor);
    return { factor, efficiency: solution.efficiency, copper: solution.copper, iron: solution.iron };
  });
}

const MAGNETISING_SLOPE = 340;  // A/turn per Wb at the nominal flux

export const transformerSim = {
  id: 'transformer',
  unit: 's',
  digits: 3,
  note: 'The animation integrates the time-domain machine — flux from the applied voltage through a non-linear magnetising curve, and a series R–L secondary circuit — while the instrument panel solves the same transformer in phasor form, so the two can be compared. Lumped, isothermal, no hysteresis detail.',
  checkNote: 'Turns ratio, the E = 4.44·f·N·A flux law, the power balance, the current ratio, the maximum-efficiency condition, saturation, and the time-domain integration against the phasor solution.',
  params: {
    voltage: 230, frequency: 50, n1: 500, n2: 100, coreArea: 25,
    loadKW: 5, powerFactor: 0.85,
    r1: 0.15, x1: 0.3, r2: 0.01, x2: 0.02, rc: 1200, xm: 300,
  },
  fields: [
    { key: 'voltage', label: 'Primary voltage (V rms)', min: 0, max: 460, step: 5 },
    { key: 'frequency', label: 'Frequency (Hz)', min: 20, max: 60, step: 1 },
    { key: 'n1', label: 'Primary turns', min: 100, max: 2000, step: 10 },
    { key: 'n2', label: 'Secondary turns', min: 20, max: 800, step: 5 },
    { key: 'coreArea', label: 'Core area (cm²)', min: 5, max: 100, step: 1 },
    { key: 'loadKW', label: 'Load (kW)', min: 0.05, max: 40, step: 0.5 },
    { key: 'powerFactor', label: 'Load power factor', min: 0.5, max: 1, step: 0.01 },
    { key: 'r1', label: 'Primary resistance (Ω)', min: 0.02, max: 2, step: 0.01 },
    { key: 'x1', label: 'Primary leakage (Ω)', min: 0.02, max: 4, step: 0.02 },
    { key: 'r2', label: 'Secondary resistance (Ω)', min: 0.002, max: 0.5, step: 0.002 },
    { key: 'x2', label: 'Secondary leakage (Ω)', min: 0.002, max: 1, step: 0.002 },
    { key: 'rc', label: 'Core loss resistance (Ω)', min: 200, max: 8000, step: 50 },
    { key: 'xm', label: 'Magnetising reactance (Ω)', min: 50, max: 1500, step: 10 },
  ],
  options: { maxStep: 5e-6, sampleEvery: 0.02, resetOn: ['n1', 'n2'] },

  init: () => ({
    phi: 0, i2: 0, i1: 0, angle: 0, trace: [], record: 0,
    acc: { n: 0, v1: 0, i1: 0, i2: 0 }, measured: { v1: 0, i1: 0, i2: 0, phi: 0 }, t: 0,
    ledger: { input: 0, output: 0, copper: 0, iron: 0 },
  }),

  step(y, dt, p) {
    const ratio = p.n1 / p.n2;
    const omega = TAU * Math.max(1, p.frequency);
    const peak = p.voltage * Math.SQRT2;
    const saturationSlope = (0.35 * MAGNETISING_SLOPE) / Math.pow(p.coreArea * 1e-4 * 1.6, 2);
    const zLoad = loadImpedance(p, 1);
    const circuitInductance = Math.max(1e-6, (p.x2 + zLoad.x) / omega);
    const v1 = peak * Math.sin(y.angle);
    const magnetising = MAGNETISING_SLOPE * y.phi + saturationSlope * y.phi ** 3;
    const i1 = magnetising + y.i2 / ratio;
    const dPhi = (v1 - p.r1 * i1) / p.n1;
    const e2 = p.n2 * dPhi;
    const di2 = (e2 - (p.r2 + zLoad.r) * y.i2) / circuitInductance;
    y.phi += dPhi * dt;
    y.i2 += di2 * dt;
    y.i1 = i1;
    y.angle += omega * dt;
    if (y.angle > TAU) y.angle -= TAU;
    y.t += dt;

    // Short-window measurement of the running waveform for the live readouts.
    const window = 1 / (Math.max(1, p.frequency) * 20);
    y.acc.n += dt;
    y.acc.v1 += v1 * v1 * dt;
    y.acc.i1 += i1 * i1 * dt;
    y.acc.i2 += y.i2 * y.i2 * dt;
    if (y.acc.n >= window) {
      y.measured = { v1: Math.sqrt(y.acc.v1 / y.acc.n), i1: Math.sqrt(y.acc.i1 / y.acc.n), i2: Math.sqrt(y.acc.i2 / y.acc.n), phi: Math.abs(y.phi) };
      y.acc = { n: 0, v1: 0, i1: 0, i2: 0 };
    }
    y.record += dt;
    if (y.record >= 1 / (Math.max(1, p.frequency) * 40)) {
      y.record = 0;
      y.trace.push({ angle: (y.angle * 180) / Math.PI, v1, i1, i2: y.i2, phi: y.phi, flux: y.phi / (p.coreArea * 1e-4) });
      if (y.trace.length > 240) y.trace.shift();
    }
    y.ledger.input += v1 * i1 * dt;
    y.ledger.output += y.i2 * y.i2 * zLoad.r * dt;
    y.ledger.copper += (p.r1 * i1 * i1 + p.r2 * y.i2 * y.i2) * dt;
    y.ledger.iron += ((p.voltage * p.voltage) / p.rc) * dt;
    return y;
  },

  read(y, p) {
    const solution = phasorSolution(p, 1);
    return {
      ...solution,
      measured: y.measured,
      fluxDensityNow: y.phi / solution.coreArea,
      i1Now: y.i1,
      saturation: (solution.fluxDensity / 1.6) * 100,
      saturated: solution.fluxDensity > 1.6,
      trace: y.trace,
      ledger: y.ledger,
      angle: (y.angle * 180) / Math.PI,
      t: y.t,
    };
  },

  series: [
    { key: 'v2', label: 'Secondary voltage (V rms)', value: (r) => r.voltage2 },
    { key: 'i1', label: 'Primary current (A rms)', value: (r) => r.measured.i1 },
    { key: 'eff', label: 'Efficiency (%)', value: (r) => r.efficiency * 100 },
    { key: 'flux', label: 'Flux density (T)', value: (r) => r.fluxDensity },
  ],

  verify: verifyTransformer,
};

/** Integrate the time-domain model past its transient and measure steady-state RMS values. */
export function integrateWaveform(p, cycles = 12, dt = 2e-5) {
  const state = transformerSim.init(p);
  const total = cycles / Math.max(1, p.frequency);
  const period = 1 / Math.max(1, p.frequency);
  // Start from the steady-state flux so the inrush DC offset does not inflate the peak.
  state.phi = -(p.voltage * Math.SQRT2) / (TAU * Math.max(1, p.frequency) * p.n1);
  const zLoad = loadImpedance(p, 1);
  let n = 0, sumV = 0, sumI1 = 0, sumI2 = 0, flux = 0, input = 0, output = 0, copper = 0;
  for (let t = 0; t < total; t += dt) {
    transformerSim.step(state, dt, p);
    const v = p.voltage * Math.SQRT2 * Math.sin(state.angle);
    if (t >= period) {
      n += 1;
      sumV += v * v;
      sumI1 += state.i1 * state.i1;
      sumI2 += state.i2 * state.i2;
      input += v * state.i1 * dt;
      output += state.i2 * state.i2 * zLoad.r * dt;
      copper += (p.r1 * state.i1 * state.i1 + p.r2 * state.i2 * state.i2) * dt;
    }
    if (t >= total - period) flux = Math.max(flux, Math.abs(state.phi));
  }
  return {
    rms: n ? { v1: Math.sqrt(sumV / n), i1: Math.sqrt(sumI1 / n), i2: Math.sqrt(sumI2 / n) } : { v1: 0, i1: 0, i2: 0 },
    fluxPeak: flux, input, output, copper,
  };
}

function verifyTransformer() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const base = { ...transformerSim.params };
  const solution = phasorSolution(base);

  const noLoad = phasorSolution({ ...base, loadKW: 0.05 });
  push('Secondary voltage follows the turns ratio at no load', Math.abs(noLoad.voltage2 / base.voltage - base.n2 / base.n1) < 0.02, `${(noLoad.voltage2 / base.voltage).toFixed(5)} against n₂/n₁ = ${(base.n2 / base.n1).toFixed(5)}`);

  const analyticFlux = (base.voltage * Math.SQRT2) / (TAU * base.frequency * base.n1);
  push('Peak flux equals V·√2/(ω·N₁)', Math.abs(solution.fluxPeak - analyticFlux) < 1e-12, `${(solution.fluxPeak * 1000).toFixed(4)} mWb`);
  push('Flux density satisfies E = 4.44·f·N·A', Math.abs(solution.fluxDensity - base.voltage / ((TAU / Math.SQRT2) * base.frequency * base.n1 * base.coreArea * 1e-4)) < 1e-9, `${solution.fluxDensity.toFixed(3)} T with ${base.coreArea} cm² of core`);

  push('Power balance closes in the equivalent circuit', Math.abs(solution.output + solution.copper + solution.iron - solution.input) / solution.input < 1e-12, `${solution.input.toFixed(1)} W in, ${solution.output.toFixed(1)} W delivered, ${solution.losses.toFixed(1)} W lost`);
  push('Current ratio approaches the turns ratio at load', Math.abs(solution.currentRatio - base.n2 / base.n1) < 0.1, `I₁/I₂ = ${solution.currentRatio.toFixed(4)} against n₂/n₁ = ${(base.n2 / base.n1).toFixed(4)}`);

  const predicted = maximumEfficiencyLoad(base);
  let best = { factor: 0, efficiency: 0 };
  for (let i = 1; i <= 200; i += 1) {
    const factor = (i / 200) * 1.6;
    const candidate = phasorSolution(base, factor);
    if (candidate.efficiency > best.efficiency) best = { factor, efficiency: candidate.efficiency };
  }
  push('Efficiency peaks where copper loss equals iron loss', Math.abs(best.factor - predicted) < 0.04, `numeric maximum at ${(best.factor * 100).toFixed(0)}% load against √(iron/copper) = ${(predicted * 100).toFixed(0)}%`);

  const saturated = phasorSolution({ ...base, voltage: 460 });
  push('Saturation is flagged when the core is over-excited', saturated.fluxDensity > 1.6, `${saturated.fluxDensity.toFixed(2)} T at 460 V, above the 1.6 T knee`);

  const wave = integrateWaveform({ ...base, voltage: 120 }, 10);
  const reference = phasorSolution({ ...base, voltage: 120 });
  push('Time-domain integration agrees with the phasor solution', Math.abs(wave.rms.i1 - reference.current1) / reference.current1 < 0.15, `primary current ${wave.rms.i1.toFixed(3)} A measured against ${reference.current1.toFixed(3)} A from the equivalent circuit`);
  push('Time-domain flux amplitude matches the phasor flux', Math.abs(wave.fluxPeak - reference.fluxPeak) / reference.fluxPeak < 0.02, `${(wave.fluxPeak * 1000).toFixed(4)} vs ${(reference.fluxPeak * 1000).toFixed(4)} mWb`);
  push('Time-domain power balance closes', Math.abs(wave.output + wave.copper - wave.input) / Math.max(1e-9, wave.input) < 0.25, `${wave.input.toFixed(1)} W in, ${wave.output.toFixed(1)} W delivered, ${wave.copper.toFixed(1)} W in copper`);

  return { checks };
}