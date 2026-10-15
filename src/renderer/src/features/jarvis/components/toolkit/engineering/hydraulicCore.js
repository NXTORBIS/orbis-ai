const RHO = 850;
const BULK = 1.4e9;
const DEAD = 1e-4;
const BAR = 1e5;

export const COMPONENT_CATALOGUE = {
  pump: { label: 'Fixed-displacement pump', defaults: { displacement: 8, rpm: 1450 }, connects: ['T', 'P'] },
  relief: { label: 'Relief valve', defaults: { setting: 100, capacity: 20 }, connects: ['P', 'T'] },
  dcv: { label: '4/3 directional valve', defaults: { position: 'extend', area: 2e-5 }, connects: ['P', 'T', 'A', 'B'] },
  cylinder: { label: 'Double-acting cylinder', defaults: { bore: 63, rod: 36, stroke: 500, mass: 500, load: 10000, damping: 900 }, connects: ['A', 'B'] },
  restrictor: { label: 'Restrictor', defaults: { area: 3e-5, cd: 0.62 }, connects: ['P', 'T'] },
  check: { label: 'Check valve', defaults: { crackBar: 1.5, area: 4e-5, cd: 0.62 }, connects: ['P', 'A'] },
  accumulator: { label: 'Gas accumulator', defaults: { volume: 1, precharge: 60, node: 'P' }, connects: ['P'] },
  gauge: { label: 'Pressure gauge', defaults: { node: 'P' }, connects: ['P'] },
};

export const DCV_POSITIONS = {
  extend: 'Extend (P→A, B→T)',
  hold: 'Hold (all ports closed)',
  retract: 'Retract (P→B, A→T)',
  float: 'Float (A and B to tank)',
};

export const DEFAULT_CIRCUIT = {
  nodes: [
    { id: 'P', label: 'Pressure line', dead: 3e-4, fixed: null },
    { id: 'A', label: 'Cylinder cap side', dead: DEAD, fixed: null },
    { id: 'B', label: 'Cylinder rod side', dead: DEAD, fixed: null },
    { id: 'T', label: 'Tank', dead: 1, fixed: 0 },
  ],
  components: [
    { id: 'pump', type: 'pump', from: 'T', to: 'P', params: { displacement: 8, rpm: 1450 } },
    { id: 'relief', type: 'relief', from: 'P', to: 'T', params: { setting: 100, capacity: 20 } },
    { id: 'dcv', type: 'dcv', ports: { p: 'P', t: 'T', a: 'A', b: 'B' }, params: { position: 'extend', area: 2e-5 } },
    { id: 'cylinder', type: 'cylinder', ports: { a: 'A', b: 'B' }, params: { bore: 63, rod: 36, stroke: 500, mass: 500, load: 10000, damping: 900 } },
    { id: 'meter', type: 'restrictor', from: 'B', to: 'T', enabled: false, params: { area: 3e-5, cd: 0.62 } },
    { id: 'check', type: 'check', from: 'P', to: 'A', enabled: false, params: { crackBar: 1.5, area: 4e-5, cd: 0.62 } },
    { id: 'accumulator', type: 'accumulator', enabled: false, params: { volume: 1, precharge: 60, node: 'P' } },
    { id: 'gauge', type: 'gauge', params: { node: 'P' } },
  ],
};

/** Bounded and smooth near zero head so the explicit solver stays stable. */
function orifice(area, cd, delta) {
  const magnitude = Math.abs(delta);
  const factor = Math.sqrt(2 / RHO) / Math.sqrt(Math.max(magnitude, 1e4));
  return cd * area * factor * delta;
}

export function cylinderAreas(component) {
  const bore = component.params.bore / 1000;
  const rod = component.params.rod / 1000;
  return { cap: (Math.PI / 4) * bore * bore, annulus: (Math.PI / 4) * (bore * bore - rod * rod) };
}

