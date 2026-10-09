import React, { useState, useMemo, useRef, useEffect } from 'react';
import { LANGUAGES, LANGUAGE_CATEGORIES } from '../lib/languages.js';
import { ChevronDown, Search, Check } from 'lucide-react';

// Searchable language selector grouped by category.
// When `executionOnly` is true, only languages whose runtime is configured are shown
// as executable — others appear greyed and labelled "not executable".
export default function LanguageSelector({ value, onChange, executionOnly = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const selected = LANGUAGES.find((l) => l.id === value);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return LANGUAGES.filter((l) => !query || l.label.toLowerCase().includes(query));
  }, [q]);

  const openMenu = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 4, left: r.right - 256 });
    setOpen((o) => !o);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={openMenu}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-cyan-j/50"
      >
        <span>{selected?.label || 'Select language'}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div
          style={{ position: 'fixed', top: `${menuPos.top}px`, left: `${menuPos.left}px`, zIndex: 9999 }}
          className="w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
              <input
                autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search language…"
                className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs focus:border-cyan-j focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto scrollbar-thin">
            {LANGUAGE_CATEGORIES.map((cat) => {
              const items = filtered.filter((l) => l.category === cat);
              if (!items.length) return null;
              return (
                <div key={cat}>
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{cat}</div>
                  {items.map((l) => {
                    const disabled = executionOnly && !l.executionAvailable;
                    return (
                      <button
                        key={l.id}
                        disabled={disabled}
                        onClick={() => { onChange(l.id); setOpen(false); setQ(''); }}
                        className={`flex w-full items-center justify-between px-2.5 py-1.5 text-xs transition ${
                          l.id === value ? 'bg-cyan-j/10 text-cyan-j' : 'hover:bg-accent text-foreground'
                        } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                      >
                        <span>{l.label}</span>
                        <span className="flex items-center gap-1.5">
                          {disabled && <span className="text-[9px] text-muted-foreground">not executable</span>}
                          {l.id === value && <Check className="size-3" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {!filtered.length && <div className="px-2.5 py-3 text-center text-xs text-muted-foreground">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}