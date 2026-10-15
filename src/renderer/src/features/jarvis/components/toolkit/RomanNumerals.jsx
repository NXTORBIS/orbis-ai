import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { ToolHeader, Field, Out, Stat, Panel } from './shared';

const TABLE = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return null;
  let rest = n;
  let out = '';
  for (const [value, sym] of TABLE) { while (rest >= value) { out += sym; rest -= value; } }
  return out;
}

export function fromRoman(s) {
  const t = s.trim().toUpperCase();
  if (!/^[MDCLXVI]+$/.test(t)) return null;
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = VALUES[t[i]];
    const next = VALUES[t[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total;
}

export default function RomanNumerals() {
  const [num, setNum] = useState('1987');
  const [roman, setRoman] = useState('MCMLXXXVII');

  const romanFromNum = toRoman(parseInt(num, 10));
  const numFromRoman = fromRoman(roman);
  const valid = romanFromNum !== null;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Landmark} title="Roman Numerals" desc="Convert numbers to Roman numerals and back, with validation." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Number (1 – 3999)">
          <input value={num} onChange={(e) => setNum(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Roman numeral">
          <input value={roman} onChange={(e) => setRoman(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j uppercase text-sm" />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Out label="Number → Roman" value={romanFromNum || ''}>
          <span className={`font-display text-lg tracking-[0.2em] ${valid ? 'text-cyan-j' : 'text-red-500'}`}>{valid ? romanFromNum : 'Out of range (1–3999)'}</span>
        </Out>
        <Out label="Roman → Number" value={numFromRoman ?? ''}>
          <span className={`font-display text-lg ${numFromRoman !== null ? 'text-cyan-j' : 'text-red-500'}`}>{numFromRoman !== null ? numFromRoman : 'Not a valid Roman numeral'}</span>
        </Out>
      </div>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Reference</div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {TABLE.map(([v, s]) => (
            <button key={s} onClick={() => { setNum(String(v)); setRoman(s); }} className="rounded-lg border border-border/70 bg-card/60 px-2 py-1.5 text-center transition hover:border-cyan-j/50">
              <div className="font-display text-sm text-cyan-j">{s}</div>
              <div className="text-[10px] text-muted-foreground">{v}</div>
            </button>
          ))}
        </div>
      </Panel>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Symbols" value={String((romanFromNum || '').length)} />
        <Stat label="Round trip" value={valid ? `${num} = ${romanFromNum}` : '—'} mono />
      </div>
    </div>
  );
}