import { useMemo, useState } from 'react';
import { PenTool, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const START = [
  { id: uid(), name: 'Introduction', weight: '10', written: '420' },
  { id: uid(), name: 'Background', weight: '20', written: '610' },
  { id: uid(), name: 'Method', weight: '20', written: '0' },
  { id: uid(), name: 'Findings', weight: '30', written: '0' },
  { id: uid(), name: 'Discussion', weight: '15', written: '0' },
  { id: uid(), name: 'Conclusion', weight: '5', written: '0' },
];

export default function WritingPlan() {
  const [target, setTarget] = useState('4000');
  const [sections, setSections] = useState(START);

  const plan = useMemo(() => {
    const total = Math.max(1, Number(target) || 1);
    const weightSum = sections.reduce((sum, row) => sum + (Number(row.weight) || 0), 0) || 1;
    const rows = sections.map((row) => {
      const weight = Number(row.weight) || 0;
      const words = Math.round((weight / weightSum) * total);
      const written = Number(row.written) || 0;
      return {
        ...row,
        weight,
        words,
        written,
        share: (weight / weightSum) * 100,
        remaining: Math.max(0, words - written),
        progress: words ? Math.min(100, (written / words) * 100) : 0,
        readMinutes: words / 200,
        speakMinutes: words / 130,
      };
    });
    const writtenTotal = rows.reduce((sum, row) => sum + row.written, 0);
    const remaining = Math.max(0, total - writtenTotal);
    const biggest = [...rows].sort((a, b) => b.words - a.words)[0];
    const done = rows.filter((row) => row.progress >= 100).length;

    return {
      rows, total, weightSum, writtenTotal, remaining, biggest, done,
      progress: Math.min(100, (writtenTotal / total) * 100),
      readMinutes: total / 200,
      speakMinutes: total / 130,
      pages: total / 250,
      atPace: remaining / Math.max(1, rows.filter((row) => row.progress < 100).length),
      sessions: Math.ceil(remaining / 500),
    };
  }, [target, sections]);

  const report = useMemo(() => [
    'Target ' + plan.total.toLocaleString() + ' words · ' + plan.readMinutes.toFixed(1) + ' minutes to read · ' + plan.speakMinutes.toFixed(1) + ' minutes to speak aloud',
    '',
    ...plan.rows.map((row) => [
      row.name,
      row.words.toLocaleString() + ' words',
      '(' + row.share.toFixed(0) + '% of the piece)',
      row.written ? 'written ' + row.written : 'not started',
    ].join('  ·  ')),
    '',
    'Written so far ' + plan.writtenTotal.toLocaleString() + ' words (' + plan.progress.toFixed(0) + '% done), ' + plan.remaining.toLocaleString() + ' to go',
  ].join('\n'), [plan]);

  const setRow = (id, patch) => setSections((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <ToolShell
      toolId="writing-plan"
      icon={PenTool}
      title="Writing Plan & Word Budget"
      desc="Turn a word count into a plan: how many words each section gets, how long the piece takes to read or say aloud, and how much is genuinely left to write."
      state={{ target, sections }}
      onRestore={(restored) => {
        if (restored.target !== undefined) setTarget(String(restored.target));
        if (Array.isArray(restored.sections) && restored.sections.length) setSections(restored.sections);
      }}
      exportText={report}
      exportName="writing-plan.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <Field label="Total target words">
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm text-cyan-j" />
        </Field>
        <div className="flex flex-wrap items-end gap-1.5">
          {['800', '1500', '2500', '4000', '8000'].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setTarget(preset)}
              className={target === preset
                ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 font-mono-j text-xs text-cyan-j'
                : 'rounded-lg border border-border/70 px-3 py-1.5 font-mono-j text-xs text-muted-foreground transition hover:text-foreground'}
            >
              {preset}
            </button>
          ))}
          <CopyBtn value={report} label="Copy plan" />
        </div>
      </div>

      <div className="space-y-2">
        {plan.rows.map((row) => (
          <div key={row.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="grid gap-2 sm:grid-cols-[1.6fr_1.4fr_1fr_auto] sm:items-center">
              <input value={row.name} onChange={(e) => setRow(row.id, { name: e.target.value })} placeholder="Section" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={40}
                  step={1}
                  value={row.weight}
                  onChange={(e) => setRow(row.id, { weight: e.target.value })}
                  className="w-full accent-[hsl(var(--cyan))]"
                  aria-label={row.name + ' weight'}
                />
                <span className="w-12 shrink-0 text-right font-mono-j text-[10px] text-muted-foreground">{row.share.toFixed(0)}%</span>
              </div>
              <input
                value={row.written}
                onChange={(e) => setRow(row.id, { written: e.target.value })}
                inputMode="numeric"
                placeholder="written"
                title="Words already written"
                className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm"
              />
              <button type="button" onClick={() => setSections((current) => current.filter((entry) => entry.id !== row.id))} className="text-muted-foreground transition hover:text-rose-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-cyan-j" style={{ width: row.progress + '%' }} />
              </div>
              <span className="font-mono-j text-[10px] text-muted-foreground">
                {row.words.toLocaleString()} words · {row.written > 0 ? row.progress.toFixed(0) + '%' : 'not started'} · reads in {row.readMinutes.toFixed(1)} min
              </span>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setSections((current) => [...current, { id: uid(), name: '', weight: '10', written: '0' }].slice(0, 20))}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
      >
        <Plus className="h-3.5 w-3.5" /> Add a section
      </button>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={plan.progress > 66 ? 'emerald' : plan.progress > 25 ? 'amber' : 'rose'}
          label="Written so far"
          value={plan.writtenTotal.toLocaleString()}
          unit={'of ' + plan.total.toLocaleString() + ' words'}
          sub={plan.remaining > 0
            ? plan.remaining.toLocaleString() + ' words still to write — about ' + plan.sessions + ' sessions of 500 words, or ' + plan.readMinutes.toFixed(0) + ' minutes of reading time in total.'
            : 'Target met. Everything from here is editing, which is a different job from writing.'}
        />
        <Ring
          value={plan.progress}
          max={100}
          tone={plan.progress > 66 ? 'emerald' : plan.progress > 25 ? 'amber' : 'rose'}
          label="Draft progress"
          sub={plan.done + ' of ' + plan.rows.length + ' sections at or over their budget'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Words per section</div>
        <Bars
          data={plan.rows.map((row) => ({ label: row.name.slice(0, 12) || '—', value: row.words }))}
          format={(value) => value.toLocaleString()}
          highlightLast={false}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Weights are relative, so proportions survive a change of target: doubling the word count doubles every section and keeps the same shape. The biggest
          section here, {plan.biggest.name || 'the largest one'}, carries {plan.biggest.words.toLocaleString()} words — {plan.biggest.share.toFixed(0)}% of the whole
          piece, which is a lot to write in one sitting.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the target means in other units</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Reading time (200 wpm)</span>
              <span>{plan.readMinutes.toFixed(1)} minutes</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Spoken aloud (130 wpm)</span>
              <span>{plan.speakMinutes.toFixed(1)} minutes</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Pages (250 words a page)</span>
              <span>{plan.pages.toFixed(1)} pages</span>
            </div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5">
              <span>Average per open section</span>
              <span className="text-cyan-j">{Math.round(plan.atPace).toLocaleString()} words</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            If this piece is to be delivered rather than read, aim at the speaking figure: {plan.speakMinutes.toFixed(0)} minutes of stage time is
            {' '}{(plan.speakMinutes / 60).toFixed(1)} hours, which is longer than most audiences want in one sitting.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sections against their budget</div>
          <div className="space-y-1">
            {plan.rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span className="truncate">{row.name || '—'}</span>
                <span className="ml-2 shrink-0 font-mono-j text-[10px] text-muted-foreground">
                  {row.written > 0 ? row.written.toLocaleString() + ' / ' + row.words.toLocaleString() : 'budget ' + row.words.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Target" value={plan.total.toLocaleString()} mono sub="words" />
        <Stat label="Written" value={plan.writtenTotal.toLocaleString()} mono sub={plan.progress.toFixed(0) + '% done'} />
        <Stat label="Remaining" value={plan.remaining.toLocaleString()} mono sub={plan.sessions + ' sittings'} />
        <Stat label="Speaking time" value={plan.speakMinutes.toFixed(1)} mono sub="minutes aloud" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Writing to a budget that helps</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Allocate before you write. A section with a number attached stops expanding to fill the afternoon.</p>
          <p>· Weight by importance to the reader, not by how much you enjoy writing it — the middle sections are usually over-fed.</p>
          <p>· Treat {plan.biggest.words.toLocaleString()} words as a week of work, not a session. Break it into sub-headings with their own counts.</p>
          <p>· Keep a running count as you draft. Overshooting one section by 500 words always comes out of another section's argument.</p>
          <p>· Finish the draft at 100% before editing; cutting a finished piece is easy, and cutting while drafting just slows the draft.</p>
          <p>· A tenth of the total will be lost in editing. Aim {Math.round(plan.total * 0.1).toLocaleString()} words over the target if you cut hard.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Target', value: plan.total.toLocaleString() + ' words' },
              { label: 'Reading', value: plan.readMinutes.toFixed(1) + ' min' },
              { label: 'Sections', value: String(plan.rows.length) },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Sections are apportioned by weight, so the plan holds its shape whatever total you choose, and each row shows what it has to reach, what has been written
          and how much of the piece it represents. Reading time uses 200 words a minute and speaking 130 — the usual figures for careful prose and clear delivery.
        </p>
      </Panel>
    </ToolShell>
  );
}