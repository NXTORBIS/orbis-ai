import { useState } from 'react';
import { Type } from 'lucide-react';
import { ToolHeader, Area, Out, Seg, useCopy, Stat } from './shared';

const WORDS = (s) => s.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean);

export const CASES = {
  upper: { label: 'UPPER', fn: (s) => s.toUpperCase() },
  lower: { label: 'lower', fn: (s) => s.toLowerCase() },
  title: { label: 'Title Case', fn: (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) },
  sentence: { label: 'Sentence case', fn: (s) => s.toLowerCase().replace(/(^\s*\S|[.!?]\s+\S)/g, (c) => c.toUpperCase()) },
  camel: { label: 'camelCase', fn: (s) => WORDS(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') },
  pascal: { label: 'PascalCase', fn: (s) => WORDS(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('') },
  snake: { label: 'snake_case', fn: (s) => WORDS(s).map((w) => w.toLowerCase()).join('_') },
  kebab: { label: 'kebab-case', fn: (s) => WORDS(s).map((w) => w.toLowerCase()).join('-') },
  constant: { label: 'CONSTANT_CASE', fn: (s) => WORDS(s).map((w) => w.toUpperCase()).join('_') },
};

export default function CaseConverter() {
  const [text, setText] = useState('the quick brown fox jumps over the lazy dog');
  const [mode, setMode] = useState('title');
  const { copied, copy } = useCopy();
  const out = CASES[mode].fn(text);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Type} title="Case Converter" desc="Rewrite text in nine writing and naming styles, live." />
      <Area value={text} onChange={setText} rows={4} placeholder="Paste text to convert…" />
      <Seg value={mode} onChange={setMode} options={Object.entries(CASES).map(([value, c]) => ({ value, label: c.label }))} />
      <Out label={CASES[mode].label} value={out}>
        <span className="whitespace-pre-wrap">{out || '—'}</span>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Characters" value={String(out.length)} />
        <Stat label="Words" value={String(WORDS(out).length)} />
        <Stat label="Lines" value={String(out.split('\n').length)} />
      </div>
      <button
        onClick={() => copy(out)}
        className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground"
      >
        {copied ? 'Copied to clipboard' : 'Copy result'}
      </button>
    </div>
  );
}