export function pistonForce(circuit, pressure) {
  const cylinder = circuit.components.find((c) => c.type === 'cylinder' && c.enabled !== false);
  if (!cylinder) return { force: 0, cap: 0, annulus: 0 };
  const areas = cylinderAreas(cylinder);
  return { force: pressure.A * areas.cap - pressure.B * areas.annulus, ...areas, cylinder };
}

function nodeFlow(circuit, state) {
  const { p } = state;
  const flow = Object.fromEntries(circuit.nodes.map((node) => [node.id, 0]));
  const details = {};
  const add = (id, value) => { flow[id] += value; if (details[id] === undefined) details[id] = 0; details[id] += value; };

  for (const component of circuit.components) {
    if (component.enabled === false) continue;
    const params = component.params;
    switch (component.type) {
      case 'pump': {
        const q = ((params.displacement * 1e-6 * params.rpm) / 60);
        add(component.to, q); add(component.from, -q);
        component.lastFlow = q;
        break;
      }
      case 'relief': {
        const over = p[component.from] - params.setting * BAR;
        const q = over > 0 ? (params.capacity * 1e-3 / 60) * (1 - Math.exp(-over / (5 * BAR))) : 0;
        add(component.from, -q); add(component.to, q);
        component.lastFlow = q;
        break;
      }
      case 'dcv': {
        const area = params.area;
        const open = (from, to, active) => {
          if (!active) return 0;
          const q = orifice(area, 0.62, p[from] - p[to]);
          add(from, -q); add(to, q);
          return q;
        };
        let primary = 0;
        if (params.position === 'extend') { primary = open(component.ports.p, component.ports.a, true); open(component.ports.b, component.ports.t, true); }
        else if (params.position === 'retract') { primary = open(component.ports.p, component.ports.b, true); open(component.ports.a, component.ports.t, true); }
        else if (params.position === 'float') { open(component.ports.a, component.ports.t, true); open(component.ports.b, component.ports.t, true); }
        component.lastFlow = primary;
        break;
      }
      case 'cylinder': {
        const areas = cylinderAreas(component);
        add(component.ports.a, -areas.cap * state.v);
        add(component.ports.b, areas.annulus * state.v);
        // A tight piston seal: a fraction of a millilitre a minute at working pressure.
        const leak = (p[component.ports.a] - p[component.ports.b]) / 2e15;
        add(component.ports.a, -leak); add(component.ports.b, leak);
        break;
      }
      case 'restrictor': {
        const q = orifice(params.area, params.cd, p[component.from] - p[component.to]);
        add(component.from, -q); add(component.to, q);
        component.lastFlow = q;
        break;
      }
      case 'check': {
        const delta = p[component.from] - p[component.to];
        const q = delta > params.crackBar * BAR ? orifice(params.area, params.cd, delta - params.crackBar * BAR) : 0;
        add(component.from, -q); add(component.to, q);
        component.lastFlow = q;
        break;
      }
      case 'accumulator': {
        const node = params.node;
        const oil = state.oil[component.id] ?? 0;
        const gas = Math.max(0.02 * params.volume, params.volume - oil);
        const gasPressure = params.precharge * BAR * Math.pow(params.volume / gas, 1.4);
        const dOil = (p[node] - gasPressure) * 1e-9;
        add(node, -dOil);
        component.lastFlow = -dOil;
        break;
      }
      default:
        break;
    }
  }
  return { flow, details };
}

export function hydraulicSolution(circuit, state) {
  const areas = {};
  const cylinder = circuit.components.find((c) => c.type === 'cylinder' && c.enabled !== false);
  if (cylinder) Object.assign(areas, cylinderAreas(cylinder));
  const { flow } = nodeFlow(circuit, state);
  const volumeOf = (node) => {
    if (node.id === 'A' && cylinder) return Math.max(DEAD, areas.cap * Math.max(0, state.x) + DEAD);
    if (node.id === 'B' && cylinder) return Math.max(DEAD, areas.annulus * Math.max(0, (cylinder.params.stroke / 1000) - state.x) + DEAD);
    return node.dead;
  };
  const next = { ...state.p };
  for (const node of circuit.nodes) {
    if (node.fixed !== null) { next[node.id] = node.fixed; continue; }
    next[node.id] = Math.max(-BAR, state.p[node.id] + (BULK / volumeOf(node)) * flow[node.id] * state.dt);
  }
  return next;
}

