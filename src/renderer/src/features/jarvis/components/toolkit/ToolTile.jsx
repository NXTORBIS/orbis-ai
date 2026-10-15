import { cn } from '@jarvis/lib/utils';

/** One tool card — shared by browsing, search results and shelves. */
export default function ToolTile({ tool, categoryLabel, onOpen, className }) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(tool.id)}
      className={cn(
        'tk-card tk-depth tk-topline group relative flex flex-col items-start gap-2 overflow-hidden rounded-xl border border-border/70 bg-card/50 p-3 text-left',
        className,
      )}
    >
      <span aria-hidden className="tk-shine pointer-events-none absolute inset-0" />
      {tool.isNew && (
        <span className="premium-glow absolute right-2 top-2 rounded-full border border-cyan-j/40 bg-cyan-j/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-cyan-j">
          new
        </span>
      )}
      <div className="relative grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-cyan-j/25 to-cyan-j/5 text-cyan-j transition group-hover:scale-110">
        {Icon ? <Icon className="h-5 w-5" strokeWidth={1.5} /> : null}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{tool.label}</div>
        <div className="tk-desc mt-0.5 text-[11px] leading-tight text-muted-foreground">{tool.desc}</div>
        {categoryLabel && (
          <div className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">{categoryLabel}</div>
        )}
      </div>
    </button>
  );
}