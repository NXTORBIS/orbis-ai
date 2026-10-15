import { useState } from 'react';
import { Sigma } from 'lucide-react';
import { ToolHeader, Field, Stat, Panel, CopyBtn } from './shared';

function euclid(a, b) {
  const steps = [];
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y) {
    const q = Math.floor(x / y);
    const r = x % y;
    steps.push({ x, y, q, r });
    x = y;
    y = r;
  }
  return { gcd: x || 1, steps };
}

export default function GcdLcm() {
  const [a, setA] = useState('1071');
  const [b, setB] = useState('462');

  const x = Math.floor(Number(a));
  const y = Math.floor(Number(b));
  const valid = Number.isFinite(x) && Number.isFinite(y) && x !== 0 && y !== 0;
  const { gcd, steps } = valid ? euclid(x, y) : { gcd: 0, steps: [] };
  const lcm = valid ? Math.abs(x * y) / gcd : 0;
  const g = gcd || 1;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Sigma} title="GCD, LCM & Fractions" desc="Greatest common divisor with the working steps, plus the reduced ratio." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First number"><input value={a} onChange={(e) => setA(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Second number"><input value={b} onChange={(e) => setB(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>
      {valid ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="GCD (HCF)" value={String(gcd)} mono />
            <Stat label="LCM" value={lcm.toLocaleString()} mono />
            <Stat label="Coprime?" value={gcd === 1 ? 'Yes — share no factors' : 'No'} />
            <Stat label="Reduced ratio" value={`${x / g} : ${y / g}`} mono />
          </div>
          <Panel>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Euclid's algorithm ({steps.length} steps)</span>
              <CopyBtn value={steps.map((s) => `${s.x} = ${s.y} × ${s.q} + ${s.r}`).join('\n')} label="Copy steps" />
            </div>
            <ol className="space-y-1 font-mono-j text-xs">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>{s.x} = {s.y} × {s.q} + <span className={s.r === 0 ? 'text-cyan-j font-semibold' : ''}>{s.r}</span></span>
                </li>
              ))}
            </ol>
          </Panel>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="Fraction a/b" value={`${x/g}/${y/g}`} mono />
            <Stat label="Decimal value" value={(x / y).toFixed(6)} mono />
            <Stat label="Simplified by" value={`÷ ${g}`} />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Enter two non-zero whole numbers.</div>
      )}
    </div>
  );
}