import { useMemo, useState } from 'react';
import { Shuffle, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Area, Out, CopyBtn, ToggleRow, Stat } from './shared';

const scramble = (word, keepEnds) => {
  const chars = Array.from(word);
  if (chars.length <= 3) return word;
  const head = keepEnds ? chars.shift() : null;
  const tail = keepEnds ? chars.pop() : null;
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return `${head ?? ''}${chars.join('')}${tail ?? ''}`;
};

export default function WordScrambler() {
  const [text, setText] = useState('Mark32 brings notes tasks files and knowledge together in one intelligent workspace');
  const [keepEnds, setKeepEnds] = useState(true);
  const [seed, setSeed] = useState(0);

  const out = useMemo(
    () => text.split(/(\s+)/).map((chunk) => (/\s/.test(chunk) || chunk === '' ? chunk : chunk.replace(/[A-Za-z]+/g, (w) => scramble(w, keepEnds)))).join(''),
    [text, keepEnds, seed],
  );

  return (
    <div className="space-y-4">
      <ToolHeader icon={Shuffle} title="Word Scrambler" desc="Jumble the letters of a sentence for puzzles, games and brain teasers." />
      <Area value={text} onChange={setText} rows={5} placeholder="Text to scramble…" />
      <ToggleRow label="Keep first and last letter of each word" checked={keepEnds} onChange={setKeepEnds} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setSeed((s) => s + 1)} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Reshuffle</Button>
        <CopyBtn value={out} label="Copy scrambled text" />
      </div>
      <Out label="Scrambled" value={out}>
        <span className="whitespace-pre-wrap">{out}</span>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Words" value={String(text.trim() ? text.trim().split(/\s+/).length : 0)} />
        <Stat label="Characters" value={String(text.length)} />
        <Stat label="Difficulty" value={keepEnds ? 'Easy — ends visible' : 'Hard — fully jumbled'} />
      </div>
    </div>
  );
}