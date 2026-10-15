import { Anchor } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import LockView from '@jarvis/components/toolkit/engineering/LockView';
import { lockSim } from '@jarvis/components/toolkit/engineering/lockCore';

export default function LockStudio() {
  return (
    <EngShell
      sim={lockSim}
      toolId="canal-lock"
      icon={Anchor}
      title="Canal Lock Gate Simulator"
      desc="Work the valves and gates yourself or run an automatic transit: equalisation is solved from orifice flow into a real chamber volume, and the sequencer will not open a gate while a head remains across it."
    >
      {({ params, setParams, readings: r, api }) => {
        const command = (key) => setParams({ ...params, commands: { ...params.commands, [key]: !params.commands[key] } });
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Chamber level" value={r.level.toFixed(2)} unit="m" sub={`${r.gateState} · ${r.phase}`} />
              <Stat label="Head to upstream" value={`${r.headUpstream.toFixed(2)} m`} sub={`downstream head ${r.headDownstream.toFixed(2)} m`} mono />
              <Stat label="Valve flow" value={`${(r.flowUp - r.flowDown).toFixed(3)} m³/s`} sub={`up ${r.flowUp.toFixed(3)} · down ${r.flowDown.toFixed(3)} m³/s`} mono />
              <Stat label="Lockage water per transit" value={`${(r.lockagePerCycle / 1000).toFixed(1)} × 10³ m³`} sub={`chamber ${r.chamberArea.toFixed(0)} m² · ${r.cycles} completed`} mono />
            </div>

            <Panel className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Lock plan</h3>
                <div className="flex flex-wrap gap-2">
                  {params.mode === 'auto' ? (
                    <Button size="sm" onClick={() => setParams({ ...params, token: params.token + 1 })}>Start a transit</Button>
                  ) : (
                    <>
                      <Button size="sm" variant={params.commands.upValve ? 'default' : 'outline'} onClick={() => command('upValve')}>Upstream valve</Button>
                      <Button size="sm" variant={params.commands.upGate ? 'default' : 'outline'} onClick={() => command('upGate')}>Upstream gate</Button>
                      <Button size="sm" variant={params.commands.downValve ? 'default' : 'outline'} onClick={() => command('downValve')}>Downstream valve</Button>
                      <Button size="sm" variant={params.commands.downGate ? 'default' : 'outline'} onClick={() => command('downGate')}>Downstream gate</Button>
                    </>
                  )}
                </div>
              </div>
              <LockView readings={r} params={params} />
              <p className="text-xs text-muted-foreground">{r.interlock} Time is compressed {params.timeScale}× so a real equalisation can be watched; every rate and level in the model stays in seconds and metres.</p>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2 lg:col-span-2">
                <h3 className="text-sm font-semibold">Levels and flows</h3>
                <ScientificPlot
                  series={[
                    { label: 'Chamber level (m)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.level?.[i] ?? 0 })) },
                    { label: 'Head to upstream (m)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.head?.[i] ?? 0 })) },
                  ]}
                  xLabel="Model time (s)"
                  yLabel="m"
                  height={210}
                />
                <ScientificPlot series={[{ label: 'Net valve flow (m³/s)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.flow?.[i] ?? 0 })) }]} xLabel="Model time (s)" yLabel="m³/s" height={170} />
              </Panel>
              <div className="space-y-3">
                <Gauge value={r.vessel * 100} min={0} max={100} label="Vessel progress" unit="%" caption={r.gateState} />
                <Panel className="space-y-2">
                  <h3 className="text-sm font-semibold">Cycle state</h3>
                  <Stat label="Phase" value={r.phase} sub={`${r.phaseTime.toFixed(0)} s in this phase`} />
                  <Stat label="Gate position" value={`${(r.upGate * 100).toFixed(0)}% / ${(r.downGate * 100).toFixed(0)}%`} sub="upstream / downstream" mono />
                  <Stat label="Valve position" value={`${(r.upValve * 100).toFixed(0)}% / ${(r.downValve * 100).toFixed(0)}%`} sub="upstream / downstream" mono />
                  <Stat label="Predicted equalisation from here" value={`${r.predictedFill.toFixed(0)} s`} sub="analytic, from the current head" mono />
                </Panel>
              </div>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}