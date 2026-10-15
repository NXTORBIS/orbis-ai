const G = 9.81;
const RHO = 1000;

export const GATE_TYPES = { vertical: 'Vertical lift gate', radial: 'Radial (Tainter) gate' };
export const HOIST = [{ value: 1, label: 'Raise' }, { value: 0, label: 'Hold' }, { value: -1, label: 'Lower' }];

/** Orifice discharge under the gate, or a broad-crested weir once the gate is clear of the water. */
export function discharge(p, h1, h2, opening) {
  if (opening <= 1e-3 || h1 <= 1e-4) return { flow: 0, regime: 'closed', head: 0 };
  if (opening > 0.85 * h1) {
    return { flow: 1.7 * p.width * Math.pow(h1, 1.5), regime: 'weir (gate clear of the water)', head: h1 };
  }
  const submerged = h2 > opening + 0.01;
  const head = submerged ? Math.max(0, h1 - h2) : h1;
  const area = p.width * opening;
  return {
    flow: p.cd * area * Math.sqrt(2 * G * head),
    regime: submerged ? 'submerged orifice' : 'free orifice',
    head,
    area,
  };
}

export function outfall(p, h2) {
  return h2 <= 0 ? 0 : 1.7 * p.width * Math.pow(h2, 1.5);
}

/** Net hydrostatic force, by trapezoidal integration of the pressure on each face. */
export function hydrostaticForce(p, h1, h2, opening, steps = 200) {
  const height = Math.max(opening, 0.001);
  const dz = height / steps;
  let force = 0, moment = 0;
  for (let i = 0; i < steps; i += 1) {
    const z = (i + 0.5) * dz;
    const upstream = RHO * G * Math.max(0, h1 - z);
    const downstream = RHO * G * Math.max(0, h2 - z);
    const net = (upstream - downstream) * p.width * dz;
    force += net;
    moment += net * z;
  }
  return { force, centreOfPressure: force !== 0 ? moment / force : 0 };
}

/** Hydraulic moment about the trunnion of a circular-arc radial gate. */
export function trunnionMoment(p, h1, h2, opening, steps = 240) {
  const trunnionHeight = p.trunnionHeight;
  const radius = p.radius;
  let moment = 0;
  let force = 0;
  const dphi = (Math.PI / 2) / steps;
  for (let i = 0; i < steps; i += 1) {
    const phi = (i + 0.5) * dphi;
    const x = radius * Math.sin(phi);
    const z = trunnionHeight - radius * Math.cos(phi);
    const ds = radius * dphi;
    const net = RHO * G * (Math.max(0, h1 - z) - Math.max(0, h2 - z));
    const load = net * p.width * ds;
    force += load;
    // The water load acts along the inward normal of the arc, so the moment arm is the
    // perpendicular distance from the trunnion to that line of action — zero by geometry.
    const normalX = Math.sin(phi);
    const normalZ = -Math.cos(phi);
    const armX = x;
    const armZ = z - trunnionHeight;
    moment += armX * (-load * normalZ) - armZ * (-load * normalX);
  }
  return { moment, force, note: 'A circular arc centred on its trunnion carries the water load straight into the pivot, so the hydraulic moment is zero by geometry.' };
}

export function hoistForce(p, h1, h2, opening) {
  const submergedFraction = Math.min(1, Math.max(h1, h2) / Math.max(p.gateHeight, 0.001));
  const weight = p.gateMass * G;
  const buoyancy = RHO * G * p.gateMass / 7850 * submergedFraction * 0.35;
  const sealFriction = p.friction * Math.abs(hydrostaticForce(p, h1, h2, opening).force);
  const lipDrag = 0.5 * RHO * p.width * Math.max(opening, 0.001) * (opening > 0 ? 1 : 0) * 0.02;
  return { weight, buoyancy, sealFriction, lipDrag, total: weight - buoyancy + sealFriction + lipDrag };
}

export function criticalDepth(unitFlow) {
  return Math.pow((unitFlow * unitFlow) / G, 1 / 3);
}

export function specificEnergy(depth, unitFlow) {
  return depth + (unitFlow * unitFlow) / (2 * G * depth * depth);
}

