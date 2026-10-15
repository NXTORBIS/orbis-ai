import { useState } from 'react';
import { Receipt } from 'lucide-react';
import { ToolHeader, Field, Stat, Panel, ToggleRow } from './shared';

const TIPS = [5, 10, 12.5, 15, 18, 20];

export default function TipSplitter() {
  const [bill, setBill] = useState(1250);
  const [tip, setTip] = useState(10);
  const [people, setPeople] = useState(4);
  const [tax, setTax] = useState(0);
  const [round, setRound] = useState(false);
  const [symbol, setSymbol] = useState('₹');

  const base = Number(bill) || 0;
  const taxAmount = base * ((Number(tax) || 0) / 100);
  const tipAmount = base * ((Number(tip) || 0) / 100);
  const total = base + taxAmount + tipAmount;
  const n = Math.max(1, Number(people) || 1);
  const exact = total / n;
  const perPerson = round ? Math.ceil(exact) : exact;
  const extra = round ? perPerson * n - total : 0;

  const money = (v) => `${symbol}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Receipt} title="Tip & Bill Splitter" desc="Work out the tip, tax and what each person owes — with optional rounding." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bill amount">
          <input type="number" value={bill} onChange={(e) => setBill(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Tax / service charge %">
          <input type="number" value={tax} onChange={(e) => setTax(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>
      <Field label={`Tip · ${tip}%`}>
        <input type="range" min={0} max={30} step={0.5} value={tip} onChange={(e) => setTip(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {TIPS.map((t) => (
          <button key={t} onClick={() => setTip(t)} className={`rounded-lg border px-2.5 py-1 text-xs transition ${tip === t ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>{t}%</button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="People">
          <input type="number" min={1} value={people} onChange={(e) => setPeople(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Currency symbol">
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={3} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <ToggleRow label="Round up per person" checked={round} onChange={setRound} />
      </div>
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Each person pays</div>
        <div className="font-display text-4xl font-bold tabular-nums text-cyan-j">{money(perPerson)}</div>
        {round && extra > 0 && <div className="mt-1 text-[11px] text-muted-foreground">{money(extra)} extra goes back to the payer</div>}
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Bill" value={money(base)} mono />
        <Stat label={`Tax (${tax || 0}%)`} value={money(taxAmount)} mono />
        <Stat label={`Tip (${tip}%)`} value={money(tipAmount)} mono />
        <Stat label="Total" value={money(total)} mono />
      </div>
      <p className="text-[11px] text-muted-foreground">Tip is calculated on the bill before tax. Exact split: {money(exact)} per person across {n} {n === 1 ? 'person' : 'people'}.</p>
    </div>
  );
}