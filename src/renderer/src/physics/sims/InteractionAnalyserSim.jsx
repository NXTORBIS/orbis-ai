import React, { useMemo, useState } from 'react';
import { ResearchHeader, Card, SciTable, AIPanel, useAIExplain } from '../research.jsx';

// Unique interaction-analyser engine: checks particle reactions against
// conservation of electric charge (Q), baryon number (B), lepton number (L),
// and individual lepton family numbers (Le, Lμ, Lτ). Supports antiparticles
// (bar prefix) and decays as well as scattering.

const PARTICLES = {
  // Quarks
  u:  { Q: 2/3,  B: 1/3, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'quark' },
  d:  { Q: -1/3, B: 1/3, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'quark' },
  c:  { Q: 2/3,  B: 1/3, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'quark' },
  s:  { Q: -1/3, B: 1/3, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'quark' },
  t:  { Q: 2/3,  B: 1/3, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'quark' },
  b:  { Q: -1/3, B: 1/3, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'quark' },
  // Leptons
  'e-':  { Q: -1, B: 0, L: 1, Le: 1, Lmu: 0, Ltau: 0, type: 'lepton' },
  'mu-': { Q: -1, B: 0, L: 1, Le: 0, Lmu: 1, Ltau: 0, type: 'lepton' },
  'tau-':{ Q: -1, B: 0, L: 1, Le: 0, Lmu: 0, Ltau: 1, type: 'lepton' },
  've':  { Q: 0,  B: 0, L: 1, Le: 1, Lmu: 0, Ltau: 0, type: 'lepton' },
  'vmu': { Q: 0,  B: 0, L: 1, Le: 0, Lmu: 1, Ltau: 0, type: 'lepton' },
  'vtau':{ Q: 0,  B: 0, L: 1, Le: 0, Lmu: 0, Ltau: 1, type: 'lepton' },
  // Bosons
  'g':   { Q: 0, B: 0, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'boson' },
  'gamma':{ Q: 0, B: 0, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'boson' },
  'W+':  { Q: 1, B: 0, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'boson' },
  'W-':  { Q: -1,B: 0, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'boson' },
  'Z':   { Q: 0, B: 0, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'boson' },
  'H':   { Q: 0, B: 0, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'boson' },
  // Composite
  'p':   { Q: 1, B: 1, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'baryon' },
  'n':   { Q: 0, B: 1, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'baryon' },
  'pi0': { Q: 0, B: 0, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'meson' },
  'pi+': { Q: 1, B: 0, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'meson' },
  'pi-': { Q: -1,B: 0, L: 0, Le: 0, Lmu: 0, Ltau: 0, type: 'meson' },
};

// Antiparticle: flip all quantum numbers
function getParticle(sym) {
  if (PARTICLES[sym]) return PARTICLES[sym];
  if (sym.startsWith('anti-')) {
    const base = PARTICLES[sym.slice(5)];
    if (base) return { ...base, Q: -base.Q, B: -base.B, L: -base.L, Le: -base.Le, Lmu: -base.Lmu, Ltau: -base.Ltau };
  }
  // e+ = anti e-, etc.
  if (sym === 'e+') return { ...PARTICLES['e-'], Q: 1, Le: -1, L: -1 };
  if (sym === 'mu+') return { ...PARTICLES['mu-'], Q: 1, Lmu: -1, L: -1 };
  if (sym === 'tau+') return { ...PARTICLES['tau-'], Q: 1, Ltau: -1, L: -1 };
  if (sym === 'anti-ve') return { ...PARTICLES['ve'], Le: -1, L: -1 };
  if (sym === 'anti-vmu') return { ...PARTICLES['vmu'], Lmu: -1, L: -1 };
  if (sym === 'anti-vtau') return { ...PARTICLES['vtau'], Ltau: -1, L: -1 };
  if (sym === 'anti-p') return { ...PARTICLES['p'], Q: -1, B: -1 };
  if (sym === 'anti-n') return { ...PARTICLES['n'], B: -1 };
  return null;
}

