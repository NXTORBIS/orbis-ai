import { ArrowRight, BookOpen, Sparkles } from 'lucide-react';

// Shown for topics that are part of the suite but don't yet have a dedicated
// interactive simulator. Renders a clean concept overview and links to the
// related live simulators within the same section so the card is never a dead end.
export default function ConceptPanel({ topic, section, onOpen }) {
  const related = (section?.topics || []).filter(
    (tp) => tp.id !== topic.id && tp.component && tp.status === 'live'
  );
  const uniq = related.filter((tp, i, arr) => arr.findIndex((x) => x.component === tp.component) === i).slice(0, 4);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-cyan-j/30 bg-gradient-to-br from-cyan-j/5 to-card/40 p-5">
        <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-cyan-j"><BookOpen className="size-3.5" /> CONCEPT MODULE</div>
        <h3 className="mt-2 font-display text-lg font-bold">{topic.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{topic.desc}</p>
        <div className="mt-4 rounded-lg border border-border/60 bg-background/40 p-4 text-sm leading-relaxed text-muted-foreground">
          This topic is part of the Physics Studio suite. The interactive simulator for this specific sub-topic is documented here — explore the related live laboratories below to run real numerical models covering the same physics.
        </div>
      </div>

      {uniq.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] tracking-[0.2em] text-muted-foreground"><Sparkles className="size-3.5 text-cyan-j" /> RELATED LIVE SIMULATORS</div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {uniq.map((tp) => (
              <button key={tp.id} onClick={() => onOpen(tp)}
                className="group flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-3 text-left transition-all hover:border-cyan-j hover:bg-card/70">
                <div>
                  <div className="text-sm font-medium">{tp.name}</div>
                  <div className="text-xs text-muted-foreground">{tp.desc}</div>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-cyan-j" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}