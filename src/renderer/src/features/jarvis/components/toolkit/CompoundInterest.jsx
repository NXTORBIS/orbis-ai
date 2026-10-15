import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel, CopyBtn } from './shared';

export default function CompoundInterest() {
  const [principal, setPrincipal] = useState(100000);
  const [rate, setRate] = useState(11);
  const [years, setYears] = useState(10);
  const [freq, setFreq] = useState(12);
  const [monthly, setMonthly] = useState(5000);

  const p = Number(principal) || 0;
  const annual = (Number(rate) || 0) / 100;
  const y = Math.max(0, Number(years) || 0);
  const n = Number(freq) || 1;
  const perPeriod = annual / n;
  const periods = Math.round(y * n);
  const contributionPerPeriod = (Number(monthly) || 0) * (12 / n);

  const rows = [];
  let balance = p;
  let contributed = p;
  for (let i = 1; i <= periods; i++) {
    const interest = balance * perPeriod;
    balance = balance + interest + contributionPerPeriod;
    contributed += contributionPerPeriod;
    const isYearEnd = i % n === 0;
    if (isYearEnd) rows.push({ year: i / n, balance, contributed, interest: balance - contributed });
  }

  const final = rows.length ? rows[rows.length - 1] : { balance: p, contributed: p, interest: 0 };
  const money = (v) => `₹${Math.round(v).toLocaleString()}`;
  const multiple = p + contributionPerPeriod > 0 ? final.balance / final.contributed : 0;
  const simple = p * (1 + annual * y) + (Number(monthly) || 0) * 12 * y;

  return (
    <div className="space-y-4">
      <ToolHeader icon={TrendingUp} title="Compound Interest" desc="See how regular contributions and compounding frequency grow your money." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starting amount">
          <input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Monthly contribution">
          <input type="number" value={monthly} onChange={(e) => setMonthly(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Annual return %">
          <input type="number" step={0.1} value={rate} onChange={(e) => setRate(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Years">
          <input type="number" value={years} onChange={(e) => setYears(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>
      <Field label="Compounding">
        <Seg value={freq} onChange={setFreq} options={[{ value: 1, label: 'Yearly' }, { value: 4, label: 'Quarterly' }, { value: 12, label: 'Monthly' }, { value: 365, label: 'Daily' }]} />
      </Field>
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Value after {y} years</div>
        <div className="font-display text-4xl font-bold tabular-nums text-cyan-j">{money(final.balance)}</div>
        <div className="mt-1 text-xs text-muted-foreground">on {money(final.contributed)} invested · {money(final.interest)} earned</div>
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Total invested" value={money(final.contributed)} mono />
        <Stat label="Interest earned" value={money(final.interest)} mono />
        <Stat label="Growth multiple" value={`${multiple.toFixed(2)}×`} />
        <Stat label="Simple interest" value={money(simple - principal - (Number(monthly) || 0) * 12 * y)} mono />
      </div>
      {rows.length > 0 && (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="bg-secondary/60">
              <tr>
                <th className="px-3 py-2 font-semibold text-muted-foreground">Year</th>
                <th className="px-3 py-2 font-semibold text-muted-foreground">Invested</th>
                <th className="px-3 py-2 font-semibold text-muted-foreground">Interest</th>
                <th className="px-3 py-2 font-semibold text-muted-foreground">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year} className="border-t border-border/60">
                  <td className="px-3 py-1.5">{r.year}</td>
                  <td className="px-3 py-1.5 font-mono-j text-muted-foreground">{money(r.contributed)}</td>
                  <td className="px-3 py-1.5 font-mono-j text-amber-500">{money(r.interest)}</td>
                  <td className="px-3 py-1.5 font-mono-j text-cyan-j">{money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <CopyBtn value={rows.map((r) => `Year ${r.year}: invested ${Math.round(r.contributed)}, interest ${Math.round(r.interest)}, balance ${Math.round(r.balance)}`).join('\n')} label="Copy schedule" />
      <p className="text-[11px] text-muted-foreground">Assumes a constant return rate with contributions added each period — real markets vary, so treat this as an illustration.</p>
    </div>
  );
}