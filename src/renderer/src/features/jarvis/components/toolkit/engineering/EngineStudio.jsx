import { Flame } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge, Bars } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import EngineView from '@jarvis/components/toolkit/engineering/EngineView';
import { engineSim, simulateCycle, valveLift, valveEvents } from '@jarvis/components/toolkit/engineering/engineCore';

const liftCurve = (params, side) => {
  const events = valveEvents(params)[side];
  return Array.from({ length: 145 }, (_, i) => {
    const deg = i * 5;
    return { x: deg, y: valveLift((deg * Math.PI) / 180, events.open, events.close, events.lift) };
  });
};

export default function EngineStudio() {
  return (
    <EngShell
      sim={engineSim}
      toolId="four-stroke-engine"
      icon={Flame}
      title="Four-Stroke Engine Simulator"
      desc="Follow intake, compression, power and exhaust in a cutaway while the cylinder integrates pV^γ compression, Wiebe heat release, and a friction correlation — then read IMEP, peak pressure, torque, power and efficiency from the solved cycle."
    >
      {({ params, readings: r, api }) => {
        const trace = r.trace.length > 3 ? r.trace : simulateCycle(params, 2).samples;
        const pv = trace.map((s) => ({ x: s.v, y: s.p }));
        const pressure = trace.map((s) => ({ x: s.deg, y: s.p }));
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Brake torque" value={r.brakeTorque.toFixed(1)} unit="N·m" sub={`${r.brakePower.toFixed(2)} kW at ${params.rpm} rpm`} />
              <Stat label="Cylinder pressure" value={`${r.pressureBar.toFixed(2)} bar`} sub={`peak ${r.peakPressure.toFixed(1)} bar at ${r.peakAngle.toFixed(0)}°`} mono />
              <Stat label="IMEP / PMEP" value={`${r.imep.toFixed(2)} / ${r.pmep.toFixed(2)} bar`} sub={`FMEP ${r.fmep.toFixed(2)} bar · BMEP ${r.bmep.toFixed(2)} bar`} mono />
              <Stat label="Thermal efficiency" value={`${(r.efficiency * 100).toFixed(1)}%`} sub={`Otto ceiling ${(r.ottoLimit * 100).toFixed(1)}%`} mono />
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <Panel className="lg:col-span-2"><EngineView readings={r} params={params} /></Panel>
              <div className="space-y-3">
                <Gauge value={r.pressureBar} min={0} max={Math.max(10, r.peakPressure)} label="Cylinder pressure" unit=" bar" caption={`${r.volumeCc.toFixed(1)} cm³ · ${r.stage}`} />
                <Panel className="space-y-2">
                  <h3 className="text-sm font-semibold">Cycle energy</h3>
                  <Bars data={[
                    { label: 'Ind work', value: r.indicatedWork },
                    { label: 'Heat in', value: r.released },
                  ]} suffix=" J" format={(v) => v.toFixed(0)} />
                  <Stat label="Fuel per cycle" value={`${(r.fuelMass * 1e6).toFixed(2)} mg`} sub={`air ${(r.airMass * 1e3).toFixed(3)} g · stoichiometric`} mono />
                  <Stat label="BSFC" value={`${r.bsfc.toFixed(0)} g/kWh`} sub={`${r.cycles} cycle${r.cycles === 1 ? '' : 's'} simulated`} mono />
                </Panel>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Pressure–volume diagram</h3>
                <ScientificPlot series={[{ label: 'Cylinder gas', points: pv }]} xLabel="Volume (cm³)" yLabel="Pressure (bar)" height={250} />
                <p className="text-xs text-muted-foreground">The loop area is the indicated work; the thin loop at low pressure is the pumping loss. Both are integrated from the same gas equation the animation runs.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Pressure against crank angle</h3>
                <ScientificPlot series={[{ label: 'Cylinder pressure (bar)', points: pressure }]} xLabel="Crank angle (°)" yLabel="bar" height={250} />
                <ScientificPlot
                  series={[
                    { label: 'Intake valve lift (mm)', points: liftCurve(params, 'intake') },
                    { label: 'Exhaust valve lift (mm)', points: liftCurve(params, 'exhaust') },
                  ]}
                  xLabel="Crank angle (°)"
                  yLabel="mm"
                  height={170}
                />
              </Panel>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Instantaneous torque" value={`${(r.instantaneousTorque).toFixed(1)} N·m`} sub="(p − p_crank)·A·dx/dθ" mono />
              <Stat label="Mean piston speed" value={`${r.meanPistonSpeed.toFixed(2)} m/s`} sub={`displacement ${r.displacementCc.toFixed(0)} cm³`} mono />
              <Stat label="Throttled intake pressure" value={`${(r.intakePressure / 1e5).toFixed(3)} bar`} sub={`exhaust ${(r.exhaustPressure / 1e5).toFixed(2)} bar`} mono />
              <Stat label="Valve lift now" value={`${r.intakeLift.toFixed(2)} / ${r.exhaustLift.toFixed(2)} mm`} sub="intake / exhaust" mono />
            </div>
          </>
        );
      }}
    </EngShell>
  );
}