import { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel, CopyBtn } from './shared';
import ToolShell from './kit/ToolShell';

const BASES = [
  ['annual', 'Annual'], ['monthly', 'Monthly'], ['weekly', 'Weekly'], ['daily', 'Daily'], ['hourly', 'Hourly'],
];

const CURRENCIES = [['$', 'USD  $'], ['₹', 'INR  ₹'], ['€', 'EUR  €'], ['£', 'GBP  £']];

const money = (value, symbol) => `${symbol}${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

export default function SalaryConverter() {
  const [base, setBase] = useState('annual');
  const [value, setValue] = useState('75000');
  const [hours, setHours] = useState('40');
  const [weeks, setWeeks] = useState('52');
  const [vacationWeeks, setVacationWeeks] = useState('4');
  const [symbol, setSymbol] = useState('$');

  const result = useMemo(() => {
    const amount = Number(value) || 0;
    const h = Math.max(0.5, Number(hours) || 40);
    const w = Math.max(1, Number(weeks) || 52);
    const weeksWorked = Math.max(1, w - (Number(vacationWeeks) || 0));
    const daysPerWeek = 5;
    const annual = base === 'annual' ? amount
      : base === 'monthly' ? amount * 12
        : base === 'weekly' ? amount * w
          : base === 'daily' ? amount * daysPerWeek * weeksWorked
            : amount * h * weeksWorked;
    const hourly = annual / (h * weeksWorked);
    const daily = hourly * (h / daysPerWeek);
    const weekly = hourly * h;
    const monthly = annual / 12;
    const workedDaysPerYear = weeksWorked * daysPerWeek;
    return {
      annual,
      hourly,
      daily,
      weekly,
      biweekly: weekly * 2,
      monthly,
      quarterly: annual / 4,
      workedDaysPerYear,
      perWorkedDay: annual / workedDaysPerYear,
      hoursPerYear: h * weeksWorked,
    };
  }, [base, value, hours, weeks, vacationWeeks]);

  const rows = [
    ['Hourly', result.hourly],
    ['Daily', result.daily],
    ['Weekly', result.weekly],
    ['Bi-weekly', result.biweekly],
    ['Monthly', result.monthly],
    ['Quarterly', result.quarterly],
    ['Annual', result.annual],
  ];

  const summary = rows.map(([label, amount]) => `${label}: ${money(amount, symbol)}`).join('\n');

  return (
    <ToolShell
      toolId="salary-converter"
      icon={Landmark}
      title="Salary & Rate Converter"
      desc="Move between hourly, weekly, monthly and annual pay — with unpaid weeks factored in."
      state={{ base, value, hours, weeks, vacationWeeks, symbol }}
      onRestore={(saved) => {
        setBase(saved.base); setValue(saved.value); setHours(saved.hours);
        setWeeks(saved.weeks); setVacationWeeks(saved.vacationWeeks); setSymbol(saved.symbol);
      }}
      exportText={JSON.stringify(result, null, 2)}
      exportName="salary.json"
      exportMime="application/json"
    >
      <Seg value={base} onChange={setBase} options={BASES.map(([value, label]) => ({ value, label }))} />
      <Seg value={symbol} onChange={setSymbol} options={CURRENCIES.map(([value, label]) => ({ value, label }))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Amount per ${BASES.find(([b]) => b === base)[1].toLowerCase()}`}>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Full days per week" hint="Used to convert between daily and hourly"><input value="5" readOnly className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm opacity-70" /></Field>
        <Field label="Hours per week"><input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Weeks per year"><input value={weeks} onChange={(e) => setWeeks(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Unpaid weeks off" hint="Holiday or unpaid leave — the rest of the weeks carry the pay"><input value={vacationWeeks} onChange={(e) => setVacationWeeks(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map(([label, amount]) => (
          <div key={label} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${label === 'Annual' ? 'border-cyan-j/50 bg-cyan-j/5' : 'border-border/70 bg-card/50'}`}>
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={`text-sm font-semibold ${label === 'Annual' ? 'text-cyan-j' : ''}`}>{money(amount, symbol)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Hours worked / year" value={result.hoursPerYear.toFixed(0)} />
        <Stat label="Worked days / year" value={result.workedDaysPerYear.toFixed(0)} />
        <Stat label="Per worked day" value={money(result.perWorkedDay, symbol)} />
        <Stat label="Effective hourly" value={money(result.hourly, symbol)} />
      </div>
      <CopyBtn value={summary} label="Copy breakdown" />
      <Panel>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Two rates often sound identical but are not: an annual figure divided by 52 weeks gives a different hourly rate than dividing by the weeks you actually work. Setting unpaid weeks aside makes the hourly number the honest one for comparing offers.
        </div>
      </Panel>
    </ToolShell>
  );
}