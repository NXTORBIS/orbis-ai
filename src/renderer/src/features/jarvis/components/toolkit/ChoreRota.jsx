import { useMemo, useState } from 'react';
import { Plus, RefreshCw, Users } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const PEOPLE = [{ id: uid(), name: 'Alex' }, { id: uid(), name: 'Sam' }, { id: uid(), name: 'Jordan' }];

const TASKS = [
  { id: uid(), name: 'Kitchen', effort: '3' },
  { id: uid(), name: 'Bathroom', effort: '4' },
  { id: uid(), name: 'Bins', effort: '1' },
  { id: uid(), name: 'Hoover', effort: '2' },
];

export default function ChoreRota() {
  const [people, setPeople] = useState(PEOPLE);
  const [tasks, setTasks] = useState(TASKS);
  const [weeks, setWeeks] = useState('8');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [fair, setFair] = useState(true);

  const rota = useMemo(() => {
    const activePeople = people.filter((person) => person.name.trim());
    const activeTasks = tasks.filter((task) => task.name.trim());
    const weekCount = Math.max(1, Math.min(52, Number(weeks) || 1));
    if (!activePeople.length || !activeTasks.length) return { rows: [], burden: [], weekCount };

    const mondayOf = new Date(start + 'T00:00:00');
    const rows = Array.from({ length: weekCount }, (_, weekIndex) => {
      const date = new Date(mondayOf.getTime() + weekIndex * 7 * 86400000);
      const assignments = activeTasks.map((task, taskIndex) => {
        const slot = weekIndex * activeTasks.length + taskIndex;
        const person = fair
          ? activePeople[(slot + 0) % activePeople.length]
          : activePeople[taskIndex % activePeople.length];
        return { task, person };
      });
      return { weekIndex, date, assignments };
    });

    const burden = activePeople.map((person) => {
      const assigned = rows.flatMap((row) => row.assignments.filter((entry) => entry.person.id === person.id));
      const effort = assigned.reduce((sum, entry) => sum + (Number(entry.task.effort) || 1), 0);
      return { person, count: assigned.length, effort };
    });

    return { rows, burden, weekCount, activeTasks, activePeople };
  }, [people, tasks, weeks, start, fair]);

  const totals = useMemo(() => {
    const efforts = rota.burden.map((row) => row.effort);
    const max = Math.max(...efforts, 0);
    const min = Math.min(...efforts, 0);
    return { max, min, spread: max - min };
  }, [rota]);

  const report = useMemo(() => {
    if (!rota.rows.length) return 'Add at least one person and one task.';
    const lines = [];
    rota.rows.forEach((row) => {
      lines.push('Week of ' + row.date.toLocaleDateString() + ': ' + row.assignments.map((entry) => entry.person.name + ' — ' + entry.task.name).join(' · '));
    });
    lines.push('');
    lines.push('Totals over ' + rota.weekCount + ' weeks:');
    rota.burden.forEach((row) => lines.push('  ' + row.person.name + ': ' + row.count + ' tasks (' + row.effort + ' effort points)'));
    return lines.join('\n');
  }, [rota]);

  const rotate = () => setStart((current) => {
    const date = new Date(current + 'T00:00:00');
    date.setDate(date.getDate() + 7);
    return date.toISOString().slice(0, 10);
  });

  return (
    <ToolShell
      toolId="chore-rota"
      icon={Users}
      title="Chore Rota Builder"
      desc="A rotating schedule that shares the work fairly — weighted by how much effort each job actually takes, not just how many jobs there are."
      state={{ people, tasks, weeks, start, fair }}
      onRestore={(restored) => {
        if (Array.isArray(restored.people) && restored.people.length) setPeople(restored.people);
        if (Array.isArray(restored.tasks) && restored.tasks.length) setTasks(restored.tasks);
        if (restored.weeks !== undefined) setWeeks(String(restored.weeks));
        if (restored.start) setStart(restored.start);
        if (typeof restored.fair === 'boolean') setFair(restored.fair);
      }}
      exportText={report}
      exportName="rota.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={rotate} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <RefreshCw className="h-3.5 w-3.5" /> Roll forward a week
        </button>
        <CopyBtn value={report} label="Copy rota" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Who is on the rota</div>
          <div className="space-y-2">
            {people.map((person) => (
              <div key={person.id} className="flex items-center gap-2">
                <input
                  value={person.name}
                  onChange={(e) => setPeople((current) => current.map((row) => (row.id === person.id ? { ...row, name: e.target.value } : row)))}
                  placeholder="Name"
                  className="h-9 flex-1 rounded-md border border-input bg-transparent px-2.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setPeople((current) => current.filter((row) => row.id !== person.id))}
                  disabled={people.length <= 1}
                  className="text-[11px] text-muted-foreground transition hover:text-rose-400 disabled:opacity-30"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPeople((current) => [...current, { id: uid(), name: '' }].slice(0, 12))}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
          >
            <Plus className="h-3.5 w-3.5" /> Add person
          </button>
        </Panel>

        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Jobs and how heavy they are</div>
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="grid grid-cols-[1.6fr_1fr_auto] items-center gap-2">
                <input
                  value={task.name}
                  onChange={(e) => setTasks((current) => current.map((row) => (row.id === task.id ? { ...row, name: e.target.value } : row)))}
                  placeholder="Task"
                  className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={task.effort}
                    onChange={(e) => setTasks((current) => current.map((row) => (row.id === task.id ? { ...row, effort: e.target.value } : row)))}
                    className="w-full accent-[hsl(var(--cyan))]"
                  />
                  <span className="font-mono-j text-[11px] text-cyan-j">{task.effort}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTasks((current) => current.filter((row) => row.id !== task.id))}
                  disabled={tasks.length <= 1}
                  className="text-[11px] text-muted-foreground transition hover:text-rose-400 disabled:opacity-30"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setTasks((current) => [...current, { id: uid(), name: '', effort: '2' }].slice(0, 12))}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
          >
            <Plus className="h-3.5 w-3.5" /> Add task
          </button>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={'Weeks to plan · ' + weeks}>
          <input type="range" min={4} max={26} step={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Starting week of">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <div className="self-end">
          <ToggleRow label="Rotate so nobody gets the worst job twice" checked={fair} onChange={setFair} hint="Spreads effort, not just task count" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={totals.spread <= 2 ? 'emerald' : totals.spread <= 5 ? 'amber' : 'rose'}
          label="Effort spread across the rota"
          value={totals.spread}
          unit="points"
          sub={totals.spread <= 2
            ? 'Nobody is carrying more than the others — this rota is fair.'
            : 'One person is carrying ' + totals.spread + ' effort points more than the lightest. Reorder the jobs or add a person.'}
        />
        <Ring
          value={totals.min}
          max={totals.max || 1}
          tone={totals.spread <= 2 ? 'emerald' : 'amber'}
          label="Lightest vs heaviest load"
          sub={'lightest ' + totals.min + ' · heaviest ' + totals.max}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Effort carried by each person</div>
        <Bars
          data={rota.burden.map((row) => ({ label: row.person.name.slice(0, 8), value: row.effort }))}
          format={(value) => String(value)}
          suffix=" pts"
          highlightLast={false}
        />
        <div className="mt-2 space-y-1">
          {rota.burden.map((row) => (
            <div key={row.person.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span>{row.person.name}</span>
              <span className="font-mono-j text-muted-foreground">{row.count} jobs</span>
              <span className="font-mono-j text-cyan-j">{row.effort} effort points</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The rota, week by week</div>
        <div className="max-h-96 space-y-1.5 overflow-auto">
          {rota.rows.map((row) => (
            <div key={row.weekIndex} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono-j text-[10px] text-muted-foreground">
                  Week {row.weekIndex + 1} · {row.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  {row.weekIndex === 0 ? ' (this week)' : ''}
                </span>
                <span className="font-mono-j text-[10px] text-cyan-j">
                  {row.assignments.reduce((sum, entry) => sum + (Number(entry.task.effort) || 1), 0)} pts
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.assignments.map((entry) => (
                  <span key={entry.task.id} className="rounded-md border border-cyan-j/40 bg-cyan-j/5 px-2 py-0.5 text-[11px]">
                    <span className="text-cyan-j">{entry.person.name || '—'}</span>
                    <span className="text-muted-foreground"> · {entry.task.name}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {!rota.rows.length && <span className="text-[11px] text-muted-foreground">Add at least one person and one task to build the rota.</span>}
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="People" value={String(people.length)} mono />
        <Stat label="Jobs" value={String(tasks.length)} mono />
        <Stat label="Weeks planned" value={String(rota.weekCount || 0)} mono />
        <Stat label="Spread" value={totals.spread + ' pts'} mono sub={totals.spread <= 2 ? 'fair' : 'uneven'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Making a rota people actually follow</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Weight jobs by how much they are disliked, not how long they take. Ten minutes of bathroom is not the same as ten minutes of bins.</p>
          <p>· Rotate on a fixed day and let people swap freely — the rota exists so the decision is made once, not so it is enforced.</p>
          <p>· {fair ? 'Fair rotation means a job moves to the next person each week, so nobody is stuck with the same one for the whole period.' : 'Each job is pinned to a person, which is simpler but leaves the heavy jobs with the same person.'}</p>
          <p>· Put the rota where everyone sees it, and roll it forward a week at a time so the next week is always visible.</p>
          <p>· Review after a month: if one job always gets swapped away, the job is the problem, not the person doing it.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Pattern', value: fair ? 'rotating' : 'fixed' },
              { label: 'Lightest', value: totals.min + ' pts' },
              { label: 'Heaviest', value: totals.max + ' pts' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Effort points are your own judgement — a sliding scale from 1 to 5 per job is enough. The scheduler walks jobs and people in step, so every week
          each job moves to the next person and the total effort travels with the job rather than sticking to a name.
        </p>
      </Panel>
    </ToolShell>
  );
}