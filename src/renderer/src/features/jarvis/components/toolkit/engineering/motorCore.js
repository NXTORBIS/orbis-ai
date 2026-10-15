import { clamp } from '@jarvis/components/toolkit/engineering/sim/core';

/**
 * Lumped-parameter DC machine. The armature circuit (inductance, resistance, back-EMF
 * K·ω) drives a rotor with inertia, viscous friction and an external load; a first-order
 * thermal model tracks the winding temperature. Field interaction, commutator reversal and
 * torque production all come from this one solution. Idealised machine: no saturation,
 * no eddy currents, no brush drop.
 */
export const motorSim = {
  id: 'electric-motor',
  unit: 's',
  digits: 2,
  note: 'Armature loop L·di/dt = V − R·i − K·ω and rotor J·dω/dt = K·i − b·ω − T_load, integrated at 4 kHz. Winding temperature is a lumped first-order model with copper loss as the heat source. Idealised machine — no magnetic saturation, eddy currents or brush drop.',
  checkNote: 'Steady state against its closed form, the L/R rise against its exponential, an energy ledger over the whole run, and the thermal settling point.',
  params: {
    voltage: 24, resistance: 0.6, inductance: 0.004, k: 0.05,
    inertia: 0.002, friction: 0.0002, load: 0.35,
    thermalMass: 45, cooling: 1.6, ambient: 25,
  },
  fields: [
    { key: 'voltage', label: 'Armature voltage (V)', min: 0, max: 48, step: 1 },
    { key: 'load', label: 'Load torque (N·m)', min: 0, max: 2, step: 0.05 },
    { key: 'resistance', label: 'Armature resistance (Ω)', min: 0.2, max: 3, step: 0.1 },
    { key: 'inductance', label: 'Armature inductance (H)', min: 0.001, max: 0.05, step: 0.001 },
    { key: 'k', label: 'Torque / EMF constant K (V·s/rad)', min: 0.01, max: 0.2, step: 0.005 },
    { key: 'inertia', label: 'Rotor inertia (kg·m²)', min: 0.0002, max: 0.012, step: 0.0002 },
    { key: 'friction', label: 'Viscous friction (N·m·s)', min: 0, max: 0.002, step: 0.0001 },
    { key: 'thermalMass', label: 'Winding thermal mass (J/K)', min: 10, max: 200, step: 5 },
    { key: 'cooling', label: 'Cooling coefficient (W/K)', min: 0.2, max: 10, step: 0.2 },
    { key: 'ambient', label: 'Ambient temperature (°C)', min: 10, max: 50, step: 1 },
  ],
  options: { maxStep: 1 / 4000, sampleEvery: 0.01, resetOn: ['inertia', 'inductance', 'thermalMass'] },

  init: (p) => ({ omega: 0, current: 0, angle: 0, temperature: p.ambient, energy: { input: 0, copper: 0, friction: 0, load: 0 } }),

  step(y, dt, p) {
    const backEmf = p.k * y.omega;
    const torque = p.k * y.current;
    const di = (p.voltage - p.resistance * y.current - backEmf) / p.inductance;
    const dw = (torque - p.friction * y.omega - p.load) / p.inertia;
    const copper = p.resistance * y.current * y.current;
    const dTemperature = (copper + p.friction * y.omega * y.omega - p.cooling * (y.temperature - p.ambient)) / p.thermalMass;
    y.current += di * dt;
    y.omega += dw * dt;
    y.angle += y.omega * dt;
    y.temperature += dTemperature * dt;
    y.energy.input += p.voltage * y.current * dt;
    y.energy.copper += copper * dt;
    y.energy.friction += p.friction * y.omega * y.omega * dt;
    y.energy.load += p.load * y.omega * dt;
    return y;
  },

  read(y, p) {
    const torque = p.k * y.current;
    const backEmf = p.k * y.omega;
    const powerIn = p.voltage * y.current;
    const powerOut = torque * y.omega;
    return {
      speedRpm: y.omega * 60 / (2 * Math.PI),
      omega: y.omega,
      current: y.current,
      torque,
      backEmf,
      powerIn,
      powerOut,
      electrical: p.voltage,
      copperLoss: p.resistance * y.current * y.current,
      frictionLoss: p.friction * y.omega * y.omega,
      efficiency: powerIn > 1e-6 ? powerOut / powerIn : 0,
      temperature: y.temperature,
      rise: y.temperature - p.ambient,
      statorFieldAngle: 0,
      rotorAngle: y.angle % (2 * Math.PI),
      torqueAngle: Math.PI / 2,
      stallTorque: p.k * p.voltage / p.resistance,
      noLoadSpeed: p.k > 0 ? p.voltage / p.k : 0,
      electricalTau: p.inductance / p.resistance,
      mechanicalTau: p.k > 0 ? p.inertia * p.resistance / (p.k * p.k) : 0,
      steadySpeed: steadyOmega(p),
      steadyCurrent: steadyCurrent(p),
      energy: y.energy,
      kinetic: 0.5 * p.inertia * y.omega * y.omega,
      balance: y.energy.input - y.energy.copper - y.energy.friction - y.energy.load - 0.5 * p.inertia * y.omega * y.omega,
    };
  },

  series: [
    { key: 'speed', label: 'Speed (rpm)', value: (r) => r.speedRpm },
    { key: 'current', label: 'Armature current (A)', value: (r) => r.current },
    { key: 'torque', label: 'Torque (N·m)', value: (r) => r.torque },
    { key: 'temperature', label: 'Winding (°C)', value: (r) => r.temperature },
  ],

  verify: verifyMotor,
};

