import { useMemo, useState } from 'react';
import { Binary } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const floatToParts = (value, bits) => {
  const exponentBits = bits === 32 ? 8 : 11;
  const bias = 2 ** (exponentBits - 1) - 1;
  const buffer = new ArrayBuffer(bits === 32 ? 4 : 8);
  const view = new DataView(buffer);
  if (bits === 32) view.setFloat32(0, value);
  else view.setFloat64(0, value);
  const bytes = new Uint8Array(buffer);
  let bitsString = '';
  for (const byte of bytes) bitsString += byte.toString(2).padStart(8, '0');
  if (bits === 32 && !isLittleEndian()) bitsString = reverseBytes(bitsString);
  const sign = bitsString[0];
  const exponent = bitsString.slice(1, 1 + exponentBits);
  const mantissa = bitsString.slice(1 + exponentBits);
  const exponentValue = parseInt(exponent, 2);
  return {
    bitsString,
    sign,
    exponent,
    mantissa,
    exponentValue,
    unbiased: exponentValue === 0 ? 1 - bias : exponentValue - bias,
    bias,
    hex: bytesToHex(bits === 32 && !isLittleEndian() ? bytes.slice().reverse() : bytes),
    special: exponentValue === 0 && /^0+$/.test(mantissa) ? 'zero'
      : exponentValue === (2 ** exponentBits - 1) ? (/^0+$/.test(mantissa) ? 'infinity' : 'NaN')
        : exponentValue === 0 ? 'subnormal' : 'normal',
  };
};

const isLittleEndian = () => {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, 256, true);
  return new Int16Array(buffer)[0] === 256;
};

const reverseBytes = (bitsString) => {
  const chunks = bitsString.match(/.{8}/g) || [];
  return chunks.reverse().join('');
};

const bytesToHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

const hexToFloat = (input, bits) => {
  const clean = String(input).replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  const expected = bits === 32 ? 8 : 16;
  if (clean.length !== expected) return null;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  const buffer = new ArrayBuffer(bits === 32 ? 4 : 8);
  const view = new DataView(buffer);
  bytes.forEach((byte, index) => view.setUint8(index, byte));
  return bits === 32 ? view.getFloat32(0) : view.getFloat64(0);
};

