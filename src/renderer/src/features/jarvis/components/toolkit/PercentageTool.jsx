import { useState } from 'react';
import { Percent } from 'lucide-react';
import { ToolHeader, Field, Seg, Out, Stat } from './shared';

const MODES = {
  of: { label: 'X % of Y', a: 'Percentage (X)', b: 'Of value (Y)' },
  is: { label: 'X is what % of Y', a: 'Value (X)', b: 'Total (Y)' },
  change: { label: 'Percentage change', a: 'From', b: 'To' },
  reverse: { label: 'X % of what?', a: 'Percentage (X)', b: 'Result value' },
  diff: { label: 'Difference between two', a: 'First value', b: 'Second value' },
};

export default function PercentageTool() {
  const [mode, setMode] = useState('of');
  const [a, setA] = useState('15');
  const [b, setB] = useState('250');

  const x = Number(a) || 0;
  const y = Number(b) || 0;
  let out = '';
  let formula = '';
  if (mode === 'of') { out = `${((x / 100) * y).toLocaleString(undefined, { maximumFractionDigits: 4 })}`; formula = `${x}% × ${y} = ${x}/100 × ${y}`; }
  if (mode === 'is') { out = y === 0 ? 'undefined' : `${((x / y) * 100).toFixed(2)}%`; formula = `${x} ÷ ${y} × 100`; }
  if (mode === 'change') {
    const change = x === 0 ? null : ((y - x) / Math.abs(x)) * 100;
    out = change === null ? 'undefined' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}% ${change >= 0 ? 'increase' : 'decrease'}`;
    formula = `(${y} − ${x}) ÷ |${x}| × 100`;
  }
  if (mode === 'reverse') { out = x === 0 ? 'undefined' : `${((y / x) * 100).toLocaleString(undefined, { maximumFractionDigits: 4 })}`; formula = `${y} ÷ ${x} × 100`; }
  if (mode === 'diff') { out = x + y === 0 ? 'undefined' : `${((Math.abs(x - y) / (Math.abs(x + y) / 2)) * 100).toFixed(2)}%`; formula = `|${x} − ${y}| ÷ ((${x} + ${y}) ÷ 2) × 100`; }

  return (
    <div className="space-y-4">
      <ToolHeader icon={Percent} title="Percentage Toolkit" desc="Five ways to work with percentages — each one shows the formula it used." />
      <Seg value={mode} onChange={setMode} options={Object.entries(MODES).map(([value, m]) => ({ value, label: m.label }))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={MODES[mode].a}><input value={a} onChange={(e) => setA(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={MODES[mode].b}><input value={b} onChange={(e) => setB(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>
      <Out label={MODES[mode].label} value={out}>
        <div className="font-display text-3xl font-bold text-cyan-j">{out || '—'}</div>
      </Out>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Formula" value={formula} mono />
        <Stat label="As fraction" value={mode === 'of' ? `${x}/100` : '—'} mono />
        <Stat label="As decimal" value={mode === 'of' ? (x / 100).toFixed(4) : '—'} mono />
      </div>
    </div>
  );
}