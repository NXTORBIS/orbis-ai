import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const MODELS = [
  { id: 'saas', label: 'SaaS subscription', churn: 2, arpu: 99, margin: 78 },
  { id: 'marketplace', label: 'Marketplace', churn: 4.5, arpu: 45, margin: 22 },
  { id: 'services', label: 'Agency retainer', churn: 3, arpu: 2500, margin: 48 },
  { id: 'mobile', label: 'Mobile app', churn: 9, arpu: 8, margin: 65 },
];

export default function LtvCac() {
  const [model, setModel] = useState('saas');
  const [arpu, setArpu] = useState('');
  const [margin, setMargin] = useState('');
  const [churn, setChurn] = useState('');
  const [expansion, setExpansion] = useState('1');
  const [cac, setCac] = useState('420');
  const [salesCost, setSalesCost] = useState('120');
  const [discount, setDiscount] = useState('10');
  const [customers, setCustomers] = useState('120');
  const [months, setMonths] = useState('36');
  const [extra, setExtra] = useState({ expansionOn: true, paybackOn: true, cohorts: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const preset = MODELS.find((entry) => entry.id === model) || MODELS[0];
    const monthlyArpu = arpu === '' ? preset.arpu : Math.max(0, Number(arpu) || 0);
    const grossMargin = (margin === '' ? preset.margin : Math.max(0, Number(margin) || 0)) / 100;
    const monthlyChurn = (churn === '' ? preset.churn : Math.max(0.05, Number(churn) || 0)) / 100;
    const expansionRate = extra.expansionOn ? Math.max(0, Number(expansion) || 0) / 100 : 0;
    const acquisition = Math.max(1, Number(cac) || 0);
    const salesAdd = Math.max(0, Number(salesCost) || 0);
    const disc = Math.min(40, Math.max(0, Number(discount) || 0)) / 100;
    const startingCustomers = Math.max(1, Number(customers) || 1);
    const horizon = Math.min(120, Math.max(6, Number(months) || 36));

    const lifetimeMonths = 1 / monthlyChurn;
    const grossProfitPerMonth = monthlyArpu * grossMargin;
    // Geometric series with expansion: each month's gross profit grows and decays.
    let ltvGross = 0;
    for (let m = 0; m < 600; m += 1) {
      const survival = Math.pow(1 - monthlyChurn, m);
      const expanded = Math.pow(1 + expansionRate, m);
      ltvGross += grossProfitPerMonth * survival * expanded;
    }
    const ltvDiscounted = (() => {
      const monthlyRate = disc / 12;
      let total = 0;
      for (let m = 0; m < 600; m += 1) {
        const survival = Math.pow(1 - monthlyChurn, m);
        const expanded = Math.pow(1 + expansionRate, m);
        total += (grossProfitPerMonth * survival * expanded) / Math.pow(1 + monthlyRate, m + 1);
      }
      return total;
    })();

    const totalCac = acquisition + salesAdd + acquisition * 0.05;
    const ltvCac = ltvDiscounted / totalCac;
    const paybackMonths = grossProfitPerMonth > 0 ? totalCac / grossProfitPerMonth : 0;
    const paybackDiscounted = (() => {
      const monthlyRate = disc / 12;
      let cumulative = 0;
      for (let m = 1; m <= 120; m += 1) {
        cumulative += grossProfitPerMonth / Math.pow(1 + monthlyRate, m);
        if (cumulative >= totalCac) return m;
      }
      return Infinity;
    })();

    const magicNumber = totalCac > 0 ? (monthlyArpu * grossMargin * 12) / totalCac : 0;
    const netRevenueRetention = (1 + expansionRate) / (1 + monthlyChurn);
    const annualRetention = Math.pow(1 - monthlyChurn, 12) * 100;

    // Cohort table: customers and cumulative gross profit over the horizon.
    const cohort = [];
    let remaining = startingCustomers;
    let cumulativeProfit = 0;
    for (let m = 1; m <= Math.min(horizon, 48); m += 1) {
      remaining *= 1 - monthlyChurn;
      const monthProfit = remaining * grossProfitPerMonth * Math.pow(1 + expansionRate, m);
      cumulativeProfit += monthProfit;
      if (m % Math.max(1, Math.round(horizon / 12)) === 0 || m < 6) {
        cohort.push({ label: 'M' + m, value: Number(monthProfit.toFixed(0)), customers: remaining, cumulative: cumulativeProfit });
      }
    }

    const breakEvenMonth = cohort.find((row) => row.cumulative >= startingCustomers * totalCac);
    const paybackVerdict = paybackMonths <= 12 ? 'healthy' : paybackMonths <= 18 ? 'acceptable' : paybackMonths <= 24 ? 'slow' : 'problematic';

    const scenarioCac = [0.6, 0.8, 1, 1.3, 1.6].map((factor) => ({
      label: (factor * 100).toFixed(0) + '%',
      value: Number((ltvDiscounted / (totalCac * factor)).toFixed(2)),
      tone: ltvDiscounted / (totalCac * factor) < 3 ? 'rose' : undefined,
    }));

    const warnings = [];
    if (ltvCac < 1) warnings.push('LTV to CAC of ' + ltvCac.toFixed(2) + ':1 means you spend more to win a customer than they ever return in gross profit. Every sale deepens the loss.');
    else if (ltvCac < 3) warnings.push('LTV to CAC of ' + ltvCac.toFixed(2) + ':1 is below the usual 3:1 benchmark. Either the acquisition cost is too high or retention is too weak.');
    if (paybackMonths > 18) warnings.push('CAC payback of ' + paybackMonths.toFixed(1) + ' months ties up cash for a long time. Growth funded this way needs external capital or it stalls.');
    if (monthlyChurn > 0.05) warnings.push('Monthly churn of ' + (monthlyChurn * 100).toFixed(1) + '% means an average customer stays only ' + lifetimeMonths.toFixed(1) + ' months. Retention work usually beats acquisition spend at this level.');
    if (expansionRate > 0 && expansionRate >= monthlyChurn) warnings.push('Expansion revenue is covering churn, so net revenue retention rises. That is the healthiest possible sign — check it is real, not price rises on a shrinking base.');
    if (magicNumber < 0.75) warnings.push('The magic number is ' + magicNumber.toFixed(2) + '. Below 0.75, sales and marketing spend is not paying for itself within a year.');
    if (grossMargin < 0.3) warnings.push('A gross margin of ' + Math.round(grossMargin * 100) + '% leaves very little to cover acquisition and overhead. LTV is built on margin, not revenue.');
    if (disc > 0.15) warnings.push('Discounting at ' + (disc * 100).toFixed(0) + '% is a heavy assumption. Most businesses should evaluate LTV without a discount rate to stay comparable with how they are valued.');

    const report = [
      'UNIT ECONOMICS: LTV AND CAC',
      preset.label + ', ' + startingCustomers + ' customers, ' + horizon + ' month horizon',
      '',
      'ARPU per month: ' + monthlyArpu.toFixed(2),
      'Gross margin: ' + Math.round(grossMargin * 100) + '%',
      'Monthly churn: ' + (monthlyChurn * 100).toFixed(2) + '%  (lifetime ' + lifetimeMonths.toFixed(1) + ' months)',
      'Monthly expansion: ' + (expansionRate * 100).toFixed(2) + '%',
      '',
      'Gross profit per customer per month: ' + grossProfitPerMonth.toFixed(2),
      'LTV undiscounted: ' + ltvGross.toFixed(0),
      'LTV discounted at ' + (disc * 100).toFixed(0) + '%: ' + ltvDiscounted.toFixed(0),
      '',
      'CAC (marketing): ' + acquisition.toFixed(0),
      'Fully loaded CAC (with ' + salesAdd.toFixed(0) + ' sales cost): ' + totalCac.toFixed(0),
      'LTV to CAC: ' + ltvCac.toFixed(2) + ':1',
      'CAC payback: ' + paybackMonths.toFixed(1) + ' months (' + (paybackDiscounted === Infinity ? 'never discounted' : paybackDiscounted + ' months discounted') + ')',
      'Magic number: ' + magicNumber.toFixed(2),
      'Net revenue retention: ' + (netRevenueRetention * 100).toFixed(1) + '%',
      'Annual logo retention: ' + annualRetention.toFixed(1) + '%',
      '',
      'Cohort of ' + startingCustomers + ' customers, cumulative gross profit:',
      ...cohort.map((row) => '  ' + row.label + ': ' + row.customers.toFixed(0) + ' customers, ' + row.value.toFixed(0) + ' that month, ' + row.cumulative.toFixed(0) + ' cumulative'),
    ].join('\n');

    return {
      preset, monthlyArpu, grossMargin, monthlyChurn, expansionRate, acquisition, salesAdd, disc, startingCustomers,
      horizon, lifetimeMonths, grossProfitPerMonth, ltvGross, ltvDiscounted, totalCac, ltvCac, paybackMonths, paybackDiscounted,
      magicNumber, netRevenueRetention, annualRetention, cohort, breakEvenMonth, paybackVerdict, scenarioCac, warnings, report,
    };
  }, [model, arpu, margin, churn, expansion, cac, salesCost, discount, customers, months, extra]);

  return (
    <ToolShell
      toolId="ltv-cac"
      icon={Users}
      title="LTV, CAC & Payback Calculator"
      desc="Unit economics that hold up: LTV from margin and churn, discounted for time, against a fully loaded CAC — with payback in months, the magic number and retention."
      state={{ model, arpu, margin, churn, expansion, cac, salesCost, discount, customers, months, extra }}
      onRestore={(restored) => {
        const map = { arpu: setArpu, margin: setMargin, churn: setChurn, expansion: setExpansion, cac: setCac, salesCost: setSalesCost, discount: setDiscount, customers: setCustomers, months: setMonths };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.model) setModel(restored.model);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="unit-economics.txt"
    >
      <Seg value={model} onChange={setModel} options={MODELS.map((entry) => ({ value: entry.id, label: entry.label }))} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Monthly ARPU (' + result.preset.arpu + ' preset)'}><input value={arpu} onChange={(e) => setArpu(e.target.value)} inputMode="decimal" placeholder={String(result.preset.arpu)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Gross margin % (' + result.preset.margin + ' preset)'}><input value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" placeholder={String(result.preset.margin)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Monthly churn % (' + result.preset.churn + ' preset)'}><input value={churn} onChange={(e) => setChurn(e.target.value)} inputMode="decimal" placeholder={String(result.preset.churn)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Monthly expansion %"><input value={expansion} onChange={(e) => setExpansion(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Marketing CAC"><input value={cac} onChange={(e) => setCac(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Sales cost per customer"><input value={salesCost} onChange={(e) => setSalesCost(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Discount rate, % per year"><input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Customers in cohort"><input value={customers} onChange={(e) => setCustomers(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Horizon, months"><input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Count expansion revenue" checked={extra.expansionOn} onChange={() => toggle('expansionOn')} />
        <ToggleRow label="Use fully loaded CAC" checked={extra.paybackOn} onChange={() => toggle('paybackOn')} hint="Includes sales cost" />
        <ToggleRow label="Build the cohort table" checked={extra.cohorts} onChange={() => toggle('cohorts')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.preset.label + ' at ' + result.monthlyArpu.toFixed(0) + ' a month'}
          value={result.ltvCac.toFixed(2)}
          unit=":1 LTV/CAC"
          sub={'LTV is ' + result.ltvDiscounted.toFixed(0) + ' per customer discounted, against a fully loaded CAC of ' + result.totalCac.toFixed(0) + '. Payback takes ' + result.paybackMonths.toFixed(1) + ' months, which counts as ' + result.paybackVerdict + '. The average customer stays ' + result.lifetimeMonths.toFixed(1) + ' months.'}
        />
        <Ring
          value={Math.round(Math.min(120, (result.ltvCac / 5) * 100))}
          max={100}
          label="Unit economics"
          sub={result.ltvCac.toFixed(2) + ':1 against a 3:1 benchmark'}
          unit="%"
          tone={result.ltvCac < 3 ? 'rose' : undefined}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">LTV to CAC at different acquisition costs</div>
          <Bars data={result.scenarioCac} suffix=":1" format={(v) => v.toFixed(2)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Red bars fall below the 3:1 benchmark. The same product can be a great business or a bad one depending purely on what it costs to win a customer.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Unit economics summary</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Gross profit per month</span><span>{result.grossProfitPerMonth.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">LTV, undiscounted</span><span>{result.ltvGross.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">LTV, discounted</span><span className="text-cyan-j">{result.ltvDiscounted.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Marketing CAC</span><span>{result.acquisition.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Fully loaded CAC</span><span>{result.totalCac.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Payback</span><span className={result.paybackMonths <= 12 ? 'text-cyan-j' : 'text-amber-400'}>{result.paybackMonths.toFixed(1)} months</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Magic number</span><span>{result.magicNumber.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Net revenue retention</span><span>{result.netRevenueRetention.toFixed(3)}×</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Annual logo retention</span><span>{result.annualRetention.toFixed(1)}%</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Lifetime', value: result.lifetimeMonths.toFixed(1) + ' mo' },
                { label: 'Churn', value: (result.monthlyChurn * 100).toFixed(2) + '%/mo' },
                { label: 'Payback', value: result.paybackVerdict, tone: result.paybackMonths > 18 ? 'amber' : undefined },
              ]}
            />
          </div>
        </Panel>
      </div>

      {extra.cohorts && (
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Cohort payback on {result.startingCustomers} customers</span>
            <span className="font-mono-j text-[11px] text-muted-foreground">cumulative gross profit per month</span>
          </div>
          <Bars data={result.cohort.map((row) => ({ label: row.label, value: row.cumulative }))} suffix="" format={(v) => Math.round(v).toLocaleString()} />
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-border/60">
              <table className="w-full font-mono-j text-[10px]">
                <thead className="bg-card/80 text-muted-foreground">
                  <tr><th className="py-1 pl-2 text-left">Month</th><th className="py-1 text-right">Customers</th><th className="py-1 pr-2 text-right">Cumulative</th></tr>
                </thead>
                <tbody>
                  {result.cohort.slice(0, 8).map((row) => (
                    <tr key={row.label} className="border-t border-border/40">
                      <td className="py-1 pl-2">{row.label}</td>
                      <td className="py-1 text-right">{row.customers.toFixed(0)}</td>
                      <td className="py-1 pr-2 text-right">{row.cumulative.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· The cohort covers its acquisition cost at {result.breakEvenMonth ? result.breakEvenMonth.label : 'beyond the horizon shown'}, cumulative {result.breakEvenMonth ? result.breakEvenMonth.cumulative.toFixed(0) : '—'} against {Math.round(result.startingCustomers * result.totalCac).toLocaleString()} spent to acquire them.</p>
              <p>· Churn reduces the number of paying customers every month while the acquisition cost is already sunk. That is why payback speed matters more than LTV in a growing business.</p>
              <p>· Expansion revenue bends the curve back upward. A business with 100% net revenue retention grows on the existing base alone.</p>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Discounted LTV" value={result.ltvDiscounted.toFixed(0)} mono sub="per customer" />
        <Stat label="Fully loaded CAC" value={result.totalCac.toFixed(0)} mono sub="marketing plus sales" />
        <Stat label="LTV / CAC" value={result.ltvCac.toFixed(2) + ':1'} mono sub="benchmark is 3:1" />
        <Stat label="Payback" value={result.paybackMonths.toFixed(1)} mono sub="months" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What needs attention</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Full unit economics sheet</div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting unit economics right</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· LTV must be built on gross profit, not revenue. A business with 25% margins and a 3:1 revenue-based ratio may not cover its own overheads.</p>
            <p>· Fully loaded CAC includes sales salaries, tooling and onboarding. Marketing spend alone flatters the number badly when there are people involved in the sale.</p>
            <p>· Churn in the first ninety days is usually different from steady-state churn. Early cohorts often mislead, in both directions.</p>
            <p>· Discounting an LTV over thirty-six months at 10% is honest; discounting at 25% makes any business look weak. Stay consistent across comparisons.</p>
            <p>· Expansion revenue is what separates a good subscription business from a treadmill. Retention plus expansion is worth more than any growth hack.</p>
            <p>· The magic number tells you how much next year's revenue each pound of sales spend buys. Under 0.75 there is no case for spending more.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Benchmarks to judge against</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Metric</th><th className="py-1 text-right">Weak</th><th className="py-1 text-right">Good</th><th className="py-1 pr-2 text-right">Excellent</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">LTV / CAC</td><td className="py-1 text-right">&lt; 2</td><td className="py-1 text-right">3</td><td className="py-1 pr-2 text-right">&gt; 5</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">CAC payback</td><td className="py-1 text-right">&gt; 24 mo</td><td className="py-1 text-right">12 mo</td><td className="py-1 pr-2 text-right">&lt; 6 mo</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Magic number</td><td className="py-1 text-right">&lt; 0.75</td><td className="py-1 text-right">1.0</td><td className="py-1 pr-2 text-right">&gt; 1.5</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Net revenue retention</td><td className="py-1 text-right">&lt; 90%</td><td className="py-1 text-right">100%</td><td className="py-1 pr-2 text-right">&gt; 120%</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Monthly churn</td><td className="py-1 text-right">&gt; 5%</td><td className="py-1 text-right">2%</td><td className="py-1 pr-2 text-right">&lt; 1%</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Consumer businesses live at the weaker end and enterprise at the stronger, so judge yourself against your own segment rather than the headline figures.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          LTV is the discounted sum of gross profit per customer over a geometric survival curve, with expansion applied month by month. It assumes constant churn and expansion rates, which real cohorts
          never quite deliver — use your own cohort data where you have it, and compare assumptions rather than trusting a single figure.
        </p>
      </Panel>
    </ToolShell>
  );
}