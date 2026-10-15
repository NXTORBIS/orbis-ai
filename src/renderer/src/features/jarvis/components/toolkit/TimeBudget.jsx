import { useMemo, useState } from 'react';
import { Clock, RotateCcw } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Panel, Stat } from './shared';

const GROUPS = [
  { id: 'sleep', label: 'Sleep', colour: '#a78bfa' },
  { id: 'work', label: 'Work', colour: '#22d3ee' },
  { id: 'commute', label: 'Commute', colour: '#38bdf8' },
  { id: 'chores', label: 'Chores & errands', colour: '#fbbf24' },
  { id: 'care', label: 'Family & care', colour: '#f472b6' },
  { id: 'health', label: 'Exercise & health', colour: '#34d399' },
  { id: 'learning', label: 'Learning', colour: '#fb7185' },
  { id: 'social', label: 'Social & rest', colour: '#facc15' },
];

const START = { sleep: 52, work: 42, commute: 5, chores: 9, care: 10, health: 4, learning: 3, social: 12 };

const PRESETS = [
  { label: 'Full-time office job', values: { sleep: 52, work: 40, commute: 8, chores: 9, care: 7, health: 4, learning: 3, social: 14 } },
  { label: 'Working from home', values: { sleep: 54, work: 40, commute: 1, chores: 8, care: 7, health: 5, learning: 4, social: 15 } },
  { label: 'Student', values: { sleep: 54, work: 22, commute: 3, chores: 5, care: 2, health: 4, learning: 20, social: 20 } },
  { label: 'Parent, full-time', values: { sleep: 47, work: 40, commute: 6, chores: 12, care: 32, health: 2, learning: 2, social: 5 } },
  { label: 'Two jobs', values: { sleep: 48, work: 60, commute: 8, chores: 7, care: 4, health: 2, learning: 1, social: 6 } },
];

