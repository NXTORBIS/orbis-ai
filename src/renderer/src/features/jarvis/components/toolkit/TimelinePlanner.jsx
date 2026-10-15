import { useMemo, useState } from 'react';
import { CalendarRange, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);
const iso = (date) => date.toISOString().slice(0, 10);
const shift = (date, days) => new Date(date.getTime() + days * 86400000);
const parseDay = (value) => new Date(value + 'T00:00:00');
const dayCount = (from, to) => Math.round((to.getTime() - from.getTime()) / 86400000);

const START = [
  { id: uid(), name: 'Brief and research', owner: 'Alex', start: iso(new Date()), days: '3', after: '' },
  { id: uid(), name: 'Design pass', owner: 'Sam', start: iso(new Date()), days: '5', after: '' },
  { id: uid(), name: 'Build', owner: 'Jordan', start: iso(new Date()), days: '10', after: '' },
  { id: uid(), name: 'Review and polish', owner: 'Alex', start: iso(new Date()), days: '3', after: '' },
  { id: uid(), name: 'Launch', owner: 'Sam', start: iso(new Date()), days: '1', after: '' },
];

const OWNER_COLOURS = ['#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#f472b6'];

export default function TimelinePlanner() {
  const [tasks, setTasks] = useState(START.map((task, index) => ({ ...task, after: index === 0 ? '' : START[index - 1].name })));
  const [title, setTitle] = useState('Website rebuild');

  const plan = useMemo(() => {
    const rows = tasks.filter((task) => task.name.trim());
    if (!rows.length) return { rows: [], empty: true };

    const byName = {};
    rows.forEach((row) => { byName[row.name.trim().toLowerCase()] = row; });

    const resolved = {};
    const resolving = new Set();
    const compute = (row) => {
      if (resolved[row.id]) return resolved[row.id];
      if (resolving.has(row.id)) {
        const fallback = { start: parseDay(row.start), end: shift(parseDay(row.start), Number(row.days) || 1) };
        resolved[row.id] = fallback;
        return fallback;
      }
      resolving.add(row.id);
      let start = parseDay(row.start);
      const dependency = row.after ? byName[row.after.trim().toLowerCase()] : null;
      if (dependency && dependency.id !== row.id) {
        const upstream = compute(dependency);
        if (upstream.end > start) start = shift(upstream.end, 0);
      }
      const end = shift(start, Number(row.days) || 1);
      const result = { start, end };
      resolved[row.id] = result;
      resolving.delete(row.id);
      return result;
    };

    const scheduled = rows.map((row) => {
      const timing = compute(row);
      return { ...row, startDate: timing.start, endDate: timing.end, length: Number(row.days) || 1, blocked: Boolean(row.after && !byName[row.after.trim().toLowerCase()]) };
    });

    const rangeStart = new Date(Math.min(...scheduled.map((row) => row.startDate.getTime())));
    const rangeEnd = new Date(Math.max(...scheduled.map((row) => row.endDate.getTime())));
    const span = Math.max(1, dayCount(rangeStart, rangeEnd));

    const owners = [...new Set(scheduled.map((row) => row.owner.trim() || 'unassigned'))];
    const coloured = scheduled.map((row) => ({ ...row, colour: OWNER_COLOURS[owners.indexOf(row.owner.trim() || 'unassigned') % OWNER_COLOURS.length] }));

    const chain = {};
    const chainOf = (row) => {
      if (chain[row.id]) return chain[row.id];
      const dependency = row.after ? byName[row.after.trim().toLowerCase()] : null;
      if (!dependency || dependency.id === row.id) {
        chain[row.id] = [row.name];
        return chain[row.id];
      }
      chain[row.id] = [...chainOf(dependency), row.name];
      return chain[row.id];
    };
    const paths = coloured.map((row) => ({ names: chainOf(row), length: chainOf(row).reduce((sum, name) => {
      const match = coloured.find((entry) => entry.name === name);
      return sum + (match ? match.length : 0);
    }, 0) }));
    const critical = paths.sort((a, b) => b.length - a.length)[0];

    const effort = coloured.reduce((sum, row) => sum + row.length, 0);
    const days = Array.from({ length: Math.min(span, 60) }, (_, index) => shift(rangeStart, index));
    const weeks = Math.ceil(span / 7);

    return {
      rows: coloured, rangeStart, rangeEnd, span, owners, critical,
      effort, days, weeks, empty: false,
      finish: dayCount(new Date(), rangeEnd),
      overlap: effort / Math.max(1, span),
    };
  }, [tasks]);

  const report = useMemo(() => {
    if (plan.empty) return 'Add at least one task.';
    const lines = [
      title + ' · ' + dayCount(plan.rangeStart, plan.rangeEnd) + ' days · ' + plan.rows.length + ' tasks',
      '',
      ...plan.rows.map((row) => [
        row.name,
        'starts ' + row.startDate.toLocaleDateString(),
        'ends ' + shift(row.endDate, -1).toLocaleDateString(),
        row.length + ' days',
        row.owner || 'unassigned',
      ].join('  ·  ')),
      '',
      'Longest chain: ' + plan.critical.names.join(' → ') + ' (' + plan.critical.length + ' days)',
    ];
    return lines.join('\n');
  }, [plan, title]);

  const setTask = (id, patch) => setTasks((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <ToolShell
      toolId="timeline-planner"
      icon={CalendarRange}
      title="Project Timeline Planner"
      desc="Timetable a project properly — dependencies push real dates around, the longest chain is found for you, and the whole thing renders as a bar chart you can read at a glance."
      state={{ tasks, title }}
      onRestore={(restored) => {
        if (Array.isArray(restored.tasks) && restored.tasks.length) setTasks(restored.tasks);
        if (typeof restored.title === 'string') setTitle(restored.title);
      }}
      exportText={report}
      exportName="timeline.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.4fr_auto]">
        <Field label="Project">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <div className="flex items-end">
          <CopyBtn value={report} label="Copy the schedule" />
        </div>
      </div>

      <div className="space-y-2">
        {tasks.map((task, index) => (
          <div key={task.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_8rem_5rem_1fr_auto] sm:items-center">
              <input value={task.name} onChange={(e) => setTask(task.id, { name: e.target.value })} placeholder="Task" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
              <input value={task.owner} onChange={(e) => setTask(task.id, { owner: e.target.value })} placeholder="Owner" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
              <input type="date" value={task.start} onChange={(e) => setTask(task.id, { start: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]" />
              <input value={task.days} onChange={(e) => setTask(task.id, { days: e.target.value })} inputMode="numeric" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
              <select
                value={task.after}
                onChange={(e) => setTask(task.id, { after: e.target.value })}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-[11px]"
              >
                <option value="">starts independently</option>
                {tasks.filter((row) => row.id !== task.id && row.name.trim()).map((row) => (
                  <option key={row.id} value={row.name}>after {row.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => setTasks((current) => current.filter((row) => row.id !== task.id))} className="text-muted-foreground transition hover:text-rose-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {index === 0 && <div className="mt-1 text-[10px] text-muted-foreground">Days = working length · “after” chains tasks so the earlier one pushes this one later</div>}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setTasks((current) => [...current, { id: uid(), name: '', owner: '', start: iso(new Date()), days: '3', after: '' }].slice(0, 30))}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
      >
        <Plus className="h-3.5 w-3.5" /> Add a task
      </button>

      {plan.empty ? (
        <Panel className="text-[12px] text-muted-foreground">Add a task to draw the timeline.</Panel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              label="Project spans"
              value={plan.span}
              unit="days"
              sub={plan.rangeStart.toLocaleDateString() + ' to ' + shift(plan.rangeEnd, -1).toLocaleDateString() + ' · ' + plan.weeks + ' week' + (plan.weeks === 1 ? '' : 's') + ' · finishes in ' + plan.finish + ' days at this pace'}
            />
            <Ring
              value={plan.critical.length}
              max={Math.max(1, plan.span)}
              tone={plan.critical.length / plan.span > 0.8 ? 'rose' : 'emerald'}
              label="Longest chain vs the whole span"
              sub={plan.critical.names.length + ' tasks in a row, ' + plan.critical.length + ' of ' + plan.span + ' days'}
            />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">The timeline</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">
                {plan.rangeStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} → {shift(plan.rangeEnd, -1).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
            </div>
            <div className="space-y-1.5">
              {plan.rows.map((row) => {
                const offset = (dayCount(plan.rangeStart, row.startDate) / plan.span) * 100;
                const width = Math.max(1.5, (row.length / plan.span) * 100);
                const onCritical = plan.critical.names.includes(row.name);
                return (
                  <div key={row.id} className="grid grid-cols-[8rem_1fr] items-center gap-2">
                    <div className="truncate text-[11px]">
                      <span className={onCritical ? 'text-cyan-j' : ''}>{row.name}</span>
                      <span className="ml-1 text-muted-foreground">· {row.owner || '—'}</span>
                    </div>
                    <div className="relative h-6 rounded-md border border-border/50 bg-muted/30">
                      <div
                        className="absolute inset-y-0.5 rounded"
                        style={{ left: offset + '%', width: width + '%', backgroundColor: row.colour, boxShadow: onCritical ? '0 0 0 1px hsl(var(--cyan) / 0.6)' : undefined }}
                        title={row.name + ': ' + row.startDate.toLocaleDateString() + ' → ' + shift(row.endDate, -1).toLocaleDateString()}
                      />
                      <span className="absolute inset-y-0 right-1.5 flex items-center font-mono-j text-[9px] text-muted-foreground">{row.length}d</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Bars are positioned on a shared calendar, so the gaps between them are real idle time. The outlined bar is on the longest chain — every day that
              chain slips, the project finish slips with it.
            </p>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Dates, in order</div>
              <div className="max-h-72 space-y-1 overflow-auto">
                {[...plan.rows].sort((a, b) => a.startDate - b.startDate).map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                    <span className="truncate">{row.name}</span>
                    <span className="ml-2 shrink-0 font-mono-j text-[10px] text-muted-foreground">
                      {row.startDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} → {shift(row.endDate, -1).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Reading the schedule</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· The longest chain is <span className="text-cyan-j">{plan.critical.names.join(' → ')}</span> at {plan.critical.length} days — that is the critical path, and it is what any deadline has to be measured against.</p>
                <p>· Total effort is {plan.effort} task-days across {plan.span} calendar days, so roughly {plan.overlap.toFixed(1)} tasks run at once. Above about three, expect coordination cost.</p>
                <p>· A dependency only delays a task if the earlier one finishes after this task's own start date — that is why changing one date can move half the chart, or none of it.</p>
                <p>· Owners: {plan.owners.join(', ')}. Anyone appearing twice in a row is a bottleneck waiting to happen.</p>
                <p>· {plan.span > 60 ? 'Over two months, so review it weekly rather than replanning it monthly.' : 'Short enough to review at each milestone rather than weekly.'}</p>
              </div>
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Tasks" value={String(plan.rows.length)} mono />
            <Stat label="Span" value={plan.span + 'd'} mono sub={plan.weeks + ' weeks'} />
            <Stat label="Effort" value={plan.effort + 'd'} mono sub="task-days" />
            <Stat label="Longest chain" value={plan.critical.length + 'd'} mono sub={plan.critical.names.length + ' tasks'} />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Planning that survives contact with reality</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Estimate in working days and count from a start date, not from "as soon as possible" — vague starts are where schedules die.</p>
              <p>· Keep the critical path short. Parallel work that is not on the chain can slip without hurting the date; chain work cannot.</p>
              <p>· Put the review at the end of a phase, not fixed to a Friday — a milestone that arrives before the work is ready teaches nothing.</p>
              <p>· Add a buffer to the final task rather than to every task; distributed padding hides slip instead of absorbing it.</p>
              <p>· A plan with no dependency marked is a list of hopes. Even three or four real links make the difference between a schedule and a wish.</p>
            </div>
            <div className="mt-2">
              <Pills
                items={[
                  { label: 'Span', value: plan.span + ' days' },
                  { label: 'Effort', value: plan.effort + ' task-days' },
                  { label: 'Owners', value: String(plan.owners.length) },
                ]}
              />
            </div>
          </Panel>

          <Panel>
            <p className="text-[11px] text-muted-foreground">
              Dates are resolved in dependency order: each task starts on its own date or the day its predecessor ends, whichever is later, with a loop guard so a
              chain that circles back cannot hang the page. The critical path is the longest chain by duration, found by walking every chain rather than assuming
              the last task is the longest.
            </p>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}