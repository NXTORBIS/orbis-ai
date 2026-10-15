import { useMemo, useState } from 'react';
import { Binary } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const OPS = [
  { id: 'and', label: 'AND', symbol: '&' },
  { id: 'or', label: 'OR', symbol: '|' },
  { id: 'xor', label: 'XOR', symbol: '^' },
  { id: 'not', label: 'NOT A', symbol: '~' },
  { id: 'shl', label: 'A <<', symbol: '<<' },
  { id: 'shr', label: 'A >>', symbol: '>>' },
];

const parseBig = (raw) => {
  const text = String(raw ?? '').trim().replace(/[\s_,]/g, '');
  if (!text) return null;
  try {
    if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text);
    if (/^0b[01]+$/i.test(text)) return BigInt(text);
    if (/^0o[0-7]+$/i.test(text)) return BigInt(text);
    if (/^-?\d+$/.test(text)) return BigInt(text);
    return null;
  } catch {
    return null;
  }
};

const MASK = (1n << 64n) - 1n;
const toBinary = (value, width = 64) => ((value & MASK) + (1n << BigInt(width))).toString(2).slice(-width);

export default function BitwiseCalculator() {
  const [a, setA] = useState('0b1101_0110');
  const [b, setB] = useState('0xFF');
  const [op, setOp] = useState('and');
  const [width, setWidth] = useState(16);

  const bigA = parseBig(a);
  const bigB = parseBig(b);

  const result = useMemo(() => {
    if (bigA === null) return { error: 'The first value is not a valid integer.', value: null };
    if (op !== 'not' && bigB === null) return { error: 'The second value is not a valid integer.', value: null };
    switch (op) {
      case 'and': return { value: bigA & bigB, error: '' };
      case 'or': return { value: bigA | bigB, error: '' };
      case 'xor': return { value: bigA ^ bigB, error: '' };
      case 'not': return { value: ~bigA, error: '' };
      case 'shl': return { value: bigA << bigB, error: Number(bigB) > 128 ? 'That shift is far too large to be meaningful.' : '' };
      case 'shr': return { value: bigA >> bigB, error: Number(bigB) > 128 ? 'That shift is far too large to be meaningful.' : '' };
      default: return { value: null, error: '' };
    }
  }, [bigA, bigB, op]);

  const value = result.value;
  const forms = value === null ? [] : [
    { label: 'Decimal', value: value.toString(10) },
    { label: 'Hex', value: `0x${((value & MASK)).toString(16).toUpperCase()}` },
    { label: 'Binary', value: toBinary(value, width) },
    { label: 'Octal', value: `0o${(value & MASK).toString(8)}` },
    { label: 'Unsigned 64-bit', value: (value & MASK).toString(10) },
    { label: 'Bit count (population)', value: [...toBinary(value, width)].filter((c) => c === '1').length.toString() },
  ];

  const bits = value === null ? '' : toBinary(value, width);
  const bitsA = bigA === null ? '' : toBinary(bigA, width);
  const bitsB = bigB === null ? '' : toBinary(bigB, width);

  const activeOp = OPS.find((o) => o.id === op);

  return (
    <ToolShell
      toolId="bitwise"
      icon={Binary}
      title="Bitwise Calculator"
      desc="AND, OR, XOR, NOT and shifts on values of any size — written in binary, hex, octal or decimal, with the bit grid to prove it."
      state={{ a, b, op, width }}
      onRestore={(restored) => {
        if (typeof restored.a === 'string') setA(restored.a);
        if (typeof restored.b === 'string') setB(restored.b);
        if (restored.op) setOp(restored.op);
        if (restored.width) setWidth(Number(restored.width));
      }}
      exportText={value === null ? '' : `${a} ${activeOp?.symbol} ${b} = ${value.toString(10)}\n0x${(value & MASK).toString(16).toUpperCase()}\n${toBinary(value, width)}`}
      exportName="bitwise.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Value A" hint="0b… binary · 0x… hex · 0o… octal · plain decimal">
          <input value={a} onChange={(e) => setA(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label={op === 'not' ? 'Value B (not used)' : 'Value B'}>
          <input
            value={b}
            onChange={(e) => setB(e.target.value)}
            disabled={op === 'not'}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm disabled:opacity-40"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg value={op} onChange={setOp} options={OPS.map((o) => ({ value: o.id, label: o.label }))} />
        <Seg value={width} onChange={setWidth} options={[{ value: 8, label: '8-bit' }, { value: 16, label: '16-bit' }, { value: 32, label: '32-bit' }, { value: 64, label: '64-bit' }]} />
      </div>

      {result.error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{result.error}</Panel>}

      {value !== null && !result.error && (
        <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {a} <span className="text-cyan-j">{activeOp?.symbol}</span> {op === 'not' ? '' : b}
          </div>
          <div className="tk-title-glow mt-1 break-all font-mono-j text-2xl font-semibold text-cyan-j">{value.toString(10)}</div>
        </div>
      )}

      {!!bits && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Bit grid · {width} bits</div>
          <div className="space-y-1.5 font-mono-j text-[10px] leading-none">
            {[{ label: 'A ', bits: bitsA }, { label: activeOp?.label?.slice(0, 2) || 'B ', bits: op === 'not' ? '' : bitsB }, { label: '= ', bits }].map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-muted-foreground">{row.label}</span>
                {row.bits ? (
                  <span className="flex flex-wrap gap-[2px]">
                    {[...row.bits].map((bit, index) => (
                      <span
                        key={index}
                        className={`inline-grid h-4 w-3 place-items-center rounded-sm ${
                          bit === '1' ? (row.label === '= ' ? 'bg-cyan-j/30 text-cyan-j' : 'bg-card/80 text-foreground') : 'bg-card/30 text-muted-foreground/40'
                        }`}
                      >
                        {bit}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        {forms.map((f) => <Stat key={f.label} label={f.label} value={f.value} mono />)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={value === null ? '' : value.toString(10)} label="Copy decimal" />
        <CopyBtn value={value === null ? '' : `0x${(value & MASK).toString(16).toUpperCase()}`} label="Copy hex" />
        <CopyBtn value={bits} label="Copy bits" />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Values are handled as true integers, so 64-bit masks, permission flags and hashes stay exact instead of drifting once they pass the
          JavaScript number limit. Negative results are shown in two's complement — that is why NOT 0 comes back as −1.
        </p>
      </Panel>
    </ToolShell>
  );
}