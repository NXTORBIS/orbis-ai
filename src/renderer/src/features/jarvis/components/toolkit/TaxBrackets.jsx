import { useMemo, useState } from 'react';
import { Landmark, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const START = [
  { id: uid(), upTo: '11000', rate: '10' },
  { id: uid(), upTo: '44725', rate: '12' },
  { id: uid(), upTo: '95375', rate: '22' },
  { id: uid(), upTo: '182100', rate: '24' },
  { id: uid(), upTo: '231250', rate: '32' },
  { id: uid(), upTo: '578125', rate: '35' },
  { id: uid(), upTo: '', rate: '37' },
];

export default function TaxBrackets() {
  const [income, setIncome] = useState('95000');
  const [deduction, setDeduction] = useState('14600');
  const [brackets, setBrackets] = useState(START);
  const [period, setPeriod] = useState('yearly');

  const result = useMemo(() => {
    const gross = Math.max(0, Number(income) || 0);
    const allowance = Math.max(0, Number(deduction) || 0);
    const taxable = Math.max(0, gross - allowance);
    const rows = [];
    let floor = 0;
    let tax = 0;

    brackets.forEach((bracket) => {
      const rate = Number(bracket.rate) || 0;
      const ceiling = bracket.upTo === '' ? Infinity : Math.max(floor, Number(bracket.upTo) || 0);
      const inBand = Math.max(0, Math.min(taxable, ceiling) - floor);
      const bandTax = (inBand * rate) / 100;
      tax += bandTax;
      rows.push({
        id: bracket.id,
        label: ceiling === Infinity ? 'above ' + floor.toLocaleString() : floor.toLocaleString() + ' – ' + ceiling.toLocaleString(),
        from: floor,
        to: ceiling,
        rate,
        inBand,
        bandTax,
        used: inBand > 0,
      });
      floor = ceiling;
    });

    const used = rows.filter((row) => row.used);
    const marginal = used.length ? used[used.length - 1].rate : 0;
    const nextRate = rows.find((row) => !row.used && row.from <= taxable) || null;
    const effective = gross ? (tax / gross) * 100 : 0;
    const net = gross - tax;
    const nextThousand = (Math.min(taxable + 1000, rows[rows.length - 1].to) - taxable) * (marginal / 100);

    return {
      gross, taxable, allowance, tax, net, rows, marginal,
      effective,
      rateOnTaxable: taxable ? (tax / taxable) * 100 : 0,
      netMonthly: net / 12,
      netWeekly: net / 52,
      nextThousand,
      unused: nextRate,
    };
  }, [income, deduction, brackets]);

  const report = useMemo(() => [
    'Gross ' + result.gross.toLocaleString() + ' · allowance ' + result.allowance.toLocaleString() + ' · taxable ' + result.taxable.toLocaleString(),
    'Tax ' + result.tax.toFixed(2) + ' · effective rate ' + result.effective.toFixed(2) + '% · marginal rate ' + result.marginal + '%',
    'Net ' + result.net.toFixed(2) + ' per year · ' + result.netMonthly.toFixed(2) + ' per month',
    '',
    ...result.rows.filter((row) => row.used).map((row) => row.label + ' @ ' + row.rate + '% → ' + row.bandTax.toFixed(2)),
  ].join('\n'), [result]);

  const setBracket = (id, patch) => setBrackets((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const perPeriod = (value) => {
    if (period === 'monthly') return value / 12;
    if (period === 'weekly') return value / 52;
    if (period === 'daily') return value / 365;
    return value;
  };

  const netWeekNote = 'of ' + result.netWeekly.toFixed(0) + ' a week';

  return (
    <ToolShell
      toolId="tax-brackets"
      icon={Landmark}
      title="Income Tax Bracket Calculator"
      desc="Progressive tax worked out band by band, with the marginal rate, the effective rate and what your next thousand of income is really taxed at."
      state={{ income, deduction, brackets, period }}
      onRestore={(restored) => {
        if (restored.income !== undefined) setIncome(String(restored.income));
        if (restored.deduction !== undefined) setDeduction(String(restored.deduction));
        if (Array.isArray(restored.brackets) && restored.brackets.length) setBrackets(restored.brackets);
        if (restored.period) setPeriod(restored.period);
      }}
      exportText={report}
      exportName="tax-brackets.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1.2fr]">
        <Field label="Gross income">
          <input value={income} onChange={(e) => setIncome(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Deduction or allowance">
          <input value={deduction} onChange={(e) => setDeduction(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Show figures per">
          <Seg value={period} onChange={setPeriod} options={[{ value: 'yearly', label: 'Year' }, { value: 'monthly', label: 'Month' }, { value: 'weekly', label: 'Week' }, { value: 'daily', label: 'Day' }]} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.effective > 35 ? 'rose' : result.effective > 20 ? 'amber' : 'emerald'}
          label="Effective tax rate"
          value={result.effective.toFixed(2)}
          unit="%"
          sub={'You pay ' + perPeriod(result.tax).toFixed(2) + ' per ' + (period === 'yearly' ? 'year' : period.replace('ly', '')) + ' on ' + perPeriod(result.gross).toFixed(2) + ' gross — the marginal rate of ' + result.marginal + '% only applies to the last slice.'}
        />
        <Gauge
          value={result.marginal}
          min={0}
          max={60}
          unit="%"
          label="Marginal rate on the next unit"
          caption={'The next 1,000 you earn is taxed at ' + result.marginal + '%' + (result.unused ? ', and the band after that starts at ' + result.unused.label + '.' : '.')}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Bracket by bracket</div>
          <div className="space-y-1.5">
            {result.rows.map((row) => (
              <div key={row.id} className={row.used ? 'rounded-lg border border-cyan-j/30 bg-cyan-j/5 px-2.5 py-1.5' : 'rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5'}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono-j text-muted-foreground">{row.label}</span>
                  <span className="font-mono-j text-cyan-j">{row.rate}%</span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-j/70" style={{ width: row.to === Infinity ? '100%' : Math.min(100, (row.inBand / Math.max(1, result.taxable)) * 100) + '%' }} />
                </div>
                <div className="mt-1 flex items-center justify-between font-mono-j text-[10px] text-muted-foreground">
                  <span>{row.inBand > 0 ? row.inBand.toFixed(2) + ' taxed' : 'not reached'}</span>
                  <span>{row.bandTax ? row.bandTax.toFixed(2) : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Tax contributed by each band</div>
          <Bars
            data={result.rows.filter((row) => row.bandTax > 0).map((row) => ({ label: row.rate + '%', value: Number(row.bandTax.toFixed(2)) }))}
            format={(value) => value.toFixed(0)}
            highlightLast={false}
          />
          <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            <p>· Progressive means each rate only applies inside its own band — the top rate never applies to the whole income.</p>
            <p>· The effective rate of {result.effective.toFixed(2)}% is the honest number to quote; the marginal rate of {result.marginal}% is what a raise or overtime is taxed at.</p>
            <p>· An extra 1,000 of income costs about {result.nextThousand.toFixed(2)} in tax at this level, so a raise only nets you {Math.max(0, 1000 - result.nextThousand).toFixed(2)}.</p>
            <p>· Changing the allowance moves the whole taxable figure, which can drop you out of a band entirely — that is where reliefs do their work.</p>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Your own brackets</div>
        <div className="space-y-1.5">
          {brackets.map((bracket, index) => (
            <div key={bracket.id} className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
              <span className="font-mono-j text-[10px] text-muted-foreground">{index + 1}</span>
              <input
                value={bracket.upTo}
                onChange={(e) => setBracket(bracket.id, { upTo: e.target.value })}
                inputMode="decimal"
                placeholder={index === brackets.length - 1 ? 'no limit' : 'upper limit'}
                className="h-9 rounded-md border border-input bg-transparent px-2.5 font-mono-j text-sm"
              />
              <input
                value={bracket.rate}
                onChange={(e) => setBracket(bracket.id, { rate: e.target.value })}
                inputMode="decimal"
                className="h-9 rounded-md border border-input bg-transparent px-2.5 font-mono-j text-sm"
              />
              <button
                type="button"
                onClick={() => setBrackets((current) => current.filter((row) => row.id !== bracket.id))}
                disabled={brackets.length <= 1}
                className="text-muted-foreground transition hover:text-rose-400 disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setBrackets((current) => [...current, { id: uid(), upTo: '', rate: '0' }].slice(0, 12))}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a band
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Put the bands in order with the upper limit of each and its rate. Leave the final limit blank for the top band. The defaults are a common
          single-filer schedule — replace them with your own country's and the maths follows.
        </p>
        <div className="mt-2">
          <CopyBtn value={report} label="Copy the breakdown" />
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Tax" value={perPeriod(result.tax).toFixed(0)} mono sub={period} />
        <Stat label="Net" value={perPeriod(result.net).toFixed(0)} mono sub={period} />
        <Stat label="Marginal" value={result.marginal + '%'} mono sub="next unit" />
        <Stat label="Net per month" value={result.netMonthly.toFixed(0)} mono sub={netWeekNote} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Reading the numbers correctly</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Gross is before anything; taxable is after the deduction. Tax is charged on the taxable figure, then the deduction is not subtracted from your pay.</p>
          <p>· A common mistake is to assume the top band taxes everything. Here the {result.marginal}% band takes {result.rateOnTaxable.toFixed(2)}% of taxable income on average.</p>
          <p>· Marginal rate matters for decisions: an extra hour of overtime, a bonus or a second job is all taxed at that figure, not the effective one.</p>
          <p>· Social contributions, local taxes and student repayments usually sit outside this model. Add them as another band or treat the result as income tax only.</p>
          <p>· Once a new band starts, only the amount above the threshold is charged at the higher rate — the arithmetic you can check right here.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Effective', value: result.effective.toFixed(2) + '%' },
              { label: 'Marginal', value: result.marginal + '%' },
              { label: 'Bands reached', value: String(result.rows.filter((row) => row.used).length) + ' of ' + result.rows.length },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The calculation is a plain walk up the bands: take the taxable income, fill each band in turn, charge that band's rate on the portion that falls inside
          it. Because the bands are yours to edit, the same engine handles any progressive system, a flat rate, or a hypothetical reform you want to test — and
          nothing leaves the browser.
        </p>
      </Panel>
    </ToolShell>
  );
}