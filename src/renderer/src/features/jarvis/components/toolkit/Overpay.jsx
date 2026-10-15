import { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring, Spark } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const money = (value) => Math.round(Number(value) || 0).toLocaleString();

const schedule = (principal, annualRate, years, extra = 0, lump = 0, lumpMonth = 12) => {
  const monthlyRate = annualRate / 100 / 12;
  const totalMonths = Math.round(years * 12);
  const payment = monthlyRate > 0
    ? (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -totalMonths)
    : principal / Math.max(1, totalMonths);

  let balance = principal;
  let interest = 0;
  let month = 0;
  const rows = [];
  const yearly = [0, 0, 0, 0, 0];

  while (balance > 0.5 && month < 1200) {
    month += 1;
    const monthInterest = balance * monthlyRate;
    interest += monthInterest;
    balance += monthInterest;

    let capitalPaid = Math.min(balance, Math.max(0, payment - monthInterest));
    balance -= capitalPaid;
    const extraPaid = extra > 0 ? Math.min(balance, extra) : 0;
    balance -= extraPaid;
    const lumpPaid = lump > 0 && month === lumpMonth ? Math.min(balance, lump) : 0;
    balance -= lumpPaid;
    capitalPaid += extraPaid + lumpPaid;

    if (month <= 60) yearly[Math.ceil(month / 12) - 1] += monthInterest;
    if (rows.length < 24) rows.push({ month, monthInterest, capitalPaid, extraPaid, lumpPaid, balance: Math.max(0, balance) });
  }

  return { payment, months: month, totalInterest: interest, rows, yearly };
};

