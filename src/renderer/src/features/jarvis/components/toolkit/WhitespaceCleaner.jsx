import { useState } from 'react';
import { Eraser } from 'lucide-react';
import { ToolHeader, Area, Out, Stat, ToggleRow } from './shared';

export default function WhitespaceCleaner() {
  const [text, setText] = useState('   Hello   world,\n\n\n\tthis  line   has   tabs and trailing spaces   \n  ');
  const [trim, setTrim] = useState(true);
  const [collapse, setCollapse] = useState(true);
  const [dropEmpty, setDropEmpty] = useState(true);
  const [tabs, setTabs] = useState(true);
  const [breaks, setBreaks] = useState(false);

  let lines = text.split('\n');
  if (tabs) lines = lines.map((l) => l.replace(/\t+/g, '  '));
  if (trim) lines = lines.map((l) => l.replace(/[ \t]+$/, '').replace(/^[ \t]+/, ''));
  if (collapse && !breaks) lines = lines.map((l) => l.replace(/ {2,}/g, ' '));
  if (dropEmpty) lines = lines.filter((l) => l.trim().length);
  let out = lines.join('\n');
  if (collapse && breaks) out = out.replace(/[ \t]{2,}/g, ' ');

  const saved = text.length - out.length;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Eraser} title="Whitespace Cleaner" desc="Tidy pasted text — trim lines, collapse runs of spaces, strip blank lines." />
      <Area value={text} onChange={setText} rows={7} mono placeholder="Paste messy text…" />
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Trim each line" checked={trim} onChange={setTrim} />
        <ToggleRow label="Collapse repeated spaces" checked={collapse} onChange={setCollapse} />
        <ToggleRow label="Remove blank lines" checked={dropEmpty} onChange={setDropEmpty} />
        <ToggleRow label="Tabs → 2 spaces" checked={tabs} onChange={setTabs} />
        <ToggleRow label="Treat every line break as a space" checked={breaks} onChange={setBreaks} />
      </div>
      <Out label="Cleaned text" value={out}>
        <span className="whitespace-pre-wrap font-mono-j text-xs">{out || '—'}</span>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Original" value={`${text.length} chars`} />
        <Stat label="Cleaned" value={`${out.length} chars`} />
        <Stat label="Saved" value={`${Math.max(0, saved)} chars`} />
      </div>
    </div>
  );
}