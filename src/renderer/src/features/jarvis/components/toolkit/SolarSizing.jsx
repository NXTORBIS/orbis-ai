import { useMemo, useState } from 'react';
import { Sunrise, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const CHEMISTRY = [
  { id: 'lifepo4', label: 'LiFePO4', dod: 0.85, voltage: 12.8, cost: 420, life: 4000 },
  { id: 'agm', label: 'AGM / Gel', dod: 0.5, voltage: 12.0, cost: 220, life: 700 },
  { id: 'flooded', label: 'Flooded lead', dod: 0.45, voltage: 12.0, cost: 170, life: 500 },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON = [0.78, 0.86, 1, 1.1, 1.18, 1.2, 1.18, 1.12, 1, 0.88, 0.76, 0.7];

const START_LOADS = [
  { name: 'Fridge (compressor duty)', watts: 150, hours: 8, qty: 1 },
  { name: 'LED lighting', watts: 10, hours: 5, qty: 6 },
  { name: 'Laptop', watts: 60, hours: 4, qty: 1 },
  { name: 'Router / modem', watts: 12, hours: 24, qty: 1 },
  { name: 'Television', watts: 80, hours: 3, qty: 1 },
];

export default function SolarSizing() {
  const [loads, setLoads] = useState(START_LOADS);
  const [chemistry, setChemistry] = useState('lifepo4');
  const [psh, setPsh] = useState('4.2');
  const [systemVolts, setSystemVolts] = useState('24');
  const [autonomy, setAutonomy] = useState('2');
  const [derate, setDerate] = useState('0.75');
  const [inverterEff, setInverterEff] = useState('0.9');
  const [panelWatts, setPanelWatts] = useState('450');
  const [peakWatts, setPeakWatts] = useState('2500');
  const [gridPrice, setGridPrice] = useState('0.28');
  const [extra, setExtra] = useState({ wind: false, backup: true, monitor: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));
  const setLoad = (index, key, value) => setLoads((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const addLoad = () => setLoads((current) => [...current, { name: 'New appliance', watts: 100, hours: 2, qty: 1 }]);

  const result = useMemo(() => {
    const chem = CHEMISTRY.find((entry) => entry.id === chemistry) || CHEMISTRY[0];
    const sunHours = Math.max(0.5, Number(psh) || 4);
    const volts = Math.max(12, Number(systemVolts) || 24);
    const days = Math.max(0.5, Number(autonomy) || 2);
    const lossFactor = Math.min(0.95, Math.max(0.4, Number(derate) || 0.75));
    const invEff = Math.min(0.99, Math.max(0.6, Number(inverterEff) || 0.9));
    const panelRated = Math.max(50, Number(panelWatts) || 450);
    const peak = Math.max(100, Number(peakWatts) || 2500);
    const price = Math.max(0, Number(gridPrice) || 0.28);

    const rows = loads.map((row) => {
      const watts = Math.max(0, Number(row.watts) || 0);
      const hours = Math.max(0, Number(row.hours) || 0);
      const qty = Math.max(0, Number(row.qty) || 0);
      return { ...row, watts, hours, qty, daily: (watts * hours * qty) / 1000 };
    });
    const dailyKwh = rows.reduce((sum, row) => sum + row.daily, 0);
    const dailyWh = dailyKwh * 1000;

    // Array must cover the daily energy AND push it back through inverter and battery losses.
    const arrayW = dailyWh / (sunHours * lossFactor * invEff);
    const panels = Math.max(1, Math.ceil(arrayW / panelRated));
    const installedW = panels * panelRated;

    // Battery bank stores what the load draws, adjusted for depth of discharge and round trip losses.
    const usableWh = dailyWh * days / invEff;
    const bankWh = usableWh / chem.dod;
    const bankAh = bankWh / volts;
    const units = Math.max(1, Math.ceil(bankAh / 100));
    const bankCost = units * chem.cost;
    const dailyDod = dailyWh > 0 ? (dailyWh / invEff) / bankWh : 0;

    const inverterVa = peak / 0.9;
    const surgeVa = inverterVa * 2;
    const inverterSize = Math.max(1, Math.ceil(inverterVa / 500) * 500);
    const controllerA = (installedW / volts) * 1.25;
    const controllerSize = Math.max(10, Math.ceil(controllerA / 10) * 10);
    const chargeHours = dailyWh > 0 && installedW > 0 ? (bankWh * chem.dod) / (installedW * lossFactor) : 0;

    const monthly = MONTHS.map((month, index) => ({
      label: month,
      value: Number(((installedW * sunHours * SEASON[index] * 30 * lossFactor) / 1000).toFixed(1)),
    }));
    const annualKwh = monthly.reduce((sum, month) => sum + month.value, 0);
    const worstMonth = Math.min(...monthly.map((month) => month.value));
    const winterCover = dailyKwh > 0 ? (worstMonth / 30) / dailyKwh : 0;

    const panelCost = panels * (panelRated >= 400 ? 190 : 150);
    const labour = Math.round((panelCost + bankCost) * 0.25);
    const extras = (extra.wind ? 900 : 0) + (extra.backup ? 700 : 0) + (extra.monitor ? 260 : 0);
    const capital = panelCost + bankCost + inverterSize * 0.55 + controllerSize * 1.8 + labour + extras;
    const annualSaving = annualKwh * price;
    const payback = annualSaving > 0 ? capital / annualSaving : 0;
    const co2 = annualKwh * 0.42;

    const warnings = [];
    if (dailyKwh > 0 && winterCover < 1) warnings.push('The shortest month generates ' + Math.round(winterCover * 100) + '% of what you use daily. Either add panels, cut winter load or plan for generator top-ups.');
    if (dailyDod > 0.45) warnings.push('Daily depth of discharge is ' + Math.round(dailyDod * 100) + '%. Above about 45% a lead bank ages fast — lithium tolerates this far better.');
    if (chem.id !== 'lifepo4' && days < 3) warnings.push('Flooded or AGM banks want three days of autonomy to avoid cycling deeply. Lithium is happy with fewer.');
    if (controllerA > 80) warnings.push('Charge current is ' + controllerA.toFixed(0) + ' A. Use an MPPT controller, keep cable runs short and check the ampacity against the voltage drop.');
    if (peak > inverterSize * 0.85) warnings.push('The inverter is sized close to the peak load, so motor start-up surges will need the two-times surge rating.');

    const report = [
      'OFF-GRID SOLAR SIZING',
      'Daily consumption: ' + dailyKwh.toFixed(2) + ' kWh (' + Math.round(dailyWh) + ' Wh)',
      'Peak load: ' + peak + ' W',
      '',
      'Array: ' + installedW + ' W (' + panels + ' x ' + panelRated + ' W) using ' + sunHours + ' peak sun hours',
      'Battery: ' + Math.round(bankWh) + ' Wh / ' + Math.round(bankAh) + ' Ah at ' + volts + ' V, ' + chem.label + ', ' + days + ' day autonomy',
      'Inverter: ' + inverterSize + ' VA continuous, ' + surgeVa.toFixed(0) + ' VA surge',
      'Charge controller: ' + controllerSize + ' A MPPT at ' + volts + ' V',
      '',
      'Annual generation: ' + Math.round(annualKwh) + ' kWh, worst month ' + worstMonth + ' kWh',
      'Capital estimate: ' + capital.toFixed(0) + ', payback about ' + (payback ? payback.toFixed(1) : '—') + ' years at ' + price + ' per kWh',
      '',
      'Loads',
      ...rows.map((row) => '  ' + row.name + ': ' + row.qty + ' x ' + row.watts + ' W x ' + row.hours + ' h = ' + row.daily.toFixed(2) + ' kWh'),
    ].join('\n');

    return {
      rows, dailyKwh, dailyWh, arrayW, panels, installedW, usableWh, bankWh, bankAh, units, bankCost, dailyDod,
      inverterVa, surgeVa, inverterSize, controllerA, controllerSize, chargeHours, monthly, annualKwh, worstMonth,
      winterCover, panelCost, labour, extras, capital, annualSaving, payback, co2, chem, sunHours, volts, days, panelRated, peak, price,
      warnings, report, loadChart: rows.map((row) => ({ label: row.name.split(' ')[0].slice(0, 7), value: Number(row.daily.toFixed(2)) })),
    };
  }, [loads, chemistry, psh, systemVolts, autonomy, derate, inverterEff, panelWatts, peakWatts, gridPrice, extra]);

  const download = () => {
    const blob = new Blob([result.report], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'off-grid-solar-sizing.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <ToolShell
      toolId="solar-sizing"
      icon={Sunrise}
      title="Off-Grid Solar & Battery Sizing"
      desc="Build the load list, then size the array, battery bank, inverter and charge controller from real sun hours and losses — with the winter month that decides how much panel you actually need."
      state={{ loads, chemistry, psh, systemVolts, autonomy, derate, inverterEff, panelWatts, peakWatts, gridPrice, extra }}
      onRestore={(restored) => {
        if (Array.isArray(restored.loads)) setLoads(restored.loads);
        if (restored.chemistry) setChemistry(restored.chemistry);
        if (restored.psh !== undefined) setPsh(String(restored.psh));
        if (restored.systemVolts !== undefined) setSystemVolts(String(restored.systemVolts));
        if (restored.autonomy !== undefined) setAutonomy(String(restored.autonomy));
        if (restored.derate !== undefined) setDerate(String(restored.derate));
        if (restored.inverterEff !== undefined) setInverterEff(String(restored.inverterEff));
        if (restored.panelWatts !== undefined) setPanelWatts(String(restored.panelWatts));
        if (restored.peakWatts !== undefined) setPeakWatts(String(restored.peakWatts));
        if (restored.gridPrice !== undefined) setGridPrice(String(restored.gridPrice));
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="off-grid-solar-sizing.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Daily loads</span>
            <button type="button" onClick={addLoad} className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j transition hover:bg-cyan-j/20">
              <Plus className="h-3 w-3" /> Add appliance
            </button>
          </div>
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.5fr_0.8fr_auto] gap-1.5 font-mono-j text-[9px] uppercase text-muted-foreground">
              <span>Appliance</span><span>Watts</span><span>Hours</span><span>Qty</span><span>kWh/day</span><span />
            </div>
            {result.rows.map((row, index) => (
              <div key={row.name + index} className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.5fr_0.8fr_auto] items-center gap-1.5">
                <input value={row.name} onChange={(e) => setLoad(index, 'name', e.target.value)} className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[11px]" />
                <input value={row.watts} onChange={(e) => setLoad(index, 'watts', e.target.value)} inputMode="numeric" className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]" />
                <input value={row.hours} onChange={(e) => setLoad(index, 'hours', e.target.value)} inputMode="decimal" className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]" />
                <input value={row.qty} onChange={(e) => setLoad(index, 'qty', e.target.value)} inputMode="numeric" className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]" />
                <span className="font-mono-j text-[11px] text-cyan-j">{row.daily.toFixed(2)}</span>
                <button type="button" onClick={() => setLoads((current) => current.filter((_, i) => i !== index))} className="rounded-md border border-border/60 p-1.5 text-muted-foreground transition hover:border-rose-500/50 hover:text-rose-400">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where you are and what you have</div>
          <div className="space-y-2">
            <Seg value={chemistry} onChange={setChemistry} options={CHEMISTRY.map((entry) => ({ value: entry.id, label: entry.label }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Peak sun hours"><input value={psh} onChange={(e) => setPsh(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              <Field label="System voltage"><input value={systemVolts} onChange={(e) => setSystemVolts(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              <Field label="Autonomy, days"><input value={autonomy} onChange={(e) => setAutonomy(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              <Field label="System derate"><input value={derate} onChange={(e) => setDerate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              <Field label="Inverter eff."><input value={inverterEff} onChange={(e) => setInverterEff(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              <Field label="Panel watts"><input value={panelWatts} onChange={(e) => setPanelWatts(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              <Field label="Peak load, W"><input value={peakWatts} onChange={(e) => setPeakWatts(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              <Field label="Grid price / kWh"><input value={gridPrice} onChange={(e) => setGridPrice(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            </div>
            <ToggleRow label="Generator backup input" checked={extra.backup} onChange={() => toggle('backup')} />
            <ToggleRow label="Wind top-up" checked={extra.wind} onChange={() => toggle('wind')} />
            <ToggleRow label="Monitoring and shunt" checked={extra.monitor} onChange={() => toggle('monitor')} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Array for ' + result.dailyKwh.toFixed(1) + ' kWh a day'}
          value={(result.installedW / 1000).toFixed(2)}
          unit="kW"
          sub={result.panels + ' × ' + result.panelRated + ' W panels, sized on ' + result.sunHours + ' peak sun hours with a ' + Math.round(result.chem.dod * 100) + '% usable bank and ' + result.days + ' day autonomy. It generates about ' + Math.round(result.annualKwh) + ' kWh a year, covering ' + Math.round(result.winterCover * 100) + '% of daily use in the worst month.'}
        />
        <Ring
          value={Math.round(result.winterCover * 100)}
          max={100}
          label="Winter cover"
          sub={result.worstMonth.toFixed(0) + ' kWh in the weakest month'}
          unit="%"
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Generation through the year</span>
          <span className="font-mono-j text-[11px] text-muted-foreground">{Math.round(result.annualKwh)} kWh/yr</span>
        </div>
        <Bars data={result.monthly} suffix=" kWh" format={(v) => v.toFixed(0)} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Panels are sized on the weakest month, not the average. Sizing on an annual average is the single most common reason an off-grid system browns out every December.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The shopping list</span>
            <CopyBtn value={result.report} label="Copy plan" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Panels</span><span>{result.panels} × {result.panelRated} W = {result.installedW} W</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Battery bank</span><span>{Math.round(result.bankAh)} Ah at {result.volts} V ({Math.round(result.bankWh / 1000 * 10) / 10} kWh)</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Battery units</span><span>{result.units} × 100 Ah {result.chem.label}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Inverter</span><span>{result.inverterSize} VA ({result.surgeVa.toFixed(0)} VA surge)</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Charge controller</span><span>{result.controllerSize} A MPPT</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Charging</span><span>{result.chargeHours.toFixed(1)} h at full sun</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Daily use', value: result.dailyKwh.toFixed(2) + ' kWh' },
                { label: 'Peak', value: result.peak + ' W' },
                { label: 'Daily DoD', value: Math.round(result.dailyDod * 100) + '%', tone: result.dailyDod > 0.45 ? 'amber' : undefined },
              ]}
            />
          </div>
        </Panel>

        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Cost and payback</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Panels</span><span>{result.panelCost.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Batteries</span><span>{result.bankCost.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Inverter and controller</span><span>{(result.inverterSize * 0.55 + result.controllerSize * 1.8).toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Install and extras</span><span>{(result.labour + result.extras).toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Capital total</span><span className="text-cyan-j">{result.capital.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Annual saving</span><span>{result.annualSaving.toFixed(0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Simple payback</span><span>{result.payback ? result.payback.toFixed(1) + ' years' : '—'}</span></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The bank outlives its payback only if you stay inside the daily depth of discharge above. Avoided emissions work out at roughly {Math.round(result.co2)} kg of CO₂ a year at the usual grid intensity.
          </p>
        </Panel>
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Before you buy anything</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Daily energy by appliance</div>
        <Bars data={result.loadChart} suffix=" kWh" format={(v) => v.toFixed(2)} highlightLast={false} />
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Daily energy" value={result.dailyKwh.toFixed(2)} mono sub="kWh per day" />
        <Stat label="Battery bank" value={(result.bankWh / 1000).toFixed(1)} mono sub={Math.round(result.bankAh) + ' Ah at ' + result.volts + ' V'} />
        <Stat label="Array" value={(result.installedW / 1000).toFixed(2)} mono sub={result.panels + ' panels'} />
        <Stat label="Inverter" value={String(result.inverterSize)} mono sub="VA continuous" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Full sizing report</span>
            <div className="flex gap-2">
              <CopyBtn value={result.report} label="Copy" />
              <button type="button" onClick={download} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
                Download
              </button>
            </div>
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting it right on site</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Peak sun hours are not daylight hours. A place with fourteen hours of summer daylight and cloud still only harvests four or five hours' worth of full sun.</p>
            <p>· Keep the battery bank close to the inverter and the controller close to both. Short, fat DC cables matter far more than they look on a diagram.</p>
            <p>· Panels in series raise voltage and lower current, which lets thinner cable reach further. Keep string voltage inside the controller's maximum.</p>
            <p>· Fuses belong on every string and on the battery positive. A DC arc does not self-extinguish the way an AC arc does.</p>
            <p>· Derate assumptions should include dust, heat and ageing. Hot panels make noticeably less power than the nameplate suggests.</p>
            <p>· Lithium banks need a low-temperature charge cut-off. Charging below freezing is what actually kills them.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Figures are an engineering estimate built from the load list, the peak sun hours you type in and standard loss assumptions. Sizing is always worth checking against a local installer who
          knows your shading, your seasonal weather and the regulations that apply where the system is being built.
        </p>
      </Panel>
    </ToolShell>
  );
}