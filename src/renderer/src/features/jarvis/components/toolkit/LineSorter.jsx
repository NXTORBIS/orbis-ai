import { useState } from 'react';
import { ListOrdered } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Area, Out, Seg, Stat, ToggleRow } from './shared';

const MODES = [
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
  { value: 'length', label: 'By length' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'reverse', label: 'Reverse lines' },
  { value: 'shuffle', label: 'Shuffle' },
];

export default function LineSorter() {
  const [text, setText] = useState('banana\nApple\ncherry\n10 apples\n2 pears\nApple');
  const [mode, setMode] = useState('az');
  const [dedupe, setDedupe] = useState(false);
  const [trim, setTrim] = useState(true);
  const [dropEmpty, setDropEmpty] = useState(true);

  let lines = text.split('\n');
  if (trim) lines = lines.map((l) => l.trim());
  if (dropEmpty) lines = lines.filter((l) => l.length);
  if (dedupe) lines = [...new Set(lines)];

  const cmp = {
    az: (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    za: (a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }),
    length: (a, b) => a.length - b.length || a.localeCompare(b),
    numeric: (a, b) => parseFloat(a) - parseFloat(b),
  }[mode];

  let out = lines;
  if (cmp) out = [...lines].sort(cmp);
  else if (mode === 'reverse') out = [...lines].reverse();
  else if (mode === 'shuffle') out = [...lines].map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

  const asText = out.join('\n');
  const removed = text.split('\n').length - out.length;

  return (
    <div className="space-y-4">
      <ToolHeader icon={ListOrdered} title="Line Sorter & Deduper" desc="Clean up lists and log files — sort, dedupe and shuffle lines." />
      <Area value={text} onChange={setText} rows={8} mono placeholder="One item per line…" />
      <Seg value={mode} onChange={setMode} options={MODES} />
      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Remove duplicates" checked={dedupe} onChange={setDedupe} />
        <ToggleRow label="Trim whitespace" checked={trim} onChange={setTrim} />
        <ToggleRow label="Drop empty lines" checked={dropEmpty} onChange={setDropEmpty} />
      </div>
      <Out label="Sorted lines" value={asText}>
        <span className="whitespace-pre-wrap font-mono-j text-xs">{asText || '—'}</span>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Lines in" value={String(text.split('\n').length)} />
        <Stat label="Lines out" value={String(out.length)} />
        <Stat label="Removed" value={String(Math.max(0, removed))} />
      </div>
      <Button size="sm" variant="outline" onClick={() => setText(asText)}>Apply to input</Button>
    </div>
  );
}