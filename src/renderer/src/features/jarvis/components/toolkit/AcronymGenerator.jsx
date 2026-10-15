import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const STOP = ['a', 'an', 'the', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'with', 'by', 'from', 'as', 'it', 'is', 'that', 'this'];

const BANK = {
  A: ['Analytics', 'Assistant', 'Automation', 'Archive', 'Atlas', 'Agency', 'App', 'Audio'],
  B: ['Base', 'Builder', 'Bank', 'Bridge', 'Bureau', 'Beacon', 'Book'],
  C: ['Control', 'Core', 'Cloud', 'Centre', 'Console', 'Compass', 'Craft'],
  D: ['Design', 'Data', 'Desk', 'Dispatch', 'Directory', 'Draft'],
  E: ['Engine', 'Exchange', 'Editor', 'Environment', 'Empire', 'Edge'],
  F: ['Framework', 'Forge', 'Flow', 'Factory', 'Finder', 'Field'],
  G: ['Gateway', 'Grid', 'Guide', 'Graph', 'Group', 'Generator'],
  H: ['Hub', 'House', 'Harbour', 'Headquarters', 'Helper', 'Horizon'],
  I: ['Index', 'Interface', 'Intelligence', 'Institute', 'Inbox', 'Idea'],
  J: ['Journal', 'Junction', 'Journey', 'Jarvis', 'Judge'],
  K: ['Kit', 'Key', 'Knowledge', 'Keep', 'Kernel'],
  L: ['Lab', 'Library', 'Ledger', 'Locator', 'Launchpad', 'Light'],
  M: ['Manager', 'Machine', 'Module', 'Monitor', 'Market', 'Mentor', 'Map'],
  N: ['Network', 'Navigator', 'Nexus', 'Notebook', 'Node', 'Nest'],
  O: ['Orchestrator', 'Orbit', 'Office', 'Observer', 'Outline', 'Open'],
  P: ['Platform', 'Portal', 'Planner', 'Processor', 'Pilot', 'Pulse', 'Path'],
  Q: ['Queue', 'Query', 'Quill', 'Quota', 'Quarry'],
  R: ['Registry', 'Radar', 'Repository', 'Relay', 'Reserve', 'River'],
  S: ['System', 'Studio', 'Suite', 'Sync', 'Scanner', 'Signal', 'Stack'],
  T: ['Tracker', 'Toolkit', 'Terminal', 'Table', 'Tower', 'Tide'],
  U: ['Utility', 'Universe', 'Unit', 'Upload', 'Union', 'Urn'],
  V: ['Vault', 'Viewer', 'Validator', 'Voyage', 'Vector', 'Voice'],
  W: ['Workspace', 'Widget', 'Watch', 'Warehouse', 'Wave', 'Wire'],
  X: ['Exchange', 'Xenon', 'Xray', 'Xpress'],
  Y: ['Yard', 'Yield', 'Yarn', 'Yearbook'],
  Z: ['Zone', 'Zenith', 'Zephyr', 'Zeal'],
};

const vowels = 'AEIOUY';
const isVowel = (character) => vowels.indexOf(character) >= 0;
const letters = (value) => String(value).toUpperCase().replace(/[^A-Z]/g, '');

const scoreOf = (candidate, lettersOnly) => {
  const length = lettersOnly.length;
  const lengthScore = length >= 3 && length <= 6 ? 30 : length === 2 || length === 7 ? 18 : 8;
  let clusters = 0;
  for (let index = 0; index < length - 2; index += 1) {
    if (!isVowel(lettersOnly[index]) && !isVowel(lettersOnly[index + 1]) && !isVowel(lettersOnly[index + 2])) clusters += 1;
  }
  const vowelShare = length ? lettersOnly.split('').filter(isVowel).length / length : 0;
  const vowelScore = vowelShare >= 0.3 && vowelShare <= 0.6 ? 30 : vowelShare > 0 && vowelShare <= 0.75 ? 18 : 6;
  const pronounce = Math.max(0, 25 - clusters * 10);
  const distinct = new Set(lettersOnly.split('')).size === length ? 10 : 4;
  const total = Math.round(lengthScore + vowelScore + pronounce + distinct);
  return { total: Math.min(100, total), length, clusters, vowelShare, pronounceable: clusters === 0 && vowelShare >= 0.25 };
};

