import { useState, useMemo } from 'react';
import { Search, BookOpen, ChevronDown } from 'lucide-react';
import { FORMULA_CATEGORIES, searchFormulas } from '../lib/trigFormulas.js';

export default function FormulaReference() {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState(null);

  const results = useMemo(() => searchFormulas(query, cat), [query, cat]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: double angle, sin 2x, allied angles, half angle, inverse trig…"
            className="w-full rounded-xl border border-border/60 bg-card/40 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-cyan-j/50"
          />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 text-sm">
          <option value="all">All categories</option>
          {FORMULA_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="text-xs text-muted-foreground">{results.length} formula{results.length !== 1 ? 's' : ''}</div>

      <div className="grid gap-2.5">
        {results.map((f) => {
          const isOpen = open === f.id;
          return (
            <div key={f.id} className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl">
              <button onClick={() => setOpen(isOpen ? null : f.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="rounded-md bg-cyan-j/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-j">{f.category}</span>
                <span className="flex-1 font-display text-sm font-semibold">{f.name}</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className="px-4 pb-3">
                <div className="rounded-xl border border-cyan-j/20 bg-background/40 px-4 py-3 font-mono-j text-base font-semibold text-cyan-j">{f.formula}</div>
                {isOpen && (
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <Detail label="Meaning" value={f.meaning} />
                    <Detail label="When to use" value={f.use} />
                    <Detail label="Example" value={f.example} accent />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {results.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <BookOpen className="h-8 w-8 opacity-40" />
            <p className="text-sm">No formulas match “{query}”.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const Detail = ({ label, value, accent }) => (
  <div className="rounded-xl border border-border/40 bg-background/30 px-3 py-2">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={`text-sm ${accent ? 'text-cyan-j' : 'text-foreground'}`}>{value}</div>
  </div>
);