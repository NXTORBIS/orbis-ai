import { useMemo, useState } from 'react';
import { Barcode } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['000000', '001011', '001101', '001110', '010011', '011001', '011100', '010101', '010110', '011010'];

const SAMPLES = [
  { label: '5901234123457', value: '5901234123457' },
  { label: '4006381333931', value: '4006381333931' },
  { label: '036000291452', value: '036000291452' },
];

const checkFor = (twelve) => {
  let sum = 0;
  twelve.split('').forEach((d, i) => { sum += Number(d) * (i % 2 === 0 ? 1 : 3); });
  return (10 - (sum % 10)) % 10;
};

const bitsFor = (digits) => {
  if (digits.length === 13) {
    const parity = PARITY[Number(digits[0])];
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += parity[i - 1] === '0' ? L[Number(digits[i])] : G[Number(digits[i])];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[Number(digits[i])];
    return `${bits}101`;
  }
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += L[Number(digits[i])];
  bits += '01010';
  for (let i = 6; i < 12; i++) bits += R[Number(digits[i])];
  return `${bits}101`;
};

export default function BarcodeGenerator() {
  const [input, setInput] = useState('5901234123457');
  const [barHeight, setBarHeight] = useState(90);
  const [module, setModule] = useState(2);
  const [colour, setColour] = useState('#0b1020');
  const [showDigits, setShowDigits] = useState(true);

  const info = useMemo(() => {
    const digits = String(input).replace(/\D/g, '');
    if (digits.length === 12) {
      const check = checkFor(digits);
      const full = `${digits}${check}`;
      return { ok: true, type: 'UPC-A', printed: full, bits: bitsFor(digits), check, note: 'UPC-A · check digit added automatically' };
    }
    if (digits.length === 13) {
      const expected = checkFor(digits.slice(0, 12));
      return {
        ok: Number(digits[12]) === expected,
        type: 'EAN-13',
        printed: digits,
        bits: bitsFor(digits),
        check: expected,
        note: Number(digits[12]) === expected ? 'EAN-13 · check digit verified' : `EAN-13 · check digit should be ${expected}, not ${digits[12]}`,
      };
    }
    return { ok: false, note: 'Enter 12 digits for a UPC-A barcode or 13 for EAN-13.', code: digits.length };
  }, [input]);

  const svg = useMemo(() => {
    if (!info.ok) return '';
    const bits = info.bits;
    const quiet = 10;
    const width = (bits.length + quiet * 2) * module;
    const total = barHeight + (showDigits ? 20 : 0);
    const bars = [];
    let i = 0;
    while (i < bits.length) {
      if (bits[i] === '1') {
        let run = 1;
        while (bits[i + run] === '1') run++;
        bars.push(`<rect x="${(quiet + i) * module}" y="0" width="${run * module}" height="${barHeight}" fill="${colour}"/>`);
        i += run;
      } else {
        i++;
      }
    }
    const labels = [];
    if (showDigits) {
      const d = info.printed;
      const y = barHeight + 15;
      const style = `font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" fill="${colour}"`;
      if (d.length === 13) labels.push(`<text x="${6}" y="${y}" ${style}>${d[0]}</text>`);
      const offset = d.length === 13 ? 1 : 0;
      for (let k = 0; k < 6; k++) {
        labels.push(`<text x="${(quiet + 3 + k * 7 + 3.5) * module}" y="${y}" text-anchor="middle" ${style}>${d[offset + k]}</text>`);
      }
      for (let k = 0; k < 6; k++) {
        labels.push(`<text x="${(quiet + 50 + k * 7 + 3.5) * module}" y="${y}" text-anchor="middle" ${style}>${d[offset + 6 + k]}</text>`);
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}"><rect width="${width}" height="${total}" fill="#ffffff"/>${bars.join('')}${labels.join('')}</svg>`;
  }, [info, barHeight, module, colour, showDigits]);

  const dataUri = svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : '';

  const download = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${info.printed || 'barcode'}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <ToolShell
      toolId="barcode"
      icon={Barcode}
      title="Barcode Generator"
      desc="Real EAN-13 and UPC-A barcodes with correct check digits, drawn as crisp SVG ready for print."
      state={{ input, barHeight, module, colour, showDigits }}
      onRestore={(saved) => {
        if (saved.input !== undefined) setInput(saved.input);
        setBarHeight(saved.barHeight ?? 90);
        setModule(saved.module ?? 2);
        if (saved.colour) setColour(saved.colour);
        setShowDigits(saved.showDigits ?? true);
      }}
      exportText={svg}
      exportName={`${info.printed || 'barcode'}.svg`}
      exportMime="image/svg+xml"
    >
      <Field label="Number">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          inputMode="numeric"
          placeholder="12 digits (UPC-A) or 13 digits (EAN-13)"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm"
        />
      </Field>

      <div className="flex flex-wrap gap-1.5">
        {SAMPLES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setInput(s.value)}
            className="rounded-lg border border-border/70 px-2.5 py-1.5 font-mono-j text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
          >
            {s.label}
          </button>
        ))}
      </div>

      <Panel className={info.ok ? '' : 'border-amber-500/40'}>
        {info.ok ? (
          <img src={dataUri} alt={`Barcode ${info.printed}`} className="mx-auto w-full max-w-lg rounded-md bg-white p-2" />
        ) : (
          <p className="py-6 text-center text-xs text-amber-500">{info.note}</p>
        )}
        {info.ok && <p className="mt-2 text-center text-[11px] text-muted-foreground">{info.note}</p>}
      </Panel>

      <Field label={`Bar height · ${barHeight}px`}>
        <input type="range" min={40} max={200} value={barHeight} onChange={(e) => setBarHeight(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Bar width · ${module}px per module`}>
        <input type="range" min={1} max={6} value={module} onChange={(e) => setModule(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Bar colour · ${colour.toUpperCase()}`}>
        <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent" />
      </Field>

      <ToggleRow label="Show the digits" checked={showDigits} onChange={setShowDigits} hint="human readable line" />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Symbology" value={info.ok ? info.type : '—'} />
        <Stat label="Check digit" value={info.ok ? String(info.check) : '—'} mono />
        <Stat label="Modules" value={info.ok ? '95' : '—'} mono />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={download}
          disabled={!info.ok}
          className="rounded-lg border border-cyan-j/50 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/10 disabled:opacity-40"
        >
          Download SVG
        </button>
        <CopyBtn value={svg} label="Copy SVG" />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          EAN-13 prints a 13th check digit derived from the first twelve; UPC-A adds one to eleven. A scanner reads the patterns, not the picture, so
          keep the bars sharp and the quiet zone white. Print it at least 30mm wide for reliable scanning.
        </p>
      </Panel>
    </ToolShell>
  );
}