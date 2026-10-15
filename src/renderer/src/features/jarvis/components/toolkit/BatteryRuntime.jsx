import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const CHEMISTRY = {
  lead: { label: 'Lead-acid or AGM', dod: 50, maxRate: 0.2, cycleNote: 'roughly 300 to 500 cycles at half depth' },
  gel: { label: 'Gel', dod: 50, maxRate: 0.2, cycleNote: 'similar to AGM, but slower to charge' },
  lifepo4: { label: 'LiFePO4', dod: 90, maxRate: 1, cycleNote: '2000 to 5000 cycles at deep discharge' },
  liion: { label: 'Li-ion NMC', dod: 80, maxRate: 1, cycleNote: '500 to 1000 cycles, usually lighter for the same energy' },
};

export default function BatteryRuntime() {
  const [chemistry, setChemistry] = useState('lifepo4');
  const [capacity, setCapacity] = useState('100');
  const [capacityUnit, setCapacityUnit] = useState('Ah');
  const [voltage, setVoltage] = useState('12.8');
  const [load, setLoad] = useState('300');
  const [dod, setDod] = useState('90');
  const [inverter, setInverter] = useState('88');
  const [idle, setIdle] = useState('8');
  const [sunHours, setSunHours] = useState('4');
  const [target, setTarget] = useState('6');

  const result = useMemo(() => {
    const spec = CHEMISTRY[chemistry] || CHEMISTRY.lifepo4;
    const volts = Math.max(1, Number(voltage) || 12);
    const ampHours = capacityUnit === 'Ah' ? Math.max(0, Number(capacity) || 0) : maxWhFallback();
    const wh = capacityUnit === 'Ah' ? ampHours * volts : Math.max(0, Number(capacity) || 0);

    function maxWhFallback() {
      return Math.max(0, Number(capacity) || 0) / volts;
    }

    const depth = Math.max(10, Math.min(100, Number(dod) || spec.dod));
    const inverterEff = Math.max(50, Math.min(100, Number(inverter) || 88)) / 100;
    const idleLoss = Math.max(0, Number(idle) || 0);
    const loadW = Math.max(1, Number(load) || 0);

    const usableWh = wh * (depth / 100) * inverterEff;
    const effectiveLoad = loadW + idleLoss;
    const runtimeHours = effectiveLoad ? usableWh / effectiveLoad : 0;
    const currentDraw = loadW / volts;
    const cRate = ampHours ? currentDraw / ampHours : 0;
    const chargeHours = ampHours ? (ampHours * (depth / 100)) / Math.max(1, ampHours * 0.2) : 0;
    const sun = Math.max(0.5, Number(sunHours) || 4);
    const solarWatts = (wh * (depth / 100)) / (sun * 0.75);
    const targetHours = Math.max(0.5, Number(target) || 6);
    const batteriesNeeded = Math.ceil((effectiveLoad * targetHours) / Math.max(1, usableWh));

    const profile = [0.25, 0.5, 0.75, 1, 1.25, 1.5].map((multiplier) => ({
      label: Math.round(multiplier * 100) + '%',
      load: Math.round(loadW * multiplier),
      value: Number(((usableWh / (loadW * multiplier + idleLoss))).toFixed(2)),
    }));

    const warnings = [];
    if (cRate > spec.maxRate) warnings.push('The draw is ' + cRate.toFixed(2) + 'C, above the ' + spec.maxRate + 'C that ' + spec.label.toLowerCase() + ' is comfortable with. Capacity delivered will be lower than the label, and the battery will age faster.');
    if (chemistry === 'lead' || chemistry === 'gel') warnings.push('Discharging below 50% on lead chemistry shortens life sharply. The 50% rule is not conservatism, it is the chemistry.');
    if (inverterEff < 0.85) warnings.push('Inverter efficiency is set at ' + (inverterEff * 100).toFixed(0) + '%, which loses roughly ' + ((1 - inverterEff) * 100).toFixed(0) + '% of the stored energy as heat before the load sees any of it.');
    if (idleLoss > loadW * 0.3) warnings.push('Inverter idle draw is a large share of the total load. Leaving it switched on for a small load is the most common way a system underperforms.');
    if (runtimeHours < 1) warnings.push('At this load the battery lasts under an hour. For continuous use you are looking at a generator or mains supply with the battery as backup only.');

    return {
      spec, volts, ampHours, wh, depth, inverterEff, idleLoss, loadW, usableWh, effectiveLoad, runtimeHours, currentDraw, cRate,
      chargeHours, solarWatts, profile, warnings, batteriesNeeded, targetHours,
      days: runtimeHours / 24,
      deepCycleNote: spec.cycleNote,
    };
  }, [chemistry, capacity, capacityUnit, voltage, load, dod, inverter, idle, sunHours, target]);

  const report = useMemo(() => [
    'Battery: ' + result.spec.label + ', ' + result.wh.toFixed(0) + ' Wh at ' + result.volts + ' V' + (result.ampHours ? ' (' + result.ampHours.toFixed(0) + ' Ah)' : ''),
    'Usable energy ' + result.usableWh.toFixed(0) + ' Wh after ' + result.depth + '% depth of discharge and ' + (result.inverterEff * 100).toFixed(0) + '% inverter efficiency',
    'Load ' + result.loadW + ' W plus ' + result.idleLoss + ' W idle',
    '',
    'Runtime: ' + result.runtimeHours.toFixed(2) + ' hours (' + (result.runtimeHours * 60).toFixed(0) + ' minutes)',
    'Current draw ' + result.currentDraw.toFixed(1) + ' A, a discharge rate of ' + result.cRate.toFixed(2) + 'C',
    'Recharge from empty at a 0.2C charge rate: about ' + result.chargeHours.toFixed(1) + ' hours',
    'Solar to recharge in one day: about ' + result.solarWatts.toFixed(0) + ' W of panel',
    'Batteries of this size needed for ' + result.targetHours + ' hours: ' + result.batteriesNeeded,
    '',
    ...result.warnings.map((line) => '· ' + line),
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="battery-runtime"
      icon={Zap}
      title="Battery Runtime & Sizing"
      desc="Battery capacity and load into real runtime, with depth of discharge, inverter losses, idle draw, recharge time and the panel or battery count needed to hit a target."
      state={{ chemistry, capacity, capacityUnit, voltage, load, dod, inverter, idle, sunHours, target }}
      onRestore={(restored) => {
        if (restored.chemistry) setChemistry(restored.chemistry);
        if (restored.capacity !== undefined) setCapacity(String(restored.capacity));
        if (restored.capacityUnit) setCapacityUnit(restored.capacityUnit);
        if (restored.voltage !== undefined) setVoltage(String(restored.voltage));
        if (restored.load !== undefined) setLoad(String(restored.load));
        if (restored.dod !== undefined) setDod(String(restored.dod));
        if (restored.inverter !== undefined) setInverter(String(restored.inverter));
        if (restored.idle !== undefined) setIdle(String(restored.idle));
        if (restored.sunHours !== undefined) setSunHours(String(restored.sunHours));
        if (restored.target !== undefined) setTarget(String(restored.target));
      }}
      exportText={report}
      exportName="battery-runtime.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(CHEMISTRY).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => { setChemistry(key); setDod(String(CHEMISTRY[key].dod)); }}
            className={key === chemistry
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
          >
            {CHEMISTRY[key].label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Battery capacity"><input value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Capacity unit">
          <Seg value={capacityUnit} onChange={setCapacityUnit} options={[{ value: 'Ah', label: 'Ah' }, { value: 'Wh', label: 'Wh' }]} />
        </Field>
        <Field label="Nominal voltage"><input value={voltage} onChange={(e) => setVoltage(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Load, W"><input value={load} onChange={(e) => setLoad(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Depth of discharge, %"><input value={dod} onChange={(e) => setDod(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Inverter efficiency, %"><input value={inverter} onChange={(e) => setInverter(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Inverter idle draw, W"><input value={idle} onChange={(e) => setIdle(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Target runtime, hours"><input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Peak sun hours a day"><input value={sunHours} onChange={(e) => setSunHours(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Runtime at this load"
          value={result.runtimeHours.toFixed(1)}
          unit="hours"
          sub={result.wh.toFixed(0) + ' Wh of storage gives ' + result.usableWh.toFixed(0) + ' Wh of usable energy at ' + result.depth + '% depth of discharge, and ' + result.effectiveLoad.toFixed(0) + ' W of load including inverter idle draw. That is ' + (result.runtimeHours * 60).toFixed(0) + ' minutes.'}
        />
        <Ring
          value={result.cRate}
          max={Math.max(0.5, result.spec.maxRate * 2)}
          tone={result.cRate > result.spec.maxRate ? 'rose' : 'emerald'}
          label="Discharge rate in C"
          sub={result.spec.label + ' is comfortable up to ' + result.spec.maxRate + 'C. This draw is ' + result.currentDraw.toFixed(1) + ' A from ' + result.ampHours.toFixed(0) + ' Ah.'}
        />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3 !border-amber-400/50">
          <div className="space-y-1 text-[11px] text-amber-200">
            {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Runtime as the load changes</div>
          <Bars
            data={result.profile.map((row) => ({ label: row.label + ' · ' + row.load + 'W', value: row.value }))}
            format={(value) => value.toFixed(1)}
            suffix=" h"
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The relationship looks linear and is not quite. Lead chemistry in particular delivers less total energy at high current, so the real runtime at 150% load will be
            shorter than this table suggests.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The numbers</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Stored energy</span><span>{result.wh.toFixed(0)} Wh</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Usable energy</span><span className="text-cyan-j">{result.usableWh.toFixed(0)} Wh</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Effective load</span><span>{result.effectiveLoad.toFixed(0)} W</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Runtime</span><span className="text-cyan-j">{result.runtimeHours.toFixed(2)} h · {(result.runtimeHours * 60).toFixed(0)} min</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Current draw</span><span>{result.currentDraw.toFixed(1)} A</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Charge time at 0.2C</span><span>{result.chargeHours.toFixed(1)} h</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Solar to refill daily</span><span>{result.solarWatts.toFixed(0)} W of panel</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">For {result.targetHours} h of runtime</span><span>{result.batteriesNeeded} batter{result.batteriesNeeded === 1 ? 'y' : 'ies'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Cycle life at this depth</span><span>{result.deepCycleNote}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Runtime" value={result.runtimeHours.toFixed(1) + ' h'} mono sub={(result.runtimeHours * 60).toFixed(0) + ' minutes'} />
        <Stat label="Usable energy" value={result.usableWh.toFixed(0) + ' Wh'} mono sub={'of ' + result.wh.toFixed(0) + ' stored'} />
        <Stat label="Discharge rate" value={result.cRate.toFixed(2) + 'C'} mono sub={result.cRate > result.spec.maxRate ? 'above the safe rate' : 'within the safe rate'} />
        <Stat label="Panel to refill" value={result.solarWatts.toFixed(0) + ' W'} mono sub={sunHours + ' sun hours a day'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the energy actually goes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Depth of discharge is a policy, not a limit: lead chemistry can be taken past half, it just loses cycles each time you do.</p>
            <p>· Inverter conversion is the largest hidden loss. A 12 V system running an AC load through a cheap inverter can lose a quarter of the stored energy before anything switches on.</p>
            <p>· Idle draw runs all night whether or not the load is active. On small systems it is often the reason runtime falls short of the calculation.</p>
            <p>· Wiring and connections cost a little more. Long cable runs at 12 V lose meaningful power, which is why larger systems move to 24 or 48 V.</p>
            <p>· Capacity is quoted at a specific discharge rate. A 100 Ah lead battery at 1C delivers considerably less than 100 Ah in practice.</p>
            <p>· Cold reduces usable capacity, sometimes by a fifth in freezing conditions, and charging below zero is damaging for lithium.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sizing and wiring rules that matter</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Size for the worst realistic week, then add 20 to 30% margin. A system sized exactly to the average will fail on the first cloudy week.</p>
            <p>· {result.spec.label} at this depth of discharge gives {result.deepCycleNote}. Buying for cycle life is usually cheaper than replacing cheap batteries twice.</p>
            <p>· Never mix old and new batteries in one bank. The weakest cell sets the performance of the whole string, and the mismatch accelerates with age.</p>
            <p>· Series raises voltage and keeps the capacity in amp hours; parallel raises capacity and keeps the voltage. Both change how the fuse and cable need to be sized.</p>
            <p>· Fuse at the battery terminal, not at the load end. A short in the cable between them is exactly what the fuse exists for.</p>
            <p>· Charge at around 0.2C for lead and up to 0.5C for lithium. Charging far slower than the manufacturer specifies can leave lead batteries permanently undercharged.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Chemistry', value: result.spec.label.split(' ')[0] },
                { label: 'Runtime', value: result.runtimeHours.toFixed(1) + ' h' },
                { label: 'Rate', value: result.cRate.toFixed(2) + 'C' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>stored energy = amp hours × nominal voltage</p>
          <p>usable energy = stored × depth of discharge × inverter efficiency</p>
          <p>runtime = usable energy ÷ (load + idle draw)</p>
          <p>current draw = load ÷ voltage, and the C rate is that current ÷ amp hours</p>
          <p>solar panel watts = stored energy × depth ÷ (peak sun hours × 0.75 system derate)</p>
          <p className="text-cyan-j">Check: {result.wh.toFixed(0)} Wh × {result.depth}% × {(result.inverterEff * 100).toFixed(0)}% = {result.usableWh.toFixed(0)} Wh usable.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The model treats capacity as constant, which is optimistic at high current and in the cold. For lead chemistry in particular, treat the result as the best case and plan
          your load around the worst.
        </p>
      </Panel>
    </ToolShell>
  );
}