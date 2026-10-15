import { useMemo, useState } from 'react';
import { PiggyBank } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const money = (value) => Math.round(Number(value) || 0).toLocaleString();

export default function Retirement() {
  const [age, setAge] = useState('32');
  const [retireAge, setRetireAge] = useState('65');
  const [savings, setSavings] = useState('48000');
  const [monthly, setMonthly] = useState('650');
  const [returnRate, setReturnRate] = useState('7');
  const [inflation, setInflation] = useState('2.5');
  const [income, setIncome] = useState('3000');
  const [pension, setPension] = useState('900');
  const [lifeExpectancy, setLifeExpectancy] = useState('88');
  const [currency, setCurrency] = useState('$');

  const result = useMemo(() => {
    const startAge = Number(age) || 0;
    const endWorkAge = Number(retireAge) || 0;
    const yearsToGrow = Math.max(0, endWorkAge - startAge);
    const yearsInRetirement = Math.max(1, (Number(lifeExpectancy) || 0) - endWorkAge);
    const nominal = (Number(returnRate) || 0) / 100;
    const inflationRate = (Number(inflation) || 0) / 100;
    const realReturn = (1 + nominal) / (1 + inflationRate) - 1;
    const monthlyRate = nominal / 12;

    let corpus = Number(savings) || 0;
    const growth = [];
    for (let year = 0; year <= yearsToGrow; year += 1) {
      growth.push({ label: year % 5 === 0 ? `${startAge + year}` : '', value: corpus });
      for (let month = 0; month < 12 && year < yearsToGrow; month += 1) {
        corpus = corpus * (1 + monthlyRate) + (Number(monthly) || 0);
      }
    }

    const desiredIncome = Number(income) || 0;
    const otherIncome = Number(pension) || 0;
    const gap = Math.max(0, desiredIncome - otherIncome);
    const realMonthly = realReturn / 12;
    const months = yearsInRetirement * 12;
    const required = realMonthly > 0
      ? gap * ((1 - (1 + realMonthly) ** -months) / realMonthly)
      : gap * months;
    const extraNeeded = Math.max(0, required - corpus);
    const extraPerMonth = extraNeeded > 0 && monthlyRate > 0 && yearsToGrow > 0
      ? extraNeeded / ((((1 + monthlyRate) ** (yearsToGrow * 12)) - 1) / monthlyRate)
      : extraNeeded / Math.max(1, yearsToGrow * 12);
    return {
      yearsToGrow,
      yearsInRetirement,
      realReturn,
      corpus,
      required,
      gap,
      desiredIncome,
      otherIncome,
      surplus: corpus - required,
      extraPerMonth,
      funded: required ? Math.min(200, (corpus / required) * 100) : 100,
      growth,
      fourPercent: (corpus * 0.04) / 12,
    };
  }, [age, retireAge, savings, monthly, returnRate, inflation, income, pension, lifeExpectancy]);

  const onTrack = result.surplus >= 0;

  const report = [
    `Retiring at ${retireAge}, planning to live to ${lifeExpectancy} (${result.yearsToGrow} years of saving, ${result.yearsInRetirement} years of retirement)`,
    `Real return after ${inflation}% inflation: ${(result.realReturn * 100).toFixed(2)}%`,
    `Income wanted ${money(result.desiredIncome)} a month; ${money(result.otherIncome)} comes from elsewhere, leaving a gap of ${money(result.gap)}`,
    `Corpus needed: ${money(result.required)} · projected: ${money(result.corpus)}`,
    onTrack ? `On track with ${money(result.surplus)} to spare` : `Shortfall ${money(-result.surplus)} — about ${money(result.extraPerMonth)} extra needed each month`,
    `The 4% rule would allow ${money(result.fourPercent)} a month from the projected pot`,
  ].join('\n');

  return (
    <ToolShell
      toolId="retirement"
      icon={PiggyBank}
      title="Retirement Planner"
      desc="Work out the pot you actually need, whether your current saving rate gets there, and the extra a month that closes any gap."
      state={{ age, retireAge, savings, monthly, returnRate, inflation, income, pension, lifeExpectancy, currency }}
      onRestore={(restored) => {
        if (restored.age !== undefined) setAge(String(restored.age));
        if (restored.retireAge !== undefined) setRetireAge(String(restored.retireAge));
        if (restored.savings !== undefined) setSavings(String(restored.savings));
        if (restored.monthly !== undefined) setMonthly(String(restored.monthly));
        if (restored.returnRate !== undefined) setReturnRate(String(restored.returnRate));
        if (restored.inflation !== undefined) setInflation(String(restored.inflation));
        if (restored.income !== undefined) setIncome(String(restored.income));
        if (restored.pension !== undefined) setPension(String(restored.pension));
        if (restored.lifeExpectancy !== undefined) setLifeExpectancy(String(restored.lifeExpectancy));
        if (restored.currency) setCurrency(restored.currency);
      }}
      exportText={report}
      exportName="retirement-plan.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={currency} onChange={setCurrency} options={[{ value: '$', label: '$' }, { value: '€', label: '€' }, { value: '£', label: '£' }, { value: '₹', label: '₹' }]} />
        <CopyBtn value={report} label="Copy plan" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Age now">
          <input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Age you stop working">
          <input value={retireAge} onChange={(e) => setRetireAge(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Plan for living until">
          <input value={lifeExpectancy} onChange={(e) => setLifeExpectancy(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Saved so far">
          <input value={savings} onChange={(e) => setSavings(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Saved each month">
          <input value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Expected return % a year">
          <input value={returnRate} onChange={(e) => setReturnRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Inflation % a year">
          <input value={inflation} onChange={(e) => setInflation(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Monthly income you want">
          <input value={income} onChange={(e) => setIncome(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Other income (pension, rent)">
          <input value={pension} onChange={(e) => setPension(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          tone={onTrack ? 'emerald' : 'amber'}
          label={onTrack ? 'On track' : 'Extra needed each month'}
          value={onTrack ? `${currency}${money(result.surplus)}` : `${currency}${money(result.extraPerMonth)}`}
          sub={onTrack ? `more than you need by age ${retireAge}` : `to close a ${currency}${money(-result.surplus)} gap by age ${retireAge}`}
        />
        <Ring
          value={Math.min(200, result.funded)}
          max={200}
          tone={result.funded >= 100 ? 'emerald' : result.funded >= 70 ? 'amber' : 'rose'}
          label="Projected pot against what is needed"
          unit={`${currency}${money(result.corpus)} projected`}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Projected pot" value={`${currency}${money(result.corpus)}`} mono />
        <Stat label="Pot needed" value={`${currency}${money(result.required)}`} mono />
        <Stat label="Real return" value={`${(result.realReturn * 100).toFixed(1)}%`} mono sub="after inflation" />
        <Stat label="Years to cover" value={String(result.yearsInRetirement)} mono />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Pot growing to retirement</div>
          <Bars data={result.growth} format={(value) => money(value)} />
          <p className="mt-2 text-[11px] text-muted-foreground">Each bar is the balance at that age — the curve steepens because returns start earning returns.</p>
        </Panel>
        <div className="space-y-3">
          <Gauge
            value={Math.min(150, Math.round(result.funded))}
            min={0}
            max={150}
            unit="%"
            label="How funded you are"
            bands={[
              { label: 'Behind plan', min: 0, max: 70, stroke: 'hsl(350 89% 60%)' },
              { label: 'Close', min: 70, max: 100, stroke: 'hsl(38 92% 55%)' },
              { label: 'On track', min: 100, max: 150, stroke: 'hsl(160 84% 52%)' },
            ]}
          />
          <Panel className="!p-3">
            <Pills
              items={[
                { label: '4% rule allows', value: `${currency}${money(result.fourPercent)}/mo` },
                { label: 'Income gap to fill', value: `${currency}${money(result.gap)}/mo`, tone: result.gap > 0 ? 'amber' : undefined },
                { label: 'Saving years', value: result.yearsToGrow },
              ]}
            />
          </Panel>
        </div>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What moves the needle most</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Save 100 more a month from today and, compounding at {returnRate}%, it becomes roughly {currency}{money(100 * result.yearsToGrow * 12 * (1 + (Number(returnRate) || 0) / 200))} by retirement.</p>
          <p>· One extra year of work both adds contributions and shortens the years the pot has to cover — usually the single biggest lever.</p>
          <p>· Fees matter more than most people think: paying 1% instead of 0.2% can quietly consume a fifth of a long-term pot.</p>
          <p>· {result.desiredIncome > result.otherIncome ? `Your own savings need to supply ${currency}${money(result.gap)} a month, on top of ${currency}${money(result.otherIncome)} from elsewhere.` : 'Other income already covers the target, so the pot is a cushion rather than the engine.'}</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Everything here is shown in today's money — the return is reduced by inflation first, so the figures stay comparable to the bills you pay now.
          That is why a 7% return with 2.5% inflation behaves like 4.4% real growth. It is a planning estimate, not a promise: markets do not deliver a
          smooth average, which is why the last few years before retiring usually deserve a steadier mix.
        </p>
      </Panel>
    </ToolShell>
  );
}