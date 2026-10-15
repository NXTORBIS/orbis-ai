import { SearchX } from 'lucide-react';
import ToolTile from './ToolTile';

/** Ranked search results, shown instead of the category grid while a query is active. */
export default function ToolResults({ results, query, onOpen, onClear }) {
  if (!results.length) {
    return (
      <div className="tk-card tk-depth rounded-xl border border-border/70 bg-card/50 px-4 py-8 text-center">
        <SearchX className="mx-auto h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <p className="mt-2 text-sm">Nothing matches “{query}”.</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Try the job rather than the name — “split a bill”, “voltage drop”, “resize an image”.
        </p>
        <button
          type="button"
          onClick={onClear}
          className="mt-3 rounded-lg border border-cyan-j/40 bg-card/60 px-3 py-1.5 text-[11px] text-cyan-j transition hover:border-cyan-j/70"
        >
          Clear search
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 text-xs text-muted-foreground">
        {results.length} {results.length === 1 ? 'tool' : 'tools'} for “{query}”, best match first
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {results.map(({ tool, category }) => (
          <ToolTile key={tool.id} tool={tool} categoryLabel={category.label} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}