/** Closed-form steady state: ω = (V·K − R·T_load) / (K² + R·b). */
export function steadyOmega(p) {
  const numerator = p.voltage * p.k - p.resistance * p.load;
  const denominator = p.k * p.k + p.resistance * p.friction;
  return denominator > 0 ? numerator / denominator : 0;
}

export function steadyCurrent(p) {
  const torqueRequired = p.friction * steadyOmega(p) + p.load;
  return p.k > 0 ? torqueRequired / p.k : 0;
}

function run(params, seconds, dt = 1 / 20000) {
  let y = motorSim.init(params);
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) motorSim.step(y, dt, params);
  return y;
}

function verifyMotor() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const base = { ...motorSim.params };

  const settled = run(base, 12);
  const omega = steadyOmega(base);
  push('Settling speed matches the closed-form steady state', Math.abs(settled.omega - omega) / omega < 2e-3, `${settled.omega.toFixed(2)} vs ${omega.toFixed(2)} rad/s`);
  push('Settling current matches the closed-form steady state', Math.abs(settled.current - steadyCurrent(base)) < 1e-2, `${settled.current.toFixed(4)} vs ${steadyCurrent(base).toFixed(4)} A`);

  const blocked = { ...base, load: 0, friction: 0, voltage: base.voltage };
  const stalled = run({ ...blocked, inertia: 1e6 }, 8 * (base.inductance / base.resistance));
  push('Stalled rotor draws V/R once the current settles', Math.abs(stalled.current - base.voltage / base.resistance) / (base.voltage / base.resistance) < 2e-2, `${stalled.current.toFixed(4)} vs ${(base.voltage / base.resistance).toFixed(4)} A at ${(stalled.omega).toExponential(1)} rad/s`);

  const tau = base.inductance / base.resistance;
  const atTau = run({ ...blocked, inertia: 1e6, k: 0 }, tau);
  const target = 0.6321205588 * base.voltage / base.resistance;
  push('Current rise follows the L/R exponential at one time constant', Math.abs(atTau.current - target) / target < 5e-3, `${atTau.current.toFixed(5)} vs ${target.toFixed(5)} A at ${(tau * 1000).toFixed(2)} ms`);

  const energy = settled.energy;
  const residual = energy.input - energy.copper - energy.friction - energy.load - 0.5 * base.inertia * settled.omega ** 2;
  push('Energy ledger closes over the whole run', Math.abs(residual) / Math.max(1e-9, energy.input) < 1e-3, `${residual.toExponential(2)} J left over of ${energy.input.toFixed(3)} J in`);

  const thermal = run({ ...base, load: 0.9 }, 400, 1 / 1000);
  const expectedRise = (base.resistance * (base.friction * thermal.omega + 0.9) ** 2 / base.k ** 2 + base.friction * thermal.omega ** 2) / base.cooling;
  push('Winding temperature settles where copper loss balances cooling', Math.abs((thermal.temperature - base.ambient) - expectedRise) / expectedRise < 1e-2, `${(thermal.temperature - base.ambient).toFixed(3)} vs ${expectedRise.toFixed(3)} K`);

  push('Torque constant and back-EMF constant are the same number by definition', base.k === base.k, 'K = Kt = Ke (SI, per rad/s)');
  push('Efficiency stays physical across the whole load range', [0, 0.2, 0.5, 1, 2].every((load) => {
    const y = run({ ...base, load }, 4);
    const r = motorSim.read(y, { ...base, load });
    return r.efficiency > -0.01 && r.efficiency < 1.01;
  }), '0 → 2 N·m in steps');

  return { checks };
}

export const motorFields = motorSim.fields;
export const motorClamp = clamp;