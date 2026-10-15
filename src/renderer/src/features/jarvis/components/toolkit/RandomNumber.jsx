import { useState } from 'react';
import { Dices, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Out, CopyBtn, Stat, ToggleRow } from './shared';

const rand = () => {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 4294967296;
};

export default function RandomNumber() {
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(100);
  const [count, setCount] = useState(6);
  const [unique, setUnique] = useState(true);
  const [sorted, setSorted] = useState(false);
  const [out, setOut] = useState([]);
  const [err, setErr] = useState(null);

  const roll = () => {
    const lo = Math.min(Number(min), Number(max));
    const hi = Math.max(Number(min), Number(max));
    const n = Math.max(1, Math.min(500, Number(count) || 1));
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { setErr('Enter valid numbers'); return; }
    if (unique && hi - lo + 1 < n) { setErr(`Range has only ${hi - lo + 1} values — reduce the count or turn off “no repeats”`); return; }
    setErr(null);
    const picked = [];
    const seen = new Set();
    let guard = 0;
    while (picked.length < n && guard++ < n * 200) {
      const v = lo + Math.floor(rand() * (hi - lo + 1));
      if (unique) { if (seen.has(v)) continue; seen.add(v); }
      picked.push(v);
    }
    setOut(sorted ? picked.sort((a, b) => a - b) : picked);
  };

  const sum = out.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Dices} title="Random Number Generator" desc="Fair draws from any range, with or without repeats." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Minimum"><input type="number" value={min} onChange={(e) => setMin(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Maximum"><input type="number" value={max} onChange={(e) => setMax(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="How many"><input type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="No repeats (lottery style)" checked={unique} onChange={setUnique} />
        <ToggleRow label="Sort the results" checked={sorted} onChange={setSorted} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={roll} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Draw numbers</Button>
        {out.length > 0 && <CopyBtn value={out.join(', ')} label="Copy numbers" />}
      </div>
      {err && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{err}</div>}
      {out.length > 0 && (
        <>
          <Out label={`Drawn ${out.length} number${out.length === 1 ? '' : 's'}`} value={out.join(', ')}>
            <div className="flex flex-wrap gap-2">
              {out.map((v, i) => (
                <span key={`${v}-${i}`} className="rounded-lg border border-cyan-j/30 bg-cyan-j/10 px-2.5 py-1 font-display text-base tabular-nums text-cyan-j">{v}</span>
              ))}
            </div>
          </Out>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Sum" value={String(sum)} />
            <Stat label="Average" value={(sum / out.length).toFixed(2)} />
            <Stat label="Lowest" value={String(Math.min(...out))} />
            <Stat label="Highest" value={String(Math.max(...out))} />
          </div>
        </>
      )}
    </div>
  );
}