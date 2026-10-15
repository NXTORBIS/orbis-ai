import { useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const money = (value) => {
  const number = Number(value) || 0;
  const rounded = Math.abs(number) >= 1000 ? Math.round(number) : Math.round(number * 100) / 100;
  return rounded.toLocaleString(undefined, { minimumFractionDigits: Math.abs(number) >= 1000 ? 0 : 2, maximumFractionDigits: 2 });
};

export default function BreakEven() {
  const [fixed, setFixed] = useState('4800');
  const [price, setPrice] = useState('39');
  const [variable, setVariable] = useState('16');
  const [volume, setVolume] = useState('400');

  const result = useMemo(() => {
    const f = Number(fixed) || 0;
    const p = Number(price) || 0;
    const v = Number(variable) || 0;
    const volumeValue = Number(volume) || 0;
    const margin = p - v;
    const breakEvenUnits = margin > 0 ? Math.ceil(f / margin) : Infinity;
    const breakEvenRevenue = Number.isFinite(breakEvenUnits) ? breakEvenUnits * p : Infinity;
    const marginPercent = p ? (margin / p) * 100 : 0;
    const profit = (p - v) * volumeValue - f;
    const safety = Number.isFinite(breakEvenUnits) ? volumeValue - breakEvenUnits : -Infinity;
    const safetyPercent = volumeValue ? (safety / volumeValue) * 100 : 0;
    const curve = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((factor) => {
      const units = Number.isFinite(breakEvenUnits) ? Math.round(breakEvenUnits * factor) : Math.round(volumeValue * factor);
      return { units, profit: (p - v) * units - f };
    });
    return { margin, breakEvenUnits, breakEvenRevenue, marginPercent, profit, safety, safetyPercent, curve };
  }, [fixed, price, variable, volume]);

  const invalid = Number(price) <= Number(variable);

  const report = [
    `Fixed costs: ${money(fixed)}`,
    `Price per unit: ${money(price)} · variable cost: ${money(variable)}`,
    `Contribution margin: ${money(result.margin)} (${result.marginPercent.toFixed(1)}%)`,
    `Break-even: ${Number.isFinite(result.breakEvenUnits) ? `${result.breakEvenUnits} units (${money(result.breakEvenRevenue)} revenue)` : 'never at this price'}`,
    `At ${volume} units: profit ${money(result.profit)}, margin of safety ${result.safetyPercent.toFixed(1)}%`,
  ].join('\n');

  return (
    <ToolShell
      toolId="break-even"
      icon={Scale}
      title="Break-even Calculator"
      desc="How many sales it really takes to cover your costs, the margin each unit contributes, and how much cushion you have at your volume."
      state={{ fixed, price, variable, volume }}
      onRestore={(restored) => {
        if (restored.fixed !== undefined) setFixed(String(restored.fixed));
        if (restored.price !== undefined) setPrice(String(restored.price));
        if (restored.variable !== undefined) setVariable(String(restored.variable));
        if (restored.volume !== undefined) setVolume(String(restored.volume));
      }}
      exportText={report}
      exportName="break-even.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Fixed costs per month" hint="rent, salaries, tools">
          <input value={fixed} onChange={(e) => setFixed(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Price per unit">
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Variable cost per unit" hint="materials, fees, shipping">
          <input value={variable} onChange={(e) => setVariable(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Units you expect to sell">
          <input value={volume} onChange={(e) => setVolume(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      {invalid && (
        <Panel className="border-amber-500/40 text-[11px] text-amber-500">
          Your variable cost is at or above your price, so every sale loses money — no volume can break even until that gap is closed.
        </Panel>
      )}

      {!invalid && (
        <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Break-even point</div>
          <div className="tk-title-glow mt-1 font-mono-j text-4xl font-semibold text-cyan-j">{Number.isFinite(result.breakEvenUnits) ? result.breakEvenUnits : '—'}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            units · {money(result.breakEvenRevenue)} in revenue · about {Math.ceil(result.breakEvenUnits / 30)} a day
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Contribution margin" value={money(result.margin)} sub={`${result.marginPercent.toFixed(1)}% of price`} mono />
        <Stat label="Profit at your volume" value={money(result.profit)} mono />
        <Stat label="Margin of safety" value={`${result.safetyPercent.toFixed(1)}%`} sub={`${Math.round(result.safety)} units of cushion`} mono />
        <Stat label="Units to break even" value={Number.isFinite(result.breakEvenUnits) ? String(result.breakEvenUnits) : '—'} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-3 text-xs font-medium">Profit as volume grows</div>
        <div className="flex h-32 items-end gap-1.5">
          {result.curve.map((point) => {
            const max = Math.max(...result.curve.map((c) => Math.abs(c.profit)), 1);
            const height = (Math.abs(point.profit) / max) * 100;
            return (
              <div key={point.units} className="flex flex-1 flex-col items-center gap-1">
                <span className="font-mono-j text-[9px] text-muted-foreground">{money(point.profit)}</span>
                <div className={`w-full rounded-t ${point.profit >= 0 ? 'bg-gradient-to-t from-cyan-j/30 to-cyan-j' : 'bg-gradient-to-t from-red-500/30 to-red-500'}`} style={{ height: `${Math.max(3, height)}%` }} />
                <span className="font-mono-j text-[9px] text-muted-foreground">{point.units}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Units along the bottom, profit above the bar — red is still below break-even.</p>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={report} label="Copy breakdown" />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Contribution margin is the number that decides everything here: raise the price or cut the per-unit cost and the break-even line drops fast.
          A margin of safety below about 20% means a slow month puts you under water, so that is usually the figure to fix first.
        </p>
      </Panel>
    </ToolShell>
  );
}