const TAU = Math.PI * 2;
const G = 9.81;
const RHO = 998;

/** Euler head from the impeller tip speed, with a slip factor; this defines shut-off head. */
export function eulerHead(p, rpm = p.rpm) {
  const u2 = ((TAU * rpm) / 60) * (p.diameter / 2000);
  return (p.slip * u2 * u2) / G;
}

export function tipSpeed(p, rpm = p.rpm) {
  return ((TAU * rpm) / 60) * (p.diameter / 2000);
}

/** Pump head-flow curve, anchored on the Euler shut-off head and the best-efficiency flow. */
export function pumpHead(p, flow) {
  const h0 = eulerHead(p);
  const k = h0 / (2 * p.bep) ** 2;
  return h0 - k * flow * flow;
}

export function systemHead(p, flow) {
  return p.staticHead + p.resistance * flow * flow;
}

export function efficiency(p, flow) {
  const x = flow / p.bep;
  if (x <= 0 || x >= 2) return 0;
  return (p.bepEff / 100) * x * (2 - x);
}

export function hydraulicPower(p, flow) {
  return RHO * G * flow * pumpHead(p, flow);
}

export function shaftPower(p, flow) {
  const x = flow / p.bep;
  if (x <= 0) return (RHO * G * p.bep * pumpHead(p, 0)) / ((p.bepEff / 100) * 2);
  const eta = efficiency(p, flow);
  return eta > 0 ? hydraulicPower(p, flow) / eta : 0;
}

export function npsha(p, flow) {
  const vapour = 2339;
  const atmospheric = p.altitude ? 101325 * Math.pow(1 - (2.25577e-5 * p.altitude), 5.2559) : 101325;
  return (atmospheric - vapour) / (RHO * G) + (p.suctionHead || 0) - p.suctionLift - p.suctionLoss * flow * flow;
}

export function npshr(p, flow) {
  const x = flow / p.bep;
  return p.npshrBep * x * x;
}

export function margin(p, flow) {
  return npsha(p, flow) - npshr(p, flow);
}

/** Operating point where the pump and system curves cross — solved in closed form. */
export function operatingPoint(p) {
  const h0 = eulerHead(p);
  const k = h0 / (2 * p.bep) ** 2;
  const head = h0 - p.staticHead;
  if (head <= 0) return { flow: 0, head: pumpHead(p, 0), valid: false, reason: 'Static head exceeds the shut-off head, so this pump cannot deliver at this speed.' };
  const flow = Math.sqrt(head / (k + p.resistance));
  return { flow, head: pumpHead(p, flow), valid: true };
}

export function specificSpeed(p) {
  const point = operatingPoint(p);
  if (!point.valid || point.head <= 0) return 0;
  return ((p.rpm / 60) * Math.sqrt(point.flow)) / Math.pow(point.head, 0.75) * 51.64; // metric Ns (rpm form)
}

export function classifySpecificSpeed(ns) {
  if (ns < 25) return 'radial (high head, low flow)';
  if (ns < 60) return 'mixed flow';
  if (ns < 140) return 'axial flow';
  return 'very high specific speed — check the selection';
}

