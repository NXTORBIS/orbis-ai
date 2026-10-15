import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import FluidScene from '@jarvis/components/toolkit/physics/next/FluidScene';

export default function FluidView({ params: p, r, a }) {
  const tank = p.mode === 'tank', pipe = p.mode === 'pipe';
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label={tank ? 'Remaining liquid depth' : pipe ? 'Pressure loss' : 'Throat absolute pressure'} value={tank ? r.tank.height.toFixed(4) : ((pipe ? r.pressure : r.pressure2) / 1000).toFixed(3)} unit={tank ? 'm' : 'kPa'} tone="cyan" sub={tank ? `${r.tankTime.toFixed(1)} s of physical drainage` : pipe ? r.regime : 'Bernoulli + continuity'} />
      <Stat label={tank ? 'Current outflow' : pipe ? 'Reynolds number' : 'Throat velocity'} value={tank ? `${(r.tank.flow * 1000).toFixed(4)} L/s` : pipe ? r.re.toPrecision(5) : `${r.v2.toFixed(4)} m/s`} mono />
      <Stat label={tank ? 'Predicted emptying time' : pipe ? 'Darcy friction factor' : 'Inlet velocity'} value={tank ? `${r.tank.emptyTime.toFixed(2)} s` : pipe ? r.f.toFixed(6) : `${r.velocity.toFixed(4)} m/s`} mono />
      <Stat label={tank ? 'Liquid mass remaining' : pipe ? 'Pump input power' : 'Pressure change'} value={tank ? `${r.tankMass.toFixed(3)} kg` : pipe ? `${r.pumpPower.toPrecision(5)} W` : `${(r.pressure2 / 1000 - p.inlet).toFixed(4)} kPa`} sub={pipe ? `Loss head ${r.head.toFixed(4)} m · η = ${p.efficiency}%` : tank ? 'Density × tank area × current depth' : 'Negative means a pressure drop'} mono />
    </div>
    {!tank && !pipe && r.pressure2 <= 0 && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">The model predicts nonpositive absolute pressure. These inputs violate the single-phase Bernoulli assumptions; cavitation or a different flow regime must be considered.</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="space-y-3"><h3 className="text-sm font-semibold">{tank ? 'A changing water column' : pipe ? 'Flow and losses along the pipe' : 'Acceleration through a contraction'}</h3><FluidScene params={p} r={r} />
        <p className="text-xs leading-relaxed text-muted-foreground">{tank ? 'h(t) = h₀(1 − t/t_empty)² until the tank empties. Exit speed is √(2gh); Cd reduces volume discharge. The animated clock is accelerated, but the reported time is physical seconds.' : pipe ? 'ΔP = (fL/D + K)ρv²/2. Colebrook friction is solved implicitly for turbulent flow; in laminar flow it switches to 64/Re. Pump power includes the selected efficiency.' : 'Q = Av sets the speeds. P + ½ρv² + ρgz stays constant in a lossless steady streamline. The diagram is schematic; the output uses the actual diameters and elevation change.'}</p>
      </Panel>
      <Panel className="space-y-3"><h3 className="text-sm font-semibold">{tank ? 'Drainage curve' : pipe ? 'The cost of increasing flow' : 'Pressure through the contraction'}</h3><ScientificPlot series={a.curves} xLabel={a.xLabel} yLabel={a.yLabel} height={290} /></Panel>
    </div>
  </>;
}