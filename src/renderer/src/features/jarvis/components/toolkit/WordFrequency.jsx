import { useMemo, useState } from 'react';
import { AlignLeft } from 'lucide-react';
import { ToolHeader, Area, Stat, Panel, CopyBtn, Field, ToggleRow } from './shared';
import ToolShell from './kit/ToolShell';

const STOPWORDS = new Set("a an the and or but if then than that this these those of in on at to for from with without by as is are was were be been being it its can could should would may might will just so not no do does did done have has had he she they them his her their you your i we our us me my about into over under again more most some such only own same too very now also there here what when which who how all any both each few other".split(' '));

export default function WordFrequency() {
  const [text, setText] = useState('Mark32 brings notes, tasks, files and knowledge together in one intelligent workspace. Search finds anything, and the AI assistant reads your notes to answer questions about your own work.');
  const [ignoreStop, setIgnoreStop] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [minLength, setMinLength] = useState(1);

  const analysis = useMemo(() => {
    const words = (text.match(/[A-Za-z0-9'’-]+/g) || []).filter((w) => w.length >= minLength);
    const normalised = words.map((w) => (caseSensitive ? w : w.toLowerCase()));
    const counted = normalised.filter((w) => !(ignoreStop && STOPWORDS.has(w)));
    const freq = new Map();
    counted.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30);

    const charFreq = new Map();
    Array.from(text.toLowerCase()).filter((c) => /[a-z0-9]/.test(c)).forEach((c) => charFreq.set(c, (charFreq.get(c) || 0) + 1));
    const topChars = [...charFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

    const sentences = text.split(/[.!?…]+/).map((s) => s.trim()).filter(Boolean);
    const longest = words.slice().sort((a, b) => b.length - a.length)[0] || '—';
    return {
      words,
      countedWords: counted.length,
      unique: freq.size,
      top,
      topChars,
      sentences: sentences.length,
      longest,
      avgLength: words.length ? words.reduce((sum, w) => sum + w.length, 0) / words.length : 0,
      ratio: counted.length ? (freq.size / counted.length) * 100 : 0,
      max: top.length ? top[0][1] : 1,
      hapax: [...freq.values()].filter((c) => c === 1).length,
    };
  }, [text, ignoreStop, caseSensitive, minLength]);

  return (
    <ToolShell
      toolId="word-frequency"
      icon={AlignLeft}
      title="Word Frequency & Keywords"
      desc="Find the words a text leans on — useful for SEO, study notes and style checks."
      state={{ text, ignoreStop, caseSensitive, minLength }}
      onRestore={(saved) => { setText(saved.text); setIgnoreStop(saved.ignoreStop ?? true); setCaseSensitive(!!saved.caseSensitive); setMinLength(saved.minLength ?? 1); }}
      exportText={JSON.stringify(analysis, null, 2)}
      exportName="keywords.json"
      exportMime="application/json"
    >
      <Area value={text} onChange={setText} rows={7} placeholder="Paste an article, essay or transcript…" />
      <div className="flex flex-wrap items-center gap-3">
        <ToggleRow label="Ignore common stopwords" checked={ignoreStop} onChange={setIgnoreStop} />
        <ToggleRow label="Case sensitive" checked={caseSensitive} onChange={setCaseSensitive} />
        <div className="min-w-40 flex-1">
          <Field label={`Minimum word length · ${minLength}`}>
            <input type="range" min={1} max={8} value={minLength} onChange={(e) => setMinLength(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Words counted" value={analysis.countedWords.toLocaleString()} />
        <Stat label="Unique words" value={analysis.unique.toLocaleString()} />
        <Stat label="Type–token ratio" value={`${analysis.ratio.toFixed(1)}%`} />
        <Stat label="Words used once" value={analysis.hapax.toLocaleString()} />
        <Stat label="Average word length" value={analysis.avgLength.toFixed(1)} />
        <Stat label="Longest word" value={analysis.longest} />
      </div>
      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Top {analysis.top.length} words</span>
          <CopyBtn value={analysis.top.map(([w, c]) => `${w}\t${c}`).join('\n')} label="Copy list" />
        </div>
        <div className="space-y-1.5">
          {analysis.top.map(([word, count]) => (
            <div key={word} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate font-mono-j text-xs">{word}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-j/60 to-cyan-j transition-all" style={{ width: `${(count / analysis.max) * 100}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right font-mono-j text-[11px] text-muted-foreground">{count}</span>
              <span className="hidden w-12 shrink-0 text-right text-[10px] text-muted-foreground sm:block">{((count / (analysis.countedWords || 1)) * 100).toFixed(1)}%</span>
            </div>
          ))}
          {!analysis.top.length && <p className="py-3 text-sm text-muted-foreground">Nothing to count yet.</p>}
        </div>
      </Panel>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Most common characters</div>
        <div className="flex flex-wrap gap-1.5">
          {analysis.topChars.map(([char, count]) => (
            <span key={char} className="rounded-md bg-secondary px-2 py-1 font-mono-j text-xs">{char === ' ' ? '␣' : char} <span className="text-muted-foreground">{count}</span></span>
          ))}
        </div>
      </Panel>
    </ToolShell>
  );
}