const PRESETS = [
  'n -> p + e- + anti-ve',
  'p + anti-p -> pi+ + pi-',
  'mu- -> e- + anti-ve + vmu',
  'pi0 -> gamma + gamma',
  'tau- -> mu- + anti-vmu + vtau',
  'e- + e+ -> mu- + mu+',
  'p -> n + e+ + ve',
  'd -> u + W-',
];

function analyse(rxn) {
  const [lhsStr, rhsStr] = rxn.split('->').map((s) => s.trim());
  if (!rhsStr) return null;
  const lhs = lhsStr.split(/\s+\+\s+/);
  const rhs = rhsStr.split(/\s+\+\s+/);
  const keys = ['Q', 'B', 'L', 'Le', 'Lmu', 'Ltau'];
  const sum = (side, key) => side.reduce((s, sym) => {
    const p = getParticle(sym); return s + (p ? p[key] : 0);
  }, 0);
  const deltas = {};
  for (const k of keys) deltas[k] = +(sum(lhs, k) - sum(rhs, k)).toFixed(4);
  const ok = keys.every((k) => Math.abs(deltas[k]) < 1e-9);
  const unknown = [...lhs, ...rhs].filter((sym) => !getParticle(sym));
  return { deltas, ok, lhs, rhs, unknown };
}

export default function InteractionAnalyserSim() {
  const [rxn, setRxn] = useState('n -> p + e- + anti-ve');
  const res = useMemo(() => analyse(rxn), [rxn]);
  const { explain, explaining, output } = useAIExplain();

  return (
    <div className="space-y-4">
      <ResearchHeader title="Interaction Analyser" subtitle="Check particle reactions against conservation of charge (Q), baryon number (B), lepton number (L), and individual lepton family numbers (Le, Lμ, Lτ). Supports antiparticles and decays."
        onExplain={() => explain(`Interaction analyser: "${rxn}" ${res?.ok ? 'CONSERVES' : 'VIOLATES'} all quantum numbers.`)} explaining={explaining} />
      <Card title="Reaction Input">
        <input value={rxn} onChange={(e) => setRxn(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm" placeholder="e.g. n -> p + e- + anti-ve" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((r) => <button key={r} onClick={() => setRxn(r)} className="rounded-full border border-border/60 bg-card/40 px-2.5 py-1 text-xs font-mono hover:border-cyan-j">{r}</button>)}
        </div>
      </Card>
      {res && res.unknown.length === 0 && (
        <div className={`rounded-xl border p-4 ${res.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
          <div className={`font-display text-sm font-bold uppercase ${res.ok ? 'text-emerald-500' : 'text-red-500'}`}>{res.ok ? '✓ All quantum numbers conserved' : '✗ Conservation violated'}</div>
          <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2">
            {Object.entries(res.deltas).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border/40 bg-card/40 p-2 text-center">
                <div className="text-[10px] uppercase text-muted-foreground">Δ{k}</div>
                <div className={`font-mono text-sm ${Math.abs(v) < 1e-9 ? 'text-emerald-500' : 'text-red-500'}`}>{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            <strong>Reaction:</strong> {res.lhs.join(' + ')} → {res.rhs.join(' + ')}
          </div>
        </div>
      )}
      {res && res.unknown.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400">
          Unknown particles: {res.unknown.join(', ')}. Use symbols: u d c s t b, e- mu- tau-, ve vmu vtau, g gamma W+ W- Z H, p n pi0 pi+ pi-, anti-* for antiparticles.
        </div>
      )}
      <Card title="Available Particles">
        <SciTable headers={['Sym', 'Type', 'Q', 'B', 'L']} rows={Object.keys(PARTICLES).map((s) => [s, PARTICLES[s].type, PARTICLES[s].Q, PARTICLES[s].B, PARTICLES[s].L])} />
      </Card>
      <AIPanel output={output} />
    </div>
  );
}