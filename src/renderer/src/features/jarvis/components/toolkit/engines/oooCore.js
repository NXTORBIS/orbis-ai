/**
 * A Tomasulo-style out-of-order core, simulated cycle by cycle.
 *
 * In-order issue and in-order retire, register renaming, reservation stations with operand
 * tags, and functional-unit latencies. The architectural state it commits is then compared
 * with a plain in-order execution of the same program, which is a check the simulator cannot
 * pass unless the renaming, the tags and the writeback order are all right.
 */

export const LATENCY = { load: 4, add: 1, sub: 1, mul: 3 };

export const PROGRAMS = {
  chains: {
    label: 'Two independent chains',
    init: { r0: 1, r1: 2, r2: 3, r3: 4, r4: 5, r5: 6, r6: 7, r7: 8 },
    memory: [10, 20, 30, 40, 50, 60],
    code: [
      { op: 'load', dst: 'r0', addr: 0 },
      { op: 'load', dst: 'r1', addr: 1 },
      { op: 'mul', dst: 'r2', a: 'r0', b: 'r0' },
      { op: 'add', dst: 'r3', a: 'r1', b: 'r1' },
      { op: 'mul', dst: 'r4', a: 'r2', b: 'r0' },
      { op: 'add', dst: 'r5', a: 'r3', b: 'r1' },
      { op: 'add', dst: 'r6', a: 'r4', b: 'r5' },
      { op: 'mul', dst: 'r7', a: 'r6', b: 'r2' },
    ],
  },
  serial: {
    label: 'One long dependency chain',
    init: { r0: 2, r1: 3, r2: 1, r3: 1, r4: 1, r5: 1, r6: 1, r7: 1 },
    memory: [4, 8, 12],
    code: [
      { op: 'load', dst: 'r6', addr: 2 },
      { op: 'mul', dst: 'r0', a: 'r0', b: 'r1' },
      { op: 'mul', dst: 'r1', a: 'r0', b: 'r6' },
      { op: 'mul', dst: 'r2', a: 'r1', b: 'r0' },
      { op: 'add', dst: 'r3', a: 'r2', b: 'r6' },
      { op: 'add', dst: 'r4', a: 'r3', b: 'r2' },
      { op: 'add', dst: 'r5', a: 'r4', b: 'r3' },
      { op: 'add', dst: 'r7', a: 'r5', b: 'r4' },
    ],
  },
  reuse: {
    label: 'Heavy register reuse',
    init: { r0: 5, r1: 4, r2: 3, r3: 2, r4: 1, r5: 1, r6: 1, r7: 1 },
    memory: [7, 9, 11],
    code: [
      { op: 'load', dst: 'r0', addr: 0 },
      { op: 'load', dst: 'r1', addr: 1 },
      { op: 'mul', dst: 'r0', a: 'r0', b: 'r1' },
      { op: 'add', dst: 'r1', a: 'r0', b: 'r2' },
      { op: 'mul', dst: 'r0', a: 'r1', b: 'r3' },
      { op: 'add', dst: 'r3', a: 'r0', b: 'r4' },
      { op: 'mul', dst: 'r0', a: 'r3', b: 'r1' },
      { op: 'add', dst: 'r5', a: 'r0', b: 'r3' },
    ],
  },
};

const execute = (ins, regs, memory) => {
  if (ins.op === 'load') return memory[ins.addr] ?? 0;
  const a = regs[ins.a] ?? 0;
  const b = regs[ins.b] ?? 0;
  if (ins.op === 'add') return a + b;
  if (ins.op === 'sub') return a - b;
  return a * b;
};

/** Plain in-order execution — the reference the out-of-order core must reproduce. */
export function sequential(program) {
  const regs = { ...program.init };
  const memory = [...program.memory];
  const order = [];
  program.code.forEach((ins, index) => {
    if (ins.op === 'store') { memory[ins.addr] = regs[ins.a]; return; }
    const value = execute(ins, regs, memory);
    regs[ins.dst] = value;
    order.push({ index, dst: ins.dst, value });
  });
  return { regs, memory, order };
}

/** Longest chain of producer latencies — a hard lower bound on the cycles any core needs. */
export function criticalPath(program) {
  const best = {};
  let longest = 0;
  program.code.forEach((ins) => {
    const producers = [ins.a, ins.b].filter(Boolean).map((name) => best[name] ?? 0);
    const finish = Math.max(0, ...producers) + LATENCY[ins.op];
    best[ins.dst] = finish;
    longest = Math.max(longest, finish);
  });
  return longest;
}

