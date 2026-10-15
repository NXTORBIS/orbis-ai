import { useState } from 'react';
import { AlignLeft } from 'lucide-react';
import { ToolHeader, Area, Stat } from './shared';

export default function WordCounter() {
  const [text, setText] = useState('');

  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/) : [];
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length;
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim()).length;
  const unique = new Set(words.map((w) => w.toLowerCase().replace(/[^\w']/g, ''))).size;
  const longest = words.reduce((a, w) => (w.replace(/\W/g, '').length > a.length ? w : a), '');

  const stats = [
    ['Words', words.length],
    ['Characters', text.length],
    ['No spaces', text.replace(/\s/g, '').length],
    ['Sentences', sentences],
    ['Paragraphs', paragraphs],
    ['Unique words', unique],
    ['Avg word length', words.length ? (words.join('').length / words.length).toFixed(1) : '0'],
    ['Reading time', `${words.length ? Math.max(1, Math.ceil(words.length / 200)) : 0} min`],
    ['Speaking time', `${words.length ? Math.max(1, Math.ceil(words.length / 130)) : 0} min`],
    ['Longest word', longest || '—'],
  ];

  return (
    <div className="space-y-4">
      <ToolHeader icon={AlignLeft} title="Word & Character Counter" desc="Live statistics, reading time and speaking time as you type." />
      <Area value={text} onChange={setText} rows={8} placeholder="Start typing or paste your text…" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(([label, value]) => <Stat key={label} label={label} value={String(value)} />)}
      </div>
    </div>
  );
}