export default function FloatBits() {
  const [value, setValue] = useState('3.14159');
  const [bits, setBits] = useState(32);
  const [mode, setMode] = useState('encode');
  const [hex, setHex] = useState('');

  const numeric = Number(value);
  const parts = useMemo(() => {
    if (!Number.isFinite(numeric) && value.trim() !== 'NaN' && value.trim() !== 'Infinity' && value.trim() !== '-Infinity') return null;
    return floatToParts(value.trim() === 'NaN' ? NaN : value.trim() === 'Infinity' ? Infinity : value.trim() === '-Infinity' ? -Infinity : numeric, bits);
  }, [numeric, value, bits]);

  const decoded = useMemo(() => (mode === 'decode' && hex ? hexToFloat(hex, bits) : null), [mode, hex, bits]);

  const steps = parts ? [
    `1. Sign bit: ${parts.sign} → ${parts.sign === '1' ? 'negative' : 'positive'}`,
    `2. Exponent: ${parts.exponent}₂ = ${parts.exponentValue}, minus bias ${parts.bias} = ${parts.unbiased}`,
    `3. Mantissa: ${parts.mantissa} — 1.${parts.mantissa}₂ implied for normal numbers`,
    `4. Value = ${parts.sign === '1' ? '−' : ''}1.${parts.mantissa}₂ × 2^${parts.unbiased}`,
  ] : [];

  const report = parts
    ? [
        `${value} as ${bits}-bit float`,
        `Bits:  ${parts.bitsString}`,
        `Sign ${parts.sign} · exponent ${parts.exponent} (${parts.exponentValue}) · mantissa ${parts.mantissa}`,
        `Hex: ${parts.hex}`,
        `Class: ${parts.special} · unbiased exponent ${parts.unbiased}`,
      ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="float-bits"
      icon={Binary}
      title="IEEE 754 Float Inspector"
      desc="See exactly how a number is stored in binary — sign, exponent, mantissa — and find out why 0.1 + 0.2 is not quite 0.3."
      state={{ value, bits, mode, hex }}
      onRestore={(restored) => {
        if (typeof restored.value === 'string') setValue(restored.value);
        if (restored.bits) setBits(Number(restored.bits));
        if (restored.mode) setMode(restored.mode);
        if (typeof restored.hex === 'string') setHex(restored.hex);
      }}
      exportText={report}
      exportName="float-bits.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={setMode} options={[{ value: 'encode', label: 'Number → bits' }, { value: 'decode', label: 'Hex → number' }]} />
        <Seg value={bits} onChange={setBits} options={[{ value: 32, label: '32-bit' }, { value: 64, label: '64-bit' }]} />
        {parts && <CopyBtn value={report} label="Copy breakdown" />}
      </div>

      {mode === 'encode' ? (
        <Field label="Number (or NaN, Infinity)">
          <input value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      ) : (
        <Field label={`Hex bytes (${bits === 32 ? 8 : 16} hex digits)`}>
          <input value={hex} onChange={(e) => setHex(e.target.value)} placeholder={bits === 32 ? '40 49 0f db' : '40 09 21 fb 54 44 2d 18'} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      )}

      {mode === 'decode' && decoded !== null && (
        <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Decoded value</div>
          <div className="tk-title-glow mt-1 font-mono-j text-3xl font-semibold text-cyan-j">{decoded}</div>
        </div>
      )}
      {mode === 'decode' && hex && decoded === null && (
        <Panel className="border-amber-500/40 text-[11px] text-amber-500">
          Expecting exactly {bits === 32 ? 8 : 16} hex digits for a {bits}-bit value — spaces are fine.
        </Panel>
      )}

      {mode === 'encode' && parts && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(2.4rem,1fr))] gap-1">
            {parts.bitsString.split('').map((bit, index) => {
              const zone = index === 0 ? 'sign' : index <= (bits === 32 ? 8 : 11) ? 'exponent' : 'mantissa';
              return (
                <div
                  key={index}
                  className={`rounded-md border py-1.5 text-center font-mono-j text-xs ${
                    bit === '1'
                      ? zone === 'sign' ? 'border-red-500/50 bg-red-500/10 text-red-400'
                        : zone === 'exponent' ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                          : 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j'
                      : 'border-border/50 bg-card/40 text-muted-foreground'
                  }`}
                >
                  {bit}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
            <span>sign</span>
            <span>exponent ({bits === 32 ? 8 : 11} bits)</span>
            <span>mantissa ({bits === 32 ? 23 : 52} bits)</span>
          </div>
        </>
      )}

      {mode === 'encode' && parts && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How it is assembled</div>
          <div className="space-y-1">
            {steps.map((step) => (
              <div key={step} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px] text-muted-foreground">{step}</div>
            ))}
          </div>
        </Panel>
      )}

      {mode === 'encode' && parts && (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Hex bytes" value={parts.hex} mono />
          <Stat label="Exponent (biased)" value={String(parts.exponentValue)} mono />
          <Stat label="Exponent (real)" value={String(parts.unbiased)} mono />
          <Stat label="Class" value={parts.special} mono />
        </div>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The classic example</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <div>0.1 + 0.2 = {(0.1 + 0.2).toPrecision(20)}</div>
          <div>0.1 === 0.3 - 0.2 → {String(0.1 === 0.3 - 0.2)}</div>
          <div>1e16 + 1 === 1e16 → {String(1e16 + 1 === 1e16)}</div>
          <div>Number.MAX_SAFE_INTEGER = {Number.MAX_SAFE_INTEGER}</div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          None of those are bugs — 0.1 has no exact binary representation, so every language using IEEE 754 shows the same drift. Compare with
          tolerance, and use integers (cents, milliseconds) when exactness matters.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Half of all 32-bit patterns are not whole numbers but fractions between 1 and 2, which is why floats have more precision near zero than far
          from it. It also explains why a 64-bit double cannot hold more than about 15–17 significant decimal digits — the mantissa simply runs out of
          bits.
        </p>
      </Panel>
    </ToolShell>
  );
}