export default function AcronymGenerator() {
  const [phrase, setPhrase] = useState('Personal Operating System For Learning And Work');
  const [mode, setMode] = useState('forward');
  const [keepStopWords, setKeepStopWords] = useState(false);
  const [maxLength, setMaxLength] = useState('6');
  const [rawLetters, setRawLetters] = useState('MARK');
  const [variant, setVariant] = useState(0);

  const forward = useMemo(() => {
    const words = String(phrase).split(/[\s,;]+/).filter(Boolean);
    const significant = keepStopWords ? words : words.filter((word) => !STOP.includes(word.toLowerCase()));
    const limit = Math.max(2, Math.min(10, Number(maxLength) || 6));
    const usable = significant.slice(0, limit);

    const initials = usable.map((word) => letters(word).slice(0, 1)).join('');
    const full = words.map((word) => letters(word).slice(0, 1)).join('');
    const syllable = usable.map((word) => {
      const clean = letters(word);
      const firstVowel = clean.split('').findIndex(isVowel);
      return clean.slice(0, Math.max(2, Math.min(3, firstVowel >= 0 ? firstVowel + 1 : 2)));
    }).join('');
    const twoLetter = usable.slice(0, Math.ceil(limit / 2)).map((word) => letters(word).slice(0, 2)).join('');
    const consonantVowel = usable.map((word) => {
      const clean = letters(word);
      const first = clean.slice(0, 1);
      const rest = clean.slice(1).split('').find(isVowel) || clean.slice(1, 2);
      return first + rest;
    }).join('');
    const hybrid = usable.map((word, index) => (index % 2 === 0 ? letters(word).slice(0, 2) : letters(word).slice(0, 1))).join('');

    const candidates = [
      { label: 'Initials of the key words', value: initials, note: 'The obvious one. Use it when the phrase was written so the initials already read well.' },
      { label: 'Every word included', value: full, note: 'Nothing omitted, but it is longer and harder to say.' },
      { label: 'Initial syllables', value: syllable, note: 'Reads as a word rather than a set of letters, which is why it is easier to remember.' },
      { label: 'Two letters from the first half', value: twoLetter, note: 'Weights the front of the phrase, which is usually where the meaning sits.' },
      { label: 'Consonant plus a vowel', value: consonantVowel, note: 'Built to be spoken aloud: every pair has a vowel in it.' },
      { label: 'Alternating pairs', value: hybrid, note: 'A compromise between initials and syllables.' },
    ]
      .map((entry) => ({ ...entry, score: scoreOf(entry.value, letters(entry.value)) }))
      .filter((entry) => entry.value.length >= 2)
      .sort((a, b) => b.score.total - a.score.total);

    return { candidates, usable, omitted: words.length - usable.length };
  }, [phrase, keepStopWords, maxLength]);

  const reverse = useMemo(() => {
    const wanted = letters(rawLetters).slice(0, 8);
    if (!wanted) return { words: [], score: 0, phrase: '' };
    const seed = variant + wanted.length;
    const words = wanted.split('').map((letter, index) => {
      const options = BANK[letter] || ['Idea'];
      const pick = options[(seed + index * 3) % options.length];
      return { letter, word: pick };
    });
    const phraseText = words.map((entry) => entry.word).join(' ');
    const score = scoreOf(phraseText.replace(/\s/g, ''), wanted).total;
    return { words, score, phrase: phraseText };
  }, [rawLetters, variant]);

  const report = useMemo(() => (mode === 'forward'
    ? [
      'Phrase: ' + phrase,
      '',
      ...forward.candidates.map((entry) => entry.value + ' · ' + entry.score.total + '/100 · ' + entry.label + ' — ' + entry.note),
    ].join('\n')
    : [
      'Letters: ' + letters(rawLetters),
      'Expansion: ' + reverse.phrase,
      'Score: ' + reverse.score + '/100',
      '',
      ...reverse.words.map((entry) => entry.letter + ' — ' + entry.word),
    ].join('\n')), [mode, phrase, forward, reverse, rawLetters]);

  return (
    <ToolShell
      toolId="acronym-generator"
      icon={Sparkles}
      title="Acronym & Backronym Builder"
      desc="A phrase into ranked acronym candidates scored for pronounceability and length, or letters into a backronym expansion using a word bank — with the reasoning shown."
      state={{ phrase, mode, keepStopWords, maxLength, rawLetters, variant }}
      onRestore={(restored) => {
        if (typeof restored.phrase === 'string') setPhrase(restored.phrase);
        if (restored.mode) setMode(restored.mode);
        if (restored.keepStopWords !== undefined) setKeepStopWords(!!restored.keepStopWords);
        if (restored.maxLength !== undefined) setMaxLength(String(restored.maxLength));
        if (typeof restored.rawLetters === 'string') setRawLetters(restored.rawLetters);
        if (restored.variant !== undefined) setVariant(Number(restored.variant) || 0);
      }}
      exportText={report}
      exportName="acronyms.txt"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'forward', label: 'Phrase to acronym' }, { value: 'reverse', label: 'Letters to words' }]} />

      {mode === 'forward' ? (
        <>
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">The phrase</div>
            <Area value={phrase} onChange={setPhrase} rows={3} placeholder="Personal Operating System" />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Longest acronym to consider"><input value={maxLength} onChange={(e) => setMaxLength(e.target.value)} inputMode="numeric" className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              <ToggleRow label="Include short words like of, and, the" checked={keepStopWords} onChange={() => setKeepStopWords((current) => !current)} />
            </div>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              label="Best candidate"
              value={forward.candidates.length ? forward.candidates[0].value : '—'}
              sub={forward.candidates.length ? 'Scores ' + forward.candidates[0].score.total + ' out of 100 for pronounceability, length and vowel balance, built from ' + forward.usable.length + ' key words' + (forward.omitted ? ' with ' + forward.omitted + ' left out' : '') + '.' : 'Enter a phrase to see candidates.'}
            />
            <Ring
              value={forward.candidates.length ? forward.candidates[0].score.total : 0}
              max={100}
              label="Score of the best option"
              sub={forward.candidates.length && forward.candidates[0].score.pronounceable ? 'Speakable as a word rather than spelled out letter by letter' : 'Likely to be spelled out letter by letter'}
            />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Candidates, best first</span>
              <CopyBtn value={report} label="Copy the list" />
            </div>
            <div className="space-y-2">
              {forward.candidates.map((entry, index) => (
                <div key={entry.label} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={index === 0 ? 'font-mono-j text-lg text-cyan-j' : 'font-mono-j text-lg'}>{entry.value}</span>
                    <span className="rounded-md border border-border/60 px-1.5 py-0.5 font-mono-j text-[10px] text-muted-foreground">{entry.score.total}/100</span>
                    <span className="text-[11px] text-muted-foreground">{entry.label}</span>
                    <CopyBtn value={entry.value} label="Copy" />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{entry.note}</p>
                  <div className="mt-1.5 flex flex-wrap gap-3 font-mono-j text-[10px] text-muted-foreground">
                    <span>{entry.score.length} letters</span>
                    <span>{Math.round(entry.score.vowelShare * 100)}% vowels</span>
                    <span>{entry.score.clusters} consonant clusters</span>
                    <span className={entry.score.pronounceable ? 'text-emerald-300' : 'text-amber-300'}>{entry.score.pronounceable ? 'speakable' : 'hard to say'}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Scores side by side</div>
            <Bars
              data={forward.candidates.map((entry) => ({ label: entry.value.slice(0, 7), value: entry.score.total }))}
              format={(value) => String(value)}
              suffix=""
              highlightLast={false}
            />
          </Panel>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Letters to expand"><input value={rawLetters} onChange={(e) => setRawLetters(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm uppercase text-cyan-j" /></Field>
            <Field label="Another combination">
              <button type="button" onClick={() => setVariant((current) => current + 1)} className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md border border-cyan-j/50 bg-cyan-j/10 text-xs text-cyan-j transition hover:bg-cyan-j/20">
                <Sparkles className="h-3.5 w-3.5" /> Regenerate
              </button>
            </Field>
            <Field label="Score">
              <div className="flex h-9 items-center font-mono-j text-sm text-muted-foreground">{reverse.score}/100</div>
            </Field>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Expansion</span>
              <CopyBtn value={reverse.phrase} label="Copy" />
            </div>
            <p className="font-mono-j text-lg text-cyan-j">{reverse.phrase || '—'}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {reverse.words.map((entry) => (
                <div key={entry.letter} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                  <span className="font-mono-j text-cyan-j">{entry.letter}</span>
                  <span>{entry.word}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Press regenerate to reshuffle the word choices for the same letters. The score is recalculated each time, so it is worth cycling until something reads naturally.
            </p>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Where backronyms work</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Naming a project, a system or a product where the letters already exist and need a story rather than the other way round.</p>
              <p>· Security and engineering mnemonics: STRIDE, PASTA and friends all exist because letters are easier to remember than lists.</p>
              <p>· A backronym that reads naturally is remembered; one that reads like a thesaurus entry is quietly dropped after a week.</p>
              <p>· Avoid forcing a word that does not fit the meaning. A clever expansion that describes the wrong thing is worse than an unmemorable one that is accurate.</p>
              <p>· Check the letters against your own language for unfortunate readings before printing anything permanent.</p>
            </div>
          </Panel>
        </>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Mode" value={mode === 'forward' ? 'phrase' : 'letters'} mono />
        <Stat label="Candidates" value={String(forward.candidates.length)} mono sub={mode === 'forward' ? 'ranked by score' : 'word bank'} />
        <Stat label="Best score" value={mode === 'forward' && forward.candidates.length ? forward.candidates[0].score.total + '/100' : reverse.score + '/100'} mono />
        <Stat label="Key words used" value={String(forward.usable.length)} mono sub={forward.omitted ? forward.omitted + ' ignored' : 'none ignored'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What makes an acronym stick</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Three to six letters is the sweet spot. Two is forgettable and seven or more gets abbreviated anyway.</p>
            <p>· A vowel share of roughly a third to a half makes it readable as a word. Below a quarter and people spell it out instead.</p>
            <p>· Three consonants in a row make it unpronounceable, which means people will mangle it or avoid saying it altogether.</p>
            <p>· An acronym that spells an unexpected real word tends to stick, for better or worse.</p>
            <p>· Consistency matters more than beauty: if the acronym is spoken as a word, write it in lower case; if it is spelled out, capitals are correct.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Scoring used here</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>length: 3 to 6 letters scores highest, 2 or 7 next, anything else lowest</p>
            <p>vowels: 30 to 60% of the letters is ideal</p>
            <p>clusters: every run of three consonants costs points</p>
            <p>variety: repeated letters score lower than distinct ones</p>
            <p className="text-cyan-j">The total is capped at 100 and is a guide to speech, not a measure of how good the name is.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The word bank behind the reverse mode is deliberately general — one or two well-known words per letter — so the output reads as a starting point for a human edit
          rather than a finished name. Nothing leaves this page.
        </p>
      </Panel>
    </ToolShell>
  );
}