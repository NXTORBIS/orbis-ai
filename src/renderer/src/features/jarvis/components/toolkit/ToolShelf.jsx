import { cn } from '@jarvis/lib/utils';

/** A labelled row of tool shortcuts — pinned tools, recently used tools. */
export default function ToolShelf({ title, icon: Icon, iconClassName, hint, tools, onOpen }) {
  if (!tools.length) return null;

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        {Icon ? <Icon className={cn('h-4 w-4 text-cyan-j', iconClassName)} strokeWidth={1.5} /> : null}
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</h2>
        {hint && <span className="text-[10px] text-muted-foreground/60">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => onOpen(tool.id)}
            className="tk-card tk-depth relative flex items-center gap-2 overflow-hidden rounded-xl border border-cyan-j/30 bg-card/50 px-3 py-2 text-left"
          >
            <span aria-hidden className="tk-shine pointer-events-none absolute inset-0" />
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-cyan-j/25 to-cyan-j/5 text-cyan-j">
              {tool.icon ? <tool.icon className="h-4 w-4" strokeWidth={1.6} /> : null}
            </span>
            <span className="text-xs font-medium">{tool.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}