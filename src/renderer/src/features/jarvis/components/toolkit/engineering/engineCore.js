const TAU = Math.PI * 2;
const R_AIR = 287;
const LHV = 44e6;
const AFR = 14.7;

/** Slider-crank geometry. θ is measured from top dead centre, x from the crank axis. */
export function pistonFromCrank(theta, crankRadius, rodLength) {
  return crankRadius * Math.cos(theta) + Math.sqrt(rodLength ** 2 - (crankRadius * Math.sin(theta)) ** 2);
}

export function geometry(p) {
  const r = p.stroke / 2000;          // crank radius, m
  const l = p.rod / 1000;             // connecting rod, m
  const bore = p.bore / 1000;
  const area = (Math.PI / 4) * bore ** 2;
  const displacement = area * 2 * r;
  const clearance = displacement / (p.compressionRatio - 1);
  return { r, l, area, displacement, clearance, top: r + l, bottom: l - r };
}

export function cylinderVolume(theta, p) {
  const g = geometry(p);
  return g.clearance + g.area * (g.top - pistonFromCrank(theta, g.r, g.l));
}

export function dVolumeDTheta(theta, p) {
  const g = geometry(p);
  const root = Math.sqrt(g.l ** 2 - (g.r * Math.sin(theta)) ** 2);
  const dx = -g.r * Math.sin(theta) - (g.r ** 2 * Math.sin(theta) * Math.cos(theta)) / root;
  return -g.area * dx;
}

/** Poppet lift inside its open window, as a sine bump. */
export function valveLift(theta, openDeg, closeDeg, maxLift) {
  let span = closeDeg - openDeg;
  let deg = ((((theta * 180) / Math.PI) % 360) + 360) % 360;
  if (openDeg > closeDeg) span += 360;
  let travel = deg - openDeg;
  if (travel < 0) travel += 360;
  if (travel > span || span <= 0) return 0;
  return maxLift * Math.sin((Math.PI * travel) / span);
}

export const valveEvents = (p) => ({
  intake: { open: -8, close: 215, lift: p.bore * 0.24 },
  exhaust: { open: 498, close: 730, lift: p.bore * 0.22 },
});

/** Trapped air mass from a throttled intake, then the fuel energy that air can burn. */
export function charge(p) {
  const g = geometry(p);
  const intakePressure = 1e5 * (0.25 + 0.75 * p.throttle);
  const air = (intakePressure * g.displacement * p.volumetric) / (R_AIR * (273 + p.ambient));
  const fuel = air / AFR;
  return { intakePressure, air, fuel, heat: fuel * LHV * 0.96, mass: air + fuel };
}

export function wiebeRate(theta, theta0, duration, heat, a = 5, m = 2) {
  const x = (theta - theta0) / duration;
  if (x <= 0 || x >= 1) return 0;
  return (heat * (a * (m + 1) * x ** m * Math.exp(-a * x ** (m + 1)))) / duration;
}

export const wiebeFraction = (a = 5) => 1 - Math.exp(-a);

function frictionMean(p) {
  const rpm = p.rpm / 1000;
  return (0.97 + 0.15 * rpm + 0.05 * rpm * rpm) * 1e5; // Pa, Heywood's SI correlation
}

/**
 * One full cycle integrated from a given crank-angle resolution. The animated simulator
 * advances the same equations incrementally; this routine exists so the cycle integrals can
 * be recomputed at any resolution for the checks.
 */