export function simulate(program, { issueWidth = 2, retireWidth = 2, rsSize = 8, robSize = 12, physRegs = 24 } = {}) {
  const code = program.code;
  const arch = { ...program.init };
  const memory = [...program.memory];
  const rename = {};
  const ready = new Array(physRegs).fill(true);
  const value = new Array(physRegs).fill(0);
  let nextPhys = 0;
  Object.keys(arch).forEach((name) => { rename[name] = nextPhys; value[nextPhys] = arch[name]; nextPhys += 1; });
  const freeList = [];
  for (let i = nextPhys; i < physRegs; i += 1) freeList.push(i);

  const rob = [];
  const rs = [];
  const lifecycle = new Map();
  const frames = [];
  const stalls = { 'ROB full': 0, 'RS full': 0, 'No physical register': 0 };
  let pc = 0;
  let cycle = 0;
  let retired = 0;
  let peakRob = 0;
  let peakRs = 0;

  const record = (pcIndex) => {
    if (!lifecycle.has(pcIndex)) lifecycle.set(pcIndex, { pc: pcIndex, op: code[pcIndex].op, dst: code[pcIndex].dst, issue: null, execute: null, writeback: null, commit: null });
    return lifecycle.get(pcIndex);
  };

  while (pc < code.length || rob.length) {
    cycle += 1;
    const frame = { cycle, commit: [], writeback: [], issue: [], execute: [], robDepth: 0, rsDepth: 0, stall: null };

    // 1. Retire in order, freeing the physical register the destination replaced.
    let committed = 0;
    while (rob.length && rob[0].done && committed < retireWidth) {
      const entry = rob.shift();
      const previous = entry.oldPhys;
      if (previous != null && previous !== entry.phys) { freeList.push(previous); ready[previous] = false; }
      rename[entry.dst] = entry.phys;
      arch[entry.dst] = entry.value;
      void entry;
      record(entry.pc).commit = cycle;
      frame.commit.push(entry.pc);
      committed += 1;
      retired += 1;
    }

    // 2. Write back anything that finished, and broadcast to waiting operands.
    rs.forEach((entry) => {
      if (entry.state !== 'done') return;
      value[entry.phys] = entry.value;
      ready[entry.phys] = true;
      entry.robEntry.done = true;
      entry.robEntry.value = entry.value;
      record(entry.pc).writeback = cycle;
      frame.writeback.push(entry.pc);
      rs.forEach((other) => {
        if (other.qj === entry.phys) { other.qj = null; other.vj = entry.value; }
        if (other.qk === entry.phys) { other.qk = null; other.vk = entry.value; }
      });
      entry.free = true;
    });
    for (let i = rs.length - 1; i >= 0; i -= 1) if (rs[i].free) rs.splice(i, 1);

    // 3. Issue in program order while the reservation station and the reorder buffer allow.
    let issued = 0;
    while (pc < code.length && issued < issueWidth) {
      const ins = code[pc];
      if (rob.length >= robSize) { frame.stall = 'ROB full'; stalls['ROB full'] += 1; break; }
      if (rs.length >= rsSize) { frame.stall = 'RS full'; stalls['RS full'] += 1; break; }
      if (!freeList.length) { frame.stall = 'No physical register'; stalls['No physical register'] += 1; break; }
      const dest = freeList.shift();
      const entry = {
        pc, op: ins.op, phys: dest, state: 'waiting', remaining: 0, value: null,
        qj: null, qk: null, vj: 0, vk: 0, robEntry: null,
      };
      const source = (name) => {
        const phys = rename[name] ?? 0;
        return ready[phys] ? { value: value[phys] } : { tag: phys };
      };
      if (ins.a) { const found = source(ins.a); if (found.tag != null) entry.qj = found.tag; else entry.vj = found.value; }
      if (ins.b) { const found = source(ins.b); if (found.tag != null) entry.qk = found.tag; else entry.vk = found.value; }
      const oldPhys = rename[ins.dst] ?? null;
      rename[ins.dst] = dest;
      ready[dest] = false;
      const robEntry = { pc, dst: ins.dst, phys: dest, oldPhys, done: false, value: 0 };
      entry.robEntry = robEntry;
      rob.push(robEntry);
      rs.push(entry);
      record(pc).issue = cycle;
      record(pc).phys = dest;
      frame.issue.push(pc);
      pc += 1;
      issued += 1;
    }
    if (!frame.stall && pc < code.length && issued === 0 && rob.length >= robSize) { frame.stall = 'ROB full'; stalls['ROB full'] += 1; }

    // 4. Start anything whose operands have arrived.
    rs.forEach((entry) => {
      if (entry.state !== 'waiting' || entry.qj != null || entry.qk != null) return;
      entry.state = 'executing';
      entry.remaining = LATENCY[entry.op];
      if (entry.op === 'load') entry.value = memory[code[entry.pc].addr] ?? 0;
      else if (entry.op === 'add') entry.value = entry.vj + entry.vk;
      else if (entry.op === 'sub') entry.value = entry.vj - entry.vk;
      else entry.value = entry.vj * entry.vk;
      record(entry.pc).execute = cycle;
      frame.execute.push(entry.pc);
    });

    // 5. Advance the units; finished entries write back next cycle.
    rs.forEach((entry) => {
      if (entry.state !== 'executing') return;
      entry.remaining -= 1;
      if (entry.remaining <= 0) entry.state = 'done';
    });

    peakRob = Math.max(peakRob, rob.length);
    peakRs = Math.max(peakRs, rs.length);
    frame.robDepth = rob.length;
    frame.rsDepth = rs.length;
    frames.push(frame);
    if (cycle > 4000) break;
  }

  return {
    cycles: cycle,
    retired,
    ipc: retired / cycle,
    regs: arch,
    memory,
    frames,
    lifecycle: [...lifecycle.values()].sort((a, b) => a.pc - b.pc),
    stalls,
    peakRob,
    peakRs,
  };
}