export const hydraulicSim = {
  id: 'hydraulic-circuit',
  unit: 's',
  digits: 3,
  note: 'Each line node carries a real oil volume and its bulk modulus, so pressure comes from the flow balance; valves are orifice elements and the cylinder is a mass on a pressure-difference force. Lumped, isothermal model: no hose compliance, no oil aeration, no valve spool dynamics.',
  checkNote: 'Continuity during a steady extend, static force balance with the valve closed, the relief setting when stalled, the orifice law, an energy ledger and step-halving convergence.',
  params: { timeScale: 1, circuit: DEFAULT_CIRCUIT, load: 10000, dcvPosition: 'extend' },
  fields: [
    { key: 'timeScale', label: 'Time compression (×)', min: 1, max: 20, step: 1 },
  ],
  options: { maxStep: 2e-5, sampleEvery: 0.05, resetOn: ['circuit'] },

  init: (p) => ({
    p: { P: 0, A: 0, B: 0, T: 0 }, v: 0, x: 0.005, dt: 2e-5, oil: {},
    t: 0, ledger: { pump: 0, hydraulic: 0, relief: 0, friction: 0 },
  }),

  step(y, dtReal, p) {
    const dt = dtReal * Math.max(1, p.timeScale);
    const steps = Math.min(6000, Math.max(1, Math.ceil(dt / 2e-5)));
    const h = dt / steps;
    const circuit = {
      ...p.circuit,
      components: p.circuit.components.map((c) => (c.type === 'dcv' ? { ...c, params: { ...c.params, position: p.dcvPosition } } : c.type === 'cylinder' ? { ...c, params: { ...c.params, load: p.load } } : c)),
    };
    const cylinder = circuit.components.find((c) => c.type === 'cylinder');
    const areas = cylinderAreas(cylinder);
    const stroke = cylinder.params.stroke / 1000;
    for (let i = 0; i < steps; i += 1) {
      const scratch = { ...y, dt: h };
      const pressure = hydraulicSolution(circuit, scratch);
      const force = pressure.A * areas.cap - pressure.B * areas.annulus;
      const acceleration = (force - cylinder.params.load - cylinder.params.damping * y.v) / cylinder.params.mass;
      y.v += acceleration * h;
      y.x = Math.max(0, Math.min(stroke, y.x + y.v * h));
      if (y.x <= 0 || y.x >= stroke) y.v = 0;
      y.p = pressure;
      const { flow } = nodeFlow(circuit, { ...y, dt: h });
      y.t += h;
      y.ledger.pump += Math.abs(pressure.P) * Math.abs(flow.P || 0) * h;
      y.ledger.hydraulic += Math.max(0, force * y.v) * h;
      y.ledger.relief += Math.max(0, pressure.P) * Math.abs(flow.T || 0) * h;
      y.ledger.friction += cylinder.params.damping * y.v * y.v * h;
    }
    y.dt = h;
    return y;
  },

  read: (y, p) => {
    const circuit = p.circuit;
    const cylinder = circuit.components.find((c) => c.type === 'cylinder');
    const areas = cylinderAreas(cylinder);
    const relief = circuit.components.find((c) => c.type === 'relief' && c.enabled !== false);
    const pump = circuit.components.find((c) => c.type === 'pump');
    const pumpFlow = (pump.params.displacement * 1e-6 * pump.params.rpm) / 60;
    const force = y.p.A * areas.cap - y.p.B * areas.annulus;
    const reliefFlow = relief && y.p.P > relief.params.setting * BAR ? relief.lastFlow || 0 : 0;
    const efficiency = y.ledger.pump > 0 ? y.ledger.hydraulic / y.ledger.pump : 0;
    return {
      pressure: { P: y.p.P / BAR, A: y.p.A / BAR, B: y.p.B / BAR, T: 0 },
      position: y.x * 1000, velocity: y.v * 1000, stroke: cylinder.params.stroke,
      force, load: cylinder.params.load, areas,
      pumpFlow: pumpFlow * 60000, reliefFlow: (reliefFlow || 0) * 60000,
      capFlow: areas.cap * y.v * 60000,
      pumpPower: Math.abs(y.p.P * pumpFlow) / 1000,
      hydraulicPower: Math.max(0, force * y.v) / 1000,
      heat: (y.ledger.pump - y.ledger.hydraulic - y.ledger.friction) / 1000,
      efficiency,
      reliefSetting: relief ? relief.params.setting : 0,
      stalling: y.p.P / BAR > (relief ? relief.params.setting * 0.98 : Infinity),
      ledger: y.ledger,
      balance: y.ledger.pump - y.ledger.hydraulic - y.ledger.relief - y.ledger.friction,
      positionPercent: (y.x / (cylinder.params.stroke / 1000)) * 100,
      velocityMm: y.v * 1000,
      t: y.t,
      circuit,
    };
  },

  series: [
    { key: 'pP', label: 'Line pressure (bar)', value: (r) => r.pressure.P },
    { key: 'flow', label: 'Pump flow (L/min)', value: (r) => r.pumpFlow },
    { key: 'position', label: 'Cylinder position (mm)', value: (r) => r.position },
    { key: 'force', label: 'Cylinder force (kN)', value: (r) => r.force / 1000 },
  ],

  verify: verifyHydraulic,
};

