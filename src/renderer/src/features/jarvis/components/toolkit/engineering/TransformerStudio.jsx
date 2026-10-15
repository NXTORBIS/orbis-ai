import { Power } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge, Bars, Spark } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import TransformerView from '@jarvis/components/toolkit/engineering/TransformerView';
import { transformerSim, efficiencyCurve, maximumEfficiencyLoad } from '@jarvis/components/toolkit/engineering/transformerCore';

export default function TransformerStudio() {
  return (
    <EngShell
      sim={transformerSim}
      toolId="transformer"
      icon={Power}
      title="Transformer Working Simulator"
      desc="Set the turns, core area, voltage and load and read the equivalent circuit: flux density, magnetising current, copper and iron loss, regulation and efficiency — while the animation integrates the real flux and winding currents."
    >
      {({ params, readings: r, api }) => {
        const curve = efficiencyCurve(params);
        const peak = maximumEfficiencyLoad(params);
        const trace = r.trace.length > 4 ? r.trace : [];
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Secondary voltage" value={r.voltage2.toFixed(1)} unit="V" sub={`${r.current2.toFixed(1)} A · ${(r.output / 1000).toFixed(2)} kW delivered`} />
              <Stat label="Efficiency" value={`${(r.efficiency * 100).toFixed(2)}%`} sub={`${r.losses.toFixed(1)} W lost of ${r.input.toFixed(1)} W in`} mono />
              <Stat label="Flux density" value={`${r.fluxDensity.toFixed(3)} T`} sub={`${(r.saturation).toFixed(0)}% of the 1.6 T knee · ${params.coreArea} cm² core`} mono />
              <Stat label="Regulation" value={`${(r.regulation * 100).toFixed(2)}%`} sub={`${r.secondaryNominal.toFixed(1)} V no-load`} mono />
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <Panel className="lg:col-span-2"><TransformerView readings={r} params={params} /></Panel>
              <div className="space-y-3">
                <Gauge value={r.saturation} min={0} max={140} label="Core excitation" unit="%" bands={[{ min: 0, max: 100, label: 'linear', stroke: 'hsl(160 84% 52%)' }, { min: 100, max: 140, label: 'saturating', stroke: 'hsl(350 89% 60%)' }]} />
                <Panel className="space-y-2">
                  <h3 className="text-sm font-semibold">Losses</h3>
                  <Bars data={[
                    { label: 'Copper', value: r.copper },
                    { label: 'Iron', value: r.iron, tone: 'rose' },
                  ]} suffix=" W" format={(v) => v.toFixed(1)} />
                  <Stat label="Copper / iron balance" value={`${(r.copper / Math.max(1e-9, r.iron)).toFixed(2)}×`} sub={`best load for efficiency ${(peak * 100).toFixed(0)}%`} mono />
                  <Stat label="Magnetising current" value={`${r.noLoadCurrent.toFixed(3)} A`} sub={`${((r.noLoadCurrent / r.current1) * 100).toFixed(1)}% of the primary current`} mono />
                </Panel>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Windings over a couple of cycles</h3>
                <ScientificPlot
                  series={[
                    { label: 'Primary current (A)', points: trace.map((s) => ({ x: s.angle, y: s.i1 })) },
                    { label: 'Secondary current (A)', points: trace.map((s) => ({ x: s.angle, y: s.i2 / 10 })) },
                  ]}
                  xLabel="Electrical angle (°)"
                  yLabel="A (secondary ÷ 10)"
                  height={200}
                />
                <ScientificPlot series={[{ label: 'Core flux density (T)', points: trace.map((s) => ({ x: s.angle, y: s.flux })) }]} xLabel="Electrical angle (°)" yLabel="T" height={180} />
                <p className="text-xs text-muted-foreground">The secondary waveform is scaled by ten so both fit on one axis. The flux curve is the integral of the applied voltage — set the voltage high enough and its own shape distorts as the core saturates.</p>
              </Panel>
              <Panel className="space-y-3">
                <h3 className="text-sm font-semibold">Efficiency against load</h3>
                <ScientificPlot
                  series={[
                    { label: 'Efficiency (%)', points: curve.map((c) => ({ x: c.factor * 100, y: c.efficiency * 100 })) },
                  ]}
                  xLabel="Load (%)"
                  yLabel="%"
                  height={190}
                />
                <ScientificPlot
                  series={[
                    { label: 'Copper loss (W)', points: curve.map((c) => ({ x: c.factor * 100, y: c.copper })) },
                    { label: 'Iron loss (W)', points: curve.map((c) => ({ x: c.factor * 100, y: c.iron })) },
                  ]}
                  xLabel="Load (%)"
                  yLabel="W"
                  height={180}
                />
                <p className="text-xs text-muted-foreground">Efficiency peaks exactly where the copper loss curve crosses the iron loss curve — here at {((maximumEfficiencyLoad(params)) * 100).toFixed(0)}% load. Iron loss is set by voltage and frequency; copper loss grows with the square of the current.</p>
                <Spark data={curve.map((c) => c.efficiency * 100)} />
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}