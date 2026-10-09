import React, { useState, useMemo } from 'react';
import { Cpu, Play, StepForward, RotateCcw, MemoryStick } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Tiny 8-bit CPU simulator with a minimal ISA.
// Memory: 16 cells. Registers: R0-R3, PC, flags.
// Instructions: LOAD rd,addr | STORE addr,rs | ADD rd,rs | SUB rd,rs | INC rd | JMP addr | JZ addr | HALT
const PROGRAMS = {
  sum: `LOAD R0,0
LOAD R1,5
LOAD R2,0
LOOP: ADD R2,R0
INC R0
SUB R1,R1
JZ DONE
JMP LOOP
DONE: STORE 15,R2
HALT`,
  countdown: `LOAD R0,10
LOOP: STORE 15,R0
SUB R0,R0
JZ DONE
JMP LOOP
DONE: HALT`,
};

const parse = (src) => {
  const lines = src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
  const labels = {};
  lines.forEach((l, i) => {
    const m = l.match(/^(\w+):/);
    if (m) labels[m[1]] = i;
  });
  const instrs = lines.map((l) => {
    l = l.replace(/^\w+:\s*/, '');
    const [op, ...args] = l.split(/[ ,]+/).filter(Boolean);
    return { op: op.toUpperCase(), args };
  });
  return { instrs, labels };
};

const getVal = (reg, name) => reg[name] ?? 0;