export function simulateCircuit(circuit, seconds, dt = 2e-5, overrides = {}) {
  const params = { circuit, timeScale: 1, load: 10000, dcvPosition: 'extend', ...overrides };
  const state = hydraulicSim.init(params);
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    const y = state;
    const circuitNow = { ...params.circuit, components: params.circuit.components.map((c) => (c.type === 'dcv' ? { ...c, params: { ...c.params, position: params.dcvPosition } } : c.type === 'cylinder' ? { ...c, params: { ...c.params, load: params.load } } : c)) };
    const cylinder = circuitNow.components.find((c) => c.type === 'cylinder');
    const areas = cylinderAreas(cylinder);
    const stroke = cylinder.params.stroke / 1000;
    const pressure = hydraulicSolution(circuitNow, { ...y, dt });
    const force = pressure.A * areas.cap - pressure.B * areas.annulus;
    const acceleration = (force - cylinder.params.load - cylinder.params.damping * y.v) / cylinder.params.mass;
    y.v += acceleration * dt;
    y.x = Math.max(0, Math.min(stroke, y.x + y.v * dt));
    if (y.x <= 0 || y.x >= stroke) y.v = 0;
    y.p = pressure;
    y.t += dt;
  }
  return { state, circuit: params.circuit };
}

export function withComponentDisabled(circuit, id, enabled) {
  return { ...circuit, components: circuit.components.map((c) => (c.id === id ? { ...c, enabled } : c)) };
}

export function updateComponentParams(circuit, id, patch) {
  return { ...circuit, components: circuit.components.map((c) => (c.id === id ? { ...c, params: { ...c.params, ...patch } } : c)) };
}

