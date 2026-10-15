import { useState } from 'react';
import { Workflow } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import LadderView from '@jarvis/components/toolkit/engineering/LadderView';
import LadderEditor from '@jarvis/components/toolkit/engineering/LadderEditor';
import { ladderSim, toggleInput } from '@jarvis/components/toolkit/engineering/ladderCore';

const draftDefaults = { type: 'NO', addr: 'M0' };

export default function LadderStudio() {
  return (
    <EngShell
      sim={ladderSim}
      toolId="plc-ladder"
      icon={Workflow}
      title="PLC Ladder Logic Execution Visualizer"
      desc="A real scan engine: edit the rungs, toggle the field inputs and watch power flow along the contacts, with timers counting in scan time, counters on rising edges and outputs written at the end of each scan."
    >
      {({ params, setParams, readings: r, api }) => <LadderBody params={params} setParams={setParams} readings={r} api={api} />
      }
    </EngShell>
  );
}

function LadderBody({ params, setParams, readings: r, api }) {
  const [draft, setDraft] = useState(draftDefaults);
  const setProgram = (program) => setParams({ ...params, program });
  const outputs = params.program.outputs;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Hero label="Scans executed" value={String(r.scans)} unit="" sub={`${r.scanMs} ms scan interval · ${api.clock.toFixed(1)} s run time`} />
        <Stat label="Energised rungs" value={`${(r.powers || []).filter(Boolean).length} of ${params.program.rungs.length}`} sub="power flow shown live" mono />
        <Stat label="Outputs" value={outputs.map((o) => `${o}=${r.outputs?.[o] ? 1 : 0}`).join(' ')} mono />
        <Stat label="Timer / counter" value={`T1 ${r.timers?.T1?.acc?.toFixed(1) ?? '0.0'}/${r.timers?.T1?.preset ?? 3} s · C1 ${r.counters?.C1?.acc ?? 0}/${r.counters?.C1?.preset ?? 5}`} mono />
      </div>

      <Panel className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Field inputs</h3>
          <div className="flex flex-wrap gap-2">
            {params.program.inputs.map((input) => (
              <Button
                key={input}
                size="sm"
                variant={params.inputs[input] ? 'default' : 'outline'}
                onClick={() => setParams(toggleInput(params, input))}
              >
                {input} {params.inputs[input] ? 'on' : 'off'}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          X0 is the start button, X1 the stop contact, X2 the part sensor and X3 the counter reset. Contacts read the state at the
          start of a scan and coils are written at the end, so an output contact carries a one-scan delay — the reason the seal-in
          branch takes one scan to appear.
        </p>
        <LadderView program={params.program} state={r} />
      </Panel>

      <LadderEditor program={params.program} setProgram={setProgram} draft={draft} setDraft={setDraft} />

      <Panel className="space-y-2">
        <h3 className="text-sm font-semibold">Scan diagnostics</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Scan time" value={`${r.scanMs} ms`} sub={`scheduled ${params.scan <= 0 ? '—' : 'fixed'} interval`} mono />
          <Stat label="Rung power flow" value={(r.powers || []).map((p) => (p ? '1' : '0')).join('')} sub="one bit per rung, in order" mono />
          <Stat label="Timer T1" value={`${(r.timers?.T1?.acc ?? 0).toFixed(2)} s`} sub={`done ${r.timers?.T1?.done ? 'yes' : 'no'} · preset ${r.timers?.T1?.preset ?? 3} s`} mono />
          <Stat label="Counter C1" value={`${r.counters?.C1?.acc ?? 0}`} sub={`done ${r.counters?.C1?.done ? 'yes' : 'no'} · preset ${r.counters?.C1?.preset ?? 5}`} mono />
        </div>
      </Panel>
    </>
  );
}