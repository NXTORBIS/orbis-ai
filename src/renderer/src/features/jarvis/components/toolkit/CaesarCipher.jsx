import { useState } from 'react';
import { Lock } from 'lucide-react';
import { ToolHeader, Field, Seg, Area, Out, Panel, CopyBtn } from './shared';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const shiftChar = (ch, shift) => {
  const upper = ch.toUpperCase();
  const idx = A.indexOf(upper);
  if (idx === -1) return ch;
  const next = A[(idx + shift + 26) % 26];
  return ch === upper ? next : next.toLowerCase();
};
const transform = (text, shift) => Array.from(text).map((c) => shiftChar(c, shift)).join('');

export default function CaesarCipher() {
  const [mode, setMode] = useState('encode');
  const [text, setText] = useState('Meet me at the library at noon');
  const [shift, setShift] = useState(3);

  const applied = mode === 'encode' ? shift : -shift;
  const out = transform(text, applied);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Lock} title="Caesar Cipher" desc="Shift letters forward or back — with a brute-force table for decoding without the key." />
      <Seg value={mode} onChange={setMode} options={[{ value: 'encode', label: 'Encode' }, { value: 'decode', label: 'Decode' }]} />
      <Area value={text} onChange={setText} rows={4} placeholder="Type a message…" />
      <Field label={`Shift · ${shift} ${shift === 1 ? 'letter' : 'letters'} (${mode === 'encode' ? 'forward' : 'backward'})`}>
        <input type="range" min={0} max={25} value={shift} onChange={(e) => setShift(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {[1, 3, 5, 13, 25].map((s) => (
          <button key={s} onClick={() => setShift(s)} className={`rounded-lg border px-2.5 py-1 text-xs transition ${shift === s ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>
            shift {s}{s === 13 ? ' (ROT13)' : ''}
          </button>
        ))}
      </div>
      <Out label={mode === 'encode' ? 'Ciphertext' : 'Plain text'} value={out}>
        <span className="whitespace-pre-wrap font-mono-j text-sm text-cyan-j">{out || '—'}</span>
      </Out>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Brute force — try every shift</div>
        <div className="space-y-1">
          {Array.from({ length: 26 }, (_, s) => (
            <button
              key={s}
              onClick={() => { setMode('decode'); setShift(s); }}
              className="flex w-full items-start gap-3 rounded-md px-2 py-1 text-left transition hover:bg-accent"
            >
              <span className="w-10 shrink-0 font-mono-j text-[11px] text-muted-foreground">{s === 0 ? '0 / 26' : s}</span>
              <span className="truncate font-mono-j text-xs">{transform(text, -s).slice(0, 80)}</span>
            </button>
          ))}
        </div>
      </Panel>
      <CopyBtn value={out} label="Copy result" />
    </div>
  );
}