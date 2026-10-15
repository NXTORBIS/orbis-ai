import { useMemo, useState } from 'react';
import { Plus, TrendingUp, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills } from './kit/premium';
import { CopyBtn, Panel, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const START = [
  { id: uid(), label: 'Savings account', initial: '2000', monthly: '400', deposit: '0', rate: '3.5', years: '15' },
  { id: uid(), label: 'Index fund', initial: '2000', monthly: '400', deposit: '0', rate: '7.5', years: '15' },
  { id: uid(), label: 'Pension', initial: '2000', monthly: '400', deposit: '1500', rate: '6', years: '15' },
];

const COLOURS = ['#22d3ee', '#34d399', '#a78bfa', '#fbbf24'];

export default function InvestmentCompare() {
  const [rows, setRows] = useState(START);

  const compare = useMemo(() => {
    const computed = rows.map((row, index) => {
      const initial = Number(row.initial) || 0;
      const monthly = Number(row.monthly) || 0;
      const deposit = Number(row.deposit) || 0;
      const rate = (Number(row.rate) || 0) / 100;
      const years = Math.max(1, Math.min(60, Number(row.years) || 1));
      const monthlyRate = rate / 12;
      let balance = initial;
      const series = [];
      for (let month = 1; month <= years * 12; month += 1) {
        balance = balance * (1 + monthlyRate) + monthly;
        if (month % 12 === 0) {
          balance += deposit;
          const contributedSoFar = initial + monthly * month + deposit * (month / 12);
          series.push({ year: month / 12, balance, contributed: contributedSoFar });
        }
      }
      const contributed = initial + monthly * years * 12 + deposit * years;
      const growth = balance - contributed;
      return {
        ...row,
        index,
        colour: COLOURS[index % COLOURS.length],
        initial, monthly, deposit, rate: rate * 100, years,
        final: balance,
        contributed,
        growth,
        growthShare: balance ? (growth / balance) * 100 : 0,
        multiple: contributed ? balance / contributed : 0,
        series,
        doubleAt: rate > 0 ? 72 / (rate * 100) : 0,
      };
    }).sort((a, b) => b.final - a.final);

    const best = computed[0] || null;
    const worst = computed[computed.length - 1] || null;
    const gap = best && worst ? best.final - worst.final : 0;
    const totalContributed = computed.reduce((sum, row) => sum + row.contributed, 0);

    return {
      rows: computed, best, worst, gap, totalContributed,
      empty: !computed.length,
      longest: computed.length ? computed[0].series : [],
    };
  }, [rows]);

  const report = useMemo(() => {
    if (compare.empty) return 'Add a scenario to compare.';
    const lines = ['Investment comparison over the same money'];
    compare.rows.forEach((row) => {
      lines.push('');
      lines.push(row.label + ' — ' + row.rate + '% for ' + row.years + ' years');
      lines.push('  paid in: ' + row.contributed.toFixed(2) + '  (start ' + row.initial + ', ' + row.monthly + '/month' + (row.deposit ? ', ' + row.deposit + '/year extra' : '') + ')');
      lines.push('  final value: ' + row.final.toFixed(2) + '  growth: ' + row.growth.toFixed(2) + '  (' + row.multiple.toFixed(2) + '× what you put in)');
    });
    lines.push('');
    lines.push('Best outcome is ' + compare.gap.toFixed(2) + ' ahead of the weakest over the same contributions.');
    return lines.join('\n');
  }, [compare]);

  const setRow = (id, patch) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const gapNote = compare.worst ? 'ahead of ' + (compare.worst.label || 'the weakest') : 'ahead of the weakest';

  return (
    <ToolShell
      toolId="investment-compare"
      icon={TrendingUp}
      title="Investment Scenario Comparison"
      desc="The same money, the same years, different rates — compounding side by side, so the cost of a cautious choice is a number instead of an argument."
      state={{ rows }}
      onRestore={(restored) => {
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
      }}
      exportText={report}
      exportName="investment-comparison.txt"
    >
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_5rem_auto] sm:items-center">
              <input value={row.label} onChange={(e) => setRow(row.id, { label: e.target.value })} placeholder="Scenario" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
              <input value={row.initial} onChange={(e) => setRow(row.id, { initial: e.target.value })} inputMode="decimal" placeholder="start" title="Starting amount" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
              <input value={row.monthly} onChange={(e) => setRow(row.id, { monthly: e.target.value })} inputMode="decimal" placeholder="monthly" title="Added every month" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
              <input value={row.deposit} onChange={(e) => setRow(row.id, { deposit: e.target.value })} inputMode="decimal" placeholder="yearly extra" title="Added once a year" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
              <input value={row.rate} onChange={(e) => setRow(row.id, { rate: e.target.value })} inputMode="decimal" placeholder="rate %" title="Annual return" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
              <input value={row.years} onChange={(e) => setRow(row.id, { years: e.target.value })} inputMode="numeric" title="Years" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
              <button type="button" onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))} className="text-muted-foreground transition hover:text-rose-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {index === 0 && <div className="mt-1 text-[10px] text-muted-foreground">Columns: scenario · starting amount · monthly · yearly extra · annual rate % · years</div>}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRows((current) => [...current, { id: uid(), label: '', initial: '1000', monthly: '250', deposit: '0', rate: '6', years: '15' }].slice(0, 4))}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
      >
        <Plus className="h-3.5 w-3.5" /> Add a scenario
      </button>

      {!compare.empty && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              label={'Best outcome: ' + (compare.best.label || 'scenario one')}
              value={Math.round(compare.best.final).toLocaleString()}
              sub={'After ' + compare.best.years + ' years you would have paid in ' + Math.round(compare.best.contributed).toLocaleString() + ' — the rest, ' + Math.round(compare.best.growth).toLocaleString() + ', is growth. That is ' + compare.best.multiple.toFixed(2) + '× what went in.'}
            />
            <Gauge
              value={compare.best.growthShare}
              min={0}
              max={100}
              unit="%"
              label="Growth share of the final pot"
              caption={compare.best.growthShare > 40
                ? 'Most of the final balance is return rather than contributions — the compounding is doing the heavy lifting.'
                : 'Most of the final balance is still your own money; time in the market is the lever that changes that.'}
            />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Final value after the full term</div>
            <Bars
              data={compare.rows.map((row) => ({ label: (row.label || '—').slice(0, 12), value: Math.round(row.final), colour: row.colour }))}
              format={(value) => value.toLocaleString()}
              highlightLast={false}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              The difference between the best and weakest outcome here is {Math.round(compare.gap).toLocaleString()} — {gapNote} — from the same contributions and
              the same amount of patience. Rate changes are worth arguing about; time is not.
            </p>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Scenario by scenario</span>
              <CopyBtn value={report} label="Copy comparison" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 text-left font-medium">Scenario</th>
                    <th className="py-1 text-right font-medium">Rate</th>
                    <th className="py-1 text-right font-medium">Paid in</th>
                    <th className="py-1 text-right font-medium">Final</th>
                    <th className="py-1 text-right font-medium">Growth</th>
                    <th className="py-1 text-right font-medium">Multiple</th>
                    <th className="py-1 text-right font-medium">Doubles in</th>
                  </tr>
                </thead>
                <tbody className="font-mono-j">
                  {compare.rows.map((row) => (
                    <tr key={row.id} className="border-t border-border/50">
                      <td className="py-1">{row.label || '—'}</td>
                      <td className="py-1 text-right">{row.rate}%</td>
                      <td className="py-1 text-right text-muted-foreground">{Math.round(row.contributed).toLocaleString()}</td>
                      <td className="py-1 text-right text-cyan-j">{Math.round(row.final).toLocaleString()}</td>
                      <td className="py-1 text-right">{Math.round(row.growth).toLocaleString()}</td>
                      <td className="py-1 text-right">{row.multiple.toFixed(2)}×</td>
                      <td className="py-1 text-right text-muted-foreground">{row.doubleAt ? row.doubleAt.toFixed(1) + ' yrs' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Balance year by year, best scenario</div>
              <div className="max-h-72 space-y-1 overflow-auto">
                {compare.longest.map((point) => (
                  <div key={point.year} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                    <span className="text-muted-foreground">Year {point.year}</span>
                    <span className="font-mono-j">{Math.round(point.balance).toLocaleString()}</span>
                    <span className="font-mono-j text-[10px] text-muted-foreground">paid in {Math.round(point.contributed).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">What actually drives the outcome</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· Time is the biggest term. Halving the years costs far more than a point off the rate.</p>
                <p>· The rate compounds on the whole balance, so the last few years contribute more than the first ones — the same contribution buys more later.</p>
                <p>· A doubling rule of thumb: at {compare.best.rate}% money takes about {compare.best.doubleAt.toFixed(1)} years to double (72 ÷ rate).</p>
                <p>· Contributions matter most at the start and least at the end; an increase late is worth much less than the same increase early.</p>
                <p>· Returns are not smooth. A model with a fixed rate flatters everything — treat the best scenario as an assumption, not a forecast.</p>
                <p>· Fees usually come straight off the rate, which is why a 7% fund with 1% fees behaves like a 6% one here.</p>
              </div>
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Scenarios" value={String(compare.rows.length)} mono />
            <Stat label="Paid in (all)" value={Math.round(compare.totalContributed).toLocaleString()} mono />
            <Stat label="Best final" value={Math.round(compare.best.final).toLocaleString()} mono sub={compare.best.label || '—'} />
            <Stat label="Spread" value={Math.round(compare.gap).toLocaleString()} mono sub="best vs weakest" />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Modelling assumptions used</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Interest is applied monthly at rate ÷ 12, and contributions are added at the end of each month — the usual way a regular saver behaves.</p>
              <p>· The yearly extra is added at the end of each full year, not spread across it.</p>
              <p>· No tax, no platform fee and no inflation. To see real terms, subtract inflation from the rate before entering it.</p>
              <p>· Compounding is monthly rather than continuous, which makes the figures slightly conservative against a daily-compounding product.</p>
            </div>
            <div className="mt-2">
              <Pills
                items={[
                  { label: 'Best', value: compare.best.label || '—' },
                  { label: 'Best rate', value: compare.best.rate + '%' },
                  { label: 'Multiple', value: compare.best.multiple.toFixed(2) + '×' },
                ]}
              />
            </div>
          </Panel>

          <Panel>
            <p className="text-[11px] text-muted-foreground">
              Every scenario is run month by month with its own rate, so contributions, one-off deposits and the compounding order all behave the way a real
              account does. Comparisons are only meaningful when the contributions match — if you change what goes in, the difference between scenarios stops being
              about the return.
            </p>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}