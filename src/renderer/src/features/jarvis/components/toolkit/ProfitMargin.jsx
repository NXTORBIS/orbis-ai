import { useState } from 'react';
import { Percent } from 'lucide-react';
import { ToolHeader, Field, Stat, Panel } from './shared';

export default function ProfitMargin() {
  const [cost, setCost] = useState(800);
  const [price, setPrice] = useState(1200);
  const [qty, setQty] = useState(50);
  const [target, setTarget] = useState(40);
  const [fees, setFees] = useState(0);

  const c = Number(cost) || 0;
  const s = Number(price) || 0;
  const q = Math.max(0, Number(qty) || 0);
  const fee = (s * ((Number(fees) || 0) / 100));
  const net = s - fee;
  const profit = net - c;
  const margin = net > 0 ? (profit / net) * 100 : 0;
  const markup = c > 0 ? (profit / c) * 100 : 0;
  const priceForTarget = (Number(target) || 0) >= 100 ? null : c / (1 - (Number(target) || 0) / 100) / (1 - (Number(fees) || 0) / 100);
  const money = (v) => `₹${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const tone = profit >= 0 ? 'text-cyan-j' : 'text-red-500';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <ToolHeader icon={Percent} title="Profit & Margin Calculator" desc="Margin, markup, break-even price and the price needed for a target margin." />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cost price (per unit)"><input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Selling price (per unit)"><input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Units sold"><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Marketplace fee %"><input type="number" step={0.1} value={fees} onChange={(e) => setFees(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>
      <Field label={`Target margin · ${target}%`}>
        <input type="range" min={0} max={90} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Profit per unit</div>
        <div className={`font-display text-4xl font-bold tabular-nums ${tone}`}>{money(profit)}</div>
        <div className="mt-1 text-xs text-muted-foreground">Margin {margin.toFixed(1)}% · Markup {markup.toFixed(1)}%</div>
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Total revenue" value={money(net * q)} mono />
        <Stat label="Total cost" value={money(c * q)} mono />
        <Stat label="Total profit" value={money(profit * q)} mono />
        <Stat label="Break-even units" value={profit > 0 ? String(Math.ceil((c * q) / profit)) : '—'} />
        <Stat label="Fees paid (unit)" value={money(fee)} mono />
        <Stat label="Margin" value={`${margin.toFixed(1)}%`} />
        <Stat label="Markup" value={`${markup.toFixed(1)}%`} />
        <Stat label="Price for target margin" value={priceForTarget ? money(priceForTarget) : 'Unreachable'} mono />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Margin is measured against the selling price after fees; markup is measured against cost.
        {priceForTarget ? ` To hit a ${target}% margin you would charge ${money(priceForTarget)} per unit.` : ` A ${target}% margin is mathematically unreachable with these fees.`}
      </p>
    </div>
  );
}