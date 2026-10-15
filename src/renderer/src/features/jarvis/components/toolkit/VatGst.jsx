import { useMemo, useState } from 'react';
import { Receipt } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel, CopyBtn } from './shared';
import ToolShell from './kit/ToolShell';

const CURRENCIES = [['$', 'USD  $'], ['₹', 'INR  ₹'], ['€', 'EUR  €'], ['£', 'GBP  £']];
const RATES = [5, 7.5, 12, 15, 18, 20, 28];

const money = (value, symbol) => `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function VatGst() {
  const [mode, setMode] = useState('add');
  const [amount, setAmount] = useState('1000');
  const [rate, setRate] = useState('18');
  const [symbol, setSymbol] = useState('$');

  const result = useMemo(() => {
    const value = Number(amount) || 0;
    const r = Math.max(0, Number(rate) || 0);
    if (mode === 'add') {
      const tax = value * (r / 100);
      return { net: value, tax, gross: value + tax };
    }
    const net = value / (1 + r / 100);
    return { net, tax: value - net, gross: value };
  }, [amount, rate, mode]);

  const breakdown = [
    ['Net (before tax)', money(result.net, symbol)],
    [`Tax at ${rate}%`, money(result.tax, symbol)],
    ['Gross (with tax)', money(result.gross, symbol)],
  ];

  return (
    <ToolShell
      toolId="vat-gst"
      icon={Receipt}
      title="VAT / GST Calculator"
      desc="Add tax to a price, or work backwards from a tax-inclusive total."
      state={{ mode, amount, rate, symbol }}
      onRestore={(saved) => { setMode(saved.mode); setAmount(saved.amount); setRate(saved.rate); setSymbol(saved.symbol); }}
      exportText={JSON.stringify(result, null, 2)}
      exportName="vat.json"
      exportMime="application/json"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'add', label: 'Add tax to net' }, { value: 'remove', label: 'Extract tax from gross' }]} />
      <Seg value={symbol} onChange={setSymbol} options={CURRENCIES.map(([value, label]) => ({ value, label }))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={mode === 'add' ? 'Amount before tax' : 'Total including tax'}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Tax rate %">
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {RATES.map((r) => (
          <button key={r} onClick={() => setRate(String(r))} className={`rounded-lg border px-2.5 py-1 text-xs transition ${Number(rate) === r ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>{r}%</button>
        ))}
      </div>
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{mode === 'add' ? 'Total to charge' : 'Net before tax'}</div>
        <div className="mt-1 font-display text-4xl font-bold text-cyan-j">{money(mode === 'add' ? result.gross : result.net, symbol)}</div>
      </Panel>
      <div className="grid gap-2 sm:grid-cols-3">
        {breakdown.map(([label, value]) => <Stat key={label} label={label} value={value} />)}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Tax as % of gross" value={result.gross ? `${((result.tax / result.gross) * 100).toFixed(2)}%` : '—'} />
        <Stat label="Tax as % of net" value={result.net ? `${((result.tax / result.net) * 100).toFixed(2)}%` : '—'} />
        <Stat label="Gross / net ratio" value={result.net ? (result.gross / result.net).toFixed(4) : '—'} />
        <Stat label="Reverse rate" value={mode === 'add' ? `divide by ${(1 + (Number(rate) || 0) / 100).toFixed(4)}` : `multiply by ${(1 + (Number(rate) || 0) / 100).toFixed(4)}`} />
      </div>
      <CopyBtn value={breakdown.map(([label, value]) => `${label}: ${value}`).join('\n')} label="Copy breakdown" />
      {mode === 'remove' && <p className="text-[11px] text-muted-foreground">Extracting tax divides the gross by (1 + rate), so the tax you recover is always less than rate% of the gross.</p>}
    </ToolShell>
  );
}