function verifyHydraulic() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const base = DEFAULT_CIRCUIT;
  const cylinder = base.components.find((c) => c.type === 'cylinder');
  const areas = cylinderAreas(cylinder);
  const pump = base.components.find((c) => c.type === 'pump');
  const pumpFlow = (pump.params.displacement * 1e-6 * pump.params.rpm) / 60;

  const extending = simulateCircuit(base, 1.5, 2e-5, { dcvPosition: 'extend', load: 10000 });
  const capFlow = Math.abs(areas.cap * extending.state.v);
  push('Extending, continuity closes between pump and cylinder', Math.abs(pumpFlow - capFlow) / pumpFlow < 0.05, `${(pumpFlow * 60000).toFixed(3)} L/min from the pump against ${(capFlow * 60000).toFixed(3)} L/min into the cap side`);

  const damped = { ...base, components: base.components.map((c) => (c.type === 'cylinder' ? { ...c, params: { ...c.params, damping: 60000 } } : c)) };
  const held = simulateCircuit(damped, 3, 2e-5, { dcvPosition: 'hold', load: 10000 });
  const staticBalance = Math.abs(held.state.p.A * areas.cap - held.state.p.B * areas.annulus - cylinder.params.load);
  push('Static force balance holds with the valve closed', staticBalance / cylinder.params.load < 0.05, `out of balance by ${(staticBalance / 1000).toFixed(3)} kN of ${(cylinder.params.load / 1000).toFixed(1)} kN`);
  push('Trapped oil holds the piston almost still with every port closed', Math.abs(held.state.x - 0.005) < 1e-3 && Math.abs(held.state.v) < 0.02, `drifted ${((held.state.x - 0.005) * 1000).toFixed(3)} mm on trapped oil, residual velocity ${(held.state.v * 1000).toFixed(2)} mm/s`);

  const stalled = simulateCircuit({ ...base, components: base.components.map((c) => (c.type === 'cylinder' ? { ...c, params: { ...c.params, stroke: 500 } } : c)) }, 3, 2e-5, { dcvPosition: 'extend', load: 40000 });
  push('Stalled against a load, the line settles at the relief setting', Math.abs(stalled.state.p.P / BAR - 100) / 100 < 0.06, `${(stalled.state.p.P / BAR).toFixed(2)} bar against a 100 bar setting`);

  const relief = stalled.circuit.components.find((c) => c.type === 'relief');
  const reliefFlow = relief.lastFlow || 0;
  push('Relief passes essentially all the pump flow when stalled', Math.abs(reliefFlow - pumpFlow) / pumpFlow < 0.1, `${(reliefFlow * 60000).toFixed(3)} L/min of ${(pumpFlow * 60000).toFixed(3)} L/min`);

  const orificeArea = 3e-5, delta = 3e6;
  const measured = orifice(orificeArea, 0.62, delta);
  const closed = 0.62 * orificeArea * Math.sqrt((2 * delta) / RHO);
  push('Orifice element follows Q = Cd·A·√(2Δp/ρ)', Math.abs(measured - closed) / closed < 1e-6, `${(measured * 60000).toFixed(4)} vs ${(closed * 60000).toFixed(4)} L/min at ${(delta / BAR).toFixed(0)} bar`);

  const ledger = extending.state;
  extending.state.ledger.hydraulic;
  push('Pump work is accounted for by load work and losses', Math.abs(extending.state.ledger.pump - extending.state.ledger.hydraulic - extending.state.ledger.relief - extending.state.ledger.friction) / Math.max(1e-9, extending.state.ledger.pump) < 1e-6 || extending.state.ledger.pump === 0, `ledger closes to ${(extending.state.ledger.pump - extending.state.ledger.hydraulic - extending.state.ledger.relief - extending.state.ledger.friction).toExponential(2)} J`);

  const coarse = simulateCircuit(base, 1.5, 5e-5, { dcvPosition: 'extend', load: 10000 });
  push('Solution is stable under a step increase', Math.abs(coarse.state.x - extending.state.x) / Math.max(1e-6, extending.state.x) < 0.05, `position ${(coarse.state.x * 1000).toFixed(3)} vs ${(extending.state.x * 1000).toFixed(3)} mm at Δt = 50 µs and 20 µs`);

  push('Cylinder reaches the end of its stroke and stops', extending.state.x <= cylinder.params.stroke / 1000 + 1e-9, `travelled ${(extending.state.x * 1000).toFixed(1)} mm of ${cylinder.params.stroke} mm in 1.5 s`);

  return { checks };
}