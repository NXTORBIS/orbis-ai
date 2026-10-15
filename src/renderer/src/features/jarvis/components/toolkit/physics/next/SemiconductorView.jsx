import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import DeviceScene from '@jarvis/components/toolkit/physics/next/DeviceScene';

export default function SemiconductorView({ params: p, r, a }) {
  const solar = p.mode === 'solar', mos = p.mode === 'mosfet';
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label={solar ? 'Maximum available power' : 'Device current'} value={solar ? (r.pmax * 1000).toFixed(3) : (r.current * 1000).toPrecision(5)} unit={solar ? 'mW' : 'mA'} tone={solar ? 'amber' : mos ? 'emerald' : 'cyan'} sub={solar ? `MPP: ${r.vmpp.toFixed(4)} V × ${(r.impp * 1000).toFixed(3)} mA` : mos ? r.region : 'Implicit series-resistance solution'} />
      <Stat label={solar ? 'Open-circuit voltage' : mos ? 'Gate overdrive' : 'Junction voltage'} value={`${(solar ? r.voc : mos ? r.over : r.junction).toFixed(5)} V`} sub={solar ? 'I(Voc) = 0' : mos ? 'VGS − VT' : 'Terminal voltage minus IR'} mono />
      <Stat label={solar ? 'Short-circuit current' : mos ? 'Transconductance gm' : 'Resistance voltage drop'} value={solar ? `${(r.isc * 1000).toFixed(3)} mA` : mos ? `${(r.gm * 1000).toFixed(3)} mS` : `${(p.bias - r.junction).toFixed(5)} V`} mono />
      <Stat label={solar ? 'Fill factor / efficiency' : 'Operating-point power'} value={solar ? `${(r.fill * 100).toFixed(2)}% / ${(r.efficiency * 100).toFixed(2)}%` : `${(r.power * 1000).toPrecision(5)} mW`} sub={solar ? 'Efficiency depends on photocurrent and cell area inputs' : 'P = VI'} mono />
    </div>
    {solar && r.efficiency > 1 && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">These photocurrent and area inputs imply efficiency over 100%; they are not physically consistent. Adjust the inputs rather than treating this as a viable cell.</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold">{solar ? 'Illuminated I–V curve' : mos ? 'Drain current at three gate voltages' : 'Forward conduction and reverse saturation'}</h3>
        <ScientificPlot series={a.curves} xLabel={mos ? 'VDS (V)' : 'Terminal voltage (V)'} yLabel="Current (mA)" height={280} />
        <Stat label="Selected operating point" value={`${(mos ? p.drain : p.bias).toFixed(3)} V · ${(r.current * 1000).toPrecision(5)} mA`} mono />
      </Panel>
      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold">{solar ? 'The power curve and MPP' : 'Device cross-section — schematic'}</h3>
        {solar ? <ScientificPlot series={[{ label: 'Delivered power', points: a.power }]} xLabel="Terminal voltage (V)" yLabel="Power (mW)" height={240} /> : <DeviceScene params={p} r={r} />}
        <p className="text-xs leading-relaxed text-muted-foreground">{solar ? 'I = Iph − Is(exp(V/nVT) − 1). The maximum-power voltage is found by solving d(VI)/dV = 0, not by choosing the nearest plotted sample. Beyond Voc the cell consumes rather than delivers power.' : mos ? 'Below threshold the channel is off. In triode the channel current depends on drain voltage; above VDS = VGS − VT it saturates, with optional channel-length modulation. This is not a short-channel model.' : 'I = Is(exp(Vjunction/nVT) − 1), with Vterminal = Vjunction + IR. Series resistance caps forward current naturally; the root solver enforces the voltage balance.'}</p>
      </Panel>
    </div>
  </>;
}