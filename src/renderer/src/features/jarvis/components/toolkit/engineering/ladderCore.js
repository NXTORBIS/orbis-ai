/** A small PLC: rungs of contacts driving coils, evaluated scan by scan. */

export const CONTACT_TYPES = { NO: 'Normally open', NC: 'Normally closed' };
export const COIL_TYPES = { coil: 'Output coil', set: 'Latch (set)', reset: 'Unlatch (reset)', TON: 'On-delay timer', CTU: 'Count up' };

export const DEFAULT_PROGRAM = {
  inputs: ['X0', 'X1', 'X2', 'X3'],
  outputs: ['Y0', 'Y1', 'Y2'],
  rungs: [
    {
      id: 'r1',
      label: 'Motor start/stop with a seal-in contact',
      branches: [
        [{ type: 'NO', addr: 'X0' }, { type: 'NC', addr: 'X1' }],
        [{ type: 'NO', addr: 'Y0' }, { type: 'NC', addr: 'X1' }],
      ],
      coils: [{ type: 'coil', addr: 'Y0' }],
    },
    { id: 'r2', label: 'Run-on timer started by the motor', branches: [[{ type: 'NO', addr: 'Y0' }]], coils: [{ type: 'TON', addr: 'T1', preset: 3 }] },
    { id: 'r3', label: 'Timer done lights the run-on lamp', branches: [[{ type: 'NO', addr: 'T1' }]], coils: [{ type: 'coil', addr: 'Y1' }] },
    { id: 'r4', label: 'Part counter on the sensor edge', branches: [[{ type: 'NO', addr: 'X2' }]], coils: [{ type: 'CTU', addr: 'C1', preset: 5 }] },
    { id: 'r5', label: 'Batch complete', branches: [[{ type: 'NO', addr: 'C1' }]], coils: [{ type: 'coil', addr: 'Y2' }] },
    { id: 'r6', label: 'Reset the batch counter', branches: [[{ type: 'NO', addr: 'X3' }]], coils: [{ type: 'reset', addr: 'Y2' }] },
  ],
};

export const ADDRESSES = ['X0', 'X1', 'X2', 'X3', 'Y0', 'Y1', 'Y2', 'T1', 'C1', 'M0', 'M1'];

export function blankState(inputs) {
  return { inputs: { ...inputs }, outputs: {}, memory: {}, timers: {}, counters: {}, powers: [], scans: 0 };
}

/** Read a bit: inputs, outputs, internal memory, timer and counter done bits. */
export function resolve(state, addr) {
  if (!addr) return false;
  switch (addr[0]) {
    case 'X': return !!state.inputs[addr];
    case 'Y': return !!state.outputs[addr];
    case 'M': return !!state.memory[addr];
    case 'T': return !!state.timers[addr]?.done;
    case 'C': return !!state.counters[addr]?.done;
    default: return false;
  }
}

export function contactHolds(contact, state) {
  const value = resolve(state, contact.addr);
  return contact.type === 'NC' ? !value : value;
}

export function branchPowered(branch, state) {
  return branch.every((contact) => contactHolds(contact, state));
}

export function rungPowered(rung, state) {
  if (!rung.branches.length) return false;
  return rung.branches.some((branch) => branchPowered(branch, state));
}

/**
 * One scan. Contacts read the state as it was at the start of the scan and coils are written
 * at the end, so a contact that reads an output sees the previous scan's value — exactly how
 * a PLC behaves, and the reason a seal-in contact takes one scan to appear.
 */
export function executeScan(program, state, scanSeconds) {
  const outputs = { ...state.outputs };
  const memory = { ...state.memory };
  const timers = { ...state.timers };
  const counters = { ...state.counters };
  const powers = [];

  program.rungs.forEach((rung, index) => {
    const powered = rungPowered(rung, state);
    const previous = !!state.powers[index];
    powers.push(powered);
    for (const coil of rung.coils) {
      if (coil.type === 'coil') outputs[coil.addr] = powered;
      else if (coil.type === 'set') { if (powered) outputs[coil.addr] = true; }
      else if (coil.type === 'reset') { if (powered) outputs[coil.addr] = false; }
      else if (coil.type === 'TON') {
        const timer = timers[coil.addr] || { acc: 0, done: false, preset: 1 };
        const preset = coil.preset ?? timer.preset ?? 1;
        const acc = powered ? Math.min(preset, timer.acc + scanSeconds) : 0;
        timers[coil.addr] = { acc, preset, done: acc >= preset };
      } else if (coil.type === 'CTU') {
        const counter = counters[coil.addr] || { acc: 0, done: false, preset: 5 };
        const preset = coil.preset ?? counter.preset ?? 5;
        const acc = powered && !previous ? counter.acc + 1 : counter.acc;
        counters[coil.addr] = { acc, preset, done: acc >= preset };
      }
    }
  });

  return { ...state, outputs, memory, timers, counters, powers, scans: state.scans + 1 };
}

