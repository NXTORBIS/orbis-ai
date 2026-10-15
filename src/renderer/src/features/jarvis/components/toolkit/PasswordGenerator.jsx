import { useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Stat, CopyBtn, Panel, ToggleRow } from './shared';

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/~';
const AMBIGUOUS = /[Il1O0o]/g;

function pick(pool) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return pool[bytes[0] % pool.length];
}

function generate({ length, lower, upper, digits, symbols, avoidAmbiguous, count }) {
  let pool = '';
  if (lower) pool += LOWER;
  if (upper) pool += UPPER;
  if (digits) pool += DIGITS;
  if (symbols) pool += SYMBOLS;
  if (!pool) pool = LOWER;
  if (avoidAmbiguous) pool = pool.replace(AMBIGUOUS, '');

  const out = [];
  for (let i = 0; i < count; i++) {
    let pw = '';
    while (pw.length < length) pw += pick(pool);
    out.push(pw);
  }
  return out;
}

export default function PasswordGenerator() {
  const [length, setLength] = useState(18);
  const [opts, setOpts] = useState({ lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false, count: 5 });
  const [list, setList] = useState(() => generate({ length: 18, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false, count: 5 }));

  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));
  const roll = () => setList(generate({ length: Number(length), ...opts }));

  const strength = length >= 20 ? 'Excellent' : length >= 16 ? 'Very strong' : length >= 12 ? 'Strong' : 'Short';

  return (
    <div className="space-y-4">
      <ToolHeader icon={KeyRound} title="Password Generator" desc="Cryptographically random passwords — generated on your device, never sent anywhere." />
      <Field label={`Length · ${length} characters`}>
        <input type="range" min={8} max={64} value={length} onChange={(e) => setLength(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Lowercase (a–z)" checked={opts.lower} onChange={(v) => set({ lower: v })} />
        <ToggleRow label="Uppercase (A–Z)" checked={opts.upper} onChange={(v) => set({ upper: v })} />
        <ToggleRow label="Digits (0–9)" checked={opts.digits} onChange={(v) => set({ digits: v })} />
        <ToggleRow label="Symbols (!@#$)" checked={opts.symbols} onChange={(v) => set({ symbols: v })} />
        <ToggleRow label="Avoid look-alike characters" checked={opts.avoidAmbiguous} onChange={(v) => set({ avoidAmbiguous: v })} />
        <Field label="How many">
          <input type="number" min={1} max={20} value={opts.count} onChange={(e) => set({ count: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={roll} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Generate</Button>
        <CopyBtn value={list.join('\n')} label="Copy all" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Length" value={String(length)} />
        <Stat label="Strength" value={strength} />
        <Stat label="Pool size" value={String((opts.lower ? 25 : 0) + (opts.upper ? 25 : 0) + (opts.digits ? 8 : 0) + (opts.symbols ? 24 : 0))} />
      </div>
      <Panel className="space-y-2">
        {list.map((pw, i) => (
          <div key={`${pw}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
            <code className="truncate font-mono-j text-sm text-cyan-j">{pw}</code>
            <CopyBtn value={pw} label="" />
          </div>
        ))}
      </Panel>
    </div>
  );
}