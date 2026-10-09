import { useMemo, useState } from 'react';
import { Atom } from 'lucide-react';
import { parseFormula, molarMass, atomCount, massPercent } from './lib/chemistry.js';
import { renderFormula } from './lib/formulaRender.jsx';
import { MOLECULES } from './lib/moleculeGallery.js';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import AIPanel from './parts/AIPanel.jsx';
import PageTitle from './ui/PageTitle.jsx';

const COLORS = ['#22d3ee','#a78bfa','#f472b6','#facc15','#34d399','#fb7185','#60a5fa','#f59e0b'];

export default function MolecularStudio() {
  const [formula, setFormula] = useState('H2SO4');

  const parsed = useMemo(() => {
    const counts = parseFormula(formula);
    const { mass, breakdown } = molarMass(formula);
    const comp = massPercent(formula);
    return { counts, mass, breakdown, comp, atoms: atomCount(formula) };
  }, [formula]);

  const pieData = parsed.comp.map((c) => ({ name: c.symbol, value: c.percent }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageTitle title="MOLECULAR STUDIO" subtitle="Volume 5 · Parse formulas, compute molar mass & composition, explore molecules" />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass glass-border rounded-2xl p-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enter a chemical formula</div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2">
            <Atom className="h-4 w-4 text-cyan-j" />
            <input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="e.g. C6H12O6" className="flex-1 bg-transparent font-mono-j text-lg outline-none" />
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {['H2O','CO2','CH4','NH3','C6H12O6','H2SO4','NaCl','CaCO3','C2H5OH'].map((f) => (
              <button key={f} onClick={() => setFormula(f)} className="rounded-full border border-border/60 bg-card/50 px-2.5 py-1 text-[11px] font-mono-j hover:border-cyan-j/50">{f}</button>
            ))}
          </div>

          <div className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Formula</span><span className="font-mono-j text-lg text-cyan-j">{renderFormula(formula)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Molar mass</span><span className="font-medium">{parsed.mass ? parsed.mass.toFixed(3) : '—'} g/mol</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total atoms</span><span className="font-medium">{parsed.atoms}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Elements</span><span className="font-medium">{Object.keys(parsed.counts).length}</span></div>
          </div>

          {parsed.breakdown.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Breakdown</div>
              <div className="space-y-1.5">
                {parsed.breakdown.map((b) => (
                  <div key={b.symbol} className="flex items-center justify-between text-xs">
                    <span className="font-medium">{b.symbol} ({b.name}) ×{b.count}</span>
                    <span className="text-muted-foreground">{b.atomicMass} × {b.count} = {b.contribution.toFixed(3)} g</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass glass-border rounded-2xl p-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mass composition</div>
            {pieData.length ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={70} innerRadius={40}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => v.toFixed(2) + '%'} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {parsed.comp.map((c, i) => (
                    <div key={c.symbol} className="flex items-center gap-2 text-xs">
                      <span className="h-3 w-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="font-medium">{c.symbol}</span>
                      <span className="text-muted-foreground">{c.percent.toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="text-xs text-muted-foreground">Enter a valid formula.</p>}
          </div>

          <div className="glass glass-border rounded-2xl p-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Molecule gallery</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {MOLECULES.map((m) => (
                <button key={m.formula} onClick={() => setFormula(m.formula)} className="rounded-xl border border-border/60 bg-card/40 p-2 text-left transition hover:border-cyan-j/50">
                  <svg viewBox="0 0 240 180" className="h-24 w-full">
                    {m.bonds.map((bd, i) => {
                      const a = m.atoms[bd.a], b = m.atoms[bd.b];
                      return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#64748b" strokeWidth={bd.o === 2 ? 4 : 2} />;
                    })}
                    {m.atoms.map((at, i) => (
                      <g key={i}>
                        <circle cx={at.x} cy={at.y} r={11} fill={at.color} stroke="#0f172a" strokeWidth={1} />
                        <text x={at.x} y={at.y + 4} textAnchor="middle" fontSize="10" fill="#0f172a" fontWeight="bold">{at.sym}</text>
                      </g>
                    ))}
                  </svg>
                  <div className="mt-1 text-[11px] font-medium">{m.name}</div>
                  <div className="font-mono-j text-[10px] text-muted-foreground">{m.formula}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="glass glass-border mt-4 rounded-2xl p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Molecular AI assistant</div>
        <AIPanel systemContext={`You are a chemistry expert. The user is exploring the molecule "${formula}". Explain structure, bonding, polarity, and uses.`} initialPrompt={`Describe the molecular structure and key properties of ${formula}.`} />
      </div>
    </div>
  );
}