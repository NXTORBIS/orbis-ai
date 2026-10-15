import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { ToolHeader, Area, Out, Seg, Stat } from './shared';

const MODES = {
  chars: { label: 'Reverse characters', fn: (s) => Array.from(s).reverse().join('') },
  words: { label: 'Reverse word order', fn: (s) => s.split(/\s+/).reverse().join(' ') },
  lines: { label: 'Reverse line order', fn: (s) => s.split('\n').reverse().join('\n') },
  each: { label: 'Reverse each word', fn: (s) => s.split(/(\s+)/).map((w) => (/\s/.test(w) ? w : Array.from(w).reverse().join(''))).join('') },
  mirror: { label: 'Mirror (reverse + flip)', fn: (s) => Array.from(s).reverse().join('').replace(/[()<>\[\]{}]/g, (c) => ({ '(': ')', ')': '(', '<': '>', '>': '<', '[': ']', ']': '[', '{': '}', '}': '{' }[c])) },
};

export default function TextReverser() {
  const [text, setText] = useState('Mark32 keeps everything in one place');
  const [mode, setMode] = useState('chars');
  const out = MODES[mode].fn(text);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Repeat} title="Text Reverser" desc="Flip text by character, word, line — or mirror it for puzzles." />
      <Area value={text} onChange={setText} rows={4} placeholder="Text to reverse…" />
      <Seg value={mode} onChange={setMode} options={Object.entries(MODES).map(([value, m]) => ({ value, label: m.label }))} />
      <Out label={MODES[mode].label} value={out}>
        <span className="whitespace-pre-wrap">{out || '—'}</span>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Input length" value={String(text.length)} />
        <Stat label="Output length" value={String(out.length)} />
        <Stat label="Lines" value={String(text.split('\n').length)} />
      </div>
    </div>
  );
}