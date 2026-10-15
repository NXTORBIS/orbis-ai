import { Check, Loader2, X } from 'lucide-react';

/**
 * Shared chrome for the engines: a progress line while something long is running, and
 * a checks panel for the independent verifications each engine performs on its own
 * output.
 */

export function EngineProgress({ busy, phase, done, total, stats = [] }) {
  if (!busy && !phase) return null;
  const ratio = total ? Math.min(1, done / total) : null;
  return (
    <div className="tk-glass-panel space-y-2 rounded-xl px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-j" />}
        <span className="font-medium">{phase || 'Working'}</span>
        {ratio != null && <span className="font-mono-j text-[11px] text-muted-foreground">{Math.round(ratio * 100)}%</span>}
        {stats.map((item) => (
          <span key={item} className="font-mono-j text-[11px] text-muted-foreground">· {item}</span>
        ))}
      </div>
      {ratio != null && (
        <div className="h-1 overflow-hidden rounded-full bg-border/60">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-j/60 to-cyan-j transition-[width] duration-200" style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function VerifyPanel({ title = 'Independent checks', items = [], note }) {
  if (!items.length) return null;
  const failed = items.filter((item) => item.ok === false).length;
  return (
    <div className="tk-glass-panel rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{title}</span>
        <span className={failed
          ? 'rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono-j text-[10px] text-amber-400'
          : 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono-j text-[10px] text-emerald-400'}
        >
          {failed ? `${failed} not passing` : 'all passing'}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-2 text-[11px]">
            {item.ok === false
              ? <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />}
            <span className="min-w-0">
              <span className="text-foreground">{item.label}</span>
              {item.detail && <span className="ml-1 font-mono-j text-muted-foreground">{item.detail}</span>}
            </span>
          </div>
        ))}
      </div>
      {note && <p className="mt-2 text-[11px] text-muted-foreground/80">{note}</p>}
    </div>
  );
}