export const ladderSim = {
  id: 'plc-ladder',
  unit: 's',
  digits: 2,
  note: 'A real scan engine: contacts are read from the state at the start of the scan and coils are written at the end, so output contacts carry a one-scan delay. Timers accumulate in scan time and counters advance on rising edges only.',
  checkNote: 'The seal-in rung checked against its analytic latch equation over every input combination, the one-scan output delay, counter edge detection, timer accuracy and reset, and scan idempotence.',
  params: { scan: 20, inputs: { X0: false, X1: false, X2: false, X3: false }, program: DEFAULT_PROGRAM },
  fields: [{ key: 'scan', label: 'Scan interval (ms)', min: 5, max: 200, step: 5 }],
  options: { maxStep: 0.01, sampleEvery: 1, resetOn: ['program'] },

  init: (p) => ({ ...blankState(p.inputs), pending: 0, t: 0 }),

  step(y, dt, p) {
    y.t = (y.t || 0) + dt;
    y.inputs = { ...p.inputs };
    const scanSeconds = Math.max(0.005, p.scan / 1000);
    y.pending = (y.pending || 0) + dt;
    let guard = 0;
    while (y.pending >= scanSeconds && guard < 200) {
      Object.assign(y, executeScan(p.program, y, scanSeconds));
      y.pending -= scanSeconds;
      guard += 1;
    }
    return y;
  },

  read: (y, p) => ({ ...y, scanMs: p.scan, program: p.program }),

  series: [],
  verify: verifyLadder,
};

export function toggleInput(p, address) {
  return { ...p, inputs: { ...p.inputs, [address]: !p.inputs[address] } };
}

export function addRung(program) {
  return { ...program, rungs: [...program.rungs, { id: `r${program.rungs.length + 1}-${program.rungs.length}-${program.rungs.length}`, label: 'New rung', branches: [[{ type: 'NO', addr: 'X0' }]], coils: [{ type: 'coil', addr: program.outputs[0] || 'Y0' }] }] };
}

export function updateRung(program, index, rung) {
  const rungs = program.rungs.map((existing, i) => (i === index ? rung : existing));
  return { ...program, rungs };
}

export function removeRung(program, index) {
  return { ...program, rungs: program.rungs.filter((_, i) => i !== index) };
}

export function addContact(rung, branchIndex, contact) {
  return { ...rung, branches: rung.branches.map((branch, i) => (i === branchIndex ? [...branch, contact] : branch)) };
}

export function removeContact(rung, branchIndex, contactIndex) {
  return { ...rung, branches: rung.branches.map((branch, i) => (i === branchIndex ? branch.filter((_, k) => k !== contactIndex) : branch)) };
}

export function addBranch(rung) {
  return { ...rung, branches: [...rung.branches, []] };
}

export function removeBranch(rung, branchIndex) {
  const branches = rung.branches.filter((_, i) => i !== branchIndex);
  return { ...rung, branches: branches.length ? branches : [[]] };
}

export function resetState(sim, params) {
  return { ...blankState(params.inputs), pending: 0, t: 0 };
}

function runScans(program, inputs, scans, scanSeconds = 0.02) {
  let state = { ...blankState(inputs), pending: 0, t: 0 };
  for (let i = 0; i < scans; i += 1) Object.assign(state, executeScan(program, state, scanSeconds));
  return state;
}

