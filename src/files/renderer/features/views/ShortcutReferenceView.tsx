// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { useMemo, useState } from 'react';
import { COMMANDS, bindingsFor, keyLabel, type Command } from '../../commands';
import { Icon } from '../../ui/Icon';

interface ShortcutEntry {
  id: string;
  title: string;
  category: string;
  description?: string;
  keys: string[];
  labels: string[];
}

function buildEntries(): ShortcutEntry[] {
  return COMMANDS.map((c) => {
    const keys = bindingsFor(c.id);
    return {
      id: c.id,
      title: c.title,
      category: c.category,
      description: c.description,
      keys,
      labels: keys.map(keyLabel),
    };
  }).filter((e) => e.keys.length > 0);
}

const CATEGORIES: readonly string[] = ['Navigate', 'File', 'Edit', 'View', 'Tools', 'Window', 'Customize', 'AI', 'Actions'];

export function ShortcutReferenceView() {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const entries = useMemo(buildEntries, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return entries.filter((e) => {
      if (selectedCategory && e.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q) ||
        e.labels.some((l) => l.toLowerCase().includes(q)) ||
        e.keys.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [entries, query, selectedCategory]);

  const grouped = useMemo(() => {
    const map = new Map<string, ShortcutEntry[]>();
    for (const e of filtered) {
      const list = map.get(e.category) ?? [];
      list.push(e);
      map.set(e.category, list);
    }
    return CATEGORIES.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
  }, [filtered]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    return counts;
  }, [entries]);

  return (
    <div className="tool-view scroll-y shortcut-ref">
      <header className="view-header">
        <h1><Icon name="keyboard" size={20} /> Keyboard Shortcuts</h1>
        <p className="muted small">Press F1 anytime to open this reference. Shortcuts can be customized in Customization Studio → Keyboard shortcuts.</p>
      </header>

      <div className="shortcut-ref-controls">
        <div className="shortcut-ref-search">
          <Icon name="search" size={14} className="muted" />
          <input
            type="text"
            placeholder="Search shortcuts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button type="button" className="shortcut-ref-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        <div className="shortcut-ref-filters">
          <button
            type="button"
            className={`shortcut-ref-chip ${selectedCategory === null ? 'active' : ''}`}
            onClick={() => setSelectedCategory(null)}
          >
            All ({entries.length})
          </button>
          {CATEGORIES.filter((c) => categoryCounts.has(c)).map((c) => (
            <button
              key={c}
              type="button"
              className={`shortcut-ref-chip ${selectedCategory === c ? 'active' : ''}`}
              onClick={() => setSelectedCategory(selectedCategory === c ? null : c)}
            >
              {c} ({categoryCounts.get(c)})
            </button>
          ))}
        </div>
      </div>

      {grouped.length === 0 && (
        <div className="shortcut-ref-empty">
          <Icon name="search" size={32} className="muted" />
          <p className="muted">No shortcuts match "{query}"</p>
        </div>
      )}

      {grouped.map(({ category, items }) => (
        <section key={category} className="shortcut-ref-group">
          <h2>{category}</h2>
          <div className="shortcut-ref-table">
            {items.map((e) => (
              <div key={e.id} className="shortcut-ref-row">
                <div className="shortcut-ref-info">
                  <span className="shortcut-ref-title">{e.title}</span>
                  {e.description && <span className="shortcut-ref-desc muted small">{e.description}</span>}
                </div>
                <div className="shortcut-ref-keys">
                  {e.labels.map((l, i) => (
                    <kbd key={i}>{l}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <footer className="shortcut-ref-footer muted small">
        <p>{filtered.length} shortcut{filtered.length !== 1 ? 's' : ''} shown · {entries.length} total</p>
      </footer>
    </div>
  );
}
