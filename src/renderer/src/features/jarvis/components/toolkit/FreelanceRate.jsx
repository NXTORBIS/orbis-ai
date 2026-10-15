import { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const money = (value) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function FreelanceRate() {
  const [income, setIncome] = useState('90000');
  const [expenses, setExpenses] = useState('12000');
  const [taxRate, setTaxRate] = useState('25');
  const [billableHours, setBillableHours] = useState('25');
  const [weeks, setWeeks] = useState('46');
  const [nonBillable, setNonBillable] = useState('35');
  const [currentRate, setCurrentRate] = useState('75');

  const result = useMemo(() => {
    const target = Number(income) || 0;
    const costs = Number(expenses) || 0;
    const tax = Number(taxRate) || 0;
    const hours = Number(billableHours) || 1;
    const workingWeeks = Number(weeks) || 1;
    const overhead = (Number(nonBillable) || 0) / 100;

    // Income must be grossed up so that what remains after tax covers salary + expenses.
    const gross = (target + costs) / (1 - tax / 100);
    const taxPaid = gross - target - costs;
    const billablePerYear = hours * workingWeeks;
    const totalHours = billablePerYear / Math.max(0.05, 1 - overhead);
    const hourly = gross / Math.max(1, billablePerYear);
    const dayRate = hourly * 8;
    const weekRate = hourly * hours;
    const monthRetainer = hourly * hours * (52 / 12);
    const breakEven = costs / (1 - tax / 100) / Math.max(1, billablePerYear);
    const current = Number(currentRate) || 0;
    const gap = current ? ((hourly - current) / current) * 100 : 0;
    const annualAtCurrent = (current || 0) * billablePerYear * (1 - tax / 100) - costs;

    const breakdown = [
      { label: 'Your income', value: target },
      { label: 'Running costs', value: costs },
      { label: 'Tax', value: Math.max(0, taxPaid) },
    ];

    return {
      gross, taxPaid, hourly, dayRate, weekRate, monthRetainer, breakEven, billablePerYear, totalHours,
      breakdown, gap, annualAtCurrent, hoursPerWeek: hours, overhead,
    };
  }, [income, expenses, taxRate, billableHours, weeks, nonBillable, currentRate]);

  const report = [
    `Target income ${money(Number(income) || 0)} · expenses ${money(Number(expenses) || 0)} · tax ${taxRate}%`,
    `Gross you must invoice: ${money(result.gross)}`,
    `Hourly rate: ${money(result.hourly)} · day rate (8h): ${money(result.dayRate)} · weekly: ${money(result.weekRate)}`,
    `Monthly retainer at ${billableHours} hours a week: ${money(result.monthRetainer)}`,
    `Break-even rate (costs only): ${money(result.breakEven)}`,
    `At your current ${money(Number(currentRate) || 0)} an hour you would net ${money(result.annualAtCurrent)} a year`,
  ].join('\n');

  return (
    <ToolShell
      toolId="freelance-rate"
      icon={Wallet}
      title="Freelance Rate Calculator"
      desc="Start from the income you want to take home and work forwards to the rate you must charge — including the hours you cannot bill for."
      state={{ income, expenses, taxRate, billableHours, weeks, nonBillable, currentRate }}
      onRestore={(restored) => {
        if (restored.income !== undefined) setIncome(String(restored.income));
        if (restored.expenses !== undefined) setExpenses(String(restored.expenses));
        if (restored.taxRate !== undefined) setTaxRate(String(restored.taxRate));
        if (restored.billableHours !== undefined) setBillableHours(String(restored.billableHours));
        if (restored.weeks !== undefined) setWeeks(String(restored.weeks));
        if (restored.nonBillable !== undefined) setNonBillable(String(restored.nonBillable));
        if (restored.currentRate !== undefined) setCurrentRate(String(restored.currentRate));
      }}
      exportText={report}
      exportName="freelance-rate.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={report} label="Copy rate card" />
        <span className="text-[11px] text-muted-foreground">{result.billablePerYear} billable hours a year across {result.totalHours.toFixed(0)} hours of actual work</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Income you want to keep, per year">
          <input value={income} onChange={(e) => setIncome(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Business costs per year" hint="Software, hardware, insurance, accountant, marketing">
          <input value={expenses} onChange={(e) => setExpenses(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={`Tax and contributions · ${taxRate}%`}>
          <input type="range" min={0} max={55} step={1} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Billable hours a week · ${billableHours}`}>
          <input type="range" min={5} max={45} step={1} value={billableHours} onChange={(e) => setBillableHours(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Weeks worked a year · ${weeks}`}>
          <input type="range" min={30} max={52} step={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Non-billable share of your time · ${nonBillable}%`} hint="Admin, sales, learning, emails">
          <input type="range" min={0} max={70} step={5} value={nonBillable} onChange={(e) => setNonBillable(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Your hourly rate"
          value={money(result.hourly)}
          unit="/ hour"
          sub={`${money(result.dayRate)} a day · ${money(result.weekRate)} a week at ${billableHours} billed hours`}
        />
        <Ring
          value={result.billablePerYear}
          max={result.totalHours}
          tone={result.overhead > 0.4 ? 'amber' : 'cyan'}
          label="Billable vs total hours"
          sub={`${result.totalHours.toFixed(0)} hours worked to bill ${result.billablePerYear}`}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Day rate (8 h)" value={money(result.dayRate)} mono />
        <Stat label="Weekly rate" value={money(result.weekRate)} mono />
        <Stat label="Monthly retainer" value={money(result.monthRetainer)} mono sub={`at ${billableHours} h a week`} />
        <Stat label="Break-even rate" value={money(result.breakEven)} mono sub="covers costs only, no income" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Where every invoiced dollar goes</div>
        <Bars data={result.breakdown} format={(value) => money(value)} highlightLast={false} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          You must invoice <span className="text-cyan-j">{money(result.gross)}</span> a year to keep {money(Number(income) || 0)}. Of that, {money(Math.max(0, result.taxPaid))} goes
          to tax and {money(Number(expenses) || 0)} to running the business — which is why a rate that looks high on paper is rarely high in practice.
        </p>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Against what you charge today</div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-40">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono-j text-xs text-muted-foreground">$</span>
            <input
              value={currentRate}
              onChange={(e) => setCurrentRate(e.target.value)}
              inputMode="decimal"
              className="h-9 w-full rounded-md border border-input bg-transparent pl-7 pr-2 text-right font-mono-j text-sm"
            />
          </div>
          <span className={`font-mono-j text-sm ${result.gap > 5 ? 'text-amber-400' : result.gap < -5 ? 'text-emerald-400' : 'text-cyan-j'}`}>
            {result.gap > 0 ? `${result.gap.toFixed(0)}% below the rate you need` : `${Math.abs(result.gap).toFixed(0)}% above the rate you need`}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Charging {money(Number(currentRate) || 0)} an hour across the same {result.billablePerYear} billable hours leaves about{' '}
          <span className="text-cyan-j">{money(result.annualAtCurrent)}</span> after tax and costs. Raising the rate is usually far easier than winning more
          hours: a 15% increase on the same clients does what another day of work a week cannot.
        </p>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Quote, don't estimate</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Price the outcome, not the hours: use {money(result.dayRate)} a day as your internal sanity check and let the client see a project figure.</p>
          <p>· Add a 20% buffer on any project estimate — the unbilled revision round is the most common reason a profitable rate produces an unprofitable month.</p>
          <p>· Value-based pricing can sit well above this number for work that directly earns or saves the client money; this rate is your floor, not your ceiling.</p>
          <p>· Raise rates with new clients first, one step of 10–15% at a time, and give existing clients 60 days' notice.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Hours a week worked', value: (Number(billableHours) / Math.max(0.05, 1 - result.overhead)).toFixed(1) },
              { label: 'Non-billable', value: `${nonBillable}%` },
              { label: 'Weeks off', value: `${52 - (Number(weeks) || 0)}` },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The single biggest mistake in freelance pricing is dividing a target income by the hours you sit at the desk. Only the hours you can actually
          invoice count, and they are usually about 55–70% of the ones you work. This calculator starts from the money you need to keep, adds the tax and
          business costs on top, and divides by the billable hours that remain.
        </p>
      </Panel>
    </ToolShell>
  );
}