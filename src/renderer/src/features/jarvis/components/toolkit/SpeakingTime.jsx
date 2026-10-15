import { useMemo, useState } from 'react';
import { Volume2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat } from './shared';

const RATES = [
  { id: 'slow', label: 'Slow, deliberate', wpm: 110 },
  { id: 'normal', label: 'Conversational', wpm: 140 },
  { id: 'brisk', label: 'Brisk presenter', wpm: 165 },
  { id: 'fast', label: 'Fast, energetic', wpm: 185 },
];

const formatDuration = (minutes) => {
  if (!Number.isFinite(minutes)) return '—';
  const totalSeconds = Math.round(minutes * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
};

const SAMPLE = `Thank you all for being here. In the next ten minutes I want to walk through three things: where we are today, what changed in the last quarter, and what I need from each of you before we finish. The short version is that the plan is working, but the pace is uneven — and uneven pace is what turns a good quarter into a missed year.`;

export default function SpeakingTime() {
  const [text, setText] = useState(SAMPLE);
  const [rate, setRate] = useState('normal');
  const [customWpm, setCustomWpm] = useState('150');
  const [slides, setSlides] = useState('8');
  const [questions, setQuestions] = useState('5');
  const [slot, setSlot] = useState('15');

  const result = useMemo(() => {
    const words = (text.trim().match(/\S+/g) || []).length;
    const sentences = (text.match(/[^.!?]+[.!?]+/g) || []).length || (text.trim() ? 1 : 0);
    const paragraphs = text.split(/\n{2,}/).filter((block) => block.trim()).length;
    const longest = (text.match(/[^.!?]+[.!?]+/g) || []).reduce((max, sentence) => Math.max(max, (sentence.trim().match(/\S+/g) || []).length), 0);
    const wpm = rate === 'custom' ? Number(customWpm) || 150 : RATES.find((item) => item.id === rate)?.wpm || 140;
    const speaking = words / wpm;
    const reading = words / 220;
    const slideCount = Math.max(1, Number(slides) || 1);
    const perSlide = speaking / slideCount;
    const qa = Number(questions) || 0;
    const total = speaking + qa;
    const available = Number(slot) || 0;
    const verdict = total <= available * 0.9
      ? { tone: 'emerald', label: 'Comfortable fit', note: `about ${(available - total).toFixed(1)} minutes of headroom` }
      : total <= available
        ? { tone: 'amber', label: 'Tight but fits', note: 'almost no margin for a slow start' }
        : { tone: 'rose', label: 'Over the slot', note: `cut about ${Math.round((total - available) * wpm)} words or drop material` };
    return { words, sentences, paragraphs, longest, wpm, speaking, reading, perSlide, qa, total, available, verdict, slideCount };
  }, [text, rate, customWpm, slides, questions, slot]);

  const rateTable = useMemo(() => RATES.map((item) => ({ label: item.label.split(',')[0], value: (result.words / item.wpm) * 60 })), [result.words]);

  const report = [
    `${result.words} words · ${result.sentences} sentences · ${result.paragraphs} paragraphs`,
    `Speaking at ${result.wpm} wpm: ${formatDuration(result.speaking)}`,
    `${result.slideCount} slides → about ${formatDuration(result.perSlide)} each`,
    `Plus ${result.qa} minutes of questions: ${formatDuration(result.total)} total against a ${result.available} minute slot`,
    `Verdict: ${result.verdict.label} — ${result.verdict.note}`,
  ].join('\n');

  return (
    <ToolShell
      toolId="speaking-time"
      icon={Volume2}
      title="Speaking Time Calculator"
      desc="Paste your script and know how long you will actually take — per slide, with questions, and whether it fits the slot you were given."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={rate} onChange={setRate} options={[...RATES.map((item) => ({ value: item.id, label: item.label.split(',')[0] })), { value: 'custom', label: 'Custom' }]} />
        <CopyBtn value={report} label="Copy timing" />
      </div>

      <Area label="Your script or notes" value={text} onChange={setText} rows={9} placeholder="Paste what you plan to say…" />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Slides">
          <input value={slides} onChange={(e) => setSlides(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Minutes of questions">
          <input value={questions} onChange={(e) => setQuestions(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Slot you were given (minutes)">
          <input value={slot} onChange={(e) => setSlot(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        {rate === 'custom' && (
          <Field label="Words per minute">
            <input value={customWpm} onChange={(e) => setCustomWpm(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          tone={result.verdict.tone}
          label="You will speak for"
          value={formatDuration(result.speaking)}
          sub={`${result.words} words at ${result.wpm} words a minute · ${result.verdict.label.toLowerCase()}`}
        />
        <Panel className="!p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">With {result.qa} minutes of questions</div>
          <div className={`tk-title-glow mt-1 font-mono-j text-3xl font-semibold ${result.verdict.tone === 'rose' ? 'text-rose-400' : result.verdict.tone === 'amber' ? 'text-amber-400' : 'text-emerald-400'}`}>
            {formatDuration(result.total)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{result.verdict.note}</div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Words" value={result.words.toLocaleString()} mono />
        <Stat label="Sentences" value={String(result.sentences)} mono />
        <Stat label="Time per slide" value={formatDuration(result.perSlide)} mono />
        <Stat label="Longest sentence" value={`${result.longest} words`} mono sub={result.longest > 30 ? 'worth splitting' : 'reads well'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The same script at different paces</div>
          <Bars data={rateTable} format={(value) => (value / 60).toFixed(1)} suffix=" min" highlightLast />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Slow and deliberate suits technical or emotional moments; brisk suits status updates. Knowing both ends of the range is what stops a
            rehearsal surprising you on the day.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Timing notes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Silence reading — {formatDuration(result.reading)} — is always faster than speaking, so never time a talk from reading it silently.</p>
            <p>· Allow about 10% for pauses, laughs, demos and the moment you look up at the room.</p>
            <p>· Roughly 120–150 words is one minute of comfortable speech; {result.slideCount} slides in {result.available} minutes means about {formatDuration(result.available / result.slideCount)} a slide.</p>
            <p>· {result.longest > 25 ? 'Your longest sentence runs long — split anything over about 25 words, since listeners cannot re-read it.' : 'Sentence lengths are presentation-friendly.'}</p>
            <p>· Rehearse the first and last minute out loud, and let the middle be conversational.</p>
          </div>
          <div className="mt-2">
            <Pills
              items={[
                { label: 'Script length', value: `${result.words} words` },
                { label: 'Paragraphs', value: result.paragraphs },
                { label: 'Per slide', value: formatDuration(result.perSlide) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What to cut if you are over</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>1. Delete the framing sentences — the ones that explain what you are about to say, just before you say it.</p>
          <p>2. Turn any list of three into a list of two, or say the third as an aside rather than a slide.</p>
          <p>3. Cut roughly {Math.max(0, Math.round((result.total - result.available) * result.wpm))} words if the whole slot has to fit, or hand the detail to a follow-up document and say so.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The two numbers that matter are words and pace: the average presenter speaks at about 140 words a minute, accelerates when nervous, and
          slows when explaining something visual. Time yourself reading one paragraph aloud at the pace you intend — one minute of your own speech sets
          the real number far better than any table.
        </p>
      </Panel>
    </ToolShell>
  );
}