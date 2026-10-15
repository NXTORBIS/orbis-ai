import { useMemo, useState } from 'react';
import { Variable } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel, CopyBtn } from './shared';

function factorial(n) {
  let out = 1n;
  for (let i = 2n; i <= BigInt(n); i++) out *= i;
  return out;
}

function nCr(n, r) {
  if (r < 0 || r > n) return 0n;
  let out = 1n;
  const k = Math.min(r, n - r);
  for (let i = 0; i < k; i++) out = (out * BigInt(n - i)) / BigInt(i + 1);
  return out;
}

const group = (v) => v.toLocaleString('en-US');

export default function Combinatorics() {
  const [n, setN] = useState('8');
  const [r, setR] = useState('3');
  const [mode, setMode] = useState('both');

  const N = Math.max(0, Math.min(60, Math.floor(Number(n) || 0)));
  const R = Math.max(0, Math.min(N, Math.floor(Number(r) || 0)));

  const combos = useMemo(() => {
    if (mode === 'factorial') return [];
    const out = [];
    const build = (start, current) => {
      if (out.length >= 60) return;
      if (current.length === R) { out.push([...current]); return; }
      for (let i = start; i < N; i++) { build(i + 1, [...current, i + 1]); }
    };
    if (nCr(N, R) <= 120n && R > 0) build(0, []);
    return out;
  }, [N, R, mode]);

  const combinations = nCr(N, R);
  const permutations = combinations * factorial(R);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Variable} title="Combinatorics Calculator" desc="Combinations, permutations and factorials — exact, even for big numbers." />
      <Seg value={mode} onChange={setMode} options={[{ value: 'both', label: 'nCr & nPr' }, { value: 'factorial', label: 'Factorial only' }]} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="n — items to choose from"><input value={n} onChange={(e) => setN(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        {mode !== 'factorial' && (
          <Field label="r — items chosen"><input value={r} onChange={(e) => setR(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Panel className="text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">C({N}, {R}) — combinations</div>
          <div className="mt-1 font-display text-xl font-bold tabular-nums text-cyan-j">{mode === 'factorial' ? '—' : group(combinations)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">order does not matter</div>
        </Panel>
        <Panel className="text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">P({N}, {R}) — permutations</div>
          <div className="mt-1 font-display text-xl font-bold tabular-nums text-cyan-j">{mode === 'factorial' ? '—' : group(permutations)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">order matters</div>
        </Panel>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={`${N}!`} value={N <= 30 ? group(factorial(N)) : `${String(factorial(N)).length} digits`} mono />
        <Stat label={`${R}!`} value={group(factorial(R))} mono />
        <Stat label="Combinations digits" value={String(String(combinations).length)} />
        <Stat label="Repeats allowed (nʳ)" value={N <= 30 ? group(BigInt(N) ** BigInt(R)) : 'huge'} mono />
      </div>
      {combos.length > 0 && (
        <Panel>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Every combination of {R} from {N}</span>
            <CopyBtn value={combos.map((c) => c.join('-')).join('\n')} label="Copy list" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {combos.map((c, i) => (
              <span key={i} className="rounded-md bg-secondary px-2 py-1 font-mono-j text-xs">{c.join('·')}</span>
            ))}
          </div>
        </Panel>
      )}
      <p className="text-[11px] text-muted-foreground">Computed with arbitrary-precision integers, so results stay exact beyond the normal number limit.</p>
    </div>
  );
}