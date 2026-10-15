import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { ToolHeader, Area, Field, Seg, Out, CopyBtn, Panel, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const vigenere = (text, key, decode) => {
  const clean = key.replace(/[^a-z]/gi, '').toUpperCase();
  if (!clean) return text;
  let index = 0;
  return Array.from(text).map((ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= 65 && code <= 90 ? 65 : code >= 97 && code <= 122 ? 97 : null;
    if (base === null) return ch;
    const shift = clean.charCodeAt(index % clean.length) - 65;
    index += 1;
    const direction = decode ? -shift : shift;
    return String.fromCharCode(((code - base + direction + 26 * 26) % 26) + base);
  }).join('');
};

const railFenceEncode = (text, rails) => {
  if (rails < 2) return text;
  const rows = Array.from({ length: rails }, () => '');
  let rail = 0;
  let step = 1;
  Array.from(text).forEach((ch) => {
    rows[rail] += ch;
    rail += step;
    if (rail === 0 || rail === rails - 1) step = -step;
  });
  return rows.join('');
};

const railFenceDecode = (text, rails) => {
  if (rails < 2) return text;
  const pattern = [];
  let rail = 0;
  let step = 1;
  for (let i = 0; i < text.length; i += 1) {
    pattern.push(rail);
    rail += step;
    if (rail === 0 || rail === rails - 1) step = -step;
  }
  const counts = Array(rails).fill(0);
  pattern.forEach((r) => { counts[r] += 1; });
  const chunks = [];
  let cursor = 0;
  for (let i = 0; i < rails; i += 1) {
    chunks.push(text.slice(cursor, cursor + counts[i]).split(''));
    cursor += counts[i];
  }
  return pattern.map((r) => chunks[r].shift()).join('');
};

const atbash = (text) => Array.from(text).map((ch) => {
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(90 - (code - 65));
  if (code >= 97 && code <= 122) return String.fromCharCode(122 - (code - 97));
  return ch;
}).join('');

const rotN = (text, shift) => {
  const n = ((shift % 26) + 26) % 26;
  return Array.from(text).map((ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) return String.fromCharCode(((code - 65 + n) % 26) + 65);
    if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + n) % 26) + 97);
    return ch;
  }).join('');
};

const CIPHERS = [
  { value: 'vigenere', label: 'Vigenère', note: 'Each letter is shifted by a repeating keyword, which defeats simple frequency analysis.' },
  { value: 'atbash', label: 'Atbash', note: 'The alphabet is mirrored A↔Z, B↔Y. Encoding and decoding are the same operation.' },
  { value: 'rail', label: 'Rail Fence', note: 'Letters are written in a zigzag across rails and read off rail by rail — a transposition, not a substitution.' },
  { value: 'rot', label: 'ROT-N', note: 'Every letter moves forward N places; N = 13 gives the classic ROT13.' },
];

export default function ClassicalCiphers() {
  const [cipher, setCipher] = useState('vigenere');
  const [mode, setMode] = useState('encode');
  const [key, setKey] = useState('MARK32');
  const [rails, setRails] = useState(3);
  const [shift, setShift] = useState(13);
  const [input, setInput] = useState('Meet me at the studio at nine.');

  const active = CIPHERS.find((c) => c.value === cipher);

  const output = useMemo(() => {
    const decode = mode === 'decode';
    if (cipher === 'vigenere') return vigenere(input, key, decode);
    if (cipher === 'atbash') return atbash(input);
    if (cipher === 'rail') return decode ? railFenceDecode(input, rails) : railFenceEncode(input, rails);
    return rotN(input, decode ? -shift : shift);
  }, [cipher, mode, input, key, rails, shift]);

  const roundTrip = useMemo(() => {
    if (mode !== 'encode') return null;
    const back = cipher === 'vigenere' ? vigenere(output, key, true)
      : cipher === 'atbash' ? atbash(output)
        : cipher === 'rail' ? railFenceDecode(output, rails)
          : rotN(output, -shift);
    return back === input;
  }, [cipher, mode, output, input, key, rails, shift]);

  const letters = input.replace(/[^a-z]/gi, '').length;

  return (
    <ToolShell
      toolId="classical-ciphers"
      icon={Lock}
      title="Classical Cipher Suite"
      desc="Vigenère, Atbash, Rail Fence and ROT-N — encode for fun, decode a puzzle."
      state={{ cipher, mode, key, rails, shift, input }}
      onRestore={(saved) => { setCipher(saved.cipher); setMode(saved.mode); setKey(saved.key); setRails(saved.rails); setShift(saved.shift); setInput(saved.input); }}
      exportText={output}
      exportName="cipher.txt"
    >
      <Seg value={cipher} onChange={setCipher} options={CIPHERS.map(({ value, label }) => ({ value, label }))} />
      <Seg value={mode} onChange={setMode} options={[{ value: 'encode', label: 'Encode' }, { value: 'decode', label: 'Decode' }]} />
      {cipher === 'vigenere' && (
        <Field label="Keyword" hint="Letters only — the key repeats across the message">
          <input value={key} onChange={(e) => setKey(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      )}
      {cipher === 'rail' && (
        <Field label={`Rails · ${rails}`}>
          <input type="range" min={2} max={8} value={rails} onChange={(e) => setRails(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      )}
      {cipher === 'rot' && (
        <div className="space-y-2">
          <Field label={`Shift · ${shift} places`}>
            <input type="range" min={1} max={25} value={shift} onChange={(e) => setShift(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {[13, 5, 3, 21, 25].map((s) => (
              <button key={s} onClick={() => setShift(s)} className={`rounded-lg border px-2.5 py-1 text-xs transition ${shift === s ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>ROT{s}</button>
            ))}
          </div>
        </div>
      )}
      <Area value={input} onChange={setInput} rows={5} placeholder="Type the message…" />
      <Out label={`${mode === 'encode' ? 'Encoded' : 'Decoded'} with ${active.label}`} value={output}>
        <pre className="whitespace-pre-wrap break-words text-sm">{output || '—'}</pre>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Letters" value={String(letters)} />
        <Stat label="Characters" value={String(input.length)} />
        <Stat label="Round trip" value={roundTrip === null ? '—' : roundTrip ? 'matches input' : 'differs'} />
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={output} label="Copy result" />
        <button onClick={() => { setInput(output); setMode(mode === 'encode' ? 'decode' : 'encode'); }} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground">Send result back to input</button>
      </div>
      <Panel>
        <div className="text-[11px] leading-relaxed text-muted-foreground">{active.note} Punctuation, digits and spacing are left untouched, so the text stays readable. These ciphers are for puzzles and learning — never for real secrets.</div>
      </Panel>
    </ToolShell>
  );
}