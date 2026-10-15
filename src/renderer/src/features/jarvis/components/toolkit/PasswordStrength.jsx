import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ToolHeader, Stat, Panel, ToggleRow } from './shared';

const SETS = [
  [/[a-z]/, 26, 'lowercase'],
  [/[A-Z]/, 26, 'uppercase'],
  [/[0-9]/, 10, 'digits'],
  [/[^A-Za-z0-9]/, 33, 'symbols'],
];
const COMMON = ['password', '123456', 'qwerty', 'admin', 'letmein', 'welcome', 'iloveyou', 'abc123', 'dragon'];
const LEVELS = [
  { label: 'Very weak', bar: 'bg-red-500', text: 'text-red-500' },
  { label: 'Weak', bar: 'bg-orange-500', text: 'text-orange-500' },
  { label: 'Fair', bar: 'bg-amber-500', text: 'text-amber-500' },
  { label: 'Strong', bar: 'bg-cyan-j', text: 'text-cyan-j' },
  { label: 'Very strong', bar: 'bg-green-500', text: 'text-green-500' },
];

export function fmtDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'forever';
  if (seconds < 1) return 'instantly';
  const units = [[31557600, 'years'], [86400, 'days'], [3600, 'hours'], [60, 'minutes'], [1, 'seconds']];
  for (const [size, name] of units) {
    if (seconds >= size) {
      const n = seconds / size;
      if (n > 1e6) return 'centuries';
      return `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${name}`;
    }
  }
  return 'instantly';
}

export default function PasswordStrength() {
  const [pw, setPw] = useState('Mark32-Strong!');
  const [show, setShow] = useState(true);

  const pool = SETS.filter(([re]) => re.test(pw)).reduce((sum, [, size]) => sum + size, 0);
  const bits = pw.length ? Math.round(pw.length * Math.log2(pool || 1)) : 0;
  const score = Math.min(4, bits >= 110 ? 4 : bits >= 80 ? 3 : bits >= 55 ? 2 : bits >= 32 ? 1 : 0);
  const level = LEVELS[score];
  const guesses = Math.pow(2, Math.min(bits, 200));

  const advice = [];
  if (pw.length < 12) advice.push('Use at least 12 characters');
  if (!/[A-Z]/.test(pw)) advice.push('Add uppercase letters');
  if (!/[0-9]/.test(pw)) advice.push('Add numbers');
  if (!/[^A-Za-z0-9]/.test(pw)) advice.push('Add a symbol');
  if (COMMON.some((c) => pw.toLowerCase().includes(c))) advice.push('Avoid common words like “password” or “qwerty”');
  if (/(.)\1{2,}/.test(pw)) advice.push('Avoid repeated characters');
  if (advice.length === 0) advice.push('Nice — this password holds up well.');

  return (
    <div className="space-y-4">
      <ToolHeader icon={ShieldCheck} title="Password Strength Analyzer" desc="Entropy, character mix and estimated cracking time — all calculated locally." />
      <input
        type={show ? 'text' : 'password'}
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="Type a password to test…"
        className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm focus-glow"
      />
      <ToggleRow label="Show password" checked={show} onChange={setShow} />
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className={`font-semibold ${level.text}`}>{level.label}</span>
          <span className="text-muted-foreground">{bits} bits of entropy</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div className={`h-full rounded-full transition-all ${level.bar}`} style={{ width: `${((score + 1) / 5) * 100}%` }} />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Online attack (10/s)" value={fmtDuration(guesses / 2 / 10)} />
        <Stat label="Slow offline (10k/s)" value={fmtDuration(guesses / 2 / 1e4)} />
        <Stat label="Fast offline (10B/s)" value={fmtDuration(guesses / 2 / 1e10)} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Length" value={String(pw.length)} />
        <Stat label="Character pool" value={String(pool)} />
        <Stat label="Character types" value={String(SETS.filter(([re]) => re.test(pw)).length)} />
        <Stat label="Unique chars" value={String(new Set(pw).size)} />
      </div>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Suggestions</div>
        <ul className="space-y-1 text-sm">
          {advice.map((a) => <li key={a} className="flex gap-2"><span className="text-cyan-j">›</span>{a}</li>)}
        </ul>
      </Panel>
    </div>
  );
}