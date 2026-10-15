import { useMemo, useState } from 'react';
import { TrendingUp, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const money = (value, currency) => currency + (Math.abs(value) >= 1000 ? Math.round(value).toLocaleString() : value.toFixed(2));

const DEFAULT_PRICES = ['100', '94', '88', '95', '104', '112', '105', '98', '92', '101', '115', '124'];

export default function DollarCostAverage() {
  const [prices, setPrices] = useState(DEFAULT_PRICES.map((value, index) => ({ id: 'p' + index, value })));
  const [contribution, setContribution] = useState('250');
  const [frequency, setFrequency] = useState('monthly');
  const [currency, setCurrency] = useState('$');
  const [fee, setFee] = useState('0.5');

  const set = (id, value) => setPrices((current) => current.map((row) => (row.id === id ? { ...row, value } : row)));

  const result = useMemo(() => {
    const points = prices.map((row) => Math.max(0.01, Number(row.value) || 0));
    const amount = Math.max(0, Number(contribution) || 0);
    const feePercent = Math.max(0, Number(fee) || 0) / 100;
    const count = points.length;
    if (!count) return { points: [], rows: [], totalInvested: 0 };

    const periodsPerYear = frequency === 'weekly' ? 52 : frequency === 'monthly' ? 12 : 4;
    const net = amount * (1 - feePercent);
    const rows = points.map((price, index) => ({
      index: index + 1,
      price,
      units: price ? net / price : 0,
      invested: net,
    }));

    const totalInvested = net * count;
    const totalUnits = rows.reduce((sum, row) => sum + row.units, 0);
    const averageCost = totalUnits ? totalInvested / totalUnits : 0;
    const averagePrice = points.reduce((sum, value) => sum + value, 0) / count;
    const finalPrice = points[count - 1];
    const finalValue = totalUnits * finalPrice;
    const profit = finalValue - totalInvested;
    const roi = totalInvested ? (profit / totalInvested) * 100 : 0;

    const lumpUnits = (totalInvested / points[0]);
    const lumpValue = lumpUnits * finalPrice;
    const bestUnits = (totalInvested / Math.min(...points));
    const bestValue = bestUnits * finalPrice;

    let peak = points[0];
    let maxDrawdown = 0;
    points.forEach((value) => {
      if (value > peak) peak = value;
      const drawdown = ((value - peak) / peak) * 100;
      if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    });

    const cheapest = rows.reduce((best, row) => (row.price < best.price ? row : best), rows[0]);
    const dearest = rows.reduce((worst, row) => (row.price > worst.price ? row : worst), rows[0]);

    const scenarios = [
      { label: 'Steady payments', value: finalValue },
      { label: 'Lump sum at the start', value: lumpValue },
      { label: 'Perfect timing', value: bestValue },
    ];

    const breakEven = averageCost;
    const marginOfSafety = finalPrice ? ((finalPrice - averageCost) / averageCost) * 100 : 0;

    return {
      points, rows, totalInvested, totalUnits, averageCost, averagePrice, finalPrice, finalValue, profit, roi,
      lumpValue, bestValue, maxDrawdown, cheapest, dearest, scenarios, breakEven, marginOfSafety, periodsPerYear,
      annualInvested: net * periodsPerYear,
      chart: rows.map((row) => ({ label: String(row.index), value: Number(row.units.toFixed(3)) })),
      averageCostAdvantage: ((averagePrice - averageCost) / averagePrice) * 100,
      unitsPerYear: totalUnits / count * periodsPerYear,
    };
  }, [prices, contribution, frequency, fee]);

  const report = useMemo(() => [
    'Dollar-cost averaging across ' + result.rows.length + ' periods at ' + money(Number(contribution) || 0, currency) + ' ' + frequency,
    '',
    'Total invested ' + money(result.totalInvested, currency) + ' for ' + result.totalUnits.toFixed(4) + ' units',
    'Average cost per unit ' + money(result.averageCost, currency) + ' against an average market price of ' + money(result.averagePrice, currency),
    'Final price ' + money(result.finalPrice, currency) + ' → value ' + money(result.finalValue, currency),
    'Profit ' + money(result.profit, currency) + ' (' + result.roi.toFixed(2) + '% return)',
    '',
    'Comparison over the same money: lump sum at the first price would be worth ' + money(result.lumpValue, currency) + ', perfect timing ' + money(result.bestValue, currency) + '.',
    'Deepest fall from a peak during the period: ' + result.maxDrawdown.toFixed(1) + '%',
    'Cheapest purchase at ' + money(result.cheapest.price, currency) + ', dearest at ' + money(result.dearest.price, currency),
    'Break-even price: ' + money(result.breakEven, currency),
  ].join('\n'), [result, contribution, frequency, currency]);

  return (
    <ToolShell
      toolId="dollar-cost-average"
      icon={TrendingUp}
      title="Dollar-Cost Averaging Analyser"
      desc="A price series and a fixed contribution into average cost, units bought, profit, the deepest drawdown and how it compares with a lump sum and with perfect timing."
      state={{ prices, contribution, frequency, currency, fee }}
      onRestore={(restored) => {
        if (Array.isArray(restored.prices) && restored.prices.length) setPrices(restored.prices);
        if (restored.contribution !== undefined) setContribution(String(restored.contribution));
        if (restored.frequency) setFrequency(restored.frequency);
        if (typeof restored.currency === 'string') setCurrency(restored.currency);
        if (restored.fee !== undefined) setFee(String(restored.fee));
      }}
      exportText={report}
      exportName="dca-analysis.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Contribution each period"><input value={contribution} onChange={(e) => setContribution(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Frequency">
          <Seg value={frequency} onChange={setFrequency} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }]} />
        </Field>
        <Field label="Fee or spread, %"><input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Price at each period, oldest first</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.rows.length} periods</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-6">
          {prices.map((row) => (
            <div key={row.id} className="rounded-lg border border-border/60 bg-card/40 p-2">
              <input value={row.value} onChange={(e) => set(row.id, e.target.value)} inputMode="decimal" className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              <button type="button" onClick={() => setPrices((current) => current.filter((entry) => entry.id !== row.id))} className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground transition hover:text-rose-300">
                <Trash2 className="h-3 w-3" /> remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPrices((current) => [...current, { id: Math.random().toString(36).slice(2), value: current.length ? current[current.length - 1].value : '100' }])}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a period
        </button>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.roi >= 0 ? 'emerald' : 'rose'}
          label="Portfolio value at the final price"
          value={money(result.finalValue, currency)}
          sub={'On ' + money(result.totalInvested, currency) + ' invested across ' + result.rows.length + ' periods, for a profit of ' + money(result.profit, currency) + ' and a return of ' + result.roi.toFixed(1) + '%. Your average cost is ' + money(result.averageCost, currency) + ' per unit against an average market price of ' + money(result.averagePrice, currency) + '.'}
        />
        <Ring
          value={Math.abs(result.maxDrawdown)}
          max={50}
          tone={result.maxDrawdown < -20 ? 'rose' : 'amber'}
          label="Deepest fall during the period"
          sub={result.maxDrawdown.toFixed(1) + '% from a peak — the drop you would have had to sit through'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Units bought each period</div>
          <Bars data={result.chart} format={(value) => value.toFixed(2)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            This is the whole mechanism in one picture: a fixed amount of money buys more units when prices are low and fewer when they are high. The cheapest period bought
            {' '}{result.cheapest.units.toFixed(3)} units and the dearest bought {result.dearest.units.toFixed(3)}.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The numbers</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Invested</span><span>{money(result.totalInvested, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Units held</span><span className="text-cyan-j">{result.totalUnits.toFixed(4)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Average cost</span><span>{money(result.averageCost, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Average market price</span><span>{money(result.averagePrice, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Final price</span><span>{money(result.finalPrice, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Break-even price</span><span>{money(result.breakEven, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Cushion above break-even</span><span>{result.marginOfSafety.toFixed(1)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Annualised contribution</span><span>{money(result.annualInvested, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Units a year at this rate</span><span>{result.unitsPerYear.toFixed(3)}</span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Against the alternatives, over the same money</div>
        <Bars
          data={result.scenarios.map((entry) => ({ label: entry.label.split(' ')[0], value: Number(entry.value.toFixed(0)) }))}
          format={(value) => money(value, currency)}
          suffix=""
          highlightLast={false}
        />
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          <p>· Steady payments ended at {money(result.finalValue, currency)}.</p>
          <p>· A single lump sum at the first price would have ended at {money(result.lumpValue, currency)}, which is {result.lumpValue > result.finalValue ? 'better' : 'worse'} by {money(Math.abs(result.lumpValue - result.finalValue), currency)}.</p>
          <p>· Perfect timing at the lowest price is the theoretical ceiling at {money(result.bestValue, currency)} — nobody achieves it, and it is here only to show the size of the prize.</p>
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Invested" value={money(result.totalInvested, currency)} mono sub={result.rows.length + ' periods'} />
        <Stat label="Value" value={money(result.finalValue, currency)} mono sub={result.roi.toFixed(1) + '% return'} />
        <Stat label="Average cost" value={money(result.averageCost, currency)} mono sub={'market average ' + money(result.averagePrice, currency)} />
        <Stat label="Drawdown" value={result.maxDrawdown.toFixed(1) + '%'} mono sub="worst fall from a peak" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What averaging does and does not do</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· It removes the need to decide when to buy. That is the real benefit, and it is a behavioural one rather than a mathematical one.</p>
            <p>· It reduces timing risk, not cost. With rising prices you end up buying fewer units than a lump sum would have bought at the start.</p>
            <p>· Your average cost of {money(result.averageCost, currency)} is below the average market price of {money(result.averagePrice, currency)} here, by {result.averageCostAdvantage.toFixed(1)}%. That gap is the volatility dividend.</p>
            <p>· With smooth rising prices the lump sum wins. With a fall or a round trip, steady buying usually wins. Over long periods, investing early has historically won more often than not.</p>
            <p>· Averaging is the right answer when the money arrives monthly, because that is the only option available anyway.</p>
            <p>· It does nothing about the asset itself. Averaging into something that goes to zero averages you into zero.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Practical points that change the result</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Fees and spreads compound against you. At {fee}% a period you are paying {money((Number(contribution) || 0) * (Number(fee) || 0) / 100, currency)} every time, which is {' '}{money(result.totalInvested === 0 ? 0 : (Number(contribution) || 0) * (Number(fee) || 0) / 100 * result.rows.length, currency)} across this period.</p>
            <p>· Small contributions with a fixed commission per trade can lose money before the market does. Check the minimum fee, not just the percentage.</p>
            <p>· Keep the contribution the same in cash terms. Adjusting it with the mood turns averaging back into timing.</p>
            <p>· Reinvest dividends or distributions, otherwise the comparison understates the compounding.</p>
            <p>· A drawdown of {result.maxDrawdown.toFixed(1)}% is what you would have experienced. If that would have made you stop contributing, the plan needs to be smaller rather than cleverer.</p>
            <p>· The maths is identical for any asset with a price series: shares, funds, gold, or a pension contribution.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Investment', value: money(result.totalInvested, currency) },
                { label: 'Value', value: money(result.finalValue, currency) },
                { label: 'Average cost', value: money(result.averageCost, currency) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>units each period = contribution × (1 − fee) ÷ price</p>
          <p>average cost = total invested ÷ total units</p>
          <p>average market price = the plain arithmetic mean of the prices, which is not the same number</p>
          <p>return = value ÷ invested − 1</p>
          <p>max drawdown = the largest fall from a running peak in the price series</p>
          <p className="text-cyan-j">Check: {money(result.totalInvested, currency)} ÷ {result.totalUnits.toFixed(4)} units = {money(result.averageCost, currency)} per unit.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This is arithmetic on the price series you paste in, with no dividends, taxes or inflation. A real comparison would reinvest distributions and account for tax on
          disposals, both of which shift the answer without changing the mechanism shown here.
        </p>
      </Panel>
    </ToolShell>
  );
}