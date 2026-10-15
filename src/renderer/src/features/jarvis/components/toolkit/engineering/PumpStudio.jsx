import { Droplets } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge, Bars } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import PumpView from '@jarvis/components/toolkit/engineering/PumpView';
import { pumpSim, pumpCurveSamples } from '@jarvis/components/toolkit/engineering/pumpCore';

const curves = (params) => {
  const samples = pumpCurveSamples(params, 30);
  return [
    { label: 'Pump head (m)', points: samples.map((s) => ({ x: s.flow * 1000, y: s.pump })) },
    { label: 'System head (m)', points: samples.map((s) => ({ x: s.flow * 1000, y: s.system })) },
  ];
};

export default function PumpStudio() {
  return (
    <EngShell
      sim={pumpSim}
      toolId="centrifugal-pump"
      icon={Droplets}
      title="Centrifugal Pump Cutaway Simulator"
      desc="Impeller tip speed sets the Euler head, the system curve sets the duty point, and efficiency and NPSH follow from flow. Change speed, diameter, static head or suction lift and watch the duty point, shaft power and cavitation margin move."
    >
      {({ params, readings: r, api }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Duty flow" value={(r.flow * 1000).toFixed(2)} unit="L/s" sub={`${(r.flow * 3600).toFixed(1)} m³/h at ${r.head.toFixed(2)} m`} />
            <Stat label="Shaft power" value={`${(r.shaft / 1000).toFixed(3)} kW`} sub={`${(r.hydraulic / 1000).toFixed(3)} kW hydraulic · ${(r.eta * 100).toFixed(1)}%`} mono />
            <Stat label="Impeller tip speed" value={`${r.u2.toFixed(2)} m/s`} sub={`shut-off head ${r.headAtShutoff.toFixed(2)} m`} mono />
            <Stat label="NPSH margin" value={`${r.cavitation.toFixed(2)} m`} sub={`available ${r.npsha.toFixed(2)} m · required ${r.npshr.toFixed(2)} m`} mono />
          </div>

          <Panel className="space-y-3">
            <h3 className="text-sm font-semibold">Cutaway and duty point</h3>
            <PumpView readings={r} params={params} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Head-flow and system curves</h3>
              <ScientificPlot series={curves(params)} xLabel="Flow (L/s)" yLabel="Head (m)" height={230} />
              <p className="text-xs text-muted-foreground">The duty point is where the two curves cross — {r.valid ? `${(r.flow * 1000).toFixed(2)} L/s at ${r.head.toFixed(2)} m` : r.reason}</p>
            </Panel>
            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Efficiency and power against flow</h3>
              <ScientificPlot
                series={[
                  { label: 'Efficiency (%)', points: pumpCurveSamples(params, 30).map((s) => ({ x: s.flow * 1000, y: (params.bepEff) * (s.flow / params.bep) * (2 - Math.min(2, s.flow / params.bep)) })) },
                  { label: 'Shaft power (kW)', points: pumpCurveSamples(params, 30).map((s) => ({ x: s.flow * 1000, y: (998 * 9.81 * s.flow * s.pump) / 1000 })) },
                ]}
                xLabel="Flow (L/s)"
                yLabel="% / kW"
                height={230}
              />
              <p className="text-xs text-muted-foreground">The power curve is the hydraulic power ρgQH; dividing by efficiency gives the shaft power at the duty point.</p>
            </Panel>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Gauge value={r.ratio * 100} min={0} max={200} label="Flow against best-efficiency point" unit="%" caption={`${(r.flow * 1000).toFixed(2)} L/s of ${(params.bep * 1000).toFixed(2)} L/s`} />
            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Outlet velocity triangle</h3>
              <Bars data={[
                { label: 'u₂', value: r.u2 },
                { label: 'cθ₂', value: r.cu2 },
                { label: 'cm₂', value: r.cm2 },
              ]} suffix=" m/s" format={(v) => v.toFixed(2)} />
              <Stat label="Blade angle at the outlet" value={`${((r.beta2 * 180) / Math.PI).toFixed(1)}°`} sub="measured from the tangential direction" mono />
            </Panel>
            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Selection and suction</h3>
              <Stat label="Specific speed" value={`Ns ≈ ${r.specificSpeed.toFixed(1)}`} sub={r.classification} mono />
              <Stat label="Duty point residuals" value={`${r.pumpResidual.toExponential(1)} m`} sub="pump head minus system head" mono />
              <Stat label="Best-efficiency point" value={`${(params.bep * 1000).toFixed(2)} L/s at ${r.headAtBep.toFixed(2)} m`} sub={`${params.bepEff}% at BEP`} mono />
              <Stat label="Duty point" value={`${r.ratio.toFixed(2)} × BEP flow`} mono />
            </Panel>
          </div>

          <Panel className="space-y-2">
            <h3 className="text-sm font-semibold">Live trace</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <ScientificPlot series={[{ label: 'Head (m)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.head?.[i] ?? 0 })) }]} xLabel="Time (s)" yLabel="m" height={170} />
              <ScientificPlot series={[{ label: 'Shaft power (kW)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.shaft?.[i] ?? 0 })) }]} xLabel="Time (s)" yLabel="kW" height={170} />
            </div>
          </Panel>
        </>
      )}
    </EngShell>
  );
}