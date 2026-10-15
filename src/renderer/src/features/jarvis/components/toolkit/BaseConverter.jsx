import { useState } from 'react';
import { Binary } from 'lucide-react';
import { ToolHeader, Field, Seg, CopyBtn, Stat, Panel } from './shared';

const BASES = [
  { value: 2, label: 'Binary' },
  { value: 8, label: 'Octal' },
  { value: 10, label: 'Decimal' },
  { value: 16, label: 'Hex' },
];

function parseValue(str, base) {
  const s = str.trim().toLowerCase().replace(/^0[bxo]/, '').replace(/[\s_]/g, '');
  if (!s) return 0n;
  let value = 0n;
  const b = BigInt(base);
  for (const ch of s) {
    const d = parseInt(ch, 36);
    if (Number.isNaN(d) || d >= base) throw new Error(`“${ch}” is not a digit in base ${base}`);
    value = value * b + BigInt(d);
  }
  return value;
}

export default function BaseConverter() {
  const [input, setInput] = useState('11111111');
  const [base, setBase] = useState(2);
  const [custom, setCustom] = useState(36);

  let value = 0n;
  let error = null;
  try { value = parseValue(input, base); } catch (e) { error = e.message; }
  if (!error && value > (2n ** 256n)) error = 'Number too large (256-bit limit)';

  const bin = error ? '' : value.toString(2);
  const grouped = bin.replace(/\B(?=(.{4})+$)/g, ' ');
  const outputs = [['Binary (2)', bin], ['Octal (8)', value.toString(8)], ['Decimal (10)', value.toString(10)], ['Hexadecimal (16)', value.toString(16).toUpperCase()], [`Custom (${custom})`, value.toString(Number(custom) || 36).toUpperCase()]];

  return (
    <div className="space-y-4">
      <ToolHeader icon={Binary} title="Number Base Converter" desc="Convert between binary, octal, decimal, hex — or any base up to 36." />
      <Field label="Input value">
        <input value={input} onChange={(e) => setInput(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>
      <Seg value={base} onChange={setBase} options={BASES} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Custom output base (2–36)">
          <input type="number" min={2} max={36} value={custom} onChange={(e) => setCustom(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Bit length" value={error ? '—' : String(bin.length)} />
          <Stat label="Bytes" value={error ? '—' : String(Math.ceil(bin.length / 8))} />
        </div>
      </div>
      {error ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{error}</div>
      ) : (
        <>
          <Panel>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Bit view (nibbles)</span>
              <CopyBtn value={grouped} />
            </div>
            <div className="break-all font-mono-j text-sm text-cyan-j">{grouped}</div>
          </Panel>
          <div className="grid gap-2 sm:grid-cols-2">
            {outputs.map(([label, val]) => (
              <div key={label} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                  <div className="truncate font-mono-j text-sm">{val || '0'}</div>
                </div>
                <CopyBtn value={val} label="" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}