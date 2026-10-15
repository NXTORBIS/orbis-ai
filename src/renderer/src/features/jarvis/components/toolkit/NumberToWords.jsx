import { useState } from 'react';
import { Hash } from 'lucide-react';
import { ToolHeader, Field, Seg, Out, CopyBtn, Stat } from './shared';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function chunk(n) {
  const o = [];
  if (n >= 100) { o.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; }
  if (n >= 20) { o.push(TENS[Math.floor(n / 10)]); n %= 10; }
  if (n > 0) o.push(ONES[n]);
  return o.join(' ');
}

function integerWords(n, system) {
  if (n === 0) return 'zero';
  const groups = system === 'indian'
    ? [[10000000, 'crore'], [100000, 'lakh'], [1000, 'thousand']]
    : [[1000000000000, 'trillion'], [1000000000, 'billion'], [1000000, 'million'], [1000, 'thousand']];
  const out = [];
  let rest = n;
  for (const [value, name] of groups) {
    if (rest >= value) { out.push(`${chunk(Math.floor(rest / value))} ${name}`); rest %= value; }
  }
  if (rest > 0) out.push(chunk(rest));
  return out.join(' ');
}

export function toWords(input, system) {
  const s = String(input ?? '').trim().replace(/[,\s]/g, '');
  if (!s) return '';
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 'Enter a valid number';
  const negative = s.startsWith('-');
  const [intPart, fracPart] = s.replace('-', '').split('.');
  if (intPart.length > 15) return 'Too large — keep it under 15 digits';
  let words = integerWords(Number(intPart), system);
  if (fracPart) words += ` point ${fracPart.split('').map((d) => ONES[Number(d)]).join(' ')}`;
  return `${negative ? 'minus ' : ''}${words}`;
}

export default function NumberToWords() {
  const [num, setNum] = useState('1234567.5');
  const [system, setSystem] = useState('international');
  const out = toWords(num, system);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Hash} title="Number to Words" desc="Spell out any amount in international or Indian numbering." />
      <Field label="Number">
        <input value={num} onChange={(e) => setNum(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>
      <Seg value={system} onChange={setSystem} options={[{ value: 'international', label: 'Million / Billion' }, { value: 'indian', label: 'Lakh / Crore' }]} />
      <Out label="In words" value={out}>
        <span className="capitalize">{out || '—'}</span>
      </Out>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Digits" value={String(String(num).replace(/\D/g, '').length)} />
        <Stat label="US grouping" value={Number(num) ? Number(num).toLocaleString('en-US') : '—'} mono />
        <Stat label="Indian grouping" value={Number(num) ? Number(num).toLocaleString('en-IN') : '—'} mono />
      </div>
      <CopyBtn value={out} label="Copy words" />
    </div>
  );
}