import { useMemo, useState } from 'react';
import { BadgePercent, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const UNITS = [
  { id: 'g', label: 'grams', base: 1, display: 'per 100 g', factor: 100 },
  { id: 'kg', label: 'kilograms', base: 1000, display: 'per kg', factor: 1 },
  { id: 'ml', label: 'millilitres', base: 1, display: 'per 100 ml', factor: 100 },
  { id: 'L', label: 'litres', base: 1000, display: 'per litre', factor: 1 },
  { id: 'pcs', label: 'pieces', base: 1, display: 'per piece', factor: 1 },
  { id: 'm', label: 'metres', base: 1, display: 'per metre', factor: 1 },
];

const uid = () => Math.random().toString(36).slice(2, 8);

const ROWS = [
  { id: uid(), name: 'Own brand coffee 250 g', price: '6.20', qty: '250', unit: 'g' },
  { id: uid(), name: 'Roaster coffee 1 kg', price: '21.50', qty: '1', unit: 'kg' },
  { id: uid(), name: 'Cafe pack 500 g', price: '11.10', qty: '500', unit: 'g' },
];

const money = (value) => (Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });

export default function UnitPrice() {
  const [rows, setRows] = useState(ROWS);
  const [need, setNeed] = useState('1000');

  const computed = useMemo(() => {
    const priced = rows.map((row) => {
      const unit = UNITS.find((u) => u.id === row.unit) || UNITS[0];
      const base = (Number(row.qty) || 0) * unit.base;
      const total = Number(row.price) || 0;
      return { ...row, unitLabel: unit, base, total, perBase: base ? total / base : 0, perDisplay: base ? (total / base) * unit.factor : 0, display: unit.display };
    });
    const valid = priced.filter((row) => row.perBase > 0);
    const best = valid.length ? valid.reduce((a, b) => (b.perBase < a.perBase ? b : a)) : null;
    const worst = valid.length ? valid.reduce((a, b) => (b.perBase > a.perBase ? b : a)) : null;
    return {
      priced: priced.map((row) => ({
        ...row,
        saving: best && row.perBase ? ((row.perBase - best.perBase) / row.perBase) * 100 : 0,
        isBest: best ? row.id === best.id : false,
      })),
      best,
      worst,
    };
  }, [rows]);

  const needCosts = computed.priced
    .filter((row) => row.perBase > 0)
    .map((row) => ({ name: row.name, cost: row.perBase * (Number(need) || 0), isBest: row.isBest }))
    .sort((a, b) => a.cost - b.cost);

  const setRow = (id, patch) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const report = computed.priced.map((row) => `${row.name}: ${money(row.price)} for ${row.qty} ${row.unitLabel.label} = ${money(row.perDisplay)} ${row.display}${row.isBest ? '  ← best value' : ` (+${row.saving.toFixed(1)}% vs best)`}`).join('\n');

  return (
    <ToolShell
      toolId="unit-price"
      icon={BadgePercent}
      title="Unit Price & Best Value"
      desc="Compare packs of different sizes honestly — price per gram, litre or piece, with the real gap between the cheapest and the rest."
      state={{ rows, need }}
      onRestore={(restored) => {
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
        if (restored.need !== undefined) setNeed(String(restored.need));
      }}
      exportText={report}
      exportName="unit-price.txt"
    >
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className={`tk-card tk-depth grid grid-cols-[1fr_auto] gap-2 rounded-xl border p-2.5 sm:grid-cols-[1fr_84px_74px_110px_96px_auto] sm:items-center ${computed.priced.find((r) => r.id === row.id)?.isBest ? 'border-cyan-j/60 bg-cyan-j/5' : 'border-border/70 bg-gradient-to-b from-card/75 to-card/40'}`}>
            <input value={row.name} onChange={(e) => setRow(row.id, { name: e.target.value })} placeholder="Product" className="col-span-2 h-9 rounded-md border border-input bg-transparent px-2.5 text-sm sm:col-span-1" />
            <input value={row.price} onChange={(e) => setRow(row.id, { price: e.target.value })} inputMode="decimal" placeholder="Price" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <input value={row.qty} onChange={(e) => setRow(row.id, { qty: e.target.value })} inputMode="decimal" placeholder="Size" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <select value={row.unit} onChange={(e) => setRow(row.id, { unit: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              {UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
            <span className="col-span-2 text-right font-mono-j text-[11px] text-cyan-j sm:col-span-1">
              {computed.priced.find((r) => r.id === row.id)?.perDisplay ? `${money(computed.priced.find((r) => r.id === row.id).perDisplay)} ${computed.priced.find((r) => r.id === row.id).display}` : '—'}
            </span>
            <button type="button" onClick={() => setRows(rows.filter((r) => r.id !== row.id))} disabled={rows.length <= 2} className="justify-self-end text-muted-foreground transition hover:text-red-500 disabled:opacity-30">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRows((current) => [...current, { id: uid(), name: '', price: '', qty: '1', unit: 'kg' }].slice(0, 6))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add another option
        </button>
        <CopyBtn value={report} label="Copy comparison" />
      </div>

      {computed.best && (
        <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Best value</div>
          <div className="tk-title-glow mt-1 text-lg font-semibold text-cyan-j">{computed.best.name || 'Untitled option'}</div>
          <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">
            {money(computed.best.perDisplay)} {computed.best.display}
            {computed.worst && computed.worst.id !== computed.best.id ? ` · the priciest is ${(((computed.worst.perBase - computed.best.perBase) / computed.best.perBase) * 100).toFixed(0)}% more per unit` : ''}
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="How much do you need in total?" hint="In the same base unit — grams, millilitres, pieces">
          <input value={need} onChange={(e) => setNeed(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Seg value="note" onChange={() => {}} options={[{ value: 'note', label: 'Cost for that amount, each option' }]} />
      </div>

      <Panel className="!p-3">
        <div className="space-y-1.5">
          {needCosts.map((item) => (
            <div key={item.name} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] ${item.isBest ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/50 bg-card/40'}`}>
              <span className="truncate">{item.name || 'Untitled option'}</span>
              <span className="font-mono-j">{money(item.cost)}</span>
            </div>
          ))}
          {!needCosts.length && <span className="text-[11px] text-muted-foreground">Fill in prices and sizes to compare.</span>}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Options compared" value={String(computed.priced.length)} mono />
        <Stat label="Cheapest per unit" value={computed.best ? money(computed.best.perDisplay) : '—'} mono />
        <Stat label="Spread" value={computed.best && computed.worst ? `${(((computed.worst.perBase - computed.best.perBase) / computed.best.perBase) * 100).toFixed(0)}%` : '—'} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The big pack is not always the better deal — promo pricing and pack sizes shift the maths constantly, which is exactly why this is worth
          thirty seconds in the aisle. Only compare like with like: solids by weight, liquids by volume, and count items by piece.
        </p>
      </Panel>
    </ToolShell>
  );
}