import { check, closeCheck, linspace } from '@jarvis/components/toolkit/physics/phys';
const G = 9.80665;
export const frictionFactor = (re, roughRatio) => {
  if (re <= 0) return 0;
  if (re < 2300) return 64 / re;
  let lo = 0.005, hi = 0.3;
  for (let i = 0; i < 60; i++) { const f = (lo + hi) / 2; const residual = 1 / Math.sqrt(f) + 2 * Math.log10(roughRatio / 3.7 + 2.51 / (re * Math.sqrt(f))); if (residual > 0) lo = f; else hi = f; }
  const turbulent = (lo + hi) / 2;
  return re < 4000 ? 64 / re + (turbulent - 64 / re) * (re - 2300) / 1700 : turbulent;
};
export const pipeState = (p, flow = p.flow) => {
  const q = flow * 1e-3, diameter = p.diameter * 0.01, velocity = q / (Math.PI * diameter ** 2 / 4);
  const re = p.density * velocity * diameter / (p.viscosity * 1e-3), f = frictionFactor(re, p.roughness * 1e-3 / diameter);
  const pressure = (f * p.length / diameter + p.minor) * p.density * velocity ** 2 / 2;
  return { q, velocity, re, f, pressure, pumpPower: pressure * q / (p.efficiency / 100), regime: re < 2300 ? 'Laminar' : re < 4000 ? 'Transition (blended estimate)' : 'Turbulent' };
};
export const tankDrain = (height, tankArea, holeArea, cd, time) => {
  const emptyTime = tankArea / (cd * holeArea) * Math.sqrt(2 * height / G);
  const level = height * Math.max(0, 1 - time / emptyTime) ** 2;
  return { emptyTime, height: level, flow: cd * holeArea * Math.sqrt(2 * G * level), velocity: Math.sqrt(2 * G * level) };
};
export const fluidSim = {
  id: 'fluid-dynamics-lab', unit: 'display s',
  endTime: (p) => p.mode === 'tank' ? 20 : undefined,
  params: { mode: 'venturi', flow: 1, diameter: 5, throat: 2.5, density: 1000, inlet: 200, elevation: 0, viscosity: 1, length: 10, roughness: 0.045, minor: 1, efficiency: 80, tankDiameter: 1, height: 2, hole: 10, cd: 0.62 },
  fields: [
    { key: 'mode', label: 'Experiment', options: [{ value: 'venturi', label: 'Venturi & Bernoulli balance' }, { value: 'pipe', label: 'Viscous pipe & pump sizing' }, { value: 'tank', label: 'Tank draining through an orifice' }] },
    { key: 'flow', label: 'Volume flow (L/s)', min: 0.001, max: 20, step: 0.001, slider: true, when: { mode: ['venturi', 'pipe'] } },
    { key: 'diameter', label: 'Inlet / pipe diameter (cm)', min: 1, max: 30, step: 0.1, when: { mode: ['venturi', 'pipe'] } },
    { key: 'throat', label: 'Throat diameter (cm)', min: 0.5, max: 30, step: 0.1, when: { mode: ['venturi'] } },
    { key: 'density', label: 'Fluid density (kg/m³)', min: 100, max: 2000, step: 10 },
    { key: 'inlet', label: 'Inlet absolute pressure (kPa)', min: 10, max: 2000, step: 1, when: { mode: ['venturi'] } },
    { key: 'elevation', label: 'Outlet height minus inlet (m)', min: -10, max: 10, step: 0.1, when: { mode: ['venturi'] } },
    { key: 'viscosity', label: 'Dynamic viscosity (mPa·s)', min: 0.1, max: 1000, step: 0.1, when: { mode: ['pipe'] } },
    { key: 'length', label: 'Pipe length (m)', min: 0.1, max: 500, step: 0.1, when: { mode: ['pipe'] } },
    { key: 'roughness', label: 'Absolute roughness (mm)', min: 0, max: 1, step: 0.005, when: { mode: ['pipe'] } },
    { key: 'minor', label: 'Minor-loss coefficient K', min: 0, max: 100, step: 0.1, when: { mode: ['pipe'] } },
    { key: 'efficiency', label: 'Pump efficiency (%)', min: 10, max: 100, step: 1, when: { mode: ['pipe'] } },
    { key: 'tankDiameter', label: 'Tank diameter (m)', min: 0.2, max: 5, step: 0.05, when: { mode: ['tank'] } },
    { key: 'height', label: 'Initial water depth (m)', min: 0.1, max: 10, step: 0.1, when: { mode: ['tank'] } },
    { key: 'hole', label: 'Orifice diameter (mm)', min: 1, max: 100, step: 1, when: { mode: ['tank'] } },
    { key: 'cd', label: 'Discharge coefficient Cd', min: 0.1, max: 1, step: 0.01, when: { mode: ['tank'] } },
  ],
  options: { maxStep: 0.05, resetOn: ['mode', 'height', 'hole', 'tankDiameter', 'cd'] }, init: () => ({}), step: (s) => s, series: [],
  read: (s, p) => {
    const pipe = pipeState(p), area2 = Math.PI * (p.throat * 0.01) ** 2 / 4;
    const v2 = pipe.q / area2, pressure2 = p.inlet * 1000 + p.density * (pipe.velocity ** 2 - v2 ** 2) / 2 - p.density * G * p.elevation;
    const tankArea = Math.PI * p.tankDiameter ** 2 / 4, holeArea = Math.PI * (p.hole * 0.001) ** 2 / 4;
    const initial = tankDrain(p.height, tankArea, holeArea, p.cd, 0), time = Math.min(1, (s.t ?? 0) / 20) * initial.emptyTime;
    const tank = tankDrain(p.height, tankArea, holeArea, p.cd, time);
    return { ...pipe, v2, pressure2, head: pipe.pressure / (p.density * G), tank, tankTime: time, phase: (s.t ?? 0) % 1, tankMass: tank.height * tankArea * p.density };
  },
  analyse: (p) => {
    const r = fluidSim.read({}, p);
    if (p.mode === 'tank') return { curves: [{ label: 'Liquid height (m)', points: linspace(0, r.tank.emptyTime, 121).map((x) => ({ x, y: p.height * (1 - x / r.tank.emptyTime) ** 2 })) }], xLabel: 'Physical time (s)', yLabel: 'Liquid height (m)' };
    if (p.mode === 'pipe') return { curves: [{ label: 'Pressure loss (kPa)', points: linspace(0.001, Math.max(1, p.flow * 1.5), 121).map((x) => ({ x, y: pipeState(p, x).pressure / 1000 })) }], xLabel: 'Flow (L/s)', yLabel: 'Pressure loss (kPa)' };
    return { curves: [{ label: 'Static pressure (kPa)', points: linspace(0, 1, 121).map((x) => { const d = p.diameter + (p.throat - p.diameter) * (1 - Math.cos(Math.PI * x)) / 2, v = r.q / (Math.PI * (d * 0.01) ** 2 / 4); return { x, y: p.inlet + p.density * (r.velocity ** 2 - v ** 2) / 2000 - p.density * G * p.elevation * x / 1000 }; }) }], xLabel: 'Distance through contraction (normalised)', yLabel: 'Absolute pressure (kPa)' };
  },
  note: 'Steady incompressible flow: lossless Bernoulli for the Venturi, Darcy–Weisbach with Colebrook turbulent friction for pipes, and quasi-steady Torricelli tank drainage. Transitional friction is explicitly a blended estimate. Tank animation compresses the physical emptying time into 20 display seconds.',
  checkNote: 'Continuity, total-head conservation, the Colebrook residual, laminar Hagen–Poiseuille pressure drop, pump energy and the numerical tank volume derivative.',
  verify: () => {
    const p = { ...fluidSim.params, minor: 0 }, r = fluidSim.read({}, p), f = frictionFactor(1e5, 0.001);
    const lam = pipeState({ ...p, viscosity: 100, length: 10 }, 0.01);
    const a = Math.PI / 4, hole = Math.PI * 0.01 ** 2 / 4, tank = tankDrain(2, a, hole, 0.62, 100), h = 0.01;
    return { checks: [
      closeCheck('Area times speed gives the same flow in the throat', Math.PI * (p.throat * 0.01) ** 2 / 4 * r.v2, r.q, 1e-12),
      closeCheck('Halving diameter multiplies velocity by four', r.v2 / r.velocity, 4, 1e-12),
      closeCheck('Bernoulli total head is conserved', r.pressure2 + p.density * r.v2 ** 2 / 2, p.inlet * 1000 + p.density * r.velocity ** 2 / 2, 1e-12),
      closeCheck('Laminar friction is 64/Re', frictionFactor(1000, 0), 0.064, 1e-12),
      check('Colebrook implicit residual is below 1e−10', Math.abs(1 / Math.sqrt(f) + 2 * Math.log10(0.001 / 3.7 + 2.51 / (1e5 * Math.sqrt(f)))) < 1e-10, `f = ${f.toFixed(6)}`),
      closeCheck('Laminar pipe loss agrees with Hagen–Poiseuille', lam.pressure, 128 * 0.1 * 10 * lam.q / (Math.PI * 0.05 ** 4), 1e-12),
      closeCheck('Input pump power times efficiency equals hydraulic power', r.pumpPower * p.efficiency / 100, r.q * r.pressure, 1e-12),
      closeCheck('Torricelli exit velocity is √(2gh)', tank.velocity, Math.sqrt(2 * G * tank.height), 1e-12),
      closeCheck('The numerical loss of tank volume equals outflow', -a * (tankDrain(2, a, hole, 0.62, 100 + h).height - tankDrain(2, a, hole, 0.62, 100 - h).height) / (2 * h), tank.flow, 1e-7),
      check('The tank is empty at the predicted time', tankDrain(2, a, hole, 0.62, tank.emptyTime).height === 0, 'height = 0'),
      closeCheck('Halfway through draining the depth is one quarter', tankDrain(2, a, hole, 0.62, tank.emptyTime / 2).height, 0.5, 1e-12),
    ] };
  },
};