export default function ArchitectureLab() {
  const [src, setSrc] = useState(PROGRAMS.sum);
  const [mem, setMem] = useState(() => Array(16).fill(0));
  const [regs, setRegs] = useState({ R0: 0, R1: 0, R2: 0, R3: 0, PC: 0, ZF: 0 });
  const [halted, setHalted] = useState(false);
  const [output, setOutput] = useState([]);
  const [error, setError] = useState('');

  const { instrs, labels } = useMemo(() => parse(src), [src]);

  const reset = () => {
    setMem(Array(16).fill(0));
    setRegs({ R0: 0, R1: 0, R2: 0, R3: 0, PC: 0, ZF: 0 });
    setHalted(false);
    setOutput([]);
    setError('');
  };

  const loadProgram = () => {
    reset();
  };

  const step = () => {
    if (halted) return;
    setRegs((prev) => {
      const r = { ...prev };
      const pc = r.PC;
      if (pc >= instrs.length) { setHalted(true); return r; }
      const ins = instrs[pc];
      r.PC = pc + 1;
      const [a0, a1] = ins.args;
      try {
        switch (ins.op) {
          case 'LOAD': { r[a0] = mem[+a1] ?? 0; break; }
          case 'STORE': { setMem((m) => { const n = [...m]; n[+a0] = getVal(r, a1); return n; }); break; }
          case 'ADD': { r[a0] = (getVal(r, a0) + getVal(r, a1)) & 255; r.ZF = r[a0] === 0 ? 1 : 0; break; }
          case 'SUB': { r[a0] = (getVal(r, a0) - getVal(r, a1)) & 255; r.ZF = r[a0] === 0 ? 1 : 0; break; }
          case 'INC': { r[a0] = (getVal(r, a0) + 1) & 255; r.ZF = r[a0] === 0 ? 1 : 0; break; }
          case 'JMP': { r.PC = labels[a0] ?? +a0; break; }
          case 'JZ': { if (r.ZF) r.PC = labels[a0] ?? +a0; break; }
          case 'HALT': { setHalted(true); break; }
          default: setError(`Unknown op: ${ins.op}`); setHalted(true);
        }
      } catch (e) { setError(String(e)); setHalted(true); }
      return r;
    });
  };

  const run = () => {
    reset();
    setTimeout(() => {
      let r = { R0: 0, R1: 0, R2: 0, R3: 0, PC: 0, ZF: 0 };
      let m = Array(16).fill(0);
      const lbls = labels;
      const steps = instrs;
      for (let i = 0; i < 1000; i++) {
        if (r.PC >= steps.length) break;
        const ins = steps[r.PC];
        r.PC++;
        const [a0, a1] = ins.args;
        if (ins.op === 'HALT') break;
        if (ins.op === 'LOAD') r[a0] = m[+a1] ?? 0;
        else if (ins.op === 'STORE') m[+a0] = getVal(r, a1);
        else if (ins.op === 'ADD') { r[a0] = (getVal(r, a0) + getVal(r, a1)) & 255; r.ZF = r[a0] === 0 ? 1 : 0; }
        else if (ins.op === 'SUB') { r[a0] = (getVal(r, a0) - getVal(r, a1)) & 255; r.ZF = r[a0] === 0 ? 1 : 0; }
        else if (ins.op === 'INC') { r[a0] = (getVal(r, a0) + 1) & 255; r.ZF = r[a0] === 0 ? 1 : 0; }
        else if (ins.op === 'JMP') r.PC = lbls[a0] ?? +a0;
        else if (ins.op === 'JZ') { if (r.ZF) r.PC = lbls[a0] ?? +a0; }
      }
      setMem(m);
      setRegs(r);
      setHalted(true);
    }, 50);
  };

  return (
    <LabShell icon={Cpu} title="Computer Architecture" description="Tiny 8-bit CPU — write assembly, step through the fetch-decode-execute cycle.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <select value={src} onChange={(e) => { setSrc(e.target.value); reset(); }}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs">
              <option value={PROGRAMS.sum}>Sum 0..4</option>
              <option value={PROGRAMS.countdown}>Countdown</option>
            </select>
            <button onClick={run} className="flex items-center gap-1 rounded-md bg-cyan-j px-2.5 py-1 text-xs font-semibold text-background hover:bg-cyan-j/90"><Play className="size-3.5" /> Run</button>
            <button onClick={step} disabled={halted} className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-cyan-j/40 disabled:opacity-40"><StepForward className="size-3.5" /> Step</button>
            <button onClick={reset} className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-cyan-j/40"><RotateCcw className="size-3.5" /> Reset</button>
          </div>
          <textarea value={src} onChange={(e) => { setSrc(e.target.value); reset(); }} spellCheck={false}
            className="h-72 resize-none rounded-lg border border-border bg-card p-3 font-mono-j text-xs leading-relaxed scrollbar-thin" />
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">{error}</div>}
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground">REGISTERS</div>
            <div className="grid grid-cols-5 gap-2">
              {['R0', 'R1', 'R2', 'R3', 'PC'].map((k) => (
                <div key={k} className="rounded-md border border-border bg-card px-2 py-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground">{k}</div>
                  <div className="font-mono-j text-sm font-bold text-cyan-j">{regs[k] ?? 0}</div>
                </div>
              ))}
              <div className="rounded-md border border-border bg-card px-2 py-1.5 text-center">
                <div className="text-[9px] text-muted-foreground">ZF</div>
                <div className="font-mono-j text-sm font-bold">{regs.ZF}</div>
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground"><MemoryStick className="size-3" /> MEMORY (16 cells)</div>
            <div className="grid grid-cols-8 gap-1">
              {mem.map((v, i) => (
                <div key={i} className={`rounded border px-1 py-1.5 text-center font-mono-j text-[10px] ${regs.PC === i ? 'border-cyan-j bg-cyan-j/10 text-cyan-j' : 'border-border bg-card'}`}>
                  <div className="text-[8px] text-muted-foreground">{i}</div>
                  <div className="font-semibold">{v}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-border bg-card p-3 text-xs">
            <div className="font-semibold">Instruction Set</div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono-j text-[10px] text-muted-foreground">
              <span>LOAD Rd,addr</span><span>STORE addr,Rs</span>
              <span>ADD Rd,Rs</span><span>SUB Rd,Rs</span>
              <span>INC Rd</span><span>JMP label</span>
              <span>JZ label</span><span>HALT</span>
            </div>
          </div>
        </div>
      </div>
    </LabShell>
  );
}