export function simulateCycle(p, stepDeg = 0.25, options = {}) {
  const combustion = options.combustion !== false;
  const g = geometry(p);
  const { intakePressure, heat } = charge(p);
  const exhaustPressure = 1.05e5 + 0.25e5 * p.throttle;
  const ignition = TAU - (p.advance * Math.PI) / 180;
  const duration = (p.duration * Math.PI) / 180;
  const h = (stepDeg * Math.PI) / 180;
  let theta = 0, pressure = intakePressure, released = 0;
  let work = 0, closedWork = 0, compressionWork = 0, peak = { p: pressure, deg: 0 };
  const samples = [];
  while (theta < TAU * 2 - h / 2) {
    const volume = cylinderVolume(theta, p);
    const dv = dVolumeDTheta(theta, p);
    const closed = theta >= Math.PI && theta < 3 * Math.PI;
    let dp = 0;
    if (!closed) {
      pressure = theta < Math.PI ? intakePressure : exhaustPressure;
    } else {
      const dq = combustion ? wiebeRate(theta, ignition, duration, heat) : 0;
      released += dq * h;
      dp = ((p.gamma - 1) * dq - p.gamma * pressure * dv) / volume;
      pressure += dp * h;
    }
    const dw = pressure * dv * h;
    work += dw;
    if (closed) {
      closedWork += dw;
      if (theta < 2 * Math.PI) compressionWork += dw;
    }
    if (pressure > peak.p) peak = { p: pressure, deg: (theta * 180) / Math.PI };
    const sampleDeg = Math.floor((theta * 180) / Math.PI);
    const lastDeg = samples.length ? samples[samples.length - 1].deg : -1;
    if (sampleDeg > lastDeg && samples.length < 4000) samples.push({ deg: sampleDeg, p: pressure / 1e5, v: volume * 1e6 });
    theta += h;
  }
  const indicator = closedWork / g.displacement;
  const pumping = (work - closedWork) / g.displacement;
  const friction = frictionMean(p);
  const cycle = {
    imep: (indicator - pumping) / 1e5,
    gross: indicator / 1e5,
    pmep: pumping / 1e5,
    fmep: friction / 1e5,
    bmep: (indicator - pumping - friction) / 1e5,
    work,
    closedWork,
    compressionWork,
    released,
    peak: peak.p / 1e5,
    peakDeg: peak.deg,
    samples,
    friction,
  };
  cycle.torque = (work - friction * g.displacement) / (4 * Math.PI);
  cycle.power = (cycle.torque * p.rpm * TAU) / 60;
  cycle.efficiency = charge(p).heat > 0 ? closedWork / charge(p).heat : 0;
  return cycle;
}

