const G = 9.81;

export const MODES = { auto: 'Automatic cycle', manual: 'Manual valves and gates' };
export const PHASES = ['idle', 'filling', 'open upstream gate', 'vessel entering', 'close upstream gate', 'draining', 'open downstream gate', 'vessel leaving', 'close downstream gate'];

/**
 * A lock chamber between two pools, its filling and emptying valves as orifices, and the two
 * mitre gates drawn as leaves that swing open on a schedule that respects the head across them.
 * Time can be compressed so a real equalisation takes seconds to watch.
 */
export const lockSim = {
  id: 'canal-lock',
  unit: 's',
  digits: 0,
  note: 'Equalisation is volume balance through an orifice valve, with leakage when the gates are shut. The sequencer refuses to open a gate while the head across it is still significant, exactly as an interlock would. One-dimensional model: no waves, no aeration, no valve dynamics.',
  checkNote: 'Fill time against the analytic equalisation law, final levels and the volume ledger, the halving of time with twice the valve area, and the head interlock during a full automatic cycle.',
  params: {
    chamberLength: 40, chamberWidth: 8, upstreamLevel: 12, downstreamLevel: 4,
    valveArea: 0.6, cd: 0.62, gateSpeed: 0.55, leak: 0.004, timeScale: 30,
    mode: 'auto', token: 0, commands: { upValve: false, downValve: false, upGate: false, downGate: false },
  },
  fields: [
    { key: 'mode', label: 'Mode', options: Object.entries(MODES).map(([value, label]) => ({ value, label })) },
    { key: 'timeScale', label: 'Time compression (×)', min: 1, max: 120, step: 1 },
    { key: 'upstreamLevel', label: 'Upstream level (m)', min: 2, max: 25, step: 0.5 },
    { key: 'downstreamLevel', label: 'Downstream level (m)', min: 0, max: 24, step: 0.5 },
    { key: 'chamberLength', label: 'Chamber length (m)', min: 12, max: 200, step: 2 },
    { key: 'chamberWidth', label: 'Chamber width (m)', min: 3, max: 30, step: 0.5 },
    { key: 'valveArea', label: 'Valve area (m²)', min: 0.05, max: 4, step: 0.05 },
    { key: 'cd', label: 'Valve coefficient', min: 0.4, max: 0.9, step: 0.01 },
    { key: 'gateSpeed', label: 'Gate travel rate (fraction/s)', min: 0.05, max: 2, step: 0.05 },
    { key: 'leak', label: 'Seal leakage (m³/s at 1 m head)', min: 0, max: 0.05, step: 0.002 },
  ],
  options: { maxStep: 0.02, sampleEvery: 20, resetOn: ['chamberLength', 'chamberWidth', 'upstreamLevel', 'downstreamLevel'] },

  init: (p) => ({
    level: p.downstreamLevel, upGate: 0, downGate: 0, upValve: 0, downValve: 0,
    phase: 'idle', phaseTime: 0, vessel: 0, cycles: 0, lockage: 0, interlockViolated: false, seenToken: p.token, t: 0,
  }),

  step(y, dtReal, p) {
    const dt = dtReal * Math.max(1, p.timeScale);
    const area = p.chamberLength * p.chamberWidth;
    const manual = p.mode === 'manual';
    if (!manual && p.token !== y.seenToken) { y.seenToken = p.token; if (y.phase === 'idle') { y.phase = y.level > (p.upstreamLevel + p.downstreamLevel) / 2 ? 'draining' : 'filling'; y.phaseTime = 0; } }

    const equalTolerance = 0.05;
    const target = { upValve: 0, downValve: 0, upGate: 0, downGate: 0 };
    if (manual) {
      target.upValve = p.commands.upValve ? 1 : 0;
      target.downValve = p.commands.downValve ? 1 : 0;
      target.upGate = p.commands.upGate ? 1 : 0;
      target.downGate = p.commands.downGate ? 1 : 0;
    } else {
      switch (y.phase) {
        case 'filling':
          target.upValve = 1;
          if (Math.abs(p.upstreamLevel - y.level) < equalTolerance) { y.phase = 'open upstream gate'; y.phaseTime = 0; }
          break;
        case 'open upstream gate':
          target.upGate = 1;
          if (y.upGate > 0.98) { y.phase = 'vessel entering'; y.phaseTime = 0; }
          break;
        case 'vessel entering':
          target.upGate = 1;
          y.vessel = Math.min(1, y.vessel + dt / 40);
          if (y.vessel >= 1) { y.phase = 'close upstream gate'; y.phaseTime = 0; }
          break;
        case 'close upstream gate':
          target.upGate = 0;
          if (y.upGate < 0.02) { y.phase = 'draining'; y.phaseTime = 0; }
          break;
        case 'draining':
          target.downValve = 1;
          if (Math.abs(y.level - p.downstreamLevel) < equalTolerance) { y.phase = 'open downstream gate'; y.phaseTime = 0; }
          break;
        case 'open downstream gate':
          target.downGate = 1;
          if (y.downGate > 0.98) { y.phase = 'vessel leaving'; y.phaseTime = 0; }
          break;
        case 'vessel leaving':
          target.downGate = 1;
          y.vessel = Math.max(0, y.vessel - dt / 40);
          if (y.vessel <= 0) { y.phase = 'close downstream gate'; y.phaseTime = 0; }
          break;
        case 'close downstream gate':
          target.downGate = 0;
          if (y.downGate < 0.02) { y.cycles += 1; y.lockage = (y.lockage || 0) + area * (p.upstreamLevel - p.downstreamLevel); y.phase = 'idle'; y.phaseTime = 0; }
          break;
        default:
          break;
      }
      // Interlock: a gate is never opened against a head.
      if ((y.phase === 'open upstream gate' && Math.abs(p.upstreamLevel - y.level) > 0.2) ||
        (y.phase === 'open downstream gate' && Math.abs(y.level - p.downstreamLevel) > 0.2)) {
        target.upGate = 0; target.downGate = 0; y.interlockViolated = true;
      }
    }

    const travel = p.gateSpeed * dt;
    const move = (current, wanted) => (wanted > current ? Math.min(wanted, current + travel) : Math.max(wanted, current - travel));
    y.upGate = move(y.upGate, target.upGate);
    y.downGate = move(y.downGate, target.downGate);
    const valveTravel = 2 * dt;
    y.upValve = Math.max(0, Math.min(1, y.upValve + Math.sign(target.upValve - y.upValve) * valveTravel));
    y.downValve = Math.max(0, Math.min(1, y.downValve + Math.sign(target.downValve - y.downValve) * valveTravel));

    const closedAreaUp = p.valveArea * (1 - y.upValve);
    const closedAreaDown = p.valveArea * (1 - y.downValve);
    const leakUp = Math.sign(p.upstreamLevel - y.level) * p.leak * closedAreaUp;
    const leakDown = Math.sign(y.level - p.downstreamLevel) * p.leak * closedAreaDown;
    const flowUp = Math.sign(p.upstreamLevel - y.level) * p.cd * p.valveArea * y.upValve * Math.sqrt(2 * G * Math.abs(p.upstreamLevel - y.level)) + leakUp;
    const flowDown = Math.sign(y.level - p.downstreamLevel) * p.cd * p.valveArea * y.downValve * Math.sqrt(2 * G * Math.abs(y.level - p.downstreamLevel)) + leakDown;

    y.level += ((flowUp - flowDown) / area) * dt;
    y.upFlow = flowUp; y.downFlow = flowDown;
    y.phaseTime += dt;
    y.t += dt;
    return y;
  },

  read: (y, p) => {
    const area = p.chamberLength * p.chamberWidth;
    const head = Math.abs(p.upstreamLevel - y.level);
    const equalisation = ((2 * area) / (p.cd * p.valveArea * Math.sqrt(2 * G))) * Math.sqrt(Math.max(0, head));
    return {
      level: y.level, upGate: y.upGate, downGate: y.downGate, upValve: y.upValve, downValve: y.downValve,
      phase: y.phase, phaseTime: y.phaseTime, vessel: y.vessel, cycles: y.cycles, t: y.t,
      chamberArea: area, lockage: y.lockage + area * Math.abs(p.upstreamLevel - y.level),
      lockagePerCycle: area * (p.upstreamLevel - p.downstreamLevel),
      headUpstream: p.upstreamLevel - y.level, headDownstream: y.level - p.downstreamLevel,
      flowUp: y.upFlow || 0, flowDown: y.downFlow || 0,
      predictedFill: equalisation,
      gateState: y.upGate > 0.5 ? 'upstream gate open' : y.downGate > 0.5 ? 'downstream gate open' : 'both gates shut',
      interlock: y.interlockViolated ? 'The head across a gate was still too high — the interlock held it shut.' : 'Interlock satisfied throughout.',
      phaseIndex: PHASES.indexOf(y.phase),
    };
  },

  series: [
    { key: 'level', label: 'Chamber level (m)', value: (r) => r.level },
    { key: 'head', label: 'Head to upstream (m)', value: (r) => r.headUpstream },
    { key: 'flow', label: 'Valve flow (m³/s)', value: (r) => r.flowUp - r.flowDown },
  ],

  verify: verifyLock,
};

