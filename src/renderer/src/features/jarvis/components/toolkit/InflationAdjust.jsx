import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat } from './shared';

const money = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const SAMPLE_RATES = '2019 2.3\n2020 1.4\n2021 3.4\n2022 6.4\n2023 3.5\n2024 2.9\n2025 2.4';

const parseRates = (text) => text
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length >= 2) {
      const year = Number(parts[0].replace(/[^\d]/g, ''));
      const rate = Number(parts[1].replace(/[^\d.\-]/g, ''));
      return Number.isFinite(year) && Number.isFinite(rate) ? { year, rate } : null;
    }
    const rate = Number(line.replace(/[^\d.\-]/g, ''));
    return Number.isFinite(rate) ? { year: null, rate } : null;
  })
  .filter(Boolean);

export default function InflationAdjust() {
  const [amount, setAmount] = useState('1000');
  const [startYear, setStartYear] = useState('2019');
  const [mode, setMode] = useState('table');
  const [average, setAverage] = useState('3');
  const [years, setYears] = useState('10');
  const [rates, setRates] = useState(SAMPLE_RATES);

  const result = useMemo(() => {
    const start = Number(startYear) || new Date().getFullYear();
    const base = Number(amount) || 0;

    const rows = [];
    let factor = 1;

    if (mode === 'average') {
      const rate = Number(average) || 0;
      const count = Math.max(1, Math.min(60, Number(years) || 1));
      for (let index = 1; index <= count; index += 1) {
        factor *= 1 + rate / 100;
        rows.push({ year: start + index, rate, factor, value: base * factor });
      }
      return {
        rows, factor, start, base, rate,
        endYear: start + count,
        totalChange: (factor - 1) * 100,
        purchasingPower: base ? base / factor : 0,
        perYear: count ? ((Math.pow(factor, 1 / count) - 1) * 100) : 0,
      };
    }

    const parsed = parseRates(rates);
    let cursor = start;
    parsed.forEach((entry, index) => {
      const year = entry.year || cursor + index;
      cursor = year;
      factor *= 1 + entry.rate / 100;
      rows.push({ year, rate: entry.rate, factor, value: base * factor });
    });

    return {
      rows, factor, start, base, rate: rows.length ? rows.reduce((sum, row) => sum + row.rate, 0) / rows.length : 0,
      endYear: rows.length ? rows[rows.length - 1].year : start,
      totalChange: (factor - 1) * 100,
      purchasingPower: base ? base / factor : 0,
      perYear: rows.length ? ((Math.pow(factor, 1 / rows.length) - 1) * 100) : 0,
    };
  }, [amount, startYear, mode, average, years, rates]);

  const chart = useMemo(() => {
    const step = Math.max(1, Math.ceil(result.rows.length / 12));
    return result.rows.filter((row, index) => index % step === 0 || index === result.rows.length - 1)
      .map((row) => ({ label: String(row.year).slice(2), value: Math.round(row.value) }));
  }, [result]);

  const report = useMemo(() => [
    money(result.base) + ' in ' + result.start + ' is worth ' + money(result.rows.length ? result.rows[result.rows.length - 1].value : result.base) + ' by ' + result.endYear,
    'Total inflation over the period: ' + result.totalChange.toFixed(1) + '% (an average of ' + result.perYear.toFixed(2) + '% a year)',
    'The same basket of goods costing ' + money(result.base) + ' then would cost ' + money(result.rows.length ? result.rows[result.rows.length - 1].value : result.base) + ' now',
    '',
    ...result.rows.map((row) => row.year + ': ' + row.rate.toFixed(2) + '% · cumulative ×' + row.factor.toFixed(4) + ' · ' + money(row.value)),
  ].join('\n'), [result]);

  const finalValue = result.rows.length ? result.rows[result.rows.length - 1].value : result.base;

  return (
    <ToolShell
      toolId="inflation-adjust"
      icon={TrendingUp}
      title="Inflation Adjuster"
      desc="See what an amount from one year is worth in another — using a single average rate or a year-by-year table of real figures, with the cumulative effect and purchasing power."
      state={{ amount, startYear, mode, average, years, rates }}
      onRestore={(restored) => {
        if (restored.amount !== undefined) setAmount(String(restored.amount));
        if (restored.startYear !== undefined) setStartYear(String(restored.startYear));
        if (restored.mode) setMode(restored.mode);
        if (restored.average !== undefined) setAverage(String(restored.average));
        if (restored.years !== undefined) setYears(String(restored.years));
        if (typeof restored.rates === 'string') setRates(restored.rates);
      }}
      exportText={report}
      exportName="inflation.txt"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount at the start"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Start year"><input value={startYear} onChange={(e) => setStartYear(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="How to model it">
          <Seg value={mode} onChange={setMode} options={[{ value: 'average', label: 'Average rate' }, { value: 'table', label: 'Year by year' }]} />
        </Field>
      </div>

      {mode === 'average' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Average inflation, % a year"><input value={average} onChange={(e) => setAverage(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Years to project"><input value={years} onChange={(e) => setYears(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        </div>
      ) : (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Year and inflation rate, one per line — paste figures from any published table</div>
          <Area value={rates} onChange={setRates} rows={8} mono placeholder={'2021 3.4\n2022 6.4'} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The year is optional: with only a rate on a line, the years are numbered from the start year. A negative rate models deflation, and a single very high
            line is how a shocked year gets represented.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Value by ' + result.endYear}
          value={money(finalValue)}
          sub={money(result.base) + ' in ' + result.start + ' has the same buying power as ' + money(finalValue) + ' in ' + result.endYear + ' — cumulative inflation of ' + result.totalChange.toFixed(1) + '%, an average of ' + result.perYear.toFixed(2) + '% a year.'}
        />
        <Ring
          value={Math.min(500, Math.abs(result.totalChange))}
          max={500}
          tone={result.totalChange > 0 ? 'amber' : 'emerald'}
          label="Cumulative change"
          sub={'Prices moved ' + result.totalChange.toFixed(1) + '% across ' + result.rows.length + ' year' + (result.rows.length === 1 ? '' : 's')}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the amount is worth over time</div>
          <Bars data={chart} format={(value) => money(value)} suffix="" highlightLast />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Each bar is what the same starting sum becomes by that year. The rise is compound, not linear — which is why a decade of modest inflation quietly adds a
            third to prices.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Two ways to read the same figure</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Forward: money you had then is worth {money(finalValue)} now, so a 2019 salary of {money(result.base)} would need to be {money(finalValue)} to feel the same today.</p>
            <p>· Backward: {money(finalValue)} today buys what {money(result.base)} bought in {result.start}. Divide instead of multiply to move the other way.</p>
            <p>· The same maths applies to rent, a subscription or a budget line — anything fixed in money terms loses ground at this rate.</p>
            <p>· Purchasing power of the original sum today is {money(result.purchasingPower)} — that is what {money(result.base)} would buy if prices had stood still.</p>
            <p>· {result.totalChange > 0 ? 'A fixed income over this period loses ' + result.totalChange.toFixed(1) + '% of its real value unless it is indexed.' : 'Prices fell over this period, so cash held its value and then some.'}</p>
          </div>
          <div className="mt-3">
            <CopyBtn value={report} label="Copy the working" />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Year by year</div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card">
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Year</th>
                <th className="py-1 text-right font-medium">Rate</th>
                <th className="py-1 text-right font-medium">Cumulative factor</th>
                <th className="py-1 text-right font-medium">Equivalent value</th>
                <th className="py-1 text-right font-medium">Buying power left</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {result.rows.map((row) => (
                <tr key={row.year} className="border-t border-border/50">
                  <td className="py-1">{row.year}</td>
                  <td className="py-1 text-right text-muted-foreground">{row.rate.toFixed(2)}%</td>
                  <td className="py-1 text-right">×{row.factor.toFixed(4)}</td>
                  <td className="py-1 text-right text-cyan-j">{money(row.value)}</td>
                  <td className="py-1 text-right text-rose-300">{money(result.base / row.factor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Starting amount" value={money(result.base)} mono sub={String(result.start)} />
        <Stat label="Equivalent now" value={money(finalValue)} mono sub={String(result.endYear)} />
        <Stat label="Total inflation" value={result.totalChange.toFixed(1) + '%'} mono />
        <Stat label="Average a year" value={result.perYear.toFixed(2) + '%'} mono sub="compound" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading inflation figures honestly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A published index measures an average basket. Your own basket may be heavier in rent or fuel, so your personal rate can run above or below the headline.</p>
            <p>· Compound, not additive: 3% a year for ten years is about 34%, not 30%.</p>
            <p>· Averaging hides shocks. A single 8% year and a single 1% year do not cancel out in the middle of a budget.</p>
            <p>· Use the same index throughout. Mixing one country's figures with another currency's purchasing power quietly invalidates the comparison.</p>
            <p>· Nominal versus real: subtract the inflation rate from a return to get the real return. A 5% saving rate during 4% inflation is really 1%.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What people use this for</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Salary conversations: what a role paying {money(result.base)} in {result.start} ought to pay now to be no worse off.</p>
            <p>· Long contracts: checking whether an annual uplift clause actually keeps pace.</p>
            <p>· Historical comparison: what a price from an old catalogue means in today's money.</p>
            <p>· Planning: projecting a budget forward so next year's numbers are not quietly optimistic.</p>
            <p>· Savings: seeing how much of a cash lump sum inflation erodes over the horizon, which is the argument for holding productive assets.</p>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The formula in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>value_final = value_start × Π (1 + rate_i ÷ 100)</p>
          <p>Average yearly rate = ((final ÷ start) ^ (1 ÷ years)) − 1</p>
          <p>Buying power = value_start ÷ cumulative factor</p>
          <p className="text-cyan-j">Check: ×{result.factor.toFixed(4)} over {result.rows.length} years is {(result.perYear || 0).toFixed(2)}% a year, compounded.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Mode', value: mode === 'average' ? 'average rate' : 'year by year' },
              { label: 'Years', value: String(result.rows.length) },
              { label: 'Factor', value: '×' + result.factor.toFixed(3) },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Each year's rate is applied to the running total rather than to the starting amount, which is what makes the result compound correctly. Your own figures can
          be pasted from any published table, and a year of deflation simply carries a negative rate.
        </p>
      </Panel>
    </ToolShell>
  );
}