export const engineSim = {
  id: 'four-stroke-engine',
  unit: 's',
  digits: 3,
  note: 'Slider-crank kinematics with a single-zone cylinder: polytropic compression and expansion, Wiebe heat release timed by the ignition advance, and a Heywood friction correlation. Idealised model — no knock, no valve flow restriction, no heat transfer to the walls, one zone.',
  checkNote: 'Crank kinematics and their derivative, the exact compression ratio, pV^γ preservation without combustion, the isentropic work closed form, the Wiebe integral, the Otto limit and grid refinement.',
  params: {
    bore: 80, stroke: 90, rod: 160, compressionRatio: 10, rpm: 1200,
    advance: 24, duration: 45, throttle: 0.8, gamma: 1.32, volumetric: 0.9, ambient: 25,
  },
  fields: [
    { key: 'rpm', label: 'Engine speed (rpm)', min: 500, max: 6000, step: 50 },
    { key: 'throttle', label: 'Throttle (0–1)', min: 0.1, max: 1, step: 0.05 },
    { key: 'advance', label: 'Ignition advance (° BTDC)', min: 0, max: 45, step: 1 },
    { key: 'duration', label: 'Combustion duration (°)', min: 10, max: 90, step: 1 },
    { key: 'compressionRatio', label: 'Compression ratio', min: 6, max: 16, step: 0.1 },
    { key: 'bore', label: 'Bore (mm)', min: 50, max: 130, step: 1 },
    { key: 'stroke', label: 'Stroke (mm)', min: 50, max: 140, step: 1 },
    { key: 'rod', label: 'Connecting rod (mm)', min: 100, max: 260, step: 2 },
    { key: 'gamma', label: 'Ratio of specific heats γ', min: 1.25, max: 1.4, step: 0.01 },
    { key: 'volumetric', label: 'Volumetric efficiency', min: 0.6, max: 1, step: 0.02 },
    { key: 'ambient', label: 'Inlet temperature (°C)', min: 0, max: 60, step: 1 },
  ],
  options: { maxStep: 1 / 20000, sampleEvery: 0.02, resetOn: ['compressionRatio', 'bore', 'stroke', 'rod'] },

  init: (p) => ({
    theta: 0, pressure: charge(p).intakePressure, released: 0,
    work: 0, closedWork: 0, peak: 0, peakDeg: 0, next: 2, trace: [],
    cycle: simulateCycle(p, 1), cycles: 0,
  }),

  step(y, dt, p) {
    const g = geometry(p);
    const { intakePressure, heat } = charge(p);
    const exhaustPressure = 1.05e5 + 0.25e5 * p.throttle;
    const ignition = TAU - (p.advance * Math.PI) / 180;
    const duration = (p.duration * Math.PI) / 180;
    let theta = y.theta;
    let pressure = y.pressure;
    const dTheta = ((p.rpm * TAU) / 60) * dt;
    const steps = Math.max(1, Math.ceil(dTheta / 0.004));
    const h = dTheta / steps;
    for (let i = 0; i < steps; i += 1) {
      const volume = cylinderVolume(theta, p);
      const dv = dVolumeDTheta(theta, p);
      const closed = theta >= Math.PI && theta < 3 * Math.PI;
      if (!closed) {
        pressure = theta < Math.PI ? intakePressure : exhaustPressure;
      } else {
        const dq = wiebeRate(theta, ignition, duration, heat);
        y.released += dq * h;
        pressure += (((p.gamma - 1) * dq - p.gamma * pressure * dv) / volume) * h;
      }
      const dw = pressure * dv * h;
      y.work += dw;
      if (closed) y.closedWork += dw;
      if (pressure > y.peak) { y.peak = pressure; y.peakDeg = (theta * 180) / Math.PI; }
      theta += h;
      while (y.trace.length && theta < (y.trace[y.trace.length - 1].deg * Math.PI) / 180 - 1) y.trace.shift();
      const deg = (theta * 180) / Math.PI;
      if (deg >= y.next) { y.trace.push({ deg, p: pressure / 1e5, v: volume * 1e6 }); y.next = deg + 2; }
      if (theta >= TAU * 2) {
        const friction = frictionMean(p);
        y.cycle = {
          imep: y.closedWork / g.displacement / 1e5,
          gross: y.closedWork / g.displacement / 1e5,
          pmep: (y.work - y.closedWork) / g.displacement / 1e5,
          fmep: friction / 1e5,
          bmep: (y.work - friction * g.displacement) / g.displacement / 1e5,
          work: y.work, closedWork: y.closedWork, released: y.released,
          peak: y.peak / 1e5, peakDeg: y.peakDeg, torque: (y.work - friction * g.displacement) / (4 * Math.PI),
          power: (((y.work - friction * g.displacement) / (4 * Math.PI)) * ((p.rpm * TAU) / 60)) / 1000,
          efficiency: charge(p).heat > 0 ? y.closedWork / charge(p).heat : 0,
        };
        y.cycles = (y.cycles || 0) + 1;
        theta -= TAU * 2; y.work = 0; y.closedWork = 0; y.released = 0; y.peak = pressure; y.peakDeg = 0; y.next = 2; y.trace = [];
      }
    }
    y.theta = theta; y.pressure = pressure;
    return y;
  },

  read(y, p) {
    const g = geometry(p);
    const deg = (y.theta * 180) / Math.PI;
    const { intakePressure, heat, fuel, air } = charge(p);
    const events = valveEvents(p);
    const friction = frictionMean(p);
    const cycle = y.cycle;
    const cyclesPerSecond = p.rpm / 120;
    return {
      thetaDeg: deg,
      stage: deg < 180 ? 'Intake' : deg < 360 ? 'Compression' : deg < 540 ? 'Power' : 'Exhaust',
      pressure: y.pressure,
      pressureBar: y.pressure / 1e5,
      volume: cylinderVolume(y.theta, p),
      volumeCc: cylinderVolume(y.theta, p) * 1e6,
      displacementCc: g.displacement * 1e6,
      intakePressure,
      exhaustPressure: 1.05e5 + 0.25e5 * p.throttle,
      intakeLift: valveLift(y.theta, events.intake.open, events.intake.close, events.intake.lift),
      exhaustLift: valveLift(y.theta, events.exhaust.open, events.exhaust.close, events.exhaust.lift),
      piston: pistonFromCrank(y.theta, g.r, g.l),
      instantaneousTorque: (y.pressure - 1e5) * g.area * -dVolumeDTheta(y.theta, p),
      imep: cycle.imep, pmep: cycle.pmep, fmep: cycle.fmep, bmep: cycle.bmep,
      indicatedWork: cycle.closedWork,
      released: cycle.released,
      peakPressure: cycle.peak,
      peakAngle: cycle.peakDeg,
      brakeTorque: cycle.torque,
      brakePower: cycle.power,
      efficiency: cycle.efficiency,
      ottoLimit: 1 - Math.pow(p.compressionRatio, 1 - p.gamma),
      fuelMass: fuel,
      airMass: air,
      bsfc: cycle.power > 0 ? (fuel * cyclesPerSecond * 3.6e6) / cycle.power : 0,
      friction,
      cycles: y.cycles || 0,
      trace: y.trace,
      meanPistonSpeed: (2 * p.stroke * p.rpm) / 60000,
      heat,
      cyclesPerSecond,
    };
  },

  series: [
    { key: 'pressure', label: 'Cylinder pressure (bar)', value: (r) => r.pressureBar },
    { key: 'torque', label: 'Torque (N·m)', value: (r) => r.instantaneousTorque },
    { key: 'power', label: 'Brake power (kW)', value: (r) => r.brakePower },
  ],

  verify: verifyEngine,
};

