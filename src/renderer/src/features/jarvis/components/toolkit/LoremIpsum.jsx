import { useMemo, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Seg, Out, CopyBtn, ToggleRow } from './shared';

const LATIN = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');
const CLASSIC = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const sentence = () => {
  const n = 8 + Math.floor(Math.random() * 8);
  const w = Array.from({ length: n }, () => pick(LATIN));
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(' ') + '.';
};

export default function LoremIpsum() {
  const [unit, setUnit] = useState('paragraphs');
  const [count, setCount] = useState(3);
  const [classic, setClassic] = useState(true);
  const [seed, setSeed] = useState(0);

  const out = useMemo(() => {
    const n = Math.max(1, Math.min(50, Number(count) || 1));
    if (unit === 'words') {
      const w = Array.from({ length: n }, () => pick(LATIN));
      return (classic ? `${CLASSIC} ` : '') + w.join(' ');
    }
    if (unit === 'sentences') {
      const s = Array.from({ length: n }, sentence);
      if (classic) s[0] = CLASSIC + ' ' + s[0];
      return s.join(' ');
    }
    return Array.from({ length: n }, (_, i) => {
      const sentences = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, sentence);
      if (classic && i === 0) sentences[0] = CLASSIC;
      return sentences.join(' ');
    }).join('\n\n');
  }, [unit, count, classic, seed]);

  return (
    <div className="space-y-4">
      <ToolHeader icon={FileText} title="Lorem Ipsum Generator" desc="Placeholder copy for layouts and mock-ups — paragraphs, sentences or words." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What to generate">
          <Seg value={unit} onChange={setUnit} options={[{ value: 'paragraphs', label: 'Paragraphs' }, { value: 'sentences', label: 'Sentences' }, { value: 'words', label: 'Words' }]} />
        </Field>
        <Field label={`How many (1–50)`}>
          <input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </Field>
      </div>
      <ToggleRow label="Open with “Lorem ipsum dolor sit amet…”" checked={classic} onChange={setClassic} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setSeed((s) => s + 1)} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Regenerate
        </Button>
        <CopyBtn value={out} label="Copy text" />
      </div>
      <Out label="Generated text" value={out}>
        <span className="whitespace-pre-wrap text-muted-foreground">{out}</span>
      </Out>
    </div>
  );
}