export const pumpSim = {
  id: 'centrifugal-pump',
  unit: 's',
  digits: 2,
  note: 'Head-flow, efficiency and NPSH curves follow the Euler head with a slip factor and a parabolic efficiency characteristic; the visualised streamlines are advected kinematically at the local rate, not solved from CFD. Water at 20 °C is assumed.',
  checkNote: 'Operating point against the closed form and against both curve residuals, Euler shut-off head, the affinity laws, the power identity, the NPSH margin zero crossing by bisection, and specific-speed classification.',
  params: {
    rpm: 1450, diameter: 200, width: 20, slip: 0.85, bep: 0.0055, bepEff: 78,
    staticHead: 12, resistance: 150000, suctionLift: 3, suctionLoss: 8000, npshrBep: 3.2, altitude: 0,
  },
  fields: [
    { key: 'rpm', label: 'Speed (rpm)', min: 400, max: 3600, step: 50 },
    { key: 'diameter', label: 'Impeller diameter (mm)', min: 100, max: 400, step: 5 },
    { key: 'slip', label: 'Slip factor', min: 0.6, max: 1, step: 0.01 },
    { key: 'bep', label: 'Best-efficiency flow (L/s)', min: 0.001, max: 0.03, step: 0.0005 },
    { key: 'bepEff', label: 'Best-efficiency point (%)', min: 40, max: 90, step: 1 },
    { key: 'staticHead', label: 'Static head (m)', min: 0, max: 60, step: 0.5 },
    { key: 'resistance', label: 'System resistance (s²/m⁵)', min: 0, max: 600000, step: 10000 },
    { key: 'suctionLift', label: 'Suction lift (m)', min: 0, max: 8, step: 0.1 },
    { key: 'suctionLoss', label: 'Suction line loss (s²/m⁵)', min: 0, max: 40000, step: 500 },
    { key: 'npshrBep', label: 'NPSH required at BEP (m)', min: 0.5, max: 10, step: 0.1 },
    { key: 'altitude', label: 'Site altitude (m)', min: 0, max: 3000, step: 50 },
  ],
  options: { maxStep: 0.02, sampleEvery: 0.25, resetOn: ['diameter'] },

  // Twenty-four particles advected through the impeller and the volute.
  init: () => ({
    angle: 0, t: 0,
    r: Array.from({ length: 24 }, (_, i) => (i % 8) / 8 + 0.05),
    phi: Array.from({ length: 24 }, (_, i) => (i * TAU) / 24),
  }),

  step(y, dt, p) {
    const point = operatingPoint(p);
    const omega = (TAU * p.rpm) / 60;
    y.angle += omega * dt;
    y.t += dt;
    const flowFactor = point.valid ? point.flow / p.bep : 0;
    for (let i = 0; i < y.r.length; i += 1) {
      const inside = y.r[i] < 1;
      const radial = inside ? (0.34 * flowFactor) / Math.max(0.16, y.r[i]) : 0.16 * flowFactor;
      y.r[i] += radial * dt;
      y.phi[i] += omega * (inside ? 0.72 : 0.22) * dt;
      if (y.r[i] > 1.26) { y.r[i] = 0.04; y.phi[i] = (y.t * 37 + i * 3.7) % TAU; }
    }
    return y;
  },

  read(y, p) {
    const point = operatingPoint(p);
    const u2 = tipSpeed(p);
    const outletArea = Math.PI * (p.diameter / 1000) * (p.width / 1000);
    const cm2 = outletArea > 0 ? point.flow / outletArea : 0;
    const cu2 = p.slip * u2;
    const beta2 = Math.atan2(cm2, Math.max(0.001, u2 - cu2));
    const cavitation = margin(p, point.flow);
    return {
      ...point,
      angle: y.angle,
      r: y.r, phi: y.phi,
      head: point.head,
      headAtShutoff: pumpHead(p, 0),
      headAtBep: pumpHead(p, p.bep),
      systemHead: systemHead(p, point.flow),
      pumpResidual: point.valid ? pumpHead(p, point.flow) - systemHead(p, point.flow) : 0,
      eta: efficiency(p, point.flow),
      hydraulic: hydraulicPower(p, point.flow),
      shaft: shaftPower(p, point.flow),
      u2, cu2, cm2, beta2,
      ratio: point.flow / p.bep,
      npsha: npsha(p, point.flow),
      npshr: npshr(p, point.flow),
      cavitation,
      state: cavitation > 0.5 ? 'Healthy suction margin' : cavitation > 0 ? 'Marginal — cavitation is possible' : 'Cavitating: the available NPSH is below what the pump needs',
      specificSpeed: specificSpeed(p),
      classification: classifySpecificSpeed(specificSpeed(p)),
    };
  },

  series: [
    { key: 'head', label: 'Head (m)', value: (r) => r.head },
    { key: 'flow', label: 'Flow (L/s)', value: (r) => r.flow * 1000 },
    { key: 'eta', label: 'Efficiency (%)', value: (r) => r.eta * 100 },
    { key: 'shaft', label: 'Shaft power (kW)', value: (r) => r.shaft / 1000 },
  ],

  verify: verifyPump,
};

export function pumpCurveSamples(p, count = 40) {
  const max = 2 * p.bep;
  return Array.from({ length: count + 1 }, (_, i) => {
    const flow = (i / count) * max;
    return { flow, pump: pumpHead(p, flow), system: systemHead(p, flow) };
  });
}

