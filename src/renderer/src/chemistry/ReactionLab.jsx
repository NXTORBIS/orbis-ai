import { useMemo, useState } from 'react';
import { motion } from './ui/motion.jsx';
import { FlaskConical, Zap, Play, ChevronRight } from 'lucide-react';
import { REACTIONS, REACTION_TYPES } from './lib/reactionData.js';
import { renderEquation } from './lib/formulaRender.jsx';
import AIPanel from './parts/AIPanel.jsx';
import PageTitle from './ui/PageTitle.jsx';

export default function ReactionLab() {
  const [type, setType] = useState(null);
  const [selId, setSelId] = useState(REACTIONS[0].id);
  const [playing, setPlaying] = useState(false);

  const list = useMemo(() => REACTIONS.filter((r) => !type || r.type === type), [type]);
  const sel = REACTIONS.find((r) => r.id === selId) || REACTIONS[0];
  const selType = REACTION_TYPES.find((t) => t.id === sel.type);

  const simulate = () => {
    setPlaying(true);
    setTimeout(() => setPlaying(false), 2200);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageTitle title="REACTION SIMULATOR" subtitle="Volume 4 · Explore reaction types, balance equations, and simulate reactions" />

      <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
        <div className="glass glass-border rounded-2xl p-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button onClick={() => setType(null)} className={`rounded-full border px-2.5 py-1 text-[10px] transition ${!type ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/50'}`}>All</button>
            {REACTION_TYPES.map((t) => (
              <button key={t.id} onClick={() => setType(t.id)} className={`rounded-full border px-2.5 py-1 text-[10px] transition ${type === t.id ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/50'}`}>{t.label}</button>
            ))}
          </div>
          <div className="scrollbar-thin max-h-[58vh] space-y-1.5 overflow-y-auto pr-1">
            {list.map((r) => (
              <button key={r.id} onClick={() => setSelId(r.id)} className={`w-full rounded-xl border px-3 py-2 text-left transition ${r.id === selId ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/40 hover:border-border'}`}>
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-[11px] text-muted-foreground">{r.equation}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <motion.div key={sel.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass glass-border rounded-2xl p-6">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full border border-cyan-j/40 bg-cyan-j/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-j">{selType?.label}</span>
              <span className="text-xs text-muted-foreground">{sel.energy}</span>
            </div>
            <h2 className="font-display text-2xl font-bold">{sel.name}</h2>
            <div className="my-5 flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-card/40 px-4 py-6 text-center">
              {renderEquation(sel.equation)}
            </div>
            <p className="text-sm text-foreground/85">{sel.description}</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Zap className="h-3.5 w-3.5 text-cyan-j" /> Conditions: {sel.conditions}</div>

            <div className="mt-5 flex items-center gap-3">
              <button onClick={simulate} className="flex items-center gap-2 rounded-xl bg-cyan-j px-4 py-2 text-sm font-medium text-background transition hover:opacity-90">
                <Play className="h-4 w-4" /> {playing ? 'Reacting…' : 'Simulate'}
              </button>
              {playing && (
                <div className="flex items-center gap-2 text-xs text-cyan-j">
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-card">
                    <motion.div className="h-full bg-cyan-j" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 2 }} />
                  </div>
                  <ChevronRight className="h-3 w-3" />
                </div>
              )}
            </div>
          </motion.div>

          <div className="glass glass-border rounded-2xl p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ask about this reaction</div>
            <AIPanel systemContext={`Reaction in focus: ${sel.name} (${sel.equation}). Type: ${selType?.label}. Explain chemistry accurately.`} initialPrompt={`Explain the reaction "${sel.name}" step by step, including what is oxidized/reduced and why it is ${sel.energy}.`} />
          </div>
        </div>
      </div>
    </div>
  );
}