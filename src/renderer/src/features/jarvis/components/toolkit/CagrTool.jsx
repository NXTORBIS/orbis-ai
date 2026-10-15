import { useMemo, useState } from 'react';
import { ChartColumn } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Spark } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const FREQUENCIES = [
  { id: 'monthly', label: 'Monthly', perYear: 12 },
  { id: 'quarterly', label: 'Quarterly', perYear: 4 },
  { id: 'annual', label: 'Annual', perYear: 1 },
];

export default function CagrTool() {
  const [start, setStart] = useState('10000');
  const [end, setEnd] = useState('24800');
  const [years, setYears] = useState('8');
  const [contribution, setContribution] = useState('0');
  const [frequency, setFrequency] = useState('monthly');
  const [target, setTarget] = useState('50000');
  const [inflationInput, setInflation] = useState('2.5');
  const [volatility, setVolatility] = useState('16');
  const [extra, setExtra] = useState({ real: true, compare: true, rolling: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const s = Math.max(0.01, Number(start) || 1);
    const e = Math.max(0, Number(end) || 0);
    const yrs = Math.max(0.05, Number(years) || 1);
    const contrib = Math.max(0, Number(contribution) || 0);
    const freq = (FREQUENCIES.find((entry) => entry.id === frequency) || FREQUENCIES[0]).perYear;
    const inflation = Math.max(0, Number(inflationInput) || 0) / 100;
    const vol = Math.max(0, Number(volatility) || 0) / 100;
    const goal = Math.max(0, Number(target) || 0);

    const invested = s + contrib * freq * yrs;
    const profit = e - invested;
    const yearsEffective = yrs;
    // CAGR of the price series on the starting value alone.
    const cagr = (Math.pow(e / s, 1 / yearsEffective) - 1) * 100;
    // Money weighted return, solved by bisection over an IRR of the contribution schedule.
    const cashflows = [];
    for (let i = 0; i < Math.round(freq * yrs); i += 1) {
      cashflows.push({ time: (i + 1) / freq, amount: -contrib });
    }
    cashflows.push({ time: yrs, amount: e });

    let lo = -0.95;
    let hi = 3;
    let irr = 0;
    for (let i = 0; i < 100; i += 1) {
      const mid = (lo + hi) / 2;
      let npv = 0;
      cashflows.forEach((flow) => { npv += flow.amount / Math.pow(1 + mid, flow.time); });
      if (npv > 0) lo = mid; else hi = mid;
      irr = mid;
    }
    const irrPercent = irr * 100;

    const absoluteReturn = ((e - s) / s) * 100;
    const doublingExact = Math.log(2) / Math.log(1 + cagr / 100);
    const doubling72 = 72 / (cagr || 0.0001);
    const realCagr = ((1 + cagr / 100) / (1 + inflation) - 1) * 100;
    const realEnd = e / Math.pow(1 + inflation, yrs);

    // Growth path using the actual CAGR, plus a straight-line comparison.
    const path = [];
    const steps = Math.min(30, Math.max(6, Math.round(yrs)));
    for (let i = 0; i <= steps; i += 1) {
      const t = (yrs * i) / steps;
      path.push({ label: t.toFixed(1) + 'y', value: Number((s * Math.pow(1 + cagr / 100, t)).toFixed(0)) });
    }
    const straight = path.map((point, index) => ({ label: point.label, value: Number((s + ((e - s) * index) / steps).toFixed(0)) }));

    // Monte Carlo-free estimate: annualised standard deviation of the return.
    const annualVol = vol * 100;
    const bestCase = s * Math.pow(1 + cagr / 100 + vol, yrs);
    const worstCase = s * Math.pow(1 - Math.max(0.001, cagr / 100 - vol), yrs);
    const oneSigma = (cagr / 100) * Math.sqrt(yrs) * vol * 100;

    // What rate is needed to hit the target from here.
    const neededRate = goal > 0 ? ((Math.pow(goal / s, 1 / yrs) - 1) * 100) : 0;
    const neededWithContrib = (() => {
      if (goal <= 0) return 0;
      let lo2 = 0;
      let hi2 = 2;
      for (let i = 0; i < 80; i += 1) {
        const mid = (lo2 + hi2) / 2;
        let value = s * Math.pow(1 + mid, yrs);
        for (let p = 0; p < Math.round(freq * yrs); p += 1) {
          value += contrib * Math.pow(1 + mid, yrs - (p + 1) / freq);
        }
        if (value > goal) hi2 = mid; else lo2 = mid;
      }
      return ((lo2 + hi2) / 2) * 100;
    })();
    const shortfall = goal > 0 ? Math.max(0, goal - (s * Math.pow(1 + cagr / 100, yrs) + contrib * freq * yrs)) : 0;
    const extraPerPeriod = shortfall > 0 && freq > 0 ? shortfall / (freq * yrs) : 0;

    const rateTable = [4, 6, 8, 10, 12].map((rate) => ({
      label: rate + '%',
      value: Number((s * Math.pow(1 + rate / 100, yrs)).toFixed(0)),
    }));

    const warnings = [];
    if (Math.abs(cagr - irrPercent) > 3 && contrib > 0) warnings.push('The simple CAGR (' + cagr.toFixed(2) + '%) and the money-weighted return (' + irrPercent.toFixed(2) + '%) differ because contributions changed the timing of the money. For a portfolio with regular deposits, the money-weighted figure is the honest one.');
    if (realCagr < 0) warnings.push('After inflation the real return is negative. The account balance rose, but it buys less than it did.');
    if (vol > 0.25) warnings.push('Annualised volatility of ' + annualVol.toFixed(0) + '% means a single bad year can be larger than the whole average gain. Expect drawdowns of that size, not just the smooth curve.');
    if (cagr > 25) warnings.push('A sustained return above 25% is extraordinary. Check whether the period is short, whether the start value was unusually low, or whether a one-off event is doing the work.');
    if (yrs < 2) warnings.push('Under two years, CAGR is dominated by noise. Annualising a short period exaggerates whatever happened.');
    if (contrib > 0 && contribution && Number(contribution) * freq > s) warnings.push('Contributions now dwarf the starting lump sum, so the headline growth rate describes your deposits more than the market.');

    const report = [
      'GROWTH AND CAGR ANALYSIS',
      'From ' + s.toFixed(0) + ' to ' + e.toFixed(0) + ' over ' + yrs.toFixed(1) + ' years',
      contrib > 0 ? 'Plus ' + contrib.toFixed(0) + ' ' + FREQUENCIES.find((entry) => entry.id === frequency).label.toLowerCase() + ' contributions' : 'No further contributions',
      '',
      'Total invested: ' + invested.toFixed(0),
      'Profit: ' + profit.toFixed(0) + ' (' + absoluteReturn.toFixed(2) + '% absolute)',
      'CAGR on the starting value: ' + cagr.toFixed(3) + '%',
      contrib > 0 ? 'Money-weighted return: ' + irrPercent.toFixed(3) + '%' : 'No contributions, so IRR equals CAGR',
      extra.real ? 'Real CAGR after ' + (inflation * 100).toFixed(1) + '% inflation: ' + realCagr.toFixed(3) + '%' : '',
      extra.real ? "Today's value of the ending balance: " + realEnd.toFixed(0) : '',
      '',
      'Doubling time at this rate: ' + (doublingExact > 0 ? doublingExact.toFixed(1) + ' years (rule of 72 says ' + doubling72.toFixed(1) + ')' : 'never at a negative rate'),
      '',
      'Aiming for ' + goal.toFixed(0) + ':',
      'Rate needed with no further contributions: ' + (neededRate > 0 ? neededRate.toFixed(2) + '%' : 'already passed'),
      'Rate needed with your contributions: ' + (neededWithContrib > 0 ? neededWithContrib.toFixed(2) + '%' : '0%'),
      shortfall > 0 ? 'Shortfall at the current rate: ' + shortfall.toFixed(0) + ', about ' + extraPerPeriod.toFixed(0) + ' more per period' : 'The current rate reaches the target',
      '',
      'Growth path',
      ...path.map((point) => '  ' + point.label + ': ' + point.value.toFixed(0)),
    ].filter(Boolean).join('\n');

    return {
      s, e, yrs, contrib, freq, cagr, irrPercent, absoluteReturn, invested, profit, doublingExact, doubling72, realCagr,
      realEnd, path, straight, annualVol, bestCase, worstCase, oneSigma, neededRate, neededWithContrib, shortfall,
      extraPerPeriod, rateTable, warnings, report, inflation, vol, goal,
    };
  }, [start, end, years, contribution, frequency, target, inflationInput, volatility, extra]);

  return (
    <ToolShell
      toolId="cagr-analysis"
      icon={ChartColumn}
      title="CAGR, IRR & Growth Analysis"
      desc="The growth rate between two values, the money-weighted return once contributions are counted, the real return after inflation, doubling time and what it takes to reach a target."
      state={{ start, end, years, contribution, frequency, target, inflation: inflationInput, volatility, extra }}
      onRestore={(restored) => {
        const map = { start: setStart, end: setEnd, years: setYears, contribution: setContribution, target: setTarget, inflation: setInflation, volatility: setVolatility };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.frequency) setFrequency(restored.frequency);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="cagr-analysis.txt"
    >
      <Seg value={frequency} onChange={setFrequency} options={FREQUENCIES.map((entry) => ({ value: entry.id, label: entry.label }))} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Starting value"><input value={start} onChange={(e) => setStart(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Ending value"><input value={end} onChange={(e) => setEnd(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Years"><input value={years} onChange={(e) => setYears(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Contribution per ' + (frequency === 'monthly' ? 'month' : frequency === 'quarterly' ? 'quarter' : 'year')}><input value={contribution} onChange={(e) => setContribution(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Target value"><input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Inflation, %"><input value={inflationInput} onChange={(e) => setInflation(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Volatility, %"><input value={volatility} onChange={(e) => setVolatility(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Adjust for inflation" checked={extra.real} onChange={() => toggle('real')} />
        <ToggleRow label="Show rate scenarios" checked={extra.compare} onChange={() => toggle('compare')} />
        <ToggleRow label="Show growth path" checked={extra.rolling} onChange={() => toggle('rolling')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'From ' + result.s.toFixed(0) + ' to ' + result.e.toFixed(0) + ' in ' + result.yrs.toFixed(1) + ' years'}
          value={result.cagr.toFixed(2)}
          unit="% CAGR"
          sub={'That is ' + result.absoluteReturn.toFixed(1) + '% in total, and ' + result.profit.toFixed(0) + ' of profit on ' + result.invested.toFixed(0) + ' invested.' + (result.contrib > 0 ? ' Once the timing of contributions is counted, the money-weighted return is ' + result.irrPercent.toFixed(2) + '%.' : '') + (extra.real ? ' After inflation the real rate is ' + result.realCagr.toFixed(2) + '%.' : '')}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Doubling and the real picture</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Exact doubling time</span><span>{result.cagr > 0 ? result.doublingExact.toFixed(1) + ' years' : 'never'}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Rule of 72</span><span>{result.cagr > 0 ? result.doubling72.toFixed(1) + ' years' : '—'}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Real CAGR</span><span className={result.realCagr < 0 ? 'text-rose-400' : 'text-cyan-j'}>{result.realCagr.toFixed(2)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Ending value today</span><span>{result.realEnd.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Annual volatility</span><span>{result.annualVol.toFixed(1)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Plausible range</span><span>{Math.round(result.worstCase).toLocaleString()} – {Math.round(result.bestCase).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">± 1σ on the rate</span><span>±{result.oneSigma.toFixed(1)}%</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Invested', value: Math.round(result.invested).toLocaleString() },
                { label: 'Profit', value: Math.round(result.profit).toLocaleString(), tone: result.profit < 0 ? 'rose' : undefined },
                { label: 'Absolute', value: result.absoluteReturn.toFixed(1) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      {extra.rolling && (
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Growth path against a straight line</span>
            <span className="font-mono-j text-[11px] text-muted-foreground">compound curve versus linear</span>
          </div>
          <Spark data={result.path.map((point) => point.value)} width={520} height={54} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 font-mono-j text-[9px] uppercase text-muted-foreground">Compounded at {result.cagr.toFixed(1)}%</div>
              <Bars data={result.path.slice(0, 12)} suffix="" format={(v) => Math.round(v).toLocaleString()} />
            </div>
            <div>
              <div className="mb-1 font-mono-j text-[9px] uppercase text-muted-foreground">Same total spread evenly</div>
              <Bars data={result.straight.slice(0, 12)} suffix="" format={(v) => Math.round(v).toLocaleString()} />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Compounding looks unremarkable for years and then does most of the work late. That shape is why the last few years of a long plan matter more than the first few.
          </p>
        </Panel>
      )}

      {extra.compare && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the same money lands at other rates</div>
          <Bars data={result.rateTable} suffix="" format={(v) => Math.round(v).toLocaleString()} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Small differences in rate compound into large differences in outcome. That is the whole argument for keeping costs low over a long horizon.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Full analysis</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading growth rates honestly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· CAGR is a mathematical average, not what you experienced. A portfolio can deliver 8% a year and still have lost 30% in one of those years.</p>
            <p>· With deposits, CAGR overstates performance when markets were good early and understates it when they were bad. The money-weighted return is the number you actually earned.</p>
            <p>· Short periods annualise into nonsense. A 20% gain over three months is not an 80% annual return, and no plan should be built on it.</p>
            <p>· Inflation quietly decides whether a gain is real. Adjust before comparing a return with a goal that has a date attached.</p>
            <p>· Volatility widens the range of outcomes as the horizon grows. The average stays put; the spread around it does not.</p>
            <p>· A target rate is a planning input, not a promise. What you control is contribution, cost and time — in that order.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="CAGR" value={result.cagr.toFixed(2) + '%'} mono sub="on the starting value" />
        <Stat label="Money weighted" value={result.irrPercent.toFixed(2) + '%'} mono sub="including contributions" />
        <Stat label="Real rate" value={result.realCagr.toFixed(2) + '%'} mono sub="after inflation" />
        <Stat label="Doubling" value={result.cagr > 0 ? result.doublingExact.toFixed(1) : '—'} mono sub={result.cagr > 0 ? 'years' : 'negative growth'} />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Watch the assumptions</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Target planning</div>
        <div className="space-y-1.5 font-mono-j text-[11px]">
          <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Target</span><span>{Math.round(result.goal).toLocaleString()}</span></div>
          <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Rate needed, no contributions</span><span>{result.neededRate > 0 ? result.neededRate.toFixed(2) + '%' : 'already reached'}</span></div>
          <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Rate needed with contributions</span><span>{result.neededWithContrib > 0 ? result.neededWithContrib.toFixed(2) + '%' : '0%'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Extra per period if short</span><span>{result.extraPerPeriod > 0 ? result.extraPerPeriod.toFixed(0) : 'nothing extra needed'}</span></div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          When the required rate looks unrealistic, the honest answers are more money per period, more time, or a smaller target. Chasing a higher return is the one that does not reliably work.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Growth, IRR and duration figures are computed from the values you enter, treating contributions as arriving at the end of each period. Real portfolios have fees, taxes and uneven contributions; a
          spread of assumptions is more useful than a single point estimate.
        </p>
      </Panel>
    </ToolShell>
  );
}