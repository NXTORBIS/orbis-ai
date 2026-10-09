import React from 'react';
import { Boxes } from 'lucide-react';
import { CODE_LIST } from '../lib/qec/codes.js';
import Section from './Section';

export default function CodeSelector({ value, onChange }) {
  return (
    <Section title="QEC Code" icon={Boxes}>
      <div className="grid gap-2 sm:grid-cols-2">
        {CODE_LIST.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              onClick={() => onChange(c.id)}
              className={`rounded-lg border p-3 text-left transition-colors ${active ? 'border-cyan-j bg-cyan-j/10' : 'border-border hover:border-cyan-j/50'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{c.name}</span>
                <span className="font-mono text-[10px] text-cyan-j">{c.tag}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                n={c.n} · k={c.k} · d={c.d} · t={c.t}
              </div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}