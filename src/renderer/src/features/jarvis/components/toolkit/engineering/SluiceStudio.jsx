import { Waves } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import SluiceView from '@jarvis/components/toolkit/engineering/SluiceView';
import { sluiceSim } from '@jarvis/components/toolkit/engineering/sluiceCore';

export default function SluiceStudio() {
  return (
    <EngShell
      sim={sluiceSim}
      toolId="sluice-gate"
      icon={Waves}
      title="Sluice Gate Working Simulator"
      desc="Raise or lower the gate and watch both pool levels respond from volume balance, with the discharge regime, jet velocity, hydrostatic pressure on each face, centre of pressure and hoist load recalculated as it moves."
    >
      {({ params, readings: r, api }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Discharge" value={r.flow.toFixed(2)} unit="m³/s" sub={`${r.regime} · unit flow ${r.unitFlow.toFixed(2)} m²/s`} />
            <Stat label="Net hydrostatic force" value={`${(r.force / 1000).toFixed(1)} kN`} sub={`centre of pressure ${r.centreOfPressure.toFixed(2)} m above the sill`} mono />
            <Stat label="Head on the gate" value={`${r.head.toFixed(2)} m`} sub={`up ${r.h1.toFixed(2)} m · down ${r.h2.toFixed(2)} m`} mono />
            <Stat label="Hoist load" value={`${(r.hoist.total / 1000).toFixed(1)} kN`} sub={`weight ${(r.hoist.weight / 1000).toFixed(1)} · seal ${(r.hoist.sealFriction / 1000).toFixed(1)} kN`} mono />
          </div>

          <Panel className="space-y-3">
            <h3 className="text-sm font-semibold">Elevation</h3>
            <SluiceView readings={r} params={params} />
            <p className="text-xs text-muted-foreground">The shaded wedges are the pressure distribution on each face; their difference is the net force and the point where it acts. Changing the gate type re-solves the same water load against a curved leaf.</p>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Pool levels and discharge</h3>
              <ScientificPlot
                series={[
                  { label: 'Upstream depth (m)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.h1?.[i] ?? 0 })) },
                  { label: 'Downstream depth (m)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.h2?.[i] ?? 0 })) },
                ]}
                xLabel="Time (s)"
                yLabel="m"
                height={210}
              />
              <ScientificPlot series={[{ label: 'Discharge (m³/s)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.flow?.[i] ?? 0 })) }]} xLabel="Time (s)" yLabel="m³/s" height={170} />
            </Panel>
            <div className="space-y-3">
              <Gauge value={r.gatePercent} min={0} max={100} label="Gate opening" unit="%" caption={`${r.gate.toFixed(2)} m of ${params.gateHeight} m`} />
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Hydraulics</h3>
                <Stat label="Gate velocity" value={`${r.gateVelocity.toFixed(2)} m/s`} sub={`tail velocity ${r.tailVelocity.toFixed(2)} m/s · Froude ${r.froude.toFixed(2)}`} mono />
                <Stat label="Critical depth at this flow" value={`${r.critical.toFixed(3)} m`} sub={`minimum specific energy ${r.criticalEnergy.toFixed(3)} m`} mono />
                <Stat label="Trunnion moment" value={`${r.moment.toFixed(0)} N·m`} sub="radial gates carry the load into their pivot" mono />
                <Stat label="Dissipated power" value={`${r.power.toFixed(2)} kW`} sub={`volume balance ${r.balance >= 0 ? '+' : ''}${r.balance.toFixed(2)} m³/s`} mono />
              </Panel>
            </div>
          </div>
        </>
      )}
    </EngShell>
  );
}