export function verifyOoo() {
  const checks = [];
  const base = { issueWidth: 2, retireWidth: 2, rsSize: 8, robSize: 12 };

  // 1. Architectural state must equal a plain in-order execution of the same program.
  const mismatches = [];
  Object.entries(PROGRAMS).forEach(([name, program]) => {
    const reference = sequential(program);
    const timed = simulate(program, base);
    Object.entries(reference.regs).forEach(([reg, expected]) => {
      if (timed.regs[reg] !== expected) mismatches.push(`${name}:${reg}`);
    });
  });
  checks.push({ label: 'Committed register values equal the in-order reference', ok: mismatches.length === 0, detail: mismatches.length ? mismatches.join(', ') : `all ${Object.keys(PROGRAMS).length} programs match` });

  // 2. Retirement order is program order.
  const orderOk = Object.values(PROGRAMS).every((program) => {
    const timed = simulate(program, base);
    return timed.lifecycle.every((entry, index) => index === 0 || entry.commit >= timed.lifecycle[index - 1].commit) && timed.lifecycle.every((entry) => entry.commit >= entry.issue);
  });
  checks.push({ label: 'Instructions retire in program order, never before they issue', ok: orderOk, detail: 'commit cycles are non-decreasing in program order' });

  // 3. Dataflow: a consumer cannot write back before its producer has.
  const flowOk = Object.values(PROGRAMS).every((program) => {
  const timed = simulate(program, base);
  return timed.lifecycle.every((entry) => {
    const ins = program.code[entry.pc];
    return [ins.a, ins.b].filter(Boolean).every((name) => {
      const earlier = timed.lifecycle.filter((item) => item.pc < entry.pc && program.code[item.pc].dst === name).pop();
      return !earlier || earlier.writeback < entry.writeback;
    });
  });
  });
  checks.push({ label: 'Every consumer writes back after its producer', ok: flowOk, detail: 'measured over the dependency chains of all programs' });

  // 4. Renaming: every in-flight destination gets its own physical register.
  const renameOk = Object.values(PROGRAMS).every((program) => {
    const timed = simulate(program, base);
    const physical = timed.lifecycle.map((entry) => entry.phys);
    return physical.every((register) => register != null) && new Set(physical).size === physical.length;
  });
  checks.push({ label: 'Register renaming gives every in-flight destination its own physical register', ok: renameOk, detail: 'no two live destinations share a physical register' });

  // 5. The dependency chain is a hard floor on the cycle count.
  const floors = Object.values(PROGRAMS).map((program) => ({ program, cycles: simulate(program, base).cycles, floor: criticalPath(program) }));
  checks.push({
    label: 'Cycles never fall below the program’s critical-path latency',
    ok: floors.every((entry) => entry.cycles >= entry.floor),
    detail: floors.map((entry) => `${entry.program.cycles}≥${entry.floor}`).join(', '),
  });

  // 6. A serialising core can never beat the wide one.
  const monotone = Object.values(PROGRAMS).every((program) => simulate(program, { issueWidth: 1, retireWidth: 1, rsSize: 1, robSize: 4 }).cycles >= simulate(program, base).cycles);
  checks.push({ label: 'A serialising core (one in flight) is never faster than the wide core', ok: monotone, detail: 'checked on all three programs' });

  // 7. Reported IPC is consistent with the cycles and retirements it came from.
  const ipcOk = Object.values(PROGRAMS).every((program) => {
    const timed = simulate(program, base);
    return Math.abs(timed.ipc - timed.retired / timed.cycles) < 1e-12 && timed.retired === program.code.length;
  });
  checks.push({ label: 'Retired count and IPC match the simulated cycles', ok: ipcOk, detail: 'retired = program length for every program' });

  return { checks };
}