function verifyEngine() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const base = { ...engineSim.params };
  const g = geometry(base);
  const { intakePressure, heat } = charge(base);

  const atTop = pistonFromCrank(0, g.r, g.l);
  const atBottom = pistonFromCrank(Math.PI, g.r, g.l);
  push('Piston reaches the exact top and bottom of its travel', Math.abs(atTop - g.top) < 1e-12 && Math.abs(atBottom - g.bottom) < 1e-12, `${(atTop * 1000).toFixed(4)} mm and ${(atBottom * 1000).toFixed(4)} mm`);
  const h = 1e-6;
  push('Piston velocity is zero at both dead centres', Math.abs(pistonFromCrank(h, g.r, g.l) - pistonFromCrank(-h, g.r, g.l)) < 1e-12 && Math.abs(pistonFromCrank(Math.PI + h, g.r, g.l) - pistonFromCrank(Math.PI - h, g.r, g.l)) < 1e-12, 'central difference at 0° and 180°');

  const ratio = cylinderVolume(Math.PI, base) / cylinderVolume(0, base);
  push('Volume ratio reproduces the compression ratio', Math.abs(ratio - base.compressionRatio) < 1e-9, `${ratio.toFixed(6)} vs ${base.compressionRatio}`);

  const cold = simulateCycle({ ...base, throttle: 1 }, 0.05, { combustion: false });
  const p1 = cold.samples.find((s) => s.deg >= 181).p;
  const p2 = cold.samples.find((s) => s.deg >= 359).p;
  const v1 = cold.samples.find((s) => s.deg >= 181).v;
  const v2 = cold.samples.find((s) => s.deg >= 359).v;
  const gammaResidual = Math.abs(p1 * Math.pow(v1, base.gamma) - p2 * Math.pow(v2, base.gamma)) / (p1 * Math.pow(v1, base.gamma));
  push('Compression follows pV^γ with no heat release', gammaResidual < 5e-3, `relative drift ${gammaResidual.toExponential(2)}`);

  const isentropic = ((p1 * 1e5 * v1 * 1e-6) - (p2 * 1e5 * v2 * 1e-6)) / (base.gamma - 1);
  push('Compression work matches the isentropic closed form', Math.abs(cold.compressionWork - isentropic) / Math.abs(isentropic) < 1e-2, `${cold.compressionWork.toFixed(3)} vs ${isentropic.toFixed(3)} J`);

  const fired = simulateCycle(base, 0.25);
  const analytic = heat * wiebeFraction();
  push('Released heat matches the analytic Wiebe integral', Math.abs(fired.released - analytic) / analytic < 1e-3, `${fired.released.toFixed(2)} vs ${analytic.toFixed(2)} J`);
  const otto = 1 - Math.pow(base.compressionRatio, 1 - base.gamma);
  push('Indicated efficiency stays under the Otto limit', fired.efficiency < otto && fired.efficiency > 0, `${(fired.efficiency * 100).toFixed(2)}% against the ${(otto * 100).toFixed(2)}% Otto ceiling`);

  const coarse = simulateCycle(base, 0.25);
  const fine = simulateCycle(base, 0.0625);
  push('Cycle integrals converge under grid refinement', Math.abs(coarse.imep - fine.imep) / fine.imep < 0.015, `${coarse.imep.toFixed(4)} vs ${fine.imep.toFixed(4)} bar at 0.25° and 0.0625°`);

  push('Pumping loop is a loss when the exhaust is above the intake', fired.pmep < 0, `PMEP ${fired.pmep.toFixed(3)} bar with ${(intakePressure / 1e5).toFixed(2)} bar intake`);

  const throttled = simulateCycle({ ...base, throttle: 0.25 }, 0.5);
  push('Closing the throttle lowers both peak pressure and load', throttled.peak < fired.peak && throttled.imep < fired.imep, `${throttled.peak.toFixed(1)} vs ${fired.peak.toFixed(1)} bar peak`);

  push('Firing leaves the pressure well above motoring', fired.peak > cold.peak * 2, `${fired.peak.toFixed(1)} bar fired vs ${cold.peak.toFixed(1)} bar motored`);

  return { checks };
}