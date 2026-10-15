import { useMemo, useState } from 'react';
import { Hash } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const LOCALES = [
  { id: 'en-US', label: 'International', hint: '1,234,567.89' },
  { id: 'en-IN', label: 'Indian', hint: '12,34,567.89' },
  { id: 'de-DE', label: 'European', hint: '1.234.567,89' },
  { id: 'fr-CH', label: 'Swiss', hint: "1'234'567.89" },
  { id: 'ar-EG', label: 'Arabic-Indic', hint: '١٬٢٣٤٬٥٦٧' },
];

const CURRENCIES = ['USD', 'EUR', 'INR', 'GBP', 'JPY', 'AUD', 'CAD', 'AED', 'SGD', 'CHF'];

const suffixFor = (n) => {
  const i = Math.abs(Math.round(n)) % 100;
  if (i >= 11 && i <= 13) return 'th';
  const j = i % 10;
  if (j === 1) return 'st';
  if (j === 2) return 'nd';
  if (j === 3) return 'rd';
  return 'th';
};

const clean = (n, digits) => Number(n.toFixed(digits)).toString();

export default function NumberFormatter() {
  const [raw, setRaw] = useState('1234567.891');
  const [opts, setOpts] = useState({
    locale: 'en-US',
    decimals: 2,
    currency: 'INR',
    addGrouped: true,
    addCompact: true,
    addScientific: true,
    addOrdinal: true,
    addPercent: true,
    addCurrency: true,
  });

  const set = (key) => (value) => setOpts((o) => ({ ...o, [key]: value }));

  const rows = useMemo(() => {
    const n = Number(String(raw).replace(/[,\s_]/g, ''));
    if (!Number.isFinite(n)) return [];
    const list = [];
    const digits = { minimumFractionDigits: opts.decimals, maximumFractionDigits: opts.decimals };
    const attempt = (label, fn) => {
      try {
        const value = fn();
        if (value !== '' && value !== null && value !== undefined) list.push({ label, value: String(value) });
      } catch {
        /* locale or currency unsupported in this browser — skip that row */
      }
    };
    attempt('Plain (no grouping)', () => n.toFixed(opts.decimals));
    LOCALES.forEach((l) => attempt(`${l.label} · ${l.hint}`, () => new Intl.NumberFormat(l.id, digits).format(n)));
    if (opts.addCompact) attempt('Compact', () => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n));
    if (opts.addScientific) attempt('Scientific', () => n.toExponential(Math.min(8, opts.decimals + 2)));
    if (opts.addOrdinal) attempt('Ordinal', () => `${new Intl.NumberFormat(opts.locale, digits).format(n)}${suffixFor(n)}`);
    if (opts.addPercent) attempt('As a percentage', () => new Intl.NumberFormat('en-US', { style: 'percent', ...digits }).format(n / 100));
    if (opts.addCurrency) attempt(`Currency (${opts.currency})`, () => new Intl.NumberFormat('en-US', { style: 'currency', currency: opts.currency, ...digits }).format(n));
    attempt('Rounded', () => new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 0 }).format(n));
    return list;
  }, [raw, opts]);

  const exportText = rows.map((r) => `${r.label}: ${r.value}`).join('\n');

  return (
    <ToolShell
      toolId="number-format"
      icon={Hash}
      title="Number Formatter"
      desc="See one number written every way — grouped, compact, ordinal, as currency or a percentage."
      state={{ raw, opts }}
      onRestore={(saved) => { setRaw(saved.raw); if (saved.opts) setOpts({ ...opts, ...saved.opts }); }}
      exportText={exportText}
      exportName="formats.txt"
    >
      <Field label="Number">
        <input value={raw} onChange={(e) => setRaw(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>

      <Field label="Decimal places">
        <Seg
          value={opts.decimals}
          onChange={(v) => set('decimals')(Number(v))}
          options={[0, 1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Rounding locale</span>
        <select value={opts.locale} onChange={(e) => set('locale')(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs">
          {LOCALES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <span className="text-[11px] text-muted-foreground">Currency</span>
        <select value={opts.currency} onChange={(e) => set('currency')(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs">
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Compact" checked={opts.addCompact} onChange={set('addCompact')} hint="1.2M" />
        <ToggleRow label="Scientific" checked={opts.addScientific} onChange={set('addScientific')} hint="1.2e6" />
        <ToggleRow label="Ordinal" checked={opts.addOrdinal} onChange={set('addOrdinal')} hint="1,235th" />
        <ToggleRow label="Percentage" checked={opts.addPercent} onChange={set('addPercent')} hint="/100" />
        <ToggleRow label="Currency" checked={opts.addCurrency} onChange={set('addCurrency')} />
      </div>

      <Stat label="Rows shown" value={String(rows.length)} />

      <Panel>
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
              <span className="w-40 shrink-0 truncate text-[11px] text-muted-foreground">{r.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono-j text-xs">{r.value}</span>
              <CopyBtn value={r.value} />
            </div>
          ))}
          {!rows.length && <p className="py-4 text-center text-[11px] text-muted-foreground">Enter a number to format.</p>}
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Grouping, decimal marks and digits come from your browser's own internationalisation data, so what you see here is exactly what a browser in that region shows.
          {raw.includes(',') ? ' Commas and spaces in your input are ignored.' : ''} {rows.length ? `Last row rounds away the decimals (${clean(Number(String(raw).replace(/[,\s_]/g, '')), 0)}).` : ''}
        </p>
      </Panel>
    </ToolShell>
  );
}