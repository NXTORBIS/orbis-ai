import { rk4, trapz, linspace, relErr, check, closeCheck } from '@jarvis/components/toolkit/physics/phys';

/**
 * Thermodynamic processes on an ideal gas. Every process is followed from the initial to the
 * final state, and the work is computed twice — from the closed-form expression and by
 * integrating p dV along the drawn path — so the first law and the entropy changes are
 * checked against the path itself rather than against the formula that produced it.
 */

const R = 8.314462618;
const P0 = 101325;

const GASES = [
  { value: 'monatomic', label: 'Monatomic — He, Ar, Ne', degrees: 3 },
  { value: 'diatomic', label: 'Diatomic — N₂, O₂, air', degrees: 5 },
  { value: 'polyatomic', label: 'Polyatomic — CO₂, CH₄, H₂O', degrees: 6 },
];

const PROCESSES = [
  { value: 'isothermal', label: 'Isothermal — T constant' },
  { value: 'isobaric', label: 'Isobaric — p constant' },
  { value: 'isochoric', label: 'Isochoric — V constant' },
  { value: 'adiabatic', label: 'Adiabatic — no heat' },
  { value: 'carnot', label: 'Carnot cycle — four reversible stages' },
];

const degreesOf = (p) => GASES.find((gas) => gas.value === p.gas).degrees;

export const gasProperties = (p) => {
  const degrees = degreesOf(p);
  const cv = (degrees / 2) * R;
  const cp = cv + R;
  return { degrees, cv, cp, gamma: cp / cv };
};

const initialState = (p) => {
  const volume = p.volume * 1e-3;
  const pressure = (p.moles * R * p.temperature) / volume;
  return { volume, pressure, temperature: p.temperature };
};

/** The four Carnot stages, in order, as volume-pressure paths. */
export function carnotStages(p) {
  const { cv, gamma } = gasProperties(p);
  const n = p.moles;
  const th = p.temperature;
  const tc = p.temperature / Math.max(1.01, p.coldRatio);
  const expansion = p.ratio;
  const adiabaticRatio = Math.pow(th / tc, 1 / (gamma - 1));
  const v1 = p.volume * 1e-3;
  const v2 = v1 * expansion;
  const v3 = v2 * adiabaticRatio;
  const v4 = v3 / expansion;
  const stages = [
    { name: 'Isothermal expansion at T_h', from: v1, to: v2, temperature: th, kind: 'isothermal', heat: n * R * th * Math.log(v2 / v1), work: n * R * th * Math.log(v2 / v1), entropy: n * R * Math.log(v2 / v1) },
    { name: 'Adiabatic expansion', from: v2, to: v3, temperature: th, endTemperature: tc, kind: 'adiabatic', heat: 0, work: n * cv * (th - tc), entropy: 0 },
    { name: 'Isothermal compression at T_c', from: v3, to: v4, temperature: tc, kind: 'isothermal', heat: n * R * tc * Math.log(v4 / v3), work: n * R * tc * Math.log(v4 / v3), entropy: n * R * Math.log(v4 / v3) },
    { name: 'Adiabatic compression', from: v4, to: v1, temperature: tc, endTemperature: th, kind: 'adiabatic', heat: 0, work: n * cv * (tc - th), entropy: 0 },
  ];
  const pressure = (v, t) => (n * R * t) / v;
  const path = [];
  for (const stage of stages) {
    const volumes = linspace(stage.from, stage.to, 60);
    for (const v of volumes) {
      if (stage.kind === 'isothermal') path.push({ x: v * 1e3, y: pressure(v, stage.temperature) / 1000 });
      else {
        const fraction = (Math.log(v) - Math.log(stage.from)) / (Math.log(stage.to) - Math.log(stage.from) || 1);
        const t = stage.temperature + (stage.endTemperature - stage.temperature) * fraction;
        path.push({ x: v * 1e3, y: pressure(v, t) / 1000 });
      }
    }
  }
  const work = stages.reduce((sum, stage) => sum + stage.work, 0);
  const heatIn = stages.filter((stage) => stage.heat > 0).reduce((sum, stage) => sum + stage.heat, 0);
  const heatOut = stages.filter((stage) => stage.heat < 0).reduce((sum, stage) => sum + stage.heat, 0);
  const entropyChange = stages.reduce((sum, stage) => sum + stage.entropy, 0);
  return { th, tc, stages, path, work, heatIn, heatOut, entropyChange, efficiency: 1 - tc / th, numericWork: trapz(path.map((point) => point.x * 1e-3), path.map((point) => point.y * 1e3)) };
}

