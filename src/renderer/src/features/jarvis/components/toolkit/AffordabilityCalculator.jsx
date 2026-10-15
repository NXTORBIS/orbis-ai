import { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const money = (value) => Math.round(value).toLocaleString();

const PROFILES = [
  { id: 'conservative', label: 'Conservative · 28/36', front: 28, back: 36, note: 'The traditional guideline, and what most lenders in the US used before automated underwriting.' },
  { id: 'standard', label: 'Standard · 35/43', front: 35, back: 43, note: 'A common modern limit once other debts are counted.' },
  { id: 'stretched', label: 'Stretched · 38/50', front: 38, back: 50, note: 'What some lenders will approve with strong credit and a large deposit.' },
];

export default function AffordabilityCalculator() {
  const [income, setIncome] = useState('82000');
  const [otherIncome, setOtherIncome] = useState('0');
  const [debts, setDebts] = useState('450');
  const [deposit, setDeposit] = useState('40000');
  const [rate, setRate] = useState('6');
  const [years, setYears] = useState('30');
  const [profile, setProfile] = useState('standard');
  const [costs, setCosts] = useState({ tax: '1.1', insurance: '1200', maintenance: '0.6', closing: '3' });

  const setCost = (key, value) => setCosts((current) => ({ ...current, [key]: value }));

  const result = useMemo(() => {
    const chosen = PROFILES.find((entry) => entry.id === profile) || PROFILES[1];
    const annualIncome = (Number(income) || 0) + (Number(otherIncome) || 0);
    const monthlyIncome = annualIncome / 12;
    const otherDebts = Number(debts) || 0;
    const depositAmount = Number(deposit) || 0;
    const interest = Math.max(0.01, Number(rate) || 0) / 100 / 12;
    const months = Math.max(1, (Number(years) || 30) * 12);

    const paymentFor = (loan, monthlyRate, count) => {
      if (loan <= 0) return 0;
      return (loan * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -count));
    };

    const maxByFront = monthlyIncome * (chosen.front / 100);
    const maxByBack = monthlyIncome * (chosen.back / 100) - otherDebts;
    const housingBudget = Math.max(0, Math.min(maxByFront, maxByBack));

    const taxRate = (Number(costs.tax) || 0) / 100 / 12;
    const insurance = (Number(costs.insurance) || 0) / 12;
    const maintenanceRate = (Number(costs.maintenance) || 0) / 100 / 12;

    // Solve for price where total cost equals the housing budget, including tax and upkeep which scale with price.
    const fixedShare = taxRate + maintenanceRate;
    const paymentFromPrice = (price) => paymentFor(Math.max(0, price - depositAmount), interest, months) + price * fixedShare + insurance;
    let low = 0;
    let high = 20000000;
    for (let step = 0; step < 60; step += 1) {
      const middle = (low + high) / 2;
      if (paymentFromPrice(middle) > housingBudget) high = middle;
      else low = middle;
    }
    const maxPrice = Math.max(0, low);
    const loan = Math.max(0, maxPrice - depositAmount);
    const principalInterest = paymentFor(loan, interest, months);
    const tax = maxPrice * taxRate;
    const maintenance = maxPrice * maintenanceRate;
    const totalMonthly = principalInterest + tax + insurance + maintenance;

    const stressRate = (Math.max(0.01, Number(rate) || 0) + 2) / 100 / 12;
    const stressPayment = paymentFor(loan, stressRate, months);
    const stressTotal = stressPayment + tax + insurance + maintenance;
    const stressGap = stressTotal - totalMonthly;

    const stressMax = (() => {
      const budget = housingBudget;
      let lowBound = 0;
      let highBound = 20000000;
      for (let step = 0; step < 60; step += 1) {
        const middle = (lowBound + highBound) / 2;
        const payment = paymentFor(Math.max(0, middle - depositAmount), stressRate, months) + middle * fixedShare + insurance;
        if (payment > budget) highBound = middle;
        else lowBound = middle;
      }
      return Math.max(0, lowBound);
    })();

    const closingCosts = maxPrice * ((Number(costs.closing) || 0) / 100);
    const depositShare = maxPrice ? (depositAmount / maxPrice) * 100 : 0;

    const budgetSplit = [
      { label: 'Principal and interest', value: Number(principalInterest.toFixed(0)) },
      { label: 'Tax', value: Number(tax.toFixed(0)) },
      { label: 'Insurance', value: Number(insurance.toFixed(0)) },
      { label: 'Upkeep', value: Number(maintenance.toFixed(0)) },
      { label: 'Other debts', value: Number(otherDebts) },
    ];

    const remaining = monthlyIncome - totalMonthly - otherDebts;

    return {
      chosen, annualIncome, monthlyIncome, otherDebts, depositAmount, housingBudget, maxByFront, maxByBack, maxPrice, loan,
      principalInterest, tax, insurance, maintenance, totalMonthly, stressPayment, stressTotal, stressGap, stressMax,
      closingCosts, depositShare, budgetSplit, remaining, months, interest,
      dtiTotal: monthlyIncome ? ((totalMonthly + otherDebts) / monthlyIncome) * 100 : 0,
      frontRatio: monthlyIncome ? (totalMonthly / monthlyIncome) * 100 : 0,
      ltv: maxPrice ? (loan / maxPrice) * 100 : 0,
      limit: Math.min(maxByFront, maxByBack) === maxByBack ? 'total debt' : 'housing cost',
    };
  }, [income, otherIncome, debts, deposit, rate, years, profile, costs]);

  const report = useMemo(() => [
    'Income ' + money(result.annualIncome) + ' a year, about ' + money(result.monthlyIncome) + ' a month',
    'Housing budget ' + money(result.housingBudget) + ' a month, limited by ' + result.limit,
    '',
    'Maximum price: ' + money(result.maxPrice),
    'Loan: ' + money(result.loan) + ' · deposit ' + money(result.depositAmount) + ' (' + result.depositShare.toFixed(0) + '% of the price)',
    'Monthly: principal and interest ' + money(result.principalInterest) + ', tax ' + money(result.tax) + ', insurance ' + money(result.insurance) + ', upkeep ' + money(result.maintenance),
    'Total monthly housing cost: ' + money(result.totalMonthly),
    '',
    'Stress test at ' + (Number(rate) + 2).toFixed(1) + '%: ' + money(result.stressTotal) + ' a month, ' + money(result.stressGap) + ' more',
    'Price that stays affordable at that rate: ' + money(result.stressMax),
    'Closing costs at ' + costs.closing + '%: about ' + money(result.closingCosts),
    '',
    'Debt to income including the new loan: ' + result.dtiTotal.toFixed(1) + '%',
    'Left each month after housing and debts: ' + money(result.remaining),
  ].join('\n'), [result, rate, costs]);

  return (
    <ToolShell
      toolId="affordability"
      icon={Landmark}
      title="Home Affordability Calculator"
      desc="Income, debts and deposit into the price you can actually carry — with the debt-to-income caps, tax, insurance and upkeep in the monthly figure, and a stress test at higher rates."
      state={{ income, otherIncome, debts, deposit, rate, years, profile, costs }}
      onRestore={(restored) => {
        if (restored.income !== undefined) setIncome(String(restored.income));
        if (restored.otherIncome !== undefined) setOtherIncome(String(restored.otherIncome));
        if (restored.debts !== undefined) setDebts(String(restored.debts));
        if (restored.deposit !== undefined) setDeposit(String(restored.deposit));
        if (restored.rate !== undefined) setRate(String(restored.rate));
        if (restored.years !== undefined) setYears(String(restored.years));
        if (restored.profile) setProfile(restored.profile);
        if (restored.costs) setCosts((current) => ({ ...current, ...restored.costs }));
      }}
      exportText={report}
      exportName="affordability.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Gross income a year"><input value={income} onChange={(e) => setIncome(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Other income a year"><input value={otherIncome} onChange={(e) => setOtherIncome(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Other monthly debt payments"><input value={debts} onChange={(e) => setDebts(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Deposit"><input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Interest rate, %"><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Term, years"><input value={years} onChange={(e) => setYears(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Property tax, % a year"><input value={costs.tax} onChange={(e) => setCost('tax', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Insurance a year"><input value={costs.insurance} onChange={(e) => setCost('insurance', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Upkeep, % of value a year"><input value={costs.maintenance} onChange={(e) => setCost('maintenance', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Closing costs, % of price"><input value={costs.closing} onChange={(e) => setCost('closing', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <Seg value={profile} onChange={setProfile} options={PROFILES.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <p className="text-[11px] text-muted-foreground">{result.chosen.note}</p>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Maximum purchase price"
          value={money(result.maxPrice)}
          sub={'With ' + money(result.depositAmount) + ' down, that is a loan of ' + money(result.loan) + ' and a monthly housing cost of ' + money(result.totalMonthly) + '. The ceiling here is your ' + result.limit + ' limit, not the loan itself.'}
        />
        <Ring
          value={result.dtiTotal}
          max={60}
          tone={result.dtiTotal > result.chosen.back ? 'rose' : 'emerald'}
          label="Debt to income including the new loan"
          sub={result.dtiTotal.toFixed(1) + '% against a ' + result.chosen.back + '% ceiling, with housing at ' + result.frontRatio.toFixed(1) + '%'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where each month goes</div>
          <Bars data={result.budgetSplit} format={(value) => money(value)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The housing figure is not just the mortgage. Tax, insurance and upkeep together add {money(result.tax + result.insurance + result.maintenance)} a month here, and
            they never get paid off — which is why lenders count them in the ratio.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Monthly breakdown</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Monthly income</span><span>{money(result.monthlyIncome)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Housing budget</span><span className="text-cyan-j">{money(result.housingBudget)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Principal and interest</span><span>{money(result.principalInterest)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Property tax</span><span>{money(result.tax)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Insurance</span><span>{money(result.insurance)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Upkeep</span><span>{money(result.maintenance)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Total housing</span><span className="text-cyan-j">{money(result.totalMonthly)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Other debts</span><span>{money(result.otherDebts)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Loan to value</span><span>{result.ltv.toFixed(0)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Closing costs</span><span>{money(result.closingCosts)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Left each month</span><span>{money(result.remaining)}</span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Stress test at {(Number(rate) + 2).toFixed(1)}%</div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Payment then" value={money(result.stressTotal)} mono sub={money(result.stressGap) + ' more'} />
          <Stat label="Affordable price then" value={money(result.stressMax)} mono sub={money(result.maxPrice - result.stressMax) + ' less'} />
          <Stat label="Housing share then" value={result.monthlyIncome ? ((result.stressTotal / result.monthlyIncome) * 100).toFixed(0) + '%' : '—'} mono sub={'of ' + money(result.monthlyIncome)} />
          <Stat label="Front limit" value={result.chosen.front + '%'} mono sub="of gross income" />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          A two point rise on a loan this size adds {money(result.stressGap)} a month, and that is on an unchanged balance. Rates move before your income does, so the price that
          survives the stress test is the one worth borrowing against.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Max price" value={money(result.maxPrice)} mono sub={result.depositShare.toFixed(0) + '% deposit'} />
        <Stat label="Loan" value={money(result.loan)} mono sub={result.ltv.toFixed(0) + '% loan to value'} />
        <Stat label="Monthly housing" value={money(result.totalMonthly)} mono sub={result.dtiTotal.toFixed(0) + '% DTI'} />
        <Stat label="Left each month" value={money(result.remaining)} mono sub="after housing and debts" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What lenders actually look at</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The back-end ratio counts every recurring debt: cards, car loans, student loans and child support. Your housing budget here is limited by {result.limit}.</p>
            <p>· A bigger deposit lowers the risk and usually the rate, which raises the price you can afford more than the extra cash alone suggests.</p>
            <p>· Credit history affects the approved rate more than the approved amount. Two points of rate is worth far more over the term than a slightly larger loan.</p>
            <p>· Lenders will often approve more than is comfortable. The maximum is the limit of what they will lend, not a recommendation to borrow it.</p>
            <p>· Income that is variable, self-employed or bonus-based is usually averaged over two years and sometimes discounted, so the figure they use can be lower than yours.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Costs the calculator does not hide</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Closing costs at {costs.closing}% come to about {money(result.closingCosts)} on top of the deposit, payable at completion and not financed by most loans.</p>
            <p>· Moving, furnishing, and the first round of repairs rarely cost less than a few percent of the price, and they land in the same month.</p>
            <p>· Upkeep at {costs.maintenance}% of value a year is the average across roofs, boilers, appliances and decoration. Older properties cost more, and it arrives in lumps rather than in even instalments.</p>
            <p>· Leasehold charges, service charges and ground rent sit outside tax and insurance, and they rise over time independently of your loan.</p>
            <p>· Insurance and tax usually rise faster than inflation. Treating them as fixed for thirty years is the quiet error in most household budgets.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Max price', value: money(result.maxPrice) },
                { label: 'Monthly', value: money(result.totalMonthly) },
                { label: 'Limit', value: result.limit },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sensible ways to use the maximum</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Treat the figure as a ceiling for the search rather than a budget to spend up to, and look first below it.</p>
            <p>· Keep the emergency fund intact after the deposit. A house with no cash buffer turns a broken boiler into a credit card balance.</p>
            <p>· Test the payment against your bank statement for three months before committing. The ratio is theory; the cash flow is not.</p>
            <p>· Factor in the commute and any change to it. A cheaper house further out can cost more per month in transport than the loan saves.</p>
            <p>· If the payment only works with a bonus or overtime, it does not work. Lenders will exclude that income for exactly this reason.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The equations in use</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>housing budget = min(income × front%, income × back% − other debts)</p>
            <p>payment = P × r ÷ (1 − (1 + r)⁻ⁿ) with r the monthly rate</p>
            <p>price solved numerically so that payment + tax + insurance + upkeep = housing budget</p>
            <p>stress: the same solve again at rate + 2%</p>
            <p className="text-cyan-j">Here the budget of {money(result.housingBudget)} supports a loan of {money(result.loan)} at {rate}% over {years} years.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A planning estimate, not a lending decision. Real underwriting uses your credit file, verified income, the property valuation and rules that differ by country, so an
          approved amount can land either side of this figure. The stress test is the number worth designing your search around.
        </p>
      </Panel>
    </ToolShell>
  );
}