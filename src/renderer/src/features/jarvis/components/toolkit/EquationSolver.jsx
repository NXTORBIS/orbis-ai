import { useState } from 'react';
import { Sigma } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Stat } from './shared';

export default function EquationSolver() {
  const [mode, setMode] = useState('quadratic');
  const [a, setA] = useState('1'); const [b, setB] = useState('-3'); const [c, setC] = useState('2');
  const [sol, setSol] = useState(null);

  const solve = () => {
    if (mode === 'linear') {
      const A = parseFloat(a), B = parseFloat(b);
      if (A === 0) { setSol({ err: B === 0 ? 'Infinite solutions' : 'No solution' }); return; }
      setSol({ steps: [`${A}x + ${B} = 0`, `x = -${B} / ${A}`, `x = ${-B / A}`], x: -B / A });
    } else {
      const A = parseFloat(a), B = parseFloat(b), C = parseFloat(c);
      if (A === 0) { setSol({ err: 'Not quadratic (a = 0)' }); return; }
      const disc = B * B - 4 * A * C;
      const steps = [`a=${A}, b=${B}, c=${C}`, `Δ = b² − 4ac = ${B}² − 4·${A}·${C} = ${disc}`];
      if (disc > 0) { const r1 = (-B + Math.sqrt(disc)) / (2 * A), r2 = (-B - Math.sqrt(disc)) / (2 * A); steps.push(`x = (−b ± √Δ) / 2a`, `x₁ = ${r1}, x₂ = ${r2}`); setSol({ steps, x1: r1, x2: r2 }); }
      else if (disc === 0) { const r = -B / (2 * A); steps.push(`x = ${r}`); setSol({ steps, x1: r, x2: r }); }
      else { const re = -B / (2 * A), im = Math.sqrt(-disc) / (2 * A); steps.push(`x = ${re} ± ${im}i`); setSol({ steps, x1: `${re} + ${im}i`, x2: `${re} − ${im}i` }); }
    }
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Sigma} title="Equation Solver" desc="Solve linear and quadratic equations with step-by-step working." />
      <div className="flex gap-2">
        <Button size="sm" variant={mode === 'linear' ? 'default' : 'outline'} onClick={() => setMode('linear')}>Linear (ax + b = 0)</Button>
        <Button size="sm" variant={mode === 'quadratic' ? 'default' : 'outline'} onClick={() => setMode('quadratic')}>Quadratic (ax² + bx + c = 0)</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="a"><Input value={a} onChange={(e) => setA(e.target.value)} className="w-24" /></Field>
        <Field label="b"><Input value={b} onChange={(e) => setB(e.target.value)} className="w-24" /></Field>
        {mode === 'quadratic' && <Field label="c"><Input value={c} onChange={(e) => setC(e.target.value)} className="w-24" /></Field>}
        <Button size="sm" onClick={solve}>Solve</Button>
      </div>
      {sol && (sol.err ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-600">{sol.err}</div> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="x₁" value={sol.x1} mono />
            {sol.x2 !== undefined && <Stat label="x₂" value={sol.x2} mono />}
          </div>
          <div><div className="mb-1 text-xs text-muted-foreground">Steps</div>
            <div className="space-y-1 rounded-md border border-border/70 bg-card/60 p-3 font-mono-j text-xs">{sol.steps.map((s, i) => <div key={i}>{s}</div>)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}