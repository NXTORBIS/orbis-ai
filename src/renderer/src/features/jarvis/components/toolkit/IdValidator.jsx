import { useMemo, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, CopyBtn, Panel, Stat } from './shared';

const clean = (value) => String(value || '').replace(/[\s-]/g, '');
const digits = (value) => String(value || '').replace(/\D/g, '');

const luhn = (value) => {
  const s = digits(value);
  if (s.length < 2) return { ok: false, why: 'needs at least 2 digits' };
  let sum = 0;
  let double = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = Number(s[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0
    ? { ok: true, why: 'check digit matches' }
    : { ok: false, why: `check digit fails (sum ${sum})` };
};

const ean = (value) => {
  const s = digits(value);
  if (![8, 12, 13, 14].includes(s.length)) return { ok: false, why: 'expected 8, 12, 13 or 14 digits' };
  const body = s.slice(0, -1);
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  const given = Number(s[s.length - 1]);
  return given === expected
    ? { ok: true, why: 'checksum matches' }
    : { ok: false, why: `expected check digit ${expected}` };
};

const isbn10 = (value) => {
  const s = String(value || '').replace(/[\s-]/g, '').toUpperCase();
  if (s.length !== 10) return { ok: false, why: 'expected 10 characters' };
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    if (!/\d/.test(s[i])) return { ok: false, why: 'only the last character may be X' };
    sum += Number(s[i]) * (10 - i);
  }
  const last = s[9] === 'X' ? 10 : Number(s[9]);
  sum += last;
  return sum % 11 === 0
    ? { ok: true, why: 'checksum matches' }
    : { ok: false, why: 'checksum does not match' };
};

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const verhoeff = (value) => {
  const s = digits(value);
  if (!s.length) return { ok: false, why: 'no digits found' };
  let c = 0;
  const reversed = s.split('').reverse();
  for (let i = 0; i < reversed.length; i++) c = D[c][P[i % 8][Number(reversed[i])]];
  return c === 0
    ? { ok: true, why: 'Verhoeff check digit matches' }
    : { ok: false, why: 'Verhoeff check digit does not match' };
};

const iban = (value) => {
  const s = clean(value).toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return { ok: false, why: 'wrong shape for an IBAN' };
  const rearranged = s.slice(4) + s.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of expanded) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1
    ? { ok: true, why: 'mod-97 check passes' }
    : { ok: false, why: 'mod-97 check fails' };
};

const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const gstin = (value) => {
  const s = clean(value).toUpperCase();
  if (s.length !== 15) return { ok: false, why: 'expected 15 characters' };
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = BASE36.indexOf(s[i]);
    if (v < 0) return { ok: false, why: 'unexpected character' };
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  const expected = BASE36[(36 - (sum % 36)) % 36];
  return s[14] === expected
    ? { ok: true, why: 'checksum matches' }
    : { ok: false, why: `expected check character ${expected}` };
};

const brand = (s) => {
  if (/^4/.test(s)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(s)) return 'Mastercard';
  if (/^3[47]/.test(s)) return 'American Express';
  if (/^(6011|64[4-9]|65)/.test(s)) return 'Discover';
  if (/^3(0[0-5]|[68])/.test(s)) return 'Diners Club';
  if (/^35/.test(s)) return 'JCB';
  if (/^(60|81|82|508)/.test(s)) return 'RuPay';
  if (/^(50|5[6-9]|6\d)/.test(s)) return 'Maestro';
  return 'an unknown issuer';
};

export default function IdValidator() {
  const [input, setInput] = useState('4111 1111 1111 1111');

  const checks = useMemo(() => {
    const raw = String(input || '').trim();
    if (!raw) return [];
    const s = clean(raw);
    const d = digits(raw);
    const list = [];

    if (/^\d{8,19}$/.test(s)) list.push({ label: `Card number (Luhn) — looks like ${brand(s)}`, ...luhn(s) });
    if ([8, 12, 13, 14].includes(d.length) && /^\d+$/.test(s)) list.push({ label: 'EAN / UPC barcode checksum', ...ean(s) });
    if (d.length === 10 && /^[\dXx]{10}$/.test(s)) list.push({ label: 'ISBN-10', ...isbn10(s) });
    if (d.length === 15 && /^\d+$/.test(s)) list.push({ label: 'IMEI (Luhn)', ...luhn(s) });
    if (d.length === 12 && /^\d+$/.test(s)) list.push({ label: 'Aadhaar-style number (Verhoeff)', ...verhoeff(d) });
    if (/^[A-Za-z]{2}\d{2}[A-Za-z0-9]{10,30}$/.test(s)) list.push({ label: 'IBAN', ...iban(s) });
    if (/^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z]{3}$/.test(s)) list.push({ label: 'GSTIN', ...gstin(s) });

    return list;
  }, [input]);

  const passed = checks.filter((c) => c.ok).length;

  return (
    <ToolShell
      toolId="id-check"
      icon={Fingerprint}
      title="ID & Checksum Validator"
      desc="Check the maths behind card numbers, IBANs, ISBNs, barcodes, IMEIs, Aadhaar-style numbers and GSTINs."
      state={{ input }}
      onRestore={(saved) => { if (saved.input !== undefined) setInput(saved.input); }}
      exportText={checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} — ${c.label}: ${c.why}`).join('\n')}
      exportName="checks.txt"
    >
      <Field label="Number or code">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="4111 1111 1111 1111, GB82 WEST 1234 5698 7654 32, 978-0-306-40615-7…"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm"
        />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Checks run" value={String(checks.length)} />
        <Stat label="Passed" value={String(passed)} />
        <Stat label="Characters" value={String(clean(input).length)} />
      </div>

      <Panel>
        <div className="mb-2 text-xs font-medium">Checks</div>
        <div className="space-y-1">
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2 rounded-lg border border-border/60 px-2 py-2">
              <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${c.ok ? 'bg-cyan-j/15 text-cyan-j' : 'bg-red-500/15 text-red-500'}`}>
                {c.ok ? 'PASS' : 'FAIL'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs">{c.label}</span>
                <span className="block text-[11px] text-muted-foreground">{c.why}</span>
              </span>
              <CopyBtn value={`${c.ok ? 'PASS' : 'FAIL'} — ${c.label}: ${c.why}`} />
            </div>
          ))}
          {!checks.length && <p className="py-4 text-center text-[11px] text-muted-foreground">Paste a number or code above to check it.</p>}
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A pass means the digits are internally consistent — the check digit agrees with the rest. It does not mean the account, card or parcel exists:
          nothing here is sent anywhere and no database is consulted, so treat a pass as "correctly typed" rather than "genuine".
          Card numbers are fine to test with a known test value rather than a real one.
        </p>
      </Panel>
    </ToolShell>
  );
}