export default function TimeBudget() {
  const [values, setValues] = useState(START);

  const week = useMemo(() => {
    const rows = GROUPS.map((group) => ({ ...group, hours: Number(values[group.id]) || 0 }));
    const allocated = rows.reduce((sum, row) => sum + row.hours, 0);
    const free = 168 - allocated;
    const biggest = [...rows].sort((a, b) => b.hours - a.hours)[0];
    const waking = 168 - (Number(values.sleep) || 0);
    const screenShare = allocated ? (((Number(values.social) || 0) * 0.5) / allocated) * 100 : 0;

    return {
      rows, allocated, free, biggest,
      sleeping: Number(values.sleep) || 0,
      waking,
      freePerDay: free / 7,
      workShare: allocated ? ((Number(values.work) || 0) / allocated) * 100 : 0,
      lifeShare: allocated ? ((allocated - (Number(values.work) || 0) - (Number(values.sleep) || 0)) / allocated) * 100 : 0,
      over: allocated > 168,
      healthy: (Number(values.sleep) || 0) >= 49 && (Number(values.health) || 0) >= 2.5,
      screenShare,
    };
  }, [values]);

  const report = useMemo(() => [
    '168 hours in a week',
    '',
    ...week.rows.map((row) => row.label.padEnd(20) + String(row.hours).padStart(4) + ' h   ' + ((row.hours / 168) * 100).toFixed(0) + '%'),
    '',
    'Allocated ' + week.allocated + ' h · unallocated ' + week.free + ' h (' + week.freePerDay.toFixed(1) + ' h a day)',
    week.over ? 'Over budget by ' + (week.allocated - 168) + ' h — something has to come from somewhere.' : 'Inside the week with room to spare.',
  ].join('\n'), [week]);

  const set = (id, hours) => setValues((current) => ({ ...current, [id]: hours }));

  return (
    <ToolShell
      toolId="time-budget"
      icon={Clock}
      title="Weekly Time Budget"
      desc="There are 168 hours in every week. Allocate them honestly across sleep, work, care and everything else, and see what is actually left."
      state={{ values }}
      onRestore={(restored) => {
        if (restored.values && typeof restored.values === 'object') setValues({ ...START, ...restored.values });
      }}
      exportText={report}
      exportName="time-budget.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setValues({ ...START, ...preset.values })}
            className={GROUPS.every((group) => Number(values[group.id]) === preset.values[group.id])
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j'
              : 'rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground'}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setValues(START)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {week.rows.map((row) => (
          <div key={row.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.colour }} />
                {row.label}
              </span>
              <span className="font-mono-j text-cyan-j">{row.hours} h · {(row.hours / 168 * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={80}
              step={0.5}
              value={row.hours}
              onChange={(e) => set(row.id, Number(e.target.value))}
              className="w-full accent-[hsl(var(--cyan))]"
              aria-label={row.label}
            />
            <div className="mt-0.5 flex justify-between font-mono-j text-[10px] text-muted-foreground">
              <span>{(row.hours / 7).toFixed(1)} h a day</span>
              <span>{row.hours > 0 ? Math.round((row.hours / 24) * 7 / 7 * 24) + ' min a day on average' : 'nothing'}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={week.over ? 'rose' : week.free > 20 ? 'emerald' : 'amber'}
          label={week.over ? 'Over the week by' : 'Unclaimed hours each week'}
          value={Math.abs(week.free).toFixed(1)}
          unit="hours"
          sub={(week.over
            ? 'Everything listed adds up to ' + week.allocated + ' hours against 168. Cut ' + Math.abs(week.free).toFixed(0) + ' to make it fit — sleep and care are the wrong places to take them from.'
            : 'That is ' + week.freePerDay.toFixed(1) + ' hours a day, or ' + (week.free / 31.5).toFixed(0) + ' hours a month, that no plan currently claims.')
            + ' Allocated ' + week.allocated.toFixed(1) + ' of 168.'}
        />
        <Ring
          value={week.allocated}
          max={168}
          tone={week.over ? 'rose' : 'emerald'}
          label="Of the week committed"
          sub={week.allocated.toFixed(0) + ' hours allocated, ' + (168 - week.allocated).toFixed(0) + ' left'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the week is distributed</div>
        <Bars
          data={week.rows.map((row) => ({ label: row.label.split(' ')[0], value: row.hours, colour: row.colour }))}
          format={(value) => value.toFixed(0)}
          suffix=" h"
          highlightLast={false}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          {week.biggest.hours > 0 ? week.biggest.label + ' is the largest commitment at ' + week.biggest.hours + ' hours a week. ' : ''}
          Work takes {week.workShare.toFixed(0)}% of everything you have allocated; sleep takes {((week.sleeping / 168) * 100).toFixed(0)}% of the whole week. Together,
          those two account for the bulk of a typical adult life, which is why small changes elsewhere feel so much bigger.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the numbers say</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· {week.sleeping >= 49 ? 'Sleep is at ' + (week.sleeping / 7).toFixed(1) + ' hours a night, which is in the healthy range.' : 'Sleep is ' + (week.sleeping / 7).toFixed(1) + ' hours a night — below the 7 that most people need, and the first thing to protect rather than cut.'}</p>
            <p>· You are awake for {week.waking.toFixed(0)} hours a week. Committed obligations take {week.allocated.toFixed(0)}, leaving {week.free.toFixed(0)} hours of genuinely free time — or a deficit.</p>
            <p>· {week.healthy ? 'Exercise has a real slot, which is the only reliable way it survives a busy week.' : 'Exercise has ' + (Number(values.health) || 0) + ' hours a week. Under three is where good intentions go to die; book it like a meeting.'}</p>
            <p>· Learning gets {(Number(values.learning) || 0).toFixed(1)} hours. At that rate a new skill takes a long time — an hour a day is roughly ' + Math.round((1 * 7) / Math.max(0.5, Number(values.learning) || 1)) + '× your current pace.</p>
            <p>· {week.free < 0 ? 'A negative balance means this week is arithmetically impossible. Real life resolves it by moving sleep or care into the gap — which is exactly what you do not want.' : 'Some of the free time will be absorbed by the unpredictable: illness, delays, other people. Leave a buffer rather than planning every hour.'}</p>
            <p>· The point of this is not a rigid timetable. It is knowing, before you say yes to something, which hour it is going to come out of.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the hours usually go</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Sleep 49–56 hours is the normal range; anything under 45 shows up as a health cost, not a time saving.</p>
            <p>· A full-time job with commute typically takes 45–50 hours, not 40 — the commute is part of the job.</p>
            <p>· Chores and errands are consistently underestimated. Nine to twelve hours a week is ordinary for an adult household.</p>
            <p>· Care responsibilities are the least flexible item on any list and the one most often left out of planning.</p>
            <p>· Social and rest time is not spare capacity. Removing it to make room looks efficient for two weeks and then stops working.</p>
          </div>
          <div className="mt-3">
            <CopyBtn value={report} label="Copy the breakdown" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Allocated" value={week.allocated.toFixed(0) + ' h'} mono sub="of 168" />
        <Stat label="Free" value={week.free.toFixed(0) + ' h'} mono sub={(week.freePerDay).toFixed(1) + ' h a day'} />
        <Stat label="Sleep a night" value={(week.sleeping / 7).toFixed(1) + ' h'} mono sub={week.sleeping >= 49 ? 'healthy' : 'short'} />
        <Stat label="Largest" value={week.biggest.label.split(' ')[0]} mono sub={week.biggest.hours + ' h'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Using this honestly</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Count real hours, not ideal ones. If the commute is forty minutes each way, that is six and a half hours a week, not two.</p>
          <p>· Keep the total at or below 168. If it does not fit, the plan is the problem, not your discipline.</p>
          <p>· Add up the small recurring things — the daily scroll, the second coffee run — and decide if that is how you want the week spent.</p>
          <p>· Recheck after a month. Weeks that look balanced on paper often show a two-hour daily gap nobody planned for.</p>
          <p>· Protect sleep and care first, then place the things you are trying to build, then let everything else fill the rest.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Allocated', value: week.allocated.toFixed(0) + ' h' },
              { label: 'Free', value: week.free.toFixed(0) + ' h' },
              { label: 'Work share', value: week.workShare.toFixed(0) + '%' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Every figure is a plain sum against the fixed 168 hours in a week, with a per-day equivalent so the numbers mean something in your head. Half-hour
          granularity is deliberate: a budget accurate to the minute is a budget nobody keeps, and the point here is the shape of the week rather than an exact
          ledger.
        </p>
      </Panel>
    </ToolShell>
  );
}