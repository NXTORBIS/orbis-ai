import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { money } from './invoiceDocument';

export function LineItemRow({ item, currency, onChange, onRemove, canRemove }) {
  const amount = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  const number = (value) => (value === '' ? '' : String(value));
  return (
    <div className="tk-card tk-depth grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5 sm:grid-cols-[1fr_78px_104px_auto_auto] sm:items-center">
      <input
        value={item.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="What you did"
        className="col-span-2 h-9 rounded-md border border-input bg-transparent px-2.5 text-sm sm:col-span-1"
      />
      <input
        value={number(item.qty)}
        onChange={(e) => onChange({ qty: e.target.value === '' ? '' : Number(e.target.value) })}
        inputMode="decimal"
        placeholder="Qty"
        className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm"
      />
      <input
        value={number(item.rate)}
        onChange={(e) => onChange({ rate: e.target.value === '' ? '' : Number(e.target.value) })}
        inputMode="decimal"
        placeholder="Rate"
        className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm"
      />
      <span className="col-span-2 text-right font-mono-j text-xs text-muted-foreground sm:col-span-1 sm:min-w-[86px]">
        {money(amount, currency)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        title="Remove this line"
        className="justify-self-end text-muted-foreground transition hover:text-red-500 disabled:opacity-30"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function AddLineButton({ onClick }) {
  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick} className="gap-1.5">
      <Plus className="h-3.5 w-3.5" /> Add a line
    </Button>
  );
}

export function TotalsSummary({ totals, currency }) {
  const row = (label, value, tone) => (
    <div className={`flex items-center justify-between gap-3 text-xs ${tone ?? ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono-j tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {row('Subtotal', money(totals.subtotal, currency))}
      {totals.discount > 0 && row('Discount', `−${money(totals.discount, currency)}`, 'text-amber-400')}
      {totals.tax > 0 && row('Tax', money(totals.tax, currency))}
      <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-2 text-sm font-semibold">
        <span>Total</span>
        <span className="font-mono-j tabular-nums text-cyan-j">{money(totals.total, currency)}</span>
      </div>
      {totals.paid > 0 && row('Paid', `−${money(totals.paid, currency)}`)}
      {totals.paid > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 text-xs font-medium">
          <span>Balance due</span>
          <span className="font-mono-j tabular-nums">{money(totals.balance, currency)}</span>
        </div>
      )}
    </div>
  );
}