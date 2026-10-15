import { useMemo, useState } from 'react';
import { PiggyBank } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const fmt = (value, currency = 'USD') => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value) || 0);
  } catch {
    return `${currency} ${Math.round(Number(value) || 0)}`;
  }
};

export default function SavingsGoal() {
  const [income, setIncome] = useState('4500');
  const [needs, setNeeds] = useState(50);
  const [wants, setWants] = useState(30);
  const [target, setTarget] = useState('20000');
  const [saved, setSaved] = useState('2500');
  const [rate, setRate] = useState('4');
  const [currency, setCurrency] = useState('USD');

  const computed = useMemo(() => {
    const monthly = Number(income) || 0;
    const goal = Number(target) || 0;
    const starting = Number(saved) || 0;
    const annual = (Number(rate) || 0) / 100;
    const monthlyRate = annual / 12;
    const needsAmount = (monthly * needs) / 100;
    const wantsAmount = (monthly * wants) / 100;
    const savingsAmount = Math.max(0, monthly - needsAmount - wantsAmount);

    let balance = starting;
    let months = 0;
    const milestones = [];
    if (goal > 0 && (savingsAmount > 0 || starting >= goal)) {
      while (balance < goal && months < 720) {
        balance = balance * (1 + monthlyRate) + savingsAmount;
        months += 1;
        const progress = months / 12;
        if (Number.isInteger(progress) && progress <= 10) milestones.push({ label: `${progress} year${progress === 1 ? '' : 's'}`, value: balance });
      }
    }
    const years = Math.floor(months / 12);
    const restMonths = months % 12;
    return {
      needsAmount, wantsAmount, savingsAmount,
      months, eta: months ? `${years ? `${years}y ` : ''}${restMonths ? `${restMonths}m` : years ? '' : '0m'}`.trim() : '—',
      final: balance,
      interestEarned: Math.max(0, balance - starting - savingsAmount * months),
      milestones,
      savingsRate: monthly ? (savingsAmount / monthly) * 100 : 0,
    };
  }, [income, needs, wants, target, saved, rate]);

  const report = [
    `Monthly income: ${fmt(income, currency)}`,
    `Needs ${needs}%: ${fmt(computed.needsAmount, currency)} · Wants ${wants}%: ${fmt(computed.wantsAmount, currency)} · Savings ${Math.round(computed.savingsRate)}%: ${fmt(computed.savingsAmount, currency)}`,
    `Goal: ${fmt(target, currency)} (already saved ${fmt(saved, currency)}) at ${rate}% a year`,
    `Reached in ${computed.months} months (${computed.eta}) · interest earned ${fmt(computed.interestEarned, currency)}`,
  ].join('\n');

  return (
    <ToolShell
      toolId="savings-goal"
      icon={PiggyBank}
      title="Budget & Savings Goal Planner"
      desc="Split your income 50/30/20, see what that leaves for savings, and find out exactly when your goal lands."
      state={{ income, needs, wants, target, saved, rate, currency }}
      onRestore={(restored) => {
        if (restored.income !== undefined) setIncome(String(restored.income));
        if (restored.needs) setNeeds(Number(restored.needs));
        if (restored.wants) setWants(Number(restored.wants));
        if (restored.target !== undefined) setTarget(String(restored.target));
        if (restored.saved !== undefined) setSaved(String(restored.saved));
        if (restored.rate !== undefined) setRate(String(restored.rate));
        if (restored.currency) setCurrency(restored.currency);
      }}
      exportText={report}
      exportName="savings-plan.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
          {['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED'].map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <CopyBtn value={report} label="Copy plan" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Take-home income / month">
          <input value={income} onChange={(e) => setIncome(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Already saved">
          <input value={saved} onChange={(e) => setSaved(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Savings goal">
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Needs · ${needs}%`}>
          <input type="range" min={20} max={80} value={needs} onChange={(e) => setNeeds(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Wants · ${wants}%`}>
          <input type="range" min={5} max={60} value={wants} onChange={(e) => setWants(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Expected return · ${rate}% a year`}>
          <input type="range" min={0} max={12} step={0.25} value={rate} onChange={(e) => setRate(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Goal reached in</div>
        <div className="tk-title-glow mt-1 font-mono-j text-4xl font-semibold text-cyan-j">{computed.eta}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          saving {fmt(computed.savingsAmount, currency)} a month · {computed.months} months
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Needs 50%" value={fmt(computed.needsAmount, currency)} mono />
        <Stat label="Wants 30%" value={fmt(computed.wantsAmount, currency)} mono />
        <Stat label="Savings" value={fmt(computed.savingsAmount, currency)} sub={`${Math.round(computed.savingsRate)}% of income`} mono />
        <Stat label="Interest earned" value={fmt(computed.interestEarned, currency)} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Where the balance lands over time</div>
        <div className="flex h-28 items-end gap-1">
          {[0, 3, 6, 9, 12, 18, 24, 36, 48, 60].map((months) => {
            let balance = Number(saved) || 0;
            for (let i = 0; i < months; i += 1) balance = balance * (1 + (Number(rate) || 0) / 1200) + computed.savingsAmount;
            const percent = Number(target) ? Math.min(100, (balance / Number(target)) * 100) : 0;
            return (
              <div key={months} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-gradient-to-t from-cyan-j/30 to-cyan-j" style={{ height: `${Math.max(3, percent)}%` }} />
                <span className="font-mono-j text-[9px] text-muted-foreground">{months}m</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The 50/30/20 split is a starting point, not a rule — move the sliders to something you would actually live with, because a plan you keep
          beats a stricter one you abandon. Small monthly amounts compound surprisingly well: the interest line above is money you never worked for.
        </p>
      </Panel>
    </ToolShell>
  );
}