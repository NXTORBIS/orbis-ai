import { useMemo, useState } from 'react';
import { PiggyBank, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const money = (value, currency) => currency + Math.round(value).toLocaleString();

const DEFAULT_EXPENSES = [
  { id: 'a', label: 'Housing', amount: '1100' },
  { id: 'b', label: 'Food', amount: '420' },
  { id: 'c', label: 'Transport', amount: '260' },
  { id: 'd', label: 'Utilities', amount: '180' },
  { id: 'e', label: 'Insurance', amount: '140' },
  { id: 'f', label: 'Debt minimums', amount: '220' },
];

const blank = () => ({ id: Math.random().toString(36).slice(2), label: 'New expense', amount: '0' });

export default function EmergencyFund() {
  const [expenses, setExpenses] = useState(DEFAULT_EXPENSES);
  const [months, setMonths] = useState('6');
  const [saved, setSaved] = useState('2500');
  const [contribution, setContribution] = useState('300');
  const [rate, setRate] = useState('4');
  const [currency, setCurrency] = useState('£');

  const set = (id, key, value) => setExpenses((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const monthlyEssentials = expenses.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const target = monthlyEssentials * Math.max(1, Number(months) || 1);
    const current = Math.max(0, Number(saved) || 0);
    const monthly = Math.max(0, Number(contribution) || 0);
    const annualRate = (Number(rate) || 0) / 100;
    const monthlyRate = annualRate / 12;
    const gap = Math.max(0, target - current);
    const coverMonths = monthlyEssentials ? current / monthlyEssentials : 0;

    const simulate = (deposit) => {
      let balance = current;
      let count = 0;
      while (balance < target && count < 600) {
        balance = balance * (1 + monthlyRate) + deposit;
        count += 1;
        if (deposit === 0 && monthlyRate === 0) break;
      }
      return { months: balance >= target ? count : 601, balance };
    };

    const base = simulate(monthly);
    const monthsToGoal = base.months;
    const reachDate = (() => {
      if (monthsToGoal > 600) return 'not reached at this contribution';
      const date = new Date();
      date.setMonth(date.getMonth() + monthsToGoal);
      return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    })();

    const scenarios = [0.5, 1, 1.5, 2].map((multiplier) => {
      const outcome = simulate(monthly * multiplier);
      return {
        label: Math.round(multiplier * 100) + '% of your contribution',
        value: outcome.months > 600 ? 0 : outcome.months,
        months: outcome.months,
        amount: monthly * multiplier,
      };
    });

    const bare = monthlyEssentials * 0.6;
    const bareTarget = bare * Math.max(1, Number(months) || 1);
    const interestEarned = base.balance - current - monthly * monthsToGoal;
    const progress = target ? (current / target) * 100 : 0;

    const rows = expenses.map((row) => ({ ...row, amount: Number(row.amount) || 0 }));
    const largest = rows.reduce((best, row) => (row.amount > (best.amount || 0) ? row : best), {});
    const trimmed = rows.reduce((sum, row) => sum + row.amount * 0.9, 0);
    const trimmedTarget = trimmed * Math.max(1, Number(months) || 1);

    return {
      monthlyEssentials, target, current, monthly, gap, coverMonths, monthsToGoal, reachDate, scenarios, bare, bareTarget,
      interestEarned, progress, rows, largest, trimmed, trimmedTarget, monthlyRate,
      contributionShare: monthlyEssentials ? (monthly / monthlyEssentials) * 100 : 0,
    };
  }, [expenses, months, saved, contribution, rate]);

  const report = useMemo(() => [
    'Essential spending ' + money(result.monthlyEssentials, currency) + ' a month',
    'Target fund ' + money(result.target, currency) + ' for ' + months + ' months of cover',
    'Currently saved ' + money(result.current, currency) + ', which covers ' + result.coverMonths.toFixed(1) + ' months',
    'Gap to close: ' + money(result.gap, currency),
    '',
    result.monthsToGoal > 600
      ? 'At ' + money(result.monthly, currency) + ' a month the target is not reached within fifty years. Increase the contribution.'
      : 'At ' + money(result.monthly, currency) + ' a month the target is reached in ' + result.monthsToGoal + ' months, around ' + result.reachDate + '.',
    'Interest earned along the way: about ' + money(Math.max(0, result.interestEarned), currency),
    '',
    'Bare-bones version, cutting every category by 40%: ' + money(result.bareTarget, currency) + ' covers the same ' + months + ' months.',
    'Scenarios: ' + result.scenarios.map((row) => row.label + ' → ' + (row.months > 600 ? 'unreachable' : row.months + ' months')).join(', '),
  ].join('\n'), [result, currency, months]);

  return (
    <ToolShell
      toolId="emergency-fund"
      icon={PiggyBank}
      title="Emergency Fund Planner"
      desc="What you actually spend each month, the fund that covers it for the number of months you choose, how long the gap takes to close and what a bare-bones version would need."
      state={{ expenses, months, saved, contribution, rate, currency }}
      onRestore={(restored) => {
        if (Array.isArray(restored.expenses) && restored.expenses.length) setExpenses(restored.expenses);
        if (restored.months !== undefined) setMonths(String(restored.months));
        if (restored.saved !== undefined) setSaved(String(restored.saved));
        if (restored.contribution !== undefined) setContribution(String(restored.contribution));
        if (restored.rate !== undefined) setRate(String(restored.rate));
        if (typeof restored.currency === 'string') setCurrency(restored.currency);
      }}
      exportText={report}
      exportName="emergency-fund.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={months} onChange={setMonths} options={[{ value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '9', label: '9 months' }, { value: '12', label: '12 months' }]} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Monthly essentials — the money that must leave</span>
          <span className="font-mono-j text-[10px] text-cyan-j">{money(result.monthlyEssentials, currency)} a month</span>
        </div>
        <div className="space-y-2">
          {expenses.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-3">
              <Field label="Category"><input value={row.label} onChange={(e) => set(row.id, 'label', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
              <Field label="Monthly amount"><input value={row.amount} onChange={(e) => set(row.id, 'amount', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <div className="flex items-end">
                <button type="button" onClick={() => setExpenses((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setExpenses((current) => [...current, blank()])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Plus className="h-3.5 w-3.5" /> Add a category
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Essentials only. Rent or mortgage, food, transport, utilities, insurance and minimum debt payments are what an emergency fund protects; subscriptions and leisure are
          what you cancel first when income stops.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Already saved for this"><input value={saved} onChange={(e) => setSaved(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Monthly contribution"><input value={contribution} onChange={(e) => setContribution(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Savings interest rate, %"><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Fund target"
          value={money(result.target, currency)}
          sub={months + ' months of essential spending at ' + money(result.monthlyEssentials, currency) + ' a month. You currently cover ' + result.coverMonths.toFixed(1) + ' months, so the gap is ' + money(result.gap, currency) + '. At ' + money(result.monthly, currency) + ' a month that closes around ' + result.reachDate + '.'}
        />
        <Ring
          value={result.progress}
          max={100}
          tone={result.progress >= 100 ? 'emerald' : result.progress >= 50 ? 'amber' : 'rose'}
          label="Progress towards the target"
          sub={money(result.current, currency) + ' of ' + money(result.target, currency) + ' already saved'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Months to reach the target at different contributions</div>
          <Bars
            data={result.scenarios.map((row) => ({ label: row.label.split(' ')[0], value: row.months > 600 ? 0 : row.months }))}
            format={(value) => (value ? String(value) : 'never')}
            suffix={result.scenarios[0] && result.scenarios[0].months > 600 ? '' : ' mo'}
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {result.contributionShare < 10
              ? 'Your contribution is under a tenth of your essentials, which is why the timeline is long. Raising it is the only lever that moves the date much.'
              : 'The timeline is dominated by the contribution, not the interest rate. At these balances the growth from interest is a rounding error next to what you add each month.'}
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The plan</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Essentials a month</span><span>{money(result.monthlyEssentials, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Cover now</span><span className="text-cyan-j">{result.coverMonths.toFixed(1)} months</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Target, {months} months</span><span className="text-cyan-j">{money(result.target, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Gap</span><span>{money(result.gap, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Monthly contribution</span><span>{money(result.monthly, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Months to target</span><span>{result.monthsToGoal > 600 ? 'unreachable' : result.monthsToGoal}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Reached around</span><span>{result.reachDate}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Interest earned</span><span>{money(Math.max(0, result.interestEarned), currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Bare-bones target</span><span>{money(result.bareTarget, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Largest category</span><span>{(result.largest.label || 'none') + ' · ' + money(result.largest.amount || 0, currency)}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Target" value={money(result.target, currency)} mono sub={months + ' months'} />
        <Stat label="Cover now" value={result.coverMonths.toFixed(1) + ' mo'} mono sub={money(result.current, currency)} />
        <Stat label="Months to goal" value={result.monthsToGoal > 600 ? 'never' : String(result.monthsToGoal)} mono sub={result.reachDate} />
        <Stat label="Bare-bones" value={money(result.bareTarget, currency)} mono sub="same months, tighter budget" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How much cover is enough</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Three months is the floor for a stable salaried job with another earner in the household and no dependants.</p>
            <p>· Six months is the sensible default for most people: one income, standard commitments, a job market that takes a few months to work through.</p>
            <p>· Nine to twelve months suits freelance and contract work, single-income households, commission-based pay or anyone whose skills take time to re-employ.</p>
            <p>· Add a separate sinking fund for known costs — car service, insurance renewal, holidays — so a large annual bill does not masquerade as an emergency.</p>
            <p>· The figure is not a judgement of your budgeting. It is simply the number that lets you turn down a bad job offer instead of accepting one.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Building and holding it</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Automate the transfer on payday. Money that is moved before you see it does not get spent, and consistency beats optimism.</p>
            <p>· Keep it in an instant-access savings account, not investments. The whole point is that it is available on the day the boiler fails.</p>
            <p>· Separate accounts prevent blurring. A fund sitting in your current account tends to quietly disappear into ordinary spending.</p>
            <p>· Refill it immediately after using it. The fund is not a bonus; it is insurance that has just paid out and now needs renewing.</p>
            <p>· Interest on a fund this size is small, and chasing a better rate should never cost you same-day access. Liquidity is the feature, not the yield.</p>
            <p>· {result.progress >= 100 ? 'You are at or above target, so the next decision is whether to hold it there or direct the surplus elsewhere.' : result.progress >= 50 ? 'You are over halfway, which is the point where the habit usually outlasts the motivation.' : 'At this stage the win is the standing order existing at all, not the amount.'}</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Target', value: money(result.target, currency) },
                { label: 'Cover', value: result.coverMonths.toFixed(1) + ' months' },
                { label: 'Contribution', value: money(result.monthly, currency) + ' / month' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>essentials = the sum of the categories above</p>
          <p>target = essentials × months of cover</p>
          <p>cover now = savings ÷ essentials</p>
          <p>balance each month = balance × (1 + rate ÷ 12) + contribution</p>
          <p className="text-cyan-j">Check: {money(result.monthlyEssentials, currency)} × {months} = {money(result.target, currency)}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The projection compounds monthly at the rate you enter, assumes the rate holds and that contributions never slip. In reality the date moves when life happens, which is
          exactly why the fund is worth having.
        </p>
      </Panel>
    </ToolShell>
  );
}