export default function Overpay() {
  const [amount, setAmount] = useState('320000');
  const [rate, setRate] = useState('6.4');
  const [years, setYears] = useState('25');
  const [extra, setExtra] = useState('200');
  const [lump, setLump] = useState('5000');
  const [lumpMonth, setLumpMonth] = useState('6');
  const [useLump, setUseLump] = useState(false);
  const [currency, setCurrency] = useState('$');

  const result = useMemo(() => {
    const principal = Number(amount) || 0;
    const rateValue = Number(rate) || 0;
    const term = Number(years) || 1;
    const extraValue = Number(extra) || 0;
    const lumpValue = useLump ? Number(lump) || 0 : 0;
    const base = schedule(principal, rateValue, term);
    const plan = schedule(principal, rateValue, term, extraValue, lumpValue, Number(lumpMonth) || 12);
    const totalMonthly = plan.payment + extraValue;
    return {
      base,
      plan,
      totalMonthly,
      interestSaved: base.totalInterest - plan.totalInterest,
      monthsSaved: Math.max(0, base.months - plan.months),
      months: Array.from({ length: 5 }, (_, i) => ({ label: `Year ${i + 1}`, value: plan.yearly[i], before: base.yearly[i] })),
    };
  }, [amount, rate, years, extra, lump, lumpMonth, useLump]);

  const savedYears = Math.floor(result.monthsSaved / 12);
  const savedMonths = result.monthsSaved % 12;

  const report = [
    `Loan ${amount} at ${rate}% over ${years} years`,
    `Baseline: ${money(result.base.payment)} a month · cleared in ${result.base.months} months · ${money(result.base.totalInterest)} interest`,
    `With ${extra} extra a month${useLump ? ` and a ${lump} lump sum in month ${lumpMonth}` : ''}:`,
    `Payment ${money(result.totalMonthly)} a month · cleared in ${result.plan.months} months · ${money(result.plan.totalInterest)} interest`,
    `Interest saved ${money(result.interestSaved)} · time saved ${savedYears ? `${savedYears}y ` : ''}${savedMonths}m`,
  ].join('\n');

  const tone = result.interestSaved > (Number(amount) || 0) * 0.1 ? 'emerald' : 'cyan';

  return (
    <ToolShell
      toolId="overpay"
      icon={Landmark}
      title="Mortgage Overpayment Planner"
      desc="See exactly what a little extra each month does to the interest and the finish date — and how much of the term it deletes."
      state={{ amount, rate, years, extra, lump, lumpMonth, useLump, currency }}
      onRestore={(restored) => {
        if (restored.amount !== undefined) setAmount(String(restored.amount));
        if (restored.rate !== undefined) setRate(String(restored.rate));
        if (restored.years !== undefined) setYears(String(restored.years));
        if (restored.extra !== undefined) setExtra(String(restored.extra));
        if (restored.lump !== undefined) setLump(String(restored.lump));
        if (restored.lumpMonth !== undefined) setLumpMonth(String(restored.lumpMonth));
        if (typeof restored.useLump === 'boolean') setUseLump(restored.useLump);
        if (restored.currency) setCurrency(restored.currency);
      }}
      exportText={report}
      exportName="overpayment-plan.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={currency} onChange={setCurrency} options={[{ value: '$', label: '$' }, { value: '€', label: '€' }, { value: '£', label: '£' }, { value: '₹', label: '₹' }]} />
        <CopyBtn value={report} label="Copy plan" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount borrowed">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Interest rate % a year">
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Term in years">
          <input value={years} onChange={(e) => setYears(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[100, 200, 350, 500].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setExtra(String(value))}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${Number(extra) === value ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'}`}
          >
            +{currency}{value} a month
          </button>
        ))}
      </div>

      <Field label={`Extra every month · ${currency}${extra}`}>
        <input type="range" min={0} max={2000} step={25} value={extra} onChange={(e) => setExtra(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <ToggleRow label="Also make a one-off lump-sum payment" checked={useLump} onChange={setUseLump} />
      {useLump && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lump sum amount">
            <input value={lump} onChange={(e) => setLump(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <Field label="Paid in which month of the loan">
            <input value={lumpMonth} onChange={(e) => setLumpMonth(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          tone={tone}
          label="Interest saved"
          value={`${currency}${money(result.interestSaved)}`}
          sub={`and ${savedYears ? `${savedYears} year${savedYears === 1 ? '' : 's'} ` : ''}${savedMonths} month${savedMonths === 1 ? '' : 's'} off the term`}
        />
        <Ring value={result.plan.months} max={result.base.months} label="Term remaining" sub={`${result.plan.months} of ${result.base.months} months`} />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Baseline payment" value={`${currency}${money(result.base.payment)}`} mono />
        <Stat label="Your payment" value={`${currency}${money(result.totalMonthly)}`} mono sub={useLump ? 'plus the lump sum' : undefined} />
        <Stat label="Interest before" value={`${currency}${money(result.base.totalInterest)}`} mono />
        <Stat label="Interest after" value={`${currency}${money(result.plan.totalInterest)}`} mono />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Interest paid each year — before and after</div>
          <div className="space-y-2">
            {result.months.map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{row.label}</span>
                  <span className="font-mono-j">{currency}{money(row.value)} <span className="opacity-60">was {currency}{money(row.before)}</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-card/70">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-j/50 to-cyan-j" style={{ width: `${row.before ? Math.min(100, (row.value / row.before) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Balance falling away faster</div>
          <Spark data={result.plan.rows.map((row) => row.balance)} />
          <div className="mt-2">
            <Pills
              items={[
                { label: 'Baseline', value: `${result.base.months}m` },
                { label: 'With overpayment', value: `${result.plan.months}m` },
                { label: 'Saved', value: `${currency}${money(result.interestSaved)}`, tone: 'amber' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">First months of the faster plan</div>
        <div className="max-h-56 overflow-auto">
          <table className="w-full border-collapse text-left font-mono-j text-[11px]">
            <thead className="sticky top-0 bg-card/95 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5">Month</th>
                <th className="py-1.5 text-right">Interest</th>
                <th className="py-1.5 text-right">Capital</th>
                <th className="py-1.5 text-right">Extra</th>
                <th className="py-1.5 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {result.plan.rows.map((row) => (
                <tr key={row.month} className="border-t border-border/40">
                  <td className="py-1">{row.month}</td>
                  <td className="py-1 text-right text-amber-400">{money(row.monthInterest)}</td>
                  <td className="py-1 text-right text-cyan-j">{money(row.capitalPaid)}</td>
                  <td className="py-1 text-right text-muted-foreground">{row.extraPaid || row.lumpPaid ? money(row.extraPaid + row.lumpPaid) : '—'}</td>
                  <td className="py-1 text-right text-muted-foreground">{money(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Early overpayments are worth several times what the same money is worth late in the term, because the amber column is interest you never pay.
          Most fixed-rate deals allow around 10% of the balance as overpayment each year before a fee applies — check your own terms, since an early
          repayment charge can outweigh the saving.
        </p>
      </Panel>
    </ToolShell>
  );
}