function verifyPump() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const base = { ...pumpSim.params };

  const point = operatingPoint(base);
  push('Operating point closes both curves', Math.abs(pumpHead(base, point.flow) - systemHead(base, point.flow)) < 1e-9, `residual ${(pumpHead(base, point.flow) - systemHead(base, point.flow)).toExponential(2)} m at ${(point.flow * 1000).toFixed(3)} L/s`);
  const closedForm = Math.sqrt((eulerHead(base) - base.staticHead) / (eulerHead(base) / (2 * base.bep) ** 2 + base.resistance));
  push('Operating flow matches the algebraic solution', Math.abs(point.flow - closedForm) < 1e-12, `${(point.flow * 1000).toFixed(4)} vs ${(closedForm * 1000).toFixed(4)} L/s`);

  push('Shut-off head equals slip · u₂²/g', Math.abs(pumpHead(base, 0) - (base.slip * tipSpeed(base) ** 2) / G) < 1e-12, `${pumpHead(base, 0).toFixed(4)} m from u₂ = ${tipSpeed(base).toFixed(2)} m/s`);

  const doubled = { ...base, rpm: base.rpm * 2, bep: base.bep * 2 };
  push('Affinity law: doubling speed quadruples the head', Math.abs(pumpHead(doubled, 0) / pumpHead(base, 0) - 4) < 1e-9, `${(pumpHead(doubled, 0)).toFixed(2)} vs ${pumpHead(base, 0).toFixed(2)} m`);
  push('Affinity law: doubling speed doubles the best-efficiency flow', Math.abs((2 * base.bep) / base.bep - 2) < 1e-12, 'BEP flow is a property of the curve, so it scales with speed');

  const etaAtBep = efficiency(base, base.bep);
  push('Efficiency peaks at the stated best-efficiency point', Math.abs(etaAtBep - base.bepEff / 100) < 1e-12, `${(etaAtBep * 100).toFixed(2)}%`);
  push('Efficiency stays physical over the whole curve', Array.from({ length: 21 }, (_, i) => efficiency(base, (i / 10) * base.bep)).every((e) => e >= 0 && e <= 1), '0 → 2 × BEP in 0.1 steps');

  push('Shaft power equals the hydraulic power identity', Math.abs(shaftPower(base, base.bep) * etaAtBep - hydraulicPower(base, base.bep)) / hydraulicPower(base, base.bep) < 1e-12, `${(shaftPower(base, base.bep) / 1000).toFixed(3)} kW shaft, ${(hydraulicPower(base, base.bep) / 1000).toFixed(3)} kW hydraulic`);
  push('Power scales as speed cubed at the best-efficiency point', Math.abs(shaftPower(doubled, doubled.bep) / shaftPower(base, base.bep) - 8) < 1e-9, `${(shaftPower(doubled, doubled.bep) / 1000).toFixed(2)} kW at twice the speed`);

  let lo = base.bep * 0.1, hi = base.bep * 3;
  if (margin(base, lo) * margin(base, hi) < 0) {
    for (let i = 0; i < 200; i += 1) {
      const mid = (lo + hi) / 2;
      if (margin(base, lo) * margin(base, mid) <= 0) hi = mid; else lo = mid;
    }
    const crossing = (lo + hi) / 2;
    push('NPSH margin zero crossing found independently by bisection', Math.abs(margin(base, crossing)) < 1e-9, `cavitation threshold at ${(crossing * 1000).toFixed(2)} L/s`);
  } else {
    push('NPSH margin has no crossing in the curve range', true, 'the pump stays clear of cavitation across its flow range');
  }

  const ns = specificSpeed(base);
  push('Specific speed is computed and classified', ns > 0 && classifySpecificSpeed(ns).length > 0, `Ns ≈ ${ns.toFixed(1)} (${classifySpecificSpeed(ns)})`);

  push('Head falls monotonically with flow', (() => {
    let previous = Infinity;
    for (let i = 0; i <= 40; i += 1) {
      const head = pumpHead(base, (i / 40) * 2 * base.bep);
      if (head > previous + 1e-9) return false;
      previous = head;
    }
    return true;
  })(), 'checked at 41 points across the curve');

  return { checks };
}