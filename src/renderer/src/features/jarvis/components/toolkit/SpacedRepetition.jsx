import { useMemo, useState } from 'react';
import { GraduationCap, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);
const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);
const parseDay = (value) => new Date(value + 'T00:00:00');

const BASE = [1, 3, 7, 16, 35, 75, 150, 300];
const CONFIDENCE = ['shaky', 'unsure', 'reasonable', 'solid', 'strong'];

const START = [
  { id: uid(), topic: 'Photosynthesis', confidence: '2' },
  { id: uid(), topic: 'Quadratic formula', confidence: '4' },
  { id: uid(), topic: 'Spanish irregular verbs', confidence: '1' },
  { id: uid(), topic: 'Big-O notation', confidence: '3' },
];

export default function SpacedRepetition() {
  const [topics, setTopics] = useState(START);
  const [start, setStart] = useState(iso(new Date()));
  const [weeks, setWeeks] = useState('8');

  const plan = useMemo(() => {
    const rows = topics.filter((topic) => topic.topic.trim());
    const anchor = parseDay(start);
    if (!rows.length) return { topics: [], byDate: [], dates: [], empty: true };

    const schedules = rows.map((topic) => {
      const confidence = Math.max(1, Math.min(5, Number(topic.confidence) || 3));
      const factor = 0.6 + (confidence - 1) * 0.2;
      const intervals = BASE.map((days) => Math.max(1, Math.round(days * factor)));
      const dates = intervals.map((days) => addDays(anchor, days));
      return { ...topic, confidence, confidenceLabel: CONFIDENCE[confidence - 1], factor, intervals, dates, last: dates[dates.length - 1] };
    });

    const horizon = addDays(anchor, (Number(weeks) || 8) * 7);
    const byDate = {};
    schedules.forEach((schedule) => {
      schedule.dates.forEach((date, index) => {
        if (date > horizon) return;
        const key = iso(date);
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push({ topic: schedule.topic, round: index + 1 });
      });
    });

    const dates = Object.keys(byDate).sort();
    const totalReviews = dates.reduce((sum, key) => sum + byDate[key].length, 0);
    const today = iso(new Date());
    const nextWeek = dates.filter((key) => key >= today && key <= iso(addDays(new Date(), 7)));
    const thisWeekCount = nextWeek.reduce((sum, key) => sum + byDate[key].length, 0);
    const busiest = dates.map((key) => ({ date: key, count: byDate[key].length })).sort((a, b) => b.count - a.count)[0] || null;
    const lastDate = schedules.map((schedule) => schedule.last).sort((a, b) => b - a)[0];

    return {
      topics: schedules, byDate, dates, totalReviews, thisWeekCount, busiest, lastDate, empty: false,
      average: schedules.reduce((sum, schedule) => sum + schedule.confidence, 0) / schedules.length,
      nextDate: dates.find((key) => key >= today) || null,
      perTopic: totalReviews / schedules.length,
    };
  }, [topics, start, weeks]);

  const report = useMemo(() => {
    if (plan.empty) return 'Add a topic to build a schedule.';
    const lines = ['Revision plan from ' + start];
    plan.topics.forEach((topic) => {
      lines.push('');
      lines.push(topic.topic + ' · confidence ' + topic.confidenceLabel);
      topic.dates.forEach((date, index) => {
        lines.push('  review ' + (index + 1) + ': ' + date.toLocaleDateString() + '  (day ' + topic.intervals[index] + ')');
      });
    });
    lines.push('');
    lines.push('Upcoming sessions:');
    plan.dates.forEach((key) => {
      lines.push('  ' + key + ': ' + plan.byDate[key].map((entry) => entry.topic).join(', '));
    });
    return lines.join('\n');
  }, [plan, start]);

  const setTopic = (id, patch) => setTopics((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const weeksNote = 'in ' + weeks + ' weeks';
  const stretchNote = 'Intervals stretched ×' + (0.6 + (plan.average - 1) * 0.2).toFixed(2) + ' on your answers';

  return (
    <ToolShell
      toolId="spaced-repetition"
      icon={GraduationCap}
      title="Spaced Revision Planner"
      desc="A real revision calendar: every topic gets expanding intervals tuned to how well you know it, and the tool spreads the sessions so you can see which days are heavy before they arrive."
      state={{ topics, start, weeks }}
      onRestore={(restored) => {
        if (Array.isArray(restored.topics) && restored.topics.length) setTopics(restored.topics);
        if (restored.start) setStart(restored.start);
        if (restored.weeks !== undefined) setWeeks(String(restored.weeks));
      }}
      exportText={report}
      exportName="revision-plan.txt"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="First session">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label={'Plan ahead · ' + weeks + ' weeks'}>
          <input type="range" min={2} max={26} step={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <div className="flex items-end">
          <CopyBtn value={report} label="Copy the plan" />
        </div>
      </div>

      <div className="space-y-2">
        {topics.map((topic) => (
          <div key={topic.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr_auto] sm:items-center">
              <input value={topic.topic} onChange={(e) => setTopic(topic.id, { topic: e.target.value })} placeholder="Topic to remember" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={topic.confidence}
                  onChange={(e) => setTopic(topic.id, { confidence: e.target.value })}
                  className="w-full accent-[hsl(var(--cyan))]"
                />
                <span className="w-16 shrink-0 font-mono-j text-[10px] text-cyan-j">{CONFIDENCE[(Number(topic.confidence) || 3) - 1]}</span>
              </div>
              <button type="button" onClick={() => setTopics((current) => current.filter((row) => row.id !== topic.id))} className="text-muted-foreground transition hover:text-rose-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setTopics((current) => [...current, { id: uid(), topic: '', confidence: '3' }].slice(0, 40))}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
      >
        <Plus className="h-3.5 w-3.5" /> Add a topic
      </button>

      {plan.empty ? (
        <Panel className="text-[12px] text-muted-foreground">Add a topic to generate its review dates.</Panel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              label="Sessions in the next seven days"
              value={plan.thisWeekCount}
              unit="reviews"
              sub={(plan.nextDate ? 'Next session ' + parseDay(plan.nextDate).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Nothing scheduled') + ' · ' + plan.totalReviews + ' reviews across ' + plan.topics.length + ' topics'}
            />
            <Ring
              value={plan.average}
              max={5}
              tone={plan.average < 2.5 ? 'rose' : plan.average < 3.5 ? 'amber' : 'emerald'}
              label="Average confidence"
              sub={stretchNote}
            />
          </div>

          <div className="space-y-2">
            {plan.topics.map((topic) => (
              <Panel key={topic.id} className="!p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[12px] font-medium">{topic.topic}</span>
                  <span className="font-mono-j text-[10px] text-cyan-j">{topic.confidenceLabel} · ×{topic.factor.toFixed(1)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {topic.dates.map((date, index) => (
                    <span
                      key={index}
                      className={index === 0
                        ? 'rounded-md border border-cyan-j/50 bg-cyan-j/10 px-2 py-0.5 font-mono-j text-[10px] text-cyan-j'
                        : 'rounded-md border border-border/60 px-2 py-0.5 font-mono-j text-[10px] text-muted-foreground'}
                    >
                      {date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · +{topic.intervals[index]}d
                    </span>
                  ))}
                </div>
              </Panel>
            ))}
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">How heavy each session day is</div>
            <div className="max-h-72 space-y-1 overflow-auto">
              {plan.dates.map((key) => (
                <div key={key} className={plan.byDate[key].length >= 4 ? 'rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2' : 'rounded-lg border border-border/50 bg-card/40 px-2.5 py-2'}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono-j text-cyan-j">{parseDay(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span className="font-mono-j text-muted-foreground">{plan.byDate[key].length} review{plan.byDate[key].length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{plan.byDate[key].map((entry) => entry.topic).join(' · ')}</div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Rounds per topic</div>
              <Bars
                data={plan.topics.map((topic) => ({ label: topic.topic.slice(0, 10), value: topic.dates.length }))}
                format={(value) => String(value)}
                highlightLast={false}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Every topic gets the same number of rounds; what changes is how far apart they sit. A shaky topic comes back within days, a solid one waits
                over a month — same effort, far better spent.
              </p>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Doing this well</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· Rate honestly when you start. Rating a topic you only recognise as "solid" pushes its next review too far and it quietly disappears.</p>
                <p>· After each session, move the rating up one step only if you recalled it without looking. Recognition is not recall.</p>
                <p>· Retrieval, not rereading: close the notes and write what you remember before checking.</p>
                <p>· {plan.busiest ? 'Your busiest day is ' + parseDay(plan.busiest.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) + ' with ' + plan.busiest.count + ' reviews — split it in two rather than skipping one.' : 'No day is overloaded yet.'}</p>
                <p>· Missing a day is fine; missing a week resets the forgetting curve, so restart that topic from round one.</p>
                <p>· Spacing beats volume: {plan.totalReviews} short sessions over {weeks} weeks will outlast the same hours spent in one sitting.</p>
              </div>
              <div className="mt-2">
                <Pills
                  items={[
                    { label: 'Topics', value: String(plan.topics.length) },
                    { label: 'Total reviews', value: String(plan.totalReviews) },
                    { label: 'Per topic', value: plan.perTopic.toFixed(1) },
                  ]}
                />
              </div>
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Next session" value={plan.nextDate ? parseDay(plan.nextDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'} mono />
            <Stat label="This week" value={String(plan.thisWeekCount)} mono sub="reviews" />
            <Stat label="Total" value={String(plan.totalReviews)} mono sub={weeksNote} />
            <Stat label="Finishing" value={plan.lastDate ? plan.lastDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'} mono sub="last round" />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Where the intervals come from</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· The ladder is 1, 3, 7, 16, 35, 75, 150 and 300 days — each step roughly doubling, which is the shape of the forgetting curve.</p>
              <p>· Your confidence multiplies the whole ladder: ×0.6 when you are shaky, ×1.4 when you are strong. That is the entire personalisation.</p>
              <p>· Reviews 1 and 2 sit close together deliberately; the first repeat after a day is what fixes something in memory at all.</p>
              <p>· The 300-day rung matters for exams a year away and for long-term knowledge; drop it if your horizon is shorter.</p>
              <p>· This is a schedule, not a promise. If a session feels hard, reset that topic's ladder rather than pushing through with a rating you do not believe.</p>
            </div>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}