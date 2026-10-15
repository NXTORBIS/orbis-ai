import { useMemo, useState } from 'react';
import { Sunrise } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const money = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function SolarPayback() {
  const [inputs, setInputs] = useState({
    size: '6',
    cost: '9000',
    yieldPerKwp: '1050',
    selfUse: '45',
    importTariff: '0.28',
    exportTariff: '0.08',
    degradation: '0.5',
    maintenance: '90',
    years: '25',
    battery: '4000',
    batteryBoost: '25',
  });

  const set = (key, value) => setInputs((current) => ({ ...current, [key]: value }));
  const n = (key) => Number(inputs[key]) || 0;

  const result = useMemo(() => {
    const years = Math.max(1, Math.min(40, n('years')));
    const degradation = n('degradation') / 100;
    const selfUse = Math.min(100, Math.max(0, n('selfUse') + n('batteryBoost'))) / 100;
    const investment = n('cost') + (n('battery') > 0 ? n('battery') : 0);
    const nominal = n('size') * n('yieldPerKwp');

    let cumulative = -investment;
    let paybackYear = null;
    const rows = [];
    for (let year = 1; year <= years; year += 1) {
      const generation = nominal * Math.pow(1 - degradation, year - 1);
      const selfUsed = generation * selfUse;
      const exported = generation - selfUsed;
      const billSaving = selfUsed * n('importTariff');
      const exportIncome = exported * n('exportTariff');
      const benefit = billSaving + exportIncome - n('maintenance');
      cumulative += benefit;
      if (paybackYear === null && cumulative >= 0 && year > 1) paybackYear = year - 1 + (cumulative - benefit ? (benefit - cumulative) / benefit : 0);
      rows.push({ year, generation, benefit, cumulative, billSaving, exportIncome });
    }

    const firstYear = rows[0];
    const lifetimeBenefit = rows.reduce((sum, row) => sum + row.benefit, 0);
    const lifetimeGeneration = rows.reduce((sum, row) => sum + row.generation, 0);
    const co2 = lifetimeGeneration * 0.4;
    const roi = investment ? ((lifetimeBenefit - investment) / investment) * 100 : 0;
    const withoutBattery = n('cost');
    const simplePayback = firstYear && firstYear.benefit > 0 ? withoutBattery / firstYear.benefit : null;

    return {
      rows, years, investment, firstYear, lifetimeBenefit, lifetimeGeneration, co2, roi,
      paybackYear: paybackYear !== null ? paybackYear : null,
      simplePayback, selfUse: selfUse * 100, nominal,
      perYear: firstYear ? firstYear.benefit : 0,
    };
  }, [inputs]);

  const milestones = useMemo(() => [5, 10, 15, 20, 25].filter((year) => year <= result.years).map((year) => {
    const row = result.rows[year - 1];
    return { label: year + 'y', value: Math.round(row ? row.cumulative : 0) };
  }), [result]);

  const report = useMemo(() => [
    n('size') + ' kWp system, ' + money(result.investment) + ' installed',
    'First-year benefit: ' + money(result.perYear),
    'Simple payback: ' + (result.simplePayback ? result.simplePayback.toFixed(1) + ' years' : '—'),
    'With degradation and maintenance: ' + (result.paybackYear ? result.paybackYear.toFixed(1) + ' years' : 'beyond the horizon'),
    'Over ' + result.years + ' years: ' + money(result.lifetimeBenefit) + ' benefit, ' + money(result.lifetimeBenefit - result.investment) + ' net',
    result.lifetimeGeneration.toFixed(0) + ' kWh generated, ' + money(result.co2) + ' kg CO₂ avoided',
    '',
    ...result.rows.map((row) => 'Year ' + row.year + ': ' + row.generation.toFixed(0) + ' kWh, ' + money(row.benefit) + ' benefit, cumulative ' + money(row.cumulative)),
  ].join('\n'), [result, inputs]);

  return (
    <ToolShell
      toolId="solar-payback"
      icon={Sunrise}
      title="Solar Payback Planner"
      desc="Size a rooftop system and see the year the panels pay for themselves — with degradation, maintenance, a battery if you want one, and the lifetime savings."
      state={inputs}
      onRestore={(restored) => setInputs((current) => ({ ...current, ...restored }))}
      exportText={report}
      exportName="solar-payback.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="System size, kWp"><input value={inputs.size} onChange={(e) => set('size', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Installed cost (before subsidy)"><input value={inputs.cost} onChange={(e) => set('cost', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Generation, kWh per kWp a year"><input value={inputs.yieldPerKwp} onChange={(e) => set('yieldPerKwp', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Electricity you buy at, per kWh"><input value={inputs.importTariff} onChange={(e) => set('importTariff', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Share you use yourself, %"><input value={inputs.selfUse} onChange={(e) => set('selfUse', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Export tariff, per kWh"><input value={inputs.exportTariff} onChange={(e) => set('exportTariff', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Panel degradation, % a year"><input value={inputs.degradation} onChange={(e) => set('degradation', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Maintenance and insurance a year"><input value={inputs.maintenance} onChange={(e) => set('maintenance', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Battery cost, leave 0 for none"><input value={inputs.battery} onChange={(e) => set('battery', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Battery lifts self-use by, %"><input value={inputs.batteryBoost} onChange={(e) => set('batteryBoost', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Years to plan over"><input value={inputs.years} onChange={(e) => set('years', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.paybackYear && result.paybackYear <= result.years ? 'emerald' : 'amber'}
          label={result.paybackYear ? 'Paid back in about ' + result.paybackYear.toFixed(1) + ' years' : 'Not repaid within ' + result.years + ' years'}
          value={money(result.lifetimeBenefit - result.investment)}
          sub={'Net gain over ' + result.years + ' years after ' + money(result.investment) + ' spent, from ' + money(result.lifetimeGeneration) + ' kWh generated.'}
        />
        <Ring
          value={Math.min(100, result.selfUse)}
          max={100}
          label="Electricity used at home"
          sub={result.selfUse.toFixed(0) + '% of generation is used on site' + (n('battery') > 0 ? ', including the battery lift' : '; the rest is exported at the lower rate')}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Cumulative position at each milestone</div>
          <Bars
            data={milestones}
            format={(value) => money(value)}
            suffix=""
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Negative bars are the years still paying back the installation; positive bars are money in hand. The crossing point is the payback year.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">First full year, line by line</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Generation</span><span>{result.firstYear ? result.firstYear.generation.toFixed(0) : 0} kWh</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Bill avoided</span><span>{money(result.firstYear ? result.firstYear.billSaving : 0)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Export income</span><span>{money(result.firstYear ? result.firstYear.exportIncome : 0)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Maintenance</span><span>−{money(n('maintenance'))}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5">
              <span>Net benefit</span><span className="text-cyan-j">{money(result.perYear)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Simple payback</span><span>{result.simplePayback ? result.simplePayback.toFixed(1) + ' yrs' : '—'}</span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Year by year</span>
          <CopyBtn value={report} label="Copy the projection" />
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card">
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Year</th>
                <th className="py-1 text-right font-medium">kWh</th>
                <th className="py-1 text-right font-medium">Benefit</th>
                <th className="py-1 text-right font-medium">Cumulative</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {result.rows.map((row) => (
                <tr key={row.year} className={row.cumulative >= 0 && result.rows[row.year - 2] && result.rows[row.year - 2].cumulative < 0 ? 'border-t border-cyan-j/40 bg-cyan-j/5' : 'border-t border-border/50'}>
                  <td className="py-1">{row.year}</td>
                  <td className="py-1 text-right text-muted-foreground">{row.generation.toFixed(0)}</td>
                  <td className="py-1 text-right">{money(row.benefit)}</td>
                  <td className={row.cumulative >= 0 ? 'py-1 text-right text-emerald-400' : 'py-1 text-right text-rose-300'}>{money(row.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What actually moves the payback</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Self-use is worth more than export. Every kilowatt-hour you consume on site is worth the full import tariff; the exported one earns the export rate, often a fraction of it.</p>
            <p>· A battery buys self-use, not generation. It pays when the gap between import and export tariffs is wide, and rarely otherwise.</p>
            <p>· Panel degradation is slow — around {(n('degradation')).toFixed(2)}% a year here — so the first decade looks very like the first year.</p>
            <p>· Panel prices have fallen faster than tariffs have risen, which is why payback on new systems is shorter than it was a decade ago despite lower export rates.</p>
            <p>· Changing your usage to daytime, even by running the washing machine at noon, improves the return without spending anything.</p>
            <p>· {result.paybackYear ? 'At these figures the system crosses over in year ' + result.paybackYear.toFixed(1) + '.' : 'At these figures it never crosses over within the horizon — try a longer horizon or a lower installed cost.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Before you sign anything</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Use a real generation figure for your roof. Shading, orientation and pitch can move the number by a third in either direction.</p>
            <p>· Check the subsidy or tax treatment you are actually eligible for, since it changes the installed cost directly.</p>
            <p>· Confirm the export tariff and how long it is guaranteed — the return depends on it, and it is the figure most often quoted loosely.</p>
            <p>· Ask about inverter replacement: it typically needs changing once inside 25 years, which is a real cost in the middle of the projection.</p>
            <p>· {result.lifetimeGeneration > 0 ? 'This system would generate about ' + money(result.lifetimeGeneration) + ' kWh over the horizon, avoiding roughly ' + money(result.co2) + ' kg of CO₂ at current grid intensity.' : ''}</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="First-year benefit" value={money(result.perYear)} mono />
        <Stat label="Simple payback" value={result.simplePayback ? result.simplePayback.toFixed(1) + ' yrs' : '—'} mono sub="ignoring degradation" />
        <Stat label="With wear" value={result.paybackYear ? result.paybackYear.toFixed(1) + ' yrs' : 'beyond'} mono sub="degradation and upkeep" />
        <Stat label="Return on cost" value={result.roi.toFixed(0) + '%'} mono sub={result.years + '-year horizon'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Reading the projection honestly</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Tariffs will change over a horizon this long, in both directions. The projection holds them flat, which is the only defensible assumption without a forecast.</p>
          <p>· Generation is modelled as a fixed figure per kWp with annual degradation — good enough to judge a decision, not a substitute for a site survey.</p>
          <p>· Maintenance is treated as constant, though in practice it is occasional cleaning and one inverter swap.</p>
          <p>· The CO₂ figure uses a standard grid intensity of 0.4 kg per kWh, which falls as the grid decarbonises — so the real saving is a little smaller each year.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'System', value: n('size') + ' kWp' },
              { label: 'Generation', value: money(result.nominal) + ' kWh' },
              { label: 'Self-use', value: result.selfUse.toFixed(0) + '%' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Every year is calculated separately, so degradation and the fixed maintenance cost both bite, and the payback year is found where the cumulative position
          first crosses zero rather than by dividing the cost by the first year's benefit. That distinction is why the two payback figures here differ.
        </p>
      </Panel>
    </ToolShell>
  );
}