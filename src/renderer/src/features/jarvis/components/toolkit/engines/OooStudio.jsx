import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Field, Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Pills } from '@jarvis/components/toolkit/kit/premium';
import ToolShell from '@jarvis/components/toolkit/kit/ToolShell';
import { EngineProgress } from '@jarvis/components/toolkit/engines/EngineUi';
import useVizEngine from '@jarvis/components/toolkit/engines/useVizEngine';
import VizChecks from '@jarvis/components/toolkit/engines/VizChecks';
import OooTimeline from '@jarvis/components/toolkit/engines/OooTimeline';
import { LATENCY, PROGRAMS } from '@jarvis/components/toolkit/engines/oooCore';

const DEFAULT = { program: 'chains', issueWidth: 2, retireWidth: 2, rsSize: 8, robSize: 12 };

export default function OooStudio() {
  const [state, setState] = useState(DEFAULT);
  const [result, setResult] = useState(null);
  const engine = useVizEngine();

  useEffect(() => {
    let live = true;
    setResult(null);
    engine.run({ kind: 'ooo', action: 'analyze', ...state }).then((value) => { if (live) setResult(value); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const restore = (value) => {
    if (!value || !PROGRAMS[value.program]) return;
    setState({
      program: value.program,
      issueWidth: Math.min(4, Math.max(1, Number(value.issueWidth) || 2)),
      retireWidth: Math.min(4, Math.max(1, Number(value.retireWidth) || 2)),
      rsSize: Math.min(16, Math.max(1, Number(value.rsSize) || 8)),
      robSize: Math.min(32, Math.max(2, Number(value.robSize) || 12)),
    });
  };

  const mismatch = result ? Object.entries(result.reference).filter(([register, value]) => result.regs[register] !== value) : [];
  const stallPills = result ? [
    { label: 'ROB full', value: `${result.stalls['ROB full']} cycles` },
    { label: 'RS full', value: `${result.stalls['RS full']} cycles` },
    { label: 'No free register', value: `${result.stalls['No physical register']} cycles` },
  ] : [];

  return (
    <ToolShell
      toolId="cpu-ooo"
      icon={Cpu}
      title="CPU Out-of-Order Execution Visualizer"
      desc="A Tomasulo core simulated cycle by cycle: in-order issue and retirement, register renaming, tagged reservation stations and functional-unit latencies. The committed registers are compared with a plain in-order execution of the same program, so a renaming or writeback mistake cannot hide."
      state={state}
      onRestore={restore}
      onReset={() => setState(DEFAULT)}
      exportText={result ? JSON.stringify({ program: result.name, options: result.options, cycles: result.cycles, ipc: result.ipc, floor: result.floor, stalls: result.stalls, lifecycle: result.lifecycle }, null, 2) : ''}
      exportName="out-of-order-trace.json"
      exportMime="application/json"
    >
      <Panel className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Program">
            <select className="w-full rounded-lg border p-2 text-sm" value={state.program} onChange={(event) => setState((current) => ({ ...current, program: event.target.value }))}>
              {Object.entries(PROGRAMS).map(([key, program]) => <option key={key} value={key}>{program.label}</option>)}
            </select>
          </Field>
          {[['issueWidth', 'Issue width', 1, 4], ['retireWidth', 'Retire width', 1, 4], ['rsSize', 'Reservation stations', 1, 16], ['robSize', 'Reorder buffer', 2, 32]].map(([key, label, min, max]) => (
            <Field key={key} label={`${label} · ${state[key]}`}>
              <input className="w-full accent-cyan-j" type="range" min={min} max={max} value={state[key]} onChange={(event) => setState((current) => ({ ...current, [key]: Number(event.target.value) }))} />
            </Field>
          ))}
          <div className="flex items-end"><Button disabled={engine.busy} onClick={() => setState((current) => ({ ...current }))}>Recalculate</Button></div>
        </div>
        <p className="text-xs text-muted-foreground">Latencies in cycles: load {LATENCY.load}, multiply {LATENCY.mul}, add and subtract {LATENCY.add}. Loads are assumed to hit in the first level, and a producer writing back in a cycle can supply a consumer issued in the same cycle.</p>
      </Panel>

      <EngineProgress busy={engine.busy} phase={engine.busy ? 'Simulating the core cycle by cycle' : ''} />
      {engine.error && <p role="alert" className="text-sm text-destructive">{engine.error}</p>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Cycles" value={result.cycles} sub={`${result.retired} instructions retired`} />
            <Stat label="Instructions per cycle" value={result.ipc.toFixed(3)} mono />
            <Stat label="Critical-path floor" value={`${result.floor} cycles`} sub="dependency latencies alone" mono />
            <Stat label="Serialising core" value={`${result.narrowCycles} cycles`} sub="one instruction in flight" mono />
          </div>
          <Panel className="space-y-4">
            <h3 className="text-sm font-semibold">Every instruction, cycle by cycle</h3>
            <OooTimeline lifecycle={result.lifecycle} code={result.code} cycles={result.cycles} frames={result.frames} />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">Committed architectural state</h3>
              <div className="space-y-1">
                {Object.entries(result.regs).map(([register, value]) => (
                  <div key={register} className="tk-glass-panel flex items-center justify-between rounded-lg px-3 py-1 text-xs">
                    <span className="font-mono-j">{register}</span>
                    <span className="font-mono-j text-cyan-j">{value}</span>
                    <span className="text-[10px] text-muted-foreground">in-order reference {result.reference[register]}</span>
                  </div>
                ))}
              </div>
              <p className={`text-[11px] ${mismatch.length ? 'text-destructive' : 'text-emerald-400'}`}>
                {mismatch.length ? `${mismatch.length} registers disagree with the in-order execution.` : 'Every committed register matches the in-order execution.'}
              </p>
            </Panel>
            <Panel className="space-y-3">
              <h3 className="text-sm font-semibold">Where the cycles went</h3>
              <Pills items={stallPills} />
              <div className="grid gap-2 sm:grid-cols-2">
                <Stat label="Peak reorder buffer" value={`${result.peakRob} entries`} mono />
                <Stat label="Peak reservation stations" value={`${result.peakRs} entries`} mono />
              </div>
              <p className="text-[11px] text-muted-foreground">In Tomasulo a busy operand does not stall issue: it is tagged, and the rename table lets later instructions writing the same destination proceed independently.</p>
            </Panel>
          </div>
        </>
      )}

      <VizChecks kind="ooo" />
    </ToolShell>
  );
}