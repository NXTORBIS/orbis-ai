import { useMemo, useState } from 'react';
import { Wind } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const SYSTEM_TYPES = [
  { id: 'supply', label: 'Supply', velocity: 350, friction: 0.08, note: 'Cool air from the unit' },
  { id: 'return', label: 'Return', velocity: 500, friction: 0.08, note: 'Warm air back to the unit' },
  { id: 'exhaust', label: 'Exhaust / kitchen', velocity: 1200, friction: 0.12, note: 'Grease and odour extraction' },
  { id: 'fresh', label: 'Fresh air intake', velocity: 600, friction: 0.1, note: 'Outdoor air brought in' },
];

const FITTINGS = [
  { id: 'none', label: 'Straight run', extra: 0 },
  { id: 'light', label: 'A few bends', extra: 6 },
  { id: 'moderate', label: 'Ducted with elbows', extra: 14 },
  { id: 'heavy', label: 'Zig-zag layout', extra: 24 },
];

export default function DuctSizing() {
  const [systemType, setSystemType] = useState('supply');
  const [airflow, setAirflow] = useState('600');
  const [airflowUnit, setAirflowUnit] = useState('cfm');
  const [shape, setShape] = useState('round');
  const [aspect, setAspect] = useState('2');
  const [length, setLength] = useState('12');
  const [fittings, setFittings] = useState('light');
  const [heightLimit, setHeightLimit] = useState('200');
  const [unitSystem, setUnitSystem] = useState('metric');
  const [staticPressure, setStaticPressure] = useState('0.5');
  const [extra, setExtra] = useState({ flex: false, insulated: true, balanced: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const sys = SYSTEM_TYPES.find((entry) => entry.id === systemType) || SYSTEM_TYPES[0];
    const fitting = FITTINGS.find((entry) => entry.id === fittings) || FITTINGS[0];
    const metric = unitSystem === 'metric';
    const cfm = airflowUnit === 'cfm' ? Math.max(1, Number(airflow) || 0) : (Number(airflow) || 0) / 0.0283168 * 60;
    const lps = (cfm / 60) * 0.0283168 * 1000;
    const runM = metric ? Math.max(0.5, Number(length) || 1) : Math.max(0.5, (Number(length) || 1) / 3.28084);
    const targetVelocity = sys.velocity * (extra.flex ? 0.9 : 1);

    // Round duct diameter from continuity: D = sqrt(4Q/(pi V)).
    const areaFt2 = cfm / sys.velocity;
    const diaIn = Math.sqrt((4 * areaFt2) / Math.PI) * 12;
    const diaMm = diaIn * 25.4;
    const standard = [100, 125, 150, 160, 180, 200, 250, 300, 315, 355, 400, 450, 500, 560, 630, 710, 800];
    const chosenMm = standard.find((size) => size >= diaMm) || standard[standard.length - 1];
    const chosenIn = Math.round((chosenMm / 25.4) * 4) / 4;
    const chosenAreaFt2 = (((chosenMm / 1000) ** 2 * Math.PI) / 4) * 10.7639;
    const actualVelocity = cfm / chosenAreaFt2;

    // Rectangular equivalent: keep the same velocity and the aspect ratio you want.
    const rectHeightMm = Math.max(50, Number(heightLimit) || 200);
    const rectWidthMm = ((chosenMm ** 2 * Math.PI) / 4) / rectHeightMm;
    const rectRounded = Math.ceil(rectWidthMm / 25) * 25;
    const rectHeightRounded = Math.ceil(((chosenMm ** 2 * Math.PI) / 4) / rectRounded / 25) * 25;
    const dew = (4 * ((rectRounded / 1000) * (rectHeightRounded / 1000))) / (2 * ((rectRounded + rectHeightRounded) / 1000));
    const velocityRect = cfm / (((rectRounded / 1000) * (rectHeightRounded / 1000)) * 10.7639);

    // Friction rate per 100 ft, plus fitting allowances expressed as equivalent length.
    const frictionPer100ft = sys.friction * (actualVelocity / sys.velocity) ** 1.85;
    const runFt = runM * 3.28084;
    const lengthWithFittings = runFt * (1 + fitting.extra / 100) * (extra.flex ? 1.25 : 1);
    const frictionLoss = (frictionPer100ft * lengthWithFittings) / 100;
    const fittingLoss = frictionPer100ft * (lengthWithFittings - runFt) / 100;
    const totalLoss = frictionLoss * (extra.insulated ? 1.05 : 1);
    const available = Math.max(0, Number(staticPressure) || 0.5);
    const remaining = available - totalLoss;

    // Fan power from flow and total pressure.
    const flowM3s = cfm * 0.000471947;
    const pressurePa = totalLoss * 249.089;
    const airPower = flowM3s * pressurePa;
    const fanInput = airPower / 0.6;

    const sizeChart = [0.8, 1, 1.25, 1.5, 2].map((factor) => {
      const size = Math.round((chosenMm * factor) / 25) * 25;
      const area = ((size / 1000) ** 2 * Math.PI) / 4;
      const vel = (lps / 1000) / area;
      return { label: size + ' mm', value: Number(vel.toFixed(2)) };
    });

    const lossRows = [
      { label: 'Straight', value: Number(frictionLoss.toFixed(3)) },
      { label: 'Fittings', value: Number(fittingLoss.toFixed(3)) },
      { label: 'Total', value: Number(totalLoss.toFixed(3)) },
    ];

    const warnings = [];
    if (actualVelocity > targetVelocity * 1.15) warnings.push('Velocity is ' + actualVelocity.toFixed(0) + ' fpm against a target of ' + targetVelocity + '. Move up a size — the noise from an undersized duct is not something a diffuser can hide.');
    if (actualVelocity < targetVelocity * 0.6) warnings.push('Velocity of ' + actualVelocity.toFixed(0) + ' fpm is well under target. Oversized ducts cost more, lose more heat through the surface and can stratify air in the room.');
    if (remaining <= 0) warnings.push('The run needs ' + totalLoss.toFixed(2) + ' in w.g. against ' + available.toFixed(2) + ' available. Shorten the run, remove fittings or choose a higher static pressure unit.');
    if (extra.flex && runM > 3) warnings.push('Flexible duct over long runs crushes and sags, adding far more resistance than the table suggests. Keep it short and pulled tight.');
    if (rectRounded > 1200) warnings.push('The rectangular equivalent needs a ' + rectRounded + ' mm side. Round duct is cheaper, quieter and easier to seal at that size.');
    if (dew < 150 && shape === 'rect') warnings.push('Equivalent diameter is ' + dew.toFixed(0) + ' mm, below the point where rectangular duct stops behaving like round. Recheck against a duct calculator.');
    if (systemType === 'exhaust' && !extra.insulated) warnings.push('Kitchen exhaust ducting should be smooth, sealed and grease-tight with the shortest possible run — never flexible, never insulated on the inside.');

    const report = [
      'DUCT SIZING',
      sys.label + ' system, ' + Math.round(cfm) + ' cfm (' + Math.round(lps) + ' L/s)',
      'Straight run ' + runM.toFixed(1) + ' m with ' + fitting.label.toLowerCase() + (extra.flex ? ', flexible' : ''),
      '',
      'Round duct: ' + chosenMm + ' mm (' + chosenIn.toFixed(2) + ' in)',
      'Actual velocity: ' + actualVelocity.toFixed(0) + ' fpm on ' + chosenAreaFt2.toFixed(2) + ' ft²',
      rectRounded ? 'Rectangular equivalent: ' + rectRounded + ' x ' + rectHeightRounded + ' mm' : '',
      'Velocity in rectangular: ' + velocityRect.toFixed(0) + ' fpm',
      '',
      'Friction rate: ' + frictionPer100ft.toFixed(3) + ' in w.g. per 100 ft',
      'Effective length with fittings: ' + lengthWithFittings.toFixed(1) + ' ft (' + (lengthWithFittings * 0.3048).toFixed(1) + ' m)',
      'Total pressure loss: ' + totalLoss.toFixed(3) + ' in w.g. (' + (totalLoss * 249.089).toFixed(0) + ' Pa)',
      'Static pressure available: ' + available.toFixed(2) + ' in w.g., remaining ' + remaining.toFixed(3),
      '',
      'Air power: ' + airPower.toFixed(1) + ' W, fan input at 60% efficiency: ' + fanInput.toFixed(0) + ' W',
      '',
      'Velocity by size',
      ...sizeChart.map((row) => '  ' + row.label + ': ' + row.value.toFixed(2) + ' m/s'),
    ].filter(Boolean).join('\n');

    return {
      sys, fitting, metric, cfm, lps, runM, targetVelocity, diaIn, diaMm, chosenMm, chosenIn, actualVelocity, rectWidthMm,
      rectRounded, rectHeightRounded, dew, velocityRect, frictionPer100ft, runFt, lengthWithFittings, frictionLoss,
      fittingLoss, totalLoss, available, remaining, flowM3s, pressurePa, airPower, fanInput, sizeChart, lossRows, shape, warnings, report, heightLimit,
    };
  }, [systemType, airflow, airflowUnit, shape, aspect, length, fittings, heightLimit, unitSystem, staticPressure, extra]);

  return (
    <ToolShell
      toolId="duct-sizing"
      icon={Wind}
      title="HVAC Duct Sizing & Pressure Loss"
      desc="Airflow, run length and fitting count into round or rectangular duct size, real velocity, friction rate and the static pressure left for the unit — plus what the fan will draw."
      state={{ systemType, airflow, airflowUnit, shape, aspect, length, fittings, heightLimit, unitSystem, staticPressure, extra }}
      onRestore={(restored) => {
        const map = { airflow: setAirflow, aspect: setAspect, length: setLength, heightLimit: setHeightLimit, staticPressure: setStaticPressure };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.systemType) setSystemType(restored.systemType);
        if (restored.airflowUnit) setAirflowUnit(restored.airflowUnit);
        if (restored.shape) setShape(restored.shape);
        if (restored.fittings) setFittings(restored.fittings);
        if (restored.unitSystem) setUnitSystem(restored.unitSystem);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="duct-sizing.txt"
    >
      <Seg value={systemType} onChange={setSystemType} options={SYSTEM_TYPES.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Duct shape"><Seg value={shape} onChange={setShape} options={[{ value: 'round', label: 'Round' }, { value: 'rect', label: 'Rectangular' }]} /></Field>
        <Field label="Run complexity"><Seg value={fittings} onChange={setFittings} options={FITTINGS.map((entry) => ({ value: entry.id, label: entry.label.split(' ')[0] }))} /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Airflow (' + (airflowUnit === 'cfm' ? Math.round(result.lps) + ' L/s' : Math.round(result.cfm) + ' cfm')}>
          <div className="flex gap-2">
            <input value={airflow} onChange={(e) => setAirflow(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            <select value={airflowUnit} onChange={(e) => setAirflowUnit(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs">
              <option value="cfm">cfm</option>
              <option value="lps">L/s</option>
            </select>
          </div>
        </Field>
        <Field label={result.metric ? 'Straight run, m' : 'Straight run, ft'}><input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Max duct height, mm"><input value={heightLimit} onChange={(e) => setHeightLimit(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Fan static, in w.g."><input value={staticPressure} onChange={(e) => setStaticPressure(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Flexible ducting" checked={extra.flex} onChange={() => toggle('flex')} hint="Higher resistance, lower target speed" />
        <ToggleRow label="Insulated duct" checked={extra.insulated} onChange={() => toggle('insulated')} hint="Slight gain and more surface loss" />
        <ToggleRow label="Balanced branches" checked={extra.balanced} onChange={() => toggle('balanced')} hint="Dampers on each branch" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.sys.label + ' duct for ' + Math.round(result.cfm) + ' cfm'}
          value={result.chosenMm}
          unit="mm round"
          sub={result.shape === 'round'
            ? 'That is ' + result.chosenIn.toFixed(2) + ' inches, giving ' + result.actualVelocity.toFixed(0) + ' fpm against a ' + result.targetVelocity + ' fpm target. The whole run drops ' + result.totalLoss.toFixed(3) + ' in w.g. of static pressure.'
            : 'Equivalent rectangular section ' + result.rectRounded + ' × ' + result.rectHeightRounded + ' mm at ' + result.velocityRect.toFixed(0) + ' fpm. Equivalent diameter is ' + result.dew.toFixed(0) + ' mm.'}
        />
        <Gauge
          value={Number(result.actualVelocity.toFixed(0))}
          min={0}
          max={1400}
          label="Duct velocity"
          unit=" fpm"
          bands={[{ to: 500, tone: 'cyan' }, { to: 900, tone: 'violet' }, { to: 1400, tone: 'rose' }]}
          caption="Supply ducts are quiet below about 500 fpm; kitchen exhaust must run far faster to carry grease."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Velocity at neighbouring sizes</div>
          <Bars data={result.sizeChart} suffix=" m/s" format={(v) => v.toFixed(2)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            One size up cuts velocity by roughly 20% and cuts noise by far more than that. Duct noise rises steeply with speed, not gently.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Sizing summary</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Round size</span><span className="text-cyan-j">{result.chosenMm} mm / {result.chosenIn.toFixed(2)} in</span></div>
            {result.shape === 'rect' && <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Rectangular</span><span>{result.rectRounded} × {result.rectHeightRounded} mm</span></div>}
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Airflow</span><span>{Math.round(result.cfm)} cfm / {Math.round(result.lps)} L/s</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Friction</span><span>{result.frictionPer100ft.toFixed(3)} in w.g./100 ft</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Effective length</span><span>{result.lengthWithFittings.toFixed(1)} ft</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Total loss</span><span>{result.totalLoss.toFixed(3)} in w.g.</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Fan power</span><span>{result.fanInput.toFixed(0)} W at 60% efficiency</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Static remaining</span><span className={result.remaining > 0 ? 'text-cyan-j' : 'text-rose-400'}>{result.remaining.toFixed(3)} in w.g.</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Target', value: result.targetVelocity + ' fpm' },
                { label: 'Equivalent dia', value: result.dew.toFixed(0) + ' mm' },
                { label: 'Air power', value: result.airPower.toFixed(0) + ' W' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the pressure goes</div>
          <Bars data={result.lossRows} suffix=" in w.g." format={(v) => v.toFixed(3)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Fittings and elbows routinely cost as much pressure as the straight run. Removing one elbow is usually cheaper than adding a size.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Full report</div>
          <pre className="max-h-64 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Duct size" value={String(result.chosenMm)} mono sub="mm round equivalent" />
        <Stat label="Velocity" value={result.actualVelocity.toFixed(0)} mono sub="fpm actual" />
        <Stat label="Total loss" value={result.totalLoss.toFixed(3)} mono sub="in w.g." />
        <Stat label="Fan power" value={result.fanInput.toFixed(0)} mono sub="watts input" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Duct design cautions</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Velocity rules of thumb</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Application</th><th className="py-1 text-right">fpm</th><th className="py-1 text-right">m/s</th><th className="py-1 pr-2 text-left">Notes</th></tr>
              </thead>
              <tbody>
                {SYSTEM_TYPES.map((entry) => (
                  <tr key={entry.id} className={`border-t border-border/40 ${entry.id === result.sys.id ? 'text-cyan-j' : ''}`}>
                    <td className="py-1 pl-2">{entry.label}</td>
                    <td className="py-1 text-right">{entry.velocity}</td>
                    <td className="py-1 text-right">{(entry.velocity * 0.00508).toFixed(1)}</td>
                    <td className="py-1 pr-2">{entry.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Installing it properly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Seal every joint, including the ones behind the ceiling. Leaky supply duct quietly dumps conditioned air into a roof space, which is the same as paying to heat the sky.</p>
            <p>· Keep at least three duct diameters of straight run before the fan inlet. The inlet condition decides how much air the fan actually moves.</p>
            <p>· Support flexible duct so it runs taut and straight. A sagged section adds resistance and loses airflow you have already paid for.</p>
            <p>· Put the last branch run as short as you can. The furthest room always gets the least air, and that is the room people complain about.</p>
            <p>· Return air is not an afterthought. A choked return starves the whole system and raises velocity at the grille to a whistle.</p>
            <p>· Balance with dampers rather than by guessing diffuser sizes, and measure the flow at the outlets rather than assuming it.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Sized on a constant-friction method with typical duct friction rates and an assumed 60% fan efficiency. Real systems need branch-by-branch balancing, fitting loss coefficients from a duct
          calculator and the selected unit's actual fan curve; use this to choose a size and check it never lands off the chart.
        </p>
      </Panel>
    </ToolShell>
  );
}