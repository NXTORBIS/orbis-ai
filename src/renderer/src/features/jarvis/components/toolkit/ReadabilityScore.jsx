import { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { ToolHeader, Area, Stat, Panel } from './shared';
import ToolShell from './kit/ToolShell';

const countSyllables = (word) => {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
};

const VERDICT = [
  [90, 'Very easy', 'Primary-school level. Plain and direct.'],
  [80, 'Easy', 'Conversational — 6th grade reading level.'],
  [70, 'Fairly easy', 'Comfortable for most adults.'],
  [60, 'Standard', 'Plain English, 8th–9th grade.'],
  [50, 'Fairly difficult', 'Some college reading level.'],
  [30, 'Difficult', 'Dense — best for expert readers.'],
  [-Infinity, 'Very confusing', 'Academic or highly technical writing.'],
];

export default function ReadabilityScore() {
  const [text, setText] = useState('Mark32 brings your notes, tasks, files and knowledge together. It reads what you save, links related ideas, and keeps everything one search away.');

  const metrics = useMemo(() => {
    const clean = text.trim();
    const sentences = clean.split(/[.!?…]+(?:\s|$)/).map((s) => s.trim()).filter((s) => s.split(/\s+/).filter(Boolean).length > 0);
    const words = clean.split(/\s+/).map((w) => w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '')).filter(Boolean);
    const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
    const complexWords = words.filter((w) => countSyllables(w) >= 3);
    const longWords = words.filter((w) => w.length >= 7);
    const chars = words.join('').length;
    const sentenceCount = Math.max(1, sentences.length);
    const wordCount = words.length;
    if (!wordCount) return null;
    const wordsPerSentence = wordCount / sentenceCount;
    const syllablesPerWord = syllables / wordCount;
    return {
      words: wordCount,
      sentences: sentenceCount,
      syllables,
      chars,
      avgSentence: wordsPerSentence,
      avgSyllables: syllablesPerWord,
      complexPct: (complexWords.length / wordCount) * 100,
      longPct: (longWords.length / wordCount) * 100,
      flesch: 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord,
      fkGrade: 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59,
      fog: 0.4 * (wordsPerSentence + 100 * (complexWords.length / wordCount)),
      smog: wordCount >= 30 ? 1.0430 * Math.sqrt(complexWords.length * (30 / sentenceCount)) + 3.1291 : null,
      ari: 4.71 * (chars / wordCount) + 0.5 * wordsPerSentence - 21.43,
      readingTime: wordCount / 200,
      speakingTime: wordCount / 130,
    };
  }, [text]);

  const verdict = metrics ? VERDICT.find(([min]) => metrics.flesch >= min) : null;
  const barPct = metrics ? Math.max(0, Math.min(100, metrics.flesch)) : 0;

  return (
    <ToolShell
      toolId="readability"
      icon={BookOpen}
      title="Readability Score"
      desc="Flesch, grade level and reading time for any passage you paste in."
      state={{ text }}
      onRestore={(saved) => { if (saved.text !== undefined) setText(saved.text); }}
      exportText={metrics ? JSON.stringify(metrics, null, 2) : ''}
      exportName="readability.json"
      exportMime="application/json"
    >
      <Area value={text} onChange={setText} rows={7} placeholder="Paste an article, essay or email…" />
      {metrics ? (
        <>
          <Panel>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Reading ease</div>
                <div className="font-display text-3xl font-bold text-cyan-j">{metrics.flesch.toFixed(1)}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">{verdict[1]}</div>
                <div className="text-[11px] text-muted-foreground">{verdict[2]}</div>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 transition-all" style={{ width: `${barPct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>0 · very confusing</span><span>100 · very easy</span></div>
          </Panel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Words" value={metrics.words.toLocaleString()} />
            <Stat label="Sentences" value={String(metrics.sentences)} />
            <Stat label="Syllables" value={metrics.syllables.toLocaleString()} />
            <Stat label="Characters" value={metrics.chars.toLocaleString()} />
            <Stat label="Words / sentence" value={metrics.avgSentence.toFixed(1)} />
            <Stat label="Syllables / word" value={metrics.avgSyllables.toFixed(2)} />
            <Stat label="Complex words (3+ syllables)" value={`${metrics.complexPct.toFixed(1)}%`} />
            <Stat label="Long words (7+ letters)" value={`${metrics.longPct.toFixed(1)}%`} />
          </div>
          <Panel>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Grade-level formulas</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Flesch–Kincaid grade" value={metrics.fkGrade > 0 ? `Grade ${metrics.fkGrade.toFixed(1)}` : 'Below grade 1'} />
              <Stat label="Gunning Fog index" value={metrics.fog.toFixed(1)} />
              <Stat label="SMOG index" value={metrics.smog ? metrics.smog.toFixed(1) : 'needs 30+ words'} />
              <Stat label="Automated Readability Index" value={metrics.ari > 0 ? metrics.ari.toFixed(1) : 'Below grade 1'} />
            </div>
          </Panel>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Reading time" value={metrics.readingTime < 1 ? `${Math.round(metrics.readingTime * 60)} seconds` : `${metrics.readingTime.toFixed(1)} minutes`} />
            <Stat label="Speaking time" value={metrics.speakingTime < 1 ? `${Math.round(metrics.speakingTime * 60)} seconds` : `${metrics.speakingTime.toFixed(1)} minutes`} />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Add some text to score.</div>
      )}
    </ToolShell>
  );
}