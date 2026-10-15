import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel, CopyBtn } from './shared';

export default function LoanCalculator() {
  const [amount, setAmount] = useState(500000);
  const [rate, setRate] = useState(9.5);
  const [tenure, setTenure] = useState(5);
  const [unit, setUnit] = useState('years');

  const months = unit === 'years' ? Math.max(1, Number(tenure) * 12) : Math.max(1, Number(tenure));
  const p = Number(amount) || 0;
  const r = (Number(rate) || 0) / 1200;
  const emi = r === 0 ? p / months : (p * r * (1 + r) ** months) / ((1 + r) ** months - 1);
  const total = emi * months;
  const interest = total - p;

  const money = (v) => `₹${Math.round(v).toLocaleString()}`;
  const schedule = [];
  let balance = p;
  for (let i = 1; i <= months && i <= 12; i++) {
    const interestPart = balance * r;
    const principalPart = emi - interestPart;
    balance -= principalPart;
    schedule.push({ month: i, interest: interestPart, principal: principalPart, balance: Math.max(0, balance) });
  }

  return (
    <div className="space-y-4">
      <ToolHeader icon={Landmark} title="Loan EMI Calculator" desc="Monthly instalment, total interest and a year-one repayment schedule." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Loan amount">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Annual interest rate %">
          <input type="number" step={0.1} value={rate} onChange={(e) => setRate(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tenure">
          <input type="number" value={tenure} onChange={(e) => setTenure(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Tenure unit">
          <Seg value={unit} onChange={setUnit} options={[{ value: 'years', label: 'Years' }, { value: 'months', label: 'Months' }]} />
        </Field>
      </div>
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Monthly EMI</div>
        <div className="font-display text-4xl font-bold tabular-nums text-cyan-j">{money(emi)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{months} monthly instalments</div>
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Principal" value={money(p)} mono />
        <Stat label="Total interest" value={money(interest)} mono />
        <Stat label="Total payable" value={money(total)} mono />
        <Stat label="Interest share" value={`${((interest / (total || 1)) * 100).toFixed(1)}%`} />
      </div>
      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead className="bg-secondary/60">
            <tr>
              <th className="px-3 py-2 font-semibold text-muted-foreground">Month</th>
              <th className="px-3 py-2 font-semibold text-muted-foreground">Interest</th>
              <th className="px-3 py-2 font-semibold text-muted-foreground">Principal</th>
              <th className="px-3 py-2 font-semibold text-muted-foreground">Balance</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((row) => (
              <tr key={row.month} className="border-t border-border/60">
                <td className="px-3 py-1.5">{row.month}</td>
                <td className="px-3 py-1.5 font-mono-j text-amber-500">{money(row.interest)}</td>
                <td className="px-3 py-1.5 font-mono-j text-cyan-j">{money(row.principal)}</td>
                <td className="px-3 py-1.5 font-mono-j text-muted-foreground">{money(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <CopyBtn value={JSON.stringify({ loan: p, rate, months, emi: Math.round(emi), totalInterest: Math.round(interest), totalPayable: Math.round(total) }, null, 2)} label="Copy summary" />
      <p className="text-[11px] text-muted-foreground">Assumes a fixed rate with equal monthly instalments, calculated locally — figures are estimates, not a lender quote.</p>
    </div>
  );
}