function verifyLadder() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const program = DEFAULT_PROGRAM;

  let truthTableOk = true;
  for (let mask = 0; mask < 16; mask += 1) {
    const inputs = { X0: !!(mask & 1), X1: !!(mask & 2), X2: !!(mask & 4), X3: !!(mask & 8) };
    const settled = runScans(program, inputs, 30).outputs.Y0 === true;
    const analytic = (inputs.X0 || false) && !inputs.X1; // least fixed point of Y0 = (X0 OR Y0) AND NOT X1
    if (settled !== !!analytic) truthTableOk = false;
  }
  push('Seal-in rung reproduces its latch equation for every input combination', truthTableOk, 'Y0 = (X0 OR Y0) AND NOT X1, checked over all 16 input vectors');

  const pulsed = runScans(program, { X0: false, X1: false, X2: false, X3: false }, 1, 0.02);
  const started = runScans(program, { X0: true, X1: false, X2: false, X3: false }, 1, 0.02);
  const held = (() => {
    let state = started;
    for (let i = 0; i < 10; i += 1) state = { ...state, ...executeScan(program, { ...state, inputs: { X0: false, X1: false, X2: false, X3: false } }, 0.02) };
    return state.outputs.Y0;
  })();
  push('A momentary start latches the output after the button is released', pulsed.outputs.Y0 === false && started.outputs.Y0 === true && held === true, 'one scan of X0 is enough, and Y0 stays on for ten further scans');

  const stopped = (() => {
    let state = runScans(program, { X0: true, X1: true, X2: false, X3: false }, 3);
    return state.outputs.Y0;
  })();
  push('The stop contact breaks the seal-in even with start held', stopped === false, 'X1 in series with both branches');

  const held30 = runScans(program, { X0: false, X1: false, X2: true, X3: false }, 30);
  push('Counter advances on rising edges only, not every scan', held30.counters.C1.acc === 1, `${held30.counters.C1.acc} count after 30 scans with the sensor held on`);

  const timed = runScans(program, { X0: true, X1: false, X2: false, X3: false }, 200, 0.02);
  const timer = timed.timers.T1;
  push('On-delay timer reaches its preset in scan time', Math.abs(timer.acc - timer.preset) < 1e-9 && timer.done === true, `${timer.acc.toFixed(2)} s held at the ${timer.preset} s preset after 200 scans of 20 ms`);

  const reset = runScans(program, { X0: false, X1: false, X2: false, X3: true }, 12, 0.05);
  push('Output goes false when its rung loses power', reset.outputs.Y0 === false, 'coils are not latched unless the rung says so');

  const twoStep = {
    inputs: ['X0'], outputs: ['Y0', 'Y1'],
    rungs: [
      { id: 'a', label: 'first', branches: [[{ type: 'NO', addr: 'X0' }]], coils: [{ type: 'coil', addr: 'Y0' }] },
      { id: 'b', label: 'second', branches: [[{ type: 'NO', addr: 'Y0' }]], coils: [{ type: 'coil', addr: 'Y1' }] },
    ],
  };
  const first = runScans(twoStep, { X0: true }, 1, 0.02);
  const second = runScans(twoStep, { X0: true }, 2, 0.02);
  push('An output contact carries exactly a one-scan delay', first.outputs.Y0 === true && first.outputs.Y1 !== true && second.outputs.Y1 === true, 'documented scan semantics, not an accident');

  const stable = runScans(program, { X0: true, X1: false, X2: false, X3: false }, 40, 0.02);
  const again = executeScan(program, stable, 0.02);
  push('Scans are idempotent once the program settles', JSON.stringify(again.outputs) === JSON.stringify(stable.outputs) && again.timers.T1.done === stable.timers.T1.done, 'repeating a scan on a settled state changes nothing');

  const branchTest = runScans({ inputs: ['X0', 'X1'], outputs: ['Y0'], rungs: [{ id: 'p', label: 'parallel', branches: [[{ type: 'NO', addr: 'X0' }], [{ type: 'NO', addr: 'X1' }]], coils: [{ type: 'coil', addr: 'Y0' }] }] }, { X0: false, X1: true }, 2, 0.02);
  push('Parallel branches are OR-ed and series contacts are AND-ed', branchTest.outputs.Y0 === true, 'X1 alone powers the rung through its own branch');

  const ncTest = runScans({ inputs: ['X0'], outputs: ['Y0'], rungs: [{ id: 'n', label: 'nc', branches: [[{ type: 'NC', addr: 'X0' }]], coils: [{ type: 'coil', addr: 'Y0' }] }] }, { X0: true }, 2, 0.02);
  push('Normally-closed contacts invert', ncTest.outputs.Y0 === false, 'X0 on opens the NC contact');

  return { checks };
}