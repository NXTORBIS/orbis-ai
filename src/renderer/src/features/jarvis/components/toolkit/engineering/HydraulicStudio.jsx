import { useState } from 'react';
import { CircuitBoard } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Panel, Stat, Field } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge, Bars } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import HydraulicView from '@jarvis/components/toolkit/engineering/HydraulicView';
import { hydraulicSim, DCV_POSITIONS, COMPONENT_CATALOGUE, withComponentDisabled, updateComponentParams } from '@jarvis/components/toolkit/engineering/hydraulicCore';

export default function HydraulicStudio() {
  return (
    <EngShell
      sim={hydraulicSim}
      toolId="hydraulic-circuit"
      icon={CircuitBoard}
      title="Hydraulic Circuit Builder"
      desc="Wire a pump, relief valve, directional valve and cylinder together, add optional restrictor, check valve or accumulator, then watch line pressures, flows, cylinder force and speed come out of the flow balance and the load."
    >
      {({ params, setParams, readings: r, api }) => (
        <HydraulicBody params={params} setParams={setParams} readings={r} api={api} />
      )}
    </EngShell>
  );
}

function HydraulicBody({ params, setParams, readings: r, api }) {
  const [selected, setSelected] = useState('dcv');
  const circuit = params.circuit;
  const setCircuit = (next) => setParams({ ...params, circuit: next });
  const component = circuit.components.find((c) => c.id === selected);
  const optional = circuit.components.filter((c) => ['meter', 'check', 'accumulator'].includes(c.id));
  const cylinder = circuit.components.find((c) => c.type === 'cylinder');

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Hero label="Line pressure" value={r.pressure.P.toFixed(1)} unit="bar" sub={`cap ${r.pressure.A.toFixed(1)} · rod ${r.pressure.B.toFixed(1)} bar`} tone={r.stalling ? 'rose' : 'cyan'} />
        <Stat label="Cylinder force" value={`${(r.force / 1000).toFixed(2)} kN`} sub={`against a ${(r.load / 1000).toFixed(1)} kN load`} mono />
        <Stat label="Piston speed" value={`${r.velocityMm.toFixed(1)} mm/s`} sub={`${r.capFlow.toFixed(2)} L/min into the cap side`} mono />
        <Stat label="Pump" value={`${r.pumpFlow.toFixed(2)} L/min`} sub={`${r.pumpPower.toFixed(3)} kW absorbed`} mono />
      </div>

      <Panel className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Circuit</h3>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Directional valve
              <select aria-label="Valve position" className="rounded-lg border border-border bg-card/60 px-2 py-1 text-xs" value={params.dcvPosition} onChange={(e) => setParams({ ...params, dcvPosition: e.target.value })}>
                {Object.entries(DCV_POSITIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <Button size="sm" variant="outline" onClick={() => setParams({ ...params, load: params.load + 5000 })}>Add 5 kN load</Button>
            <Button size="sm" variant="outline" onClick={() => setParams({ ...params, load: Math.max(0, params.load - 5000) })}>Remove 5 kN</Button>
          </div>
        </div>
        <HydraulicView readings={r} params={params} selected={selected} onSelect={setSelected} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="space-y-2 lg:col-span-2">
          <h3 className="text-sm font-semibold">Pressures and motion</h3>
          <ScientificPlot
            series={[
              { label: 'Line pressure (bar)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.pP?.[i] ?? 0 })) },
              { label: 'Pump flow (L/min)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.flow?.[i] ?? 0 })) },
            ]}
            xLabel="Time (s)"
            yLabel="bar / L·min⁻¹"
            height={210}
          />
          <ScientificPlot
            series={[
              { label: 'Cylinder position (mm)', points: (api.history.xs || []).map((x, i) => ({ x, y: api.history.data.position?.[i] ?? 0 })) },
              { label: 'Cylinder force (kN)', points: (api.history.xs || []).map((x, i) => ({ x, y: (api.history.data.force?.[i] ?? 0) / 1000 })) },
            ]}
            xLabel="Time (s)"
            yLabel="mm / kN"
            height={190}
          />
        </Panel>
        <div className="space-y-3">
          <Gauge value={r.positionPercent} min={0} max={100} label="Stroke used" unit="%" caption={`${r.position.toFixed(1)} mm of ${r.stroke} mm`} />
          <Panel className="space-y-2">
            <h3 className="text-sm font-semibold">Energy ledger</h3>
            <Bars data={[
              { label: 'Pump in', value: r.ledger.pump },
              { label: 'Load', value: r.ledger.hydraulic, tone: 'rose' },
            ]} suffix=" J" format={(v) => v.toFixed(1)} />
            <Stat label="Overall efficiency" value={`${(r.efficiency * 100).toFixed(1)}%`} sub={`heat ${r.heat.toFixed(2)} kJ · ledger closes to ${r.balance.toExponential(1)} J`} mono />
            <Stat label="Relief passing" value={`${r.reliefFlow.toFixed(2)} L/min`} sub={r.stalling ? 'The cylinder is stalled — all pump flow is being dumped as heat.' : 'Only what the circuit cannot absorb.'} mono />
          </Panel>
        </div>
      </div>

      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold">Components</h3>
        <p className="text-xs text-muted-foreground">Every element is a real element in the solver: it contributes its own flow to the node balance, so disabling one genuinely changes the result.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {optional.map((c) => (
            <div key={c.id} className="tk-glass-panel space-y-2 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{COMPONENT_CATALOGUE[c.type].label}</span>
                <Button size="sm" variant={c.enabled === false ? 'outline' : 'default'} onClick={() => setCircuit(withComponentDisabled(circuit, c.id, c.enabled === false))}>
                  {c.enabled === false ? 'Add to circuit' : 'Remove'}
                </Button>
              </div>
              {c.type === 'restrictor' && <Field label="Restrictor area (mm²)"><input aria-label="Restrictor area" type="number" step="5" className="w-full rounded-lg border border-border bg-card/60 p-2 text-xs" value={c.params.area * 1e6} onChange={(e) => setCircuit(updateComponentParams(circuit, c.id, { area: Number(e.target.value) * 1e-6 }))} /></Field>}
              {c.type === 'check' && <Field label="Cracking pressure (bar)"><input aria-label="Cracking pressure" type="number" step="0.5" className="w-full rounded-lg border border-border bg-card/60 p-2 text-xs" value={c.params.crackBar} onChange={(e) => setCircuit(updateComponentParams(circuit, c.id, { crackBar: Number(e.target.value) }))} /></Field>}
              {c.type === 'accumulator' && <Field label="Precharge (bar)"><input aria-label="Precharge" type="number" step="5" className="w-full rounded-lg border border-border bg-card/60 p-2 text-xs" value={c.params.precharge} onChange={(e) => setCircuit(updateComponentParams(circuit, c.id, { precharge: Number(e.target.value) }))} /></Field>}
            </div>
          ))}
          <div className="tk-glass-panel space-y-2 rounded-xl p-3">
            <span className="text-xs font-medium">Relief setting</span>
            <Field label="Cracking pressure (bar)">
              <input
                aria-label="Relief setting"
                type="number"
                step="5"
                className="w-full rounded-lg border border-border bg-card/60 p-2 text-xs"
                value={circuit.components.find((c) => c.type === 'relief').params.setting}
                onChange={(e) => setCircuit(updateComponentParams(circuit, 'relief', { setting: Number(e.target.value) }))}
              />
            </Field>
            <span className="text-xs font-medium">Cylinder load</span>
            <Field label="Load (kN)">
              <input
                aria-label="Load"
                type="number"
                step="0.5"
                className="w-full rounded-lg border border-border bg-card/60 p-2 text-xs"
                value={params.load / 1000}
                onChange={(e) => setParams({ ...params, load: Number(e.target.value) * 1000 })}
              />
            </Field>
            <Stat label="Cylinder" value={`${cylinder.params.bore} / ${cylinder.params.rod} mm`} sub={`${(r.areas.cap * 1e4).toFixed(2)} cm² cap · ${(r.areas.annulus * 1e4).toFixed(2)} cm² annulus`} mono />
          </div>
        </div>
      </Panel>
    </>
  );
}