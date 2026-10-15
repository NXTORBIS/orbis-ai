import { useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const PUMP_TYPES = [
  { id: 'centrifugal', label: 'Centrifugal', eff: 0.65, note: 'Best at high flow, low head' },
  { id: 'jet', label: 'Jet / booster', eff: 0.5, note: 'Suits shallow suction lifts' },
  { id: 'submersible', label: 'Submersible bore', eff: 0.6, note: 'Deep wells, multistage' },
  { id: 'positive', label: 'Positive displacement', eff: 0.75, note: 'Viscous fluids and dosing' },
];

const FLUIDS = [
  { id: 'water', label: 'Water', density: 1000, viscosity: 1 },
  { id: 'glycol', label: '30% glycol', density: 1040, viscosity: 2.2 },
  { id: 'diesel', label: 'Diesel', density: 830, viscosity: 3.5 },
  { id: 'oil', label: 'Light oil', density: 870, viscosity: 30 },
];

export default function PumpSizing() {
  const [pumpType, setPumpType] = useState('centrifugal');
  const [fluid, setFluid] = useState('water');
  const [flow, setFlow] = useState('60');
  const [staticHead, setStaticHead] = useState('8');
  const [suctionLift, setSuctionLift] = useState('2');
  const [pipeLoss, setPipeLoss] = useState('4');
  const [dischargePressure, setDischargePressure] = useState('1.5');
  const [motorEff, setMotorEff] = useState('0.9');
  const [hours, setHours] = useState('6');
  const [energyPrice, setEnergyPrice] = useState('0.25');
  const [extra, setExtra] = useState({ vfd: false, spare: true, altitude: false });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const pump = PUMP_TYPES.find((entry) => entry.id === pumpType) || PUMP_TYPES[0];
    const media = FLUIDS.find((entry) => entry.id === fluid) || FLUIDS[0];
    const q = Math.max(0.1, Number(flow) || 0) / 60 / 1000; // m3/s
    const qLpm = Math.max(0.1, Number(flow) || 0);
    const staticH = Math.max(0, Number(staticHead) || 0);
    const lift = Math.max(0, Number(suctionLift) || 0);
    const friction = Math.max(0, Number(pipeLoss) || 0);
    const pressureHead = (Math.max(0, Number(dischargePressure) || 0) * 100000) / (media.density * 9.81);
    const mEff = Math.min(0.95, Math.max(0.4, Number(motorEff) || 0.9));
    const runtime = Math.min(24, Math.max(0, Number(hours) || 0));
    const price = Math.max(0, Number(energyPrice) || 0.25);

    const frictionDerate = media.viscosity > 5 ? 1 + Math.log10(media.viscosity) * 0.22 : 1;
    const adjustedFriction = friction * frictionDerate;
    const totalHead = staticH + adjustedFriction + pressureHead + lift * 0.3;
    const pressureBar = (totalHead * media.density * 9.81) / 100000;

    const hydraulicKw = (media.density * 9.81 * q * totalHead) / 1000;
    const shaftKw = hydraulicKw / pump.eff;
    const inputKw = shaftKw / mEff;
    const dailyKwh = inputKw * runtime;
    const annualKwh = dailyKwh * 365;
    const annualCost = annualKwh * price;

    const vfdSaving = extra.vfd ? 0.28 : 0;
    const savedCost = annualCost * vfdSaving;

    const wireToWater = hydraulicKw / Math.max(0.0001, inputKw);

    // NPSH available from the suction side.
    const atmospheric = extra.altitude ? 8.9 : 10.3;
    const vapour = 0.24;
    const suctionLoss = Math.max(0.2, lift * 0.4);
    const npshA = atmospheric - lift - suctionLoss - vapour;
    const npshNeeded = pump.id === 'centrifugal' ? 3.5 : pump.id === 'jet' ? 5 : pump.id === 'submersible' ? 2.5 : 2;
    const cavitationMargin = npshA - npshNeeded;

    const pumpSize = Math.max(0.25, Math.ceil(inputKw / 0.25) * 0.25);

    const curve = [0.4, 0.6, 0.8, 1, 1.2].map((factor) => {
      const headAt = totalHead * (1.25 - 0.55 * factor * factor);
      return { label: (factor * 100).toFixed(0) + '%', value: Number(Math.max(0, headAt).toFixed(1)) };
    });

    const headRows = [
      { label: 'Static', value: Number(staticH.toFixed(1)) },
      { label: 'Friction', value: Number(adjustedFriction.toFixed(1)) },
      { label: 'Pressure', value: Number(pressureHead.toFixed(1)) },
      { label: 'Suction', value: Number((lift * 0.3).toFixed(1)) },
    ];

    const warnings = [];
    if (cavitationMargin < 0.5) warnings.push('NPSH available is ' + npshA.toFixed(1) + ' m against ' + npshNeeded + ' m needed. That margin is too thin — raise the pump, shorten the suction line or reduce the lift.');
    if (suctionLift > 7) warnings.push('Suction lift above about seven metres of water is approaching the physical limit at sea level, and altitude makes it worse.');
    if (media.viscosity > 5 && pump.id === 'centrifugal') warnings.push(pump.label + ' pumps lose head and efficiency quickly on ' + media.label + '. A positive displacement pump suits viscous media far better.');
    if (totalHead > 40 && pump.id === 'centrifugal') warnings.push('At ' + totalHead.toFixed(1) + ' m of head, a single-stage centrifugal pump is near its limit. Consider a multistage or series arrangement.');
    if (wireToWater < 0.3) warnings.push('Overall wire-to-water efficiency is only ' + Math.round(wireToWater * 100) + '%. Check the duty point against the real pump curve before buying.');
    if (runtime > 12) warnings.push('Running ' + runtime + ' hours a day makes efficiency the dominant cost. A better duty point usually pays back faster than a cheaper pump.');

    const report = [
      'PUMP SIZING',
      pump.label + ' handling ' + media.label + ' at ' + qLpm.toFixed(1) + ' L/min (' + (qLpm * 0.264172).toFixed(1) + ' US gpm)',
      '',
      'Static head: ' + staticH.toFixed(1) + ' m',
      'Friction loss: ' + adjustedFriction.toFixed(1) + ' m' + (frictionDerate > 1 ? ' (viscosity adjusted x' + frictionDerate.toFixed(2) + ')' : ''),
      'Discharge pressure head: ' + pressureHead.toFixed(1) + ' m',
      'Suction allowance: ' + (lift * 0.3).toFixed(1) + ' m',
      'TOTAL HEAD: ' + totalHead.toFixed(1) + ' m (' + pressureBar.toFixed(2) + ' bar)',
      '',
      'Hydraulic power: ' + hydraulicKw.toFixed(2) + ' kW',
      'Shaft power: ' + shaftKw.toFixed(2) + ' kW at ' + Math.round(pump.eff * 100) + '% pump efficiency',
      'Motor input: ' + inputKw.toFixed(2) + ' kW at ' + Math.round(mEff * 100) + '% motor efficiency',
      'Suggested motor size: ' + pumpSize.toFixed(2) + ' kW',
      'Wire-to-water efficiency: ' + Math.round(wireToWater * 100) + '%',
      '',
      'NPSH available: ' + npshA.toFixed(1) + ' m, required ' + npshNeeded.toFixed(1) + ' m, margin ' + cavitationMargin.toFixed(1) + ' m',
      '',
      'Running ' + runtime + ' h/day: ' + dailyKwh.toFixed(1) + ' kWh/day, ' + Math.round(annualKwh) + ' kWh/year',
      'Energy cost: ' + annualCost.toFixed(0) + ' per year at ' + price + ' per kWh' + (extra.vfd ? ', about ' + savedCost.toFixed(0) + ' saved with a VFD' : ''),
    ].join('\n');

    return {
      pump, media, qLpm, staticH, lift, friction, adjustedFriction, pressureHead, totalHead, pressureBar, hydraulicKw, shaftKw,
      inputKw, pumpSize, dailyKwh, annualKwh, annualCost, vfdSaving, savedCost, wireToWater, npshA, npshNeeded, cavitationMargin,
      curve, headRows, warnings, report, runtime, price, mEff, frictionDerate,
    };
  }, [pumpType, fluid, flow, staticHead, suctionLift, pipeLoss, dischargePressure, motorEff, hours, energyPrice, extra]);

  return (
    <ToolShell
      toolId="pump-sizing"
      icon={Gauge}
      title="Pump Head, Power & Running Cost"
      desc="Flow, static lift, friction and discharge pressure into total head, hydraulic and motor power, NPSH margin against cavitation, and what it costs to run all year."
      state={{ pumpType, fluid, flow, staticHead, suctionLift, pipeLoss, dischargePressure, motorEff, hours, energyPrice, extra }}
      onRestore={(restored) => {
        const map = { flow: setFlow, staticHead: setStaticHead, suctionLift: setSuctionLift, pipeLoss: setPipeLoss, dischargePressure: setDischargePressure, motorEff: setMotorEff, hours: setHours, energyPrice: setEnergyPrice };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.pumpType) setPumpType(restored.pumpType);
        if (restored.fluid) setFluid(restored.fluid);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="pump-sizing.txt"
    >
      <Seg value={pumpType} onChange={setPumpType} options={PUMP_TYPES.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <Seg value={fluid} onChange={setFluid} options={FLUIDS.map((entry) => ({ value: entry.id, label: entry.label }))} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Flow, L/min"><input value={flow} onChange={(e) => setFlow(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Static head, m"><input value={staticHead} onChange={(e) => setStaticHead(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Suction lift, m"><input value={suctionLift} onChange={(e) => setSuctionLift(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Pipe friction, m"><input value={pipeLoss} onChange={(e) => setPipeLoss(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Discharge pressure, bar"><input value={dischargePressure} onChange={(e) => setDischargePressure(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Motor efficiency"><input value={motorEff} onChange={(e) => setMotorEff(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Hours per day"><input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Energy price / kWh"><input value={energyPrice} onChange={(e) => setEnergyPrice(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Variable speed drive" checked={extra.vfd} onChange={() => toggle('vfd')} hint="Typically 25 to 30% less energy" />
        <ToggleRow label="Duty and standby pump" checked={extra.spare} onChange={() => toggle('spare')} hint="Redundancy cost" />
        <ToggleRow label="Site above 1000 m" checked={extra.altitude} onChange={() => toggle('altitude')} hint="Lower atmospheric pressure" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Total head for ' + result.qLpm.toFixed(0) + ' L/min of ' + result.media.label.toLowerCase()}
          value={result.totalHead.toFixed(1)}
          unit="m head"
          sub={'That is ' + result.pressureBar.toFixed(2) + ' bar of pressure. The pump needs ' + result.pumpSize.toFixed(2) + ' kW at the motor shaft, draws ' + result.inputKw.toFixed(2) + ' kW from the supply and costs about ' + result.annualCost.toFixed(0) + ' a year to run.'}
        />
        <Ring
          value={Math.round(result.wireToWater * 100)}
          max={100}
          label="Wire to water"
          sub={'Pump ' + Math.round(result.pump.eff * 100) + '%, motor ' + Math.round(result.mEff * 100) + '%'}
          unit="%"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the head goes</div>
          <Bars data={result.headRows} suffix=" m" format={(v) => v.toFixed(1)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Static head is fixed by the installation. Friction is the part a larger pipe removes, and it is usually the cheapest head you can get rid of.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Power and cost</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Hydraulic power</span><span>{result.hydraulicKw.toFixed(2)} kW</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Shaft power</span><span>{result.shaftKw.toFixed(2)} kW</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Motor input</span><span>{result.inputKw.toFixed(2)} kW</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Suggested motor</span><span className="text-cyan-j">{result.pumpSize.toFixed(2)} kW</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Daily energy</span><span>{result.dailyKwh.toFixed(1)} kWh</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Annual energy</span><span>{Math.round(result.annualKwh)} kWh</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Annual cost</span><span>{result.annualCost.toFixed(0)}</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Pump', value: result.pump.label },
                { label: 'Viscosity', value: result.media.viscosity + ' cSt' },
                { label: 'Friction ×', value: result.frictionDerate.toFixed(2) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Duty point check</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">NPSH available</span><span>{result.npshA.toFixed(1)} m</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">NPSH required</span><span>{result.npshNeeded.toFixed(1)} m</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Cavitation margin</span><span className={result.cavitationMargin > 1 ? 'text-cyan-j' : 'text-rose-400'}>{result.cavitationMargin.toFixed(1)} m</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Wire to water</span><span>{Math.round(result.wireToWater * 100)}%</span></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {result.cavitationMargin > 1
              ? 'There is comfortable margin against cavitation. Keep the suction line short, sealed and free of high points where air can collect.'
              : 'The margin is thin. Cavitation sounds like gravel moving through the pump and destroys the impeller long before the pump stops working.'}
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Typical head at reduced flow</div>
          <Bars data={result.curve} suffix=" m" format={(v) => v.toFixed(1)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            A real centrifugal pump trades head for flow along its own curve. The duty point is where that curve crosses the system curve, which is why the pump and the pipework must be chosen together.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Total head" value={result.totalHead.toFixed(1)} mono sub={result.pressureBar.toFixed(2) + ' bar'} />
        <Stat label="Motor input" value={result.inputKw.toFixed(2)} mono sub="kW electrical" />
        <Stat label="Daily energy" value={result.dailyKwh.toFixed(1)} mono sub="kWh" />
        <Stat label="Annual cost" value={result.annualCost.toFixed(0)} mono sub="at your tariff" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Before you order the pump</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Why pumps cost more than they look</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· A pump running continuously for years spends several times its purchase price on electricity. The duty point matters more than the price tag.</p>
          <p>· Throttling a valve to reduce flow wastes energy directly. Reducing speed with a variable drive cuts power with roughly the cube of the flow.</p>
          <p>· Every extra bend, strainer or partially closed valve on the suction side eats NPSH margin. Suction design is where pumps fail.</p>
          <p>· Air in the suction line is the most common cause of a noisy, underperforming pump. A properly sloping rising main and a foot valve cure most of it.</p>
          <p>· Oversizing a pump is not a safety margin. It pushes the operating point to the right of the curve, where efficiency falls and motors overload.</p>
          <p>· Viscous fluids need both a larger motor and a pump type that tolerates them; centrifugal impellers lose head quickly as viscosity rises.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Head, power and cost are computed from the duty you describe with standard hydraulic formulas. Efficiency figures are typical published values for each pump family — always confirm the chosen
          pump's own curve at your duty point before committing, and allow a margin above the calculated motor size.
        </p>
      </Panel>
    </ToolShell>
  );
}