export const sluiceSim = {
  id: 'sluice-gate',
  unit: 's',
  digits: 1,
  note: 'Level dynamics from volume balance, discharge from the orifice equation with a broad-crested weir above 85% opening, forces by numerical pressure integration on both faces. A simplified hydraulic model: no hydraulic jump, no turbulence, no gate vibration, no sediment.',
  checkNote: 'The orifice equation against Bernoulli, the vertical-gate force against its closed form, the arc-gate trunnion moment property, mass balance at steady state, and the critical-depth minimum of specific energy.',
  params: {
    width: 6, gateHeight: 3, opening: 0.6, hoist: 0, hoistSpeed: 0.08,
    inflow: 12, cd: 0.61, upstreamArea: 240, downstreamArea: 120,
    initialUpstream: 3.2, initialDownstream: 0.8,
    gateType: 'vertical', trunnionHeight: 4.6, radius: 6, gateMass: 2500, friction: 0.3,
  },
  fields: [
    { key: 'gateType', label: 'Gate type', options: Object.entries(GATE_TYPES).map(([value, label]) => ({ value, label })) },
    { key: 'hoist', label: 'Hoist command', options: HOIST },
    { key: 'opening', label: 'Gate opening (m)', min: 0, max: 3, step: 0.05 },
    { key: 'hoistSpeed', label: 'Hoist speed (m/s)', min: 0.01, max: 0.4, step: 0.01 },
    { key: 'inflow', label: 'Channel inflow (m³/s)', min: 0, max: 60, step: 1 },
    { key: 'width', label: 'Gate width (m)', min: 1, max: 20, step: 0.5 },
    { key: 'cd', label: 'Discharge coefficient', min: 0.4, max: 0.85, step: 0.01 },
    { key: 'upstreamArea', label: 'Upstream pool area (m²)', min: 40, max: 2000, step: 20 },
    { key: 'downstreamArea', label: 'Downstream area (m²)', min: 40, max: 2000, step: 20 },
    { key: 'initialUpstream', label: 'Start upstream depth (m)', min: 0.4, max: 6, step: 0.1 },
    { key: 'initialDownstream', label: 'Start downstream depth (m)', min: 0, max: 6, step: 0.1 },
  ],
  options: { maxStep: 0.004, sampleEvery: 0.05, resetOn: ['initialUpstream', 'initialDownstream', 'opening', 'gateType'] },

  init: (p) => ({
    h1: p.initialUpstream, h2: p.initialDownstream, gate: p.opening, t: 0,
    particles: Array.from({ length: 18 }, (_, i) => ({ x: (i / 18) * 1.3 - 0.15, y: 0.15 + (i % 4) * 0.12 })),
  }),

  step(y, dt, p) {
    const command = Number(p.hoist) || 0;
    y.gate = Math.max(0, Math.min(p.gateHeight, y.gate + command * p.hoistSpeed * dt));
    const gate = discharge(p, y.h1, y.h2, y.gate);
    const fall = outfall(p, y.h2);
    y.h1 = Math.max(0.05, y.h1 + ((p.inflow - gate.flow) / p.upstreamArea) * dt);
    y.h2 = Math.max(0.01, y.h2 + ((gate.flow - fall) / p.downstreamArea) * dt);
    y.t += dt;
    const tailVelocity = Math.max(0, gate.flow) / (p.width * Math.max(0.15, y.h2));
    for (const particle of y.particles) {
      const speed = gate.flow > 0 ? (particle.x < 0 ? p.inflow / (p.width * Math.max(0.2, y.h1)) : tailVelocity) : 0;
      particle.x += (speed * dt) / 40;
      if (particle.x > 1.15) { particle.x = -0.15; particle.y = 0.12 + ((particle.y * 7) % 1) * 0.35; }
    }
    return y;
  },

  read(y, p) {
    const gate = discharge(p, y.h1, y.h2, y.gate);
    const fall = outfall(p, y.h2);
    const force = hydrostaticForce(p, y.h1, y.h2, y.gate);
    const unitFlow = y.h1 > 0 ? p.inflow / p.width : 0;
    const critical = criticalDepth(Math.max(1e-6, gate.flow / p.width));
    return {
      flow: gate.flow, regime: gate.regime, head: gate.head, area: gate.area || p.width * y.gate,
      h1: y.h1, h2: y.h2, gate: y.gate, gatePercent: (y.gate / p.gateHeight) * 100,
      outfall: fall,
      upstreamVelocity: p.inflow / (p.width * Math.max(0.2, y.h1)),
      gateVelocity: y.gate > 0.01 ? gate.flow / (p.width * Math.max(0.01, y.gate)) : 0,
      tailVelocity: gate.flow / (p.width * Math.max(0.2, y.h2)),
      force: force.force, centreOfPressure: force.centreOfPressure,
      moment: trunnionMoment(p, y.h1, y.h2, y.gate).moment,
      hoist: hoistForce(p, y.h1, y.h2, y.gate),
      unitFlow, critical, criticalEnergy: specificEnergy(critical, Math.max(1e-6, gate.flow / p.width)),
      froude: y.gate > 0.01 ? (gate.flow / (p.width * Math.max(0.01, y.gate))) / Math.sqrt(G * Math.max(0.01, y.gate)) : 0,
      power: RHO * G * Math.max(0, gate.flow) * Math.max(0, y.h1 - y.h2) / 1000,
      particles: y.particles, t: y.t,
      balance: p.inflow - gate.flow,
    };
  },

  series: [
    { key: 'h1', label: 'Upstream depth (m)', value: (r) => r.h1 },
    { key: 'h2', label: 'Downstream depth (m)', value: (r) => r.h2 },
    { key: 'flow', label: 'Discharge (m³/s)', value: (r) => r.flow },
  ],

  verify: verifySluice,
};

