import { useState } from 'react';
import { Eraser } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, CopyBtn, Field, Stat } from './shared';

export default function DuplicateLineRemover() {
  const [text, setText] = useState('apple\nbanana\napple\ncherry\nbanana\nApple');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [trim, setTrim] = useState(false);
  const [preserveOrder, setPreserveOrder] = useState(true);
  const [out, setOut] = useState('');

  const run = () => {
    const lines = text.split('\n');
    const seen = new Set(); const result = [];
    for (const line of lines) {
      let key = line; if (trim) key = key.trim(); if (!caseSensitive) key = key.toLowerCase();
      if (seen.has(key)) continue; seen.add(key); result.push(preserveOrder ? line : line);
    }
    setOut(result.join('\n'));
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Eraser} title="Duplicate Line Remover" desc="Remove duplicate lines with case-sensitivity, trim and order options." />
      <textarea value={text} onChange={(e) => setText(e.target.value)} className="h-40 w-full rounded-md border border-input bg-transparent p-3 font-mono-j text-sm" />
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} className="accent-cyan-j" />Case-sensitive</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} className="accent-cyan-j" />Trim whitespace</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={preserveOrder} onChange={(e) => setPreserveOrder(e.target.checked)} className="accent-cyan-j" />Preserve order</label>
      </div>
      <Button size="sm" onClick={run}>Remove duplicates</Button>
      {out && (
        <div>
          <div className="mb-1 flex justify-between"><Stat label="Result" value={`${out.split('\n').length} lines`} /><CopyBtn value={out} /></div>
          <pre className="max-h-48 overflow-auto rounded-md border border-border/70 bg-card/60 p-3 font-mono-j text-xs">{out}</pre>
        </div>
      )}
    </div>
  );
}