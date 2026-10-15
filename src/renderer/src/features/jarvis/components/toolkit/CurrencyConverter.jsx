import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Coins, Loader2 } from 'lucide-react';
import { base44 } from '@jarvis/api/base44Client';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const POPULAR = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'SGD', 'AED', 'CHF'];
const NAMES = {
  USD: 'US dollar', EUR: 'Euro', GBP: 'British pound', INR: 'Indian rupee', JPY: 'Japanese yen', AUD: 'Australian dollar',
  CAD: 'Canadian dollar', SGD: 'Singapore dollar', AED: 'UAE dirham', CHF: 'Swiss franc', CNY: 'Chinese yuan',
  ZAR: 'South African rand', BRL: 'Brazilian real', NZD: 'New Zealand dollar', SEK: 'Swedish krona', NOK: 'Norwegian krone',
  MXN: 'Mexican peso', HKD: 'Hong Kong dollar', KRW: 'South Korean won', TRY: 'Turkish lira', RUB: 'Russian ruble',
  IDR: 'Indonesian rupiah', MYR: 'Malaysian ringgit', THB: 'Thai baht', PHP: 'Philippine peso', VND: 'Vietnamese dong',
  PKR: 'Pakistani rupee', BDT: 'Bangladeshi taka', LKR: 'Sri Lankan rupee', NPR: 'Nepalese rupee', SAR: 'Saudi riyal',
  QAR: 'Qatari riyal', KWD: 'Kuwaiti dinar', EGP: 'Egyptian pound', NGN: 'Nigerian naira', KES: 'Kenyan shilling',
  PLN: 'Polish zloty', CZK: 'Czech koruna', DKK: 'Danish krone', HUF: 'Hungarian forint', ILS: 'Israeli shekel',
  ARS: 'Argentine peso', CLP: 'Chilean peso', COP: 'Colombian peso', PEN: 'Peruvian sol', TWD: 'Taiwan dollar',
};

export default function CurrencyConverter() {
  const [base, setBase] = useState('USD');
  const [target, setTarget] = useState('INR');
  const [amount, setAmount] = useState('100');
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');

  const fetchRates = useCallback(async (currency) => {
    setLoading(true);
    setError('');
    try {
      const response = await base44.functions.invoke('fxRates', { base: currency });
      const data = response?.data ?? {};
      if (data.error || !data.rates) {
        setError(data.error || 'Live rates are unavailable right now — try again in a moment.');
        setTable(null);
        return;
      }
      setTable({ base: data.base, rates: data.rates, source: data.source });
      setUpdated(data.date || new Date().toISOString().slice(0, 10));
    } catch (e) {
      setError('Could not reach the rate service. Check your connection and try again.');
      setTable(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRates(base); }, [base, fetchRates]);

  const codes = useMemo(() => {
    const list = Object.keys(table?.rates ?? {});
    return [...new Set([...POPULAR, ...list])].filter((code) => list.includes(code) || POPULAR.includes(code)).sort();
  }, [table]);

  const rate = table?.rates?.[target];
  const value = Number(String(amount).replace(/,/g, '')) || 0;
  const converted = rate ? value * rate : null;

  const format = (number, code) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: number && Math.abs(number) < 1 ? 4 : 2 }).format(number);
    } catch {
      return `${code} ${number?.toFixed(2)}`;
    }
  };

  const swap = () => { setBase(target); setTarget(base); };

  const others = POPULAR.filter((code) => code !== base && code !== target).slice(0, 8);

  const report = rate
    ? `${value} ${base} = ${converted?.toFixed(2)} ${target}\n1 ${base} = ${rate} ${target}\n1 ${target} = ${(1 / rate).toFixed(6)} ${base}\nRates: ${table.source} · ${updated}`
    : '';

  return (
    <ToolShell
      toolId="currency"
      icon={Coins}
      title="Currency Converter"
      desc="Convert any of 160+ currencies with live daily rates, a rate table at a glance and the inverse rate for checking your maths."
      state={{ base, target, amount }}
      onRestore={(restored) => {
        if (restored.base) setBase(restored.base);
        if (restored.target) setTarget(restored.target);
        if (restored.amount !== undefined) setAmount(String(restored.amount));
      }}
      exportText={report}
      exportName="conversion.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fetchRates(base)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Coins className="h-3.5 w-3.5" />} Refresh rates
        </button>
        <CopyBtn value={report} label="Copy conversion" />
        {updated && <span className="text-[11px] text-muted-foreground">Rates updated {updated}{table?.source ? ` · ${table.source}` : ''}</span>}
      </div>

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <Field label="Amount">
          <div className="flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm"
            />
            <select value={base} onChange={(e) => setBase(e.target.value)} className="h-9 w-28 rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
              {codes.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>
        </Field>
        <button
          type="button"
          onClick={swap}
          title="Swap currencies"
          className="mx-auto grid h-9 w-9 place-items-center rounded-lg border border-border/70 text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
        <Field label="Converted to">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
            {codes.map((code) => <option key={code} value={code}>{code}{NAMES[code] ? ` — ${NAMES[code]}` : ''}</option>)}
          </select>
        </Field>
      </div>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {value.toLocaleString()} {base} in {target}
        </div>
        <div className="tk-title-glow mt-1 break-all font-mono-j text-3xl font-semibold text-cyan-j">
          {loading ? '…' : converted === null ? '—' : format(converted, target)}
        </div>
        {rate && (
          <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">
            1 {base} = {rate} {target} · 1 {target} = {(1 / rate).toFixed(6)} {base}
          </div>
        )}
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Also worth in</div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {others.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setTarget(code)}
              className="tk-card rounded-lg border border-border/60 bg-card/40 px-2 py-1.5 text-left transition hover:border-cyan-j/40"
            >
              <div className="font-mono-j text-[10px] text-muted-foreground">{code}</div>
              <div className="font-mono-j text-[12px]">{table?.rates?.[code] ? format(value * table.rates[code], code) : '—'}</div>
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Currencies" value={table ? String(Object.keys(table.rates).length) : '—'} mono />
        <Stat label="Base" value={base} mono />
        <Stat label="Inverse rate" value={rate ? (1 / rate).toFixed(6) : '—'} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          These are daily reference rates from a public exchange-rate feed — perfect for invoicing, travel budgeting and price comparison, but not a
          live trading quote. Banks and cards add their own spread on top, so expect the amount you are actually charged to differ slightly.
        </p>
      </Panel>
    </ToolShell>
  );
}