import { useMemo, useState } from 'react';
import { Users, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Ring } from './kit/premium';
import { CopyBtn, Panel, Stat } from './shared';

const LETTERS = ['R', 'A', 'C', 'I', ''];

const DEFAULT_TASKS = [
  { id: 't1', name: 'Scope the release' },
  { id: 't2', name: 'Build the feature' },
  { id: 't3', name: 'Review the code' },
  { id: 't4', name: 'Sign off on quality' },
  { id: 't5', name: 'Approve the launch' },
];

const DEFAULT_PEOPLE = [
  { id: 'p1', name: 'Priya' },
  { id: 'p2', name: 'Tom' },
  { id: 'p3', name: 'Ada' },
];

const DEFAULT_GRID = {
  't1:p1': 'R', 't1:p2': 'C', 't1:p3': 'A',
  't2:p1': 'A', 't2:p2': 'R', 't2:p3': 'I',
  't3:p1': 'C', 't3:p2': 'R', 't3:p3': 'A',
  't4:p1': 'A', 't4:p2': 'C', 't4:p3': 'I',
};

export default function RaciBuilder() {
  const [tasks, setTasks] = useState(DEFAULT_TASKS);
  const [people, setPeople] = useState(DEFAULT_PEOPLE);
  const [grid, setGrid] = useState(DEFAULT_GRID);

  const cycle = (taskId, personId) => {
    const key = taskId + ':' + personId;
    setGrid((current) => {
      const value = current[key] || '';
      const next = LETTERS[(LETTERS.indexOf(value) + 1) % LETTERS.length];
      return { ...current, [key]: next };
    });
  };

  const result = useMemo(() => {
    const rows = tasks.map((task) => {
      const cells = people.map((person) => ({ person, value: grid[task.id + ':' + person.id] || '' }));
      const accountable = cells.filter((cell) => cell.value === 'A');
      const responsible = cells.filter((cell) => cell.value === 'R');
      const consulted = cells.filter((cell) => cell.value === 'C');
      const informed = cells.filter((cell) => cell.value === 'I');
      const issues = [];
      if (accountable.length === 0) issues.push('no one is accountable');
      if (accountable.length > 1) issues.push(accountable.length + ' people are accountable');
      if (responsible.length === 0) issues.push('no one does the work');
      if (cells.every((cell) => !cell.value)) issues.push('nothing assigned');
      return { task, cells, accountable, responsible, consulted, informed, issues };
    });

    const peopleRows = people.map((person) => {
      const values = tasks.map((task) => grid[task.id + ':' + person.id] || '');
      return {
        person,
        counts: {
          R: values.filter((value) => value === 'R').length,
          A: values.filter((value) => value === 'A').length,
          C: values.filter((value) => value === 'C').length,
          I: values.filter((value) => value === 'I').length,
        },
        total: values.filter(Boolean).length,
      };
    });

    const warnings = [];
    rows.forEach((row) => {
      if (row.issues.length) warnings.push(row.task.name + ': ' + row.issues.join(', ') + '.');
    });
    peopleRows.forEach((row) => {
      if (row.total === 0) warnings.push(row.person.name + ' appears nowhere in the matrix, which means their involvement is implicit rather than agreed.');
      else if (row.counts.A > 2) warnings.push(row.person.name + ' is accountable for ' + row.counts.A + ' tasks. Accountability does not scale — spread it.');
      else if (row.counts.R > 3 && row.counts.A === 0) warnings.push(row.person.name + ' is doing ' + row.counts.R + ' tasks without being accountable for any of them.');
    });

    const coverage = tasks.length && people.length
      ? (rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.value).length, 0) / (tasks.length * people.length)) * 100
      : 0;

    const markdown = [
      '| Task | ' + people.map((person) => person.name).join(' | ') + ' |',
      '| --- | ' + people.map(() => '---').join(' | ') + ' |',
      ...rows.map((row) => '| ' + row.task.name + ' | ' + row.cells.map((cell) => cell.value || '·').join(' | ') + ' |'),
    ].join('\n');

    const csv = [
      'Task,' + people.map((person) => person.name).join(','),
      ...rows.map((row) => '"' + row.task.name + '",' + row.cells.map((cell) => cell.value || '').join(',')),
    ].join('\n');

    const report = [
      'RACI matrix — ' + tasks.length + ' tasks across ' + people.length + ' people',
      '',
      markdown,
      '',
      'Legend: R responsible for the work · A accountable for the outcome · C consulted before · I informed after',
      '',
      'Per person:',
      ...peopleRows.map((row) => '  ' + row.person.name.padEnd(12, ' ') + 'R ' + row.counts.R + ' · A ' + row.counts.A + ' · C ' + row.counts.C + ' · I ' + row.counts.I),
      '',
      ...(warnings.length ? warnings.map((line) => '· ' + line) : ['No structural problems found: every task has exactly one accountable person and at least one doer.']),
    ].join('\n');

    return {
      rows, peopleRows, warnings, coverage, markdown, csv, report,
      counts: [
        { label: 'R', value: peopleRows.reduce((sum, row) => sum + row.counts.R, 0) },
        { label: 'A', value: peopleRows.reduce((sum, row) => sum + row.counts.A, 0) },
        { label: 'C', value: peopleRows.reduce((sum, row) => sum + row.counts.C, 0) },
        { label: 'I', value: peopleRows.reduce((sum, row) => sum + row.counts.I, 0) },
      ],
    };
  }, [tasks, people, grid]);

  return (
    <ToolShell
      toolId="raci"
      icon={Users}
      title="RACI Matrix Builder"
      desc="Who does the work, who answers for it, who is consulted and who is told — a clickable grid that checks its own structure and flags the tasks that will stall."
      state={{ tasks, people, grid }}
      onRestore={(restored) => {
        if (Array.isArray(restored.tasks) && restored.tasks.length) setTasks(restored.tasks);
        if (Array.isArray(restored.people) && restored.people.length) setPeople(restored.people);
        if (restored.grid && typeof restored.grid === 'object') setGrid(restored.grid);
      }}
      exportText={result.report}
      exportName="raci-matrix.md"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Tasks or deliverables</div>
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2">
                <input value={task.name} onChange={(e) => setTasks((current) => current.map((row) => (row.id === task.id ? { ...row, name: e.target.value } : row)))} className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm" />
                <button type="button" onClick={() => setTasks((current) => current.filter((row) => row.id !== task.id))} className="inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setTasks((current) => [...current, { id: Math.random().toString(36).slice(2), name: 'New task' }])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
            <Plus className="h-3.5 w-3.5" /> Add a task
          </button>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">People or roles</div>
          <div className="space-y-2">
            {people.map((person) => (
              <div key={person.id} className="flex items-center gap-2">
                <input value={person.name} onChange={(e) => setPeople((current) => current.map((row) => (row.id === person.id ? { ...row, name: e.target.value } : row)))} className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-sm" />
                <button type="button" onClick={() => setPeople((current) => current.filter((row) => row.id !== person.id))} className="inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setPeople((current) => [...current, { id: Math.random().toString(36).slice(2), name: 'New person' }])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
            <Plus className="h-3.5 w-3.5" /> Add a person
          </button>
          <p className="mt-2 text-[11px] text-muted-foreground">Click a cell in the grid to cycle R, A, C, I and blank. Use roles rather than names where the work outlives a person.</p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.warnings.length === 0 ? 'emerald' : 'amber'}
          label="Cells assigned"
          value={result.coverage.toFixed(0)}
          unit="%"
          sub={tasks.length + ' tasks across ' + people.length + ' people, with ' + result.warnings.length + ' structural problem' + (result.warnings.length === 1 ? '' : 's') + '. A matrix where everything is marked I is not a matrix — it is a mailing list.'}
        />
        <Ring
          value={result.peopleRows.filter((row) => row.counts.A === 1).length}
          max={Math.max(1, people.length)}
          tone="cyan"
          label="People with clear accountability"
          sub={result.peopleRows.filter((row) => row.counts.A === 0).length + ' have no accountable task at all'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">The matrix</span>
          <CopyBtn value={result.markdown} label="Copy as Markdown" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left text-[11px] font-medium text-muted-foreground">Task</th>
                {people.map((person) => (
                  <th key={person.id} className="w-16 text-center text-[11px] font-medium">{person.name}</th>
                ))}
                <th className="w-24 text-left text-[11px] font-medium text-muted-foreground">Structure</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.task.id}>
                  <td className="pr-2 text-[11px]">{row.task.name}</td>
                  {row.cells.map((cell) => (
                    <td key={cell.person.id}>
                      <button
                        type="button"
                        onClick={() => cycle(row.task.id, cell.person.id)}
                        className={cell.value
                          ? 'h-9 w-full rounded-lg border border-cyan-j/50 bg-cyan-j/10 font-mono-j text-sm text-cyan-j transition hover:bg-cyan-j/20'
                          : 'h-9 w-full rounded-lg border border-border/60 font-mono-j text-sm text-muted-foreground/50 transition hover:border-cyan-j/40'}
                      >
                        {cell.value || '·'}
                      </button>
                    </td>
                  ))}
                  <td className="text-[10px]">
                    {row.issues.length === 0
                      ? <span className="text-emerald-300">clear</span>
                      : <span className="text-amber-300">{row.issues.join(' · ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          R does the work, A answers for the outcome, C is consulted before it happens, I is told after. Exactly one A per task is the rule that makes the rest of the matrix
          useful.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Load per person</div>
          <div className="space-y-1">
            {result.peopleRows.map((row) => (
              <div key={row.person.id} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{row.person.name}</span>
                  <span className="ml-auto font-mono-j text-muted-foreground">R {row.counts.R} · A {row.counts.A} · C {row.counts.C} · I {row.counts.I}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            A healthy person has one or two A cells, a few R cells and several C or I cells. Anyone with three or more A cells will become the bottleneck.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How assignments are spread</div>
          <Bars data={result.counts} format={(value) => String(value)} suffix=" cells" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Most cells in a working matrix are C and I. If almost everything is R, the matrix is a task list; if almost everything is I, the work is being done by people who
            have not been consulted.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Tasks" value={String(tasks.length)} mono sub={people.length + ' people'} />
        <Stat label="Assigned cells" value={result.coverage.toFixed(0) + '%'} mono sub="of the whole grid" />
        <Stat label="Problems" value={String(result.warnings.length)} mono sub="structural issues" />
        <Stat label="Markdown" value="ready" mono sub="copy into a wiki or ticket" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3 !border-amber-400/50">
          <div className="space-y-1 text-[11px] text-amber-200">
            {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Making the matrix mean something</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· One A per task, always. Two accountable people is the single most reliable predictor of something not getting done.</p>
            <p>· A can be the same person as R on small tasks. That is normal and not a problem — the point is that somebody owns the outcome.</p>
            <p>· Keep C small. Consulting everyone in advance is how decisions take three weeks; consult the people whose disagreement would change the answer.</p>
            <p>· Use it before the work, not after a delay. A RACI built during a post-mortem is a description, not a plan.</p>
            <p>· Publish it where the work happens, in the ticket or the channel, not in a document nobody opens.</p>
            <p>· Revisit it when the shape of the team changes. Matrices go stale quietly and then confidently assign the wrong person.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The letters, in plain language</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· <span className="font-mono-j text-cyan-j">R</span> — responsible: does the work, and there can be several.</p>
            <p>· <span className="font-mono-j text-cyan-j">A</span> — accountable: the person whose name is on the outcome and who makes the final call. Exactly one.</p>
            <p>· <span className="font-mono-j text-cyan-j">C</span> — consulted: asked for input before the decision, in a way that can genuinely change it.</p>
            <p>· <span className="font-mono-j text-cyan-j">I</span> — informed: told after the fact, with no expectation of response.</p>
            <p>· Variants exist — RASCI adds a support role, RACI-VS adds verifier and signatory, CAIRO adds out-of-loop — but four letters is enough for almost every team.</p>
            <p>· {result.warnings.length === 0 ? 'This matrix has no structural problems, which means it can be published as it stands.' : 'Fix the flagged tasks first: ' + result.warnings.length + ' structural issue' + (result.warnings.length === 1 ? '' : 's') + ' will otherwise turn into a delayed decision.'}</p>
          </div>
          <div className="mt-3">
            <CopyBtn value={result.csv} label="Copy as CSV" />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the structure is checked</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>each task is checked for exactly one A and at least one R</p>
          <p>a task with no assignments at all is flagged as unassigned</p>
          <p>each person is checked for presence, for more than two A cells, and for doing work without accountability</p>
          <p>coverage is the proportion of grid cells that carry a letter</p>
          <p className="text-cyan-j">Check: {result.rows.filter((row) => row.issues.length === 0).length} of {result.rows.length} tasks have valid structure.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The checks cover the structural rules that most often cause delivery problems. They cannot tell whether the right person is accountable — that is a judgement about the
          team, which the matrix can only make visible.
        </p>
      </Panel>
    </ToolShell>
  );
}