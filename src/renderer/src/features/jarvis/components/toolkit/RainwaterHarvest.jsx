import { useMemo, useState } from 'react';
import { Droplets } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const ROOF_TYPES = [
  { id: 'tile', label: 'Concrete tile', coef: 0.85 },
  { id: 'metal', label: 'Corrugated metal', coef: 0.9 },
  { id: 'asphalt', label: 'Asphalt shingle', coef: 0.8 },
  { id: 'membrane', label: 'Flat membrane', coef: 0.8 },
  { id: 'green', label: 'Green roof', coef: 0.6 },
];

const USE_CASES = [
  { id: 'garden', label: 'Garden irrigation' },
  { id: 'toilet', label: 'Toilets and laundry' },
  { id: 'potable', label: 'Treated, near potable' },
  { id: 'topup', label: 'Pond / pool top-up' },
];

export default function RainwaterHarvest() {
  const [roofType, setRoofType] = useState('tile');
  const [roofArea, setRoofArea] = useState('120');
  const [rainfall, setRainfall] = useState('900');
  const [dryMonths, setDryMonths] = useState('3');
  const [household, setHousehold] = useState('400');
  const [tank, setTank] = useState('5000');
  const [usage, setUsage] = useState('garden');
  const [downpipes, setDownpipes] = useState('3');
  const [waterPrice, setWaterPrice] = useState('2.4');
  const [installCost, setInstallCost] = useState('3200');
  const [unit, setUnit] = useState('metric');
  const [extra, setExtra] = useState({ firstFlush: true, filter: true, pump: true, overflow: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const roof = ROOF_TYPES.find((entry) => entry.id === roofType) || ROOF_TYPES[0];
    const metric = unit === 'metric';
    const areaM2 = metric ? Math.max(5, Number(roofArea) || 0) : Math.max(5, (Number(roofArea) || 0) / 10.7639);
    const rainMm = Math.max(50, Number(rainfall) || 0) * (metric ? 1 : 25.4);
    const dry = Math.min(9, Math.max(0, Number(dryMonths) || 0));
    const dailyUse = metric ? Math.max(0, Number(household) || 0) : (Number(household) || 0) * 3.78541;
    const tankLitres = metric ? Math.max(50, Number(tank) || 0) : (Number(tank) || 0) * 3.78541;
    const nDownpipes = Math.max(1, Number(downpipes) || 1);
    const price = metric ? Math.max(0, Number(waterPrice) || 0) : (Number(waterPrice) || 0) * 3.78541;
    const capex = Math.max(0, Number(installCost) || 0);

    const efficiency = 0.9 * (extra.filter ? 0.95 : 1) * (extra.firstFlush ? 0.95 : 1);
    const annualLitres = areaM2 * rainMm * roof.coef * efficiency;
    const monthlyAverage = annualLitres / 12;
    const dryLossMonths = Math.min(dry, 12);
    const wetMonthly = dryLossMonths > 0 ? annualLitres / (12 - dryLossMonths) : monthlyAverage;

    // Tank needs to carry the dry season from the wettest month's harvest.
    const carryLitres = dryLossMonths * 30 * dailyUse;
    const requiredTank = carryLitres + Math.max(0, dailyUse * 7);
    const coverDays = dailyUse > 0 ? tankLitres / dailyUse : 0;
    const tankCovers = coverDays * 30 >= dryLossMonths * 30;
    const supplyRatio = dailyUse > 0 ? Math.min(3, monthlyAverage / dailyUse) : 0;
    const annualDemand = dailyUse * 365;
    const demandCovered = annualDemand > 0 ? Math.min(1, annualLitres / annualDemand) : 0;
    const deliveredLitres = Math.min(annualLitres, annualDemand);
    const annualSaving = (deliveredLitres / 1000) * (metric ? price : price);
    const payback = annualSaving > 0 ? capex / annualSaving : 0;
    const overflow = Math.max(0, annualLitres - deliveredLitres);

    // First flush volume: about 0.5 to 2 mm of rain depending on how dirty the roof is.
    const firstFlushLitres = areaM2 * (roof.id === 'tile' ? 1.5 : roof.id === 'metal' ? 0.6 : 1) * roof.coef;
    const downpipeFlow = (rainMm / 1000 / 12) * areaM2 / (30 * 24 * 3600) * 1000;

    const monthly = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, index) => {
      const wet = index >= 4 && index <= 9 ? 1.35 : 0.7;
      return { label: month, value: Number(((annualLitres * wet) / (6 * 1.35 + 6 * 0.7) / 1000).toFixed(2)) };
    });

    const demandRows = [
      { label: 'Harvest', value: Number((annualLitres / 1000).toFixed(1)) },
      { label: 'Demand', value: Number((annualDemand / 1000).toFixed(1)) },
      { label: 'Tank use', value: Number((deliveredLitres / 1000).toFixed(1)) },
      { label: 'Overflow', value: Number((overflow / 1000).toFixed(1)) },
    ];

    const warnings = [];
    if (supplyRatio < 1 && dailyUse > 0) warnings.push('The roof harvests ' + Math.round(supplyRatio * 100) + '% of what you use. Everything downstream still needs mains backup or a larger collection area.');
    if (tankCovers === false) warnings.push('A ' + Math.round(tankLitres) + ' litre tank carries only ' + Math.round(coverDays) + ' days. For a ' + dryLossMonths + ' month dry season, about ' + Math.round(requiredTank) + ' litres is needed.');
    if (overflow / Math.max(1, annualLitres) > 0.4) warnings.push(Math.round((overflow / annualLitres) * 100) + '% of the harvest overflows in a wet year. More storage is the only way to keep that water.');
    if (usage === 'potable') warnings.push('Water for drinking needs treatment, testing and a maintenance regime. Roof runoff is not potable by default, whatever the filter claims.');
    if (roof.id === 'green') warnings.push('A green roof holds a lot of water back, so both the yield and the water quality change. Expect the harvest coefficient to fall after dry spells.');
    if (nDownpipes < Math.ceil(areaM2 / 60)) warnings.push('At ' + Math.round(areaM2) + ' m² you would normally see at least ' + Math.ceil(areaM2 / 60) + ' downpipes. One pipe feeding the tank will back up in a downpour.');
    if (roof.coef < 0.7) warnings.push('A runoff coefficient of ' + roof.coef + ' means a lot of rain soaks in or evaporates. The roof still helps, it just yields less.');

    const report = [
      'RAINWATER HARVESTING',
      roof.label + ', ' + Math.round(areaM2) + ' m² collection area, ' + Math.round(rainMm) + ' mm annual rainfall',
      'Use: ' + (USE_CASES.find((entry) => entry.id === usage) || USE_CASES[0]).label,
      '',
      'Runoff coefficient: ' + roof.coef,
      'System efficiency: ' + Math.round(efficiency * 100) + '% (filtration and first flush)',
      'Annual harvest: ' + Math.round(annualLitres).toLocaleString() + ' litres',
      'Daily demand: ' + Math.round(dailyUse) + ' litres, annual ' + Math.round(annualDemand).toLocaleString() + ' litres',
      'Demand covered by rain: ' + Math.round(demandCovered * 100) + '%',
      '',
      'Dry season: ' + dry + ' months',
      'Carry-through storage needed: ' + Math.round(requiredTank) + ' litres',
      'Tank you have: ' + Math.round(tankLitres) + ' litres (' + Math.round(coverDays) + ' days of use)',
      'Overflow in a wet year: ' + Math.round(overflow).toLocaleString() + ' litres',
      '',
      'First flush diversion: ' + Math.round(firstFlushLitres) + ' litres after dry weather',
      'Downpipes: ' + nDownpipes + ', each carrying about ' + downpipeFlow.toFixed(2) + ' L/s in heavy rain',
      '',
      'Annual saving: ' + annualSaving.toFixed(0),
      'Installed cost: ' + capex.toFixed(0) + ', simple payback ' + (payback ? payback.toFixed(1) + ' years' : '—'),
    ].join('\n');

    return {
      roof, metric, areaM2, rainMm, dry, dailyUse, tankLitres, price, capex, efficiency, annualLitres, monthlyAverage,
      dryLossMonths, wetMonthly, carryLitres, requiredTank, coverDays, tankCovers, supplyRatio, annualDemand, demandCovered,
      deliveredLitres, annualSaving, payback, overflow, firstFlushLitres, downpipeFlow, monthly, demandRows, warnings, report,
      useCase: (USE_CASES.find((entry) => entry.id === usage) || USE_CASES[0]).label, nDownpipes,
    };
  }, [roofType, roofArea, rainfall, dryMonths, household, tank, usage, downpipes, waterPrice, installCost, unit, extra]);

  return (
    <ToolShell
      toolId="rainwater-harvest"
      icon={Droplets}
      title="Rainwater Harvesting Planner"
      desc="Roof area and rainfall into litres harvested a year, the tank size that carries a dry season, demand coverage, overflow in a wet year and the payback on the whole system."
      state={{ roofType, roofArea, rainfall, dryMonths, household, tank, usage, downpipes, waterPrice, installCost, unit, extra }}
      onRestore={(restored) => {
        const map = { roofArea: setRoofArea, rainfall: setRainfall, dryMonths: setDryMonths, household: setHousehold, tank: setTank, downpipes: setDownpipes, waterPrice: setWaterPrice, installCost: setInstallCost };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.roofType) setRoofType(restored.roofType);
        if (restored.usage) setUsage(restored.usage);
        if (restored.unit) setUnit(restored.unit);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="rainwater-harvest.txt"
    >
      <Seg value={roofType} onChange={setRoofType} options={ROOF_TYPES.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <Seg value={usage} onChange={setUsage} options={USE_CASES.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <Seg value={unit} onChange={setUnit} options={[{ value: 'metric', label: 'Litres / m²' }, { value: 'imperial', label: 'Gallons / ft²' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={result.metric ? 'Roof area, m²' : 'Roof area, ft²'}><input value={roofArea} onChange={(e) => setRoofArea(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={result.metric ? 'Annual rainfall, mm' : 'Annual rainfall, in'}><input value={rainfall} onChange={(e) => setRainfall(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Dry season, months"><input value={dryMonths} onChange={(e) => setDryMonths(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={result.metric ? 'Daily use, litres' : 'Daily use, gallons'}><input value={household} onChange={(e) => setHousehold(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={result.metric ? 'Tank volume, litres' : 'Tank volume, gallons'}><input value={tank} onChange={(e) => setTank(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Downpipes"><input value={downpipes} onChange={(e) => setDownpipes(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={result.metric ? 'Water price per m³' : 'Water price per 1000 gal'}><input value={waterPrice} onChange={(e) => setWaterPrice(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Installed cost"><input value={installCost} onChange={(e) => setInstallCost(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <ToggleRow label="First flush diverter" checked={extra.firstFlush} onChange={() => toggle('firstFlush')} />
        <ToggleRow label="Filtration" checked={extra.filter} onChange={() => toggle('filter')} />
        <ToggleRow label="Transfer pump" checked={extra.pump} onChange={() => toggle('pump')} />
        <ToggleRow label="Overflow to garden" checked={extra.overflow} onChange={() => toggle('overflow')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Harvest from ' + Math.round(result.areaM2) + ' m² of ' + result.roof.label.toLowerCase()}
          value={Math.round(result.annualLitres / 1000)}
          unit="m³ a year"
          sub={'That is ' + Math.round(result.annualLitres).toLocaleString() + ' litres against a demand of ' + Math.round(result.annualDemand).toLocaleString() + ' — covering ' + Math.round(result.demandCovered * 100) + '% of what you use for ' + result.useCase.toLowerCase() + '. About ' + Math.round(result.overflow / 1000) + ' m³ overflows in a wet year.'}
        />
        <Ring
          value={Math.round(result.demandCovered * 100)}
          max={100}
          label="Demand covered"
          sub={Math.round(result.annualLitres) + ' L harvest'}
          unit="%"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Harvest month by month</div>
          <Bars data={result.monthly} suffix=" m³" format={(v) => v.toFixed(2)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Rainfall is seasonal almost everywhere. A tank is sized for the dry gap, not for the annual total, and the wettest month decides how much you spill.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Tank sizing</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Wet month harvest</span><span>{(result.wetMonthly / 1000).toFixed(2)} m³</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Daily use</span><span>{Math.round(result.dailyUse)} L</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Carry through dry season</span><span>{(result.carryLitres / 1000).toFixed(2)} m³</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Storage needed</span><span className="text-cyan-j">{(result.requiredTank / 1000).toFixed(2)} m³</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Tank you have</span><span className={result.tankCovers ? 'text-cyan-j' : 'text-amber-400'}>{(result.tankLitres / 1000).toFixed(2)} m³</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Days of cover</span><span>{Math.round(result.coverDays)} days</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">First flush</span><span>{Math.round(result.firstFlushLitres)} L</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Annual saving</span><span>{result.annualSaving.toFixed(0)}</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Coefficient', value: result.roof.coef.toFixed(2) },
                { label: 'Efficiency', value: Math.round(result.efficiency * 100) + '%' },
                { label: 'Payback', value: result.payback ? result.payback.toFixed(1) + ' yr' : '—', tone: result.payback > 15 ? 'amber' : undefined },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Supply against demand</div>
          <Bars data={result.demandRows} suffix=" m³" format={(v) => v.toFixed(1)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The gap between harvest and demand is what a mains backup covers. Harvest above the tank and use is the water that leaves down the overflow.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Full plan</div>
          <pre className="max-h-64 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Annual harvest" value={(result.annualLitres / 1000).toFixed(1)} mono sub="m³ per year" />
        <Stat label="Demand covered" value={Math.round(result.demandCovered * 100) + '%'} mono sub={Math.round(result.annualDemand / 1000) + ' m³ demand'} />
        <Stat label="Storage needed" value={(result.requiredTank / 1000).toFixed(1)} mono sub="m³ for the dry season" />
        <Stat label="Payback" value={result.payback ? result.payback.toFixed(1) : '—'} mono sub="years on water saved" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Design cautions</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Making the collection work</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Divert the first flush. The first millimetre or two of rain carries most of the dust, pollen and bird droppings off the roof.</p>
            <p>· Screen the inlet and keep a leaf trap before the tank, then keep the tank dark and sealed. Light plus nutrients grows algae.</p>
            <p>· Calm the inlet so water enters without stirring sediment, and draw from about 150 mm above the base rather than from the very bottom.</p>
            <p>· Fit a first-rate overflow that discharges well away from the foundations and, ideally, into the garden rather than the drain.</p>
            <p>· Check the tank base and the weight. Ten thousand litres is ten tonnes, and that load has to be carried by something designed for it.</p>
            <p>· Mosquito-proof every opening. A mesh that stops debris is not automatically fine enough to stop insects breeding.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Roof runoff coefficients</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Roof type</th><th className="py-1 text-right">Coefficient</th><th className="py-1 pr-2 text-left">Note</th></tr>
              </thead>
              <tbody>
                {ROOF_TYPES.map((entry) => (
                  <tr key={entry.id} className={`border-t border-border/40 ${entry.id === result.roof.id ? 'text-cyan-j' : ''}`}>
                    <td className="py-1 pl-2">{entry.label}</td>
                    <td className="py-1 text-right">{entry.coef.toFixed(2)}</td>
                    <td className="py-1 pr-2">{entry.coef >= 0.85 ? 'High yield' : entry.coef >= 0.75 ? 'Good yield' : 'Retains water'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Smooth roofs shed water quickly and cleanly. Textured and planted roofs hold some back, and the first rain after a dry spell comes off dirtier.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Harvest is calculated from collection area, rainfall and runoff coefficient, with filtration and first-flush losses applied. Local rainfall varies enormously month to month, so the seasonal
          figures here are illustrative — use a nearby weather station's monthly record for a tank-sizing decision you intend to rely on.
        </p>
      </Panel>
    </ToolShell>
  );
}