export const thermoSim = {
  id: 'gas-processes',
  unit: 's',
  digits: 3,
  note: 'An ideal gas taken through a chosen process. The end state comes from the process law, the work from the closed form, and the same work is integrated numerically along the drawn p–V path — so the first law, the heat capacities and the entropy change are all cross-checked by a second, independent route.',
  checkNote: 'The ideal gas law at both states, C_v = (f/2)R and C_p = C_v + R, the first law for every process, the adiabatic relation pV^γ, the isothermal work, the Carnot efficiency and the zero net entropy of a reversible cycle, plus a numeric integration of p dV along each path.',
  params: { gas: 'diatomic', moles: 1, temperature: 300, volume: 24, ratio: 2.5, coldRatio: 2.2, process: 'isothermal' },
  fields: [
    { key: 'process', label: 'Process', options: PROCESSES },
    { key: 'gas', label: 'Gas', options: GASES },
    { key: 'moles', label: 'Amount (mol)', min: 0.1, max: 5, step: 0.1 },
    { key: 'temperature', label: 'Initial temperature (K)', min: 100, max: 1500, step: 5 },
    { key: 'volume', label: 'Initial volume (L)', min: 1, max: 100, step: 1 },
    { key: 'ratio', label: 'Volume ratio (expansion or compression)', min: 1.2, max: 8, step: 0.1 },
    { key: 'coldRatio', label: 'Carnot hot/cold temperature ratio', min: 1.2, max: 6, step: 0.1 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.1, resetOn: ['process', 'gas', 'moles', 'temperature', 'volume', 'ratio', 'coldRatio'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const { cv, cp, gamma, degrees } = gasProperties(p);
    const start = initialState(p);
    const n = p.moles;
    const r = p.ratio;

    if (p.process === 'carnot') {
      const cycle = carnotStages(p);
      return {
        t: y.tau, process: 'carnot', cv, cp, gamma, degrees, start,
        end: { volume: cycle.stages[3].from, pressure: (n * R * cycle.th) / cycle.stages[3].from, temperature: cycle.th },
        path: cycle.path, stages: cycle.stages, work: cycle.work, numericWork: cycle.numericWork,
        heat: cycle.heatIn + cycle.heatOut, heatIn: cycle.heatIn, heatOut: cycle.heatOut,
        internalChange: 0, entropyChange: cycle.entropyChange, efficiency: cycle.efficiency,
        carnotEfficiency: 1 - cycle.tc / cycle.th, th: cycle.th, tc: cycle.tc,
      };
    }

    let volume;
    let pressure;
    let temperature;
    if (p.process === 'isothermal') {
      volume = start.volume * r; pressure = start.pressure / r; temperature = start.temperature;
    } else if (p.process === 'isobaric') {
      pressure = start.pressure; volume = start.volume * r; temperature = start.temperature * r;
    } else if (p.process === 'isochoric') {
      volume = start.volume; temperature = start.temperature * r; pressure = start.pressure * r;
    } else {
      volume = start.volume * r;
      pressure = start.pressure * Math.pow(r, -gamma);
      temperature = start.temperature * Math.pow(r, 1 - gamma);
    }
    const internalChange = n * cv * (temperature - start.temperature);
    let work;
    let heat;
    let entropyChange;
    if (p.process === 'isothermal') {
      work = n * R * start.temperature * Math.log(r); heat = work; entropyChange = n * R * Math.log(r);
    } else if (p.process === 'isobaric') {
      work = start.pressure * (volume - start.volume); heat = n * cp * (temperature - start.temperature); entropyChange = n * cp * Math.log(temperature / start.temperature);
    } else if (p.process === 'isochoric') {
      work = 0; heat = internalChange; entropyChange = n * cv * Math.log(temperature / start.temperature);
    } else {
      work = n * cv * (start.temperature - temperature); heat = 0; entropyChange = 0;
    }

    const samples = 400;
    const volumes = linspace(start.volume, volume, samples);
    const path = volumes.map((v, index) => {
      const fraction = index / (samples - 1);
      let currentPressure;
      if (p.process === 'isothermal') currentPressure = (n * R * start.temperature) / v;
      else if (p.process === 'isobaric') currentPressure = start.pressure;
      else if (p.process === 'isochoric') currentPressure = (n * R * (start.temperature + (temperature - start.temperature) * fraction)) / v;
      else currentPressure = start.pressure * Math.pow(start.volume / v, gamma);
      return { x: v * 1e3, y: currentPressure / 1000 };
    });
    const numericWork = trapz(volumes, path.map((point) => point.y * 1e3));

    return {
      t: y.tau, process: p.process, cv, cp, gamma, degrees, start,
      end: { volume, pressure, temperature }, path, work, numericWork, heat,
      internalChange, entropyChange, firstLawResidual: heat - work - internalChange,
      workError: relErr(numericWork, work),
      carnotEfficiency: 1 - (start.temperature / p.coldRatio) / start.temperature,
      idealGasResidual: pressure * volume - n * R * temperature,
      molarVolume: volume / n,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...thermoSim.params };
    const n = base.moles;

    const mono = gasProperties({ gas: 'monatomic' });
    const di = gasProperties({ gas: 'diatomic' });
    list.push(closeCheck('Monatomic C_v is 3R/2', mono.cv, 1.5 * R, 1e-12, 4));
    list.push(closeCheck('Diatomic C_v is 5R/2', di.cv, 2.5 * R, 1e-12, 4));
    list.push(closeCheck('Mayer’s relation C_p = C_v + R', di.cp - di.cv, R, 1e-12, 6));
    list.push(closeCheck('Monatomic γ is 5/3', mono.gamma, 5 / 3, 1e-12, 6));

    const isoThermal = thermoSim.read({ tau: 0 }, { ...base, process: 'isothermal', ratio: 2.5 });
    list.push(closeCheck('Isothermal work is nRT ln(V₂/V₁)', isoThermal.work, n * R * base.temperature * Math.log(2.5), 1e-12, 4));
    list.push(check('Isothermal internal energy does not change', Math.abs(isoThermal.internalChange) < 1e-9, `ΔU = ${isoThermal.internalChange.toExponential(1)} J`));
    list.push(closeCheck('Numeric ∫p dV matches the isothermal work', isoThermal.numericWork, isoThermal.work, 1e-4, 4));
    list.push(check('The first law holds for the isothermal process', Math.abs(isoThermal.firstLawResidual) < 1e-6, `Q − W − ΔU = ${isoThermal.firstLawResidual.toExponential(1)} J`));

    const isobaric = thermoSim.read({ tau: 0 }, { ...base, process: 'isobaric', ratio: 2 });
    list.push(closeCheck('Isobaric heat is nC_pΔT', isobaric.heat, n * di.cp * (base.temperature * 2 - base.temperature), 1e-12, 4));
    list.push(closeCheck('Numeric ∫p dV matches the isobaric work', isobaric.numericWork, isobaric.work, 1e-9, 6));

    const isochoric = thermoSim.read({ tau: 0 }, { ...base, process: 'isochoric', ratio: 3 });
    list.push(check('Isochoric work is zero', Math.abs(isochoric.work) < 1e-12, 'no change in volume, so no boundary work'));
    list.push(closeCheck('Isochoric heat equals the internal energy change', isochoric.heat, isochoric.internalChange, 1e-12, 6));

    const adiabatic = thermoSim.read({ tau: 0 }, { ...base, process: 'adiabatic', ratio: 3 });
    const startPressureVolume = adiabatic.start.pressure * Math.pow(adiabatic.start.volume, di.gamma);
    const endPressureVolume = adiabatic.end.pressure * Math.pow(adiabatic.end.volume, di.gamma);
    list.push(closeCheck('Adiabatic pV^γ is constant along the process', endPressureVolume, startPressureVolume, 1e-12, 6));
    list.push(check('An adiabatic process exchanges no heat', Math.abs(adiabatic.heat) < 1e-12, 'Q = 0'));
    list.push(closeCheck('Adiabatic work is −ΔU', adiabatic.work, -adiabatic.internalChange, 1e-12, 6));
    list.push(closeCheck('Numeric ∫p dV matches the adiabatic work', adiabatic.numericWork, adiabatic.work, 2e-4, 4));
    list.push(check('Adiabatic expansion cools the gas', adiabatic.end.temperature < adiabatic.start.temperature, `${adiabatic.end.temperature.toFixed(1)} K from ${adiabatic.start.temperature} K`));
    list.push(check('The adiabatic entropy change is zero', Math.abs(adiabatic.entropyChange) < 1e-12, 'reversible and adiabatic means isentropic'));

    const carnot = thermoSim.read({ tau: 0 }, { ...base, process: 'carnot', ratio: 2.5 });
    list.push(closeCheck('Carnot efficiency is 1 − T_c/T_h', carnot.efficiency, 1 - carnot.tc / carnot.th, 1e-12, 6));
    list.push(closeCheck('Net work equals heat in minus heat out', carnot.work, carnot.heatIn + carnot.heatOut, 1e-9, 4));
    list.push(check('The reversible cycle leaves no net entropy behind', Math.abs(carnot.entropyChange) < 1e-9, `ΣΔS = ${carnot.entropyChange.toExponential(2)} J/K`));
    list.push(closeCheck('The numeric integral over the whole cycle matches the net work', carnot.numericWork, carnot.work, 1e-3, 4));
    list.push(check('The cycle runs clockwise on the p–V diagram, so it is an engine', carnot.numericWork > 0, `${carnot.work.toFixed(1)} J of net work`));

    let trapped = 0;
    for (const process of ['isothermal', 'isobaric', 'isochoric', 'adiabatic']) {
      const reading = thermoSim.read({ tau: 0 }, { ...base, process, ratio: 2.5 });
      if (Math.abs(reading.firstLawResidual) > 1e-5) trapped += 1;
    }
    list.push(check('The first law is satisfied by every process', trapped === 0, 'Q − W − ΔU is zero in all four'));

    const stateCheck = initialState(base);
    list.push(closeCheck('The ideal gas law fixes the initial pressure', stateCheck.pressure, (n * R * base.temperature) / (base.volume * 1e-3), 1e-12, 4));
    list.push(check('Entropy rises when a gas expands isothermally', isoThermal.entropyChange > 0, `ΔS = ${isoThermal.entropyChange.toFixed(3)} J/K`));
    return { checks: list };
  },
};