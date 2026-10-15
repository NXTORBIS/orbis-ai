import { useMemo, useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const money = (value) => (Math.round((Number(value) || 0) * 100) / 100).toLocaleString();

const START = [
  { id: uid(), name: 'Credit card', balance: '4200', rate: '22.9', minimum: '120' },
  { id: uid(), name: 'Car loan', balance: '8600', rate: '7.4', minimum: '260' },
  { id: uid(), name: 'Student loan', balance: '14500', rate: '5.1', minimum: '180' },
];

const simulate = (debts, budget, strategy) => {
  const working = debts.map((debt) => ({
    name: debt.name,
    current: debt.balance,
    rate: (debt.rate || 0) / 100 / 12,
    minimum: debt.minimum,
  }));
  let month = 0;
  let totalInterest = 0;
  const order = [];
  const balances = [];

  while (working.some((debt) => debt.current > 0.5) && month < 720) {
    month += 1;
    let pool = budget;
    working.forEach((debt) => {
      if (debt.current <= 0) return;
      const interest = debt.current * debt.rate;
      debt.current += interest;
      totalInterest += interest;
      const pay = Math.min(debt.current, debt.minimum);
      debt.current -= pay;
      pool -= pay;
    });
    const targets = working
      .filter((debt) => debt.current > 0)
      .sort(strategy === 'avalanche' ? (a, b) => b.rate - a.rate : (a, b) => a.current - b.current);
    targets.forEach((debt) => {
      if (pool <= 0) return;
      const pay = Math.min(debt.current, pool);
      debt.current -= pay;
      pool -= pay;
    });
    working.forEach((debt) => {
      if (debt.current <= 0.5 && !order.includes(debt.name)) order.push(debt.name);
    });
    balances.push(working.reduce((sum, debt) => sum + Math.max(0, debt.current), 0));
  }

  const step = Math.max(1, Math.ceil(balances.length / 36));
  const timeline = balances
    .filter((_, index) => index % step === 0 || index === balances.length - 1)
    .map((value, index) => ({ label: index % 6 === 0 ? `M${index * step + 1}` : '', value }));

  return { months: month, totalInterest, order, timeline };
};

export default function DebtPayoff() {
  const [debts, setDebts] = useState(START);
  const [extra, setExtra] = useState('300');
  const [strategy, setStrategy] = useState('avalanche');
  const [currency, setCurrency] = useState('$');

  const result = useMemo(() => {
    const cleaned = debts
      .map((debt) => ({ name: debt.name.trim() || 'Debt', balance: Number(debt.balance) || 0, rate: Number(debt.rate) || 0, minimum: Number(debt.minimum) || 0 }))
      .filter((debt) => debt.balance > 0);
    const minimumTotal = cleaned.reduce((sum, debt) => sum + debt.minimum, 0);
    const budget = minimumTotal + (Number(extra) || 0);
    const avalanche = simulate(cleaned, budget, 'avalanche');
    const snowball = simulate(cleaned, budget, 'snowball');
    const baseline = simulate(cleaned, minimumTotal, 'avalanche');
    const chosen = strategy === 'avalanche' ? avalanche : snowball;
    const other = strategy === 'avalanche' ? snowball : avalanche;
    return {
      cleaned,
      minimumTotal,
      budget,
      totalDebt: cleaned.reduce((sum, debt) => sum + debt.balance, 0),
      avalanche,
      snowball,
      baseline,
      chosen,
      other,
      interestSaved: Math.max(0, baseline.totalInterest - chosen.totalInterest),
      monthsSaved: Math.max(0, baseline.months - chosen.months),
    };
  }, [debts, extra, strategy]);

  const setDebt = (id, patch) => setDebts((current) => current.map((debt) => (debt.id === id ? { ...debt, ...patch } : debt)));

  const report = [
    `Total debt ${currency}${money(result.totalDebt)} · minimums ${currency}${money(result.minimumTotal)} · paying ${currency}${money(result.budget)} a month`,
    `Strategy: ${strategy} — clear in ${result.chosen.months} months (${(result.chosen.months / 12).toFixed(1)} years), interest ${currency}${money(result.chosen.totalInterest)}`,
    `Order: ${result.chosen.order.join(' → ')}`,
    `Versus minimum payments only: ${result.monthsSaved} months and ${currency}${money(result.interestSaved)} saved`,
    `The other strategy: ${result.other.months} months, ${currency}${money(result.other.totalInterest)} interest`,
  ].join('\n');

  return (
    <ToolShell
      toolId="debt-payoff"
      icon={Wallet}
      title="Debt Payoff Planner"
      desc="List your debts and one extra payment, then compare avalanche against snowball — with the exact order to pay and the interest each route costs."
      state={{ debts, extra, strategy, currency }}
      onRestore={(restored) => {
        if (Array.isArray(restored.debts) && restored.debts.length) setDebts(restored.debts);
        if (restored.extra !== undefined) setExtra(String(restored.extra));
        if (restored.strategy) setStrategy(restored.strategy);
        if (restored.currency) setCurrency(restored.currency);
      }}
      exportText={report}
      exportName="debt-plan.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={strategy} onChange={setStrategy} options={[{ value: 'avalanche', label: 'Avalanche — highest rate first' }, { value: 'snowball', label: 'Snowball — smallest first' }]} />
        <Seg value={currency} onChange={setCurrency} options={[{ value: '$', label: '$' }, { value: '€', label: '€' }, { value: '£', label: '£' }, { value: '₹', label: '₹' }]} />
        <CopyBtn value={report} label="Copy plan" />
      </div>

      <div className="space-y-2">
        <div className="hidden grid-cols-[1.3fr_1fr_0.7fr_0.9fr_auto] gap-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
          <span>Debt</span><span>Balance</span><span>Rate %</span><span>Minimum</span><span />
        </div>
        {debts.map((debt) => (
          <div key={debt.id} className="tk-card tk-depth grid grid-cols-[1.3fr_1fr_auto] gap-2 rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5 sm:grid-cols-[1.3fr_1fr_0.7fr_0.9fr_auto] sm:items-center">
            <input value={debt.name} onChange={(e) => setDebt(debt.id, { name: e.target.value })} placeholder="Credit card" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
            <input value={debt.balance} onChange={(e) => setDebt(debt.id, { balance: e.target.value })} inputMode="decimal" placeholder="Balance" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <input value={debt.rate} onChange={(e) => setDebt(debt.id, { rate: e.target.value })} inputMode="decimal" placeholder="APR" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <input value={debt.minimum} onChange={(e) => setDebt(debt.id, { minimum: e.target.value })} inputMode="decimal" placeholder="Minimum" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <button type="button" onClick={() => setDebts(debts.filter((row) => row.id !== debt.id))} disabled={debts.length <= 1} className="justify-self-end text-muted-foreground transition hover:text-red-500 disabled:opacity-30">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDebts((current) => [...current, { id: uid(), name: '', balance: '', rate: '', minimum: '' }].slice(0, 10))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a debt
        </button>
        <span className="text-[11px] text-muted-foreground">Minimums total {currency}{money(result.minimumTotal)} a month</span>
      </div>

      <Field label={`Extra you can throw at it · ${currency}${extra} a month`}>
        <input type="range" min={0} max={2000} step={25} value={extra} onChange={(e) => setExtra(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          label="Debt-free in"
          value={result.chosen.months}
          unit="months"
          sub={`${(result.chosen.months / 12).toFixed(1)} years · ${currency}${money(result.chosen.totalInterest)} of interest on the way`}
        />
        <Ring
          value={result.interestSaved}
          max={result.baseline.totalInterest || 1}
          tone="emerald"
          label="Interest avoided"
          unit={`${currency}${money(result.interestSaved)} saved`}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Total debt" value={`${currency}${money(result.totalDebt)}`} mono />
        <Stat label="Monthly outgoings" value={`${currency}${money(result.budget)}`} mono />
        <Stat label="Minimums only" value={`${result.baseline.months}m`} mono />
        <Stat label="Months saved" value={String(result.monthsSaved)} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Pay them in this order — {strategy}</div>
        <div className="space-y-1.5">
          {result.chosen.order.map((name, index) => {
            const debt = result.cleaned.find((row) => row.name === name);
            return (
              <div key={`${name}-${index}`} className="flex items-center gap-3 rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-2 text-[11px]">
                <span className="grid h-6 w-6 place-items-center rounded-full border border-cyan-j/50 font-mono-j text-[10px] text-cyan-j">{index + 1}</span>
                <span className="flex-1 truncate">{name}</span>
                <span className="font-mono-j text-muted-foreground">{debt?.rate ?? 0}% APR</span>
                <span className="font-mono-j">{currency}{money(debt?.balance ?? 0)}</span>
              </div>
            );
          })}
          {!result.chosen.order.length && <span className="text-[11px] text-muted-foreground">Add a debt with a balance to see the order.</span>}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Balance over time</div>
          <Bars data={result.chosen.timeline} format={(value) => money(value)} />
          <p className="mt-2 text-[11px] text-muted-foreground">One bar per month of remaining balance — the extra payment is what makes the final bars collapse so fast.</p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Avalanche vs snowball</div>
          <div className="space-y-2">
            {[
              { label: 'Avalanche — highest rate first', data: result.avalanche },
              { label: 'Snowball — smallest balance first', data: result.snowball },
            ].map((option) => (
              <div key={option.label} className={`rounded-lg border px-2.5 py-2 text-[11px] ${option.data === result.chosen ? 'border-cyan-j/50 bg-cyan-j/5' : 'border-border/50 bg-card/40'}`}>
                <div className="flex items-center justify-between">
                  <span>{option.label}</span>
                  <span className="font-mono-j">{option.data.months} months</span>
                </div>
                <div className="mt-1 font-mono-j text-muted-foreground">interest {currency}{money(option.data.totalInterest)}</div>
              </div>
            ))}
            <Pills
              items={[
                { label: 'Interest difference', value: `${currency}${money(Math.abs(result.avalanche.totalInterest - result.snowball.totalInterest))}` },
                { label: 'Months apart', value: Math.abs(result.avalanche.months - result.snowball.months) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Avalanche always costs less overall because high-interest debt compounds fastest. Snowball usually wins on behaviour, not maths: clearing a
          small debt early gives a visible win that keeps people going. If the gap between the two is small, pick the one you will actually stick to —
          the best plan is the one still running in month eight.
        </p>
      </Panel>
    </ToolShell>
  );
}