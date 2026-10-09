import React, { useState, useMemo } from 'react';
import { Table2, Search } from 'lucide-react';
import Section from './Section';
import { pauliToString, pauliWeight } from '../lib/qec/pauli.js';
import { syndromeOf, syndromeToKey } from '../lib/qec/decoders.js';

export default function SyndromeTable({ code, lookup }) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const out = [];
    for (const [key, entry] of lookup.entries()) {
      out.push({ syndrome: key, correction: entry.pauli, weight: entry.weight });
    }
    out.sort((a, b) => a.weight - b.weight || a.syndrome.localeCompare(b.syndrome));
    return out;
  }, [lookup]);

  const filtered = query
    ? rows.filter((r) => r.syndrome.includes(query) || r.correction.includes(query.toUpperCase()))
    : rows;

  return (
    <Section title="Syndrome Table" icon={Table2}>
      <div className="mb-2 flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter syndrome or correction…"
          className="flex-1 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
        />
        <span className="text-[10px] text-muted-foreground">{filtered.length}/{rows.length}</span>
      </div>
      <div className="max-h-56 overflow-y-auto scrollbar-thin rounded border border-border/60">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-card">
            <tr className="text-muted-foreground">
              <th className="px-2 py-1">Syndrome</th>
              <th className="px-2 py-1">Correction</th>
              <th className="px-2 py-1">Weight</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((r) => (
              <tr key={r.syndrome} className="border-t border-border/40 font-mono">
                <td className="px-2 py-0.5 text-cyan-j">{r.syndrome}</td>
                <td className="px-2 py-0.5">{r.correction}</td>
                <td className="px-2 py-0.5 text-muted-foreground">{r.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && <div className="px-2 py-1 text-[10px] text-muted-foreground">Showing first 200 of {filtered.length}…</div>}
      </div>
    </Section>
  );
}