export function runToSteady(p, seconds = 4000, dt = 0.05) {
  const state = sluiceSim.init(p);
  for (let i = 0; i < seconds / dt; i += 1) sluiceSim.step(state, dt, { ...p, hoist: 0 });
  return state;
}

function verifySluice() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const base = { ...sluiceSim.params };

  const h1 = 3.2, h2 = 0.8, opening = 1.0;
  const modelled = discharge(base, h1, h2, opening);
  const bernoulli = base.cd * base.width * opening * Math.sqrt(2 * G * h1);
  push('Free orifice discharge matches the Bernoulli form', Math.abs(modelled.flow - bernoulli) < 1e-12, `${modelled.flow.toFixed(4)} vs ${bernoulli.toFixed(4)} m³/s`);

  const submerged = discharge(base, h1, 1.4, opening);
  push('Submergence switches to the differential head and reduces flow', submerged.regime === 'submerged orifice' && submerged.flow < modelled.flow, `${submerged.flow.toFixed(3)} submerged vs ${modelled.flow.toFixed(3)} m³/s free`);

  const leaf = 0.6;
  const integrated = hydrostaticForce(base, h1, h2, leaf, 4000).force;
  const band = (depth) => depth * depth - Math.max(0, depth - leaf) ** 2;
  const closed = (RHO * G * base.width * (band(h1) - band(h2))) / 2;
  push('Numerical pressure integration matches the closed-form force', Math.abs(integrated - closed) / closed < 1e-6, `${(integrated / 1000).toFixed(3)} vs ${(closed / 1000).toFixed(3)} kN on a ${leaf} m leaf`);

  const arcMoment = trunnionMoment(base, h1, h2, leaf);
  const scale = RHO * G * base.width * h1 * h1 * base.radius;
  push('Radial gate load passes through its trunnion', Math.abs(arcMoment.moment) < 1e-9 * scale && Math.abs(arcMoment.force) > 1000, `moment ${arcMoment.moment.toExponential(1)} N·m about the pivot for ${(arcMoment.force / 1000).toFixed(1)} kN of arc thrust`);

  const steady = runToSteady({ ...base, inflow: 12 });
  push('Steady state satisfies the volume balance', Math.abs(base.inflow - discharge(base, steady.h1, steady.h2, steady.gate).flow) / base.inflow < 0.02, `inflow ${base.inflow} m³/s against discharge ${discharge(base, steady.h1, steady.h2, steady.gate).flow.toFixed(3)} m³/s at h₁ = ${steady.h1.toFixed(3)} m`);

  const coarse = runToSteady({ ...base, inflow: 12 }, 2000, 0.2);
  push('Level integration converges under step refinement', Math.abs(coarse.h1 - steady.h1) / steady.h1 < 5e-3, `h₁ ${coarse.h1.toFixed(4)} vs ${steady.h1.toFixed(4)} m at Δt = 0.2 s and 0.05 s`);

  const q = 12 / base.width;
  const critical = criticalDepth(q);
  let minimumAt = critical;
  let minimum = specificEnergy(minimumAt, q);
  for (let i = 1; i <= 400; i += 1) {
    const depth = 0.05 + (i / 400) * 5;
    const energy = specificEnergy(depth, q);
    if (energy < minimum) { minimum = energy; minimumAt = depth; }
  }
  push('Specific energy is minimised at the critical depth', Math.abs(minimumAt - critical) < 0.02, `numeric minimum at ${minimumAt.toFixed(3)} m against y_c = (q²/g)^⅓ = ${critical.toFixed(3)} m`);

  const raised = hoistForce(base, h1, h2, opening);
  push('Hoist load exceeds the gate weight once seal friction is included', raised.total > raised.weight, `${(raised.total / 1000).toFixed(1)} kN against ${(raised.weight / 1000).toFixed(1)} kN of dead weight`);

  const closedGate = discharge(base, h1, h2, 0);
  push('A closed gate passes nothing', closedGate.flow === 0 && closedGate.regime === 'closed', 'opening ≤ 1 mm');

  return { checks };
}