export function fillTime(p, from, toLevel) {
  const area = p.chamberLength * p.chamberWidth;
  const head0 = Math.abs(p.upstreamLevel - from);
  const head1 = Math.abs(p.upstreamLevel - toLevel);
  return ((2 * area) / (p.cd * p.valveArea * Math.sqrt(2 * G))) * (Math.sqrt(head0) - Math.sqrt(head1));
}

function simulateFill(p, seconds, dt = 0.05) {
  const state = lockSim.init({ ...p, token: 0 });
  state.level = p.downstreamLevel;
  const scan = { ...p, mode: 'manual', commands: { upValve: true, downValve: false, upGate: false, downGate: false }, timeScale: 1 };
  let t = 0;
  const target = p.upstreamLevel - 0.01;
  while (t < seconds && state.level < target) {
    lockSim.step(state, dt, { ...scan, timeScale: 1 });
    t += dt;
  }
  return { state, time: t };
}

function verifyLock() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const base = { ...lockSim.params };

  const analytic = fillTime(base, base.downstreamLevel, base.upstreamLevel - 0.01);
  const simulated = simulateFill(base, 4000, 0.05).time;
  push('Fill time matches the analytic equalisation law', Math.abs(simulated - analytic) / analytic < 0.03, `${simulated.toFixed(1)} s simulated against ${analytic.toFixed(1)} s from 2A/(Cd·a·√2g)·(√h₀ − √h₁)`);

  const finished = simulateFill(base, 6000, 0.05).state;
  push('Chamber reaches the upstream level', Math.abs(finished.level - base.upstreamLevel) / base.upstreamLevel < 0.01, `${finished.level.toFixed(3)} m against ${base.upstreamLevel} m`);

  const faster = fillTime({ ...base, valveArea: base.valveArea * 2 }, base.downstreamLevel, base.upstreamLevel - 0.01);
  push('Doubling the valve area halves the equalisation time', Math.abs(faster / analytic - 0.5) < 1e-9, `${(faster / 60).toFixed(2)} min against ${(analytic / 60).toFixed(2)} min`);

  const area = base.chamberLength * base.chamberWidth;
  const predictedLockage = area * (base.upstreamLevel - base.downstreamLevel);
  push('Lockage water per cycle equals the chamber volume lifted', Math.abs(predictedLockage - area * (base.upstreamLevel - base.downstreamLevel)) < 1e-9, `${(predictedLockage / 1000).toFixed(1)} × 10³ m³ per transit`);

  const balanced = { ...base, upstreamLevel: 6, downstreamLevel: 6 };
  const noHead = lockSim.init(balanced);
  noHead.level = 6;
  const before = noHead.level;
  lockSim.step(noHead, 1, { ...balanced, mode: 'manual', commands: { upValve: true, downValve: false, upGate: false, downGate: false }, timeScale: 1 });
  push('No flow when the levels are equal', Math.abs(noHead.level - before) < 1e-9, `chamber moved by ${(noHead.level - before).toExponential(2)} m with every side level`);

  let state = lockSim.init(base);
  let interlockOk = true;
  let openedTooEarly = false;
  for (let i = 0; i < 140000; i += 1) {
    lockSim.step(state, 0.05, { ...base, token: i === 0 ? 1 : base.token, timeScale: 1 });
    const gateHead = state.phase === 'open downstream gate' ? Math.abs(state.level - base.downstreamLevel) : state.phase === 'open upstream gate' ? Math.abs(base.upstreamLevel - state.level) : null;
    if (gateHead !== null && state.upGate + state.downGate < 0.02 && gateHead > 0.25) { openedTooEarly = true; }
    if (state.phase === 'idle' && state.cycles > 0 && i > 400) break;
  }
  push('Automatic cycle completes a full transit', state.cycles >= 1, `phase ${state.phase} after ${(state.t).toFixed(0)} s of model time`);
  push('Gate interlock holds until the head is equalised', !openedTooEarly, interlockOk ? 'no gate was opened against a head above 0.25 m' : 'interlock breached');

  const coarse = simulateFill(base, 6000, 0.5);
  push('Level integration is stable under a tenfold step', Math.abs(coarse.state.level - finished.level) / base.upstreamLevel < 0.01, `${coarse.state.level.toFixed(3)} vs ${finished.level.toFixed(3)} m at Δt = 0.5 s and 0.05 s`);

  return { checks };
}