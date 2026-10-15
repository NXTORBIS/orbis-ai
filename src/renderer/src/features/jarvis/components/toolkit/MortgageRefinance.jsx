import { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const money = (value, currency) => currency + Math.round(value).toLocaleString();

const payment = (principal, annualRate, years) => {
  const months = Math.max(1, Math.round(years * 12));
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
};

const amortise = (principal, annualRate, years, extraPayment = 0) => {
  const months = Math.max(1, Math.round(years * 12));
  const monthlyRate = annualRate / 100 / 12;
  const monthly = payment(principal, annualRate, years) + extraPayment;
  let balance = principal;
  let interest = 0;
  let paidMonths = 0;
  while (balance > 0.5 && paidMonths < months * 2 + 24) {
    const due = balance * monthlyRate;
    const principalPart = monthly - due;
    if (principalPart <= 0) break;
    interest += due;
    balance -= principalPart;
    paidMonths += 1;
  }
  return { interest, paidMonths, monthly };
};

export default function MortgageRefinance() {
  const [balance, setBalance] = useState('320000');
  const [currentRate, setCurrentRate] = useState('6.4');
  const [remainingYears, setRemainingYears] = useState('24');
  const [newRate, setNewRate] = useState('5.1');
  const [newTerm, setNewTerm] = useState('25');
  const [closingCosts, setClosingCosts] = useState('4200');
  const [cashOut, setCashOut] = useState('0');
  const [currency, setCurrency] = useState('$');
  const [keepTerm, setKeepTerm] = useState(false);

  const result = useMemo(() => {
    const principal = Math.max(1000, Number(balance) || 320000);
    const rateNow = Math.max(0, Number(currentRate) || 0);
    const yearsNow = Math.max(1, Number(remainingYears) || 24);
    const rateNew = Math.max(0, Number(newRate) || 0);
    const yearsNew = keepTerm ? yearsNow : Math.max(1, Number(newTerm) || 25);
    const costs = Math.max(0, Number(closingCosts) || 0);
    const extra = Math.max(0, Number(cashOut) || 0);

    const currentMonthly = payment(principal, rateNow, yearsNow);
    const currentTotal = amortise(principal, rateNow, yearsNow);
    const newPrincipal = principal + extra + costs;
    const newMonthly = payment(newPrincipal, rateNew, yearsNew);
    const newTotal = amortise(newPrincipal, rateNew, yearsNew);

    const monthlySaving = currentMonthly - newMonthly;
    const interestSaved = currentTotal.interest - newTotal.interest;
    const closingAdded = costs + extra;
    const breakEvenMonths = monthlySaving > 0 ? closingAdded / monthlySaving : null;
    const lifetimeSaving = interestSaved - closingAdded;

    const projected = (startBalance, rate, years) => {
      const rows = [];
      let remaining = startBalance;
      const monthlyRate = rate / 100 / 12;
      const monthly = payment(startBalance, rate, years);
      for (let year = 1; year <= Math.ceil(years); year += 1) {
        for (let month = 0; month < 12; month += 1) {
          const due = remaining * monthlyRate;
          remaining = Math.max(0, remaining - (monthly - due));
        }
        rows.push({ year, balance: Math.max(0, remaining) });
      }
      return rows;
    };

    const currentBalances = projected(principal, rateNow, yearsNow);
    const newBalances = projected(newPrincipal, rateNew, yearsNew);
    const maxYear = Math.max(yearsNow, yearsNew);
    const step = Math.max(1, Math.round(maxYear / 6));
    const timeline = [];
    for (let year = step; year <= maxYear; year += step) {
      const oldRow = currentBalances.find((row) => row.year === year);
      const newRow = newBalances.find((row) => row.year === year);
      timeline.push({
        label: 'year ' + year,
        value: Number((oldRow ? oldRow.balance : 0).toFixed(0)),
        other: Number((newRow ? newRow.balance : 0).toFixed(0)),
      });
    }

    const warnings = [];
    if (monthlySaving <= 0) warnings.push('The new deal costs ' + money(Math.abs(monthlySaving), currency) + ' more every month. Only consider it for a shorter term or to release equity.');
    else if (breakEvenMonths !== null && breakEvenMonths > 36) warnings.push('Break-even takes ' + Math.round(breakEvenMonths) + ' months, which is over three years. If there is a real chance you move before then, the closing costs do not come back.');
    if (yearsNew > yearsNow + 0.5) warnings.push('Extending the term to ' + yearsNew + ' years lowers the payment but adds years of interest. The monthly saving is partly a longer loan rather than a better one.');
    if (yearsNew < yearsNow && monthlySaving > 0) warnings.push('A shorter term at a lower rate cuts the payment and the interest at the same time. That is the strongest version of a refinance.');
    if (costs > interestSaved) warnings.push('The closing costs of ' + money(costs, currency) + ' exceed the interest saved. The refinance does not pay for itself over the life of the loan.');
    if (!warnings.length) warnings.push('This looks favourable: ' + money(monthlySaving, currency) + ' a month better, breaking even in ' + Math.round(breakEvenMonths || 0) + ' months and ' + money(lifetimeSaving, currency) + ' better over the full term.');

    const report = [
      'Current: ' + money(principal, currency) + ' at ' + rateNow + '% over ' + yearsNow + ' years',
      'New: ' + money(newPrincipal, currency) + ' at ' + rateNew + '% over ' + yearsNew + ' years',
      '',
      'Monthly payment ' + money(currentMonthly, currency) + ' to ' + money(newMonthly, currency) + ' — ' + (monthlySaving >= 0 ? 'saving ' : 'costing ') + money(Math.abs(monthlySaving), currency) + ' a month',
      'Total interest ' + money(currentTotal.interest, currency) + ' to ' + money(newTotal.interest, currency),
      'Interest saved ' + money(interestSaved, currency) + ' · costs and cash released ' + money(closingAdded, currency),
      'Net saving over the full term ' + money(lifetimeSaving, currency),
      breakEvenMonths !== null ? 'Break-even on the costs: ' + Math.round(breakEvenMonths) + ' months' : 'Break-even: never, because the payment does not fall',
      'Rate reduction ' + (rateNow - rateNew).toFixed(2) + ' percentage points',
      '',
      ...warnings,
    ].join('\n');

    return {
      principal, rateNow, yearsNow, rateNew, yearsNew, costs, extra, currentMonthly, newMonthly, currentTotal, newTotal,
      monthlySaving, interestSaved, closingAdded, breakEvenMonths, lifetimeSaving, timeline, warnings, report,
      chart: timeline,
    };
  }, [balance, currentRate, remainingYears, newRate, newTerm, closingCosts, cashOut, keepTerm]);

  return (
    <ToolShell
      toolId="mortgage-refinance"
      icon={Landmark}
      title="Mortgage Refinance Planner"
      desc="Current loan against a new one: monthly payment, total interest, the month the closing costs are recovered, and whether a lower rate is worth restarting the clock for."
      state={{ balance, currentRate, remainingYears, newRate, newTerm, closingCosts, cashOut, currency, keepTerm }}
      onRestore={(restored) => {
        if (restored.balance !== undefined) setBalance(String(restored.balance));
        if (restored.currentRate !== undefined) setCurrentRate(String(restored.currentRate));
        if (restored.remainingYears !== undefined) setRemainingYears(String(restored.remainingYears));
        if (restored.newRate !== undefined) setNewRate(String(restored.newRate));
        if (restored.newTerm !== undefined) setNewTerm(String(restored.newTerm));
        if (restored.closingCosts !== undefined) setClosingCosts(String(restored.closingCosts));
        if (restored.cashOut !== undefined) setCashOut(String(restored.cashOut));
        if (typeof restored.currency === 'string') setCurrency(restored.currency);
        if (typeof restored.keepTerm === 'boolean') setKeepTerm(restored.keepTerm);
      }}
      exportText={result.report}
      exportName="refinance-comparison.txt"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Current balance"><input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Current rate, %"><input value={currentRate} onChange={(e) => setCurrentRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Years remaining"><input value={remainingYears} onChange={(e) => setRemainingYears(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="New rate, %"><input value={newRate} onChange={(e) => setNewRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'New term, years' + (keepTerm ? ' (locked to the current term)' : '')}>
          <input value={keepTerm ? String(result.yearsNow) : newTerm} onChange={(e) => setNewTerm(e.target.value)} disabled={keepTerm} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm disabled:opacity-60" />
        </Field>
        <Field label="Closing costs"><input value={closingCosts} onChange={(e) => setClosingCosts(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Cash released in the refinance"><input value={cashOut} onChange={(e) => setCashOut(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <div className="flex items-end">
          <ToggleRow label="Keep the same remaining term" checked={keepTerm} onChange={setKeepTerm} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.monthlySaving > 0 ? 'emerald' : 'rose'}
          label="Monthly payment change"
          value={money(Math.abs(result.monthlySaving), currency)}
          sub={(result.monthlySaving >= 0 ? 'Lower each month, from ' : 'Higher each month, from ') + money(result.currentMonthly, currency) + ' to ' + money(result.newMonthly, currency) + '. Over the full term you would pay ' + money(result.currentTotal.interest, currency) + ' of interest now against ' + money(result.newTotal.interest, currency) + ' on the new loan, so the interest difference is ' + money(Math.abs(result.interestSaved), currency) + (result.interestSaved >= 0 ? ' in your favour.' : ' against you.')}
        />
        <Ring
          value={result.breakEvenMonths === null ? 0 : Math.min(result.breakEvenMonths, 120)}
          max={120}
          tone={result.breakEvenMonths === null ? 'rose' : result.breakEvenMonths <= 24 ? 'emerald' : result.breakEvenMonths <= 48 ? 'amber' : 'rose'}
          label="Break-even on costs"
          sub={result.breakEvenMonths === null ? 'Never — the payment does not fall, so the costs are never recovered' : Math.round(result.breakEvenMonths) + ' months to recover ' + money(result.closingAdded, currency) + ' of closing costs and cash released'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Balance remaining year by year</div>
          <Bars data={result.chart} format={(value) => money(value, currency)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Bars show the loan you have now. A refinance that lowers the payment while leaving a higher balance late in the term is the classic trap: cheaper monthly, more total.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The comparison</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Current payment</span><span>{money(result.currentMonthly, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>New payment</span><span className="text-cyan-j">{money(result.newMonthly, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Current total interest</span><span>{money(result.currentTotal.interest, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">New total interest</span><span>{money(result.newTotal.interest, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Interest saved</span><span>{money(result.interestSaved, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Costs plus cash released</span><span>{money(result.closingAdded, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Net over the full term</span><span className="text-cyan-j">{money(result.lifetimeSaving, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Rate reduction</span><span>{(result.rateNow - result.rateNew).toFixed(2)} points</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Term</span><span>{result.yearsNow} to {result.yearsNew} years</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">New balance borrowed</span><span>{money(result.principal + result.closingAdded, currency)}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Monthly" value={money(result.newMonthly, currency)} mono sub={(result.monthlySaving >= 0 ? 'saves ' : 'costs ') + money(Math.abs(result.monthlySaving), currency)} />
        <Stat label="Break-even" value={result.breakEvenMonths === null ? 'never' : Math.round(result.breakEvenMonths) + ' months'} mono sub="on costs and cash released" />
        <Stat label="Interest saved" value={money(result.interestSaved, currency)} mono sub="across the full term" />
        <Stat label="Net saving" value={money(result.lifetimeSaving, currency)} mono sub="after all costs" />
      </div>

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          <p>· Closing costs are added to the new balance, which is how most refinances are handled. Paying them in cash shortens the break-even but does not remove it.</p>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">When a refinance is worth doing</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A rate cut of at least one percentage point is the traditional rule of thumb, but your own numbers matter more — costs and the remaining term decide it.</p>
            <p>· Break-even shorter than the time you realistically expect to stay is the real test. Three years to break even does not work if you might move in two.</p>
            <p>· Keep the term if you can. Restarting a long clock a decade in is where most of the money quietly goes.</p>
            <p>· Dropping mortgage insurance is often the largest single saving available and is worth checking even when the rate barely moves.</p>
            <p>· Compare total interest, not the payment. The payment is the visible number and the least informative one.</p>
            <p>· A shorter term at a lower rate is the ideal case: the payment and the interest both fall. If only the payment falls, ask what you are paying for.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Costs people forget</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Valuation, arrangement or origination fees, legal work, title search and registration all land in the closing costs figure.</p>
            <p>· Exit penalties or early repayment charges on a fixed rate can exceed the entire benefit of a small rate reduction.</p>
            <p>· Released equity is not free money. Cash taken now is added to the balance at {result.rateNew}% and paid until the loan ends.</p>
            <p>· Extending the term can push the final payment past retirement age, and some lenders will refuse it outright.</p>
            <p>· Your current lender may offer a product switch with no legal work at all. Always ask before switching away — it takes one phone call.</p>
            <p>· Fixed rates end. Price the deal at the rate after the fix expires, not at the introductory headline.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Rate', value: result.rateNow + '% to ' + result.rateNew + '%' },
                { label: 'Monthly', value: money(result.monthlySaving, currency) },
                { label: 'Break-even', value: result.breakEvenMonths === null ? 'never' : Math.round(result.breakEvenMonths) + ' mo' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>payment = P × i ÷ (1 − (1 + i)^−n), with i the monthly rate and n the number of months</p>
          <p>interest is accumulated month by month, so term changes and extra payments both show up correctly</p>
          <p>new balance = current balance + cash released + closing costs</p>
          <p>break-even in months = costs and cash released ÷ monthly saving</p>
          <p>net saving = interest saved − costs and cash released</p>
          <p className="text-cyan-j">Check: {money(result.principal, currency)} at {result.rateNow}% over {result.yearsNow} years gives {money(result.currentMonthly, currency)} a month.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A fixed-rate amortisation model with no taxes, insurance, escrow or lender-specific fees. Lenders round slightly differently on the final payment, and rates move with the
          market, so use this as a comparison rather than as a quotation.
        </p>
      </Panel>
    </ToolShell>
  );
}