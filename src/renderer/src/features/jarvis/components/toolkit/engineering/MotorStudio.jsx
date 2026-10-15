import { Zap } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge, Ring } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import MotorView from '@jarvis/components/toolkit/engineering/MotorView';
import { motorSim } from '@jarvis/components/toolkit/engineering/motorCore';

const plot = (history, key, label, reference) => ({
  series: [{ label, points: (history.xs || []).map((x, i) => ({ x, y: history.data[key]?.[i] ?? 0 })) }],
  reference,
});

export default function MotorStudio() {
  return (
    <EngShell
      sim={motorSim}
      toolId="electric-motor"
      icon={Zap}
      title="Electric Motor Working Simulator"
      desc="Solve the armature circuit and the rotor together: change voltage, load and machine constants and watch speed, torque, current, back-EMF and winding temperature respond, with commutation and field interaction drawn from the same solution."
    >
      {({ params, readings: r, api }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Shaft speed" value={r.speedRpm.toFixed(0)} unit="rpm" sub={`no-load ${(r.noLoadSpeed * 60 / (2 * Math.PI)).toFixed(0)} rpm · ${r.omega.toFixed(1)} rad/s`} />
            <Stat label="Electromagnetic torque" value={`${r.torque.toFixed(3)} N·m`} sub={`stall ${r.stallTorque.toFixed(2)} N·m at ${r.electrical.toFixed(0)} V`} mono />
            <Stat label="Armature current" value={`${r.current.toFixed(3)} A`} sub={`back-EMF ${r.backEmf.toFixed(2)} V`} mono />
            <Stat label="Winding temperature" value={`${r.temperature.toFixed(1)} °C`} sub={`${r.rise.toFixed(1)} K rise · ${r.copperLoss.toFixed(1)} W copper`} mono />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel className="lg:col-span-2">
              <MotorView readings={r} params={params} />
            </Panel>
            <div className="space-y-3">
              <Gauge value={r.speedRpm} min={0} max={Math.max(50, (r.noLoadSpeed * 60) / (2 * Math.PI))} label="Speed against no-load" unit=" rpm" caption={`${r.omega.toFixed(1)} rad/s`} />
              <Ring value={r.efficiency * 100} max={100} label="Electrical to mechanical" unit="efficiency" />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Speed and current</h3>
              <ScientificPlot {...plot(api.history, 'speed', 'Speed (rpm)')} xLabel="Time (s)" yLabel="rpm" />
              <ScientificPlot {...plot(api.history, 'current', 'Armature current (A)')} xLabel="Time (s)" yLabel="A" />
            </Panel>
            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Torque and thermal</h3>
              <ScientificPlot {...plot(api.history, 'torque', 'Torque (N·m)', params.load)} xLabel="Time (s)" yLabel="N·m" />
              <ScientificPlot {...plot(api.history, 'temperature', 'Winding temperature (°C)')} xLabel="Time (s)" yLabel="°C" height={200} />
            </Panel>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Electrical power in" value={`${r.powerIn.toFixed(1)} W`} mono />
            <Stat label="Mechanical power out" value={`${r.powerOut.toFixed(1)} W`} sub={`friction ${r.frictionLoss.toFixed(2)} W`} mono />
            <Stat label="Back-EMF constant" value={`${params.k} V·s/rad`} sub={`torque constant identical: ${params.k} N·m/A`} mono />
            <Stat label="Time constants" value={`${(r.electricalTau * 1000).toFixed(1)} ms / ${(r.mechanicalTau * 1000).toFixed(0)} ms`} sub="electrical L/R · mechanical J·R/K²" mono />
          </div>

          <Panel className="space-y-2">
            <h3 className="text-sm font-semibold">Energy ledger</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Electrical energy in" value={`${r.energy.input.toFixed(2)} J`} mono />
              <Stat label="Copper loss" value={`${r.energy.copper.toFixed(2)} J`} mono />
              <Stat label="Mechanical work delivered" value={`${r.energy.load.toFixed(2)} J`} sub={`friction ${r.energy.friction.toFixed(2)} J`} mono />
              <Stat label="Stored kinetic energy" value={`${r.kinetic.toFixed(3)} J`} sub={`unaccounted ${r.balance.toExponential(1)} J`} mono />
            </div>
            <p className="text-xs text-muted-foreground">Closed-form steady state for this setting: {r.steadySpeed.toFixed(2)} rad/s at {r.steadyCurrent.toFixed(3)} A. The machine is idealised — no saturation, no eddy currents, brushes assumed lossless, and the thermal model is a single lumped mass.</p>
          </Panel>
        </>
      )}
    </EngShell>
  );
}