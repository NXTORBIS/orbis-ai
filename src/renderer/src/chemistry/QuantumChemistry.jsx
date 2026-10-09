import { useMemo, useState } from 'react';
import { Atom } from 'lucide-react';
import { ALL_ELEMENTS } from './lib/elementsData.js';
import { SUBSHELL_ORDER, SUBSHELL_CAPACITY, ORBITAL_SHAPES, QUANTUM_NUMBERS, PRINCIPLES } from './lib/quantumData.js';
import PageTitle from './ui/PageTitle.jsx';

function buildConfig(z) {
  let rem = z;
  const out = [];
  for (const sub of SUBSHELL_ORDER) {
    if (rem <= 0) break;
    const cap = SUBSHELL_CAPACITY[sub[1]];
    const e = Math.min(cap, rem);
    out.push({ sub, count: e });
    rem -= e;
  }
  return out;
}

function orbitals(sub, count) {
  const cap = SUBSHELL_CAPACITY[sub[1]];
  const nOrb = cap / 2;
  const orbs = Array.from({ length: nOrb }, () => []);
  for (let e = 0; e < count; e++) {
    if (e < nOrb) orbs[e] = ['↑'];
    else orbs[e - nOrb] = [orbs[e - nOrb][0], '↓'];
  }
  return orbs;
}

export default function QuantumChemistry() {
  const [z, setZ] = useState(6);
  const el = ALL_ELEMENTS.find((e) => e.atomic_number === z);
  const config = useMemo(() => buildConfig(z), [z]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageTitle title="QUANTUM CHEMISTRY" subtitle="Volume 9 · Quantum numbers, orbitals & electron configurations" />

      <div className="mb-4 glass glass-border rounded-2xl p-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Select element</div>
        <input type="range" min={1} max={36} value={z} onChange={(e) => setZ(+e.target.value)} className="w-full accent-cyan-500" />
        <div className="mt-1 flex items-center gap-3">
          <span className="font-display text-3xl font-bold text-cyan-j">{el?.symbol}</span>
          <span className="text-sm">{el?.name} · Z = {z}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass glass-border rounded-2xl p-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Electron configuration</div>
          <div className="mb-4 font-mono-j text-base text-cyan-j">
            {config.map((c, i) => <span key={i}>{c.sub}<sup>{c.count}</sup> </span>)}
          </div>
          <div className="space-y-2">
            {config.map((c, i) => {
              const orbs = orbitals(c.sub, c.count);
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-10 font-mono-j text-sm text-foreground/80">{c.sub}</span>
                  <div className="flex gap-1.5">
                    {orbs.map((o, j) => (
                      <div key={j} className="grid h-9 w-9 place-items-center rounded-md border border-border/60 bg-card/50 text-sm">
                        {o[0] ? <span className="text-cyan-j">{o[0]}</span> : <span className="text-muted-foreground/30">_</span>}
                        {o[1] && <span className="ml-0.5 text-cyan-j/70">{o[1]}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass glass-border rounded-2xl p-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quantum numbers</div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] text-muted-foreground"><th className="pb-2">Symbol</th><th>Name</th><th>Values</th><th>Meaning</th></tr></thead>
              <tbody>
                {QUANTUM_NUMBERS.map((q) => (
                  <tr key={q.sym} className="border-t border-border/40">
                    <td className="py-2 font-mono-j text-cyan-j">{q.sym}</td>
                    <td>{q.name}</td>
                    <td className="font-mono-j text-xs">{q.values}</td>
                    <td className="text-xs text-muted-foreground">{q.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="glass glass-border rounded-2xl p-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Orbital shapes</div>
            <div className="grid grid-cols-2 gap-2">
              {ORBITAL_SHAPES.map((o) => (
                <div key={o.sub} className="rounded-xl border border-border/60 bg-card/40 p-3">
                  <div className="flex items-center gap-2"><Atom className="h-4 w-4 text-cyan-j" /><span className="font-medium">{o.sub}-orbital</span></div>
                  <div className="text-xs text-muted-foreground">{o.shape} · {o.n} orbital(s)</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{o.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass glass-border rounded-2xl p-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Governing principles</div>
            <div className="space-y-2">
              {PRINCIPLES.map((p) => (
                <div key={p.name}><span className="text-sm font-medium text-cyan-j">{p.name}:</span> <span className="text-xs text-muted-foreground">{p.text}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}