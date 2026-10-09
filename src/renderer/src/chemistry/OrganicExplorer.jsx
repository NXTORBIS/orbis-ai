import { useState } from 'react';
import { motion } from './ui/motion.jsx';
import { Leaf, BookOpen } from 'lucide-react';
import { FUNCTIONAL_GROUPS, IUPAC_RULES } from './lib/organicData.js';
import AIPanel from './parts/AIPanel.jsx';
import PageTitle from './ui/PageTitle.jsx';

export default function OrganicExplorer() {
  const [sel, setSel] = useState(FUNCTIONAL_GROUPS[0]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageTitle title="ORGANIC CHEMISTRY" subtitle="Volume 7 · Functional groups, IUPAC naming, and reactions" />
      <div className="grid gap-4 lg:grid-cols-[280px,1fr]">
        <div className="glass glass-border rounded-2xl p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Functional Groups</div>
          <div className="space-y-1">
            {FUNCTIONAL_GROUPS.map((g) => (
              <button key={g.id} onClick={() => setSel(g)} className={`w-full rounded-lg border px-3 py-2 text-left transition ${g.id === sel.id ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/40 hover:border-border'}`}>
                <div className="text-sm font-medium">{g.name}</div>
                <div className="font-mono-j text-[11px] text-muted-foreground">{g.general}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <motion.div key={sel.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass glass-border rounded-2xl p-6">
            <div className="flex items-center gap-2"><Leaf className="h-5 w-5 text-cyan-j" /><h2 className="font-display text-2xl font-bold">{sel.name}</h2></div>
            <p className="mt-2 text-sm text-foreground/85">{sel.description}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-card/40 p-3"><div className="text-[10px] uppercase text-muted-foreground">General formula</div><div className="mt-1 font-mono-j text-lg text-cyan-j">{sel.general}</div></div>
              <div className="rounded-xl border border-border/60 bg-card/40 p-3"><div className="text-[10px] uppercase text-muted-foreground">IUPAC suffix</div><div className="mt-1 font-medium">{sel.suffix}</div></div>
            </div>
            <div className="mt-3 rounded-xl border border-border/60 bg-card/40 p-3"><div className="text-[10px] uppercase text-muted-foreground">Example</div><div className="mt-1 text-sm">{sel.example}</div></div>
            <div className="mt-3">
              <div className="text-[10px] uppercase text-muted-foreground">Characteristic reactions</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sel.reactions.map((r) => <span key={r} className="rounded-full border border-border/60 bg-card/50 px-2.5 py-1 text-[11px]">{r}</span>)}
              </div>
            </div>
          </motion.div>

          <div className="glass glass-border rounded-2xl p-5">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><BookOpen className="h-4 w-4 text-cyan-j" /> IUPAC naming rules</div>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground/85">
              {IUPAC_RULES.map((r, i) => <li key={i}>{r}</li>)}
            </ol>
          </div>

          <div className="glass glass-border rounded-2xl p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Organic chemistry tutor</div>
            <AIPanel systemContext="You are an organic chemistry tutor. Help with IUPAC naming, functional groups, and mechanisms." initialPrompt={`Explain the ${sel.name} functional group with naming rules and an example reaction.`} />
          </div>
        </div>
      </div>
    </div>
  );
}