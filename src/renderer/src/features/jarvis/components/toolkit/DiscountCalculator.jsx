import { useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel } from './shared';
import ToolShell from './kit/ToolShell';

const CURRENCIES = [['$', 'USD  $'], ['₹', 'INR  ₹'], ['€', 'EUR  €'], ['£', 'GBP  £']];

const money = (value, symbol) => `${symbol}${(Math.abs(value) < 0.005 ? 0 : value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DiscountCalculator() {
  const [price, setPrice] = useState('2499');
  const [first, setFirst] = useState('30');
  const [second, setSecond] = useState('10');
  const [tax, setTax] = useState('0');
  const [symbol, setSymbol] = useState('$');

  const result = useMemo(() => {
    const p = Number(price) || 0;
    const d1 = Math.min(100, Math.max(0, Number(first) || 0));
    const d2 = Math.min(100, Math.max(0, Number(second) || 0));
    const t = Math.max(0, Number(tax) || 0);
    const afterFirst = p * (1 - d1 / 100);
    const afterSecond = afterFirst * (1 - d2 / 100);
    const taxAmount = afterSecond * (t / 100);
    const final = afterSecond + taxAmount;
    const savings = p - afterSecond;
    const effective = p ? (savings / p) * 100 : 0;
    return { p, d1, d2, t, afterFirst, afterSecond, taxAmount, final, savings, effective };
  }, [price, first, second, tax]);

  const quick = [
    ['10%', '10'], ['15%', '15'], ['20%', '20'], ['25%', '25'], ['30%', '30'], ['50%', '50'], ['70%', '70'],
  ];

  return (
    <ToolShell
      toolId="discount"
      icon={Tag}
      title="Discount Calculator"
      desc="Stacked discounts, tax and the real percentage you saved."
      state={{ price, first, second, tax, symbol }}
      onRestore={(saved) => {
        setPrice(saved.price); setFirst(saved.first); setSecond(saved.second);
        setTax(saved.tax); setSymbol(saved.symbol);
      }}
      exportText={JSON.stringify(result, null, 2)}
      exportName="discount.json"
      exportMime="application/json"
    >
      <Seg value={symbol} onChange={setSymbol} options={CURRENCIES.map(([value, label]) => ({ value, label }))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Original price"><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="First discount %">
          <div className="flex gap-2">
            <input value={first} onChange={(e) => setFirst(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </div>
        </Field>
        <Field label="Second discount % (stacks on top)" hint="Leave 0 for a single discount">
          <input value={second} onChange={(e) => setSecond(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Tax / VAT %">
          <input value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {quick.map(([label, value]) => (
          <button key={label} onClick={() => setFirst(value)} className={`rounded-lg border px-2.5 py-1 text-xs transition ${first === value ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>{label} off</button>
        ))}
      </div>
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">You pay</div>
        <div className="mt-1 font-display text-4xl font-bold text-cyan-j">{money(result.final, symbol)}</div>
        <div className="mt-1 text-xs text-muted-foreground">instead of <span className="line-through">{money(result.p, symbol)}</span> — saving {money(result.savings, symbol)}</div>
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="After first discount" value={money(result.afterFirst, symbol)} />
        <Stat label="After all discounts" value={money(result.afterSecond, symbol)} />
        <Stat label={result.t ? `Tax at ${result.t}%` : 'Tax'} value={money(result.taxAmount, symbol)} />
        <Stat label="Effective discount" value={`${result.effective.toFixed(2)}%`} />
        <Stat label="Actual saving" value={money(result.savings, symbol)} />
        <Stat label="Discount steps" value={result.d2 ? `${result.d1}% then ${result.d2}%` : `${result.d1}%`} />
        <Stat label="Total reduction" value={money(result.p - result.final, symbol)} />
        <Stat label="Price per 100" value={result.p ? `${money((result.final / result.p) * 100, symbol)}` : '—'} />
      </div>
      <p className="text-[11px] text-muted-foreground">Stacked discounts multiply rather than add: 30% then 10% is a 37% total reduction, not 40%.</p>
    </ToolShell>
  );
}