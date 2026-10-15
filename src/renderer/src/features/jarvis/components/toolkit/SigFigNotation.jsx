import { useMemo, useState } from 'react';
import { Sigma } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const PREFIXES = [
  { power: 12, symbol: 'T', name: 'tera' }, { power: 9, symbol: 'G', name: 'giga' }, { power: 6, symbol: 'M', name: 'mega' },
  { power: 3, symbol: 'k', name: 'kilo' }, { power: 0, symbol: '', name: '' }, { power: -3, symbol: 'm', name: 'milli' },
  { power: -6, symbol: 'µ', name: 'micro' }, { power: -9, symbol: 'n', name: 'nano' }, { power: -12, symbol: 'p', name: 'pico' },
];

const countSigFigs = (raw) => {
  let text = String(raw).trim().replace(/^[+-]/, '');
  if (/e/i.test(text)) {
    const [mantissa] = text.split(/e/i);
    text = mantissa;
  }
  text = text.replace(/\.$/, '');
  const digits = text.replace('.', '');
  const stripped = digits.replace(/^0+/, '');
  if (!stripped) return 0;
  if (text.includes('.')) return stripped.replace(/0+$/, '').length || 1;
  const withoutTrailingZeros = stripped.replace(/0+$/, '');
  return withoutTrailingZeros.length || 1;
};

const roundToSigFigs = (value, sig) => {
  if (!Number.isFinite(value) || value === 0) return 0;
  const digits = Math.max(1, Math.min(15, Math.round(sig)));
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** (digits - 1 - magnitude);
  return Math.round(value * factor) / factor;
};

export default function SigFigNotation() {
  const [raw, setRaw] = useState('1234.5678');
  const [sig, setSig] = useState(3);
  const [mode, setMode] = useState('sci');

  const value = Number(String(raw).replace(/,/g, '').trim());
  const detected = useMemo(() => countSigFigs(raw), [raw]);
  const rounded = useMemo(() => roundToSigFigs(value, sig), [value, sig]);

  const format = useMemo(() => {
    if (!Number.isFinite(value) || value === 0) return { sci: '0', eng: '0', decimal: '0', order: 0, prefix: '—' };
    const order = Math.floor(Math.log10(Math.abs(value)));
    const mantissa = value / 10 ** order;
    const engPower = Math.floor(order / 3) * 3;
    const engMantissa = value / 10 ** engPower;
    const prefix = [...PREFIXES].sort((a, b) => Math.abs(a.power - engPower) - Math.abs(b.power - engPower))[0];
    return {
      sci: `${mantissa.toFixed(Math.max(0, Math.min(10, sig - 1)))} × 10^${order}`,
      sciPlain: `${mantissa.toFixed(Math.max(0, Math.min(10, sig - 1)))}e${order}`,
      eng: `${engMantissa.toFixed(Math.max(0, Math.min(10, sig - 1)))} × 10^${engPower}`,
      decimal: rounded.toLocaleString(undefined, { maximumFractionDigits: 12 }),
      order,
      prefix: `${rounded / 10 ** prefix.power} ${prefix.symbol}${prefix.name ? ` (${prefix.name})` : ''}`.trim(),
    };
  }, [value, rounded, sig]);

  const steps = [
    { label: 'Significant figures in your input', value: String(detected) },
    { label: `Rounded to ${sig} s.f.`, value: Number.isFinite(rounded) ? String(rounded) : '—' },
    { label: 'Order of magnitude', value: Number.isFinite(value) && value !== 0 ? `10^${format.order}` : '—' },
    { label: 'Scientific notation', value: format.sci },
  ];

  const report = `${raw} → ${sig} s.f. = ${format.decimal}\n${format.sci}\n${format.eng}\n${format.prefix}`;

  return (
    <ToolShell
      toolId="sig-figs"
      icon={Sigma}
      title="Significant Figures & Notation"
      desc="Count the significant figures in a measurement, round it properly, and see it as scientific, engineering and prefixed notation."
      state={{ raw, sig, mode }}
      onRestore={(restored) => {
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (restored.sig) setSig(Number(restored.sig));
        if (restored.mode) setMode(restored.mode);
      }}
      exportText={report}
      exportName="notation.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Measurement" hint="Commas are fine — 0.00450 keeps its trailing zero">
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            inputMode="decimal"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm"
          />
        </Field>
        <Seg value={mode} onChange={setMode} options={[{ value: 'sci', label: 'Scientific' }, { value: 'eng', label: 'Engineering' }, { value: 'dec', label: 'Decimal' }]} />
      </div>

      <Field label={`Round to ${sig} significant figure${sig === 1 ? '' : 's'}`}>
        <input type="range" min={1} max={12} value={sig} onChange={(e) => setSig(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {mode === 'sci' ? 'Scientific notation' : mode === 'eng' ? 'Engineering notation' : 'Rounded decimal'}
        </div>
        <div className="tk-title-glow mt-1 break-all font-mono-j text-2xl font-semibold text-cyan-j">
          {!Number.isFinite(value) ? '—' : mode === 'sci' ? format.sci : mode === 'eng' ? format.eng : format.decimal}
        </div>
        <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">{Number.isFinite(value) ? format.sciPlain : ''}</div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {steps.map((s) => <Stat key={s.label} label={s.label} value={s.value} mono />)}
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Same value in every form</div>
        <div className="space-y-1.5 text-[11px]">
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Decimal</span><span className="font-mono-j">{format.decimal}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Scientific</span><span className="font-mono-j">{format.sci}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Engineering</span><span className="font-mono-j">{format.eng}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Nearest metric prefix</span><span className="font-mono-j">{format.prefix}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Uncertainty if ±1 in last place</span><span className="font-mono-j">±{detected ? (10 ** (format.order - detected + 1)).toPrecision(2) : '—'}</span></div>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={format[mode === 'sci' ? 'sci' : mode === 'eng' ? 'eng' : 'decimal']} label="Copy answer" />
        <CopyBtn value={report} label="Copy working" />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Trailing zeros after a decimal point count, zeros before the first non-zero digit never do — that is why 0.00450 has three significant
          figures. Rounding here uses the half-up rule you were taught, which is the right behaviour for lab reports and mark schemes.
        </p>
      </Panel>
    </ToolShell>
  );
}